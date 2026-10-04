(() => {
 'use strict';
 const app=window.CanvasApp,$=s=>document.querySelector(s),icons=window.CANVAS_COMMAND_ICONS;
 const entries=[['text','文本','脚本、广告词、品牌文案'],['image','图片','宣传图、海报、封面'],['video','视频','宣传视频、动画、电影'],['audio','音频','音乐、配音、音效'],['world','3D','生成3D场景与对象'],['playlist','剪辑时间线','时间轴串联多段素材'],['studio','3D 片场','布置场景、角色与镜头调度'],['imageEditor','图片编辑器','编辑和处理图片']];
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const localImageReady=import('./src/features/local-resource-migration/display-image.mjs');
 let palette=null,returnTo=null;
 function close(restore=false){palette?.remove();palette=null;$('#add').setAttribute('aria-expanded','false');if(restore)returnTo?.focus({preventScroll:true});}
 function center(){const r=$('#canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}
 async function create(type,point){if(type==='upload')return upload(point);if(type==='world')return window.WorldNode?.create(point);if(type==='playlist')return window.CanvasPlaylist.create(point);if(type==='imageEditor')return window.CanvasImageEditor?.create(point);const scale=app.getState().view.scale,height=type==='text'?200:type==='audio'?300:250;return app.addNode(type,{x:point.x,y:point.y-height*scale/2},null,type==='studio'?'3D 片场':null);}
 function open(x,y,mode='all',point=center()){
  close();window.CanvasMenus.close();returnTo=document.activeElement;palette=el('div','canvas-command-menu'+(mode==='dock'?' command-dock':''));palette.setAttribute('role','listbox');palette.setAttribute('aria-label',mode==='tools'?'辅助工具':'添加节点');palette.tabIndex=-1;
  const groups=['all','dock'].includes(mode)?[['添加节点',entries.slice(0,5)],['辅助工具',entries.slice(5)]]:mode==='tools'?[['辅助工具',entries.slice(5)]]:[['添加节点',entries.slice(0,5)]];
  if(mode==='dock')groups.push(['添加资源',[['upload','上传','支持图片、视频、音频和 3D 资产']]]);
  for(const [title,items]of groups){palette.append(el('div','command-heading',title));for(const [type,label,description]of items){const b=el('button','command-option');b.type='button';b.dataset.nodeType=type;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.disabled=type==='world'&&!window.WorldNode||type==='imageEditor'&&!window.CanvasImageEditor;b.setAttribute('aria-disabled',String(b.disabled));if(type==='imageEditor'&&b.disabled)b.title='独立图片编辑器正在还原';const icon=el('span','command-icon');icon.innerHTML=icons[type];const copy=el('span','command-copy'),name=el('span','command-label',label);if(type==='playlist')name.append(el('small','command-beta','Beta'));copy.append(name,el('span','command-description',description));b.append(icon,copy);const select=()=>{if(b.disabled)return;palette?.querySelectorAll('[role=option]').forEach(v=>v.setAttribute('aria-selected',String(v===b)));};b.onpointerenter=select;b.onfocus=select;b.onclick=async()=>{close();try{await create(type,point);}catch(e){app.notify(e.message);}};palette.append(b);}palette.lastElementChild.classList.add('command-group-last');}
  document.body.append(palette);palette.style.maxHeight=(innerHeight-24)+'px';palette.style.left=Math.max(12,Math.min(innerWidth-palette.offsetWidth-12,x))+'px';palette.style.top=Math.max(12,Math.min(innerHeight-palette.offsetHeight-12,y))+'px';palette.querySelector('button:not(:disabled)')?.focus({preventScroll:true});$('#add').setAttribute('aria-expanded','true');
 }
 function keyboard(e){if(!palette||e.defaultPrevented||e.isComposing)return;const target=e.composedPath?.()[0]||e.target||document.activeElement;if(!palette.contains(target))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);return;}if(e.key==='Tab'){close();return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();const rows=[...palette.querySelectorAll('button:not(:disabled)')],index=rows.indexOf(palette.querySelector('[aria-selected=true]')),next=e.key==='Home'?0:e.key==='End'?rows.length-1:(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;rows[next]?.focus({preventScroll:true});rows[next]?.scrollIntoView({block:'nearest'});}
 async function importFiles(files,point=center()){const view={...app.getState().view};let at={x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};for(const file of files){try{if(/\.glb$/i.test(file.name)){if(!window.WorldNode)throw Error('3D 节点正在加载');const patch=await (await import('./src/features/world-node/resource.mjs')).importFile(file),draft=window.WorldNode.draft();app.addNode('world',point,null,file.name,{...draft,...patch,title:file.name,x:at.x,y:at.y-draft.height/2});}else{const type=file.type.split('/')[0];if(!['image','video','audio'].includes(type))throw Error('不支持的素材类型');const url=await window.LocalMedia.asDataUrl(file),patch=type==='video'?{video:url}:type==='audio'?{audio:url,audioMode:'upload'}:{};app.addNode(type,point,type==='image'?url:null,file.name,{...patch,x:at.x,y:at.y});}at={x:at.x+40/view.scale,y:at.y+40/view.scale};}catch(e){app.notify(e.message);}}}
 async function upload(point){const input=el('input');input.type='file';input.accept='image/*,video/*,audio/*,.glb';input.multiple=true;input.onchange=()=>importFiles(input.files,point);input.click();}
 function assets(point){
  const d=el('dialog','command-assets');d.setAttribute('aria-label','添加资产');
  const head=el('header'),title=el('h2',null,'添加资产'),exit=el('button');exit.setAttribute('aria-label','关闭');exit.innerHTML=window.UI_ICONS.close;exit.onclick=()=>d.close();head.append(title,exit);d.append(head);
  const search=el('input');search.type='search';search.placeholder='搜索素材';search.setAttribute('aria-label','搜索素材');const grid=el('div','command-assets-grid');d.append(search,grid);
  let ready=!window.CanvasLibrary?.ready,error=null;let revision=0;const bindings=new Set(),disposeImages=()=>{revision++;for(const binding of bindings)binding.dispose();bindings.clear();};
  const render=()=>{
   disposeImages();grid.replaceChildren();const version=revision;if(!ready){grid.append(el('p',null,error?'素材库读取失败：'+error.message:'正在读取素材库…'));return;}
   for(const a of window.CanvasLibrary.items.filter(a=>a.name.toLowerCase().includes(search.value.toLowerCase()))){
    const b=el('button');b.setAttribute('aria-label',a.name);
    if(a.image||a.fullImage){
     const img=el('img');img.alt='';b.append(img);
     // Resolve persistent references through the existing local display gate.
     // Search/close invalidates both pending resolutions and installed handlers.
     const isCurrent=()=>version===revision&&d.isConnected&&img.isConnected;
     localImageReady.then(({bindLocalImage})=>{if(isCurrent())bindings.add(bindLocalImage(img,{source:a.image||a.fullImage,fallback:a.fullImage,isCurrent}));}).catch(error=>{if(isCurrent())img.title=error.message;});
    }else{const icon=el('span','command-asset-icon');icon.innerHTML=icons[a.type]||icons.image;b.append(icon);}
    b.append(el('span',null,a.name));b.onclick=()=>{app.insertAsset(a,point);d.close();};grid.append(b);
   }
   if(!grid.children.length)grid.append(el('p',null,'暂无素材，请先将节点保存到素材库'));
  };
  search.oninput=render;render();d.onclose=()=>{disposeImages();d.remove();};document.body.append(d);d.showModal();if(window.CanvasLibrary?.ready)window.CanvasLibrary.ready().then(()=>{ready=true;if(d.isConnected)render();}).catch(cause=>{error=cause;if(d.isConnected)render();});
 }

 function context(x,y,history){close();const point={x,y};window.CanvasMenus.show(x,y,[{label:'上传',run:()=>upload(point)},{label:'添加资产',run:()=>assets(point)},null,{label:'添加节点',run:()=>open(x,y,'nodes',point)},{label:'添加辅助工具',run:()=>open(x,y,'tools',point)},null,{label:'撤销',key:'⌘Z',run:history.undo?()=>app.undo():null},{label:'重做',key:'⇧⌘Z',run:history.redo?()=>app.undo(true):null},null,{label:'粘贴',key:'⌘V',run:window.CanvasMenus.hasCopy?()=>window.CanvasMenus.paste(point):null}]);}
 document.addEventListener('focusin',e=>{if(palette&&!palette.contains(e.target)&&!e.target.closest('#add'))close();});document.addEventListener('keydown',keyboard,true);document.addEventListener('pointerdown',e=>{if(!e.target.closest('.canvas-command-menu,#add'))close();});$('#canvas').addEventListener('dblclick',e=>{if(e.target.closest('.node'))return;open(e.clientX,e.clientY,'all',{x:e.clientX,y:e.clientY});});$('#canvas').addEventListener('wheel',close,{passive:true});window.addEventListener('resize',()=>close());
 $('#canvas').addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
 $('#canvas').addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;event.preventDefault();event.stopPropagation();importFiles(files,{x:event.clientX,y:event.clientY});});
 window.CanvasCommands={open,close,context,create,upload,importFiles,assets};
})();
