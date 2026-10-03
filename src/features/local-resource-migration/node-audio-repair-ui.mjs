import {createNodeAudioRepair,isRepairableAudio} from './node-audio-repair.mjs';

const opened=new WeakMap();
export function openNodeAudioRepair({app,nodeId,assets=window.LocalAssets,getJobs=()=>window.GenerationAPI?.getJobs()||[],isCurrent=()=>true,readProject=()=>app.projectSnapshot(),document=globalThis.document,...adapters}={}){
 if(opened.has(app)){const current=opened.get(app);current.element.focus();return current;}
 const previousFocus=document.activeElement,node=app.getState().nodes.find(item=>item.id===nodeId);
 if(!isRepairableAudio(node,adapters.getAudioSource))throw Error('此节点没有待修复的旧音频');
 if(!document.querySelector('link[data-local-audio-repair]')){
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./node-audio-repair.css',import.meta.url).href;link.dataset.localAudioRepair='';document.head.append(link);
 }
 const dialog=document.createElement('dialog');dialog.className='local-audio-repair';dialog.setAttribute('aria-labelledby','local-audio-repair-title');
 const title=document.createElement('h2');title.id='local-audio-repair-title';title.textContent='导入本地音频修复节点';
 const description=document.createElement('p');description.textContent=`为「${node.title||node.label||'音频节点'}」选择替换文件。仅替换此节点的音频，读取真实时长与波形；所选文件作为用户导入素材，不认定为原站原件。`;
 const label=document.createElement('label');label.textContent='浏览器可解码音频 · 50 MiB 以内';
 const input=document.createElement('input');input.type='file';input.accept='audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm';label.append(input);
 const status=document.createElement('p');status.className='repair-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='选择文件后导入。旧音频引用不会被请求。';
 const controls=document.createElement('div');controls.className='repair-actions';
 const apply=document.createElement('button');apply.type='button';apply.textContent='导入并替换';apply.disabled=true;
 const retry=document.createElement('button');retry.type='button';retry.textContent='重试保存';retry.hidden=true;
 const close=document.createElement('button');close.type='button';close.textContent='关闭';controls.append(close,retry,apply);dialog.append(title,description,label,status,controls);document.body.append(dialog);
 let busy=false,disposed=false;
 let service;
 try{service=createNodeAudioRepair({nodeId,getNode:id=>app.getState().nodes.find(item=>item.id===id),getProjectId:()=>app.projectIdentity().id,isCurrent:()=>!disposed&&dialog.isConnected&&isCurrent()===true,getJobs,assets,updateNode:(id,patch)=>app.updateNode(id,patch),saveProject:()=>app.saveProject(),readProject,...adapters});}
 catch(error){dialog.remove();throw error;}
 function setBusy(value){busy=value;input.disabled=value||!!service.status();apply.disabled=value||!input.files.length||!!service.status();retry.disabled=value;close.disabled=value;}
 function report(result){
  input.disabled=true;apply.hidden=true;retry.hidden=result.persisted;
  status.textContent=result.persisted?`已替换并保存。音频 ${result.duration.toFixed(3)} 秒，解码采样率 ${result.sampleRate} Hz、${result.channels} 通道，${result.bytes} 字节。可使用画布撤销恢复旧节点。`:`本地音频已应用，尚未确认画布保存：${result.saveError}。请保留此页面并重试保存。`;
  dialog.dataset.repairState=result.persisted?'saved':'applied_unsaved';
 }
 async function run(operation){
  const manageFocus=[apply,retry].includes(document.activeElement);setBusy(true);status.textContent='正在解码音频与波形、保存素材并核对回读字节…';
  try{report(await operation());}catch(error){status.textContent='未替换节点：'+error.message;dialog.dataset.repairState='rejected';}
  finally{setBusy(false);if(manageFocus&&[apply,retry,dialog,document.body].includes(document.activeElement))(service.status()?(service.status().persisted?close:retry):apply).focus();}
 }
 input.onchange=()=>{apply.disabled=busy||!input.files.length;};apply.onclick=()=>run(()=>service.repair(input.files[0]));retry.onclick=()=>run(()=>service.retrySave());
 function dispose(){
  if(busy)return;const restore=dialog.contains(document.activeElement)||document.activeElement===document.body;disposed=true;dialog.close();dialog.remove();opened.delete(app);
  if(!restore||isCurrent()!==true)return;
  const target=previousFocus?.isConnected?previousFocus:app.getNodeElement?.(nodeId);
  if(target?.isConnected&&(document.activeElement===document.body||document.activeElement===previousFocus)){
   const temporary=!target.hasAttribute('tabindex');if(temporary)target.tabIndex=-1;target.focus({preventScroll:true});if(temporary)target.removeAttribute('tabindex');
  }
 }
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&(event.isComposing||event.repeat||event.keyCode===229))event.preventDefault();});
 close.onclick=dispose;dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
 const handle={element:dialog,close:dispose,service};opened.set(app,handle);dialog.showModal();return handle;
}
