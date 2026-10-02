// H5e/Jl showPrice=false, official Lucide ArrowUp and Tabler Loader2 geometry.
const arrow='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
const loader='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
const controls=new WeakMap();
function ensureStyles(){
 if(document.querySelector('link[data-generation-action]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./action-button.css',import.meta.url).href;link.dataset.generationAction='';document.head.append(link);
}
export function updateGenerationAction(button,{busy=false,disabled=button.disabled,label=button.getAttribute('aria-label')||'生成'}={}){
 let record=controls.get(button);
 if(!record){
  ensureStyles();const wrapper=document.createElement('div');wrapper.className='generation-action-shell';
  button.parentNode?.insertBefore(wrapper,button);wrapper.append(button);button.classList.add('generation-action-button');
  record={wrapper,busy:null,icon:null};controls.set(button,record);
 }
 if(record.busy!==busy||record.icon!==button.firstElementChild){button.innerHTML=busy?loader:arrow;record.icon=button.firstElementChild;record.busy=busy;}
 const blocked=!!(busy||disabled);if(button.disabled!==blocked)button.disabled=blocked;
 if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
 if(button.getAttribute('aria-busy')!==String(busy))button.setAttribute('aria-busy',String(busy));
 return record.wrapper;
}
