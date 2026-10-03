'use strict';
const {createHash}=require('node:crypto');
const {rejectCredentials}=require('./generation-durable.cjs');
const {publicMediaUrl}=require('./generation-media-download.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFailure=message=>Object.assign(failure(message),{providerDispatched:false});
const endpoints=Object.freeze({flux:'fal-ai/flux-video-upscale',topaz:'fal-ai/topaz/upscale/video'});
const resolutions=Object.freeze({'1080p':1920,'2k':2560,'4k':3840});
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const taskId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value)&&value!=='.'&&value!=='..';

function parseFalVideoModelMap(value){
 const mapping=typeof value==='string'?JSON.parse(value):value||{};
 if(!object(mapping)||Object.keys(mapping).length>100)throw failure('fal 视频模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(mapping)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','model','enhancementModel'].includes(key))||entry.kind!=='video.upscale'||!Object.values(endpoints).includes(entry.model)||entry.model===endpoints.flux&&entry.enhancementModel!==undefined||entry.model===endpoints.topaz&&entry.enhancementModel!=='Proteus')throw failure('fal 视频映射须显式选择已核实的 FLUX 或 Topaz Proteus 接口','configuration_invalid');
 }
 return structuredClone(mapping);
}
function httpsMedia(value){
 try{const url=publicMediaUrl(value);if(url.protocol!=='https:')throw Error();return url.href;}
 catch{throw localFailure('视频须为内联 MP4 或不含凭据的公网 HTTPS 地址');}
}
function inlineMp4(url){
 const match=/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
 if(!match||match[1].length%4||match[1].length>Math.ceil(50000000/3)*4)throw localFailure('视频须为不超过 50 MB 的有效内联 MP4');
 const bytes=Buffer.from(match[1],'base64');
 if(!bytes.length||bytes.length>50000000||bytes.toString('base64')!==match[1])throw localFailure('内联视频大小或编码无效');
 // Check the complete ISO BMFF envelope. Full media decoding and authoritative
 // dimensions/duration belong to the host reader and the official model API.
 let offset=0;const atoms=new Set();
 while(offset<bytes.length){
  if(offset+8>bytes.length)throw localFailure('MP4 文件结构无效');
  let size=bytes.readUInt32BE(offset),header=8;
  const type=bytes.toString('ascii',offset+4,offset+8);
  if(size===1){if(offset+16>bytes.length)throw localFailure('MP4 文件结构无效');const extended=bytes.readBigUInt64BE(offset+8);if(extended>BigInt(Number.MAX_SAFE_INTEGER))throw localFailure('MP4 文件结构无效');size=Number(extended);header=16;}
  else if(size===0)size=bytes.length-offset;
  if(size<header||offset+size>bytes.length)throw localFailure('MP4 文件结构无效');
  if(type==='ftyp'){
   if(offset!==0||size<header+8||! /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(bytes.toString('ascii',offset+header,offset+header+4)))throw localFailure('视频须为 MP4，不能用图片或 MOV 替代');
  }
  atoms.add(type);offset+=size;
 }
 if(!['ftyp','moov','mdat'].every(type=>atoms.has(type)))throw localFailure('MP4 缺少必要的媒体数据或索引');
 return bytes.length;
}
function createFalVideoProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},endpoint='https://queue.fal.run',configurationError=null;
 try{
  mapping=parseFalVideoModelMap(modelMap);
  if(typeof baseUrl!=='string')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!=='https://queue.fal.run'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#'))throw Error();endpoint=url.href.replace(/\/$/,'');}
  if(typeof fetchImpl!=='function'||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
 }catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(canonical({protocol:'fal-video-native',endpoint,mapping})).digest('hex');
 const metadata={configured,protocol:'fal-video-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['video.upscale']:[],models:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{kind:'video.upscale',label:entry.model===endpoints.flux?'FLUX Video Upscale':'Topaz Proteus'}])),references:true,videoReferences:{maxVideos:1,mimeTypes:['video/mp4'],transport:'inline-or-public-https'},remoteRecovery:true,remoteCancellation:'best-effort',verified:'official-schema-and-local-contract'}};
 const queue=createFalQueue({baseUrl:endpoint,apiKey,fetchImpl});
 function resolve(request){
  if(!configured)throw failure('fal 视频增强尚未配置，请检查 Key 与模型映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='video.upscale'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFailure('fal 视频原生适配仅支持不超过 64 MiB 的单视频增强请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire)||Object.keys(wire).some(key=>key!=='model'))throw localFailure('视频增强供应商参数无效');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&own(mapping,alias)?mapping[alias]:null;
  if(!entry)throw failure('所选视频增强型号尚未映射到 fal 官方接口','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias))throw localFailure('视频增强模型标识不一致');
  const flux=entry.model===endpoints.flux;
  const allowed=new Set(['model','modelId','providerParameters','provider','resolution','originalWidth','originalHeight','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout',...(flux?['mode','creativity','upscaleFactor','durationSeconds','duration']:['width','height','frameRate','slowMotion'])]);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw localFailure('fal 视频增强含有尚未支持的设置，不会忽略后提交');
  if(p.provider!== (flux?'bfl':'topazlabs'))throw localFailure('视频增强菜单供应商与显式模型映射不符');
  for(const value of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw localFailure('每个视频增强任务只能提交一个结果');
  if(request.references?.length||!Array.isArray(request.inputs)||request.inputs.length!==1||!object(request.inputs[0])||request.inputs[0].type!=='video')throw localFailure('视频增强须且只能提交一个来源视频');
  const input=request.inputs[0];
  if([input.clip,input.trim,input.sourceClip,p.sourceClip,request.sourceClip].some(value=>value!==undefined&&value!==null))throw localFailure('来源片段尚未裁出实际 MP4，不会处理整片替代选段');
  if(input.role!==undefined&&input.role!=='source_video')throw localFailure('视频增强输入用途无效');
  const width=p.originalWidth,height=p.originalHeight;
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=65535)||!own(resolutions,p.resolution))throw localFailure('须提供真实源视频尺寸和 1080p、2K 或 4K 目标');
  const factor=resolutions[p.resolution]/Math.max(width,height);
  let videoUrl,sizeBytes;
  if(typeof input.url==='string'&&input.url.startsWith('data:')){sizeBytes=inlineMp4(input.url);videoUrl=input.url;}
  else videoUrl=httpsMedia(input.url);
  const body={video_url:videoUrl};
  const prompt=request.prompt??'';
  if(typeof prompt!=='string'||prompt.length>2000)throw localFailure('视频增强提示词须为不超过 2000 字符的文字');
  if(flux){
   if(!['precise','creative'].includes(p.mode)||p.creativity!==(p.mode==='creative'?1:0)||!Number.isFinite(p.upscaleFactor)||Math.abs(p.upscaleFactor-factor)>1e-9||factor<1.5||factor>3)throw localFailure('FLUX 模式、创意度和真实长边倍率须一致，倍率仅支持 1.5–3');
   if(!Number.isFinite(p.durationSeconds)||p.durationSeconds<=0||p.durationSeconds>20||p.duration!==Math.ceil(p.durationSeconds))throw localFailure('FLUX 来源视频须为 20 秒以内，时长元数据须一致');
   if(input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>50000000||sizeBytes!==undefined&&input.sizeBytes!==sizeBytes))throw localFailure('FLUX 来源视频须不超过 50 MB，字节数须与实际素材一致');
   if(p.mode==='precise'&&prompt.trim())throw localFailure('精准模式不支持创意提示词，不会忽略后提交');
   Object.assign(body,{upscale_factor:factor,creativity:p.creativity,...p.mode==='creative'&&prompt.trim()?{prompt:prompt.trim()}:{}});
  }else{
   if(width>=3840||height>=2160||factor<1||factor>4||p.width!==Math.round(width*factor)||p.height!==Math.round(height*factor))throw localFailure('Topaz 源尺寸、目标尺寸及 1–4 倍放大须一致，不支持缩小或改画幅');
   if(!['auto',30,60].includes(p.frameRate)||p.slowMotion!==1||prompt.trim())throw localFailure('已核实的 fal Topaz 接口仅支持原速和 auto/30/60fps；90fps、2x 慢放或提示词未提交');
   // Explicit H.264 avoids the official H.265 default, which is not uniformly
   // playable in the canvas browsers. No interpolation is requested for auto.
   Object.assign(body,{model:entry.enhancementModel,upscale_factor:factor,H264_output:true,...p.frameRate!=='auto'?{target_fps:p.frameRate}:{}});
  }
  return {model:entry.model,enhancementModel:entry.enhancementModel??null,body};
 }
 const envelope=(model,id,enhancementModel)=>'fv1.'+Buffer.from(JSON.stringify([model,id,'video.upscale',enhancementModel])).toString('base64url');
 function identity(id){
  let value;
  try{if(typeof id!=='string'||id.length>1800||!/^fv1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==4||!Object.values(endpoints).includes(value[0])||!taskId(value[1])||value[2]!=='video.upscale'||!(value[0]===endpoints.flux&&value[3]===null||value[0]===endpoints.topaz&&value[3]==='Proteus')||envelope(value[0],value[1],value[3])!==id)throw Error();}
  catch{throw failure('fal 视频任务身份无效','provider_identity_mismatch');}
  if(!configured)throw failure('原 fal 视频供应商尚未配置','configuration_required');
  if(!Object.values(mapping).some(entry=>entry.model===value[0]&&(entry.enhancementModel??null)===value[3]))throw failure('原 fal 视频模型映射已变更','provider_configuration_changed');
  return {model:value[0],requestId:value[1],enhancementModel:value[3]};
 }
 function receipt(value,model,enhancementModel,expected){
  if(!object(value)||!taskId(value.requestId)||expected!==undefined&&value.requestId!==expected)throw failure('fal 视频回执任务身份未确认','provider_identity_mismatch');
  if(!['queued','running','succeeded','failed','unknown'].includes(value.status))throw failure('fal 视频状态未确认','unknown');
  const result={id:envelope(model,value.requestId,enhancementModel),status:value.status};
  if(value.status==='succeeded'){
   const video=value.result?.video;let url;
   try{if(!object(video)||typeof video.url!=='string')throw Error();url=httpsMedia(video.url);if(video.content_type!==undefined&&video.content_type!==null&&video.content_type!=='video/mp4')throw Error();if(video.file_size!==undefined&&video.file_size!==null&&(!Number.isSafeInteger(video.file_size)||video.file_size<1))throw Error();}
   catch{throw failure('fal 未返回可用的真实 MP4 结果','unknown');}
   result.outputs=[{type:'video',url,...video.content_type?{mime:'video/mp4'}:{},sourceFileId:value.requestId}];
  }else if(value.status==='failed'){result.code='provider_failed';result.error='fal 视频增强未完成';}
  else if(value.status==='unknown'){result.code='unknown';result.error='原 fal 视频任务状态尚待确认，不会重复提交';}
  return result;
 }
 function prepare(request){resolve(request);return request;}
 async function submit(request,{signal}={}){const prepared=resolve(request);return receipt(await queue.submit(prepared.model,prepared.body,{signal}),prepared.model,prepared.enhancementModel);}
 async function poll(id,{signal}={}){const stored=identity(id);return receipt(await queue.poll(stored.model,stored.requestId,{signal}),stored.model,stored.enhancementModel,stored.requestId);}
 async function cancel(id,{signal}={}){const stored=identity(id),value=await queue.cancel(stored.model,stored.requestId,{signal});if(value.requestId!==stored.requestId)throw failure('fal 视频取消回执身份未确认','provider_identity_mismatch');return {id,status:'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isFinite(timeout)||timeout<1||timeout>1800000||!Number.isFinite(pollInterval)||pollInterval<1||pollInterval>30000)throw localFailure('fal 视频轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw failure('fal 视频增强未完成',value.status==='unknown'?'unknown':'provider_failed');
   return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw failure('fal 视频任务超时，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,cancel,generate};
}
module.exports={createFalVideoProvider,parseFalVideoModelMap,FAL_VIDEO_ENDPOINTS:endpoints};
