import {availableApps} from '../agent-manager/registry.mjs';
import {icons} from './icons.mjs';
import {skillIcons,getSkillIcon} from './skill-icons.mjs';
import {bindTooltip} from '../agent-composer/tooltip.mjs';
const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./styles.css',import.meta.url);document.head.append(css);
let active=null;
export function createAddMenu({trigger,onAction,getSkills,onSkill,onError}){
  let menu=null,sub=null,timer=0,token=0,abort=null,tooltips=[];
  trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
  const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
  function close(focus=false){tooltips.forEach(t=>t.destroy());tooltips=[];token++;clearTimeout(timer);abort?.abort();sub?.remove();menu?.remove();menu=sub=null;trigger.setAttribute('aria-expanded','false');if(active===close)active=null;if(focus)trigger.focus();}
  function closeSub(focus=false){if(!sub)return;const kind=sub.dataset.kind;token++;clearTimeout(timer);tooltips.forEach(t=>t.destroy());tooltips=[];sub.remove();sub=null;menu?.querySelectorAll('[data-submenu]').forEach(row=>row.dataset.expanded='false');if(focus)menu?.querySelector('[data-submenu='+kind+']')?.focus({preventScroll:true});}
  function invoke(action){close(true);try{Promise.resolve(onAction(action)).catch(error=>onError(error.message));}catch(error){onError(error.message);}}
  function row(label,action,arrow=false,artwork=''){const info={上传技能文件:'上传 Markdown 技能文件（.md 或 .markdown），例如 SKILL.md。',上传技能文件夹:'上传包含 Markdown 文件的技能文件夹，例如 SKILL.md 和相关参考文件。'}[label];const e=el(info?'div':'button','agent-add-item');if(!info)e.type='button';e.role='menuitem';e.tabIndex=-1;
    if(artwork)e.insertAdjacentHTML('beforeend',artwork);else if(skillIcons[label])e.insertAdjacentHTML('beforeend',skillIcons[label]);else if(icons[label])e.insertAdjacentHTML('beforeend',icons[label]);else if(label==='头脑风暴'){const img=el('img');img.src='/assets/agent-brainstorm.svg';img.alt='';e.append(img);}
    e.append(el('span','',label));if(arrow)e.insertAdjacentHTML('beforeend',icons.chevron);if(info){const hint=el('button','agent-add-info');hint.type='button';hint.innerHTML=icons.info;hint.ariaLabel=info;hint.onclick=event=>event.stopPropagation();e.append(hint);tooltips.push(bindTooltip(hint,{text:()=>info}));e.onkeydown=event=>{if(event.target===e&&['Enter',' '].includes(event.key)){event.preventDefault();action();}};}e.onclick=action;e.onpointerenter=()=>{e.focus({preventScroll:true});};return e;
  }
  function separator(parent){const e=el('div','agent-add-separator');e.role='separator';parent.append(e);}
  function position(){if(!menu)return;const r=trigger.getBoundingClientRect(),height=menu.offsetHeight,above=r.top>height+12;menu.dataset.side=above?'top':'bottom';menu.style.left=Math.max(8,Math.min(innerWidth-248,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-height-8,above?r.top-height-8:r.bottom+8))+'px';if(sub){const m={left:parseFloat(menu.style.left),right:parseFloat(menu.style.left)+menu.offsetWidth,bottom:parseFloat(menu.style.top)+menu.offsetHeight},width=sub.offsetWidth;sub.style.left=(m.right+width+12<innerWidth?m.right+4:Math.max(8,m.left-width-4))+'px';sub.style.top=Math.max(8,Math.min(innerHeight-sub.offsetHeight-8,m.bottom-sub.offsetHeight))+'px';const list=sub.querySelector('.agent-add-sublist');list.dataset.top=String(list.scrollTop>1);list.dataset.bottom=String(list.scrollTop+list.clientHeight<list.scrollHeight-1);}}
  async function openSub(kind,focus=false){if(!menu)return;if(sub?.dataset.kind===kind){if(focus)sub.querySelector('input')?.focus();return;}const version=++token;menu.querySelectorAll('[data-submenu]').forEach(row=>row.dataset.expanded=String(row.dataset.submenu===kind));tooltips.forEach(t=>t.destroy());tooltips=[];sub?.remove();sub=el('div','agent-add-submenu');sub.role='menu';sub.dataset.kind=kind;sub.ariaLabel=kind==='skills'?'技能':'全部应用';document.body.append(sub);sub.onkeydown=menu.onkeydown;
    const search=el('input','agent-add-search');search.placeholder='搜索';search.ariaLabel='搜索';search.autocomplete='off';search.spellcheck=false;const searchWrap=el('div','agent-add-search-wrap');searchWrap.innerHTML=icons.search;searchWrap.append(search);sub.append(searchWrap);const list=el('div','agent-add-sublist');list.onscroll=position;sub.append(list);
    if(kind==='apps'){const render=()=>{list.replaceChildren();for(const app of availableApps().filter(a=>(a.menuLabel+' '+a.description).toLowerCase().includes(search.value.toLowerCase()))){const b=row(app.menuLabel,()=>invoke('app:'+app.id)),image=el('img');image.src=app.icon;image.alt='';b.prepend(image);b.classList.add('agent-add-app');const desc=el('small','',app.description);b.querySelector('span').append(desc);list.append(b);}if(!list.children.length)list.append(el('p','agent-add-empty','暂无结果'));position();};search.oninput=render;render();separator(sub);sub.append(row('管理应用',()=>invoke('apps')));}
    else{list.append(el('p','agent-add-empty','正在加载…'));try{const skills=await getSkills();if(!menu||version!==token)return;
      const render=()=>{list.replaceChildren();for(const skill of skills.filter(s=>s.name.toLowerCase().includes(search.value.toLowerCase())))list.append(row(skill.name,()=>{close(true);try{Promise.resolve(onSkill(skill.name)).catch(error=>onError(error.message));}catch(error){onError(error.message);}},false,getSkillIcon(skill.name,skill.custom)));if(!list.children.length)list.append(el('p','agent-add-empty','暂无匹配技能'));position();};search.oninput=render;render();
      separator(sub);for(const [label,action]of [['上传技能文件','skill-file'],['上传技能文件夹','skill-folder'],['创建技能','skill-create'],['管理技能','skills']])sub.append(row(label,()=>invoke(action)));
    }catch(error){if(version===token)list.replaceChildren(el('p','agent-add-empty',error.message));}}
    if(!menu||version!==token)return;position();if(focus)search.focus();
  }
  function open(){if(trigger.disabled)return;if(menu)return close();active?.();active=close;abort=new AbortController();menu=el('div','agent-add-menu');menu.role='menu';menu.ariaLabel='添加';menu.tabIndex=-1;
    for(const [label,action,kind] of [['从画布添加','canvas'],['上传附件','upload'],['技能',null,'skills'],['头脑风暴','brainstorm'],['全部应用',null,'apps']]){
      if(label==='技能'||label==='头脑风暴')separator(menu);const b=row(label,()=>kind?openSub(kind,true):invoke(action),!!kind);b.dataset.submenu=kind||'';
      b.onpointerenter=()=>{b.focus({preventScroll:true});clearTimeout(timer);if(kind)timer=setTimeout(()=>openSub(kind),160);else closeSub();};menu.append(b);
    }
    document.body.append(menu);position();trigger.setAttribute('aria-expanded','true');menu.querySelector('[role=menuitem]').focus();
    document.addEventListener('pointerdown',event=>{if(!menu?.contains(event.target)&&!sub?.contains(event.target)&&!trigger.contains(event.target))close();},{capture:true,signal:abort.signal});
    menu.onkeydown=event=>{const scope=event.target.closest('.agent-add-submenu')||menu,items=[...scope.querySelectorAll('[role=menuitem]')].filter(e=>e.closest('.agent-add-submenu')===(scope===menu?null:scope));
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(sub)closeSub(true);else close(true);return;}if(event.key==='Tab'){close(true);return;}
      if(event.key==='ArrowLeft'&&sub){event.preventDefault();event.stopPropagation();closeSub(true);return;}
      if(event.key==='ArrowRight'&&event.target.dataset.submenu){event.preventDefault();openSub(event.target.dataset.submenu,true);return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target.tagName==='INPUT'&&['Home','End'].includes(event.key))){event.preventDefault();const index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:index<0?(event.key==='ArrowDown'?0:items.length-1):(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}
    };
    window.addEventListener('resize',position,{signal:abort.signal});
  }
  trigger.onclick=open;return {open,close,destroy(){close();trigger.onclick=null;}};
}
