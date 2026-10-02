import {install} from './entry.mjs';
import {groupRows} from './model.mjs';
const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls || '';if(text!==undefined)node.textContent=text;return node;};
const button=(text,action,cls='')=>{const node=make('button',cls,text);node.type='button';node.onclick=action;return node;};
const icon=(name,cls='')=>{const node=make('span',cls);node.innerHTML=globalThis.window?.UI_ICONS?.[name] || '';node.setAttribute('aria-hidden','true');return node;};
export function mountHistory({panel,head,app,loadHistory=install}) {
  if(!document.querySelector('link[data-generation-history]')){const link=make('link');link.rel='stylesheet';link.href=new URL('./styles.css',import.meta.url).href;link.dataset.generationHistory='';document.head.append(link);}
  panel.classList.add('generation-history-panel');
  let alive=true,history,unsubscribe,type='image',list=false,selecting=false,query='',busy=false,signature=null;
  const selected=new Set(),rowViews=new Map(),previewing=new Set();
  const status=make('p','generation-history-status');status.setAttribute('role','status');status.hidden=true;
  const content=make('div','panel-scroll'),footer=make('div','history-footer');
  const Observer=globalThis.IntersectionObserver,observer=Observer?new Observer(entries=>{for(const entry of entries){const view=rowViews.get(entry.target.dataset.historyId);if(view?.tile===entry.target){if(entry.isIntersecting)view.loadThumbnail();else releaseImage(view);}}},{root:content,rootMargin:'200px'}):null;
  const message=text=>{if(!alive)return;status.textContent=text || '';status.hidden=!text;};
  const action=async operation=>{if(busy)return;busy=true;render();try{await operation();message('');}catch(error){message(error.message);app.notify(error.message);}finally{busy=false;if(alive)render();}};
  const select=button('选择',()=>{selecting=!selecting;if(!selecting)selected.clear();render();});select.setAttribute('aria-label','选择历史素材');
  const toggle=button('',()=>{list=!list;render();},'resource-icon-button');toggle.append(icon('list'));toggle.setAttribute('aria-label','切换历史列表视图');
  const expand=button('',()=>{const expanded=panel.classList.toggle('expanded-panel');expand.setAttribute('aria-expanded',String(expanded));},'resource-icon-button');expand.append(icon('expand'));expand.setAttribute('aria-label','展开历史');expand.setAttribute('aria-expanded','false');head.append(select,toggle,expand);
  const tabs=make('div','segmented');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','历史素材类型');
  const labels=[['image','图片'],['video','视频'],['audio','音频'],['model','3D']];
  labels.forEach(([value,label],index)=>{const tab=button(label,()=>{type=value;selected.clear();render();});tab.setAttribute('role','tab');tab.dataset.type=value;tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?3:(index+(event.key==='ArrowRight'?1:-1)+4)%4;tabs.children[next].click();tabs.children[next].focus();}};tabs.append(tab);});
  const search=make('input','panel-search');search.type='search';search.placeholder='搜索历史';search.setAttribute('aria-label','搜索历史');search.oninput=()=>{query=search.value;render();};
  panel.append(tabs,search,status,content,footer);
  const chosen=()=>history.list().filter(row=>selected.has(row.id));
  async function preview(view){
    const row=view.row;if(previewing.has(row.id))return;previewing.add(row.id);view.action.setAttribute('aria-busy','true');view.action.focus({preventScroll:true});
    try{await history.preview(row);message('');}catch(error){message(error.message);app.notify(error.message);}finally{previewing.delete(row.id);view.action.setAttribute('aria-busy','false');}
  }
  const rowKey=row=>JSON.stringify([row.id,row.type,row.title,row.createdAt,row.archiveStatus,row.archiveError,row.mediaRef,row.thumbnailRef,row.thumbnailStatus,row.thumbnailError,row.worldPatch?.image,row.parameters,list]);
  function releaseImage(view){view.generation=(view.generation || 0)+1;view.lease?.release();view.lease=null;view.thumbnailRequested=false;if(view.image){view.image.onerror=null;view.image.removeAttribute('src');if(view.image.parentNode || view.image.parent)view.image.replaceWith(view.placeholder);view.image=null;}}
  function retireView(view){observer?.unobserve(view.tile);releaseImage(view);}
  function viewFor(row) {
    const key=rowKey(row);let view=rowViews.get(row.id);
    if(!view || view.key!==key){
      if(view)retireView(view);
      const wrapper=make('div','generation-history-row');view={key,row,wrapper,generation:0};
      const tile=button('',()=>{if(busy)return;const current=view.row;if(selecting){selected.has(current.id)?selected.delete(current.id):selected.add(current.id);render();}else action(()=>history.apply([current]));},'history-item');view.tile=tile;
      tile.dataset.historyId=row.id;
      const placeholder=icon(row.type==='audio'?'music':row.type==='model'?'cube':row.type==='video'?'video':'image','generation-history-placeholder');view.placeholder=placeholder;tile.append(placeholder);
      const live=()=>alive&&rowViews.get(row.id)===view&&tile.isConnected;
      view.loadThumbnail=()=>{if(view.thumbnailRequested || row.archiveStatus!=='ready')return;view.thumbnailRequested=true;const generation=++view.generation;view.lease=history.acquireThumbnail?history.acquireThumbnail(view.row):{source:history.thumbnail(view.row),release(){}};
        view.lease.source.then(source=>{if(!live() || view.generation!==generation || !source)return;const image=make('img');image.alt='';image.loading='lazy';image.decoding='async';image.src=source;view.image=image;image.onerror=()=>{if(live()){releaseImage(view);const error=Error('历史缩略图读取失败，请重试缩略图');message(error.message);(history.thumbnailUnavailable?history.thumbnailUnavailable(view.row,error):history.markUnavailable(view.row.id,error)).catch(failure=>message(failure.message));}};placeholder.replaceWith(image);}).catch(error=>{if(live() && view.generation===generation && error.name!=='AbortError')message(error.message);});
      };
      if(list){const text=make('span','generation-history-title',row.title);text.title=row.title;tile.append(text);}
      view.check=icon('check','generation-history-check');tile.append(view.check);
      wrapper.append(tile);
      if(row.archiveStatus!=='ready'){const failure=make('div','generation-history-item-error');const retry=button('重试归档',()=>action(()=>history.retry(view.row.taskId)));view.action=retry;failure.append(make('span','',row.archiveError || '正在保存媒体…'),retry);wrapper.append(failure);}
      else {const open=button('预览',()=>preview(view),'generation-history-preview');open.setAttribute('aria-label','预览：'+row.title);view.action=open;wrapper.append(open);}
      if(row.type==='video' && row.thumbnailError){const failure=make('div','generation-history-item-error'),retry=button('重试缩略图',()=>action(()=>history.retryThumbnail(view.row.id)));failure.append(make('span','',row.thumbnailError),retry);wrapper.append(failure);}
      rowViews.set(row.id,view);
      if(observer)observer.observe(tile);else view.loadThumbnail();
    }
    view.row=row;view.tile.classList.toggle('selected',selected.has(row.id));view.tile.disabled=busy || row.archiveStatus!=='ready';view.tile.setAttribute('aria-label',(selecting?'选择':'应用到画布')+'：'+row.title);if(selecting)view.tile.setAttribute('aria-pressed',String(selected.has(row.id)));else view.tile.removeAttribute('aria-pressed');view.check.hidden=!selecting || !selected.has(row.id);view.action.disabled=busy;
    return view.wrapper;
  }
  function render() {
    if(!alive)return;
    const diagnostics=history?.diagnostics() || {receipts:[]},unresolved=diagnostics.receipts.filter(entry=>['unknown','running','queued'].includes(entry.status)),rows=history?.list({type,search:query}) || [];
    const next=JSON.stringify([!!history,type,list,selecting,query,busy,[...selected],diagnostics.error,diagnostics.canvasPending,diagnostics.canvasError,unresolved.map(entry=>[entry.taskId,entry.status]),rows.map(rowKey)]);
    // Storage revision and application metadata can change while the visible
    // history stays identical. Keep rows/images intact during those emissions.
    if(signature===next)return;signature=next;
    const focusedId=document.activeElement?.dataset?.historyId,scroll=content.scrollTop;
    select.textContent=selecting?'取消':'选择';select.setAttribute('aria-pressed',String(selecting));select.disabled=busy || !history;
    toggle.setAttribute('aria-pressed',String(list));
    for(const tab of tabs.children){const active=tab.dataset.type===type;tab.classList.toggle('chosen',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    content.replaceChildren();footer.replaceChildren();
    if(!history){content.append(make('p','panel-empty','正在读取历史…'));return;}
    if(diagnostics.error){const failure=make('div','generation-history-failure');failure.append(make('span','',diagnostics.error),button('重试保存',()=>action(()=>history.retrySave())));content.append(failure);}
    if(diagnostics.canvasPending){const failure=make('div','generation-history-failure');failure.append(make('span','','素材已插入但未保存：'+(diagnostics.canvasError || '正在保存')),button('重试画布保存',()=>action(()=>history.retryCanvasSave())));content.append(failure);}
    if(unresolved.length){const pending=make('div','generation-history-failure');pending.append(make('span','',`${unresolved.length} 个任务尚无完成结果`),button('查询原任务',()=>action(async()=>{for(const entry of unresolved)await history.retry(entry.taskId);})));content.append(pending);}
    const visible=new Set(rows.map(row=>row.id));for(const [id,view]of rowViews)if(!visible.has(id)){retireView(view);rowViews.delete(id);}
    if(!rows.length)content.append(make('p','panel-empty',query?'没有匹配的历史':'暂无历史'));
    for(const [date,batch] of groupRows(rows)) {
      content.append(make('div','history-date',date));const grid=make('div','history-grid'+(list?' history-list':''));
      for(const row of batch)grid.append(viewFor(row));
      content.append(grid);
    }
    if(selecting){const count=make('span','',`已选 ${selected.size} 个`),cancel=button('取消',()=>{selecting=false;selected.clear();render();}),apply=button('应用到画布',()=>action(async()=>{await history.apply(chosen());selected.clear();selecting=false;})),download=button('下载',()=>action(()=>history.download(chosen())));for(const node of [cancel,apply,download]){node.setAttribute('aria-label',node.textContent);node.disabled=busy || node!==cancel&&!selected.size;}footer.append(count,cancel,apply,download);}
    content.scrollTop=scroll;
    if(focusedId)for(const tile of content.querySelectorAll('[data-history-id]'))if(tile.dataset.historyId===focusedId&&!tile.disabled){tile.focus({preventScroll:true});break;}
  }
  async function load(){try{history=await loadHistory();if(!alive)return;unsubscribe=history.subscribe(render);message('');render();}catch(error){if(!alive)return;message('历史读取失败：'+error.message);content.replaceChildren(button('重试读取',load));}}
  render();void load();
  return ()=>{alive=false;observer?.disconnect();for(const view of rowViews.values())retireView(view);rowViews.clear();unsubscribe?.();};
}
