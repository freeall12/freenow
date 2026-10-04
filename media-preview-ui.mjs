import * as core from './media-preview-core.mjs';
import icons from './media-preview-icons.mjs';
import {displayMediaRef,isOriginalMediaRef} from './src/features/local-resource-migration/display-media.mjs';
const unavailableMedia='原站资源已停用，请重新导入本地资源';
async function resolvePreviewMedia(source){
  const safe=displayMediaRef(source);if(!safe)throw Error(unavailableMedia);
  const resolved=safe.startsWith('asset:')?await window.LocalAssets.url(safe):safe;
  const checked=displayMediaRef(resolved);if(!checked)throw Error(unavailableMedia);return checked;
}
function displayPoster(image,source){
  if(!source)return;
  resolvePreviewMedia(source).then(url=>{if(image.isConnected)image.src=url;}).catch(()=>{if(image.isConnected){image.removeAttribute('src');image.title=unavailableMedia;}});
}
const app=window.CanvasApp,el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;},dialog=document.querySelector('#preview-dialog');
const css=el('link');css.rel='stylesheet';css.href=new URL('./media-preview.css',import.meta.url).href;document.head.append(css);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,find=id=>app.getState().nodes.find(n=>n.id===id);
let session=null;
function action(label,icon,fn,cls='media-viewer-button'){const b=el('button',cls);b.type='button';b.setAttribute('aria-label',label);b.dataset.tooltip=label;b.innerHTML=icons[icon];b.onclick=async e=>{e.stopPropagation();try{await fn(e);}catch(error){if(session)session.status.textContent=error.message;}};return b;}
function sourceElement(n){return document.querySelector(`.node[data-id="${CSS.escape(n.id)}"] .node-body`);}
function release(root){root?.querySelectorAll('video').forEach(v=>{v.onloadedmetadata=v.onerror=v.onloadeddata=null;v.pause();v.removeAttribute('src');v.load();});root?.remove();}
function motion(e,frames,duration=440){const a=e.animate(frames,{duration:reduced()?0:duration,easing:'cubic-bezier(.65,0,.35,1)',fill:'both'});return a.finished.catch(()=>{}).then(()=>a.cancel());}
function frameStyle(r){return {left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'};}
function anchorTransform(from,to){return `translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`;}
function selected(s){return s.resources[s.index];}
function mediaNode(s,r=selected(s)){return {...s.node,type:s.type,video:s.type==='video'?r.src:undefined,image:s.type==='image'?r.src:r.poster,fullImage:s.type==='image'?r.src:null,currentSourceFileId:r.currentSourceFileId,provenance:core.resourceProvenance(r)};}
function hideSource(s){const body=sourceElement(s.node);if(s.source&&s.source!==body)s.source.style.visibility=s.visibility;s.source=body;if(body){if(body.style.visibility!=='hidden')s.visibility=body.style.visibility;body.style.visibility='hidden';}}
function cleanup(s){
  if(!s||s.cleaned)return;s.cleaned=true;clearTimeout(s.chromeTimer);clearTimeout(s.zoomTimer);clearTimeout(s.loadingTimer);clearTimeout(s.tipTimer);release(s.layer);release(s.oldLayer);if(s.source)s.source.style.visibility=s.visibility||'';s.observer?.disconnect();document.body.classList.remove('media-preview-open');dialog.replaceChildren();if(session===s)session=null;if(s.returnFocus?.isConnected)s.returnFocus.focus({preventScroll:true});else sourceElement(s.node)?.closest('.node')?.focus({preventScroll:true});
}
async function close(force=false){
  const s=session;if(!s||s.phase==='closing')return;
  if(s.inspect&&!force){returnToPreview(s);return;}
  s.exitTheater?.();s.phase='closing';dialog.dataset.phase='closing';s.video?.pause();const body=sourceElement(s.node),target=body?.getBoundingClientRect(),current=s.frame.getBoundingClientRect();
  if(selected(s).src!==s.mainSrc){const primary=s.resources.find(r=>r.src===s.mainSrc);if(primary?.poster||s.type==='image'){const image=el('img','media-viewer-return-poster');displayPoster(image,primary.poster||primary.src);s.frame.append(image);}}
  await Promise.all([motion(s.backdrop,[{opacity:1},{opacity:0}]),motion(s.chrome,[{opacity:1},{opacity:0}],160),motion(s.actions,[{opacity:1},{opacity:0}],160),motion(s.frame,target?[{transform:'none',borderRadius:'0px'},{transform:anchorTransform(target,current),borderRadius:getComputedStyle(body).borderRadius}]:[{opacity:1},{opacity:0}])]);
  if(session!==s)return;dialog.close();cleanup(s);
}
function place(s){
  if(session!==s)return;const r=selected(s),size={width:r.width||s.node.width||435,height:r.height||s.node.height||250},layout=core.layout(innerWidth,innerHeight,size);s.layout=layout;
  const columnLeft=layout.box.left;Object.assign(s.frame.style,frameStyle(layout.frame));Object.assign(s.column.style,{width:layout.box.width+'px',maxWidth:'none',marginLeft:columnLeft+'px'});
  const relative={left:layout.frame.left-columnLeft,top:layout.frame.top-64};for(const [key,value]of Object.entries({'frame-left':relative.left,'frame-top':relative.top,'frame-width':layout.frame.width,'frame-height':layout.frame.height,'prompt-offset':layout.frame.top+layout.frame.height+32-64-layout.box.height}))s.column.style.setProperty('--media-viewer-'+key,value+'px');
  s.placeholder.style.height=layout.box.height+'px';s.constraints=core.constraints(layout.frame,layout.inspect);s.nav=s.inspect?core.bound(s.nav,s.constraints):{zoom:s.constraints.minZoom,panX:0,panY:0};paintImage(s);
  if(s.history){const list=s.history.querySelector('.media-viewer__history-list');s.history.toggleAttribute('data-media-viewer-history-overflow',list.scrollHeight>list.clientHeight+1);}
}
function facts(s){
  const r=selected(s);s.facts.replaceChildren();const dl=el('dl');const info=[['分辨率',r.width&&r.height?`${r.width} × ${r.height}`:null],['模型',r.model],['日期',r.createdAt&&!isNaN(new Date(r.createdAt))?new Date(r.createdAt).toLocaleDateString():null],['时长',s.type==='video'&&Number.isFinite(r.duration)?core.time(Math.round(r.duration)).replace(/^0/,''):null]];
  for(const [label,value]of info)if(value){const row=el('div');row.append(el('dt','',label),el('dd','',value));dl.append(row);}s.facts.append(dl);s.prompt.hidden=!r.prompt;s.prompt.querySelector('p').textContent=r.prompt||'';
}
function paintActions(s){
  const r=selected(s),current=r.src===s.mainSrc;s.copy.hidden=!r.prompt;s.primary.hidden=s.resources.length<2||!find(s.node.id);s.primary.disabled=current||!!s.applyingPrimary;s.primary.setAttribute('aria-pressed',String(current));s.primary.setAttribute('aria-label',current?(s.type==='video'?'当前主视频':'当前主图'):(s.type==='video'?'设为主视频':'设为主图'));s.primary.dataset.tooltip=s.primary.getAttribute('aria-label');
  s.primary.innerHTML=icons.main+(current?`<span class="media-viewer-primary-check">${icons.check}</span>`:'');const favorite=!!window.CanvasLibrary?.isFavorite(mediaNode(s));s.favorite.classList.toggle('is-favorite',favorite);s.favorite.setAttribute('aria-pressed',String(favorite));s.favorite.setAttribute('aria-label',favorite?'取消收藏':'收藏');s.favorite.dataset.tooltip=favorite?'取消收藏':'收藏';
}
function history(s){
  s.history?.remove();s.history=null;if(s.resources.length<2)return;const aside=el('aside','media-viewer__history');aside.setAttribute('aria-label','历史版本');aside.dataset.blockDismiss='';
  const prev=action('上一个版本','previous',()=>switchResource(s,s.index-1),'media-viewer__history-edge'),next=action('下一个版本','next',()=>switchResource(s,s.index+1),'media-viewer__history-edge'),content=el('div','media-viewer__history-content'),count=el('div','media-viewer__history-count',`${s.index+1} / ${s.resources.length}`),list=el('div','media-viewer__history-list');prev.disabled=s.index===0;next.disabled=s.index===s.resources.length-1;
  s.resources.forEach((r,i)=>{const b=el('button','media-viewer__history-item'+(Math.abs(i-s.index)===1?' is-near':''));b.type='button';b.setAttribute('aria-label',`历史版本 ${i+1}`);b.tabIndex=i===s.index?0:-1;if(i===s.index)b.setAttribute('aria-current','true');const img=el('img');img.alt='';img.draggable=false;displayPoster(img,r.poster||(s.type==='image'?r.src:s.node.image));img.loading=i===s.index?'eager':'lazy';b.append(img);b.onclick=()=>switchResource(s,i);list.append(b);});content.append(count,list);aside.append(prev,content,next);s.column.append(aside);s.history=aside;
}
function switchResource(s,index){
  index=core.clamp(index,0,s.resources.length-1);if(session!==s||s.phase!=='open'||index===s.index)return;const historyFocused=s.history?.contains(document.activeElement);s.index=index;s.video?.pause();s.inspect=false;dialog.classList.remove('is-inspecting','show-inspect-chrome');history(s);facts(s);paintActions(s);loadMedia(s);place(s);if(historyFocused)s.history?.querySelector('[aria-current=true]')?.focus({preventScroll:true});
}
function paintImage(s){if(!s.image||!s.constraints)return;const t=core.transform(s.nav,s.constraints);s.image.style.transform=`translate3d(${t.x}px,${t.y}px,0) scale(${t.scale})`;s.frame.classList.toggle('is-zoomed',s.inspect&&s.nav.zoom>1);s.frame.dataset.zoom=String(s.nav.zoom);}
function inspect(s){if(s.type!=='image'||s.phase!=='open'||s.inspect)return;s.inspect=true;s.chrome.inert=s.actions.inert=s.header.inert=true;s.nav={zoom:1,panX:0,panY:0};dialog.classList.add('is-inspecting');dialog.scrollTop=0;s.image.style.transition='transform .44s cubic-bezier(.65,0,.35,1)';paintImage(s);}
function returnToPreview(s){clearTimeout(s.chromeTimer);clearTimeout(s.zoomTimer);s.inspect=false;s.chrome.inert=s.actions.inert=s.header.inert=false;dialog.classList.remove('is-inspecting','show-inspect-chrome');s.image.style.transition='transform .28s cubic-bezier(.65,0,.35,1)';s.nav={zoom:s.constraints.minZoom,panX:0,panY:0};paintImage(s);}
function showInspectChrome(s){if(!s.inspect)return;dialog.classList.add('show-inspect-chrome');s.header.inert=false;clearTimeout(s.chromeTimer);s.chromeTimer=setTimeout(()=>{dialog.classList.remove('show-inspect-chrome');s.header.inert=true;},3000);}
function imageEvents(s){
  let drag=null,lastDrag=0;s.frame.onpointerdown=e=>{if(!s.inspect||s.nav.zoom<=1||![0,1].includes(e.button))return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...s.nav},moved:false};s.frame.setPointerCapture(e.pointerId);s.frame.classList.add('is-dragging');};
  s.frame.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;s.image.style.transition='none';s.nav=core.bound({...drag.view,panX:drag.view.panX+dx,panY:drag.view.panY+dy},s.constraints);paintImage(s);};
  s.frame.onpointerup=s.frame.onpointercancel=e=>{if(!drag)return;if(drag.moved)lastDrag=performance.now();drag=null;s.frame.classList.remove('is-dragging');if(s.frame.hasPointerCapture(e.pointerId))s.frame.releasePointerCapture(e.pointerId);};
  s.frame.onclick=e=>{e.stopPropagation();if(performance.now()-lastDrag<400)return;if(!s.inspect)inspect(s);else showInspectChrome(s);};
  s.frame.onwheel=e=>{if(!s.inspect&&!e.ctrlKey)return;e.preventDefault();e.stopPropagation();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?s.layout.frame.height:1);if(!s.inspect&&delta>=0)return;if(!s.inspect){s.inspect=true;dialog.classList.add('is-inspecting');}s.image.style.transition='none';const r=s.layout.frame,zoom=core.wheelZoom(s.nav.zoom,delta,e.ctrlKey,s.constraints.minZoom);s.nav=core.zoomAt(s.nav,zoom,{x:e.clientX-r.left-r.width/2,y:e.clientY-r.top+dialog.scrollTop-r.height/2},s.constraints);paintImage(s);clearTimeout(s.zoomTimer);if(zoom===s.constraints.minZoom)s.zoomTimer=setTimeout(()=>returnToPreview(s),180);};
}
function videoControls(s,video,layer){
  const controls=el('div','media-viewer-player-controls'),play=action('播放视频','play',()=>toggle(),'media-viewer-play'),seek=el('input','media-viewer-seek'),clock=el('span','media-viewer-clock'),volumeWrap=el('div','media-viewer-volume'),pop=el('div','media-viewer-volume-pop'),percent=el('output'),volume=el('input'),mute=action('静音','volume',()=>{video.muted=!video.muted;sync();},'media-viewer-mute'),full=action('进入全屏','fullscreen',()=>{if(s.theater){s.exitTheater();return;}s.theater=true;layer.classList.add('is-theater');full.innerHTML=icons.minimize;full.setAttribute('aria-label','退出全屏');full.dataset.tooltip='退出全屏';try{const request=layer.requestFullscreen?.();request?.catch(()=>{});}catch{}},'media-viewer-fullscreen');
  seek.type='range';seek.min=0;seek.max=0;seek.step=.01;seek.setAttribute('aria-label','视频播放进度');volume.type='range';volume.min=0;volume.max=1;volume.step=.01;volume.value=1;volume.setAttribute('aria-label','音量');volume.setAttribute('aria-orientation','vertical');volume.tabIndex=-1;mute.setAttribute('aria-haspopup','dialog');mute.setAttribute('aria-expanded','false');pop.append(percent,volume);volumeWrap.append(pop,mute);controls.append(play,seek,clock,volumeWrap,full);layer.append(controls);
  const bounds=()=>({start:selected(s).clip?.start||0,end:Math.min(selected(s).clip?.end??video.duration,video.duration)||0});
  function toggle(){if(video.paused){const {start,end}=bounds();if(video.currentTime>=end-.02)video.currentTime=start;video.play().catch(e=>s.status.textContent=e.message);}else video.pause();}
  function sync(){if(session!==s||s.video!==video)return;const {start,end}=bounds(),duration=Math.max(0,end-start),time=Math.max(0,video.currentTime-start);play.innerHTML=icons[video.paused?'play':'pause'];play.setAttribute('aria-label',video.paused?'播放视频':'暂停视频');play.dataset.tooltip=play.getAttribute('aria-label');seek.max=duration;seek.value=time;seek.disabled=!duration;seek.style.setProperty('--progress',(duration?time/duration*100:0)+'%');clock.textContent=core.time(time)+' / '+core.time(duration);volume.value=video.muted?0:video.volume;percent.textContent=Math.round(Number(volume.value)*100);mute.innerHTML=icons[video.muted||!video.volume?'muted':'volume'];mute.setAttribute('aria-label',video.muted?'取消静音':'静音');mute.dataset.tooltip=mute.getAttribute('aria-label');}
  seek.oninput=()=>{video.currentTime=bounds().start+Number(seek.value);sync();};volume.oninput=()=>{video.muted=false;video.volume=Number(volume.value);sync();};
  let volumeTimer;const show=()=>{clearTimeout(volumeTimer);volumeWrap.classList.add('is-open');volume.tabIndex=0;mute.setAttribute('aria-expanded','true');},hide=()=>{clearTimeout(volumeTimer);volumeTimer=setTimeout(()=>{volumeWrap.classList.remove('is-open');volume.tabIndex=-1;mute.setAttribute('aria-expanded','false');},120);};volumeWrap.onpointerenter=show;volumeWrap.onpointerleave=hide;volumeWrap.onfocusin=show;volumeWrap.onfocusout=e=>{if(!volumeWrap.contains(e.relatedTarget))hide();};
  mute.onkeydown=e=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();e.stopPropagation();video.volume=core.clamp((video.muted?0:video.volume)+(['ArrowUp','ArrowRight'].includes(e.key)?.05:-.05),0,1);video.muted=false;show();sync();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();show();volume.focus();}};
  video.onclick=toggle;video.ontimeupdate=()=>{const {end}=bounds();if(selected(s).clip&&video.currentTime>=end){video.pause();video.currentTime=bounds().start;}sync();};for(const name of ['play','pause','volumechange','durationchange','loadedmetadata'])video.addEventListener(name,sync);
  s.exitTheater=()=>{s.theater=false;layer.classList.remove('is-theater');full.innerHTML=icons.fullscreen;full.setAttribute('aria-label','进入全屏');full.dataset.tooltip='进入全屏';if(document.fullscreenElement===layer)document.exitFullscreen().catch(()=>{});};let wasNative=false;
  layer.onfullscreenchange=()=>{const fullscreen=document.fullscreenElement===layer;if(fullscreen){wasNative=true;if(session!==s)s.exitTheater();}else if(wasNative){wasNative=false;s.exitTheater();}};sync();
}
async function loadMedia(s){
  const r=selected(s),token=++s.mediaRevision;clearTimeout(s.loadingTimer);s.loading.hidden=true;s.status.textContent='';s.video?.pause();release(s.oldLayer);s.oldLayer=s.layer;if(s.oldLayer){s.oldLayer.classList.add('is-previous');s.oldLayer.inert=true;s.oldLayer.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));}
  const layer=el('div','media-viewer-media');layer.dataset.blockDismiss='';s.frame.append(layer);s.layer=layer;s.video=null;s.image=null;
  const current=()=>session===s&&token===s.mediaRevision&&!s.cleaned;
  const ready=()=>{if(!current())return;s.loading.hidden=true;clearTimeout(s.loadingTimer);layer.classList.add('is-ready');const old=s.oldLayer;s.oldLayer=null;if(old){motion(old,[{opacity:1},{opacity:0}],200).then(()=>release(old));}facts(s);place(s);};
  const fail=message=>{if(!current())return;s.loading.hidden=true;clearTimeout(s.loadingTimer);const error=el('div','media-viewer-error');error.dataset.blockDismiss='';error.append(el('p','',typeof message==='string'?message:'媒体加载失败'));if(message!==unavailableMedia){const retry=el('button','','重试');retry.onclick=e=>{e.stopPropagation();loadMedia(s);};error.append(retry);}layer.append(error);};
  s.loadingTimer=setTimeout(()=>{if(current())s.loading.hidden=false;},180);
  if(s.type==='video'){
    const v=el('video');v.id='preview-video';v.playsInline=true;v.preload='auto';v.controls=false;v.setAttribute('aria-label',s.node.title||'视频');if(displayMediaRef(r.poster))resolvePreviewMedia(r.poster).then(url=>{if(current())v.poster=url;}).catch(()=>{});layer.append(v);s.video=v;videoControls(s,v,layer);
    v.onloadedmetadata=()=>{if(!current())return;r.width=v.videoWidth;r.height=v.videoHeight;r.duration=v.duration;v.currentTime=r.clip?.start||0;facts(s);place(s);};v.onloadeddata=ready;v.onerror=fail;
    try{const url=await resolvePreviewMedia(r.src);if(current())v.src=url;}catch(error){fail(error.message===unavailableMedia?unavailableMedia:undefined);}
  }else{
    const image=el('img');image.id='preview-image';image.alt=s.node.title||'图片';image.draggable=false;layer.append(image);s.image=image;image.onload=()=>{if(!current())return;r.width=image.naturalWidth;r.height=image.naturalHeight;ready();};image.onerror=fail;try{const url=await resolvePreviewMedia(r.src);if(current())image.src=url;}catch(error){fail(error.message===unavailableMedia?unavailableMedia:undefined);}imageEvents(s);
  }
}
function open(node){
  if(session){dialog.close();cleanup(session);}window.VideoHistory?.close();window.ImageHistory?.close();window.ImageVersions?.close();window.NodeEditor?.closePopover();document.querySelectorAll('.inline-video video,.pile-gallery video').forEach(v=>v.pause());
  const n={...node,video:node.video||window.EDITOR_DATA?.nodes[node.id]?.video},type=n.video?'video':'image',config=window.NodeEditor?.getConfig(n)||n.generation||{},resources=core.resources({...n,type},config,window.VERSION_DATA?.[n.id]||[]);if(!resources.length)return;
  const origin=sourceElement(n),anchor=origin?.getBoundingClientRect(),s={node:n,type,resources,index:0,mainSrc:resources[0].src,phase:'opening',mediaRevision:0,returnFocus:document.activeElement,visibility:origin?.style.visibility||'',nav:{zoom:1,panX:0,panY:0}};session=s;
  dialog.replaceChildren();dialog.className='media-viewer';dialog.dataset.phase='opening';dialog.setAttribute('aria-label',node.title||'媒体预览');dialog.tabIndex=-1;
  s.backdrop=el('div','media-viewer-backdrop');s.header=el('header','media-viewer-header');s.header.dataset.blockDismiss='';s.back=action('返回','back',()=>close(),'media-viewer-button close');s.header.append(s.back);
  s.chrome=el('div','media-viewer-chrome');s.column=el('main','media-viewer__media-column');s.placeholder=el('div','media-viewer-placeholder');s.prompt=el('section','media-viewer__prompt');s.prompt.dataset.blockDismiss='';s.prompt.append(el('span','','提示词'),el('p'));s.facts=el('aside','media-viewer__facts');s.facts.dataset.blockDismiss='';s.column.append(s.placeholder,s.prompt,s.facts);s.chrome.append(s.column);
  s.frame=el('div','media-viewer-frame');s.frame.dataset.blockDismiss='';s.frame.dataset.type=type;s.actions=el('div','media-viewer-actions');s.actions.dataset.blockDismiss='';s.status=el('div','media-viewer-status');s.status.setAttribute('role','status');s.status.dataset.blockDismiss='';s.loading=el('div','media-viewer-loading');s.loading.setAttribute('role','status');s.loading.setAttribute('aria-label','加载中');s.loading.hidden=true;s.frame.append(s.loading);
  s.copy=action('复制提示词','copy',async()=>{await navigator.clipboard.writeText(selected(s).prompt||'');s.status.textContent='提示词已复制';});
  s.primary=action(type==='video'?'设为主视频':'设为主图','main',async()=>{
    const n=find(s.node.id);if(!n)throw Error('原节点已不存在');if(s.applyingPrimary)return;
    const r=selected(s),before=JSON.stringify(n);if(isOriginalMediaRef(r.src))throw Error(unavailableMedia);s.applyingPrimary=true;paintActions(s);
    try{
      if(type==='image'){const image=s.image;await image.decode();if(session!==s||selected(s)!==r||s.image!==image)return;r.width=image.naturalWidth;r.height=image.naturalHeight;}
      if(find(n.id)!==n||JSON.stringify(n)!==before)throw Error('原节点已变化，请重新选择主图');
      window.NodeEditor.invalidate();app.updateNode(n.id,core.mainPatch(n,r,window.NodeEditor.getConfig(n)));s.mainSrc=r.src;s.node={...n};s.resources=[r,...s.resources.filter(v=>v!==r)];s.index=0;history(s);place(s);hideSource(s);s.status.textContent=type==='video'?'主视频已更新':'主图已更新';
    }finally{s.applyingPrimary=false;if(session===s)paintActions(s);}
  });
  s.download=action('下载','download',()=>{if(isOriginalMediaRef(selected(s).src))throw Error(unavailableMedia);return window.CanvasMenus.download(mediaNode(s));});s.favorite=action('收藏','star',()=>{Promise.resolve(window.CanvasLibrary.toggleFavorite(mediaNode(s))).then(()=>{if(session===s)paintActions(s);}).catch(()=>{});});s.actions.append(s.copy,s.primary,s.download,s.favorite);s.tip=el('div','media-viewer-tooltip');s.tip.setAttribute('role','tooltip');s.tip.hidden=true;dialog.append(s.backdrop,s.chrome,s.frame,s.header,s.actions,s.status,s.tip);history(s);facts(s);paintActions(s);dialog.showModal();dialog.focus({preventScroll:true});document.body.classList.add('media-preview-open');place(s);hideSource(s);loadMedia(s);
  const target=s.layout.frame;Promise.all([motion(s.frame,anchor?[{transform:anchorTransform(anchor,target),borderRadius:'16px'},{transform:'none',borderRadius:'0px'}]:[{opacity:0},{opacity:1}]),motion(s.backdrop,[{opacity:0},{opacity:1}]),motion(s.chrome,[{opacity:0},{opacity:1}]),motion(s.header,[{opacity:0,transform:'translateX(-28px)'},{opacity:1,transform:'none'}])]).then(()=>{if(session!==s||s.phase!=='opening')return;s.phase='open';dialog.dataset.phase='open';motion(s.actions,[{opacity:0,translate:'0 18px'},{opacity:1,translate:'0 0'}],280);});
  s.observer=new ResizeObserver(()=>place(s));s.observer.observe(dialog);
}
dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{if(!dialog.open)cleanup(session);});
dialog.addEventListener('click',e=>{if(!session||session.phase!=='open'||e.target.closest('[data-block-dismiss]'))return;if(session.inspect)showInspectChrome(session);else close();});
dialog.addEventListener('keydown',e=>{const s=session;if(!s)return;e.stopPropagation();if(e.key==='Escape'){if(s.theater){e.preventDefault();s.exitTheater();return;}if(document.fullscreenElement)return;e.preventDefault();close();return;}if(s.phase==='open'&&!s.inspect&&['ArrowUp','ArrowDown'].includes(e.key)&&!e.target.matches('input,textarea,select')){e.preventDefault();switchResource(s,s.index+(e.key==='ArrowUp'?-1:1));}});
document.addEventListener('canvas:render',()=>{if(session){hideSource(session);paintActions(session);}});window.addEventListener('resize',()=>{if(session)place(session);});
window.MediaPreview={open,close,get active(){return session?{id:session.node.id,phase:session.phase,index:session.index,inspect:!!session.inspect}:null;}};

dialog.addEventListener('pointerover',e=>{const s=session,b=e.target.closest('button[data-tooltip]');if(!s||!b||b===s.back||s.tipTarget===b)return;clearTimeout(s.tipTimer);s.tipTarget=b;s.tipTimer=setTimeout(()=>{if(session!==s||!b.isConnected)return;s.tip.textContent=b.dataset.tooltip;s.tip.hidden=false;const r=b.getBoundingClientRect(),t=s.tip.getBoundingClientRect();s.tip.style.left=core.clamp(r.left+r.width/2-t.width/2,8,innerWidth-t.width-8)+'px';s.tip.style.top=Math.max(8,r.top-t.height-8)+'px';},300);});
dialog.addEventListener('pointerout',e=>{const s=session,b=e.target.closest('button[data-tooltip]');if(!s||!b||b.contains(e.relatedTarget))return;clearTimeout(s.tipTimer);s.tipTarget=null;s.tip.hidden=true;});
