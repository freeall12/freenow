import {icons} from './icons.mjs';
export function openCanvasPicker({nodes,selected=[],onConfirm,onError,returnFocus}){
  const dialog=document.createElement('dialog');dialog.className='agent-canvas-picker';dialog.ariaLabel='选择画布素材';
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const header=el('header');header.append(el('h2','','选择画布素材'),el('p','','为对话选择参考图、参考视频或其他画布素材。'));
  const search=el('input','agent-picker-search');search.ariaLabel=search.placeholder='搜索';const grid=el('div','agent-picker-grid'),footer=el('footer','agent-picker-footer');
  const available=nodes.filter(n=>['text','image','video','audio','model','studio'].includes(n.type)),ids=new Set(selected.filter(id=>available.some(n=>n.id===id)));
  const cancel=el('button','','取消'),confirm=el('button'),close=el('button','agent-picker-close');close.innerHTML=icons.close;close.ariaLabel='关闭';cancel.onclick=close.onclick=()=>dialog.close();
  confirm.onclick=()=>{try{onConfirm([...ids]);dialog.close();}catch(error){onError(error.message);}};
  const sync=()=>{confirm.textContent='确认 ('+ids.size+')';confirm.disabled=!ids.size;};
  function render(){grid.replaceChildren();for(const node of available.filter(n=>(n.title||'').toLowerCase().includes(search.value.toLowerCase()))){const tile=el('button','agent-picker-tile');tile.type='button';tile.setAttribute('aria-pressed',String(ids.has(node.id)));const source=node.image||node.video||node.audio;let media;
    if(node.image){media=el('img');media.alt='';media.loading='lazy';media.src=node.image;}else if(node.video){media=el('video');media.preload='metadata';media.muted=true;media.src=node.video;}else media=el('div','agent-picker-type',node.type);
    if(source?.startsWith('asset:')&&media.tagName!=='DIV')window.LocalAssets.url(source).then(url=>{if(dialog.isConnected)media.src=url;}).catch(()=>{});
    const title=el('span','',node.title||node.type);title.title=node.title||node.type;tile.append(media,title);tile.onclick=()=>{ids.has(node.id)?ids.delete(node.id):ids.add(node.id);tile.setAttribute('aria-pressed',String(ids.has(node.id)));sync();};grid.append(tile);
  }if(!grid.children.length)grid.append(el('p','agent-picker-empty','没有匹配的素材'));sync();}
  dialog.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}};
  search.oninput=render;footer.append(cancel,confirm);dialog.append(header,search,grid,footer,close);dialog.onclose=()=>{grid.querySelectorAll('video').forEach(v=>{v.removeAttribute('src');v.load();});dialog.remove();returnFocus?.focus();};document.body.append(dialog);dialog.showModal();render();search.focus();return dialog;
}
