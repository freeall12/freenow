const test=require('node:test'),assert=require('node:assert/strict');
const summary={id:'subject-1',name:'主角',version:'v2',assetCount:2,archived:false};

test('subject execution confirmation shows source nodes, exact position and operation without assuming success',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const save=toolPresentation({name:'subjects_save',status:'pending',args:{operationId:'op-1',name:'主角',nodeIds:['image-1','text-2'],expectedVersion:0}});
 assert.equal(save.icon,'edit');assert.match(save.label,/等待确认/);assert.match(save.detail,/主体名称：主角/);assert.match(save.detail,/操作：新建主体/);assert.match(save.detail,/来源节点：image-1、text-2/);assert.match(save.detail,/确认版本：0/);
 const apply=toolPresentation({name:'subjects_apply',status:'pending',args:{id:'subject-1',expectedVersion:'v2',position:{x:-12.75,y:200.125}}});assert.match(apply.detail,/画布位置：\(-12.75, 200.125\)/);assert.equal(apply.icon,'command');
 for(const name of ['subjects_save','subjects_archive','subjects_apply'])assert.match(toolPresentation({name,status:'done',result:{}}).label,/结果状态待确认/);
});

test('subject read and list use actual returned summaries and read icons',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const list=toolPresentation({name:'subjects_list',status:'done',result:{subjects:[summary],total:8}});assert.equal(list.icon,'read');assert.match(list.label,/已读取 1 个主体/);assert.match(list.detail,/主体总数：8/);assert.match(list.detail,/主体：主角/);
 const read=toolPresentation({name:'subjects_read',status:'done',result:{subject:summary}});assert.equal(read.icon,'read');assert.match(read.label,/主角 · 已读取主体详情/);assert.match(read.detail,/素材数量：2/);
 assert.match(toolPresentation({name:'subjects_read',status:'done',result:{error:'主体不存在'}}).label,/操作失败/);
});

test('subject mutation receipts distinguish current success, historical replay and unsaved canvas changes',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const receipt={subject:summary,operationId:'op-1',action:'save',applied:true,saved:true,replayed:false,currentMatches:true,committedVersion:'v2'};
 assert.match(toolPresentation({name:'subjects_save',status:'done',result:receipt}).label,/已保存/);
 const replay=toolPresentation({name:'subjects_save',status:'done',result:{...receipt,replayed:true,currentMatches:false}});assert.match(replay.label,/历史操作已保存，当前主体已变化/);assert.match(replay.detail,/复用历史操作回执，未重复执行/);
 assert.match(toolPresentation({name:'subjects_archive',status:'done',result:{...receipt,action:'archive',subject:{...summary,archived:true}}}).label,/已归档并保存/);
 const failed={operationId:'apply-1',subjectId:'subject-1',subjectName:'主角',applied:true,saved:false,status:'save_failed',nodeIds:['node-1'],error:'画布保存失败'};
 const applied=toolPresentation({name:'subjects_apply',status:'error',result:failed});assert.match(applied.label,/主角 · 已添加到画布，保存失败/);assert.match(applied.detail,/结果节点：node-1/);
 assert.match(toolPresentation({name:'subjects_apply',status:'done',result:{...failed,status:'succeeded',saved:true,error:undefined}}).label,/已添加到画布并保存/);
 assert.match(toolPresentation({name:'subjects_save',status:'error',result:{saved:false,applied:false,error:'存储空间不足'}}).label,/操作失败/);
});


test('historical import with changed or deleted results is not presented as current canvas success',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const presentation=toolPresentation({name:'subjects_apply',status:'done',result:{applied:true,saved:true,status:'succeeded',currentMatches:false,replayed:true}});
 assert.match(presentation.label,/当前结果已变化/);assert.doesNotMatch(presentation.label,/已添加到画布并保存/);assert.match(presentation.detail,/节点已修改或缺失/);
});
