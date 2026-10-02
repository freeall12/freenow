const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService,httpProvider}=require('../generation-api.js');
const tick=()=>new Promise(r=>setImmediate(r));
const output={outputs:[{type:'image',url:'https://example.test/result.png',width:1024,height:1024}]};
test('direct generation expands library snapshots before image settings and retry stays idempotent',async()=>{
  const {prepareGenerationRequest}=await import('../src/features/node-composer/generation-request.mjs');
  const {assetToken,libraryAsset}=await import('../src/features/node-composer/library-mentions.mjs');
  const prompt=assetToken(libraryAsset({id:'image',type:'image',image:'/reference.png'}));
  const service=new TaskService({prepareRequest:prepareGenerationRequest});
  const job=service.submit({kind:'image.generate',prompt,inputs:[{type:'text',text:'Already expanded'}],parameters:{model:'gpt-image-2',ratio:'2:1',isPanoramaPrompt:true}});
  await tick();
  assert.equal(job.status,'configuration_required');
  assert.equal(job.request.prompt,'{{Image 1}}');
  assert.equal(job.request.inputs.at(-1).url,'/reference.png');
  assert.equal(job.request.parameters.providerParameters.mode,'image_to_image');
  assert.equal(job.request.parameters.providerParameters.isPanoramaPrompt,true);
  assert.deepEqual(prepareGenerationRequest(job.request),job.request);
});
test('direct video generation resolves catalog aliases and blocks unsupported assets before dispatch',async()=>{
  const {prepareGenerationRequest}=await import('../src/features/node-composer/generation-request.mjs');
  const {assetToken,libraryAsset}=await import('../src/features/node-composer/library-mentions.mjs');
  const prompt=assetToken(libraryAsset({id:'sound',type:'audio',audio:'/reference.wav',name:'声音'}));
  const request={kind:'video.generate',prompt,parameters:{model:'agent-video-generation-01',videoMode:'REFERENCE_TO_VIDEO'}};
  assert.equal(prepareGenerationRequest(request).prompt,'{{Audio 1}}');
  let calls=0;
  const service=new TaskService({prepareRequest:prepareGenerationRequest});
  service.setProvider({generate:async()=>{calls++;return output;}});
  const job=service.submit({...request,parameters:{model:'kling-v3-omni',videoMode:'REFERENCE_TO_VIDEO'}});
  await tick();assert.equal(job.status,'failed');assert.match(job.error,/不支持引用/);assert.equal(calls,0);
  assert.throws(()=>prepareGenerationRequest({...request,parameters:{model:'seedance-2.0',videoMode:'START_END_TO_VIDEO'}}),/模式不支持/);
});
test('unconfigured task has actionable state and can retry after configuration',async()=>{const s=new TaskService(),j=s.submit({kind:'image.generate'});await tick();assert.equal(j.status,'configuration_required');s.setProvider({generate:async()=>output});const next=s.retry(j.id);await tick();assert.equal(next.status,'succeeded');assert.equal(next.progress,100);});
test('progress is monotonic and output is validated',async()=>{const s=new TaskService();s.setProvider({generate:async(r,{onProgress})=>{onProgress(60);onProgress(20);assert.equal([...s.jobs.values()][0].progress,60);return {outputs:[{type:'image',url:'javascript:alert(1)'}]};}});const j=s.submit({kind:'image.generate'});await tick();assert.equal(j.status,'failed');});
test('cancel prevents late result insertion even if provider ignores signal',async()=>{const s=new TaskService();let finish;s.setProvider({generate:()=>new Promise(r=>finish=r)});const j=s.submit({kind:'video.extend'});await tick();s.cancel(j.id);finish(output);await tick();assert.equal(j.status,'cancelled');assert.equal(j.outputs,undefined);});
test('HTTP adapter posts contract and polls task safely',async()=>{const calls=[];const provider=httpProvider({baseUrl:'https://example.test/api',pollInterval:1,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{id:'task/1',status:'running',progress:35}:output};}});const seen=[];const value=await provider.generate({kind:'image.relight',parameters:{brightness:50}},{signal:new AbortController().signal,onProgress:p=>seen.push(p)});assert.deepEqual(value,output);assert.equal(calls[1].url,'https://example.test/api/tasks/task%2F1');assert.equal(JSON.parse(calls[0].options.body).kind,'image.relight');assert.deepEqual(seen,[35]);});
test('HTTP errors and provider failures surface to UI',async()=>{const s=new TaskService();s.setProvider(httpProvider({baseUrl:'https://example.test',fetchImpl:async()=>({ok:false,status:429})}));const j=s.submit({kind:'image.upscale'});await tick();assert.equal(j.status,'failed');assert.match(j.error,/429/);});
test('HTTP poll cancels promptly without further requests',async()=>{let calls=0;const controller=new AbortController(),provider=httpProvider({baseUrl:'https://example.test',pollInterval:10000,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({id:'a',status:'running'})};}});const promise=provider.generate({kind:'video.generate'},{signal:controller.signal,onProgress:()=>controller.abort()});await assert.rejects(promise);assert.equal(calls,1);});
test('typed generation results require the matching media field or nonempty text',async()=>{for(const value of [{type:'image',text:'not pixels'},{type:'video',image:'https://example.test/poster.png'},{type:'audio',text:'not sound'},{type:'text',text:'   '}]){const s=new TaskService();s.setProvider({generate:async()=>({outputs:[value]})});const j=s.submit({kind:value.type+'.generate'});await tick();assert.equal(j.status,'failed');assert.match(j.error,/格式错误/);}});

