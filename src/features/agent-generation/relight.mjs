import {anglePresets,brightnessStops,temperatureStops,rimPresets,rimAllowed,requestParameters,parameters as relightValues} from '../../../image-relight-core.mjs';
import {relightRequestState} from '../image-relight/native-profile.mjs';

const fields=['angle','brightnessPercent','temperatureK','rimEnabled','rimPreset'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const metadataOf=node=>JSON.stringify([node.id,node.type,node.image,node.fullImage,node.crop,node.imageCrop,node.clip,node.trim,node.selection,node.imageSelection,node.region,node.metadata,node.relightParameters,node.params,node.generation,node.settings,node.prompt]);
const sourceOf=node=>node?.fullImage||node?.image;
const abort=()=>new DOMException('图片打光已取消','AbortError');

// Agent values must be explicit. The UI core normalizes interactive controls;
// validate first so its defaults cannot silently change an Agent instruction.
export function agentRelightParameters(value){
 if(!plain(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!fields.includes(key)))throw Error('图片打光需要全部五组显式参数，不接受默认值或额外字段');
 if(!plain(value.angle)||Object.keys(value.angle).length!==1||!Object.hasOwn(value.angle,'preset'))throw Error('图片打光只接受标准 angle.preset');
 const angle=anglePresets.find(p=>p.key===value.angle.preset);
 if(!angle||!brightnessStops.includes(value.brightnessPercent)||!temperatureStops.includes(value.temperatureK)||typeof value.rimEnabled!=='boolean'||!Object.hasOwn(rimPresets,value.rimPreset))throw Error('图片打光光位、亮度、色温或轮廓光参数无效');
 if(value.rimEnabled&&!rimAllowed(angle.azimuthDeg,angle.elevationDeg))throw Error('所选主光位不支持轮廓光，请显式关闭轮廓光后重新提交');
 return requestParameters({...value,brightnessLevel:value.brightnessPercent});
}

function validateArgs(args){
 if(!plain(args)||args.kind!=='image.relight'||typeof args.nodeId!=='string'||!args.nodeId||args.prompt!==''||Object.keys(args).some(key=>!['kind','nodeId','prompt','relight','referenceIds','count'].includes(key))||args.count!==undefined&&args.count!==1||args.referenceIds!==undefined&&(!Array.isArray(args.referenceIds)||args.referenceIds.length!==1||args.referenceIds[0]!==args.nodeId))throw Error('图片打光只接受一张来源图、空提示词、完整光照参数和一个结果');
 return agentRelightParameters(args.relight);
}

// Approval captures metadata and object identity only. Media bytes are resolved
// by TaskService after the durable submittedTaskId receipt has been saved.
export function captureAgentRelightApproval(args,{app,signal}={}){
 validateArgs(args);
 const node=app.getState().nodes.find(value=>value.id===args.nodeId),project=app.projectIdentity().id;
 if(node?.type!=='image'||!sourceOf(node))throw Error('图片打光需要真实来源图片节点');
 if(['crop','imageCrop','clip','trim','selection','imageSelection','region'].some(key=>node[key]!=null))throw Error('图片打光只编辑完整来源图，请先将选区导出为实际完整图片');
 const metadata=metadataOf(node),argumentsSnapshot=JSON.stringify(args);
 const guard=(candidate=args)=>{
  if(signal?.aborted)throw abort();
  if(app.projectIdentity().id!==project||!app.getState().nodes.includes(node)||metadataOf(node)!==metadata)throw Error('已确认的图片打光项目、来源或选区已变化，请重新提交');
  if(JSON.stringify(candidate)!==argumentsSnapshot)throw Error('已确认的图片打光参数已变化，请重新提交');
 };
 guard();return guard;
}

export async function submitAgentRelight(args,{app,api,signal,onSubmitted,approvedConfiguration,approvalGuard}={}){
 const parameters=validateArgs(args);
 if(typeof approvalGuard!=='function')throw Error('图片打光缺少审批来源守卫');approvalGuard(args);
 const node=app.getState().nodes.find(value=>value.id===args.nodeId);
 if(node?.type!=='image'||!sourceOf(node))throw Error('图片打光需要真实来源图片节点');
 if(typeof onSubmitted!=='function'||typeof app.saveProject!=='function'||typeof api.runInPlace!=='function')throw Error('图片打光缺少持久任务回执或画布保存入口');
 const guard=captureAgentRelightApproval(args,{app,signal});
 const checkSource=()=>{approvalGuard(args);guard();};
 if(typeof approvedConfiguration!=='string'||typeof api.configurationSnapshot!=='function')throw Error('图片打光缺少已批准供应商配置的派发守卫');
 if(approvedConfiguration==='null')return {nodeId:node.id,status:'configuration_required',error:'无法确认图片打光供应商配置，请连接已配置的任务服务后重新提交'};
 const dispatchGuard=()=>{checkSource();const configuration=api.configurationSnapshot();if(!configuration||JSON.stringify(configuration)!==approvedConfiguration)throw Error('图片打光供应商配置已变化，请重新确认');};
 const request={kind:'image.relight',nodeId:node.id,sourceNodeId:node.id,label:'图片打光',prompt:'',inputs:[{type:'image',url:sourceOf(node),nodeId:node.id,role:'source_image'}],parameters};
 dispatchGuard();
 let state=relightRequestState(api.configurationSnapshot(),request);
 if(!state.ready)return {nodeId:node.id,status:'configuration_required',error:state.reason};
 const availability=await api.availability({request,signal});dispatchGuard();
 if(availability?.configured!==true)return {nodeId:node.id,status:'configuration_required',error:availability?.reason||'所选图片打光服务尚未配置'};
 if(typeof api.configuration==='function'){const configuration=await api.configuration();dispatchGuard();if(JSON.stringify(configuration)!==approvedConfiguration)throw Error('图片打光供应商配置已变化，请重新确认');state=relightRequestState(configuration,request);if(!state.ready)return {nodeId:node.id,status:'configuration_required',error:state.reason};}
 let job,created,createdImage,createdMetadata,createdOutput,ready,failed,abortListener;
 const acknowledgement=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledgement.catch(()=>{});
 const aborted=new Promise((_,reject)=>{abortListener=()=>reject(abort());signal?.addEventListener('abort',abortListener,{once:true});if(signal?.aborted)abortListener();});aborted.catch(()=>{});
 try{
  const completion=api.runInPlace(request,{guard:checkSource,dispatchGuard,type:'image',apply:async output=>{
   checkSource();
   const actual=output.fullImage||output.image||output.url,preview=output.image||output.url||actual,outputSnapshot=JSON.stringify([output.type,output.image,output.fullImage,output.url]);
   if(output.type!=='image'||typeof actual!=='string'||!actual||typeof preview!=='string'||!preview)throw Error('图片打光任务缺少真实图片结果');
   if(created&&outputSnapshot!==createdOutput)throw Error('原图片打光任务结果已变化，未覆盖或重复创建');
   if(!created){created=app.createConnected(node.id,[{...output,image:preview,fullImage:actual,title:request.label,relightParameters:relightValues({...parameters,brightnessLevel:parameters.brightnessPercent})}],{gap:200});createdImage=created[0]?.image;createdMetadata=metadataOf(created[0]);createdOutput=outputSnapshot;}
   if(created.length!==1||!app.getState().nodes.includes(created[0]))throw Error('图片打光结果节点已被移除或替换，未重复创建');
   const result=created[0];if(result.image!==createdImage||metadataOf(result)!==createdMetadata)throw Error('图片打光结果已变化，未覆盖或重复创建');
   await app.saveProject();checkSource();
   if(!app.getState().nodes.includes(result)||result.image!==createdImage||metadataOf(result)!==createdMetadata)throw Error('图片打光结果在保存期间已变化');
   return created;
  }},{signal,onSubmitted:async submitted=>{try{job=submitted;dispatchGuard();await onSubmitted(job);dispatchGuard();ready({nodeId:node.id,taskId:job.id,status:job.status});}catch(error){failed(error);throw error;}}});
  const failedCompletion=Promise.resolve(completion).then(()=>{if(!job?.id)throw Error('图片打光缺少原任务标识，不能重发');return acknowledgement;});failedCompletion.catch(()=>{});
  return await Promise.race([acknowledgement,failedCompletion,aborted]);
 }catch(error){if(job?.id)api.cancel(job.id);throw error;}
 finally{signal?.removeEventListener('abort',abortListener);}
}
