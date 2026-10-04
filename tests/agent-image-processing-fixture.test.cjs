'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),fixture=fs.readFileSync(path.join(root,'qa/agent-image-processing-fixture.js'),'utf8');
function boot({throwingStorage=false,throwingFetch=false,throwingDB=false,panorama=false}={}){
 const calls=[],storageCalls=[],dbCalls=[];
 const search='?session=quota-repro'+(panorama?'&kind=panorama':''),context={URL,URLSearchParams,Response,Headers,Map,DataView,Uint8Array,Event,atob,crypto:globalThis.crypto,document:{baseURI:'http://localhost:4173/'},location:{href:'http://localhost:4173/qa/agent-image-processing-app.html'+search,origin:'http://localhost:4173',search},dispatchEvent:()=>{}};
 Object.defineProperty(context,'localStorage',{configurable:true,get:()=>{storageCalls.push('get');if(throwingStorage)throw new DOMException('storage getter denied','SecurityError');return {getItem:()=>{storageCalls.push('read');return null;},setItem:()=>{storageCalls.push('write');throw new DOMException('origin full','QuotaExceededError');},removeItem:()=>storageCalls.push('remove')};}});
 Object.defineProperty(context,'fetch',{configurable:true,get:()=>{if(throwingFetch)throw Error('fetch getter failed');return async (...args)=>{calls.push(args);return Response.json({native:true});};}});
 Object.defineProperty(context,'indexedDB',{configurable:true,get:()=>{if(throwingDB)throw Error('DB getter failed');return {open:(...args)=>{dbCalls.push(args);return {};},deleteDatabase:()=>assert.fail('must not delete origin DB')};}});
 context.window=context;vm.runInNewContext(fixture,context);
 return {context,calls,storageCalls,dbCalls};
}
test('reproduces old origin quota bootstrap failure, current fixture never reads or writes origin storage',async()=>{
 const old={localStorage:{getItem:()=>null,setItem:()=>{throw new DOMException('origin full','QuotaExceededError');}}};old.window=old;
 assert.throws(()=>vm.runInNewContext("const storage=window.localStorage; storage.setItem('qa-confirm-mode','ask');",old),{name:'QuotaExceededError'});
 for(const throwingStorage of [false,true]){
  const f=boot({throwingStorage});assert.equal(f.context.AgentImageProcessingFixture.state.preferences,'page-memory');assert.deepEqual(f.storageCalls,[]);
  f.context.localStorage.setItem('test','ok');assert.equal(f.context.localStorage.getItem('test'),'ok');
  assert.equal((await f.context.fetch('/api/agent/config')).status,200);
  await assert.rejects(f.context.fetch('/api/real-provider'),/未声明/);await assert.rejects(f.context.fetch('https://example.org/api'),/外部/);assert.equal(f.calls.length,0);
 }
});
test('bootstrap fetch/DB getters fail closed, and database open is namespace checked',async()=>{
 const failed=boot({throwingFetch:true});assert.match(failed.context.AgentImageProcessingFixture.state.bootstrapError,/素材读取/);await assert.rejects(failed.context.fetch('/api/agent/turn'),/未初始化/);assert.equal(failed.calls.length,0);
 const missing=boot({throwingDB:true});assert.throws(()=>missing.context.indexedDB.open(missing.context.CANVAS_DB_NAME),/真实数据库/);
 const ready=boot();assert.throws(()=>ready.context.indexedDB.open('tapnow-canvas-replica'),/真实数据库/);assert.throws(()=>ready.context.indexedDB.deleteDatabase('tapnow-canvas-replica'),/删除/);ready.context.indexedDB.open(ready.context.CANVAS_DB_NAME,1);assert.equal(ready.dbCalls.length,1);
});
test('HTML installs CSP before fixture and all app scripts, with no same-origin API connection permission',()=>{
 const html=fs.readFileSync(path.join(root,'qa/agent-image-processing-app.html'),'utf8'),meta=html.indexOf('http-equiv="Content-Security-Policy"');assert(meta>0);assert(meta<html.indexOf('<script'));
 const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1],connect=policy.split(';').find(item=>item.trim().startsWith('connect-src'));
 assert(!connect.includes("'self'"));assert(!connect.includes('/api'));assert(connect.includes('http://localhost:*/qa/'));assert(connect.includes('http://127.0.0.1:*/qa/'));
 assert(connect.includes('http://localhost:*/runtime-reference/skills-catalog.json'));assert(!connect.includes('http://localhost:*/runtime-reference/;'));
});
test('Agent static catalog resolves against document baseURI and only its exact GET is allowed',async()=>{
 const f=boot();await f.context.fetch('runtime-reference/skills-catalog.json');assert.equal(f.calls[0][0],'http://localhost:4173/runtime-reference/skills-catalog.json');assert.equal(f.context.AgentImageProcessingFixture.state.requests[0].path,'/runtime-reference/skills-catalog.json');
 await assert.rejects(f.context.fetch('/runtime-reference/skills-catalog.json',{method:'POST'}),/未声明/);await assert.rejects(f.context.fetch('/runtime-reference/other.json'),/未声明/);await assert.rejects(f.context.fetch('/api/agent/real-model'),/未声明/);assert.equal(f.calls.length,1);
});
test('refresh initialization restores fixture receipts and returns synthetic migration map without reading private files',async()=>{
 const f=boot(),saved={tasks:[['original-task',{id:'original-task',status:'succeeded'}]],posts:[{id:'original-task',kind:'image.remove-background',acknowledged:true,width:512,height:320}]};
 assert.equal(f.context.AgentImageProcessingFixture.state.taskRecords,'loading');
 f.context.CanvasStore={readRecord:async key=>{assert.equal(key,'agent-qa-image-fixture-tasks');return saved;}};await f.context.AgentImageProcessingFixture.restoreTasks();assert.equal(f.context.AgentImageProcessingFixture.state.taskRecords,'ready');assert.equal(f.context.AgentImageProcessingFixture.state.posts[0].id,'original-task');
 const {loadResourceIndex}=await import('../src/features/local-resource-migration/canvas-load.mjs'),result=await loadResourceIndex({fetchIndex:f.context.fetch});assert.equal(result.state,'ready');assert.equal(Object.keys(result.index.entries).length,0);assert.equal(f.calls.length,0);
 await assert.rejects(f.context.fetch('/assets/local-resource-index.json',{method:'POST'}),/未声明/);await assert.rejects(f.context.fetch('/assets/private-map.json'),/未声明/);assert.equal(f.calls.length,0);
});
test('production Agent requestAgent turn/continue entry consumes fixture without a real fetch',async()=>{
 const f=boot(),{requestAgent}=await import('../src/features/agent-stream/transport.mjs'),binding={projectId:'qa-image-project',chatId:'fixture-chat'};
 const first=await requestAgent('turn',{binding,message:'把测试图片抠图'},{fetchImpl:f.context.fetch});assert.equal(first.calls[0].args.kind,'image.remove-background');assert.equal(first.done,false);
 const last=await requestAgent('continue',{binding,sessionId:first.sessionId,results:[{callId:first.calls[0].callId,result:{taskId:'fixed-task'}}]},{fetchImpl:f.context.fetch});assert.equal(last.done,true);assert.equal(last.sessionId,first.sessionId);assert.equal(f.calls.length,0);assert.equal(f.context.AgentImageProcessingFixture.state.turns,1);assert.equal(f.context.AgentImageProcessingFixture.state.errors.length,0);assert.equal(f.context.AgentImageProcessingFixture.state.requests.length,2);
});
test('panorama fixture feeds explicit native profile and pure PNG input through production preparation without claiming a receipt gate',async()=>{
 const f=boot({panorama:true}),records=new Map();f.context.CanvasStore={readRecord:async key=>records.get(key),writeRecord:async(key,value)=>records.set(key,value)};
 const config=await f.context.fetch('/api/generation/config').then(r=>r.json()),reply=await f.context.fetch('/api/agent/turn',{body:JSON.stringify({binding:{id:'qa-project'}})}).then(r=>r.json()),args=reply.calls[0].args;
 assert.equal(args.kind,'image.generate');assert.equal(args.model,'hunyuan-world-panorama');assert.equal(args.isPanoramaPrompt,true);assert.equal(args.aspect,'2:1');assert.deepEqual(args.referenceIds,['image-source']);
 const png=fs.readFileSync(path.join(root,'qa/agent-image-processing-source.png')),inline='data:image/png;base64,'+png.toString('base64'),{preparePanoramaMedia}=await import('../src/features/image-generation/panorama-media.mjs');
 // Node has no Image/canvas. Only the final PNG encode primitive is replaced;
 // real resolver, strict config/request checks and transport remain active.
 const request=await preparePanoramaMedia({kind:args.kind,prompt:args.prompt,inputs:[{type:'image',id:args.nodeId,url:inline,width:512,height:320}],parameters:{model:args.model,isPanoramaPrompt:true,aspect:'2:1',count:1}},{nativeConfiguration:config,baseUrl:f.context.location.href,encode:async url=>({url,width:png.readUInt32BE(16),height:png.readUInt32BE(20)})});
 const response=await f.context.fetch('/api/generation/tasks',{method:'POST',headers:{'Idempotency-Key':'qa-panorama-task'},body:JSON.stringify(request)}).then(r=>r.json());
 assert.equal(response.outputs[0].width,1024);assert.equal(response.outputs[0].height,512);assert.equal(f.context.AgentImageProcessingFixture.state.posts[0].acknowledged,false);assert(!f.context.AgentImageProcessingFixture.state.posts[0].inputKeys.includes('sourceUrl'));assert(records.has('agent-qa-image-fixture-tasks'));assert.equal(f.calls.length,0);
 const result=fs.readFileSync(path.join(root,'qa/agent-image-processing-panorama-result.png'));assert.equal(result.readUInt32BE(16),1024);assert.equal(result.readUInt32BE(20),512);
});
