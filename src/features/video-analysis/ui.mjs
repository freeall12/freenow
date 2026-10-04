import {prepareWorkflowInputs} from '../agent-workflows/media-transport.mjs';

const app=window.CanvasApp,loading=new Map(),watching=new Map();
const source=n=>n.video||window.EDITOR_DATA?.nodes[n.id]?.video;
const snapshot=n=>({type:n.type,source:source(n),clip:JSON.stringify(n.clip||null)});
const projectId=()=>window.CanvasProjects?.id?.()||'canvas';
const cancelled=()=>new DOMException('已取消','AbortError');
let leaving=false;

async function wait(operation,signal){
  if(signal.aborted)throw signal.reason;
  let abort;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw signal.reason;return operation();}),interrupted]);}
  finally{signal.removeEventListener('abort',abort);}
}
async function metadata(src,signal){
  const video=document.createElement('video');video.preload='metadata';
  try{return await new Promise((resolve,reject)=>{
    let settled=false,timer;
    const abort=()=>finish(signal.reason||cancelled());
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);video.onloadedmetadata=video.onerror=null;error?reject(error):resolve({duration:video.duration,width:video.videoWidth,height:video.videoHeight});};
    timer=setTimeout(()=>finish(Error('获取视频时长失败')),15000);
    video.onerror=()=>finish(Error('获取视频时长失败'));
    video.onloadedmetadata=()=>finish(Number.isFinite(video.duration)&&video.duration>0&&video.videoWidth>0&&video.videoHeight>0?null:Error('获取视频时长失败'));
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}video.src=src;
  });}finally{video.onloadedmetadata=video.onerror=null;video.removeAttribute('src');video.load();}
}
function invalidate(task){
  task.invalidated=true;task.controller.abort(cancelled());
  // A cancelled resolver can still settle later; it must not own a newer attempt.
  if(loading.get(task.id)===task)loading.delete(task.id);
  // Native transport can still be reading an external video after submission.
  // Queued jobs have not dispatched a provider; stop that preparation promptly.
  if(task.jobId&&window.GenerationAPI.getJobs().some(job=>job.id===task.jobId&&job.status==='queued'))window.GenerationAPI.cancel(task.jobId);
}
function isCurrent(task){
  const node=app.getState().nodes.find(n=>n.id===task.id);
  return !leaving&&projectId()===task.project&&!!node&&node.type===task.before.type&&source(node)===task.before.source&&JSON.stringify(node.clip||null)===task.before.clip;
}
export async function analyze(id){
  if(leaving||loading.has(id))return;
  const node=app.getState().nodes.find(n=>n.id===id);if(node?.type!=='video'||!source(node)){app.notify('未找到视频来源');return;}
  const active=window.GenerationAPI.getJobs().find(j=>j.request.kind==='video.analyze'&&j.request.nodeId===id&&(['queued','running','unknown'].includes(j.status)||j.status==='succeeded'&&!j.applied&&!j.applicationError));
  if(active){app.notify(active.status==='unknown'?'解析状态待确认，请先查询已有任务':active.status==='succeeded'?'解析已完成，请先应用已有结果':'正在解析中，预计耗时5-10分钟，请耐心等待。');return;}
  const task={id,controller:new AbortController(),before:snapshot(node),project:projectId(),invalidated:false};
  const clip=structuredClone(node.clip||null),src=source(node),signal=task.controller.signal;
  const guard=()=>{if(task.invalidated||!isCurrent(task)){invalidate(task);throw Error('来源视频已变化，请重新解析');}if(signal.aborted)throw signal.reason;};
  loading.set(id,task);
  const timer=setTimeout(()=>task.controller.abort(Error('视频素材准备超时，请重试')),60000);
  try{
    const availability=await wait(()=>window.GenerationAPI.availability({kind:'video.analyze',signal}),signal);guard();
    if(availability.configured===false){
      app.notify('待连接分镜解析 API，尚未开始解析');
      window.GenerationAPI.configure();
      return {status:'configuration_required'};
    }
    app.notify('正在解析中，预计耗时5-10分钟，请耐心等待。');
    const url=await wait(()=>window.LocalAssets.url(src),signal);guard();
    const info=await metadata(url,signal);guard();
    if(clip&&(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>info.duration))throw Error('视频裁切区间无效，请重新选择');
    const current=app.getState().nodes.find(n=>n.id===id);
    const request={kind:'video.analyze',label:'分镜头解析',nodeId:id,prompt:'',inputs:[{type:'video',url,clip,...info}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:current.x,y:current.y},...info}};
    // Reuse the existing 64 MiB transport budget and abortable Blob/FileReader path.
    const prepared=await prepareWorkflowInputs(request,{signal,baseUrl:document.baseURI,validateSources:guard});guard();
    const latest=app.getState().nodes.find(n=>n.id===id);prepared.parameters.nodePosition={x:latest.x,y:latest.y};
    const targetGuard=()=>{guard();watching.set(id,task);};
    const job=window.GenerationAPI.submitDerived(prepared,{guard:targetGuard,options:{gap:100},didApply:()=>{if(watching.get(id)===task)watching.delete(id);if(!task.invalidated&&isCurrent(task))app.notify('分镜创建成功');}});
    task.jobId=job.id;return job;
  }catch(error){if(!leaving&&!task.invalidated&&error.name!=='AbortError')app.notify(error.message);}
  finally{clearTimeout(timer);if(loading.get(id)===task)loading.delete(id);}
}
document.addEventListener('canvas:render',()=>{
  for(const task of [...loading.values(),...watching.values()])if(!isCurrent(task))invalidate(task);
});
window.CanvasProjects?.registerNavigationGuard?.(()=>loading.size?'视频素材正在准备，请等待完成后再切换画布':null);
window.addEventListener('pagehide',()=>{
  leaving=true;
  for(const task of [...loading.values(),...watching.values()])invalidate(task);
  for(const task of [...watching.values()])if(task.jobId)window.GenerationAPI.cancel(task.jobId);
  watching.clear();
});
window.addEventListener('pageshow',()=>{leaving=false;});
window.GenerationAPI.subscribe(job=>{
  if(job.request.kind!=='video.analyze')return;
  const task=watching.get(job.request.nodeId);
  // submitDerived retries reuse their original guard and emit a new queued identity.
  if(task&&job.status==='queued')task.jobId=job.id;
  if(task?.jobId===job.id&&(['failed','configuration_required','cancelled'].includes(job.status)||job.status==='succeeded'&&(job.applied||job.applicationError)))watching.delete(task.id);
  if(leaving)return;
  if(job.status==='failed')app.notify('分镜创建失败：'+(job.error||'请重试'));
  if(job.status==='configuration_required')app.notify('待连接分镜解析 API，尚未开始解析');
  if(job.status==='cancelled')app.notify('已取消解析');
});
window.VideoAnalysis={analyze};
