import {createWorkflowMediaResolver} from './media-resolver.mjs';
import {prepareWorkflowInputs} from './media-transport.mjs';

const failure=(code,message)=>Object.assign(Error(message),{code});
const keyPrefix='tapnow.agent.video-analysis.operations.v1.';
const sourceOf=node=>node.video||globalThis.EDITOR_DATA?.nodes?.[node.id]?.video;
const signature=node=>JSON.stringify([node?.type,node&&sourceOf(node),node?.clip??null,node?.trim??null]);
const cancelled=()=>new DOMException('分镜解析已取消','AbortError');
const terminal=job=>['failed','cancelled','configuration_required','unknown'].includes(job.status)||job.status==='succeeded'&&(job.applied||job.applicationError);

export function videoAnalysisRequest(input){
  if(!input||Object.keys(input).some(key=>!['operationId','nodeId'].includes(key))||['operationId','nodeId'].some(key=>typeof input[key]!=='string'||!input[key].trim()||input[key].length>180))throw failure('invalid_request','分镜解析需要稳定的 operationId 和来源 nodeId');
  return {operationId:input.operationId,nodeId:input.nodeId};
}

// Decode the COMPLETE source stream. A displayed clip remains absolute source
// provenance for the server to apply once; it is not a physical video input.
export async function prepareAgentVideoAnalysisRequest(node,{resolveMedia,signal,validateSources=()=>{},baseUrl=globalThis.document?.baseURI,transport=prepareWorkflowInputs}={}){
  const check=()=>{if(signal?.aborted)throw signal.reason||cancelled();validateSources();};
  check();
  if(node?.type!=='video'||!sourceOf(node))throw failure('invalid_source','来源节点不是可读取的视频');
  if(node.trim!=null)throw failure('invalid_clip','不支持此节点裁剪格式');
  if(typeof resolveMedia!=='function')throw TypeError('resolveMedia adapter is required');
  const clip=structuredClone(node.clip??null),source=sourceOf(node);
  const info=await resolveMedia({id:node.id,type:'video',video:source},{signal});check();
  if(!Number.isFinite(info?.duration)||info.duration<=0||!Number.isInteger(info.width)||info.width<=0||!Number.isInteger(info.height)||info.height<=0||typeof info.url!=='string'||!info.url)throw failure('invalid_source','来源视频缺少实际尺寸、时长或地址');
  if(clip&&(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>info.duration||Object.keys(clip).some(key=>!['start','end'].includes(key))))throw failure('invalid_clip','节点裁切区间超出实际来源视频');
  const request={kind:'video.analyze',label:'分镜头解析',nodeId:node.id,prompt:'',
    inputs:[{type:'video',url:info.url,clip,width:info.width,height:info.height,duration:info.duration}],
    parameters:{operation:'film_scene_breakdown',nodePosition:{x:node.x,y:node.y},width:info.width,height:info.height,duration:info.duration}};
  if(!Number.isFinite(node.x)||!Number.isFinite(node.y))throw failure('invalid_source','来源节点缺少有效世界坐标');
  const prepared=await transport(request,{signal,baseUrl,validateSources:check});check();return prepared;
}

