import {availableApps} from '../agent-manager/registry.mjs';
import {referenceIcons as icons} from './reference-icons.mjs';
import {libraryFolders,libraryScope,nodeOptions} from './reference-data.mjs';
const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export function createReferencePicker({anchor,getData,onPick,onCancel}){
 const root=el('div','agent-reference-picker');root.role='tooltip';root.ariaLabel='添加参考';root.dataset.mentionPanel='';const abort=new AbortController();let scope=null,folder=null,expanded=new Set(),active=0,rows=[],closed=false;
 const searchWrap=el('div','agent-reference-search-wrap'),search=el('input','agent-reference-search');search.ariaLabel=search.placeholder='搜索';search.autocomplete='off';search.spellcheck=false;searchWrap.innerHTML=icons.search;searchWrap.append(search);const scroll=el('div','agent-reference-list');root.append(searchWrap,scroll);
 function position(){const r=anchor.getBoundingClientRect();root.style.left=Math.max(12,Math.min(innerWidth-root.offsetWidth-12,r.left))+'px';root.style.top=Math.max(12,Math.min(innerHeight-root.offsetHeight-12,r.top-root.offsetHeight-12))+'px';}
 function destroy(){if(closed)return;closed=true;abort.abort();root.inert=true;root.style.pointerEvents='none';root.removeAttribute('role');root.setAttribute('aria-hidden','true');const animation=root.animate([{opacity:1},{opacity:0}],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300,fill:'forwards'});animation.finished.finally(()=>root.remove());}
 function cancel(focus=true){destroy();onCancel(focus);}
 function select(item){destroy();onPick(item);}
 function mark(index){active=Math.max(0,Math.min(index,rows.length-1));rows.forEach((row,i)=>{row.classList.toggle('selected',i===active);row.setAttribute('aria-selected',String(i===active));});search.setAttribute('aria-activedescendant',rows[active]?.id||'');}
 function row(label,action,{icon,preview,number,type,kind=''}={}){const button=el('button','agent-reference-row');button.type='button';button.ariaLabel=label;button.tabIndex=-1;button.id='agent-reference-row-'+rows.length;button.dataset.selectableIndex=rows.length;
  const thumb=el('span','agent-reference-thumb '+kind);if(preview){const image=el('img');image.alt='';Promise.resolve(window.LocalAssets?.url(preview)||preview).then(url=>{if(!closed)image.src=url;}).catch(()=>{});thumb.append(image);}else thumb.innerHTML=icon||icons[type]||icons.folder;
  button.append(thumb,el('span','agent-reference-label',label));if(number)button.append(el('span','agent-reference-number','#'+number));if(type){const t=el('span','agent-reference-type');t.innerHTML=icons[type+'Type']||icons[type]||icons.folder;button.append(t);}
  const index=rows.length;rows.push(button);button.onclick=action;button.onpointerenter=()=>mark(index);return button;
 }
 function section(title,items,key,render,numbered=false){if(!items.length&&key!=='apps')return;const group=el('section','agent-reference-group'),heading=el('div','agent-reference-heading');heading.append(el('p','',title));if(numbered)heading.append(el('span','','输入序号快选'));group.append(heading);for(const item of (expanded.has(key)||search.value?items:items.slice(0,3)))group.append(render(item));if(!expanded.has(key)&&!search.value&&items.length>3){const more=row('还有 '+(items.length-3)+' 个结果',()=>{expanded.add(key);renderList();},{icon:''});more.classList.add('agent-reference-more');group.append(more);}scroll.append(group);}
 function renderList(){const data=getData(),query=search.value.trim(),numeric=/^#?\d+$/.test(query);rows=[];scroll.replaceChildren();
  if(folder!==null){const path=el('div','agent-reference-path'),back=el('button');back.ariaLabel='返回: '+folder;back.innerHTML=icons.back;back.onclick=()=>{folder=scope=null;search.value='';renderList();};path.append(back,el('span','',folder));const use=el('button','','Reference folder');use.onclick=()=>select({kind:'folder',id:folder,scope,label:(scope==='team'?'team':'private')+':/'+folder});path.append(use);scroll.append(path);
   const items=data.library.filter(item=>libraryScope(item)===scope&&item.folder===folder&&item.name.toLowerCase().includes(query.toLowerCase()));for(const item of items)scroll.append(row(item.name,()=>select({kind:'library',id:item.id,scope,label:item.name,mediaType:item.type}),{preview:item.image,type:item.type}));if(!items.length)scroll.append(el('p','agent-reference-empty','暂无结果'));
  }else{
   section('添加参考',nodeOptions(data.nodes,query),'nodes',item=>row(item.label,()=>select(item),{number:item.number,type:item.mediaType,preview:item.image,kind:item.mediaType}),true);
   section('应用',availableApps().filter(app=>numeric||[app.menuLabel,app.label].some(name=>name.toLowerCase().includes(query.toLowerCase()))),'apps',item=>row(item.menuLabel,()=>select(item),{preview:item.icon,kind:'app'}));
   for(const key of ['personal','team']){const folders=[...new Set([...(key==='personal'?['收藏']:[]),...libraryFolders,...(data.folders||[]),...data.library.filter(i=>libraryScope(i)===key).map(i=>i.folder)])].filter(Boolean).filter(name=>!query||name.toLowerCase().includes(query.toLowerCase()));section(key==='personal'?'个人素材库':'团队素材库',folders,key,name=>row(name,()=>{scope=key;folder=name;search.value='';renderList();},{icon:icons.folder}));}
  }mark(0);scroll.scrollTop=0;position();fade();
 }
 function fade(){scroll.dataset.top=String(scroll.scrollTop>1);scroll.dataset.bottom=String(scroll.scrollTop+scroll.clientHeight<scroll.scrollHeight-1);}
 search.oninput=renderList;scroll.onscroll=fade;root.onkeydown=event=>{event.stopPropagation();if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();cancel();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!rows.length)return;mark((active+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);rows[active]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'&&event.target===search){event.preventDefault();rows[active]?.click();}else if(event.key==='Tab'){event.preventDefault();cancel();}};
 document.body.append(root);renderList();search.focus();document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))cancel(false);},{capture:true,signal:abort.signal});window.addEventListener('resize',position,{signal:abort.signal});
 return {destroy,cancel};
}
