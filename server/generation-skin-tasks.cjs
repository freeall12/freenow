'use strict';
const {createHash}=require('node:crypto');
const {skinGatewayCapabilities,validateSkinRequest,validateSkinOutputs}=require('./generation-skin-profile.cjs');
const {assertCredentialFree}=require('./outbound-client.cjs');
const PROTOCOL='skin-tasks-v1',CONTRACT_VERSION='image-skin-complete-png-v1';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=2048&&!/[\x00-\x1f\x7f]/.test(value)&&!['.','..'].includes(value);
const fail=(message,code='unknown')=>Object.assign(Error(message),{code});

// The ordinary HTTP task transport is injected by the router. This wrapper
// establishes a dedicated external-server contract, not a native Enhancor API.
function createSkinTasksProvider({transport,apiKey='',modelMap}={}){
 let configurationError=null;
 try{
  const map=typeof modelMap==='string'?JSON.parse(modelMap):modelMap??{};
  if(!object(map)||Object.keys(map).length||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!transport||!['prepare','submit','poll','cancel'].every(key=>typeof transport[key]==='function'))throw Error();
 }catch{configurationError='configuration_invalid';}
 const configured=!configurationError&&transport?.configured===true;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:PROTOCOL,contractVersion:CONTRACT_VERSION,transport:transport?.fingerprint??null})).digest('hex');
 const metadata={configured,protocol:PROTOCOL,missing:transport?.metadata?.missing??['GENERATION_API_BASE_URL','GENERATION_API_KEY'],configurationError:configurationError??transport?.metadata?.configurationError??null,capabilities:{
  kinds:['image.skin'],models:{'image.skin':{kind:'image.skin'}},skin:{...skinGatewayCapabilities(),contractVersion:CONTRACT_VERSION,outputTransport:'inline-png'},references:false,remoteRecovery:true,remoteCancellation:'receipt-required',verified:'local-contract-only',vendorNative:false
 }};
 function assertConfigured(){if(!configured)throw fail('专用皮肤任务网关尚未配置；需要实现 skin-tasks-v1 合同的独立服务器，Enhancor Key 不能直填','configuration_required');}
 function prepare(request){assertConfigured();validateSkinRequest(request,{apiKey});transport.prepare(request);return request;}
 async function receipt(value,{expectedId,signal,onTaskIdentity}={}){
  try{assertCredentialFree(value,apiKey);}catch{throw fail('皮肤任务回执包含凭据，未接收或重新生成');}
  if(!object(value)||!validId(value.id)||expectedId!==undefined&&expectedId!==value.id)throw fail('皮肤任务回执身份未确认','provider_identity_mismatch');
  if(!['queued','running','succeeded','failed','cancelled','configuration_required','unknown'].includes(value.status))throw fail('皮肤任务状态未确认');
  // A valid accepted task may return damaged media. Save its trusted identity
  // before decoding outputs so recovery can query that task without another POST.
  if(onTaskIdentity)await onTaskIdentity(value.id);
  if(value.status==='succeeded'){
   // The dedicated contract requires a single inline PNG, so neither a guessed
   // vendor output encoding nor an unbound result URL can claim completion.
   if(!Array.isArray(value.outputs)||value.outputs.length!==1||typeof value.outputs[0]?.url!=='string'||!value.outputs[0].url.startsWith('data:image/png;base64,'))throw fail('皮肤网关须返回单个完整内联 PNG；未接受未知结果或重新生成');
   return {...value,outputs:await validateSkinOutputs(value.outputs,{apiKey,signal})};
  }
  if(value.outputs!==undefined)throw fail('皮肤任务尚未成功，不能接收附带图片');
  return value;
 }
 async function submit(request,context={}){prepare(request);return receipt(await transport.submit(request,context),{signal:context.signal,onTaskIdentity:context.onTaskIdentity});}
 async function poll(id,context={}){assertConfigured();if(!validId(id))throw fail('皮肤原任务身份无效','provider_identity_mismatch');return receipt(await transport.poll(id,context),{expectedId:id,signal:context.signal});}
 async function cancel(id,context={}){assertConfigured();if(!validId(id))throw fail('皮肤原任务身份无效','provider_identity_mismatch');const value=await transport.cancel(id,context);return receipt(value,{expectedId:id,signal:context.signal});}
 async function generate(request,options={}){
  prepare(request);if(typeof transport.generate!=='function')throw fail('皮肤网关缺少任务执行接口','configuration_required');
  return receipt(await transport.generate(request,options),{signal:options.signal});
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,cancel,generate,isConfigured:()=>configured,isPollable:()=>configured};
}
module.exports={createSkinTasksProvider,PROTOCOL,CONTRACT_VERSION};
