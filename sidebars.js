(() => {
  'use strict';
  const app=window.CanvasApp,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const btn=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;window.applyButtonIcon?.(b,text);return b;};
  const iconButton=(label,name,fn,cls='',text=label)=>{const b=btn('',fn,cls),symbol=el('span','resource-icon-button');b.setAttribute('aria-label',label);b.classList.add('resource-icon-button');symbol.setAttribute('aria-hidden','true');symbol.innerHTML=window.UI_ICONS[name]||'';b.append(symbol);if(text)b.append(el('span','',text));return b;};
  const officialMedia=src=>{try{const host=new URL(src,window.location?.href||'http://localhost/').hostname.toLowerCase().replace(/\.$/,'');return ['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'].some(domain=>host===domain||host.endsWith('.'+domain));}catch{return false;}};
  function mediaSource(element,src){if(!src)return;if(officialMedia(src)){element.title='此媒体需迁移或重新导入本地素材';return;}if(src.startsWith('asset:')){const pending=window.LocalAssets?.url?.(src);if(!pending){element.title='本地素材存储尚未就绪';return;}pending.then(url=>{if(!officialMedia(url))element.src=url;}).catch(error=>{element.title=error.message;});}else element.src=src;}
  const img=(src,alt='')=>{const i=el('img');mediaSource(i,src);i.alt=alt;return i;};
  const folders=['角色','场景','道具','风格','音效','Others'];
  let library=[],extraFolders=[],libraryLoaded=false,libraryError=null,hydration=null,libraryRevision=0;
  let libraryWrites=Promise.resolve(),libraryPending=0,libraryUnsaved=false,migrationPending=null,libraryMigration=null,libraryConflict=false,favoriteIntents=0;
  const recordKey='agent-library:personal-v1',store=window.CanvasStore;
  const conflict=()=>Object.assign(Error('另一窗口已修改素材库，当前草稿尚未保存；请先导出草稿并确认本机文件，再刷新读取当前库'),{name:'LibraryConflictError'});
  function validateLibrary(items,folderNames){
    if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||typeof item.id!=='string')||new Set(items.map(item=>item.id)).size!==items.length||!Array.isArray(folderNames)||folderNames.some(name=>typeof name!=='string'))throw Error('素材库数据无效，原记录已保留');
    return {items,folders:folderNames};
  }
  function legacyLibrary(){
    // Never treat an unavailable legacy source as an empty library.
    const raw=localStorage.getItem('tapnow-library'),folderRaw=localStorage.getItem('tapnow-folders');
    return {...validateLibrary(JSON.parse(raw??'[]'),JSON.parse(folderRaw??'[]')),raw,folderRaw};
  }
  function emitLibrary(){
    // UI listeners cannot turn a committed database receipt into a save failure.
    try{document.dispatchEvent(new CustomEvent('library:changed'));}catch(error){console.error('Library UI:',error);}
    try{app.render?.();}catch(error){console.error('Library render:',error);}
  }
  function assertLibraryReady(){if(!libraryLoaded)throw libraryError||Error('素材库正在读取，请稍后重试');}
  function readyLibrary(){
    if(libraryLoaded)return Promise.resolve();if(hydration)return hydration;
    hydration=Promise.resolve().then(async()=>{
      if(typeof store?.readRecord!=='function'||typeof store?.writeRecord!=='function')throw Error('本地素材库数据库尚未就绪，旧记录保持只读');
      const record=await store.readRecord(recordKey);let next;
      if(record==null){
        const source=legacyLibrary();next={items:source.items,folders:source.folders};
        const receipt=await store.writeRecord(recordKey,{version:1,...next},{expectedRevision:0,canCommit:()=>localStorage.getItem('tapnow-library')===source.raw&&localStorage.getItem('tapnow-folders')===source.folderRaw});
        if(!receipt||receipt===false)throw Error('旧素材库迁移未能提交，原记录已保留');libraryRevision=receipt.storageRevision;
      }else{
        if(record.version!==1)throw Error('素材库版本不匹配，原记录已保留');
        next=validateLibrary(record.items,record.folders);libraryRevision=record.storageRevision??0;
      }
      library=structuredClone(next.items);extraFolders=structuredClone(next.folders);libraryLoaded=true;libraryError=null;
    }).catch(error=>{libraryError=error;throw error;}).finally(()=>{hydration=null;emitLibrary();});return hydration;
  }
  async function writeLibrary(items,folderNames,{canCommit}={}){
    validateLibrary(items,folderNames);
    let receipt;try{receipt=await store.writeRecord(recordKey,{version:1,items,folders:folderNames},{expectedRevision:libraryRevision,...(canCommit?{canCommit}:{})});}catch(error){if(error.name==='AgentConversationConflictError')throw conflict();throw error;}
    if(!receipt||receipt===false)throw Error('素材库记录未能提交');libraryRevision=receipt.storageRevision;
  }
  function persistLibrary(){
    assertLibraryReady();if(libraryConflict){const blocked=Promise.reject(conflict());blocked.catch(()=>{});return blocked;}const items=structuredClone(library),folderNames=structuredClone(extraFolders),baseline=JSON.stringify({items,folders:folderNames});libraryUnsaved=true;libraryPending++;
    const pending=libraryWrites.catch(()=>{}).then(async()=>{await writeLibrary(items,folderNames);if(JSON.stringify({items:library,folders:extraFolders})===baseline)libraryUnsaved=false;emitLibrary();});libraryWrites=pending;
    pending.catch(error=>{if(error.name==='LibraryConflictError')libraryConflict=true;app.notify('素材库保存失败：'+error.message);}).finally(()=>{libraryPending--;emitLibrary();});return pending;
  }
  function libraryReport(report){libraryMigration=report;document.dispatchEvent(new CustomEvent('library:changed'));return report;}
  async function migrateLibraryResources(options={}){
    if(migrationPending)return migrationPending;
    migrationPending=(async()=>{
      await readyLibrary();await libraryWrites;if(libraryUnsaved)return libraryReport({status:'local_edits',persisted:false});
      const [{migrateLibrarySnapshot},{loadResourceIndex}]=await Promise.all([import('./src/features/local-resource-migration/snapshot.mjs'),import('./src/features/local-resource-migration/canvas-load.mjs')]);
      const indexState=options.indexState||(options.index?{state:'ready',index:options.index}:await loadResourceIndex());
      if(indexState.state!=='ready')return libraryReport({status:indexState.state,persisted:false});
      const baseline=JSON.stringify(library),folderBaseline=JSON.stringify(extraFolders);
      // Older saved videos contain only their seed node ID. Migrate the actual
      // preview/insert source into the authority record, not just its poster.
      const source=library.map(item=>{const video=item.type==='video'?(item.video||window.EDITOR_DATA?.nodes?.[item.nodeId]?.video):null;return !item.video&&video?{...item,video}:item;});
      const result=await (options.migrate||migrateLibrarySnapshot)(source,{index:indexState.index,...(options.hashSource?{hashSource:options.hashSource}:{})});
      const report={status:result.unresolved.length?'pending_import':'ready',persisted:false,summary:result.summary,diagnostics:result.unresolved.map(({path,code})=>({path,code}))};
      if(JSON.stringify(library)!==baseline||JSON.stringify(extraFolders)!==folderBaseline||libraryUnsaved){report.status='local_edits';return libraryReport(report);}
      if(result.changes.length){
        await writeLibrary(result.snapshot,structuredClone(extraFolders),{canCommit:()=>JSON.stringify(library)===baseline&&JSON.stringify(extraFolders)===folderBaseline&&!libraryUnsaved});
        library=result.snapshot;report.persisted=true;
      }
      return libraryReport(report);
    })().catch(error=>{const conflict=['LibraryConflictError','AgentConversationConflictError','CanvasRecordCommitRejectedError'].includes(error.name);const report=libraryReport({status:conflict?'local_edits':'migration_failed',persisted:false});if(conflict)return report;throw error;}).finally(()=>{migrationPending=null;});return migrationPending;
  }
  window.CanvasProjects?.registerNavigationGuard(()=>favoriteIntents||hydration||migrationPending||libraryPending?'素材库正在保存或迁移，请稍后切换项目':libraryConflict?'素材库版本冲突，请先导出草稿并确认本机文件后再刷新':libraryUnsaved?'素材库修改尚未保存，请保留此页面并重试':null);
  window.addEventListener('beforeunload',event=>{if(libraryUnsaved||favoriteIntents){event.preventDefault();event.returnValue='';}});
  const favoriteMedia=n=>n?.type==='video'?(n.video||window.EDITOR_DATA?.nodes[n.id]?.video):n?.type==='image'?(n.fullImage||n.image):null;
  const favoriteKey=n=>['video','image'].includes(n?.type)?n.type+':'+(n.currentSourceFileId||n.sourceFileId||favoriteMedia(n)):null;
  const favoriteMatches=(asset,n)=>asset.folder==='收藏'&&(['video','image'].includes(n?.type)?asset.mediaKey===favoriteKey(n)||(n.type==='video'?asset.video:asset.fullImage||asset.image)===favoriteMedia(n):asset.nodeId===n?.id);
  function toggleFavorite(n){
    if(!libraryLoaded){const captured=structuredClone(n);favoriteIntents++;const pending=readyLibrary().then(()=>toggleFavorite(captured)).finally(()=>{favoriteIntents--;emitLibrary();});pending.catch(error=>app.notify('收藏尚未保存：'+error.message));return pending;}
    const existing=library.findIndex(a=>favoriteMatches(a,n));if(existing>=0)library.splice(existing,1);else library.push({id:crypto.randomUUID(),name:n.title,image:n.image,type:n.type,folder:'收藏',nodeId:n.id,mediaKey:favoriteKey(n),audio:n.audio,video:n.type==='video'?favoriteMedia(n):null,fullImage:n.type==='image'?favoriteMedia(n):null});persistLibrary();return existing<0;
  }
  async function exportLibraryDraft(){
    assertLibraryReady();const snapshot={format:'freenow-library-draft',version:1,exportedAt:new Date().toISOString(),baseStorageRevision:libraryRevision,items:structuredClone(library),folders:structuredClone(extraFolders),media:{}};
    const references=new Set();function collect(value){if(typeof value==='string'&&/^asset:[A-Za-z0-9_-]+$/.test(value))references.add(value);else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);}collect(snapshot.items);
    for(const ref of references){
      if(typeof window.LocalAssets?.url!=='function')throw Error('本地媒体存储尚未就绪，未导出草稿');
      const url=await window.LocalAssets.url(ref);if(!/^(?:blob:|data:)/.test(url))throw Error('草稿媒体不是本地Blob，未导出');const response=await fetch(url);if(!response.ok)throw Error('草稿媒体读取失败，未导出');const media=await response.blob(),bytes=new Uint8Array(await media.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));snapshot.media[ref]={mime:media.type,bytes:media.size,dataUrl:'data:'+media.type+';base64,'+btoa(binary)};
    }
    return new Blob([JSON.stringify(snapshot)],{type:'application/json'});
  }
  async function downloadLibraryDraft(button){
    button.disabled=true;let url;try{const blob=await exportLibraryDraft();url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download='freenow-library-unsaved-'+Date.now()+'.json';document.body.append(link);link.click();link.remove();app.notify('草稿导出已交给浏览器；确认本机文件已保存后再刷新读取当前库');}catch(error){app.notify('草稿未能导出：'+error.message);}finally{if(url)window.setTimeout(()=>URL.revokeObjectURL(url),60000);button.disabled=false;}
  }
  window.CanvasLibrary={ready:readyLibrary,exportDraft:exportLibraryDraft,get conflict(){return libraryConflict;},retrySave:async()=>{await readyLibrary();return persistLibrary();},get loaded(){return libraryLoaded;},get error(){return libraryError;},get items(){assertLibraryReady();return library;},get folders(){assertLibraryReady();return [...folders,...extraFolders];},isFavorite(value){if(!libraryLoaded)return false;const n=typeof value==='string'?app.getState().nodes.find(n=>n.id===value)||{id:value}:value;return library.some(a=>favoriteMatches(a,n));},toggleFavorite};
  Object.assign(window.CanvasLibrary,{migrateResources:migrateLibraryResources,migrationStatus:()=>libraryMigration&&structuredClone(libraryMigration),async flush(){await readyLibrary();let pending;do{if(migrationPending)await migrationPending;pending=libraryWrites;await pending;}while(pending!==libraryWrites||migrationPending);}});
  readyLibrary().catch(error=>app.notify('素材库读取失败：'+error.message));
  function migrationText(report){if(!report)return '';if(report.status==='migration_failed')return '资源迁移尚未保存，原记录已保留，请重试';if(report.status==='local_edits')return '素材已有新修改，迁移已暂停，请先保存当前修改';if(report.status==='lock_unavailable')return '此浏览器不支持安全迁移，请使用支持 Web Locks 的浏览器';if(report.status.startsWith('index_'))return '本地资源索引尚未就绪，原引用已保留';return report.summary?.unresolved?`已映射 ${report.summary.changed} 项，${report.summary.unresolved} 项需重新导入本地素材，原引用已保留`:`本地资源检查完成，${report.summary?.changed||0} 项已映射`;}
  function migrationStatusElement(report){const status=el('p','panel-empty',migrationText(report));status.setAttribute('role','status');status.dataset.migrationStatus=report.status;return status;}
  const effectiveLibraryAsset=item=>({...item,...item.type==='video'?{video:item.video||window.EDITOR_DATA?.nodes?.[item.nodeId]?.video}:{}});
  const assertLibraryReadable=item=>{const current=effectiveLibraryAsset(item);if(['image','fullImage','video','audio','poster','thumbnail'].some(field=>officialMedia(current[field])))throw Error('此旧素材需迁移或重新导入本地素材，原记录已保留');};
  function insertLibraryAsset(item){try{const current=effectiveLibraryAsset(item);assertLibraryReadable(current);app.insertAsset(current);}catch(error){app.notify(error.message);}}
  let left=null,intro=null,activePanel=null,subjectManager=null,leftTrigger=null,contextMenu=null,shareMenu=null,contextFocusCheck=0;
  const surfaceMotions=new Map(),surfaceDisposers=new Map();
  function enterSurface(element,kind){
    const create=window.ReplicaUI?.createPresenceMotion;if(!create)return;
    const ease='cubic-bezier(.16,1,.3,1)',leave='cubic-bezier(.7,0,.84,0)';
    const options=kind==='library'?{hidden:{opacity:0,transform:'translateX(-20px)'},enter:{duration:200,easing:ease,opacity:{duration:100,delay:60,easing:ease}},exit:{duration:160,easing:leave,opacity:{duration:60,easing:leave}}}:
      kind==='history'?{hidden:{opacity:0,transform:'translateX(-24px)'},enter:{duration:200,easing:ease}}:
      {hidden:{opacity:0,transform:'scale(.95)'},enter:{duration:150,easing:'cubic-bezier(.4,0,.2,1)'}};
    const motion=create(element,{...options,onHidden:()=>{motion.destroy();surfaceMotions.delete(element);element.remove();}});
    surfaceMotions.set(element,motion);motion.enter();
  }
  function retireSurface(element){
    if(!element)return;
    surfaceDisposers.get(element)?.();surfaceDisposers.delete(element);
    const motion=surfaceMotions.get(element);
    // An exiting drawer must not share its live ID with the replacement drawer.
    element.removeAttribute('id');if(motion)motion.exit();else element.remove();
  }
  window.addEventListener('pagehide',event=>{if(event.persisted)return;closeContext();for(const dispose of surfaceDisposers.values())dispose();surfaceDisposers.clear();for(const [element,motion]of surfaceMotions){motion.destroy();element.remove();}surfaceMotions.clear();});
  const focusBack=trigger=>{if(trigger?.isConnected&&!trigger.closest('[hidden]'))trigger.focus({preventScroll:true});};
  function closeContext(restoreFocus=false){window.clearTimeout?.(contextFocusCheck);contextFocusCheck=0;if(!contextMenu)return;const {element,trigger}=contextMenu;contextMenu=null;retireSurface(element);trigger?.setAttribute('aria-expanded','false');if(restoreFocus)focusBack(trigger);}
  function closeShare(restoreFocus=false){if(!shareMenu)return;const trigger=shareMenu.trigger;shareMenu.element.remove();shareMenu=null;trigger.setAttribute('aria-expanded','false');if(restoreFocus)focusBack(trigger);}
  function closeLeft({restoreFocus=true,onDiscard}={}){const managed=subjectManager?.element;if(subjectManager?.destroy({onDiscard:()=>{closeLeft({restoreFocus});onDiscard?.();}})===false)return false;subjectManager=null;closeContext();if(left!==managed)retireSurface(left);intro?.remove();left=null;intro=null;activePanel=null;$('.side-tools').hidden=false;const trigger=leftTrigger;leftTrigger=null;trigger?.setAttribute('aria-expanded','false');if(restoreFocus)focusBack(trigger);return true;}
  function panel(title,kind){if(!closeLeft({restoreFocus:false,onDiscard:()=>({library:showLibrary,history:showHistory})[kind]?.()}))return {};activePanel=kind;leftTrigger=$(`.side-tools button[aria-label="${title}"]`);left=el('aside','floating-panel left-panel');left.setAttribute('aria-label',title);left.id='left-panel-'+kind;leftTrigger?.setAttribute('aria-expanded','true');const h=el('div','panel-heading');const back=iconButton('关闭'+title,'arrowLeft',()=>closeLeft(),'back-panel',false);back.setAttribute('aria-label','关闭'+title);h.append(back,el('h2','',title));left.append(h);$('.side-tools').hidden=true;document.body.append(left);enterSurface(left,kind);back.focus({preventScroll:true});return {panel:left,head:h};}
  function showDialog(dialog){const trigger=document.activeElement;dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('close',()=>{dialog.remove();focusBack(trigger);});document.body.append(dialog);dialog.showModal();}
  function segments(labels,callback){const s=el('div','segmented');labels.forEach((name,index)=>{const b=btn(name,()=>{s.querySelectorAll('button').forEach(x=>x.classList.toggle('chosen',x===b));callback(name);});if(!index)b.className='chosen';s.append(b);});return s;}
  function searchBox(placeholder,callback){const input=el('input','panel-search');input.type='search';input.placeholder=placeholder;input.setAttribute('aria-label',placeholder);input.oninput=()=>callback(input.value);return input;}
  function folderButton(name,fn){const b=btn('',fn,'folder-row');const chevron=el('span','folder-chevron');chevron.innerHTML=window.UI_ICONS.arrowRight;const folder=el('span','folder-resource-icon');folder.innerHTML=window.UI_ICONS.folder;b.append(chevron,folder,el('span','',name));return b;}
  function assetPreview(item){try{assertLibraryReadable(item);}catch(error){app.notify(error.message);return;}const n={id:item.id,title:item.name,image:item.image,fullImage:item.fullImage,type:item.type||'image',content:item.content,color:item.color,audio:item.audio,video:item.video||window.EDITOR_DATA?.nodes[item.nodeId]?.video};app.preview(n);}
  function saveAsset(nodes){if(typeof readyLibrary==='function'&&!libraryLoaded){const projectId=window.CanvasProjects?.id?.();readyLibrary().then(()=>{if(projectId!==window.CanvasProjects?.id?.())throw Error('画布已切换，请重新保存素材');saveAsset(nodes);}).catch(error=>app.notify('素材尚未保存：'+error.message));return;}const assets=nodes.filter(n=>n.image||n.fullImage||n.audio||n.video||window.EDITOR_DATA?.nodes[n.id]?.video||n.type==='text'&&n.content?.trim());if(!assets.length)return;const d=el('dialog','save-library-dialog');d.append(el('h2','','保存到素材库'));const name=el('input');name.value=assets.length===1?assets[0].title:`${assets.length} 个素材`;name.setAttribute('aria-label','素材名称');const select=el('select');select.setAttribute('aria-label','素材文件夹');[...folders,...extraFolders,'收藏'].forEach(n=>select.append(el('option','',n)));let preparedAssets=null;const save=btn('保存',async()=>{save.disabled=true;try{if(typeof readyLibrary==='function')await readyLibrary();if(!preparedAssets){const capture=window.CanvasLibraryAssetRoundtrip?.capture||((n,o)=>({id:o.id,name:o.name,folder:o.folder,type:n.type,nodeId:n.id,image:['image','video'].includes(n.type)?n.image:undefined,fullImage:n.type==='image'?n.fullImage:undefined,audio:n.type==='audio'?n.audio:undefined,video:n.type==='video'?n.video||o.legacyVideo:undefined,content:n.type==='text'?n.content:undefined,color:n.type==='text'?n.color:undefined}));preparedAssets=assets.map(n=>capture(n,{id:crypto.randomUUID(),name:assets.length===1?name.value:n.title,folder:select.value,legacyVideo:window.EDITOR_DATA?.nodes[n.id]?.video}));library.push(...preparedAssets);}preparedAssets.forEach((item,i)=>{item.name=assets.length===1?name.value:assets[i].title;item.folder=select.value;});await persistLibrary();d.close();showLibrary();}catch(error){app.notify('素材尚未保存：'+error.message);if(typeof libraryConflict!=='undefined'&&libraryConflict&&!d.querySelector('[data-library-export]')){const recovery=el('p','','版本冲突：先导出并确认本机文件，再刷新读取当前库。本页保留未保存素材。'),exportButton=btn('导出未保存素材',()=>downloadLibraryDraft(exportButton));exportButton.dataset.libraryExport='true';d.append(recovery,exportButton,btn('保留草稿并关闭',()=>d.close()));}}finally{save.disabled=typeof libraryConflict!=='undefined'&&libraryConflict;}},'solid-button');d.append(name,select,save);showDialog(d);}
  document.addEventListener('canvas:save-assets',e=>saveAsset(e.detail));
  function subjectShortcut(){const b=btn('主体库',showSubjectLibrary,'library-shortcut');b.setAttribute('aria-label','主体库');return b;}
  function showLibrary(){
    const {panel:p,head}=panel('素材库','library');if(!p)return;let scope='个人',folder=null,q='';const ai=iconButton('AI 角色','user',()=>showSubjectLibrary());ai.title='AI 角色';const add=iconButton('添加素材','plus',()=>libraryAddMenu(),'panel-plus',false);add.setAttribute('aria-label','添加素材');add.setAttribute('aria-haspopup','menu');add.setAttribute('aria-expanded','false');head.append(ai,add);
    p.append(segments(['个人','团队'],v=>{scope=v;folder=null;render();}),searchBox('搜索',v=>{q=v;render();}));const content=el('div','panel-scroll');p.append(content);
    function render(){const focused=document.activeElement?.closest?.('.asset-tile')?.dataset.assetId;content.replaceChildren();if(!libraryLoaded){content.append(el('p','panel-empty',libraryError?'素材库读取失败：'+libraryError.message:'正在读取素材库…'));if(libraryError)content.append(btn('重试',()=>readyLibrary().catch(error=>app.notify(error.message))));return;}if(libraryUnsaved){const status=el('p','panel-empty',libraryConflict?'素材库版本冲突。本页保留未保存草稿；先导出并确认本机文件，再刷新读取当前库。不会自动覆盖新版。':libraryPending?'素材库正在保存…':'素材修改尚未保存，请保留此页面并重试');status.setAttribute('role','status');content.append(status);if(!libraryPending){if(libraryConflict){const exportButton=btn('导出未保存素材',()=>downloadLibraryDraft(exportButton));content.append(exportButton);}else content.append(btn('重试保存',()=>persistLibrary().catch(()=>{})));}}if(libraryMigration)content.append(migrationStatusElement(libraryMigration));if(scope==='团队'){content.append(el('p','panel-empty','暂无团队素材'));return;}
      if(folder!==null||q){const back=()=>{folder=null;q='';p.querySelector('input').value='';render();},path=folder?iconButton(folder,'arrowLeft',back,'library-shortcut'):btn('搜索结果',back,'library-shortcut');content.append(path);const grid=el('div','library-grid');const items=library.filter(i=>(!folder||i.folder===folder)&&i.name.toLowerCase().includes(q.toLowerCase()));items.forEach(item=>{const b=btn('',()=>assetPreview(item),'asset-tile');b.dataset.assetId=item.id;if(item.image)b.append(img(item.image,item.name));else{const glyph=el('div','asset-audio-placeholder');glyph.innerHTML=window.UI_ICONS[item.type==='text'?'text':'music'];b.append(glyph);}b.append(el('span','',item.name));b.ondblclick=()=>insertLibraryAsset(item);b.oncontextmenu=e=>{e.preventDefault();simplePopup(e.clientX,e.clientY,[['添加到画布',()=>insertLibraryAsset(item)],['移到收藏',()=>{item.folder='收藏';persistLibrary();render();}],['重命名',()=>{const name=prompt('素材名称',item.name);if(name?.trim()){item.name=name.trim();persistLibrary();render();}}]],b);};grid.append(b);});content.append(grid);if(!items.length)content.append(el('p','panel-empty','暂无素材'));if(focused)Array.from(content.querySelectorAll('.asset-tile')).find(b=>b.dataset.assetId===focused)?.focus({preventScroll:true});return;}
      content.append(iconButton('收藏','star',()=>{folder='收藏';render();},'library-shortcut'),subjectShortcut(),el('div','library-divider'),el('div','library-caption','文件夹'));
      [...folders,...extraFolders].forEach(name=>{const b=folderButton(name,()=>{folder=name;render();});const dots=el('span','folder-more resource-icon-button');dots.setAttribute('aria-hidden','true');dots.innerHTML=window.UI_ICONS.more||'';b.append(dots);content.append(b);});
    }
    function libraryAddMenu(){if(!libraryLoaded){app.notify(libraryError?.message||'素材库正在读取，请稍后重试');return;}const r=add.getBoundingClientRect();simplePopup(r.right,r.bottom+8,[['上传图片',()=>uploadLibrary(folder||'Others',()=>{if(left===p&&p.isConnected&&activePanel==='library')render();})],['保存选中节点',()=>saveAsset(app.getState().nodes.filter(n=>app.getState().selected.includes(n.id)))],['迁移本地资源',()=>migrateLibraryResources().catch(error=>app.notify('迁移尚未保存：'+error.message))],['新建文件夹',()=>{const name=prompt('文件夹名称');if(name?.trim()&&![...folders,...extraFolders].includes(name.trim())){extraFolders.push(name.trim());persistLibrary();render();}}]],add);}
    const refresh=()=>{if(left===p&&p.isConnected)render();};document.addEventListener('library:changed',refresh);surfaceDisposers.set(p,()=>document.removeEventListener('library:changed',refresh));render();
  }
  function uploadLibrary(folder,onSaved){
    const input=el('input');input.type='file';input.accept='image/*';input.multiple=true;
    input.onchange=async()=>{try{await readyLibrary();for(const file of input.files){if(!file.type.startsWith('image/'))throw Error('仅支持图片素材');if(typeof window.LocalAssets?.put!=='function')throw Error('本地媒体存储尚未就绪');const image=await window.LocalAssets.put(file);library.push({id:crypto.randomUUID(),name:file.name,image,folder,type:'image'});await persistLibrary();onSaved?.();}}catch(error){app.notify('素材尚未保存：'+error.message);}};input.click();
  }
  async function showSubjectLibrary(){
    const previous=left;
    const {openSubjectManager}=await import('./src/features/subject-library/manager.mjs');
    if(left!==previous)return;
    const trigger=leftTrigger||$('.side-tools button[aria-label="素材库"]');if(!closeLeft({restoreFocus:false,onDiscard:showSubjectLibrary}))return;leftTrigger=trigger;activePanel='library';$('.side-tools').hidden=true;
    subjectManager=openSubjectManager({onBack:showLibrary,onApply:async (subject,options)=>{const {applySubject}=await import('./src/features/subject-library/apply.mjs');await applySubject(subject,app,options);}});left=subjectManager.element;left.id='left-panel-library';leftTrigger?.setAttribute('aria-expanded','true');
  }
  async function showHistory(){
    const {panel:p,head}=panel('历史','history');if(!p)return;
    try{const {mountHistory}=await import('./src/features/generation-history/ui.mjs');if(left!==p)return;surfaceDisposers.set(p,mountHistory({panel:p,head,app}));}
    catch(error){if(left===p){p.append(el('p','panel-empty','历史面板读取失败：'+error.message));app.notify(error.message);}}
  }
  function showTemplates(){
    if(!closeLeft({restoreFocus:false,onDiscard:showTemplates}))return;
    activePanel='templates';leftTrigger=$('.side-tools button[aria-label="模板"]');
    left=el('aside','floating-panel templates-panel');left.setAttribute('aria-label','模板');left.id='left-panel-templates';leftTrigger?.setAttribute('aria-expanded','true');
    const owner=left,projectId=window.CanvasProjects?.id?.();let tab='公共模板',q='',category='all',workflowTemplates=null,publicItems=(window.SIDEBAR_DATA?.template||[]).filter(item=>item.graph),loadError=null,localReadError=null,applying=false,gallery=null;
    const active=()=>left===owner&&owner.isConnected;
    const currentProject=()=>window.CanvasProjects?.id?.();
    const tabs=el('div','template-tabs');
    const publicBtn=btn('公共模板',()=>{tab='公共模板';publicBtn.classList.add('chosen');mineBtn.classList.remove('chosen');render();},'chosen');
    const mineBtn=btn('我的模板',()=>{tab='我的模板';mineBtn.classList.add('chosen');publicBtn.classList.remove('chosen');render();});
    const expand=iconButton('浏览全部模板','expand',event=>openGallery(null,event.currentTarget),'',false);expand.setAttribute('aria-label','浏览全部模板');
    tabs.append(publicBtn,mineBtn,expand);owner.append(tabs,searchBox('搜索资产包...',value=>{q=value;render();}));
    const categoryFilter=el('select','workflow-template-category-filter');categoryFilter.setAttribute('aria-label','公共模板分类');const allCategory=el('option','','全部');allCategory.value='all';categoryFilter.append(allCategory);categoryFilter.onchange=()=>{category=categoryFilter.value;render();};owner.append(categoryFilter);
    const content=el('div','panel-scroll');owner.append(content);document.body.append(owner);publicBtn.focus({preventScroll:true});
    if(localStorage.getItem('tapnow-template-intro')!=='dismissed'){
      intro=el('div','template-intro');intro.append(img(window.SIDEBAR_DATA.template[0].image));const text=el('div');
      text.append(el('h3','','使用模板加速创作'),el('p','','一键使用专业模版，快速构建你的专属场景。'));
      intro.append(text,btn('知道了',()=>{localStorage.setItem('tapnow-template-intro','dismissed');intro.remove();intro=null;}));document.body.append(intro);
    }
    const navigationGuard=window.CanvasProjects?.registerNavigationGuard?.(()=>applying?'模板正在应用，请稍后切换项目':null);
    window.TemplateAPI?.ready.then(()=>{if(active())render();}).catch(error=>{localReadError=error;if(active()&&tab==='我的模板')render();});
    const refresh=()=>{if(active())render();};document.addEventListener('templates:changed',refresh);
    surfaceDisposers.set(owner,()=>{document.removeEventListener('templates:changed',refresh);navigationGuard?.();gallery?.destroy();});
    async function loadPublic(){
      loadError=null;
      try{
        const module=window.WorkflowTemplatesUI||await import('./src/features/workflow-templates/entry.mjs');
        module.installStyles(document);const items=await module.readCatalog();
        if(!active())return;workflowTemplates=module;publicItems=items;categoryFilter.replaceChildren(allCategory);module.officialCategories.forEach(value=>{const option=el('option','',value.name);option.value=value.id;categoryFilter.append(option);});categoryFilter.value=category;render();
      }catch(error){if(active()){loadError=error;render();}}
    }
    async function applyItem(item){
      if(applying||!active())return;applying=true;
      try{
        if(projectId!==currentProject())throw Error('画布已切换，请重新打开模板');
        if(tab==='公共模板')await workflowTemplates.apply(item,{app,projectId,currentProjectId:currentProject});
        else{await window.TemplateAPI.ready;if(!active())return;if(projectId!==currentProject())throw Error('画布已切换，请重新打开模板');await window.TemplateAPI.use(item.id,{canApply:()=>active()&&projectId===currentProject()});}
      }catch(error){app.notify(error.message);}finally{applying=false;}
    }
    function openGallery(item,source){
      if(!workflowTemplates){if(loadError)loadPublic();else app.notify('公共模板正在读取，请稍后再试');return;}
      gallery?.close();intro?.remove();intro=null;
      gallery=workflowTemplates.openGallery({items:publicItems,selected:item,initialScope:tab==='我的模板'?'mine':category,app,templateAPI:window.TemplateAPI,document,mediaSource,onApplied:()=>{if(active())closeLeft();},returnFocus:source||document.activeElement,onClose:()=>{gallery=null;}});
    }
    function render(){
      categoryFilter.hidden=tab!=='公共模板';
      const focused=document.activeElement?.closest?.('.template-card')?.dataset.templateId;content.replaceChildren();
      if(tab==='我的模板'){
        if(localReadError){content.append(el('p','panel-empty','模板读取失败：'+localReadError.message));return;}
        content.append(btn('迁移本地资源',()=>window.TemplateAPI?.migrateResources().catch(error=>app.notify('模板迁移尚未保存：'+error.message)),'library-shortcut'));
        const report=window.TemplateAPI?.migrationStatus?.();if(report)content.append(migrationStatusElement(report));
      }
      if(tab==='公共模板'&&loadError){content.append(el('p','panel-empty',loadError.message),btn('重试',loadPublic,'library-shortcut'));return;}
      if(tab==='公共模板'&&!publicItems.length&&!workflowTemplates){const loading=el('p','workflow-template-loading','加载模板中…');loading.setAttribute('role','status');content.append(loading);return;}
      const grid=el('div','template-grid');
      const items=(tab==='公共模板'?(workflowTemplates?publicItems:(window.SIDEBAR_DATA?.template||[]).filter(item=>item.graph)):window.TemplateAPI?.list()||[]).filter(item=>(tab!=='公共模板'||category==='all'||item.categoryIds?.includes(category))&&item.name.toLowerCase().includes(q.trim().toLowerCase()));
      items.forEach(item=>{
        if(workflowTemplates){grid.append(workflowTemplates.createCard(item,{document,mediaSource,onApply:applyItem,onPreview:openGallery}));return;}
        const b=btn('',()=>templateDetail(item),'template-card');b.dataset.templateId=item.id||item.name;
        if(item.image)b.append(img(item.image,item.name));else{const glyph=el('div','asset-audio-placeholder');glyph.innerHTML=window.UI_ICONS[item.type==='text'?'text':'music'];b.append(glyph);}
        b.append(el('span','',item.name));grid.append(b);
      });
      content.append(grid);if(!items.length)content.append(el('p','panel-empty',q?'没有匹配的模板':'暂无模板'));
      const focusedCard=focused&&Array.from(content.querySelectorAll('.template-card')).find(node=>node.dataset.templateId===focused);if(focusedCard)(focusedCard.querySelector('button')||focusedCard).focus({preventScroll:true});
    }
    render();loadPublic();
  }
  function templateDetail(item){const owner=left,trigger=document.activeElement;let using=false;const d=el('dialog','template-preview');d.setAttribute('aria-label',item.name);d.addEventListener('close',()=>{if(left===owner&&!trigger?.isConnected)(Array.from(owner.querySelectorAll('.template-card')).find(b=>b.dataset.templateId===(item.id||item.name))||owner.querySelector('.template-tabs .chosen'))?.focus({preventScroll:true});});const head=el('div','dialog-heading');head.append(el('h2','',item.name),iconButton('关闭模板预览','close',()=>d.close(),'close',false));d.append(head);if(item.video){const video=el('video');mediaSource(video,item.video);video.controls=true;d.append(video);}else if(item.image)d.append(img(item.image,item.name));if(item.description)d.append(el('p','template-description',item.description));if(item.tags)d.append(el('p','template-tags',item.tags.join(' · ')));const actions=el('div','template-actions');const use=btn('使用模板',async()=>{if(using)return;using=true;use.disabled=true;use.setAttribute('aria-busy','true');try{await window.TemplateAPI.use(item.id);if(d.isConnected&&d.open){d.close();if(left===owner)closeLeft();}}catch(e){app.notify(e.message);}finally{using=false;if(d.isConnected){use.disabled=!item.graph;use.setAttribute('aria-busy','false');}}},'solid-button');use.disabled=!item.graph;if(!item.graph)use.title='尚未导入此模板的完整节点数据';actions.append(btn('关闭',()=>d.close()),use);d.append(actions);showDialog(d);}
  function simplePopup(x,y,items,trigger=document.activeElement){
    if(contextMenu?.trigger===trigger){closeContext(true);return null;}closeContext();closeShare();
    const p=el('div','menu context-popup');p.setAttribute('role','menu');p.setAttribute('aria-label','素材操作');
    items.forEach(([text,fn])=>{const b=btn(text,()=>{closeContext(true);fn();});b.setAttribute('role','menuitem');p.append(b);});
    p.style.left=Math.max(8,Math.min(innerWidth-230,x))+'px';p.style.top=Math.max(8,Math.min(innerHeight-items.length*38-20,y))+'px';document.body.append(p);enterSurface(p,'menu');contextMenu={element:p,trigger};trigger?.setAttribute('aria-expanded','true');
    p.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeContext(true);return;}if(e.key==='Tab'){if(contextMenu?.element===p)contextMenu.tabLeaving=true;return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const rows=[...p.querySelectorAll('button')],i=rows.indexOf(document.activeElement);rows[e.key==='Home'?0:e.key==='End'?rows.length-1:(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();};
    p.querySelector('button')?.focus({preventScroll:true});return p;
  }
  function showShare(){if(shareMenu){closeShare(true);return;}closeContext();const p=el('section','share-menu');p.setAttribute('aria-label','分享画布');p.setAttribute('role','dialog');p.tabIndex=-1;for(const [title,action,desc]of[['在 TapTV 上发布','发布','在 TapTV 上发布你的作品，让更多创作者看到。'],['通过链接分享','分享','任何拥有此链接的人都可以查看并克隆你的画布。'],['移动到团队项目','移动','将此项目转移到团队进行协作。']]){const s=el('div','share-section'),h=el('div');const b=btn(action,null);b.disabled=true;b.title='本地预览尚未连接协作服务';h.append(el('span','',title),b);s.append(h,el('p','',desc));p.append(s);}document.body.append(p);shareMenu={element:p,trigger:shareButton};shareButton.setAttribute('aria-expanded','true');p.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeShare(true);}else if(e.key==='Tab')closeShare();};p.focus({preventScroll:true});}
  const actions={素材库:['library',showLibrary],模板:['templates',showTemplates],历史:['history',showHistory]};Object.entries(actions).forEach(([name,[kind,fn]])=>{const b=$(`.side-tools button[aria-label^="${name}"]`);b.classList.remove('deferred');b.setAttribute('aria-label',name);b.dataset.tip=name;b.setAttribute('aria-controls','left-panel-'+kind);b.setAttribute('aria-expanded','false');b.onclick=()=>activePanel===kind?closeLeft():fn();});
  const agentButton=$('.agent');agentButton.classList.remove('deferred');agentButton.setAttribute('aria-label','AI 助手');agentButton.dataset.tip='AI 助手';agentButton.onclick=()=>window.AgentUI.toggle();
  const avatar=$('.avatar');
  import('./src/features/generation-results/entry.mjs').then(({install})=>{install(avatar);avatar.classList.remove('deferred');avatar.dataset.tip='个人账号';}).catch(error=>app.notify('画布设置加载失败：'+error.message));
  const shareButton=$('.share');shareButton.classList.remove('deferred');shareButton.setAttribute('aria-label','分享画布');shareButton.dataset.tip='分享';shareButton.onclick=showShare;
  document.addEventListener('canvas:render',()=>{
    const save=$('#node-toolbar button[aria-label="复制节点"]');if(save){save.setAttribute('aria-label','保存到素材库');save.title='保存到素材库';save.onclick=()=>app.saveSelection();}
  });
  document.addEventListener('pointerdown',e=>{if(contextMenu)contextMenu.tabLeaving=false;if(contextMenu&&!contextMenu.element.contains(e.target)&&!contextMenu.trigger?.contains(e.target))closeContext();if(shareMenu&&!shareMenu.element.contains(e.target)&&!shareMenu.trigger.contains(e.target))closeShare();});
  document.addEventListener('focusin',e=>{if(contextMenu&&!contextMenu.element.contains(e.target)&&(!contextMenu.trigger?.contains(e.target)||contextMenu.tabLeaving))closeContext();else if(contextMenu)contextMenu.tabLeaving=false;});
  document.addEventListener('focusout',e=>{
    if(!contextMenu?.element.contains(e.target))return;
    window.clearTimeout?.(contextFocusCheck);const pending=contextMenu;
    contextFocusCheck=window.setTimeout(()=>{if(contextMenu!==pending)return;contextFocusCheck=0;if(document.hasFocus?.()===false||!pending.element.contains(document.activeElement))closeContext();},0);
  });
  window.addEventListener('blur',()=>closeContext());
  // A later listener may remove its popup before this fallback runs. Remember
  // the upper layer at dispatch start so the same Escape cannot close the drawer.
  const upperEscapes=new WeakSet();
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const layers=$$('dialog[open],[role="menu"],[role="dialog"],.subject-editor-v2');if(layers.some(node=>!node.hidden&&!node.closest('[hidden],[inert],[aria-hidden="true"]')&&node!==contextMenu?.element&&node!==shareMenu?.element))upperEscapes.add(e);},{capture:true});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||upperEscapes.has(e)||document.querySelector('dialog[open]')||document.body.matches('.studio-active,.media-editing,.text-viewer-active,.pile-gallery-active,.video-masking,.video-reshoot-active,.video-creation-active,.video-trimming,.action-editing'))return;if(contextMenu){e.preventDefault();e.stopImmediatePropagation();closeContext(true);return;}if(shareMenu){e.preventDefault();e.stopImmediatePropagation();closeShare(true);return;}if(left){e.preventDefault();e.stopImmediatePropagation();closeLeft();}});

})();
