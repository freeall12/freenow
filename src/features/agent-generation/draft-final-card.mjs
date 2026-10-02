import {appendRecoveryActions} from './recovery-actions.mjs';
import {icons} from './icons.mjs';
import {createDraftFinalDraft,confirmDraftFinal,draftFinalSource} from './draft-final.mjs';
import {generationStatus} from './model.mjs';
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function createDraftFinalCard(initial,{getNodes,getEdges=()=>[],getMode,setMode,onConfirm,onChange,onOpenNode,resolveAsset}){
 let trace=initial,draft=trace.confirmationDraft||createDraftFinalDraft(trace.args,getNodes()),error='',disposed=false;
 const root=el('section','agent-generation-card');root.ariaLabel='样片生成正式片确认';root.dataset.draftFinal='true';
 const button=(text,click,cls)=>{const node=el('button',cls,text);node.type='button';node.onclick=click;return node;};
 function confirm(allowed){try{const args=allowed?confirmDraftFinal(trace.args,draft,getNodes(),getEdges()):undefined;trace.confirmationDraft=structuredClone(draft);onChange(trace);root.querySelectorAll('button').forEach(node=>node.disabled=true);onConfirm(trace,allowed,args);}catch(reason){error=reason.message;render();}}
 function updateMode(){const toggle=root.querySelector('[role=switch]');toggle?.setAttribute('aria-checked',String(getMode()==='auto'));}
 function render(){
  root.replaceChildren();const status=generationStatus(trace);root.dataset.status=status.state;
  const heading=el('header','generation-card-header'),glyph=el('span','generation-glyph');glyph.innerHTML=icons.videoType;heading.append(glyph,el('span','','样片 → 正式片'));if(status.label)heading.append(el('span','generation-card-status',status.label));root.append(heading);
  let source,issue='';try{source=draftFinalSource(trace.args,getNodes(),getEdges());if(trace.status==='pending')confirmDraftFinal(trace.args,draft,getNodes(),getEdges());}catch(reason){issue=reason.message;}
  const content=el('div','generation-prompt'),copy=el('div','generation-prompt-item');copy.append(el('div','generation-prompt-text','沿用样片的提示词与素材生成正式片，保留原样片。'));content.append(copy);root.append(content);
  const parameters=el('div','generation-card-parameters'),chips=el('div','generation-chip-list');for(const label of ['Seedance 2.5','1080P','1 个正式片'])chips.append(el('span','generation-chip',label));parameters.append(chips);
  const sourceButton=button('样片：'+(source?.title||draft.draftSourceTitle||trace.args.draftSourceId),()=>Promise.resolve(onOpenNode(trace.args.draftSourceId)).catch(reason=>{error=reason.message;render();}),'generation-small-button');sourceButton.disabled=!source;sourceButton.ariaLabel='查看继承样片：'+(source?.title||draft.draftSourceTitle||trace.args.draftSourceId);parameters.append(sourceButton);root.append(parameters);
  if(source?.image){const refs=el('div','generation-references'),preview=button('',()=>sourceButton.click(),'generation-thumb'),image=el('img','');image.alt=source.title||'样片';preview.ariaLabel=sourceButton.ariaLabel;preview.append(image);refs.append(preview);parameters.append(refs);Promise.resolve(resolveAsset(source.image)).then(url=>{if(!disposed&&image.isConnected)image.src=url;}).catch(()=>{});}
  if(trace.status==='pending'){
   const footer=el('footer','generation-confirm-footer'),auto=el('label','generation-auto'),toggle=button('',()=>{try{setMode(getMode()==='auto'?'ask':'auto');updateMode();}catch(reason){error=reason.message;render();}},'generation-auto-switch');toggle.role='switch';toggle.ariaLabel='自动生成';toggle.append(el('span',''));auto.append(toggle,el('span','','Act'));footer.append(auto,el('span','generation-spacer'),button('取消',()=>confirm(false),'generation-small-button'));
   const submit=button('生成正式片',()=>confirm(true),'generation-confirm-button');submit.disabled=!!issue;footer.append(submit);root.append(footer);updateMode();
  }
  appendRecoveryActions(root,trace,{onError:reason=>{error=reason.message;render();}});
  const failure=error||status.error||(trace.status==='pending'?issue:'');if(failure){const message=el('p','generation-error',failure);message.role='alert';root.append(message);}
 }
 render();return {element:root,update(next){trace=next;if(trace.status!=='pending')draft=trace.confirmationDraft||createDraftFinalDraft(trace.args,getNodes());render();},suspend(){},destroy(){disposed=true;root.remove();}};
}
