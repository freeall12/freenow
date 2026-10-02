const test=require('node:test'),assert=require('node:assert/strict');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const disk=()=>{const data=new Map();return {data,readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async value=>{data.set(value.id,structuredClone(value));}};};
const textRequest={kind:'text.generate',prompt:'原始正文',parameters:{modelId:'text',model:'文字展示名',count:1}};
const textProvider=client=>({protocol:'openai-native',baseUrl:'https://openai.test/v1',apiKey:'private-openai',modelMap:{text:{kind:'text.generate',model:'actual-secret-model'}},client:client||{responses:{create:async()=>({output_text:'真实正文'})}}});
const taskProvider={protocol:'tasks-v1',baseUrl:'https://tasks.test/v1',apiKey:'private-tasks'};
const videoProvider={protocol:'ark-native',baseUrl:'https://ark.test/api/v3',apiKey:'private-ark',modelMap:{video:{kind:'video.generate',model:'actual-secret-video',modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}},supportsDraft:true,supportsDraftTask:true}}};
const videoRequest={kind:'video.generate',prompt:'树林里行走的小狐狸',inputs:[],parameters:{model:'视频展示名',modelId:'video',count:1,ratio:'16:9',quality:'720p',duration:5,audio:true,audioLabel:'开启',camera:'Sony Venice',lens:'Zeiss Ultra Prime',focal:'24mm',aperture:'ƒ/4',thinking:'high',providerParameters:{model:'video',modelType:'TEXT_TO_VIDEO',aspectRatio:'16:9',resolution:'720p',duration:5,generateAudio:true,times:1}}};
async function settled(service,id){for(let i=0;i<20;i++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await tick();}return service.get(id);}

test('exact kind and nullish model precedence choose one provider, missing routes do not disable working routes',async()=>{
 const calls=[],providers={native:textProvider({responses:{create:async()=>{calls.push('native');return {output_text:'正文'};}}}),tasks:taskProvider};
 const router=createGenerationRouter({providers,routes:{'text.generate':{default:'tasks',models:{text:'native','task-alias':'tasks'}}},fetchImpl:async(_url,options)=>{calls.push('tasks');return response({status:'succeeded',outputs:[{type:'text',text:JSON.parse(options.body).prompt}]});}});
 assert.equal(router.configured,true);assert.equal(router.protocolFor(textRequest),'openai-native');assert.equal(router.isPollable(textRequest),false);
 await router.submit(textRequest);await router.submit({...textRequest,parameters:{modelId:'text',providerParameters:{model:'task-alias'}}});await router.submit({...textRequest,parameters:{model:'unknown-alias'}});
 assert.deepEqual(calls,['native','tasks','tasks']);
 assert.throws(()=>router.prepare({...textRequest,kind:'image.generate'}),{code:'configuration_required'});
 assert.throws(()=>router.prepare({...textRequest,kind:'text.generate.extra'}),{code:'configuration_required'});
 assert.throws(()=>router.prepare({...textRequest,parameters:{modelId:'text',providerParameters:{model:''}}}),{code:'unsupported_generation'});
});

test('no fallback after selected provider lacks key, kind, mapping or returns an uncertain response',async()=>{
 let taskCalls=0,nativeCalls=0;
 const providers={native:textProvider({responses:{create:async()=>{nativeCalls++;throw Error('private-openai');}}}),disabled:{...taskProvider,apiKey:''},tasks:taskProvider};
 const fetchImpl=async()=>{taskCalls++;return response({status:'succeeded',outputs:[{type:'text',text:'错误替代'}]});};
 let router=createGenerationRouter({providers,routes:{'text.generate':{default:'tasks',models:{text:'native',disabled:'disabled'}},'video.generate':'native'},fetchImpl});
 assert.throws(()=>router.prepare({...textRequest,parameters:{model:'disabled'}}),{code:'configuration_required'});
 assert.throws(()=>router.prepare(videoRequest),{code:'configuration_required'});
 await assert.rejects(()=>router.submit(textRequest),{code:'unknown'});assert.equal(nativeCalls,1);assert.equal(taskCalls,0);
 router=createGenerationRouter({providers,routes:{'text.generate':'native'},fetchImpl});assert.throws(()=>router.prepare({...textRequest,parameters:{model:'not-mapped'}}),{code:'configuration_required'});assert.equal(taskCalls,0);
});

