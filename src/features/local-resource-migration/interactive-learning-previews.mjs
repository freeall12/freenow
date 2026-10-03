import {prepareInteractiveLearning,interactiveLearningUri} from '../agent-apps/interactive-learning.mjs';
import {importIndexedAsset} from './import-asset.mjs';
import {hashSource as digestSource,isStaticAssetRef} from './index-format.mjs';
import {decodeActorPreview} from './actor-previews.mjs';

export const interactiveLearningPreviewSlots=Object.freeze(['preview_url','learner_preview_url','contrast_url']);
export const interactiveLearningPreviewChars=250000;
export const interactiveLearningPreviewBytes=187476;
const placeholder='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw Error('互动学习预览记录无效，原记录未修改');};
export function isInteractiveLearningPreviewDataUrl(value){
 if(typeof value!=='string'||value.length>interactiveLearningPreviewChars||!/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return false;
 const payload=value.slice(value.indexOf(',')+1);if(!payload)return false;
 try{return btoa(atob(payload))===payload;}catch{return false;}
}
export function isInteractiveLearningPreviewTrace(trace){
 return trace?.name==='show_app'&&trace.status==='done'&&!trace.error&&!trace.result?.error&&trace.result?.kind==='mcp_app'&&trace.args?.resource_uri===interactiveLearningUri&&trace.result.resource_uri===interactiveLearningUri&&trace.result.response?.view==='board';
}
function legacySource(value){
 if(typeof value!=='string'||!value.length||value.length>interactiveLearningPreviewChars)return false;
 try{encodeURIComponent(value);if(isStaticAssetRef(value))return true;const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
// Only exact preview slots in this validation copy may be projected to local
// bytes. The returned source/candidate is never replaced by a placeholder.
export function validateInteractiveLearningPreviewResponse(response,{allowLegacy=false}={}){
 if(!object(response)||response.view!=='board'||Object.keys(response).some(key=>!['title','summary','view','locale','level'].includes(key))||response.summary!==response.title||!object(response.level))fail();
 const projected=structuredClone(response);
 for(const slot of interactiveLearningPreviewSlots)if(Object.hasOwn(projected.level,slot)){
  const source=projected.level[slot];
  if(isInteractiveLearningPreviewDataUrl(source))continue;
  if(!allowLegacy||!legacySource(source))fail();
  projected.level[slot]=placeholder;
 }
 const {title,summary,...data}=projected;prepareInteractiveLearning(data,title);return response;
}
function encode(bytes,mime){let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));return `data:${mime};base64,${btoa(binary)}`;}

export function createInteractiveLearningPreviewMigration({assets,fetchImpl,hashSource=digestSource,hashBytes,decodePreview=decodeActorPreview,importAsset=importIndexedAsset}={}){
 const imported=new Map();
 return async(snapshot,index)=>{
  const changes=[],unresolved=[];let references=0,alreadyLocal=0;
  for(const [i,chat]of snapshot.chats.entries())for(const [j,trace]of (chat.messages||[]).entries()){
   if(!isInteractiveLearningPreviewTrace(trace))continue;
   const response=trace.result.response,path=`$.chats[${i}].messages[${j}].result.response.level`;
   try{validateInteractiveLearningPreviewResponse(response,{allowLegacy:true});}
   catch{unresolved.push({path,code:'invalid_learning_preview_record'});continue;}
   const mapped=[];let blocked=false;
   for(const slot of interactiveLearningPreviewSlots)if(Object.hasOwn(response.level,slot)){
    const source=response.level[slot],at=path+'.'+slot;references++;
    if(isInteractiveLearningPreviewDataUrl(source)){alreadyLocal++;continue;}
    let entry;
    if(isStaticAssetRef(source)){const ref='/assets/'+source.replace(/^(?:\.\/|\/)?assets\//,'');entry=Object.values(index.entries).find(row=>row.ref===ref);}
    else entry=index.entries[await hashSource(source)];
    if(!entry){unresolved.push({path:at,code:'local_import_required'});blocked=true;continue;}
    mapped.push({slot,entry,path:at});
   }
   // A partially migrated board would still fail the production local-only
   // contract. Publish this card only after every actual slot can be local.
   if(blocked)continue;
   const candidate=structuredClone(response),cardChanges=[];
   for(const {slot,entry,path:at}of mapped){
    const cacheKey=[entry.ref,entry.sha256,entry.bytes].join(':');
    if(!imported.has(cacheKey)){
     const pending=Promise.resolve().then(async()=>{
      let value;
      await importAsset(entry.ref,{index,fetchImpl,expectedKind:'image',maxBytes:interactiveLearningPreviewBytes,...(hashBytes?{hashBytes}:{}),assets:{put:async blob=>{
       if(!/^image\/(?:png|jpeg|webp)$/.test(blob.type)||!blob.size||blob.size>interactiveLearningPreviewBytes)throw Error('互动学习预览图片类型或容量无效');
       const dimensions=await decodePreview(blob);
       if(!Number.isSafeInteger(dimensions?.width)||!Number.isSafeInteger(dimensions?.height)||dimensions.width<1||dimensions.height<1||dimensions.width>8192||dimensions.height>8192||dimensions.width*dimensions.height>16777216)throw Error('互动学习预览图片实际尺寸无效或超限');
       value=encode(new Uint8Array(await blob.arrayBuffer()),blob.type);if(!isInteractiveLearningPreviewDataUrl(value))throw Error('互动学习预览超过保存上限');
       if(typeof assets?.put!=='function')throw Error('互动学习本地素材存储尚未就绪');return assets.put(blob);
      }}});
      if(!value)throw Error('互动学习预览缺少实际核验字节');return value;
     });imported.set(cacheKey,pending);pending.catch(()=>{if(imported.get(cacheKey)===pending)imported.delete(cacheKey);});
    }
    const value=await imported.get(cacheKey);candidate.level[slot]=value;cardChanges.push({path:at,ref:value});
   }
   validateInteractiveLearningPreviewResponse(candidate);
   for(const {slot}of mapped)response.level[slot]=candidate.level[slot];changes.push(...cardChanges);
  }
  return {changes,unresolved,summary:{references,changed:changes.length,unresolved:unresolved.length,alreadyLocal}};
 };
}
