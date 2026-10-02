import {generationSubjectPreview} from './prompt-subject-preview.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {promptIcons} from './prompt-icons.mjs';
import {audioTypeIcon} from './audio-assets.mjs';
import {audioPreview} from '../node-composer/audio-preview.mjs';
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
// UQe's ZW uses bf (160px); Asset mentions use Vq/a3 (100px).
// Read-only node pills use vp/us and deliberately have no media tooltip.
export function generationPromptPreviews(track,{resolve,editing=false,resolveAsset=async url=>url}={}){
 let active=null,pending=null,enterTimer=0,leaveTimer=0,disposed=false;
 const abort=new AbortController(),signal=abort.signal;
 function hide(){clearTimeout(enterTimer);clearTimeout(leaveTimer);pending=null;if(!active)return;const current=active;active=null;current.chip.removeAttribute('aria-describedby');current.destroy();current.element.remove();}
 function leave(){clearTimeout(enterTimer);pending=null;clearTimeout(leaveTimer);leaveTimer=setTimeout(hide,150);}
 function position(){if(!active)return;const {chip,element,nodeStyle}=active;if(!chip.isConnected){hide();return;}const rect=chip.getBoundingClientRect(),width=element.offsetWidth,height=element.offsetHeight,gap=nodeStyle?8:6,above=rect.top>=height+gap;
  element.dataset.side=above?'top':'bottom';Object.assign(element.style,{left:Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))+'px',top:Math.max(8,Math.min(innerHeight-height-8,above?rect.top-height-gap:rect.bottom+gap))+'px'});
 }
 function show(chip,ref){
  hide();if(disposed||!chip.isConnected)return;
  const nodeStyle=!!ref.nodeId,element=el('aside','generation-reference-preview '+(nodeStyle?'is-node':'is-asset'));element.id='generation-reference-preview-'+crypto.randomUUID();element.role='tooltip';element.ariaLabel='素材预览：'+ref.label;
  const frame=el('div','generation-reference-preview-frame');element.append(frame);const cleanups=[];let media=null;
  const placeholder=()=>{frame.replaceChildren();const icon=el('span','generation-reference-preview-placeholder');icon.innerHTML=ref.type==='audio'?audioTypeIcon:referenceIcons[ref.type+'Type']||referenceIcons.folderType||'';frame.append(icon);};
  active={chip,element,nodeStyle,destroy(){for(const cleanup of cleanups)cleanup();if(media?.tagName==='VIDEO'){media.pause();media.removeAttribute('src');media.load();}}};const current=active;
  const live=()=>!disposed&&active===current;
  if(ref.subjectId){const subject=generationSubjectPreview(ref);element.className='generation-reference-preview is-subject';element.replaceChildren(subject.element);cleanups.push(subject.destroy);}
  else if(ref.type==='text'&&ref.text){const text=el('div','generation-reference-preview-text',ref.text);frame.append(text);}
  else if(!nodeStyle&&ref.type==='audio'&&ref.url){const player=audioPreview(ref.url);frame.append(player.element);cleanups.push(player.destroy);player.show();}
  else if(['image','video'].includes(ref.type)&&(ref.url||ref.thumbnail)){
   media=el(ref.type==='video'?'video':'img','generation-reference-preview-media');media.alt=ref.label;
   if(media.tagName==='VIDEO'){media.autoplay=true;media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';if(!nodeStyle){const mute=el('button','generation-reference-mute');mute.type='button';const update=()=>{mute.ariaLabel=media.muted?'取消静音':'静音';mute.innerHTML=promptIcons[media.muted?'muted':'sound'];};update();mute.onclick=event=>{event.stopPropagation();media.muted=!media.muted;update();};frame.append(mute);}}
   media.onerror=()=>{if(live()){placeholder();element.dataset.error='media_unavailable';position();}};media.onload=media.onloadedmetadata=()=>{if(live())position();};frame.prepend(media);
   Promise.resolve(resolveAsset(ref.type==='image'&&!nodeStyle?ref.thumbnail||ref.url:ref.url||ref.thumbnail)).then(url=>{if(!live())return;media.src=url;if(media.tagName==='VIDEO')media.play().catch(()=>{});}).catch(()=>{if(live()){placeholder();element.dataset.error='media_unavailable';}});
  }else placeholder();
  if(nodeStyle)element.append(el('div','generation-reference-preview-caption',ref.label));
  else if(ref.type==='text')frame.append(el('div','generation-reference-preview-caption','@'+ref.label));
  element.onpointerenter=()=>clearTimeout(leaveTimer);element.onpointerleave=leave;document.body.append(element);chip.setAttribute('aria-describedby',element.id);const text=frame.querySelector('.generation-reference-preview-text');if(nodeStyle&&text)frame.dataset.overflow=String(text.scrollHeight>text.clientHeight);position();
 }
 function enter(chip,immediate=false){
  const ref=resolve(chip);if(!ref||(!editing&&ref.nodeId)||(!ref.nodeId&&!ref.subjectId&&!ref.token.startsWith('{{Asset:')))return;
  if(!ref.nodeId&&!ref.subjectId&&!ref.thumbnail&&!ref.url&&!(ref.type==='text'&&ref.text))return;
  clearTimeout(leaveTimer);if(active?.chip===chip||pending===chip)return;hide();pending=chip;enterTimer=setTimeout(()=>{pending=null;show(chip,ref);},immediate?0:ref.nodeId?700:300);
 }
 track.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const chip=event.target.closest('.generation-mention');if(chip&&track.contains(chip))enter(chip);},{signal});
 track.addEventListener('pointerout',event=>{const chip=active?.chip||pending;if(chip&&!chip.contains(event.relatedTarget)&&!active?.element.contains(event.relatedTarget))leave();},{signal});
 track.addEventListener('focusin',event=>{const chip=event.target.closest('.generation-mention');if(chip)enter(chip,true);},{signal});
 track.addEventListener('focusout',event=>{if(!active?.element.contains(event.relatedTarget))leave();},{signal});
 track.addEventListener('pointerdown',hide,{signal});track.addEventListener('keydown',event=>{if(event.key==='Escape')hide();},{signal});
 document.addEventListener('scroll',hide,{capture:true,signal});window.addEventListener('resize',hide,{signal});document.addEventListener('canvas:render',hide,{signal});
 const observer=new MutationObserver(()=>{if(active&&!active.chip.isConnected||pending&&!pending.isConnected)hide();});observer.observe(track,{childList:true,subtree:true});
 return {hide,destroy(){disposed=true;hide();observer.disconnect();abort.abort();}};
}