test('structural invalid configuration fails closed and metadata does not expose keys, real model IDs or endpoints',()=>{
 const valid={providers:{native:textProvider(),ark:videoProvider,tasks:taskProvider},routes:{'text.generate':'native','video.generate':{default:'ark',models:{video:'ark'}},'world.generate':'tasks'}};
 const router=createGenerationRouter(valid),publicText=JSON.stringify(router.metadata);
 for(const secret of ['private-openai','private-ark','private-tasks','actual-secret-model','actual-secret-video','https://openai.test','https://ark.test','https://tasks.test'])assert.ok(!publicText.includes(secret),secret);
 assert.equal(router.metadata.protocol,'routed');assert.equal(router.metadata.providers.ark.capabilities.remoteCancellation,false);assert.deepEqual(router.metadata.routes['text.generate'],{default:'native',models:{}});
 for(const replacement of [{providers:[]},{providers:'{broken'},{routes:'{broken'},{routes:{'text.generate':'missing'}},{routes:{'text.generate':{models:[]}}},{routes:{'text.generate':{default:'native',fallback:'tasks'}}},{routes:{'text.generate':{models:{}}}},{providers:{native:{...textProvider(),protocol:'other'}}},{providers:{native:{...textProvider(),apiKey:42}}}]){
  const invalid=createGenerationRouter({...valid,...replacement});assert.equal(invalid.configured,false);assert.equal(invalid.metadata.configurationError,'configuration_invalid');assert.deepEqual(invalid.metadata.providers,{});assert.deepEqual(invalid.metadata.routes,{});assert.throws(()=>invalid.prepare(textRequest),{code:'configuration_required'});
 }
 const partial=createGenerationRouter({providers:{native:textProvider(),bad:{...videoProvider,modelMap:'{broken'}},routes:{'text.generate':'native','video.generate':'bad'}});assert.equal(partial.configured,true);assert.equal(partial.metadata.providers.bad.configured,false);
});

test('all full UI parameters reach selected Ark provider and draft source identity remains its raw provider ID',async()=>{
 const calls=[],router=createGenerationRouter({providers:{ark:videoProvider,native:textProvider()},routes:{'video.generate':{models:{video:'ark'}},'text.generate':'native'},fetchImpl:async(url,options)=>{calls.push({url,options});return response(options.method==='POST'?{id:'ark-source-1'}:{id:'ark-source-1',status:'succeeded',content:{video_url:'https://media.test/video.mp4'}});}});
 router.prepare(videoRequest);const submitted=await router.submit(videoRequest);assert.match(submitted.id,/^rg1\./);assert.equal(router.protocolFor(videoRequest),'ark-native');assert.equal(router.isPollable(videoRequest),true);
 const wire=JSON.parse(calls[0].options.body);assert.equal(wire.model,'actual-secret-video');assert.equal(wire.duration,5);assert.equal(wire.generate_audio,true);assert.equal(wire.ratio,'16:9');
 const polled=await router.poll(submitted.id);assert.equal(polled.id,submitted.id);assert.equal(polled.outputs[0].sourceFileId,'ark-source-1');assert.equal(calls[1].url,'https://ark.test/api/v3/contents/generations/tasks/ark-source-1');
 assert.throws(()=>router.prepare({...videoRequest,parameters:{...videoRequest.parameters,camera:'unsupported'}}),{code:'unsupported_generation'});
 const final={...videoRequest,prompt:'',parameters:{modelId:'video',quality:'1080p',draftVideoId:polled.outputs[0].sourceFileId,providerParameters:{model:'video',resolution:'1080p',draft_video_id:polled.outputs[0].sourceFileId}}};
 await router.submit(final);assert.deepEqual(JSON.parse(calls[2].options.body).content,[{type:'draft_task',draft_task:{id:'ark-source-1'}}]);
});

