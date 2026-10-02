'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFalProvider,topazStyles}=require('../server/generation-fal.cjs');
const modelMap={'image.remove-background':{kind:'image.remove-background',model:'fal-ai/birefnet'},'image.upscale:topazlabs':{kind:'image.upscale',model:'fal-ai/topaz/upscale/image'}};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const request=(kind='image.upscale',parameters={provider:'topazlabs',style:'general',scale:2})=>({kind,prompt:'',inputs:[{type:'image',url:png}],parameters});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const provider=fetchImpl=>createFalProvider({baseUrl:'https://queue.fal.run',apiKey:'test-key-only',modelMap,fetchImpl});

test('operator configuration is explicit, official-only and never exposes key or model destinations',()=>{
 const ready=provider(()=>assert.fail());assert.equal(ready.configured,true);
 assert.equal(ready.metadata.capabilities.models['image.upscale:topazlabs'].kind,'image.upscale');
 assert.equal(ready.metadata.capabilities.remoteCancellation,'best-effort');
 for(const options of [{modelMap:{fake:{kind:'image.skin',model:'fal-ai/birefnet'}}},{modelMap:{fake:{kind:'image.upscale',model:'made-up/topaz'}}},{modelMap:{fake:{kind:'image.upscale',model:'fal-ai/topaz/upscale/image',adapter:'guess'}}},{baseUrl:'https://queue.fal.run:444'},{baseUrl:'https://private-key@queue.fal.run'},{baseUrl:'https://queue.fal.run?secret=private-key'},{apiKey:' key\n'},{modelMap:'[]'}]){
  const p=createFalProvider({baseUrl:'https://queue.fal.run',apiKey:'private-key',modelMap,...options});assert.equal(p.configured,false);assert.equal(p.metadata.configurationError,'configuration_invalid');assert.ok(!JSON.stringify(p.metadata).includes('private-key'));
 }
 for(const options of [{},{baseUrl:'https://queue.fal.run',apiKey:'x'},{baseUrl:'https://queue.fal.run',modelMap}])assert.equal(createFalProvider(options).configured,false);
 for(const baseUrl of [undefined,'']){const defaults=createFalProvider({baseUrl,apiKey:'x',modelMap});assert.equal(defaults.configured,true);assert.equal(defaults.fingerprint,ready.fingerprint);assert.ok(!defaults.metadata.missing.includes('GENERATION_API_BASE_URL'));}
 assert.ok(!JSON.stringify(ready.metadata).includes('test-key-only'));assert.ok(!JSON.stringify(ready.metadata).includes('fal-ai/topaz'));
});
test('all five frontend Topaz styles map to exact official models at 2x and 4x',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({request_id:'real-task',status:'IN_QUEUE'});});
 for(const [style,model]of Object.entries(topazStyles))for(const scale of [2,4]){
  const result=await p.submit(request('image.upscale',{provider:'topazlabs',style,scale}));assert.equal(result.status,'queued');
  assert.equal(calls.at(-1).url,'https://queue.fal.run/fal-ai/topaz/upscale/image');
  assert.deepEqual(calls.at(-1).body,{image_url:png,output_format:'png',model,upscale_factor:scale,crop_to_fill:false});
 }
 assert.equal(calls.length,10);
});
test('6x, Magnific, skin, extra sliders and multiple images fail without any POST',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();});
 for(const input of [request('image.upscale',{provider:'topazlabs',style:'general',scale:6}),request('image.upscale',{provider:'magnific',scaleFactor:2}),request('image.skin',{mode:'detailed'}),request('image.upscale',{provider:'topazlabs',scale:2,sharpen:30}),request('image.upscale',{provider:'topazlabs',style:'guess',scale:2}),{...request(),count:2},{...request(),inputs:[...request().inputs,...request().inputs]},{...request(),prompt:'change face'},{...request(),references:[{type:'image',url:png}]}])await assert.rejects(()=>p.submit(input));
 assert.equal(calls,0);assert.throws(()=>p.prepare(request('image.upscale',{provider:'topazlabs',scale:6})),error=>error.providerDispatched===false&&/6x/.test(error.message));
});
test('explicit aliases take priority and contradictory model identities do not dispatch',async()=>{
 const p=provider(async()=>response({request_id:'accepted',status:'IN_QUEUE'}));
 const custom=createFalProvider({baseUrl:'https://queue.fal.run',apiKey:'test-key',modelMap:{custom:modelMap['image.upscale:topazlabs']},fetchImpl:async()=>response({request_id:'accepted',status:'IN_QUEUE'})});
 assert.equal((await custom.submit(request('image.upscale',{modelId:'custom',provider:'topazlabs',scale:4}))).status,'queued');
 assert.throws(()=>custom.prepare(request()),{code:'configuration_required'});
 assert.throws(()=>p.prepare(request('image.upscale',{modelId:'missing',provider:'topazlabs',scale:2})),{code:'configuration_required'});
 assert.throws(()=>p.prepare(request('image.upscale',{providerParameters:{model:'image.upscale:topazlabs'},modelId:'other',provider:'topazlabs',scale:2})));
});
test('background removal sends transparent PNG options and treats dimensions as canvas metadata',async()=>{
 let body;const p=provider(async(_url,options)=>{body=JSON.parse(options.body);return response({request_id:'bg-real',status:'IN_QUEUE'});});
 await p.submit({...request('image.remove-background',{width:600,height:400}),count:1});
 assert.deepEqual(body,{image_url:png,output_format:'png',output_mask:false,refine_foreground:true,sync_mode:false});
 assert.throws(()=>p.prepare(request('image.remove-background',{width:0})));
});
test('source image validation rejects local URLs, bad bytes, credentials and non-image sources',()=>{
 const p=provider(()=>assert.fail());
 for(const url of ['blob:https://local.test/opaque','asset:private','http://localhost/a.png','https://127.0.0.1/a.png','https://0x7f000001/a.png','https://user:secret@public.test/a.png','data:image/png;base64,bm90LWltYWdl','data:image/svg+xml;base64,PHN2Zy8+'])assert.throws(()=>p.prepare({...request(),inputs:[{type:'image',url}]}));
 assert.doesNotThrow(()=>p.prepare({...request(),inputs:[{type:'image',url:'https://public.test/source.png'}]}));
 assert.throws(()=>p.prepare({...request(),inputs:[{type:'video',url:png}]}));
});
test('accepted identity survives provider recreation and restores original app endpoint without another POST',async()=>{
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url,method:options.method});if(options.method==='POST')return response({request_id:'accepted-real-task',status:'IN_QUEUE'});if(url.includes('/status'))return response({status:'COMPLETED',request_id:'accepted-real-task'});return response({image:{url:'https://v3.fal.media/files/result.png',content_type:'image/png',width:500,height:400}});};
 const first=provider(fetchImpl),accepted=await first.submit(request()),restarted=provider(fetchImpl),result=await restarted.poll(accepted.id);
 assert.equal(result.id,accepted.id);assert.equal(result.status,'succeeded');
 assert.deepEqual(result.outputs,[{type:'image',url:'https://v3.fal.media/files/result.png',mimeType:'image/png',sourceFileId:'accepted-real-task',width:500,height:400}]);
 assert.deepEqual(calls.map(call=>call.url),['https://queue.fal.run/fal-ai/topaz/upscale/image','https://queue.fal.run/fal-ai/topaz/requests/accepted-real-task/status?logs=0','https://queue.fal.run/fal-ai/topaz/requests/accepted-real-task']);
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(first.fingerprint,restarted.fingerprint);
 const rotated=createFalProvider({baseUrl:'https://queue.fal.run',apiKey:'rotated-test-key',modelMap});assert.equal(rotated.fingerprint,first.fingerprint);
});
test('Topaz result without actual dimensions does not invent multiplied sizes',async()=>{
 const p=provider(async(url,options)=>options.method==='POST'?response({request_id:'task',status:'IN_QUEUE'}):url.includes('/status')?response({status:'COMPLETED'}):response({image:{url:'https://v3.fal.media/result.png'}}));
 const result=await p.poll((await p.submit(request())).id);assert.equal(result.outputs[0].width,undefined);assert.equal(result.outputs[0].height,undefined);
});
test('wrong task identity and malformed output stay unconfirmed and never resubmit',async()=>{
 for(const output of [{image:{url:'blob:fake'}},{image:{url:'https://user:secret@v3.fal.media/result.png'}},{image:{url:'https://v3.fal.media/result.png',width:0}},{images:[{url:'https://v3.fal.media/result.png'}]}]){
  let posts=0;const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response({request_id:'task',status:'IN_QUEUE'});}return response(url.includes('/status')?{status:'COMPLETED'}:output);});const receipt=await p.submit(request());await assert.rejects(()=>p.poll(receipt.id),{code:'unknown'});assert.equal(posts,1);
 }
 const p=provider(async(_url,options)=>response(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:{status:'COMPLETED',request_id:'different'}));const accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id));await assert.rejects(()=>p.poll('fl1.invalid'),{code:'provider_identity_mismatch'});
});
test('uncertain POST is sent once, while cancellation acceptance never claims remote execution stopped',async()=>{
 let posts=0;const lost=provider(async()=>{posts++;throw Error('private network detail');});await assert.rejects(()=>lost.generate(request()),{code:'unknown'});assert.equal(posts,1);
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return response(options.method==='POST'?{request_id:'task',status:'IN_QUEUE'}:{status:'CANCELLATION_REQUESTED'},options.method==='PUT'?202:200);});const accepted=await p.submit(request());assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(calls[1].method,'PUT');assert.ok(calls[1].url.endsWith('/fal-ai/topaz/requests/task/cancel'));
});
test('generate uses one accepted task and returns only after successful result retrieval',async()=>{
 let posts=0,gets=0;const identities=[],p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response({request_id:'loop-task',status:'IN_QUEUE'});}if(url.includes('/status')){gets++;return response({status:gets===1?'IN_PROGRESS':'COMPLETED'});}return response({image:{url:'https://v3.fal.media/result.png'}});});
 const result=await p.generate(request(),{pollInterval:1,onTaskIdentity:id=>identities.push(id)});assert.equal(result.status,'succeeded');assert.equal(posts,1);assert.equal(identities.length,1);assert.equal(result.id,identities[0]);
});
