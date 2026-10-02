const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../generation-api.js');
const ready=Promise.all([import('../src/features/world-node/model.mjs'),import('../src/features/world-node/media.mjs'),
 import('../src/features/agent-workflows/media-resolver.mjs'),import('../src/features/agent-workflows/media-transport.mjs'),
 import('../src/features/node-composer/provider-configuration.mjs')]);
const baseUrl='http://localhost:4173/',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const data='data:image/png;base64,'+png,serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
const terminal=(service,job)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('task timeout'));},3000);const off=service.subscribe(value=>{if(value.id===job.id&&['failed','cancelled','configuration_required','succeeded'].includes(value.status)){clearTimeout(timer);off();resolve(value);}});});
const imageFactory=probes=>()=>({naturalWidth:640,naturalHeight:360,decode:async()=>{},removeAttribute(){},set src(url){probes.push(url);queueMicrotask(()=>this.onload?.());}});
function fixture(model,source={id:'image',type:'image',image:'asset:thumbnail',fullImage:'asset:full'}){
 const world={id:'world',type:'world',worldConfig:{model:'tripo-h3',prompt:'',material:'pbr'}},state={nodes:[world,source],edges:[{id:'reference',source:source.id,target:'world'}]};
 const refs=()=>model.references('world',state),request=()=>model.prepare(world,refs()).request;
 return {world,source,state,refs,request,getNode:id=>state.nodes.find(node=>node.id===id)};
}

test('world full source is read once after scoped route readiness; exact original parameters reach native provider',async()=>{
 const [model,media,resolver,transport,routing]=await ready,f=fixture(model),reads=[],fetches=[],probes=[];
 const original=f.request(),metadata={protocol:'routed',configured:true,routes:{'world.generate':{models:{'tripo-image-to-model-h3':'tripo'}}},providers:{
  unrelated:{protocol:'openai-native',configured:true},tripo:{protocol:'tripo-native',configured:false,capabilities:{kinds:['world.generate'],models:{'tripo-image-to-model-h3':{kind:'world.generate'}}}}}};
 const resolveMedia=resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async source=>{reads.push(source);return 'blob:http://localhost:4173/full';}},createImage:imageFactory(probes)});
 const service=new TaskService({prepareInputs:(request,{signal,validateSources})=>media.prepareWorldMediaRequest(request,{signal,validateSources,baseUrl,nativeConfiguration:metadata,resolveMedia,
  transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize,fetchImpl:async(url,options)=>{fetches.push({url,options});return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});}})})});
 let sent;service.setProvider({isConfigured:async({request})=>{assert.equal(request.parameters.model,'tripo-image-to-model-h3');return routing.providerConfigured(metadata,request);},generate:async request=>{sent=request;return {outputs:[{type:'model',url:'https://provider.test/actual.glb'}]};}});
 const missing=service.submit(original);await terminal(service,missing);assert.equal(missing.status,'configuration_required');assert.deepEqual(reads,[]);assert.deepEqual(fetches,[]);assert.equal(sent,undefined);
 metadata.providers.tripo.configured=true;const job=service.retry(missing.id);await terminal(service,job);assert.equal(job.status,'succeeded');
 assert.deepEqual(reads,['asset:full']);assert.equal(fetches.length,1);assert.deepEqual(probes,[data]);assert.equal(sent.inputs[0].url,data);assert.equal(sent.inputs[0].sourceUrl,'asset:full');assert.equal(sent.inputs[0].width,640);assert.deepEqual(sent.parameters,original.parameters);assert.deepEqual(f.request(),original);
});

test('native public HTTPS stays original; unsupported local WebP and model modes fail explicitly',async()=>{
 const [model,media,resolver,transport]=await ready,f=fixture(model,{id:'image',type:'image',image:'https://public.test/full.webp'}),nativeConfiguration={protocol:'tripo-native'};
 const resolveMedia=resolver.createWorkflowMediaResolver({baseUrl,createImage:()=>assert.fail('public Tripo URL must not be decoded or fetched by browser')});
 const result=await media.prepareWorldMediaRequest(f.request(),{baseUrl,nativeConfiguration,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,fetchImpl:()=>assert.fail('public URL must not trigger CORS read')})});
 assert.equal(result.inputs[0].url,'https://public.test/full.webp');assert.deepEqual(result.parameters,f.request().parameters);
 await assert.rejects(media.prepareWorldMediaRequest({...f.request(),inputs:[{type:'image',url:'data:image/webp;base64,AAAA'}]},{baseUrl,nativeConfiguration,resolveMedia}),{code:'unsupported_generation'});
 f.world.worldConfig.model='worldlabs-marble-1.1';await assert.rejects(media.prepareWorldMediaRequest(f.request(),{nativeConfiguration,resolveMedia:()=>assert.fail('wrong native route must not read reference')}),{code:'unsupported_generation'});
});