test('image request preparation validates actual inputs before contacting a provider',async()=>{
  const {prepareImageRequest}=await import('../src/features/image-generation/request.mjs');
  let calls=0;
  const s=new TaskService({prepareRequest:prepareImageRequest});
  s.setProvider({generate:async()=>{calls++;return output;}});
  const job=s.submit({kind:'image.generate',inputs:[{type:'image',url:'https://example.test/ref.png'}],parameters:{model:'RC V4',inputCounts:0}});
  await tick();
  assert.equal(job.status,'failed');
  assert.equal(job.error,'不支持图生图');
  assert.equal(calls,0);
});

test('image request preparation maps camera and model parameters and survives retry',async()=>{
  const {prepareImageRequest}=await import('../src/features/image-generation/request.mjs');
  const s=new TaskService({prepareRequest:prepareImageRequest});
  const input={kind:'image.generate',inputs:[{type:'image',url:'https://example.test/ref.png'}],parameters:{model:'Tap Nano 2',ratio:'16:9',quality:'2K',count:2,cameraEnabled:true,camera:'Arri Alexa 35',lens:'Canon K-35',focal:'50mm',aperture:'ƒ/11'}};
  const job=s.submit(input);
  await tick();
  assert.equal(job.status,'configuration_required');
  assert.equal(input.parameters.providerParameters,undefined);
  const params=job.request.parameters;
  assert.equal(params.providerParameters.mode,'image_to_image');
  assert.equal(params.providerParameters.imageSize,'2K');
  assert.equal(params.providerParameters.times,2);
  assert.equal(params.cameraControl.cameraKey,'arri_alexa_35');
  assert.equal(params.cameraControl.apertureKey,'f/11');
  s.setProvider({generate:async request=>{assert.deepEqual(request,job.request);return output;}});
  const next=s.retry(job.id);
  await tick();
  assert.equal(next.status,'succeeded');
});

test('cancellation during asynchronous request preparation cannot dispatch a late task',async()=>{
  let finish,calls=0;
  const s=new TaskService({prepareRequest:request=>new Promise(resolve=>{finish=()=>resolve(request);})});
  s.setProvider({generate:async()=>{calls++;return output;}});
  const job=s.submit({kind:'image.generate'});
  await tick();
  s.cancel(job.id);
  finish();
  await tick();
  assert.equal(job.status,'cancelled');
  assert.equal(calls,0);
});

test('panorama remains distinct from a standard 2:1 image and is cleared for unsupported models',async()=>{
  const {prepareImageRequest}=await import('../src/features/image-generation/request.mjs');
  const {normalize,selectModel}=await import('../src/features/image-generation/catalog.mjs');
  const parameters={model:'gpt-image-2',ratio:'2:1',isPanoramaPrompt:true,count:1};
  const request=prepareImageRequest({kind:'image.generate',parameters});
  assert.equal(request.parameters.providerParameters.isPanoramaPrompt,true);
  assert.equal(request.parameters.providerParameters.aspectRatio,'2:1');
  assert.equal(prepareImageRequest({kind:'image.generate',parameters:{...parameters,isPanoramaPrompt:false}}).parameters.providerParameters.isPanoramaPrompt,undefined);
  assert.equal(normalize({...parameters,ratio:'1:1'}).isPanoramaPrompt,false);
  assert.equal(selectModel(parameters,'nano-banana').isPanoramaPrompt,false);
});

