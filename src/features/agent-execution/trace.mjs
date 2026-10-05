const abortError=()=>new DOMException('Aborted','AbortError');
// Automatic generation is not permission to install, rename or remove reusable instructions.
export const needsToolConfirmation=(definition,mode)=>['skills_save','skills_rename','skills_uninstall','video_segment_target','video_segmentation_resume'].includes(definition.name)||definition.mutates&&mode!=='auto';
export const activeTrace=trace=>['pending','running','waiting'].includes(trace.status);

// Reload cannot establish whether an in-flight remote operation took effect.
export function recoverTraces(messages){
 for(const trace of messages){
  if(trace.batchItems)recoverTraces(trace.batchItems);
  for(const task of trace.delegates||[])if(['blocked','unknown','queued','running','waiting'].includes(task.status)){task.status='interrupted';task.error='页面已刷新，子任务执行状态未恢复；没有自动重新调用模型';for(const call of task.calls||[])if(['running','waiting','unknown'].includes(call.status))call.status='interrupted';}
  if(trace.role!=='tool'||!activeTrace(trace))continue;
  const wasPending=['pending','waiting'].includes(trace.status);
  trace.status='interrupted';
  trace.result={error:trace.name==='show_form'?'页面已刷新，此表单未提交。请重新发送需求以继续。':trace.name==='ask_question'?'页面已刷新，此问题未提交回答。请重新发送需求以继续。':wasPending?'页面已刷新，此操作未获确认，未执行。':'页面已刷新，执行结果未恢复；请检查画布或任务状态。'};
 }
}

export async function executeTracedCall(call,{runId,signal,confirm,requestInput,execute,changed,now=Date.now,createId=()=>crypto.randomUUID()}){
 if(signal?.aborted)throw abortError();
 const trace={role:'tool',id:createId(),callId:call.callId,runId,name:call.name,args:structuredClone(call.args),createdAt:now(),status:requestInput?'waiting':confirm?'pending':'running'};
 if(call.originalArgs)trace.originalArgs=structuredClone(call.originalArgs);
 const publish=()=>changed(trace);
 let result;
 try{
  if(confirm){
   publish();
   const decision=await confirm(trace);
   const allowed=typeof decision==='object'&&decision!==null?decision.allowed===true:decision===true;
   if(signal?.aborted)throw abortError();
   if(!allowed){
    trace.status='denied';trace.endedAt=now();trace.result={error:'用户拒绝执行此操作'};publish();
    return {callId:call.callId,result:trace.result};
   }
   if(decision?.args){trace.originalArgs??=structuredClone(trace.args);trace.args=structuredClone(decision.args);}
  }
  if(signal?.aborted)throw abortError();
  trace.status=requestInput?'waiting':'running';trace.startedAt=now();publish();
  result=requestInput?await requestInput(trace):await execute(call.name,trace.args);
  // A stop request cannot undo a tool which actually finished while stopping.
  trace.status=result?.error?'error':'done';
 }catch(error){
  trace.status=error.name==='AbortError'?'cancelled':'error';
  result={error:trace.status==='cancelled'?'本次操作已停止。':error.message||String(error)};
 }
 trace.result=result;trace.endedAt=now();publish();
 if(signal?.aborted||trace.status==='cancelled')throw abortError();
 return {callId:call.callId,result};
}

export function elapsedMs(traces){
 const timed=traces.filter(t=>Number.isFinite(t.startedAt)&&Number.isFinite(t.endedAt)&&t.endedAt>=t.startedAt);
 return timed.length?Math.max(...timed.map(t=>t.endedAt))-Math.min(...timed.map(t=>t.startedAt)):null;
}
export function durationLabel(ms){
 if(!Number.isFinite(ms)||ms<0)return '';
 const seconds=Math.max(1,Math.round(ms/1000)),minutes=Math.floor(seconds/60);
 return minutes?`${minutes}m${seconds%60?`${seconds%60}s`:''}`:`${seconds}s`;
}
