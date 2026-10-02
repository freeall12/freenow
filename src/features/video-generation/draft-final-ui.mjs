import {isDraftNode,isFinalNode,resolveDraftReference,requireDraftSource} from './draft-final.mjs';
import {previewTooltips} from '../world-node/preview-tooltips.mjs';
import icons from './draft-final-icons.mjs';
const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./draft-final-ui.css',import.meta.url);css.onload=()=>document.dispatchEvent(new Event('node-composer:layout'));document.head.append(css);
const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
export const labels={hint:'先出 480P 样片快速预览，满意后可直接定稿为 1080P 正片',revise:'样片修改 480P',final:'生成正片 1080P',title:'选择正片分辨率',explanation:'沿用这条样片的提示词和素材，只改输出分辨率。',unavailable:'样片参考不可用，请确认样片已生成并连接至正式片'};
// Mqe/Pqe/Rqe and titleBadge: official canvas-current-readable.js:31049–31106,31630.
export function createDraftFinalUI({app,panel,onModeChange,onLayout=()=>{}}){
  const modes=new Map(),errors=new Map(),submitting=new Set(),badges=new Map();let mounted=null,disposeTip=null,observer=null,layoutFrame=0,previousPill=null,previousSwap=null,swapAnimations=[];
  const media=n=>n?.video||n?.src||window.EDITOR_DATA?.nodes[n?.id]?.video;
  const effective=(n,settings)=>settings?{...n,generation:settings}:n;
  function kind(n,settings){const value=effective(n,settings);if(isFinalNode(value))return 'final-node';if(!isDraftNode(value))return 'ordinary';return media(n)?'draft-'+(modes.get(n.id)||'final'):'draft-empty';}
  function signature(n,settings){return n?.id+':'+kind(n,settings);}
  function finalMode(n,settings){return ['draft-final','final-node'].includes(kind(n,settings));}
  function syncBadges(state){
    const seen=new Set();
    for(const n of state.nodes){if(n.type!=='video')continue;const owner=app.getNodeElement?.(n.id);if(!owner)continue;seen.add(owner);const old=badges.get(owner);if(!isDraftNode(n)){old?.remove();badges.delete(owner);continue;}if(old?.isConnected)continue;const title=owner.querySelector('.node-title');if(!title)continue;const badge=el('span','video-draft-badge','Draft');badge.dataset.draftBadge='true';title.append(badge);badges.set(owner,badge);}
    for(const [owner,badge]of badges)if(!seen.has(owner)){badge.remove();badges.delete(owner);}
  }
  function beginUpdate(n,settings){
    previousSwap=null;const next=kind(n,settings);
    if(mounted?.id===n.id&&mounted.mode!==next&&['draft-final','draft-revise'].includes(mounted.mode)&&['draft-final','draft-revise'].includes(next)&&mounted.body?.isConnected&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const copy=mounted.body.cloneNode(true);copy.inert=true;copy.setAttribute('aria-hidden','true');for(const e of [copy,...copy.querySelectorAll('[id]')])e.removeAttribute('id');previousSwap={id:n.id,height:mounted.swap.offsetHeight,copy};
    }
  }
  function finishMount(){
    const previous=previousSwap;previousSwap=null;const state=mounted;if(!state?.swap||!previous||previous.id!==state.id)return;
    const swap=state.swap,body=state.body,height=swap.offsetHeight,copy=previous.copy;copy.classList.add('video-draft-card-outgoing');swap.append(copy);swap.style.height=height+'px';swap.style.overflow='hidden';
    const options={duration:360,easing:'cubic-bezier(.16,1,.3,1)'},heightAnimation=swap.animate([{height:previous.height+'px'},{height:height+'px'}],{...options,duration:460});
    const entering=body.animate([{opacity:0},{opacity:1}],options),leaving=copy.animate([{opacity:1},{opacity:0}],{...options,fill:'forwards'});swapAnimations=[heightAnimation,entering,leaving];
    leaving.finished.then(()=>copy.remove()).catch(()=>copy.remove());
    heightAnimation.finished.then(()=>{if(mounted===state){swap.style.height='';swap.style.overflow='';swapAnimations=[];onLayout();}}).catch(()=>{});
  }
  function unmount(){for(const animation of swapAnimations)animation.cancel();swapAnimations=[];if(mounted?.pill)previousPill={id:mounted.id,left:mounted.pill.style.left,top:mounted.pill.style.top,width:mounted.pill.style.width,height:mounted.pill.style.height};disposeTip?.();disposeTip=null;observer?.disconnect();observer=null;cancelAnimationFrame(layoutFrame);layoutFrame=0;mounted=null;}
  function mount(n,settings){
    unmount();const mode=kind(n,settings),special=mode!=='ordinary';panel.classList.toggle('video-draft-shell',special);panel.dataset.draftFinalMode=mode;
    if(!special)return {body:panel,replacement:false};
    const state=mounted={id:n.id,mode,buttons:[],generate:null,error:null};
    if(mode==='draft-empty')panel.append(el('p','video-draft-hint',labels.hint));
    else if(mode!=='final-node'){
      const wrap=el('div','video-draft-tabs-wrap'),tabs=el('div','video-draft-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','样片与正片');const pill=el('span','video-draft-active-pill');pill.setAttribute('aria-hidden','true');state.pill=pill;if(previousPill?.id===n.id){const {id,...geometry}=previousPill;Object.assign(pill.style,geometry);}tabs.append(pill);
      for(const [value,label]of [['revise',labels.revise],['final',labels.final]]){const b=el('button','video-draft-tab',label);b.type='button';b.dataset.mode=value;b.dataset.activePill=String(mode==='draft-'+value);b.setAttribute('role','tab');b.setAttribute('aria-selected',b.dataset.activePill);b.tabIndex=mode==='draft-'+value?0:-1;b.onclick=()=>{if(b.disabled||modes.get(n.id)===value)return;modes.set(n.id,value);errors.delete(n.id);onModeChange(value);panel.querySelector(`.video-draft-tab[data-mode="${value}"]`)?.focus({preventScroll:true});};state.buttons.push(b);tabs.append(b);}
      tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const enabled=state.buttons.filter(b=>!b.disabled);if(!enabled.length)return;event.preventDefault();const current=enabled.indexOf(document.activeElement),next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(current+(event.key==='ArrowRight'?1:-1)+enabled.length)%enabled.length];next.click();};
      function placePill(){const b=tabs.querySelector('[data-active-pill=true]');if(b)Object.assign(pill.style,{left:b.offsetLeft+'px',top:b.offsetTop+'px',width:b.offsetWidth+'px',height:b.offsetHeight+'px'});}
      observer=new ResizeObserver(placePill);observer.observe(tabs);layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;placePill();});wrap.append(tabs);panel.append(wrap);
    }
    const replacement=finalMode(n,settings),body=el('div',replacement?'video-draft-final-card':'video-draft-composer-card');state.body=body;if(mode==='draft-final'||mode==='draft-revise'){state.swap=el('div','video-draft-card-swap');state.swap.append(body);panel.append(state.swap);}else panel.append(body);
    if(replacement){
      body.setAttribute('role','group');body.setAttribute('aria-label','生成正式片');const heading=el('div','video-draft-final-heading');heading.append(el('span','',labels.title));const info=el('button','video-draft-final-info');info.type='button';info.ariaLabel=labels.explanation;info.dataset.tooltip=labels.explanation;info.innerHTML=icons['info-circle'];info.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();info.blur();}};heading.append(info);body.append(heading,el('div','video-draft-final-resolution','1080P'));
      const generate=el('button','video-draft-final-generate');generate.type='button';generate.ariaLabel='生成正式片';generate.innerHTML=icons.generate;generate.append(el('span','','生成'));generate.onclick=()=>submit(n.id,mode);body.append(generate);state.generate=generate;
      const failure=el('p','video-draft-final-error');failure.setAttribute('role','status');failure.hidden=true;body.append(failure);state.error=failure;
      disposeTip=previewTooltips(body,{selector:'[data-tooltip]',portal:document.body,className:'video-draft-final-tooltip'});
    }
    update();return {body,replacement};
  }
  function currentStatus(id,mode){
    const state=app.getState(),n=state.nodes.find(n=>n.id===id),jobs=window.GenerationAPI?.getJobs()||[],job=jobs.filter(j=>j.request.nodeId===id&&j.request.kind==='video.generate').at(-1);let reason='',source=null;
    if(mode==='final-node'||mode==='draft-final')try{source=mode==='final-node'?resolveDraftReference(n,state.nodes,state.edges).source:requireDraftSource(n,state.nodes);}catch(error){reason=error.code==='draft_reference_unavailable'?labels.unavailable:error.message||labels.unavailable;}
    const busy=!!n?.pendingOperation||!!source?.pendingOperation||submitting.has(id)||jobs.some(j=>(j.request.nodeId===id||source&&j.request.nodeId===source.id)&&(['queued','running'].includes(j.status)||j.applying));
    return {busy,reason,message:reason||errors.get(id)||job?.applicationError||(['configuration_required','failed','cancelled'].includes(job?.status)?job.error||(job.status==='cancelled'?'已取消':'生成失败'):'')};
  }
  function update(){if(!mounted)return;const status=currentStatus(mounted.id,mounted.mode);for(const b of mounted.buttons)b.disabled=status.busy;if(mounted.generate){mounted.generate.disabled=status.busy||!!status.reason;mounted.generate.title=status.reason||(status.busy?'生成中…':'生成正式片');mounted.generate.setAttribute('aria-busy',String(status.busy));mounted.error.textContent=status.message;mounted.error.hidden=!status.message;}panel.setAttribute('aria-busy',String(status.busy));onLayout();}
  async function submit(id,mode){const status=currentStatus(id,mode);if(status.busy||status.reason)return;errors.delete(id);submitting.add(id);update();try{const {submitDraftFinal}=await import('./draft-final-workflow.mjs');await submitDraftFinal(mode==='final-node'?{targetId:id}:{sourceId:id});}catch(error){errors.set(id,error.message||'生成失败');app.notify(error.message||'生成失败');}finally{submitting.delete(id);update();}}
  return {kind,signature,finalMode,beginUpdate,finishMount,mount,update,unmount,syncBadges,submit(){if(mounted)return submit(mounted.id,mounted.mode);}};
}
