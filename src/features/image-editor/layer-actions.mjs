import {imageEditorSourceStamp} from './agent-bridge.mjs';
const fail=message=>new Error(message);
export function layerActionState(canvas,target){
 const layers=canvas.getObjects().filter(object=>!object.excludeFromExport),index=layers.indexOf(target);
 const unavailable=index<0;
 return {copy:!unavailable,up:!unavailable&&index<layers.length-1,down:!unavailable&&index>0,delete:!unavailable};
}

// J$ acts on the context-clicked layer, independently of canvas selection.
// Cloning is asynchronous; no late clone may enter a changed/disposed document.
export async function applyLayerAction(editor,target,action,{app,util,id=()=>crypto.randomUUID()}={}){
 if(!['copy','up','down','delete'].includes(action))throw fail('未知图层操作');
 const canvas=editor.canvas,revision=editor.revision,mode=editor.mode,baseline=JSON.stringify(editor.document()),projectId=app.projectIdentity?.().id;
 const assertCurrent=()=>{
  if(!editor.alive||editor.loading||editor.saving||editor.crop||editor.resizing||editor.mode!==mode||canvas._currentTransform||editor.revision!==revision||JSON.stringify(editor.document())!==baseline||!canvas.getObjects().includes(target))throw fail('编辑文档或图层已变化，请重新操作');
  const node=app.getState().nodes.find(node=>node.id===editor.nodeId);
  if(app.projectIdentity?.().id!==projectId||node!==editor.sourceNode||imageEditorSourceStamp(node)!==editor.sourceStamp)throw fail('来源图片节点或项目已变化，请重新打开编辑器');
 };
 assertCurrent();
 if(!layerActionState(canvas,target)[action])return false;
 if(action==='copy'){
  const matrix=target.group?.type?.toLowerCase()==='activeselection'?target.calcTransformMatrix().slice():null;
  const copy=await target.clone();
  try{
   assertCurrent();
   // ActiveSelection stores child positions relative to its temporary wrapper.
   // Preserve the clicked layer's real artboard transform before the +10 offset.
   if(matrix)util.applyTransformToObject(copy,matrix);
   copy.set({id:id(),left:copy.left+10,top:copy.top+10});copy.setCoords();
   canvas.discardActiveObject();canvas.add(copy);canvas.setActiveObject(copy);
  }catch(error){copy.dispose?.();throw error;}
 }else if(action==='delete'){
  if(canvas.getActiveObjects().includes(target))canvas.discardActiveObject();
  canvas.remove(target);
 }else{
  action==='up'?canvas.bringObjectForward(target):canvas.sendObjectBackwards(target);
 }
 canvas.requestRenderAll();editor.record();return true;
}

export function openLayerMenu(editor,target,anchor,event,{app,util,button}={}){
 const actions=layerActionState(editor.canvas,target);
 editor.menu(anchor,popup=>{
  popup.setAttribute('aria-label','图层操作');
  for(const [action,label,icon]of [['copy','复制图层','copy'],['up','上移一层','up'],['down','下移一层','down'],['delete','删除图层','delete']]){
   if(action==='up'||action==='delete'){const separator=popup.ownerDocument.createElement('i');separator.className='ie-layer-menu-separator';separator.setAttribute('role','separator');popup.append(separator);}
   const item=button(icon,label,editor.safe(async()=>{
    editor.closeMenu();await applyLayerAction(editor,target,action,{app,util});
    if(!editor.alive)return;
    const focusId=action==='copy'?editor.canvas.getActiveObject()?.id:target.id;
    const layer=[...editor.root.querySelectorAll('.ie-layer')].find(item=>item.dataset.objectId===focusId);
    (layer||editor.root).focus({preventScroll:true});
   }),label);
   delete item.dataset.ieTip;item.setAttribute('role','menuitem');item.disabled=!actions[action];item.classList.toggle('is-destructive',action==='delete');popup.append(item);
  }
 },'ie-layer-menu');
 if(!editor.popup)return;
 const popup=editor.popup,navigate=popup.onkeydown;
 popup.onkeydown=event=>{
  // Preserve native Enter/Space activation and Tab movement while keeping all
  // menu keys away from the editor's delete, nudge and Space-pan shortcuts.
  event.stopPropagation();
  navigate(event);
 };
 popup.addEventListener('keyup',event=>event.stopPropagation());
 popup.addEventListener('focusout',event=>{
  // Native blur may expose body before the next button is focused. Closing in
  // that gap removes the clicked item before its click can perform the action.
  const next=event.relatedTarget;
  if(next&&(popup.contains(next)||editor.popupAnchor?.contains(next)))return;
  const closeIfOutside=()=>{
   if(editor.popup===popup&&!popup.contains(document.activeElement)&&!editor.popupAnchor?.contains(document.activeElement))editor.closeMenu();
  };
  if(next)queueMicrotask(closeIfOutside);
  else setTimeout(closeIfOutside,0);
 });
 editor.popupLayer=target;
 if(event?.type==='contextmenu'){
  editor.popup.style.left=Math.max(8,Math.min(innerWidth-editor.popup.offsetWidth-8,event.clientX))+'px';
  editor.popup.style.top=Math.max(8,Math.min(innerHeight-editor.popup.offsetHeight-8,event.clientY))+'px';
 }
 editor.popup.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
}
