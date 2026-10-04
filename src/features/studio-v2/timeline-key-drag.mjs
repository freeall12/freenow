// Three edits mutate clips in place; revision and scene identity mirror the official immutable-document guard.
export function createTimelineKeyDrag(runtime,{preview,changed,commit}){
  let state=null;
  const current=s=>runtime.motion.open&&runtime.content===s.content&&runtime.motion.clip===s.clip&&runtime.motion.index===s.index&&runtime.motion.cameraId===s.cameraId&&runtime.revision===s.revision;
  function cancel(){if(!state)return;const s=state;state=null;if(s.button.hasPointerCapture(s.pointerId))s.button.releasePointerCapture(s.pointerId);changed();}
  return {
    get state(){return state;},
    start(event,time,duration,width){
      if(event.button!==0)return;
      cancel();event.preventDefault();event.currentTarget.focus({preventScroll:true});
      const editor=runtime.motion,index=editor.times.indexOf(time);if(index<0)return;
      editor.select(index);runtime.playback.seekMotion(time);
      state={button:event.currentTarget,pointerId:event.pointerId,time,next:time,x:event.clientX,width:Math.max(1,width),duration,moved:false,
        min:index?Math.fround(editor.times[index-1]+.001):0,max:index<editor.times.length-1?Math.fround(editor.times[index+1]-.001):7200,
        content:runtime.content,clip:editor.clip,index:editor.index,cameraId:editor.cameraId,revision:runtime.revision};
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    move(event){
      const s=state;if(!s||s.button!==event.currentTarget||s.pointerId!==event.pointerId||!s.button.hasPointerCapture(s.pointerId))return;
      if(!current(s)){cancel();return;}
      s.moved ||= Math.abs(event.clientX-s.x)>3;if(!s.moved)return;
      s.next=Math.max(s.min,Math.min(s.max,s.time+(event.clientX-s.x)/s.width*s.duration));
      preview(s.next);changed();
    },
    finish(event){
      const s=state;if(!s||s.button!==event.currentTarget||s.pointerId!==event.pointerId)return;
      const captured=s.button.hasPointerCapture(s.pointerId);state=null;
      if(captured)s.button.releasePointerCapture(s.pointerId);
      if(captured&&s.moved&&current(s))commit(s.time,s.next);
      changed();
    },
    cancel(event){if(event&&state&&(state.button!==event.currentTarget||state.pointerId!==event.pointerId))return;cancel();}
  };
}