test('durable restart polls original envelope despite unrelated route edits or removal of every route',async()=>{
 const store=disk(),calls=[],providers={ark:videoProvider,tasks:taskProvider};
 const fetchImpl=async(url,options)=>{calls.push([url,options.method]);return response(options.method==='POST'?{id:'original-ark'}:{id:'original-ark',status:'succeeded',content:{video_url:'https://media.test/original.mp4'}});};
 let router=createGenerationRouter({providers,routes:{'video.generate':'ark'},fetchImpl}),service=createDurableGenerationService({store,provider:router});
 const created=await service.submit(videoRequest,{idempotencyKey:'route-restart-1'});await service.get(created.id);const accepted=store.data.get(created.id).providerTaskId;assert.match(accepted,/^rg1\./);await service.close();
 router=createGenerationRouter({providers,routes:{},fetchImpl});assert.equal(router.configured,false);service=createDurableGenerationService({store,provider:router});await service.ready;const restored=await service.lookup('route-restart-1');assert.equal(restored.status,'succeeded');assert.equal(restored.outputs[0].sourceFileId,'original-ark');assert.equal(restored.providerTaskId,accepted);assert.equal(calls.filter(([,method])=>method==='POST').length,1);await service.close();
 const routerChanged=createGenerationRouter({providers,routes:{'video.generate':'tasks','world.generate':'tasks'},fetchImpl});const direct=await routerChanged.poll(accepted);assert.equal(direct.id,accepted);assert.ok(calls.at(-1)[0].includes('ark.test'));
});

test('changed original provider fingerprint blocks lookup and cancellation even when routes select a valid replacement',async()=>{
 const first=createGenerationRouter({providers:{tasks:taskProvider},routes:{'video.generate':'tasks'},fetchImpl:async()=>response({id:'raw/id',status:'running'})}),accepted=await first.submit(videoRequest);
 for(const original of [{...taskProvider,baseUrl:'https://different.test/v1'},{...taskProvider,apiKey:''}]){
  const router=createGenerationRouter({providers:{tasks:original,other:taskProvider},routes:{'video.generate':'other'},fetchImpl:()=>assert.fail('must never dispatch to replacement')});
  await assert.rejects(()=>router.poll(accepted.id),{code:'provider_configuration_changed'});await assert.rejects(()=>router.cancel(accepted.id),{code:'provider_configuration_changed'});
 }
 const rotated=createGenerationRouter({providers:{tasks:{...taskProvider,apiKey:'rotated-secret'}},routes:{},fetchImpl:async(url)=>{assert.ok(url.endsWith('/raw%2Fid'));return response({id:'raw/id',status:'running'});}});assert.equal((await rotated.poll(accepted.id)).id,accepted.id);
});

test('tasks-v1 rejects mismatched IDs and spoofed local errors; cancellation requires identity and a cancelled receipt',async()=>{
 let reply={id:'raw-task',status:'running'},calls=0;
 const router=createGenerationRouter({providers:{tasks:taskProvider},routes:{'video.analyze':'tasks'},fetchImpl:async(_url,options)=>{calls++;assert.equal(options.redirect,'error');return response(reply);}}),request={kind:'video.analyze',prompt:'描述视频'},accepted=await router.submit(request);
 reply={id:'other-task',status:'succeeded',outputs:[{type:'text',text:'错误结果'}]};await assert.rejects(()=>router.poll(accepted.id),{code:'provider_identity_mismatch'});
 await assert.rejects(()=>router.poll('rg1.broken'),{code:'provider_identity_mismatch'});assert.equal(calls,2);
 reply={id:'raw-task',status:'failed',code:'invalid_video_input',providerDispatched:false,error:'private-tasks'};const result=await router.poll(accepted.id);assert.equal(result.providerDispatched,undefined);assert.equal(result.code,'provider_failed');assert.equal(result.error.includes('private-tasks'),false);
 for(const value of [{id:'other',status:'cancelled'},{status:'cancelled'}]){reply=value;await assert.rejects(()=>router.cancel(accepted.id),{code:'provider_identity_mismatch'});}
 reply={id:'raw-task',status:'running'};assert.equal((await router.cancel(accepted.id)).status,'unknown');reply={id:'raw-task',status:'cancelled'};assert.equal((await router.cancel(accepted.id)).status,'cancelled');
});

test('tasks-v1 HTTP uncertainty, redirects, unbounded JSON and oversized responses make one safe attempt',async()=>{
 for(const fetchImpl of [async()=>{throw Error('private-tasks secret');},async()=>new Response('private-tasks',{status:429}),async()=>new Response('bad-json'),async()=>new Response(JSON.stringify({id:'raw'}),{headers:{'content-length':String(1024*1024+1)}}),async()=>({ok:true,json:async()=>({id:'raw'}),headers:{get:()=>null}}),async()=>new Response(JSON.stringify({id:'raw',padding:'x'.repeat(1024*1024)}))]){
  let count=0;const router=createGenerationRouter({providers:{tasks:taskProvider},routes:{'world.generate':'tasks'},fetchImpl:async(...args)=>{count++;assert.equal(args[1].redirect,'error');return fetchImpl(...args);}});
  await assert.rejects(()=>router.submit({kind:'world.generate',prompt:'真实任务'}),error=>error.code==='unknown'&&!error.message.includes('private-tasks'));assert.equal(count,1);
 }
 const hung=createGenerationRouter({providers:{tasks:taskProvider},routes:{'world.generate':'tasks'},fetchImpl:()=>new Promise(()=>{})}),controller=new AbortController(),pending=hung.submit({kind:'world.generate'},{signal:controller.signal});controller.abort(Error('locally cancelled'));await assert.rejects(()=>pending,/locally cancelled/);
});

