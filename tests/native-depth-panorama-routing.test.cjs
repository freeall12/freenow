'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Vector3}=require('three');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {encodeRGBA,decodePNG}=require('../server/generation-png-alpha.cjs');
const {COORDINATES}=require('../server/generation-panorama-edit-geometry.cjs');
const key='synthetic-depth-panorama-integration-key';
const depthConfig={protocol:'fal-video-depth-native',apiKey:key,modelMap:{'depth-anything-video':{kind:'video.depth',model:'fal-ai/depth-anything-video'}}};
const panoramaConfig={protocol:'openai-panorama-edit-native',apiKey:key,modelMap:{'panorama.edit':{kind:'panorama.edit',model:'gpt-image-2',semantics:'perspective-mask-reproject',quality:'high',cropSize:'1024x1024'}}};
const configuration={providers:{depth:depthConfig,panorama:panoramaConfig},routes:{'video.depth':'depth','panorama.edit':'panorama'}};
const opaque=(width,height,color)=>{const rgba=Buffer.alloc(width*height*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=color;rgba[i+1]=45;rgba[i+2]=80;rgba[i+3]=255;}return encodeRGBA(width,height,rgba);};
const source=opaque(2048,1024,60),edited=opaque(1024,1024,180);
function panorama(){return {kind:'panorama.edit',label:'全景图编辑',nodeId:'scene',prompt:'将选区改为石墙',inputs:[{type:'image',image:'data:image/png;base64,'+source.toString('base64'),projection:'equirectangular'}],parameters:{binding:{nodeId:'scene',setupId:'setup',sessionId:'editor',revision:2},camera:{position:[0,1,0],quaternion:[0,0,0,1],fov:60,aspect:1.5},regions:[{id:'selection',color:'#75e845',directions:[[-.2,.2,-1],[.2,.2,-1],[.2,-.2,-1],[-.2,-.2,-1]].map(v=>new Vector3(...v).normalize().toArray())}],output:{projection:'equirectangular',width:2048,height:1024,composite:true},coordinates:{...COORDINATES}}};}
async function depth(){const bytes=await fs.readFile(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));return {kind:'video.depth',nodeId:'video',prompt:'Extract per-frame depth; preserve source movement, camera, duration and frame size.',inputs:[{id:'video',type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),width:64,height:48,duration:2}],parameters:{workflow:'depth-video-studio',protocol:'local-depth-v1',resolution:'source',duration:2,width:64,height:48,preserveDuration:true,promptUsed:false}};}
async function send(gateway,url,method='GET',input,key='integration-request'){
 let result;await gateway.handle({method,headers:{'idempotency-key':key}},{},url,{json:(_res,status,body)=>{result={status,body};},body:async()=>input});return result;
}
async function waitFor(gateway,id,predicate){
 for(let i=0;i<160;i++){const value=(await send(gateway,'/api/generation/tasks/'+id)).body;if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.fail('integration task did not reach the expected state');
}
async function harness(t,fetchImpl){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-depth-panorama-route-'));let gateway;
 const open=async()=>{gateway=createGenerationGateway({...configuration,directory:path.join(root,'tasks'),fetchImpl});await gateway.ready;};await open();
 t.after(async()=>{await gateway.close();await fs.rm(root,{recursive:true,force:true});});
 return {get gateway(){return gateway;},root,async restart(){await gateway.close();await open();},bytes:output=>fs.readFile(path.join(root,'tasks-media',output.url.split('/').at(-1)+'.bin'))};
}

test('direct and routed metadata expose exact depth/panorama operations without a model-selection fallback',async t=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs');
 const {depthRequestState}=await import('../src/features/video-depth/native-profile.mjs'),{prepareDepthMedia}=await import('../src/features/video-depth/media.mjs');
 for(const [options,requests]of [[depthConfig,[await depth()]],[panoramaConfig,[panorama()]],[configuration,[await depth(),panorama()]]]){
  const gateway=createGenerationGateway({...options,fetchImpl:()=>assert.fail('metadata must not dispatch')});t.after(()=>gateway.close());
  const metadata=(await send(gateway,'/api/generation/config')).body;assert.equal(metadata.configured,true);assert.equal(metadata.configurationError,null);assert.equal(JSON.stringify(metadata).includes(key),false);
  for(const request of requests){
   assert.equal(ui.providerConfigured(metadata,request),true);assert.equal(ui.generationOperationReadiness(metadata).find(row=>row.kind===request.kind).state,'ready');assert.equal(ui.providerConfigured(metadata,{...request,parameters:{...request.parameters,model:'unmapped'}}),false);
   if(request.kind==='video.depth'){
    assert.equal(depthRequestState(metadata,request).ready,true);
    const prepared=await prepareDepthMedia(request,{nativeConfiguration:metadata,baseUrl:'http://localhost:4173/',resolveMedia:async()=>request.inputs[0],transport:async(value,options)=>{assert.equal(options.inlineVideos,true);return value;}});
    assert.deepEqual(prepared,request);
   }
  }
 }
 const router=createGenerationRouter(configuration);assert.equal(router.protocolFor(await depth()),'fal-video-depth-native');assert.equal(router.protocolFor(panorama()),'openai-panorama-edit-native');
 for(const kind of ['video.generate','image.generate','image.skin'])assert.throws(()=>router.prepare({kind}),{code:'configuration_required'});
});

