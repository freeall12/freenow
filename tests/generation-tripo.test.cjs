'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTripoProvider,parseTripoModelMap}=require('../server/generation-tripo.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const modelMap={
 'tripo-text-to-model-h3':{kind:'world.generate',mode:'text-to-model',model:'v3.1-20260211',displayModel:'Tripo H3.1'},
 'tripo-image-to-model-h3':{kind:'world.generate',mode:'image-to-model',model:'v3.1-20260211',displayModel:'Tripo H3.1'},
};
const params={texture:true,pbr:false,smart_low_poly:false,quad:false,auto_size:true,generate_parts:false,export_uv:false,geometry_quality:'standard',compress:'geometry',texture_quality:'standard'};
const request=(image=false,extra={})=>({kind:'world.generate',prompt:image?'':'a wooden chair',inputs:image?[{type:'image',url:png}]:[],parameters:{model:'tripo-'+(image?'image':'text')+'-to-model-h3',provider:'tripo',modelType:image?'IMAGE_TO_WORLD':'TEXT_TO_WORLD',outputType:'asset',representation:'mesh',isPano:false,count:1,tripoParams:{...params,...image?{enable_image_autofix:false,orientation:'default',texture_alignment:'original_image'}:{},...extra}}});
const response=(data,status=200)=>new Response(JSON.stringify({code:0,data}),{status,headers:{'Content-Type':'application/json'}});
const provider=fetchImpl=>createTripoProvider({apiKey:'test-key',modelMap,fetchImpl});
const task=(overrides={})=>({task_id:'task_actual',type:'text_to_model',status:'success',progress:100,output:{model_url:'https://cdn.tripo3d.ai/output/model_pbr.glb',rendered_image_url:'https://cdn.tripo3d.ai/output/preview.png'},...overrides});