test('tasks-v1 and Marble preserve text and export actual selected video bytes with source range',async()=>{
 const [model,media,resolver,transport]=await ready,{createLocalClipResolver}=await import('../src/features/agent-workflows/local-clip-resolver.mjs');
 const url=URL.createObjectURL(new Blob(['whole video'],{type:'video/mp4'})),f=fixture(model,{id:'video',type:'video',video:url,clip:{start:2,end:4}});
 f.world.worldConfig={model:'worldlabs-marble-1.1',prompt:'camera moves through courtyard'};
 f.state.nodes.push({id:'text',type:'text',content:'preserve old brickwork'});f.state.edges.push({id:'text-reference',source:'text',target:'world'});
 const request=f.request();
 try{
  for(const protocol of ['tasks-v1','marble-native']){
  let reads=0,crops=0;
  const result=await media.prepareWorldMediaRequest(request,{baseUrl,nativeConfiguration:{protocol},resolveMedia:async(node,options)=>{
   const resolveClip=createLocalClipResolver({getNode:id=>id===node.id?node:undefined,serialize,fetchImpl:async(...args)=>{reads++;return fetch(...args);},localMedia:{process:async(operation,blob,options)=>{
    crops++;assert.equal(operation,'trim');assert.equal(await blob.text(),'whole video');assert.equal(options.start,2);assert.equal(options.end,4);return new Blob(['actual selected frames'],{type:'video/mp4'});
   }}});
   return resolver.createWorkflowMediaResolver({baseUrl,resolveClip,createVideo:()=>({videoWidth:1280,videoHeight:720,duration:2,removeAttribute(){},load(){},set src(url){queueMicrotask(()=>this.onloadedmetadata?.());}})})(node,options);
  },transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize})});
  assert.equal(reads,1);assert.equal(crops,1);assert.equal(Buffer.from(result.inputs[0].url.split(',')[1],'base64').toString(),'actual selected frames');assert.deepEqual(result.inputs[0].sourceRange,{start:2,end:4});assert.equal(result.inputs[0].clip,undefined);assert.equal(result.inputs[0].durationMs,2000);
  assert.equal(result.inputs[0].sourceUrl,url);assert.equal(result.prompt,'preserve old brickwork\n\ncamera moves through courtyard');assert.deepEqual(result.parameters,request.parameters);assert.deepEqual(request.inputs[0].clip,{start:2,end:4});
  }
 }finally{URL.revokeObjectURL(url);}
});

test('cancellation or reference disconnect during actual transport prevents world provider dispatch',async()=>{
 const [model,media,resolver,transport]=await ready;
 for(const cancelled of [true,false]){
  const f=fixture(model);let started,release,calls=0;const began=new Promise(resolve=>started=resolve),probes=[];
  const guard=media.captureWorldSourceGuard(f.world,f.refs(),{getNode:f.getNode,resolveReferences:f.refs});
  const resolveMedia=resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async()=> 'blob:http://localhost:4173/full'},createImage:imageFactory(probes)});
  const service=new TaskService({prepareInputs:(value,{signal,validateSources})=>media.prepareWorldMediaRequest(value,{baseUrl,signal,validateSources,nativeConfiguration:{protocol:'tripo-native'},resolveMedia,
   transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize,fetchImpl:async()=>new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(Buffer.from(png,'base64'));controller.close();};started();}}),{headers:{'content-type':'image/png'}})})})});
  service.setProvider({generate:async()=>{calls++;return {outputs:[{type:'model',url:'https://provider.test/result.glb'}]};}});
  const job=service.submit(f.request(),{beforeDispatch:guard}),done=terminal(service,job);await began;
  if(cancelled)service.cancel(job.id);else{f.state.edges=[];release();}
  await done;assert.equal(job.status,cancelled?'cancelled':'failed');assert.equal(calls,0);assert.deepEqual(probes,[]);assert.equal(job.providerDispatched,cancelled?undefined:false);
 }
});