test('server task gateway keeps credentials private and supports configuration, result, and cancellation states',async()=>{
  const {createGenerationGateway}=require('../server/generation.cjs');
  const send=async(gateway,path,method='GET',input)=>{
    let result;
    await gateway.handle({method},{},path,{json:(_,status,value)=>{result={status,value};},body:async()=>input});
    return result;
  };
  const missing=createGenerationGateway();
  for(const kind of ['panorama.edit','model.generate'])assert.equal((await send(missing,'/api/generation/tasks','POST',{kind})).status,202);
  let job=await send(missing,'/api/generation/tasks','POST',{kind:'image.generate'});
  await tick();
  assert.equal((await send(missing,'/api/generation/tasks/'+job.value.id)).value.status,'configuration_required');
  const calls=[];
  const gateway=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'server-only-key',fetchImpl:async(url,options)=>{
    calls.push({url,options}); return {ok:true,json:async()=>output};
  }});
  job=await send(gateway,'/api/generation/tasks','POST',{kind:'image.generate',parameters:{isPanoramaPrompt:true}});
  await tick();
  const result=await send(gateway,'/api/generation/tasks/'+job.value.id);
  assert.equal(result.value.status,'succeeded');
  assert.deepEqual(result.value.outputs,output.outputs);
  assert.equal(calls[0].options.headers.Authorization,'Bearer server-only-key');
  assert.equal(JSON.parse(calls[0].options.body).parameters.isPanoramaPrompt,true);
  assert.ok(!JSON.stringify(result).includes('server-only-key'));
  assert.equal((await send(gateway,'/api/generation/tasks','POST',{kind:'invalid'})).status,400);
  assert.equal((await send(gateway,'/api/generation/tasks/no-such-task')).status,404);
  const running=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'server-only-key',fetchImpl:async()=>({ok:true,json:async()=>({id:'upstream',status:'running'})})});
  job=await send(running,'/api/generation/tasks','POST',{kind:'video.generate'});
  await tick();
  assert.equal((await send(running,'/api/generation/tasks/'+job.value.id,'DELETE')).value.status,'cancelled');
});

test('HTTP adapter preserves configuration_required and sends remote cancellation only when enabled',async()=>{
  const service=new TaskService();
  service.setProvider(httpProvider({baseUrl:'https://provider.test',fetchImpl:async()=>({ok:true,json:async()=>({status:'configuration_required',error:'需要配置'})})}));
  const job=service.submit({kind:'image.generate'});await tick();
  assert.equal(job.status,'configuration_required');
  const calls=[],controller=new AbortController();
  const provider=httpProvider({baseUrl:'https://provider.test',cancelRemote:true,fetchImpl:async(url,options)=>{calls.push(options.method);return {ok:true,json:async()=>({id:'task',status:'running'})};}});
  await assert.rejects(provider.generate({kind:'video.generate'},{signal:controller.signal,onProgress:()=>controller.abort()}));
  assert.deepEqual(calls,['POST','DELETE']);
});

test('video specs follow real reference shape and clear parameters absent from the selected variant',async()=>{
  const {configuration,prepareVideoRequest}=await import('../src/features/video-generation/settings.mjs');
  const image={type:'image',url:'/frame.png'},audio={type:'audio',url:'/sound.wav'};
  const frames=configuration({model:'Seedance 2.0',mode:'首尾帧',ratio:'16:9',quality:'4k',duration:15},[image]);
  assert.equal(frames.settings.videoMode,'IMAGE_TO_VIDEO');assert.equal(frames.settings.ratio,undefined);assert.equal(frames.settings.duration,15);
  const mixed=configuration({model:'Seedance 2.0',mode:'全能参考'},[image,audio]);
  assert.deepEqual(mixed.modeOptions,[{label:'首尾帧',disabled:true},{label:'全能参考',disabled:false}]);
  assert.throws(()=>prepareVideoRequest({kind:'video.generate',parameters:{model:'Seedance 2.0',mode:'首尾帧'},inputs:[image,audio]}),/不支持/);
  const horse=prepareVideoRequest({kind:'video.generate',parameters:{model:'HappyHorse 1.1',mode:'首尾帧',audio:true,quality:'4k',duration:30,ratio:'21:9'},inputs:[image]});
  assert.deepEqual(horse.parameters.providerParameters,{model:'happyhorse-1.1',modelType:'IMAGE_TO_VIDEO',variant:'i2v',resolution:'1080P',duration:5,times:1});
  assert.deepEqual(prepareVideoRequest(horse),horse);
});

