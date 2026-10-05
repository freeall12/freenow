import {parameters as enhanceParameters,mediaSource} from '../../../image-enhance-core.mjs';
import {assertEnhanceSourceScope,createEnhanceSourceGuard,enhanceTargetSnapshot} from '../image-skin/source-guard.mjs';
import {createEnhanceResultApplication} from '../image-skin/result-application.mjs';
import {assertMagnificRequest,magnificRequestState} from '../image-upscale/native-profile.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
const nativeState=(configuration,request)=>resolveProviderConfiguration(configuration,request)?.protocol==='magnific-native'?magnificRequestState(configuration,request):{ready:false,reason:'此 Agent Magnific 放大需要已配置的 magnific-native Precision V2 接口，普通任务网关不能授权此原生操作'};

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const controls=['scaleFactor','sharpen','smartGrain','ultraDetail'];
const abort=()=>new DOMException('Magnific 放大已取消','AbortError');
export function agentUpscaleParameters(value){
 if(!plain(value)||Object.keys(value).length!==5||Object.keys(value).some(key=>!['provider',...controls].includes(key))||value.provider!=='magnific'||controls.some(key=>!Number.isInteger(value[key])||value[key]<(key==='scaleFactor'?2:0)||value[key]>(key==='scaleFactor'?8:100)))throw Error('Magnific 放大需要显式 provider、2–8 倍及 0–100 的锐化、智能颗粒、超细节整数，不接受默认值或额外参数');
 return {provider:'magnific',...Object.fromEntries(controls.map(key=>[key,value[key]]))};
}
function validateArgs(args){
 if(!plain(args)||args.kind!=='image.upscale'||typeof args.nodeId!=='string'||!args.nodeId||args.prompt!==''||Object.keys(args).some(key=>!['kind','nodeId','targetNodeId','prompt','upscale','referenceIds','count'].includes(key))||args.count!==undefined&&args.count!==1||args.referenceIds!==undefined&&(!Array.isArray(args.referenceIds)||args.referenceIds.length!==1||args.referenceIds[0]!==args.nodeId)||args.targetNodeId!==undefined&&(typeof args.targetNodeId!=='string'||!args.targetNodeId||args.targetNodeId===args.nodeId))throw Error('Magnific 放大只接受完整来源图、可选独立增强目标、空提示词、显式四参数和一个结果');
 return agentUpscaleParameters(args.upscale);
}
function existingTarget(app,args,source){
 if(args.targetNodeId===undefined)return null;
 const state=app.getState(),target=state.nodes.find(node=>node.id===args.targetNodeId),incoming=state.edges.filter(edge=>edge.target===args.targetNodeId);
 if(target?.type!=='image'||target.tool!=='enhance'||incoming.length!==1||incoming[0].source!==source.id)throw Error('既有 Magnific 目标必须是仅连接此来源图的独立增强节点');
 assertEnhanceSourceScope(target);return target;
}

// Bind source identity and controls without resolving any image bytes before
// the host persists the original submittedTaskId.
export function captureAgentUpscaleApproval(args,{app,signal}={}){
 validateArgs(args);const source=app.getState().nodes.find(node=>node.id===args.nodeId),project=app.projectIdentity().id;
 if(source?.type!=='image'||!mediaSource(source))throw Error('Magnific 放大需要真实完整来源图片节点');assertEnhanceSourceScope(source);
 const target=existingTarget(app,args,source),sourceSnapshot=enhanceTargetSnapshot(source),argsSnapshot=JSON.stringify(args),targetGuard=target?createEnhanceSourceGuard(app,target,source,{signal}):()=>{};
 const checkSource=(candidate=args)=>{
  if(signal?.aborted)throw abort();assertEnhanceSourceScope(source);
  if(app.projectIdentity().id!==project||!app.getState().nodes.includes(source)||enhanceTargetSnapshot(source)!==sourceSnapshot)throw Error('已确认的 Magnific 项目、来源或选区已变化，请重新提交');
  if(JSON.stringify(candidate)!==argsSnapshot)throw Error('已确认的 Magnific 参数或目标已变化，请重新提交');
 };
 const guard=(candidate=args)=>{checkSource(candidate);targetGuard();};guard.checkSource=checkSource;guard();return guard;
}

