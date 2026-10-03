import {createNodeVideoRepair,isRepairableVideo} from './node-video-repair.mjs';

const opened=new WeakMap();
export function openNodeVideoRepair({app,nodeId,assets=window.LocalAssets,getJobs=()=>window.GenerationAPI?.getJobs()||[],isCurrent=()=>true,readProject=()=>app.projectSnapshot(),document=globalThis.document,...adapters}={}){
 if(opened.has(app)){const current=opened.get(app);current.element.focus();return current;}
 const previousFocus=document.activeElement,node=app.getState().nodes.find(item=>item.id===nodeId);
 if(!isRepairableVideo(node,adapters.getVideoSource))throw Error('此节点没有待修复的旧视频');
 if(!document.querySelector('link[data-local-video-repair]')){
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./node-video-repair.css',import.meta.url).href;link.dataset.localVideoRepair='';document.head.append(link);
 }
 const dialog=document.createElement('dialog');dialog.className='local-video-repair';dialog.setAttribute('aria-labelledby','local-video-repair-title');
 const title=document.createElement('h2');title.id='local-video-repair-title';title.textContent='导入本地视频修复节点';
 const description=document.createElement('p');description.textContent=`为「${node.title||node.label||'视频节点'}」选择替换文件。替换此节点的视频并从新文件生成首帧封面，重置裁剪范围；所选文件作为用户导入素材，不认定为原站原件。`;
 const label=document.createElement('label');label.textContent='浏览器可解码视频 · 100 MiB 以内';
 const input=document.createElement('input');input.type='file';input.accept='video/*';label.append(input);
 const status=document.createElement('p');status.className='repair-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='选择文件后导入。旧视频引用不会被请求。';
 const controls=document.createElement('div');controls.className='repair-actions';
 const apply=document.createElement('button');apply.type='button';apply.textContent='导入并替换';apply.disabled=true;
 const retry=document.createElement('button');retry.type='button';retry.textContent='重试保存';retry.hidden=true;
 const close=document.createElement('button');close.type='button';close.textContent='关闭';controls.append(close,retry,apply);dialog.append(title,description,label,status,controls);document.body.append(dialog);
 let busy=false,disposed=false;
 let service;
 try{service=createNodeVideoRepair({nodeId,getNode:id=>app.getState().nodes.find(item=>item.id===id),getProjectId:()=>app.projectIdentity().id,isCurrent:()=>!disposed&&dialog.isConnected&&isCurrent()===true,getJobs,assets,updateNode:(id,patch)=>app.updateNode(id,patch),saveProject:()=>app.saveProject(),readProject,...adapters});}
 catch(error){dialog.remove();throw error;}
 function setBusy(value){busy=value;input.disabled=value||!!service.status();apply.disabled=value||!input.files.length||!!service.status();retry.disabled=value;close.disabled=value;}
 function report(result){
  input.disabled=true;apply.hidden=true;retry.hidden=result.persisted;
  status.textContent=result.persisted?`已替换并保存。视频 ${result.width} × ${result.height}，${result.duration.toFixed(3)} 秒，${result.bytes} 字节。可使用画布撤销恢复旧节点。`:`本地视频已应用，尚未确认画布保存：${result.saveError}。请保留此页面并重试保存。`;
  dialog.dataset.repairState=result.persisted?'saved':'applied_unsaved';
 }
 async function run(operation){
  const manageFocus=[apply,retry].includes(document.activeElement);setBusy(true);status.textContent='正在解码视频及首帧封面、保存素材并核对回读字节…';
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
