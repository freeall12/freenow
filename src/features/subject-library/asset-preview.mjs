import {el,button} from './ui.mjs';
import {assetIcons} from './asset-icons.mjs';

import {mediaView} from './preview-media.mjs';

export function assetPreviews(panel) {
  let hover=null,dialog=null,openTimer=0,closeTimer=0;const abort=new AbortController();
  function hide(){clearTimeout(openTimer);clearTimeout(closeTimer);hover?.view.destroy();hover?.element.remove();hover=null;}
  function queueHide(){clearTimeout(openTimer);clearTimeout(closeTimer);closeTimer=setTimeout(hide,150);}
  function show(asset,anchor){
    hide();const element=el('aside','subject-asset-hover'),view=mediaView(asset,{hover:true});element.ariaLabel='素材预览：'+asset.name;
    const footer=el('footer'),icon=el('span');icon.innerHTML=assetIcons[asset.type]||'';footer.append(el('span','',asset.name),icon);element.append(view.element,footer);document.body.append(element);hover={element,view};
    const source=anchor.getBoundingClientRect(),rect=element.getBoundingClientRect();let left=source.right+8;
    if(left+rect.width>innerWidth-8)left=source.left-rect.width-8;
    Object.assign(element.style,{left:Math.max(8,Math.min(innerWidth-rect.width-8,left))+'px',top:Math.max(8,Math.min(innerHeight-rect.height-8,source.top+(source.height-rect.height)/2))+'px'});
    element.onpointerenter=()=>clearTimeout(closeTimer);element.onpointerleave=queueHide;
  }
  function closeDialog(){if(!dialog)return;const current=dialog;dialog=null;current.view.destroy();current.element.close();current.element.remove();if(current.anchor?.isConnected)current.anchor.focus({preventScroll:true});}
  function open(asset,anchor){
    hide();closeDialog();const element=el('dialog','subject-asset-dialog'),view=mediaView(asset);element.ariaLabel=asset.name;
    const close=button('关闭素材预览',closeDialog,'subject-asset-dialog-close','close');element.append(view.element,close);dialog={element,view,anchor};
    element.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
    element.addEventListener('keydown',event=>event.stopPropagation());
    element.addEventListener('click',event=>{if(event.target!==element)return;const rect=element.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();});
    document.body.append(element);element.showModal();close.focus({preventScroll:true});
  }
  panel.addEventListener('scroll',hide,{capture:true,signal:abort.signal});window.addEventListener('resize',hide,{signal:abort.signal});
  return {open,hide,bind(card,asset){card.onpointerenter=()=>{if(panel.querySelector('[data-sorting]')||dialog)return;clearTimeout(closeTimer);openTimer=setTimeout(()=>show(asset,card),300);};card.onpointerleave=queueHide;},destroy(){hide();closeDialog();abort.abort();}};
}
