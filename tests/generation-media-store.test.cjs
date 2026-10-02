'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{Readable}=require('node:stream');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util'),runFile=promisify(execFile);
const taskId=randomUUID(),metadata={taskId,outputIndex:0,role:'main',mime:'image/png',format:'png',filename:'生成结果.png'};
const bytes=Buffer.from('actual provider bytes');
const stream=(value=bytes)=>Readable.from([value.subarray(0,3),value.subarray(3)]);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-media-store-'));let store=createGenerationMediaStore({directory,...options});
 t.after(async()=>{await store.close();await fs.rm(directory,{recursive:true,force:true});});await store.ready;
 return {directory,get store(){return store;},async restart(){await store.close();store=createGenerationMediaStore({directory,...options});await store.ready;return store;}};
}
test('stream bytes commit privately with random durable identity, SHA, immutable metadata and readonly handle',async t=>{
 const f=await fixture(t),first=await f.store.put(metadata,stream(),{expectedBytes:bytes.length});
 assert.match(first.resourceId,/^[a-f0-9-]{36}$/);assert.equal(first.taskId,taskId);assert.equal(first.outputIndex,0);assert.equal(first.role,'main');assert.equal(first.bytes,bytes.length);assert.equal(first.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(first.path,undefined);
 first.role='tampered';const info=await f.store.info(first.resourceId,{taskId,role:'main'});assert.equal(info.role,'main');
 const opened=await f.store.open(first.resourceId,{taskId,outputIndex:0});assert.deepEqual(await opened.handle.readFile(),bytes);await assert.rejects(()=>opened.handle.write(Buffer.from('overwrite')));await opened.handle.close();
 assert.equal((await fs.stat(f.directory)).mode&0o777,0o700);for(const name of await fs.readdir(f.directory))assert.equal((await fs.stat(path.join(f.directory,name))).mode&0o777,0o600);
 assert.deepEqual((await fs.readdir(f.directory)).filter(name=>name.endsWith('.part')),[]);
 await f.restart();assert.deepEqual(await f.store.info(first.resourceId),info);
 const unused=stream();assert.equal((await f.store.put(metadata,unused)).resourceId,first.resourceId);assert.equal(unused.destroyed,true);
 await assert.rejects(()=>f.store.info(first.resourceId,{taskId:randomUUID()}),{code:'media_ownership_mismatch'});
 await assert.rejects(()=>f.store.info(first.resourceId,{role:'poster'}),{code:'media_ownership_mismatch'});
});
test('concurrent duplicate role merges one write; metadata conflict and changed size never overwrite; revisions are independent',async t=>{
 const f=await fixture(t),gate=deferred(),entered=deferred();let reads=0;
 const original={async *[Symbol.asyncIterator](){reads++;entered.resolve();await gate.promise;yield bytes;}};
 const a=f.store.put(metadata,original);await entered.promise;const unused=stream(),b=f.store.put({...metadata},unused);
 const conflict=stream();await assert.rejects(()=>f.store.put({...metadata,mime:'image/jpeg'},conflict),{code:'media_identity_conflict'});assert.equal(conflict.destroyed,true);gate.resolve();const [one,two]=await Promise.all([a,b]);assert.equal(one.resourceId,two.resourceId);assert.equal(reads,1);assert.equal(unused.destroyed,true);
 await assert.rejects(()=>f.store.put({...metadata,filename:undefined},stream()),{code:'media_identity_conflict'});
 const omitted={...metadata};delete omitted.filename;await assert.rejects(()=>f.store.put(omitted,stream()),{code:'media_identity_conflict'});
 await assert.rejects(()=>f.store.put(metadata,stream(),{maxBytes:1}),{code:'media_identity_conflict'});
 const next=await f.store.put({...metadata,descriptorRevision:1},stream());assert.notEqual(next.resourceId,one.resourceId);assert.equal((await f.store.info(one.resourceId)).sha256,one.sha256);
});
test('limits count streamed bytes without Content-Length and failures do not publish files',async t=>{
 const f=await fixture(t,{maxBytes:10});
 for(const [value,options,code] of [[Buffer.alloc(11),{},'media_too_large'],[Buffer.alloc(0),{},'media_empty'],[Buffer.alloc(5),{expectedBytes:7},'media_length_mismatch']]){
  await assert.rejects(()=>f.store.put(metadata,stream(value),options),{code});assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
 }
 await assert.rejects(()=>f.store.put(metadata,stream(Buffer.alloc(5)),{maxBytes:11}),{code:'media_invalid_input'});
 const bad={async *[Symbol.asyncIterator](){yield Buffer.alloc(3);throw Error('source interrupted');}};
 await assert.rejects(()=>f.store.put(metadata,bad),{code:'media_storage_error'});assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
 const nonBytes={async *[Symbol.asyncIterator](){yield 'URL or string';}};await assert.rejects(()=>f.store.put(metadata,nonBytes),{code:'media_invalid_input'});assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
});
test('a duplicate waiter can cancel promptly without cancelling the original write',async t=>{
 const f=await fixture(t),gate=deferred(),entered=deferred(),controller=new AbortController();
 const source={async *[Symbol.asyncIterator](){entered.resolve();await gate.promise;yield bytes;}},owner=f.store.put(metadata,source);await entered.promise;
 const unused=stream(),waiter=f.store.put(metadata,unused,{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(waiter,{code:'media_cancelled'});assert.equal(unused.destroyed,true);
 gate.resolve();const record=await owner;assert.equal((await f.store.info(record.resourceId)).bytes,bytes.length);
});
test('cancellation interrupts a stalled read and cleans part; late bytes cannot publish; close cancels outstanding work',async t=>{
 const f=await fixture(t),gate=deferred(),entered=deferred(),controller=new AbortController();let stopped=false;
 const stalled={ [Symbol.asyncIterator](){let count=0;return {next(){if(!count++){return Promise.resolve({done:false,value:Buffer.from('first')});}entered.resolve();return gate.promise;},return(){stopped=true;return Promise.resolve({done:true});}};}};
 const pending=f.store.put(metadata,stalled,{signal:controller.signal});await entered.promise;controller.abort();await assert.rejects(pending,{code:'media_cancelled'});assert.equal(stopped,true);assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);gate.resolve({done:false,value:bytes});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
 const entered2=deferred(),never=new ReadableStream({pull(){entered2.resolve();return new Promise(()=>{});}});const saving=f.store.put(metadata,never);await entered2.promise;const closing=f.store.close();await assert.rejects(saving,{code:'media_cancelled'});await closing;assert.deepEqual(await fs.readdir(f.directory),[]);await assert.rejects(()=>f.store.put(metadata,stream()),{code:'media_store_closed'});
});
test('Web stream saves actual bytes and does not remove committed resources when later work fails or store closes',async t=>{
 const f=await fixture(t),web=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes));controller.close();}}),first=await f.store.put(metadata,web);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>f.store.put({...metadata,role:'poster'},stream(),{signal:cancelled.signal}),{code:'media_cancelled'});
 await f.store.close();assert.ok((await fs.readdir(f.directory)).includes(first.resourceId+'.bin'));assert.ok((await fs.readdir(f.directory)).includes(first.resourceId+'.json'));await f.restart();assert.equal((await f.store.info(first.resourceId)).bytes,bytes.length);
});
test('restart and readonly opens detect same-length tampering, missing bytes and malformed manifests',async t=>{
 for(const kind of ['tamper','missing','manifest']){
  const f=await fixture(t),record=await f.store.put(metadata,stream());await f.store.close();
  if(kind==='tamper')await fs.writeFile(path.join(f.directory,record.resourceId+'.bin'),Buffer.alloc(bytes.length));
  if(kind==='missing')await fs.unlink(path.join(f.directory,record.resourceId+'.bin'));
  if(kind==='manifest')await fs.writeFile(path.join(f.directory,record.resourceId+'.json'),'{broken');
  await assert.rejects(()=>f.restart(),{code:kind==='manifest'?'media_storage_error':'media_integrity_error'});assert.ok((await fs.readdir(f.directory)).includes(record.resourceId+'.json'));
 }
 const f=await fixture(t),record=await f.store.put(metadata,stream());await fs.writeFile(path.join(f.directory,record.resourceId+'.bin'),Buffer.alloc(bytes.length));await assert.rejects(()=>f.store.open(record.resourceId),{code:'media_integrity_error'});
});
test('store ownership is exclusive; rejects user paths, URLs, arbitrary fields and symlinked committed media',async t=>{
 const f=await fixture(t),rival=createGenerationMediaStore({directory:f.directory});await assert.rejects(rival.ready,{code:'media_store_locked'});await rival.close();
 for(const id of ['../secret','https://provider.test/file','file:///tmp/secret','not-a-resource'])await assert.rejects(()=>f.store.open(id),{code:'media_invalid_input'});
 await assert.rejects(()=>f.store.info(randomUUID()),{code:'media_not_found'});
 await assert.rejects(()=>f.store.put(metadata,'https://provider.test/file'),{code:'media_invalid_input'});
 for(const extra of [{url:'https://provider.test/file'},{path:'/tmp/media'},{headers:{Authorization:'secret'}},{filename:'../secret'},{taskId:'../task'},{outputIndex:50},{role:'../../role'}])await assert.rejects(()=>f.store.put({...metadata,...extra},stream()),{code:'media_invalid_input'});
 const record=await f.store.put(metadata,stream());await assert.rejects(()=>f.store.put(metadata,'https://provider.test/file'),{code:'media_invalid_input'});const file=path.join(f.directory,record.resourceId+'.bin'),target=path.join(f.directory,'external-bytes');await fs.writeFile(target,bytes,{mode:0o600});await fs.unlink(file);await fs.symlink(target,file);await assert.rejects(()=>f.store.open(record.resourceId),{code:'media_integrity_error'});assert.deepEqual(await fs.readFile(target),bytes);
});
test('manifest publication failure cleans only this unpublished write and preserves committed media and orphan files',async t=>{
 const f=await fixture(t),prior=await f.store.put(metadata,stream());const orphan=path.join(f.directory,randomUUID()+'.bin');await fs.writeFile(orphan,'unreferenced bytes',{mode:0o600});
 const source={async *[Symbol.asyncIterator](){yield bytes;const part=(await fs.readdir(f.directory)).find(name=>name.endsWith('.part'));const id=part.slice(1,37);await fs.mkdir(path.join(f.directory,id+'.json'));}};
 await assert.rejects(()=>f.store.put({...metadata,role:'poster'},source),{code:'media_storage_error'});
 assert.equal((await f.store.info(prior.resourceId)).sha256,prior.sha256);assert.equal(await fs.readFile(orphan,'utf8'),'unreferenced bytes');assert.equal((await fs.readdir(f.directory)).filter(name=>name.endsWith('.part')).length,0);assert.equal((await fs.readdir(f.directory)).filter(name=>name.endsWith('.bin')).length,2);
});
test('two processes fail closed on a stale lease; only explicit operator recovery permits reopening',async t=>{
 const f=await fixture(t),record=await f.store.put(metadata,stream());await f.store.close();
 const exited=spawn(process.execPath,['-e','process.exit(0)']);await new Promise((resolve,reject)=>{exited.once('error',reject);exited.once('close',code=>code===0?resolve():reject(Error('child exit')));});
 const lock=path.join(f.directory,'.writer-lock'),owner=JSON.stringify({pid:exited.pid,token:randomUUID()});await fs.writeFile(lock,owner,{mode:0o600});
 const child="const {createGenerationMediaStore}=require(process.argv[2]);const store=createGenerationMediaStore({directory:process.argv[1]});(async()=>{try{await store.ready;process.stdout.write('unexpected-owner');}catch(error){process.stdout.write(error.code);}finally{await store.close();}})().catch(()=>process.exitCode=1);";
 const contenders=await Promise.all([0,1].map(()=>runFile(process.execPath,['-e',child,f.directory,require.resolve('../server/generation-media-store.cjs')],{timeout:5000})));
 assert.deepEqual(contenders.map(value=>value.stdout),['media_store_locked','media_store_locked']);assert.equal(await fs.readFile(lock,'utf8'),owner);assert.deepEqual(await fs.readFile(path.join(f.directory,record.resourceId+'.bin')),bytes);
 const retired=path.join(os.tmpdir(),randomUUID()+'.operator-retired-lease');t.after(()=>fs.unlink(retired));await fs.rename(lock,retired);
 await f.restart();assert.equal((await f.store.info(record.resourceId)).sha256,record.sha256);assert.equal(await fs.readFile(retired,'utf8'),owner);
});
test('initialization rejection releases the supplied stream instead of leaving provider bytes flowing',async t=>{
 const f=await fixture(t),rival=createGenerationMediaStore({directory:f.directory});let cancelled=0;
 const source=new ReadableStream({cancel(){cancelled++;}});await assert.rejects(()=>rival.put(metadata,source),{code:'media_store_locked'});assert.equal(cancelled,1);assert.equal(source.locked,false);await rival.close();
 assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
});
test('a throwing source destroy does not replace the original failure or skip file cleanup',async t=>{
 const f=await fixture(t),source={destroy(){throw Error('stop throws');},async *[Symbol.asyncIterator](){yield Buffer.alloc(2);}};
 await assert.rejects(()=>f.store.put(metadata,source,{maxBytes:1}),{code:'media_too_large'});assert.deepEqual(await fs.readdir(f.directory),['.writer-lock']);
 const saved=await f.store.put(metadata,stream());assert.equal((await f.store.info(saved.resourceId)).bytes,bytes.length);
});
