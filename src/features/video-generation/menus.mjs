import {configuration} from './settings.mjs';
import {ratioIcon} from '../image-generation/menus.mjs';
export * from './settings.mjs';
const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./menus.css',import.meta.url);document.head.append(css);
const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
export function modelIcon(config){const d=configuration(config);if(!d)return null;const img=el('img','image-model-icon');img.src=d.model.icon;img.alt='';return img;}
export function renderSpecifications(pop,config,getInputs,onChange){
  let current=config,observers=[],tooltip=null,disposed=false,renderRevision=0;
  const hideTooltip=()=>{tooltip?.remove();tooltip=null;};
  pop.classList.add('video-spec-menu');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','视频生成规格');pop.tabIndex=-1;
  function section(label){const s=el('section','video-parameter-section');s.append(el('div','video-parameter-label',label));pop.append(s);return s;}
  function draw(){
    const revision=++renderRevision;
    hideTooltip();observers.forEach(o=>o.disconnect());observers=[];pop.replaceChildren();const data=configuration(current,getInputs());if(!data)return;
    current=data.settings;pop.classList.toggle('wide-duration',data.model.id.startsWith('seedance-2.5'));
    function commit(key,value,rebuild=false){if(disposed||revision!==renderRevision)return;current=onChange({...current,[key]:value,...(key==='mode'?{videoMode:undefined}:{} )})||current;if(rebuild)draw();}
    function segments(label,values,key,{render,scroll=false,disabled=[],hint=''}={}){
      const s=section(label);if(!values?.length){s.append(el('div','video-parameter-auto','自动'));return;}
      const group=el('div','video-parameter-segments');group.classList.toggle('scrollable',scroll);const selection=el('span','video-parameter-selection');group.append(selection);s.append(group);
      const buttons=values.map(value=>{const b=el('button','',render?undefined:String(value));b.type='button';if(render)b.append(render(value));b.disabled=disabled.includes(value);b.setAttribute('aria-pressed',String(current[key]===value));if(b.disabled)b.title='当前参考素材不支持此生成方式';b.onclick=()=>{commit(key,value,key==='mode');if(key!=='mode')update();};group.append(b);return b;});
      if(hint){const b=buttons[values.indexOf('全能参考')];if(b){const info=el('span','video-mode-hint');info.tabIndex=0;info.setAttribute('role','button');info.setAttribute('aria-label',hint);info.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>';const showTooltip=()=>{if(disposed||revision!==renderRevision)return;hideTooltip();tooltip=el('span','video-mode-tooltip is-visible',hint);tooltip.setAttribute('role','tooltip');document.body.append(tooltip);const r=info.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(innerWidth-tooltip.offsetWidth-8,r.left+r.width/2-tooltip.offsetWidth/2))+'px';tooltip.style.top=(r.top>tooltip.offsetHeight+12?r.top-tooltip.offsetHeight-8:r.bottom+8)+'px';};info.onmouseenter=showTooltip;info.onmouseleave=hideTooltip;info.onfocus=showTooltip;info.onblur=hideTooltip;info.onclick=e=>e.stopPropagation();info.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){if(tooltip){e.stopPropagation();e.preventDefault();hideTooltip();}return;}if(e.key==='Enter'||e.key===' '){e.stopPropagation();e.preventDefault();showTooltip();}};b.append(info);}}
      function update(){if(disposed)return;buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(current[key]===values[i])));const active=buttons[values.indexOf(current[key])];if(active)Object.assign(selection.style,{left:active.offsetLeft+'px',top:active.offsetTop+'px',width:active.offsetWidth+'px',height:active.offsetHeight+'px'});const left=group.scrollLeft>1,right=group.scrollLeft+group.clientWidth<group.scrollWidth-1;group.style.maskImage=scroll?`linear-gradient(to right,${left?'transparent':'black'},black 15%,black 85%,${right?'transparent':'black'})`:'';}
      group.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const enabled=buttons.filter(b=>!b.disabled),i=enabled.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const next=e.key==='Home'?enabled[0]:e.key==='End'?enabled.at(-1):enabled[(i+(e.key==='ArrowRight'?1:-1)+enabled.length)%enabled.length];next.focus();next.scrollIntoView({block:'nearest',inline:'nearest'});};
      group.addEventListener('scroll',update);const observer=new ResizeObserver(update);observer.observe(group);observers.push(observer);requestAnimationFrame(update);return {s,group,update};
    }
    if(data.options.modes?.length)segments('生成模式',data.options.modes,'generateMode',{render:v=>el('span','',{std:'标准',pro:'专业','4k':'4K'}[v]||v)});
    if(data.modeOptions.length>1)segments('生成方式',data.modeOptions.map(v=>v.label),'mode',{disabled:data.modeOptions.filter(v=>v.disabled).map(v=>v.label),hint:data.hint});
    segments('比例',data.options.aspectRatios,'ratio',{render:v=>{const face=el('span','video-ratio-option');face.append(ratioIcon(v==='adaptive'?'auto':v,14),el('span','',v==='adaptive'?'自适应':v));return face;}});
    segments('清晰度',data.options.resolutions,'quality');
    const duration=segments('生成时长',data.options.durations,'duration',{render:v=>el('span','',v===-1?'自动':`${v}s`),scroll:(data.options.durations?.length||0)>8});
    if(duration&&data.model.id.startsWith('seedance-2.5')){
      const row=el('div','video-duration-row'),input=el('input','video-duration-input');input.type='text';input.inputMode='numeric';input.setAttribute('aria-label','生成时长（秒）');input.value=String(current.duration);duration.s.append(row);row.append(duration.group,input);
      const apply=()=>{if(disposed||revision!==renderRevision)return;const n=Number(input.value),values=data.options.durations.filter(v=>v>0);if(input.value&&Number.isFinite(n)){const closest=values.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);if(closest!==current.duration)commit('duration',closest);duration.update();}input.value=String(current.duration);};
      input.oninput=()=>{input.value=input.value.replace(/\D/g,'').slice(0,3);if(input.value&&data.options.durations.includes(Number(input.value))){commit('duration',Number(input.value));duration.update();}};input.onfocus=()=>input.select();input.onblur=apply;input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();apply();input.select();}if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();input.value=String(current.duration);pop.focus({preventScroll:true});}};
    }
    if(data.options.supportsAudio)segments('生成音频',[true,false],'audio',{render:v=>el('span','',v?'开启':'关闭')});
  }
  draw();return()=>{disposed=true;hideTooltip();observers.forEach(o=>o.disconnect());};
}

// Official v$e / VideoConfigsTrigger paths from canvas-current-readable.js:29311.
export function audioIcon(enabled){
  const wrap=el('span','video-audio-indicator');wrap.setAttribute('aria-label',enabled?'生成音频开启':'生成音频关闭');
  wrap.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M2 2L22 22" style="stroke-dasharray:30;stroke-dashoffset:${enabled?30:0};transition:stroke-dashoffset 300ms ease-out"/></g></svg>`;
  return wrap;
}
