import {ReviewService, media, pending, httpAdapter} from './media-review-core.mjs';
import icons from './media-review-icons.mjs';
const app=window.CanvasApp;
const style=document.createElement('link'); style.rel='stylesheet'; style.href='media-review.css'; document.head.append(style);
const storageKey='tapnow-media-reviews-v1';
const texts={approved:'角色已合规，可用于 Seedance 2.0 视频生成',rejected:'检测到真人照片或受版权保护的 IP 形象',pending:'已提交角色合规验证，请稍候',processing:'已提交角色合规验证，请稍候',checking:'正在检查验证资格',configuration_required:'待连接合规验证 API，尚未提交审核'};
const invalid={image:'图片规格受限，请确认满足以下要求：\n格式　jpeg / png / webp / bmp / tiff / gif\n尺寸　300 ~ 6000 px（宽高）\n比例　0.4 ~ 2.5（宽 ÷ 高）\n大小　≤ 30 MB',video:'视频规格受限，请确认满足以下要求：\n格式　mp4 / mov\n分辨率　480p ~ 720p\n时长　2 ~ 15 秒\n比例　0.4 ~ 2.5（宽 ÷ 高）\n大小　≤ 50 MB',audio:'音频规格受限，请确认满足以下要求：\n格式　wav / mp3\n时长　2 ~ 15 秒\n大小　≤ 15 MB'};
const service=new ReviewService({adapter:httpAdapter(),read:()=>JSON.parse(localStorage.getItem(storageKey)||'[]'),write:rows=>localStorage.setItem(storageKey,JSON.stringify(rows)),change:()=>render()});
const current=id=>app.getState().nodes.find(n=>n.id===(typeof id==='string'?id:id?.id));
const input=id=>{const n=current(id);return n?media(n,window.EDITOR_DATA?.nodes[n.id]):null;};
let tooltip;
const nodeBadges=new Map(),domRecords=new WeakMap();
const menuButtons=new Set(),ownedBadges=new WeakSet();
function invalidateBadges(records){
  for(const mutation of records){
    if(mutation.type==='childList'&&[...mutation.addedNodes,...mutation.removedNodes].every(node=>ownedBadges.has(node)))continue;
    for(let element=mutation.target;element;element=element.parentNode){const record=domRecords.get(element);if(record){record.dirty=true;break;}}
  }
}
// The canvas preserves most node DOM during drags. Track structural/title edits
// separately so a stable unknown review does not rescan three selectors per frame.
const badgeObserver=new MutationObserver(invalidateBadges);
badgeObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
function badgeRecord(node){
  let record=nodeBadges.get(node.id);
  const element=app.getNodeElement?app.getNodeElement(node.id):record?.element?.isConnected?record.element:document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`);
  if(!element){nodeBadges.delete(node.id);return null;}
  if(record?.element!==element){record={element,dirty:true};nodeBadges.set(node.id,record);domRecords.set(element,record);}
  if(record.dirty||record.title&&!element.contains(record.title)){
    record.title=element.querySelector('.node-title');record.badge=record.title?.querySelector('.media-review-badge');record.legacy=record.title?.querySelector('.restricted');record.hasReview=false;record.dirty=false;
  }
  return record;
}
function hideTooltip(){tooltip?.remove();tooltip=null;}
function showTooltip(anchor,text){hideTooltip();tooltip=document.createElement('div');tooltip.className='media-review-tooltip';tooltip.role='tooltip';tooltip.textContent=text;document.body.append(tooltip);const r=anchor.getBoundingClientRect(),w=tooltip.offsetWidth,h=tooltip.offsetHeight;tooltip.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';tooltip.style.top=Math.max(8,r.top-h-8)+'px';}
export async function submit(id){
  const before=input(id);
  try {const review=await service.submit(before);if(before?.key!==input(id)?.key)return review;if(['configuration_required','unavailable','failed'].includes(review.status))app.notify(review.message);if(review.persistenceError)app.notify('验证结果暂未保存：浏览器存储空间不足');return review;} catch(error){app.notify(error.message);return {status:'failed',message:error.message};}
}
export function bindMenu(button,id){button.dataset.reviewNode=typeof id==='string'?id:id.id;menuButtons.add(button);refreshButton(button);}
function refreshButton(button){const value=input(button.dataset.reviewNode),review=service.get(value),busy=pending(review.status)&&!review.interrupted;const disabled=!value||busy;if(button.disabled!==disabled)button.disabled=disabled;if(button.getAttribute('aria-busy')!==String(busy))button.setAttribute('aria-busy',String(busy));const svg=button.querySelector('svg');if(svg&&svg.dataset.reviewBusy!==String(busy)){svg.outerHTML=busy?icons.loading:window.CANVAS_MENU_ICONS.compliance;const replacement=button.querySelector('svg');replacement.dataset.reviewBusy=String(busy);replacement.classList.toggle('review-spinner',busy);}}
function render(event){
  if(event?.detail?.viewportOnly)return;
  if(tooltip&&!tooltip.isConnected)tooltip=null;
  invalidateBadges(badgeObserver.takeRecords());
  const state=app.getState(),liveKeys=new Set(),liveNodes=new Set();
  for(const node of state.nodes){liveNodes.add(node.id);const value=media(node,window.EDITOR_DATA?.nodes[node.id]);if(value)liveKeys.add(value.key);const review=service.get(value),record=badgeRecord(node),title=record?.title;if(!title)continue;
    const old=record.badge;
    if(record.hasReview&&record.status===review.status&&record.message===review.message&&record.interrupted===review.interrupted&&record.nodeType===node.type&&record.mediaKey===value?.key&&(!old||old.parentNode===title))continue;
    record.hasReview=true;record.status=review.status;record.message=review.message;record.interrupted=review.interrupted;record.nodeType=node.type;record.mediaKey=value?.key;record.badge=null;
    if(old)hideTooltip();old?.remove();const legacy=record.legacy;if(legacy)legacy.hidden=review.status!=='unknown';
    if(review.status==='unknown')continue;
    const badge=document.createElement('span');ownedBadges.add(badge);badge.className='media-review-badge';badge.dataset.status=review.status;badge.dataset.fingerprint=JSON.stringify([review.status,review.message,review.interrupted,node.type]);badge.tabIndex=0;
    const message=review.status==='rejected_invalid'?invalid[node.type]:review.message||texts[review.status]||'验证失败，请重试';
    badge.setAttribute('aria-label',message);
    if(['approved','rejected'].includes(review.status))badge.innerHTML=icons[review.status];
    else badge.textContent=pending(review.status)?(review.interrupted?'验证已中断':'正在验证'):({rejected_invalid:'规格受限',configuration_required:'待连接 API',unavailable:'暂不可验证',failed:'验证失败'}[review.status]||'');
    badge.onpointerenter=()=>showTooltip(badge,message);badge.onpointerleave=hideTooltip;badge.onfocus=()=>showTooltip(badge,message);badge.onblur=hideTooltip;
    badge.onpointerdown=e=>e.stopPropagation();badge.onkeydown=e=>{if(e.key==='Escape')hideTooltip();e.stopPropagation();};
    title.append(badge);record.badge=badge;
  }
  for(const id of nodeBadges.keys())if(!liveNodes.has(id))nodeBadges.delete(id);
  // Results belong to media, not node IDs. Retain a shared job while any copy references it.
  for(const key of service.running.keys())if(!liveKeys.has(key))service.cancel({key});
  for(const button of menuButtons){if(!button.isConnected){menuButtons.delete(button);continue;}refreshButton(button);}
}
window.MediaReview={submit,bindMenu,status:id=>service.get(input(id)),cancel:id=>service.cancel(input(id)),setAdapter:adapter=>{service.setAdapter(adapter);render();},getTrace:()=>structuredClone(service.trace)};
document.addEventListener('canvas:render',event=>{hideTooltip();render(event);});render();
