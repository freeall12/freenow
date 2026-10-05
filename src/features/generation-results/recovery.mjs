// Explicit recovery imports never invoke a model or restore lost in-place guards.
import {resultProvenance} from '../media-preview/provenance.mjs';
export async function importRecoveredOutputs(job,{app,validateMedia,localizeAudio,persist,onApplied,sourceId=job.request.nodeId,guard=()=>{}}) {
  guard();
  const save=async()=>{guard();await persist();guard();};
  if(job.request.kind==='image.recognize')throw Error('焦点识别结果绑定原编辑会话，不能作为普通节点恢复');
  const outputs=job.outputs;
  if(job.status!=='succeeded'||!outputs?.length)throw Error('任务尚未返回可恢复的结果');
  if(outputs.some(output=>!['image','video','audio','text'].includes(output.type)))throw Error('该结果需要专用片场应用流程，不能作为普通节点恢复');
  const matching=()=>app.getState().nodes.filter(node=>node.recoveredGeneration?.taskId===job.id);
  const retained=matching();
  if(retained.length){
    const ordered=outputs.map((_,index)=>retained.filter(node=>node.recoveredGeneration.index===index));
    if(retained.length!==outputs.length||ordered.some(nodes=>nodes.length!==1))throw Error('恢复结果曾被修改或部分移除；为避免重复节点，未再次导入');
    guard();job.resultIds=ordered.map(nodes=>nodes[0].id);onApplied?.(job.resultIds,{created:false});await save();guard();return job.resultIds;
  }
  if(job.resultIds?.length)throw Error('上次已创建的恢复节点不再完整，未重复创建');
  guard();await Promise.all(outputs.map(async output=>{guard();await validateMedia(output);guard();}));guard();
  const materialized=await Promise.all(outputs.map(async(output,index)=>{
    guard();const audio=output.type==='audio'?await localizeAudio(output.audio||output.url):undefined;guard();
    return {...output,...resultProvenance(job,output),
    image:output.image||(output.type==='image'?output.url||output.fullImage:output.poster),
    fullImage:output.type==='image'?(output.fullImage||output.image||output.url):undefined,
    video:output.video||(output.type==='video'?output.url:undefined),
    audio,
    content:output.text,...(output.type==='text'?{textMode:'pure'}:{}),
    title:output.title||job.request.label||'恢复结果',recoveredGeneration:{taskId:job.id,index},
  };}));guard();
  if(!app.getState().nodes.some(node=>node.id===sourceId))throw Error('来源节点已移除，请指定当前画布的连接来源');
  if(matching().length)throw Error('该任务已在其他操作中导入，请重新读取结果');
  guard();const nodes=app.createConnected(sourceId,materialized);job.resultIds=nodes.map(node=>node.id);guard();
  // Capture downstream source ownership in the same synchronous turn as the
  // graph mutation, before persistence gives user edits a chance to interleave.
  onApplied?.(job.resultIds,{created:true,audioRefs:materialized.map(output=>output.type==='audio'?output.audio:null)});
  guard();await save();guard();return job.resultIds;
}

export async function applyRecoveredPlan(job,{app,workflow,validateMedia,persist,guard=()=>{}}){
  guard();
  if(!job.resultIds?.length){
    if(!workflow?.has(job.id))throw Error('无法验证原结果占位，请选择作为新节点取回');
    guard();job.resultIds=await workflow.apply(job,async output=>{guard();await validateMedia(output);guard();});guard();
  }
  if(!job.resultIds?.length||job.resultIds.some(id=>!app.getState().nodes.some(node=>node.id===id)))throw Error('已经应用的结果节点不再完整，未重新创建');
  // The graph may already have changed when disk persistence fails. Retain IDs
  // and retry only saving the current graph; do not replay cleared placeholders.
  guard();await persist();guard();return job.resultIds;
}
