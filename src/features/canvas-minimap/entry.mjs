import {SIZE,nodeBounds,geometryFromBounds,project,viewportRect,centerAt,dragTo} from './geometry.mjs';

const NS='http://www.w3.org/2000/svg';
const set=(el,key,value)=>{if(el.getAttribute(key)!==String(value))el.setAttribute(key,value);};
export function install(app){
  const root=document.querySelector('#minimap'),toggle=document.querySelector('#toggle-map'),canvas=document.querySelector('#canvas');
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./styles.css',import.meta.url);document.head.append(css);
  const svg=document.createElementNS(NS,'svg');svg.classList.add('minimap-nodes');svg.setAttribute('viewBox',`0 0 ${SIZE.width} ${SIZE.height}`);svg.setAttribute('aria-hidden','true');svg.setAttribute('preserveAspectRatio','none');
  const layer=document.createElementNS(NS,'g');svg.append(layer);
  const frame=document.createElement('div');frame.id='mini-window';frame.className='minimap-viewport';root.replaceChildren(svg,frame);
  const marks=new Map(),abort=new AbortController(),signal=abort.signal;
  let visible=[],bounds=null,baseMap=null,projection='',radius='',frameValues={},selected=new Set();
  let current,map,rect,drag=null,frozen=null,motion=null,raf=0,writing=false,lastCount=0,lastSelection='',lastSelectionIds=[];
  let canvasSize={width:canvas.clientWidth,height:canvas.clientHeight},lastNodes,lastDisplayed,lastPiles,graphDirty=false;
  const dimensions=()=>canvasSize;
  function open(value){root.hidden=!value;toggle.classList.toggle('active',value);toggle.setAttribute('aria-pressed',String(value));toggle.setAttribute('aria-label',value?'关闭小地图':'打开小地图');toggle.dataset.tip=value?'关闭小地图':'打开小地图';if(!value){graphDirty=true;stop();}}
  function update(state,displayed,piles,deriveGraph=false){
    // Data updates also render the canvas. Only a changed viewport means an
    // external navigation took over; retain an owned copy because app pans in place.
    const viewChanged=current&&['x','y','scale'].some(key=>state.view[key]!==current.view[key]);
    if((motion||drag)&&!writing&&viewChanged)stop();
    current={...state,view:{...state.view}};
    // app supplies a new selection array each frame. Retain an owned sequence
    // so unchanged selections avoid sorting and allocating a canonical key,
    // including updates while the map is closed. Sequence edits still use the
    // original unordered key, so reordering never reopens a manually closed map.
    const selectionIds=state.selected;
    let selection=lastSelection;
    let sameSelection=Array.isArray(selectionIds)&&selectionIds.length===lastSelectionIds.length;
    if(sameSelection)for(let index=0;index<selectionIds.length;index++)if(selectionIds[index]!==lastSelectionIds[index]){sameSelection=false;break;}
    if(!sameSelection){
      lastSelectionIds=[...selectionIds];selection=[...selectionIds].sort().join('|');
    }
    const selectionChanged=selection!==lastSelection;
    if(state.nodes.length>50&&lastCount<=50||selection&&selectionChanged)open(true);
    lastCount=state.nodes.length;lastSelection=selection;
    // Hidden updates may mutate arrays, nodes and pile ownership in place. Mark
    // the projection dirty instead of retaining identity-based reuse eligibility.
    if(root.hidden){graphDirty=true;return;}
    if(deriveGraph){displayed=new Map(state.nodes.map(n=>[n.id,{...n,...window.NodeEditor?.layoutFor(n),...window.ImageHistory?.layoutFor(n)}]));piles=window.CanvasPiles.index(state.nodes);}
    if(selectionChanged||graphDirty)selected=new Set(state.selected);
    let shapeChanged=false,appearanceChanged=selectionChanged||graphDirty,orderChanged=false,index=0;
    const dirtyRecords=new Set();
    const reuseGraph=!graphDirty&&state.viewportOnly&&state.nodes===lastNodes&&displayed===lastDisplayed&&piles===lastPiles;
    if(!reuseGraph){
    for(const raw of state.nodes){
      if(raw.hidden||piles?.owner.has(raw.id))continue;
      const n=displayed?.get(raw.id)||raw;
      let record=marks.get(n.id);
      if(!record){
        const mark=document.createElementNS(NS,'rect');mark.dataset.nodeId=n.id;mark.classList.add('minimap-node-transition');layer.append(mark);
        record={id:n.id,mark};marks.set(n.id,record);dirtyRecords.add(record);shapeChanged=appearanceChanged=true;
      }
      if(visible[index]!==record){orderChanged=true;visible[index]=record;}index++;
      for(const key of ['x','y','width','height'])if(record[key]!==n[key]){record[key]=n[key];dirtyRecords.add(record);shapeChanged=true;}
      for(const key of ['type','parentId','groupColor'])if(record[key]!==n[key]){record[key]=n[key];appearanceChanged=true;}
    }
    if(visible.length!==index){visible.length=index;orderChanged=true;}
    if(orderChanged){
      appearanceChanged=true;
      const ids=new Set(visible.map(n=>n.id));for(const [id,record]of marks)if(!ids.has(id)){record.mark.remove();marks.delete(id);shapeChanged=true;}
      let next=layer.firstElementChild;for(const {mark}of visible){if(mark!==next)layer.insertBefore(mark,next);next=mark.nextElementSibling;}
    }
    lastNodes=state.nodes;lastDisplayed=displayed;lastPiles=piles;
    }
    graphDirty=false;
    if(shapeChanged)bounds=nodeBounds(visible);
    map=frozen||geometryFromBounds(bounds,state.view,dimensions());rect=viewportRect(state.view,dimensions(),map);
    if(shapeChanged||!baseMap){
      // Keep one projection basis while nodes move. The layer transform accounts
      // for changed map bounds, so unchanged marks need no DOM reads or writes.
      // Rebase only for an empty map or an extreme relocation whose SVG-local
      // coordinates would lose precision. World coordinates stay untouched.
      const extent=baseMap&&bounds?project(bounds,baseMap):null;
      const scaleRatio=baseMap?map.scale/baseMap.scale:1;
      const rebase=!baseMap||!visible.length||scaleRatio>1e4||scaleRatio<1e-4||extent&&Object.values(extent).some(value=>Math.abs(value)>1e6);
      if(rebase)baseMap=map;
      for(const record of rebase?visible:dirtyRecords){
        const box=project(record,baseMap);
        for(const key of ['x','y','width','height'])if(record.projected?.[key]!==box[key])record.mark.setAttribute(key,box[key]);
        const half=Math.min(box.width,box.height)/2+'px';
        if(record.half!==half){record.mark.style.setProperty('--minimap-half',half);record.half=half;}
        record.projected=box;
      }
    }
    if(appearanceChanged){
      const activeGroups=new Map(visible.filter(n=>n.type==='group'&&selected.has(n.id)&&n.groupColor).map(n=>[n.id,n.groupColor]));
      for(const record of visible){
        const picked=selected.has(record.id),color=activeGroups.get(record.parentId)||(record.type==='group'?record.groupColor:null);
        const fill=picked?'rgba(59, 130, 246, 0.9)':color||'rgba(90,90,99,0.5)',stroke=picked?'rgba(59, 130, 246, 0.6)':color||'rgba(255,255,255,0.6)';
        if(record.fill!==fill){set(record.mark,'fill',fill);record.fill=fill;}if(record.stroke!==stroke){set(record.mark,'stroke',stroke);record.stroke=stroke;}
        if(record.picked!==picked){record.mark.classList.toggle('minimap-node-highlight',picked);record.picked=picked;}
      }
    }
    // A viewport update changes one affine transform, never every node. Stroke
    // and corner radius stay in screen units even when the map bounds expand.
    const ratio=map.scale/baseMap.scale,tx=map.offsetX-baseMap.offsetX*ratio,ty=map.offsetY-baseMap.offsetY*ratio;
    const transform=`matrix(${ratio} 0 0 ${ratio} ${tx} ${ty})`;
    if(projection!==transform){layer.setAttribute('transform',transform);projection=transform;}
    const corner=String(4/ratio)+'px';if(radius!==corner){svg.style.setProperty('--minimap-radius',corner);radius=corner;}
    // Cache requested values rather than reading CSSOM's rounded serialization.
    for(const [key,value]of Object.entries(rect)){
      const property={x:'left',y:'top',width:'width',height:'height'}[key],next=value/(key==='x'||key==='width'?SIZE.width:SIZE.height)*100+'%';
      if(frameValues[property]!==next){frame.style[property]=next;frameValues[property]=next;}
    }
  }

  function refresh(){update(app.getState(),undefined,undefined,true);}
  function stop(){cancelAnimationFrame(raf);raf=0;motion=null;frozen=null;if(drag){const id=drag.id;drag=null;delete root.dataset.dragging;if(root.hasPointerCapture(id))root.releasePointerCapture(id);}}
  function write(view){writing=true;try{app.setView(view);}finally{writing=false;}}
  function spring(target){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){write(target);if(!drag){frozen=null;refresh();}return;}
    if(!motion)motion={x:current.view.x,y:current.view.y,vx:0,vy:0,last:performance.now(),target};else motion.target=target;
    if(raf)return;
    const tick=now=>{
      raf=0;if(!motion)return;const m=motion;let remaining=Math.min((now-m.last)/1000,.05);m.last=now;
      while(remaining>0){const dt=Math.min(remaining,1/120);for(const axis of ['x','y']){const velocity='v'+axis;m[velocity]+=(120*(m.target[axis]-m[axis])-18*m[velocity])*dt;m[axis]+=m[velocity]*dt;}remaining-=dt;}
      const settled=Math.hypot(m.target.x-m.x,m.target.y-m.y)<.01&&Math.hypot(m.vx,m.vy)<.01;
      write(settled?m.target:{x:m.x,y:m.y,scale:m.target.scale});
      if(settled){motion=null;if(!drag){frozen=null;refresh();}}else raf=requestAnimationFrame(tick);
    };raf=requestAnimationFrame(tick);
  }
  const point=e=>{const box=root.getBoundingClientRect();return{x:(e.clientX-box.left-root.clientLeft)/root.clientWidth*SIZE.width,y:(e.clientY-box.top-root.clientTop)/root.clientHeight*SIZE.height};};
  root.addEventListener('pointerdown',e=>{
    if(e.button!==0||!map)return;e.preventDefault();stop();root.focus({preventScroll:true});
    // setView cancels app-level fit/search animation before its next RAF can
    // overwrite this gesture; the current displayed view itself stays unchanged.
    app.setView(app.getState().view);refresh();const p=point(e);frozen=map;
    if(p.x>=rect.x&&p.x<=rect.x+rect.width&&p.y>=rect.y&&p.y<=rect.y+rect.height){drag={id:e.pointerId,point:p,view:{...current.view}};root.dataset.dragging='true';root.setPointerCapture(e.pointerId);}
    else spring(centerAt(p,current.view,dimensions(),map));
  },{signal});
  root.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const p=point(e);spring(dragTo({x:p.x-drag.point.x,y:p.y-drag.point.y},drag.view,frozen));},{signal});
  function finish(e){if(!drag||e&&e.pointerId!==drag.id)return;const id=drag.id;drag=null;delete root.dataset.dragging;if(root.hasPointerCapture(id))root.releasePointerCapture(id);if(!motion){frozen=null;refresh();}}
  root.addEventListener('pointerup',finish,{signal});
  const cancel=e=>{if(drag&&e.pointerId!==drag.id||!drag&&!motion)return;stop();refresh();};
  root.addEventListener('pointercancel',cancel,{signal});
  root.addEventListener('lostpointercapture',e=>{if(drag)cancel(e);},{signal});
  window.addEventListener('blur',()=>{stop();refresh();},{signal});
  root.addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.isComposing||e.keyCode===229||document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&(drag||motion)){e.preventDefault();e.stopImmediatePropagation();stop();refresh();}
  },{signal});
  toggle.onclick=()=>{open(root.hidden);if(!root.hidden)refresh();};
  const observer=new ResizeObserver(entries=>{const size=entries[0]?.contentRect;if(!size||size.width===canvasSize.width&&size.height===canvasSize.height)return;canvasSize={width:size.width,height:size.height};if(!writing){stop();refresh();}});observer.observe(canvas);
  open(!root.hidden);refresh();
  return{update,destroy(){stop();observer.disconnect();abort.abort();toggle.onclick=null;css.remove();root.replaceChildren();}};
}