test('first/last frame order preserves node identity even when images use the same URL',async()=>{
  const {referencesFor,referenceInputs,reorderReferences}=await import('../src/features/node-composer/reference-model.mjs');
  const {prepareVideoRequest}=await import('../src/features/video-generation/settings.mjs');
  const target={id:'target',type:'video'},state={nodes:[target,{id:'a',type:'image',image:'/same.png'},{id:'b',type:'image',image:'/same.png'}],edges:[{id:'a-t',source:'a',target:'target'},{id:'b-t',source:'b',target:'target'}]};
  const {reconcilePrompt}=await import('../src/features/node-composer/prompt-state.mjs');
  const settings={model:'Seedance 2.0',mode:'首尾帧',prompt:'从 {{Image 1}} 到 {{Image 2}}'};
  const initial=referencesFor(target,settings,state),swapped=reorderReferences(reconcilePrompt(settings,initial),initial,1,0);
  const inputs=referenceInputs(referencesFor(target,swapped,state));
  const request=prepareVideoRequest({kind:'video.generate',inputs,parameters:swapped});
  assert.deepEqual(request.inputs.map(input=>input.id),['b','a']);
  assert.equal(request.parameters.providerParameters.modelType,'START_END_TO_VIDEO');
  assert.equal(swapped.prompt,'从 {{Image 2}} 到 {{Image 1}}');
  assert.deepEqual(prepareVideoRequest(request),request);
});
test('subject references send immutable media snapshots, preserve ordinals, and remain idempotent on retry',async()=>{
 const {subjectToken}=await import('../src/features/subject-library/model.mjs');
 const {prepareGenerationRequest}=await import('../src/features/node-composer/generation-request.mjs');
 const subject={id:'subject-a',name:'角色: A }',description:'红色外套',assets:[{id:'i',type:'image',url:'/actor.png'},{id:'t',type:'text',text:'保持面部一致'}]};
 const request={kind:'video.generate',prompt:subjectToken(subject)+'走进镜头',inputs:[{id:'i',type:'image',url:'/actor.png'}],parameters:{model:'Seedance 2.0',mode:'全能参考',subjects:[subject]}};
 const prepared=prepareGenerationRequest(request);assert.equal(prepared.inputs.length,1);assert.match(prepared.prompt,/角色: A }：红色外套：\{\{Image 1\}\}：保持面部一致走进镜头/);assert.deepEqual(prepareGenerationRequest(prepared),prepared);assert.equal(request.prompt,subjectToken(subject)+'走进镜头');
 subject.name='changed';assert.equal(prepared.parameters.subjects[0].name,'角色: A }');
 const service=new TaskService({prepareRequest:prepareGenerationRequest}),job=service.submit(prepared);await tick();assert.equal(job.status,'configuration_required');assert.equal(job.outputs,undefined);
});
test('empty, missing, malformed and incompatible subject references cannot dispatch a generation',async()=>{
 const {subjectToken}=await import('../src/features/subject-library/model.mjs');
 const {prepareGenerationRequest}=await import('../src/features/node-composer/generation-request.mjs');
 const subject={id:'s',name:'角色',assets:[]},request={kind:'video.generate',prompt:subjectToken(subject),parameters:{model:'Seedance 2.0',mode:'全能参考',subjects:[subject]}};
 assert.throws(()=>prepareGenerationRequest(request),/没有可用参考/);assert.throws(()=>prepareGenerationRequest({...request,parameters:{...request.parameters,subjects:[]}}),/引用失效/);
 assert.throws(()=>prepareGenerationRequest({...request,parameters:{...request.parameters,mode:'首尾帧'}}),/不支持主体/);
 assert.throws(()=>prepareGenerationRequest({...request,prompt:'{{ElementRef:s:%zz}}'}),/引用失效/);
});

