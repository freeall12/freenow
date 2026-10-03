(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clone = (value) => structuredClone(value);
  const data = window.CanvasProjects&&!window.CanvasProjects.isDefault()?{...window.CANVAS_DATA,nodes:[],edges:[]}:window.CANVAS_DATA;
  const original = new Map(data.nodes.map(n => [n.id, clone(n)]));
  let nodes = clone(data.nodes), edges = clone(data.edges);
  let selected = new Set(), space = false, snap = false, gesture = null;
  const gestureQueue=window.CanvasNavigation.gestureQueue();
  let history = [], future = [], filter = 'all', graphLoaded = false, graphReadFailed = false, localChanges = 0, focusRevision = 0, viewportFrame = 0, saveRevision = 0;
  let generationPlanModule;
  let resourceMigrationStatus=null;
  window.CanvasResourceDisplayReady=import('./src/features/local-resource-migration/display-media.mjs').then(policy=>{window.CanvasResourceDisplay=policy;return policy;}).catch(()=>null);
  const displayMediaRef=value=>window.CanvasResourceDisplay?.displayMediaRef(value)??(typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:'');
  const pendingMedia=node=>window.CanvasResourceDisplay?.nodeHasPendingOriginalMedia(node)??['image','fullImage','video','audio','poster','thumbnail'].some(key=>node?.[key]&&!displayMediaRef(node[key]));
  const actionMediaRef=node=>node?.type==='video'?displayMediaRef(node.video||window.EDITOR_DATA?.nodes[node.id]?.video):node?.type==='audio'?displayMediaRef(node.audio):displayMediaRef(node?.fullImage)||displayMediaRef(node?.image);
  const blockedPrimaryMedia=node=>['image','video','audio'].includes(node?.type)&&!actionMediaRef(node)&&pendingMedia(node);
  const mediaDisplayNode=node=>{if(!['image','video','audio'].includes(node?.type))return node;const source=actionMediaRef(node);return {...node,image:displayMediaRef(node.image)||(node.type==='image'?source:''),fullImage:node.type==='image'?source:displayMediaRef(node.fullImage),video:node.type==='video'?source:displayMediaRef(node.video),audio:displayMediaRef(node.audio),poster:displayMediaRef(node.poster),thumbnail:displayMediaRef(node.thumbnail)};};
  const generationRuns = new Map();
  let searchFocusTimer=0,searchFocusElement=null;
  const initial = !data.nodes.length||window.CanvasProjects&&!window.CanvasProjects.isDefault()?{x:0,y:0,scale:1}:{x: -11821.75458177424, y: 1093.1602809876204, scale: 0.22841067612171173};
  let view = {...initial, x: initial.x + (innerWidth - data.referenceWidth) / 2, y: initial.y + (innerHeight - data.referenceHeight) / 2};
  if(window.CanvasProjects&&!window.CanvasProjects.isDefault())view={...initial};
  const viewStorageKey=window.CanvasProjects?.storageKey('tapnow-canvas-view-v1')||'tapnow-canvas-view-v1';
  try { view=window.CanvasNavigation.parseView(localStorage.getItem(viewStorageKey))||view; } catch {}
  let viewSaveTimer=0,emptyCheckTimer=0,emptyHintTimer=0,lastSavedView=JSON.stringify(view),emptyCandidate=false;
  const nodeElements = new Map(), nodeRecords = new Map(), pathElements = new Map(), refreshKeys = new WeakMap(), styleValues = new WeakMap(), shellStates = new WeakMap();
  function styleValue(el,key,value){
    let values=styleValues.get(el);if(!values){values=new Map();styleValues.set(el,values);}
    const input=String(value),current=el.style.getPropertyValue(key),previous=values.get(key);
    // CSSOM serializes long fractional values with fewer digits. Compare the
    // requested value as well as its serialization without rounding world data.
    if(previous?.input===input&&previous.output===current)return;
    if(current!==input)el.style.setProperty(key,input);
    values.set(key,{input,output:el.style.getPropertyValue(key)});
  }
  const attributeValue=(el,key,value)=>{if(value===null){if(el.hasAttribute(key))el.removeAttribute(key);}else if(el.getAttribute(key)!==String(value))el.setAttribute(key,value);};
  const canvas = $('#canvas'), world = $('#world');
  const shellDirty=new WeakSet(),titleDirty=new WeakSet(),nodeRoot=$('#nodes');
  function invalidateShells(records){
    for(const {target} of records){
      if(target.parentNode===nodeRoot)shellDirty.add(target);
      else if(target.parentNode?.parentNode===nodeRoot)titleDirty.add(target);
    }
  }
  // Observe external preview/history writes instead of serializing every idle
  // shell's inline styles each frame. takeRecords also catches synchronous writes.
  const shellObserver=typeof MutationObserver==='function'?new MutationObserver(invalidateShells):null;
  shellObserver?.observe(nodeRoot,{subtree:true,attributes:true,attributeFilter:['style','class','hidden']});
  const svg = name => window.UI_ICONS[name] || window.UI_ICONS.image;
  $$('[data-icon]').forEach(e => { e.insertAdjacentHTML('afterbegin', window.REFERENCE_ICONS[e.dataset.icon] || ''); });
  $('#reset').innerHTML=window.CANVAS_NAVIGATION_ICONS.reset;$('#reset').setAttribute('aria-label','重置');$('#reset').dataset.tip='重置';
  $('#toggle-map').innerHTML=window.UI_ICONS.map;
  $$('.close').forEach(b=>b.innerHTML=window.UI_ICONS.close);
  // Imported DOM paths preserve the source geometry; edits translate their control points.
  const paths = new Map(edges.map(e => [e.id, e.path?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number)]));
  function remember() { if(window.CanvasProjects&&!graphLoaded){notify('画布尚未完成读取，请稍后编辑');throw Error('画布尚未完成读取，不能修改已有项目');}flushGesture();localChanges++; history.push({nodes:clone(nodes), edges:clone(edges)}); if(history.length>60) history.shift(); future=[]; }
  function persist() {
    let pending=null;
    window.CanvasProjects?.markDirty();
    if(graphLoaded){
      const revision=++saveRevision;
      try{pending=window.CanvasStore.save(window.CanvasProjects?.snapshot({version:1,nodes,edges},view,history,future)||{version:1,nodes,edges});pending.then(()=>{
        if(revision===saveRevision){$('#storage-notice')?.remove();window.CanvasProjects?.markDirty(false);}
      },error=>{if(revision===saveRevision)storageError(error);});}
      catch(error){storageError(error);}
    }
    if(!graphReadFailed&&(!window.CanvasProjects||window.CanvasProjects.isDefault()))try { localStorage.setItem('tapnow-canvas-v1', JSON.stringify(nodes.filter(n=>original.has(n.id)).map(({id,x,y,title})=>({id,x,y,title})))); } catch {}
    return pending;
  }
  function storageError(error,operation='save'){
    let notice=$('#storage-notice');if(!notice){notice=document.createElement('div');notice.id='storage-notice';notice.setAttribute('role','status');document.body.append(notice);}
    notice.dataset.operation=operation;notice.dataset.errorName=error?.name||'Error';
    notice.textContent=operation==='load'?'本地画布读取失败，已停止自动保存以保护已有数据。当前修改尚未保存，请保留此页面并重试加载。':error?.name==='CanvasProjectConflictError'?error.message:error?.name==='QuotaExceededError'?'本地保存失败：浏览器存储空间不足。当前修改尚未保存，请保留此页面。':'本地保存失败，当前修改尚未保存。请保留此页面并稍后重试。';
  }
  try {
    const saved = !window.CanvasProjects||window.CanvasProjects.isDefault()?JSON.parse(localStorage.getItem('tapnow-canvas-v1') || '[]'):[];
    saved.forEach(p=>{const n=nodes.find(n=>n.id===p.id);if(n && Number.isFinite(p.x) && Number.isFinite(p.y)) Object.assign(n,p);});
  } catch {}
  function undo(redo=false) {
    flushGesture();
    window.CanvasConnections?.cancel();window.CanvasConnections?.clearSelection();
    const from=redo?future:history,to=redo?history:future;
    if(!from.length)return false;
    to.push({nodes:clone(nodes),edges:clone(edges)});
    ({nodes,edges}=from.pop()); selected.clear();clearOrphanGenerationState();rebuildAndPersist();return true;
  }
  function nodeContentKey(n) {
    const content={...n};
    // These fields are reconciled by the node shell or existing render listeners.
    for(const key of ['x','y','width','height','title','restricted','parentId','hidden','color','colorPins','groupColor'])delete content[key];
    if(['image','video'].includes(n.type))delete content.generation;
    return JSON.stringify(content);
  }
  function syncNodeShell(n,element) {
    attributeValue(element,'aria-label',n.title||'图片节点');
    const title=element.querySelector('.node-title'),text=title.querySelector('.title-text'),input=title.querySelector('input');
    if(text&&text.textContent!==n.title)text.textContent=n.title||'';
    if(input&&document.activeElement!==input&&input.value!==n.title)input.value=n.title||'';
    if(text){let badge=title.querySelector('.restricted');if(n.restricted&&!badge){badge=document.createElement('span');badge.className='restricted';badge.textContent=' · 规格受限';title.append(badge);}else if(!n.restricted)badge?.remove();}
    const image=element.querySelector('.node-body > img');if(image)attributeValue(image,'alt',n.title||'');
    if(n.type==='text')styleValue(element.querySelector('.node-body'),'background-color',n.color||'');
  }
  function removeNodeElement(id) {
    const element=nodeElements.get(id);if(!element)return;
    window.CanvasPilesUI.disposeMediaTree(element);
    element.querySelectorAll('video,audio').forEach(media=>media.pause());
    element.remove();nodeElements.delete(id);nodeRecords.delete(id);
  }
  function makeNode(n,before=null) {
    const el=document.createElement('div');el.className='node';el.dataset.id=n.id;el.tabIndex=0;
    el.setAttribute('role','group');el.setAttribute('aria-label',n.title || '图片节点');
    const title=document.createElement('div');title.className='node-title';title.innerHTML=svg(n.type);
    const text=document.createElement('span');text.className='title-text';text.textContent=n.title;title.append(text);
    if(n.restricted){const badge=document.createElement('span');badge.className='restricted';badge.textContent=' · 规格受限';title.append(badge);}
    const body=document.createElement('div');body.className='node-body';
    const imageRef=displayMediaRef(n.type==='image'&&n.fullImage?n.fullImage:n.image)||displayMediaRef(n.image);
    if(imageRef){const img=document.createElement('img');img.src=imageRef;img.onerror=()=>{img.onerror=null;const fallback=displayMediaRef(n.image);if(fallback&&img.getAttribute('src')!==fallback)img.src=fallback;};img.alt=n.title;img.draggable=false;body.append(img);}
    else if(pendingMedia(n)){const placeholder=document.createElement('div');placeholder.className='placeholder';placeholder.textContent='原站媒体待导入本地';placeholder.setAttribute('role','status');placeholder.title='旧媒体引用已保留，请重新导入本地素材后替换';body.append(placeholder);}
    else if(n.type==='text'){}
    else body.innerHTML=`<div class="placeholder">${svg('image')}</div>`;
    if(pendingMedia(n)){el.dataset.mediaStatus='pending_import';body.title='原站媒体待导入本地；旧引用已保留。请重新导入本地素材后替换。';}
    const left=document.createElement('button');left.className='port left';left.dataset.port='left';left.textContent='+';left.setAttribute('aria-label','输入连接点');
    const right=left.cloneNode(true);right.className='port right';right.dataset.port='right';right.setAttribute('aria-label','输出连接点');
    el.append(title,body,left,right);if(n.type==='text')window.CanvasTextUI.renderNode(n,el);if(n.type==='studio')window.StudioNode.render(n,el);if(n.type==='world')window.WorldNode?.render(n,el);if(n.type==='group')window.CanvasGroupsUI.renderNode(n,el);if(n.type==='pile')window.CanvasPilesUI.renderNode(n,el,nodes);$('#nodes').insertBefore(el,before);nodeElements.set(n.id,el);nodeRecords.set(n.id,{node:n,content:nodeContentKey(n)});
    window.ImagePanorama?.attach(n,el);
    window.CanvasConnections?.attachNode(n,el);
    el.addEventListener('dblclick',event=>{if(!event.target.closest('.port'))preview(n);});
  }
  function rebuild() {
    window.PileMotion.cancel();
    const removedPiles=new Set(window.CanvasPiles.reconcile(nodes));edges=edges.filter(e=>!removedPiles.has(e.source)&&!removedPiles.has(e.target));
    const ids=new Set(nodes.map(n=>n.id));
    for(const id of nodeElements.keys())if(!ids.has(id))removeNodeElement(id);
    const successors=new Map();let successor=null;
    for(let index=nodes.length-1;index>=0;index--){const id=nodes[index].id;successors.set(id,successor);if(nodeElements.has(id))successor=nodeElements.get(id);}
    for(let index=0;index<nodes.length;index++){
      let n=nodes[index];const record=nodeRecords.get(n.id),content=nodeContentKey(n),sameType=record?.node.type===n.type;
      if(record&&sameType&&record.node!==n){
        // History supplies snapshots. Keep callbacks attached to surviving nodes
        // reading the same live object rather than a pre-undo snapshot.
        for(const key of Object.keys(record.node))if(!Object.hasOwn(n,key))delete record.node[key];
        Object.assign(record.node,n);n=nodes[index]=record.node;
      }
      if(record&&sameType&&record.content===content)syncNodeShell(n,nodeElements.get(n.id));
      else{const before=nodeElements.get(n.id)?.nextElementSibling||successors.get(n.id)||null;removeNodeElement(n.id);makeNode(n,before);}
    }
    const root=$('#nodes');let next=root.firstElementChild;
    for(const n of nodes){const element=nodeElements.get(n.id);if(element!==next)root.insertBefore(element,next);next=element.nextElementSibling;}
    if(!window.CanvasConnections){
      const ids=new Set(edges.map(e=>e.id));for(const [id,path]of pathElements)if(!ids.has(id)){path.remove();pathElements.delete(id);}
      for(const e of edges)if(!pathElements.has(e.id)){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.dataset.id=e.id;$('#edges').append(p);pathElements.set(e.id,p);}
    }
    render();if(graphLoaded)persist();
  }
  function rebuildAndPersist() {
    rebuild();
    // Rebuild owns ready-document saves. Preserve the legacy pre-load write
    // for operations that previously called persist explicitly after rebuild.
    if(!graphLoaded)persist();
  }
  function generationSignature(node) {
    const content={...node};delete content.x;delete content.y;delete content.selected;delete content.generationRecovery;
    return JSON.stringify(content,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  }
  function generationTargetMatches(guard,runId,checkContent=false) {
    const node=nodes.find(item=>item.id===guard.id);
    return node===guard.node&&node.generationRun?.runId===runId&&
      JSON.stringify(node.generationRun)===guard.token&&node.pendingOperation===guard.operation&&
      (!checkContent||generationSignature(node)===guard.signature);
  }
  function clearOrphanGenerationState({allowRecovery=false}={}) {
    for(const node of nodes){
      const run=node.generationRun;
      if(!run||typeof run.runId!=='string'||node.pendingOperation!==`${node.type}.generate`)continue;
      // Rebuild reconciles surviving history snapshots into their existing live
      // objects. Deleted/recreated nodes have no such identity and cannot inherit a task.
      const record=nodeRecords.get(node.id),live=record?.node.type===node.type?record.node:node;
      const guard=generationRuns.get(run.runId)?.find(item=>item.id===node.id);
      if(guard?.node===live&&guard.operation===node.pendingOperation&&guard.token===JSON.stringify(run))continue;
      const recovery=node.generationRecovery;
      // Only hydration may retain a durable baseline. Undo must not resurrect
      // deleted task identities or turn a completed operation back into a job.
      if(allowRecovery&&recovery?.version===1&&recovery.runId===run.runId&&recovery.kind===node.pendingOperation&&
        Array.isArray(recovery.targetNodeIds)&&recovery.targetNodeIds.includes(node.id)&&
        typeof recovery.signature==='string'&&recovery.signature===generationSignature(node))continue;
      delete node.generationRun;delete node.pendingOperation;delete node.generationRecovery;
    }
  }
  function edgePath(e, byId, piles) {
    const source=piles.owner.get(e.source)||e.source,target=piles.owner.get(e.target)||e.target;if(source===target)return '';
    const a=byId.get(source),b=byId.get(target),raw=source===e.source&&target===e.target?paths.get(e.id):null;
    if(raw?.length===8){const v=raw.slice();for(const [n,id,ix] of [[a,e.source,0],[b,e.target,4]]){const base=original.get(id);if(n&&base){for(const j of [ix,ix+2]){v[j]+=n.x-base.x+(ix===0?n.width-base.width:0);v[j+1]+=n.y-base.y+(n.height-base.height)/2;}}}return `M${v[0]},${v[1]} C${v[2]},${v[3]} ${v[4]},${v[5]} ${v[6]},${v[7]}`;}
    if(!a||!b)return '';
    const x1=a.x+a.width,y1=a.y+a.height/2,x2=b.x,y2=b.y+b.height/2,c=x2>=x1?(x2-x1)*.5:6.25*Math.sqrt(x1-x2);
    return `M${x1},${y1} C${x1+c},${y1} ${x2-c},${y2} ${x2},${y2}`;
  }
  let renderFrame=0,pendingRender=null,renderLayout=null,renderScale=null;
  // Pointer model work and rendering share one frame. A graph edit always
  // wins over a pending viewport-only pass, including synchronous render calls.
  function scheduleRender(viewportOnly=false){
    pendingRender=pendingRender===null?viewportOnly:pendingRender&&viewportOnly;
    if(!renderFrame)renderFrame=requestAnimationFrame(()=>{const only=pendingRender;renderFrame=0;pendingRender=null;render({viewportOnly:only});});
  }
  function flushGesture(getPiles){return gestureQueue.flush(gesture,e=>applyGesture(e,getPiles));}
  function flushRender(){if(pendingRender!==null||gestureQueue.pending)render({viewportOnly:pendingRender});}
  function renderNodeShell(n,el,piles,viewportOnly){
    let state=shellStates.get(el);
    if(!state){state={};shellStates.set(el,state);}
    if(!viewportOnly){
      const hidden=!!n.hidden||piles.owner.has(n.id),picked=selected.has(n.id);
      // History previews also write the owner's inline geometry and layer. Keep
      // their writes observable so closing a preview restores the canvas shell.
      if(state.x!==n.x||state.y!==n.y||state.width!==n.width||state.height!==n.height||
        state.type!==n.type||state.parentId!==n.parentId||state.hidden!==hidden||state.picked!==picked||
        ((!shellObserver||shellDirty.has(el))&&(state.css!==el.style.cssText||state.classes!==el.className||el.hidden!==hidden))){
        styleValue(el,'left',`${n.x}px`);styleValue(el,'top',`${n.y}px`);
        styleValue(el,'width',`${n.width}px`);styleValue(el,'height',`${n.height}px`);
        if(el.hidden!==hidden)el.hidden=hidden;
        attributeValue(el,'data-type',n.type);attributeValue(el,'data-parent',n.parentId||null);
        styleValue(el,'z-index',n.type==='group'?'0':n.parentId?(picked?'1001':'1'):'');
        if(el.classList.contains('selected')!==picked)el.classList.toggle('selected',picked);
        attributeValue(el,'aria-selected',picked);
        Object.assign(state,{x:n.x,y:n.y,width:n.width,height:n.height,type:n.type,parentId:n.parentId,hidden,picked,css:el.style.cssText,classes:el.className});
      }
      shellDirty.delete(el);
    }
    // Pile titles are display:none; member/hidden titles cannot be seen. Keep
    // their dirty markers until a full render reveals them at the current scale.
    if(n.type==='studio'||n.type==='group'||n.type==='pile'||n.hidden||piles.owner.has(n.id))return;
    if(state.title?.parentNode!==el){state.title=el.querySelector('.node-title');state.titleWidth=undefined;}
    const title=state.title,width=n.width*view.scale;
    if(state.titleWidth!==width||((!shellObserver||titleDirty.has(title))&&state.titleCss!==title.style.cssText)){
      styleValue(title,'width',`${width}px`);state.titleWidth=width;state.titleCss=title.style.cssText;
    }
    titleDirty.delete(title);
  }
  function render(options) {
    if(shellObserver)invalidateShells(shellObserver.takeRecords());
    // A marquee and its render consume the same current graph. Keep this lazy
    // layout local to one call, after layout hooks and before selection testing.
    let frameLayout;
    const deriveLayout=()=>frameLayout||(frameLayout={byId:new Map(nodes.map(n=>[n.id,{...n,...window.NodeEditor?.layoutFor(n),...window.ImageHistory?.layoutFor(n)}])),piles:window.CanvasPiles.index(nodes)});
    const gestureViewportOnly=flushGesture(()=>deriveLayout().piles);
    const viewportOnly=options?.viewportOnly===true&&pendingRender!==false&&gestureViewportOnly!==false&&!!renderLayout;
    cancelAnimationFrame(renderFrame);renderFrame=0;pendingRender=null;
    const scaleChanged=renderScale!==view.scale;renderScale=view.scale;
    styleValue(world,'transform',`translate(${view.x}px,${view.y}px) scale(${view.scale})`);
    styleValue(world,'--scale',view.scale);styleValue(world,'--inverse',1/view.scale);
    if(!viewportOnly)renderLayout=deriveLayout();
    const {byId,piles}=renderLayout;
    if(!viewportOnly||scaleChanged)
    for(const raw of nodes){const n=byId.get(raw.id),el=nodeElements.get(n.id);
      renderNodeShell(n,el,piles,viewportOnly);
      if(n.type==='studio'||n.type==='group'){
        const key=JSON.stringify([n.type,n.width,n.title,n.groupColor,view.scale]);
        if(refreshKeys.get(el)!==key){refreshKeys.set(el,key);if(n.type==='studio')window.StudioNode.refresh(n,el,view.scale);else window.CanvasGroupsUI.refresh(n,el,view.scale);}
      }
      if(!viewportOnly&&n.type==='pile')window.CanvasPilesUI.refresh(n,el,nodes,piles);
    }
    if(window.CanvasConnections)window.CanvasConnections.render({nodes,edges,selected:[...selected],view,viewportOnly},byId,piles,edgePath);
    else if(!viewportOnly)edges.forEach(e=>{const p=pathElements.get(e.id);p.setAttribute('d',edgePath(e,byId,piles));p.classList.toggle('selected-edge',selected.has(e.source)&&selected.has(e.target));});
    if(scaleChanged){const label=Math.round(view.scale*100)+'%';$('#zoom').value=view.scale;$('#zoom-label').textContent=label;attributeValue($('#zoom'),'aria-valuetext',label);}
    const grid=$('#grid'),step=20*view.scale;
    styleValue(grid,'background-image','radial-gradient(circle, #555 0.7px, transparent 0.9px)');styleValue(grid,'background-size',`${step}px ${step}px`);styleValue(grid,'background-position',`${view.x}px ${view.y}px`);styleValue(grid,'opacity',view.scale>.5?Math.min(.5,(view.scale-.5)/2):0);
    scheduleEmptyHint();scheduleViewSave();
    window.CanvasMinimap?.update({nodes,selected:[...selected],view,viewportOnly},byId,piles);
    toolbar(viewportOnly);
    document.dispatchEvent(new CustomEvent('canvas:render',{detail:{viewportOnly,scaleChanged}}));
  }
  function saveView(){clearTimeout(viewSaveTimer);viewSaveTimer=0;if(window.CanvasProjects&&!graphLoaded)return;const value=JSON.stringify(view);if(value===lastSavedView)return;try{localStorage.setItem(viewStorageKey,value);lastSavedView=value;}catch{if(graphLoaded){const pending=persist();pending?.then(()=>{if(JSON.stringify(view)===value)lastSavedView=value;},()=>{});}}}
  function scheduleViewSave(){if(!viewSaveTimer)viewSaveTimer=setTimeout(saveView,100);}
  function scheduleEmptyHint(){clearTimeout(emptyCheckTimer);emptyCheckTimer=setTimeout(()=>{const dimensions={width:canvas.clientWidth,height:canvas.clientHeight},candidates=window.CanvasNavigation.visible(nodes),empty=candidates.length>0&&dimensions.width>0&&dimensions.height>0&&!candidates.some(n=>window.CanvasNavigation.intersects(n,view,dimensions));if(!empty){clearTimeout(emptyHintTimer);emptyHintTimer=0;emptyCandidate=false;$('#empty-view').hidden=true;}else if(!emptyCandidate){emptyCandidate=true;emptyHintTimer=setTimeout(()=>{emptyHintTimer=0;$('#empty-view').hidden=false;},1000);}},100);}
  function cancelViewportAnimation(){flushGesture();focusRevision++;cancelAnimationFrame(viewportFrame);viewportFrame=0;delete canvas.dataset.viewportMotion;}
  function animateView(target,duration){cancelViewportAnimation();if(!target)return;const revision=focusRevision,started=performance.now(),path=window.CanvasNavigation.interpolate(view,target,{width:canvas.clientWidth,height:canvas.clientHeight});if(matchMedia('(prefers-reduced-motion: reduce)').matches||!duration){view={...target};render({viewportOnly:true});return;}canvas.dataset.viewportMotion='moving';const frame=now=>{if(revision!==focusRevision)return;const t=Math.min(1,(now-started)/duration);view=path(t);render({viewportOnly:true});if(t<1)viewportFrame=requestAnimationFrame(frame);else{viewportFrame=0;delete canvas.dataset.viewportMotion;}};viewportFrame=requestAnimationFrame(frame);}
  function resetView(){flushGesture();animateView(window.CanvasNavigation.fit(nodes,{width:canvas.clientWidth,height:canvas.clientHeight}),300);}
  function returnToNodes(){flushGesture();const target=window.CanvasNavigation.fit(nodes,{width:canvas.clientWidth,height:canvas.clientHeight},'latest');if(!target)return;clearTimeout(emptyHintTimer);emptyHintTimer=0;emptyCandidate=false;$('#empty-view').hidden=true;animateView(target,500);}
  window.addEventListener('pagehide',saveView);
  function zoomAt(scale,x=canvas.clientWidth/2,y=canvas.clientHeight/2){cancelViewportAnimation();scale=Math.max(.15,Math.min(2,scale));const ratio=scale/view.scale;view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.scale=scale;render({viewportOnly:true});}
  let toolbarPicked=null;
  function toolbar(viewportOnly=false){
    // Pure viewport passes keep graph and selection unchanged. Retain raw node
    // identities and graph order; all content/selection passes refresh the list.
    const bar=$('#node-toolbar');const picked=viewportOnly&&toolbarPicked?toolbarPicked:(toolbarPicked=nodes.filter(n=>selected.has(n.id)));if(window.WorldNode?.toolbar(picked,bar,{nodes,view,canvas}))return;if(window.CanvasPlaylist?.toolbar(picked,bar))return;if(window.CanvasPilesUI.toolbar(picked,bar,{nodes,view,canvas}))return;if(window.CanvasGroupsUI.toolbar(picked,bar,{nodes,edges,view,canvas}))return;if(window.CanvasTextUI.toolbar(picked,bar,{nodes,view,canvas}))return;bar.classList.remove('group-toolbar','multiselect-toolbar');bar.hidden=!picked.length||picked.length===1&&picked[0].type==='studio';if(bar.hidden)return;
    const key=picked.map(n=>n.id).join(',');
    if(bar.dataset.key!==key){bar.dataset.key=key;bar.replaceChildren();
      if(picked.length>1){const count=document.createElement('span');count.className='count';count.textContent=`${picked.length} 个节点`;bar.append(count);}
      for(const [icon,label,action] of [['crop','裁剪 · 后续复刻',null],['cube','3D 片场 · 后续复刻',null],['edit','图片编辑 · 后续复刻',null],['brush','重命名',()=>rename(picked[0])],['more','更多操作',e=>nodeMenu(e.clientX,e.clientY)],['tag','标签 · 后续复刻',null],['folder','复制节点',duplicate],['download','下载图片',()=>download(picked[0])],['expand','预览',()=>preview(picked[0])]]){const b=document.createElement('button');b.className='icon-btn';b.innerHTML=svg(icon);b.title=label;b.setAttribute('aria-label',label);if(action)b.onclick=action;else b.disabled=true;bar.append(b);}
    }
    if(picked.length===1&&window.CanvasMenus?.positionToolbar(picked[0],view))return;
    const displayed=picked.map(n=>({...n,...window.NodeEditor?.layoutFor(n)}));
    const minX=Math.min(...displayed.map(n=>n.x)),maxX=Math.max(...displayed.map(n=>n.x+n.width)),minY=Math.min(...displayed.map(n=>n.y));
    const center=(minX+maxX)/2*view.scale+view.x;
    bar.style.left=Math.max(10,Math.min(innerWidth-bar.offsetWidth-10,center-bar.offsetWidth/2))+'px';bar.style.top=Math.max(65,minY*view.scale+view.y-61)+'px';
  }
  function closeMenu(){if(window.CanvasMenus)return window.CanvasMenus.close();const menu=$('#menu');if(!menu.hidden)menu.hidden=true;}
  function menu(x,y,items){if(window.CanvasMenus)return window.CanvasMenus.show(x,y,items);const el=$('#menu');el.replaceChildren();items.forEach(item=>{if(!item){el.append(document.createElement('hr'));return;}const b=document.createElement('button');b.textContent=item.label;if(item.key){const k=document.createElement('small');k.textContent=item.key;b.append(k);}b.disabled=!item.run;if(item.danger)b.className='danger';b.onclick=()=>{closeMenu();item.run();};el.append(b);});el.hidden=false;el.style.left=Math.max(8,Math.min(innerWidth-el.offsetWidth-8,x))+'px';el.style.top=Math.max(8,Math.min(innerHeight-el.offsetHeight-8,y))+'px';}
  function rename(n){const text=prompt('节点名称',n.title);if(text!==null&&text.trim()){remember();n.title=text.trim();rebuildAndPersist();}}
  function duplicate(){
    if(!selected.size)return;
    const ids=window.CanvasGroups.descendants(nodes,selected),copies=nodes.filter(n=>ids.has(n.id));
    if(copies.some(n=>n.type==='studio')){notify('暂不支持复制 3D 片场。');return;}
    remember();const mapping=new Map(copies.map(n=>[n.id,crypto.randomUUID()]));
    const added=copies.map(n=>({...clone(n),id:mapping.get(n.id),parentId:mapping.get(n.parentId),memberIds:n.memberIds?.map(id=>mapping.get(id)),...(n.clips?{clips:n.clips.map(c=>({...c,id:crypto.randomUUID(),sourceId:mapping.get(c.sourceId)||c.sourceId}))}:{}),x:n.x+80,y:n.y+100}));
    for(let i=0;i<added.length;i++)if(copies[i].type==='text'&&copies[i].generation&&window.CanvasText?.remapGeneration)added[i].generation=window.CanvasText.remapGeneration(copies[i],mapping);
    edges.push(...edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({...clone(e),id:crypto.randomUUID(),path:undefined,source:mapping.get(e.source),target:mapping.get(e.target)})));
    nodes.push(...added);const pileOwners=window.CanvasPiles.index(nodes).owner;selected=new Set(added.filter(n=>!n.parentId&&!pileOwners.has(n.id)).map(n=>n.id));rebuildAndPersist();
  }
  function removeSelected(){
    if(!selected.size)return;remember();const removed=window.CanvasGroups.descendants(nodes,selected),sources=nodes.filter(n=>removed.has(n.id));
    // Removing a source and its bound prompt mentions must share one undo entry.
    for(const n of nodes)if(n.type==='text'&&(n.generation||n.textMode==='generate')&&!removed.has(n.id)){
      const next=window.CanvasText?.withoutSources?.(n,sources,nodes,edges);if(next)n.generation=next;
    }
    nodes=nodes.filter(n=>!removed.has(n.id));edges=edges.filter(e=>!removed.has(e.source)&&!removed.has(e.target));selected.clear();rebuildAndPersist();
  }
  function nodeMenu(x,y){if(window.CanvasMenus)return window.CanvasMenus.node(x,y);const picked=nodes.filter(n=>selected.has(n.id));if(picked.length===1&&picked[0].type==='pile'){menu(x,y,[{label:'取消堆叠',run:()=>window.CanvasApp.unstack(picked[0].id)},{label:'下载全部',run:()=>window.CanvasPilesUI.downloadAll(picked[0].id).catch(e=>notify(e.message))},null,{label:'副本',key:'⌘D',run:duplicate},{label:'删除',key:'⌫',run:removeSelected,danger:true}]);return;}if(picked.length===1&&picked[0].type==='group')return;if(picked.some(n=>n.type==='studio')){menu(x,y,[{label:'复制',key:'⌘C'}, {label:'粘贴',key:'⌘V'}, {label:'副本'},null,{label:'删除',key:'⌫,del',run:removeSelected},null,{label:'反馈问题',run:()=>window.FeedbackAPI.open(picked.map(n=>n.id))}]);return;}menu(x,y,[{label:'重命名',run:()=>rename(nodes.find(n=>selected.has(n.id)))},{label:'下载图片',run:()=>download(nodes.find(n=>selected.has(n.id)))},null,{label:'副本',key:'⌘D',run:duplicate},{label:'删除',key:'⌫',run:removeSelected,danger:true}]);}
  function download(n){if(blockedPrimaryMedia(n)){notify('原站媒体待导入本地；旧引用已保留。请重新导入后下载。');return;}if(window.CanvasMenus)return window.CanvasMenus.download(mediaDisplayNode(n)).catch(e=>notify(e.message));if(!n?.image)return;const ref=actionMediaRef(n);if(!ref)return;const a=document.createElement('a');a.href=ref;const ext=a.href.startsWith('data:image/png')?'png':a.href.startsWith('data:image/webp')?'webp':a.href.split(/[?#]/)[0].match(/\.(png|webp|jpe?g)$/i)?.[1]||'jpg';a.download=(n.title||'image')+'.'+ext;a.click();}
  function preview(n){
    if(blockedPrimaryMedia(n)){notify('原站媒体待导入本地；旧引用已保留。请重新导入后预览。');return;}
    if(n.tool==='image-editor'&&window.CanvasImageEditor){window.CanvasImageEditor.open(n);return;}
    n=mediaDisplayNode(n);
    if(n.type==='playlist'){window.CanvasPlaylist?.open(n.id);return;}if(n.type==='group')return;if(n.type==='pile'){window.CanvasPilesUI.open(n.id);return;}
    if(n.type==='audio'&&n.audio){window.AudioAPI?.preview(n);return;}
    if(n.type==='studio'){window.StudioAPI?.open(n.id);return;}if(n.type==='world'){window.WorldNode?.preview(n.id);return;}
    if(n.type==='text'){window.CanvasTextUI.open(n,{readonly:!nodes.some(v=>v.id===n.id)});return;}
    if(window.MediaPreview)window.MediaPreview.open(n);else import('./media-preview-ui.mjs').then(m=>window.MediaPreview.open(n)).catch(e=>notify(e.message));
  }
  function newNode(type,point={x:innerWidth/2,y:innerHeight/2},image=null,title=null,initialPatch={}){return {id:crypto.randomUUID(),type,title:title||(type==='text'?'Text':type==='video'?'Video':type==='audio'?'Audio':'Image generation'),x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale,width:['text','audio'].includes(type)?300:type==='studio'?375:446,height:type==='text'?200:type==='audio'?300:250,image,...(type==='text'?{textMode:'generate',content:'',generation:window.CanvasText.config({})}:{}),...structuredClone(initialPatch)};}
  function addNode(type,point={x:innerWidth/2,y:innerHeight/2},image=null,title=null,initialPatch={}){remember();const n=newNode(type,point,image,title,initialPatch);nodes.push(n);selected=new Set([n.id]);rebuild();return n;}
  function addMenu(x,y){if(window.CanvasCommands){if(document.querySelector('.command-dock'))return window.CanvasCommands.close();return window.CanvasCommands.open(x,y,'dock');}menu(x,y,[{label:'文本',run:()=>addNode('text')},{label:'图片',run:()=>addNode('image')},{label:'视频',run:()=>addNode('video')},{label:'音频',run:()=>addNode('audio')},{label:'3D 片场',run:()=>addNode('studio',undefined,null,'3D 片场')},null,{label:'上传图片',run:()=>$('#upload').click()}]);}
  function search(){window.CanvasSearchUI?.open();}
  function notify(message){let status=$('#canvas-status');if(!status){status=document.createElement('div');status.id='canvas-status';status.setAttribute('role','status');document.body.append(status);}status.textContent=message;clearTimeout(status.timer);status.timer=setTimeout(()=>status.remove(),3500);}
  function focusNode(id){
    cancelViewportAnimation();
    id=window.CanvasPiles.index(nodes).owner.get(id)||id;
    const node=nodes.find(n=>n.id===id);if(!node)return;
    selected=new Set([id]);render();
    const element=nodeElements.get(id),revision=focusRevision;
    clearTimeout(searchFocusTimer);searchFocusElement?.classList.remove('node-search-focus');
    searchFocusElement=element;element.classList.add('node-search-focus');
    searchFocusTimer=setTimeout(()=>{element.classList.remove('node-search-focus');searchFocusElement=null;},1100);
    // Official search waits for selection layout and only includes an editor nested in the node.
    // A screen-fixed portal must not feed its zoom-dependent bounds back into the next fit.
    viewportFrame=requestAnimationFrame(()=>{viewportFrame=requestAnimationFrame(()=>{
      if(revision!==focusRevision)return;
      const current=nodes.find(n=>n.id===id);if(!current)return;
      const bounds={x:current.x,y:current.y,width:current.width,height:current.height};
      const editor=element.querySelector('.node-editor:not([hidden])');
      let padding=.35;
      if(editor&&!editor.classList.contains('node-float-ui-hidden')){
        const r=editor.getBoundingClientRect(),c=canvas.getBoundingClientRect();
        const left=(r.left-c.left-view.x)/view.scale,top=(r.top-c.top-view.y)/view.scale;
        const right=Math.max(bounds.x+bounds.width,(r.right-c.left-view.x)/view.scale);
        const bottom=Math.max(bounds.y+bounds.height,(r.bottom-c.top-view.y)/view.scale);
        bounds.x=Math.min(bounds.x,left);bounds.y=Math.min(bounds.y,top);
        bounds.width=right-bounds.x;bounds.height=bottom-bounds.y;padding=.2;
      }
      animateView(window.CanvasSearch.fit(bounds,{width:canvas.clientWidth,height:canvas.clientHeight},padding),500);
    });});
  }
  canvas.addEventListener('wheel',e=>{
    cancelViewportAnimation();e.preventDefault();closeMenu();
    // Translation needs no pointer anchor. Read live bounds only for pinch so
    // sidebar/layout changes cannot leave a stale zoom origin.
    let point;
    if(e.ctrlKey){const r=canvas.getBoundingClientRect();point={x:e.clientX-r.left,y:e.clientY-r.top};}
    view=window.CanvasNavigation.wheel(view,e,point,navigator.userAgent.includes('Mac'));scheduleRender(true);
  },{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    flushRender();gestureQueue.clear();
    cancelViewportAnimation();
    if(window.FocusEdit?.active()&&e.button===0&&!space)return;
    if(e.button===2){suppressContext=false;rightContext={nodeId:e.target.closest('.node')?.dataset.id,moved:false};gesture={mode:'right-pan',x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};canvas.setPointerCapture(e.pointerId);return;}rightContext=null;const resize=e.target.closest('[data-group-resize],[data-text-resize]');if(resize){const n=nodes.find(n=>n.id===resize.closest('.node').dataset.id);gesture={mode:resize.dataset.textResize?'text-resize':'group-resize',id:n.id,handle:resize.dataset.textResize||resize.dataset.groupResize,x:e.clientX,y:e.clientY,bounds:{x:n.x,y:n.y,width:n.width,height:n.height},saved:false};resize.setPointerCapture(e.pointerId);e.preventDefault();return;}if(e.target.closest('.version-control,.version-option,input,textarea,[contenteditable]'))return;closeMenu();canvas.focus({preventScroll:true});
    const node=e.target.closest('.node'),port=e.target.closest('[data-port]');
    if(port)return;
    const pan=space||e.button===1;
    if(pan){if(!space&&e.button===0)selected.clear();gesture={mode:'pan',x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};canvas.classList.add('panning');}
    else if(node){const id=node.dataset.id;if(e.shiftKey){selected.has(id)?selected.delete(id):selected.add(id);}else if(!selected.has(id))selected=new Set([id]);gesture={mode:'node',x:e.clientX,y:e.clientY,positions:window.CanvasGroups.positions(nodes,selected),saved:false};}
    else{selected.clear();gesture={mode:'select',x:e.clientX,y:e.clientY};$('#selection-box').hidden=false;}
    (node||canvas).setPointerCapture(e.pointerId);render();
  });
  function applyGesture(e,getPiles){if(!gesture)return;const pointerView=e.view,pointerSnap=e.snap,dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(gesture.mode==='right-pan'&&gesture.thresholdCrossed){rightContext.moved=true;closeMenu();canvas.classList.add('panning');}
    if(gesture.mode==='pan'||gesture.mode==='right-pan'){view.x=gesture.vx+dx;view.y=gesture.vy+dy;}
    if(gesture.mode==='node'&&(gesture.thresholdCrossed||gesture.saved)){if(!gesture.saved){remember();gesture.saved=true;canvas.dataset.connectionsDragging='true';}window.CanvasGroups.translate(nodes,gesture.positions,dx/pointerView.scale,dy/pointerView.scale,pointerSnap);window.CanvasPilesUI.dropTarget({x:(e.clientX-pointerView.x)/pointerView.scale,y:(e.clientY-pointerView.y)/pointerView.scale},[...selected],[...selected]);}
    if(['group-resize','text-resize'].includes(gesture.mode)&&(gesture.thresholdCrossed||gesture.saved)){if(!gesture.saved){remember();gesture.saved=true;}Object.assign(nodes.find(n=>n.id===gesture.id),(gesture.mode==='text-resize'?window.CanvasText.resize:window.CanvasGroups.resizeBounds)(gesture.bounds,gesture.handle,dx/pointerView.scale,dy/pointerView.scale));}
    if(gesture.mode==='select'){const x=Math.min(e.clientX,gesture.x),y=Math.min(e.clientY,gesture.y),w=Math.abs(dx),h=Math.abs(dy);$('#selection-box').style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;const pileOwners=(getPiles?getPiles():window.CanvasPiles.index(nodes)).owner;selected=new Set(nodes.filter(n=>{if(pileOwners.has(n.id))return false;const nx=n.x*pointerView.scale+pointerView.x,ny=n.y*pointerView.scale+pointerView.y;return nx<x+w&&nx+n.width*pointerView.scale>x&&ny<y+h&&ny+n.height*pointerView.scale>y;}).map(n=>n.id));}
  }
  function moveGesture(e){
    if(!gesture)return;
    gestureQueue.push(gesture,e,{view:{...view},snap});
    scheduleRender(gesture.mode==='pan'||gesture.mode==='right-pan');
  }
  canvas.addEventListener('pointermove',moveGesture);
  let suppressContext=false,rightContext=null;
  const finish=e=>{if(e?.type==='pointerup'&&gesture&&(e.clientX!==(gesture.lastX??gesture.x)||e.clientY!==(gesture.lastY??gesture.y)))moveGesture(e);flushRender();if(gesture?.mode==='right-pan')suppressContext=!!e&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>3;if(gesture?.saved){let persisted=false;if(gesture.mode==='node'){for(const id of selected){const el=nodeElements.get(id);if(el?.dataset.type==='pile')el.dataset.pileDragged='true';}const point=e?{x:(e.clientX-view.x)/view.scale,y:(e.clientY-view.y)/view.scale}:null,target=point&&window.CanvasPiles.dropTarget(nodes,point,[...selected],[...selected]);if(target&&e.type!=='pointercancel'){const before=window.PileMotion.capture(nodes,view);window.CanvasPiles.join(nodes,target.id,[...selected]);selected=new Set([target.id]);rebuildAndPersist();persisted=true;window.PileMotion.play(before,nodes,view,target.memberIds,'entry');}else window.CanvasGroups.autoGroup(nodes,gesture.positions.map(n=>n.id));}if(!persisted)persist();render();}gestureQueue.clear();gesture=null;delete canvas.dataset.connectionsDragging;window.CanvasPilesUI.clearDropTarget();canvas.classList.remove('panning');$('#selection-box').hidden=true;};
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(suppressContext||rightContext?.moved){suppressContext=false;return;}const n=rightContext?.nodeId?nodeElements.get(rightContext.nodeId):e.target.closest('.node');if(n){if(!selected.has(n.dataset.id))selected=new Set([n.dataset.id]);render();nodeMenu(e.clientX,e.clientY);}else if(window.CanvasCommands)window.CanvasCommands.context(e.clientX,e.clientY,{undo:history.length>0,redo:future.length>0});else menu(e.clientX,e.clientY,[{label:'上传图片',run:()=>$('#upload').click()},{label:'添加图片节点',run:()=>addNode('image',{x:e.clientX,y:e.clientY})},{label:'添加文本节点',run:()=>addNode('text',{x:e.clientX,y:e.clientY})},null,{label:'撤销',key:'⌘Z',run:history.length?()=>undo():null},{label:'重做',key:'⇧⌘Z',run:future.length?()=>undo(true):null}]);});
  let canvasKeyboardScope='external';
  const updateKeyboardScope=e=>canvasKeyboardScope=window.CanvasClipboard.keyboardScope(window.CanvasClipboard.eventTarget(e,document),canvas);
  document.addEventListener('pointerdown',updateKeyboardScope,true);
  document.addEventListener('focusin',updateKeyboardScope,true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')canvasKeyboardScope='external';});
  window.addEventListener('blur',()=>canvasKeyboardScope='external');
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||window.CanvasClipboard.isComposing(e))return;
    const keyboardTarget=window.CanvasClipboard.eventTarget(e,document);
    if(window.CanvasClipboard.keyboardScope(keyboardTarget,canvas)!=='canvas'&&!(canvasKeyboardScope==='canvas'&&(keyboardTarget===document.body||keyboardTarget===document.documentElement)))return;
    if(document.body.classList.contains('video-masking')||document.body.classList.contains('video-reshoot-active')||document.body.classList.contains('video-creation-active')||document.body.classList.contains('studio-active')||document.body.classList.contains('media-editing')||document.body.classList.contains('video-trimming')||document.body.classList.contains('text-viewer-active')||document.body.classList.contains('pile-gallery-active')||e.target.closest('input,textarea,[contenteditable],#node-editor,#parameter-popover,.playlist-preview,.playlist-menu,.playlist-node button,.playlist-clip,.canvas-command-menu,.connection-menu,.world-generation,.world-popover,.selection-connection-handle,#text-generation-panel,.text-generation-menu,.floating-panel,#agent-panel,.canvas-comment,.node-action-panel,.task-tray'))return;
    if($$('dialog[open]').length)return;
    if(e.key==='Escape'){closeMenu();selected.clear();window.CanvasConnections?.cancel();window.CanvasConnections?.clearSelection();render();return;}
    if(e.code==='Space'){e.preventDefault();space=true;canvas.classList.add('space');}
    if((e.metaKey||e.ctrlKey)&&['k','f'].includes(e.key.toLowerCase())){e.preventDefault();search();}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'&&!window.CanvasMenus&&!e.repeat&&!e.shiftKey&&!e.altKey){e.preventDefault();duplicate();}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'){e.preventDefault();const pileOwners=window.CanvasPiles.index(nodes).owner;selected=new Set(nodes.filter(n=>!pileOwners.has(n.id)).map(n=>n.id));render();}
    if((e.key==='Backspace'||e.key==='Delete')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&selected.size){e.preventDefault();removeSelected();}
    if(e.key==='0')resetView();if(e.key==='?')$('#help-dialog').showModal();
    if((e.metaKey||e.ctrlKey)&&['+','=','-'].includes(e.key)){e.preventDefault();const scale=Math.max(.15,Math.min(2,view.scale+(e.key==='-'?-.1:.1))),ratio=scale/view.scale;animateView({x:canvas.clientWidth/2-(canvas.clientWidth/2-view.x)*ratio,y:canvas.clientHeight/2-(canvas.clientHeight/2-view.y)*ratio,scale},200);}
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;canvas.classList.remove('space');}});
  window.addEventListener('blur',()=>{space=false;finish();canvas.classList.remove('space');});
  $('#zoom').addEventListener('input',e=>zoomAt(Number(e.target.value)));
  $('#reset').onclick=resetView;$('#return-nodes').onclick=returnToNodes;
  $('#toggle-edges').onclick=e=>{const hidden=$('#edges').style.visibility!=='hidden';$('#edges').style.visibility=hidden?'hidden':'visible';e.currentTarget.classList.toggle('active',hidden);e.currentTarget.setAttribute('aria-pressed',hidden);};
  $('#toggle-snap').onclick=e=>{snap=!snap;e.currentTarget.classList.toggle('active',snap);e.currentTarget.setAttribute('aria-pressed',snap);};

  $('#search').onclick=search;
  $('#add').onclick=()=>addMenu(80,Math.min(innerHeight-275,innerHeight/2-165));$('#help').onclick=()=>$('#help-dialog').showModal();
  $('#project-menu').onclick=()=>menu(16,64,[{label:'新建画布',run:()=>window.CanvasProjectsUI?.create()},{label:'切换画布',run:()=>window.CanvasProjectsUI?.open()},{label:'重命名画布',run:()=>window.CanvasProjectsUI?.rename()},{label:'保存画布',run:()=>window.CanvasApp.saveProject().then(()=>notify('画布已保存'),error=>notify(error.message))},{label:'重置视图',run:resetView},{label:'查找节点',run:search},{label:'撤销',run:history.length?()=>undo():null}]);
  $('#project-title').onclick=()=>window.CanvasProjectsUI?.open();
  $('#project-title').ondblclick=()=>window.CanvasProjectsUI?.rename();
  $$('.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('#upload').onchange=e=>{[...e.target.files].forEach(file=>{if(!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=()=>addNode('image',undefined,reader.result,file.name);reader.readAsDataURL(file);});e.target.value='';};
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#menu,#add,#project-menu,#node-toolbar'))closeMenu();});
  window.addEventListener('resize',()=>{cancelViewportAnimation();render();});
  window.CanvasApp = {
    getState:()=>({nodes,edges,selected:[...selected],view:{...view}}),
    projectIdentity:()=>window.CanvasProjects?.current()||{id:'canvas',title:$('#project-title').textContent},
    projectSnapshot:()=>window.CanvasProjects?.snapshot({version:1,nodes,edges},view,history,future)||{version:1,nodes,edges},
    resourceMigrationStatus:()=>resourceMigrationStatus?structuredClone(resourceMigrationStatus):null,
    async saveProject(){if(!graphLoaded||graphReadFailed)throw Error('画布尚未成功读取，已停止保存以保护已有数据');flushGesture();saveView();const saving=persist();if(!saving)throw Error('当前画布未能保存，请保留此页面并重试');await saving;await window.CanvasStore.flush();},
    async prepareProjectNavigation(){cancelViewportAnimation();await this.saveProject();},
    async renameProject(name){if(!graphLoaded||graphReadFailed)throw Error('画布尚未成功读取，请稍后重试');window.CanvasProjects.setTitle(name);await this.saveProject();return window.CanvasProjects.current();},
    historyState:()=>({undoCount:history.length,redoCount:future.length}),
    // Feature renderers reuse the reconciled shell; never retain it across rebuilds.
    getNodeElement:id=>nodeElements.get(id)||null,
    select(id,focus=false){flushGesture();if(focus)cancelViewportAnimation();id=window.CanvasPiles.index(nodes).owner.get(id)||id;selected=new Set(id?[id]:[]);const n=nodes.find(n=>n.id===id);if(focus&&n){view.scale=.7;view.x=(canvas.clientWidth)/2-(n.x+n.width/2)*view.scale;view.y=Math.min(320,innerHeight*.35)-(n.y+n.height/2)*view.scale;}render();},
    transitionView:animateView,
    fitNode(id,{padding=.35,minZoom=.15,maxZoom=2,duration=500}={}){flushGesture();const n=nodes.find(n=>n.id===id);if(n)animateView(window.CanvasSearch.fit(n,{width:canvas.clientWidth,height:canvas.clientHeight},padding,{min:minZoom,max:maxZoom}),duration);},
    preview,addNode,download,render,resetView,returnToNodes,undo,focusNode,notify,duplicate,
    captureSelection(){return window.CanvasClipboard.capture(nodes,edges,selected);},
    pasteGraph(snapshot,point,iteration=0){const graph=window.CanvasClipboard.instantiate(snapshot,nodes,point,iteration,view.scale);remember();nodes.push(...graph.nodes);edges.push(...graph.edges);selected=new Set(graph.selected);rebuildAndPersist();return graph;},
    stack(ids=[...selected]){if(!window.CanvasPiles.plan(nodes,ids))throw Error('请选择2–50个可堆叠节点');const before=window.PileMotion.capture(nodes,view);remember();const pile=window.CanvasPiles.stack(nodes,ids,crypto.randomUUID());selected=new Set([pile.id]);rebuild();window.PileMotion.play(before,nodes,view,pile.memberIds,'entry');return pile;},
    unstack(id){if(!nodes.some(n=>n.id===id&&n.type==='pile'))throw Error('堆叠不存在');const before=window.PileMotion.capture(nodes,view);remember();const positions=window.CanvasPiles.unstack(nodes,id);selected=new Set(positions.map(n=>n.id));rebuild();window.PileMotion.play(before,nodes,view,positions.map(n=>n.id),'unstack',new Map(positions.map(p=>[p.id,p.animationIndex])));return positions;},
    joinPile(id,ids){if(!window.CanvasPiles.plan(nodes,[id,...ids]))throw Error('无法加入该堆叠');const before=window.PileMotion.capture(nodes,view);remember();const pile=window.CanvasPiles.join(nodes,id,ids);selected=new Set([pile.id]);rebuild();window.PileMotion.play(before,nodes,view,pile.memberIds,'entry');return pile;},
    bringPileMemberToTop(pileId,id){const p=nodes.find(n=>n.id===pileId&&n.type==='pile');if(!p?.memberIds.includes(id))throw Error('成员不存在');if(p.memberIds.at(-1)===id)return;remember();p.memberIds=p.memberIds.filter(n=>n!==id).concat(id);rebuild();},
    releasePile(pileId,id,point,targetId){const pileState=window.CanvasPiles.index(nodes);if(pileState.owner.get(id)!==pileId||![point.x,point.y].every(Number.isFinite))throw Error('无效的堆叠成员或坐标');const target=targetId&&nodes.find(n=>n.id===targetId&&n.type==='pile');if(targetId&&(!target||targetId===pileId||pileState.members.get(targetId).length>=50))throw Error('目标堆叠无效或已满');remember();const node=window.CanvasPiles.release(nodes,pileId,id,point);if(target)window.CanvasPiles.join(nodes,targetId,[id]);selected=new Set([target?.id||id]);rebuild();return node;},
    selectMany(ids){flushGesture();const owner=window.CanvasPiles.index(nodes).owner,nodeIds=new Set(nodes.map(n=>n.id));selected=new Set(ids.map(id=>owner.get(id)||id).filter(id=>nodeIds.has(id)));render();},
    group(ids=[...selected]){const owner=window.CanvasPiles.index(nodes).owner;ids=[...new Set(ids.map(id=>owner.get(id)||id))];if(!window.CanvasGroups.eligible(nodes,ids))throw Error('请选择2–50个不在同一分组的节点');remember();const group=window.CanvasGroups.group(nodes,ids,crypto.randomUUID());selected=new Set([group.id]);rebuild();return group;},
    ungroup(id){if(!nodes.some(n=>n.id===id&&n.type==='group'))throw Error('分组不存在');remember();selected=new Set(window.CanvasGroups.ungroup(nodes,id));rebuild();},
    layoutNodes(mode,ids=[...selected]){const owner=window.CanvasPiles.index(nodes).owner;ids=[...new Set(ids.map(id=>owner.get(id)||id))];remember();const result=window.CanvasGroups.layout(nodes,edges,ids,mode,window.CanvasDagre);rebuild();return result;},
    moveNodes(ids,dx,dy){if(![dx,dy].every(Number.isFinite))throw Error('移动坐标无效');remember();const snapshot=window.CanvasGroups.positions(nodes,ids);window.CanvasGroups.translate(nodes,snapshot,dx,dy);window.CanvasGroups.autoGroup(nodes,snapshot.map(n=>n.id));rebuild();},
    remove(ids){selected=new Set(ids);removeSelected();},
    async createDraftFinalNode(sourceId){
      const {createFinalPlan}=await import('./src/features/video-generation/draft-final.mjs');
      flushGesture();
      if(window.GenerationAPI?.getJobs().some(job=>job.request.nodeId===sourceId&&(['queued','running'].includes(job.status)||job.applying)))throw Error('样片正在生成，请等待完成或取消任务');
      const source=nodes.find(n=>n.id===sourceId);
      if(source?.pendingOperation)throw Error('样片正在生成，请等待完成或取消任务');
      const plan=createFinalPlan(source,nodes,{id:crypto.randomUUID(),edgeId:crypto.randomUUID()});
      remember();nodes.push(plan.node);edges.push(plan.edge);selected=new Set([plan.node.id]);rebuild();
      return plan.node;
    },
    connect(source,target){
      const error=window.CanvasConnections?.validate(source,target);if(error)throw Error(error);
      if(!nodes.some(n=>n.id===source)||!nodes.some(n=>n.id===target)||source===target)throw Error('连接节点无效');
      if(edges.some(e=>e.source===source&&e.target===target))throw Error('这两个节点已经连接');
      const purpose=window.CanvasConnections?.purposeFor?.(target);
      remember();const edge={id:crypto.randomUUID(),source,target,sourceHandle:'right',targetHandle:'left',...(purpose?{purpose}:{})};edges.push(edge);
      if(window.CanvasConnections){render();persist();}else rebuild();return edge;
    },
    disconnect(source,target){window.CanvasApp.removeEdges(edges.filter(e=>e.source===source&&e.target===target).map(e=>e.id));},
    removeEdges(ids){
      const removed=new Set(ids),links=edges.filter(e=>removed.has(e.id));if(!links.length)return;
      remember();
      // A reference and its visible connection are one undoable action. Clearing
      // legacy URL copies prevents a deleted edge reappearing as a saved input.
      for(const target of new Set(links.map(e=>e.target))){const n=nodes.find(n=>n.id===target);if(n&&['image','video','text'].includes(n.type)){const sources=links.filter(e=>e.target===target).map(e=>nodes.find(n=>n.id===e.source)).filter(Boolean);const next=n.type==='text'?window.CanvasText?.withoutSources?.(n,sources,nodes,edges):window.NodeEditor?.withoutSources(n,sources);if(next)n.generation=next;}}
      edges=edges.filter(e=>!removed.has(e.id));if(window.CanvasConnections){render();persist();}else rebuild();
    },
    addConnectionNode(originId,side,draft){
      if(!['left','right'].includes(side)||!['image','video','text','audio','world'].includes(draft.type)||![draft.x,draft.y,draft.width,draft.height].every(Number.isFinite)||draft.width<=0||draft.height<=0)throw Error('节点参数无效');
      const node={...clone(draft),id:crypto.randomUUID()},source=side==='left'?node.id:originId,target=side==='left'?originId:node.id;
      const error=window.CanvasConnections?.validate(source,target,[...nodes,node],edges);if(error)throw Error(error);
      remember();nodes.push(node);edges.push({id:crypto.randomUUID(),source,target,sourceHandle:'right',targetHandle:'left'});selected=new Set([node.id]);
      makeNode(node);render();persist();return node;
    },
    addSelectionConnectionNode(ids,draft){
      const wanted=new Set(ids),byId=new Map();
      // Keep first-match lookup and missing entries: validation must still reject
      // stale selections instead of silently connecting only surviving nodes.
      if(wanted.size)for(const node of nodes){const id=node.id;if(wanted.has(id)&&!Number.isNaN(id)&&!byId.has(id)){byId.set(id,node);if(byId.size===wanted.size)break;}}
      const sources=[...wanted].map(id=>byId.get(id));
      if(sources.length<2||sources.some(n=>!n)||!['image','video','text','world'].includes(draft.type)||![draft.x,draft.y,draft.width,draft.height].every(Number.isFinite)||draft.width<=0||draft.height<=0)throw Error('选区或节点参数无效');
      const ordered=window.CanvasConnections.selectionInputs(draft.tool==='image-editor'?'imageEditor':draft.type,sources);
      const node={...clone(draft),id:crypto.randomUUID()};
      remember();nodes.push(node);edges.push(...ordered.map(source=>({id:crypto.randomUUID(),source,target:node.id,sourceHandle:'right',targetHandle:'left'})));
      makeNode(node);render();persist();return node;
    },
    setView(next){cancelViewportAnimation();view={...view,...next};render({viewportOnly:true});},
    insertDerived(sourceId,image,width,height){const source=nodes.find(n=>n.id===sourceId);if(!source)return;remember();const n={id:crypto.randomUUID(),type:'image',title:'Cropped Image',image,x:source.x+source.width+160,y:source.y,width:446,height:446*height/width};nodes.push(n);edges.push({id:crypto.randomUUID(),source:sourceId,target:n.id});selected=new Set([n.id]);rebuild();return n;},
    createConnected(sourceId,outputs,options={}){
      const source=nodes.find(n=>n.id===sourceId);if(!source)throw new Error('来源节点已不存在');if(!outputs.length)return [];
      const placements=window.CanvasGeometry.placeOutputs(source,outputs,nodes,options.side,options);remember();const added=placements.map(o=>({...o,id:crypto.randomUUID(),type:o.type||'image',title:o.title||'Image',sourceId}));
      nodes.push(...added);added.forEach(n=>edges.push({id:crypto.randomUUID(),source:options.reverse?n.id:sourceId,target:options.reverse?sourceId:n.id}));selected=new Set(added.map(n=>n.id));rebuild();return added;
    },
    async commitGenerationPlan(plan,{isActive=()=>true}={}){
      generationPlanModule||=import('./src/features/generation-results/plan.mjs');
      const planner=await generationPlanModule;
      if(!isActive())throw Error('生成任务已取消，结果占位未创建');
      flushGesture();planner.assertPlanCurrent(plan,nodes,edges);
      const runId=plan.additionalParameters?.batch_id,ids=plan.targetNodeIds;
      if(typeof runId!=='string'||!runId||generationRuns.has(runId)||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('生成事务标识或目标无效');
      const byId=new Map(nodes.map(node=>[node.id,node])),changed=new Set(),changes=clone(plan.nodeChanges),edgeChanges=clone(plan.edgeChanges),edgeIds=new Set(edges.map(edge=>edge.id));
      for(const change of changes){
        const node=change.item,id=node?.id;
        if(!['add','replace'].includes(change.type)||typeof id!=='string'||!id||changed.has(id)||!['x','y','width','height'].every(key=>Number.isFinite(node[key]))||node.width<=0||node.height<=0||change.type==='add'&&byId.has(id)||change.type==='replace'&&(!byId.has(id)||change.id!==id))throw Error('生成节点变更无效');
        changed.add(id);byId.set(id,node);
      }
      for(const change of edgeChanges){const edge=change.item;if(change.type!=='add'||!edge||typeof edge.id!=='string'||!edge.id||edgeIds.has(edge.id)||!byId.has(edge.source)||!byId.has(edge.target))throw Error('生成参考连线无效');edgeIds.add(edge.id);}
      for(const id of ids){const node=byId.get(id);if(!changed.has(id)||node?.generationRun?.runId!==runId||node.pendingOperation!==`${node.type}.generate`)throw Error('生成占位标识不匹配');
        node.generationRecovery={version:1,runId,kind:node.pendingOperation,targetNodeIds:[...ids],signature:generationSignature(node)};
      }
      remember();
      const replacements=[];
      for(const change of changes){if(change.type==='add')nodes.push(change.item);else{
        const index=nodes.findIndex(node=>node.id===change.id);replacements.push({before:nodes[index],after:change.item});
        // A planned replacement is an intentional identity transition. Do not
        // let history's DOM reconciliation mutate the original source object:
        // dispatch guards need its unchanged fields and the actual new identity.
        removeNodeElement(change.id);nodes[index]=change.item;
      }}
      edges.push(...edgeChanges.map(change=>change.item));rebuildAndPersist();
      generationRuns.set(runId,ids.map(id=>{const node=nodes.find(item=>item.id===id);return {id,node,signature:generationSignature(node),token:JSON.stringify(node.generationRun),operation:node.pendingOperation};}));
      const receipt={runId,targetNodeIds:[...ids]};Object.defineProperty(receipt,'replacements',{value:replacements});return receipt;
    },
    restoreGenerationResults({runId,kind,targetNodeIds:ids,requestPlans}){
      const invalid=()=>{throw Object.assign(Error('原占位缺失、已编辑或没有可验证的恢复基准；未应用结果'),{code:'unsafe_generation_recovery'});};
      if(typeof runId!=='string'||!runId||!['image.generate','video.generate','text.generate'].includes(kind)||!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||!Array.isArray(requestPlans)||!requestPlans.length)invalid();
      const targets=[],requestIds=new Set();
      for(const request of requestPlans){if(!request||typeof request.requestId!=='string'||!request.requestId||requestIds.has(request.requestId)||!Array.isArray(request.targets)||!request.targets.length)invalid();requestIds.add(request.requestId);for(const [index,target]of request.targets.entries()){if(!target||target.resultIndex!==index)invalid();targets.push({id:target.nodeId,token:{runId,requestId:request.requestId,resultIndex:index}});}}
      if(targets.length!==ids.length||targets.some((target,index)=>target.id!==ids[index]))invalid();
      const existing=generationRuns.get(runId);
      if(existing){if(existing.length!==ids.length||existing.some((guard,index)=>guard.id!==ids[index]||guard.operation!==kind||guard.token!==JSON.stringify(targets[index].token)||!generationTargetMatches(guard,runId,true)))invalid();return {runId,targetNodeIds:[...ids],restored:false};}
      const guards=targets.map(({id,token})=>{
        const matches=nodes.filter(node=>node.id===id);if(matches.length!==1)invalid();const node=matches[0],recovery=node.generationRecovery;
        if(node.type!==kind.split('.')[0]||node.pendingOperation!==kind||node.generationRun?.runId!==runId||node.generationRun.requestId!==token.requestId||node.generationRun.resultIndex!==token.resultIndex||
          recovery?.version!==1||recovery.runId!==runId||recovery.kind!==kind||!Array.isArray(recovery.targetNodeIds)||recovery.targetNodeIds.length!==ids.length||recovery.targetNodeIds.some((value,index)=>value!==ids[index])||typeof recovery.signature!=='string'||recovery.signature!==generationSignature(node))invalid();
        return {id,node,signature:recovery.signature,token:JSON.stringify(node.generationRun),operation:kind,recovered:true};
      });
      generationRuns.set(runId,guards);return {runId,targetNodeIds:[...ids],restored:true};
    },
    applyGenerationResults(runId,patches){
      const guards=generationRuns.get(runId);
      if(!guards||!Array.isArray(patches)||patches.length!==guards.length||new Set(patches.map(item=>item?.id)).size!==guards.length)throw Error('生成结果未完整对应当前任务');
      const normalized=patches.map(item=>{if(!item||!item.patch||typeof item.patch!=='object'||Array.isArray(item.patch)||Object.keys(item.patch).some(key=>['id','type','generationRun','generationRecovery','pendingOperation','__proto__','constructor','prototype'].includes(key)))throw Error('生成结果补丁无效');return {id:item.id,patch:clone(item.patch)};});
      flushGesture();
      if(guards.some(guard=>!normalized.some(item=>item.id===guard.id)||!generationTargetMatches(guard,runId,true)))throw Error('生成目标已编辑或替换，结果未应用');
      remember();
      for(const guard of guards){Object.assign(guard.node,normalized.find(item=>item.id===guard.id).patch);delete guard.node.pendingOperation;delete guard.node.generationRun;delete guard.node.generationRecovery;}
      generationRuns.delete(runId);rebuildAndPersist();return guards.map(guard=>guard.id);
    },
    getGenerationFailureTargets(runId){
      return (generationRuns.get(runId)||[]).filter(guard=>generationTargetMatches(guard,runId,true)).map(guard=>guard.node);
    },
    clearGenerationResults(runId){
      const guards=generationRuns.get(runId);if(!guards)return [];
      flushGesture();const current=guards.filter(guard=>generationTargetMatches(guard,runId,guard.recovered===true));
      if(current.length){remember();for(const guard of current){delete guard.node.pendingOperation;delete guard.node.generationRun;delete guard.node.generationRecovery;}generationRuns.delete(runId);rebuildAndPersist();}
      else generationRuns.delete(runId);
      return current.map(guard=>guard.id);
    },
    updateNode(id,patch){
      const n=nodes.find(n=>n.id===id);if(!n)return;
      const parametersOnly=['image','video'].includes(n.type)&&Object.keys(patch).every(key=>key==='generation')||n.type==='text'&&window.CanvasText?.mode?.(n)==='generate'&&Object.keys(patch).every(key=>key==='generation'||key==='textMode'&&patch.textMode==='generate');
      remember();
      if(['group','pile'].includes(n.type)&&(patch.x!==undefined||patch.y!==undefined))window.CanvasGroups.translate(nodes,window.CanvasGroups.positions(nodes,[id]),(patch.x??n.x)-n.x,(patch.y??n.y)-n.y);
      Object.assign(n,patch);
      // Prompt/model changes do not replace media. Keep decoded images, playback,
      // pointer targets and node-local overlays alive while refreshing derived layout.
      if(parametersOnly){render();persist();}else rebuildAndPersist();
    },
    insertGraph(graph){
      const ids=new Set(nodes.map(n=>n.id));if(!graph.nodes?.length||graph.nodes.some(n=>ids.has(n.id)||![n.x,n.y,n.width,n.height].every(Number.isFinite)))throw Error('导入节点无效');
      const incoming=new Set(graph.nodes.map(n=>n.id));if(incoming.size!==graph.nodes.length||graph.edges.some(e=>!incoming.has(e.source)||!incoming.has(e.target)))throw Error('导入连线无效');
      remember();nodes.push(...clone(graph.nodes));edges.push(...clone(graph.edges));selected=new Set([graph.group.id]);rebuildAndPersist();return nodes.find(n=>n.id===graph.group.id);
    },
    insertAsset(asset,point){remember();const n=newNode(asset.type||'image',point,asset.image,asset.name);n.fullImage=asset.fullImage;n.video=asset.video||window.EDITOR_DATA?.nodes[asset.nodeId]?.video;n.audio=asset.audio;if(n.type==='text'){n.content=asset.content||'';n.color=asset.color||'';n.textMode='pure';delete n.generation;}if(n.type==='audio'){n.audioMode='upload';n.width=300;n.height=300;}nodes.push(n);selected=new Set([n.id]);rebuildAndPersist();return n;},
    addTypedNode(type){addNode(type);return nodes[nodes.length-1];},
    saveSelection(){const ids=window.CanvasGroups.descendants(nodes,selected),picked=nodes.filter(n=>ids.has(n.id)&&!['group','pile'].includes(n.type));document.dispatchEvent(new CustomEvent('canvas:save-assets',{detail:clone(picked)}));},
    // Panel resizing changes screen bounds only; render still upgrades queued
    // graph gestures to a full pass before notifying floating UI consumers.
    setRightPanel(width){cancelViewportAnimation();document.documentElement.style.setProperty('--agent-width',width+'px');canvas.style.right=width+'px';render({viewportOnly:true});}
  };
  rebuild();
  window.CanvasResourceDisplayReady.then(policy=>{if(policy&&!graphLoaded&&!localChanges){nodeRecords.clear();rebuild();}});
  import('./src/features/canvas-minimap/entry.mjs').then(module=>{window.CanvasMinimap=module.install(window.CanvasApp);render();}).catch(error=>{console.error('Canvas minimap:',error);notify('小地图加载失败，请刷新页面');});
  import('./src/features/canvas-connections/entry.mjs').then(module=>{window.CanvasConnections=module.install(window.CanvasApp);render();}).catch(error=>{console.error('Canvas connections:',error);notify('连线控件加载失败，请刷新页面');});
  window.CanvasStore.load().then(async saved=>{
    await window.CanvasResourceDisplayReady;
    let valid=saved?.version===1&&Array.isArray(saved.nodes)&&Array.isArray(saved.edges)&&saved.nodes.every(n=>typeof n.id==='string'&&[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0)&&new Set(saved.nodes.map(n=>n.id)).size===saved.nodes.length&&saved.edges.every(e=>typeof e.id==='string'&&typeof e.source==='string'&&typeof e.target==='string');
    if(saved!=null&&!valid)throw Error('本地画布数据格式无效');
    if(window.CanvasProjects&&!window.CanvasProjects.isDefault()&&saved==null)throw Error('未找到此本地画布，不能保存到不存在的项目');
    if(valid&&window.CanvasProjects&&typeof window.fetch==='function'){
      const migration=await import('./src/features/local-resource-migration/canvas-load.mjs');
      const indexState=await migration.loadResourceIndex({fetchIndex:window.fetch.bind(window)});
      const expectedChanges=localChanges;
      let report;
      try{report=await migration.migrateLoadedCanvas({saved,store:window.CanvasStore,id:window.CanvasProjects.id(),indexState,canCommit:()=>localChanges===expectedChanges&&expectedChanges===0&&!graphLoaded});}
      catch(error){resourceMigrationStatus={status:'migration_failed',persisted:false,summary:null};migration.showMigrationNotice(resourceMigrationStatus);throw error;}
      resourceMigrationStatus={status:report.status,persisted:report.persisted,summary:report.summary,diagnostics:report.diagnostics||[]};
      migration.showMigrationNotice(resourceMigrationStatus);
      if(report.status==='local_edits'){window.CanvasProjects.markDirty();throw Error('资源迁移期间画布已修改，已停止恢复以保护当前内容');}
      saved=report.snapshot;valid=migration.validCanvasSnapshot(saved);
    }
    window.CanvasProjects?.hydrate(saved);
    if(valid&&!localChanges&&window.CanvasProjects){
      const savedView=window.CanvasNavigation.parseView(JSON.stringify(saved.view));
      try{if(savedView&&!window.CanvasNavigation.parseView(localStorage.getItem(viewStorageKey)))view=savedView;}catch{if(savedView)view=savedView;}
      // Hydration is a read, even when localStorage is full and the viewport
      // comes from IndexedDB. Only a later camera change needs a view save.
      lastSavedView=JSON.stringify(view);
      const validHistory=items=>Array.isArray(items)?items.filter(item=>Array.isArray(item?.nodes)&&Array.isArray(item?.edges)&&item.nodes.every(n=>typeof n.id==='string'&&[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0)&&item.edges.every(e=>typeof e.id==='string'&&typeof e.source==='string'&&typeof e.target==='string')).slice(-60):[];
      history=validHistory(saved.history);future=validHistory(saved.future);
    }
    if(valid&&!localChanges){nodes=saved.nodes;edges=saved.edges;nodes.forEach(n=>{
      const recovery=n.generationRecovery,recoverable=recovery?.version===1&&recovery.runId===n.generationRun?.runId&&recovery.kind===n.pendingOperation&&recovery.signature===generationSignature(n);
      // A pending saved placeholder must not inherit media from the seed graph.
      const seedFullImage=original.get(n.id)?.fullImage;
      if(!recoverable&&!n.fullImage&&seedFullImage&&displayMediaRef(seedFullImage))n.fullImage=seedFullImage;
    });clearOrphanGenerationState({allowRecovery:true});rebuild();}
    graphLoaded=true;if(localChanges)persist();
  }).catch(error=>{graphLoaded=false;graphReadFailed=true;storageError(error,'load');});
})();
