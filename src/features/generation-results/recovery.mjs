// Explicit recovery imports never invoke a model or restore lost in-place guards.
export async function importRecoveredOutputs(job,{app,validateMedia,localizeAudio,persist,sourceId=job.request.nodeId}) {
  if(job.request.kind==='image.recognize')throw Error('焦点识别结果绑定原编辑会话，不能作为普通节点恢复');
  const outputs=job.outputs;
  if(job.status!=='succeeded'||!outputs?.length)throw Error('任务尚未返回可恢复的结果');
  if(outputs.some(output=>!['image','video','audio','text'].includes(output.type)))throw Error('该结果需要专用片场应用流程，不能作为普通节点恢复');
  const matching=()=>app.getState().nodes.filter(node=>node.recoveredGeneration?.taskId===job.id);
  const retained=matching();
  if(retained.length){
    const ordered=outputs.map((_,index)=>retained.filter(node=>node.recoveredGeneration.index===index));
    if(retained.length!==outputs.length||ordered.some(nodes=>nodes.length!==1))throw Error('恢复结果曾被修改或部分移除；为避免重复节点，未再次导入');
    job.resultIds=ordered.map(nodes=>nodes[0].id);await persist();return job.resultIds;
  }
  if(job.resultIds?.length)throw Error('上次已创建的恢复节点不再完整，未重复创建');
  await Promise.all(outputs.map(validateMedia));
  const materialized=await Promise.all(outputs.map(async(output,index)=>({...output,
    image:output.image||(output.type==='image'?output.url:output.poster),
    fullImage:output.type==='image'?(output.image||output.url):undefined,
    video:output.video||(output.type==='video'?output.url:undefined),
    audio:output.type==='audio'?await localizeAudio(output.audio||output.url):undefined,
    content:output.text,...(output.type==='text'?{textMode:'pure'}:{}),
    title:output.title||job.request.label||'恢复结果',recoveredGeneration:{taskId:job.id,index},
  })));
  if(!app.getState().nodes.some(node=>node.id===sourceId))throw Error('来源节点已移除，请指定当前画布的连接来源');
  if(matching().length)throw Error('该任务已在其他操作中导入，请重新读取结果');
  const nodes=app.createConnected(sourceId,materialized);job.resultIds=nodes.map(node=>node.id);
  await persist();return job.resultIds;
}

export async function applyRecoveredPlan(job,{app,workflow,validateMedia,persist}){
  if(!job.resultIds?.length){
    if(!workflow?.has(job.id))throw Error('无法验证原结果占位，请选择作为新节点取回');
    job.resultIds=await workflow.apply(job,validateMedia);
  }
  if(!job.resultIds?.length||job.resultIds.some(id=>!app.getState().nodes.some(node=>node.id===id)))throw Error('已经应用的结果节点不再完整，未重新创建');
  // The graph may already have changed when disk persistence fails. Retain IDs
  // and retry only saving the current graph; do not replay cleared placeholders.
  await persist();return job.resultIds;
}
