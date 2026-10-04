(() => {
 const mediaDisplayReady=window.CanvasResourceDisplayReady||import('./src/features/local-resource-migration/display-media.mjs');mediaDisplayReady.catch(()=>{});
 const asDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
 async function process(operation,blob,{start,end,duration,signal}={}){const query=operation==='trim'?'?'+new URLSearchParams({start,end}):duration?'?'+new URLSearchParams({duration}):'';const response=await fetch('/api/media/'+operation+query,{method:'POST',body:blob,headers:{'Content-Type':blob.type||'application/octet-stream'},signal});if(!response.ok){const error=await response.json();throw Error(error.error||'本地媒体处理失败');}return response.blob();}
 async function trim(node){
  const app=window.CanvasApp,source=()=>node.video||window.EDITOR_DATA?.nodes[node.id]?.video,src=source(),clipStamp=JSON.stringify(node.clip||null),clip=node.clip?structuredClone(node.clip):undefined,projectId=app.projectIdentity?.().id;
  if(!src)throw Error('没有视频源');
  const assertCurrent=()=>{if(app.projectIdentity?.().id!==projectId||app.getState().nodes.find(current=>current.id===node.id)!==node||node.type!=='video'||source()!==src||JSON.stringify(node.clip||null)!==clipStamp)throw Error('来源视频、剪辑或项目已变化，请重新导出');};
  assertCurrent();const policy=await mediaDisplayReady;assertCurrent();
  if(!policy.displayMediaRef(src))throw Error('原站资源已停用，请重新导入本地资源');
  const url=policy.displayMediaRef(await window.LocalAssets.url(src));assertCurrent();
  if(!url)throw Error('原站资源已停用，请重新导入本地资源');
  const response=await fetch(url);assertCurrent();if(!response.ok)throw Error('本地视频源读取失败（'+response.status+'）');
  const blob=await response.blob();assertCurrent();
  const result=await process('trim',blob,clip);assertCurrent();
  const video=await asDataUrl(result);assertCurrent();
  const added=app.createConnected(node.id,[{type:'video',title:'已导出剪辑',image:node.image,video,width:node.width,height:node.height}]);return {blob:result,node:added[0]};
 }

 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 window.LocalMedia={process,trim,asDataUrl,download};
})();