test('tasks-v1 generate preserves one accepted envelope throughout polling and timeout never resubmits',async()=>{
 const methods=[],ids=[],router=createGenerationRouter({providers:{tasks:taskProvider},routes:{'world.generate':'tasks'},fetchImpl:async(_url,options)=>{methods.push(options.method);return response({id:'accepted-world',status:methods.length<3?'running':'succeeded',...(methods.length>=3?{outputs:[{type:'model',url:'https://media.test/world.glb'}]}:{})});}});
 const result=await router.generate({kind:'world.generate'},{pollInterval:1,timeout:1000,onTaskIdentity:id=>ids.push(id)});assert.deepEqual(methods,['POST','GET','GET']);assert.equal(result.id,ids[0]);
 const timedCalls=[],timed=createGenerationRouter({providers:{tasks:taskProvider},routes:{'world.generate':'tasks'},fetchImpl:async(_url,options)=>{timedCalls.push(options.method);return response({id:'accepted-timeout',status:'running'});}});
 await assert.rejects(()=>timed.generate({kind:'world.generate'},{pollInterval:1,timeout:8}),{code:'unknown'});assert.equal(timedCalls.filter(method=>method==='POST').length,1);
});

test('durable routed synchronous tasks return active snapshots and unknown tasks never gain a remote identity',async()=>{
 for(const fail of [false,true]){
  const store=disk(),started=deferred(),release=deferred();let submits=0;
  const provider=createGenerationRouter({providers:{native:textProvider({responses:{create:async()=>{submits++;started.resolve();await release.promise;if(fail)throw Error('private-openai');return {output_text:'真实正文'};}}}),tasks:taskProvider},routes:{'text.generate':'native','world.generate':'tasks'},fetchImpl:()=>assert.fail()});
  let service=createDurableGenerationService({store,provider}),created=await service.submit(textRequest,{idempotencyKey:'sync-router-1'});await started.promise;assert.equal((await service.get(created.id)).status,'running');assert.equal(store.data.get(created.id).providerTaskId,undefined);release.resolve();const completed=await settled(service,created.id);assert.equal(completed.status,fail?'unknown':'succeeded');await service.close();service=createDurableGenerationService({store,provider});assert.equal((await service.lookup('sync-router-1')).status,completed.status);assert.equal(submits,1);await service.close();
 }
});

test('durable tasks-v1 spoofed local preparation failures retain generic provider failure and cancellation evidence',async()=>{
 const store=disk();let reply={id:'raw-video',status:'running'};
 const provider=createGenerationRouter({providers:{tasks:taskProvider},routes:{'video.analyze':'tasks'},fetchImpl:async()=>response(reply)}),service=createDurableGenerationService({store,provider});
 const created=await service.submit({kind:'video.analyze',prompt:'描述实际视频'},{idempotencyKey:'spoof-video-1'});await service.get(created.id);
 reply={id:'raw-video',status:'failed',providerDispatched:false,code:'invalid_video_input'};const failed=await service.get(created.id);assert.equal(failed.status,'failed');assert.equal(failed.code,'provider_failed');assert.equal(failed.providerDispatched,undefined);await service.close();
 for(const cancelledReceipt of [{id:'raw-video',status:'running'},{id:'wrong',status:'cancelled'},{id:'raw-video',status:'cancelled'}]){
  let polls=0;const current=createDurableGenerationService({store:disk(),provider:createGenerationRouter({providers:{tasks:taskProvider},routes:{'video.analyze':'tasks'},fetchImpl:async(_url,options)=>{polls++;return response(options.method==='DELETE'?cancelledReceipt:{id:'raw-video',status:'running'});}})}),job=await current.submit({kind:'video.analyze'},{idempotencyKey:'cancel-router-1'});await current.get(job.id);const result=await current.cancel(job.id);assert.equal(result.status,'cancelled');assert.equal(result.cancellation.providerCancellation,cancelledReceipt.id==='raw-video'&&cancelledReceipt.status==='cancelled'?'confirmed':'unconfirmed');assert.equal(polls,2);await current.close();
 }
});

