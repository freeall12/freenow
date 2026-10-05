'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {inlineImage}=require('./generation-image-input.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const MODEL='fal-ai/wan-vace-14b/inpainting',PROTOCOL='fal-video-mask-native',SEMANTICS='explicit-native-alternative';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_SOURCE=32*1024*1024,MAX_IMAGE=20*1024*1024,MAX_UPLOAD=90*1024*1024,MAX_MEDIA=100*1024*1024;
const MIN_OUTPUT_PIXELS=720*720,MAX_PIXELS=16777216;
const ACTIONS={'video.erase':'remove','video.replace':'replace'};
const PROMPTS={'video.erase':'Remove the masked object and reconstruct the background, preserving the unmasked scene and motion.','video.replace':'Replace the masked object with the subject in the reference image, preserving the surrounding scene and motion.'};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.hasOwn(v,k);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code,providerDispatched:false});
const unknown=()=>Object.assign(Error('视频遮罩编辑原任务或上传尚未确认，未重新上传或提交生成'),{code:'unknown'});
const check=signal=>{if(signal?.aborted)throw signal.reason??unknown();};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function shape(value,keys){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))throw fail('包含尚未支持的字段，未丢弃参数后提交');}
function parseVideoMaskModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(k=>!own(ACTIONS,k)))throw fail('视频遮罩仅支持显式 video.erase/video.replace 映射','configuration_invalid');
 for(const [kind,e]of Object.entries(map)){shape(e,['kind','model','semantics']);if(Object.keys(e).length!==3||e.kind!==kind||e.model!==MODEL||e.semantics!==SEMANTICS)throw fail('须明确选择 Wan VACE 独立遮罩替代接口','configuration_invalid');}
 return structuredClone(map);
}
function httpsUrl(value){let u;try{u=publicMediaUrl(value);if(u.protocol!=='https:')throw Error();}catch{throw fail('素材须为内联实际字节或独立无凭据公网 HTTPS 地址');}return u.href;}
function inlineBytes(url,mime,max){
 const prefix='data:'+mime+';base64,';
 if(typeof url!=='string'||!url.startsWith(prefix))throw fail('素材内联 MIME 无效');
 const base=url.slice(prefix.length);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base)||base.length%4||base.length>Math.ceil(max/3)*4)throw fail('素材内联编码或字节预算无效');
 const bytes=Buffer.from(base,'base64');if(!bytes.length||bytes.length>max||bytes.toString('base64')!==base)throw fail('素材内联编码或字节预算无效');return bytes;
}
function maskShape(mask){
 shape(mask,['encoding','width','height','fps','frames']);
 if(mask.encoding!=='rle-zero-based-row-major'||![mask.width,mask.height].every(v=>Number.isSafeInteger(v)&&v>0)||mask.width*mask.height>16777216||!Number.isFinite(mask.fps)||mask.fps<5||mask.fps>30||!Array.isArray(mask.frames)||!mask.frames.length||mask.frames.length>2400)throw fail('须提供完整来源时间轴的真实 RLE 遮罩，最多 2400 帧且 fps 为 5–30');
 let size=0,found=false;
 for(const frame of mask.frames){if(typeof frame!=='string'||(size+=Buffer.byteLength(frame))>32*1024*1024)throw fail('遮罩 RLE 编码无效或超限');const values=frame.trim()?frame.trim().split(/\s+/):[];if(values.length%2)throw fail('遮罩 RLE 游程不完整');let end=0;for(let i=0;i<values.length;i+=2){const start=Number(values[i]),length=Number(values[i+1]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<end||length<1||start+length>mask.width*mask.height)throw fail('遮罩游程越界或重叠');end=start+length;found=true;}}
 if(!found)throw fail('遮罩没有目标，未提交生成');
}
function actualMetadata(value,{output=false}={}){
 if(!object(value)||![value.width,value.height,value.numFrames].every(v=>Number.isSafeInteger(v)&&v>0)||value.width*value.height>MAX_PIXELS||output&&value.width*value.height<MIN_OUTPUT_PIXELS||value.numFrames<81||value.numFrames>241||!Number.isFinite(value.fps)||value.fps<5||value.fps>30||!Number.isFinite(value.duration)||value.duration<=0||typeof value.hasAudio!=='boolean'||!Array.isArray(value.pts)||value.pts.length!==value.numFrames||value.pts.some((v,i)=>!Number.isFinite(v)||v<0||i&&v<=value.pts[i-1]))throw fail('实际视频几何、时间或本地输出像素预算无效','invalid_video_mask_media');
 return value;
}
function createVideoMaskProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,directory=path.join(__dirname,'.video-mask-preparation'),download,mediaTools,uploader}={}){
 let mapping={},configurationError=null;
 try{
  mapping=parseVideoMaskModelMap(modelMap);
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey))||typeof fetchImpl!=='function'||!path.isAbsolute(directory)||download!==undefined&&typeof download!=='function')throw Error();
  if(baseUrl){const u=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||u.origin!=='https://queue.fal.run'||u.pathname!=='/'||u.username||u.password||u.search||u.hash||baseUrl.includes('?')||baseUrl.includes('#'))throw Error();}
  assertCredentialFree(mapping,apiKey);
 }catch{mapping={};configurationError='configuration_invalid';}
 const configured=!configurationError&&!!apiKey&&!!Object.keys(mapping).length;
 const fingerprint=hash({protocol:PROTOCOL,mapping,origin:'https://queue.fal.run'});
 const profile={semantics:SEMANTICS,label:'Wan VACE 14B Inpainting',temporalMask:true,maskEncoding:'rle-zero-based-row-major',preservesSourceAudio:'local-remux',resolution:'720p',aspectRatio:'adaptive',maxCount:1,sourceFrames:{min:81,max:241},sourceFps:{min:5,max:30},maxFullMaskFrames:2400,maxSourceBytes:MAX_SOURCE,maxReferenceBytes:MAX_IMAGE,maxUploadBytes:MAX_UPLOAD,maxOutputBytes:MAX_MEDIA,minOutputPixels:MIN_OUTPUT_PIXELS,maxPixels:MAX_PIXELS,requiresExistingMask:true,promptTemplates:structuredClone(PROMPTS)};
 const metadata={configured,protocol:PROTOCOL,missing:[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configurationError,capabilities:{kinds:Object.keys(mapping),models:Object.fromEntries(Object.keys(mapping).map(k=>[k,{kind:k,label:profile.label}])),videoMask:profile,videoReferences:{maxVideos:1,mimeTypes:['video/mp4'],transport:'inline-or-public-https'},imageReferences:Object.fromEntries(Object.keys(mapping).filter(k=>k==='video.replace').map(k=>[k,{maxImages:1,mimeTypes:['image/png'],transport:'inline-or-public-https'}])),remoteRecovery:true,remoteCancellation:'best-effort',preparationRecovery:'read-only',verified:'official-schema-and-local-contract'}};
 const downloader=download||createGenerationMediaDownloader({limits:{video:MAX_MEDIA,image:MAX_IMAGE}}).download;
 let tools=mediaTools,uploadClient=uploader;
 // Pure configuration and prepare do not create private directories or invoke
 // codecs. These dependencies are initialized only after an authorized submit.
 const media=()=>tools??=(require('./generation-video-mask-media.cjs').createVideoMaskMediaTools({maxInputBytes:MAX_SOURCE,maxOutputBytes:MAX_MEDIA}));
 const upload=()=>uploadClient??=(require('./generation-fal-upload.cjs').createFalUpload({apiKey,maxBytes:MAX_UPLOAD}));
 async function guardedFetch(url,options){
  const response=await fetchImpl(url,options);if(!response.body?.pipeThrough)return response;
  let size=0;const parts=[];const stream=response.body.pipeThrough(new TransformStream({transform(chunk){if(!(chunk instanceof Uint8Array)||(size+=chunk.length)>1024*1024)throw unknown();parts.push(Buffer.from(chunk));},flush(controller){const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assertCredentialFree(parsed,apiKey);controller.enqueue(bytes);}}));return new Response(stream,{status:response.status,headers:response.headers});
 }
 const queue=createFalQueue({baseUrl:'https://queue.fal.run',apiKey,fetchImpl:guardedFetch});
 function resolve(request){
  if(!configured)throw fail('Wan VACE 视频遮罩替代尚未配置','configuration_required');
  rejectCredentials(request);assertCredentialFree(request,apiKey);
  shape(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references']);
  if(!own(mapping,request.kind)||Buffer.byteLength(canonical(request))>64*1024*1024)throw fail('操作未显式映射或请求超过 64 MiB');
  const p=request.parameters;shape(p,['action','sourceClip','mask','aspectRatio','resolution','candidateCount','model','modelId','providerParameters']);
  if(p.providerParameters!==undefined){shape(p.providerParameters,['model']);}
  for(const alias of [p.model,p.modelId,p.providerParameters?.model])if(alias!==undefined&&alias!==request.kind)throw fail('遮罩模型身份不一致，不会替换型号');
  if(p.action!==ACTIONS[request.kind]||p.aspectRatio!=='adaptive'||p.resolution!=='720p'||p.candidateCount!==1||request.count!==undefined&&request.count!==1||request.prompt!==''||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('须显式使用对应动作、adaptive/720p、单结果及空提示词');
  maskShape(p.mask);
  const duration=p.mask.frames.length/p.mask.fps,clip=p.sourceClip;
  if(clip!=null){shape(clip,['start','end']);if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>duration+.001)throw fail('来源选段无效或超出完整遮罩时间轴');}
  const start=clip?.start??0,end=clip?.end??duration,n=(end-start)*p.mask.fps;
  if(Math.abs(start*p.mask.fps-Math.round(start*p.mask.fps))>1e-6||Math.abs(end*p.mask.fps-Math.round(end*p.mask.fps))>1e-6||Math.abs(n-Math.round(n))>1e-6||Math.round(n)<81||Math.round(n)>241)throw fail('选段须为帧边界且包含 81–241 帧，不会重采样或补帧');
  if(!p.mask.frames.slice(Math.round(start*p.mask.fps),Math.round(end*p.mask.fps)).some(v=>v.trim()))throw fail('选段内遮罩没有目标，未提交生成');
  const expected=request.kind==='video.replace'?2:1;
  if(!Array.isArray(request.inputs)||request.inputs.length!==expected)throw fail('擦除只要来源视频；替换必须另有一张实际图片');
  const [source,reference]=request.inputs;
  for(const [index,input]of request.inputs.entries()){shape(input,['type','url','id','nodeId','title','name','role','width','height',...index===0?['duration','durationMs','fps']:[],'mime','mimeType','sizeBytes']);if(typeof input.url!=='string')throw fail('素材必须已物化为字节或独立 URL');}
  if(source.type!=='video'||source.role!=='source_video'||reference&&(reference.type!=='image'||reference.role!=='replacement_image'))throw fail('来源视频或替换图片角色无效');
  for(const [key,actual]of [['width',p.mask.width],['height',p.mask.height],['fps',p.mask.fps]])if(source[key]!==undefined&&source[key]!==actual)throw fail('来源声明与全时序遮罩不一致');
  for(const value of [source.duration,source.durationMs===undefined?undefined:source.durationMs/1000])if(value!==undefined&&(!Number.isFinite(value)||Math.abs(value-duration)>.001))throw fail('来源声明时长与全时序遮罩不一致');
  for(const [input,mime,max]of [[source,'video/mp4',MAX_SOURCE],...(reference?[[reference,'image/png',MAX_IMAGE]]:[])]){
   if([input.mime,input.mimeType].some(v=>v!==undefined&&v!==mime)||input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>max))throw fail('素材 MIME 或字节预算不受支持');
   if(input.url.startsWith('data:')){const bytes=inlineBytes(input.url,mime,max);assertCredentialFreeBytes(bytes,apiKey);if(input.sizeBytes!==undefined&&input.sizeBytes!==bytes.length)throw fail('素材声明大小与实际字节不符');}else httpsUrl(input.url);
  }
  return {source,reference,mask:p.mask,sourceClip:clip??null,kind:request.kind};
 }
 const prepare=request=>{resolve(request);return request;};
 const folder=id=>{if(!UUID.test(id))throw unknown();return path.join(directory,id);};
 async function privateDirectory(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077)throw unknown();}
 async function writeFile(dir,name,bytes){const handle=await fs.open(path.join(dir,name),'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
 async function writeManifest(manifest){assertCredentialFree(manifest,apiKey);const dir=folder(manifest.preparationId),temporary='.'+randomUUID()+'.tmp';await writeFile(dir,temporary,JSON.stringify(manifest));await fs.rename(path.join(dir,temporary),path.join(dir,'manifest.json'));const handle=await fs.open(dir,'r');try{await handle.sync();}finally{await handle.close();}}
 async function readFile(dir,name,max){const handle=await fs.open(path.join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size<1||stat.size>max)throw unknown();const bytes=await handle.readFile();if(bytes.length!==stat.size)throw unknown();assertCredentialFreeBytes(bytes,apiKey);return bytes;}finally{await handle.close();}}
 async function readManifest(id){const dir=folder(id),stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077)throw unknown();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(dir,'manifest.json',2*1024*1024)));if(!object(value)||value.version!==1||value.preparationId!==id||value.protocol!==PROTOCOL||value.model!==MODEL||!own(mapping,value.kind)||!/^[a-f0-9]{64}$/.test(value.requestHash))throw unknown();assertCredentialFree(value,apiKey);return value;}
 async function bytesFor(input,kind,max,signal){
  check(signal);let resource;
  if(input.url.startsWith('data:'))return inlineBytes(input.url,kind==='video'?'video/mp4':'image/png',max);
  try{resource=await downloader(httpsUrl(input.url),{kind,signal});if(resource.mime!==(kind==='video'?'video/mp4':'image/png'))throw fail('实际媒体 MIME 不符');const parts=[];let size=0;for await(const chunk of resource.stream){check(signal);if(!(chunk instanceof Uint8Array)||(size+=chunk.length)>max)throw fail('素材实际字节超限');parts.push(Buffer.from(chunk));}if(!size||resource.expectedBytes!==undefined&&size!==resource.expectedBytes||input.sizeBytes!==undefined&&size!==input.sizeBytes)throw fail('素材实际字节不完整');const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);return bytes;}finally{resource?.close?.();}
 }
 const envelope=(manifest,id)=>'wm1.'+Buffer.from(JSON.stringify([MODEL,manifest.kind,manifest.preparationId,id])).toString('base64url');
 function identity(id){let value;try{if(typeof id!=='string'||id.length>2048||!/^wm1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==4||value[0]!==MODEL||!own(mapping,value[1])||!UUID.test(value[2])||!validId(value[3])||envelope({kind:value[1],preparationId:value[2]},value[3])!==id)throw Error();}catch{throw fail('遮罩原任务身份无效','provider_identity_mismatch');}if(!configured)throw fail('原视频遮罩供应商尚未配置','configuration_required');return value;}
 async function checkpoint(manifest,stage,status,callback){manifest.stage=stage;manifest.status=status;await writeManifest(manifest);await callback({version:1,protocol:PROTOCOL,preparationId:manifest.preparationId,kind:manifest.kind,stage,status,requestHash:manifest.requestHash});}
 async function submit(request,{signal,onPreparationState=async()=>{},onTaskIdentity=async()=>{},localTaskId}={}){
  const resolved=resolve(request),id=randomUUID(),manifest={version:1,protocol:PROTOCOL,model:MODEL,preparationId:id,kind:resolved.kind,requestHash:hash(request),files:{},...(localTaskId!==undefined?{localTaskId}:{})};
  if(localTaskId!==undefined&&!UUID.test(localTaskId)||typeof onPreparationState!=='function'||typeof onTaskIdentity!=='function')throw fail('私有准备回调或任务身份无效');
  let remoteStarted=false;
  try{
   check(signal);await privateDirectory(directory);await privateDirectory(folder(id));await checkpoint(manifest,'media-preparing','preparing',onPreparationState);
   const sourceBytes=await bytesFor(resolved.source,'video',MAX_SOURCE,signal),prepared=await media().prepareMedia({source:{bytes:sourceBytes,mime:'video/mp4'},mask:resolved.mask,sourceClip:resolved.sourceClip},{signal});check(signal);
   assertCredentialFree(prepared.metadata,apiKey);assertCredentialFree(prepared.sourceRange,apiKey);actualMetadata(prepared.metadata);if(prepared.metadata.hasAudio!==!!prepared.audio)throw fail('原音轨准备信息缺失，未上传或静默丢声','invalid_video_mask_media');
   manifest.metadata=prepared.metadata;manifest.sourceRange=prepared.sourceRange;
   for(const [name,file]of [['video',prepared.video],['mask',prepared.mask],...(prepared.audio?[['audio',prepared.audio]]:[])]){if(!file||!Buffer.isBuffer(file.bytes)||file.bytes.length<1||file.bytes.length>MAX_MEDIA)throw fail('实际准备媒体无效或超限');assertCredentialFreeBytes(file.bytes,apiKey);assertCredentialFree(file.metadata,apiKey);await writeFile(folder(id),name+'.bin',file.bytes);manifest.files[name]={mime:file.mime,bytes:file.bytes.length,sha256:hash(file.bytes),metadata:file.metadata};}
   if(resolved.reference){const bytes=await bytesFor(resolved.reference,'image',MAX_IMAGE,signal),actual=decodePNG(bytes);assertCredentialFreeBytes(actual.pixels,apiKey);let offset=8;while(offset+12<=bytes.length){const type=bytes.toString('ascii',offset+4,offset+8);if(['zTXt','iTXt','iCCP'].includes(type))throw fail('替换 PNG 压缩 metadata 暂不支持');offset+=12+bytes.readUInt32BE(offset);}for(const k of ['width','height'])if(resolved.reference[k]!==undefined&&resolved.reference[k]!==actual[k])throw fail('替换图片实际尺寸与声明不符');await writeFile(folder(id),'reference.bin',bytes);manifest.files.reference={mime:'image/png',bytes:bytes.length,sha256:hash(bytes),metadata:{width:actual.width,height:actual.height}};}
   // Validate every file before publishing any one of them. A large mask must
   // not be discovered only after the source has already reached the CDN.
   for(const name of ['video','mask',...(resolved.reference?['reference']:[])]){const file=manifest.files[name];if(file.bytes>MAX_UPLOAD||file.mime!==(name==='reference'?'image/png':'video/mp4'))throw fail('待上传素材超过单次 90 MiB 或实际 MIME 无效');}
   await checkpoint(manifest,'media-ready','ready',onPreparationState);
   for(const name of ['video','mask',...(resolved.reference?['reference']:[])]){
    const file=manifest.files[name],bytes=await readFile(folder(id),name+'.bin',MAX_MEDIA);if(hash(bytes)!==file.sha256)throw unknown();
    const value=await upload().upload({bytes,mime:file.mime,fileName:name+(name==='reference'?'.png':'.mp4')},{signal,onStage:async event=>{remoteStarted=true;assertCredentialFree(event,apiKey);file.upload=structuredClone(event);const stages={initiating:['upload-initiating','dispatching'],initiated:['upload-initiated','confirmed'],uploading:['uploading','dispatching'],uploaded:['uploaded','confirmed']};const [stage,status]=stages[event.stage]??['unknown','unknown'];await checkpoint(manifest,stage,status,onPreparationState);}});
    if(value?.status!=='uploaded'||value.mime!==file.mime||value.bytes!==file.bytes||value.sha256!==file.sha256)throw unknown();const fileUrl=httpsUrl(value.fileUrl);assertCredentialFree(fileUrl,apiKey);file.upload={status:'uploaded',identity:{fileUrl,mime:file.mime,bytes:file.bytes,sha256:file.sha256}};await checkpoint(manifest,'uploaded','confirmed',onPreparationState);
   }
   const urls=Object.fromEntries(Object.entries(manifest.files).filter(([,file])=>file.upload?.status==='uploaded').map(([name,file])=>[name,file.upload.identity.fileUrl]));
   const body={prompt:PROMPTS[resolved.kind],video_url:urls.video,mask_video_url:urls.mask,...resolved.reference?{ref_image_urls:[urls.reference]}:{},resolution:'720p',aspect_ratio:'auto',match_input_num_frames:true,match_input_frames_per_second:true,enable_prompt_expansion:false,enable_auto_downsample:false,temporal_downsample_factor:0,num_interpolated_frames:0,preprocess:false,enable_safety_checker:true,sync_mode:false};
   check(signal);await checkpoint(manifest,'generation-dispatching','dispatching',onPreparationState);remoteStarted=true;
   const accepted=await queue.submit(MODEL,body,{signal});if(!validId(accepted.requestId))throw unknown();manifest.requestId=accepted.requestId;await checkpoint(manifest,'generation-accepted','confirmed',onPreparationState);const task=envelope(manifest,accepted.requestId);await onTaskIdentity(task);return {id:task,status:accepted.status};
  }catch(error){if(signal?.aborted)throw signal.reason;if(['storage_error','invalid_preparation_state','provider_identity_mismatch'].includes(error?.code))throw error;if(remoteStarted)throw unknown();throw fail('视频遮罩素材准备或私有保存失败，未上传或提交生成',error?.code==='invalid_video_mask_media'?'invalid_video_mask_media':'unsupported_generation');}
 }
 async function preparedFor(manifest){actualMetadata(manifest.metadata);const range=manifest.sourceRange;if(!object(range)||Object.keys(range).sort().join(',')!=='end,start'||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||Math.abs(range.end-range.start-manifest.metadata.duration)>1e-5)throw unknown();const prepared={metadata:manifest.metadata,sourceRange:range,audio:null};if(manifest.files.audio){const f=manifest.files.audio,bytes=await readFile(folder(manifest.preparationId),'audio.bin',MAX_MEDIA);if(hash(bytes)!==f.sha256)throw unknown();prepared.audio={bytes,mime:f.mime,metadata:f.metadata};}if(prepared.metadata.hasAudio!==!!prepared.audio)throw unknown();return prepared;}
 function bind(manifest,{request,preparationState,localTaskId}={}){if(localTaskId!==undefined&&(!UUID.test(localTaskId)||manifest.localTaskId!==localTaskId)||request&&hash(request)!==manifest.requestHash||preparationState&&(preparationState.preparationId!==manifest.preparationId||preparationState.requestHash!==manifest.requestHash||preparationState.kind!==manifest.kind))throw fail('准备记录与原任务或请求不一致','provider_identity_mismatch');}
 async function resumePreparation(state,options={}){
  if(!configured)throw fail('原视频遮罩供应商尚未配置','configuration_required');
  shape(state,['version','protocol','preparationId','kind','stage','status','requestHash']);if(state.version!==1||state.protocol!==PROTOCOL||!UUID.test(state.preparationId))throw unknown();const manifest=await readManifest(state.preparationId);bind(manifest,{...options,preparationState:state});check(options.signal);return manifest.requestId?{id:envelope(manifest,manifest.requestId),status:'queued'}:{status:'unknown',code:'media_preparation_unconfirmed'};
 }
 const busy=new Map();
 async function poll(id,{signal,request,preparationState,localTaskId}={}){
  const values=identity(id),manifest=await readManifest(values[2]);bind(manifest,{request,preparationState,localTaskId});if(manifest.kind!==values[1]||manifest.requestId!==values[3])throw fail('原生成任务与准备记录不一致','provider_identity_mismatch');
  if(busy.has(id))return busy.get(id);
  const operation=(async()=>{
   check(signal);
   const output=async({recheck=false}={})=>{const file=manifest.result,bytes=await readFile(folder(manifest.preparationId),'result.bin',MAX_MEDIA);if(hash(bytes)!==file.sha256||file.mime!=='video/mp4'||file.bytes!==bytes.length)throw unknown();actualMetadata(file.metadata,{output:true});if(recheck){const prepared=await preparedFor(manifest),actual=await media().validateResult({bytes,mime:'video/mp4'},prepared,{signal});actualMetadata(actual.metadata,{output:true});for(const key of ['width','height','fps','numFrames','duration','hasAudio'])if(actual.metadata[key]!==file.metadata[key])throw unknown();if(actual.metadata.hasAudio!==prepared.metadata.hasAudio)throw unknown();}return {id,status:'succeeded',progress:100,outputs:[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),mime:'video/mp4',width:file.metadata.width,height:file.metadata.height,duration:file.metadata.duration,sourceFileId:manifest.requestId,sourceRange:manifest.sourceRange}]};};
   if(manifest.result)return output({recheck:true});
   const receipt=await queue.poll(MODEL,manifest.requestId,{signal});if(receipt.requestId!==manifest.requestId)throw fail('供应商回执任务不一致','provider_identity_mismatch');if(receipt.status!=='succeeded')return {id,status:receipt.status};
   try{
    const video=receipt.result?.video;if(!object(video)||typeof video.url!=='string'||receipt.result.videos!==undefined||receipt.result.frames_zip!=null)throw unknown();assertCredentialFree(receipt.result,apiKey);const url=httpsUrl(video.url);assertCredentialFree(url,apiKey);if(video.content_type!=null&&video.content_type!=='video/mp4')throw unknown();
    const bytes=await bytesFor({url,sizeBytes:video.file_size??undefined},'video',MAX_MEDIA,signal),prepared=await preparedFor(manifest),actual=await media().validateResult({bytes,mime:'video/mp4'},prepared,{signal});actualMetadata(actual.metadata,{output:true});
    for(const [supplier,key]of [['width','width'],['height','height'],['fps','fps'],['num_frames','numFrames'],['duration','duration']])if(video[supplier]!=null&&(!Number.isFinite(video[supplier])||Math.abs(video[supplier]-actual.metadata[key])>(supplier==='fps'||supplier==='duration'?1e-5:0)))throw unknown();
    const preserved=await media().preserveAudio(actual,prepared,{signal});check(signal);if(!Buffer.isBuffer(preserved.bytes)||!preserved.bytes.length||preserved.bytes.length>MAX_MEDIA||preserved.mime!=='video/mp4')throw unknown();assertCredentialFreeBytes(preserved.bytes,apiKey);assertCredentialFree(preserved.metadata,apiKey);actualMetadata(preserved.metadata,{output:true});if(preserved.metadata.hasAudio!==prepared.metadata.hasAudio)throw unknown();
    const resultTemporary='.'+randomUUID()+'.result.tmp';await writeFile(folder(manifest.preparationId),resultTemporary,preserved.bytes);await fs.rename(path.join(folder(manifest.preparationId),resultTemporary),path.join(folder(manifest.preparationId),'result.bin'));manifest.result={mime:'video/mp4',bytes:preserved.bytes.length,sha256:hash(preserved.bytes),metadata:preserved.metadata};await writeManifest(manifest);return output();
   }catch(error){if(signal?.aborted)throw signal.reason;throw unknown();}
  })();busy.set(id,operation);try{return await operation;}finally{busy.delete(id);}
 }
 async function cancel(id,{signal}={}){const values=identity(id),manifest=await readManifest(values[2]);if(manifest.kind!==values[1]||manifest.requestId!==values[3])throw fail('取消任务身份无效','provider_identity_mismatch');await queue.cancel(MODEL,values[3],{signal});return {id,status:'unknown'};}
 async function generate(request,{signal,onPreparationState=async()=>{},onTaskIdentity=async()=>{},onProgress=()=>{},localTaskId,pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw fail('视频遮罩轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{let value=await submit(request,{signal:combined,onPreparationState,onTaskIdentity,localTaskId});while(['queued','running'].includes(value.status)){onProgress(0);await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});value=await poll(value.id,{signal:combined,request,localTaskId});}if(value.status!=='succeeded')throw unknown();return value;}catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,cancel,resumePreparation,generate};
}
module.exports={createVideoMaskProvider,parseVideoMaskModelMap};
