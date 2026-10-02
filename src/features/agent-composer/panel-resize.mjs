const storageKey = 'tapnow-agent-panel-width';
export function clampPanelWidth(width, viewportWidth) {
  const minimum = Math.min(360,viewportWidth);
  return Math.max(minimum,Math.min(Math.max(minimum,viewportWidth*.48),width));
}
export function createPanelResize({panel,onWidth,onError}) {
  let width=480,pressed=false,startX=0,startWidth=0,latestX=0,frame=0,pointerId=null,destroyed=false,reservedWidth;
  try {const stored=Number.parseFloat(localStorage.getItem(storageKey));if(Number.isFinite(stored))width=stored;} catch {}
  const handle=document.createElement('div');handle.className='agent-panel-resize';handle.role='separator';handle.tabIndex=0;
  handle.setAttribute('aria-label','调整对话宽度');handle.setAttribute('aria-orientation','vertical');
  handle.append(document.createElement('span'));
  function attribute(name,value) {if(handle.getAttribute(name)!==String(value))handle.setAttribute(name,value);}
  function apply(next) {
    if(destroyed)return;
    width=clampPanelWidth(next,innerWidth);
    const size=width+'px';if(panel.style.width!==size){panel.style.width=size;panel.style.setProperty('--agent-panel-size',size);}
    attribute('aria-valuemin',Math.min(360,innerWidth));attribute('aria-valuemax',Math.max(Math.min(360,innerWidth),innerWidth*.48));attribute('aria-valuenow',width);
    // Only reserve screen space. Never round or rewrite canvas world coordinates.
    const reserve=innerWidth<750?0:width;
    if(reserve!==reservedWidth){reservedWidth=reserve;onWidth(reserve);}
  }
  const persist=()=>{try{localStorage.setItem(storageKey,String(width));}catch{onError?.('对话宽度未能保存');}};
  const move=()=>{frame=0;if(pressed&&!destroyed)apply(startWidth+startX-latestX);};
  function end(commit,event) {
    if(!pressed||event&&event.pointerId!==pointerId)return;
    cancelAnimationFrame(frame);frame=0;
    if(commit&&Number.isFinite(event?.clientX))latestX=event.clientX;
    const next=commit?startWidth+startX-latestX:startWidth,id=pointerId;
    // Release capture only after clearing ownership: lostpointercapture fires
    // during release and must not commit or cancel the completed drag twice.
    pressed=false;pointerId=null;handle.classList.remove('dragging');document.body.classList.remove('agent-panel-resizing');
    if(id!==null&&handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    apply(next);if(commit&&width!==clampPanelWidth(startWidth,innerWidth))persist();
  }
  handle.onpointerdown=event=>{
    if(destroyed||pressed||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();event.stopPropagation();pressed=true;pointerId=event.pointerId;startX=latestX=event.clientX;startWidth=width;
    handle.focus({preventScroll:true});handle.setPointerCapture(pointerId);handle.classList.add('dragging');document.body.classList.add('agent-panel-resizing');
  };
  handle.onpointermove=event=>{if(!pressed||event.pointerId!==pointerId)return;latestX=event.clientX;if(!frame)frame=requestAnimationFrame(move);};
  handle.onpointerup=event=>end(true,event);
  handle.onpointercancel=handle.onlostpointercapture=event=>end(false,event);
  handle.onkeydown=event=>{
    if(destroyed||event.defaultPrevented||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'&&pressed){event.preventDefault();event.stopPropagation();end(false);return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();if(pressed)return;
    const previous=width;apply(event.key==='Home'?360:event.key==='End'?innerWidth*.48:width+(event.key==='ArrowLeft'?10:-10));if(width!==previous)persist();
  };
  const resize=()=>{if(pressed)end(false);else apply(width);};
  const storage=event=>{if(pressed||event.key!==storageKey)return;const value=Number.parseFloat(event.newValue);if(Number.isFinite(value))apply(value);};
  const cancel=()=>end(false);
  window.addEventListener('resize',resize);window.addEventListener('storage',storage);window.addEventListener('blur',cancel);
  apply(width);
  return {element:handle,destroy(){
    destroyed=true;cancelAnimationFrame(frame);frame=0;pressed=false;const id=pointerId;pointerId=null;
    if(id!==null&&handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    handle.classList.remove('dragging');document.body.classList.remove('agent-panel-resizing');
    handle.onpointerdown=handle.onpointermove=handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=handle.onkeydown=null;
    window.removeEventListener('resize',resize);window.removeEventListener('storage',storage);window.removeEventListener('blur',cancel);
  }};
}
