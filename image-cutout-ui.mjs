import {imageResultPatch} from './src/features/image-editor/generated-results.mjs';
import {sourceOf,request,sourceMatches,untouched} from './image-cutout-core.mjs';
import {nodeSize} from './image-resize-core.mjs';
import statusIcons from './media-review-icons.mjs';
import icons from './image-cutout-icons.mjs';
const app=window.CanvasApp,operations=new Map(),current=id=>app.getState().nodes.find(n=>n.id===id);
const style=document.createElement('link');style.rel='stylesheet';style.href='image-cutout.css';document.head.append(style);
const menuButtons=new Set(),buttonBusy=new WeakMap(),decorations=new Map();let selectedPendingState;
function refreshButton(b){const busy=operations.has(b.dataset.cutoutSource);if(buttonBusy.get(b)===busy)return;buttonBusy.set(b,busy);b.disabled=busy;b.setAttribute('aria-busy',String(busy));const svg=b.querySelector('svg');if(svg&&svg.dataset.cutoutBusy!==String(busy)){svg.outerHTML=busy?statusIcons.loading:window.CANVAS_MENU_ICONS.removeBackground;const next=b.querySelector('svg');next.dataset.cutoutBusy=String(busy);next.classList.toggle('cutout-spinner',busy);}}
export function bindMenu(button,id){button.dataset.cutoutSource=id;buttonBusy.delete(button);menuButtons.add(button);refreshButton(button);}
function clearDecoration(record){record.again?.remove();record.overlay?.remove();}
function render(event){
 if(event?.detail?.viewportOnly)return;
 const state=app.getState(),live=new Set(),byTarget=new Map([...operations.values()].map(op=>[op.target,op]));let selectedPending=false;
 // Node data may mutate in place and undo may replace nodes. Scan only the cheap
 // flags; ordinary nodes never cause DOM lookups or subtree queries.
 for(const n of state.nodes){
  const pending=n.pendingOperation==='image.remove-background',rerun=!!(n.cutoutResult&&n.image&&!n.pendingOperation);
  if(!pending&&!rerun)continue;
  const e=app.getNodeElement?app.getNodeElement(n.id):document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`);if(!e)continue;live.add(n.id);
  let record=decorations.get(n.id);
  if(record?.element!==e){if(record)clearDecoration(record);record={element:e,again:null,overlay:null,placeholder:undefined,text:null,message:null};decorations.set(n.id,record);}
  if(rerun){if(record.again?.parentNode!==e){const again=document.createElement('button');again.type='button';again.className='cutout-rerun';again.setAttribute('aria-label','再次抠图');again.title='再次抠图';again.innerHTML=icons.rerun;again.onpointerdown=event=>event.stopPropagation();again.ondblclick=event=>event.stopPropagation();again.onclick=event=>{event.stopPropagation();submit(n.id,{inPlace:true});};e.append(again);record.again=again;}}
  else{record.again?.remove();record.again=null;}
  if(!pending){record.overlay?.remove();record.overlay=null;record.text=null;record.message=null;continue;}
  const message=byTarget.has(n.id)?'正在抠图…':'抠图已中断，请重新生成';
  if(!n.image){
   if(record.placeholder===undefined||record.placeholder&&!e.contains(record.placeholder))record.placeholder=e.querySelector('.placeholder');
   if(record.placeholder&&record.placeholder.textContent!==message){record.placeholder.textContent=message;record.placeholder.setAttribute('role','status');}
   record.overlay?.remove();record.overlay=null;record.text=null;
  }else{
   if(record.overlay?.parentNode!==e){const overlay=document.createElement('div');overlay.className='cutout-pending-overlay';overlay.setAttribute('role','status');overlay.innerHTML=statusIcons.loading;record.text=document.createTextNode(message);overlay.append(record.text);e.append(overlay);record.overlay=overlay;}
   else if(record.message!==message)record.text.textContent=message;
  }
  record.message=message;
  if(state.selected.length===1&&state.selected[0]===n.id)selectedPending=true;
 }
 for(const [id,record]of decorations)if(!live.has(id)){clearDecoration(record);decorations.delete(id);}
 if(selectedPendingState!==selectedPending){document.body.classList.toggle('image-cutout-pending',selectedPending);selectedPendingState=selectedPending;}
 for(const b of menuButtons){if(!b.isConnected){menuButtons.delete(b);continue;}refreshButton(b);}
}
export function cancel(id){const op=operations.get(id)||[...operations.values()].find(o=>o.target===id);if(!op)return;op.cancelled=true;if(op.job)window.GenerationAPI.cancel(op.job);}
export async function submit(id,{inPlace=false}={}){
 const source=current(typeof id==='string'?id:id?.id);if(!source||source.type!=='image'||!sourceOf(source)){app.notify('未选择图片');return;}if(operations.has(source.id))return;
 const op={source:source.id,cancelled:false};operations.set(source.id,op);const src=sourceOf(source);let target,snapshot,unsubscribe;
 const guardSource=()=>{if(op.cancelled)throw Error('已取消抠图');if(!sourceMatches(current(source.id),source,src))throw Error('来源图片已变化，抠图结果未添加');};
 const guard=()=>{guardSource();if(target&&!untouched(current(target.id),target,snapshot))throw Error('抠图节点已变化，结果未覆盖');};
 try{
  window.NodeActions.close();window.NodeActions.closePop();render();
  // Only configured providers create a pending result. The missing-API state stays on the source.
  if(window.GenerationAPI.isConfigured()){if(inPlace){app.updateNode(source.id,{pendingOperation:'image.remove-background'});target=source;}else target=app.createConnected(source.id,[{type:'image',title:'抠图',image:null,pendingOperation:'image.remove-background'}],{gap:100,nodeSize:{width:250,height:250}})[0];op.target=target.id;snapshot=JSON.stringify(target);render();}
  let url=await window.LocalAssets.url(src);guard();const resolved=new URL(url,document.baseURI);if(resolved.protocol==='blob:'||resolved.origin===location.origin){const response=await fetch(resolved);if(!response.ok)throw Error('来源图片读取失败');url=await window.LocalMedia.asDataUrl(await response.blob());}else url=resolved.href;guard();
  const req=request(source,target?.id||source.id,url);unsubscribe=window.GenerationAPI.subscribe(job=>{if(job.request.kind===req.kind&&job.request.nodeId===req.nodeId&&['queued','running'].includes(job.status))op.job=job.id;});
  await window.GenerationAPI.runInPlace(req,{type:'image',guard,apply:async output=>{
   const patch=imageResultPatch(output),decoded=new Image();decoded.src=patch.fullImage;await decoded.decode();guard();
   // A provider may be attached while the source media is being read.
   if(!target&&inPlace){target=source;app.updateNode(source.id,{...patch,cutoutResult:true,pixelWidth:decoded.naturalWidth,pixelHeight:decoded.naturalHeight,...nodeSize(decoded.naturalWidth,decoded.naturalHeight)});return [source];}
   if(!target){target=app.createConnected(source.id,[{type:'image',title:'抠图',...patch,cutoutResult:true,pixelWidth:decoded.naturalWidth,pixelHeight:decoded.naturalHeight}],{gap:100,nodeSize:nodeSize(decoded.naturalWidth,decoded.naturalHeight)})[0];return [target];}
   app.updateNode(target.id,{...patch,cutoutResult:true,pendingOperation:null,pixelWidth:decoded.naturalWidth,pixelHeight:decoded.naturalHeight,...nodeSize(decoded.naturalWidth,decoded.naturalHeight)});return [target];
  }});return target;
 }catch(error){if(inPlace){if(current(source.id)===source&&source.pendingOperation==='image.remove-background')app.updateNode(source.id,{pendingOperation:null});}else if(target&&untouched(current(target.id),target,snapshot))app.remove([target.id]);app.notify(error.message);}finally{unsubscribe?.();operations.delete(source.id);render();}
}
window.ImageCutout={submit,cancel,bindMenu,get running(){return [...operations.values()].map(o=>({...o}));}};document.addEventListener('canvas:render',render);render();
