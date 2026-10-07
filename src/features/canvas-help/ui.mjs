import {helpItems,shortcutColumns} from './catalog.mjs';
import {helpIcons} from './icons.mjs';

const node=(document,tag,className,text)=>{const element=document.createElement(tag);element.className=className;if(text!==undefined)element.textContent=text;return element;};
const composing=event=>event.isComposing||event.keyCode===229||event.key==='Process';

export function createCanvasHelp({document,window,trigger,canvas,run,closeOtherMenus=()=>{}}) {
  let menu=null,panel=null,active=0,focusRevision=0,focusTimer=0,triggerPointer=false;
  const subscriptions=[];
  const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);subscriptions.push(()=>target.removeEventListener(type,handler,options));};
  const focus=element=>element?.isConnected&&element.focus({preventScroll:true});
  const hasUpperLayer=()=>[...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[role=menu],[role=listbox]')].some(element=>element!==panel&&!element.closest('[hidden],[inert],[aria-hidden="true"]')&&window.getComputedStyle(element).display!=='none'&&window.getComputedStyle(element).visibility!=='hidden');
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','canvas-help-menu');trigger.setAttribute('aria-expanded','false');
  function icon(key){const holder=node(document,'span','canvas-help-icon');holder.innerHTML=helpIcons[key];holder.firstElementChild?.setAttribute('aria-hidden','true');return holder;}
  function closeMenu(restore=false){++focusRevision;window.clearTimeout(focusTimer);triggerPointer=false;if(!menu)return;menu.remove();menu=null;trigger.setAttribute('aria-expanded','false');if(restore)focus(trigger);}
  function closeShortcuts(restore=false){if(!panel)return;panel.remove();panel=null;if(restore)focus(trigger);}
  function place(){
    if(menu){const r=trigger.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;menu.style.left=Math.max(8,Math.min(r.left+r.width/2-width/2,window.innerWidth-width-8))+'px';menu.style.top=Math.max(8,r.top-height-8)+'px';menu.style.maxHeight=Math.max(44,r.top-16)+'px';}
    if(panel){const r=canvas.getBoundingClientRect(),width=Math.min(640,window.innerWidth-24),left=Math.max(12,Math.min(r.left+(r.width-width)/2,window.innerWidth-width-12));panel.style.left=left+'px';panel.style.width=width+'px';panel.style.bottom=Math.max(16,window.innerHeight-r.bottom+16)+'px';panel.style.maxHeight=Math.max(160,r.height-32)+'px';}
  }
  function highlight(index,{moveFocus=false}={}){if(!menu)return;active=index;const rows=[...menu.querySelectorAll('[role=option]')];rows.forEach((row,i)=>row.setAttribute('aria-selected',String(i===index)));if(moveFocus)focus(rows[index]);}
  function invoke(item){closeMenu(true);if(item.id==='shortcuts'){openShortcuts();return;}try{Promise.resolve(run(item.id)).catch(error=>window.CanvasApp?.notify(error.message));}catch(error){window.CanvasApp?.notify(error.message);}}
  function openMenu(){
    if(menu){closeMenu(true);return;}closeOtherMenus();menu=node(document,'section','canvas-help-menu');menu.id='canvas-help-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label','操作帮助');menu.tabIndex=-1;
    const list=node(document,'div','canvas-help-list');list.setAttribute('role','listbox');list.setAttribute('aria-label','帮助选项');
    helpItems.forEach((item,index)=>{const button=node(document,'button','canvas-help-option',item.label);button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.dataset.helpAction=item.id;if(item.testId)button.dataset.testid=item.testId;button.prepend(icon(index));button.onclick=()=>invoke(item);button.addEventListener('pointerenter',()=>highlight(index));button.onfocus=()=>highlight(index);list.append(button);});
    menu.append(list);document.body.append(menu);trigger.setAttribute('aria-expanded','true');place();highlight(0,{moveFocus:true});
    menu.onkeydown=event=>{
      if(event.defaultPrevented||composing(event))return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
      if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey&&event.key!=='Tab')return;
      if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(!event.repeat)invoke(helpItems[active]);return;}
      const rows=[...menu.querySelectorAll('[role=option]')],index=rows.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?rows.length-1:event.key==='ArrowDown'?((index<0?active:index)+1)%rows.length:event.key==='ArrowUp'?((index<0?active:index)+rows.length-1)%rows.length:null;
      if(next!==null){event.preventDefault();event.stopPropagation();highlight(next,{moveFocus:true});}
    };
  }
  function openShortcuts(){
    closeMenu();if(panel){closeShortcuts(true);return;}panel=node(document,'section','canvas-shortcut-panel');panel.id='canvas-shortcut-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','快捷键');panel.tabIndex=-1;
    const close=node(document,'button','canvas-help-close');close.type='button';close.setAttribute('aria-label','关闭快捷键');close.append(icon('close'));close.onclick=()=>closeShortcuts(true);panel.append(close);
    for(const groups of shortcutColumns(/Mac|iPhone|iPad/.test(window.navigator.platform||window.navigator.userAgent))){
      const column=node(document,'div','canvas-shortcut-column');
      for(const group of groups){const section=node(document,'section','canvas-shortcut-group');section.append(node(document,'h2','',group.title));const rows=node(document,'div','canvas-shortcut-rows');
        for(const [label,keys]of group.rows){const row=node(document,'div','canvas-shortcut-row'),shortcuts=node(document,'span','canvas-shortcut-keys');row.append(node(document,'span','',label),shortcuts);
          for(const key of keys){if(key==='mouse'){const gesture=icon('mouse');gesture.className='canvas-shortcut-gesture';gesture.setAttribute('aria-label','鼠标拖动或滚轮');shortcuts.append(gesture);}else if(key==='zoom'||key==='pan'){const image=node(document,'img','canvas-shortcut-gesture');image.src=new URL('./assets/'+key+'.gif',import.meta.url).href;image.alt=key==='zoom'?'触控板双指捏合缩放':'触控板双指移动';image.width=image.height=28;shortcuts.append(image);}else shortcuts.append(node(document,'kbd','',key));}
          rows.append(row);
        }section.append(rows);column.append(section);
      }panel.append(column);
    }document.body.append(panel);place();focus(panel);
  }
  listen(trigger,'click',openMenu);
  listen(trigger,'pointerdown',()=>{triggerPointer=!!menu;});listen(trigger,'pointercancel',()=>{triggerPointer=false;});
  listen(document,'pointerup',()=>{if(!triggerPointer)return;const revision=focusRevision;window.setTimeout(()=>{if(revision!==focusRevision)return;triggerPointer=false;if(menu&&document.activeElement===trigger)closeMenu();},0);});
  listen(document,'pointerdown',event=>{if(menu&&!menu.contains(event.target)&&!trigger.contains(event.target))closeMenu();if(panel&&!panel.contains(event.target)&&!trigger.contains(event.target)&&!menu?.contains(event.target))closeShortcuts();},true);
  listen(document,'focusin',event=>{if(menu&&!menu.contains(event.target)&&!(event.target===trigger&&triggerPointer))closeMenu();});
  listen(document,'focusout',()=>{if(!menu)return;const revision=++focusRevision;window.clearTimeout(focusTimer);focusTimer=window.setTimeout(()=>{if(revision!==focusRevision||!menu)return;if(document.activeElement===trigger&&triggerPointer)return;if(!document.hasFocus()||!menu.contains(document.activeElement))closeMenu();},0);});
  listen(document,'keydown',event=>{if(event.defaultPrevented||composing(event)||event.key!=='Escape')return;if(menu){event.preventDefault();event.stopImmediatePropagation();closeMenu(true);}else if(panel&&!hasUpperLayer()){event.preventDefault();event.stopImmediatePropagation();closeShortcuts(true);}},true);
  listen(document,'wheel',()=>closeMenu(),{passive:true});listen(window,'blur',()=>closeMenu());listen(window,'resize',place);
  const observer=window.ResizeObserver?new window.ResizeObserver(place):null;observer?.observe(canvas);observer?.observe(trigger);
  return {open:openMenu,shortcuts:openShortcuts,close(){closeMenu();closeShortcuts();},destroy(){closeMenu();closeShortcuts();observer?.disconnect();subscriptions.forEach(remove=>remove());trigger.removeAttribute('aria-expanded');trigger.removeAttribute('aria-controls');trigger.removeAttribute('aria-haspopup');}};
}
