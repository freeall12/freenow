const storageKey = 'tapnow-agent-panel-width';
const recordKey = 'agent-panel-width';
const preferences = new WeakMap();
function durablePreference(store, legacy) {
  if(!store?.readRecord||!store?.writeRecord)return null;
  if(preferences.has(store))return preferences.get(store);
  // One read and at most one in-flight plus one latest write per store. Share
  // this state across panel lifetimes so closing/reopening cannot reorder saves.
  const state={value:legacy,revision:0,pending:null,running:false,readError:null};
  preferences.set(store,state);
  const drain=async()=>{
    if(state.running)return;state.running=true;
    try {
      await state.ready;
      while(state.pending){
        const operation=state.pending;state.pending=null;
        try {
          if(state.readError)throw state.readError;
          await store.writeRecord(recordKey,{version:1,width:operation.width});
          // The legacy mirror keeps storage-event compatibility. A full
          // localStorage must not turn a successful durable save into an error.
          try{localStorage.setItem(storageKey,String(operation.width));}catch{}
        } catch(error) {if(operation.revision===state.revision)operation.report?.(error);}
      }
    } finally {state.running=false;}
  };
  state.save=(value,report)=>{state.value=value;state.revision++;state.pending={width:value,revision:state.revision,report};void drain();};
  state.observe=value=>{state.value=value;state.revision++;state.pending=null;};
  state.ready=Promise.resolve().then(()=>store.readRecord(recordKey)).then(record=>{
    if(!state.revision){
      if(Number.isFinite(record?.width))state.value=record.width;
      else if(record==null&&Number.isFinite(legacy))state.pending={width:legacy,revision:0};
    }
  }).catch(error=>{state.readError=error;});
  void state.ready.then(drain);
  return state;
}
export function clampPanelWidth(width, viewportWidth) {
  const minimum = Math.min(360,viewportWidth);
  return Math.max(minimum,Math.min(Math.max(minimum,viewportWidth*.48),width));
}
export function createPanelResize({panel,onWidth,onError}) {
  let width=480,pressed=false,startX=0,startWidth=0,latestX=0,frame=0,pointerId=null,destroyed=false,reservedWidth,touched=false,legacy;
  try {const stored=Number.parseFloat(localStorage.getItem(storageKey));if(Number.isFinite(stored)){legacy=stored;width=stored;}} catch {}
  const preference=durablePreference(window.CanvasStore,legacy),initialRevision=preference?.revision;
  if(Number.isFinite(preference?.value))width=preference.value;
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
  const report=error=>{if(!destroyed)onError?.(error?.name==='AgentConversationConflictError'?'另一窗口已更新对话宽度，当前宽度尚未保存':'对话宽度未能保存');};
  const persist=()=>{if(preference){preference.save(width,report);return;}try{localStorage.setItem(storageKey,String(width));}catch(error){report(error);}};
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
    event.preventDefault();event.stopPropagation();touched=true;pressed=true;pointerId=event.pointerId;startX=latestX=event.clientX;startWidth=width;
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
    touched=true;const previous=width;apply(event.key==='Home'?360:event.key==='End'?innerWidth*.48:width+(event.key==='ArrowLeft'?10:-10));if(width!==previous)persist();
  };
  const resize=()=>{if(pressed)end(false);else apply(width);};
  const storage=event=>{if(destroyed||pressed||event.key!==storageKey)return;const value=Number.parseFloat(event.newValue);if(Number.isFinite(value)){touched=true;preference?.observe(value);apply(value);}};
  const cancel=()=>end(false);
  window.addEventListener('resize',resize);window.addEventListener('storage',storage);window.addEventListener('blur',cancel);
  apply(width);
  if(preference)void preference.ready.then(()=>{if(!destroyed&&!touched&&preference.revision===initialRevision&&Number.isFinite(preference.value))apply(preference.value);});
  return {element:handle,destroy(){
    destroyed=true;cancelAnimationFrame(frame);frame=0;pressed=false;const id=pointerId;pointerId=null;
    if(id!==null&&handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    handle.classList.remove('dragging');document.body.classList.remove('agent-panel-resizing');
    handle.onpointerdown=handle.onpointermove=handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=handle.onkeydown=null;
    window.removeEventListener('resize',resize);window.removeEventListener('storage',storage);window.removeEventListener('blur',cancel);
  }};
}
