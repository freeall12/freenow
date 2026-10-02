// Official rgt/sgt: dedicated handle, 5px activation and filtered-slot ordering.
export function sortAssets(assets, type, fromId, toId) {
  const visible=assets.filter(asset=>!type||asset.type===type);
  const from=visible.findIndex(asset=>asset.id===fromId),to=visible.findIndex(asset=>asset.id===toId);
  if(from<0||to<0||from===to)return assets;
  visible.splice(to,0,visible.splice(from,1)[0]);
  let index=0;
  return assets.map(asset=>!type||asset.type===type?visible[index++]:asset);
}

export function bindAssetSort(grid,{onStart,onCommit,announce}) {
  const abort=new AbortController(),scroll=grid.closest('.subject-editor-scroll');let drag=null;
  const cards=()=>[...grid.querySelectorAll('[data-asset-id]')];
  function start(handle,pointerId,x,y){
    const items=cards(),from=items.indexOf(handle.closest('[data-asset-id]'));
    drag={handle,items,from,to:from,pointerId,x,y,rects:items.map(card=>card.getBoundingClientRect()),scrollTop:scroll.scrollTop,active:false};
    if(pointerId===null)activate();
  }
  function activate(){drag.active=true;grid.dataset.sorting='true';drag.handle.ariaPressed='true';drag.items[drag.from].classList.add('sorting');onStart();announce('已拾起素材，方向键移动，空格放下，Esc取消');}
  function paint(dx,dy){
    const {items,rects,from,to}=drag;
    items.forEach((card,index)=>{
      let target=index;
      if(from<to&&index>from&&index<=to)target--;
      if(from>to&&index>=to&&index<from)target++;
      const x=index===from?dx:rects[target].left-rects[index].left;
      const y=index===from?dy:rects[target].top-rects[index].top;
      card.style.transform=`translate(${x}px,${y}px)`;
    });
  }
  function finish(commit){
    if(!drag)return;
    const state=drag;drag=null;delete grid.dataset.sorting;
    for(const card of state.items){card.style.transform='';card.classList.remove('sorting');}
    state.handle.ariaPressed='false';
    if(state.pointerId!==null&&state.handle.hasPointerCapture(state.pointerId))state.handle.releasePointerCapture(state.pointerId);
    if(!state.active)return;
    announce(commit?'排序已更新':'已取消排序');
    if(commit&&state.from!==state.to)onCommit(state.items[state.from].dataset.assetId,state.items[state.to].dataset.assetId);
  }
  grid.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.subject-asset-sort');if(!handle||event.button!==0)return;
    event.preventDefault();handle.focus({preventScroll:true});start(handle,event.pointerId,event.clientX,event.clientY);handle.setPointerCapture(event.pointerId);
  },{signal:abort.signal});
  grid.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.active){if(Math.hypot(dx,dy)<5)return;activate();}
    event.preventDefault();const source=drag.rects[drag.from];let distance=Infinity;
    drag.rects.forEach((rect,index)=>{const next=Math.hypot(rect.left+rect.width/2-source.left-source.width/2-dx,rect.top+rect.height/2-source.top-source.height/2-dy);if(next<distance){distance=next;drag.to=index;}});
    paint(dx,dy);
  },{signal:abort.signal});
  grid.addEventListener('pointerup',event=>{if(drag?.pointerId===event.pointerId)finish(true);},{signal:abort.signal});
  for(const type of ['pointercancel','lostpointercapture'])grid.addEventListener(type,()=>finish(false),{signal:abort.signal});
  grid.addEventListener('keydown',event=>{
    const handle=event.target.closest('.subject-asset-sort');if(!handle)return;
    if(!drag&&![' ','Enter'].includes(event.key))return;
    if(![' ','Enter','Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.stopPropagation();if(event.key!=='Tab')event.preventDefault();
    if(!drag){start(handle,null);return;}
    if(['Escape','Tab'].includes(event.key)){finish(false);return;}
    if([' ','Enter'].includes(event.key)){finish(true);return;}
    if(drag.pointerId!==null)return;
    const columns=getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key];
    drag.to=Math.max(0,Math.min(drag.items.length-1,drag.to+step));
    const source=drag.rects[drag.from],target=drag.rects[drag.to];paint(target.left-source.left,target.top-source.top);
    announce('移到第 '+(drag.to+1)+' 个素材');
  },{signal:abort.signal});
  window.addEventListener('blur',()=>finish(false),{signal:abort.signal});
  window.addEventListener('resize',()=>finish(false),{signal:abort.signal});
  scroll.addEventListener('scroll',()=>{
    if(!drag)return;
    if(drag.pointerId!==null){finish(false);return;}
    // Focusing a keyboard handle may scroll it into view after keydown.
    const delta=scroll.scrollTop-drag.scrollTop;drag.scrollTop=scroll.scrollTop;
    drag.rects=drag.rects.map(rect=>({left:rect.left,top:rect.top-delta,width:rect.width,height:rect.height}));
  },{signal:abort.signal});
  return {cancel:()=>finish(false),destroy(){finish(false);abort.abort();}};
}
