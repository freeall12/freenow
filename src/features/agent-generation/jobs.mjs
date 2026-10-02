// Keep task state separate from tool completion and never store raw media outputs here.
export function attachGenerationJob(trace,job){
 if(trace.batchItems){let changed=false;for(const item of trace.batchItems)if(attachGenerationJob(item,job))changed=true;return changed;}
 if(!['generation_submit','world_generate','depth_video_convert','depth_video_recast','video_analyze'].includes(trace.name)||!job||(trace.result?.taskId||trace.submittedTaskId)!==job.id)return false;
 const snapshot=Object.fromEntries(['id','status','progress','error','applied','applying','applicationError','applicationStatus','applicationAttempts','resultIds','recovered','recovery','providerStatus','localization'].filter(key=>job[key]!==undefined).map(key=>[key,structuredClone(job[key])]));
 snapshot.hasResultPlan=!!job.request?.parameters?.canvasResults;
 if(JSON.stringify(trace.generationJob)===JSON.stringify(snapshot))return false;
 trace.generationJob=snapshot;return true;
}
export function recoverGenerationJobs(messages,jobs){
 for(const trace of messages){
  if(trace.batchItems){recoverGenerationJobs(trace.batchItems,jobs);continue;}
  if(!['generation_submit','world_generate','depth_video_convert','depth_video_recast','video_analyze'].includes(trace.name)||!(trace.result?.taskId||trace.submittedTaskId))continue;
  const taskId=trace.result?.taskId||trace.submittedTaskId,job=jobs.find(job=>job.id===taskId);
  if(job)attachGenerationJob(trace,job);
  else if(!trace.generationJob||['queued','running'].includes(trace.generationJob.status)||trace.generationJob.applying||trace.generationJob.status==='succeeded'&&!trace.generationJob.applied){trace.generationJob={id:taskId,status:'unknown',error:trace.generationJob?.status==='succeeded'?'结果已生成，但页面刷新后本地应用任务未恢复；请检查已保留的画布结果，勿自动重新生成。':'页面已刷新，生成任务状态未恢复；请检查服务端任务。'};}
 }
}
