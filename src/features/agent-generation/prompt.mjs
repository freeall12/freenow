import {icons as subjectIcons} from '../subject-library/icons.mjs';
import {assetSegments,assetReference} from '../node-composer/library-mentions.mjs';
import {subjectSegments} from '../subject-library/model.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {promptIcons} from './prompt-icons.mjs';
import {audioTypeIcon} from './audio-assets.mjs';

// Official Aoe / joe: ordinal tokens bind only when the whole reference shape is known.
export function generationPromptParts(value,args={},nodes=[]){
 const refs=(args.referenceIds??(args.kind==='audio.generate'?[]:[args.nodeId])).map(id=>nodes.find(node=>node.id===id));
 const type=node=>node?.video?'video':node?.audio?'audio':node?.image?'image':null;
 const bindings=new Map(),counts={};
 if(refs.every(node=>type(node)))for(const node of refs){const kind=type(node),index=counts[kind]=(counts[kind]||0)+1;bindings.set(kind+':'+index,node);}
 const parts=[];
 for(const asset of assetSegments(value||'')){
  if(typeof asset!=='string'){const ref=assetReference(asset.asset);parts.push({token:asset.token,label:ref.title,type:ref.type,thumbnail:ref.thumbnail||(ref.type==='image'?ref.url:'')||'',url:ref.url||'',text:ref.text||''});continue;}
  for(const subject of subjectSegments(asset)){
   if(typeof subject!=='string'){parts.push({token:subject.token,label:subject.name,type:'element',subjectId:subject.id});continue;}
   let end=0;
   for(const match of subject.matchAll(/\{\{(Image|Video|Audio|Element|Text)\s+(\d+)\}\}/g)){
    if(match.index>end)parts.push(subject.slice(end,match.index));
    const kind=match[1].toLowerCase(),node=bindings.get(kind+':'+Number(match[2]));
    parts.push({token:match[0],label:node?.title||match[1]+' '+match[2],type:kind,nodeId:node?.id||'',thumbnail:node?.image||'',url:node?.video||node?.audio||node?.fullImage||node?.image||'',text:node?.content||''});end=match.index+match[0].length;
   }
   if(end<subject.length)parts.push(subject.slice(end));
  }
 }
 return parts;
}
export function generationPromptDocument(value,args,nodes){
 const blocks=[{type:'paragraph',content:[]}];
 for(const part of generationPromptParts(value,args,nodes)){
  if(typeof part!=='string'){blocks.at(-1).content.push({type:'generationMention',attrs:part});continue;}
  part.split('\n').forEach((text,index)=>{if(index)blocks.push({type:'paragraph',content:[]});if(text)blocks.at(-1).content.push({type:'text',text});});
 }
 return {type:'doc',content:blocks};
}
export function generationPromptText(doc){
 const inline=node=>node.type==='text'?node.text||'':node.type==='hardBreak'?'\n':node.type==='generationMention'?node.attrs.token:(node.content||[]).map(inline).join('');
 return (doc.content||[]).map(inline).join('\n');
}
const mentionData=new WeakMap();
export const generationMentionData=element=>mentionData.get(element);
export function generationMentionDOM(ref,{onOpenNode=()=>{},resolveAsset=async url=>url,onError=()=>{},onRemove}={}){
 const root=document.createElement(onRemove?'span':ref.nodeId?'button':'span');mentionData.set(root,ref);root.dataset.mentionKind=ref.subjectId?'subject':ref.nodeId?'node':'asset';root.className='generation-mention';root.contentEditable='false';root.dataset.generationToken=ref.token;root.dataset.referenceKey=ref.nodeId||ref.token;
 const main=onRemove?document.createElement(ref.nodeId?'button':'span'):root;if(onRemove){main.className='generation-mention-main';root.append(main);}
 if(ref.nodeId){main.type='button';main.setAttribute('aria-label','查看参考：'+ref.label);main.onclick=event=>{event.stopPropagation();Promise.resolve(onOpenNode(ref.nodeId)).catch(onError);};main.onkeydown=event=>event.stopPropagation();}
 const thumb=document.createElement('span');thumb.className='generation-mention-icon';
 const placeholder=()=>{thumb.innerHTML=ref.type==='audio'?audioTypeIcon:referenceIcons[ref.type+'Type']||referenceIcons.folderType||'';};
 if(ref.thumbnail&&ref.type!=='audio'){const img=document.createElement('img');img.alt='';img.loading='lazy';img.onerror=placeholder;thumb.append(img);Promise.resolve(resolveAsset(ref.thumbnail)).then(url=>{if(root.isConnected)img.src=url;}).catch(placeholder);}
 else if(ref.type==='video'&&ref.url){const video=document.createElement('video');video.muted=true;video.preload='metadata';video.playsInline=true;video.onerror=placeholder;thumb.append(video);Promise.resolve(resolveAsset(ref.url)).then(url=>{if(root.isConnected)video.src=url;}).catch(placeholder);}
 else placeholder();
 const label=document.createElement('span');label.className='generation-mention-label';label.textContent=ref.label;if(ref.subjectId){const mark=document.createElement('span');mark.className='generation-subject-icon';mark.innerHTML=subjectIcons.subject;main.append(label,mark);}else main.append(thumb,label);
 if(onRemove){const remove=document.createElement('button');remove.type='button';remove.tabIndex=-1;remove.className='generation-mention-remove';remove.ariaLabel='移除引用 '+ref.label;remove.innerHTML=promptIcons.close;remove.onpointerdown=event=>event.preventDefault();remove.onclick=event=>{event.preventDefault();event.stopPropagation();onRemove();};root.append(remove);}
 return root;
}
export function renderGenerationPrompt(value,args,nodes,options){
 const fragment=document.createDocumentFragment();
 for(const part of generationPromptParts(value,args,nodes))fragment.append(typeof part==='string'?document.createTextNode(part):generationMentionDOM(part,options));
 return fragment;
}
