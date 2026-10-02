'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const endpoints={'image.remove-background':'fal-ai/birefnet','image.upscale':'fal-ai/topaz/upscale/image'};
const topazStyles=Object.freeze({general:'Standard V2',low_resolution:'Low Resolution V2',animation_3d:'CGI',high_fidelity:'High Fidelity V2',text_refine:'Text Refine'});
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const taskId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value);
function publicImageUrl(value){
 let url;try{url=new URL(value);}catch{throw localFail('图片须为有效内联 PNG、JPEG、WebP 或公网 HTTPS 地址');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168)\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host))throw localFail('图片须为不含凭据的公网 HTTPS 地址');
 return url.href;
}
function parseModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value||{};
 if(!object(map)||Object.keys(map).length>100)throw fail('fal 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','model'].includes(key))||!own(endpoints,entry.kind)||entry.model!==endpoints[entry.kind])throw fail('fal 模型映射须选择已核实的抠图或 Topaz 图片接口','configuration_invalid');
 }
 return structuredClone(map);
}
function createFalProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},endpoint='https://queue.fal.run',configurationError=null;
 try{
  mapping=parseModelMap(modelMap);
  if(typeof baseUrl!=='string')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!=='https://queue.fal.run'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#')||url.pathname!=='/')throw Error();endpoint=url.href.replace(/\/$/,'');}
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
 }catch{configurationError='configuration_invalid';mapping={};}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(canonical({protocol:'fal-native',endpoint,mapping})).digest('hex');
 const metadata={configured,protocol:'fal-native',missing,configurationError,capabilities:{kinds:[...new Set(Object.values(mapping).map(entry=>entry.kind))],models:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{kind:entry.kind}])),references:true,imageReferences:Object.fromEntries(Object.entries(mapping).map(([alias])=>[alias,{maxImages:1,mimeTypes:['image/png','image/jpeg','image/webp'],transport:'inline-or-public-https'}])),remoteRecovery:true,remoteCancellation:'best-effort',verified:'official-schema-and-local-contract'}};
 const queue=createFalQueue({baseUrl:endpoint||'https://queue.fal.run',apiKey,fetchImpl});
 function resolve(request){
  if(!configured)throw fail('fal 尚未配置，请检查服务端地址、Key 与模型映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||!own(endpoints,request.kind)||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFail('fal 当前仅支持不超过 64 MiB 的图片抠图和 Topaz 放大请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire))throw localFail('图片增强参数无效');
  const explicit=wire.model??p.modelId??p.model;
  const alias=explicit??(request.kind==='image.upscale'&&typeof p.provider==='string'?'image.upscale:'+p.provider:request.kind);
  if(typeof alias!=='string'||!alias.trim()||!own(mapping,alias)||mapping[alias].kind!==request.kind)throw fail('当前图片操作尚未映射到 fal 官方接口','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias))throw localFail('图片增强模型标识不一致');
  if(Object.keys(wire).some(key=>key!=='model'))throw localFail('fal 图片操作含有尚未支持的供应商参数');
  const common=['model','modelId','providerParameters','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'];
  const allowed=new Set([...common,...(request.kind==='image.upscale'?['provider','style','scale']:['width','height'])]);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw localFail('fal 图片操作含有尚未支持的设置，不会忽略后提交');
  if(request.prompt!==undefined&&(typeof request.prompt!=='string'||request.prompt.trim()))throw localFail('抠图和精确 Topaz 放大不支持提示词');
  for(const value of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw localFail('fal 图片操作每个任务仅处理一张图片');
  // Legacy references are rejected here: the host must bind and normalize them
  // once before dispatch, so an additional unbound source cannot be discarded.
  if(request.references?.length||!Array.isArray(request.inputs)||request.inputs.length!==1||!object(request.inputs[0])||request.inputs[0].type!=='image')throw localFail('图片操作须绑定且仅提交一张源图片');
  const input=request.inputs[0];let imageUrl;
  if(typeof input.url==='string'&&input.url.startsWith('data:')){try{inlineImage(input,0);}catch{throw localFail('图片须为有效内联 PNG、JPEG 或 WebP');}imageUrl=input.url;}
  else imageUrl=publicImageUrl(input.url);
  const body={image_url:imageUrl,output_format:'png'};
  if(request.kind==='image.upscale'){
   if(p.provider!==undefined&&p.provider!=='topazlabs')throw localFail('此 fal 适配仅支持 Topazlabs，Magnific 参数尚无已核实的等价接口');
   const style=p.style??'general',scale=p.scale??2;
   if(!own(topazStyles,style))throw localFail('Topaz 放大风格不受支持');
   if(![2,4].includes(scale))throw localFail('fal Topaz 单次接口仅支持 2x 或 4x；6x 未提交，不会改倍数或自动发起多次收费');
   Object.assign(body,{model:topazStyles[style],upscale_factor:scale,crop_to_fill:false});
  }else{
   for(const key of ['width','height'])if(p[key]!==undefined&&(!Number.isSafeInteger(p[key])||p[key]<1||p[key]>65535))throw localFail('抠图画布尺寸无效');
   Object.assign(body,{output_mask:false,refine_foreground:true,sync_mode:false});
  }
  return {kind:request.kind,model:mapping[alias].model,body};
 }
 const envelope=(model,id,kind)=>'fl1.'+Buffer.from(JSON.stringify([model,id,kind])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1500||!/^fl1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==3||!own(endpoints,value[2])||value[0]!==endpoints[value[2]]||!taskId(value[1])||envelope(...value)!==id)throw Error();}catch{throw fail('fal 任务身份无效','provider_identity_mismatch');}
  if(!configured)throw fail('fal 原任务供应商尚未配置','configuration_required');
  if(!Object.values(mapping).some(entry=>entry.kind===value[2]&&entry.model===value[0]))throw fail('fal 原任务模型映射已变更','provider_configuration_changed');
  return {model:value[0],requestId:value[1],kind:value[2]};
 }
 function receipt(value,model,kind,expected){
  if(!object(value)||!taskId(value.requestId)||expected!==undefined&&value.requestId!==expected)throw fail('fal 回执任务身份未确认','provider_identity_mismatch');
  if(!['queued','running','succeeded','failed','unknown'].includes(value.status))throw fail('fal 任务状态未确认','unknown');
  const result={id:envelope(model,value.requestId,kind),status:value.status};
  if(value.status==='succeeded'){
   const image=value.result?.image;let url;
   try{if(!object(image)||typeof image.url!=='string')throw Error();url=publicImageUrl(image.url);if(image.content_type!==undefined&&image.content_type!==null&&!['image/png','image/jpeg','image/webp'].includes(image.content_type))throw Error();for(const key of ['width','height'])if(image[key]!==undefined&&image[key]!==null&&(!Number.isSafeInteger(image[key])||image[key]<1))throw Error();}catch{throw fail('fal 未返回可用的真实图片结果','unknown');}
   result.outputs=[{type:'image',url,mimeType:image.content_type||'image/png',sourceFileId:value.requestId,...Number.isSafeInteger(image.width)?{width:image.width}:{},...Number.isSafeInteger(image.height)?{height:image.height}:{}}];
  }else if(value.status==='failed'){result.code='provider_failed';result.error='fal 图片处理未完成';}
  else if(value.status==='unknown'){result.code='unknown';result.error='fal 任务状态尚未确认，不会重复提交';}
  return result;
 }
 function prepare(request){resolve(request);return request;}
 async function submit(request,{signal}={}){const prepared=resolve(request);return receipt(await queue.submit(prepared.model,prepared.body,{signal}),prepared.model,prepared.kind);}
 async function poll(id,{signal}={}){const stored=identity(id);return receipt(await queue.poll(stored.model,stored.requestId,{signal}),stored.model,stored.kind,stored.requestId);}
 async function cancel(id,{signal}={}){const stored=identity(id),value=await queue.cancel(stored.model,stored.requestId,{signal});if(value.requestId!==stored.requestId)throw fail('fal 取消回执身份未确认','provider_identity_mismatch');return {id,status:'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isFinite(timeout)||timeout<1||timeout>1800000||!Number.isFinite(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('fal 轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw fail('fal 图片处理未完成',value.status==='unknown'?'unknown':'provider_failed');
   return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw fail('fal 任务超时，状态尚未确认，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,cancel,generate};
}
module.exports={createFalProvider,topazStyles};
