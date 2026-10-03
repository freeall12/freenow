'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {publicMediaUrl}=require('./generation-media-download.cjs');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFailure=message=>Object.assign(failure(message),{providerDispatched:false});
const models=Object.freeze({'marble-1.1':'Marble 1.1','marble-1.1-plus':'Marble 1.1 Plus','marble-1.0':'Marble 1.0','marble-1.0-draft':'Marble 1.0 Draft'});
const modes=['TEXT_TO_WORLD','IMAGE_TO_WORLD','PANORAMA_TO_WORLD','MULTI_IMAGE_TO_WORLD','VIDEO_TO_WORLD'];
const resolutions=['500k','100k','150k','full_res'];
const validId=value=>typeof value==='string'&&value!=='.'&&value!=='..'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function publicUrl(value){
 let url;try{url=publicMediaUrl(value);if(url.protocol!=='https:')throw Error();}catch{throw localFailure('Marble 素材或资源需要有效的公网 HTTPS 地址');}
 return url.href;
}
function parseMarbleModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).length>100)throw failure('Marble 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','model','displayModel','modes'].includes(key))||entry.kind!=='world.generate'||!own(models,entry.model)||entry.displayModel!==models[entry.model]||!Array.isArray(entry.modes)||!entry.modes.length||entry.modes.some(mode=>!modes.includes(mode))||new Set(entry.modes).size!==entry.modes.length)throw failure('Marble 须显式配置官方型号、真实标签与允许的输入模式','configuration_invalid');
 }
 return structuredClone(map);
}
function localMedia(input,index){
 if(input.type==='image'){
  let media;try{media=inlineImage(input,index);}catch{throw localFailure('Marble 内联图片编码或像素结构无效');}
  if(media.bytes.length>20*1024*1024)throw localFailure('Marble 本地图片上传限制为 20 MiB');
  return {...media,kind:'image',extension:media.mime==='image/jpeg'?'jpg':media.mime.split('/')[1]};
 }
 const match=/^data:video\/(mp4|quicktime|webm|x-msvideo);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.url);
 if(!match||match[2].length%4!==0)throw localFailure('Marble 本地视频支持 MP4、MOV、WebM、AVI 内联素材');
 const bytes=Buffer.from(match[2],'base64'),format=match[1];
 if(!bytes.length||bytes.length>40*1024*1024||bytes.toString('base64')!==match[2])throw localFailure('Marble 本地视频编码无效或超过本项目 40 MiB 上传预算');
 const valid=['mp4','quicktime'].includes(format)?bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp'&&bytes.readUInt32BE(0)>=12&&bytes.readUInt32BE(0)<=bytes.length:format==='webm'?bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])):bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='AVI ';
 if(!valid)throw localFailure('Marble 视频容器头与 MIME 不一致');
 const extension={mp4:'mp4',quicktime:'mov',webm:'webm','x-msvideo':'avi'}[format];
 return {bytes,mime:'video/'+format,kind:'video',extension,name:'reference-'+(index+1)+'.'+extension};
}
function createMarbleProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let endpoint='https://api.worldlabs.ai/marble/v1',mapping={},configurationError=null;
 try{
  mapping=parseMarbleModelMap(modelMap);
  if(typeof baseUrl!=='string'||typeof fetchImpl!=='function')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!=='https://api.worldlabs.ai'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#')||!['/marble/v1','/marble/v1/'].includes(url.pathname))throw Error();endpoint=url.href.replace(/\/$/,'');}
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
 }catch{configurationError='configuration_invalid';mapping={};}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(canonical({protocol:'marble-native',endpoint,mapping})).digest('hex');
 const worldGeneration=Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>{
  const multiple=entry.modes.includes('MULTI_IMAGE_TO_WORLD'),images=multiple||entry.modes.some(mode=>['IMAGE_TO_WORLD','PANORAMA_TO_WORLD'].includes(mode)),videos=entry.modes.includes('VIDEO_TO_WORLD');
  return [alias,{modes:entry.modes,displayModel:entry.displayModel,maxCount:1,maxImages:multiple?8:images?1:0,maxImagesWithoutReconstruction:multiple?4:images?1:0,maxVideos:videos?1:0,maxAudios:0,inlineImageMimeTypes:images?['image/png','image/jpeg','image/webp']:[],inlineVideoMimeTypes:videos?['video/mp4','video/quicktime','video/webm','video/x-msvideo']:[],maxImageBytes:images?20*1024*1024:0,maxVideoBytes:videos?40*1024*1024:0,splatResolutions:resolutions}];
 }));
 const metadata={configured,protocol:'marble-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['world.generate']:[],models:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{kind:entry.kind,label:entry.displayModel}])),worldGeneration,references:Object.values(worldGeneration).some(profile=>profile.maxImages>0||profile.maxVideos>0),textReferences:false,output:{type:'model',format:'spz',representation:'gaussianSplat',coordinateSystem:'marble_raw_opencv'},remoteRecovery:true,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 function resolve(request){
  if(!configured)throw failure('Marble 尚未配置，请检查服务端 Key 与真实型号映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='world.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFailure('Marble 仅支持不超过 64 MiB 的世界生成请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire)||Object.keys(wire).some(key=>key!=='model'))throw localFailure('Marble 供应商参数无效');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&own(mapping,alias)?mapping[alias]:null;
  if(!entry)throw failure('当前世界模型尚未映射到 Marble 真实型号','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias))throw localFailure('Marble 模型标识不一致');
  const allowed=new Set(['model','modelId','providerParameters','provider','modelType','outputType','representation','isPano','marbleParams','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout']);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw localFailure('Marble 请求含有尚未支持的设置，不会忽略后提交');
  if(p.provider!==undefined&&p.provider!=='worldlabs'||p.outputType!==undefined&&p.outputType!=='world'||p.representation!==undefined&&p.representation!=='gaussianSplat')throw localFailure('Marble 原生接口生成 Gaussian Splat 世界');
  for(const count of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(count!==undefined&&count!==1)throw localFailure('Marble 每个任务仅生成一个世界');
  if(request.references?.length)throw localFailure('Marble 参考素材须完整展开为 inputs');
  const inputs=request.inputs??[];
  if(!Array.isArray(inputs)||inputs.some(input=>!object(input)||!['image','video'].includes(input.type)||typeof input.url!=='string'||input.clip!=null||input.trim!=null))throw localFailure('Marble 仅支持已完整处理的图片或视频素材；裁切须先物化');
  for(const input of inputs)if(input.sourceRange!==undefined){const range=input.sourceRange;if(input.type!=='video'||!object(range)||Object.keys(range).sort().join(',')!=='end,start'||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw localFailure('Marble 已物化视频的来源范围无效，未上传或提交生成');}
  const images=inputs.filter(input=>input.type==='image'),videos=inputs.filter(input=>input.type==='video');
  if(images.length&&videos.length||videos.length>1||images.length>8)throw localFailure('Marble 不支持图片视频混用、多个视频或超过 8 张图片');
  if(p.isPano!==undefined&&![true,false,'auto'].includes(p.isPano))throw localFailure('Marble 全景标识无效');
  const mode=videos.length?'VIDEO_TO_WORLD':images.length>1?'MULTI_IMAGE_TO_WORLD':images.length?p.isPano===true?'PANORAMA_TO_WORLD':'IMAGE_TO_WORLD':'TEXT_TO_WORLD';
  if(!entry.modes.includes(mode)||p.modelType!==undefined&&p.modelType!==mode||p.isPano===true&&images.length!==1)throw localFailure('Marble 生成方式与配置或素材不一致');
  const prompt=request.prompt??'';
  if(typeof prompt!=='string'||prompt.length>32768||mode==='TEXT_TO_WORLD'&&!prompt.trim())throw localFailure('Marble 文字模式需要提示词，本项目提示词限制 32768 字符');
  const params=p.marbleParams??{};
  if(!object(params)||Object.keys(params).some(key=>!['reconstruct_images','azimuths','disable_recaption','display_name','seed','splatResolution'].includes(key)))throw localFailure('Marble 存在尚未支持的生成参数');
  if(params.reconstruct_images!==undefined&&(mode!=='MULTI_IMAGE_TO_WORLD'||typeof params.reconstruct_images!=='boolean')||images.length>4&&params.reconstruct_images!==true)throw localFailure('Marble 普通多图最多 4 张；5–8 张须明确开启 reconstruct_images');
  if(params.azimuths!==undefined&&(mode!=='MULTI_IMAGE_TO_WORLD'||!Array.isArray(params.azimuths)||params.azimuths.length!==images.length||params.azimuths.some(value=>value!==null&&(!Number.isFinite(value)||value<0||value>=360))))throw localFailure('Marble azimuths 须与多图逐一对应，为 null 或 0–360 度');
  if(params.disable_recaption!==undefined&&typeof params.disable_recaption!=='boolean'||params.disable_recaption===true&&!prompt.trim())throw localFailure('Marble disable_recaption 需要布尔值；启用时须明确文字提示词');
  if(params.display_name!==undefined&&(typeof params.display_name!=='string'||!params.display_name.trim()||params.display_name.length>64)||params.seed!==undefined&&(!Number.isSafeInteger(params.seed)||params.seed<0||params.seed>4294967295))throw localFailure('Marble 标题或随机种子无效');
  const resolution=params.splatResolution??'500k';if(!resolutions.includes(resolution))throw localFailure('Marble SPZ 分辨率无效');
  const media=inputs.map((input,index)=>input.url.startsWith('data:')?{upload:localMedia(input,index)}:{content:{source:'uri',uri:publicUrl(input.url)}});
  const worldPrompt={type:{TEXT_TO_WORLD:'text',IMAGE_TO_WORLD:'image',PANORAMA_TO_WORLD:'image',MULTI_IMAGE_TO_WORLD:'multi-image',VIDEO_TO_WORLD:'video'}[mode],...prompt.trim()?{text_prompt:prompt}:{},...params.disable_recaption!==undefined?{disable_recaption:params.disable_recaption}:{}};
  if(images.length===1)worldPrompt.is_pano=p.isPano??false;
  if(mode==='MULTI_IMAGE_TO_WORLD')worldPrompt.reconstruct_images=params.reconstruct_images??false;
  return {entry,mode,resolution,media,azimuths:params.azimuths,body:{model:entry.model,world_prompt:worldPrompt,...params.display_name!==undefined?{display_name:params.display_name}:{},...params.seed!==undefined?{seed:params.seed}:{}}};
 }
 async function transport(url,options,signal,json=true){
  const timed=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=operation=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return operation();}),interrupted]);
  try{
   const response=await wait(()=>fetchImpl(url,{...options,redirect:'error',signal:combined}));
   if(!response.ok||Number(response.headers?.get('content-length'))>1024*1024){response.body?.cancel().catch(()=>{});throw Error();}
   if(!json){await wait(()=>response.body?.cancel());return;}
   if(!response.body?.getReader)throw Error();
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)throw Error();parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(!object(value))throw Error();return value;
  }catch{if(signal?.aborted)throw signal.reason;throw failure('Marble 请求状态未确认，请查询原任务；未自动重试','unknown');}
  finally{combined.removeEventListener('abort',abort);}
 }
 async function read(path,method,body,signal){
  if(!configured)throw failure('Marble 原任务供应商尚未配置','configuration_required');
  return transport(endpoint+path,{method,headers:{'WLT-Api-Key':apiKey,...body!==undefined?{'Content-Type':'application/json'}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}},signal);
 }
 const envelope=(model,mode,resolution,operationId)=>'mb1.'+Buffer.from(JSON.stringify([model,mode,resolution,operationId])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1500||!/^mb1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==4||!own(models,value[0])||!modes.includes(value[1])||!resolutions.includes(value[2])||!validId(value[3])||envelope(...value)!==id)throw Error();}catch{throw failure('Marble 任务身份无效','provider_identity_mismatch');}
  if(!configured)throw failure('Marble 原任务供应商尚未配置','configuration_required');
  if(!Object.values(mapping).some(entry=>entry.model===value[0]&&entry.modes.includes(value[1])))throw failure('Marble 原任务型号或模式映射已变更','provider_configuration_changed');
  return {model:value[0],mode:value[1],resolution:value[2],operationId:value[3]};
 }
 async function operation(value,stored,id,signal){
  if(value.operation_id!==stored.operationId||typeof value.done!=='boolean')throw failure('Marble 查询回执任务身份或状态未确认','provider_identity_mismatch');
  if(!value.done){if(value.response!=null||value.error!=null)throw failure('Marble 处理中回执含有终态结果','unknown');return {id,status:'running'};}
  if(value.error!=null){if(!object(value.error)||value.response!=null)throw failure('Marble 失败回执无效','unknown');return {id,status:'failed',code:'provider_failed',error:'Marble 未完成世界生成'};}
  let world=value.response;
  if(!object(world))throw failure('Marble 世界身份或实际型号未确认','provider_identity_mismatch');
  const identities=[world.world_id,world.id,value.metadata?.world_id].filter(value=>value!=null),worldId=identities[0];
  if(!identities.length||identities.some(value=>!validId(value)||value!==worldId)||world.model!=null&&world.model!==stored.model)throw failure('Marble 世界身份或实际型号未确认','provider_identity_mismatch');
  // Official Quickstart snapshots may omit model and use the legacy id field.
  // Hydrate only via GET of the corroborated world, never replay generation.
  if(world.world_id==null||world.model==null)world=await read('/worlds/'+encodeURIComponent(worldId),'GET',undefined,signal);
  if(world.world_id!==worldId||world.model!==stored.model)throw failure('Marble 世界身份或实际型号未确认','provider_identity_mismatch');
  const expectedType={TEXT_TO_WORLD:'text',IMAGE_TO_WORLD:'image',PANORAMA_TO_WORLD:'image',MULTI_IMAGE_TO_WORLD:'multi-image',VIDEO_TO_WORLD:'video'}[stored.mode];
  if(world.world_prompt?.type!==undefined&&world.world_prompt.type!==expectedType)throw failure('Marble 世界输入模式未确认','provider_identity_mismatch');
  let output;try{
   const assets=world.assets,splats=assets?.splats,semantics=splats?.semantics_metadata;
   if(!object(assets)||assets.mesh!=null&&!object(assets.mesh)||assets.imagery!=null&&!object(assets.imagery))throw Error();
   if(!object(splats?.spz_urls)||!own(splats.spz_urls,stored.resolution)||!object(semantics)||!Number.isFinite(semantics.metric_scale_factor)||semantics.metric_scale_factor<=0||!Number.isFinite(semantics.ground_plane_offset))throw Error();
   const spzUrls={};for(const [lod,url]of Object.entries(splats.spz_urls)){if(!resolutions.includes(lod))throw Error();spzUrls[lod]=publicUrl(url);if(/\.(?:glb|gltf|ply|obj)$/i.test(new URL(url).pathname))throw Error();}
   const optionalUrl=url=>url==null?undefined:publicUrl(url),mesh={};
   for(const [wire,key]of [['collider_mesh_url','colliderMeshUrl'],['full_res_mesh_url','fullResMeshUrl'],['hq_mesh_url','hqMeshUrl']]){const url=optionalUrl(assets.mesh?.[wire]);if(url)mesh[key]=url;}
   const pano=optionalUrl(assets.imagery?.pano_url),poster=optionalUrl(assets.thumbnail_url),marbleUrl=publicUrl(world.world_marble_url);
   output={type:'model',url:spzUrls[stored.resolution],format:'spz',representation:'gaussianSplat',sourceFileId:world.world_id,...poster?{poster}:{},world:{worldId:world.world_id,model:stored.model,marbleUrl,coordinateSystem:'marble_raw_opencv',splatResolution:stored.resolution,assets:{splats:{spzUrls,semanticsMetadata:{metricScaleFactor:semantics.metric_scale_factor,groundPlaneOffset:semantics.ground_plane_offset}},...Object.keys(mesh).length?{mesh}:{},...pano?{imagery:{panoUrl:pano}}:{}}}};
  }catch{throw failure('Marble 成功回执缺少实际 SPZ、所选分辨率或有效尺度元数据；未使用网格代理替代','unknown');}
  return {id,status:'succeeded',progress:100,outputs:[output]};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  for(const media of prepared.media){
   if(!media.upload)continue;
   const file=media.upload,value=await read('/media-assets:prepare_upload','POST',{file_name:file.name,kind:file.kind,extension:file.extension},signal);
   let url,headers;try{
    if(!validId(value.media_asset?.media_asset_id)||value.media_asset.kind!==file.kind||value.media_asset.extension!==file.extension||value.upload_info?.upload_method!=='PUT')throw Error();
    url=publicUrl(value.upload_info.upload_url);headers=value.upload_info.required_headers??{};
    if(!object(headers)||Object.keys(headers).length>24||new Set(Object.keys(headers).map(key=>key.toLowerCase())).size!==Object.keys(headers).length||Object.entries(headers).reduce((total,[key,value])=>total+key.length+(typeof value==='string'?value.length:0),0)>16384||Object.entries(headers).some(([key,value])=>!/^[-A-Za-z0-9]{1,80}$/.test(key)||typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value)||/^(authorization|proxy-authorization|cookie|set-cookie|wlt-api-key|host|content-length|transfer-encoding|connection|upgrade|expect|te|trailer)$/i.test(key)||value.includes(apiKey)))throw Error();
    const contentType=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-type');if(contentType&&contentType[1]!==file.mime)throw Error();if(!contentType)headers={...headers,'Content-Type':file.mime};
   }catch{throw failure('Marble 上传回执无效；未提交生成任务','unknown');}
   // The storage PUT uses only the signed upload headers, never the World API key.
   await transport(url,{method:'PUT',headers,body:file.bytes},signal,false);
   media.content={source:'media_asset',media_asset_id:value.media_asset.media_asset_id};
  }
  const prompt=prepared.body.world_prompt;
  if(prompt.type==='image')prompt.image_prompt=prepared.media[0].content;
  else if(prompt.type==='video')prompt.video_prompt=prepared.media[0].content;
  else if(prompt.type==='multi-image')prompt.multi_image_prompt=prepared.media.map((media,index)=>({content:media.content,...prepared.azimuths?.[index]!=null?{azimuth:prepared.azimuths[index]}:{}}));
  // A lost POST response remains unknown. Polling never replays uploads or generation.
  const value=await read('/worlds:generate','POST',prepared.body,signal);
  if(!validId(value.operation_id)||typeof value.done!=='boolean')throw failure('Marble 未返回有效操作身份；未自动重试','unknown');
  const stored={model:prepared.entry.model,mode:prepared.mode,resolution:prepared.resolution,operationId:value.operation_id},id=envelope(stored.model,stored.mode,stored.resolution,stored.operationId);
  if(value.done)return operation(value,stored,id,signal);
  if(value.error!=null||value.response!=null)throw failure('Marble 提交回执状态矛盾','unknown');
  return {id,status:'queued',progress:0};
 }
 async function poll(id,{signal}={}){const stored=identity(id),value=await read('/operations/'+encodeURIComponent(stored.operationId),'GET',undefined,signal);return operation(value,stored,id,signal);}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFailure('Marble 轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    if(value.progress!==undefined)onProgress(value.progress);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw failure('Marble 未完成世界生成','provider_failed');return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw failure('Marble 任务超时，状态尚未确认，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate};
}
module.exports={createMarbleProvider,parseMarbleModelMap};
