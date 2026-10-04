'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFalProvider}=require('../server/generation-fal.cjs');
const endpoint='fal-ai/qwen-image-edit-2511-multiple-angles';
const modelMap={'image.multiAngle':{kind:'image.multiAngle',model:endpoint}};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const defaults={rotate_right_left:30,move_forward:0,vertical_angle:.5,wide_angle_lens:false};
const request=(parameters={})=>({kind:'image.multiAngle',prompt:'',inputs:[{type:'image',url:png}],parameters:{...defaults,...parameters}});
const provider=(fetchImpl,options={})=>createFalProvider({apiKey:'fixture-only-key',modelMap,fetchImpl,...options});
const response=value=>Response.json(value);

test('default multi-angle alias agrees across frontend readiness, router and direct metadata',async()=>{
 const {createGenerationRouter}=require('../server/generation-router.cjs');
 const ui=await import('../src/features/node-composer/provider-configuration.mjs');
 const providers={fal:{protocol:'fal-native',apiKey:'fixture-only-key',modelMap}};
 const router=createGenerationRouter({providers,routes:{'image.multiAngle':{models:{'image.multiAngle':'fal'}}},fetchImpl:()=>assert.fail('readiness must not dispatch')});
 for(const input of [request(),{kind:'image.multiAngle'}]){
  assert.equal(ui.requestModelAlias(input),'image.multiAngle');
  assert.equal(ui.providerConfigured(router.metadata,input),true);
  assert.equal(router.protocolFor(input),'fal-native');
  assert.equal(ui.providerConfigured(router.metadata.providers.fal,input),true);
 }
 const unavailable={...request(),parameters:{...defaults,modelId:'another'}};
 assert.equal(ui.providerConfigured(router.metadata,unavailable),false);
 assert.equal(router.protocolFor(unavailable),null);
 assert.equal(ui.providerConfigured(router.metadata,{kind:'image.relight'}),false);
});

test('multi-angle native alternative requires the exact opt-in alias, kind and endpoint',()=>{
 const p=provider(()=>assert.fail('configuration must not dispatch'));
 assert.equal(p.configured,true);assert.deepEqual(p.metadata.capabilities.multiAngle,{semantics:'explicit-native-alternative',label:'Qwen 2511 Multiple Angles',tiltRange:[-2/3,1],wideAngle:false});
 assert.deepEqual(p.metadata.capabilities.models,{'image.multiAngle':{kind:'image.multiAngle'}});
 for(const entry of [
  {alias:{kind:'image.multiAngle',model:endpoint}},
  {'image.multiAngle':{kind:'image.multiAngle',model:'fal-ai/qwen-image-edit-plus'}},
  {'image.multiAngle':{kind:'image.upscale',model:endpoint}},
  {'image.multiAngle':{kind:'image.multiAngle',model:endpoint,conversion:'tapnow'}},
 ]){const invalid=provider(()=>assert.fail(),{modelMap:entry});assert.equal(invalid.configured,false);assert.equal(invalid.metadata.configurationError,'configuration_invalid');}
 const existing=provider(()=>assert.fail(),{modelMap:{'image.remove-background':{kind:'image.remove-background',model:'fal-ai/birefnet'}}});
 assert.equal(existing.metadata.capabilities.multiAngle,undefined);assert.throws(()=>existing.prepare(request()),{code:'configuration_required'});
 for(const secret of ['fixture-only-key',endpoint,'queue.fal.run'])assert.ok(!JSON.stringify(p.metadata).includes(secret));
});

test('signed azimuth and preview tilt map explicitly; zoom endpoints and original source bytes are retained',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({request_id:'angle-task',status:'IN_QUEUE'});});
 for(const [rotation,azimuth,tilt,elevation,zoom]of [[-90,270,-2/3,-30,0],[-30,330,.5,22.5,5],[0,0,0,0,10],[90,90,1,45,2.75]]){
  const input=request({rotate_right_left:rotation,vertical_angle:tilt,move_forward:zoom}),before=structuredClone(input);
  await p.submit(input);assert.deepEqual(input,before);
  assert.equal(calls.at(-1).url,'https://queue.fal.run/'+endpoint);
  assert.deepEqual(calls.at(-1).body,{image_urls:[png],output_format:'png',num_images:1,sync_mode:false,horizontal_angle:azimuth,vertical_angle:elevation,zoom});
 }
});

test('unsupported lens, out-of-range/non-finite/missing settings and extra controls all reject before POST',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail('invalid settings must not dispatch');});
 const invalid=[{wide_angle_lens:true},{wide_angle_lens:0},{rotate_right_left:-90.01},{rotate_right_left:90.01},{move_forward:-.01},{move_forward:10.01},{vertical_angle:-2/3-.000001},{vertical_angle:1.001},{vertical_angle:NaN},{vertical_angle:Infinity},{rotate_right_left:'30'},{move_forward:true},{prompt:'different scene'},{additional_prompt:'guess'},{horizontal_angle:30},{width:1024},{providerParameters:{horizontal_angle:30}}];
 for(const parameters of invalid)await assert.rejects(()=>p.submit(request(parameters)),error=>error.providerDispatched===false);
 for(const key of Object.keys(defaults)){const input=request();delete input.parameters[key];assert.throws(()=>p.prepare(input),error=>error.providerDispatched===false);}
 assert.equal(calls,0);
});

