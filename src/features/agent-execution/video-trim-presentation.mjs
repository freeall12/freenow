const names={video_trim:'裁剪本地视频',video_trim_retry_save:'重试保存裁剪结果'};
export const isVideoTrimTool=trace=>Object.hasOwn(names,trace.name);
const basis={node:'当前节点片段（从片段起点计时）',source:'原始视频（从源视频起点计时）'};
const rangeText=range=>Number.isFinite(range?.start)&&Number.isFinite(range?.end)?`${range.start}–${range.end} 秒`:'';

export function videoTrimPresentation(trace){
 const args=trace.args||{},result=trace.result||{},action=names[trace.name],details=[];
 const operationId=args.operationId||result.operationId,requested=trace.name==='video_trim'?args:result.requestedRange;
 if(args.nodeId)details.push('来源视频：'+args.nodeId);
 if(operationId)details.push('操作编号：'+operationId);
 if(rangeText(requested))details.push('裁剪范围：'+rangeText(requested));
 if(requested)details.push('时间基准：'+(basis[requested.timeBasis]||'未指定'));
 if(rangeText(result.sourceRange))details.push('实际源视频范围：'+rangeText(result.sourceRange));
 if(Number.isFinite(result.duration))details.push('结果时长：'+result.duration+' 秒');
 if(Array.isArray(result.nodeIds)&&result.nodeIds.length)details.push('结果节点：'+result.nodeIds.join('、'));
 let state;
 // A created node and a durable save are separate milestones. Tool completion
 // alone proves neither; only the host receipt supplies those facts.
 if(result.applied===true){
  state=result.saved===true?'已裁剪并保存':result.status==='save_failed'?'已裁剪并添加到画布，保存失败':result.status==='saving'?'已裁剪并添加到画布，正在保存':'已裁剪并添加到画布，尚未保存';
 }else if(result.status==='save_failed')state='保存失败，结果应用状态待确认';
 else if(result.status==='cancelled')state='裁剪已取消';
 else if(result.status==='failed'||result.error||trace.status==='error')state='操作失败';
 else if(result.status==='processing')state='正在裁剪';
 else if(result.status==='queued')state='等待裁剪';
 else if(result.status==='saving')state='正在保存，结果应用状态待确认';
 else state={pending:'等待确认',running:trace.name==='video_trim'?'正在裁剪':'正在重试保存',done:'操作已返回，结果状态待确认',denied:'已拒绝',cancelled:'工具已停止',interrupted:'工具已中断，结果状态待确认'}[trace.status]||'结果状态待确认';
 if(result.applied===true&&['cancelled','interrupted'].includes(trace.status))details.push('工具已停止等待，以上结果以实际操作回执为准');
 return{action,label:action+' · '+state,detail:details.join(' · '),icon:'command'};
}
