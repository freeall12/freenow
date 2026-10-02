const test=require('node:test'),assert=require('node:assert/strict');
const trace=(extra={})=>({name:'video_trim',status:'done',args:{operationId:'trim-1',nodeId:'source-1',start:1.25,end:3.5,timeBasis:'node'},...extra});

test('trim execution describes the requested range and explicit time basis using existing presentation',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const pending=toolPresentation(trace({status:'pending'}));assert.equal(pending.action,'裁剪本地视频');assert.equal(pending.icon,'command');assert.match(pending.label,/等待确认/);
 for(const text of ['来源视频：source-1','操作编号：trim-1','裁剪范围：1.25–3.5 秒','时间基准：当前节点片段（从片段起点计时）'])assert.ok(pending.detail.includes(text));
 assert.match(toolPresentation(trace({args:{start:0,end:2,timeBasis:'source'}})).detail,/原始视频（从源视频起点计时）/);
 assert.match(toolPresentation(trace()).label,/结果状态待确认/);
});

test('trim receipts distinguish applied output from successful saving and preserve readable retry results',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const result={operationId:'trim-1',status:'save_failed',saved:false,applied:true,nodeIds:['trim-output'],duration:2.25,sourceRange:{start:6.25,end:8.5},requestedRange:{start:1.25,end:3.5,timeBasis:'node'},error:'存储不可用'};
 const failed=toolPresentation(trace({status:'error',result}));assert.match(failed.label,/已裁剪并添加到画布，保存失败/);assert.match(failed.detail,/结果节点：trim-output/);assert.match(failed.detail,/结果时长：2.25 秒/);assert.match(failed.detail,/实际源视频范围：6.25–8.5 秒/);
 const saved=toolPresentation({name:'video_trim_retry_save',status:'done',args:{operationId:'trim-1'},result:{...result,status:'succeeded',saved:true,error:undefined}});assert.equal(saved.action,'重试保存裁剪结果');assert.match(saved.label,/已裁剪并保存/);assert.match(saved.detail,/裁剪范围：1.25–3.5 秒/);
 assert.match(toolPresentation(trace({status:'interrupted',result})).detail,/工具已停止等待/);
 assert.doesNotMatch(toolPresentation(trace({result:{status:'succeeded',nodeIds:['unconfirmed']}})).label,/已裁剪并保存/);
 assert.match(toolPresentation(trace({status:'error',result:{status:'cancelled',applied:false,saved:false,error:'裁剪已取消'}})).label,/裁剪已取消/);
});
