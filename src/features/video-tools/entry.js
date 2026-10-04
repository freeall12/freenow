(() => {
  'use strict';
  const app=window.CanvasApp,ui=window.NodeActions,$=s=>document.querySelector(s);
  const mediaDisplayReady=window.CanvasResourceDisplayReady||import('../local-resource-migration/display-media.mjs');
  mediaDisplayReady.catch(()=>{});
  const unavailableMedia='原站资源已停用，请重新导入本地资源';
  const {el,btn,select,slider,toggle,start,place,close,popup,closePop,colors,footer,notify}=ui;
  const panel=$('.node-action-panel');let media=null,hoveredId=null,hoverTimer=null,lastView=null,movingUntil=0;const players=new Map(),hoverBodies=new WeakSet();let muted=true,toolbarNode=null;
  const source=n=>n.video||window.EDITOR_DATA?.nodes[n.id]?.video;
  function player(n){const video=el('video','video-tool-preview');video.controls=true;video.playsInline=true;video.preload='metadata';video.crossOrigin='anonymous';return video;}
  async function downloadVideo(n){
    try{
      const policy=await mediaDisplayReady,src=policy.displayMediaRef(source(n)||n.image);if(!src)throw Error(unavailableMedia);
      if(n.clip){notify('正在本地导出剪辑…');const result=await window.LocalMedia.trim(n);window.LocalMedia.download(result.blob,n.title+'.mp4');notify('剪辑已导出');return;}
      const url=policy.displayMediaRef(await window.LocalAssets.url(src));if(!url)throw Error(unavailableMedia);
      const a=document.createElement('a');a.href=url;a.download=n.title+(src.startsWith('data:video/webm')?'.webm':'.mp4');a.click();
    }catch(error){notify(error.message);}
  }
  async function extend(n){try{const ui=await import('../video-creation/ui.mjs');ui.openExtend(n);}catch(e){notify(e.message);}}
  let enhancementModule;
  function upscale(n,existing=false){
    if(!existing){app.createConnected(n.id,[{type:'video',title:'视频增强',tool:'video-upscale',params:{resolution:'1080p',frame_rate:'auto',slow_motion:1,provider:'topazlabs'}}],{gap:100,preserveSize:true});return;}
    enhancementModule ||= import('../video-upscale/ui.mjs');enhancementModule.then(m=>m.sync()).catch(e=>notify(e.message));
  }
  const capturing=new Set();
  async function capture(n,mode='current'){
    if(capturing.has(n.id))return;
    const src=source(n),clip=JSON.stringify(n.clip||null),preview=players.get(n.id)?.video;
    try{const policy=await mediaDisplayReady;if(!policy.displayMediaRef(src))throw Error(unavailableMedia);}catch(error){app.notify(error.message);return;}
    if(!preview||preview.readyState<2){app.notify('视频尚未准备好');return;}
    preview.pause();const currentTime=preview.currentTime;let reader;
    capturing.add(n.id);document.querySelector('#node-toolbar [data-video-action="保存当前帧"]')?.setAttribute('disabled','');app.notify('正在截取画面...');
    try{
      const [{openVideoFrames},{captureTime}]=await Promise.all([import('../video-media/frames.mjs'),import('../video-capture/core.mjs')]);
      const requested=captureTime({mode,currentTime,duration:preview.duration,clip:n.clip});
      reader=await openVideoFrames(await window.LocalAssets.url(src));
      const frame=await reader.at(requested,reader.width);
      const current=app.getState().nodes.find(node=>node.id===n.id);
      if(!current||source(current)!==src||JSON.stringify(current.clip||null)!==clip)throw Error('来源视频已变化，请重新截帧');
      app.createConnected(n.id,[{type:'image',title:'视频截帧',image:frame.toDataURL('image/png'),pixelWidth:frame.width,pixelHeight:frame.height,captureMode:mode,captureTime:requested,captureSource:src}],{gap:100,preserveSize:true});
      app.notify('截帧成功');
    }catch(error){app.notify(error.message);}finally{reader?.dispose();capturing.delete(n.id);const b=document.querySelector('#node-toolbar [data-video-action="保存当前帧"]');if(b)b.disabled=capturing.has(app.getState().selected[0]);}
  }
  function captureMenu(n,anchor){
    if(document.querySelector('.video-capture-menu')){closePop();return;}
    const menu=popup(anchor,'video-capture-menu');menu.dataset.nodeId=n.id;menu.dataset.videoTrigger='保存当前帧';menu.setAttribute('role','menu');menu.setAttribute('aria-orientation','vertical');menu.tabIndex=-1;menu.setAttribute('aria-label','视频截帧');anchor.setAttribute('aria-expanded','true');
    for(const [label,mode]of [['截取当前帧','current'],['截取首帧','first'],['截取尾帧','last']]){const b=el('button','',label);b.type='button';b.setAttribute('role','menuitem');b.dataset.captureMode=mode;b.onpointerenter=e=>{if(e.pointerType==='mouse')b.focus({preventScroll:true});};b.onclick=()=>{closePop();capture(n,mode);};menu.append(b);}
    const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.left))+'px';menu.style.top=Math.max(8,r.bottom+8+menu.offsetHeight>innerHeight?r.top-menu.offsetHeight-8:r.bottom+8)+'px';
    menu.onkeydown=e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();e.stopPropagation();closePop();document.querySelector('#node-toolbar [data-video-action="保存当前帧"]')?.focus({preventScroll:true});return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const items=[...menu.children].filter(item=>!item.disabled),i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:i<0?(e.key==='ArrowDown'?0:items.length-1):(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus({preventScroll:true});};menu.focus({preventScroll:true});
  }

  async function trim(n){try{const editor=await import('../video-trim/ui.mjs');editor.open(n);}catch(error){notify(error.message);}}
  function edit(n,kind='edit'){
    if(['replace','erase'].includes(kind)){import('../video-mask/ui.mjs').then(m=>m.open(n,kind)).catch(e=>notify(e.message));return;}
    if(kind==='edit'){import('../video-reshoot/ui.mjs').then(m=>m.open(n)).catch(e=>notify(e.message));return;}
    if(kind==='compliance'){import('../../../media-review-ui.mjs').then(m=>m.submit(n.id)).catch(e=>notify(e.message));return;}
    if(kind==='analyze')import('../video-analysis/ui.mjs').then(m=>m.analyze(n.id)).catch(e=>app.notify(e.message));
  }

  function more(n,anchor){
    if(document.querySelector('.video-more-menu')){closePop();return;}
    const menu=popup(anchor,'video-more-menu');menu.dataset.nodeId=n.id;menu.setAttribute('role','menu');menu.setAttribute('aria-orientation','vertical');menu.tabIndex=-1;menu.setAttribute('aria-label','视频更多操作');anchor.setAttribute('aria-expanded','true');
    for(const [name,kind,icon]of [['解析','analyze','videoAnalyze'],['Seedance 2.0 合规验证','compliance','compliance']]){const b=btn(name,()=>{closePop();edit(n,kind);});b.insertAdjacentHTML('afterbegin',window.CANVAS_MENU_ICONS[icon]);b.setAttribute('role','menuitem');b.onpointerenter=e=>{if(e.pointerType==='mouse'&&!b.disabled)b.focus({preventScroll:true});};menu.append(b);if(kind==='compliance')import('../../../media-review-ui.mjs').then(m=>m.bindMenu(b,n.id));}
    const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+8))+'px';
    menu.onkeydown=e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();e.stopPropagation();closePop();$('#node-toolbar [data-video-action="更多操作"]')?.focus({preventScroll:true});return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const items=[...menu.children].filter(item=>!item.disabled),i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:i<0?(e.key==='ArrowDown'?0:items.length-1):(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus({preventScroll:true});};menu.focus({preventScroll:true});
  }
  function inlinePlayer(n){
    if(!n)return;
    const previous=players.get(n.id);
    if(previous&&previous.src===source(n)&&previous.clip===JSON.stringify(n.clip||null)&&previous.wrap.isConnected){previous.sync();return previous;}
    if(previous)disposePlayer(previous);
    if(!source(n))return;
    const wrap=el('div','inline-video'),video=player(n),icons=window.CANVAS_MENU_ICONS;
    video.className='node-video';video.controls=false;video.muted=muted;wrap.append(video);
    const control=(label,icon,action)=>{const b=btn('',action);b.type='button';b.setAttribute('aria-label',label);b.dataset.tooltip=label;b.innerHTML=icons[icon];return b;};
    const top=el('div','video-player-top'),bottom=el('div','video-player-bottom');
    const mute=control('取消静音','playerMuted',()=>{muted=!video.muted;for(const p of players.values()){p.video.muted=muted;p.sync();}});
    const star=control('收藏','playerStar',()=>{window.CanvasLibrary?.toggleFavorite(n);sync();});top.append(mute,star);
    const togglePlay=()=>{if(document.body.classList.contains('video-trimming'))return;if(video.paused){const {start,end}=bounds();if(video.currentTime>=end-.02||video.currentTime<start)video.currentTime=start;video.play().catch(e=>notify(e.message));}else video.pause();};
    const play=control('播放视频','playerPlay',togglePlay),time=el('output','video-player-time'),duration=el('output','video-player-duration'),seek=el('input','video-player-seek'),full=control('全屏查看','playerFullscreen',()=>{video.pause();app.preview(app.getState().nodes.find(v=>v.id===n.id)||n);});
    seek.type='range';seek.min='0';seek.max='0';seek.step='.1';seek.value='0';seek.setAttribute('aria-label','视频播放进度');
    seek.oninput=()=>{const {start,end}=bounds();video.currentTime=Math.max(start,Math.min(end,start+Number(seek.value)));sync();};
    bottom.append(play,time,seek,duration,full);wrap.append(top,bottom);
    const bounds=()=>({start:n.clip?.start||0,end:Math.min(n.clip?.end??video.duration,video.duration)||0});
    function sync(){
      const {start,end}=bounds(),length=Math.max(0,end-start),current=Math.max(0,Math.min(length,video.currentTime-start));
      play.innerHTML=icons[video.paused?'playerPlay':'playerPause'];play.setAttribute('aria-label',video.paused?'播放视频':'暂停视频');play.dataset.tooltip=video.paused?'播放视频':'暂停视频';
      mute.innerHTML=icons[video.muted?'playerMuted':'playerVolume'];mute.setAttribute('aria-label',video.muted?'取消静音':'静音');mute.dataset.tooltip=video.muted?'取消静音':'静音';mute.setAttribute('aria-pressed',String(!video.muted));
      const favorite=!!window.CanvasLibrary?.isFavorite(n.id);star.innerHTML=icons[favorite?'playerStarFilled':'playerStar'];star.setAttribute('aria-label',favorite?'取消收藏':'收藏');star.dataset.tooltip=favorite?'取消收藏':'收藏';star.setAttribute('aria-pressed',String(favorite));
      time.textContent=current.toFixed(1)+'s';duration.textContent=length.toFixed(1)+'s';seek.max=String(length);seek.value=String(current);seek.disabled=!length;seek.setAttribute('aria-valuetext',current.toFixed(1)+'秒 / '+length.toFixed(1)+'秒');seek.style.setProperty('--video-progress',(length?current/length*100:0)+'%');
    }
    wrap.onpointerdown=e=>{if(e.target!==video)e.stopPropagation();};wrap.onclick=e=>{if(e.target!==video){e.stopPropagation();return;}if(app.getState().selected.includes(n.id))togglePlay();};wrap.ondblclick=e=>{e.stopPropagation();if(e.target===video){video.pause();app.preview(n);}};
    wrap.onkeydown=e=>{e.stopPropagation();if(e.target===seek)return;if(e.key===' '&&e.target===video){e.preventDefault();togglePlay();}};
    video.tabIndex=0;video.setAttribute('aria-label','视频画面');video.onloadedmetadata=()=>{video.currentTime=n.clip?.start||0;sync();};video.onloadeddata=()=>{video.classList.add('ready');if(hoveredId===n.id&&!editing())video.play().catch(()=>{});};
    video.ontimeupdate=()=>{if(n.clip&&!document.body.classList.contains('video-trimming')&&video.currentTime>=n.clip.end){video.currentTime=n.clip.start;}sync();};
    for(const event of ['play','pause','ended','volumechange','durationchange'])video.addEventListener(event,sync);
    const showError=(message='视频预览加载失败',retry=true)=>{video.classList.remove('ready');if(wrap.querySelector('.video-player-error'))return;const error=el('div','video-player-error');error.append(el('p','',message));if(retry)error.append(btn('重试',()=>{error.remove();video.load();}));wrap.append(error);};
    video.onerror=()=>showError();
    const src=source(n);
    $(`.node[data-id="${n.id}"] .node-body`).append(wrap);const entry={id:n.id,src,clip:JSON.stringify(n.clip||null),video,wrap,sync};players.set(n.id,entry);sync();
    const current=()=>players.get(n.id)===entry&&wrap.isConnected&&source(app.getState().nodes.find(item=>item.id===n.id)||{})===src;
    mediaDisplayReady.then(async policy=>{
      if(!current())return;
      const safe=policy.displayMediaRef(src);if(!safe){showError(unavailableMedia,false);return;}
      const poster=policy.displayMediaRef(n.image);
      if(poster){window.LocalAssets.url(poster).then(url=>{if(current()){const checked=policy.displayMediaRef(url);if(checked)video.poster=checked;}}).catch(()=>{});}
      const url=policy.displayMediaRef(await window.LocalAssets.url(safe));if(!url)throw Error(unavailableMedia);
      if(current()){video.src=url;video.load();}
    }).catch(error=>{if(current())showError(error.message,false);});
    return entry;
  }
  function editing(){return !!document.querySelector('body.video-trimming,body.video-masking,body.video-reshoot-active,body.video-creation-active,body.pile-gallery-active,body.video-history-open,dialog[open]');}
  function disposePlayer(p){p.video.pause();p.video.onerror=null;p.video.onloadeddata=null;p.video.removeAttribute('src');p.video.load();p.wrap.remove();players.delete(p.id);if(media===p)media=null;}
  function enterVideo(id){
    hoveredId=id;clearTimeout(hoverTimer);if(editing())return;
    const begin=()=>{if(hoveredId!==id||editing()||document.hidden)return;const delay=movingUntil-performance.now();if(delay>0){hoverTimer=setTimeout(begin,delay+160);return;}const n=app.getState().nodes.find(n=>n.id===id);if(!n||!source(n))return;const entry=inlinePlayer(n);if(entry?.video.readyState>=2)entry.video.play().catch(()=>{});};
    if(players.has(id))begin();else hoverTimer=setTimeout(begin,160);
  }
  function leaveVideo(id){if(hoveredId===id){hoveredId=null;clearTimeout(hoverTimer);}const p=players.get(id);if(!p)return;if(!editing()){p.video.pause();p.sync();}if(!app.getState().selected.includes(id))disposePlayer(p);}
  function trackViewport(view){
    if(lastView&&(lastView.x!==view.x||lastView.y!==view.y||lastView.scale!==view.scale)){movingUntil=performance.now()+100;clearTimeout(hoverTimer);if(hoveredId)enterVideo(hoveredId);}lastView={...view};
  }
  function reconcilePlayers(state){
    trackViewport(state.view);
    for(const p of [...players.values()]){const n=state.nodes.find(n=>n.id===p.id);if(!p.wrap.isConnected||!n||source(n)!==p.src||(!state.selected.includes(p.id)&&hoveredId!==p.id))disposePlayer(p);}
    for(const n of state.nodes){if(n.type!=='video'||!source(n))continue;const body=$(`.node[data-id="${n.id}"] .node-body`);if(!body||hoverBodies.has(body))continue;hoverBodies.add(body);body.onpointerenter=()=>enterVideo(n.id);body.onpointerleave=()=>leaveVideo(n.id);}
    media=state.selected.length===1?players.get(state.selected[0])||null:null;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(hoverTimer);for(const p of [...players.values()]){p.video.pause();if(!app.getState().selected.includes(p.id))disposePlayer(p);}}});
  function toolIcon(label){const map={'剪辑':'videoTrim','视频增强':'videoUpscale','主体替换':'videoReplace','物体移除':'videoErase','延长视频':'videoExtend','视频编辑':'videoEdit','保存当前帧':'videoCapture','更多操作':'videoMore','Pin':'videoPin','保存到素材库':'videoFolder','下载视频':'videoDownload','预览':'videoExpand'};return window.CANVAS_MENU_ICONS[map[label]];}
  let lastTool=null;
  function positionToolbar(){const bar=$('#node-toolbar');if(bar.hidden||!bar.firstElementChild?.dataset.videoAction)return;const r=bar.getBoundingClientRect();if(r.right>innerWidth)bar.style.left=Math.max(10,innerWidth-r.width-10)+'px';}
  function render(event){const state=app.getState();if(event?.detail?.viewportOnly){trackViewport(state.view);if(lastTool)$('#node-toolbar').hidden=true;return;}reconcilePlayers(state);const n=state.selected.length===1?state.nodes.find(n=>n.id===state.selected[0]):null;if(n?.type!=='video'){media=null;lastTool=null;toolbarNode=null;return;}if(n.tool==='video-upscale'){const body=$(`.node[data-id="${n.id}"] .placeholder`);if(body)body.textContent='配置参数生成高清视频';if(lastTool!==n.id){lastTool=n.id;upscale(n,true);}if(source(n))media=inlinePlayer(n);else if(media)disposePlayer(media);$('#node-toolbar').hidden=true;return;}lastTool=null;media=inlinePlayer(n);const bar=$('#node-toolbar');bar.dataset.videoFor=n.id;if(toolbarNode===n&&bar.firstElementChild?.dataset.videoAction==='剪辑'){positionToolbar();return;}toolbarNode=n;bar.replaceChildren();const items=[['剪辑','✂',()=>trim(n)],['视频增强','▣',()=>upscale(n)],['主体替换','⇄',()=>edit(n,'replace')],['物体移除','▱',()=>edit(n,'erase')],['延长视频','◷',()=>extend(n)],['视频编辑','✎',()=>edit(n)],['保存当前帧','▧',b=>captureMenu(n,b)],['更多操作','⋯',b=>more(n,b)],['Pin','⚑',b=>colors(n,b)],['保存到素材库','⊞',()=>app.saveSelection()],['下载视频','↓',()=>downloadVideo(n)],['预览','⛶',()=>app.preview(n)]];for(const [label,icon,fn]of items){const b=btn('',()=>fn(b),'icon-btn');b.innerHTML=toolIcon(label);b.dataset.videoAction=label;b.setAttribute('aria-label',label);b.dataset.tooltip=label;if(['延长视频','视频编辑'].includes(label))b.append(el('i','video-new-dot'));if(label==='保存当前帧')b.disabled=capturing.has(n.id);if(['更多操作','保存当前帧'].includes(label)){b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');}bar.append(b);}positionToolbar();}
  document.addEventListener('canvas:video-history-open',()=>{clearTimeout(hoverTimer);for(const p of players.values()){p.video.pause();p.sync();}});
  import('../../../media-preview-ui.mjs').catch(e=>notify(e.message));
  import('../video-history/ui.mjs').catch(e=>notify(e.message));
  document.addEventListener('canvas:render',render);render();
})();
