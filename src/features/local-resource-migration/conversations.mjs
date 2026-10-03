import {hashSource as digestSource,isStaticAssetRef,validateResourceIndex} from './index-format.mjs';
import {loadResourceIndex} from './canvas-load.mjs';
import {importIndexedAsset} from './import-asset.mjs';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateConversationSnapshot(value){
 if(!object(value)||!Array.isArray(value.chats)||typeof value.activeId!=='string'||value.chats.some(chat=>!object(chat)||typeof chat.id!=='string')||new Set(value.chats.map(chat=>chat.id)).size!==value.chats.length)throw Error('会话迁移需要完整权威记录');
 return value;
}
function uploads(snapshot){
 const slots=[];
 const visit=(container,path)=>{
  if(container.uploads===undefined)return;
  if(!Array.isArray(container.uploads)||container.uploads.some(upload=>!object(upload)))throw Error('会话附件结构无效，原记录未修改');
  container.uploads.forEach((upload,index)=>slots.push({upload,path:path+'.uploads['+index+']'}));
 };
 snapshot.chats.forEach((chat,index)=>{
  const path='$.chats['+index+']';visit(chat,path);
  for(const key of ['messages','queuedMessages']){
   if(chat[key]===undefined)continue;
   if(!Array.isArray(chat[key])||chat[key].some(message=>!object(message)))throw Error('会话消息结构无效，原记录未修改');
   chat[key].forEach((message,at)=>visit(message,path+'.'+key+'['+at+']'));
  }
 });return slots;
}

// Actual uploads use asset for the submitted media, and the queue may read an
// optional image cover. Tool arguments, journals and app bindings are not slots.
export function createConversationMigration({assets,fetchImpl=globalThis.fetch,index,loadIndex=()=>loadResourceIndex({fetchIndex:fetchImpl}),hashSource=digestSource,hashBytes,importAsset=importIndexedAsset}={}){
 const imported=new Map();
 return async original=>{
  validateConversationSnapshot(original);
  const snapshot=structuredClone(original),slots=uploads(snapshot),loaded=index?{index,state:'ready'}:await loadIndex();
  if(loaded.state!=='ready')return {snapshot,changes:[],unresolved:[],status:loaded.state,summary:null};
  const table=validateResourceIndex(loaded.index),changes=[],unresolved=[];let references=0,alreadyLocal=0;
  for(const {upload,path} of slots)for(const key of ['asset','image']){
   const source=upload[key];if(source===undefined||source===null||source==='')continue;
   const at=path+'.'+key;references++;
   if(!['image','video'].includes(upload.type)){unresolved.push({path:at,code:'unsupported_upload_type'});continue;}
   if(typeof source!=='string'){unresolved.push({path:at,code:'invalid_media_ref'});continue;}
   if(/^asset:[^\s]+$/.test(source)||/^data:(?:image|video)\//.test(source)){alreadyLocal++;continue;}
   let entry;
   if(isStaticAssetRef(source)){
    const ref='/assets/'+source.replace(/^(?:\.\/|\/)?assets\//,'');entry=Object.values(table.entries).find(row=>row.ref===ref);
    if(!entry){unresolved.push({path:at,code:'unindexed_static_ref'});continue;}
   }else if(/^https?:\/\//.test(source)){
    const sourceHash=await hashSource(source);entry=table.entries[sourceHash];
    if(!entry){unresolved.push({path:at,code:'local_import_required'});continue;}
   }else{unresolved.push({path:at,code:source.startsWith('blob:')?'transient_blob':'invalid_media_ref'});continue;}
   const expectedKind=key==='image'?'image':upload.type,cacheKey=[entry.ref,entry.sha256,entry.bytes,expectedKind].join(':');
   if(!imported.has(cacheKey)){
    const pending=Promise.resolve().then(()=>importAsset(entry.ref,{index:table,assets,fetchImpl,expectedKind,maxBytes:100*1024*1024,...(hashBytes?{hashBytes}:{})}));
    imported.set(cacheKey,pending);pending.catch(()=>{if(imported.get(cacheKey)===pending)imported.delete(cacheKey);});
   }
   const saved=await imported.get(cacheKey);if(typeof saved!=='string'||!/^asset:[^\s]+$/.test(saved))throw Error('会话附件未保存为真实本地素材');
   upload[key]=saved;changes.push({path:at,ref:saved});
  }
  return {snapshot,changes,unresolved,status:unresolved.length?'pending_import':'ready',summary:{references,changed:changes.length,unresolved:unresolved.length,alreadyLocal}};
 };
}
