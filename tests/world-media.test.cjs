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

test('common tasks-v1 preserves text and exports actual selected video bytes with source range',async()=>{
 const [model,media,resolver,transport]=await ready,{createLocalClipResolver}=await import('../src/features/agent-workflows/local-clip-resolver.mjs');
 const url=URL.createObjectURL(new Blob(['whole video'],{type:'video/mp4'})),f=fixture(model,{id:'video',type:'video',video:url,clip:{start:2,end:4}});
 f.world.worldConfig={model:'worldlabs-marble-1.1',prompt:'camera moves through courtyard'};
 f.state.nodes.push({id:'text',type:'text',content:'preserve old brickwork'});f.state.edges.push({id:'text-reference',source:'text',target:'world'});
 const request=f.request();let reads=0,crops=0;
 try{
  const result=await media.prepareWorldMediaRequest(request,{baseUrl,nativeConfiguration:{protocol:'tasks-v1'},resolveMedia:async(node,options)=>{
   const resolveClip=createLocalClipResolver({getNode:id=>id===node.id?node:undefined,serialize,fetchImpl:async(...args)=>{reads++;return fetch(...args);},localMedia:{process:async(operation,blob,options)=>{
    crops++;assert.equal(operation,'trim');assert.equal(await blob.text(),'whole video');assert.equal(options.start,2);assert.equal(options.end,4);return new Blob(['actual selected frames'],{type:'video/mp4'});
   }}});
   return resolver.createWorkflowMediaResolver({baseUrl,resolveClip,createVideo:()=>({videoWidth:1280,videoHeight:720,duration:2,removeAttribute(){},load(){},set src(url){queueMicrotask(()=>this.onloadedmetadata?.());}})})(node,options);
  },transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize})});
  assert.equal(reads,1);assert.equal(crops,1);assert.equal(Buffer.from(result.inputs[0].url.split(',')[1],'base64').toString(),'actual selected frames');assert.deepEqual(result.inputs[0].sourceRange,{start:2,end:4});assert.equal(result.inputs[0].clip,undefined);assert.equal(result.inputs[0].durationMs,2000);
  assert.equal(result.inputs[0].sourceUrl,url);assert.equal(result.prompt,'preserve old brickwork\n\ncamera moves through courtyard');assert.deepEqual(result.parameters,request.parameters);assert.deepEqual(request.inputs[0].clip,{start:2,end:4});
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