test('only one bound source and one output may be requested, without added prompt or contradictory identity',()=>{
 const p=provider(()=>assert.fail());
 for(const input of [
  {...request(),count:2},request({count:2}),request({times:2}),request({batch_count:2}),request({canvasResults:{targetNodeIds:['a','b']}}),
  {...request(),inputs:[]},{...request(),inputs:[...request().inputs,...request().inputs]},
  {...request(),references:[{type:'image',url:png}]},{...request(),prompt:'rotate and change costume'},
  request({modelId:'another'}),request({providerParameters:{model:'image.multiAngle'},model:'another'}),
 ])assert.throws(()=>p.prepare(input));
 assert.doesNotThrow(()=>p.prepare(request({modelId:'image.multiAngle',count:1,times:1})));
});

test('native alternative retains the existing image byte and public URL boundary',()=>{
 const p=provider(()=>assert.fail());
 for(const url of ['asset:private','blob:https://local.test/id','https://localhost/source.png','https://0x7f000001/source.png','https://user:password@public.test/source.png','data:image/png;base64,YQ==','data:image/svg+xml;base64,PHN2Zy8+'])assert.throws(()=>p.prepare({...request(),inputs:[{type:'image',url}]}));
 assert.throws(()=>p.prepare({...request(),inputs:[{type:'video',url:png}]}));
 assert.doesNotThrow(()=>p.prepare({...request(),inputs:[{type:'image',url:'https://public.test/source.png'}]}));
});

test('original model/kind envelope restores after recreation with no second POST and no invented dimensions',async()=>{
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url,method:options.method});if(options.method==='POST')return response({request_id:'original-angle',status:'IN_QUEUE'});if(url.includes('/status'))return response({request_id:'original-angle',status:'COMPLETED'});return response({images:[{url:'https://v3.fal.media/angle.png',content_type:'image/png'}],seed:123,prompt:'constructed provider prompt'});};
 const first=provider(fetchImpl),accepted=await first.submit(request()),restarted=provider(fetchImpl,{apiKey:'rotated-fixture-key'}),result=await restarted.poll(accepted.id);
 assert.equal(first.fingerprint,restarted.fingerprint);assert.equal(result.id,accepted.id);assert.equal(result.status,'succeeded');
 assert.deepEqual(result.outputs,[{type:'image',url:'https://v3.fal.media/angle.png',mimeType:'image/png',sourceFileId:'original-angle'}]);
 assert.deepEqual(calls.map(c=>c.url),['https://queue.fal.run/'+endpoint,'https://queue.fal.run/'+endpoint+'/requests/original-angle/status?logs=0','https://queue.fal.run/'+endpoint+'/requests/original-angle']);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('result cardinality, content, dimensions and task mismatch remain unknown without resubmission',async()=>{
 for(const output of [
  {image:{url:'https://v3.fal.media/angle.png'}},{images:[]},{images:[{url:'https://v3.fal.media/a.png'},{url:'https://v3.fal.media/b.png'}]},
  {images:[{url:'blob:fake'}]},{images:[{url:'https://v3.fal.media/a.png',content_type:'application/json'}]},
  {images:[{url:'https://v3.fal.media/a.png',width:0}]},{images:[{url:'https://v3.fal.media/a.png',height:1.5}]},
 ]){
  let posts=0;const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response({request_id:'original',status:'IN_QUEUE'});}return response(url.includes('/status')?{status:'COMPLETED',request_id:'original'}:output);});
  const accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});assert.equal(posts,1);
 }
 const p=provider(async(_url,options)=>response(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:{request_id:'different',status:'COMPLETED'}));
 const accepted=await p.submit(request());
 await assert.rejects(()=>p.poll(accepted.id),{code:'provider_identity_mismatch'});
});

test('forged kind/model pairing and removed original mapping reject recovery before HTTP',async()=>{
 const accepted=await provider(async()=>response({request_id:'original',status:'IN_QUEUE'})).submit(request());
 const p=provider(()=>assert.fail('invalid identities must not query'));
 for(const triple of [[endpoint,'original','image.upscale'],['fal-ai/topaz/upscale/image','original','image.multiAngle'],['fal-ai/qwen-image-edit-plus','original','image.multiAngle']])await assert.rejects(()=>p.poll('fl1.'+Buffer.from(JSON.stringify(triple)).toString('base64url')),{code:'provider_identity_mismatch'});
 const removed=provider(()=>assert.fail(),{modelMap:{'image.remove-background':{kind:'image.remove-background',model:'fal-ai/birefnet'}}});
 await assert.rejects(()=>removed.poll(accepted.id),{code:'provider_configuration_changed'});
});

