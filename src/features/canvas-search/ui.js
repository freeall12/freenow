(() => {
 'use strict';
 const app=window.CanvasApp,core=window.CanvasSearch,icons=window.CANVAS_SEARCH_ICONS,dialog=document.querySelector('#search-dialog');
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 dialog.replaceChildren();dialog.setAttribute('aria-labelledby','node-search-title');dialog.setAttribute('aria-describedby','node-search-description');
 const title=el('h2','visually-hidden','节点搜索');title.id='node-search-title';const description=el('p','visually-hidden','按标题、Prompt 或文本搜索画布节点。');description.id='node-search-description';
 const head=el('div','node-search-head'),glyph=el('span','node-search-glyph');glyph.innerHTML=icons.search;const input=el('input');input.id='search-input';input.placeholder='搜索节点...';input.setAttribute('aria-label','搜索节点...');input.autocomplete='off';
 const clear=el('button','node-search-clear');clear.innerHTML=window.UI_ICONS.close;clear.setAttribute('aria-label','清除');head.append(glyph,input,clear);
 const filters=el('div','node-search-filters'),list=el('div');list.id='search-results';list.dataset.testid='node-search-results-list';dialog.append(title,description,head,filters,list);
 let filter='all',active=0,results=[],documents=[],composing=false,resultButtons=[],highlighted=null;
 const filterButtons=[];for(const [type,label]of [['all','全部'],['image','图片'],['video','视频'],['text','文本'],['audio','音频'],['world','World'],['group','分组']]){const b=el('button');b.dataset.filter=type;b.innerHTML=icons[label];b.append(el('span','',label));b.onclick=()=>{filter=type;active=0;render();};filterButtons.push(b);filters.append(b);}
 function configs(){let drafts={};try{drafts=JSON.parse(localStorage.getItem(window.CanvasProjects?.storageKey('tapnow-node-settings')||'tapnow-node-settings')||'{}');}catch{}return {...window.EDITOR_DATA?.nodes,...drafts};}
 function highlight(scroll=false){
  const button=resultButtons[active];
  // Pointer moves within the same row are frequent; retain controls and touch
  // only the old/new highlight. Keyboard repeats still check scroll bounds.
  if(button!==highlighted){highlighted?.classList.remove('chosen');button?.classList.add('chosen');highlighted=button;}
  if(button&&scroll){const top=button.offsetTop-list.offsetTop,bottom=top+button.offsetHeight;if(top<list.scrollTop+8)list.scrollTop=Math.max(0,top-8);else if(bottom>list.scrollTop+list.clientHeight-8)list.scrollTop=bottom-list.clientHeight+8;}
 }
 function choose(index){const result=results[index];if(!result)return;dialog.close();app.focusNode(result.document.node.id);}
 function render(){clear.hidden=!input.value;filterButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));results=core.query(documents,input.value,filter);active=Math.min(active,Math.max(0,results.length-1));resultButtons=[];highlighted=null;list.replaceChildren();list.scrollTop=0;
  if(!results.length){list.append(el('div','node-search-empty',input.value?'未找到匹配节点':'暂无可搜索节点'));return;}
  results.forEach((result,i)=>{const {node,title,entries}=result.document,b=el('button','search-item'),thumb=el('span','node-search-thumbnail');b.dataset.nodeId=node.id;const icon=core.category(node)==='world'?(node.type==='studio'?icons.studio:icons.World):icons[{image:'图片',video:'视频',text:'文本',audio:'音频',group:'分组'}[node.type]]||icons.图片;thumb.innerHTML=icon;
   if(node.image&&node.type!=='studio'){const image=el('img');image.alt='';image.loading='lazy';image.src=node.image;image.onerror=()=>{thumb.innerHTML=icon;};thumb.replaceChildren(image);}
   const text=el('span','node-search-copy');text.append(el('span','node-search-title',title));if(node.type!=='group')text.append(el('span','node-search-preview',entries.find(e=>e.field==='prompt')?.value||'无 Prompt'));b.append(thumb,text);b.onclick=()=>choose(i);b.onpointermove=()=>{if(active===i)return;active=i;highlight();};resultButtons.push(b);list.append(b);
  });highlight();
 }
 function open(){if(dialog.open){input.focus();return;}documents=core.index(app.getState().nodes,configs());input.value='';filter='all';active=0;render();dialog.showModal();input.focus();}
 input.oninput=()=>{active=0;render();};clear.onclick=()=>{input.value='';active=0;render();input.focus();};
 dialog.addEventListener('compositionstart',()=>{composing=true;});dialog.addEventListener('compositionend',()=>{composing=false;});dialog.addEventListener('close',()=>{composing=false;});
 dialog.addEventListener('keydown',event=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229||composing||!dialog.contains(event.target)||event.target.closest('dialog')!==dialog)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(input.value){input.value='';active=0;render();}else dialog.close();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();active=Math.max(0,Math.min(results.length-1,active+(event.key==='ArrowDown'?1:-1)));highlight(true);}else if(event.key==='Enter'&&event.target===input){event.preventDefault();event.stopPropagation();choose(active);}});
 dialog.addEventListener('cancel',event=>{if(event.defaultPrevented)return;event.preventDefault();if(composing)return;if(input.value){input.value='';active=0;render();}else dialog.close();});
 window.CanvasSearchUI={open};document.querySelector('#search').onclick=open;
})();
