import {segmentationRequest,validateMask} from '../video-mask/core.mjs';
import {mediaSource} from '../video-creation/core.mjs';
import {transportVideoSource} from '../video-mask/source-transport.mjs';
import {openVideoFrames} from '../video-media/frames.mjs';
import {nativeTasks,refreshConfiguration} from '../video-mask/segmentation.mjs';
import {sourceFingerprint,createReceiptStore,createSegmentationReceipt,assertReceiptCurrent,assertResumeConfiguration,createTaskObservation,createMaskApplication,fingerprintSourceData,taskMessage} from '../video-mask/recovery.mjs';

export const segmentationDisclosure='Replicate SAM2 原生目标识别：读取并上传完整源视频，clip 不缩短上传范围；前向片段及可能的倒序片段最多两次推理，可能分别计费，取消仍可能收费。只保存完整时序蒙层，不执行移除、替换或生成视频。';
// Canvas persistence is a later boundary than provider completion.
export function segmentationResultMessage(status,task){
 const messages={applied:'完整时序蒙层已保存到画布。',save_failed:'完整蒙层尚未确认保存；重试会复用同一蒙层素材，不重新推理。',intent:'原识别意图已保存；查询原 UUID，不重新识别。',unknown:'原识别任务回执未确认；仅查询原 UUID，不重新推理。',existing_task:'节点已保留原识别任务；查询原 UUID，不覆盖或重发。'};
 return messages[status]||task?.message||(task?taskMessage(task):'状态：'+(status||'待核对'));
}
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function captureAgentSegmentationApproval(args,{app,signal}={}){
 const node=app.getState().nodes.find(n=>n.id===args.nodeId),project=app.projectIdentity().id,source=mediaSource(node),snapshot=JSON.stringify(args),fingerprint=sourceFingerprint(node||{}),baseline=JSON.stringify(node?.videoMask??null);
 if(node?.type!=='video'||!mediaSource(node)||node.trim!=null)throw Error('SAM2 需要真实完整视频节点；trim 请先导出为实际视频');
 const guard=(candidate=args)=>{if(signal?.aborted)throw signal.reason??new DOMException('已停止识别','AbortError');if(app.projectIdentity().id!==project||app.getState().nodes.find(n=>n.id===node.id)!==node||sourceFingerprint(node)!==fingerprint||mediaSource(node)!==source||JSON.stringify(node.videoMask??null)!==baseline||JSON.stringify(candidate)!==snapshot)throw Error('已确认的视频、选段、蒙层或识别参数已变化，请重新确认');};guard();return guard;
}
export async function segmentationApprovalConfiguration({signal,loadConfiguration=refreshConfiguration}={}){
 const config=await loadConfiguration({signal});if(config?.configured!==true||config.protocol!=='replicate-sam2-native'||!config.version||!config.providerFingerprint)throw Error('首次目标识别需要已配置且固定版本的原生 Replicate SAM2 服务');return config;
}

