'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createGenerationGateway}=require('../server/generation.cjs');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S4sAAAAASUVORK5CYII=';
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
test('production gateway persists actual inline bytes and publishes only immutable local IDs across restart',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-media-gateway-')),tasks=path.join(directory,'tasks');let posts=0;
 const fetchImpl=async(_url,options)=>{assert.equal(options.method,'POST');posts++;return {ok:true,json:async()=>({status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,'+PNG,fullImage:'data:image/png;base64,'+PNG,title:'实际PNG'}]})};};
 let gateway=createGenerationGateway({directory:tasks,baseUrl:'https://provider.example.test',apiKey:'private-key',fetchImpl});await gateway.ready;
 const body=async req=>{let content='';for await(const chunk of req)content+=chunk;return JSON.parse(content);};
 const server=http.createServer(async(req,res)=>{try{await gateway.handle(req,res,new URL(req.url,'http://localhost').pathname,{json,body});}catch(error){json(res,400,{code:error.code,error:'fixture failure'});}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 let response=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'gateway-fixture-media'},body:JSON.stringify({kind:'image.generate',prompt:'图片'})});assert.equal(response.status,202);let job=await response.json();
 for(let i=0;i<10&&job.status!=='succeeded';i++){response=await fetch(base+'/api/generation/tasks/'+job.id);job=await response.json();}
 assert.equal(job.status,'succeeded');assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);assert.equal(job.outputs[0].fullImage,job.outputs[0].url);assert.equal(job.providerStatus,'succeeded');assert.equal(job.localization.state,'ready');assert.ok(!JSON.stringify(job).includes(PNG));assert.equal(job.providerResult,undefined);
 const mediaUrl=job.outputs[0].url;response=await fetch(base+mediaUrl);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(PNG,'base64'));
 await gateway.close();gateway=createGenerationGateway({directory:tasks,baseUrl:'https://provider.example.test',apiKey:'rotated-key',fetchImpl:()=>assert.fail('recovery must not generate or poll')});await gateway.ready;
 response=await fetch(base+'/api/generation/tasks/by-key/gateway-fixture-media');const restored=await response.json();assert.equal(restored.status,'succeeded');assert.equal(restored.outputs[0].url,mediaUrl);assert.equal(posts,1);response=await fetch(base+mediaUrl,{headers:{Range:'bytes=0-7'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(PNG,'base64').subarray(0,8));
 const lostId=mediaUrl.split('/').at(-1);await gateway.close();await fs.unlink(path.join(directory,'tasks-media',lostId+'.bin'));
 gateway=createGenerationGateway({directory:tasks,baseUrl:'https://provider.example.test',apiKey:'rotated-key',fetchImpl:()=>assert.fail('missing media must not regenerate or poll')});await gateway.ready;
 response=await fetch(base+'/api/generation/tasks/'+job.id);const repaired=await response.json();assert.equal(repaired.status,'succeeded');assert.equal(repaired.localization.revision,1);assert.notEqual(repaired.outputs[0].url,mediaUrl);response=await fetch(base+repaired.outputs[0].url);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(PNG,'base64'));assert.equal(posts,1);
 const privateRecord=await fs.readFile(path.join(tasks,job.id+'.json'),'utf8');assert.ok(privateRecord.includes(PNG));assert.ok(!privateRecord.includes('private-key'));assert.ok(!privateRecord.includes('rotated-key'));
});
test('signed provider result stays private while gateway publicJob exposes only local media fields',async t=>{
 const {Readable}=require('node:stream'),{createGenerationMediaStore}=require('../server/generation-media-store.cjs'),{createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-signed-gateway-')),mediaStore=createGenerationMediaStore({directory:path.join(directory,'media'),maxBytes:256*1024*1024}),sources=[];
 const mediaMaterializer=createGenerationMediaMaterializer({store:mediaStore,download:async descriptor=>{sources.push(descriptor);return {mime:'image/png',format:'png',stream:Readable.from([Buffer.from(PNG,'base64')]),maxBytes:100*1024*1024};}});
 let posts=0;const url='https://cdn.example.test/image.png?signature=never-public';
 const gateway=createGenerationGateway({directory:path.join(directory,'tasks'),mediaStore,mediaMaterializer,baseUrl:'https://provider.example.test',apiKey:'private-key',fetchImpl:async(_url,options)=>{posts++;assert.equal(options.method,'POST');return {ok:true,json:async()=>({status:'succeeded',outputs:[{type:'image',url,fullImage:url,sourceUrl:url,mime:'image/png',title:'输出'}]})};}});await gateway.ready;
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 let exposed;const capture=(_res,status,data)=>{assert.ok([200,202].includes(status));exposed=data;};await gateway.handle({method:'POST',headers:{'idempotency-key':'signed-gateway-fixture'}},{},'/api/generation/tasks',{json:capture,body:async()=>({kind:'image.generate',prompt:'signed output'})});
 const id=exposed.id;await gateway.handle({method:'GET',headers:{}},{},'/api/generation/tasks/'+id,{json:capture,body:async()=>({})});
 assert.equal(exposed.status,'succeeded');assert.equal(exposed.outputs[0].fullImage,exposed.outputs[0].url);assert.equal(exposed.outputs[0].sourceUrl,exposed.outputs[0].url);assert.equal(exposed.outputs[0].mime,'image/png');assert.ok(!JSON.stringify(exposed).includes('signature'));assert.equal(exposed.providerResult,undefined);assert.equal(exposed.localization.resources,undefined);assert.deepEqual(sources,[url]);assert.equal(posts,1);
 const record=JSON.parse(await fs.readFile(path.join(directory,'tasks',id+'.json'),'utf8'));assert.equal(record.providerResult.outputs[0].url,url);
});