test('missing keys and explicit version mappings prevent transport and never choose a default H3',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response({task_id:'task_actual'});};
 for(const config of [{},{apiKey:'test-key'},{modelMap}]){const p=createTripoProvider({...config,fetchImpl});assert.equal(p.configured,false);await assert.rejects(()=>p.submit(request()),{code:'configuration_required'});}
 assert.equal(calls,0);
 for(const model of ['h3','v2.5-20250123','tripo-v3.1'])assert.throws(()=>parseTripoModelMap({alias:{...modelMap['tripo-text-to-model-h3'],model}}));
 assert.throws(()=>parseTripoModelMap({alias:{...modelMap['tripo-text-to-model-h3'],displayModel:'Tripo H3'}}));
});
test('configuration validates origins, preserves real labels, and excludes keys and internal dates from metadata',()=>{
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.equal(p.metadata.capabilities.models['tripo-text-to-model-h3'].label,'Tripo H3.1');assert.equal(p.metadata.capabilities.worldGeneration['tripo-image-to-model-h3'].maxImages,1);assert.equal(p.metadata.capabilities.remoteCancellation,false);assert.equal(p.cancel,undefined);assert.ok(!JSON.stringify(p.metadata).includes('test-key'));assert.ok(!JSON.stringify(p.metadata).includes('v3.1-20260211'));
 for(const baseUrl of ['http://openapi.tripo3d.ai/v3','https://user:secret@openapi.tripo3d.ai/v3','https://untrusted.test/v3','https://openapi.tripo3d.ai/v3?','https://openapi.tripo3d.ai/v2'])assert.equal(createTripoProvider({baseUrl,apiKey:'test-key',modelMap}).configured,false);
 assert.equal(createTripoProvider({baseUrl:'https://openapi.tripo3d.com/v3',apiKey:'test-key',modelMap}).configured,true);
});
test('text mode forwards every UI geometry and material field to the documented exact model',async()=>{
 for(const material of ['geometry','texture','pbr']){
  const selected={texture:material!=='geometry',pbr:material==='pbr'},calls=[];
  const p=provider(async(url,options)=>{calls.push({url,options});return response({task_id:'task_actual'});});
  const accepted=await p.submit(request(false,selected));assert.equal(accepted.status,'queued');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://openapi.tripo3d.ai/v3/generation/text-to-model');assert.equal(calls[0].options.headers.Authorization,'Bearer test-key');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),{model:'v3.1-20260211',...params,...selected,prompt:'a wooden chair'});
 }
});
test('prepare is pure; local image uploads use authenticated multipart token then image task, without public upload services',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response(url.endsWith('/files')?{file_token:'file_actual'}:{task_id:'task_actual'});});
 p.prepare(request(true));assert.equal(calls.length,0);await p.submit(request(true));assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://openapi.tripo3d.ai/v3/files');assert.ok(calls[0].options.body instanceof FormData);assert.equal(calls[0].options.headers['Content-Type'],undefined);
 const file=calls[0].options.body.get('file');assert.equal(file.type,'image/png');assert.equal(file.name,'reference-1.png');assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(png.split(',')[1],'base64'));
 assert.equal(calls[1].url,'https://openapi.tripo3d.ai/v3/generation/image-to-model');assert.deepEqual(JSON.parse(calls[1].options.body),{model:'v3.1-20260211',...params,enable_image_autofix:false,orientation:'default',texture_alignment:'original_image',input:'file_actual'});
});
test('public HTTPS image goes directly to input and preserves all image controls',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,options});return response({task_id:'task_actual'});});
 const r=request(true,{texture:false,pbr:false});delete r.parameters.tripoParams.texture_alignment;r.inputs[0].url='https://public.test/image.webp';await p.submit(r);assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].options.body).input,r.inputs[0].url);
});
test('unsupported options, conflicting inputs, panorama, and changed material semantics do not upload or submit',async()=>{
 let calls=0;const p=provider(async()=>{calls++;return response({task_id:'task_actual'});});
 const invalid=[request(false,{quad:true}),request(false,{generate_parts:true}),request(false,{texture:false,pbr:true}),request(false,{unknown:true}),request(false,{texture_quality:'fast'}),request(false,{auto_size:'true'}),request(false,{enable_image_autofix:true}),{...request(),prompt:'a'.repeat(1025)},{...request(true),prompt:'image prompt'}, {...request(),inputs:[{type:'image',url:png}]},{...request(true),inputs:[]}, {...request(true),inputs:[{type:'video',url:png}]},{...request(),parameters:{...request().parameters,isPano:true}}, {...request(),parameters:{...request().parameters,count:2}}, {...request(),parameters:{...request().parameters,providerParameters:{model:'another'}}}, {...request(),references:[{type:'image',url:png}]}, {...request(),parameters:{...request().parameters,secret:'do-not-log'}}];
 for(const r of invalid)await assert.rejects(()=>p.submit(r));assert.equal(calls,0);
});
test('invalid, local and credential-bearing images are rejected before uploads',async()=>{
 let calls=0;const p=provider(async()=>{calls++;return response({file_token:'file_actual'});});
 for(const url of ['blob:local','asset:local','http://public.test/image.png','https://127.0.0.1/a.png','https://0x7f000001/a.png','https://user:secret@public.test/a.png','data:image/png;base64,bm90LWltYWdl']){const r=request(true);r.inputs[0].url=url;await assert.rejects(()=>p.submit(r));}
 const bytes=Buffer.alloc(30);bytes.write('RIFF');bytes.writeUInt32LE(22,4);bytes.write('WEBP',8);bytes.write('VP8X',12);bytes.writeUInt32LE(10,16);const r=request(true);r.inputs[0].url='data:image/webp;base64,'+bytes.toString('base64');await assert.rejects(()=>p.submit(r),/PNG\/JPEG/);assert.equal(calls,0);
});
test('a lost or malformed upload receipt never submits the billable task and never retries upload',async()=>{
 for(const upload of [()=>{throw Error('private details');},()=>response({file_token:'wrong'}),()=>response({token:'private'}),()=>new Response(JSON.stringify({code:1004,data:{file_token:'file_actual'}}))]){
  const calls=[],p=provider(async(url)=>{calls.push(url);return upload();});await assert.rejects(()=>p.submit(request(true)),{code:'unknown'});assert.deepEqual(calls,['https://openapi.tripo3d.ai/v3/files']);
 }
});
test('accepted task identity survives recreation and key rotation; polls only GET the original task',async()=>{
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{task_id:'task_actual'}:task());};
 const first=provider(fetchImpl),accepted=await first.submit(request()),restarted=createTripoProvider({apiKey:'rotated',modelMap,fetchImpl}),result=await restarted.poll(accepted.id);
 assert.equal(first.fingerprint,restarted.fingerprint);assert.equal(result.id,accepted.id);assert.deepEqual(result.outputs,[{type:'model',url:'https://cdn.tripo3d.ai/output/model_pbr.glb',sourceFileId:'task_actual',poster:'https://cdn.tripo3d.ai/output/preview.png'}]);
 assert.deepEqual(calls,[{url:'https://openapi.tripo3d.ai/v3/generation/text-to-model',method:'POST'},{url:'https://openapi.tripo3d.ai/v3/tasks/task_actual',method:'GET'}]);
 const changed=structuredClone(modelMap);changed['tripo-text-to-model-h3']={...changed['tripo-text-to-model-h3'],model:'v3.0-20250812',displayModel:'Tripo H3.0'};delete changed['tripo-image-to-model-h3'];const p=createTripoProvider({apiKey:'test-key',modelMap:changed,fetchImpl:()=>assert.fail()});assert.notEqual(first.fingerprint,p.fingerprint);await assert.rejects(()=>p.poll(accepted.id),{code:'provider_configuration_changed'});
 await assert.rejects(()=>first.poll('tp3.bad'),{code:'provider_identity_mismatch'});
});
test('fingerprints are stable for reordered maps but change for selected origin and version',()=>{
 const p=provider(()=>assert.fail()),reordered=Object.fromEntries(Object.entries(modelMap).reverse());assert.equal(p.fingerprint,createTripoProvider({apiKey:'another-key',modelMap:reordered}).fingerprint);assert.notEqual(p.fingerprint,createTripoProvider({baseUrl:'https://openapi.tripo3d.com/v3',apiKey:'test-key',modelMap}).fingerprint);
});
test('wrong tasks, states, progress and fake or non-GLB outputs remain unconfirmed without a POST replay',async()=>{
 const bad=[task({task_id:'task_other'}),task({type:'image_to_model'}),task({status:'unknown'}),task({progress:-1}),task({status:'running'}),task({output:{model_url:'blob:fake'}}),task({output:{model_url:'https://cdn.tripo3d.ai/model.fbx'}}),task({output:{model_url:'https://user:secret@cdn.tripo3d.ai/model.glb'}}),task({output:{model:'https://cdn.tripo3d.ai/model.glb'}})];
 for(const value of bad){let posts=0;const p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return response({task_id:'task_actual'});}return response(value);});const accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id));assert.equal(posts,1);}
});
test('confirmed failure or cancellation does not expose supplier error text',async()=>{
 for(const status of ['failed','cancelled','banned','expired']){const p=provider(async(_url,options)=>response(options.method==='POST'?{task_id:'task_actual'}:task({status,error_message:'private-provider-key'})));const accepted=await p.submit(request()),value=await p.poll(accepted.id);assert.equal(value.status,status==='cancelled'?'cancelled':'failed');assert.ok(!JSON.stringify(value).includes('private-provider-key'));assert.equal(value.outputs,undefined);}
});
test('generate uses one task and forwards actual running progress',async()=>{
 let posts=0,gets=0;const ids=[],progress=[],p=provider(async(_url,options)=>{if(options.method==='POST'){posts++;return response({task_id:'task_actual'});}gets++;return response(gets===1?task({status:'running',progress:47,output:undefined}):task());});
 const value=await p.generate(request(),{pollInterval:1,onTaskIdentity:id=>ids.push(id),onProgress:n=>progress.push(n)});assert.equal(value.status,'succeeded');assert.equal(posts,1);assert.deepEqual(progress,[0,47]);assert.deepEqual(ids,[value.id]);
});
test('unknown POST is never replayed and transport errors do not leak credentials or remote details',async()=>{
 let posts=0;const p=provider(async()=>{posts++;throw Error('test-key private-remote-detail');});await assert.rejects(()=>p.generate(request()),error=>error.code==='unknown'&&!error.message.includes('test-key')&&!error.message.includes('private-remote-detail'));assert.equal(posts,1);
});
test('abort cancels hanging fetch and stream reads even when a stub ignores its signal',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{})}))]){
  const p=provider(fetchImpl),controller=new AbortController(),reason=Error('user cancelled'),running=p.submit(request(),{signal:controller.signal});setTimeout(()=>controller.abort(reason),10);await assert.rejects(()=>running,error=>error===reason);
 }
});
test('response size limits bound both declared and streamed provider bodies',async()=>{
 for(const fetchImpl of [async()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}}),async()=>new Response('x'.repeat(1024*1024+1))]){const p=provider(fetchImpl);await assert.rejects(()=>p.submit(request()),{code:'unknown'});}
});
