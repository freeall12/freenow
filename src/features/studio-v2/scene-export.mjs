import {splatObjects} from '../world-node/splat-io.mjs';
import {exportGlb} from './model-io.mjs';

export function sceneFilename(name){
  const safe=String(name||'Scene').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/^\.+|[. ]+$/g,'').replace(/\.(glb|gltf)$/i,'').slice(0,100);
  return (safe||'Scene')+'.glb';
}
export function sceneSize(bytes){return bytes<1e6?(bytes/1e3).toFixed(1)+' KB':(bytes/1e6).toFixed(2)+' MB';}

// Export an immutable document, then recheck the same scene before exposing it.
export async function exportSceneDocument(runtime,{serialize=exportGlb}={}){
  const revision=runtime.revision,content=runtime.content,sessionId=runtime.sessionId;
  const check=()=>{runtime.assertReady();runtime.assertTargetNode();if(runtime.restoring||runtime.motion?.gesture||runtime.transform?.dragging||runtime.capturing)throw Error('正在编辑或拍摄片场，请完成当前操作后导出');if(runtime.revision!==revision||runtime.content!==content||runtime.sessionId!==sessionId)throw Error('场景已更新，本次未导出。请重新导出当前场景');};
  check();if(typeof runtime.content.traverse==='function'&&splatObjects(runtime.content).length)throw Error('此片场含高斯数据，GLB 无法包含完整 SPZ；请下载原 SPZ，片场编辑已保存在本机');await runtime.flush();check();
  const document=runtime.playback.document(),animations=runtime.animations.map(clip=>clip.clone());
  const blob=await serialize(document,animations);check();
  if(!(blob instanceof Blob)||blob.size<20)throw Error('场景导出没有生成有效的 GLB 文件');
  return blob;
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);
  try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export function createSceneExportController(runtime,{saveFile=downloadBlob,onChange=()=>{}}={}){
  let alive=true,busy=false,pending=null,cached=null,error=null,epoch=0;
  const name=()=>runtime.content.name&&runtime.content.name!=='Scene'?runtime.content.name:runtime.hostNode?.title||runtime.content.name||'Scene';
  const snapshot=()=>({revision:runtime.revision,content:runtime.content,sessionId:runtime.sessionId,filename:sceneFilename(name()),epoch});
  const same=(a,b)=>a&&b&&a.revision===b.revision&&a.content===b.content&&a.sessionId===b.sessionId&&a.filename===b.filename&&a.epoch===b.epoch;
  const available=()=>alive&&!runtime.closed&&runtime.loadStatus==='ready'&&!runtime.reloading&&!runtime.exporting&&!runtime.restoring&&!runtime.capturing&&!runtime.motion?.gesture&&!runtime.transform?.dragging&&!!runtime.content.children.length;
  const check=source=>{if(!available())throw Error('场景尚未就绪或正在编辑，未下载文件');runtime.assertTargetNode();if(!same(source,snapshot()))throw Error('场景已更新，本次未下载。请重试导出当前场景');};
  const publish=()=>{if(alive)onChange(api.state());};
  const api={
    state(){const source=snapshot(),current=same(cached?.source,source);return {available:available(),busy,calculating:!!pending&&same(pending.source,source),size:current?cached.blob.size:null,error,filename:source.filename};},
    async prepare(){
      const source=snapshot();check(source);if(same(cached?.source,source))return cached.blob;if(pending&&same(pending.source,source))return pending.promise;
      error=null;const operation={source,promise:null};pending=operation;
      operation.promise=Promise.resolve().then(()=>{check(source);return runtime.export();}).then(blob=>{check(source);cached={source,blob};return blob;}).catch(failure=>{if(alive&&same(source,snapshot()))error=failure.message;throw failure;}).finally(()=>{if(pending===operation)pending=null;publish();});
      publish();return operation.promise;
    },
    async download(){
      if(busy)return null;const source=snapshot();check(source);busy=true;error=null;publish();
      try{const blob=await api.prepare();check(source);await saveFile(blob,source.filename);return {filename:source.filename,size:blob.size};}
      catch(failure){if(alive)error=failure.message;throw failure;}
      finally{busy=false;publish();}
    },
    sync(){if(cached&&!same(cached.source,snapshot()))cached=null;publish();},
    cancel(){epoch++;cached=null;error=null;publish();},
    dispose(){alive=false;cached=null;}
  };
  return api;
}
