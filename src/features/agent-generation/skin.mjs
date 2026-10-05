import {modes,parameters as enhanceParameters,mediaSource} from '../../../image-enhance-core.mjs';
import {assertEnhanceSourceScope,createEnhanceSourceGuard} from '../image-skin/source-guard.mjs';
import {createEnhanceResultApplication} from '../image-skin/result-application.mjs';
import {skinRequestState,assertSkinRequest} from '../image-skin/native-profile.mjs';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sourceSnapshot=node=>JSON.stringify([node.id,node.type,node.image,node.fullImage,node.crop,node.imageCrop,node.clip,node.trim,node.selection,node.imageSelection,node.region,node.metadata,node.params,node.generation,node.settings,node.prompt,node.provenance]);
const abort=()=>new DOMException('皮肤增强已取消','AbortError');

export function agentSkinParameters(value){
 if(!plain(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'mode')||!modes.some(([mode])=>mode===value.mode))throw Error('皮肤增强需要显式 skin.mode：detailed、standard 或 heavy，不接受默认值或额外参数');
 return {mode:value.mode};
}
function validateArgs(args){
 if(!plain(args)||args.kind!=='image.skin'||typeof args.nodeId!=='string'||!args.nodeId||args.prompt!==''||Object.keys(args).some(key=>!['kind','nodeId','targetNodeId','prompt','skin','referenceIds','count'].includes(key))||args.count!==undefined&&args.count!==1||args.referenceIds!==undefined&&(!Array.isArray(args.referenceIds)||args.referenceIds.length!==1||args.referenceIds[0]!==args.nodeId)||args.targetNodeId!==undefined&&(typeof args.targetNodeId!=='string'||!args.targetNodeId||args.targetNodeId===args.nodeId))throw Error('皮肤增强只接受完整来源图、可选独立增强目标、空提示词、显式模式和一个结果');
 return agentSkinParameters(args.skin);
}
function existingTarget(app,args,source){
 if(args.targetNodeId===undefined)return null;
 const state=app.getState(),target=state.nodes.find(node=>node.id===args.targetNodeId),incoming=state.edges.filter(edge=>edge.target===args.targetNodeId);
 if(target?.type!=='image'||target.tool!=='enhance'||incoming.length!==1||incoming[0].source!==source.id)throw Error('既有皮肤增强目标必须是仅连接此来源图的独立增强节点');
 assertEnhanceSourceScope(target);return target;
}

// Approval binds identities and intent only. Full source bytes are read by
// TaskService after the host has committed its original submittedTaskId.
export function captureAgentSkinApproval(args,{app,signal}={}){
 validateArgs(args);
 const source=app.getState().nodes.find(node=>node.id===args.nodeId),project=app.projectIdentity().id;
 if(source?.type!=='image'||!mediaSource(source))throw Error('皮肤增强需要真实完整来源图片节点');assertEnhanceSourceScope(source);
 const target=existingTarget(app,args,source),metadata=sourceSnapshot(source),argumentsSnapshot=JSON.stringify(args);
 const targetGuard=target?createEnhanceSourceGuard(app,target,source,{signal}):()=>{};
 const checkSource=(candidate=args)=>{
  if(signal?.aborted)throw abort();
  assertEnhanceSourceScope(source);
  if(app.projectIdentity().id!==project||!app.getState().nodes.includes(source)||sourceSnapshot(source)!==metadata)throw Error('已确认的皮肤增强项目、来源或选区已变化，请重新提交');
  if(JSON.stringify(candidate)!==argumentsSnapshot)throw Error('已确认的皮肤增强参数或目标已变化，请重新提交');
 };
 const guard=(candidate=args)=>{checkSource(candidate);targetGuard();};guard.checkSource=checkSource;guard();return guard;
}

