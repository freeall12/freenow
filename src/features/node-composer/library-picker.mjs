import {icons as subjectIcons} from '../subject-library/icons.mjs';
import {musicIcon} from './icons.mjs';
import {referenceIcons as icons} from '../agent-composer/reference-icons.mjs';
import {libraryFolders,libraryScope} from '../agent-composer/reference-data.mjs';
import {libraryAsset,assetReference} from './library-mentions.mjs';
import {referencePreviews} from './reference-preview.mjs';
const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export function createLibraryPicker({anchor,getData,allowed,onPick,onClose}) {
  const root=el('div','agent-reference-picker node-library-picker');root.ariaLabel='引用参考素材';root.role='dialog';root.dataset.mentionPanel='';
  const abort=new AbortController(),expanded=new Set();let path=null,scope=null,active=0,rows=[],previews=null,closed=false;
  const searchWrap=el('div','agent-reference-search-wrap'),search=el('input','agent-reference-search');search.placeholder=search.ariaLabel='搜索';search.autocomplete='off';search.spellcheck=false;searchWrap.innerHTML=icons.search;searchWrap.append(search);const list=el('div','agent-reference-list');root.append(searchWrap,list);
  function position(){const r=anchor();root.style.left=Math.max(8,Math.min(innerWidth-root.offsetWidth-8,r.left))+'px';root.style.top=Math.max(8,r.top-root.offsetHeight-8)+'px';}
  function destroy(){if(closed)return;closed=true;abort.abort();previews?.destroy();root.inert=true;root.removeAttribute('role');root.setAttribute('aria-hidden','true');root.style.pointerEvents='none';const animation=root.animate([{opacity:1},{opacity:0}],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300,fill:'forwards'});animation.finished.then(()=>root.remove(),()=>root.remove());}
  function close(focus=true){if(closed)return;destroy();onClose(focus);}
  function pick(value){if(closed)return;destroy();onPick(value);}
  function mark(index,scroll=false){active=Math.max(0,Math.min(index,rows.length-1));rows.forEach((r,i)=>{r.classList.toggle('selected',i===active);r.setAttribute('aria-selected',String(i===active));});search.setAttribute('aria-activedescendant',rows[active]?.id||'');if(scroll)rows[active]?.scrollIntoView({block:'nearest'});}
  function row(label,action,{item,number,folder,subtitle}={}){
    const button=el('button','agent-reference-row');button.type='button';button.ariaLabel=label;button.tabIndex=-1;if(folder)button.dataset.folder='true';
    const thumb=el('span','agent-reference-thumb '+(item?.type||''));
    if(item?.thumbnail){const image=el('img','');image.alt='';Promise.resolve(window.LocalAssets?.url(item.thumbnail)||item.thumbnail).then(url=>{if(!closed)image.src=url;}).catch(()=>{});thumb.append(image);}else thumb.innerHTML=folder?icons.folder:item?.type==='subject'?subjectIcons.subject:icons[item?.type]||icons[item?.type+'Type']||(item?.type==='audio'?musicIcon:'');
    const labelWrap=el('span','node-library-label');labelWrap.append(el('span','agent-reference-label',label));if(subtitle)labelWrap.append(el('span','node-library-path',subtitle));button.append(thumb,labelWrap);
    if(number)button.append(el('span','agent-reference-number','#'+number));
    if(item){const type=el('span','agent-reference-type');type.innerHTML=icons[item.type+'Type']||icons[item.type]||(item.type==='audio'?musicIcon:'');button.append(type);button.dataset.previewKey=item.key;}
    if(item&&item.type!=='subject'&&!allowed.includes(item.type)){button.disabled=true;button.title='当前模型不支持此素材类型';return button;}
    button.id='node-library-row-'+rows.length;const index=rows.length;rows.push(button);button.onclick=action;button.onpointermove=()=>mark(index);return button;
  }
  function section(title,items,key,render,numbered=false){if(!items.length)return;const group=el('section','agent-reference-group'),head=el('div','agent-reference-heading');head.append(el('p','',title));if(numbered)head.append(el('span','','输入序号快选'));group.append(head);for(const item of expanded.has(key)?items:items.slice(0,3))group.append(render(item));if(!expanded.has(key)&&items.length>3){const more=row('还有 '+(items.length-3)+' 个结果',()=>{expanded.add(key);draw();});more.classList.add('agent-reference-more');group.append(more);}list.append(group);}
  function draw(){previews?.destroy();rows=[];list.replaceChildren();const data=getData(),query=search.value.trim().toLowerCase(),numeric=query.match(/^#?(\d+)$/),previewItems=new Map();
    const assets=data.library.map(libraryAsset).filter(Boolean).map(asset=>({asset,...assetReference(asset),folder:data.library.find(item=>item.id===asset.id&&libraryScope(item)===(asset.scope||'personal'))?.folder||'Others'}));
    const assetRow=(item,showPath=false)=>{previewItems.set(item.key,item);return row(item.title,()=>pick({asset:item.asset}),{item,subtitle:showPath?item.folder:undefined});};
    if(path!==null){const heading=el('div','agent-reference-path'),back=el('button','');back.type='button';back.ariaLabel='返回: '+path;back.innerHTML=icons.back;const backIndex=rows.length;back.id='node-library-row-'+backIndex;rows.push(back);back.onclick=backFolder;heading.append(back,el('span','',path));list.append(heading);
      const folders=folderNames(data,scope).filter(name=>name.startsWith(path+'/')&&!name.slice(path.length+1).includes('/'));
      for(const name of folders.filter(name=>!query||name.toLowerCase().includes(query)))list.append(row(name.slice(path.length+1),()=>openFolder(scope,name),{folder:true}));
      for(const item of assets.filter(item=>item.asset.scope===scope&&item.folder===path&&(!query||item.title.toLowerCase().includes(query))))list.append(assetRow(item));
      if(list.children.length===1)list.append(el('p','agent-reference-empty','暂无结果'));
    }else{
      const linked=data.linked.map((item,index)=>({...item,number:index+1})).filter(item=>numeric?item.number===Number(numeric[1]):item.title.toLowerCase().includes(query));
      section('已连接节点',linked,'linked',item=>{previewItems.set(item.key,item);return row(item.title,()=>pick({linked:item}),{item,number:item.number});},true);
      for(const target of ['personal','team']){
        const title=target==='personal'?'个人素材库':'团队素材库';
        section(target==='personal'?'个人主体库':'团队主体库',(data.subjects||[]).filter(s=>s.scope===target&&(!query||s.name.toLowerCase().includes(query))),target+'subjects',s=>row(s.name,()=>pick({subject:s}),{item:{type:'subject',key:'subject:'+s.id,thumbnail:s.assets?.find(a=>a.image||a.type==='image')?.image||s.assets?.find(a=>a.type==='image')?.url}}));
        if(query&&!numeric)section(title,assets.filter(item=>item.asset.scope===target&&(item.title.toLowerCase().includes(query)||item.folder.toLowerCase().includes(query))),target, item=>assetRow(item,true));
        else section(title,folderNames(data,target).filter(name=>!name.includes('/')),target,name=>row(name,()=>openFolder(target,name),{folder:true}));
      }
      if(!list.children.length)list.append(el('p','agent-reference-empty','暂无结果'));
    }
    previews=referencePreviews(list,[],{selector:'[data-preview-key]',resolve:chip=>previewItems.get(chip.dataset.previewKey),enterDelay:300});mark(0);list.scrollTop=0;position();fade();
  }
  function folderNames(data,target){const explicit=(data.folders||[]).map(folder=>typeof folder==='string'?{scope:'personal',name:folder}:folder);return [...new Set([...(target==='personal'?['收藏',...libraryFolders]:[]),...explicit.filter(folder=>folder.scope===target).map(folder=>folder.name),...data.library.filter(item=>libraryScope(item)===target).flatMap(item=>{const parts=(item.folder||'Others').split('/');return parts.map((_,i)=>parts.slice(0,i+1).join('/'));})])].filter(Boolean);}
  function openFolder(target,name){scope=target;path=name;search.value='';draw();search.focus();}
  function backFolder(){path=path?.includes('/')?path.slice(0,path.lastIndexOf('/')):null;if(path===null)scope=null;search.value='';draw();search.focus();}
  function fade(){list.dataset.top=String(list.scrollTop>1);list.dataset.bottom=String(list.scrollTop+list.clientHeight<list.scrollHeight-1);}
  search.oninput=()=>{expanded.clear();draw();};list.onscroll=fade;
  root.onkeydown=event=>{event.stopPropagation();previews?.dismissEscape(event);if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'||event.key==='ArrowLeft'&&search.selectionStart===0){event.preventDefault();if(path!==null)backFolder();else close();}
    else if(['ArrowUp','ArrowDown','Tab'].includes(event.key)){event.preventDefault();if(rows.length)mark((active+((event.key==='ArrowUp'||event.key==='Tab'&&event.shiftKey)?-1:1)+rows.length)%rows.length,true);}
    else if(event.key==='Enter'){event.preventDefault();(event.target.closest('button')||rows[active])?.click();}
    else if(event.key==='ArrowRight'&&search.selectionStart===search.value.length&&rows[active]?.dataset.folder==='true'){event.preventDefault();rows[active].click();}
  };
  const contains=target=>root.contains(target)||!!previews?.contains(target);
  const outside=event=>{if(!contains(event.target))close(false);};
  document.body.append(root);draw();search.focus();document.addEventListener('pointerdown',outside,{capture:true,signal:abort.signal});document.addEventListener('focusin',outside,{signal:abort.signal});window.addEventListener('pagehide',()=>close(false),{signal:abort.signal});window.addEventListener('resize',position,{signal:abort.signal});
  return {destroy,close,root,contains};
}
