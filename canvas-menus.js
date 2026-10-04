(() => {
  'use strict';
  const app = window.CanvasApp, $ = s => document.querySelector(s), icons = window.CANVAS_MENU_ICONS;
  const menu = $('#menu'), bar = $('#node-toolbar');
  const toolbarIcons = new WeakMap();
  const toolbarPosition = {};
  function setToolbarPosition(key,value){
    const previous=toolbarPosition[key];
    if(previous?.input===value&&previous.output===bar.style[key])return;
    if(bar.style[key]!==value)bar.style[key]=value;
    toolbarPosition[key]={input:value,output:bar.style[key]};
  }
  let copied = null, pointer = null, pasteAnchor = null, iteration = 0;
  const safe = fn => async () => { try { await fn(); } catch (error) { app.notify(error.message); } };
  const menuControl = window.ReplicaUI.createMenu({element:menu,label:'画布操作',onError:error=>app.notify(error.message)});
  const tooltipControl = window.ReplicaUI.createTooltip({
    id:'canvas-tooltip',
    selector:'#node-toolbar button,button[data-tip]',
    canShow:()=>menu.hidden&&!$('.node-action-pop'),
    place:(button,rect,size)=>{
      let x=rect.left+(rect.width-size.width)/2,y=rect.top-size.height-8;
      if(button.closest('.side-tools')){x=rect.right+12;y=rect.top+(rect.height-size.height)/2;}
      else if(button.closest('.top-actions,.project-bar'))y=rect.bottom+8;
      else if(button.matches('.agent')){x=rect.left-size.width-12;y=rect.top+(rect.height-size.height)/2;}
      return {x,y};
    }
  });
  const hideTip = () => tooltipControl.hide();
  const close = restore => menuControl.close(restore);
  function show(x, y, items) {
    hideTip(); window.NodeActions?.closePop(); menuControl.show(x,y,items);
  }
  function copy(writeNative = true) {
    copied = app.captureSelection(); pasteAnchor = null; iteration = 0;
    // Keep the graph in this workspace; the OS clipboard only receives the source-compatible marker.
    if(writeNative)navigator.clipboard?.writeText('__tapnow_internal_copy__').catch(()=>{});
    return copied;
  }
  function paste(screen = pointer) {
    if (!copied) throw Error('请先复制画布节点');
    const canvas=$('#canvas').getBoundingClientRect(),p=screen||{x:canvas.left+canvas.width/2,y:canvas.top+canvas.height/2},view=app.getState().view;
    if (!pasteAnchor || Math.hypot(p.x-pasteAnchor.x,p.y-pasteAnchor.y)>20) {pasteAnchor={...p};iteration=0;}
    const graph=app.pasteGraph(copied,{x:(p.x-view.x)/view.scale,y:(p.y-view.y)/view.scale},iteration++);return graph;
  }
  const variants = n => n.type==='image'&&window.ImageHistory?.hasHistory(n)?window.ImageHistory.variants(n):n.type==='video'&&window.VideoHistory?window.VideoHistory.variants(n):n.versions || window.VERSION_DATA?.[n.id] || [];
  async function applyHistory(n) {
    const expected=JSON.stringify(n),projectId=app.projectIdentity?.().id,legacy=variants(n);
    const {applyNodeHistory}=await import('./src/features/node-history-expansion/runtime.mjs');
    return applyNodeHistory(n,{app,legacy,expected,projectId});
  }
  function keepMain(n) { if(n.type==='image'&&window.ImageHistory?.hasHistory(n)){app.updateNode(n.id,window.ImageHistory.keepPrimary(n));return;}if(n.type==='video'&&window.VideoHistory){app.updateNode(n.id,window.VideoHistory.keepPrimary(n));return;}app.updateNode(n.id,{versions:[{image:n.fullImage||n.image,video:n.video,label:n.title}]}); }
  async function mediaBlob(n) {
    await window.CanvasResourceDisplayReady;
    const displayRef=value=>window.CanvasResourceDisplay?.displayMediaRef(value)??(typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:''),primary=n.type==='video'?(n.video||window.EDITOR_DATA?.nodes[n.id]?.video):n.type==='audio'?n.audio:n.fullImage||n.image;
    const source=n.type==='video'||n.type==='audio'?displayRef(primary):displayRef(n.fullImage)||displayRef(n.image);
    if(!source){if(primary)throw Error('原站媒体待导入本地；旧引用已保留，请重新导入后下载或复制');throw Error('节点没有可下载的媒体');}
    const url=displayRef(source.startsWith('asset:')?await window.LocalAssets.url(source):source);if(!url)throw Error('原站媒体待导入本地；旧引用已保留，请重新导入后下载或复制');
    const response=await fetch(url);if(!response.ok)throw Error('媒体读取失败');return response.blob();
  }
  async function download(n) {
    if(!n)return;
    const blob=n.type==='text'?new Blob([n.content||''],{type:'text/markdown;charset=utf-8'}):await mediaBlob(n);
    const ext=n.type==='text'?'md':({ 'image/png':'png','image/webp':'webp','image/jpeg':'jpg','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/wav':'wav','audio/webm':'webm' }[blob.type]||({video:'mp4',audio:'wav',image:'png'}[n.type]));
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(n.title||n.type)+'.'+ext;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function copyImage(n) {
    if(!navigator.clipboard?.write||!window.ClipboardItem)throw Error('当前浏览器不支持图片剪贴板');
    // Construct the item synchronously to retain the user gesture while decoding the image.
    const png=(async()=>{const bitmap=await createImageBitmap(await mediaBlob(n));try {const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('图片编码失败')),'image/png'));}finally{bitmap.close();}})();
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);app.notify('图片已复制到剪贴板');
  }
  function node(x,y) {
    const state=app.getState(),picked=state.nodes.filter(n=>state.selected.includes(n.id)),n=picked[0];if(!n)return;
    const blocked=picked.some(n=>n.type==='studio'),items=[];
    if(n.type==='pile'&&picked.length===1){items.push({label:'取消堆叠',run:()=>app.unstack(n.id)},{label:'下载全部',run:()=>window.CanvasPilesUI.downloadAll(n.id)},null);}
    else if(n.type==='playlist'&&picked.length===1){items.push({label:'添加片段',run:()=>window.CanvasPlaylist.pick(n.id)},{label:'预览',run:n.clips?.length?()=>window.CanvasPlaylist.open(n.id):null},null);}
    else if(!blocked){
      const ids=window.CanvasGroups.descendants(state.nodes,state.selected),savable=state.nodes.some(v=>ids.has(v.id)&&(v.image||v.audio||v.video||window.EDITOR_DATA?.nodes[v.id]?.video||v.type==='text'&&v.content?.trim()));
      items.push({label:'保存到素材库',run:savable?()=>app.saveSelection():null},null);
      if(picked.length===1&&['image','video'].includes(n.type)&&(n.image||n.video)){
        items.push({label:'应用所有历史',run:()=>applyHistory(n)});
        if(variants(n).length>1)items.push({label:'删除其他版本',run:()=>keepMain(n)});
      }
      const downloadable=n.type==='text'?n.content?.trim():n.type==='video'?(n.video||window.EDITOR_DATA?.nodes[n.id]?.video):n.type==='audio'?n.audio:n.type==='image'&&(n.fullImage||n.image);
      if(picked.length===1&&downloadable)items.push({label:'下载',run:()=>download(n)},null);
    }
    items.push({label:'复制',key:'⌘C',run:blocked?null:copy},{label:'粘贴',key:'⌘V',run:!blocked&&copied?()=>paste({x,y}):null},{label:'副本',run:blocked?null:()=>app.duplicate()},null,{label:'删除',key:'⌫,del',run:()=>app.remove(picked.map(n=>n.id))},null);
    if(picked.length===1&&n.type==='image'&&n.image)items.push({label:'复制到剪贴板',run:()=>copyImage(n)},null);
    items.push({label:'反馈问题',run:()=>window.FeedbackAPI.open(picked.map(n=>n.id))});show(x,y,items);
  }
  // Geometry reads after world/style writes force synchronous layout. Observe
  // actual size changes, and synchronously invalidate structural edits so the
  // first frame after switching tools still uses the correct dimensions.
  function toolbarMeasurements(element,canvas,onResize) {
    let size=null,canvasWidth=null,lastClass='',lastStyle='',sizingAnimations=[];
    const affectsSize=property=>/^(?:(?:min-|max-)?(?:width|height)|margin(?:-.+)?|padding(?:-.+)?|(?:row-|column-)?gap|flex(?:-.+)?|font(?:-.+)?|line-height|letter-spacing|word-spacing|border(?:-.+)?-width)$/.test(property);
    const moving=animation=>animation.pending||animation.playState==='running';
    const sizingStyle=()=>element.style.cssText.replace(/(?:^|;)\s*(?:left|top):[^;]*/g,'');
    function changed(records){
      for(const record of records){
        if(record.target===canvas){canvasWidth=null;continue;}
        if(record.target===element&&record.type==='attributes'){
          if(record.attributeName==='class'&&element.className===lastClass)continue;
          if(record.attributeName==='style'&&sizingStyle()===lastStyle)continue;
        }
        size=null;
      }
    }
    const mutations=new MutationObserver(changed);
    mutations.observe(element,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
    mutations.observe(canvas,{attributes:true,attributeFilter:['class','style']});
    const resize=new ResizeObserver(()=>{size=null;canvasWidth=null;onResize();});
    resize.observe(element,{box:'border-box'});resize.observe(canvas);
    window.addEventListener('resize',()=>{size=null;canvasWidth=null;});
    element.addEventListener?.('transitionrun',event=>{if(affectsSize(event.propertyName)){size=null;onResize();}});
    return ()=>{
      changed(mutations.takeRecords());
      // ResizeObserver runs after rAF. During size transitions its last sample
      // is one frame old; read current dimensions, including the final frame.
      if(sizingAnimations.length)size=null;
      if(!size){
        sizingAnimations=(element.getAnimations?.({subtree:true})||[]).filter(animation=>affectsSize(animation.transitionProperty||'')&&moving(animation));
        size={width:element.offsetWidth,height:element.offsetHeight};lastClass=element.className;lastStyle=sizingStyle();
      }
      if(canvasWidth===null)canvasWidth=canvas.clientWidth;
      return {...size,canvasWidth};
    };
  }
  const measureToolbar=toolbarMeasurements(bar,$('#canvas'),()=>{
    const state=app.getState();
    if(state.selected.length===1)positionToolbar(state.nodes.find(n=>n.id===state.selected[0]),state.view);
  });
  function positionToolbar(node,view) {
    if(!['image','video'].includes(node?.type))return false;
    if(bar.hidden)return true;
    const n={...node,...window.NodeEditor?.layoutFor(node),...window.ImageHistory?.layoutFor(node)},{width,height,canvasWidth}=measureToolbar();
    const top=(n.type==='video'?Math.max(8,n.y*view.scale+view.y-height-48):Math.max(65,n.y*view.scale+view.y-61))+'px';
    const center=(n.x+n.width/2)*view.scale+view.x;
    const left=Math.max(8,Math.min(canvasWidth-width-8,center-width/2))+'px';
    setToolbarPosition('top',top);
    setToolbarPosition('left',left);
    return true;
  }
  function toolbar(event) {
    hideTip();if(event?.detail?.viewportOnly)return;const state=app.getState(),n=state.nodes.find(n=>state.selected.length===1&&n.id===state.selected[0]);bar.classList.toggle('image-tools',n?.type==='image');bar.classList.toggle('video-tools',n?.type==='video');
    const mapping=n?.type==='video'?['videoTrim','videoUpscale','videoReplace','videoErase','videoExtend','videoEdit','videoCapture','videoMore','pin','videoFolder','videoDownload','videoExpand']:['crop','multiAngle','edit','relight','more','pin','folder','download','expand'];
    [...bar.querySelectorAll('button')].forEach((b,i)=>{
      if(['image','video'].includes(n?.type)&&mapping[i]&&(n.type==='image'||mapping[i]==='pin')) {
        const colors=mapping[i]==='pin'?window.NodeActions.pinColors.filter(v=>window.NodeActions.pins(n).includes(v[1])):[];
        const key=JSON.stringify([mapping[i],colors]),previous=toolbarIcons.get(b);
        // Moving the selected node does not change its icons. Keep the SVG and
        // hover animation targets; rebuild after a remount or a Pin change.
        if(previous?.key!==key||previous.child!==b.firstChild){
          b.innerHTML=icons[mapping[i]];
          if(mapping[i]==='pin'){const stage=document.createElement('span');stage.className='pin-motion-stage';stage.append(...b.childNodes);b.replaceChildren(stage);colors.forEach(([,color],j)=>{const dot=document.createElement('i');dot.style.cssText=`background:${color};--pin-x:${(j-(colors.length-1)/2)*3}px;--pin-hover-x:${(j-(colors.length-1)/2)*4.2}px`;stage.prepend(dot);});}
          toolbarIcons.set(b,{key,child:b.firstChild});
        }
      }
      const label=b.getAttribute('aria-label')||b.title;b.dataset.tooltip=label;b.removeAttribute('title');
    });
    positionToolbar(n,state.view);
  }
  const canvasClipboardContext = target => !document.querySelector('dialog[open]')&&!document.body.matches('.studio-active,.media-editing,.text-viewer-active,.pile-gallery-active,.video-masking,.video-reshoot-active,.video-creation-active,.video-trimming')&&window.CanvasClipboard.keyboardScope(target,$('#canvas'))==='canvas'&&!target.closest('#agent-panel,#node-editor,.floating-panel,.node-action-panel');
  const hasSelectedText=()=>!!window.getSelection()?.toString().trim();
  document.addEventListener('copy',e=>{if(e.defaultPrevented||!canvasClipboardContext(window.CanvasClipboard.eventTarget(e,document))||hasSelectedText()||!app.getState().selected.length||!e.clipboardData)return;try{copy(false);e.clipboardData.setData('text/plain','__tapnow_internal_copy__');e.preventDefault();}catch(error){app.notify(error.message);}});
  // Let the browser deliver paste: keydown has no files and cannot distinguish a
  // copied graph from an external image. Consuming Cmd-V here used to block both.
  document.addEventListener('paste',e=>{if(e.defaultPrevented||!canvasClipboardContext(window.CanvasClipboard.eventTarget(e,document)))return;
    const files=window.CanvasClipboard.clipboardFiles(e.clipboardData);
    if(files.length){if(window.CanvasCommands){e.preventDefault();safe(()=>window.CanvasCommands.importFiles(files))();}return;}
    if(!copied||e.clipboardData?.getData('text/plain')!=='__tapnow_internal_copy__')return;e.preventDefault();safe(()=>paste())();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')hideTip();
    if(e.defaultPrevented||window.CanvasClipboard.isComposing(e)||!(e.metaKey||e.ctrlKey)||!['c','d'].includes(e.key.toLowerCase())||!canvasClipboardContext(window.CanvasClipboard.eventTarget(e,document))||hasSelectedText()||!app.getState().selected.length)return;
    if(e.key.toLowerCase()==='d'&&(e.repeat||e.altKey||e.shiftKey))return;
    // Capture synchronously so the native copy event cannot race an old graph.
    try{copy();e.preventDefault();if(e.key.toLowerCase()==='d')paste();}catch(error){app.notify(error.message);}
  });
  $('#canvas').addEventListener('pointermove',e=>pointer={x:e.clientX,y:e.clientY});$('#canvas').addEventListener('pointerleave',()=>pointer=null);
  document.addEventListener('canvas:render',toolbar);window.addEventListener('resize',()=>close());
  window.CanvasMenus={show,node,close,copy,paste,applyHistory,keepMain,download,copyImage,positionToolbar,measureToolbar,get hasCopy(){return !!copied;}};toolbar();
})();