test('cancellation uses the original specialized endpoint and does not promise the model stopped',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return new Response(JSON.stringify(options.method==='POST'?{request_id:'original',status:'IN_QUEUE'}:{status:'CANCELLATION_REQUESTED'}),{status:options.method==='PUT'?202:200,headers:{'content-type':'application/json'}});});
 const accepted=await p.submit(request());assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});
 assert.deepEqual(calls[1],{url:'https://queue.fal.run/'+endpoint+'/requests/original/cancel',method:'PUT'});
});

test('an uncertain native POST remains one attempt',async()=>{
 let posts=0;const p=provider(async()=>{posts++;throw Error('fixture network interruption');});
 await assert.rejects(()=>p.generate(request()),{code:'unknown'});assert.equal(posts,1);
});

test('loopback gateway archives real PNG bytes after unknown recovery of the original multi-angle task',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{Readable}=require('node:stream');
 const {createGenerationGateway}=require('../server/generation.cjs');
 const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
 const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
 const ui=await import('../src/features/node-composer/provider-configuration.mjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-angle-loopback-'));
 const bytes=Buffer.from(png.slice(png.indexOf(',')+1),'base64'),calls=[];let complete=false,downloads=0,gateway;
 const providers={fal:{protocol:'fal-native',apiKey:'fixture-only-key',modelMap}};
 const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});
  assert.equal(new Headers(options.headers).get('authorization'),'Key fixture-only-key');
  if(options.method==='POST')return response({request_id:'original-angle-loopback',status:'IN_QUEUE'});
  if(String(url).includes('/status'))return response({request_id:'original-angle-loopback',status:complete?'COMPLETED':'UNCONFIRMED'});
  return response({images:[{url:'https://v3.fal.media/angle-loopback.png',content_type:'image/png',width:1,height:1}]});
 };
 function open(routes={'image.multiAngle':{models:{'image.multiAngle':'fal'}}}){
  const store=createGenerationMediaStore({directory:directory+'-media'});
  const materializer=createGenerationMediaMaterializer({store,download:async(source,{kind,onBytes})=>{
   assert.equal(source,'https://v3.fal.media/angle-loopback.png');assert.equal(kind,'image');downloads++;onBytes(bytes.length);
   return {stream:Readable.from([bytes]),mime:'image/png',maxBytes:bytes.length,expectedBytes:bytes.length};
  }});
  return createGenerationGateway({directory,providers,routes,fetchImpl,mediaStore:store,mediaMaterializer:materializer});
 }
 gateway=open();
 const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 const server=http.createServer((req,res)=>{
  void gateway.handle(req,res,new URL(req.url,'http://localhost').pathname,{json,body:async()=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));}}).catch(()=>json(res,500,{error:'fixture gateway error'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});await fs.rm(directory+'-media',{recursive:true,force:true});});
 const config=await (await fetch(base+'/api/generation/config')).json();
 assert.equal(ui.providerConfigured(config,request()),true);
 const created=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'angle-loopback-key'},body:JSON.stringify(request())});
 assert.equal(created.status,202);const accepted=await created.json();
 let unknown;
 for(let i=0;i<50;i++){
  unknown=await (await fetch(base+'/api/generation/tasks/'+accepted.id)).json();
  if(unknown.status==='unknown')break;
  await new Promise(resolve=>setTimeout(resolve,3));
 }
 assert.equal(unknown.status,'unknown');assert.equal(unknown.outputs,undefined);
 for(let i=0;i<2;i++)assert.equal((await (await fetch(base+'/api/generation/tasks/by-key/angle-loopback-key')).json()).status,'unknown');
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(downloads,0);
 await gateway.close();complete=true;gateway=open({});
 const recovered=await (await fetch(base+'/api/generation/tasks/by-key/angle-loopback-key')).json();
 assert.equal(recovered.id,accepted.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.localization.state,'ready');
 assert.equal(recovered.outputs.length,1);assert.match(recovered.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);
 assert.ok(!JSON.stringify(recovered.outputs).includes('fal.media'));assert.equal(downloads,1);
 const local=await fetch(base+recovered.outputs[0].url);assert.equal(local.status,200);assert.equal(local.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await local.arrayBuffer()),bytes);
 assert.deepEqual(await fs.readFile(path.join(directory+'-media',recovered.outputs[0].url.split('/').at(-1)+'.bin')),bytes);
 assert.equal(calls.filter(call=>call.method==='POST').length,1);
 assert.deepEqual(calls[0],{url:'https://queue.fal.run/'+endpoint,method:'POST',body:{image_urls:[png],output_format:'png',num_images:1,sync_mode:false,horizontal_angle:30,vertical_angle:22.5,zoom:0}});
 assert.ok(calls.slice(1).every(call=>call.url.startsWith('https://queue.fal.run/'+endpoint+'/requests/original-angle-loopback')));
});
