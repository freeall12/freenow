import {el} from './ui.mjs';
const widthKey=()=>window.SUBJECT_LIBRARY_KEY?window.SUBJECT_LIBRARY_KEY+':panel-width':'element-library-panel-width';

// Official library stores one width for both views; the editor clamps it to 370.
export function panelWidth(panel,{minimum=320,initial=320,onStart=()=>{}}={}) {
  const abort=new AbortController(),handle=el('div','subject-editor-resize');handle.ariaHidden='true';
  let width=initial,drag=null;
  try{const stored=Number.parseInt(localStorage.getItem(widthKey()),10);if(Number.isFinite(stored))width=stored;}catch{}
  const apply=value=>{width=Math.max(minimum,Math.min(520,value));panel.style.width=width+'px';};apply(width);
  function finish(event){
    if(!drag||(event?.pointerId!==undefined&&drag.id!==event.pointerId))return;
    const id=drag.id;drag=null;panel.removeAttribute('data-resizing');
    document.body.classList.remove('subject-panel-resizing');if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    try{localStorage.setItem(widthKey(),String(width));}catch{}
  }
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||drag)return;
    event.preventDefault();onStart();drag={id:event.pointerId,x:event.clientX,width};handle.setPointerCapture(event.pointerId);
    panel.dataset.resizing='true';document.body.classList.add('subject-panel-resizing');
  },{signal:abort.signal});
  handle.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId)apply(drag.width+event.clientX-drag.x);},{signal:abort.signal});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,finish,{signal:abort.signal});
  window.addEventListener('blur',()=>finish(),{signal:abort.signal});panel.append(handle);
  return ()=>{finish();abort.abort();};
}

// Official _te/Q7e/Z7e timings; cleanup happens immediately, exit is visual only.
export function panelMotion(panel) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animations=[];
  function clear(){for(const animation of animations)animation.cancel();animations=[];}
  return {
    enter(){clear();animations=[
      panel.animate([{transform:reduced?'translateX(0)':'translateX(-20px)'},{transform:'translateX(0)'}],{duration:reduced?10:200,easing:'cubic-bezier(.16,1,.3,1)'}),
      panel.animate([{opacity:0},{opacity:1}],{duration:reduced?10:100,delay:reduced?0:60,fill:'both',easing:'cubic-bezier(.16,1,.3,1)'})
    ];},
    exit(){clear();panel.inert=true;panel.ariaHidden='true';panel.style.pointerEvents='none';
      animations=[panel.animate([{transform:'translateX(0)'},{transform:reduced?'translateX(0)':'translateX(-20px)'}],{duration:reduced?10:160,fill:'forwards',easing:'cubic-bezier(.7,0,.84,0)'}),panel.animate([{opacity:1},{opacity:0}],{duration:reduced?10:60,fill:'forwards',easing:'cubic-bezier(.7,0,.84,0)'})];
      Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{clear();panel.remove();});
    }
  };
}
