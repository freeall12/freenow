import {prepareActorEmotion,actorEmotionUri} from '../agent-apps/actor-emotion.mjs';
import {importIndexedAsset} from './import-asset.mjs';
import {hashSource as digestSource,isStaticAssetRef} from './index-format.mjs';

export const actorPreviewChars=500000;
export const actorPreviewBytes=374976;
const mimePattern=/^image\/(?:png|jpeg|webp)$/;
export function isActorPreviewDataUrl(value){
 if(typeof value!=='string'||value.length>actorPreviewChars||!/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return false;
 const payload=value.slice(value.indexOf(',')+1);if(!payload)return false;
 try{return btoa(atob(payload))===payload;}catch{return false;}
}
export async function decodeActorPreview(blob){
 const image=new Image(),url=URL.createObjectURL(blob);let timer;
 try{image.src=url;await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('人物参考图片解码超时')),15000);})]);return {width:image.naturalWidth,height:image.naturalHeight};}
 finally{clearTimeout(timer);image.removeAttribute('src');URL.revokeObjectURL(url);}
}
function encode(bytes,mime){let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));return `data:${mime};base64,${btoa(binary)}`;}

// This is a display-only field. Original tool arguments, node fingerprints,
// saved expression guides and recovery journals never become migration slots.
export function createActorPreviewMigration({assets,fetchImpl,hashSource=digestSource,hashBytes,decodePreview=decodeActorPreview,importAsset=importIndexedAsset}={}){
 const imported=new Map();
 return async(snapshot,index)=>{
  const changes=[],unresolved=[];let references=0,alreadyLocal=0;
  for(const [i,chat]of snapshot.chats.entries())for(const [j,trace]of (chat.messages||[]).entries()){
   if(trace.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error||trace.result?.kind!=='mcp_app'||trace.args?.resource_uri!==actorEmotionUri||trace.result.resource_uri!==actorEmotionUri)continue;
   const response=trace.result.response,path=`$.chats[${i}].messages[${j}].result.response.actor.reference_nodes`;
   try{const {version,title,summary,...data}=response;const prepared=prepareActorEmotion(data,title);if(version!==1||summary!==prepared.summary)throw Error('invalid actor record');}
   catch{unresolved.push({path,code:'invalid_actor_preview_record'});continue;}
   for(const [k,item]of response.actor.reference_nodes.entries()){
    const at=path+`[${k}].preview_url`,source=item.preview_url;references++;
    if(isActorPreviewDataUrl(source)){alreadyLocal++;continue;}
    let entry;
    if(isStaticAssetRef(source)){const ref='/assets/'+source.replace(/^(?:\.\/|\/)?assets\//,'');entry=Object.values(index.entries).find(row=>row.ref===ref);}
    else if(/^https?:\/\//i.test(source))entry=index.entries[await hashSource(source)];
    if(!entry){unresolved.push({path:at,code:'local_import_required'});continue;}
    const key=[entry.ref,entry.sha256,entry.bytes].join(':');
    if(!imported.has(key)){
     const pending=Promise.resolve().then(async()=>{
      let value;
      await importAsset(entry.ref,{index,fetchImpl,expectedKind:'image',maxBytes:actorPreviewBytes,...(hashBytes?{hashBytes}:{}),assets:{put:async blob=>{
       if(!mimePattern.test(blob.type)||!blob.size||blob.size>actorPreviewBytes)throw Error('人物参考图片类型或容量无效');
       const dimensions=await decodePreview(blob);
       if(!Number.isSafeInteger(dimensions?.width)||!Number.isSafeInteger(dimensions?.height)||dimensions.width<1||dimensions.height<1||dimensions.width>8192||dimensions.height>8192||dimensions.width*dimensions.height>16777216)throw Error('人物参考图片实际尺寸无效或超限');
       value=encode(new Uint8Array(await blob.arrayBuffer()),blob.type);if(!isActorPreviewDataUrl(value))throw Error('人物参考预览超过保存上限');
       if(typeof assets?.put!=='function')throw Error('人物参考本地素材存储尚未就绪');return assets.put(blob);
      }}});
      if(!value)throw Error('人物参考缺少实际核验字节');return value;
     });imported.set(key,pending);pending.catch(()=>{if(imported.get(key)===pending)imported.delete(key);});
    }
    item.preview_url=await imported.get(key);changes.push({path:at,ref:item.preview_url});
   }
  }
  return {changes,unresolved,summary:{references,changed:changes.length,unresolved:unresolved.length,alreadyLocal}};
 };
}
