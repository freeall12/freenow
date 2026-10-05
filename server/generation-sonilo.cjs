'use strict';
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {waveMetadata}=require('./generation-openai-speech.cjs');
const {command,envelope}=require('./generation-video-mask-media.cjs').mediaInternals;
const ORIGIN='https://api.sonilo.com',PROTOCOL='sonilo-native',MODEL='sonilo-music';
const MAX_VIDEO_BYTES=50000000,MAX_AUDIO_BYTES=50*1024*1024,MAX_BATCH_AUDIO_BYTES=128*1024*1024,MAX_JSON_BYTES=1024*1024;
const LABELS=Object.freeze(['intro','verse','pre-chorus','chorus','bridge','break','silence','outro','none']);
const DEFAULT_SONILO_MODEL_MAP=Object.freeze({[MODEL]:Object.freeze({kind:'audio.generate',model:MODEL})});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const unknown=()=>fail('Sonilo 原任务状态未确认，请查询原任务；未自动重试或重新提交','unknown');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
function parseSoniloModelMap(value){
 const mapping=value===undefined?DEFAULT_SONILO_MODEL_MAP:typeof value==='string'?JSON.parse(value):value;
 if(!object(mapping)||Object.keys(mapping).length>1)throw fail('Sonilo 音乐模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(mapping))if(alias!==MODEL||!object(entry)||Object.keys(entry).some(key=>!['kind','model'].includes(key))||entry.kind!=='audio.generate'||entry.model!==MODEL)throw fail('Sonilo 原生音乐仅支持 sonilo-music；未替换公开型号','configuration_invalid');
 return structuredClone(mapping);
}
function validateSoniloSegments(value,duration){
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length<1||value.length>30)throw localFail('Sonilo 音乐分段须为 1–30 个明确的时间边界');
 for(let i=0;i<value.length;i++){
  const segment=value[i];
  if(!object(segment)||Object.keys(segment).some(key=>!['start','prompt','label'].includes(key))||!Number.isFinite(segment.start)||segment.start<0||i===0&&segment.start!==0||i>0&&segment.start-value[i-1].start<5||segment.start>duration-5||typeof segment.prompt!=='string'||!segment.prompt.trim()||Array.from(segment.prompt).length>200||segment.label!==undefined&&!LABELS.includes(segment.label))throw localFail('Sonilo 音乐分段须从 0 秒开始、至少相隔 5 秒且保留最后 5 秒；提示词 1–200 字符，标签须为官方枚举');
 }
 return structuredClone(value);
}
function httpsMedia(value){try{const url=publicMediaUrl(value);if(url.protocol!=='https:'||url.hash||value.includes('#'))throw Error();return url.href;}catch{throw localFail('Sonilo 来源须为本地内联 MP4 或无凭据的公网 HTTPS 视频');}}
function inlineVideo(value,apiKey){
 const match=typeof value==='string'&&/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[1].length%4||match[1].length>Math.ceil(MAX_VIDEO_BYTES/3)*4)throw localFail('Sonilo 参考视频须为不超过 50 MB 的完整内联 MP4');
 const bytes=Buffer.from(match[1],'base64');
 if(!bytes.length||bytes.length>MAX_VIDEO_BYTES||bytes.toString('base64')!==match[1])throw localFail('Sonilo 参考视频字节或编码无效');
 assertCredentialFreeBytes(bytes,apiKey);
 try{envelope({bytes,mime:'video/mp4'},MAX_VIDEO_BYTES,false,true);}catch{throw localFail('Sonilo 参考视频缺少完整 MP4 容器和实际媒体数据');}
 return bytes;
}
let activeVideoChecks=0;
// Decode private local bytes before the first billable POST. FFmpeg never sees
// input URLs; this does not rewrite, trim, resample or upload a substitute clip.
async function actualVideo(bytes,{duration,signal,ffmpegPath,ffprobePath}){
 if(activeVideoChecks>=2)throw localFail('Sonilo 本地视频校验繁忙，请稍后重试');
 activeVideoChecks++;let directory;
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-sonilo-'));await fs.chmod(directory,0o700);
  const file=path.join(directory,'source.mp4');await fs.writeFile(file,bytes,{mode:0o600,signal});
  const base=['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov'];
  const raw=await command(ffprobePath,[...base,'-show_entries','stream=codec_type,width,height,duration,nb_frames:format=duration','-of','json',file],{signal,maxStdout:65536});
  const summary=JSON.parse(raw.toString('utf8')),videos=summary.streams?.filter(stream=>stream.codec_type==='video'),audio=summary.streams?.filter(stream=>stream.codec_type==='audio');
  const video=videos?.[0],measured=Number(video?.duration??summary.format?.duration);
  if(videos?.length!==1||!Array.isArray(audio)||audio.length>1||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<1||video.height<1||video.width*video.height>16777216||!Number.isFinite(measured)||measured<5||measured>360||Math.abs(measured-duration)>.01||video.nb_frames!==undefined&&video.nb_frames!=='N/A'&&(!Number.isSafeInteger(Number(video.nb_frames))||Number(video.nb_frames)<1||Number(video.nb_frames)>21600))throw localFail('Sonilo 视频须有一条真实视频轨，实际时长不超过 360 秒且与声明一致');
  await command(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-format_whitelist','mov','-i',file,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-f','null','-'],{signal,maxStdout:1024});
  return {duration:measured,sha256:hash(bytes)};
 }catch(error){if(signal?.aborted)throw signal.reason;throw Object.assign(localFail(error?.code==='media_tool_unavailable'?'Sonilo 本地视频上传需要可运行的 FFmpeg/FFprobe':'Sonilo 视频实际解码或时长校验失败；未上传、提交或改写视频'),error?.code==='media_tool_unavailable'?{code:error.code}:{});}
 finally{activeVideoChecks--;if(directory)await fs.rm(directory,{recursive:true,force:true});}
}
function createSoniloProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,download=createGenerationMediaDownloader().download,timeoutMs=30000,mediaTimeoutMs=120000,ffmpegPath='ffmpeg',ffprobePath='ffprobe'}={}){
 let mapping={},configurationError=null;
 try{
  mapping=parseSoniloModelMap(modelMap);
  if(typeof baseUrl!=='string'||baseUrl&&!['https://api.sonilo.com','https://api.sonilo.com/'].includes(baseUrl)||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey))||typeof fetchImpl!=='function'||typeof download!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(mediaTimeoutMs)||mediaTimeoutMs<1||mediaTimeoutMs>120000||typeof ffmpegPath!=='string'||!ffmpegPath||typeof ffprobePath!=='string'||!ffprobePath)throw Error();
  assertCredentialFree(mapping,apiKey);
 }catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=hash(JSON.stringify({protocol:PROTOCOL,origin:ORIGIN,mapping}));
 const profile={scene:'Music',label:'Sonilo Music',model:MODEL,semantics:'native',duration:{min:5,max:360,automatic:false},durationMode:'source-video-or-explicit',providerMaxVideoDuration:360,localVideoDuration:{min:5,max:360},maxVideos:1,maxCount:10,count:{min:1,max:10,billing:'per-variant'},maxCharacters:1000,maxPromptCharacters:1000,maxVideoBytes:MAX_VIDEO_BYTES,maxAudioBytes:MAX_AUDIO_BYTES,maxBatchAudioBytes:MAX_BATCH_AUDIO_BYTES,segments:true,segmentContract:{maxSegments:30,minSeconds:5,maxPromptCharacters:200,labels:[...LABELS],fields:['start','prompt','label']},textOnly:true,formats:['wav'],outputFormat:'wav',requiresMediaTools:['ffmpeg','ffprobe']};
 const models=Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'audio.generate',label:profile.label,model:MODEL,semantics:'native'}]));
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models,music:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,structuredClone(profile)])),videoAudio:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,structuredClone(profile)])),references:true,textReferences:false,videoReferences:{maxVideos:1,mimeTypes:['video/mp4'],transport:'multipart-file'},remoteRecovery:true,remoteCancellation:false,providerIdempotency:false,verified:'official-schema-and-local-contract'}};
 const transport=protectGenerationFetch(fetchImpl);
 function resolve(request){
  if(!configured)throw fail('Sonilo 原生音乐尚未配置，请检查独立供应商 Key 与模型映射','configuration_required');
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>Math.ceil(MAX_VIDEO_BYTES/3)*4+MAX_JSON_BYTES)throw localFail('Sonilo 仅支持预算内音乐生成请求');
  assertCredentialFree(request,apiKey);rejectCredentials(request);
  const p=request.parameters??{};if(!object(p))throw localFail('Sonilo 音乐参数须为对象');const wire=p.providerParameters??{};
  if(!object(wire)||Object.keys(p).some(key=>!['model','modelId','virtualModel','scene','duration','segments','count','times','format','response_format','providerParameters'].includes(key))||Object.keys(wire).some(key=>!['model','prompt_influence'].includes(key)))throw localFail('Sonilo 请求含未支持的格式、混音、分轨或其他设置；不会忽略后提交');
  const alias=p.modelId??p.model;
  if(alias!==MODEL||!Object.hasOwn(mapping,alias))throw fail('此型号未配置 Sonilo 原生音乐','configuration_required');
  if([p.model,p.modelId,wire.model].some(value=>value!==undefined&&value!==alias)||p.virtualModel!==undefined&&p.virtualModel!==MODEL||p.scene!=='Music')throw localFail('Sonilo 原生音乐型号或场景不一致');
  const counts=[request.count,p.count,p.times].filter(value=>value!==undefined),count=counts[0]??1;
  if(counts.some(value=>!Number.isSafeInteger(value)||value<1||value>10||value!==count))throw localFail('Sonilo 生成数量须为一致的 1–10 整数；不同计数字段不可冲突');
  if([p.format,p.response_format].some(value=>value!==undefined&&value!=='wav'))throw localFail('Sonilo 本批固定返回 WAV，不会忽略格式或另行转码');
  if(wire.prompt_influence!==undefined&&(!Number.isFinite(wire.prompt_influence)||wire.prompt_influence<0||wire.prompt_influence>1))throw localFail('Sonilo prompt_influence 须在 0–1 之间');
  if([request.sourceClip,request.clip,request.trim,request.segments].some(value=>value!==undefined)||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw localFail('Sonilo 不接受未展开引用或选段；须先导出选段实际视频');
  const inputs=request.inputs??[];
  if(!Array.isArray(inputs)||inputs.length>1||inputs.some(input=>!object(input)||input.type!=='video'))throw localFail('Sonilo 原生音乐仅接受一个视频参考或无参考文字生成');
  if(!inputs.length&&wire.prompt_influence!==undefined)throw localFail('Sonilo prompt_influence 仅适用于视频音乐');
  if(typeof request.prompt!=='string'||Array.from(request.prompt).length>1000||!inputs.length&&!request.prompt.trim())throw localFail('Sonilo 音乐描述最多 1000 字符；无视频时描述须非空');
  const duration=p.duration;
  if(!Number.isFinite(duration)||duration<5||duration>360||!inputs.length&&(!Number.isInteger(duration)||duration<5))throw localFail('Sonilo 文字音乐时长须为 5–360 整数秒；视频音乐须声明实际来源时长');
  let source;
  if(inputs.length){
   const input=inputs[0];
   if(Object.keys(input).some(key=>!['id','type','url','title','duration','mime','mimeType','role','sizeBytes'].includes(key))||input.role!==undefined&&!['source_video','reference_video'].includes(input.role)||[input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4')||!Number.isFinite(input.duration)||Math.abs(input.duration-duration)>0.000001||input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>MAX_VIDEO_BYTES))throw localFail('Sonilo 视频声明、时长或属性无效；不会处理整片替代选段');
   source=typeof input.url==='string'&&input.url.startsWith('data:')?{bytes:inlineVideo(input.url,apiKey),duration,sizeBytes:input.sizeBytes}:{url:httpsMedia(input.url),duration,sizeBytes:input.sizeBytes};
   if(source.bytes&&source.sizeBytes!==undefined&&source.sizeBytes!==source.bytes.length)throw localFail('Sonilo 视频声明字节数不一致');
  }
  return {alias,type:source?'video_to_music':'text_to_music',path:source?'/v1/video-to-music':'/v1/text-to-music',source,duration,count,prompt:request.prompt,segments:validateSoniloSegments(p.segments,duration),promptInfluence:wire.prompt_influence};
 }
 async function bounded(operation,budget,signal){
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const timer=setTimeout(()=>controller.abort(unknown()),budget);let abort;
  const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  const wait=async(work,dispose)=>{check();return Promise.race([Promise.resolve().then(()=>{check();return work();}).then(value=>{if(combined.aborted){void Promise.resolve(dispose?.(value)).catch(()=>{});check();}return value;}),stopped]);};
  try{return await operation({signal:combined,wait,check});}finally{clearTimeout(timer);combined.removeEventListener('abort',abort);controller.abort();}
 }
 async function json(apiPath,method,body,signal){
  return bounded(async context=>{
   let response,reader,complete=false;
   try{
    response=await context.wait(()=>transport(ORIGIN+apiPath,{method,headers:{Authorization:'Bearer '+apiKey,Accept:'application/json','Accept-Encoding':'identity'},...body?{body}:{},signal:context.signal}),late=>late.body?.cancel());
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),encoding=response.headers.get('content-encoding'),length=response.headers.get('content-length');
    if(response.redirected||mime!=='application/json'||encoding&&encoding!=='identity'||!response.body?.getReader||length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)<1||Number(length)>MAX_JSON_BYTES))throw unknown();
    reader=response.body.getReader();const chunks=[];let size=0;
    for(;;){const next=await context.wait(()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_JSON_BYTES)throw unknown();chunks.push(Buffer.from(next.value));}
    context.check();if(!size||length!==null&&Number(length)!==size)throw unknown();const bytes=Buffer.concat(chunks);assertCredentialFreeBytes(bytes,apiKey);
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!object(value))throw unknown();assertCredentialFree(value,apiKey);rejectCredentials(value);complete=true;
    return {status:response.status,value};
   }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
   finally{if(!complete){if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
  },timeoutMs,signal);
 }
 async function media(url,kind,expectedSize,expectedDuration,signal){
  return bounded(async context=>{
   let resource,iterator,complete=false;
   try{
    resource=await context.wait(()=>download(url,{kind,signal:context.signal}),late=>late.close());
    const limit=kind==='video'?MAX_VIDEO_BYTES:MAX_AUDIO_BYTES,mime=kind==='video'?'video/mp4':'audio/wav';
    if(!resource||resource.mime!==mime||!resource.stream?.[Symbol.asyncIterator]||resource.expectedBytes!==undefined&&(!Number.isSafeInteger(resource.expectedBytes)||resource.expectedBytes<1||resource.expectedBytes>limit))throw unknown();
    iterator=resource.stream[Symbol.asyncIterator]();const chunks=[];let size=0;
    for(;;){const next=await context.wait(()=>iterator.next());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>limit)throw unknown();chunks.push(Buffer.from(next.value));}
    context.check();if(!size||resource.expectedBytes!==undefined&&resource.expectedBytes!==size||expectedSize!==undefined&&expectedSize!==size)throw unknown();const bytes=Buffer.concat(chunks);assertCredentialFreeBytes(bytes,apiKey);
    let duration,audioInfo;
    if(kind==='video')inlineVideo('data:video/mp4;base64,'+bytes.toString('base64'),apiKey);
    else {const metadata=waveMetadata(bytes);if(Math.abs(metadata.duration-expectedDuration)>.1)throw unknown();duration=metadata.duration;let at=12;
     while(bytes.toString('ascii',at,at+4)!=='fmt '){const size=bytes.readUInt32LE(at+4);at+=8+size+(size%2);}
     audioInfo={sampleRate:metadata.sampleRate,channels:bytes.readUInt16LE(at+10)};
    }
    context.check();complete=true;return {bytes,...duration!==undefined?{duration,...audioInfo}:{}};
   }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
   finally{if(!complete)void Promise.resolve(iterator?.return?.()).catch(()=>{});resource?.close();}
  },mediaTimeoutMs,signal);
 }
 const envelopeId=values=>'sn1.'+Buffer.from(JSON.stringify(values)).toString('base64url');
 function identity(id){
  let values;
  try{if(typeof id!=='string'||id.length>1024||!/^sn1\.[A-Za-z0-9_-]+$/.test(id))throw Error();values=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(values)||values.length!==7||values[0]!==fingerprint||values[1]!==MODEL||!['video_to_music','text_to_music'].includes(values[2])||!validId(values[3])||!Number.isFinite(values[4])||values[4]<5||values[4]>360||!Number.isSafeInteger(values[5])||values[5]<1||values[5]>10||typeof values[6]!=='string'||!/^[a-f0-9]{64}$/.test(values[6])||envelopeId(values)!==id)throw Error();}catch{throw fail('Sonilo 原任务身份或供应商配置不一致','provider_identity_mismatch');}
  if(!configured)throw fail('Sonilo 原任务供应商尚未配置','configuration_required');
  return {type:values[2],taskId:values[3],duration:values[4],count:values[5]};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  let bytes=prepared.source?.bytes,sourceHash=hash(JSON.stringify({prompt:prepared.prompt,segments:prepared.segments,duration:prepared.duration}));
  if(prepared.source){
   try{
    if(!bytes)bytes=(await media(prepared.source.url,'video',prepared.source.sizeBytes,prepared.duration,signal)).bytes;
    const actual=await bounded(context=>actualVideo(bytes,{duration:prepared.duration,signal:context.signal,ffmpegPath,ffprobePath}),mediaTimeoutMs,signal);
    validateSoniloSegments(prepared.segments,actual.duration);sourceHash=actual.sha256;
   }catch{if(signal?.aborted)throw signal.reason;throw Object.assign(localFail('Sonilo 来源未通过本地预上传校验；尚未上传或提交模型生成'),{code:'sonilo_preparation_failed'});}
  }
  const form=new FormData();form.append('mode','async');form.append('output_format','wav');form.append('variants_num',String(prepared.count));
  if(bytes)form.append('video',new Blob([bytes],{type:'video/mp4'}),'source.mp4');else form.append('duration',String(prepared.duration));
  if(prepared.prompt.length)form.append('prompt',prepared.prompt);
  if(prepared.segments!==undefined)form.append('segments',JSON.stringify(prepared.segments));
  if(prepared.promptInfluence!==undefined){if(!bytes)throw localFail('Sonilo prompt_influence 仅适用于视频音乐');form.append('prompt_influence',String(prepared.promptInfluence));}
  const receipt=await json(prepared.path,'POST',form,signal);
  if([400,401,402,403,413,422,429].includes(receipt.status))return {status:'failed',code:'provider_rejected',error:'Sonilo API 明确拒绝请求，请检查账号权限、额度或输入；未自动重试'};
  if(receipt.status!==202||receipt.value.status!=='processing'||!validId(receipt.value.task_id)||Object.keys(receipt.value).some(key=>!['task_id','status'].includes(key)))throw unknown();
  return {id:envelopeId([fingerprint,MODEL,prepared.type,receipt.value.task_id,prepared.duration,prepared.count,sourceHash]),status:'running'};
 }
 async function poll(id,{signal}={}){
  const original=identity(id),receipt=await json('/v1/tasks/'+encodeURIComponent(original.taskId),'GET',undefined,signal),value=receipt.value;
  if(receipt.status!==200)throw unknown();
  if(value.task_id!==original.taskId||value.type!==undefined&&value.type!==original.type)throw fail('Sonilo 查询回执与原任务身份不一致','provider_identity_mismatch');
  if(!['processing','succeeded','failed'].includes(value.status))throw unknown();
  if(value.status==='failed'){if(!object(value.error)||typeof value.error.code!=='string'||typeof value.error.message!=='string')throw unknown();return {id,status:'failed',code:'provider_failed',error:'Sonilo 原任务生成失败；未重新提交'};}
  if(value.error!==undefined||['video','videos','outputs','music','sfx','music_processed','vocals','mux','ducked','stems','stems_error'].some(key=>value[key]!==undefined))throw unknown();
  if(value.status==='processing'){if(value.audio!==undefined&&(!Array.isArray(value.audio)||value.audio.length))throw unknown();return {id,status:'running'};}
  if(!Array.isArray(value.audio)||value.audio.length!==original.count||value.duration_seconds!==undefined&&(!Number.isFinite(value.duration_seconds)||Math.abs(value.duration_seconds-original.duration)>.1))throw unknown();
  const title=value=>{if(!object(value)||Object.keys(value).length!==1||typeof value.title!=='string'||!value.title.trim()||Array.from(value.title).length>1000)throw unknown();return value.title;};
  if(value.title!==undefined)title(value.title);
  const descriptors=[],indices=new Set(),urls=new Set();let totalBytes=0;
  for(const descriptor of value.audio){
   if(!object(descriptor)||Object.keys(descriptor).some(key=>!['stream_index','url','content_type','file_size','sample_rate','channels','title'].includes(key))||!Number.isSafeInteger(descriptor.stream_index)||descriptor.stream_index<0||descriptor.stream_index>=original.count||indices.has(descriptor.stream_index)||descriptor.content_type!=='audio/wav'||!Number.isSafeInteger(descriptor.file_size)||descriptor.file_size<1||descriptor.file_size>MAX_AUDIO_BYTES||descriptor.sample_rate!==undefined&&(!Number.isSafeInteger(descriptor.sample_rate)||descriptor.sample_rate<8000||descriptor.sample_rate>192000)||descriptor.channels!==undefined&&![1,2].includes(descriptor.channels))throw unknown();
   if(descriptor.title!==undefined)title(descriptor.title);
   let url;try{url=httpsMedia(descriptor.url);}catch{throw unknown();}if(urls.has(url))throw unknown();
   indices.add(descriptor.stream_index);urls.add(url);totalBytes+=descriptor.file_size;if(totalBytes>MAX_BATCH_AUDIO_BYTES)throw unknown();descriptors.push({...descriptor,url});
  }
  // Preserve stream identity even if the supplier returns its list out of order.
  // Validate the complete batch before downloading; never silently pick a track.
  descriptors.sort((a,b)=>a.stream_index-b.stream_index);const outputs=[];
  for(const descriptor of descriptors){const audio=await media(descriptor.url,'audio',descriptor.file_size,original.duration,signal);if(descriptor.sample_rate!==undefined&&descriptor.sample_rate!==audio.sampleRate||descriptor.channels!==undefined&&descriptor.channels!==audio.channels)throw unknown();outputs.push({type:'audio',url:'data:audio/wav;base64,'+audio.bytes.toString('base64'),duration:audio.duration,...descriptor.title!==undefined?{title:title(descriptor.title)}:{}});}
  return {id,status:'succeeded',outputs};
 }
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=3000,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('Sonilo 轮询预算无效');
  const timed=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   let value=await submit(request,{signal:combined});if(!value.id)return value;await onTaskIdentity(value.id);
   while(value.status==='running'){
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate,isConfigured:()=>configured,isPollable:()=>true};
}
module.exports={createSoniloProvider,parseSoniloModelMap,validateSoniloSegments,DEFAULT_SONILO_MODEL_MAP,PROTOCOL,MODEL,MAX_VIDEO_BYTES,MAX_AUDIO_BYTES,MAX_BATCH_AUDIO_BYTES};
