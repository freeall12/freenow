'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const versions=Object.freeze({'v3.1-20260211':'Tripo H3.1','v3.0-20250812':'Tripo H3.0'});
const modes=['text-to-model','image-to-model'];
const validTask=value=>typeof value==='string'&&/^task_[A-Za-z0-9_-]{1,180}$/.test(value);
const validFile=value=>typeof value==='string'&&/^file_[A-Za-z0-9_-]{1,180}$/.test(value);
function publicUrl(value){
 let url;try{url=new URL(value);}catch{throw localFail('Tripo 素材须为有效内联 PNG/JPEG 或公网 HTTPS 地址');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168)\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host))throw localFail('Tripo 素材须为不含凭据的公网 HTTPS 地址');
 return url.href;
}
function parseTripoModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).length>100)throw fail('Tripo 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','mode','model','displayModel'].includes(key))||entry.kind!=='world.generate'||!modes.includes(entry.mode)||!own(versions,entry.model)||entry.displayModel!==versions[entry.model])throw fail('Tripo 须显式配置已核实的 V3.0/V3.1 型号和真实版本标签','configuration_invalid');
 }
 return structuredClone(map);
}
function createTripoProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let endpoint='https://openapi.tripo3d.ai/v3',mapping={},configurationError=null;
 try{
  mapping=parseTripoModelMap(modelMap);
  if(typeof baseUrl!=='string'||typeof fetchImpl!=='function')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||!['https://openapi.tripo3d.ai','https://openapi.tripo3d.com'].includes(url.origin)||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#')||!['/v3','/v3/'].includes(url.pathname))throw Error();endpoint=url.href.replace(/\/$/,'');}
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
 }catch{configurationError='configuration_invalid';mapping={};}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(canonical({protocol:'tripo-native',endpoint,mapping})).digest('hex');
 const worldGeneration=Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{mode:entry.mode,displayModel:entry.displayModel,maxCount:1,maxImages:entry.mode==='image-to-model'?1:0,maxVideos:0,maxAudios:0,inlineImageMimeTypes:['image/png','image/jpeg'],maxImageBytes:20*1024*1024}]));
 const metadata={configured,protocol:'tripo-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['world.generate']:[],models:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{kind:entry.kind,label:entry.displayModel}])),worldGeneration,references:true,remoteRecovery:true,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 function resolve(request){
  if(!configured)throw fail('Tripo 尚未配置，请检查服务端 Key 与真实型号映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='world.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFail('Tripo 仅支持不超过 64 MiB 的 3D 资产请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire))throw localFail('Tripo 参数无效');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&own(mapping,alias)?mapping[alias]:null;
  if(!entry)throw fail('当前 3D 模型尚未映射到 Tripo 真实型号','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias))throw localFail('Tripo 模型标识不一致');
  if(Object.keys(wire).some(key=>key!=='model'))throw localFail('Tripo 供应商参数尚未支持');
  const allowed=new Set(['model','modelId','providerParameters','provider','modelType','outputType','representation','isPano','tripoParams','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout']);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw localFail('Tripo 请求含有尚未支持的设置，不会忽略后提交');
  if(p.provider!==undefined&&p.provider!=='tripo'||p.outputType!==undefined&&p.outputType!=='asset'||p.representation!==undefined&&p.representation!=='mesh'||p.isPano!==undefined&&p.isPano!==false)throw localFail('Tripo 原生接口仅支持普通 3D 网格资产');
  for(const value of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw localFail('Tripo 每个任务仅生成一个模型');
  if(request.references?.length)throw localFail('Tripo 参考素材须完整展开为 inputs');
  const inputs=request.inputs??[];
  if(!Array.isArray(inputs)||inputs.some(input=>!object(input)||input.type!=='image')||inputs.length!==(entry.mode==='image-to-model'?1:0))throw localFail('Tripo 文字模式不接受媒体，图片模式须仅输入一张图片');
  const expectedMode=entry.mode==='image-to-model'?'IMAGE_TO_WORLD':'TEXT_TO_WORLD';
  if(p.modelType!==undefined&&p.modelType!==expectedMode)throw localFail('Tripo 生成方式与参考输入不一致');
  const prompt=request.prompt??'';
  if(typeof prompt!=='string'||entry.mode==='text-to-model'&&(!prompt.trim()||prompt.length>1024)||entry.mode==='image-to-model'&&prompt.trim())throw localFail('Tripo 文字提示词须为 1–1024 字符；图片模式不支持额外提示词');
  const params=p.tripoParams??{};
  if(!object(params))throw localFail('Tripo 生成设置无效');
  const bools=['texture','pbr','smart_low_poly','quad','auto_size','generate_parts','export_uv'];
  const permitted=[...bools,'geometry_quality','compress','texture_quality',...(entry.mode==='image-to-model'?['enable_image_autofix','orientation','texture_alignment']:[])];
  if(Object.keys(params).some(key=>!permitted.includes(key)))throw localFail('Tripo 存在尚未支持的参数');
  for(const key of [...bools,'enable_image_autofix'])if(params[key]!==undefined&&typeof params[key]!=='boolean')throw localFail('Tripo 布尔参数无效');
  for(const [key,values]of [['geometry_quality',['standard','detailed']],['texture_quality',['standard','detailed','extreme']],['compress',['geometry']],['orientation',['default','align_image']],['texture_alignment',['original_image','geometry']]])if(params[key]!==undefined&&!values.includes(params[key]))throw localFail('Tripo 参数值不受支持');
  if(params.quad===true||params.generate_parts===true)throw localFail('Tripo quad 输出 FBX、分件输出需要独立合同；当前 GLB 资产接口未提交');
  if(params.texture===false&&params.pbr!==false)throw localFail('Tripo 纯几何必须同时明确关闭 texture 和 pbr');
  if(params.texture===false&&(params.orientation==='align_image'||params.texture_alignment!==undefined))throw localFail('Tripo 纹理对齐需要开启 texture');
  const body={model:entry.model,...params,...entry.mode==='text-to-model'?{prompt}:{}};
  let upload;
  if(inputs.length){
   const input=inputs[0];
   if(typeof input.url==='string'&&input.url.startsWith('data:')){
    try{upload=inlineImage(input,0);}catch{throw localFail('Tripo 内联图片编码或像素结构无效');}
    if(!['image/png','image/jpeg'].includes(upload.mime)||upload.bytes.length>20*1024*1024)throw localFail('Tripo 官方上传仅核实 PNG/JPEG 且不超过 20 MiB；请先转换本地 WebP');
   }else body.input=publicUrl(input.url);
  }
  return {entry,body,upload};
 }
 async function read(path,method,body,signal,multipart=false){
  if(!configured)throw fail('Tripo 原任务供应商尚未配置','configuration_required');
  const timed=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=operation=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return operation();}),interrupted]);
  try{
   const response=await wait(()=>fetchImpl(endpoint+path,{method,redirect:'error',headers:{Authorization:'Bearer '+apiKey,...multipart?{}:{'Content-Type':'application/json'}},signal:combined,...body!==undefined?{body:multipart?body:JSON.stringify(body)}:{}}));
   if(!response.ok||Number(response.headers?.get('content-length'))>1024*1024){response.body?.cancel().catch(()=>{});throw Error();}
   if(!response.body?.getReader)throw Error();
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)throw Error();parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
   if(!object(value)||value.code!==0||!object(value.data))throw Error();return value.data;
  }catch{if(signal?.aborted)throw signal.reason;throw fail('Tripo 请求状态未确认，请查询原任务；未自动重试','unknown');}
  finally{combined.removeEventListener('abort',abort);}
 }
 const envelope=(model,mode,id)=>'tp3.'+Buffer.from(JSON.stringify([model,mode,id])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1500||!/^tp3\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==3||!own(versions,value[0])||!modes.includes(value[1])||!validTask(value[2])||envelope(...value)!==id)throw Error();}catch{throw fail('Tripo 任务身份无效','provider_identity_mismatch');}
  if(!configured)throw fail('Tripo 原任务供应商尚未配置','configuration_required');
  if(!Object.values(mapping).some(entry=>entry.model===value[0]&&entry.mode===value[1]))throw fail('Tripo 原任务型号映射已变更','provider_configuration_changed');
  return {model:value[0],mode:value[1],taskId:value[2]};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  if(prepared.upload){const form=new FormData();form.append('file',new Blob([prepared.upload.bytes],{type:prepared.upload.mime}),prepared.upload.name);const uploaded=await read('/files','POST',form,signal,true);if(!validFile(uploaded.file_token))throw fail('Tripo 上传回执未确认；未提交生成任务','unknown');prepared.body.input=uploaded.file_token;}
  // Upload and task POST are only performed after an explicit generation request.
  // Neither operation is replayed when its response is lost.
  const value=await read('/generation/'+prepared.entry.mode,'POST',prepared.body,signal);
  if(!validTask(value.task_id))throw fail('Tripo 未返回有效任务身份；未自动重试','unknown');
  return {id:envelope(prepared.entry.model,prepared.entry.mode,value.task_id),status:'queued',progress:0};
 }
 async function poll(id,{signal}={}){
  const stored=identity(id),value=await read('/tasks/'+encodeURIComponent(stored.taskId),'GET',undefined,signal);
  if(value.task_id!==stored.taskId||value.type!==stored.mode.replaceAll('-','_'))throw fail('Tripo 查询回执任务身份或类型未确认','provider_identity_mismatch');
  if(!['queued','running','success','failed','cancelled','banned','expired'].includes(value.status))throw fail('Tripo 任务状态未确认','unknown');
  if(['failed','cancelled','banned','expired'].includes(value.status))return {id,status:value.status==='cancelled'?'cancelled':'failed',code:'provider_'+value.status,error:'Tripo 未完成 3D 资产生成'};
  if(!Number.isSafeInteger(value.progress)||value.progress<0||value.progress>100)throw fail('Tripo 任务进度无效','unknown');
  if(value.status!=='success'){if(value.output!==undefined&&value.output!==null)throw fail('Tripo 尚未确认成功却返回输出','unknown');return {id,status:value.status,progress:value.progress};}
  let url,poster;try{url=publicUrl(value.output?.model_url);if(!new URL(url).pathname.toLowerCase().endsWith('.glb'))throw Error();if(value.output.rendered_image_url!==undefined)poster=publicUrl(value.output.rendered_image_url);}catch{throw fail('Tripo 成功回执缺少真实 HTTPS GLB 结果','unknown');}
  return {id,status:'succeeded',progress:100,outputs:[{type:'model',url,sourceFileId:stored.taskId,...poster?{poster}:{}}]};
 }
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('Tripo 轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    onProgress(value.progress??0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw fail('Tripo 未完成 3D 资产生成',value.status==='cancelled'?'cancelled':'provider_failed');return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw fail('Tripo 任务超时，状态尚未确认，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate};
}
module.exports={createTripoProvider,parseTripoModelMap};
