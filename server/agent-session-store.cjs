'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{types}=require('node:util');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RECORD=/^([a-f0-9-]{36})\.json$/i;
const TEMP=/^\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.(tmp|bak)$/i;
const storageError=()=>Object.assign(Error('Agent会话快照无法安全保存或读取'),{code:'storage_error',status:503});

// Reject JSON's lossy conversions and accessors before JSON.stringify can run
// user code. Runtime owns the remaining session schema and credential policy.
function validateJSON(value,ancestors=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Invalid JSON number');return;}
 if(typeof value!=='object'||types.isProxy(value)||ancestors.has(value))throw Error('Invalid JSON value');
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('Invalid JSON prototype');
 ancestors.add(value);
 const keys=Reflect.ownKeys(value);
 if(array&&(keys.length!==value.length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))))throw Error('Invalid JSON array');
 for(const key of keys){
  if(array&&key==='length')continue;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(typeof key!=='string'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('Invalid JSON property');
  validateJSON(descriptor.value,ancestors);
 }
 ancestors.delete(value);
}
function stringifyJSON(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value)){const parts=[];for(let index=0;index<value.length;index++)parts.push(stringifyJSON(Object.getOwnPropertyDescriptor(value,String(index)).value));return '['+parts.join(',')+']';}
 return '{'+Object.keys(value).map(key=>JSON.stringify(key)+':'+stringifyJSON(Object.getOwnPropertyDescriptor(value,key).value)).join(',')+'}';
}
function encodeRecord(record,maxRecordBytes){
 validateJSON(record);
 if(!record||Array.isArray(record)||!['version','id','updated'].every(key=>Object.hasOwn(record,key))||record.version!==1||typeof record.id!=='string'||!UUID.test(record.id)||!Number.isSafeInteger(record.updated)||record.updated<0)throw Error('Invalid session record');
 // Serialize data descriptors directly, bypassing inherited toJSON hooks.
 const json=stringifyJSON(record),bytes=Buffer.byteLength(json);
 if(bytes>maxRecordBytes)throw Error('Session record is too large');
 return {record:JSON.parse(json),json,bytes};
}