export async function submitAgentUpscale(args,{app,api,signal,onSubmitted,approvedConfiguration,approvalGuard}={}){
 const parameters=validateArgs(args);
 if(typeof approvalGuard!=='function'||typeof approvalGuard.checkSource!=='function')throw Error('Magnific 放大缺少审批来源与目标守卫');approvalGuard(args);
 const source=app.getState().nodes.find(node=>node.id===args.nodeId);let target=existingTarget(app,args,source),application;
 if(typeof onSubmitted!=='function'||typeof app.saveProject!=='function'||typeof app.updateNode!=='function'||typeof api.runInPlace!=='function'||!target&&typeof app.createConnected!=='function')throw Error('Magnific 放大缺少持久任务回执或增强节点保存入口');
 if(typeof approvedConfiguration!=='string'||typeof api.configurationSnapshot!=='function')throw Error('Magnific 放大缺少已批准供应商配置的派发守卫');
 const guard=()=>{approvalGuard.checkSource(args);if(application)application.guard();else approvalGuard(args);};
 const dispatchGuard=()=>{approvalGuard(args);const configuration=api.configurationSnapshot();if(!configuration||JSON.stringify(configuration)!==approvedConfiguration)throw Error('Magnific 放大供应商配置已变化，请重新确认');};
 const request={kind:'image.upscale',nodeId:target?.id||source.id,sourceNodeId:source.id,label:'Magnific 高清放大',prompt:'',inputs:[{type:'image',role:'source_image',url:mediaSource(source),nodeId:source.id}],parameters};
 const unavailable=reason=>({nodeId:source.id,status:'configuration_required',error:reason||'Magnific 原生服务尚未配置'});
 if(approvedConfiguration==='null')return unavailable('无法确认 Magnific Precision V2 配置，请配置原生接口后重新提交');
 dispatchGuard();let state=nativeState(api.configurationSnapshot(),request);if(!state.ready)return unavailable(state.reason);
 const availability=await api.availability({request,signal});dispatchGuard();if(availability?.configured!==true)return unavailable(availability?.reason);
 const configuration=await api.configuration();dispatchGuard();state=nativeState(configuration,request);if(!state.ready)return unavailable(state.reason);
 let job,submittedTaskId,preparedRequest,ready,failed,abortListener;
 const acknowledgement=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});acknowledgement.catch(()=>{});
 const aborted=new Promise((_,reject)=>{abortListener=()=>reject(abort());signal?.addEventListener('abort',abortListener,{once:true});if(signal?.aborted)abortListener();});aborted.catch(()=>{});
 const verifyRequest=(candidate,current)=>{guard();if(!preparedRequest||current?.id!==submittedTaskId||JSON.stringify(candidate)!==preparedRequest)throw Error('原 Magnific 任务请求、参数或来源已变化，结果未覆盖或重新提交');return true;};
 try{
  const completion=api.runInPlace(request,{guard,dispatchGuard,verifyRequest,type:'image',apply:async output=>{
   guard();const actual=output.fullImage||output.image||output.url;
   if(output.type!=='image'||typeof actual!=='string'||!actual)throw Error('Magnific 任务缺少真实图片结果');
   if(!application){
    const params=enhanceParameters({...target?.params,activeTab:'upscale',upscaleProvider:'magnific',magnificScaleFactor:parameters.scaleFactor,magnificSharpen:parameters.sharpen,magnificSmartGrain:parameters.smartGrain,magnificUltraDetail:parameters.ultraDetail});
    if(!target){const created=app.createConnected(source.id,[{type:'image',title:'增强',tool:'enhance',width:250,height:250,image:null,params}],{gap:100,nodeSize:{width:250,height:250}});if(created.length!==1||!app.getState().nodes.includes(created[0]))throw Error('Magnific 增强目标创建失败，未重复创建');target=created[0];}
    else app.updateNode(target.id,{params});
    approvalGuard.checkSource(args);application=createEnhanceResultApplication({app,node:target,parent:source,label:request.label,parameters,legacyVersions:globalThis.VERSION_DATA?.[target.id]||[]});
   }
   const applied=await application.apply(output);guard();return [applied];
  }},{signal,onSubmitted:async submitted=>{
   try{job=submitted;submittedTaskId=job.id;dispatchGuard();await onSubmitted(job);dispatchGuard();ready({nodeId:source.id,...(target?{targetNodeId:target.id}:{}),taskId:job.id,status:job.status});}catch(error){failed(error);throw error;}
  },onPrepared:prepared=>{
   dispatchGuard();assertMagnificRequest(prepared.request);
   if(prepared.id!==submittedTaskId||prepared.request.nodeId!==request.nodeId||prepared.request.sourceNodeId!==source.id||JSON.stringify(prepared.request.parameters)!==JSON.stringify(parameters)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(prepared.request.inputs[0].url)||['width','height'].some(key=>!Number.isSafeInteger(prepared.request.inputs[0][key])||prepared.request.inputs[0][key]<1))throw Error('Magnific 最终请求与批准来源、四参数或原任务身份不一致，未派发');
   preparedRequest=JSON.stringify(prepared.request);
  }});
  const failedCompletion=Promise.resolve(completion).then(()=>{if(!job?.id)throw Error('Magnific 放大缺少原任务标识，不能重发');return acknowledgement;});failedCompletion.catch(()=>{});
  return await Promise.race([acknowledgement,failedCompletion,aborted]);
 }catch(error){if(job?.id)api.cancel(job.id);throw error;}
 finally{signal?.removeEventListener('abort',abortListener);}
}
