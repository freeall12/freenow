export const imageProcessingKinds=['image.upscale','image.relight','image.multiAngle','image.remove-background'];
const imageProcessingLabels={'image.upscale':'图片超分','image.relight':'重新打光','image.multiAngle':'多角度调整','image.remove-background':'抠图'};
const signature=node=>[node.type,node.image,node.fullImage,JSON.stringify([node.crop,node.imageCrop,node.clip,node.trim,node.params,node.generation,node.settings]),node.prompt];

// The task service resolves asset/blob bytes once using its captured provider.
// Retain the full-resolution source here rather than decoding its thumbnail.
export async function submitAgentImageProcessing(args,{app,api,signal,onSubmitted}={}){
 const allowed=['kind','nodeId','prompt','model','referenceIds','count',...(args.kind==='image.multiAngle'?['rotate_right_left','move_forward','vertical_angle','wide_angle_lens']:args.kind==='image.relight'?['aspect','quality','resolution']:[])];
 if(Object.keys(args).some(key=>!allowed.includes(key)))throw Error('图片处理包含未支持的参数，未忽略后提交');
 const project=app.projectIdentity().id,current=id=>app.getState().nodes.find(node=>node.id===id);
 const source=current(args.nodeId);
 if(!source||source.type!=='image')throw Error('图片处理需要真实图片节点');
 const refs=(args.referenceIds??[source.id]).map(id=>{const node=current(id);if(node?.type!=='image'||!(node.fullImage||node.image))throw Error('图片处理参考必须为真实图片');return node;});
 if(!refs.length||new Set(refs).size!==refs.length)throw Error('图片处理需要不重复的图片参考');
 if(['image.remove-background','image.multiAngle'].includes(args.kind)&&(refs.length!==1||refs[0]!==source||args.count!==undefined&&args.count!==1))throw Error('抠图和多角度处理只接受来源节点的一张完整图片和单个结果');
 if(typeof onSubmitted!=='function')throw Error('图片处理缺少可持久保存的任务回执');
 const snapshots=[...new Set([source,...refs])].map(node=>({node,value:signature(node)}));
 const guard=()=>{
  if(signal?.aborted)throw new DOMException('图片处理已取消','AbortError');
  if(app.projectIdentity().id!==project||snapshots.some(({node,value})=>current(node.id)!==node||signature(node).some((field,index)=>field!==value[index])))throw Error('图片处理项目或来源已修改或替换，请重新提交');
 };
 const request={kind:args.kind,nodeId:source.id,sourceNodeId:source.id,label:imageProcessingLabels[args.kind],prompt:args.prompt,
  inputs:refs.map(node=>({id:node.id,nodeId:node.id,type:'image',url:node.fullImage||node.image})),
  parameters:Object.fromEntries(Object.entries({model:args.model,count:args.count,...(args.kind==='image.relight'?{aspect:args.aspect,quality:args.quality,resolution:args.resolution}:{}),...(args.kind==='image.multiAngle'?{rotate_right_left:args.rotate_right_left,move_forward:args.move_forward,vertical_angle:args.vertical_angle,wide_angle_lens:args.wide_angle_lens}:{})}).filter(([,value])=>value!==undefined))};
 guard();const availability=await api.availability({request,signal});guard();
 if(availability?.configured!==true)return {nodeId:source.id,status:'configuration_required',error:availability?.reason||'无法确认所选图片处理服务已配置，请连接对应接口后重试'};
 let ready,failed;const acknowledged=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledged.catch(()=>{});
 let job,stopped,abortedCleanup;const terminal=new Promise(resolve=>{stopped=resolve;});
 const unsubscribe=api.subscribe(value=>{if(value.id===job?.id&&['failed','cancelled','configuration_required','unknown'].includes(value.status))stopped(value);});
 const aborted=new Promise((_,reject)=>{const abort=()=>reject(new DOMException('图片处理已取消','AbortError'));signal?.addEventListener('abort',abort,{once:true});abortedCleanup=()=>signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();});
 aborted.catch(()=>{});
 try{
  job=api.submitDerived(request,{guard,options:{gap:100},beforeDispatchReady:async context=>{
   try{guard();if(context.jobId!==job?.id)throw Error('图片处理任务身份已变化');await onSubmitted(job);guard();ready();}
   catch(error){failed(error);throw error;}
  }});
  if(!job?.id)throw Error('图片处理任务身份未返回，不能重新提交');
  const outcome=await Promise.race([acknowledged.then(()=>null),terminal,aborted]);guard();
  if(outcome)throw Error(outcome.error||'图片处理任务在回执确认前终止');
  return {nodeId:source.id,taskId:job.id,status:job.status};
 }catch(error){if(job?.id)api.cancel(job.id);throw error;}
 finally{unsubscribe();abortedCleanup?.();}
}
