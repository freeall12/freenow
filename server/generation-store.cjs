'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const storageError=cause=>Object.assign(Error('生成任务记录无法安全保存或读取'),{code:'storage_error',status:503,cause});

// One process owns a store directory. Stale leases are reclaimed only when their
// recorded process is definitely absent; corrupt/ambiguous leases fail closed.
function createGenerationStore({directory}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw TypeError('Generation store requires an absolute directory');
 const lease=path.join(directory,'.writer-lock'),token=randomUUID();let held=false,closed=false,writes=Promise.resolve();
 const ready=(async()=>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  for(let attempt=0;attempt<2;attempt++){
   try{const handle=await fs.open(lease,'wx',0o600);held=true;try{await handle.writeFile(JSON.stringify({pid:process.pid,token}));await handle.sync();}finally{await handle.close();}return;}
   catch(error){if(error.code!=='EEXIST')throw error;const owner=JSON.parse(await fs.readFile(lease,'utf8'));if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('Invalid store lease');let gone=false;try{process.kill(owner.pid,0);}catch(reason){if(reason.code==='ESRCH')gone=true;else throw reason;}if(!gone)throw Error('Generation store is already owned');await fs.unlink(lease);}
  }
  throw Error('Unable to acquire store lease');
 })().catch(error=>{throw storageError(error);});
 function write(record){
  const operation=writes.then(async()=>{
   await ready;if(closed)throw Error('Store is closed');if(!/^[a-f0-9-]{36}$/.test(record.id))throw Error('Invalid task identity');
   const destination=path.join(directory,record.id+'.json'),temporary=path.join(directory,'.'+record.id+'.'+randomUUID()+'.tmp');let handle;
   try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=null;await fs.rename(temporary,destination);const folder=await fs.open(directory,'r');try{await folder.sync();}finally{await folder.close();}}
   catch(error){await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});throw error;}
  }).catch(error=>{throw storageError(error);});
  writes=operation.catch(()=>{});return operation;
 }
 async function readAll(){try{await ready;const names=await fs.readdir(directory),records=[];for(const name of names.filter(name=>name.endsWith('.json'))){if(!/^[a-f0-9-]{36}\.json$/.test(name))throw Error('Unexpected task record');const record=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));if(record.id+'.json'!==name)throw Error('Task identity mismatch');records.push(record);}return records;}catch(error){throw storageError(error);}}
 async function close(){closed=true;await ready.catch(()=>{});await writes;if(held){const owner=JSON.parse(await fs.readFile(lease,'utf8'));if(owner.token===token)await fs.unlink(lease);held=false;}}
 return {readAll,write,close};
}
module.exports={createGenerationStore};
