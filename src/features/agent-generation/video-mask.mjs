import {editRequest,validateMask,sourceGuard} from '../video-mask/core.mjs';
import {maskedVideoRequestState} from '../video-mask/native-profile.mjs';

export const agentVideoMaskKinds=['video.erase','video.replace'];
const maskHint='请打开视频节点的“添加蒙层”，识别并保存完整时序蒙层后再提交';
const sourceOf=node=>node?.video||globalThis.EDITOR_DATA?.nodes?.[node.id]?.video;
const abort=()=>new DOMException('视频蒙层编辑已取消','AbortError');
const metadataOf=(node,reference)=>JSON.stringify([node?.type,node?.videoMask,node?.trim,reference?.type,reference?.crop,reference?.imageCrop,reference?.clip,reference?.trim]);

// Capture the identities shown during approval without resolving any media.
export function captureAgentVideoMaskApproval(args,{app,signal}={}){
 const nodes=app.getState().nodes,node=nodes.find(value=>value.id===args.nodeId),referenceNode=args.kind==='video.replace'?nodes.find(value=>value.id===args.referenceIds?.[0]):null;
 if(node?.type!=='video'||!sourceOf(node))throw Error('视频蒙层编辑需要真实来源视频节点');
 const reference=referenceNode?{nodeId:referenceNode.id,url:referenceNode.fullImage||referenceNode.image}:undefined;
 const bound=sourceGuard(app,node,{signal,sourceOf,maskAsset:node.videoMask?.asset??null,reference,referenceNode}),metadata=metadataOf(node,referenceNode);
 const guard=()=>{bound();if(metadataOf(node,referenceNode)!==metadata)throw Error('已确认的视频蒙层或替换图片选区已变化，请重新提交');};guard();return guard;
}

async function readSavedMask(asset,{localAssets,fetchImpl,signal,guard}){
 const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new DOMException('保存蒙层读取超时','TimeoutError')),20000);
 const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;let reader,rejectRead;
 const interrupted=new Promise((_,reject)=>{rejectRead=()=>reject(combined.reason);combined.addEventListener('abort',rejectRead,{once:true});if(combined.aborted)rejectRead();});interrupted.catch(()=>{});
 const wait=operation=>Promise.race([Promise.resolve().then(operation),interrupted]);
 try{
  guard();const url=await wait(()=>localAssets.url(asset));guard();
  if(new URL(url).protocol!=='blob:')throw Error('保存蒙层必须来自本机不可变素材，不接受远程蒙层地址');
  const response=await wait(()=>fetchImpl(url,{signal:combined}));guard();if(!response.ok)throw Error('保存蒙层读取失败，请重新识别');
  if(!response.body?.getReader)throw Error('保存蒙层需要有界读取接口');
  reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
  for(;;){const {done,value}=await wait(()=>reader.read());guard();if(combined.aborted)throw combined.reason;if(done)break;size+=value.byteLength;if(size>66*1024*1024)throw Error('保存蒙层超过读取预算');text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();guard();return JSON.parse(text);
 }finally{clearTimeout(timer);combined.removeEventListener('abort',rejectRead);void reader?.cancel().catch(()=>{});reader?.releaseLock();}
}

