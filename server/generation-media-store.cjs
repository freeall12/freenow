'use strict';
const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=(code,message,cause)=>Object.assign(Error(message),{code,...cause?{cause}:{}});
const invalid=()=>fail('media_invalid_input','本地媒体参数无效');
const storage=cause=>fail('media_storage_error','本地媒体无法安全保存或读取',cause);
const abortError=()=>fail('media_cancelled','本地媒体保存已取消');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(key=>keys.includes(key));
function metadata(value){
 const keys=['taskId','outputIndex','role','mime','format','filename','descriptorRevision'];
 if(!exact(value,keys)||typeof value.taskId!=='string'||!UUID.test(value.taskId)||!Number.isSafeInteger(value.outputIndex)||value.outputIndex<0||value.outputIndex>=50||typeof value.role!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(value.role)||typeof value.mime!=='string'||value.mime.length>100||!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value.mime))throw invalid();
 if(value.format!==undefined&&(typeof value.format!=='string'||!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value.format)))throw invalid();
 if(value.filename!==undefined&&(typeof value.filename!=='string'||!value.filename.trim()||value.filename.length>255||/[\x00-\x1f\x7f/\\]/.test(value.filename)||['.','..'].includes(value.filename)))throw invalid();
 if(value.descriptorRevision!==undefined&&(!Number.isSafeInteger(value.descriptorRevision)||value.descriptorRevision<0))throw invalid();
 return Object.fromEntries(keys.filter(key=>key!=='descriptorRevision'&&value[key]!==undefined).map(key=>[key,value[key]]).concat([['descriptorRevision',value.descriptorRevision??0]]));
}
const identity=value=>JSON.stringify([value.taskId,value.outputIndex,value.role,value.descriptorRevision]);
const snapshot=value=>structuredClone(value);
function ownership(value={}){
 if(!exact(value,['taskId','outputIndex','role']))throw invalid();
 if(value.taskId!==undefined&&(typeof value.taskId!=='string'||!UUID.test(value.taskId))||value.outputIndex!==undefined&&(!Number.isSafeInteger(value.outputIndex)||value.outputIndex<0||value.outputIndex>=50)||value.role!==undefined&&(typeof value.role!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(value.role)))throw invalid();
 return value;
}
function sourceReader(stream){
 if(stream&&typeof stream.getReader==='function'){
  const reader=stream.getReader();return {next:()=>reader.read(),stop:()=>{void reader.cancel().catch(()=>{});},release:()=>reader.releaseLock()};
 }
 if(stream&&typeof stream[Symbol.asyncIterator]==='function'){
  const iterator=stream[Symbol.asyncIterator]();return {next:()=>iterator.next(),stop:()=>{if(typeof stream.destroy==='function')stream.destroy();else if(iterator.return)void Promise.resolve().then(()=>iterator.return()).catch(()=>{});},release:()=>{}};
 }
 throw invalid();
}
function discard(stream){let reader;try{reader=sourceReader(stream);reader.stop();}catch{}finally{try{reader?.release();}catch{}}}
async function follow(promise,signal){
 if(!signal)return promise;if(signal.aborted)throw abortError();let abort;
 const interrupted=new Promise((_,reject)=>{abort=()=>reject(abortError());signal.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([promise,interrupted]);}finally{signal.removeEventListener('abort',abort);}
}

// Only trusted materializers supply bytes and validated metadata. This module
// never interprets a URL, resolves a user path, or deletes committed resources.
// put(metadata, asyncIterable|ReadableStream, {signal,maxBytes,expectedBytes})
// returns an immutable manifest. An ownership/revision key deduplicates writes.
// info/open accept only resource IDs and optional task/index/role assertions;
// open returns {info,handle}, a verified read-only handle the caller must close.
// Failures use media_* codes with no source URL, credential or path in messages.
// No MIME decoding is claimed here: the materializer owns content validation.
// Existing locks fail closed, including a crashed writer's stale lock. Recovery
// is an operator action: stop all writers, move .writer-lock out of this private
// directory, then reopen. Never move an active writer's lock. Startup does not
// reclaim locks or delete media, because read-owner/unlink is not atomic.
function createGenerationMediaStore({directory,maxBytes=100*1024*1024}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||!positive(maxBytes))throw invalid();
 const records=new Map(),keys=new Map(),active=new Map(),controllers=new Set(),token=randomUUID(),lease=path.join(directory,'.writer-lock');
 let held=false,closing=false,closePromise;
 const filename=(id,extension)=>path.join(directory,id+'.'+extension);
 const syncDirectory=async()=>{const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}};
 async function privateFile(file){const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||(stat.mode&0o777)!==0o600)throw storage();return {handle,stat};}catch(error){await handle.close();throw error;}}
 async function verify(record){
  let opened;try{
   opened=await privateFile(filename(record.resourceId,'bin'));if(opened.stat.size!==record.bytes)throw Error('size');
   const hash=createHash('sha256'),buffer=Buffer.alloc(Math.min(record.bytes,64*1024));let offset=0;
   while(offset<record.bytes){const {bytesRead}=await opened.handle.read(buffer,0,Math.min(buffer.length,record.bytes-offset),offset);if(!bytesRead)throw Error('truncated');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
   if(hash.digest('hex')!==record.sha256)throw Error('hash');return opened.handle;
  }catch(error){await opened?.handle.close().catch(()=>{});throw fail('media_integrity_error','本地媒体缺失或完整性校验失败',error);}
 }
 const ready=(async()=>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});const dir=await fs.lstat(directory);if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('directory');await fs.chmod(directory,0o700);
  let lockHandle;try{lockHandle=await fs.open(lease,'wx',0o600);held=true;await lockHandle.writeFile(JSON.stringify({pid:process.pid,token}));await lockHandle.sync();}
  catch(error){if(error.code==='EEXIST')throw fail('media_store_locked','本地媒体仓库已有写入锁；确认所有写入进程已退出后，将 .writer-lock 移出私有仓库再重试');throw error;}
  finally{await lockHandle?.close();}
  for(const name of await fs.readdir(directory)){
   if(!name.endsWith('.json'))continue;const id=name.slice(0,-5);if(!UUID.test(id))throw Error('manifest name');
   const opened=await privateFile(filename(id,'json'));let record;try{if(opened.stat.size>4096)throw Error('manifest size');record=JSON.parse(await opened.handle.readFile('utf8'));}finally{await opened.handle.close();}
   if(!exact(record,['version','resourceId','taskId','outputIndex','role','mime','format','filename','descriptorRevision','bytes','sha256','createdAt'])||record.version!==1||record.resourceId!==id||!positive(record.bytes)||record.bytes>maxBytes||typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256)||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt)))throw Error('manifest');
   const source=metadata(Object.fromEntries(['taskId','outputIndex','role','mime','format','filename','descriptorRevision'].filter(key=>record[key]!==undefined).map(key=>[key,record[key]]))),key=identity(source);
   if(keys.has(key))throw Error('duplicate ownership');await (await verify(record)).close();records.set(id,record);keys.set(key,id);
  }
 })().catch(error=>{throw ['media_integrity_error','media_store_locked'].includes(error.code)?error:storage(error);});
 ready.catch(()=>{});
 function check(signal){if(signal.aborted)throw abortError();if(closing)throw fail('media_store_closed','本地媒体仓库已关闭');}
 async function save(source,stream,options){
  const controller=new AbortController(),cancel=()=>controller.abort();controllers.add(controller);options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=()=>reject(abortError());controller.signal.addEventListener('abort',rejectAbort,{once:true});});interrupted.catch(()=>{});
  const wait=async execute=>{check(controller.signal);const value=await Promise.race([Promise.resolve().then(()=>{check(controller.signal);return execute();}),interrupted]);check(controller.signal);return value;};
  const id=randomUUID(),part=path.join(directory,'.'+id+'.'+randomUUID()+'.part'),manifestPart=path.join(directory,'.'+id+'.'+randomUUID()+'.manifest.part');
  let handle,reader,complete=false,published=false,binaryMoved=false,record;
  try{
   check(controller.signal);reader=sourceReader(stream);handle=await fs.open(part,'wx',0o600);const hash=createHash('sha256');let bytes=0;
   while(true){const chunk=await wait(()=>reader.next());if(chunk.done){complete=true;break;}if(!(chunk.value instanceof Uint8Array))throw invalid();if(!chunk.value.byteLength)continue;bytes+=chunk.value.byteLength;if(bytes>options.maxBytes)throw fail('media_too_large','本地媒体超过保存大小上限');hash.update(chunk.value);
    let offset=0;while(offset<chunk.value.byteLength){check(controller.signal);const result=await handle.write(chunk.value,offset,chunk.value.byteLength-offset,null);if(!result.bytesWritten)throw storage();offset+=result.bytesWritten;}
   }
   if(!bytes)throw fail('media_empty','本地媒体内容为空');if(options.expectedBytes!==undefined&&bytes!==options.expectedBytes)throw fail('media_length_mismatch','本地媒体长度与预期不一致');
   check(controller.signal);await handle.sync();await handle.close();handle=null;check(controller.signal);
   await fs.rename(part,filename(id,'bin'));binaryMoved=true;await syncDirectory();check(controller.signal);
   record={version:1,resourceId:id,...source,bytes,sha256:hash.digest('hex'),createdAt:new Date().toISOString()};
   handle=await fs.open(manifestPart,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=null;check(controller.signal);
   // The last cancellation check precedes the atomic commit. Once publication
   // starts it completes without retracting bytes another owner can observe.
   await fs.rename(manifestPart,filename(id,'json'));published=true;records.set(id,record);keys.set(identity(source),id);await syncDirectory();return snapshot(record);
  }catch(error){if(error.code?.startsWith('media_'))throw error;throw storage(error);}
  finally{
   options.signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);controllers.delete(controller);
   try{if(!complete){if(reader)reader.stop();else discard(stream);}}catch{}try{reader?.release();}catch{}await handle?.close().catch(()=>{});
   if(!published){await fs.unlink(part).catch(()=>{});await fs.unlink(manifestPart).catch(()=>{});if(binaryMoved)await fs.unlink(filename(id,'bin')).catch(()=>{});}
  }
 }
 async function put(value,stream,options={}){
  const source=metadata(value);if(!stream||typeof stream.getReader!=='function'&&typeof stream[Symbol.asyncIterator]!=='function'||!exact(options,['signal','maxBytes','expectedBytes'])||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw invalid();
  const limit=options.maxBytes??maxBytes;if(!positive(limit)||limit>maxBytes||options.expectedBytes!==undefined&&(!positive(options.expectedBytes)||options.expectedBytes>limit))throw invalid();
  try{await ready;}catch(error){discard(stream);throw error;}if(closing){discard(stream);throw fail('media_store_closed','本地媒体仓库已关闭');}if(options.signal?.aborted){discard(stream);throw abortError();}
  const key=identity(source),id=keys.get(key),pending=active.get(key),prior=id?records.get(id):pending?.source;
  if(prior){const priorMetadata=metadata(Object.fromEntries(['taskId','outputIndex','role','mime','format','filename','descriptorRevision'].filter(field=>prior[field]!==undefined).map(field=>[field,prior[field]])));if(JSON.stringify(priorMetadata)!==JSON.stringify(source)){if(stream!==pending?.stream)discard(stream);throw fail('media_identity_conflict','同一媒体归属已经用于不同元数据');}if(stream!==pending?.stream)discard(stream);const record=pending?await follow(pending.promise,options.signal):records.get(id);if(options.signal?.aborted)throw abortError();if(record.bytes>limit||options.expectedBytes!==undefined&&record.bytes!==options.expectedBytes)throw fail('media_identity_conflict','已保存媒体与当前大小约束不一致');await (await verify(record)).close();await syncDirectory();if(options.signal?.aborted)throw abortError();return snapshot(record);}
  const promise=save(source,stream,{...options,maxBytes:limit}).finally(()=>active.delete(key));active.set(key,{source,stream,promise});return promise;
 }
 async function open(id,expected={}){
  if(typeof id!=='string'||!UUID.test(id))throw invalid();ownership(expected);await ready;if(closing)throw fail('media_store_closed','本地媒体仓库已关闭');const record=records.get(id);if(!record)throw fail('media_not_found','本地媒体不存在');
  if(Object.entries(expected).some(([key,value])=>record[key]!==value))throw fail('media_ownership_mismatch','本地媒体不属于指定任务或资源角色');const handle=await verify(record);return {handle,info:snapshot(record)};
 }
 async function info(id,expected){const opened=await open(id,expected);await opened.handle.close();return opened.info;}
 function close(){
  if(closePromise)return closePromise;closing=true;for(const controller of controllers)controller.abort();
  closePromise=(async()=>{await ready.catch(()=>{});await Promise.allSettled([...active.values()].map(value=>value.promise));if(held){const opened=await privateFile(lease);let owner;try{owner=JSON.parse(await opened.handle.readFile('utf8'));}finally{await opened.handle.close();}if(owner.token===token)await fs.unlink(lease);held=false;}})();return closePromise;
 }
 return {ready,put,open,info,close};
}
module.exports={createGenerationMediaStore};
