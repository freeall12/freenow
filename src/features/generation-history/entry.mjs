import {createHistory} from './core.mjs';
import {createArchiver} from './archive.mjs';
import {createImporter} from './apply.mjs';
import {createThumbnailQueue,createThumbnailResources} from './thumbnail-resources.mjs';
let installation;
export async function validateMedia(type, source) {
  const media=type==='image'?new Image():document.createElement('video');
  try { return await new Promise((resolve,reject)=>{
    const finish=(error,value)=>{clearTimeout(timer); error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('历史媒体读取超时')),20000);
    media.onerror=()=>finish(Error('历史媒体无法读取'));
    if(type==='image') media.onload=()=>media.naturalWidth>0&&media.naturalHeight>0?finish(null,{width:media.naturalWidth,height:media.naturalHeight}):finish(Error('历史图片内容无效'));
    else {media.preload='metadata';media.onloadedmetadata=()=>media.videoWidth>0&&media.videoHeight>0&&Number.isFinite(media.duration)?finish(null,{width:media.videoWidth,height:media.videoHeight,duration:media.duration}):finish(Error('历史视频内容无效'));}
    media.src=source;
  }); } finally {media.onload=null;media.onloadedmetadata=null;media.onerror=null;if(type==='video'){media.removeAttribute('src');media.load();}}
}
export function install(options = {}) {
  if (installation) return installation;
  installation=(async()=>{
    const root=options.root || window, project=options.project || root.CanvasProjectContext.resolve(), app=options.app || root.CanvasApp;
    // generation-ui starts this dynamic import before later classic asset
    // scripts have necessarily loaded. Bind dependencies only after parsing,
    // rather than retaining an undefined asset service for the whole project.
    if(!options.assets&&!root.LocalAssets&&root.document?.readyState==='loading')await new Promise(resolve=>root.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    const store=options.store || root.CanvasStore, assets=options.assets || root.LocalAssets, fetcher=options.fetch || root.fetch.bind(root);
    if(typeof assets?.url!=='function'||typeof assets?.put!=='function')throw Error('生成历史的本地素材服务尚未加载，请重试读取');
    const asDataUrl=options.asDataUrl || (blob=>root.LocalMedia.asDataUrl(blob));
    const archive=createArchiver({assets,fetch:fetcher,asDataUrl,validate:options.validate || validateMedia,
      inspectVideo:options.inspectVideo,
      createMediaUrl:options.createMediaUrl,revokeMediaUrl:options.revokeMediaUrl,
      materializeWorld:options.materializeWorld || (async(output,type)=>(await import('../world-node/resource.mjs')).materialize(output,type)),
      localizeAudio:options.localizeAudio || (source=>root.AudioAPI.localize(source))});
    const lookup=options.lookup || (async entry=>{
      const path=entry.remoteTaskId?'/api/generation/tasks/'+encodeURIComponent(entry.remoteTaskId):'/api/generation/tasks/by-key/'+encodeURIComponent(entry.taskId);
      const response=await fetcher(path,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(response.status===404?'原任务尚未找到；未重新生成':'原任务查询失败');
      const result=await response.json();if(entry.remoteTaskId && result.id!==entry.remoteTaskId)throw Error('原任务查询返回了不同标识，历史未修改');return result;
    });
    const history=createHistory({projectId:project.id,store,archive:archive.archive,lookup});
    await history.ready();
    const thumbnailQueue=createThumbnailQueue({limit:2}),backfills=new Map(),thumbnailControllers=new Set();
    const ensureThumbnail=async(row,{signal,force=false}={})=>{
      const current=history.get(row.id) || row;
      if(current.type!=='video'||current.archiveStatus!=='ready'||!force&&(current.thumbnailRef||current.thumbnailStatus==='failed'))return current;
      const key=current.id+':'+current.mediaRef,existing=backfills.get(key);if(existing&&!existing.signal.aborted)return existing.operation;
      const controller=new AbortController();thumbnailControllers.add(controller);const activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      const operation=thumbnailQueue.enqueue(async()=>{const patch=await archive.thumbnail(current,{signal:activeSignal});if(activeSignal.aborted)throw activeSignal.reason;await history.updateThumbnail(current.id,current.mediaRef,patch);return history.get(current.id) || current;},{signal:activeSignal}).finally(()=>{if(backfills.get(key)?.operation===operation)backfills.delete(key);thumbnailControllers.delete(controller);});backfills.set(key,{operation,signal:activeSignal});return operation;
    };
    const unavailableThumbnail=async(row,error)=>{if(row.type==='video')await history.updateThumbnail(row.id,row.mediaRef,{thumbnailRef:null,thumbnailStatus:'failed',thumbnailError:error.message});else await history.markUnavailable(row.id,error);};
    const thumbnailResources=createThumbnailResources({
      load:async(row,signal)=>{const current=await ensureThumbnail(row,{signal});if(signal.aborted)throw signal.reason;if(current.type==='model')return {source:current.worldPatch?.image};if(!current.thumbnailRef)return null;try{return {blob:await archive.blob(current.thumbnailRef,{signal})};}catch(error){if(!signal.aborted)await unavailableThumbnail(current,error);throw error;}},
      createUrl:options.createThumbnailUrl,revokeUrl:options.revokeThumbnailUrl
    });
    const prepare=async row=>{try{return await archive.node(row);}catch(error){await history.markUnavailable(row.id,error);throw error;}};
    // Subscribe before resolving the dispatch gate; application snapshots and
    // provider success share the same idempotent task/output archive.
    const unsubscribe=(options.generation || root.GenerationAPI)?.subscribe(job=>{history.observe(job).catch(error=>app?.notify?.('生成历史保存失败：'+error.message));});
    const persist=async()=>{const state=app.getState();await store.save({version:1,nodes:state.nodes,edges:state.edges},project.id);await store.flush();};
    const importer=createImporter({app,prepare,persist,position:options.position || (()=>{
      const {view}=app.getState(),canvas=document.querySelector('#canvas');return {x:(canvas.clientWidth/2-view.x)/view.scale-187.5,y:(canvas.clientHeight/2-view.y)/view.scale-125};
    })});
    const coreFlush=history.flush.bind(history),coreDiagnostics=history.diagnostics.bind(history),operations=new Set();let importFailure=null;
    const trackApply=execute=>{const operation=execute().then(result=>{importFailure=null;return result;},error=>{if(importer.pending)importFailure=error;throw error;}).finally(()=>operations.delete(operation));operations.add(operation);return operation;};
    const extended=Object.assign(history,{
      apply:rows=>trackApply(()=>importer(rows)),
      retryCanvasSave:()=>trackApply(()=>importer.retrySave()),
      diagnostics:()=>({...coreDiagnostics(),canvasPending:importer.pending,canvasError:importFailure?.message || null}),
      async flush(){do{await Promise.allSettled([...operations]);}while(operations.size);await coreFlush();if(importer.pending)throw Error('已导入的历史素材尚未保存，请在历史面板重试画布保存：'+(importFailure?.message || '保存未完成'));},
      async preview(row){const node=await prepare(row);if(node.type==='world')return (await import('../world-node/resource.mjs')).preview(node);return app.preview(node);},
      async thumbnail(row){if(row.archiveStatus!=='ready')return null;const current=await ensureThumbnail(row);try{if(current.type==='model')return current.worldPatch?.image || null;return current.thumbnailRef?await assets.url(current.thumbnailRef):null;}catch(error){await unavailableThumbnail(current,error);throw error;}},
      acquireThumbnail(row){return thumbnailResources.acquire(row.id+':'+(row.thumbnailRef || row.mediaRef)+':'+(row.thumbnailStatus || ''),row);},
      retryThumbnail(id){const row=history.get(id);if(!row)throw Error('历史视频未找到');return ensureThumbnail(row,{force:true});},
      thumbnailUnavailable:unavailableThumbnail,
      async download(rows){const files=await Promise.all(rows.map(async row=>{if(row.archiveStatus!=='ready')throw Error('素材尚未归档，请先重试');let value;try{value=await archive.blob(row.mediaRef);}catch(error){await history.markUnavailable(row.id,error);throw error;}const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/webm':'webm','model/gltf-binary':'glb'};const extension=extensions[value.type] || (row.type==='model'?'glb':row.type==='video'?'mp4':row.type==='audio'?'mp3':'png');return {blob:value,name:(row.title||row.taskId).replace(/[\\/:*?"<>|\n\r]/g,'_').slice(0,90)+'-'+(row.outputIndex+1)+'.'+extension};}));for(const file of files)root.LocalMedia.download(file.blob,file.name);},
      dispose(){unsubscribe?.();unregister?.();thumbnailResources.dispose();for(const controller of thumbnailControllers)controller.abort(new DOMException('历史资源已关闭','AbortError'));thumbnailQueue.dispose();root.removeEventListener?.('beforeunload',beforeUnload);installation=null;}
    });
    const unregister=root.CanvasProjects?.registerNavigationGuard(async()=>{try{await history.flush();return null;}catch(error){return '历史尚未保存：'+error.message+'。打开历史重试保存或归档后切换项目';}});
    const beforeUnload=event=>{const diagnostics=history.diagnostics();if(operations.size || importer.pending || diagnostics.pending || diagnostics.error || diagnostics.transientLoss || history.list().some(row=>row.archiveStatus==='pending')){event.preventDefault();event.returnValue='';}};
    root.addEventListener?.('beforeunload',beforeUnload);
    // Only saved, same-project receipts may be queried after refresh. This does
    // not call GenerationAPI.recover and therefore never inserts canvas nodes.
    void history.resume();
    return extended;
  })().catch(error=>{installation=null;throw error;});
  return installation;
}
