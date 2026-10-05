'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs'),{randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>Object.assign(Error(code==='storage_error'?'视频深度批次记录未安全保存':'视频深度批次身份或阶段尚未确认，未重新提交'),{code});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>object(value)&&Object.keys(value).sort().join(',')===expected.sort().join(',');
const nodeId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);

// The parent identity is saved before any billable POST. A dispatching child is
// deliberately never resumed: its lost response could conceal an accepted task.
function createVideoDepthBatch({directory,fingerprint,validateChild,pollChild,cancelChild}){
 const locks=new Map(),cancelRequests=new Set();
 function parseId(id){if(typeof id!=='string'||!id.startsWith('vd2.')||!UUID.test(id.slice(4)))throw fail('provider_identity_mismatch');return id.slice(4);}
 function validate(value,id){
  if(!keys(value,['version','id','fingerprint','actual','nodeId','sourceNodeId','cancelled','children'])||value.version!==1||value.id!==parseId(id)||value.fingerprint!==fingerprint||!nodeId(value.nodeId)||!nodeId(value.sourceNodeId)||typeof value.cancelled!=='boolean'||!Array.isArray(value.actual)||value.actual.length!==5||!value.actual.every(Number.isFinite)||!Array.isArray(value.children)||value.children.length!==2)throw fail('unknown');
  const [w,h,d,f,n]=value.actual;if(![w,h].every(v=>Number.isSafeInteger(v)&&v>=2&&v%2===0)||w>1920||h>1080||d<=0||f<5||f>30||!Number.isInteger(n)||n<1||n>2400||Math.abs(d-n/f)>.0001)throw fail('unknown');
  const used=new Set();
  for(const [index,child]of value.children.entries()){
   if(!keys(child,['index','phase','id'])||child.index!==index||!['pending','dispatching','accepted'].includes(child.phase))throw fail('unknown');
   if(child.phase==='accepted'?typeof child.id!=='string':child.id!==null)throw fail('unknown');
   if(child.phase==='accepted'){let original;try{original=validateChild(child.id);}catch{throw fail('unknown');}if(used.has(child.id)||JSON.stringify(original.actual)!==JSON.stringify(value.actual))throw fail('unknown');used.add(child.id);}
  }
  // Sequential dispatch means child two cannot be accepted before child one.
  if(value.children[1].phase!=='pending'&&value.children[0].phase!=='accepted')throw fail('unknown');
  return value;
 }
 async function ensure(){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw fail('configuration_required');
  await fs.mkdir(directory,{recursive:true,mode:0o700});const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw fail('storage_error');await fs.chmod(directory,0o700);
 }
 async function read(id){
  const uuid=parseId(id);let handle;
  try{await ensure();handle=await fs.open(path.join(directory,uuid+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW);const info=await handle.stat();if(!info.isFile()||info.size>16384)throw fail('unknown');return validate(JSON.parse(await handle.readFile('utf8')),id);}
  catch(error){if(error.code==='configuration_required')throw error;throw fail('unknown');}finally{await handle?.close().catch(()=>{});}
 }
 async function write(value){
  const id='vd2.'+value.id;validate(value,id);let handle,temporary;
  try{await ensure();temporary=path.join(directory,'.'+value.id+'.'+randomUUID()+'.tmp');handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;await fs.rename(temporary,path.join(directory,value.id+'.json'));const folder=await fs.open(directory,'r');try{await folder.sync();}finally{await folder.close();}}
  catch{throw fail('storage_error');}finally{await handle?.close().catch(()=>{});if(temporary)await fs.unlink(temporary).catch(()=>{});}
 }
 function locked(id,operation){const previous=locks.get(id)||Promise.resolve(),running=previous.catch(()=>{}).then(operation);locks.set(id,running);return running.finally(()=>{if(locks.get(id)===running)locks.delete(id);});}
 function checkRequest(value,request){
  if(request===undefined)return;
  const source=request?.inputs?.[0],p=request?.parameters;
  if(!object(request)||request.kind!=='video.depth'||request.nodeId!==value.nodeId||request.inputs?.length!==1||source?.id!==value.sourceNodeId||source.type!=='video'||source.width!==value.actual[0]||source.height!==value.actual[1]||!Number.isFinite(source.duration)||Math.abs(source.duration-value.actual[2])>.0001||p?.width!==source.width||p.height!==source.height||p.duration!==source.duration)throw fail('provider_identity_mismatch');
 }
 const unknown=id=>({id,status:'unknown',code:'unknown',error:'视频深度批次未全部确认；只查询已接受子任务，不会重新提交'});
 async function aggregate(id,value,{signal}={}){
  const results=[];
  for(const child of value.children){
   if(child.phase!=='accepted')continue;
   try{results[child.index]=await pollChild(child.id,{signal});}catch(error){if(signal?.aborted)throw signal.reason;results[child.index]={status:'unknown'};}
  }
  if(value.cancelled||cancelRequests.has(id))return unknown(id);
  if(results.some(result=>result?.status==='failed'))return {id,status:'failed',code:'provider_failed',error:'视频深度批次的原生子任务未完成'};
  if(results.filter(Boolean).length!==2||results.some(result=>result.status==='unknown'))return unknown(id);
  if(results.every(result=>result.status==='succeeded'))return {id,status:'succeeded',progress:100,outputs:results.flatMap(result=>result.outputs)};
  return {id,status:results.some(result=>result.status==='running')?'running':'queued'};
 }
 async function submit({actual,nodeId:target,sourceNodeId,submitChild},{signal,onTaskIdentity=()=>{}}={}){
  const id='vd2.'+randomUUID(),value={version:1,id:id.slice(4),fingerprint,actual,nodeId:target,sourceNodeId,cancelled:false,children:[0,1].map(index=>({index,phase:'pending',id:null}))};
  return locked(id,async()=>{
   await write(value);await onTaskIdentity(id);
   for(const child of value.children){
    if(signal?.aborted)throw signal.reason;
    if(cancelRequests.has(id)){value.cancelled=true;await write(value);return unknown(id);}
    child.phase='dispatching';await write(value);
    let result;try{result=await submitChild(child.index,{signal});}catch(error){if(signal?.aborted)throw signal.reason;return unknown(id);}
    const original=validateChild(result.id);if(JSON.stringify(original.actual)!==JSON.stringify(actual)||value.children.some(other=>other!==child&&other.id===result.id))return unknown(id);
    child.phase='accepted';child.id=result.id;await write(value);
    if(result.status==='unknown'||result.status==='failed')return unknown(id);
   }
   if(cancelRequests.has(id)){value.cancelled=true;await write(value);return unknown(id);}
   // Poll is a separate operation; enqueue never downloads or duplicates outputs.
   return {id,status:'queued'};
  });
 }
 async function poll(id,options={}){parseId(id);return locked(id,async()=>{const value=await read(id);checkRequest(value,options.request);return aggregate(id,value,options);});}
 async function cancel(id,{signal,request}={}){
  parseId(id);const initial=await read(id);checkRequest(initial,request);cancelRequests.add(id);
  try{return await locked(id,async()=>{const value=await read(id);checkRequest(value,request);value.cancelled=true;await write(value);for(const child of value.children)if(child.phase==='accepted')try{await cancelChild(child.id,{signal});}catch(error){if(signal?.aborted)throw signal.reason;}return {id,status:'unknown'};});}
  finally{cancelRequests.delete(id);}
 }
 return {submit,poll,cancel};
}
module.exports={createVideoDepthBatch};