test('world source snapshots reject same-ID replacements, changed clips and empty connected media',async()=>{
 const [model,media]=await ready;
 for(const change of ['replacement','clip','metadata']){
  const f=fixture(model,{id:'video',type:'video',video:'asset:full-video',clip:{start:1,end:3},videoMetadata:{duration:10}});
  const guard=media.captureWorldSourceGuard(f.world,f.refs(),{getNode:f.getNode,resolveReferences:f.refs});assert.doesNotThrow(guard);
  if(change==='replacement')f.state.nodes[1]={...f.source};else if(change==='clip')f.source.clip.end=4;else f.source.videoMetadata.duration=11;
  assert.throws(guard,{code:'world_source_changed'});
 }
 const f=fixture(model,{id:'image',type:'image'});f.world.worldConfig.prompt='a vessel';assert.match(model.prepare(f.world,f.refs()).error,/实际媒体/);
});

const marbleRequest=(modelType,inputs=[],marbleParams={})=>({kind:'world.generate',prompt:'preserve the courtyard',inputs,parameters:{provider:'worldlabs',model:'worldlabs-marble-1.1',modelType,marbleParams}});
test('Marble validates exact mode/count limits before reading and never invents reconstruction settings',async()=>{
 const [,media,,transport,routing]=await ready,nativeConfiguration={protocol:'marble-native'};
 const images=count=>Array.from({length:count},(_,index)=>({type:'image',url:'https://public.test/'+index+'.webp'})),video={type:'video',url:'https://public.test/world.mp4'};
 const invalid=[marbleRequest('MULTI_IMAGE_TO_WORLD',images(5)),marbleRequest('MULTI_IMAGE_TO_WORLD',images(8),{reconstruct_images:'true'}),marbleRequest('MULTI_IMAGE_TO_WORLD',images(9),{reconstruct_images:true}),
  marbleRequest('TEXT_TO_WORLD',images(1)),marbleRequest('IMAGE_TO_WORLD',images(2)),marbleRequest('PANORAMA_TO_WORLD',[]),marbleRequest('MULTI_IMAGE_TO_WORLD',images(1)),marbleRequest('VIDEO_TO_WORLD',[video,video]),
  marbleRequest('VIDEO_TO_WORLD',[video,...images(1)]),marbleRequest('UNKNOWN',[]),marbleRequest('IMAGE_TO_WORLD',[{type:'audio',url:'asset:audio'}]),{...marbleRequest('TEXT_TO_WORLD'),parameters:{provider:'tripo',modelType:'TEXT_TO_WORLD'}}];
 for(const request of invalid)await assert.rejects(media.prepareWorldMediaRequest(request,{nativeConfiguration,resolveMedia:()=>assert.fail('invalid modes must not read media'),transport:()=>assert.fail('invalid modes must not transfer')}),{code:'unsupported_generation'});
 for(const request of [marbleRequest('TEXT_TO_WORLD'),marbleRequest('IMAGE_TO_WORLD',images(1)),marbleRequest('PANORAMA_TO_WORLD',images(1)),marbleRequest('MULTI_IMAGE_TO_WORLD',images(4)),marbleRequest('MULTI_IMAGE_TO_WORLD',images(8),{reconstruct_images:true}),marbleRequest('VIDEO_TO_WORLD',[video])]){
  const before=structuredClone(request),result=await media.prepareWorldMediaRequest(request,{nativeConfiguration,baseUrl,resolveMedia:async node=>{assert.notEqual(node.type,'video','public Marble video must not be probed');return {url:node.fullImage};},transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,fetchImpl:()=>assert.fail('public HTTPS must remain direct')})});
  assert.deepEqual(result.parameters,before.parameters);assert.deepEqual(request,before);assert.deepEqual(result.inputs.map(input=>input.url),before.inputs.map(input=>input.url));
 }
 let reads=0;const metadata={protocol:'routed',configured:true,routes:{'world.generate':'marble'},providers:{other:{protocol:'tripo-native',configured:true},marble:{...nativeConfiguration,configured:false}}};
 const service=new TaskService({prepareInputs:request=>{reads++;return media.prepareWorldMediaRequest(request,{nativeConfiguration});}});
 service.setProvider({isConfigured:async({request})=>routing.providerConfigured(metadata,request),generate:()=>assert.fail('missing Marble key must not dispatch')});
 const job=service.submit(marbleRequest('IMAGE_TO_WORLD',images(1)));await terminal(service,job);assert.equal(job.status,'configuration_required');assert.equal(reads,0);
});

