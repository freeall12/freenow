const fixture=window.VideoHistoryFixture,app=window.CanvasApp,recordKey='agent-video-history-qa-fixture',base='/src/features/video-history/qa/';
if(!fixture||location.pathname!==base+'history-main.html'||window.CANVAS_DB_NAME!==fixture.namespace+'canvas'||window.LOCAL_ASSETS_DB_NAME!==fixture.namespace+'assets')throw Error('视频历史 QA 只允许写入隔离入口');
const panel=document.createElement('aside');panel.className='floating-panel qa-video-history-controls';panel.ariaLabel='视频历史真实媒体 QA';
panel.style.cssText='position:fixed;right:12px;top:58px;z-index:900;width:330px;max-height:75vh;overflow:auto;padding:12px;background:#25282b;color:#eee;border:1px solid #777;font:12px system-ui';
const heading=document.createElement('strong');heading.textContent='视频历史 · 真实本地媒体隔离 QA';
const note=document.createElement('p');note.textContent='合成横/竖/方 MP4 + PNG，真实 LocalAssets.put / IDB 保存。首项坏 preview 需真实 error 后回退原 asset。使用正式历史卡片、批次、主图与关闭操作。';
const controls=document.createElement('div'),output=document.createElement('pre');output.ariaLabel='视频历史实际诊断';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:370px;overflow:auto';panel.append(heading,note,controls,output);document.body.append(panel);
let manifest=null,savedReadback=null,failure='',saveStatus='尚未显式保存回读',delayUntil=0,assetReadback=[];
const assetRefs=new Set(),urlCalls=[],mediaEvents=[],inputEvents=[],tracked=new Map(),observers=[];
const node=()=>app.getState().nodes.find(value=>value.id===manifest?.nodeId)||app.getState().nodes.find(value=>value.qaVideoHistory===true);
const keep=(list,value,limit=48)=>{list.push(value);if(list.length>limit)list.splice(0,list.length-limit);};
const time=()=>Math.round(performance.now());
const sha256=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function mediaState(video){return {connected:video.isConnected,src:video.getAttribute('src'),currentSrc:video.currentSrc,poster:video.getAttribute('poster'),videoWidth:video.videoWidth,videoHeight:video.videoHeight,duration:Number.isFinite(video.duration)?video.duration:null,currentTime:video.currentTime,readyState:video.readyState,networkState:video.networkState,paused:video.paused,errorCode:video.error?.code||null};}
function track(video){
 if(tracked.has(video))return;const entry={sequence:tracked.size+1,optionId:video.closest('.video-history-card')?.dataset.optionId};tracked.set(video,entry);
 for(const name of ['error','loadedmetadata','loadeddata','playing','pause','emptied','ended'])video.addEventListener(name,event=>{keep(mediaEvents,{at:time(),event:name,trusted:event.isTrusted,...entry,...mediaState(video)});refresh();});
 const observer=new MutationObserver(records=>{for(const record of records)keep(mediaEvents,{at:time(),event:'attribute:'+record.attributeName,...entry,...mediaState(video)});});observer.observe(video,{attributes:true,attributeFilter:['src','poster']});observers.push(observer);
}
const mutation=new MutationObserver(()=>document.querySelectorAll('.video-history-card video').forEach(track));mutation.observe(document.body,{childList:true,subtree:true});document.querySelectorAll('.video-history-card video').forEach(track);
const realURL=window.LocalAssets.url;window.LocalAssets.url=async function(ref){
 if(!assetRefs.has(ref))return realURL.call(this,ref);
 const call={at:time(),ref,activeBefore:window.VideoHistory?.activeId||null,delayed:performance.now()<delayUntil};keep(urlCalls,call);
 try{const result=await realURL.call(this,ref);if(call.delayed)await new Promise(resolve=>setTimeout(resolve,3000));Object.assign(call,{resolved:result,localBlob:result.startsWith('blob:'),activeAfter:window.VideoHistory?.activeId||null,finishedAt:time()});return result;}
 catch(error){Object.assign(call,{error:error.message,finishedAt:time()});throw error;}
};
function geometry(card){const rect=card.getBoundingClientRect(),video=card.querySelector('video');return {optionId:card.dataset.optionId,left:parseFloat(card.style.left),top:parseFloat(card.style.top),width:parseFloat(card.style.width),height:parseFloat(card.style.height),screen:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},media:video?mediaState(video):null};}
function summary(value){return value?{id:value.id,title:value.title,video:value.video,image:value.image,width:value.width,height:value.height,currentVideoOptionId:value.currentVideoOptionId,videoMetadata:value.videoMetadata,history:value.videoHistory?.map(batch=>({id:batch.id,prompt:batch.prompt,options:batch.options.map(item=>({id:item.id,video:item.video,preview:item.preview,poster:item.poster,width:item.width,height:item.height,duration:item.duration}))}))}:null;}
function diagnostics(){
 const gallery=document.querySelector('.video-history-gallery'),cards=[...(gallery?.querySelectorAll('.video-history-card')||[])].map(geometry),focus=document.activeElement;
 return {namespace:fixture.namespace,synthetic:true,modelCalls:0,node:summary(node()),activeId:window.VideoHistory?.activeId||null,bodyOpen:document.body.classList.contains('video-history-open'),ownerInert:node()?app.getNodeElement(node().id)?.querySelector('.node-body')?.inert:null,selected:app.getState().selected,view:app.getState().view,focus:{tag:focus?.tagName,id:focus?.id,className:focus?.className,label:focus?.getAttribute('aria-label')},upperLayers:{dialogs:[...document.querySelectorAll('dialog[open]')].map(dialog=>dialog.id),menuVisible:!document.querySelector('#menu')?.hidden},cards,batches:[...(gallery?.querySelectorAll('[role=tab]')||[])].map(tab=>({label:tab.ariaLabel,selected:tab.getAttribute('aria-selected')})),scrimStyle:gallery?.querySelector('.video-history-scrim')?.getAttribute('style'),batchBarStyle:gallery?.querySelector('.video-history-batches')?.getAttribute('style'),detachedMedia:[...tracked].filter(([video])=>!video.isConnected).slice(-12).map(([video,entry])=>({...entry,...mediaState(video)})),manifest,assetReadback,saveStatus,savedNode:summary(savedReadback?.nodes?.find(value=>value.id===node()?.id)),savedStorageRevision:savedReadback?.storageRevision,history:app.historyState(),urlCalls,mediaEvents,inputEvents,fixtureReads:fixture.reads,externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,errors:fixture.errors,error:failure};
}
function refresh(){output.textContent=JSON.stringify(diagnostics(),null,2);return diagnostics();}
function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='margin:3px;padding:6px;background:#333;color:#eee;border:1px solid #777';b.onclick=async()=>{b.disabled=true;failure='';try{await run();}catch(error){failure=error.message;}finally{b.disabled=false;refresh();}};controls.append(b);return b;}
async function saveReadback(){await app.saveProject();await window.CanvasStore.flush();savedReadback=await window.CanvasStore.load();saveStatus='正式 CanvasApp.saveProject / CanvasStore.flush / load 已完成';if(node()&&!savedReadback?.nodes?.some(value=>value.id===node().id))throw Error('IDB 回读未包含 QA 节点');}
async function verifyAssets(){assetReadback=[];if(!manifest)throw Error('请先导入');for(const source of manifest.sources)for(const key of ['video','poster']){const ref=source[key],url=await window.LocalAssets.url(ref),response=await fetch(url);if(!response.ok)throw Error('本地 asset 读取失败');const blob=await response.blob(),hash=await sha256(blob),expected=source[key+'SHA256'];assetReadback.push({shape:source.id,kind:key,ref,url,bytes:blob.size,type:blob.type,sha256:hash,match:hash===expected});if(hash!==expected)throw Error('本地 asset 字节与导入源不一致');}}
async function importMedia(){
 if(node()){await saveReadback();return;}
 const sourceManifest=await (await fetch(base+'media-manifest.json')).json(),sources=[];
 for(const source of sourceManifest.sources){
  const videoResponse=await fetch(base+source.id+'.mp4'),posterResponse=await fetch(base+source.id+'.png');if(!videoResponse.ok||!posterResponse.ok)throw Error('本地测试媒体读取失败');
  const videoBlob=await videoResponse.blob(),posterBlob=await posterResponse.blob();
  if(!videoBlob.size||videoBlob.type!=='video/mp4'||!posterBlob.size||posterBlob.type!=='image/png')throw Error('本地测试媒体类型或内容无效');
  const video=await window.LocalAssets.put(videoBlob),poster=await window.LocalAssets.put(posterBlob);assetRefs.add(video);assetRefs.add(poster);sources.push({...source,video,poster,videoSHA256:await sha256(videoBlob),posterSHA256:await sha256(posterBlob)});
 }
 const get=id=>sources.find(source=>source.id===id),option=(shape,id,broken=false)=>({id,video:get(shape).video,poster:get(shape).poster,...broken?{preview:base+'deliberately-missing-preview.mp4'}:{}});
 const history=[{id:'qa-mixed',prompt:'本地合成横竖方 · 非模型结果',parameters:{model:'QA 本地合成媒体'},options:[option('landscape','qa-landscape-fallback',true),option('portrait','qa-portrait'),option('square','qa-square'),option('landscape','qa-landscape-repeat')]},{id:'qa-second',prompt:'第二合成批次 · 方/竖',parameters:{model:'QA 第二批'},options:[option('square','qa-second-square'),option('portrait','qa-second-portrait')]}];
 const view=app.getState().view,n=app.addNode('video',{x:350*view.scale+view.x,y:460*view.scale+view.y},get('landscape').poster,'QA 视频历史 · 本地横竖方',{qaVideoHistory:true,video:get('landscape').video,width:220,height:123.75,videoMetadata:{width:320,height:180,duration:4},currentVideoOptionId:'qa-landscape-fallback',videoHistory:history,versions:[],generation:{model:'QA 本地合成媒体',prompt:'未调用模型，真实本地 MP4 / PNG'}});
 manifest={version:1,nodeId:n.id,synthetic:true,importedAt:Date.now(),sources};
 await window.CanvasStore.readRecord(recordKey);await window.CanvasStore.writeRecord(recordKey,manifest);await saveReadback();
}
button('导入合成 MP4 / PNG 并保存',importMedia);
button('打开正式视频历史',()=>{const n=node();if(!n)throw Error('请先导入');window.VideoHistory.open(n.id);});
button('打开原生帮助 modal',()=>{document.querySelector('#help-dialog').showModal();});
button('打开正式节点菜单',()=>{if(!node()||!window.VideoHistory?.activeId)throw Error('请先打开视频历史');window.CanvasMenus.node(700,160);});
button('回焦正式历史',()=>{const gallery=document.querySelector('.video-history-gallery');if(!gallery)throw Error('请先打开视频历史');gallery.focus({preventScroll:true});});
button('下一次历史解析延迟 3 秒',()=>{if(!node())throw Error('请先导入');delayUntil=performance.now()+10000;});
button('保存并读取真实 IDB',saveReadback);
button('核对 6 个 asset 字节',verifyAssets);
button('刷新只读诊断',refresh);
button('保存后刷新页面',async()=>{await saveReadback();location.reload();});
button('收起 QA 面板',()=>{heading.hidden=true;note.hidden=true;controls.hidden=true;output.hidden=true;expand.hidden=false;panel.style.width='auto';});
const expand=document.createElement('button');expand.textContent='展开视频历史 QA';expand.hidden=true;expand.onclick=()=>{heading.hidden=false;note.hidden=false;controls.hidden=false;output.hidden=false;expand.hidden=true;panel.style.width='330px';refresh();};panel.append(expand);
for(const type of ['pointerdown','keydown'])window.addEventListener(type,event=>{if(type==='keydown'&&event.key!=='Escape')return;const before=window.VideoHistory?.activeId||null,target=event.composedPath?.()[0]||event.target;queueMicrotask(()=>{keep(inputEvents,{at:time(),type,key:event.key,trusted:event.isTrusted,target:target?.getAttribute?.('aria-label')||target?.id||target?.tagName,activeBefore:before,activeAfter:window.VideoHistory?.activeId||null,defaultPrevented:event.defaultPrevented});refresh();});},{capture:true});
document.addEventListener('canvas:render',()=>queueMicrotask(refresh));document.addEventListener('canvas:video-history-open',()=>queueMicrotask(refresh));
const timer=setInterval(refresh,500);window.addEventListener('pagehide',()=>{clearInterval(timer);mutation.disconnect();observers.forEach(observer=>observer.disconnect());},{once:true});
window.VideoHistoryQA={read:diagnostics,refresh,saveReadback};
try{manifest=await window.CanvasStore.readRecord(recordKey);for(const source of manifest?.sources||[]){assetRefs.add(source.video);assetRefs.add(source.poster);}savedReadback=await window.CanvasStore.load();saveStatus=savedReadback?'已有真实 IDB 记录，尚未在此页面主动保存':'此 session 尚未导入';}catch(error){failure=error.message;}refresh();
