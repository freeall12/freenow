import * as core from './core.mjs';
import icons from './icons.mjs';
import {displayMediaRef,pendingImportMessage} from '../local-resource-migration/display-media.mjs';
const app=window.CanvasApp,el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
const css=el('link');css.rel='stylesheet';css.href=new URL('./styles.css',import.meta.url).href;document.head.append(css);
const node=id=>app.getState().nodes.find(n=>n.id===id),element=id=>app.getNodeElement?app.getNodeElement(id):document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
let active=null;const decorations=new WeakMap();
function historyCount(n){let total=0;for(const batch of n.videoHistory||[])for(const item of batch.options||[])if(typeof item==='string'?item:item?.video||item?.url)total++;return total||((n.versions||[]).filter(item=>item?.video).length);}
function decoration(owner){let ui=decorations.get(owner);if(!ui){ui={indicator:owner.querySelector('.video-history-count'),stacks:[...owner.querySelectorAll(':scope > .video-history-stack')]};decorations.set(owner,ui);}if(ui.indicator?.parentNode!==owner)ui.indicator=null;ui.stacks=ui.stacks.filter(item=>item.parentNode===owner);return ui;}

const safe=fn=>async e=>{e?.stopPropagation();try{await fn();}catch(error){app.notify(error.message);}};
function button(label,icon,action){const b=el('button');b.type='button';b.setAttribute('aria-label',label);b.dataset.tooltip=label;if(icon)b.innerHTML=icons[icon];else b.textContent=label;b.onclick=safe(action);return b;}
function release(root){root?.querySelectorAll('video').forEach(v=>{v.onerror=null;v.onloadedmetadata=null;v.ontimeupdate=null;v.pause();v.removeAttribute('src');v.removeAttribute('poster');v.load();});root?.remove();}
function variant(n,b,item){return {...core.primaryPatch(n,b,item,window.NodeEditor.getConfig(n)),id:n.id,title:n.title,type:'video'};}
function closingMotion(s){
  if(!s.owner.isConnected||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const positions=[...s.root.querySelectorAll('.video-history-card')].slice(0,3).map(c=>({x:parseFloat(c.style.left),y:parseFloat(c.style.top)}));
  const exit=el('div','video-history-exit');s.owner.append(exit);
  const animations=positions.map((p,i)=>{const c=el('div','video-history-stack');c.style.zIndex=String(-i-1);exit.append(c);const frames=Array.from({length:43},(_,j)=>{const t=j/60,z=Math.exp(-9*t)*(Math.cos(Math.sqrt(199)*t)+9/Math.sqrt(199)*Math.sin(Math.sqrt(199)*t)),k=1-z;return {transform:`translate(${p.x*z+12*(i+1)*k}px,${p.y*z+4*(i+1)*k}px) rotate(${5*(i+1)*k}deg) scale(${1-(i+1)*.035*k})`,opacity:Math.max(0,1-j/42)};});return c.animate(frames,{duration:720,easing:'linear'}).finished.catch(()=>{});});
  Promise.all(animations).then(()=>exit.remove());
}
function close(focus=false){
  if(!active)return;const s=active;active=null;closingMotion(s);release(s.root);s.owner.classList.remove('video-history-owner');s.owner.querySelector('.node-body').inert=false;s.owner.style.width=s.node.width+'px';s.owner.style.height=s.node.height+'px';document.body.classList.remove('video-history-open');
  app.render();if(focus)element(s.id)?.querySelector('.video-history-count')?.focus({preventScroll:true});
}
function geometry(s){
  const dimensions=item=>core.dimensions(s.node,item.width>0&&item.height>0?item:s.previewDimensions?.get(item)||item);
  const size=dimensions(s.batch.options[0]),layout=core.grid(size,s.batch.options.length);s.size=size;
  s.owner.style.width=size.width+'px';s.owner.style.height=size.height+'px';s.owner.style.zIndex='1008';
  s.root.style.width=size.width+'px';s.root.style.height=size.height+'px';
  s.root.querySelectorAll('.video-history-card').forEach((c,i)=>{const itemSize=dimensions(s.batch.options[i]),cell=layout.cells[i];c.style.left=cell.x+'px';c.style.top=cell.y+'px';c.style.width=itemSize.width+'px';c.style.height=itemSize.height+'px';});
  const scrim=s.root.querySelector('.video-history-scrim');Object.assign(scrim.style,{left:'-64px',top:layout.top-32+'px',width:layout.width+128+'px',height:size.height-layout.top+80+'px'});
  s.root.querySelector('.video-history-batches').style.top=layout.bottom+16+'px';return layout;
}
function spring(card,index,target){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const frames=Array.from({length:43},(_,i)=>{const t=i/60,z=Math.exp(-9*t)*(Math.cos(Math.sqrt(199)*t)+9/Math.sqrt(199)*Math.sin(Math.sqrt(199)*t));return {transform:`translate(${(12*(index+1)-target.x)*z}px,${(4*(index+1)-target.y)*z}px) rotate(${5*Math.min(index+1,4)*z}deg) scale(${1-Math.min(index+1,4)*.035*z})`,opacity:1-.6*z};});
  frames.push({transform:'none',opacity:1});card.animate(frames,{duration:720,delay:index*30,easing:'linear'});
}
async function setMain(s,item){
  if(active!==s)return;const n=node(s.id);if(!n)return close();const patch=core.primaryPatch(n,s.batch,item,window.NodeEditor.getConfig(n));
  close();window.NodeEditor.invalidate?.();app.updateNode(n.id,patch);
}
function copy(s,item){
  const n=node(s.id);if(!n)return;const patch=variant(n,s.batch,item),position=core.copyPosition(n,core.dimensions(n,item),app.getState().nodes),view=app.getState().view;
  close();delete patch.id;delete patch.title;app.addNode('video',{x:position.x*view.scale+view.x,y:position.y*view.scale+view.y},patch.image,n.title,{...patch,...position,videoHistory:[],versions:[]});
}
function card(s,item,index){
  const c=el('div','video-history-card');c.dataset.optionId=item.id;c.tabIndex=0;c.setAttribute('role','group');c.setAttribute('aria-label',`视频版本 ${index+1}`);
  const video=el('video');video.muted=true;video.autoplay=true;video.loop=true;video.playsInline=true;video.preload='metadata';
  const batch=s.batch,current=()=>active===s&&s.batch===batch&&video.isConnected;
  let triedOriginal=false,loadRevision=0,loadedRef;
  const resolve=async ref=>{const safe=displayMediaRef(ref);if(!safe)throw Error(pendingImportMessage);const resolved=displayMediaRef(await window.LocalAssets.url(safe));if(!resolved)throw Error(pendingImportMessage);return resolved;};
  function showError(error){if(!current()||c.querySelector('.video-history-error'))return;const overlay=el('div','video-history-error');overlay.onclick=e=>e.stopPropagation();overlay.append(el('p','',error?.message||'视频加载失败'),button('重试',null,()=>{overlay.remove();triedOriginal=false;return load();}));c.append(overlay);}
  async function load(ref=item.preview||item.video){const revision=++loadRevision;try{const resolved=await resolve(ref);if(current()&&revision===loadRevision){loadedRef=ref;video.src=resolved;video.load();}}catch(error){if(current()&&revision===loadRevision)failed(error);}}
  function failed(error){if(!current())return;if(item.preview&&!triedOriginal){triedOriginal=true;void load(item.video);return;}showError(error);}
  video.onerror=()=>failed();
  video.onloadedmetadata=()=>{if(!current()||!loadedRef)return;if(video.videoWidth>0&&video.videoHeight>0){if(loadedRef===item.video){item.width=video.videoWidth;item.height=video.videoHeight;}else{(s.previewDimensions ||= new WeakMap()).set(item,{width:video.videoWidth,height:video.videoHeight});}}if(loadedRef===item.video&&Number.isFinite(video.duration))item.duration=video.duration;geometry(s);if(item.clip)video.currentTime=item.clip.start;};
  video.ontimeupdate=()=>{if(item.clip&&video.currentTime>=item.clip.end)video.currentTime=item.clip.start;};
  c.append(video);void load();if(item.poster)resolve(item.poster).then(url=>{if(current())video.poster=url;}).catch(()=>{});
  const actions=el('div','video-history-actions'),favorite=button('收藏','star',()=>{Promise.resolve(window.CanvasLibrary.toggleFavorite(variant(node(s.id),s.batch,item))).then(paintFavorite).catch(()=>{});});
  function paintFavorite(){const value=window.CanvasLibrary.isFavorite(variant(node(s.id),s.batch,item));favorite.classList.toggle('is-favorite',value);favorite.setAttribute('aria-pressed',String(value));favorite.setAttribute('aria-label',value?'取消收藏':'收藏');favorite.dataset.tooltip=value?'取消收藏':'收藏';}
  paintFavorite();actions.append(favorite,button('复制到画布','copy',()=>copy(s,item)),button('下载视频','download',()=>window.CanvasMenus.download(variant(node(s.id),s.batch,item))));
  const main=button('设为主图',null,()=>setMain(s,item));main.className='video-history-main';c.append(actions,main);c.onclick=safe(()=>setMain(s,item));c.onkeydown=e=>{if(e.target===c&&['Enter',' '].includes(e.key)){e.preventDefault();safe(()=>setMain(s,item))(e);}};return c;
}
function draw(s,animate=false){
  release(s.root);const root=el('div','video-history-gallery');root.setAttribute('aria-label','视频历史版本');root.tabIndex=-1;root.onpointerdown=root.ondblclick=e=>e.stopPropagation();s.root=root;
  root.append(el('div','video-history-scrim'));const b=s.history[s.index];s.batch=b;const cards=b.options.map((o,i)=>card(s,o,i));root.append(...cards);
  const pages=el('div','video-history-batches');pages.setAttribute('role','tablist');pages.setAttribute('aria-label','历史批次');
  s.history.forEach((batch,i)=>{const p=button(`历史批次 ${i+1}`,null,()=>switchBatch(s,i));p.textContent='';p.setAttribute('role','tab');p.setAttribute('aria-selected',String(i===s.index));p.tabIndex=i===s.index?0:-1;p.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const next=e.key==='Home'?0:e.key==='End'?s.history.length-1:(i+(e.key==='ArrowRight'?1:-1)+s.history.length)%s.history.length;switchBatch(s,next);s.root.querySelectorAll('[role=tab]')[next].focus({preventScroll:true});};pages.append(p);});root.append(pages);s.owner.append(root);const layout=geometry(s);if(animate)cards.forEach((c,i)=>spring(c,i,layout.cells[i]));
}
function switchBatch(s,i){if(active!==s||i===s.index)return;s.index=i;draw(s,true);}
function open(id){
  if(active?.id===id){close(true);return;}close();const n=node(id),history=core.batches(n);if(!history.length)return;
  app.select(id);window.NodeEditor.closePopover();window.NodeActions.closePop();const owner=element(id);
  active={id,node:n,history,index:core.selectedBatch(n,history),owner,signature:JSON.stringify([n.videoHistory,n.versions,n.video,n.generation,n.params,n.clip])};owner.querySelector('.video-history-exit')?.remove();owner.classList.add('video-history-owner');owner.querySelector('.node-body').inert=true;document.body.classList.add('video-history-open');document.dispatchEvent(new Event('canvas:video-history-open'));draw(active,true);render();active?.root.focus({preventScroll:true});
}
function render(event){
  // Gallery and stacks live inside the transformed world; their geometry is view-independent.
  if(event?.detail?.viewportOnly)return;
  const state=app.getState();if(active){const n=node(active.id);if(!n||state.selected.length!==1||state.selected[0]!==active.id||element(active.id)!==active.owner||JSON.stringify([n.videoHistory,n.versions,n.video,n.generation,n.params,n.clip])!==active.signature){close();return;}geometry(active);}
  for(const n of state.nodes){if(n.type!=='video')continue;const owner=element(n.id);if(!owner)continue;const total=historyCount(n),ui=decoration(owner),expanded=active?.id===n.id;let indicator=ui.indicator;
    if(total<2){indicator?.remove();ui.indicator=null;ui.state=null;for(const stack of ui.stacks)stack.remove();ui.stacks=[];continue;}
    if(!indicator){indicator=button('历史版本','chevron',()=>open(n.id));indicator.className='video-history-count';indicator.prepend(el('span'));indicator.onpointerdown=indicator.ondblclick=e=>e.stopPropagation();owner.append(indicator);ui.indicator=indicator;ui.state=null;}
    const controlState=`${total}:${expanded}`;if(ui.state!==controlState){ui.state=controlState;indicator.firstChild.textContent=total>=50?'50+':total;indicator.setAttribute('aria-label',`历史版本 ${total}`);indicator.setAttribute('aria-expanded',String(expanded));}
    const depth=expanded?0:Math.min(total-1,3);
    if(ui.stacks.length!==depth){for(const stack of ui.stacks)stack.remove();ui.stacks=[];for(let i=depth;i>0;i--){const stack=el('div','video-history-stack');stack.style.cssText=`transform:translate(${i*12}px,${i*4}px) scale(${1-i*.035}) rotate(${i*5}deg);z-index:${-i}`;owner.prepend(stack);ui.stacks.push(stack);}}
  }
}
document.addEventListener('canvas:render',render);
function upperLayer(target){
  if(document.querySelector('dialog[open],.ie-modal-shade'))return true;
  if(target?.closest?.('#agent-panel,.floating-panel,[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]'))return true;
  // Match the drawer/pile guards: hidden, inert and exiting menus do not own input.
  return [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]')].some(layer=>!active.root.contains(layer)&&!layer.hidden&&!layer.closest('[hidden],[inert],[aria-hidden="true"]')&&(!layer.getClientRects||layer.getClientRects().length));
}
document.addEventListener('pointerdown',e=>{if(!active||e.defaultPrevented)return;const target=e.composedPath?.()[0]||e.target;if(upperLayer(target)||target?.closest?.('.video-history-gallery,.video-history-count'))return;close();},{capture:true});
document.addEventListener('keydown',e=>{if(!active||e.key!=='Escape'||e.defaultPrevented||e.isComposing||e.keyCode===229)return;const target=e.composedPath?.()[0]||e.target;if(upperLayer(target)||target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(target!==document.body&&!target?.closest?.('.video-history-gallery,.video-history-count,#canvas'))return;e.preventDefault();e.stopImmediatePropagation();close(true);},{capture:true});
document.addEventListener('visibilitychange',()=>{if(!active)return;active.root.querySelectorAll('video').forEach(v=>document.hidden?v.pause():v.play().catch(()=>{}));});
window.VideoHistory={open,close,variants:core.flattened,keepPrimary:core.keepPrimary,get activeId(){return active?.id;}};render();
