'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {readGenerationRoutingConfig}=require('../server/generation-routing-config.cjs');
const {encodeRGBA,decodePNG}=require('../server/generation-png-alpha.cjs');
const key='synthetic-magnific-integration-key',remoteId='d6d99924-caaa-43a4-b87c-88c5326209d6',alias='image.upscale:magnific';
const source=encodeRGBA(13,9,Buffer.alloc(13*9*4,241)),result=encodeRGBA(21,15,Buffer.alloc(21*15*4,211));
const mediaUrl='https://magnific-integration.example.test/original-result.png';
const dataUri=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const request=()=>({kind:'image.upscale',nodeId:'target',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:dataUri(source),width:13,height:9}],parameters:{provider:'magnific',scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30}});
const direct=()=>({protocol:'magnific-native',apiKey:key,modelMap:{[alias]:{kind:'image.upscale',model:'magnific-v2'}}});
const routed=()=>({providers:{magnific:direct()},routes:{'image.upscale':{models:{[alias]:'magnific'}}}});
const complete=()=>({data:{task_id:remoteId,status:'COMPLETED',generated:[mediaUrl]}});
function apiTransport(calls,{immediate=false}={}){return async(url,options)=>{
 calls.push({url:String(url),method:options.method});assert.equal(new Headers(options.headers).get('x-magnific-api-key'),key);assert.equal(options.redirect,'error');
 if(options.method==='POST'){
  assert.equal(String(url),'https://api.magnific.com/v1/ai/image-upscaler-precision-v2');
  assert.deepEqual(JSON.parse(options.body),{image:source.toString('base64'),scale_factor:2,sharpen:7,smart_grain:7,ultra_detail:30});
  return Response.json(immediate?complete():{data:{task_id:remoteId,status:'CREATED',generated:[]}});
 }
 assert.equal(options.method,'GET');assert.equal(String(url),'https://api.magnific.com/v1/ai/image-upscaler-precision-v2/'+remoteId);return Response.json(complete());
};}
function mediaTransport(calls,bytesFor=()=>result){return async(url,options)=>{
 assert.equal(url,mediaUrl);assert.equal(options.kind,'image');assert.equal(options.headers,undefined);calls.push(url);const bytes=bytesFor();
 return {mime:'image/png',expectedBytes:bytes.length,stream:(async function*(){yield bytes;})(),close(){}};
};}
async function harness(t,configuration,fetchImpl,magnificDownloadImpl){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-magnific-integration-'));let gateway;
 const server=http.createServer(async(req,res)=>{
  try{await gateway.handle(req,res,new URL(req.url,'http://localhost').pathname,{
   json:(out,status,value)=>{out.writeHead(status,{'Content-Type':'application/json'});out.end(JSON.stringify(value));},
   body:async incoming=>{const parts=[];for await(const part of incoming)parts.push(part);return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
  });}catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:error.code,error:'Magnific integration fixture rejected request'}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 async function open(){gateway=createGenerationGateway({...configuration,directory:path.join(directory,'tasks'),localPort:server.address().port,fetchImpl,magnificDownloadImpl});await gateway.ready;}
 await open();t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 async function get(route){const response=await fetch(origin+route);assert.equal(response.status,200);return response.json();}
 async function submit(idempotencyKey){const response=await fetch(origin+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(request())});assert.equal(response.status,202);return response.json();}
 async function settle(id){for(let i=0;i<100;i++){const value=await get('/api/generation/tasks/'+id);if(!['queued','running'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('Magnific durable fixture did not settle');}
 return {origin,directory,get,submit,settle,async restart(){await gateway.close();await open();},record:id=>fs.readFile(path.join(directory,'tasks',id+'.json'),'utf8').then(JSON.parse)};
}

test('direct and routed Magnific gateway metadata retain official model and precise readiness without network',async t=>{
 const {providerConfigurationStatus,resolveProviderConfiguration,generationOperationReadiness}=await import('../src/features/node-composer/provider-configuration.mjs');
 const {magnificRequestState}=await import('../src/features/image-upscale/native-profile.mjs');
 for(const configuration of [direct(),routed()]){
  const local=await harness(t,configuration,()=>assert.fail('metadata cannot request vendor API'),()=>assert.fail('metadata cannot download media'));
  const metadata=await local.get('/api/generation/config'),selected=resolveProviderConfiguration(metadata,request());
  assert.equal(metadata.configured,true);assert.equal(selected.protocol,'magnific-native');assert.equal(selected.capabilities.models[alias].model,'magnific-v2');
  assert.equal(providerConfigurationStatus(metadata,request()).configured,true);assert.equal(magnificRequestState(metadata,request()).ready,true);
  const row=generationOperationReadiness(metadata).find(value=>value.kind==='image.upscale');assert.equal(row.state,'ready');assert.equal(row.configured,true);
  assert.equal(providerConfigurationStatus(metadata,{...request(),parameters:{provider:'topazlabs'}}).configured,false);
  assert.equal(providerConfigurationStatus(metadata,{kind:'image.skin',parameters:{mode:'detailed'}}).configured,false);
  assert.equal(JSON.stringify(metadata).includes(key),false);assert.equal(JSON.stringify(metadata).includes('magnificDownloadImpl'),false);
 }
});

test('direct and routed durable gateways archive complete decoded PNG and serve original bytes after restart with one POST',async t=>{
 for(const [mode,configuration]of [['direct',direct()],['routed',routed()]]){
  const apiCalls=[],mediaCalls=[],local=await harness(t,configuration,apiTransport(apiCalls),mediaTransport(mediaCalls)),idempotencyKey='magnific-archive-'+mode;
  const created=await local.submit(idempotencyKey),done=await local.settle(created.id);assert.equal(done.status,'succeeded');assert.equal(done.providerStatus,'succeeded');assert.equal(done.localization.state,'ready');
  assert.equal(done.outputs.length,1);assert.deepEqual([done.outputs[0].width,done.outputs[0].height],[21,15]);assert.equal(done.outputs[0].mime,'image/png');assert.match(done.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);
  const downloaded=await fetch(local.origin+done.outputs[0].url);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/png');const saved=Buffer.from(await downloaded.arrayBuffer());assert.deepEqual(saved,result);assert.deepEqual(decodePNG(saved).pixels,decodePNG(result).pixels);
  const record=await local.record(created.id);assert.equal(record.status,'succeeded');assert.ok(record.providerTaskId);assert.equal(record.localization.state,'ready');assert.equal(JSON.stringify(record).includes(key),false);
  const manifest=JSON.parse(await fs.readFile(path.join(local.directory,'tasks-media',done.outputs[0].url.split('/').at(-1)+'.json'),'utf8'));assert.equal(manifest.taskId,created.id);assert.equal(manifest.mime,'image/png');assert.equal(manifest.bytes,result.length);
  const counts=[apiCalls.length,mediaCalls.length];await local.restart();const restored=await local.get('/api/generation/tasks/by-key/'+idempotencyKey);assert.equal(restored.id,created.id);assert.equal(restored.status,'succeeded');assert.deepEqual(restored.outputs,done.outputs);
  const restoredMedia=await fetch(local.origin+restored.outputs[0].url);assert.equal(restoredMedia.status,200);assert.deepEqual(Buffer.from(await restoredMedia.arrayBuffer()),result);assert.deepEqual([apiCalls.length,mediaCalls.length],counts);
  assert.equal((await local.submit(idempotencyKey)).id,created.id);assert.equal(apiCalls.filter(call=>call.method==='POST').length,1);
 }
});

test('immediate broken PNG checkpoints original UUID before failure and restart queries that UUID without another POST',async t=>{
 for(const [mode,configuration]of [['direct',direct()],['routed',routed()]]){
  let repaired=false;const apiCalls=[],mediaCalls=[],local=await harness(t,configuration,apiTransport(apiCalls,{immediate:true}),mediaTransport(mediaCalls,()=>repaired?result:result.subarray(0,40))),idempotencyKey='magnific-broken-first-'+mode;
  const created=await local.submit(idempotencyKey),unknown=await local.settle(created.id);assert.equal(unknown.status,'unknown');assert.equal(unknown.outputs,undefined);assert.equal(unknown.recovery.pollable,true);assert.equal(unknown.recovery.submissionState,'accepted');
  const record=await local.record(created.id);assert.equal(record.submissionState,'accepted');assert.ok(record.providerTaskId);assert.equal(record.providerResult,undefined);
  if(mode==='direct')assert.equal(record.providerTaskId,remoteId);else{assert.match(record.providerTaskId,/^rg1\./);const identity=JSON.parse(Buffer.from(record.providerTaskId.slice(4),'base64url').toString('utf8'));assert.equal(identity[0],'magnific');assert.equal(identity[2],remoteId);}
  const mediaFiles=await fs.readdir(path.join(local.directory,'tasks-media'));assert.equal(mediaFiles.filter(name=>name.endsWith('.json')).length,0);
  assert.equal(apiCalls.filter(call=>call.method==='POST').length,1);await local.restart();repaired=true;
  const recovered=await local.settle(created.id);assert.equal(recovered.id,created.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.localization.state,'ready');assert.deepEqual([recovered.outputs[0].width,recovered.outputs[0].height],[21,15]);
  const bytes=await fetch(local.origin+recovered.outputs[0].url);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),result);
  assert.ok(apiCalls.some(call=>call.method==='GET'));assert.ok(apiCalls.filter(call=>call.method==='GET').every(call=>call.url.endsWith('/'+remoteId)));assert.equal(apiCalls.filter(call=>call.method==='POST').length,1);
  assert.equal((await local.submit(idempotencyKey)).id,created.id);assert.equal(apiCalls.filter(call=>call.method==='POST').length,1);assert.equal((await local.record(created.id)).providerTaskId,record.providerTaskId);
 }
});

test('Magnific download hook is trusted server injection and cannot enter provider JSON, environment JSON or local config POST',async t=>{
 const forbidden=()=>assert.fail('provider config must never execute a media hook');
 for(const [name,value]of [['magnificDownloadImpl',forbidden],['downloadImpl',forbidden],['magnificDownloadImpl','https://attacker.test/hook']]){
  const config=routed();config.providers.magnific[name]=value;const router=createGenerationRouter({...config,magnificDownloadImpl:forbidden,fetchImpl:forbidden});assert.equal(router.configured,false);assert.equal(router.metadata.configurationError,'configuration_invalid');
  const decoded=readGenerationRoutingConfig({GENERATION_PROVIDERS:JSON.stringify({magnific:{protocol:'magnific-native',apiKeyEnv:'MAGNIFIC_TEST_KEY',modelMap:direct().modelMap,[name]:'injected-hook'}}),GENERATION_ROUTES:JSON.stringify(routed().routes),MAGNIFIC_TEST_KEY:key});assert.equal(decoded.providers,null);assert.equal(decoded.routes,null);
 }
 const local=await harness(t,routed(),forbidden,forbidden),before=await local.get('/api/generation/config');
 for(const field of ['magnificDownloadImpl','downloadImpl']){
  const response=await fetch(local.origin+'/api/generation/config',{method:'POST',headers:{Origin:local.origin,'Content-Type':'application/json','X-Generation-Config-Token':before.csrfToken},body:JSON.stringify({baseUrl:'https://api.magnific.com',apiKey:key,[field]:'injected-hook'})});assert.equal(response.status,400);assert.equal((await response.json()).code,'configuration_invalid');
 }
 const after=await local.get('/api/generation/config');assert.equal(after.configurationId,before.configurationId);assert.equal(after.source,'environment');assert.equal(after.protocol,'routed');assert.equal(after.configured,true);
});
