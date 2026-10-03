'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMarbleProvider}=require('../server/generation-marble.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const mapping=modes=>({marble:{kind:'world.generate',model:'marble-1.1',displayModel:'Marble 1.1',modes}});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const accepted={operation_id:'original-operation',done:false,error:null,response:null};
function request(mode='TEXT_TO_WORLD',inputs=[]){return {kind:'world.generate',prompt:'真实世界生成合同测试',inputs,parameters:{model:'marble',provider:'worldlabs',modelType:mode,outputType:'world',representation:'gaussianSplat',isPano:mode==='PANORAMA_TO_WORLD',count:1,marbleParams:{}}};}
function provider(fetchImpl,modes=['TEXT_TO_WORLD','IMAGE_TO_WORLD','PANORAMA_TO_WORLD','MULTI_IMAGE_TO_WORLD','VIDEO_TO_WORLD']){return createMarbleProvider({apiKey:'private-world-api-key',modelMap:mapping(modes),fetchImpl});}
const upload=headers=>({media_asset:{media_asset_id:'original-media',kind:'image',extension:'png'},upload_info:{upload_method:'PUT',upload_url:'https://storage.googleapis.com/world/upload?token=storage-signed-token',required_headers:headers}});
function complete(){return {operation_id:'original-operation',done:true,error:null,metadata:{world_id:'original-world'},response:{world_id:'original-world',model:'marble-1.1',world_marble_url:'https://marble.worldlabs.ai/world/original-world',world_prompt:{type:'text'},assets:{splats:{spz_urls:{'500k':'https://cdn.worldlabs.ai/object-without-extension?token=resource-signed-token'},semantics_metadata:{metric_scale_factor:1,ground_plane_offset:0}},mesh:{collider_mesh_url:'https://cdn.worldlabs.ai/collider.glb'},imagery:{pano_url:'https://cdn.worldlabs.ai/pano.png'}}}};}

test('Marble capabilities describe only explicitly mapped modes and SPZ output, with no renderer readiness claim',()=>{
 for(const [modes,maxImages,maxDefault,maxVideos]of [[['TEXT_TO_WORLD'],0,0,0],[['IMAGE_TO_WORLD'],1,1,0],[['PANORAMA_TO_WORLD'],1,1,0],[['MULTI_IMAGE_TO_WORLD'],8,4,0],[['VIDEO_TO_WORLD'],0,0,1]]){
  const p=provider(()=>assert.fail(),modes),caps=p.metadata.capabilities,profile=caps.worldGeneration.marble;assert.equal(p.configured,true);assert.equal(profile.maxImages,maxImages);assert.equal(profile.maxImagesWithoutReconstruction,maxDefault);assert.equal(profile.maxVideos,maxVideos);assert.equal(profile.maxImageBytes,maxImages?20*1024*1024:0);assert.equal(profile.maxVideoBytes,maxVideos?40*1024*1024:0);assert.equal(profile.inlineImageMimeTypes.length,maxImages?3:0);assert.equal(profile.inlineVideoMimeTypes.length,maxVideos?4:0);assert.equal(caps.references,!!(maxImages||maxVideos));assert.equal(caps.textReferences,false);assert.deepEqual(caps.output,{type:'model',format:'spz',representation:'gaussianSplat',coordinateSystem:'marble_raw_opencv'});assert.equal(caps.preview,undefined);assert.equal(caps.rendering,undefined);assert.ok(!JSON.stringify(p.metadata).includes('private-world-api-key'));
 }
});

test('unconfigured or invalid native configuration makes no upload/model request and reports only actionable missing names',async()=>{
 for(const config of [{apiKey:'',modelMap:mapping(['TEXT_TO_WORLD'])},{apiKey:'private-world-api-key',modelMap:{}},{apiKey:'private-world-api-key',modelMap:mapping(['TEXT_TO_WORLD']),baseUrl:'https://api.worldlabs.ai/marble/v1?token=private-world-api-key'}]){
  const p=createMarbleProvider({...config,fetchImpl:()=>assert.fail('unconfigured provider must not submit or upload')});assert.equal(p.configured,false);await assert.rejects(()=>p.submit(request()),{code:'configuration_required'});assert.ok(!JSON.stringify(p.metadata).includes('private-world-api-key'));assert.ok(!JSON.stringify(p.metadata).includes('https://api.worldlabs.ai'));
 }
 const noKey=createMarbleProvider({modelMap:mapping(['TEXT_TO_WORLD']),fetchImpl:()=>assert.fail()});assert.deepEqual(noKey.metadata.missing,['GENERATION_API_KEY']);const noMap=createMarbleProvider({apiKey:'private-world-api-key',fetchImpl:()=>assert.fail()});assert.deepEqual(noMap.metadata.missing,['GENERATION_MODEL_MAP']);
});

