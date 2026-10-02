import {managerIcons} from './icons.mjs';
const el=(tag,cls='',text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};

// A detail action owns its buttons until completion. Navigation remains usable;
// the caller checks its view token before updating or closing the manager.
export function renderAppDetail({app,state,artwork,toggle,onUse,onInstall,onUninstall,onError}){
 const body=el('div','manager-app-detail'),title=el('div','manager-app-title'),labels=el('div','manager-app-labels');
 const subtitle=app.categoryLabel?.trim()||app.category?.trim()||app.description;
 labels.append(el('p','manager-name',app.name),el('p','manager-author',subtitle));title.append(artwork(app),labels);
 if(state.installed&&!app.builtin)title.append(toggle(state.enabled,'启用 '+app.name));
 const scroll=el('div','manager-app-scroll'),content=el('div','manager-app-content'),footer=el('footer','manager-footer manager-app-footer');
 const actions=[],pending=new Set();
 function action(label,run,cls,operation='use'){
  const button=el('button',cls,label);button.type='button';button.ariaLabel=label;actions.push({button,operation});
  button.onclick=async()=>{
   if(pending.has(operation))return;pending.add(operation);
   for(const item of actions)if(item.operation===operation)item.button.disabled=true;button.setAttribute('aria-busy','true');
   try{await run();}catch(error){onError(error.message);}finally{pending.delete(operation);for(const item of actions)if(item.operation===operation)item.button.disabled=false;button.removeAttribute('aria-busy');}
  };return button;
 }
 const prompts=app.examples?.length?app.examples:[app.name],hasExamples=!!app.examples?.length;
 const examples=el('div','manager-app-examples');examples.dataset.single=String(prompts.length===1);
 for(const text of prompts){
   const row=hasExamples?action(app.name+' '+text,()=>onUse(text),'manager-example'):el('div','manager-example manager-example-static'),copy=el('p','manager-example-copy');row.replaceChildren();
   const icon=el('img','manager-example-icon');icon.src=app.icon;icon.alt='';icon.draggable=false;
   copy.append(icon);if(hasExamples)copy.append(el('span','manager-example-name',app.name));copy.append(el('span','manager-example-text',text));
   const arrow=el('span','manager-example-arrow');arrow.innerHTML=managerIcons.exampleArrow;arrow.ariaHidden='true';row.append(copy,arrow);examples.append(row);
 }content.append(examples);
 const description=el('div','manager-detail-description manager-app-markdown',app.publicContent??app.description);
 if(app.publicContent??app.description)content.append(description);
 if(app.skills?.length){
  const skills=el('section','manager-app-skills');skills.append(el('p','manager-skills-heading','技能'));
  for(const skill of app.skills){
   const row=el('div','manager-app-skill'),icon=el('span','manager-app-skill-icon'),copy=el('div','manager-app-skill-copy');
   icon.innerHTML=managerIcons.appSkill;icon.ariaHidden='true';copy.append(el('p','manager-app-skill-name',skill.name),el('p','manager-detail-description',skill.description));row.append(icon,copy);skills.append(row);
  }content.append(skills);
 }
 scroll.append(content);scroll.addEventListener('wheel',event=>event.stopPropagation());body.append(title,scroll);
 if(!state.installed)footer.append(action('安装应用',onInstall,'manager-primary','install'));
 else{
  if(!app.builtin)footer.append(action('卸载',onUninstall,'manager-uninstall','uninstall'));
  footer.append(action('在对话中使用',()=>onUse(undefined),'manager-primary'));
 }
 return {body,footer,description};
}
