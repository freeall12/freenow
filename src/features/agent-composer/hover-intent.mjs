// Match the official left-side model card's 8px trajectory corridor and 400ms grace.
function headingToCard(origin, previous, point, rect) {
  if (!rect || rect.right<=rect.left || rect.bottom<=rect.top || origin.x<=rect.right || point.x>=previous.x || point.x<rect.right || point.x>origin.x) return false;
  const ratio=(origin.x-point.x)/(origin.x-rect.right);
  return point.y>=origin.y+(rect.top-8-origin.y)*ratio && point.y<=origin.y+(rect.bottom+8-origin.y)*ratio;
}
export function createHoverIntent({getCard,getActiveRow}) {
  let origin=null,previous=null,beforePrevious=null,pending=null,timer=0;
  const cancel=()=>{clearTimeout(timer);timer=0;pending=null;origin=null;previous=null;beforePrevious=null;};
  const flush=()=>{const action=pending;cancel();action?.();};
  const move=event=>{
    if(event.pointerType!=='mouse')return;
    const card=getCard(),point={x:event.clientX,y:event.clientY};
    if(card?.contains(event.target)){cancel();return;}
    if(getActiveRow()?.contains(event.target)) {if(pending)cancel();if(!origin)origin=point;}
    else if(previous&&(previous.x!==point.x||previous.y!==point.y)&&!headingToCard(origin||point,previous,point,card?.getBoundingClientRect()))flush();
    beforePrevious=previous;previous=point;
  };
  document.addEventListener('pointermove',move);window.addEventListener('scroll',cancel,true);window.addEventListener('resize',cancel);window.addEventListener('blur',cancel);
  return {
    request(event,action){
      const point={x:event.clientX,y:event.clientY},last=previous?.x===point.x&&previous?.y===point.y?beforePrevious:previous;
      const row=event.currentTarget;
      if(origin&&last&&headingToCard(origin,last,point,getCard()?.getBoundingClientRect())){
        pending=()=>{if(row.isConnected&&row.matches(':hover'))action();};if(!timer)timer=setTimeout(flush,400);
      }else{cancel();action();origin=point;}
      beforePrevious=previous;previous=point;
    },
    cancel,
    destroy(){cancel();document.removeEventListener('pointermove',move);window.removeEventListener('scroll',cancel,true);window.removeEventListener('resize',cancel);window.removeEventListener('blur',cancel);}
  };
}