test('cancellation receipts distinguish missing, queued, dispatched and terminal jobs without claiming upstream cancellation',async()=>{
 const service=new TaskService();let resolveProvider,dispatches=0,events=0;
 service.setProvider({generate:()=>{dispatches++;return new Promise(resolve=>{resolveProvider=resolve;});}});service.subscribe(()=>events++);
 assert.deepEqual(service.cancel('missing'),{id:'missing',outcome:'not_found',status:null,localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'});assert.equal(events,0);
 const queued=service.submit({kind:'video.generate'}),queuedReceipt=service.cancel(queued.id);assert.equal(queuedReceipt.outcome,'cancel_requested');assert.equal(queuedReceipt.providerCancellation,'not_requested');await tick();assert.equal(dispatches,0);
 const job=service.submit({kind:'video.generate'});await tick();const receipt=service.cancel(job.id);assert.equal(receipt.localCancellationRequested,true);assert.equal(receipt.lateResultBlocked,true);assert.equal(receipt.providerCancellation,'unconfirmed');const before=events;
 const repeat=service.cancel(job.id);assert.equal(repeat.outcome,'already_terminal');assert.equal(repeat.localCancellationRequested,false);assert.equal(repeat.lateResultBlocked,true);assert.equal(repeat.providerCancellation,'unconfirmed');assert.equal(events,before);
 resolveProvider(output);await tick();assert.equal(job.status,'cancelled');assert.equal(job.outputs,undefined);
 for(const status of ['succeeded','failed','configuration_required']){const terminal={id:status,status,outputs:output.outputs,applying:status==='succeeded',controller:new AbortController()};service.jobs.set(status,terminal);const result=service.cancel(status);assert.equal(result.outcome,'already_terminal');assert.equal(result.status,status);assert.equal(result.localCancellationRequested,false);assert.equal(result.lateResultBlocked,false);assert.equal(terminal.controller.signal.aborted,false);assert.equal(terminal.outputs,output.outputs);assert.equal(terminal.applying,status==='succeeded');}
});
test('cancellation at running notification prevents dispatch and rejected upstream DELETE remains unconfirmed',async()=>{
 const service=new TaskService();let dispatches=0;
 service.setProvider({generate:async()=>{dispatches++;return output;}});service.subscribe(job=>{if(job.status==='running')service.cancel(job.id);});const job=service.submit({kind:'image.generate'});await tick();assert.equal(dispatches,0);assert.equal(job.cancellation.providerCancellation,'not_requested');
 const http=new TaskService(),calls=[];http.setProvider(httpProvider({baseUrl:'https://provider.test',cancelRemote:true,fetchImpl:async(url,options)=>{calls.push(options.method);if(options.method==='DELETE')return {ok:false,status:503};return {ok:true,json:async()=>({id:'upstream',status:'running'})};}}));const active=http.submit({kind:'video.generate'});await tick();http.cancel(active.id);await tick();assert.deepEqual(calls,['POST','DELETE']);assert.equal(active.cancellation.providerCancellation,'unconfirmed');assert.equal(active.outputs,undefined);
});
test('gateway DELETE exposes honest cancellation receipt while preserving terminal media',async()=>{
 const {createGenerationGateway}=require('../server/generation.cjs');
 const send=async(gateway,path,method='GET',input)=>{let result;await gateway.handle({method},{},path,{json:(_,status,value)=>{result={status,value};},body:async()=>input});return result;};
 const gateway=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'private',fetchImpl:async()=>({ok:true,json:async()=>output})});
 const missing=await send(gateway,'/api/generation/tasks/missing','DELETE');assert.equal(missing.status,404);assert.equal(missing.value.cancellation.outcome,'not_found');
 const created=await send(gateway,'/api/generation/tasks','POST',{kind:'image.generate'});await tick();const response=await send(gateway,'/api/generation/tasks/'+created.value.id,'DELETE');assert.equal(response.value.status,'succeeded');assert.equal(response.value.cancellation.outcome,'already_terminal');assert.equal(response.value.cancellation.lateResultBlocked,false);assert.deepEqual(response.value.outputs,output.outputs);
 const pending=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'private',fetchImpl:async()=>({ok:true,json:async()=>({id:'upstream',status:'running'})})});const task=await send(pending,'/api/generation/tasks','POST',{kind:'video.generate'});await tick();const cancelled=await send(pending,'/api/generation/tasks/'+task.value.id,'DELETE');assert.equal(cancelled.value.cancellation.outcome,'cancel_requested');assert.equal(cancelled.value.cancellation.providerCancellation,'unconfirmed');const repeated=await send(pending,'/api/generation/tasks/'+task.value.id,'DELETE');assert.equal(repeated.value.cancellation.outcome,'already_terminal');assert.equal(repeated.value.cancellation.localCancellationRequested,false);
});
