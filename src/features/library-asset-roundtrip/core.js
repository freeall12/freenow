(function(root){
 'use strict';
 const clone=value=>structuredClone(value),positive=value=>Number.isFinite(value)&&value>0,identity=value=>typeof value==='string'&&value.trim()?value:null;
 const source=value=>value.type==='image'?value.fullImage||value.image:value.type==='video'?value.video:value.type==='audio'?value.audio:null;
 const metadata=(value,kind)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const result={};
  if(kind==='video')for(const key of ['width','height'])result[key]=positive(value[key])?value[key]:null;
  result.duration=positive(value.duration)?value.duration:null;
  return Object.values(result).some(value=>value!==null)?result:null;
 };
 function resultFields(value){
  const result={},type=value.type||'image',media=source({...value,type});
  if(!['image','video','audio','text'].includes(type))return result;
  for(const key of ['width','height'])if(positive(value[key]))result[key]=value[key];
  if(!media)return result;
  // Result labels and metadata cannot follow a changed source. An unlabelled
  // legacy source remains usable without inventing a generated model/prompt.
  if(value.provenance?.mediaSource&&value.provenance.mediaSource!==media)return result;
  if(type==='image'&&positive(value.pixelWidth)&&positive(value.pixelHeight))Object.assign(result,{pixelWidth:value.pixelWidth,pixelHeight:value.pixelHeight});
  if(type==='video'){
   const details=metadata(value.videoMetadata,'video');if(details)result.videoMetadata=details;
   if(value.clip&&Number.isFinite(value.clip.start)&&value.clip.start>=0&&Number.isFinite(value.clip.end)&&value.clip.end>value.clip.start)result.clip={start:value.clip.start,end:value.clip.end};
  }
  if(type==='audio'){const details=metadata(value.audioMetadata,'audio');if(details)result.audioMetadata=details;}
  for(const key of ['currentSourceFileId','sourceFileId'])if(identity(value[key]))result[key]=value[key];
  if(value.sourceRange&&typeof value.sourceRange==='object'&&!Array.isArray(value.sourceRange))result.sourceRange=clone(value.sourceRange);
  if(value.provenance&&typeof value.provenance==='object'&&!Array.isArray(value.provenance))result.provenance=clone(value.provenance);
  return result;
 }
 function capture(node,{id,name,folder,legacyVideo}={}){
  const type=node.type||'image',item={id,name:name??node.title,folder,type,nodeId:node.id};
  if(type==='image'||type==='video')item.image=node.image;
  if(type==='image'&&node.fullImage)item.fullImage=node.fullImage;
  if(type==='video')item.video=node.video||legacyVideo;
  if(type==='audio')item.audio=node.audio;
  if(type==='text'){item.content=node.content;item.color=node.color;}
  Object.assign(item,resultFields({...node,video:item.video}));
  return clone(item);
 }
 function restore(item,{legacyVideo}={}){
  const type=item.type||'image',result={image:['image','video'].includes(type)?item.image:undefined,fullImage:type==='image'?item.fullImage:undefined,video:type==='video'?item.video||legacyVideo:undefined,audio:type==='audio'?item.audio:undefined};
  Object.assign(result,resultFields({...item,type,video:result.video}));
  return result;
 }
 const api={capture,restore};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CanvasLibraryAssetRoundtrip=api;
})(typeof window==='undefined'?globalThis:window);
