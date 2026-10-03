import {migrateCanvasSnapshot,originalCanvasResourceDiagnostics} from './snapshot.mjs';
import {validateResourceIndex} from './index-format.mjs';

export function validCanvasSnapshot(value){
  return value?.version===1&&Array.isArray(value.nodes)&&Array.isArray(value.edges)&&
    value.nodes.every(node=>typeof node.id==='string'&&[node.x,node.y,node.width,node.height].every(Number.isFinite)&&node.width>0&&node.height>0)&&
    new Set(value.nodes.map(node=>node.id)).size===value.nodes.length&&
    value.edges.every(edge=>typeof edge.id==='string'&&typeof edge.source==='string'&&typeof edge.target==='string');
}

export async function loadResourceIndex({fetchIndex=globalThis.fetch,indexUrl='/assets/local-resource-index.json'}={}){
  if(typeof fetchIndex!=='function')return {index:null,state:'index_unavailable'};
  let response;
  try{response=await fetchIndex(indexUrl,{cache:'no-store',credentials:'same-origin',mode:'same-origin',redirect:'error'});}
  catch{return {index:null,state:'index_unavailable'};}
  if(!response?.ok)return {index:null,state:response?.status===404?'index_missing':'index_unavailable'};
  try{return {index:validateResourceIndex(await response.json()),state:'ready'};}
  catch{return {index:null,state:'index_invalid'};}
}

// This runs before graph hydration. Only the exact inspected snapshot is written;
// ordinary edits must still be gated by the app's load/readiness boundary.
export async function migrateLoadedCanvas({saved,store,id,indexState,canCommit=()=>true,maxConflicts=2,migrate=migrateCanvasSnapshot}={}){
  if(saved==null)return {snapshot:saved,status:'no_snapshot',persisted:false,summary:null};
  if(!validCanvasSnapshot(saved))throw Error('本地画布数据格式无效');
  const resourceIndex=indexState||{index:null,state:'index_unavailable'};
  let current=saved,conflicts=0;
  const displayStatus=report=>({...report,pendingOriginal:originalCanvasResourceDiagnostics(report.snapshot)});
  const interrupted=summary=>displayStatus({snapshot:current,status:'local_edits',persisted:false,summary:summary||null});
  for(;;){
    if(!canCommit())return interrupted();
    if(resourceIndex.state!=='ready'){const pendingOriginal=originalCanvasResourceDiagnostics(current);return {snapshot:current,status:resourceIndex.state,persisted:false,summary:null,diagnostics:pendingOriginal,pendingOriginal};}
    const result=await migrate(current,{index:resourceIndex.index});
    const diagnostics=result.unresolved.map(({path,code})=>({path,code}));
    if(!canCommit())return interrupted(result.summary);
    if(!result.changes.length)return displayStatus({snapshot:current,status:result.unresolved.length?'pending_import':'ready',persisted:false,summary:result.summary,diagnostics});
    try{
      await store.save(result.snapshot,id,{preserveSnapshot:true,beforeCommit:canCommit});
      if(!canCommit())return displayStatus({snapshot:result.snapshot,status:'local_edits',persisted:true,summary:result.summary,diagnostics});
      return displayStatus({snapshot:result.snapshot,status:result.unresolved.length?'pending_import':'ready',persisted:true,summary:result.summary,diagnostics});
    }catch(error){
      // The app must handle this explicitly; silently hydrating a pre-edit
      // snapshot after the transaction gate refused it would erase local edits.
      if(error?.name==='CanvasSnapshotChangedError'||!canCommit())return interrupted(result.summary);
      if(error?.name!=='CanvasProjectConflictError'||conflicts>=maxConflicts)throw error;
      conflicts++;
      current=await store.load(id);
      if(!validCanvasSnapshot(current))throw Error('资源迁移冲突后读取的画布数据无效');
    }
  }
}

export function migrationNoticeText(report){
  const count=report?.summary?.unresolved||0;
  if(report?.status==='index_missing')return '本地资源迁移待修复：资源索引尚未生成，已有引用已保留；原站媒体显示待导入占位。';
  if(report?.status==='index_invalid')return '本地资源迁移待修复：资源索引格式无效，已有引用已保留；原站媒体显示待导入占位。';
  if(report?.status==='index_unavailable')return '本地资源迁移待修复：资源索引暂时无法读取，已有引用已保留；原站媒体显示待导入占位。';
  if(report?.status==='local_edits')return '本地资源迁移已暂停：当前画布已有新修改，原有引用已保留。';
  if(report?.status==='migration_failed')return '本地资源迁移尚未保存：读取或保存失败，已停止恢复以保护原有画布。';
  if(count)return `本地资源迁移待修复：${count} 项媒体引用没有可确认的本地资源，已保留原引用；原站媒体显示待导入占位。请导入本地素材后替换。`;
  return '';
}

export function diagnosticLabel({path,code}={}){
  const history=typeof path==='string'&&path.match(/^\$\.(history|future)\[(\d+)\]\.nodes\[(\d+)\]/);
  const node=typeof path==='string'&&path.match(/^\$\.nodes\[(\d+)\]/);
  let label=history?`${history[1]==='history'?'撤销':'重做'}历史 ${Number(history[2])+1} · 节点 ${Number(history[3])+1}`:node?`当前画布 · 节点 ${Number(node[1])+1}`:'历史媒体';
  const fields={image:'图片',fullImage:'原始图片',video:'视频',audio:'音频',poster:'封面',thumbnail:'缩略图',src:'图层图片',sourceUrl:'模型资源',panoUrl:'全景图'};
  const field=typeof path==='string'&&path.match(/\.([A-Za-z]+)$/)?.[1];
  if(fields[field])label+=' · '+fields[field];
  return label+(code==='transient_blob'?'：临时媒体需重新导入':'：需导入本地素材');
}

export function showMigrationNotice(report,{document=globalThis.document}={}){
  const message=migrationNoticeText(report);
  let notice=document.querySelector('#resource-migration-notice');
  if(!message){notice?.remove();return;}
  if(!document.querySelector('#resource-migration-style')){
    const style=document.createElement('link');style.id='resource-migration-style';style.rel='stylesheet';style.href='src/features/local-resource-migration/styles.css';document.head.append(style);
  }
  if(!notice){notice=document.createElement('div');notice.id='resource-migration-notice';notice.className='resource-migration-notice';notice.setAttribute('role','status');document.body.append(notice);}
  notice.dataset.status=report.status;notice.textContent=message;
  if(report.diagnostics?.length){
    const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');summary.textContent='查看待修复位置';details.append(summary);
    for(const diagnostic of report.diagnostics.slice(0,20)){const item=document.createElement('li');item.textContent=diagnosticLabel(diagnostic);list.append(item);}
    if(report.diagnostics.length>20){const item=document.createElement('li');item.textContent=`另有 ${report.diagnostics.length-20} 项待修复`;list.append(item);}
    details.append(list);notice.append(details);
  }
}
