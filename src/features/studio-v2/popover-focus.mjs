const controls='button:not(:disabled), input:not(:disabled):not([type="hidden"]):not([type="file"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

export function focusPopoverTrigger(trigger,fallback=null){
  const available=node=>node?.isConnected&&!node.disabled&&!node.closest('[hidden]');
  const target=available(trigger)?trigger:available(fallback)?fallback:null;
  target?.focus({preventScroll:true});
}

export function focusPopover(panel){
  const target=[...panel.querySelectorAll(controls)].find(node=>!node.hidden);
  (target||panel).focus({preventScroll:true});
}

// File inspection and import state replace the controls while the same popover stays open.
// Keep its active control where possible, including a safe panel fallback while saving.
export function preservePopoverFocus(panel){
  const active=panel.ownerDocument.activeElement;
  if(!panel.contains(active))return ()=>{};
  const label=active.getAttribute('aria-label'),tag=active.tagName;
  return ()=>{
    if(!panel.isConnected)return;
    const matching=[...panel.querySelectorAll(controls)].find(node=>node.tagName===tag&&node.getAttribute('aria-label')===label&&!node.hidden);
    if(matching)matching.focus({preventScroll:true});else focusPopover(panel);
  };
}

export function bindPopoverFocus(panel,{trigger,canDismiss=()=>true,onDismiss}){
  let disposed=false;
  const document=panel.ownerDocument;
  const outside=event=>{
    if(panel.contains(event.target)||trigger.contains(event.target))return;
    queueMicrotask(()=>{
      if(disposed||!panel.isConnected||!canDismiss())return;
      const active=panel.ownerDocument.activeElement;
      if(!panel.contains(active)&&!trigger.contains(active))onDismiss();
    });
  };
  // The official Radix layer observes focusin. A mouse press can blur a button
  // to BODY without focusing its next button; dismissing on blur would eat that click.
  document.addEventListener('focusin',outside);
  return ()=>{disposed=true;document.removeEventListener('focusin',outside);};
}
