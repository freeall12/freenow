(() => {
  'use strict';
  const projects=window.CanvasProjects,title=document.querySelector('#project-title');
  const make=(tag,className,text)=>{const element=document.createElement(tag);element.className=className||'';if(text!==undefined)element.textContent=text;return element;};
  const displayRef=value=>window.CanvasResourceDisplay?.displayMediaRef(value)??(typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:'');
  const panel=make('section','canvas-project-switcher');panel.id='canvas-project-switcher';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','切换画布');
  const searchShell=make('label','canvas-project-search'),search=make('input');search.type='search';search.placeholder='搜索画布';search.setAttribute('aria-label','搜索画布');searchShell.innerHTML=window.CANVAS_PROJECT_ICONS.search;searchShell.append(search);
  const list=make('div','canvas-project-list');list.setAttribute('role','tree');list.setAttribute('aria-label','本地画布');
  const status=make('p','canvas-project-status');status.setAttribute('role','status');status.hidden=true;
  const footer=make('footer','canvas-project-footer'),create=make('button','canvas-project-create');create.innerHTML=window.CANVAS_PROJECT_ICONS.plus;create.append(make('span','','新建画布'));create.type='button';create.onclick=()=>openNameDialog('create');footer.append(create);
  panel.append(searchShell,list,status,footer);document.body.append(panel);
  let records=[],loadRevision=0,busy=false,rows=[];
  panel.tabIndex=-1;
  function setStatus(message){status.textContent=message||'';status.hidden=!message;}
  function close({restoreFocus=true}={}){panel.hidden=true;loadRevision++;title.setAttribute('aria-expanded','false');if(restoreFocus)title.focus({preventScroll:true});}
  function position(){const rect=title.closest('.project-bar').getBoundingClientRect();panel.style.left=Math.max(8,Math.min(rect.left,innerWidth-308))+'px';panel.style.top=Math.min(rect.bottom+6,innerHeight-160)+'px';}
  function focusRow(index){if(!rows.length)return;index=Math.max(0,Math.min(rows.length-1,index));rows.forEach((row,i)=>row.tabIndex=i===index?0:-1);rows[index].focus();}
  function render(){
    create.disabled=busy;
    list.replaceChildren();rows=[];
    const query=search.value.trim().toLocaleLowerCase(),filtered=records.filter(project=>project.title.toLocaleLowerCase().includes(query));
    if(!filtered.length){list.append(make('p','canvas-project-empty',query?'没有匹配的画布':'暂无本地画布'));return;}
    for(const project of filtered){
      const row=make('button','canvas-project-row');row.type='button';row.dataset.projectId=project.id;row.setAttribute('role','treeitem');row.setAttribute('aria-level','1');row.tabIndex=-1;row.disabled=busy;
      const thumbnail=make('span','canvas-project-thumbnail');thumbnail.setAttribute('aria-hidden','true');
      const thumbnailRef=displayRef(project.thumbnail);if(project.thumbnailPendingImport||project.thumbnail&&!thumbnailRef){row.title='原站媒体待导入本地；旧引用已保留';row.setAttribute('aria-description','原站媒体待导入本地');}
      if(thumbnailRef){const image=make('img');image.alt='';image.loading='lazy';image.onerror=()=>{image.onerror=null;image.src='assets/canvas-empty-project-official.svg';thumbnail.classList.add('is-placeholder');};thumbnail.append(image);if(thumbnailRef.startsWith('asset:')){image.src='assets/canvas-empty-project-official.svg';window.LocalAssets?.url(thumbnailRef).then(url=>{const local=displayRef(url);if(image.isConnected&&local)image.src=local;else{thumbnail.classList.add('is-placeholder');if(!local){row.title='原站媒体待导入本地；旧引用已保留';row.setAttribute('aria-description','原站媒体待导入本地');}}}).catch(()=>thumbnail.classList.add('is-placeholder'));}else image.src=thumbnailRef;}else{thumbnail.classList.add('is-placeholder');const image=make('img');image.alt='';image.src='assets/canvas-empty-project-official.svg';thumbnail.append(image);}
      row.append(thumbnail,make('span','canvas-project-name',project.title));
      if(project.id===projects.id()){row.classList.add('is-selected');row.setAttribute('aria-current','page');const check=make('span','canvas-project-check');check.innerHTML=window.CANVAS_PROJECT_ICONS.check;row.append(check);row.tabIndex=0;}
      row.onclick=async()=>{if(busy)return;if(project.id===projects.id()){close();return;}busy=true;render();panel.focus({preventScroll:true});setStatus('正在保存并切换画布…');try{await projects.switchTo(project.id);}catch(error){setStatus(error.message);}finally{busy=false;const restoreFocus=!panel.hidden&&document.activeElement===panel;render();if(restoreFocus)rows.find(item=>item.dataset.projectId===project.id)?.focus({preventScroll:true});}};
      row.onkeydown=event=>{const index=rows.indexOf(row);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();focusRow(event.key==='Home'?0:event.key==='End'?rows.length-1:index+(event.key==='ArrowDown'?1:-1));}};
      rows.push(row);list.append(row);
    }
    if(rows.every(row=>row.tabIndex<0))rows[0].tabIndex=0;
  }
  async function open(){
    if(!panel.hidden){close();return;}panel.hidden=false;title.setAttribute('aria-expanded','true');position();search.value='';list.replaceChildren();setStatus('正在读取本地画布…');search.focus();
    const revision=++loadRevision;
    try{const result=await window.CanvasStore.listProjects();if(revision!==loadRevision)return;records=result;const current=records.find(project=>project.id===projects.id());if(current)current.title=projects.current().title;setStatus('');render();}
    catch(error){if(revision!==loadRevision)return;setStatus('画布列表读取失败：'+error.message);const retry=make('button','canvas-project-retry','重试');retry.onclick=()=>{close({restoreFocus:false});open();};list.append(retry);}
  }
  search.oninput=render;
  search.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();focusRow(0);}};
  panel.addEventListener('keydown',event=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
  document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!title.contains(event.target))close({restoreFocus:false});});
  document.addEventListener('focusin',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!title.contains(event.target))close({restoreFocus:false});});
  window.addEventListener('resize',()=>{if(!panel.hidden)position();});
  function openNameDialog(mode){
    if(busy)return;
    close({restoreFocus:false});if(document.querySelector('#canvas-project-name-dialog'))return;
    const dialog=make('dialog','canvas-project-name-dialog');dialog.id='canvas-project-name-dialog';dialog.setAttribute('aria-labelledby','canvas-project-name-heading');
    const heading=make('h2','',mode==='create'?'新建画布':'重命名画布');heading.id='canvas-project-name-heading';
    const form=make('form'),label=make('label','canvas-project-name-label','画布名称'),input=make('input');input.name='projectName';input.required=true;input.maxLength=120;input.value=mode==='create'?'未命名画布':projects.current().title;input.setAttribute('aria-label','画布名称');label.append(input);
    const explanation=make('p','canvas-project-explanation',mode==='create'?'创建一个空白画布，独立保存到此浏览器。':'名称随画布一起保存到此浏览器。');
    const error=make('p','canvas-project-name-error');error.setAttribute('role','alert');error.hidden=true;
    const actions=make('div','canvas-project-name-actions'),cancel=make('button','','取消'),submit=make('button','is-primary',mode==='create'?'创建画布':'保存名称');cancel.type='button';submit.type='submit';actions.append(cancel,submit);
    let working=false,prepared=null;
    cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});dialog.addEventListener('close',()=>{dialog.remove();title.focus({preventScroll:true});});
    form.onsubmit=async event=>{
      event.preventDefault();if(working)return;working=true;submit.disabled=cancel.disabled=true;input.disabled=true;error.hidden=true;submit.textContent=mode==='create'?'正在创建…':'正在保存…';
      try{if(mode==='create'){prepared ||= await projects.create(input.value);await projects.switchTo(prepared.id);}else{await projects.rename(input.value);dialog.close();}}
      catch(failure){error.textContent=(prepared?'画布已创建，仍保留在项目列表。':'')+failure.message;error.hidden=false;}
      finally{working=false;submit.disabled=cancel.disabled=false;input.disabled=!!prepared;submit.textContent=prepared?'打开画布':mode==='create'?'创建画布':'保存名称';}
    };
    form.append(label,explanation,error,actions);dialog.append(heading,form);document.body.append(dialog);dialog.showModal();input.focus();input.select();
  }
  window.CanvasProjectsUI={open,close,create:()=>openNameDialog('create'),rename:()=>openNameDialog('rename')};
})();
