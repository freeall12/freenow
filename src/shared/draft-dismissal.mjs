let sequence=0;
// Page-local confirmation keeps the event loop available to uploads and editors.
// Closing this layer always preserves the owner's draft unless discard is chosen.
export function confirmDiscard({owner,title='放弃未保存的修改？',message='当前修改尚未保存。放弃后无法恢复。',discardLabel='放弃修改',onDiscard=()=>{},onCancel=()=>{}}={}){
  if(!owner?.isConnected)return null;
  const document=owner.ownerDocument||globalThis.document;
  if(!document.querySelector('link[data-draft-dismissal]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./draft-dismissal.css',import.meta.url).href;link.dataset.draftDismissal='';document.head.append(link);}
  const dialog=document.createElement('dialog');dialog.className='draft-dismissal-dialog';dialog.dataset.draftDismissal='';const id='draft-dismissal-'+(++sequence),heading=document.createElement('h2'),text=document.createElement('p'),footer=document.createElement('footer'),cancel=document.createElement('button'),discard=document.createElement('button');heading.id=id;heading.textContent=title;text.id=id+'-description';text.textContent=message;dialog.setAttribute('aria-labelledby',heading.id);dialog.setAttribute('aria-describedby',text.id);dialog.setAttribute('aria-label',title);cancel.type=discard.type='button';cancel.textContent='继续编辑';discard.textContent=discardLabel;cancel.dataset.action='cancel';discard.dataset.action='discard';discard.className='draft-dismissal-discard';footer.append(cancel,discard);dialog.append(heading,text,footer);
  const returnFocus=document.activeElement;let finished=false;
  function finish(accepted){if(finished)return;finished=true;if(dialog.open)dialog.close();dialog.remove();const target=returnFocus?.isConnected?returnFocus:owner.querySelector('input,textarea,button');target?.focus({preventScroll:true});if(accepted)onDiscard();else onCancel();}
  cancel.onclick=()=>finish(false);discard.onclick=()=>finish(true);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);}});document.body.append(dialog);dialog.showModal();cancel.focus({preventScroll:true});return {element:dialog,cancel:()=>finish(false)};
}