// Only this runner creates a task, and only after approval + durable project,
// node receipt and conversation trace. A receipt never permits another create.
export async function executeAgentSegmentation(name,args,{app,localAssets=globalThis.LocalAssets,canvasStore=globalThis.CanvasStore,receiptStore=createReceiptStore(),api=nativeTasks,signal,approvalGuard,approvedConfiguration,onCheckpoint,loadConfiguration=refreshConfiguration,transport=transportVideoSource,openFrames=openVideoFrames,fetchImpl=(...values)=>fetch(...values)}={}){
 const cancelling=name==='video_segmentation_cancel',node=app.getState().nodes.find(n=>n.id===args.nodeId),source=mediaSource(node),projectId=app.projectIdentity().id;
 if(!node||!cancelling&&(node.type!=='video'||!source||typeof app.saveProject!=='function')||typeof onCheckpoint!=='function')throw Error('视频识别缺少真实来源或持久回执入口');
 let receipt=receiptStore.read(projectId,node.id),task;
 const first=name==='video_segment_target',paid=first||name==='video_segmentation_resume';
 if(first&&!uuid(args.operationId)||!first&&!uuid(args.taskId))throw Error('识别操作必须使用原始 UUID');
 if(paid&&(typeof approvalGuard!=='function'||!approvedConfiguration))throw Error('SAM2 上传和计费需要独立明确确认，包括自动模式');
 if(paid)approvalGuard(args);
 if(receipt){if(receipt.taskId!==(first?args.operationId:args.taskId))return {nodeId:node.id,taskId:receipt.taskId,status:'existing_task',error:'节点已保留原识别任务；请查询原 UUID，不会覆盖或重发'};if(first&&(receipt.agentArguments!==JSON.stringify(args)))throw Error('原 UUID 的识别参数不一致，未重发');}
 else if(!first)throw Error('找不到此项目节点的原识别回执；不会创建任务');
 const guard=()=>{if(signal?.aborted)throw signal.reason??new DOMException('已停止查看原任务','AbortError');if(receipt){if(cancelling){const current=receiptStore.read(receipt.projectId,receipt.nodeId);if(app.projectIdentity().id!==receipt.projectId||app.getState().nodes.find(n=>n.id===receipt.nodeId)!==node||current?.taskId!==receipt.taskId||current?.revision!==receipt.revision)throw Error('原取消任务的项目、节点对象或回执已变化，未继续取消');}else assertReceiptCurrent(app,node,receipt,{sourceOf:mediaSource});}};
 const checkpoint=async status=>{guard();await onCheckpoint({protocol:'replicate-sam2-native',id:receipt?.taskId||args.operationId,nodeId:node.id,projectId,status,operationId:receipt?.taskId||args.operationId,modelVersion:receipt?.modelVersion||approvedConfiguration?.version,providerFingerprint:receipt?.providerFingerprint||approvedConfiguration?.providerFingerprint,...(receipt?.maskAsset?{maskAsset:receipt.maskAsset}:{})});guard();};
 const summary=status=>({nodeId:node.id,taskId:receipt.taskId,status,applied:status==='applied',saved:status==='applied',timeline:'full-source',message:segmentationResultMessage(status,task),...(task?{branches:task.branches}:{})});
 try{
  if(first&&!receipt){
   approvalGuard(args);await app.saveProject({beforeCommit:()=>{approvalGuard(args);return true;}});approvalGuard(args);await checkpoint('intent');approvalGuard(args);
   const data=await transport(source,signal,()=>approvalGuard(args),true,{localAssets,fetchImpl});approvalGuard(args);
   let frames;try{frames=await openFrames(data,signal);approvalGuard(args);
    const {width,height,duration}=frames,rect=args.rect;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!Number.isFinite(duration)||duration<=0||!rect||Object.values(rect).some(n=>!Number.isFinite(n))||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>width||rect.y+rect.height>height||args.time<0||args.time>duration)throw Error('选区必须是实际源视频内的像素矩形，提示时间必须在源绝对时间轴内');
    const normalized={x:rect.x/width,y:rect.y/height,width:rect.width/width,height:rect.height/height};if(normalized.width<.02||normalized.height<.02)throw Error('SAM2 提示选区宽高均需至少占完整源视频的 2%');const request=segmentationRequest({nodeId:node.id,source:data,rect:normalized,time:args.time,width,height,duration});
    receipt=createSegmentationReceipt({app,node,source,rect:normalized,time:args.time,configuration:approvedConfiguration,uuid:()=>args.operationId});receipt.agentArguments=JSON.stringify(args);receipt.media={width,height,duration};receipt.inputSha256=await fingerprintSourceData(data);approvalGuard(args);receiptStore.save(receipt);await checkpoint('intent');
    const config=await segmentationApprovalConfiguration({signal,loadConfiguration});approvalGuard(args);assertResumeConfiguration(receipt,config);
    // Persist dispatched uncertainty in the conversation before any create POST.
    await checkpoint('unknown');approvalGuard(args);task=await createTaskObservation({api,store:receiptStore,receipt,guard}).create(request,{signal});
   }finally{frames?.dispose();}
  }else if(name==='video_segmentation_retry_save'){
   guard();if(!receipt.maskAsset||!receipt.media)throw Error('尚无完整本地蒙层结果；请查询原任务，不重新识别');const url=await localAssets.url(receipt.maskAsset);guard();const response=await fetchImpl(url,{signal});guard();if(!response.ok)throw Error('完整本地蒙层读取失败');task={id:receipt.taskId,status:'succeeded',mask:await response.json()};guard();
  }else{
   guard();const observer=createTaskObservation({api:cancelling?{cancel:(taskId,context)=>{guard();return api.cancel(taskId,context);}}:api,store:receiptStore,receipt,guard});
   if(name==='video_segmentation_resume'){approvalGuard(args);assertResumeConfiguration(receipt,approvedConfiguration);const config=await segmentationApprovalConfiguration({signal,loadConfiguration});approvalGuard(args);assertResumeConfiguration(receipt,config);await checkpoint('unknown');approvalGuard(args);task=await observer.resume({signal,configuration:config});}
   else if(name==='video_segmentation_cancel'){task=await observer.cancel({signal});guard();receipt.status=task.status;receiptStore.save(receipt);await checkpoint(task.status);return summary(task.status);}
   else task=await observer.observe({signal});
  }
  if(task&&['preparing','running'].includes(task.status))task=await createTaskObservation({api,store:receiptStore,receipt,guard}).observe({signal,initial:task});
  guard();receipt.status=task.status;receiptStore.save(receipt);await checkpoint(task.status);
  if(task.status!=='succeeded')return summary(task.status);
  if(name!=='video_segmentation_retry_save'&&task.source?.sha256!==receipt.inputSha256)throw Error('完整蒙层回执未绑定原视频实际字节，未应用');
  if(!receipt.media&&task.source){const {width,height,duration}=task.source;if(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0&&Number.isFinite(duration)&&duration>0)receipt.media={width,height,duration};}
  if(!task.mask||!receipt.media)throw Error('原任务没有完整全源蒙层与源元数据，未应用');
  if(!source.startsWith('asset:')){const actual=await transport(source,signal,guard,true,{localAssets,fetchImpl});guard();if(await fingerprintSourceData(actual)!==receipt.inputSha256)throw Error('来源视频实际字节已变化，蒙层未应用');guard();}
  const mask=validateMask(task.mask,receipt.media),application=createMaskApplication({app,node,store:canvasStore,localAssets,receipt,receiptStore,guard,sourceOf:mediaSource});
  await application.apply(mask,receipt.media);guard();receiptStore.save(receipt);await checkpoint('applied');return summary('applied');
 }catch(error){
  if(!receipt)throw error;
  return {...summary(receipt.maskAsset?'save_failed':receipt.dispatched?'unknown':'intent'),applied:false,saved:false,error:error.message,recoveryTool:receipt.maskAsset?'video_segmentation_retry_save':'video_segmentation_recover'};
 }
}
