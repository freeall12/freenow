const test=require('node:test'),assert=require('node:assert/strict');
const {createArkProvider}=require('../server/generation-ark.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const plain={ratios:['16:9','adaptive'],resolutions:['480p','720p','1080p'],durations:[-1,5,10],audio:true};
const reference={...plain,maxImages:3,maxVideos:2,maxAudios:2,videoDurationRange:{min:2,max:30,totalMax:30},audioDurationRange:{min:2,max:30,totalMax:30},omniReferenceTaskType:'reference'};
const entry={kind:'video.generate',model:'operator-actual-model',supportsDraft:true,supportsDraftTask:true,modes:{TEXT_TO_VIDEO:plain,IMAGE_TO_VIDEO:{...plain,ratios:['adaptive']},START_END_TO_VIDEO:{...plain,ratios:['adaptive']},REFERENCE_TO_VIDEO:reference,VIDEO_EDIT:{...reference,ratios:['adaptive'],durations:[-1],maxVideos:1,omniReferenceTaskType:'edit'}}};
const map={'seedance-2.5':entry,'seedance-2.5-draft':entry};
const request={kind:'video.generate',prompt:'森林中的小狐狸',inputs:[],parameters:{model:'Seedance 2.5',modelId:'seedance-2.5',count:1,ratio:'16:9',quality:'720p',duration:5,audio:true,providerParameters:{model:'seedance-2.5',modelType:'TEXT_TO_VIDEO',aspectRatio:'16:9',resolution:'720p',duration:5,generateAudio:true,times:1}}};
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const provider=fetchImpl=>createArkProvider({baseUrl:'https://ark.test/api/v3',apiKey:'private-key',modelMap:map,fetchImpl});
const change=(parameters,inputs=request.inputs)=>({...request,inputs,parameters:{...request.parameters,...parameters,providerParameters:{...request.parameters.providerParameters,...parameters.providerParameters}}});
function png(width=300,height=300){const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=','base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return 'data:image/png;base64,'+bytes.toString('base64');}
const image={type:'image',url:'https://media.test/image.png'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function store(){const data=new Map();return {data,readAll:async()=>[...data.values()],write:async value=>{data.set(value.id,structuredClone(value));}};}

test('Ark configuration requires explicit operator model capabilities and never exposes keys/endpoint',()=>{
 for(const modelMap of ['{bad','[]',{}, {a:{kind:'video.generate',model:'real'}},{a:{...entry,modes:{TEXT_TO_VIDEO:{...plain,extra:true}}}},{a:{...entry,modes:{REFERENCE_TO_VIDEO:{...plain,maxVideos:1}}}}])assert.equal(createArkProvider({baseUrl:'https://ark.test/v3',apiKey:'private-key',modelMap}).configured,false);
 for(const baseUrl of ['http://ark.test','https://u:p@ark.test','https://ark.test?key=secret','https://ark.test#key'])assert.equal(createArkProvider({baseUrl,apiKey:'private-key',modelMap:map}).configured,false);
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.ok(!JSON.stringify(p.metadata).includes('private-key'));assert.ok(!JSON.stringify(p.metadata).includes('https://ark.test'));assert.equal(p.metadata.capabilities.remoteCancellation,false);assert.equal(p.cancel,undefined);
 assert.equal(createArkProvider({baseUrl:'https://ark.test',modelMap:map}).configured,false);
});
test('submit maps the UI contract into one asynchronous native task without polling',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return response({id:'cgt-task-1'});});
 assert.deepEqual(await p.submit(request),{id:'cgt-task-1',status:'queued',progress:0});assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://ark.test/api/v3/contents/generations/tasks');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer private-key');
 assert.deepEqual(calls[0].body,{model:'operator-actual-model',content:[{type:'text',text:request.prompt}],ratio:'16:9',resolution:'720p',duration:5,generate_audio:true});
});
test('UI first/end frame order is preserved and defaults do not become Ark camera parameters',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({id:'frame-task'});});
 const req=change({videoMode:'START_END_TO_VIDEO',mode:'首尾帧',ratio:'adaptive',camera:'Sony Venice',lens:'Zeiss Ultra Prime',focal:'24mm',aperture:'ƒ/4',thinking:'high',providerParameters:{modelType:'START_END_TO_VIDEO',aspectRatio:'adaptive'}},[image,{...image,url:'https://media.test/end.png'}]);
 await p.submit(req);assert.deepEqual(body.content.slice(1),[{type:'image_url',image_url:{url:image.url},role:'first_frame'},{type:'image_url',image_url:{url:'https://media.test/end.png'},role:'last_frame'}]);assert.equal(body.camera,undefined);
 await p.submit({...req,inputs:[image],parameters:{...req.parameters,videoMode:'IMAGE_TO_VIDEO',providerParameters:{...req.parameters.providerParameters,modelType:'IMAGE_TO_VIDEO'}}});assert.equal(body.content[1].role,'first_frame');
});
test('reference images/video/audio and prompt mentions become explicit native content roles',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({id:'reference-task'});});
 const req=change({videoMode:'REFERENCE_TO_VIDEO',mode:'全能参考',providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},[image,{type:'video',url:'https://media.test/ref.mp4',duration:5},{type:'audio',url:'https://media.test/ref.mp3',durationMs:2000},{type:'text',text:'天亮时'}]);req.prompt='{{Image 1}}中的狐狸，使用{{Video 1}}运镜和{{Audio 1}}音乐';
 await p.submit(req);assert.equal(body.content[0].text,'天亮时\n@image1中的狐狸，使用@video1运镜和@audio1音乐');assert.deepEqual(body.content.slice(1).map(item=>item.role),['reference_image','reference_video','reference_audio']);assert.equal(body.omni_reference_task_type,'reference');
});
test('official inline image/audio input survives local-media transport and canonicalizes MP3 MIME',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({id:'inline-task'});});
 const req=change({videoMode:'REFERENCE_TO_VIDEO',providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},[{type:'image',url:png()},{type:'audio',url:'data:audio/mpeg;base64,'+Buffer.from('ID3valid-mp3-envelope').toString('base64'),duration:2}]);
 await p.submit(req);assert.equal(body.content[1].image_url.url,png());assert.match(body.content[2].audio_url.url,/^data:audio\/mp3;base64,/);
 assert.throws(()=>p.prepare({...req,inputs:[{type:'image',url:png(100,300)}]}));
 const limited=createArkProvider({baseUrl:'https://ark.test',apiKey:'private-key',modelMap:{'seedance-2.5':{...entry,mediaTransport:{image:[]}}}});assert.throws(()=>limited.prepare({...req,inputs:[{type:'image',url:png()}]}));
});
test('unsupported options, contradictory fields and multiple-count requests fail before fetch',async()=>{
 let calls=0;const p=provider(()=>{calls++;assert.fail();});
 for(const patch of [{count:2},{count:'1'},{times:2},{providerParameters:{times:2}},{ratio:'1:1'},{duration:30},{quality:'4k'},{audio:false,providerParameters:{generateAudio:true}},{videoMode:'IMAGE_TO_VIDEO'},{camera:'Custom cinema camera'},{thinking:'max'},{generateMode:'pro'},{unknown:true},{providerParameters:{seed:2}},{batch_count:2},{modelId:'wrong'},{canvasResults:{targetNodeIds:['one','two']}}])await assert.rejects(()=>p.submit(change(patch)));
 for(const inputs of [[{type:'video',url:'data:video/mp4;base64,AAAA',duration:5}],[{type:'image',url:'http://media.test/image.png'}],[{type:'image',url:'https://u:secret@media.test/image.png'}],[{type:'image',url:'https://127.0.0.1/x.png'}],[{type:'image',url:'data:image/png;base64,YmFk'}]])await assert.rejects(()=>p.submit(change({providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},inputs)));
 assert.equal(calls,0);
});
test('reference input limits and durations are checked without truncation',()=>{
 const p=provider(()=>assert.fail());
 const req=change({providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},Array.from({length:4},()=>image));assert.throws(()=>p.prepare(req));
 for(const duration of [undefined,1,31])assert.throws(()=>p.prepare({...req,inputs:[{type:'video',url:'https://media.test/v.mp4',duration}]}));
 assert.throws(()=>p.prepare({...req,inputs:[{type:'video',url:'https://media.test/v.mp4',duration:20},{type:'video',url:'https://media.test/b.mp4',duration:20}]}));
 assert.throws(()=>p.prepare({...request,prompt:'{{Image 2}}',inputs:[image],parameters:{...request.parameters,providerParameters:{...request.parameters.providerParameters,modelType:'REFERENCE_TO_VIDEO'}}}));
});
test('explicit omni edit and extend obey API constraints even with a permissive operator reference profile',async()=>{
 const video={type:'video',url:'https://media.test/source.mp4',duration:4};
 for(const subtype of ['edit','extend']){
  const bodies=[],p=createArkProvider({baseUrl:'https://ark.test/api/v3',apiKey:'private-key',modelMap:{'seedance-2.5':{...entry,modes:{REFERENCE_TO_VIDEO:{...reference,omniReferenceTaskType:subtype}}}},fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return response({id:'omni-'+subtype});}});
  const req=change({videoMode:'REFERENCE_TO_VIDEO',ratio:'adaptive',duration:subtype==='edit'?-1:5,providerParameters:{modelType:'REFERENCE_TO_VIDEO',aspectRatio:'adaptive',duration:subtype==='edit'?-1:5}},[video]);
  for(const invalid of [{...req,inputs:[image]},{...req,inputs:[]},change({videoMode:'REFERENCE_TO_VIDEO',providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},[video]),{...req,parameters:{...req.parameters,ratio:undefined,providerParameters:{...req.parameters.providerParameters,aspectRatio:undefined}}}])await assert.rejects(()=>p.submit(invalid),{code:'unsupported_generation'});
  if(subtype==='edit'){
   for(const duration of [2,3.99])await assert.rejects(()=>p.submit({...req,inputs:[{...video,duration}]}),{code:'unsupported_generation'});
   for(const duration of [undefined,5])await assert.rejects(()=>p.submit({...req,parameters:{...req.parameters,duration,providerParameters:{...req.parameters.providerParameters,duration}}}),{code:'unsupported_generation'});
  }
  assert.equal(bodies.length,0);
  await p.submit(req);assert.equal(bodies[0].omni_reference_task_type,subtype);assert.equal(bodies[0].ratio,'adaptive');assert.equal(bodies[0].duration,subtype==='edit'?-1:5);
 }
 const edit=change({videoMode:'VIDEO_EDIT',mode:'视频编辑',ratio:'adaptive',duration:-1,providerParameters:{modelType:'VIDEO_EDIT',aspectRatio:'adaptive',duration:-1}},[{...video,duration:3}]);
 assert.throws(()=>provider(()=>assert.fail()).prepare(edit),{code:'unsupported_generation'});
 assert.doesNotThrow(()=>provider(()=>assert.fail()).prepare({...edit,inputs:[{...video,duration:undefined,durationMs:4000}]}));
 assert.doesNotThrow(()=>provider(()=>assert.fail()).prepare(change({videoMode:'REFERENCE_TO_VIDEO',providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},[{...video,duration:2}])));
});
test('uncut source ranges are rejected before an Ark POST instead of silently sending the whole source',async()=>{
 let calls=0;const p=provider(()=>{calls++;assert.fail('uncut source must not reach the provider');});
 for(const field of ['clip','trim','sourceClip']){
  const req=change({videoMode:'REFERENCE_TO_VIDEO',providerParameters:{modelType:'REFERENCE_TO_VIDEO'}},[{type:'video',url:'https://media.test/source.mp4',duration:5,[field]:{start:1,end:4}}]);
  await assert.rejects(()=>p.submit(req),{code:'unsupported_generation'});
 }
 assert.equal(calls,0);
});
test('sample draft and final chain uses Ark task ID and excludes inherited final parameters',async()=>{
 const bodies=[],p=provider(async(_url,options)=>{bodies.push(JSON.parse(options.body));return response({id:'draft-task'});});
 await p.submit(change({draft:true,quality:'480p',providerParameters:{draft:true,resolution:'480p'}}));assert.equal(bodies[0].draft,true);assert.equal(bodies[0].resolution,'480p');
 const final={kind:'video.generate',prompt:'',inputs:[],parameters:{modelId:'seedance-2.5',model:'Seedance 2.5',draftVideoId:'draft-task',draft:false,quality:'1080p',resolution:'1080p',count:1,duration:5,ratio:'16:9',audio:true,providerParameters:{model:'seedance-2.5',draft_video_id:'draft-task',resolution:'1080p',times:1}}};
 await p.submit(final);assert.deepEqual(bodies[1],{model:'operator-actual-model',content:[{type:'draft_task',draft_task:{id:'draft-task'}}],resolution:'1080p'});
 assert.throws(()=>p.prepare({...final,prompt:'new prompt'}));assert.throws(()=>p.prepare({...final,inputs:[image]}));assert.throws(()=>p.prepare({...final,parameters:{...final.parameters,providerParameters:{...final.parameters.providerParameters,duration:5}}}));
});
test('poll validates native identity, statuses and actual HTTPS results without inventing geometry',async()=>{
 const p=provider(async()=>response({id:'task-1',status:'succeeded',content:{video_url:'https://media.test/result.mp4'},duration:5,ratio:'16:9',resolution:'1080p'}));
 assert.deepEqual(await p.poll('task-1'),{id:'task-1',status:'succeeded',outputs:[{type:'video',url:'https://media.test/result.mp4',sourceFileId:'task-1'}]});
 for(const value of [{id:'other',status:'queued'},{id:'task-1',status:'made-up'},{id:'task-1',status:'succeeded',content:{}},{id:'task-1',status:'succeeded',content:{video_url:'https://key:secret@media.test/video.mp4'}},{id:'task-1',status:'succeeded',content:{video_url:'data:video/mp4;base64,AAAA'}}])await assert.rejects(()=>provider(async()=>response(value)).poll('task-1'),{code:'unknown'});
 for(const status of ['queued','running','failed','cancelled','expired']){const value=await provider(async()=>response({id:'task-1',status,error:{message:'private-key raw error'}})).poll('task-1');assert.equal(value.status,status==='expired'?'failed':status);assert.ok(!JSON.stringify(value).includes('private-key'));}
});
test('HTTP failures, malformed/oversized payloads and redirects remain unknown with one POST',async()=>{
 for(const result of [()=>new Response('private-key error',{status:429}),()=>new Response('<html>private-key</html>'),()=>new Response('{}',{headers:{'content-length':'1048577'}}),()=>new Response('x'.repeat(1048577)),()=>new Response('{}',{status:302,headers:{location:'https://exfiltration.test'}}),()=>response({})]){
  let calls=0;const p=provider(async(_url,options)=>{calls++;assert.equal(options.redirect,'error');return result();});await assert.rejects(()=>p.submit(request),error=>error.code==='unknown'&&!error.message.includes('private-key'));assert.equal(calls,1);
 }
});
test('explicit cancellation aborts a hung fetch/read and exposes no upstream cancel claim',async()=>{
 for(const hanging of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}}))]){
  const p=provider(hanging),controller=new AbortController(),pending=p.submit(request,{signal:controller.signal});setTimeout(()=>controller.abort(new Error('cancelled locally')),5);await assert.rejects(()=>pending,/cancelled locally/);assert.equal(p.cancel,undefined);
 }
});
test('generate makes one POST then bounded GET polling, retaining identity on timeout',async()=>{
 const methods=[],identities=[];const p=provider(async(_url,options)=>{methods.push(options.method);return response(options.method==='POST'?{id:'task-1'}:{id:'task-1',status:methods.length===2?'running':'succeeded',content:{video_url:'https://media.test/output.mp4'}});});
 const result=await p.generate(request,{pollInterval:1,onTaskIdentity:id=>identities.push(id)});assert.equal(result.status,'succeeded');assert.deepEqual(methods,['POST','GET','GET']);assert.deepEqual(identities,['task-1']);
 const ids=[],pending=provider(async(_url,options)=>response(options.method==='POST'?{id:'task-timeout'}:{id:'task-timeout',status:'running'}));await assert.rejects(()=>pending.generate(request,{timeout:8,pollInterval:1,onTaskIdentity:id=>ids.push(id)}),{code:'unknown'});assert.deepEqual(ids,['task-timeout']);
});
test('durable restart queries accepted Ark ID without another POST and preserves success privately until media is saved',async()=>{
 const calls=[],disk=store();let done=false;
 const p=provider(async(url,options)=>{calls.push(options.method);return response(options.method==='POST'?{id:'accepted-task'}:{id:'accepted-task',status:done?'succeeded':'running',...(done?{content:{video_url:'https://media.test/output.mp4'}}:{})});});
 let service=createDurableGenerationService({store:disk,provider:p}),job=await service.submit(request,{idempotencyKey:'ark-restart-1'});await tick();await tick();job=await service.get(job.id);assert.equal(disk.data.get(job.id).providerTaskId,'accepted-task');await service.close();
 done=true;service=createDurableGenerationService({store:disk,provider:p});await service.ready;job=await service.lookup('ark-restart-1');assert.equal(job.status,'unknown');assert.equal(job.providerStatus,'succeeded');assert.equal(job.localization.state,'failed');assert.equal(job.outputs,undefined);assert.equal(job.providerResult.outputs[0].sourceFileId,'accepted-task');assert.equal(calls.filter(method=>method==='POST').length,1);assert.equal((await service.submit(request,{idempotencyKey:'ark-restart-1'})).id,job.id);await service.close();
});
test('unconfirmed submit is durable unknown without resubmission, unsupported requests fail before dispatch',async()=>{
 let calls=0;const disk=store(),p=provider(async()=>{calls++;throw Error('private-key transport error');});let service=createDurableGenerationService({store:disk,provider:p});let job=await service.submit(request,{idempotencyKey:'ark-unknown-1'});await tick();await tick();job=await service.get(job.id);assert.equal(job.status,'unknown');await service.close();service=createDurableGenerationService({store:disk,provider:p});assert.equal((await service.lookup('ark-unknown-1')).status,'unknown');assert.equal(calls,1);await service.close();
 service=createDurableGenerationService({store:store(),provider:p});job=await service.submit(change({count:2}),{idempotencyKey:'ark-unsupported-1'});await tick();await tick();assert.equal((await service.get(job.id)).status,'failed');assert.equal(calls,1);await service.close();
});
test('unconfigured provider never calls the network',async()=>{
 const p=createArkProvider({baseUrl:'https://ark.test',modelMap:map,fetchImpl:()=>assert.fail()});await assert.rejects(()=>p.submit(request),{code:'configuration_required'});await assert.rejects(()=>p.poll('task-1'),{code:'configuration_required'});
});
