'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {assertIndependentMediaInputs}=require('../server/generation-endpoint-policy.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const original='https://files.TAPNOW.MEDIA.../source.png';
const request={kind:'image.remove-background',inputs:[{type:'image',url:original}],parameters:{model:'fixture'}};
const memoryStore=()=>{const data=new Map();return {data,readAll:async()=>[...data.values()].map(v=>structuredClone(v)),write:async v=>data.set(v.id,structuredClone(v))};};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const body=async req=>{let value='';for await(const chunk of req)value+=chunk;return JSON.parse(value);};

test('explicit media slots reject all original aliases, case, trailing dots, subdomains and protocol-relative URLs',()=>{
 for(const host of ['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app']){
  for(const url of ['https://'+host+'/a','https://sub.'+host.toUpperCase()+'.../a','//'+host+'/a','/\\'+host+'/a'])assert.throws(()=>assertIndependentMediaInputs({inputs:[{type:'video',url}]}),{code:'original_service_blocked',providerDispatched:false},url);
 }
 for(const slot of [
  {inputs:[{type:'image',fullImage:original}]},{inputs:[{type:'video',poster:original}]},{inputs:[{type:'audio',sourceUrl:original}]},
  {references:[{type:'image',url:original}]},{references:[original]},
  {parameters:{refs:[original]}},{parameters:{subjects:[{assets:[{type:'image',url:original}]}]}},
  {parameters:{draftEstimateMedia:{videos:[original]}}}
 ])assert.throws(()=>assertIndependentMediaInputs(slot),{code:'original_service_blocked'});
});

test('independent/local inputs and original URLs as plain text are preserved byte-for-byte',()=>{
 const value={kind:'text.generate',prompt:'说明 '+original,metadata:{url:original},inputs:[{type:'text',text:original,url:original},...[
  'https://tapnow.media.operator.example/source.png','https://independent.example/image.png','/assets/image.png',
  '/api/generation/media/00000000-0000-4000-8000-000000000001','asset:local','blob:http://localhost/id','data:image/png;base64,YQ=='
 ].map(url=>({type:'image',url}))],parameters:{model:original,extra:{url:original}}};
 const snapshot=structuredClone(value);assert.equal(assertIndependentMediaInputs(value),value);assert.deepEqual(value,snapshot);
});

test('durable input rejection happens before preparation, provider.prepare, provider.submit and storage',async()=>{
 const store=memoryStore();let preparation=0,prepare=0,submit=0;
 const service=createDurableGenerationService({store,provider:{configured:true,fingerprint:'native',prepare(){prepare++;},submit(){submit++;assert.fail();}},prepareRequest:async value=>{preparation++;return value;}});
 try{await assert.rejects(service.submit(request,{idempotencyKey:'media-isolation-direct'}),{code:'original_service_blocked'});assert.deepEqual({preparation,prepare,submit,records:store.data.size},{preparation:0,prepare:0,submit:0,records:0});}finally{await service.close();}
});

test('scheme-bearing original URLs cannot be reinterpreted as local paths before native prepare or tasks-v1 POST',async()=>{
 const urls=['http:tapnow.media/image.png','http:/tapnow.media/image.png','http:\\tapnow.media/image.png','https:tapnow.media/image.png','https:/SUB.TAPNOW.AI../image.png'];
 for(const native of [false,true]){
  const store=memoryStore();let prepare=0,post=0;
  const service=createDurableGenerationService({store,baseUrl:'https://independent.example',apiKey:'fixture-only',
   fetchImpl:async()=>{post++;assert.fail('tasks-v1 POST must not run');},
   ...(native?{provider:{configured:true,fingerprint:'native',prepare(){prepare++;},submit:async()=>{post++;assert.fail('native submit must not run');}}}:{})});
  try{for(const [index,url]of urls.entries()){
   assert.equal(new URL(url).hostname.toLowerCase().replace(/\.+$/,''),url.includes('SUB.')?'sub.tapnow.ai':'tapnow.media');
   await assert.rejects(service.submit({...request,inputs:[{type:'image',url}]},{idempotencyKey:'media-scheme-'+native+'-'+index}),{code:'original_service_blocked',providerDispatched:false});
  }assert.deepEqual({prepare,post,records:store.data.size},{prepare:0,post:0,records:0});}finally{await service.close();}
 }
});

