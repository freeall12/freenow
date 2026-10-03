import {offlineHtmlWrapper} from './local-export.mjs';

// Preview-only presentation messages: neither frame gains host DOM, navigation,
// tool access, upload access or changes to the offline document's CSP.
export function innerPreviewEscapeBridge(bootToken){
  let binding=null,composing=false;const nestedDialogEvents=new WeakSet();
  const same=(data)=>binding&&data?.nonce===binding.nonce&&data?.generation===binding.generation&&data?.innerNonce===binding.innerNonce;
  window.addEventListener('message',event=>{
    const data=event.data;if(event.source!==window.parent||data?.type!=='html-preview-inner-init'||data.bootToken!==bootToken||typeof data.nonce!=='string'||typeof data.innerNonce!=='string'||!Number.isSafeInteger(data.generation))return;
    binding={nonce:data.nonce,generation:data.generation,innerNonce:data.innerNonce};
    window.parent.postMessage({type:'html-preview-inner-ready',...binding},'*');
  });
  window.addEventListener('compositionstart',()=>{composing=true;},true);
  window.addEventListener('compositionend',()=>{composing=false;},true);
  // Remember dialogs before descendant handlers can close them. The same key
  // must not dismiss both the inner dialog and its containing preview.
  window.addEventListener('keydown',event=>{if(document.querySelector('dialog[open]'))nestedDialogEvents.add(event);},true);
  window.addEventListener('keydown',event=>{
    if(nestedDialogEvents.has(event)||event.key!=='Escape'||event.isTrusted!==true||event.defaultPrevented||event.isComposing||event.keyCode===229||event.repeat||composing||!binding||document.querySelector('dialog[open]'))return;
    const captured=binding;
    window.setTimeout(()=>{if(!same(captured)||event.defaultPrevented||composing)return;window.parent.postMessage({type:'html-preview-dismiss',reason:'escape',...captured},'*');},0);
  });
}
export function outerPreviewEscapeBridge(bootToken){
  const inner=document.querySelector('iframe');let binding=null,innerNonce='',ready=false;
  const init=()=>{ready=false;if(!binding)return;innerNonce=crypto.randomUUID();inner.contentWindow.postMessage({type:'html-preview-inner-init',bootToken,...binding,innerNonce},'*');};
  inner.addEventListener('load',init);
  window.addEventListener('message',event=>{
    const data=event.data;if(!data||typeof data!=='object')return;
    if(event.source===window.parent){if(data.type!=='html-preview-init'||data.bootToken!==bootToken||typeof data.nonce!=='string'||!Number.isSafeInteger(data.generation))return;binding={nonce:data.nonce,generation:data.generation};init();return;}
    if(event.source!==inner.contentWindow||!binding||data.nonce!==binding.nonce||data.generation!==binding.generation||data.innerNonce!==innerNonce)return;
    if(data.type==='html-preview-inner-ready'){ready=true;window.parent.postMessage({type:'html-preview-ready',...binding},'*');}
    else if(data.type==='html-preview-dismiss'&&data.reason==='escape'&&ready&&document.activeElement===inner)window.parent.postMessage({type:'html-preview-dismiss',reason:'escape',...binding},'*');
  });
}
export function htmlPreviewDocument(html,title,bootToken){
  if(typeof bootToken!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(bootToken))throw Error('HTML 预览握手标识无效');
  // Keep an initial doctype first: prepending a script would put standards-mode
  // works into quirks mode and shift their layout.
  const source=String(html),doctype=source.match(/^\s*<!doctype[^>]*>/i)?.[0]||'';
  const inner=doctype+'<script>('+innerPreviewEscapeBridge.toString()+')('+JSON.stringify(bootToken)+');</script>'+source.slice(doctype.length);
  const wrapper=offlineHtmlWrapper(inner,title),relay='<script>('+outerPreviewEscapeBridge.toString()+')('+JSON.stringify(bootToken)+');</script>';
  // Only the host-generated wrapper has this literal suffix; embedded user HTML
  // is attribute-escaped by offlineHtmlWrapper and cannot choose the insertion.
  return wrapper.slice(0,-'</body></html>'.length)+relay+'</body></html>';
}
