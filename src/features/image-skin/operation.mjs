import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
import {assertEnhanceSourceScope,createEnhanceSourceGuard,createEnhanceConfigurationGuard} from './source-guard.mjs';
import {createEnhanceResultApplication} from './result-application.mjs';
import {skinRequestState} from './native-profile.mjs';

export async function enhanceReadiness(api,request,{signal,guard=()=>{},requestState}={}){
 const available=await api.availability({request,signal});guard();
 const metadata=await api.configuration();guard();
 const status=metadata?providerConfigurationStatus(metadata,request):null,selected=resolveProviderConfiguration(metadata,request);
 const describe=requestState||(request.kind==='image.skin'?skinRequestState:null);
 const state=describe?describe(metadata,request):{ready:available.configured===true&&(!status||status.configured===true),reason:status?.configured===true?'':status?.message||available.reason||'',label:available.configured===true?'服务已配置':'服务待配置',hint:selected?.protocol==='tasks-v1'?'任务网关已配置；高清放大能力须由网关实现。':'配置就绪后可生成，效果以实际结果为准。'};
 if(available.configured!==true){state.ready=false;state.reason=available.reason||state.reason||'增强服务尚未配置';state.label='服务待配置';}
 return {...state,metadata};
}

export function createEnhanceOperation({app,api,node,parent,request,isAlive=()=>true,changed=()=>{},requestState,legacyVersions=[]}){
 const controller=new AbortController(),prepareGuard=createEnhanceSourceGuard(app,node,parent,{signal:controller.signal,isAlive,requireSelection:true});
 const result=createEnhanceResultApplication({app,node,parent,label:request.label,parameters:request.parameters,legacyVersions});
 const operation={status:'preparing',error:null,jobId:null,dispatched:false,controller};
 const guard=()=>operation.dispatched?result.guard():prepareGuard();
 const job=()=>api.getJobs().find(job=>job.id===operation.jobId);
 const update=state=>{Object.assign(operation,state);changed(operation);};
 let unsubscribe,preparedRequest;
 const verifyRequest=(candidate,current)=>{result.guard();if(!preparedRequest||current?.id!==operation.jobId||JSON.stringify(candidate)!==preparedRequest)throw Error('原增强任务请求或来源已变化，结果未覆盖或重新提交');return true;};
 const reflect=()=>{const current=job();if(!current)return;
  if(current.status==='unknown')update({status:'unknown',error:current.error||'生成状态待确认，请查询原任务；不会重复提交'});
  else if(operation.dispatched&&['queued','running'].includes(current.status))update({status:'running',error:null});
  else if(current.status==='succeeded'&&current.applicationError)update({status:result.applied?'application_failed':'failed',error:current.applicationError});
  else if(current.status==='succeeded'&&current.applied){update({status:'succeeded',error:null});unsubscribe?.();}
  else if(['failed','cancelled','configuration_required'].includes(current.status)){update({status:'failed',error:current.error||'增强任务已取消'});unsubscribe?.();}
 };
 operation.run=async()=>{
  if(operation.started)return operation;
  operation.started=true;
  try{
   guard();if(request.kind==='image.skin'||request.kind==='image.upscale'&&request.parameters?.provider==='magnific'){assertEnhanceSourceScope(parent);assertEnhanceSourceScope(node);}
   const readiness=await enhanceReadiness(api,request,{signal:controller.signal,guard,requestState});guard();operation.readiness=readiness;
   if(!readiness.ready)throw Error(readiness.reason||'增强服务尚未配置');
   const configurationGuard=createEnhanceConfigurationGuard(api,readiness.metadata);
   unsubscribe=api.subscribe(current=>{if(current.id===operation.jobId)reflect();});
   await api.runInPlace(request,{type:'image',guard,dispatchGuard:configurationGuard,verifyRequest,apply:output=>{guard();update({status:'saving'});return result.apply(output);}},{signal:controller.signal,onSubmitted:submitted=>{operation.jobId=submitted.id;},onPrepared:prepared=>{guard();configurationGuard();preparedRequest=JSON.stringify(prepared.request);operation.dispatched=true;update({status:'running'});}});
   update({status:'succeeded',error:null});unsubscribe?.();
  }catch(error){reflect();if(!['unknown','application_failed','failed'].includes(operation.status))update({status:'failed',error:error.name==='AbortError'?'增强准备已取消':error.message});if(!['unknown','application_failed'].includes(operation.status))unsubscribe?.();}
  return operation;
 };
 operation.cancelPreparation=()=>{if(!operation.dispatched)controller.abort(new DOMException('增强准备已取消','AbortError'));};
 operation.retryApplication=async()=>{
  if(operation.status!=='application_failed'||!operation.jobId)return operation;
  update({status:'saving',error:null});
  try{result.guard();const receipt=await api.retryApplication(operation.jobId);if(!receipt.applied)throw Error(receipt.applicationError||'增强结果尚未保存');update({status:'succeeded',error:null});}
  catch(error){update({status:'application_failed',error:error.message});}
  return operation;
 };
 operation.recover=async()=>{
  if(operation.status!=='unknown'||!operation.jobId)return operation;
  update({recovering:true});
  try{result.guard();await api.recover(operation.jobId,{signal:controller.signal,guard:result.guard,verifyRequest});reflect();}
  catch(error){update({error:error.message});}
  finally{update({recovering:false});}
  return operation;
 };
 return operation;
}