test('prepared input is checked before provider.prepare and submit; original text-only output still succeeds',async()=>{
 const store=memoryStore();let prepare=0,submit=0;
 const provider={configured:true,fingerprint:'native',prepare(){prepare++;},poll:()=>assert.fail('completed fixture never polls'),submit:async()=>{submit++;return {status:'succeeded',outputs:[{type:'text',text:original}]};}};
 const service=createDurableGenerationService({store,provider,prepareRequest:async value=>({...value,inputs:[{type:'image',url:original}]})});
 try{const created=await service.submit({kind:'image.generate',prompt:'normal'},{idempotencyKey:'media-isolation-derived'}),job=await service.get(created.id);assert.equal(job.status,'failed');assert.deepEqual({prepare,submit},{prepare:0,submit:0});}finally{await service.close();}
 const allowed=createDurableGenerationService({store:memoryStore(),provider});
 try{const value={kind:'text.generate',prompt:original,inputs:[{type:'text',text:original}]},created=await allowed.submit(value,{idempotencyKey:'media-isolation-text'});assert.equal((await allowed.get(created.id)).status,'succeeded');assert.deepEqual({prepare,submit},{prepare:1,submit:1});}finally{await allowed.close();}
});

test('restored original media request can be inspected but cannot be dispatched with a fresh key',async()=>{
 const store=memoryStore();let calls=0,service=createDurableGenerationService({store,baseUrl:'https://supplier.example',apiKey:'fixture-only',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({id:'old-provider',status:'running'})};}});
 const valid={...request,inputs:[{type:'image',url:'https://supplier.example/source.png'}]},created=await service.submit(valid,{idempotencyKey:'media-isolation-history'});await service.get(created.id);await service.close();
 const saved=store.data.get(created.id),{createHash}=require('node:crypto');
 const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 saved.request=request;saved.requestHash=createHash('sha256').update(canonical(request)).digest('hex');saved.preparedRequest=request;saved.status='failed';saved.submissionState='queued';delete saved.providerTaskId;store.data.set(saved.id,saved);
 service=createDurableGenerationService({store,baseUrl:'https://supplier.example',apiKey:'fixture-only',fetchImpl:()=>assert.fail('restored original media must not dispatch')});
 try{const restored=await service.lookup('media-isolation-history');assert.equal(restored.request.inputs[0].url,original);await assert.rejects(service.submit(restored.request,{idempotencyKey:'media-isolation-history-retry'}),{code:'original_service_blocked'});assert.equal(calls,1);}finally{await service.close();}
});

test('real local HTTP tasks-v1 gateway rejects original media without supplier POST and preserves allowed body across restart',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-input-isolation-')),sent=[];
 const options={directory:path.join(directory,'tasks'),baseUrl:'https://independent-supplier.example/api',apiKey:'fixture-only',fetchImpl:async(url,options)=>{sent.push({url,body:JSON.parse(options.body),method:options.method});return {ok:true,json:async()=>({status:'succeeded',outputs:[{type:'text',text:'local fixture result'}]})};}};
 let gateway=createGenerationGateway(options);await gateway.ready;
 const server=http.createServer(async(req,res)=>{try{await gateway.handle(req,res,new URL(req.url,'http://localhost').pathname,{json,body});}catch(error){json(res,error.status||400,{code:error.code,providerDispatched:error.providerDispatched});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const post=(value,key)=>fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(value)});
 let response=await post(request,'http-isolation-forbidden');assert.equal(response.status,400);assert.deepEqual(await response.json(),{code:'original_service_blocked',providerDispatched:false});assert.equal(sent.length,0);
 const allowed={...request,prompt:original,inputs:[{type:'image',url:'https://independent.example/source.png'}]};response=await post(allowed,'http-isolation-allowed');assert.equal(response.status,202);const created=await response.json();
 response=await fetch(base+'/api/generation/tasks/'+created.id);assert.equal((await response.json()).status,'succeeded');assert.equal(sent.length,1);assert.equal(sent[0].url,'https://independent-supplier.example/api/tasks');assert.deepEqual(sent[0].body,allowed);
 await gateway.close();gateway=createGenerationGateway(options);await gateway.ready;
 response=await post(request,'http-isolation-forbidden-restart');assert.equal(response.status,400);assert.equal(sent.length,1);
 response=await fetch(base+'/api/generation/tasks/by-key/http-isolation-allowed');assert.equal((await response.json()).status,'succeeded');assert.equal(sent.length,1);
});
