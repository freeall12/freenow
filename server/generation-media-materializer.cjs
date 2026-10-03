'use strict';
const {createHash}=require('node:crypto');
const {checkedAudioSubtitle}=require('./generation-audio-subtitle.cjs');
const {createGenerationMediaDownloader,publicMediaUrl,resourceMimeCompatible}=require('./generation-media-download.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LOCAL=/^\/api\/generation\/media\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const fail=code=>Object.assign(Error('生成素材本地保存尚未完成'),{code});
const object=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
const check=signal=>{if(signal?.aborted)throw fail('media_cancelled');};
function shape(value,allowed){if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw fail('media_invalid_outputs');}
function describe(outputs){
 if(!Array.isArray(outputs)||!outputs.length||outputs.length>50)throw fail('media_invalid_outputs');
 const cloned=structuredClone(outputs),entries=[];let characters=0;
 const add=(parent,key,kind,index,role)=>{
  if(parent[key]===undefined)return;if(typeof parent[key]!=='string'||!parent[key]||parent[key].startsWith('blob:'))throw fail(parent[key]?.startsWith?.('blob:')?'media_blob_forbidden':'media_invalid_outputs');
  const source=parent[key];characters+=source.length;if(characters>720*1024*1024)throw fail('media_task_too_large');
  if(!LOCAL.test(source)&&!source.startsWith('data:'))publicMediaUrl(source);
  if(!source.startsWith('data:')&&source.length>8192)throw fail('media_invalid_outputs');
  entries.push({source,kind,index,role,set:value=>{parent[key]=value;}});
 };
 for(const [index,output]of cloned.entries()){
  shape(output,['type','url','image','video','audio','model','text','title','width','height','duration','sourceFileId','poster','sourceUrl','sourceRange','format','representation','filename','fullImage','world','mime','subtitle']);
  if(!['image','video','audio','model','text'].includes(output.type))throw fail('media_invalid_outputs');
  const subtitle=checkedAudioSubtitle(output,{code:'media_invalid_outputs'});if(subtitle!==undefined)output.subtitle=subtitle;else delete output.subtitle;
  if(output.mime!==undefined&&(typeof output.mime!=='string'||output.mime.length>100||!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(output.mime)))throw fail('media_invalid_outputs');
  if(output.type==='text'){if(typeof output.text!=='string')throw fail('media_invalid_outputs');if(['url','image','video','audio','model','poster','fullImage','sourceUrl','world'].some(key=>output[key]!==undefined))throw fail('media_invalid_outputs');continue;}
  if(!output.url&&!output[output.type])throw fail('media_invalid_outputs');
  const kind=output.type==='model'?(output.format==='spz'?'spz':'glb'):output.type;
  // Type aliases are independent consumable fields, even when url is present.
  for(const key of ['url','image','video','audio','model'])if(output[key]!==undefined){if(key!=='url'&&key!==output.type)throw fail('media_invalid_outputs');add(output,key,kind,index,key==='url'?'main':'alias');}
  if(output.fullImage!==undefined&&output.type!=='image')throw fail('media_invalid_outputs');
  add(output,'fullImage','image',index,'full-image');add(output,'poster','image',index,'poster');add(output,'sourceUrl','source',index,'source');
  if(output.world!==undefined){
   if(kind!=='spz'||output.representation!=='gaussianSplat')throw fail('media_invalid_outputs');const world=output.world;
   shape(world,['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution']);
   const information=publicMediaUrl(world.marbleUrl);if(information.protocol!=='https:')throw fail('media_invalid_outputs');information.search='';information.hash='';world.marbleUrl=information.href;
   shape(world.assets,['splats','mesh','imagery']);shape(world.assets.splats,['spzUrls','semanticsMetadata']);
   const splats=world.assets.splats.spzUrls;shape(splats,['100k','150k','500k','full_res']);
   if(!Object.hasOwn(splats,world.splatResolution)||splats[world.splatResolution]!==output.url)throw fail('media_invalid_outputs');
   shape(world.assets.splats.semanticsMetadata,['metricScaleFactor','groundPlaneOffset']);
   for(const key of Object.keys(splats))add(splats,key,'spz',index,'spz-'+key.replace('_','-'));
   if(world.assets.mesh!==undefined){shape(world.assets.mesh,['colliderMeshUrl','fullResMeshUrl','hqMeshUrl']);for(const [key,role]of [['colliderMeshUrl','collider-mesh'],['fullResMeshUrl','full-res-mesh'],['hqMeshUrl','hq-mesh']])add(world.assets.mesh,key,'glb',index,role);}
   if(world.assets.imagery!==undefined){shape(world.assets.imagery,['panoUrl']);add(world.assets.imagery,'panoUrl','image',index,'pano');}
  }
 }
 return {outputs:cloned,entries};
}
async function follow(promise,signal){if(!signal)return promise;check(signal);let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(fail('media_cancelled'));signal.addEventListener('abort',abort,{once:true});});try{return await Promise.race([promise,stopped]);}finally{signal.removeEventListener('abort',abort);}}
// resolveResource is a trusted server-only callback. It may return {url,
// origin,headers}; authorization headers require an exact matching origin.
// Browser/provider output objects can never provide these headers themselves.
function createGenerationMediaMaterializer({store,resolveResource,download,limits={},maxCachedTasks=64,taskTimeoutMs=600000}={}){
 if(!store||typeof store.put!=='function'||typeof store.info!=='function'||resolveResource!==undefined&&typeof resolveResource!=='function'||download!==undefined&&typeof download!=='function'||!Number.isSafeInteger(maxCachedTasks)||maxCachedTasks<1||maxCachedTasks>500||!Number.isSafeInteger(taskTimeoutMs)||taskTimeoutMs<1||taskTimeoutMs>1800000)throw fail('media_invalid_input');
 const totalLimit=limits.taskBytes??512*1024*1024,maxResources=limits.resources??128,concurrency=limits.concurrency??2;
 if(Object.keys(limits).some(key=>!['taskBytes','resources','concurrency'].includes(key))||!Number.isSafeInteger(totalLimit)||totalLimit<1||totalLimit>512*1024*1024||!Number.isSafeInteger(maxResources)||maxResources<1||maxResources>128||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>2)throw fail('media_invalid_input');
 const fetchResource=download||createGenerationMediaDownloader().download,cache=new Map(),active=new Map(),waiting=[];let occupied=0;
 // The limit applies across tasks in this materializer, preventing simultaneous
 // generations from multiplying CDN connections and data-URL allocations.
 function acquire(signal){check(signal);if(occupied<concurrency){occupied++;return Promise.resolve();}return new Promise((resolve,reject)=>{const waiter={signal,resolve,reject};waiter.abort=()=>{const index=waiting.indexOf(waiter);if(index>=0)waiting.splice(index,1);reject(fail('media_cancelled'));};signal.addEventListener('abort',waiter.abort,{once:true});waiting.push(waiter);});}
 function release(){occupied--;while(waiting.length&&occupied<concurrency){const waiter=waiting.shift();waiter.signal.removeEventListener('abort',waiter.abort);if(waiter.signal.aborted){waiter.reject(fail('media_cancelled'));continue;}occupied++;waiter.resolve();}}
 const keyFor=(id,revision)=>id+':'+revision;
 function context(taskId,revision){const key=keyFor(taskId,revision);let value=cache.get(key);if(!value){if(cache.size>=maxCachedTasks){const expired=[...cache.keys()].find(k=>!active.has(k));if(!expired)throw fail('media_task_capacity');cache.delete(expired);}value={records:new Map(),signature:null};cache.set(key,value);}return value;}
 function validate(taskId,revision=0){if(!UUID.test(taskId)||!Number.isSafeInteger(revision)||revision<0)throw fail('media_invalid_input');}
 async function verify(outputs,{taskId}={}){
  validate(taskId);const described=describe(outputs),ids=new Set();
  for(const entry of described.entries){const match=LOCAL.exec(entry.source);if(!match)throw fail('media_not_local');ids.add(match[1]);}
  if(ids.size>maxResources)throw fail('media_resource_capacity');const manifests=[];let bytes=0;
  for(const resourceId of ids){const record=await store.info(resourceId,{taskId});const expected=described.entries.filter(entry=>entry.source.endsWith('/'+resourceId));for(const entry of expected){if(entry.kind!=='source'&&!(entry.kind==='glb'||entry.kind==='spz'?record.format===entry.kind:record.mime.startsWith(entry.kind+'/')))throw fail('media_format_invalid');if(described.outputs[entry.index].mime!==undefined&&['main','alias'].includes(entry.role)&&!resourceMimeCompatible(described.outputs[entry.index].mime,record))throw fail('media_mime_mismatch');}bytes+=record.bytes;if(bytes>totalLimit)throw fail('media_task_too_large');manifests.push(record);}
  return {resources:[...ids],manifests};
 }
 async function materialize(described,{taskId,signal,revision},state){
  const timed=AbortSignal.timeout(taskTimeoutMs),controller=new AbortController(),combined=AbortSignal.any([controller.signal,timed,...signal?[signal]:[]]),groups=new Map();
  for(const entry of described.entries){const hash=createHash('sha256').update(entry.source).digest('hex');let group=groups.get(hash);if(!group){group={...entry,hash,entries:[],kind:entry.kind};groups.set(hash,group);}if(group.kind!==entry.kind){if(group.kind==='source')group.kind=entry.kind;else if(entry.kind!=='source')throw fail('media_format_conflict');}group.entries.push(entry);}
  if(groups.size>maxResources)throw fail('media_resource_capacity');let bytes=0,next=0,firstError;
  const prepared=[];
  for(const group of groups.values()){
   const local=LOCAL.exec(group.source);let record;
   if(local)record=await store.info(local[1],{taskId});else if(state.records.has(group.hash))record=await store.info(state.records.get(group.hash).resourceId,{taskId});
   if(record){bytes+=record.bytes;if(bytes>totalLimit)throw fail('media_task_too_large');for(const entry of group.entries)entry.set('/api/generation/media/'+record.resourceId);}else prepared.push(group);
  }
  const onBytes=count=>{bytes+=count;if(bytes>totalLimit)throw fail('media_task_too_large');};
  async function worker(){while(next<prepared.length&&!firstError){const group=prepared[next++];let downloaded,leased=false;try{
    await acquire(combined);leased=true;check(combined);const descriptor=resolveResource?await follow(Promise.resolve().then(()=>resolveResource({url:group.source,taskId,outputIndex:group.index,role:group.role,kind:group.kind,revision},{signal:combined})),combined):group.source;
    check(combined);downloaded=await fetchResource(descriptor,{kind:group.kind,signal:combined,onBytes});
    check(combined);const record=await store.put({taskId,outputIndex:group.index,role:group.role,mime:downloaded.mime,format:downloaded.format,descriptorRevision:revision},downloaded.stream,{signal:combined,maxBytes:downloaded.maxBytes,...downloaded.expectedBytes!==undefined?{expectedBytes:downloaded.expectedBytes}:{}});
    state.records.set(group.hash,record);check(combined);for(const entry of group.entries)entry.set('/api/generation/media/'+record.resourceId);
   }catch(error){if(!firstError)firstError=error.code?.startsWith('media_')?error:fail('media_localization_failed');controller.abort();}finally{try{downloaded?.close?.();}finally{if(leased)release();}}}
  }
  await Promise.all(Array.from({length:Math.min(concurrency,prepared.length)},worker));if(firstError)throw firstError;check(combined);
  const result=await verify(described.outputs,{taskId});check(combined);
  for(const output of described.outputs)if(output.mime!==undefined&&output.type!=='text'){const source=output.url||output[output.type],record=result.manifests.find(item=>source==='/api/generation/media/'+item.resourceId);if(record)output.mime=record.mime;}
  return {outputs:described.outputs,...result};
 }
 async function localize(outputs,{taskId,signal,revision=0}={}){
  validate(taskId,revision);if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail('media_invalid_input');check(signal);
  const described=describe(outputs),signature=createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),key=keyFor(taskId,revision),running=active.get(key),state=context(taskId,revision);
  if(state.signature&&state.signature!==signature)throw fail('media_descriptor_conflict');state.signature=signature;
  if(running)return structuredClone(await follow(running,signal));
  const operation=materialize(described,{taskId,signal,revision},state).finally(()=>active.delete(key));active.set(key,operation);return structuredClone(await operation);
 }
 return {localize,verify};
}
module.exports={createGenerationMediaMaterializer,LOCAL_GENERATION_MEDIA_REF:LOCAL};
