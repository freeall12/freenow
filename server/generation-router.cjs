'use strict';
const {createHash}=require('node:crypto');
const path=require('node:path');
const {createOpenAINativeProvider}=require('./generation-openai.cjs');
const {createArkProvider}=require('./generation-ark.cjs');
const {createArkVideoMediaProvider,arkVideoUploadConfiguration}=require('./generation-ark-video-media.cjs');
const {createFalProvider}=require('./generation-fal.cjs');
const {createTripoProvider}=require('./generation-tripo.cjs');
const {createMiniMaxProvider}=require('./generation-minimax.cjs');
const {createElevenLabsProvider}=require('./generation-elevenlabs.cjs');
const {createMarbleProvider}=require('./generation-marble.cjs');
const {createMiniMaxMusicProvider}=require('./generation-minimax-music.cjs');
const {createFalVideoProvider}=require('./generation-fal-video.cjs');
const {createElevenLabsSoundProvider}=require('./generation-elevenlabs-sound.cjs');
const {createElevenLabsMusicProvider}=require('./generation-elevenlabs-music.cjs');
const {createMurekaProvider}=require('./generation-mureka.cjs');
const {createSeedAudioProvider}=require('./generation-seed-audio.cjs');
const {createVideoAudioProvider}=require('./generation-video-audio.cjs');
const {createSoniloProvider}=require('./generation-sonilo.cjs');
const {createVideoExtendProvider}=require('./generation-video-extend.cjs');
const {createVideoReshootProvider}=require('./generation-video-reshoot.cjs');
const {createPanoramaProvider}=require('./generation-panorama.cjs');
const {createVideoDepthProvider}=require('./generation-video-depth.cjs');
const {createOpenAIPanoramaEditProvider}=require('./generation-panorama-edit-openai.cjs');
const {createVideoMaskProvider}=require('./generation-video-mask.cjs');
const {createOpenAIMaskedEditProvider}=require('./generation-openai-masked-edit.cjs');
const {createOpenAIRelightProvider}=require('./generation-openai-relight.cjs');
const {createSkinTasksProvider}=require('./generation-skin-tasks.cjs');
const {createMagnificProvider}=require('./generation-magnific.cjs');
const {endpoint:tasksEndpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const validId=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=2048&&!/[\x00-\x1f\x7f]/.test(value);
const kindPattern=/^(image|video|audio|text|world|studio|model|panorama)\.[a-z][a-zA-Z.\-]*$/;
const providerPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function requestAlias(request){
 const p=request.parameters||{};
 return p.providerParameters?.model??p.modelId??p.model??(request.kind==='image.upscale'&&typeof p.provider==='string'?'image.upscale:'+p.provider:['image.recognize','video.analyze','image.remove-background','image.multiAngle'].includes(request.kind)?request.kind:undefined);
}

// This task adapter makes one POST. Recovery only queries an accepted identity;
// HTTP failures, redirects and malformed receipts never trigger another POST.
function createTasksProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,allowUnauthenticated=false,rejectCredentialEcho=false,maxResponseBytes=1024*1024}={}){
 let endpoint='',configurationError=null;
 try{if(baseUrl)endpoint=tasksEndpoint(baseUrl);if(modelMap!==undefined&&!object(modelMap)&&typeof modelMap!=='string')throw Error();if(typeof modelMap==='string'&&!object(JSON.parse(modelMap)))throw Error();if(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>64*1024*1024)throw Error();}catch{configurationError='configuration_invalid';}
 const missing=[...(!baseUrl?['GENERATION_API_BASE_URL']:[]),...(!apiKey&&!allowUnauthenticated?['GENERATION_API_KEY']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=digest({protocol:'tasks-v1',endpoint,modelMap:modelMap||null});
 const metadata={configured,protocol:'tasks-v1',missing,configurationError,capabilities:{kinds:[],references:'gateway-defined',remoteRecovery:true,remoteCancellation:'receipt-required',verified:'local-contract-only'}};
 function prepare(request){
  if(!configured)throw failure('所选任务供应商尚未配置','configuration_required');
  rejectCredentials(request);
  if(!object(request)||!kindPattern.test(request.kind)||request.inputs!==undefined&&!Array.isArray(request.inputs)||request.parameters!==undefined&&!object(request.parameters)||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw failure('生成任务参数无效');
  return request;
 }
 async function read(method,id,body,signal){
  if(!configured)throw failure('所选任务供应商尚未配置','configuration_required');
  if(id!==undefined&&!validId(id))throw failure('远端任务标识无效','provider_identity_mismatch');
  const timed=AbortSignal.timeout(method==='DELETE'?5000:30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=fn=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return fn();}),interrupted]);
  try{
   const response=await wait(()=>fetchImpl(endpoint+'/tasks'+(id===undefined?'':'/'+encodeURIComponent(id)),{method,redirect:'error',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{})},signal:combined,...(body?{body:JSON.stringify(body)}:{})}));
   if(!response.ok||Number(response.headers?.get('content-length'))>maxResponseBytes){response.body?.cancel().catch(()=>{});throw Error();}
   if(!response.body?.getReader)throw Error();
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>maxResponseBytes)throw Error();parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
   const echoes=item=>typeof item==='string'?item.includes(apiKey):item&&typeof item==='object'&&Object.entries(item).some(([key,entry])=>key.includes(apiKey)||echoes(entry));
   if(!object(value)||rejectCredentialEcho&&apiKey&&echoes(value))throw Error();return value;
  }catch{if(signal?.aborted)throw signal.reason;throw failure('生成服务请求状态未确认，请查询原任务；未自动重试','unknown');}
  finally{combined.removeEventListener('abort',abort);}
 }
 function receipt(value,id){
  if(id!==undefined&&value.id!==id)throw failure('生成服务返回了其他任务','provider_identity_mismatch');
  if(value.id!==undefined&&!validId(value.id))throw failure('生成服务任务身份未确认','provider_identity_mismatch');
  if(value.status!==undefined&&!['queued','running','succeeded','failed','cancelled','configuration_required','unknown'].includes(value.status))throw failure('生成服务返回未确认状态','provider_status_unconfirmed');
  if(value.outputs!==undefined&&value.status!==undefined&&value.status!=='succeeded')throw failure('生成服务尚未确认成功，不能接受附带结果','contradictory_outputs');
  if(value.status==='succeeded'&&(!Array.isArray(value.outputs)||!value.outputs.length))throw failure('生成服务声称完成但缺少实际结果','missing_outputs');
  if(!value.outputs&&!validId(value.id))throw failure('生成服务未返回任务 ID','submission_unconfirmed');
  const result={...(value.id!==undefined?{id:value.id}:{}),status:value.status||(value.outputs?'succeeded':'queued')};
  if(value.outputs!==undefined){rejectCredentials(value.outputs);result.outputs=value.outputs;}
  if(value.progress!==undefined)result.progress=Math.min(99,Math.max(0,Number(value.progress)||0));
  if(['failed','configuration_required','unknown'].includes(result.status)){result.code='provider_'+result.status;result.error='生成服务未完成任务';}
  // The gateway cannot attest a trusted local preparation error.
  return result;
 }
 const submit=async(request,{signal}={})=>receipt(await read('POST',undefined,prepare(request),signal));
 const poll=async(id,{signal}={})=>receipt(await read('GET',id,undefined,signal),id);
 async function cancel(id,{signal}={}){const value=await read('DELETE',id,undefined,signal);if(value.id!==id)throw failure('生成服务取消任务身份未确认','provider_identity_mismatch');return {id,status:value.status==='cancelled'?'cancelled':'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isFinite(timeout)||timeout<1||timeout>1800000||!Number.isFinite(pollInterval)||pollInterval<1||pollInterval>30000)throw failure('轮询预算无效');
  const timed=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   let value=await submit(request,{signal:combined});const id=value.id;if(id)onTaskIdentity(id);
   while(['queued','running'].includes(value.status)){
    onProgress(value.progress||0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(id,{signal:combined});
   }
   if(value.status!=='succeeded')throw failure('生成服务未完成任务',value.status==='unknown'?'unknown':value.status);
   return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw failure('生成任务状态未确认，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,cancel,generate};
}

function createGenerationRouter({providers={},routes={},fetchImpl=fetch,localPort,preparationDirectory,videoDepthDirectory,magnificDownloadImpl,videoDepthDownloadImpl,soniloDownloadImpl,arkVideoMediaOptions}={}){
 fetchImpl=protectGenerationFetch(fetchImpl);
 let instances={},normalized={},configurationError=null;
 try{
  if(typeof providers==='string')providers=JSON.parse(providers);if(typeof routes==='string')routes=JSON.parse(routes);
  if(!object(providers)||!object(routes)||Object.keys(providers).length>100||Object.keys(routes).length>100)throw Error();
  for(const [id,originalConfig]of Object.entries(providers)){
   let config=originalConfig,videoUploads={};
   if(['ark-native','ark-video-extend-reference','ark-video-reshoot-edit'].includes(config?.protocol)){
    const uploadConfiguration=arkVideoUploadConfiguration(config.modelMap,providers);
    config={...config,modelMap:uploadConfiguration.modelMap};videoUploads=uploadConfiguration.uploads;
   }
   if(!providerPattern.test(id)||!object(config)||!['tasks-v1','openai-native','ark-native','fal-native','tripo-native','minimax-native','elevenlabs-native','marble-native','minimax-music-native','fal-video-native','elevenlabs-sound-native','elevenlabs-music-native','mureka-native','seed-audio-native','sonilo-native','fal-video-audio-native','ark-video-extend-reference','ark-video-reshoot-edit','fal-panorama-native','fal-video-depth-native','openai-panorama-edit-native','fal-video-mask-native','openai-masked-edit-native','openai-relight-native','skin-tasks-v1','magnific-native'].includes(config.protocol)||Object.keys(config).some(key=>!['protocol','baseUrl','apiKey','modelMap','client'].includes(key))||['baseUrl','apiKey'].some(key=>config[key]!==undefined&&typeof config[key]!=='string'))throw Error();
   if(config.baseUrl)tasksEndpoint(config.baseUrl,{localPort});if(config.client?.baseURL)tasksEndpoint(config.client.baseURL,{localPort});
   const provider=(config.protocol==='skin-tasks-v1'?options=>createSkinTasksProvider({...options,transport:createTasksProvider({...options,maxResponseBytes:64*1024*1024,rejectCredentialEcho:true})}):config.protocol==='openai-native'?createOpenAINativeProvider:config.protocol==='ark-native'?createArkProvider:config.protocol==='fal-native'?createFalProvider:config.protocol==='tripo-native'?createTripoProvider:config.protocol==='minimax-native'?createMiniMaxProvider:config.protocol==='elevenlabs-native'?createElevenLabsProvider:config.protocol==='marble-native'?createMarbleProvider:config.protocol==='minimax-music-native'?createMiniMaxMusicProvider:config.protocol==='fal-video-native'?createFalVideoProvider:config.protocol==='elevenlabs-sound-native'?createElevenLabsSoundProvider:config.protocol==='elevenlabs-music-native'?createElevenLabsMusicProvider:config.protocol==='mureka-native'?createMurekaProvider:config.protocol==='seed-audio-native'?createSeedAudioProvider:config.protocol==='sonilo-native'?createSoniloProvider:config.protocol==='fal-video-audio-native'?createVideoAudioProvider:config.protocol==='ark-video-extend-reference'?createVideoExtendProvider:config.protocol==='ark-video-reshoot-edit'?createVideoReshootProvider:config.protocol==='fal-panorama-native'?createPanoramaProvider:config.protocol==='fal-video-depth-native'?createVideoDepthProvider:config.protocol==='openai-panorama-edit-native'?createOpenAIPanoramaEditProvider:config.protocol==='fal-video-mask-native'?createVideoMaskProvider:config.protocol==='openai-masked-edit-native'?createOpenAIMaskedEditProvider:config.protocol==='openai-relight-native'?createOpenAIRelightProvider:config.protocol==='magnific-native'?createMagnificProvider:createTasksProvider)({...config,fetchImpl,localPort,...(config.protocol==='magnific-native'?{downloadImpl:magnificDownloadImpl}:{}),...(config.protocol==='sonilo-native'?{download:soniloDownloadImpl}:{}),...(config.protocol==='fal-video-depth-native'?{download:videoDepthDownloadImpl,...(videoDepthDirectory?{directory:path.join(videoDepthDirectory,id)}:{})}:{}),...(config.protocol==='fal-video-mask-native'&&preparationDirectory?{directory:path.join(preparationDirectory,id)}:{})});
   if(!['tasks-v1','skin-tasks-v1','magnific-native','elevenlabs-native','minimax-music-native','elevenlabs-sound-native','elevenlabs-music-native','mureka-native','seed-audio-native','sonilo-native'].includes(config.protocol)){
    const map=provider.metadata.configurationError?{}:typeof config.modelMap==='string'?JSON.parse(config.modelMap):config.modelMap||{};
    provider.metadata={...provider.metadata,capabilities:{...provider.metadata.capabilities,models:Object.fromEntries(Object.entries(map).map(([alias,entry])=>{
     const label=provider.metadata.capabilities?.models?.[alias]?.label;
     return [alias,{kind:entry.kind,...typeof label==='string'&&label.trim()&&label.length<=80?{label}:{}}];
    }))}};
   }
   instances[id]=Object.keys(videoUploads).length?createArkVideoMediaProvider({provider,uploads:videoUploads,apiKey:config.apiKey,directory:path.join(preparationDirectory||path.join(__dirname,'.ark-video-preparation'),'ark-'+id),...arkVideoMediaOptions}):provider;
  }
  for(const [kind,route]of Object.entries(routes)){
   if(!kindPattern.test(kind))throw Error();
   const entry=typeof route==='string'?{default:route,models:{}}:route;
   if(!object(entry)||Object.keys(entry).some(key=>!['default','models'].includes(key))||entry.models!==undefined&&!object(entry.models)||entry.default===undefined&&!Object.keys(entry.models||{}).length)throw Error();
   const models=entry.models||{};
   for(const [alias,id]of Object.entries(models))if(!alias.trim()||alias.length>200||!own(instances,id))throw Error();
   if(entry.default!==undefined&&!own(instances,entry.default))throw Error();
   normalized[kind]={...(entry.default!==undefined?{default:entry.default}:{}),models:{...models}};
  }
 }catch{configurationError='configuration_invalid';instances={};normalized={};}
 const usable=(provider,kind,alias)=>provider?.configured&&(provider.metadata.protocol==='tasks-v1'||provider.metadata.capabilities.kinds.includes(kind)&&(alias===undefined||provider.metadata.capabilities.models[alias]?.kind===kind));
 const kinds=Object.entries(normalized).filter(([kind,route])=>usable(instances[route.default],kind)||Object.entries(route.models).some(([alias,id])=>usable(instances[id],kind,alias))).map(([kind])=>kind);
 const configured=!configurationError&&kinds.length>0;
 // Individual provider fingerprints live in accepted task identities. Route
 // edits never invalidate an existing identity or select a replacement provider.
 const fingerprint=digest({protocol:'routing-v1'});
 const metadata={configured,protocol:'routed',missing:Object.keys(normalized).length?[]:['GENERATION_ROUTES'],configurationError,providers:Object.fromEntries(Object.entries(instances).map(([id,p])=>[id,p.metadata])),routes:structuredClone(normalized),capabilities:{kinds,references:'provider-defined',remoteRecovery:'provider-defined',remoteCancellation:'provider-defined',verified:'local-contract-only'}};
 function select(request){
  if(configurationError)throw failure('供应商路由配置无效','configuration_required');
  if(!object(request)||!kindPattern.test(request.kind)||request.parameters!==undefined&&!object(request.parameters)||request.parameters?.providerParameters!==undefined&&!object(request.parameters.providerParameters))throw failure('生成任务参数无效');
  const alias=requestAlias(request);
  if(alias!==undefined&&(typeof alias!=='string'||!alias.trim()))throw failure('生成模型标识无效');
  const route=own(normalized,request.kind)?normalized[request.kind]:null;
  const id=route&&(alias!==undefined&&own(route.models,alias)?route.models[alias]:route.default);
  const provider=id&&own(instances,id)?instances[id]:null;
  const nativeAlias=alias;
  const uniqueKindOperation=['fal-video-mask-native','openai-relight-native','skin-tasks-v1','fal-video-depth-native','openai-panorama-edit-native'].includes(provider?.metadata.protocol)&&Object.values(provider.metadata.capabilities.models||{}).filter(entry=>entry.kind===request.kind).length===1;
  if(!usable(provider,request.kind,nativeAlias)||provider?.metadata.protocol!=='tasks-v1'&&nativeAlias===undefined&&!uniqueKindOperation)throw failure('此操作或模型尚未配置供应商路由','configuration_required');
  return {id,provider};
 }
 const envelope=(id,provider,raw)=>'rg1.'+Buffer.from(JSON.stringify([id,provider.fingerprint,raw])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>6000||!/^rg1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==3||!providerPattern.test(value[0])||! /^[a-f0-9]{64}$/.test(value[1])||!validId(value[2])||envelope(value[0],{fingerprint:value[1]},value[2])!==id)throw Error();}catch{throw failure('生成任务路由身份无效','provider_identity_mismatch');}
  const [providerId,stamp,raw]=value,provider=own(instances,providerId)?instances[providerId]:null;
  if(!provider?.configured||provider.fingerprint!==stamp)throw failure('原任务供应商配置已变更，未改用其他供应商','provider_configuration_changed');
  return {providerId,provider,raw};
 }
 function wrap(value,id,provider,expectedRaw){
  if(expectedRaw!==undefined&&value?.id!==expectedRaw)throw failure('生成服务返回了其他任务','provider_identity_mismatch');
  if(value?.id===undefined)return value;
  if(!validId(value.id))throw failure('远端任务标识无效','provider_identity_mismatch');
  return {...value,id:envelope(id,provider,value.id)};
 }
 function prepare(request){rejectCredentials(request);const {provider}=select(request);provider.prepare(request);return request;}
 function providerOptions(options={},id,provider){
  const {routing,...preparationState}=options.preparationState||{};
  if(routing&&(routing.providerId!==id||routing.providerFingerprint!==provider.fingerprint))throw failure('原媒体准备供应商配置已变更','provider_configuration_changed');
  return {...options,...(options.preparationState?{preparationState}:{}),
   onTaskIdentity:raw=>{if(!validId(raw))throw failure('远端任务标识无效','provider_identity_mismatch');return options.onTaskIdentity?.(envelope(id,provider,raw));},
   onPreparationState:state=>options.onPreparationState?.({...state,routing:{providerId:id,providerFingerprint:provider.fingerprint}})};
 }
 async function submit(request,options={}){prepare(request);const {id,provider}=select(request);return wrap(await provider.submit(request,providerOptions(options,id,provider)),id,provider);}
 async function resumePreparation(state,options={}){
  const route=state?.routing;
  if(!object(route)||Object.keys(route).sort().join(',')!=='providerFingerprint,providerId'||typeof route.providerId!=='string'||!providerPattern.test(route.providerId)||typeof route.providerFingerprint!=='string'||! /^[a-f0-9]{64}$/.test(route.providerFingerprint))throw failure('媒体准备路由身份无效','provider_identity_mismatch');
  const provider=own(instances,route.providerId)?instances[route.providerId]:null;
  if(!provider?.configured||provider.fingerprint!==route.providerFingerprint)throw failure('原媒体准备供应商配置已变更','provider_configuration_changed');
  if(typeof provider.resumePreparation!=='function')throw failure('原媒体准备不支持读取恢复','remote_recovery_unavailable');
  const {routing,...rawState}=state;
  return wrap(await provider.resumePreparation(rawState,providerOptions({...options,preparationState:state},route.providerId,provider)),route.providerId,provider);
 }
 async function generate(request,options={}){prepare(request);const {id,provider}=select(request);const value=await provider.generate(request,providerOptions(options,id,provider));return wrap(value,id,provider);}
 async function poll(id,options){const {providerId,provider,raw}=identity(id);if(!provider.poll)throw failure('此生成协议不支持远端任务恢复','remote_recovery_unavailable');return wrap(await provider.poll(raw,providerOptions(options,providerId,provider)),providerId,provider,raw);}
 async function cancel(id,options){const {providerId,provider,raw}=identity(id);if(!provider.cancel)throw failure('此生成协议不支持远端任务取消','remote_cancellation_unavailable');return wrap(await provider.cancel(raw,options),providerId,provider,raw);}
 function protocolFor(request){try{return select(request).provider.metadata.protocol;}catch{return null;}}
 function isPollable(request){try{return typeof select(request).provider.poll==='function';}catch{return false;}}
 return {configured,fingerprint,metadata,prepare,submit,generate,poll,cancel,resumePreparation,protocolFor,isPollable,isConfigured:()=>configured};
}
module.exports={createGenerationRouter,createTasksProvider};
