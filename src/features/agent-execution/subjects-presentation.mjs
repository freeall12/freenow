const actions={subjects_list:'读取主体列表',subjects_read:'读取主体详情',subjects_save:'保存主体',subjects_archive:'归档主体',subjects_apply:'添加主体到画布'};
export const isSubjectsTool=trace=>Object.hasOwn(actions,trace.name);
const known=value=>typeof value==='string'&&value.length>0||typeof value==='number'&&Number.isFinite(value);
const point=value=>Number.isFinite(value?.x)&&Number.isFinite(value?.y)?`(${value.x}, ${value.y})`:'';
const fallback=trace=>({pending:'等待确认',running:'正在处理',done:'操作已返回，结果状态待确认',error:'操作失败',denied:'已拒绝',cancelled:'工具已停止',interrupted:'工具已中断，结果状态待确认'}[trace.status]||'结果状态待确认');

export function subjectsPresentation(trace){
 const args=trace.args||{},result=trace.result||{},subject=result.subject,action=actions[trace.name],details=[];
 const readonly=['subjects_list','subjects_read'].includes(trace.name),name=subject?.name||result.subjectName||args.name,id=subject?.id||result.subjectId||args.id;
 if(name)details.push('主体名称：'+name);
 if(id)details.push('主体编号：'+id);
 if(trace.name==='subjects_save')details.push('操作：'+(args.id?'更新现有主体':'新建主体'));
 if(typeof args.description==='string'&&args.description)details.push('说明：'+args.description);
 if(Array.isArray(args.nodeIds)&&args.nodeIds.length)details.push('来源节点：'+args.nodeIds.join('、'));
 if(known(args.expectedVersion))details.push('确认版本：'+args.expectedVersion);
 if(point(args.position||result.position))details.push('画布位置：'+point(args.position||result.position));
 if(args.operationId||result.operationId)details.push('操作编号：'+(args.operationId||result.operationId));
 if(known(subject?.version))details.push('主体版本：'+subject.version);
 if(Number.isInteger(subject?.assetCount))details.push('素材数量：'+subject.assetCount);
 if(subject?.archived===true)details.push('主体状态：已归档');
 if(Array.isArray(result.nodeIds)&&result.nodeIds.length)details.push('结果节点：'+result.nodeIds.join('、'));
 if(result.replayed===true)details.push('复用历史操作回执，未重复执行');
 if(result.currentMatches===false)details.push(trace.name==='subjects_apply'?'当前导入节点已修改或缺失，与历史导入结果不一致':'当前主体内容已变化，与该操作提交版本不一致');
 if(known(result.committedVersion))details.push('操作提交版本：'+result.committedVersion);
 let state=fallback(trace);
 if(trace.name==='subjects_apply'&&result.applied===true){
  state=result.currentMatches===false?'已有历史导入，当前结果已变化':result.saved===true&&result.status==='succeeded'?'已添加到画布并保存':result.status==='save_failed'?'已添加到画布，保存失败':'已添加到画布，尚未确认保存';
 }else if(['subjects_save','subjects_archive'].includes(trace.name)&&result.saved===true&&result.applied===true&&result.action===trace.name.slice(9)){
  state=result.action==='archive'?'已归档并保存':'已保存';
  if(result.currentMatches===false)state='历史操作'+(result.action==='archive'?'已归档':'已保存')+'，当前主体已变化';
 }else if(result.error||trace.error||trace.status==='error')state='操作失败';
 else if(trace.status==='done'&&trace.name==='subjects_list'&&Array.isArray(result.subjects)){
  state='已读取 '+result.subjects.length+' 个主体';
  if(Number.isInteger(result.total))details.push('主体总数：'+result.total);
  const names=result.subjects.map(item=>item?.name||item?.id).filter(Boolean);if(names.length)details.push('主体：'+names.slice(0,8).join('、')+(names.length>8?' 等 '+names.length+' 个':''));
 }else if(trace.status==='done'&&trace.name==='subjects_read'&&subject?.id)state='已读取主体详情';
 else if(!readonly&&result.saved===false)state='尚未保存';
 if(result.applied===true&&['cancelled','interrupted'].includes(trace.status))details.push('工具已停止等待，以上结果以实际操作回执为准');
 return {action,label:action+(name?' · '+name:'')+' · '+state,detail:details.join(' · '),icon:readonly?'read':trace.name==='subjects_save'?'edit':'command'};
}
