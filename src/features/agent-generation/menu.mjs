import {icons} from './icons.mjs';
import {lock} from '../agent-composer/model-icons.mjs';
export function openParameterMenu(trigger,{label,options,value,onSelect,model=false,duration=false,numericSpec=null,search=false,emptyMessage='暂无可用选项',onClose=()=>{}}){
 const menu=document.createElement('div');menu.className='agent-generation-menu'+(model?' is-model':'');menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);menu.dataset.state='open';
 let content=menu,numeric=null;
 if(duration){menu.classList.add('is-duration');menu.role='dialog';const title=document.createElement('p');title.textContent=label;const layout=document.createElement('div');layout.className='generation-duration-layout';content=document.createElement('div');content.className='generation-duration-options';content.role='group';content.setAttribute('aria-label','时长选项');const numberWrap=document.createElement('label');numberWrap.className='generation-duration-number';numeric=document.createElement('input');numeric.type='text';numeric.inputMode='numeric';numeric.setAttribute('aria-label','时长秒数');numeric.value=value===null?'':String(value);const unit=document.createElement('span');unit.textContent='s';numberWrap.append(numeric,unit);layout.append(content,numberWrap);menu.append(title,layout);}
 let selected=0,closed=false;const rows=[],hideReasons=[];
 let searchInput=null;if(search){searchInput=document.createElement('input');searchInput.type='search';searchInput.placeholder='搜索';searchInput.setAttribute('aria-label','搜索音色');menu.append(searchInput);menu.classList.add('is-voice');}
 if(!options.length){const empty=document.createElement('p');empty.className='generation-menu-empty';empty.textContent=emptyMessage;menu.append(empty);}
 function close(focus=false){if(closed)return;closed=true;hideReasons.forEach(hide=>hide());menu.remove();trigger.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);onClose();if(focus&&trigger.isConnected)trigger.focus();}
 function outside(e){if(!menu.contains(e.target)&&!trigger.contains(e.target))close();}
 function position(){if(!trigger.isConnected)return close();const r=trigger.getBoundingClientRect(),h=menu.offsetHeight,w=menu.offsetWidth;const above=innerHeight-r.bottom<h+16&&r.top>h+16;menu.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-h-8,above?r.top-h-8:r.bottom+8))+'px';}
 function focus(i){selected=(i+rows.length)%rows.length;rows.forEach((row,j)=>row.tabIndex=j===selected?0:-1);rows[selected]?.focus({preventScroll:true});rows[selected]?.scrollIntoView({block:'nearest'});}
 for(const [index,option]of options.entries()){
  const row=document.createElement('button');row.type='button';row.role='menuitemradio';row.setAttribute('aria-checked',String(option.value===value));row.setAttribute('aria-disabled',String(!!option.disabled));row.title=model?'':option.reason||'';row.tabIndex=-1;
  if(option.disabled&&option.reason)row.setAttribute('aria-label',`${option.label}: ${option.reason}`);
  if(option.icon){const img=document.createElement('img');img.src=option.icon;img.alt='';row.append(img);}
  const text=document.createElement('span');text.textContent=option.label;row.append(text);
  let mark=null;
  if((option.disabled&&model)||option.value===value){if(option.value===value)selected=index;mark=document.createElement('span');mark.className=option.disabled&&model?'agent-generation-menu-lock':'agent-generation-menu-check';mark.innerHTML=option.disabled&&model?lock:icons.check;row.append(mark);}
  if(model&&option.disabled&&option.reason){
   const reason=document.createElement('span');reason.className='agent-generation-model-reason';reason.hidden=true;reason.setAttribute('aria-hidden','true');
   const glyph=document.createElement('span');glyph.className='agent-generation-model-reason-lock';glyph.innerHTML=lock;
   const message=document.createElement('span');message.textContent=option.reason;reason.append(glyph,message);row.append(reason);
   // The official Ps row shows the reason only during its hover/focus lifecycle.
   const reveal=()=>{if(closed)return;reason.hidden=false;if(mark)mark.hidden=true;};
   const conceal=()=>{reason.hidden=true;if(mark)mark.hidden=false;};
   hideReasons.push(conceal);row.onmouseenter=reveal;row.onmouseleave=conceal;row.onfocus=reveal;row.onblur=conceal;
  }
  if(option.preview){const preview=document.createElement('button');preview.type='button';preview.textContent='试听';preview.setAttribute('aria-label','试听 '+option.label);preview.onclick=()=>option.preview();content.append(preview);}
  row.onclick=()=>{if(option.disabled)return;if(duration)selectDuration(option.value);else{close(true);onSelect(option.value);}};rows.push(row);content.append(row);
 }
 function selectDuration(next){selected=options.findIndex(option=>option.value===next);value=next;numeric.value=next===null?'':String(next);rows.forEach((row,i)=>row.setAttribute('aria-checked',String(options[i].value===next)));onSelect(next);}
 if(numeric){
  const valid=options.filter(o=>!o.disabled).map(o=>o.value);let cancellingBlur=false;
  const commit=()=>{const n=Number(numeric.value);if(numeric.value.trim()&&Number.isFinite(n))selectDuration(numericSpec?Math.min(numericSpec.max,Math.max(numericSpec.min,Math.round(n/(numericSpec.step||1))*(numericSpec.step||1))):valid.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a,valid[0]));else numeric.value=value===null?'':String(value);};
  if(!numericSpec)menu.tabIndex=-1;
  numeric.onfocus=()=>{cancellingBlur=false;numeric.select();};numeric.oninput=()=>{if(numeric.value.trim()&&valid.includes(Number(numeric.value)))selectDuration(Number(numeric.value));};
  numeric.onblur=()=>{if(!cancellingBlur)commit();};
  numeric.onkeydown=e=>{
   if(!numericSpec&&closed)return;
   e.stopPropagation();
   if(e.key==='Enter'){e.preventDefault();commit();numeric.select();}
   if(e.key==='Escape'){
    e.preventDefault();numeric.value=value===null?'':String(value);
    // Browser blur can occur while removing the input or restoring trigger focus.
    cancellingBlur=true;
    if(numericSpec)close(true);
    else{
     // Official o5 ends input editing; keep the next Escape owned by this popover.
     numeric.blur();
     if(!closed)menu.focus({preventScroll:true});
    }
   }
  };
 }
 menu.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='Tab'){close();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();focus(e.key==='Home'?0:e.key==='End'?rows.length-1:selected+(e.key==='ArrowDown'?1:-1));}};
 if(searchInput)searchInput.oninput=()=>{rows.forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(searchInput.value.toLowerCase()));position();};
 document.body.append(menu);trigger.setAttribute('aria-expanded','true');position();if(searchInput)searchInput.focus();else focus(selected);
 document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',position,true);window.addEventListener('resize',position);
 return {close};
}
