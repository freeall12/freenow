'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {TaskService,httpProvider}=require('../generation-api.js');
const {createGenerationGateway}=require('../server/generation.cjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test('browser identity survives transport timeout and gateway restart: recover original result with GET only',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-recovery-'));
 let gateway; t.after(async()=>{await gateway?.close();await fs.rm(directory,{recursive:true,force:true});});
 const remote=[];let complete=false;
 const fetchRemote=async(url,options)=>{remote.push(options.method);return {ok:true,json:async()=>complete?{id:'provider-task',status:'succeeded',outputs:[{type:'text',text:'real retained output'}]}:{id:'provider-task',status:'running',progress:12}};};
 const create=()=>createGenerationGateway({directory,baseUrl:'https://provider.test',apiKey:'secret-not-public',fetchImpl:fetchRemote});
 gateway=create();await gateway.ready;
 const requests=[];
 const transport=async(url,options={})=>{
  requests.push({path:new URL(url).pathname,method:options.method||'GET',headers:options.headers});let result;
  await gateway.handle({method:options.method||'GET',headers:Object.fromEntries(Object.entries(options.headers||{}).map(([key,value])=>[key.toLowerCase(),value]))},{},new URL(url).pathname,{json:(_,status,value)=>{result={ok:status<400,status,json:async()=>value};},body:async()=>JSON.parse(options.body||'{}')});return result;
 };
 const provider=()=>httpProvider({baseUrl:'http://localhost/api/generation',recoverable:true,cancelRemote:true,fetchImpl:transport,pollInterval:100,timeout:20});
 const first=new TaskService();first.setProvider(provider());const job=first.submit({kind:'text.generate',nodeId:'source',prompt:'text'});
 for(let count=0;count<100&&['queued','running'].includes(job.status);count++)await tick();
 for(let count=0;count<100&&!remote.includes('POST');count++)await tick();
 assert.equal(job.status,'unknown');assert.equal(requests[0].headers['Idempotency-Key'],job.id);assert.equal(remote.filter(method=>method==='POST').length,1);assert.ok(!remote.includes('DELETE'));
 await gateway.close();complete=true;gateway=create();await gateway.ready;
 const second=new TaskService();second.setProvider(provider());const restored=await second.recover(job.id);
 assert.equal(restored.id,job.id);assert.equal(restored.status,'succeeded');assert.equal(restored.request.nodeId,'source');assert.equal(restored.outputs[0].text,'real retained output');assert.equal(restored.recovered,true);
 assert.equal(remote.filter(method=>method==='POST').length,1);assert.ok(requests.at(-1).path.endsWith('/by-key/'+job.id));assert.ok(!JSON.stringify(restored).includes('secret-not-public'));
 let response;await gateway.handle({method:'PUT',headers:{}},{},'/api/generation/tasks/'+restored.remoteTaskId,{json:(_,status)=>response=status,body:async()=>({})});assert.equal(response,405);
});

test('explicit recovered output import reuses persisted nodes and reports save failure without creating duplicates',async()=>{
 const {importRecoveredOutputs}=await import('../src/features/generation-results/recovery.mjs');
 const nodes=[{id:'source',type:'image'}],job={id:'stable-task',status:'succeeded',request:{nodeId:'source'},outputs:[{type:'image',url:'https://example.test/output.png'}]};let creates=0,fail=true;
 const options={app:{getState:()=>({nodes}),createConnected:(_,values)=>{creates++;const added=values.map((value,index)=>({...value,id:'output-'+index}));nodes.push(...added);return added;}},validateMedia:async()=>{},localizeAudio:async value=>value,persist:async()=>{if(fail)throw Error('disk full');}};
 await assert.rejects(importRecoveredOutputs(job,options),/disk full/);assert.deepEqual(job.resultIds,['output-0']);fail=false;
 assert.deepEqual(await importRecoveredOutputs(job,options),['output-0']);assert.equal(creates,1);
 const refreshed={...job,resultIds:undefined};assert.deepEqual(await importRecoveredOutputs(refreshed,options),['output-0']);assert.equal(creates,1);
 nodes.pop();await assert.rejects(importRecoveredOutputs(job,options),/不再完整/);assert.equal(creates,1);
});

test('recovered placeholder save failure retries persistence without replaying applied node patches',async()=>{
 const {applyRecoveredPlan}=await import('../src/features/generation-results/recovery.mjs');
 const nodes=[{id:'target',content:'old'}],job={id:'run'};let applies=0,fail=true;
 const options={app:{getState:()=>({nodes})},workflow:{has:()=>true,apply:async()=>{applies++;nodes[0].content='generated';return ['target'];}},validateMedia:async()=>{},persist:async()=>{if(fail)throw Error('save failed');}};
 await assert.rejects(applyRecoveredPlan(job,options),/save failed/);assert.deepEqual(job.resultIds,['target']);
 nodes[0].content='user edit';fail=false;await applyRecoveredPlan(job,options);assert.equal(applies,1);assert.equal(nodes[0].content,'user edit');
 nodes.pop();await assert.rejects(applyRecoveredPlan(job,options),/不再完整/);assert.equal(applies,1);
});