test('native panorama edit is archived as a real 2:1 image and restart/idempotency never submits it twice',async t=>{
 let posts=0;const h=await harness(t,async(url,options)=>{
  assert.equal(String(url),'https://api.openai.com/v1/images/edits');assert.equal(options.method,'POST');posts++;
  const form=options.body;assert(form instanceof FormData);assert.equal(form.get('size'),'1024x1024');assert.equal(form.get('n'),'1');assert.equal(form.getAll('image[]').length,1);assert(form.get('mask'));
  return Response.json({data:[{b64_json:edited.toString('base64')}]});
 });
 const request=panorama(),created=await send(h.gateway,'/api/generation/tasks','POST',request,'panorama-once');assert.equal(created.status,202);
 const done=await waitFor(h.gateway,created.body.id,job=>!['queued','running'].includes(job.status));assert.equal(done.status,'succeeded');assert.equal(done.outputs.length,1);assert.match(done.outputs[0].url,/^\/api\/generation\/media\//);
 const archived=await h.bytes(done.outputs[0]),actual=decodePNG(archived);assert.deepEqual([actual.width,actual.height],[2048,1024]);assert.equal(actual.pixels[0],60);assert.equal(actual.pixels[(512*2048+1024)*4],180);assert.equal(posts,1);
 await h.restart();const restored=(await send(h.gateway,'/api/generation/tasks/by-key/panorama-once')).body;assert.equal(restored.id,done.id);assert.equal(restored.status,'succeeded');assert.deepEqual(await h.bytes(restored.outputs[0]),archived);
 const duplicate=(await send(h.gateway,'/api/generation/tasks','POST',request,'panorama-once')).body;assert.equal(duplicate.id,done.id);assert.equal(posts,1);
});

test('depth gateway persists the original fal identity and restart queries the same task without another POST',async t=>{
 const calls=[];const h=await harness(t,async(url,options)=>{calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});return Response.json(options.method==='POST'?{request_id:'depth-original',status:'IN_QUEUE'}:{request_id:'depth-original',status:'IN_PROGRESS'});});
 const request=await depth(),created=(await send(h.gateway,'/api/generation/tasks','POST',request,'depth-once')).body;
 await waitFor(h.gateway,created.id,job=>job.recovery?.pollable===true);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 const submitted=calls.find(c=>c.method==='POST');assert.equal(submitted.body.video_url,request.inputs[0].url);assert.equal(submitted.body.max_frames,40);assert.equal(submitted.body.output_fps,null);
 await h.restart();const restored=(await send(h.gateway,'/api/generation/tasks/by-key/depth-once')).body;assert.equal(restored.id,created.id);assert.equal(restored.recovery.pollable,true);
 await send(h.gateway,'/api/generation/tasks/'+created.id+'/recover','POST',{});
 await waitFor(h.gateway,created.id,()=>calls.some(c=>c.method==='GET'));assert(calls.filter(c=>c.method==='GET').every(c=>c.url.includes('/depth-original/')));assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('gateway preparation cannot erase unsupported depth intent or enable unsupported global panorama editing',async t=>{
 let calls=0;const h=await harness(t,async()=>{calls++;assert.fail('unsupported intent must not dispatch');});
 const invalid=[];
 for(const change of [r=>r.parameters.output_fps=12,r=>r.parameters.side_by_side=true,r=>r.parameters.modelId='different-model',r=>r.prompt='replace the person',r=>r.references=[{type:'image',url:'https://example.test/source.png'}]]){const request=await depth();change(request);invalid.push(request);}
 const global=panorama();global.parameters.regions=[];invalid.push(global);
 for(let i=0;i<invalid.length;i++){
  const created=await send(h.gateway,'/api/generation/tasks','POST',invalid[i],'unsupported-'+i);
  if(created.status===202){const done=await waitFor(h.gateway,created.body.id,job=>!['queued','running'].includes(job.status));assert.equal(done.status,i===2?'configuration_required':'failed');}else assert.equal(created.status,400);
 }
 assert.equal(calls,0);
});