test('Marble transports local WebP and supported video bytes, rejecting unsupported formats and size before dispatch',async()=>{
 const [,media,resolver,transport]=await ready,nativeConfiguration={protocol:'marble-native'},reads=[],probes=[];
 const resolveMedia=resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async id=>{reads.push(id);return 'blob:http://localhost:4173/'+id.slice(6);}},createImage:imageFactory(probes)});
 const request=marbleRequest('IMAGE_TO_WORLD',[{type:'image',url:'asset:thumbnail',fullImage:'asset:full-webp'}],{reconstruct_images:false});
 const result=await media.prepareWorldMediaRequest(request,{nativeConfiguration,baseUrl,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize,fetchImpl:async()=>new Response('whole WebP bytes',{headers:{'content-type':'image/webp'}})})});
 assert.deepEqual(reads,['asset:full-webp']);assert.deepEqual(probes,[result.inputs[0].url]);assert.equal(Buffer.from(result.inputs[0].url.split(',')[1],'base64').toString(),'whole WebP bytes');assert.deepEqual(result.parameters,request.parameters);
 for(const mime of ['video/mp4','video/webm','video/quicktime','video/x-msvideo']){
  const video='data:'+mime+';base64,'+Buffer.from('full '+mime+' bytes').toString('base64'),value=marbleRequest('VIDEO_TO_WORLD',[{type:'video',url:video}]);
  const output=await media.prepareWorldMediaRequest(value,{nativeConfiguration,baseUrl,resolveMedia:async node=>({url:node.video,duration:2})});assert.equal(output.inputs[0].url,video);assert.deepEqual(output.parameters,value.parameters);
 }
 await assert.rejects(media.prepareWorldMediaRequest(marbleRequest('VIDEO_TO_WORLD',[{type:'video',url:'data:video/x-matroska;base64,AAAA'}]),{nativeConfiguration,baseUrl,resolveMedia:async node=>({url:node.video})}),{code:'unsupported_generation'});
 await assert.rejects(media.prepareWorldMediaRequest(request,{nativeConfiguration,baseUrl,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize,fetchImpl:async()=>new Response('small body',{headers:{'content-type':'image/webp','content-length':String(21*1024*1024)}})})}),{code:'media_request_too_large'});
});

test('uncut inline source consumes request budget once while clipped source range and guards retain provenance',async()=>{
 const [model,media,,transport]=await ready,video='data:video/mp4;base64,'+Buffer.alloc(1024,'v').toString('base64');
 const f=fixture(model,{id:'video',type:'video',video});f.world.worldConfig={model:'worldlabs-marble-1.1',prompt:'courtyard'};
 const request=f.request(),guard=media.captureWorldSourceGuard(f.world,f.refs(),{getNode:f.getNode,resolveReferences:f.refs});
 const budget=new TextEncoder().encode(JSON.stringify(request)).byteLength+128;
 const result=await media.prepareWorldMediaRequest(request,{baseUrl,nativeConfiguration:{protocol:'marble-native'},validateSources:guard,
  resolveMedia:async node=>({url:node.video,duration:2}),transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,maxRequestBytes:budget})});
 assert.equal(result.inputs[0].url,video);assert.equal(result.inputs[0].sourceUrl,undefined);assert.equal(request.inputs[0].url,video);assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength<=budget);
 f.source.video='data:video/mp4;base64,AAAA';assert.throws(guard,{code:'world_source_changed'});
 const derived='data:video/mp4;base64,'+Buffer.from('actual selected frames').toString('base64'),clipped=marbleRequest('VIDEO_TO_WORLD',[{type:'video',url:video,clip:{start:1,end:2}}]);
 const output=await media.prepareWorldMediaRequest(clipped,{baseUrl,nativeConfiguration:{protocol:'marble-native'},resolveMedia:async()=>({url:derived,duration:1})});
 assert.equal(output.inputs[0].url,derived);assert.equal(output.inputs[0].sourceUrl,video);assert.deepEqual(output.inputs[0].sourceRange,{start:1,end:2});assert.deepEqual(clipped.inputs[0].clip,{start:1,end:2});
});
