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
function outputShape(value,allowed,required=[]){
 if(!outputObject(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw outputFailure();
}
function outputResourceUrl(value,{http=false}={}){
 if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x20\x7f]/.test(value))throw outputFailure();
 let url;try{url=new URL(value);}catch{throw outputFailure();}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!['https:',...(http?['http:']:[])].includes(url.protocol)||url.username||url.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168|198\.(?:18|19))\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||/^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(host))throw outputFailure();
 return value;
}
function checkedWorld(output){
 const world=output.world;
 if(output.type!=='model'||output.format!=='spz'||output.representation!=='gaussianSplat')throw outputFailure();
 outputShape(world,['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution'],['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution']);
 if(typeof world.worldId!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(world.worldId)||['.','..'].includes(world.worldId)||world.worldId!==output.sourceFileId||!['marble-1.1','marble-1.1-plus','marble-1.0','marble-1.0-draft'].includes(world.model)||world.coordinateSystem!=='marble_raw_opencv'||!['100k','150k','500k','full_res'].includes(world.splatResolution))throw outputFailure();
 outputResourceUrl(world.marbleUrl);outputResourceUrl(output.url);
 if(output.poster!==undefined)outputResourceUrl(output.poster);
 outputShape(world.assets,['splats','mesh','imagery'],['splats']);
 const splats=world.assets.splats;
 outputShape(splats,['spzUrls','semanticsMetadata'],['spzUrls','semanticsMetadata']);
 outputShape(splats.spzUrls,['100k','150k','500k','full_res'],[world.splatResolution]);
 if(!Object.keys(splats.spzUrls).length||splats.spzUrls[world.splatResolution]!==output.url)throw outputFailure();
 for(const url of Object.values(splats.spzUrls)){outputResourceUrl(url);if(/\.(?:glb|gltf|ply|obj)$/i.test(new URL(url).pathname))throw outputFailure();}
 outputShape(splats.semanticsMetadata,['metricScaleFactor','groundPlaneOffset'],['metricScaleFactor','groundPlaneOffset']);
 if(!Number.isFinite(splats.semanticsMetadata.metricScaleFactor)||splats.semanticsMetadata.metricScaleFactor<=0||!Number.isFinite(splats.semanticsMetadata.groundPlaneOffset))throw outputFailure();
 // Collider meshes are auxiliary assets. Only the selected SPZ is the world
 // scene; retaining meshes here must never change its Gaussian representation.
 if(world.assets.mesh!==undefined){outputShape(world.assets.mesh,['colliderMeshUrl','fullResMeshUrl','hqMeshUrl']);for(const url of Object.values(world.assets.mesh))outputResourceUrl(url);}
 if(world.assets.imagery!==undefined){outputShape(world.assets.imagery,['panoUrl'],['panoUrl']);outputResourceUrl(world.assets.imagery.panoUrl);}
 return structuredClone(world);
}
function checkedOutputMetadata(output){
 const metadata={};
 if(output.format!==undefined){if(output.type!=='model'||!['glb','spz'].includes(output.format))throw outputFailure();metadata.format=output.format;outputResourceUrl(output.url||output.model);}
 if(output.representation!==undefined){if(output.type!=='model'||!['mesh','gaussianSplat'].includes(output.representation)||output.format==='glb'&&output.representation!=='mesh'||output.format==='spz'&&output.representation!=='gaussianSplat')throw outputFailure();metadata.representation=output.representation;}
 if(output.filename!==undefined){if(typeof output.filename!=='string'||!output.filename.trim()||output.filename.length>255||/[\x00-\x1f\x7f/\\]/.test(output.filename)||['.','..'].includes(output.filename)||output.format&&!output.filename.toLowerCase().endsWith('.'+output.format))throw outputFailure();metadata.filename=output.filename;}
 if(output.fullImage!==undefined){
  if(output.type!=='image'||typeof output.fullImage!=='string')throw outputFailure();
  if(output.fullImage.startsWith('data:')){if(output.fullImage.length>64*1024*1024||!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(output.fullImage))throw outputFailure();}
  else outputResourceUrl(output.fullImage,{http:true});
  metadata.fullImage=output.fullImage;
 }
 if(output.world!==undefined)metadata.world=checkedWorld(output);
 return metadata;
}
function checkedOutputs(outputs){
 if(!Array.isArray(outputs)||!outputs.length)throw failure('生成服务未返回实际结果','missing_outputs');
 rejectCredentials(outputs);const fields=['type','url','image','video','audio','model','text','title','width','height','duration','sourceFileId','poster','sourceUrl','sourceRange'];
 for(const output of outputs)if(output?.sourceRange!==undefined){const range=output.sourceRange;if(output.type!=='video'||!range||typeof range!=='object'||Array.isArray(range)||Object.keys(range).sort().join(',')!=='end,start'||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw failure('分镜来源时间范围无效','invalid_outputs');}
 return outputs.map(output=>{const source=output?.url||output?.[output?.type];if(!['image','video','audio','text','model'].includes(output?.type)||(output.type==='text'?typeof output.text!=='string'||!output.text.trim():typeof source!=='string'||!source))throw failure('生成结果格式无效','invalid_outputs');if(output.type!=='text'&&!/^(https?:|data:(image|video|audio)\/|blob:)/.test(source))throw failure('生成结果地址无效','invalid_outputs');return {...Object.fromEntries(fields.filter(key=>output[key]!==undefined).map(key=>[key,structuredClone(output[key])])),...checkedOutputMetadata(output)};});
}

function createDurableGenerationService({directory,store=null,baseUrl='',apiKey='',fetchImpl=fetch,provider=null,prepareRequest=async value=>value,now=Date.now,maxTasks=500,requestTimeout=30000}={}){
 let endpoint='';if(baseUrl){const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw failure('生成网关地址不能包含凭据或查询参数','invalid_provider');endpoint=url.href.replace(/\/$/,'');}
 if(!store){if(!directory)throw TypeError('Durable generation requires a private store directory');store=createGenerationStore({directory});}
 const providerFingerprint=provider?provider.fingerprint:endpoint?digest(endpoint):null,configured=provider?provider.configured:!!endpoint&&!!apiKey,headers={'Content-Type':'application/json',Authorization:'Bearer '+apiKey};
 const jobs=new Map(),keys=new Map(),active=new Map(),controllers=new Map();let mutations=Promise.resolve(),closing=false;
 const serialize=fn=>{const operation=mutations.then(fn);mutations=operation.catch(()=>{});return operation;};
 const exposed=job=>job?structuredClone(job):null;
 const recover=(job,reason,retryableLookup=false)=>{const {outputs,...record}=job;return {...record,status:'unknown',code:reason,error:'生成状态尚未确认，未重新提交生成请求',recovery:{reason,retryableLookup}};};
 async function persist(job){await store.write(job);jobs.set(job.id,job);keys.set(job.idempotencyKey,job.id);return job;}
 const ready=(async()=>{
  for(const saved of await store.readAll()){
   rejectCredentials(saved.request);if(saved.preparedRequest)rejectCredentials(saved.preparedRequest);
   if(saved.version!==1||typeof saved.id!=='string'||!saved.request||typeof saved.requestHash!=='string'||digest(saved.request)!==saved.requestHash||keys.has(requestKey(saved.idempotencyKey))||jobs.has(saved.id))throw failure('生成任务记录损坏，已阻止创建新任务','storage_corrupt',503);
   let job=saved;
   if(saved.status==='succeeded'){try{job={...saved,outputs:checkedOutputs(saved.outputs)};}catch{job=recover(saved,'stored_outputs_invalid',!!saved.providerTaskId);}}
   else if(!terminal.has(saved.status)){
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
  if(jobs.get(id).status==='cancelled'){if(jobs.get(id).providerTaskId)await deleteRemote(id);return;}
  if(value?.outputs!==undefined){
   if(value.status!==undefined&&value.status!=='succeeded')throw failure('生成服务尚未确认成功，不能接受附带结果','contradictory_outputs');
   const outputs=checkedOutputs(value.outputs);await update(id,job=>job.status==='cancelled'?null:{...job,status:'succeeded',outputs,progress:100,error:undefined,code:undefined,recovery:undefined});return;
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
 async function failedOperation(id,error){if(closing)return;const current=jobs.get(id);if(!current||terminal.has(current.status))return;if(error.code==='storage_error'){storageFailure(id);return;}try{await update(id,job=>terminal.has(job.status)?null:recover(job,error.code||'provider_connection_unconfirmed',!!job.providerTaskId));}catch{storageFailure(id);}}
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
 async function get(id){
  await ready;let job=jobs.get(id);if(!job)return null;if(closing||terminal.has(job.status))return exposed(job);
  if(active.has(id)){if(provider&&(!provider.poll||provider.isPollable?.(job.preparedRequest||job.request)===false))return exposed(job);await active.get(id);return exposed(jobs.get(id));}
  if(job.code==='storage_error'||!job.providerTaskId)return exposed(job);
  if(!compatible(job)){await update(id,current=>recover(current,configured?'provider_configuration_changed':'configuration_required',false));return exposed(jobs.get(id));}
  await launch(id,async()=>{const controller=new AbortController();controllers.set(id,controller);await applyRemote(id,await remote('GET',job.providerTaskId,null,controller.signal));});return exposed(jobs.get(id));
 }
 async function lookup(key){await ready;requestKey(key);const id=keys.get(key);return id?get(id):null;}
 async function deleteRemote(id){
  const job=jobs.get(id);if(!job?.providerTaskId||!compatible(job)||closing||job.cancellation?.providerCancellation==='confirmed')return;
  if(provider&&!provider.cancel)return;
  let confirmed=false;try{if(provider){confirmed=(await provider.cancel(job.providerTaskId,{signal:AbortSignal.timeout(5000)}))?.status==='cancelled';}else{const response=await fetchImpl(endpoint+'/tasks/'+encodeURIComponent(job.providerTaskId),{method:'DELETE',headers,signal:AbortSignal.timeout(5000)});if(response.ok){const value=await response.json();confirmed=value.status==='cancelled';}}}catch{}
  if(confirmed)await update(id,current=>current.status==='cancelled'?{...current,cancellation:{...current.cancellation,providerCancellation:'confirmed'}}:null);
 }
 async function cancel(id){
  await ready;const current=jobs.get(id);if(!current)return null;
  if(terminal.has(current.status))return {...exposed(current),cancellation:{id,outcome:'already_terminal',status:current.status,localCancellationRequested:false,lateResultBlocked:!!current.cancellation?.lateResultBlocked,providerCancellation:current.cancellation?.providerCancellation||'not_requested'}};
  const receipt={id,outcome:'cancel_requested',status:'cancelled',localCancellationRequested:true,lateResultBlocked:true,providerCancellation:current.submissionState==='queued'?'not_requested':'unconfirmed',requestedAt:now()};
  try{await update(id,job=>terminal.has(job.status)?null:{...job,status:'cancelled',cancellation:receipt,error:undefined,code:undefined,recovery:undefined});}catch(error){controllers.get(id)?.abort();throw error;}
  const latest=jobs.get(id);if(latest.status!=='cancelled')return {...exposed(latest),cancellation:{id,outcome:'already_terminal',status:latest.status,localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'}};
  controllers.get(id)?.abort();await deleteRemote(id);return exposed(jobs.get(id));
 }
 async function close(){closing=true;for(const controller of controllers.values())controller.abort();await ready.catch(()=>{});await mutations;await store.close?.();}
 return {ready,submit,get,lookup,cancel,configured,close};
}
module.exports={createDurableGenerationService,rejectCredentials};
