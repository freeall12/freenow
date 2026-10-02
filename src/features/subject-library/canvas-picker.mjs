import {el,button} from './ui.mjs';
import {assetFromNode} from './store.mjs';
import {selectionSession} from './selection-session.mjs';
// Independent selection state: canvas transforms, graph selection and history stay intact.
export function pickSubjectAssets({app,getAssets,setAssets,onClose,types=['image','video','audio','text']}) {
  const canvas=document.querySelector('#canvas'),abort=new AbortController(),roots=new Map();let gesture=null,space=false,closed=false,moveFrame=0,pendingMove=null;
  const sourceId=asset=>asset.sourceNodeId||(app.getState().nodes.some(node=>node.id===asset.id)?asset.id:null);
  const session=selectionSession({getAssets,setAssets,sourceId,toAsset:assetFromNode});
  const banner=el('section','subject-selection-banner'),label=el('strong','','选择一个图片、视频、音频或文本节点');banner.ariaLabel='选择主体参考素材';
  banner.append(label,button('取消',()=>close(false)),button('完成',()=>close(true),'subject-selection-finish'));
  const box=el('div','subject-selection-box');box.hidden=true;document.body.append(banner,box);
  function eligible(node){
    if(!types.includes(node.type)||node.tool||node.hidden)return false;
    const asset=assetFromNode(node);return node.type==='text'?!!asset.text?.trim():!!asset.url;
  }
  function clearRoot(root){root.classList.remove('subject-selection-selected','subject-selection-pending');root.querySelector('.subject-selection-hit')?.remove();}
  function paint(event){
    if(event?.detail?.viewportOnly)return;
    const nodes=app.getState().nodes,available=new Map(nodes.filter(eligible).map(node=>[node.id,node]));
    for(const [id,root] of roots)if(!available.has(id)||!root.isConnected){clearRoot(root);roots.delete(id);}
    for(const [id,node] of available){
      let root=roots.get(id);
      if(!root){root=document.querySelector('.node[data-id="'+CSS.escape(id)+'"]');if(!root||root.hidden)continue;roots.set(id,root);
        const hit=button('选择 '+node.title,()=>toggle(id),'subject-selection-hit');hit.dataset.subjectNode=id;root.append(hit);
      }
      for(const [className,enabled]of [['subject-selection-selected',session.selected.has(id)],['subject-selection-pending',!!gesture?.pending?.has(id)]])if(root.classList.contains(className)!==enabled)root.classList.toggle(className,enabled);
      const hit=root.querySelector('.subject-selection-hit'),pressed=String(session.selected.has(id));if(hit?.getAttribute('aria-pressed')!==pressed)hit?.setAttribute('aria-pressed',pressed);
    }
  }
  function toggle(id){const node=app.getState().nodes.find(node=>node.id===id);if(node&&eligible(node)){session.toggle(node);paint();}}
  function cancelGesture(event){if(!gesture||(event?.pointerId!==undefined&&event.pointerId!==gesture.id))return;cancelAnimationFrame(moveFrame);moveFrame=0;pendingMove=null;const id=gesture.id;gesture=null;box.hidden=true;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);paint();}
  function close(commit=false){
    if(closed)return;closed=true;cancelGesture();abort.abort();session.finish(commit);banner.remove();box.remove();
    for(const root of roots.values())clearRoot(root);roots.clear();onClose?.();
  }
  function down(event){
    if(event.button!==0||space)return;event.preventDefault();event.stopImmediatePropagation();if(event.isPrimary===false||gesture)return;canvas.focus({preventScroll:true});
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,node:event.target.closest('[data-subject-node]')?.dataset.subjectNode,pending:new Set()};
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event){
    if(!gesture||gesture.id!==event.pointerId)return;event.stopImmediatePropagation();const g=gesture;
    if(Math.hypot(event.clientX-g.x,event.clientY-g.y)<4&&!g.moved)return;g.moved=true;
    pendingMove={clientX:event.clientX,clientY:event.clientY};
    if(!moveFrame)moveFrame=requestAnimationFrame(flushMove);
  }
  function flushMove(){
    cancelAnimationFrame(moveFrame);moveFrame=0;
    const event=pendingMove,g=gesture;pendingMove=null;if(!event||!g||closed)return;
    const x=Math.min(g.x,event.clientX),y=Math.min(g.y,event.clientY),w=Math.abs(event.clientX-g.x),h=Math.abs(event.clientY-g.y);
    // Measure actual transformed shells before writing selection styles. History
    // previews and node composers can override model geometry independently.
    g.pending.clear();
    for(const [id,root]of roots){if(!root.isConnected||root.hidden||session.selected.has(id))continue;const r=root.getBoundingClientRect();if(r.left<x+w&&r.right>x&&r.top<y+h&&r.bottom>y)g.pending.add(id);}
    box.hidden=false;Object.assign(box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});paint();
  }
  function up(event){
    if(!gesture||gesture.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();const g=gesture;
    // Commit the last move even when pointerup arrives before the next frame;
    // preserve the existing policy of ignoring pointerup's new coordinates.
    flushMove();cancelGesture();if(g.moved){const nodes=new Map(app.getState().nodes.map(node=>[node.id,node]));session.addMany([...g.pending].map(id=>nodes.get(id)).filter(node=>node&&eligible(node)));paint();}else if(g.node)toggle(g.node);
  }
  for(const [type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancelGesture],['lostpointercapture',cancelGesture],['dblclick',event=>{event.preventDefault();event.stopImmediatePropagation();}],['contextmenu',event=>{event.preventDefault();event.stopImmediatePropagation();}],['click',event=>{if(event.detail){event.preventDefault();event.stopImmediatePropagation();}}]])canvas.addEventListener(type,fn,{capture:true,signal:abort.signal});
  document.addEventListener('keydown',event=>{
    if(event.target.closest('dialog'))return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(false);return;}
    if(!event.target.closest('input,textarea,[contenteditable]')&&(['Delete','Backspace'].includes(event.key)||((event.metaKey||event.ctrlKey)&&['a','d','z','y','x','v'].includes(event.key.toLowerCase())))){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.code==='Space'&&event.target.closest('[data-subject-node]')){event.preventDefault();event.stopImmediatePropagation();toggle(event.target.closest('[data-subject-node]').dataset.subjectNode);return;}
    if(event.code==='Space'&&!event.target.closest('button,input,textarea,[contenteditable]'))space=true;
  },{capture:true,signal:abort.signal});
  document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;},{signal:abort.signal});
  window.addEventListener('blur',()=>{space=false;cancelGesture();},{signal:abort.signal});
  canvas.addEventListener('wheel',()=>cancelGesture(),{capture:true,passive:true,signal:abort.signal});
  document.addEventListener('canvas:render',paint,{signal:abort.signal});paint();
  return {close,complete:()=>close(true),setTypes(value){cancelGesture();types=value;paint();},remove(asset){session.remove(asset);paint();}};
}
