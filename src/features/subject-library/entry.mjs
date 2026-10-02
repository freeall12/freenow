import {checkIcon} from './icons.mjs';
import {el,button,preview,loadStyles} from './ui.mjs';
import {listSubjects} from './store.mjs';
import {editSubject} from './editor.mjs';
export {listSubjects,editSubject};
export {subjectsEnabled,subjectIds,replaceSubjects,projectSubjects} from './model.mjs';
export function openSubjects({selected=[],limit=Infinity,onChoose=()=>{},anchor,onClose=()=>{}}={}) {
  loadStyles();const dialog=el('dialog','subject-grid-dialog');dialog.ariaLabel='主体库';let scope='personal',selection=new Set(selected),editor=null;
  const initial=new Set(selected),head=el('header'),line=el('div','subject-grid-heading');line.append(el('h2','','主体库'),button('取消',()=>dialog.close(),'subject-icon-button','close'));
  const tabs=el('div','subject-grid-tabs');tabs.role='tablist';tabs.ariaLabel='空间';for(const [id,label]of [['personal','个人'],['team','团队']]){const b=button(label,()=>{scope=id;draw();});b.role='tab';b.dataset.scope=id;tabs.append(b);}head.append(line,tabs);
  const body=el('div','subject-grid-scroll'),grid=el('div','subject-grid-items');body.append(grid);const foot=el('footer'),count=el('span'),done=button('完成',()=>{onChoose(listSubjects().filter(s=>selection.has(s.id)));dialog.close();},'subject-primary');foot.append(count,done);dialog.append(head,body,foot);
  function create(){dialog.close('editor');editor=editSubject({scope,onSave:()=>{},onClose(){editor=null;dialog.showModal();draw();}});}
  function draw(){for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.scope===scope));grid.replaceChildren();const add=button('新建主体',create,'subject-grid-card');add.replaceChildren();const tile=el('span','subject-grid-tile');tile.append(button('',null,'subject-create-glyph','plus'));tile.firstChild.replaceWith(...tile.firstChild.childNodes);add.append(tile,el('span','subject-grid-name','新建主体'));grid.append(add);
    for(const s of listSubjects(scope)){const active=selection.has(s.id),card=button(s.name,()=>{if(active)selection.delete(s.id);else if(selection.size<limit)selection.add(s.id);draw();},'subject-grid-card');card.replaceChildren();card.disabled=!active&&selection.size>=limit;card.setAttribute('aria-pressed',String(active));const thumb=el('span','subject-grid-tile');thumb.append(preview(s.assets.find(a=>a.image||['image','video'].includes(a.type))||s.assets[0]));if(active){const check=el('span','subject-selected-check');check.innerHTML=checkIcon;thumb.append(check);}card.append(thumb,el('span','subject-grid-name',s.name));grid.append(card);}
    count.textContent=selection.size>=limit?'最多选择 '+limit+' 个主体':'已选 '+selection.size+' 个';done.disabled=!selection.size&&![...initial].some(id=>!selection.has(id));
  }
  const changed=()=>draw();document.addEventListener('subjects:changed',changed);
  dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}};
  dialog.onclose=()=>{if(dialog.returnValue==='editor'){dialog.returnValue='';return;}document.removeEventListener('subjects:changed',changed);editor?.close();dialog.remove();anchor?.setAttribute('aria-expanded','false');anchor?.focus({preventScroll:true});onClose();};document.body.append(dialog);anchor?.setAttribute('aria-expanded','true');dialog.showModal();draw();return dialog;
}
export function subjectTrigger(options) {loadStyles();const b=button('添加主体',()=>openSubjects({...options,selected:typeof options.selected==='function'?options.selected():options.selected,anchor:b}),'subject-quick-trigger','subject');b.setAttribute('aria-expanded','false');b.setAttribute('aria-haspopup','dialog');b.dataset.tooltip='添加主体';return b;}
