// Official viewer shortcuts leave text fields and interactive controls to their native handlers.
const interactive="input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='button'], [role='menuitem']";
export function createViewportKeyHandler(runtime){
  return event=>{
    if(event.defaultPrevented||event.isComposing||event.target?.closest?.(interactive)||runtime.closed||runtime.exporting||runtime.loadStatus!=='ready')return;
    const key=event.key.toLowerCase(),modified=event.metaKey||event.ctrlKey;
    let action;
    if(modified&&!event.altKey&&(key==='z'||event.ctrlKey&&key==='y'))action=()=>runtime.undo(event.shiftKey||key==='y');
    else{
      if(modified||event.altKey||event.shiftKey)return;
      if(event.code==='Space'){
        if(runtime.motionIndex<0)return;
        action=()=>runtime.playback.toggleMotion();
      }else if(key==='f'&&runtime.selected)action=()=>{runtime.focus(runtime.selected);runtime.focusView();};
      else if((runtime.selected||runtime.motion.open&&runtime.motion.selected>=0)&&['p','r','t'].includes(key))action=()=>runtime.setMode({p:'translate',r:'rotate',t:'scale'}[key]);
      else if(key==='delete'||key==='backspace'){
        if(runtime.motion.open&&runtime.motion.selected>=0)action=()=>runtime.motion.remove();
        else if(runtime.selected)action=()=>runtime.remove(runtime.selected.userData.studioId);
      }
    }
    if(!action)return;
    event.preventDefault();event.stopPropagation();
    if(event.repeat&&!modified)return;
    try{Promise.resolve(action()).catch(error=>runtime.onError?.(error));}catch(error){runtime.onError?.(error);}
  };
}