export async function submitAgentSkin(args,{app,api,signal,onSubmitted,approvedConfiguration,approvalGuard}={}){
 const parameters=validateArgs(args);
 if(typeof approvalGuard!=='function'||typeof approvalGuard.checkSource!=='function')throw Error('皮肤增强缺少审批来源与目标守卫');approvalGuard(args);
 const source=app.getState().nodes.find(node=>node.id===args.nodeId);let target=existingTarget(app,args,source),application;
 if(typeof onSubmitted!=='function'||typeof app.saveProject!=='function'||typeof app.updateNode!=='function'||typeof api.runInPlace!=='function'||!target&&typeof app.createConnected!=='function')throw Error('皮肤增强缺少持久任务回执或增强节点保存入口');
 if(typeof approvedConfiguration!=='string'||typeof api.configurationSnapshot!=='function')throw Error('皮肤增强缺少已批准供应商配置的派发守卫');
 if(approvedConfiguration==='null')return {nodeId:source.id,status:'configuration_required',error:'无法确认皮肤增强服务配置，请连接声明完整三档模式的服务后重新提交'};
 const checkSource=()=>approvalGuard.checkSource(args);
 const guard=()=>{checkSource();if(application)application.guard();else approvalGuard(args);};
 const dispatchGuard=()=>{approvalGuard(args);const configuration=api.configurationSnapshot();if(!configuration||JSON.stringify(configuration)!==approvedConfiguration)throw Error('皮肤增强供应商配置已变化，请重新确认');};
 const request={kind:'image.skin',nodeId:target?.id||source.id,sourceNodeId:source.id,label:'皮肤增强',prompt:'',inputs:[{type:'image',url:mediaSource(source),nodeId:source.id,role:'source_image'}],parameters};
 dispatchGuard();let state=skinRequestState(api.configurationSnapshot(),request);
 if(!state.ready)return {nodeId:source.id,status:'configuration_required',error:state.reason};
 const availability=await api.availability({request,signal});dispatchGuard();
 if(availability?.configured!==true)return {nodeId:source.id,status:'configuration_required',error:availability?.reason||'皮肤增强服务尚未配置'};
 const configuration=await api.configuration();dispatchGuard();state=skinRequestState(configuration,request);
 if(!state.ready)return {nodeId:source.id,status:'configuration_required',error:state.reason};
 let job,submittedTaskId,preparedRequest,ready,failed,abortListener;
 const verifyRequest=(candidate,current)=>{guard();if(!preparedRequest||current?.id!==submittedTaskId||JSON.stringify(candidate)!==preparedRequest)throw Error('原皮肤增强任务请求、模式或来源已变化，结果未覆盖或重新提交');return true;};
 const acknowledgement=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledgement.catch(()=>{});
 const aborted=new Promise((_,reject)=>{abortListener=()=>reject(abort());signal?.addEventListener('abort',abortListener,{once:true});if(signal?.aborted)abortListener();});aborted.catch(()=>{});
 try{
  const completion=api.runInPlace(request,{guard,dispatchGuard,verifyRequest,type:'image',apply:async output=>{
   guard();
   const actual=output.fullImage||output.image||output.url;
   if(output.type!=='image'||typeof actual!=='string'||!actual)throw Error('皮肤增强任务缺少真实图片结果');
   if(!application){
    if(!target){const created=app.createConnected(source.id,[{type:'image',title:'增强',tool:'enhance',width:250,height:250,image:null,params:enhanceParameters({activeTab:'realistic-portrait',mode:parameters.mode})}],{gap:100,nodeSize:{width:250,height:250}});if(created.length!==1||!app.getState().nodes.includes(created[0]))throw Error('皮肤增强目标创建失败，未重复创建');target=created[0];}
    else app.updateNode(target.id,{params:enhanceParameters({...target.params,activeTab:'realistic-portrait',mode:parameters.mode})});
    checkSource();application=createEnhanceResultApplication({app,node:target,parent:source,label:request.label,parameters,legacyVersions:globalThis.VERSION_DATA?.[target.id]||[]});
   }
   const applied=await application.apply(output);guard();return [applied];
  }},{signal,onSubmitted:async submitted=>{try{job=submitted;submittedTaskId=job.id;dispatchGuard();await onSubmitted(job);dispatchGuard();ready({nodeId:source.id,...(target?{targetNodeId:target.id}:{}),taskId:job.id,status:job.status});}catch(error){failed(error);throw error;}},onPrepared:prepared=>{
   dispatchGuard();assertSkinRequest(prepared.request);
   if(prepared.id!==submittedTaskId||prepared.request.nodeId!==request.nodeId||prepared.request.sourceNodeId!==source.id||JSON.stringify(prepared.request.parameters)!==JSON.stringify(parameters)||!prepared.request.inputs[0].url.startsWith('data:image/png;base64,'))throw Error('皮肤增强最终请求与批准来源、模式或原任务身份不一致，未派发');
   // Bind the fully materialized wire, so a task-tray recovery cannot replace
   // mode or source bytes while keeping the original live node identities.
   preparedRequest=JSON.stringify(prepared.request);
  }});
  const failedCompletion=Promise.resolve(completion).then(()=>{if(!job?.id)throw Error('皮肤增强缺少原任务标识，不能重发');return acknowledgement;});failedCompletion.catch(()=>{});
  return await Promise.race([acknowledgement,failedCompletion,aborted]);
 }catch(error){if(job?.id)api.cancel(job.id);throw error;}
 finally{signal?.removeEventListener('abort',abortListener);}
}
