// Manual migration QA only. This creates a separate empty QA project, so an
// already-installed history instance cannot overwrite the seeded old record.
export async function seedLegacyHistory({root=window,fetchImpl=fetch,validate,createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url),uuid=()=>crypto.randomUUID(),now=Date.now}={}) {
  const url=new URL(root.location.href),session=url.searchParams.get('session') || 'manual',prefix='qa-generation-history:'+encodeURIComponent(session)+':';
  if(url.pathname!=='/qa/generation-history-app.html' || root.CANVAS_DB_NAME!==prefix+'canvas' || root.LOCAL_ASSETS_DB_NAME!==prefix+'assets')throw Error('旧版历史夹具仅允许写入隔离的历史 QA 页面');
  const projectId='qa-legacy-history-'+uuid(),taskId='qa-legacy-task-'+uuid(),recordKey='agent-generation-history:'+projectId;
  if(await root.CanvasStore.readRecord(recordKey))throw Error('此 QA 夹具项目已存在，未覆盖');
  const source=new URL('/qa/video-cut-fixture.mp4',url).href,response=await fetchImpl(source);
  if(!response.ok)throw Error('固定 QA 视频无法读取');const video=await response.blob();if(!video.size)throw Error('固定 QA 视频为空');
  const temporary=createUrl(video);let dimensions;
  try{dimensions=await validate('video',temporary);}finally{revokeUrl(temporary);}
  const mediaRef=await root.LocalAssets.put(video),created=now(),createdAt=new Date(created).toISOString(),title='旧版无缩略图视频（固定 QA 媒体）',kind='video.history-qa';
  const row={id:taskId+':0',projectId,taskId,outputIndex:0,type:'video',kind,title,prompt:'固定本地视频，仅用于旧版历史缩略图迁移验收，不是真实模型生成',model:'qa-local-fixture',parameters:{},createdAt,updatedAt:createdAt,
    source,mediaRef,mime:video.type,bytes:video.size,archiveStatus:'ready',application:{applied:false,applicationError:null,resultIds:[]},...dimensions};
  const receipt={taskId,projectId,createdAt,updatedAt:createdAt,kind,sourceNodeId:null,prompt:row.prompt,parameters:{},status:'succeeded',recoverable:false,outputs:[{type:'video',url:source,title,...dimensions}],application:row.application};
  await root.CanvasStore.save({version:1,project:{id:projectId,title:'旧版视频历史 QA',createdAt:created,updatedAt:created},nodes:[],edges:[],view:{x:0,y:0,scale:1},history:[],future:[]},projectId);
  await root.CanvasStore.writeRecord(recordKey,{version:1,projectId,rows:[row],receipts:[receipt]});await root.CanvasStore.flush();
  url.searchParams.set('project',projectId);return {projectId,recordKey,href:url.href,row};
}
