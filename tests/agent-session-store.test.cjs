'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {createAgentSessionStore}=require('../server/agent-session-store.cjs');
const record=(extra={})=>({version:1,id:randomUUID(),updated:Date.now(),state:{phase:'waiting_tools',calls:[{id:'call-1',args:{prompt:'原始请求'}}]},...extra});
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-agent-session-store-')),stores=[];
 t.after(async()=>{for(const store of stores)await store.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});});
 return {directory,create(extra={}){const store=createAgentSessionStore({directory,...options,...extra});stores.push(store);return store;}};
}
test('snapshots survive reopen with private modes and independent list copies',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create(),saved=record();await store.ready;await store.put(saved);
 assert.equal((await fs.stat(fixtureStore.directory)).mode&0o777,0o700);
 assert.equal((await fs.stat(path.join(fixtureStore.directory,saved.id+'.json'))).mode&0o777,0o600);
 saved.state.calls[0].args.prompt='later mutation';const listed=await store.list();assert.equal(listed[0].state.calls[0].args.prompt,'原始请求');listed[0].state.calls.length=0;
 assert.equal((await store.list())[0].state.calls.length,1);await store.close();const reopened=fixtureStore.create();await reopened.ready;assert.equal((await reopened.list())[0].id,saved.id);
});
test('put captures inputs immediately, serializes commits and close drains accepted writes',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create(),saved=record();await store.ready;
 const first=store.put(saved);saved.updated++;saved.state.calls[0].args.prompt='second';const second=store.put(saved);saved.state.calls[0].args.prompt='outside';
 const closing=store.close();await assert.rejects(()=>store.put(record()),{code:'storage_error'});await Promise.all([first,second,closing]);
 const reopened=fixtureStore.create();await reopened.ready;const [actual]=await reopened.list();assert.equal(actual.state.calls[0].args.prompt,'second');assert.equal(actual.updated,saved.updated);
 await assert.rejects(()=>store.list(),{code:'storage_error'});
});
test('live writer rejection preserves its lease, data and ability to continue',async t=>{
 const fixtureStore=await fixture(t),owner=fixtureStore.create();await owner.ready;const lock=await fs.readFile(path.join(fixtureStore.directory,'.writer-lock'),'utf8');const rival=fixtureStore.create();
 await assert.rejects(rival.ready,{code:'storage_error',status:503});await rival.close();assert.equal(await fs.readFile(path.join(fixtureStore.directory,'.writer-lock'),'utf8'),lock);
 await owner.put(record());assert.equal((await owner.list()).length,1);
});
test('a crashed process lease and unique claim can be reclaimed without discarding its snapshot',async t=>{
 const fixtureStore=await fixture(t),saved=record(),storePath=require.resolve('../server/agent-session-store.cjs');
 const script='const {createAgentSessionStore}=require(process.argv[1]);const store=createAgentSessionStore({directory:process.argv[2]});store.ready.then(()=>store.put(JSON.parse(process.argv[3]))).then(()=>{process.stdout.write("READY\\n");setInterval(()=>{},1000);}).catch(()=>process.exit(1));';
 const child=spawn(process.execPath,['-e',script,storePath,fixtureStore.directory,JSON.stringify(saved)],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{child.stdout.once('data',data=>data.toString()==='READY\n'?resolve():reject(Error('Unexpected child state')));child.once('error',reject);child.once('exit',()=>reject(Error('Child exited before checkpoint')));});
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const reopened=fixtureStore.create();await reopened.ready;assert.deepEqual(await reopened.list(),[saved]);
});
test('ambiguous and malformed leases fail closed and remain intact',async t=>{
 for(const lease of ['{broken',JSON.stringify({pid:process.pid,token:'invalid'}),JSON.stringify({pid:0,token:randomUUID()})]){
  const fixtureStore=await fixture(t);await fs.writeFile(path.join(fixtureStore.directory,'.writer-lock'),lease,{mode:0o600});const store=fixtureStore.create();await assert.rejects(store.ready,{code:'storage_error'});await store.close();assert.equal(await fs.readFile(path.join(fixtureStore.directory,'.writer-lock'),'utf8'),lease);
 }
});
test('simultaneous stale-lease reclaimers never both acquire a writer or delete a live winner',async t=>{
 const storePath=require.resolve('../server/agent-session-store.cjs');
 for(let attempt=0;attempt<5;attempt++){
  const fixtureStore=await fixture(t),stalePid=2147483647;await fs.writeFile(path.join(fixtureStore.directory,'.writer-lock'),JSON.stringify({pid:stalePid,token:randomUUID()}),{mode:0o600});
  const script='const {createAgentSessionStore}=require(process.argv[1]);const store=createAgentSessionStore({directory:process.argv[2]});store.ready.then(()=>{process.stdout.write("READY\\n");setInterval(()=>{},1000);}).catch(async()=>{await store.close();process.stdout.write("BLOCKED\\n");});';
  const children=Array.from({length:2},()=>spawn(process.execPath,['-e',script,storePath,fixtureStore.directory],{stdio:['ignore','pipe','pipe']}));
  t.after(()=>children.forEach(child=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}));
  const states=await Promise.all(children.map(child=>new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(data.toString().trim()));child.once('error',reject);child.once('exit',()=>reject(Error('Child exited without result')));})));
  assert.ok(states.every(state=>['READY','BLOCKED'].includes(state)));assert.ok(states.filter(state=>state==='READY').length<=1);
  if(states.includes('READY')){const winner=children[states.indexOf('READY')],owner=JSON.parse(await fs.readFile(path.join(fixtureStore.directory,'.writer-lock'),'utf8'));assert.equal(owner.pid,winner.pid);process.kill(owner.pid,0);const exited=once(winner,'exit');winner.kill('SIGKILL');await exited;}
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
  const reopened=fixtureStore.create();await reopened.ready;await reopened.put(record());assert.equal((await reopened.list()).length,1);
 }
});
test('strict JSON rejects loss, cycles, proxies and executable accessors without evaluating them',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create();await store.ready;let invoked=0;const getter={};Object.defineProperty(getter,'value',{enumerable:true,get(){invoked++;return 1;}});
 const cycle={};cycle.self=cycle;const nonenumerable={};Object.defineProperty(nonenumerable,'value',{value:1});const extraArray=[1];extraArray.extra=2;
 const values=[undefined,()=>{},1n,NaN,Infinity,new Date(),new Map(),cycle,getter,nonenumerable,[,1],extraArray,{[Symbol('secret')]:1},{toJSON(){invoked++;return {}; }},new Proxy({},{getPrototypeOf(){invoked++;return Object.prototype;}})];
 for(const value of values)await assert.rejects(()=>store.put(record({value})),{code:'storage_error'});
 for(const invalid of [record({version:2}),record({id:'../escape'}),record({updated:'2026-10-02T00:00:00Z'}),record({updated:-1}),record({updated:1.5}),record({updated:Number.MAX_SAFE_INTEGER+1}),[record()]])await assert.rejects(()=>store.put(invalid),{code:'storage_error'});
 assert.equal(invoked,0);assert.deepEqual(await store.list(),[]);const shared={value:1};await store.put(record({a:shared,b:shared}));assert.equal((await store.list()).length,1);
});
test('inherited JSON hooks do not execute during capture and required fields must be own properties',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create();await store.ready;const saved=record();let invoked=0,pending;
 const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
 Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){invoked++;return ()=>({});}});
 try{pending=store.put(saved);}finally{if(descriptor)Object.defineProperty(Object.prototype,'toJSON',descriptor);else delete Object.prototype.toJSON;}
 await pending;assert.equal(invoked,0);assert.deepEqual(await store.list(),[saved]);
 const versionDescriptor=Object.getOwnPropertyDescriptor(Object.prototype,'version');Object.defineProperty(Object.prototype,'version',{value:1,configurable:true});
 try{const invalid={...saved};delete invalid.version;await assert.rejects(()=>store.put(invalid),{code:'storage_error'});}finally{if(versionDescriptor)Object.defineProperty(Object.prototype,'version',versionDescriptor);else delete Object.prototype.version;}
});
test('record and total budgets reject changes while retaining earlier snapshots and history',async t=>{
 const saved=record({state:{text:'original'}}),size=Buffer.byteLength(JSON.stringify(saved));
 for(const limits of [{maxRecords:1},{maxRecordBytes:size+10},{maxTotalBytes:size}]){
  const fixtureStore=await fixture(t,limits),store=fixtureStore.create();await store.ready;await store.put(saved);
  if(limits.maxRecords)await assert.rejects(()=>store.put(record()),{code:'storage_error'});
  else await assert.rejects(()=>store.put({...saved,state:{text:'x'.repeat(2000)}}),{code:'storage_error'});
  assert.deepEqual(await store.list(),[saved]);await store.put({...saved,state:{text:'short'}});assert.equal((await store.list()).length,1);
 }
});
test('corruption, capacity violations and unexpected entries block initialization',async t=>{
 const saved=record(),cases=[{name:saved.id+'.json',content:'{broken'},{name:saved.id+'.json',content:JSON.stringify({...saved,id:randomUUID()})},{name:'unexpected.json',content:'{}'},{name:saved.id+'.json',content:JSON.stringify(saved),limits:{maxRecords:1,maxRecordBytes:10}},{name:saved.id+'.json',content:JSON.stringify(saved),limits:{maxTotalBytes:10}}];
 for(const item of cases){const fixtureStore=await fixture(t,item.limits);await fs.writeFile(path.join(fixtureStore.directory,item.name),item.content,{mode:0o600});const store=fixtureStore.create();await assert.rejects(store.ready,{code:'storage_error'});await assert.rejects(()=>store.put(record()),{code:'storage_error'});assert.equal(await fs.readFile(path.join(fixtureStore.directory,item.name),'utf8'),item.content);}
 const fixtureStore=await fixture(t,{maxRecords:1});for(let index=0;index<2;index++){const value=record();await fs.writeFile(path.join(fixtureStore.directory,value.id+'.json'),JSON.stringify(value),{mode:0o600});}await assert.rejects(fixtureStore.create().ready,{code:'storage_error'});
});
test('external corruption and lease loss cannot be hidden by an in-memory cache or overwritten',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create(),saved=record();await store.ready;await store.put(saved);const destination=path.join(fixtureStore.directory,saved.id+'.json');
 await fs.writeFile(destination,'{broken');await assert.rejects(()=>store.list(),{code:'storage_error'});await assert.rejects(()=>store.put(saved),{code:'storage_error'});assert.equal(await fs.readFile(destination,'utf8'),'{broken');
 await fs.writeFile(destination,JSON.stringify(saved));await fs.unlink(path.join(fixtureStore.directory,'.writer-lock'));await assert.rejects(()=>store.list(),{code:'storage_error'});await assert.rejects(()=>store.put(saved),{code:'storage_error'});
});
test('symlinks and public record permissions are rejected before reading or replacing targets',async t=>{
 for(const symlink of [false,true]){const fixtureStore=await fixture(t),saved=record(),destination=path.join(fixtureStore.directory,saved.id+'.json');if(symlink){const outside=path.join(fixtureStore.directory,'outside');await fs.writeFile(outside,JSON.stringify(saved),{mode:0o600});await fs.symlink(outside,destination);}else await fs.writeFile(destination,JSON.stringify(saved),{mode:0o644});await assert.rejects(fixtureStore.create().ready,{code:'storage_error'});}
});
test('failed temporary sync or rename retains the prior committed file and allows a later write',async t=>{
 for(const failure of ['sync','rename']){
  const fixtureStore=await fixture(t),store=fixtureStore.create(),saved=record();await store.ready;await store.put(saved);const oldOpen=fs.open,oldRename=fs.rename;
  if(failure==='rename')fs.rename=async(from,to)=>{if(from.startsWith(fixtureStore.directory)&&from.endsWith('.tmp'))throw Object.assign(Error('fixture failure'),{code:'EIO'});return oldRename(from,to);};
  else fs.open=async(filename,...args)=>{const handle=await oldOpen(filename,...args);if(filename.startsWith(fixtureStore.directory)&&filename.endsWith('.tmp'))handle.sync=async()=>{throw Object.assign(Error('fixture failure'),{code:'EIO'});};return handle;};
  try{await assert.rejects(()=>store.put({...saved,updated:saved.updated+1}),{code:'storage_error'});}finally{fs.open=oldOpen;fs.rename=oldRename;}
  assert.deepEqual(await store.list(),[saved]);assert.ok(!(await fs.readdir(fixtureStore.directory)).some(name=>/\.(tmp|bak)$/.test(name)));await store.put({...saved,updated:saved.updated+2});assert.equal((await store.list())[0].updated,saved.updated+2);
 }
});
test('directory sync failure after rename rolls back the old snapshot before reporting failure',async t=>{
 const fixtureStore=await fixture(t),store=fixtureStore.create(),saved=record();await store.ready;await store.put(saved);const oldOpen=fs.open;let failures=0;
 fs.open=async(filename,...args)=>{const handle=await oldOpen(filename,...args);if(filename===fixtureStore.directory&&failures++===0)handle.sync=async()=>{throw Error('fixture directory sync failure');};return handle;};
 try{await assert.rejects(()=>store.put({...saved,updated:saved.updated+1}),{code:'storage_error'});}finally{fs.open=oldOpen;}
 assert.deepEqual(await store.list(),[saved]);
});
test('recognized crash temporary files stay intact and count against total byte budget',async t=>{
 const fixtureStore=await fixture(t,{maxTotalBytes:100}),orphan='.'+randomUUID()+'.'+randomUUID()+'.tmp';await fs.writeFile(path.join(fixtureStore.directory,orphan),'x'.repeat(90),{mode:0o600});const store=fixtureStore.create();await store.ready;assert.deepEqual(await store.list(),[]);await assert.rejects(()=>store.put(record()),{code:'storage_error'});assert.equal(await fs.readFile(path.join(fixtureStore.directory,orphan),'utf8'),'x'.repeat(90));
});
test('invalid store configuration is rejected synchronously',()=>{
 for(const options of [{directory:'relative'},{directory:'/unused',maxRecords:0},{directory:'/unused',maxRecordBytes:NaN},{directory:'/unused',maxTotalBytes:1.5}])assert.throws(()=>createAgentSessionStore(options),TypeError);
});