// Approval is owned by generation_submit. This branch consumes only a saved
// temporal mask; it never segments a rectangle or substitutes a single frame.
export async function submitAgentVideoMask(args,{app,api,localAssets=globalThis.LocalAssets,fetchImpl=(...values)=>fetch(...values),signal,onSubmitted,approvedConfiguration,approvalGuard}={}){
 if(!agentVideoMaskKinds.includes(args.kind)||args.prompt!==''||Object.keys(args).some(key=>!['kind','nodeId','prompt','referenceIds','count'].includes(key))||args.count!==undefined&&args.count!==1)throw Error('视频蒙层编辑只接受固定单结果及空提示词，不忽略额外参数');
 if(typeof approvalGuard!=='function')throw Error('视频蒙层编辑缺少审批来源守卫');approvalGuard();
 const node=app.getState().nodes.find(value=>value.id===args.nodeId),source=sourceOf(node),saved=node?.videoMask;
 if(node?.type!=='video'||!source)throw Error('视频蒙层编辑需要真实来源视频节点');
 if(node.trim!=null)throw Error('当前trim选段不受支持，请先保存为实际视频或使用合法clip后重新识别蒙层');
 if(!saved||typeof saved.asset!=='string'||!saved.asset.startsWith('asset:')||saved.source!==source||saved.clip!==JSON.stringify(node.clip||null))return {nodeId:node.id,status:'mask_required',error:maskHint};
 if(!Number.isSafeInteger(saved.width)||saved.width<1||!Number.isSafeInteger(saved.height)||saved.height<1||!Number.isFinite(saved.duration)||saved.duration<=0||!Number.isFinite(saved.time)||saved.time<0||saved.time>saved.duration)throw Error('保存蒙层元数据无效；'+maskHint);
 const clip=node.clip;if(clip&&(Object.keys(clip).some(key=>!['start','end'].includes(key))||!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>saved.duration+.1))throw Error('视频选段与完整蒙层时间轴不一致；'+maskHint);
 const references=args.referenceIds??[];
 if(args.kind==='video.erase'?references.length!==0:references.length!==1)throw Error('视频移除不接受替换参考；视频替换必须一张图片');
 const referenceNode=args.kind==='video.replace'?app.getState().nodes.find(value=>value.id===references[0]):null;
 if(referenceNode&&(referenceNode.type!=='image'||!(referenceNode.fullImage||referenceNode.image))||args.kind==='video.replace'&&!referenceNode)throw Error('视频替换需要一张真实图片节点');
 if(typeof onSubmitted!=='function'||typeof app.saveProject!=='function'||typeof localAssets?.url!=='function')throw Error('视频蒙层编辑缺少素材或持久回执入口');
 const reference=referenceNode?{nodeId:referenceNode.id,url:referenceNode.fullImage||referenceNode.image}:undefined;
 const bound=sourceGuard(app,node,{signal,sourceOf,maskAsset:saved.asset,reference,referenceNode});
 const snapshot=()=>metadataOf(node,referenceNode),metadata=snapshot();
 const guard=()=>{approvalGuard();bound();if(snapshot()!==metadata)throw Error('保存蒙层或替换图片选区已变化，请重新提交');};
 if(typeof approvedConfiguration!=='string'||typeof api.configurationSnapshot!=='function')throw Error('视频蒙层编辑缺少已批准供应商配置的派发守卫');
 if(approvedConfiguration==='null')return {nodeId:node.id,status:'configuration_required',error:'无法确认视频蒙层编辑供应商配置，请连接已配置的任务服务后重新提交'};
 // TaskService validates sources synchronously before/after input preparation
 // and immediately before provider.generate. A Promise here would be ignored.
 const dispatchGuard=()=>{guard();const configuration=api.configurationSnapshot();if(!configuration||JSON.stringify(configuration)!==approvedConfiguration)throw Error('视频蒙层编辑供应商配置已变化，请重新确认');};
 dispatchGuard();const availability=await api.availability({request:{kind:args.kind},signal});dispatchGuard();
 if(availability?.configured!==true)return {nodeId:node.id,status:'configuration_required',error:availability?.reason||'所选视频蒙层编辑服务尚未配置'};
 const value=await readSavedMask(saved.asset,{localAssets,fetchImpl,signal,guard:dispatchGuard});dispatchGuard();
 if(value?.encoding!=='rle-zero-based-row-major')throw Error('保存蒙层缺少真实完整时序RLE编码；'+maskHint);
 const mask=validateMask(value,saved),request=editRequest(node,args.kind==='video.replace'?'replace':'remove',source,mask,reference);
 if(typeof api.configuration==='function'){const configuration=await api.configuration();dispatchGuard();if(JSON.stringify(configuration)!==approvedConfiguration)throw Error('视频蒙层编辑供应商配置已变化，请重新确认');if(configuration){const state=maskedVideoRequestState(configuration,request);if(!state.ready)return {nodeId:node.id,status:'configuration_required',error:state.reason};}}
 let job,created,createdVideo,ready,failed,abortListener;
 const acknowledgement=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledgement.catch(()=>{});
 const aborted=new Promise((_,reject)=>{abortListener=()=>reject(abort());signal?.addEventListener('abort',abortListener,{once:true});if(signal?.aborted)abortListener();});aborted.catch(()=>{});
 try{
  const completion=api.runInPlace(request,{guard,dispatchGuard,type:'video',apply:async output=>{
   guard();if(!created){created=app.createConnected(node.id,[{...output,video:output.video||output.url,image:output.poster,title:request.label}],{gap:100});createdVideo=created[0]?.video;}
   if(created.length!==1||!app.getState().nodes.includes(created[0]))throw Error('视频编辑结果节点已被移除或替换，未重复创建');
   const result=created[0];if(result.video!==createdVideo)throw Error('视频编辑结果已变化，未覆盖或重复创建');await app.saveProject();guard();
   if(!app.getState().nodes.includes(result)||result.video!==createdVideo)throw Error('视频编辑结果在保存期间已变化');
   return created;
  }},{signal,onSubmitted:async submitted=>{try{job=submitted;dispatchGuard();await onSubmitted(job);dispatchGuard();ready({nodeId:node.id,taskId:job.id,status:job.status});}catch(error){failed(error);throw error;}}});
  const failedCompletion=Promise.resolve(completion).then(()=>{if(!job?.id)throw Error('视频编辑缺少原任务标识，不能重发');return acknowledgement;});failedCompletion.catch(()=>{});
  return await Promise.race([acknowledgement,failedCompletion,aborted]);
 }catch(error){if(job?.id)api.cancel(job.id);throw error;}
 finally{signal?.removeEventListener('abort',abortListener);}
}
