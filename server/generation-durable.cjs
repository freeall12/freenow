'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {createGenerationStore}=require('./generation-store.cjs');
const {localVideoErrorMessage}=require('./video-analysis-errors.cjs');
const terminal=new Set(['succeeded','failed','cancelled','configuration_required']);
const secretKey=/^(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|password|secret|secret[-_]?key|client[-_]?secret|credentials)$/i;
const failure=(message,code,status=400)=>Object.assign(Error(message),{code,status});
function rejectCredentials(value){if(!value||typeof value!=='object')return;for(const [key,entry]of Object.entries(value)){if(secretKey.test(key))throw failure('生成请求不能包含凭据字段','credentials_forbidden');rejectCredentials(entry);}}
function canonical(value){if(value===null||['string','boolean'].includes(typeof value))return JSON.stringify(value);if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';throw failure('生成请求必须为 JSON 数据','invalid_request');}
const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
function requestKey(key){if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{8,180}$/.test(key))throw failure('提交需要有效的 Idempotency-Key','invalid_idempotency_key');return key;}
const outputObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const outputFailure=()=>failure('生成结果资源元数据无效','invalid_outputs');
const LOCAL_MEDIA=/^\/api\/generation\/media\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const isLocalMedia=value=>typeof value==='string'&&LOCAL_MEDIA.test(value);
function outputShape(value,allowed,required=[]){
 if(!outputObject(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw outputFailure();
}
function outputResourceUrl(value,{http=false,localOnly=false}={}){
 if(localOnly){if(!isLocalMedia(value))throw outputFailure();return value;}
 if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x20\x7f]/.test(value))throw outputFailure();
 let url;try{url=new URL(value);}catch{throw outputFailure();}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!['https:',...(http?['http:']:[])].includes(url.protocol)||url.username||url.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168|198\.(?:18|19))\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||/^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(host))throw outputFailure();
 return value;
}
function checkedWorld(output,{localOnly=false}={}){
 const world=output.world;
 if(output.type!=='model'||output.format!=='spz'||output.representation!=='gaussianSplat')throw outputFailure();
 outputShape(world,['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution'],['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution']);
 if(typeof world.worldId!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(world.worldId)||['.','..'].includes(world.worldId)||world.worldId!==output.sourceFileId||!['marble-1.1','marble-1.1-plus','marble-1.0','marble-1.0-draft'].includes(world.model)||world.coordinateSystem!=='marble_raw_opencv'||!['100k','150k','500k','full_res'].includes(world.splatResolution))throw outputFailure();
 outputResourceUrl(world.marbleUrl);if(localOnly){const link=new URL(world.marbleUrl);if(link.search||link.hash)throw outputFailure();}
 outputResourceUrl(output.url,{localOnly});
 if(output.poster!==undefined)outputResourceUrl(output.poster,{localOnly});
 outputShape(world.assets,['splats','mesh','imagery'],['splats']);
 const splats=world.assets.splats;
 outputShape(splats,['spzUrls','semanticsMetadata'],['spzUrls','semanticsMetadata']);
 outputShape(splats.spzUrls,['100k','150k','500k','full_res'],[world.splatResolution]);
 if(!Object.keys(splats.spzUrls).length||splats.spzUrls[world.splatResolution]!==output.url)throw outputFailure();
 for(const url of Object.values(splats.spzUrls)){outputResourceUrl(url,{localOnly});if(!localOnly&&/\.(?:glb|gltf|ply|obj)$/i.test(new URL(url).pathname))throw outputFailure();}
 outputShape(splats.semanticsMetadata,['metricScaleFactor','groundPlaneOffset'],['metricScaleFactor','groundPlaneOffset']);
 if(!Number.isFinite(splats.semanticsMetadata.metricScaleFactor)||splats.semanticsMetadata.metricScaleFactor<=0||!Number.isFinite(splats.semanticsMetadata.groundPlaneOffset))throw outputFailure();
 // Collider meshes are auxiliary assets. Only the selected SPZ is the world
 // scene; retaining meshes here must never change its Gaussian representation.
 if(world.assets.mesh!==undefined){outputShape(world.assets.mesh,['colliderMeshUrl','fullResMeshUrl','hqMeshUrl']);for(const url of Object.values(world.assets.mesh))outputResourceUrl(url,{localOnly});}
 if(world.assets.imagery!==undefined){outputShape(world.assets.imagery,['panoUrl'],['panoUrl']);outputResourceUrl(world.assets.imagery.panoUrl,{localOnly});}
 return structuredClone(world);
}
function checkedOutputMetadata(output,{localOnly=false}={}){
 const metadata={};
 if(output.format!==undefined){if(output.type!=='model'||!['glb','spz'].includes(output.format))throw outputFailure();metadata.format=output.format;outputResourceUrl(output.url||output.model,{localOnly});}
 if(output.representation!==undefined){if(output.type!=='model'||!['mesh','gaussianSplat'].includes(output.representation)||output.format==='glb'&&output.representation!=='mesh'||output.format==='spz'&&output.representation!=='gaussianSplat')throw outputFailure();metadata.representation=output.representation;}
 if(output.filename!==undefined){if(typeof output.filename!=='string'||!output.filename.trim()||output.filename.length>255||/[\x00-\x1f\x7f/\\]/.test(output.filename)||['.','..'].includes(output.filename)||output.format&&!output.filename.toLowerCase().endsWith('.'+output.format))throw outputFailure();metadata.filename=output.filename;}
 if(output.fullImage!==undefined){
  if(output.type!=='image'||typeof output.fullImage!=='string')throw outputFailure();
  if(localOnly)outputResourceUrl(output.fullImage,{localOnly});
  else if(output.fullImage.startsWith('data:')){if(output.fullImage.length>64*1024*1024||!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(output.fullImage))throw outputFailure();}
  else outputResourceUrl(output.fullImage,{http:true});
  metadata.fullImage=output.fullImage;
 }
 if(output.world!==undefined)metadata.world=checkedWorld(output,{localOnly});
 return metadata;
}
function checkedOutputs(outputs,{localOnly=false}={}){
 if(!Array.isArray(outputs)||!outputs.length||outputs.length>50)throw failure('生成服务未返回实际结果','missing_outputs');
 rejectCredentials(outputs);const fields=['type','url','image','video','audio','model','text','title','width','height','duration','sourceFileId','poster','sourceUrl','sourceRange','mime'];
 for(const output of outputs)if(output?.sourceRange!==undefined){const range=output.sourceRange;if(output.type!=='video'||!range||typeof range!=='object'||Array.isArray(range)||Object.keys(range).sort().join(',')!=='end,start'||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw failure('分镜来源时间范围无效','invalid_outputs');}
 return outputs.map(output=>{
  const source=output?.url||output?.[output?.type];
  if(!['image','video','audio','text','model'].includes(output?.type)||(output.type==='text'?typeof output.text!=='string'||!output.text.trim():typeof source!=='string'||!source))throw failure('生成结果格式无效','invalid_outputs');
  if(output.type!=='text'&&(localOnly?!isLocalMedia(source):!/^(https?:|data:(image|video|audio)\/)/.test(source)))throw failure('生成结果地址无效','invalid_outputs');
  if(output.mime!==undefined&&(typeof output.mime!=='string'||!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(output.mime)))throw outputFailure();
  if(localOnly)for(const key of ['url','image','video','audio','model','poster','fullImage','sourceUrl'])if(output[key]!==undefined&&!isLocalMedia(output[key]))throw outputFailure();
  return {...Object.fromEntries(fields.filter(key=>output[key]!==undefined).map(key=>[key,structuredClone(output[key])])),...checkedOutputMetadata(output,{localOnly})};
 });
}

function createDurableGenerationService({directory,store=null,baseUrl='',apiKey='',fetchImpl=fetch,provider=null,prepareRequest=async value=>value,now=Date.now,maxTasks=500,requestTimeout=30000,mediaMaterializer=null}={}){
 let endpoint='';if(baseUrl){const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw failure('生成网关地址不能包含凭据或查询参数','invalid_provider');endpoint=url.href.replace(/\/$/,'');}
 if(!store){if(!directory)throw TypeError('Durable generation requires a private store directory');store=createGenerationStore({directory});}
 const providerFingerprint=provider?provider.fingerprint:endpoint?digest(endpoint):null,configured=provider?provider.configured:!!endpoint&&!!apiKey,headers={'Content-Type':'application/json',Authorization:'Bearer '+apiKey};
 const jobs=new Map(),keys=new Map(),active=new Map(),controllers=new Map();let mutations=Promise.resolve(),closing=false,closePromise;
 const serialize=fn=>{const operation=mutations.then(fn);mutations=operation.catch(()=>{});return operation;};
 const exposed=job=>job?structuredClone(job):null;
 const recover=(job,reason,retryableLookup=false)=>{const {outputs,...record}=job;return {...record,status:'unknown',code:reason,error:'生成状态尚未确认，未重新提交生成请求',recovery:{reason,retryableLookup}};};
 async function persist(job){await store.write(job);jobs.set(job.id,job);keys.set(job.idempotencyKey,job.id);return job;}
 function localizationFailure(job,errorCode='media_localization_failed',extra={}){
  return {...recover(job,'media_localization_failed',true),providerStatus:'succeeded',localization:{...job.localization,state:'failed',errorCode,retryable:true,...extra},error:'生成已完成，素材保存失败；请重新取回素材'};
 }
 async function verifyLocalized(outputs,taskId){
  if(!mediaMaterializer){if(outputs.every(output=>output.type==='text'))return {resources:[]};throw failure('本地媒体保存服务未配置','media_localization_unavailable');}
  return mediaMaterializer.verify(outputs,{taskId});
 }
 async function localize(id){
  const initial=jobs.get(id);if(!initial||initial.status==='cancelled'||closing||initial.providerStatus!=='succeeded')return;
  const controller=controllers.get(id)||new AbortController();controllers.set(id,controller);
  const revision=initial.localization?.revision||0;
  await update(id,job=>job.status==='cancelled'?null:{...job,status:'running',outputs:undefined,localization:{...job.localization,state:'downloading',revision,errorCode:undefined,retryable:true},error:undefined,code:undefined,recovery:undefined});
  if(closing||controller.signal.aborted||jobs.get(id)?.status==='cancelled')return;
  try{
   const privateOutputs=checkedOutputs(initial.providerResult.outputs);
   const localized=mediaMaterializer?await mediaMaterializer.localize(privateOutputs,{taskId:id,signal:controller.signal,revision}):{outputs:privateOutputs,resources:[]};
   const outputs=checkedOutputs(localized.outputs,{localOnly:true}),verified=await verifyLocalized(outputs,id);
   if(controller.signal.aborted||closing)return;
   await update(id,job=>job.status==='cancelled'||job.localization?.revision!==revision?null:{...job,status:'succeeded',outputs,progress:100,localization:{state:'ready',revision,resources:verified.resources||localized.resources||[],retryable:false},error:undefined,code:undefined,recovery:undefined});
  }catch(error){
   if(closing||controller.signal.aborted||jobs.get(id)?.status==='cancelled')return;
   if(error.code==='storage_error')throw error;
   await update(id,job=>job.status==='cancelled'||job.localization?.revision!==revision?null:localizationFailure(job,/^media_[a-z_]+$/.test(error.code||'')?error.code:'media_localization_failed',error.code==='media_integrity_error'?{revision:revision+1}:error.code==='media_download_expired'?{sourceRefreshRequired:true}:{}));
  }
 }
 const ready=(async()=>{
  for(const saved of await store.readAll()){
   rejectCredentials(saved.request);if(saved.preparedRequest)rejectCredentials(saved.preparedRequest);
   if(saved.version!==1||typeof saved.id!=='string'||!saved.request||typeof saved.requestHash!=='string'||digest(saved.request)!==saved.requestHash||keys.has(requestKey(saved.idempotencyKey))||jobs.has(saved.id))throw failure('生成任务记录损坏，已阻止创建新任务','storage_corrupt',503);
   let job=saved;
   if(saved.providerStatus==='succeeded'&&saved.providerResult?.outputs&&saved.status!=='cancelled'){
    try{checkedOutputs(saved.providerResult.outputs);}catch{job=recover(saved,'stored_provider_result_invalid',!!saved.providerTaskId);}
    if(job===saved&&saved.localization?.state==='ready'){
     try{const outputs=checkedOutputs(saved.outputs,{localOnly:true});await verifyLocalized(outputs,saved.id);job={...saved,outputs};}
     catch{job=localizationFailure(saved,'media_localization_failed',{revision:(saved.localization?.revision||0)+1});}
    }else if(job===saved&&saved.localization?.state==='failed')job=localizationFailure(saved,saved.localization.errorCode,{retryable:saved.localization.retryable!==false});
    else if(job===saved)job={...saved,status:'running',outputs:undefined,localization:{...saved.localization,state:'pending'},error:undefined,code:undefined,recovery:undefined};
   }else if(saved.status==='succeeded'){
    // Legacy remote outputs are private descriptors until their bytes are saved.
    try{const outputs=checkedOutputs(saved.outputs);job={...saved,providerStatus:'succeeded',providerResult:{outputs},outputs:undefined,status:'running',localization:{state:'pending',revision:0,resources:[],retryable:true}};}catch{job=recover(saved,'stored_outputs_invalid',!!saved.providerTaskId);}
   }else if(!terminal.has(saved.status)){
    if(saved.providerTaskId)job=recover(saved,'service_restarted',true);
    else if(saved.submissionState==='queued')job={...saved,status:'failed',code:'dispatch_not_started',error:'服务在远端提交前中断；未自动重新提交',recovery:{reason:'dispatch_not_started',retryableLookup:false}};
    else job=recover(saved,'submission_unconfirmed',false);
   }
   jobs.set(job.id,job);keys.set(job.idempotencyKey,job.id);if(job!==saved)await persist(job);
  }
 })();
 function storageFailure(id){const current=jobs.get(id);if(current&&!terminal.has(current.status))jobs.set(id,recover(current,'storage_error',false));}
 async function update(id,change){return serialize(async()=>{const current=jobs.get(id);if(!current||closing)return current||null;const next=change(structuredClone(current));if(!next)return current;try{return await persist({...next,updatedAt:now()});}catch(error){storageFailure(id);throw error;}});}
 async function remote(method,id,body,signal){if(provider){if(method==='POST')return provider.submit(body,{signal});if(typeof provider.poll!=='function')throw failure('此生成协议不支持远端任务恢复','remote_recovery_unavailable');return provider.poll(id,{signal});}const result=await fetchImpl(endpoint+'/tasks'+(id?'/'+encodeURIComponent(id):''),{method,headers,signal:AbortSignal.any([signal,AbortSignal.timeout(requestTimeout)]),...(body?{body:JSON.stringify(body)}:{})});if(!result.ok)throw failure('生成服务请求未确认','provider_http_error',502);return result.json();}
 function compatible(job){return (configured||provider?.metadata?.protocol==='routed')&&job.providerFingerprint===providerFingerprint;}
 const protocolFor=request=>provider?.protocolFor?provider.protocolFor(request):provider?.metadata?.protocol;
 async function applyRemote(id,value){
  const existing=jobs.get(id);if(!existing||closing||controllers.get(id)?.signal.aborted&&existing.status!=='cancelled')return;
  const remoteId=value&&typeof value.id==='string'&&value.id.trim()?value.id:null;
  if(existing.providerTaskId&&remoteId&&remoteId!==existing.providerTaskId)throw failure('生成服务返回了其他任务','provider_identity_mismatch');
  if(remoteId&&!existing.providerTaskId)await update(id,job=>({...job,providerTaskId:remoteId,submissionState:'accepted'}));
  if(jobs.get(id).status==='cancelled'){
   if(value?.outputs!==undefined&&(value.status===undefined||value.status==='succeeded')){
    const outputs=checkedOutputs(value.outputs);await update(id,job=>({...job,providerStatus:'succeeded',providerResult:{outputs},cancellation:{...job.cancellation,providerCancellation:'already_succeeded'}}));
   }else if(jobs.get(id).providerTaskId)await deleteRemote(id);
   return;
  }
  if(value?.outputs!==undefined){
   if(value.status!==undefined&&value.status!=='succeeded')throw failure('生成服务尚未确认成功，不能接受附带结果','contradictory_outputs');
   const outputs=checkedOutputs(value.outputs);await update(id,job=>job.status==='cancelled'?{...job,providerStatus:'succeeded',providerResult:{outputs},cancellation:{...job.cancellation,providerCancellation:'already_succeeded'}}:{...job,status:'running',providerStatus:'succeeded',providerResult:{outputs},outputs:undefined,localization:{state:'pending',revision:job.localization?.revision||0,resources:[],retryable:true},error:undefined,code:undefined,recovery:undefined});await localize(id);return;
  }
  // A remote tasks-v1 response cannot claim a trusted local preparation failure.
  const localError=protocolFor(existing.preparedRequest||existing.request)==='openai-native'&&existing.request.kind==='video.analyze'&&value?.status==='failed'&&value.providerDispatched===false?localVideoErrorMessage(value.code):null;
  if(localError){await update(id,job=>job.status==='cancelled'?null:{...job,status:'failed',code:value.code,error:localError,providerDispatched:false,recovery:{reason:value.code,retryableLookup:false}});return;}
  if(['failed','cancelled','configuration_required'].includes(value?.status)){await update(id,job=>job.status==='cancelled'?null:{...job,status:value.status,code:'provider_'+value.status,error:value.status==='cancelled'?'生成服务已取消任务':'生成服务未完成任务',recovery:{reason:'provider_'+value.status,retryableLookup:false}});return;}
  if(value?.status==='succeeded')throw failure('生成服务声称完成但缺少实际结果','missing_outputs');
  if(value?.status!==undefined&&!['queued','running'].includes(value.status))throw failure('生成服务返回未确认状态','provider_status_unconfirmed');
  if(!jobs.get(id).providerTaskId)throw failure('生成服务未返回任务 ID','submission_unconfirmed');
  await update(id,job=>job.status==='cancelled'?null:{...job,status:'running',progress:Math.max(job.progress||0,Math.min(99,Math.max(0,Number(value?.progress)||0))),error:undefined,code:undefined,recovery:undefined});
 }
 async function failedOperation(id,error){if(closing)return;const current=jobs.get(id);if(!current||terminal.has(current.status))return;if(error.code==='storage_error'){storageFailure(id);return;}try{await update(id,job=>terminal.has(job.status)?null:job.providerStatus==='succeeded'?localizationFailure(job):recover(job,error.code||'provider_connection_unconfirmed',!!job.providerTaskId));}catch{storageFailure(id);}}
 function launch(id,action){if(active.has(id))return active.get(id);const pending=Promise.resolve().then(action).catch(error=>failedOperation(id,error)).finally(()=>{active.delete(id);controllers.delete(id);});active.set(id,pending);return pending;}
 async function dispatch(id){
  const controller=new AbortController();controllers.set(id,controller);let job=jobs.get(id);if(closing||job.status!=='queued')return;
  try{
   const prepared=await prepareRequest(structuredClone(job.request));rejectCredentials(prepared);canonical(prepared);if(!prepared||prepared.kind!==job.request.kind)throw failure('生成请求准备失败','invalid_prepared_request');
   if(provider?.configured)await provider.prepare?.(prepared);
   job=await update(id,current=>current.status==='cancelled'?null:{...current,preparedRequest:prepared});
  }catch(error){if(error.code==='storage_error')throw error;const localError=protocolFor(job.request)==='openai-native'&&job.request.kind==='video.analyze'?localVideoErrorMessage(error.code):null;await update(id,current=>current.status==='cancelled'?null:{...current,status:error.code==='configuration_required'?'configuration_required':'failed',code:localError?error.code:error.code==='configuration_required'?'configuration_required':'request_preparation_failed',error:localError||'生成参数或模型映射未兼容，尚未提交远端',...(localError?{providerDispatched:false}:{})});return;}
  if(closing||job.status==='cancelled')return;
  if(!configured){await update(id,current=>current.status==='cancelled'?null:{...current,status:'configuration_required',code:'configuration_required',error:'尚未配置生成服务，未提交远端'});return;}
  // This durable intent precedes POST. A crash anywhere after this point without
  // a saved provider ID is ambiguous and must never trigger another POST.
  job=await update(id,current=>current.status==='cancelled'?null:{...current,status:'running',submissionState:'dispatching',providerFingerprint});
  if(closing||job.status==='cancelled'||controller.signal.aborted)return;
  await applyRemote(id,await remote('POST',null,job.preparedRequest,controller.signal));
 }
 async function submit(request,{idempotencyKey}={}){
  await ready;if(closing)throw failure('生成任务服务已关闭','service_closed',503);requestKey(idempotencyKey);rejectCredentials(request);if(!request||typeof request.kind!=='string')throw failure('生成任务参数无效','invalid_request');const hash=digest(request),fixed=structuredClone(request);let created=false;
  const job=await serialize(async()=>{
   const previous=keys.get(idempotencyKey);if(previous){const saved=jobs.get(previous);if(saved.requestHash!==hash)throw failure('此幂等键已用于不同生成请求','idempotency_conflict',409);return saved;}
   if(jobs.size>=maxTasks)throw failure('生成任务记录已满，请保留记录后清理','task_capacity',429);
   const next={version:1,id:randomUUID(),idempotencyKey,requestHash:hash,request:fixed,status:'queued',submissionState:'queued',progress:0,createdAt:now(),updatedAt:now()};try{await persist(next);}catch(error){jobs.set(next.id,recover(next,'storage_error',false));keys.set(idempotencyKey,next.id);throw error;}created=true;return next;
  });
  if(created)launch(job.id,()=>dispatch(job.id));return exposed(job);
 }
 async function refreshAndLocalize(id){
  const current=jobs.get(id);if(!current||closing||current.status==='cancelled')return;
  const failedRefresh=async(code,retryable=true)=>update(id,job=>job.status==='cancelled'?null:localizationFailure(job,code,{sourceRefreshRequired:true,retryable}));
  if(!current.providerTaskId||provider&&(typeof provider.poll!=='function'||provider.isPollable?.(current.preparedRequest||current.request)===false)){await failedRefresh('media_source_refresh_unavailable',false);return;}
  if(!compatible(current)){await failedRefresh(configured?'media_source_provider_changed':'media_source_configuration_required');return;}
  const controller=new AbortController();controllers.set(id,controller);
  try{
   // One read of the original task per explicit recovery. Never call submit or
   // reselect the model route to refresh an expired private download descriptor.
   const value=await remote('GET',current.providerTaskId,null,controller.signal);
   if(closing||controller.signal.aborted||jobs.get(id)?.status==='cancelled')return;
   if(value?.id!==current.providerTaskId){await failedRefresh('media_source_identity_mismatch');return;}
   if(value.status!=='succeeded'||value.outputs===undefined){await failedRefresh('media_source_refresh_unconfirmed');return;}
   const outputs=checkedOutputs(value.outputs);
   await update(id,job=>job.status==='cancelled'?null:{...job,status:'running',outputs:undefined,providerStatus:'succeeded',providerResult:{outputs},localization:{state:'pending',revision:(job.localization?.revision||0)+1,resources:[],retryable:true},error:undefined,code:undefined,recovery:undefined});
   if(!closing&&!controller.signal.aborted&&jobs.get(id)?.status!=='cancelled')await localize(id);
  }catch(error){
   if(closing||controller.signal.aborted||jobs.get(id)?.status==='cancelled')return;
   if(error.code==='storage_error')throw error;
   await failedRefresh('media_source_refresh_failed');
  }
 }
 async function get(id){
  await ready;let job=jobs.get(id);if(!job)return null;if(closing||job.status==='cancelled')return exposed(job);
  if(active.has(id)){if(job.providerStatus!=='succeeded'&&provider&&(!provider.poll||provider.isPollable?.(job.preparedRequest||job.request)===false))return exposed(job);await active.get(id);return exposed(jobs.get(id));}
  if(job.code==='storage_error')return exposed(job);
  if(job.providerStatus==='succeeded'&&job.providerResult?.outputs){
   if(job.localization?.state==='ready'){
    try{await verifyLocalized(checkedOutputs(job.outputs,{localOnly:true}),id);return exposed(job);}
    catch{await update(id,current=>current.localization?.state==='ready'?localizationFailure(current,'media_localization_failed',{revision:(current.localization?.revision||0)+1}):null);job=jobs.get(id);}
   }
   await launch(id,()=>job.localization?.sourceRefreshRequired||job.localization?.errorCode==='media_download_expired'?refreshAndLocalize(id):localize(id));return exposed(jobs.get(id));
  }
  if(terminal.has(job.status)||!job.providerTaskId)return exposed(job);
  if(!compatible(job)){await update(id,current=>recover(current,configured?'provider_configuration_changed':'configuration_required',false));return exposed(jobs.get(id));}
  await launch(id,async()=>{const controller=new AbortController();controllers.set(id,controller);await applyRemote(id,await remote('GET',job.providerTaskId,null,controller.signal));});return exposed(jobs.get(id));
 }
 async function lookup(key){await ready;requestKey(key);const id=keys.get(key);return id?get(id):null;}
 async function deleteRemote(id){
  const job=jobs.get(id);if(job?.providerStatus==='succeeded'||!job?.providerTaskId||!compatible(job)||closing||job.cancellation?.providerCancellation==='confirmed')return;
  if(provider&&!provider.cancel)return;
  let confirmed=false;try{if(provider){confirmed=(await provider.cancel(job.providerTaskId,{signal:AbortSignal.timeout(5000)}))?.status==='cancelled';}else{const response=await fetchImpl(endpoint+'/tasks/'+encodeURIComponent(job.providerTaskId),{method:'DELETE',headers,signal:AbortSignal.timeout(5000)});if(response.ok){const value=await response.json();confirmed=value.status==='cancelled';}}}catch{}
  if(confirmed)await update(id,current=>current.status==='cancelled'?{...current,cancellation:{...current.cancellation,providerCancellation:'confirmed'}}:null);
 }
 async function cancel(id){
  await ready;const current=jobs.get(id);if(!current)return null;
  if(terminal.has(current.status))return {...exposed(current),cancellation:{id,outcome:'already_terminal',status:current.status,localCancellationRequested:false,lateResultBlocked:!!current.cancellation?.lateResultBlocked,providerCancellation:current.cancellation?.providerCancellation||'not_requested'}};
  const receipt={id,outcome:'cancel_requested',status:'cancelled',localCancellationRequested:true,lateResultBlocked:true,providerCancellation:current.providerStatus==='succeeded'?'already_succeeded':current.submissionState==='queued'?'not_requested':'unconfirmed',requestedAt:now()};
  try{await update(id,job=>terminal.has(job.status)?null:{...job,status:'cancelled',outputs:undefined,cancellation:receipt,...(job.localization?{localization:{...job.localization,state:'cancelled',retryable:false}}:{}),error:undefined,code:undefined,recovery:undefined});}catch(error){controllers.get(id)?.abort();throw error;}
  const latest=jobs.get(id);if(latest.status!=='cancelled')return {...exposed(latest),cancellation:{id,outcome:'already_terminal',status:latest.status,localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'}};
  controllers.get(id)?.abort();await deleteRemote(id);return exposed(jobs.get(id));
 }
 function close(){if(closePromise)return closePromise;closing=true;for(const controller of controllers.values())controller.abort();closePromise=(async()=>{await ready.catch(()=>{});await Promise.allSettled([...active.values()]);await mutations;await store.close?.();})();return closePromise;}
 async function ownsResource(taskId,resourceId){await ready;const job=jobs.get(taskId);return !!job&&job.status==='succeeded'&&job.localization?.state==='ready'&&job.localization.resources?.includes(resourceId);}
 // Pending descriptors are resumed as downloads only, never as POST dispatches.
 ready.then(()=>{if(!closing)for(const job of jobs.values())if(job.providerStatus==='succeeded'&&job.status==='running')launch(job.id,()=>localize(job.id));}).catch(()=>{});
 return {ready,submit,get,lookup,cancel,configured,close,ownsResource};
}
module.exports={createDurableGenerationService,rejectCredentials,checkedOutputs,isLocalMedia};