test('native input URLs obey the same static public URL contract as durable resource downloads',async()=>{
 const p=provider(()=>assert.fail('invalid input must not upload or generate'));
 for(const url of ['https://localhost./image.png','https://child.localhost./image.png','https://files.internal/image.png','https://100.64.0.1/image.png','https://198.18.0.1/image.png','https://192.0.0.1/image.png','https://user:secret@public.test/image.png','https://public.test\\private/image.png',' https://public.test/image.png','https://public.test/image.png\n','https://tapnow.media/image.png'])await assert.rejects(()=>p.submit(request('IMAGE_TO_WORLD',[{type:'image',url}])),{code:'unsupported_generation'});
});

test('already materialized video source ranges are finite provenance and never become upstream cropping instructions',async()=>{
 let calls=0,body;const p=provider(async(_url,options)=>{calls++;body=JSON.parse(options.body);return response(accepted);});
 const video={type:'video',url:'https://cdn.worldlabs.ai/materialized.mp4',sourceRange:{start:2,end:4}};
 await p.submit(request('VIDEO_TO_WORLD',[video]));assert.equal(calls,1);assert.deepEqual(body.world_prompt.video_prompt,{source:'uri',uri:video.url});assert.equal(JSON.stringify(body).includes('sourceRange'),false);assert.equal(JSON.stringify(body).includes('clip'),false);
 for(const sourceRange of [null,[],{start:4,end:2},{start:-1,end:2},{start:0,end:Infinity},{start:0,end:'2'},{start:0,end:2,mode:'crop'}])await assert.rejects(()=>p.submit(request('VIDEO_TO_WORLD',[{...video,sourceRange}])),{code:'unsupported_generation'});
 for(const patch of [{clip:{start:2,end:4}},{trim:{start:2,end:4}}])await assert.rejects(()=>p.submit(request('VIDEO_TO_WORLD',[{...video,...patch}])),{code:'unsupported_generation'});
 assert.equal(calls,1);
});

test('signed upload receipts cannot forward the API key, dangerous headers, duplicate header identities or unbounded headers',async()=>{
 const invalid=[{'x-storage-key':'private-world-api-key'},{'x-storage-key':'Bearer private-world-api-key'},{'Proxy-Authorization':'storage-auth'},{Connection:'keep-alive'},{'Transfer-Encoding':'chunked'},{Expect:'100-continue'},{'Set-Cookie':'sid=storage'},{'Content-Type':'image/png','content-type':'image/jpeg'},{'x-header':'x'.repeat(16385)},Object.fromEntries(Array.from({length:25},(_,index)=>['x-storage-'+index,'value'])),{['x'.repeat(81)]:'value'},{'x-storage':'secret\u007fvalue'}];
 for(const headers of invalid){const calls=[],p=provider(async(url,options)=>{calls.push([url,options.method]);return response(upload(headers));});await assert.rejects(()=>p.submit(request('IMAGE_TO_WORLD',[{type:'image',url:image}])),error=>error.code==='unknown'&&!error.message.includes('private-world-api-key'));assert.equal(calls.length,1);assert.equal(calls[0][0],'https://api.worldlabs.ai/marble/v1/media-assets:prepare_upload');}
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return url.includes('prepare_upload')?response(upload({'Content-Type':'image/png','x-goog-meta-resource':'signed-object'})):options.method==='PUT'?new Response(null):response(accepted);});await p.submit(request('IMAGE_TO_WORLD',[{type:'image',url:image}]));assert.equal(calls.length,3);assert.equal(calls[1].url,'https://storage.googleapis.com/world/upload?token=storage-signed-token');assert.deepEqual(calls[1].options.headers,{'Content-Type':'image/png','x-goog-meta-resource':'signed-object'});assert.equal(calls[1].options.headers['WLT-Api-Key'],undefined);assert.deepEqual(JSON.parse(calls[2].options.body).world_prompt.image_prompt,{source:'media_asset',media_asset_id:'original-media'});
});

test('optional world assets cannot silently accept malformed objects, and signed SPZ without a suffix retains the exact representation',async()=>{
 for(const mutate of [value=>{value.response.assets.mesh='invalid';},value=>{value.response.assets.mesh=[];},value=>{value.response.assets.imagery='invalid';},value=>{value.response.assets.imagery=[];},value=>{value.response.assets.splats.spz_urls['500k']='https://localhost./world.spz';}]){
  const value=complete();mutate(value);let posts=0;const p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return response(accepted);}return response(value);}),job=await p.submit(request());await assert.rejects(()=>p.poll(job.id),{code:'unknown'});assert.equal(posts,1);
 }
 const p=provider(async(_url,options)=>response(options.method==='POST'?accepted:complete())),job=await p.submit(request()),out=(await p.poll(job.id)).outputs[0];assert.equal(out.url,'https://cdn.worldlabs.ai/object-without-extension?token=resource-signed-token');assert.equal(out.format,'spz');assert.equal(out.representation,'gaussianSplat');assert.equal(out.world.assets.mesh.colliderMeshUrl,'https://cdn.worldlabs.ai/collider.glb');assert.notEqual(out.url,out.world.assets.mesh.colliderMeshUrl);assert.equal(out.world.coordinateSystem,'marble_raw_opencv');
});