function createAgentSessionStore({directory,maxRecords=100,maxRecordBytes=32*1024*1024,maxTotalBytes=256*1024*1024}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw TypeError('Agent session store requires an absolute directory');
 for(const value of [maxRecords,maxRecordBytes,maxTotalBytes])if(!Number.isSafeInteger(value)||value<=0)throw TypeError('Agent session store limits must be positive safe integers');
 const lease=path.join(directory,'.writer-lock'),token=randomUUID(),claimName='.writer-claim.'+token,claim=path.join(directory,claimName);
 let held=false,claimHeld=false,closing=false,closed=false,faulted=false,operations=Promise.resolve(),closePromise;
 async function privateFile(filename){
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||(stat.mode&0o777)!==0o600||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('Unsafe store file');
  return stat;
 }
 async function readLease(filename=lease){const stat=await privateFile(filename);if(stat.size>4096)throw Error('Oversized store lease');const owner=JSON.parse(await fs.readFile(filename,'utf8'));if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.token!=='string'||!UUID.test(owner.token))throw Error('Invalid store lease');return owner;}
 function absent(pid){try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}}
 async function inventory(){
  const directoryStat=await fs.lstat(directory),leaseOwner=await readLease();
  if(!directoryStat.isDirectory()||(directoryStat.mode&0o777)!==0o700||leaseOwner.token!==token||leaseOwner.pid!==process.pid)throw Error('Store ownership changed');
  const records=new Map();let bytes=0;
  for(const name of await fs.readdir(directory)){
   if(name==='.writer-lock'){const owner=await readLease();if(owner.token!==token||owner.pid!==process.pid)throw Error('Store lease changed');continue;}
   if(name===claimName){const owner=await readLease(claim);if(owner.token!==token||owner.pid!==process.pid)throw Error('Store claim changed');continue;}
   // Another initializer can briefly publish a claim while discovering the
   // active writer. It cannot become a writer or change this process's lease.
   if(name.startsWith('.writer-claim.')){const claimToken=name.slice('.writer-claim.'.length);if(!UUID.test(claimToken))throw Error('Invalid store claim');const owner=await readLease(path.join(directory,name));if(owner.token!==claimToken)throw Error('Store claim mismatch');continue;}
   const match=name.match(RECORD),temporary=name.match(TEMP);
   if(!match&&!temporary)throw Error('Unexpected store file');
   if(temporary&&(!UUID.test(temporary[1])||!UUID.test(temporary[2])))throw Error('Invalid store temporary file');
   const filename=path.join(directory,name),stat=await privateFile(filename);
   if(stat.size>maxRecordBytes)throw Error('Oversized store file');
   if(temporary){bytes+=stat.size;continue;}
   if(!UUID.test(match[1]))throw Error('Invalid store identity');
   const json=await fs.readFile(filename,'utf8'),encoded=encodeRecord(JSON.parse(json),maxRecordBytes);
   if(encoded.record.id+'.json'!==name)throw Error('Session identity mismatch');
   records.set(encoded.record.id,{...encoded,bytes:Buffer.byteLength(json)});bytes+=Buffer.byteLength(json);
   if(records.size>maxRecords||bytes>maxTotalBytes)throw Error('Store capacity exceeded');
  }
  if(bytes>maxTotalBytes)throw Error('Store capacity exceeded');
  return {records,bytes};
 }
 const ready=(async()=>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('Unsafe store directory');
  await fs.chmod(directory,0o700);
  // Unique claims make stale reclamation mutually exclusive without deleting
  // a canonical lease that another contender may have just acquired. Two
  // simultaneous reclaimers may both refuse; retrying is safe and explicit.
  let claimHandle;
  try{claimHandle=await fs.open(claim,'wx',0o600);claimHeld=true;await claimHandle.writeFile(JSON.stringify({pid:process.pid,token}));await claimHandle.sync();}finally{await claimHandle?.close();}
  for(const name of await fs.readdir(directory)){
   if(!name.startsWith('.writer-claim.')||name===claimName)continue;
   const claimToken=name.slice('.writer-claim.'.length),filename=path.join(directory,name);
   if(!UUID.test(claimToken))throw Error('Invalid store claim');
   let owner;try{owner=await readLease(filename);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(owner.token!==claimToken||!absent(owner.pid))throw Error('Store has another active claimant');
   await fs.unlink(filename).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  for(let attempt=0;attempt<2;attempt++){
   let handle;
   try{handle=await fs.open(lease,'wx',0o600);held=true;await handle.writeFile(JSON.stringify({pid:process.pid,token}));await handle.sync();await handle.close();handle=null;await inventory();return;}
   catch(error){await handle?.close().catch(()=>{});if(held||error.code!=='EEXIST')throw error;const owner=await readLease();if(!absent(owner.pid))throw Error('Agent session store is already owned');const current=await readLease();if(current.token!==owner.token||current.pid!==owner.pid||!absent(current.pid))throw Error('Store lease changed');await fs.unlink(lease);}
  }
  throw Error('Unable to acquire store lease');
 })().catch(async()=>{if(claimHeld){await fs.unlink(claim).catch(()=>{});claimHeld=false;}throw storageError();});
 // Callers may attach to ready later; keep the exposed rejection without an
 // unhandled rejection when initialization fails before their first request.
 ready.catch(()=>{});
 function queue(task){
  const operation=operations.then(async()=>{await ready;if(closed||faulted)throw Error('Store unavailable');return task();}).catch(()=>{throw storageError();});
  operations=operation.catch(()=>{});return operation;
 }
 async function syncDirectory(){const folder=await fs.open(directory,'r');try{await folder.sync();}finally{await folder.close();}}
 function list(){if(closing)return Promise.reject(storageError());return queue(async()=>{const {records}=await inventory();return [...records.values()].map(value=>JSON.parse(value.json));});}
 function put(record){
  if(closing)return Promise.reject(storageError());
  let encoded;try{encoded=encodeRecord(record,maxRecordBytes);}catch{return Promise.reject(storageError());}
  return queue(async()=>{
   const {records,bytes}=await inventory(),previous=records.get(encoded.record.id);
   if((!previous&&records.size>=maxRecords)||bytes-(previous?.bytes||0)+encoded.bytes>maxTotalBytes)throw Error('Store capacity exceeded');
   const destination=path.join(directory,encoded.record.id+'.json'),prefix=path.join(directory,'.'+encoded.record.id+'.'+randomUUID()),temporary=prefix+'.tmp',backup=prefix+'.bak';
   let handle,renamed=false,backedUp=false;
   try{
    handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(encoded.json);await handle.sync();await handle.close();handle=null;
    // A hard link retains the old inode for rollback if the directory sync
    // fails after replacement. It never replaces or truncates the old file.
    if(previous){await fs.link(destination,backup);backedUp=true;}
    await fs.rename(temporary,destination);renamed=true;await syncDirectory();
   }catch(error){
    await handle?.close().catch(()=>{});
    if(renamed){try{if(backedUp){await fs.rename(backup,destination);backedUp=false;}else await fs.unlink(destination);await syncDirectory();}catch{faulted=true;}}
    await fs.unlink(temporary).catch(()=>{});
    if(backedUp&&!faulted)await fs.unlink(backup).catch(()=>{});
    throw error;
   }
   if(backedUp)await fs.unlink(backup).catch(()=>{});
  });
 }
 function close(){
  if(closePromise)return closePromise;
  closing=true;closePromise=(async()=>{
   await ready.catch(()=>{});await operations;closed=true;
   if(held){const owner=await readLease();if(owner.token!==token||owner.pid!==process.pid)throw Error('Store lease changed');await fs.unlink(lease);held=false;}
   if(claimHeld){const owner=await readLease(claim);if(owner.token!==token||owner.pid!==process.pid)throw Error('Store claim changed');await fs.unlink(claim);claimHeld=false;}
  })().catch(()=>{throw storageError();});return closePromise;
 }
 return {ready,list,put,close};
}
module.exports={createAgentSessionStore};
