import {migrateGenerationHistorySnapshot} from '../local-resource-migration/snapshot.mjs';
import {loadResourceIndex} from '../local-resource-migration/canvas-load.mjs';
import {isStaticAssetRef,validateResourceIndex} from '../local-resource-migration/index-format.mjs';
import {importIndexedAsset} from '../local-resource-migration/import-asset.mjs';

const mediaKeys=['url','sourceUrl','image','fullImage','video','audio','poster','thumbnail'];
const outputIsWorld=output=>output?.type==='model'&&(output.format==='spz'||output.world!==undefined||output.representation==='gaussianSplat');
function position(snapshot,path){
 const parts=[...path.matchAll(/\.([A-Za-z][A-Za-z0-9]*)|\[(\d+)\]/g)].map(match=>match[1]??Number(match[2]));
 let target=snapshot;for(const key of parts.slice(0,-1)){target=target?.[key];if(!target||typeof target!=='object')throw Error('历史迁移资源位置无效');}
 return {target,key:parts.at(-1)};
}
function kindFor(snapshot,path){
 if(/\.(?:image|fullImage|poster|thumbnail|thumbnailRef)$/.test(path))return 'image';
 const receipt=path.match(/^\$\.receipts\[(\d+)\]\.outputs\[(\d+)\]/);
 if(receipt)return snapshot.receipts[Number(receipt[1])].outputs[Number(receipt[2])].type;
 const row=path.match(/^\$\.rows\[(\d+)\]/);return row?snapshot.rows[Number(row[1])].type:undefined;
}
function staticPositions(snapshot){
 const positions=[];
 const field=(target,key,path)=>{if(isStaticAssetRef(target?.[key]))positions.push({path:path+'.'+key,ref:target[key]});};
 snapshot.receipts.forEach((receipt,i)=>receipt.outputs?.forEach((output,j)=>{
  if(['image','video','audio','model'].includes(output?.type))for(const key of mediaKeys)field(output,key,`$.receipts[${i}].outputs[${j}]`);
 }));
 snapshot.rows.forEach((row,i)=>{
  if(!['image','video','audio','model'].includes(row.type))return;
  for(const key of ['source','mediaRef','thumbnailRef'])field(row,key,`$.rows[${i}]`);
  if(row.type==='model'){
   for(const key of ['image','fullImage','poster','thumbnail'])field(row.worldPatch,key,`$.rows[${i}].worldPatch`);
   for(const key of ['url','sourceUrl','thumbnail'])field(row.worldPatch?.worldResource,key,`$.rows[${i}].worldPatch.worldResource`);
  }
 });return positions;
}

// One explicit action owns the cache across CAS retries. Only indexed local
// bytes are read; a missing mapping never authorizes reading the original URL.
export function createHistoryMigration({assets,fetchImpl=globalThis.fetch,index,loadIndex=()=>loadResourceIndex({fetchIndex:fetchImpl}),importAsset=importIndexedAsset,hashSource,hashBytes}={}){
 const imported=new Map();
 return async original=>{
  const loaded=index?{index,state:'ready'}:await loadIndex();
  if(loaded.state!=='ready')return {snapshot:structuredClone(original),changes:[],unresolved:[],status:loaded.state,summary:null};
  const table=validateResourceIndex(loaded.index),result=await migrateGenerationHistorySnapshot(original,{index:table,...(hashSource?{hashSource}:{})});
  const blocked=[];
  original.receipts.forEach((receipt,i)=>receipt.outputs?.forEach((output,j)=>{if(outputIsWorld(output)){
   blocked.push(`$.receipts[${i}].outputs[${j}]`);result.snapshot.receipts[i].outputs[j]=structuredClone(output);
  }}));
  original.rows.forEach((row,i)=>{const output=original.receipts.find(receipt=>receipt.taskId===row.taskId)?.outputs?.[row.outputIndex];if(row.type==='model'&&(outputIsWorld(output)||row.format==='spz'||row.worldPatch?.worldResource?.format==='spz'||row.worldPatch?.worldResource?.world)){
   blocked.push(`$.rows[${i}]`);result.snapshot.rows[i]=structuredClone(row);
  }});
  const blockedPath=path=>blocked.some(prefix=>path===prefix||path.startsWith(prefix+'.')||path.startsWith(prefix+'['));
  const diagnostics=result.unresolved.map(value=>({...value,...(blockedPath(value.path)?{code:'unimplemented_world_archive'}:{})}));
  const candidates=new Map(result.changes.map(change=>[change.path,change]));
  for(const item of staticPositions(result.snapshot))if(!candidates.has(item.path))candidates.set(item.path,item);
  const changes=[];
  for(const item of candidates.values()){
   if(blockedPath(item.path)){diagnostics.push({path:item.path,code:'unimplemented_world_archive'});continue;}
   const slot=position(result.snapshot,item.path);if(slot.target[slot.key]!==item.ref)throw Error('历史迁移来源已变化');
   const ref='/assets/'+item.ref.replace(/^(?:\.\/|\/)?assets\//,''),entry=item.sourceHash?table.entries[item.sourceHash]:Object.values(table.entries).find(value=>value.ref===ref);
   if(!entry||entry.ref!==ref){diagnostics.push({path:item.path,code:'unindexed_static_ref'});continue;}
   const expectedKind=kindFor(result.snapshot,item.path),cacheKey=[ref,entry.sha256,entry.bytes,expectedKind].join(':');
   if(!imported.has(cacheKey))imported.set(cacheKey,Promise.resolve().then(()=>importAsset(ref,{index:table,assets,fetchImpl,expectedKind,maxBytes:(expectedKind==='model'?12:expectedKind==='audio'?50:100)*1024*1024,...(hashBytes?{hashBytes}:{})})));
   const saved=await imported.get(cacheKey);if(typeof saved!=='string'||!/^asset:[^\s]+$/.test(saved))throw Error('历史迁移未保存真实本地素材');
   slot.target[slot.key]=saved;changes.push({...item,ref:saved});
  }
  const unique=[...new Map(diagnostics.map(value=>[value.path,{path:value.path,code:value.code}])).values()];
  return {snapshot:result.snapshot,changes,unresolved:unique,status:unique.length?'pending_import':'ready',summary:{references:result.summary.references,changed:changes.length,unresolved:unique.length,alreadyLocal:Math.max(0,result.summary.references-changes.length-unique.length)}};
 };
}
export function historyMigrationNotice(report){
 if(report?.status==='index_missing')return '本地资源索引尚未生成，历史原引用已保留。';
 if(report?.status==='index_invalid')return '本地资源索引格式无效，历史原引用已保留。';
 if(report?.status==='index_unavailable')return '本地资源索引暂时无法读取，历史原引用已保留。';
 const count=report?.summary?.changed||0,pending=report?.summary?.unresolved||0,world=report?.diagnostics?.some(value=>value.code==='unimplemented_world_archive');
 if(!count&&!pending)return '没有新增可迁移的历史素材引用。';
 return (count?`已迁移 ${count} 项历史素材引用`:'历史素材仍待本地导入')+(pending?`；${pending} 项仍待本地导入，原引用已保留`:'')+(world?'。SPZ 世界整组仍待专用历史支持':'')+(report.retryRequired?'。未能读取的素材可重试保存':'')+'。';
}
