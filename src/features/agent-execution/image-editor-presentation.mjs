const actions={image_editor_create:'新建图片编辑文档',image_editor_open:'打开图片编辑器',image_editor_read:'读取图片图层',image_editor_edit:'编辑图片图层',image_editor_export:'导出图片文档',image_editor_save:'保存图片编辑',image_editor_close:'关闭图片编辑器'};
const edits={add:'添加图层',update:'修改图层',remove:'删除图层',reorder:'调整图层顺序',group:'创建图层分组',ungroup:'解组图层',reparent:'跨组移动图层',resize:'调整画板',crop:'裁剪图片图层',erase:'擦除图层内容',pose:'编辑本地姿势',undo:'撤销编辑',redo:'重做编辑'};
export const isImageEditorTool=trace=>Object.hasOwn(actions,trace.name);
export function imageEditorPresentation(trace){
 const args=trace.args||{},result=trace.result||{},action=trace.name==='image_editor_edit'?(edits[args.action]||actions[trace.name]):actions[trace.name];
 const details=[];
 if(args.nodeId||result.nodeId)details.push('文档节点：'+(args.nodeId||result.nodeId));
 if(args.objectId)details.push('图层：'+args.objectId);
 if(args.kind)details.push('类型：'+args.kind);
 if(args.objectIds?.length)details.push('目标图层：'+args.objectIds.join('、'));
 if(args.action==='group'&&result.objectId)details.push('新分组：'+result.objectId);
 if(result.groupedObjectIds?.length)details.push('组内图层（底→顶）：'+result.groupedObjectIds.join('、'));
 if(result.ungroupedObjectId)details.push('已解组：'+result.ungroupedObjectId);
 if(result.releasedObjectIds?.length)details.push('释放图层（底→顶）：'+result.releasedObjectIds.join('、'));
 if(args.action==='reparent'){details.push('目标：'+(args.parentObjectId===null?'画板根层':args.parentObjectId));if(Number.isInteger(args.index))details.push('底到顶插入位置：'+args.index);if(Object.hasOwn(result,'previousParentObjectId'))details.push('原父级：'+(result.previousParentObjectId===null?'画板根层':result.previousParentObjectId));}
 if(args.crop)details.push(`源像素裁剪：(${args.crop.x}, ${args.crop.y}) ${args.crop.width} × ${args.crop.height}`);
 if(args.strokeWidth!==undefined)details.push('橡皮宽度：'+args.strokeWidth+' 画板像素');
 if(args.action==='pose'){details.push(args.objectId?'修改已有姿势图层':'创建姿势图层');if(args.pose?.color)details.push('姿势颜色：'+args.pose.color);if(args.pose?.joints)details.push('姿势源像素关节点：'+Object.keys(args.pose.joints).join('、'));}
 if(args.format)details.push('格式：'+args.format.toUpperCase());
 if(result.filename)details.push('文件：'+result.filename);
 if(Number.isFinite(result.bytes))details.push('字节数：'+result.bytes);
 if(args.sourceNodeId)details.push('图片来源：'+args.sourceNodeId);
 if(args.sourceNodeIds?.length)details.push('关联图片：'+args.sourceNodeIds.join('、'));
 if(Number.isFinite(args.x)&&Number.isFinite(args.y))details.push(`画布世界坐标：(${args.x}, ${args.y})`);
 if(Number.isFinite(args.width)&&Number.isFinite(args.height))details.push(`画板：${args.width} × ${args.height} 像素`);
 if(args.expectedRevision!==undefined)details.push('确认编辑版本：'+args.expectedRevision);
 if(result.revision!==undefined)details.push('当前编辑版本：'+result.revision);
 if(Number.isInteger(result.totalLayers))details.push('图层数：'+result.totalLayers);else if(Array.isArray(result.layers))details.push('本页图层数：'+result.layers.length);
 if(result.dirty===true)details.push('编辑内容尚未保存');
 if(result.currentMatches===false)details.push('当前文档已发生变化，请重新读取');
 if(result.replayed===true)details.push(trace.name==='image_editor_export'?'复用导出回执，未重复请求下载':'复用已有文档，未重复创建');
 let status={pending:'等待确认',running:'正在处理',done:'操作已返回',error:'操作失败',denied:'已拒绝',cancelled:'已停止',interrupted:'结果待核对'}[trace.status]||'结果待核对';
 if(trace.name==='image_editor_save'){
  if(result.saved===true&&result.currentMatches===false)status='历史保存已返回，当前文档已变化';
  else if(result.applied===true)status=result.saved===true?'已保存到画布':'已更新画布，保存未完成';
  else if(result.error||trace.error)status='保存失败';
 }else if(result.error||trace.error)status='操作失败';
 else if(trace.status==='done'&&result.sessionId){
  status=trace.name==='image_editor_read'?'已读取图层':trace.name==='image_editor_open'?'已打开':trace.name==='image_editor_create'?'已创建文档':trace.name==='image_editor_edit'?'已执行编辑':status;
 }
 if(trace.name==='image_editor_export'&&result.status==='download_requested')status=result.replayed?'此前已请求下载，未重复触发':'已请求浏览器下载，落盘待确认';
 if(trace.name==='image_editor_export'&&result.status==='download_unconfirmed')status='下载请求结果不确定，未自动重试';
 if(trace.name==='image_editor_close'&&result.closed===true)status='已关闭';
 return {action,label:action+' · '+status,detail:details.join(' · '),icon:trace.name==='image_editor_read'?'read':'edit'};
}
