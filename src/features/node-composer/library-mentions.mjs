import {modelFor} from '../image-generation/catalog.mjs';
import {videoModels} from '../agent-generation/video-catalog.mjs';
const kinds = ['image','video','audio','text'];
const imageModels = new Set(['nano-banana','nano-banana-flash','nano-banana-flash-lite','tamar-google-gemini-pro','gpt-image-1','gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst','doubao-seedream-4.0','doubao-seedream-4.5','doubao-seedream-5.0-lite','doubao-seedream-5.0-pro']);
const videoDisabled = {'Seedance 2.0':[],'Seedance 2.0 Mini':[],'Seedance 2.0 Fast':[],'Seedance 2.5':[],'MiniMax H3':[],'Kling O1':['audio'],'Kling 3.0 Omni':['audio'],'Kling 3.0':['audio','video'],'Wan 2.6':['audio'],'Wan 3.0':['audio'],'HappyHorse 1.0':['audio'],'HappyHorse 1.1':['audio']};
export function libraryPolicy(type,model,mode) {
  if(type==='image')return {enabled:imageModels.has(modelFor(model)?.id||model),allowed:['image','text']};
  const name=videoModels.find(item=>item.id===model||item.name===model||item.aliases.includes(model))?.name||model;
  const disabled=videoDisabled[name];
  return {enabled:type==='video'&&!!disabled&&['全能参考','REFERENCE_TO_VIDEO'].includes(mode),allowed:kinds.filter(kind=>!disabled?.includes(kind))};
}
export function libraryAsset(item) {
  if(!kinds.includes(item?.type)||!item.id)return null;
  const type=item.type,scope=item.scope==='team'?'team':'personal';
  const url=type==='image'?item.fullImage||item.image:type==='video'?item.video:type==='audio'?item.audio:undefined;
  const data={id:item.id,nodeId:item.id,nodeType:type,nodeName:item.name||item.title||type,scope,...(url?{mediaSrc:url}:{}),...(item.image?{previewImage:item.image}:{}),...(type==='text'?{content:item.content||''}:{})};
  if(Number.isFinite(item.durationMs)&&item.durationMs>0)data.durationMs=item.durationMs;
  return data;
}
export function assetToken(asset) {return '{{Asset:'+JSON.stringify(asset)+'}}';}
function validAsset(data) {
  return data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.id==='string'&&data.id&&typeof data.nodeId==='string'&&data.nodeId&&kinds.includes(data.nodeType)&&['nodeName','mediaSrc','previewImage','content','scope'].every(key=>data[key]===undefined||typeof data[key]==='string');
}
// Count JSON braces outside quoted strings: text assets may contain literal braces or quotes.
export function assetSegments(prompt='') {
  const result=[];let cursor=0,scan=0;
  while(scan<prompt.length){const start=prompt.indexOf('{{Asset:',scan);if(start<0)break;let depth=0,quoted=false,escaped=false,end=-1;
    for(let i=start+8;i<prompt.length;i++){const c=prompt[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){if(prompt.slice(i+1,i+3)==='}}')end=i+3;break;}}}
    if(end<0){scan=start+8;continue;}let asset;try{asset=JSON.parse(prompt.slice(start+8,end-2));}catch{}if(!validAsset(asset)){scan=end;continue;}
    result.push(prompt.slice(cursor,start),{token:prompt.slice(start,end),asset});cursor=end;scan=end;
  }
  result.push(prompt.slice(cursor));return result;
}
export function assetReference(asset) {
  const type=asset.nodeType,url=asset.mediaSrc,title=asset.nodeName||type;
  return {key:'library:'+(asset.scope||'personal')+':'+asset.id,type,title,url,thumbnail:asset.previewImage,text:asset.content,empty:type==='text'?!asset.content?.trim():!url};
}
export function assetReferences(prompt) {return assetSegments(prompt).filter(part=>typeof part!=='string').map(part=>assetReference(part.asset));}
export function projectAssets(prompt, inputs, allowed=kinds) {
  const output=inputs.map(input=>({...input}));
  const text=assetSegments(prompt).map(part=>{
    if(typeof part==='string')return part;
    const item=assetReference(part.asset);
    if(!allowed.includes(item.type))throw Error('当前模型不支持引用此类素材：'+item.title);
    if(item.empty)throw Error('引用的素材没有内容：'+item.title);
    if(item.type==='text')return item.text;
    let index=output.filter(input=>input.type===item.type).findIndex(input=>input.url===item.url||input.sourceUrl===item.url);
    if(index<0){index=output.filter(input=>input.type===item.type).length;output.push({type:item.type,url:item.url,id:part.asset.id,title:item.title,source:'library',scope:part.asset.scope||'personal'});}
    return '{{'+item.type[0].toUpperCase()+item.type.slice(1)+' '+(index+1)+'}}';
  }).join('');
  return {prompt:text,inputs:output};
}