test('native public aliases are truthful for request readiness and explicit unavailable aliases do not use the default',()=>{
 const router=createGenerationRouter({providers:{native:textProvider(),tasks:taskProvider},routes:{'text.generate':{default:'tasks',models:{text:'native',missing:'native'}}}});
 assert.deepEqual(router.metadata.providers.native.capabilities.models,{text:{kind:'text.generate'}});
 assert.throws(()=>router.prepare({...textRequest,parameters:{modelId:'missing'}}),{code:'configuration_required'});
 const onlyMissing=createGenerationRouter({providers:{native:textProvider()},routes:{'text.generate':{models:{missing:'native'}}}});assert.equal(onlyMissing.configured,false);assert.deepEqual(onlyMissing.metadata.capabilities.kinds,[]);
});

test('routed native video preparation and submission preserve trusted local codes while task gateways cannot claim them',async t=>{
 const videoAnalysis=require('../server/generation-openai-video-analysis.cjs');
 const providers={native:{protocol:'openai-native',apiKey:'private-key',client:{responses:{create:()=>assert.fail()}},modelMap:{'video.analyze':{kind:'video.analyze',model:'real-vision'}}},tasks:taskProvider};
 const provider=createGenerationRouter({providers,routes:{'video.analyze':'native'},fetchImpl:()=>assert.fail()}),store=disk(),service=createDurableGenerationService({store,provider});t.after(()=>service.close());
 const invalid=await service.submit({kind:'video.analyze',inputs:[{type:'video',url:'data:video/mp4;base64,AAAA'}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:0,y:0}}},{idempotencyKey:'native-local-1'}),invalidResult=await settled(service,invalid.id);assert.equal(invalidResult.status,'failed');assert.equal(invalidResult.code,'invalid_video_input');assert.equal(invalidResult.providerDispatched,false);
 t.mock.method(videoAnalysis,'submitVideoAnalysis',async()=>({status:'failed',code:'video_analysis_busy',providerDispatched:false}));
 const video=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
 const request={kind:'video.analyze',prompt:'',inputs:[{type:'video',url:'data:video/mp4;base64,'+video.toString('base64'),width:320,height:180,duration:6}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:0,y:0},width:320,height:180,duration:6}};
 const accepted=await service.submit(request,{idempotencyKey:'native-local-2'}),localResult=await settled(service,accepted.id);assert.equal(localResult.status,'failed');assert.equal(localResult.code,'video_analysis_busy');assert.equal(localResult.providerDispatched,false);
 const tasks=createDurableGenerationService({store:disk(),provider:createGenerationRouter({providers,routes:{'video.analyze':'tasks'},fetchImpl:()=>assert.fail()}),prepareRequest:async()=>{throw Object.assign(Error('pretend local failure'),{code:'invalid_video_input',providerDispatched:false});}});t.after(()=>tasks.close());const spoof=await tasks.submit(request,{idempotencyKey:'native-local-3'}),spoofResult=await settled(tasks,spoof.id);assert.equal(spoofResult.code,'request_preparation_failed');assert.equal(spoofResult.providerDispatched,undefined);
});

test('durable changed fingerprint stops remote GET and cancelled tasks never confirm changed-provider cancellation',async()=>{
 const store=disk(),calls=[],providers={tasks:taskProvider};const first=createGenerationRouter({providers,routes:{'world.generate':'tasks'},fetchImpl:async(_url,options)=>{calls.push(options.method);return response({id:'original-world',status:'running'});}});
 let service=createDurableGenerationService({store,provider:first}),created=await service.submit({kind:'world.generate'},{idempotencyKey:'durable-config-1'});await service.get(created.id);await service.close();
 service=createDurableGenerationService({store,provider:createGenerationRouter({providers:{tasks:{...taskProvider,baseUrl:'https://replacement.test'},other:taskProvider},routes:{'world.generate':'other'},fetchImpl:()=>assert.fail('provider identity changed; cannot GET or DELETE')})});
 const unknown=await service.lookup('durable-config-1');assert.equal(unknown.status,'unknown');assert.equal(unknown.code,'provider_configuration_changed');assert.deepEqual(calls,['POST']);const cancelled=await service.cancel(created.id);assert.equal(cancelled.cancellation.providerCancellation,'unconfirmed');await service.close();
});