// Operation storage contains identities and receipts only, never video bytes,
// URLs, provider credentials or source contents. Do not evict uncertain records.
export function createAgentVideoAnalysis({app=globalThis.CanvasApp,generationAPI=globalThis.GenerationAPI,localAssets=globalThis.LocalAssets,
  storage=globalThis.localStorage,store=globalThis.CanvasStore,getProjectId=()=>globalThis.CanvasProjects?.id?.()||'canvas',baseUrl=globalThis.document?.baseURI,
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,timeoutMs=60000,
  document=globalThis.document,window=globalThis.window,projects=globalThis.CanvasProjects}={}){
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'GenerationAPI.availability':generationAPI?.availability,'GenerationAPI.submitDerived':generationAPI?.submitDerived,'GenerationAPI.getJobs':generationAPI?.getJobs,'GenerationAPI.subscribe':generationAPI?.subscribe,'GenerationAPI.cancel':generationAPI?.cancel,'storage.getItem':storage?.getItem,'storage.setItem':storage?.setItem,getProjectId,resolveMedia,transport}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw TypeError('timeoutMs must be between 1 and 120000');
  const durable=typeof store?.readRecord==='function'&&typeof store?.writeRecord==='function';
  const active=new Map(),recordsByProject=new Map(),loads=new Map(),writes=new Map(),saveErrors=new Map();let disposed=false,leaving=false,executing=0,pendingWrites=0;
  const project=()=>String(getProjectId()),slot=(p,id)=>JSON.stringify([p,id]);
  const recordKey=p=>'agent-video-analysis-operations:'+p;
  function validate(value,p){
    if(value?.projectId!==undefined&&value.projectId!==p)throw failure('operation_storage_invalid','分镜操作记录项目不匹配，未重新提交');
    if(value?.version!==1||!Array.isArray(value.operations)||value.operations.length>500||value.operations.some(op=>!op||!op.request||op.fingerprint!==JSON.stringify(videoAnalysisRequest(op.request))||typeof op.status!=='string'||op.taskId!==undefined&&typeof op.taskId!=='string')||new Set(value.operations.map(op=>op.request.operationId)).size!==value.operations.length)throw failure('operation_storage_invalid','分镜操作记录无效，未重新提交');
    return value.operations;
  }
  function legacy(p){
    let value;try{const raw=storage.getItem(keyPrefix+encodeURIComponent(p));value=raw?JSON.parse(raw):{version:1,operations:[]};}catch{throw failure('operation_storage_invalid','分镜操作记录不可读取，未重新提交');}
    return validate(value,p);
  }
  async function load(p){
    if(!durable)return legacy(p);
    if(!loads.has(p)){
      const pending=Promise.resolve().then(()=>store.readRecord(recordKey(p))).then(async value=>{
        const records=value===undefined||value===null?legacy(p):validate(value,p);
        // Commit migration before returning a receipt. Never replay an operation
        // because an existing journal could not be read or saved.
        if((value===undefined||value===null)&&records.length)await store.writeRecord(recordKey(p),{version:1,projectId:p,operations:records});
        recordsByProject.set(p,records);return records;
      });
      loads.set(p,pending);pending.catch(()=>{if(loads.get(p)===pending)loads.delete(p);});
    }
    await loads.get(p);return recordsByProject.get(p);
  }
  function write(p,op){
    const fixed={request:op.request,fingerprint:op.fingerprint,status:op.status,...op.taskId?{taskId:op.taskId}:{},...op.error?{error:op.error}:{}};
    pendingWrites++;
    const latest=(writes.get(p)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const records=structuredClone(durable?(await load(p),recordsByProject.get(p)):legacy(p)),index=records.findIndex(value=>value.request.operationId===fixed.request.operationId);
      if(index<0){if(records.length>=500)throw failure('operation_storage_full','分镜操作记录已满，请保留原任务回执，未重新提交');records.push(fixed);}else{
        if(records[index].fingerprint!==fixed.fingerprint||records[index].taskId&&fixed.taskId&&records[index].taskId!==fixed.taskId)throw failure('operation_conflict','已有分镜操作回执不同，未重新提交');
        records[index]=fixed;
      }
      try{if(durable)await store.writeRecord(recordKey(p),{version:1,projectId:p,operations:records});else storage.setItem(keyPrefix+encodeURIComponent(p),JSON.stringify({version:1,operations:records}));}
      catch(cause){throw Object.assign(failure('operation_save_failed','分镜操作记录未能保存'),{cause});}
      if(durable)recordsByProject.set(p,records);saveErrors.delete(p);
    }).catch(error=>{saveErrors.set(p,error);throw error;}).finally(()=>{pendingWrites--;});
    writes.set(p,latest);latest.catch(()=>{});return latest;
  }
  async function flush(){let pending;do{pending=[...writes.values()];await Promise.all(pending);}while(pending.length!==writes.size||pending.some((value,index)=>value!==[...writes.values()][index]));if(saveErrors.size)throw saveErrors.values().next().value;}
  function live(op){return op.taskId&&generationAPI.getJobs().find(job=>job.id===op.taskId);}
  function receipt(op){
    const job=live(op),missing=!!op.taskId&&!job,interrupted=op.restored&&op.status==='preparing'&&!op.taskId;
    return {operationId:op.request.operationId,...op.taskId?{taskId:op.taskId}:{},status:job?.status||(missing||interrupted?'unknown':op.status),
      applied:!!job?.applied,applying:!!job?.applying,applicationStatus:job?.applicationStatus||(missing?'awaiting_recovery':job?.applied?'applied':'pending'),
      resultIds:[...(job?.resultIds||[])],nodeIds:[...(job?.resultIds||[])],
      ...(job?.applicationError?{applicationError:job.applicationError}:{}),...(job?.error||op.error?{error:job?.error||op.error}:{}),
      ...(saveErrors.has(op.project)?{persistenceError:saveErrors.get(op.project).message}:{}),
      ...(missing||job?.status==='unknown'?{recoveryRequired:true,next:'使用 generation_recover 查询原 taskId；未知状态不能重新提交。'}:{}),
      ...(interrupted?{recoveryRequired:true,next:'素材准备时中断且缺少任务身份，请先检查已有生成记录；相同 operationId 不自动重发。'}:{}),
      ...(op.status==='configuration_required'&&!op.taskId?{next:'请连接分镜解析 API 后显式重试本次调用；尚未读取素材或创建任务。'}:{}),
      ...(missing?{previousStatus:op.status}:{}),...(job?.status==='succeeded'&&!job.applied?{next:job.applicationError?'使用 generation_retry_application 重试已有结果应用；不会再调用模型。':'等待结果应用；模型成功不代表画布已保存。'}:{})};
  }
  const unsubscribe=generationAPI.subscribe(job=>{
    for(const op of active.values())if(op.taskId===job.id){
      op.status=job.status;op.error=job.error;
      write(op.project,op).catch(error=>{op.error=error.message;});
      if(terminal(job)){op.stopped?.(job);op.detach?.();delete op.detach;if(job.status!=='unknown'&&!(job.status==='succeeded'&&!job.applied))op.watching=false;}
    }
  });
  const render=()=>{for(const op of active.values())if(op.watching&&!op.isCurrent())op.invalidate?.();};
  const pagehide=()=>{leaving=true;for(const op of active.values())op.cancel?.();};
  const pageshow=()=>{leaving=false;};
  document?.addEventListener('canvas:render',render);
  window?.addEventListener('pagehide',pagehide);window?.addEventListener('pageshow',pageshow);
  const beforeunload=event=>{if(executing||pendingWrites||saveErrors.size){event.preventDefault();event.returnValue='';}};
  window?.addEventListener('beforeunload',beforeunload);
  const unregisterNavigation=projects?.registerNavigationGuard?.(async()=>{
    if(executing||[...active.values()].some(op=>op.preparing))return '视频素材正在准备，请等待完成后再切换画布';
    try{await flush();}catch(error){return error.message+'，请保留此页面并重试保存后再切换画布';}
    return executing||[...active.values()].some(op=>op.preparing)?'视频素材正在准备，请等待完成后再切换画布':null;
  });
  async function start(op,{signal,authorize,onSubmitted}){
    const controller=new AbortController(),abort=()=>{if(controller.signal.aborted&&op.taskId)generationAPI.cancel(op.taskId);controller.abort(signal?.reason||cancelled());};op.cancel=abort;
    // Source invalidation stops queued media work; running providers retain their
    // real receipt while the sticky guard prevents any late local application.
    const stopJob=()=>{if(op.taskId&&(!op.invalidated||live(op)?.status==='queued'))generationAPI.cancel(op.taskId);};
    signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',stopJob,{once:true});if(signal?.aborted)abort();
    op.detach=()=>signal?.removeEventListener('abort',abort);
    let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
    const onAbort=()=>rejectAbort(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>controller.abort(failure('media_timeout','分镜素材准备超时，未重新提交')),timeoutMs);
    const current=()=>app.getState().nodes.find(node=>node.id===op.request.nodeId);
    const node=current(),before=signature(node);
    op.watching=true;
    op.isCurrent=()=>!disposed&&!leaving&&project()===op.project&&current()===node&&signature(current())===before;
    op.invalidate=()=>{op.invalidated=true;controller.abort(failure('source_changed','来源视频、裁切区间或当前画布已变化，未应用结果'));};
    const guard=()=>{if(op.invalidated||!op.isCurrent()){op.invalidate();throw controller.signal.reason;}if(controller.signal.aborted)throw controller.signal.reason;};
    const wait=async fn=>{guard();const value=await Promise.race([Promise.resolve().then(()=>{guard();return fn();}),interrupted]);guard();return value;};
    try{
      guard();await wait(()=>authorize('video_analyze',op.request));
      // availability is provider-level {configured:boolean|null}; only explicit
      // false proves no submission is needed. Native model maps are checked later.
      const availability=await wait(()=>generationAPI.availability({kind:'video.analyze',signal:controller.signal}));
      if(availability.configured===false){op.status='configuration_required';return receipt(op);}
      op.status='preparing';await write(op.project,op);op.committed=true;guard();
      const request=await wait(()=>prepareAgentVideoAnalysisRequest(node,{resolveMedia,signal:controller.signal,validateSources:guard,baseUrl,transport}));
      if(!Number.isFinite(node.x)||!Number.isFinite(node.y))throw failure('invalid_source','来源节点缺少有效世界坐标');
      request.parameters.nodePosition={x:node.x,y:node.y};
      request.agentVideoAnalysis={...op.request};
      let ready,failed;const acknowledged=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledged.catch(()=>{});
      let stopped;const taskStopped=new Promise(resolve=>{stopped=resolve;});op.stopped=stopped;
      const job=generationAPI.submitDerived(request,{guard,options:{gap:100},beforeDispatchReady:async context=>{
        try{
          guard();if(context.jobId!==op.taskId)throw failure('operation_conflict','分镜任务身份发生变化，禁止自动重试派发');
          await wait(()=>authorize('video_analyze',op.request));
          await write(op.project,op);guard();await wait(()=>onSubmitted?.(live(op)));guard();ready();
        }catch(error){failed(error);throw error;}
      }});
      if(!job?.id)throw failure('submission_unknown','分镜提交没有返回任务身份，请核对现有生成任务');
      op.taskId=job.id;op.status=job.status;await write(op.project,op);guard();
      if(terminal(job))stopped(job);
      const outcome=await wait(()=>Promise.race([acknowledged.then(()=>null),taskStopped]));
      if(outcome&&outcome.status!=='configuration_required')throw failure('dispatch_stopped',outcome.error||'分镜任务在派发确认前已终止');
      return receipt(op);
    }catch(error){
      if(op.taskId&&['queued','running'].includes(live(op)?.status))generationAPI.cancel(op.taskId);
      op.status=live(op)?.status||(controller.signal.aborted?'cancelled':'failed');op.error=error.message;
      if(op.committed)try{await write(op.project,op);}catch(persistenceError){error.persistenceError=persistenceError.message;}
      op.detach?.();delete op.detach;throw Object.assign(error,{receipt:receipt(op)});
    }finally{op.preparing=false;delete op.stopped;clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);if(!op.taskId)op.detach?.();if(!op.committed)active.delete(slot(op.project,op.request.operationId));}
  }
  async function executeNow(input,{signal,authorize,onSubmitted}={}){
    if(signal?.aborted)throw signal.reason||cancelled();
    if(disposed||leaving)throw failure('host_closed','分镜工作流宿主已关闭');
    if(typeof authorize!=='function')throw failure('authorization_required','分镜解析缺少本次工具执行的宿主确认');
    const request=videoAnalysisRequest(input),p=project(),id=slot(p,request.operationId),fingerprint=JSON.stringify(request);
    const source=()=>app.getState().nodes.find(node=>node.id===request.nodeId),initialNode=source(),initialSignature=signature(initialNode);
    let changedDuringLoad=false,records;
    const sourceChanged=()=>{if(project()!==p||source()!==initialNode||signature(source())!==initialSignature)changedDuringLoad=true;};
    document?.addEventListener('canvas:render',sourceChanged);
    try{records=await load(p);}finally{document?.removeEventListener('canvas:render',sourceChanged);}
    if(disposed||leaving)throw failure('host_closed','分镜工作流宿主已关闭');
    if(signal?.aborted)throw signal.reason||cancelled();
    if(project()!==p)throw failure('source_changed','当前画布已变化，未重新提交');
    let op=active.get(id)||records.find(value=>value.request.operationId===request.operationId);
    if(op){if(op.fingerprint!==fingerprint)throw failure('operation_conflict','相同 operationId 不能用于不同分镜请求');await authorize('video_analyze',request);if(signal?.aborted)throw signal.reason||cancelled();if(!active.has(id))op={...op,project:p,restored:true};if(saveErrors.has(p))await write(p,op);return op.pending||receipt(op);}
    const existing=generationAPI.getJobs().filter(job=>job.request?.agentVideoAnalysis?.operationId===request.operationId);
    if(existing.length>1)throw failure('ambiguous_operation','发现多个相同分镜操作任务，请先核对生成记录');
    if(existing.length){await authorize('video_analyze',request);if(signal?.aborted)throw signal.reason||cancelled();const job=existing[0];if(JSON.stringify(videoAnalysisRequest(job.request.agentVideoAnalysis))!==fingerprint)throw failure('operation_conflict','已有分镜操作参数不同');op={request,fingerprint,project:p,taskId:job.id,status:job.status};await write(p,op);active.set(id,op);return receipt(op);}
    const other=generationAPI.getJobs().find(job=>job.request?.kind==='video.analyze'&&job.request.nodeId===request.nodeId&&(['queued','running','unknown'].includes(job.status)||job.status==='succeeded'&&!job.applied));
    if(other)throw failure('source_busy','此来源已有分镜任务，请查询或应用原任务：'+other.id);
    sourceChanged();if(changedDuringLoad)throw failure('source_changed','来源视频、裁切区间或当前画布已变化，未重新提交');
    op={request,fingerprint,project:p,status:'checking_configuration',preparing:true};active.set(id,op);
    op.pending=start(op,{signal,authorize,onSubmitted}).finally(()=>{delete op.pending;});return op.pending;
  }
  async function execute(input,options){executing++;try{return await executeNow(input,options);}finally{executing--;}}
  return {execute,flush,get(operationId){const p=project(),id=slot(p,operationId),op=active.get(id)||(durable?recordsByProject.get(p)||[]:legacy(p)).find(value=>value.request.operationId===operationId);return op?receipt({...op,project:p,restored:!active.has(id)}):null;},dispose(){disposed=true;unsubscribe();unregisterNavigation?.();document?.removeEventListener('canvas:render',render);window?.removeEventListener('pagehide',pagehide);window?.removeEventListener('pageshow',pageshow);window?.removeEventListener('beforeunload',beforeunload);for(const op of active.values()){op.cancel?.();op.detach?.();}}};
}
