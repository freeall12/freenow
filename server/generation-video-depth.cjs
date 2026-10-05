'use strict';
const {createHash}=require('node:crypto');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const {createVideoMaskMediaTools}=require('./generation-video-mask-media.cjs');
const MODEL='fal-ai/depth-anything-video',ALIAS='depth-anything-video',PROTOCOL='fal-video-depth-native';
const MAX_VIDEO_BYTES=32*1024*1024,MAX_JSON_BYTES=1024*1024;
const DEPTH_PROMPT='Extract per-frame depth; preserve source movement, camera, duration and frame size.';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const unknown=()=>fail('视频深度原任务尚未确认，请查询原任务；未自动重试或重新提交','unknown');
const taskId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function parseVideoDepthModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(alias=>alias!==ALIAS))throw fail('视频深度须显式配置 depth-anything-video 别名','configuration_invalid');
 if(Object.hasOwn(map,ALIAS)){const entry=map[ALIAS];if(!object(entry)||Object.keys(entry).sort().join(',')!=='kind,model'||entry.kind!=='video.depth'||entry.model!==MODEL)throw fail('视频深度须映射到已核实的 fal depth-anything-video 接口','configuration_invalid');}
 return structuredClone(map);
}
function httpsMedia(value){try{const url=publicMediaUrl(value);if(url.protocol!=='https:'||value.includes('#'))throw Error();return url.href;}catch{throw localFail('视频须为有效内联 MP4 或无凭据的公网 HTTPS 地址');}}
function mp4Bytes(value,apiKey){
 const match=/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[1].length%4||match[1].length>Math.ceil(MAX_VIDEO_BYTES/3)*4)throw localFail('视频须为不超过 32 MiB 的完整内联 MP4');
 const bytes=Buffer.from(match[1],'base64');if(!bytes.length||bytes.length>MAX_VIDEO_BYTES||bytes.toString('base64')!==match[1])throw localFail('MP4 编码或字节预算无效');assertCredentialFreeBytes(bytes,apiKey);mp4Type(bytes);return bytes;
}
function mp4Type(bytes){
 if(bytes.length<24||bytes.toString('ascii',4,8)!=='ftyp')throw localFail('素材须为实际 MP4');const size=bytes.readUInt32BE(0);
 if(size<16||size>bytes.length||size%4)throw localFail('MP4 文件类型索引不完整');const brands=[bytes.toString('ascii',8,12)];for(let at=16;at<size;at+=4)brands.push(bytes.toString('ascii',at,at+4));
 if(brands.includes('qt  ')||!brands.some(brand=>/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |cmfc|cmfs)$/.test(brand)))throw localFail('MOV 或其他容器不能冒充 MP4');
}
function guardedJsonFetch(fetchImpl,apiKey){return async(url,options)=>{
 const target=new URL(url);if(target.origin!=='https://queue.fal.run'||!(target.pathname==='/'+MODEL||target.pathname.startsWith('/'+MODEL+'/requests/'))||target.username||target.password)throw unknown();
 const response=await fetchImpl(url,{...options,redirect:'error'});let reader,complete=false;
 const abort=()=>{void (reader?reader.cancel():response.body?.cancel())?.catch(()=>{});};options.signal?.addEventListener('abort',abort,{once:true});
 try{
  const length=response.headers?.get('content-length'),mime=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(response.redirected||mime!=='application/json'||length!=null&&(!/^\d+$/.test(length)||Number(length)>MAX_JSON_BYTES)||!response.body?.getReader)throw unknown();
  reader=response.body.getReader();let size=0;const parts=[];
  for(;;){if(options.signal?.aborted)throw options.signal.reason;const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_JSON_BYTES)throw unknown();parts.push(Buffer.from(next.value));}
  if(!size||length!=null&&Number(length)!==size)throw unknown();const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!object(value))throw unknown();assertCredentialFree(value,apiKey);rejectCredentials(value);complete=true;
  return new Response(bytes,{status:response.status,headers:{'Content-Type':'application/json'}});
 }finally{options.signal?.removeEventListener('abort',abort);if(!complete){if(reader)void reader.cancel().catch(()=>{});else void response.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
};}
function createVideoDepthProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,download,mediaTools,mediaTimeoutMs=120000}={}){
 let mapping={},origin='https://queue.fal.run',configurationError=null;
 try{
  mapping=parseVideoDepthModelMap(modelMap);if(typeof baseUrl!=='string')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!==origin||url.pathname!=='/'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#'))throw Error();}
  if(typeof fetchImpl!=='function'||download!==undefined&&typeof download!=='function'||mediaTools!==undefined&&typeof mediaTools.inspectVideo!=='function'||!Number.isSafeInteger(mediaTimeoutMs)||mediaTimeoutMs<1||mediaTimeoutMs>120000||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();assertCredentialFree(mapping,apiKey);
 }catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.hasOwn(mapping,ALIAS)?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:PROTOCOL,origin,mapping})).digest('hex');
 const profile={label:'Video Depth Anything',model:MODEL,modelSize:'VDA-Large',kind:'video.depth',semantics:'per-frame-depth',tapNowEquivalent:false,sourceMimeTypes:['video/mp4'],audioPolicy:'discard',resolutions:['source'],colormaps:['grayscale'],preserveDuration:true,preserveDimensions:true,promptUsed:false,maxVideos:1,maxCount:1,maxSourceFrames:2400,maxInputBytes:MAX_VIDEO_BYTES,maxOutputBytes:MAX_VIDEO_BYTES,localMediaProfile:'mp4-cfr-even-square-pixels-5-30fps',maxWidth:1920,maxHeight:1080,minFps:5,maxFps:30,maxDuration:480,requiresMediaTools:['ffmpeg','ffprobe'],rawDepths:false,sideBySide:false};
 const enabled=Object.hasOwn(mapping,ALIAS);
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{kinds:enabled?['video.depth']:[],models:enabled?{[ALIAS]:{kind:'video.depth',label:profile.label,model:MODEL}}:{},videoDepth:enabled?{[ALIAS]:profile}:{},references:true,textReferences:false,videoReferences:{maxVideos:1,mimeTypes:['video/mp4'],transport:'inline-or-public-https'},remoteRecovery:true,remoteCancellation:'best-effort',verified:'official-schema-and-local-contract'}};
 const queue=createFalQueue({baseUrl:origin,apiKey,fetchImpl:guardedJsonFetch(fetchImpl,apiKey)}),downloadVideo=download||createGenerationMediaDownloader({limits:{video:MAX_VIDEO_BYTES}}).download;
 let tools=mediaTools;const media=()=>tools??=createVideoMaskMediaTools({maxInputBytes:MAX_VIDEO_BYTES,maxPixels:1920*1080,maxSourceFrames:2400,timeoutMs:mediaTimeoutMs});
 function resolve(request){
  if(!configured)throw fail('视频深度原生后端尚未显式配置，请检查服务端 Key 与模型映射','configuration_required');rejectCredentials(request);assertCredentialFree(request,apiKey);
  if(!object(request)||request.kind!=='video.depth'||Buffer.byteLength(JSON.stringify(request))>48*1024*1024||Object.keys(request).some(key=>!['kind','nodeId','label','prompt','inputs','parameters','references','count'].includes(key)))throw localFail('视频深度请求包含未知设置或超过预算，不会忽略后提交');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire)||Object.keys(p).some(key=>!['workflow','protocol','model','modelId','providerParameters','resolution','duration','width','height','preserveDuration','promptUsed','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'].includes(key))||Object.keys(wire).some(key=>key!=='model'))throw localFail('视频深度仅支持保留原尺寸时长的灰度结果；颜色、帧率、截帧或原始深度设置未支持');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==ALIAS))throw localFail('视频深度型号须为明确映射的 depth-anything-video');
  if(p.workflow!=='depth-video-studio'||p.protocol!=='local-depth-v1'||p.resolution!=='source'||p.preserveDuration!==true||p.promptUsed!==false)throw localFail('视频深度须符合保留源尺寸和时长的 local-depth-v1 合同');
  if(p.resultMode!==undefined&&p.resultMode!=='variants')throw localFail('视频深度只返回一个 variants 视频，不支持分镜结果模式');
  for(const count of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(count!==undefined&&count!==1)throw localFail('每个视频深度任务仅返回一个视频');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||!Array.isArray(request.inputs)||request.inputs.length!==1)throw localFail('视频深度须且只能绑定一个来源视频');const input=request.inputs[0];
  if(!object(input)||typeof input.id!=='string'||!input.id.trim()||input.id!==input.id.trim()||input.id.length>200||/[\x00-\x1f\x7f]/.test(input.id)||input.type!=='video'||Object.keys(input).some(key=>!['id','nodeId','type','url','title','name','role','duration','width','height','sizeBytes','mime','mimeType'].includes(key))||input.role!==undefined&&!['source_video','reference_video'].includes(input.role)||request.nodeId!==input.id)throw localFail('来源须为一个真实视频；选段须先物化，不能用整片替代 clip/trim');
  if(![input.width,input.height].every(value=>Number.isSafeInteger(value)&&value>=2&&value%2===0)||input.width>profile.maxWidth||input.height>profile.maxHeight||!Number.isFinite(input.duration)||input.duration<=0||input.duration>480||p.width!==input.width||p.height!==input.height||p.duration!==input.duration)throw localFail('来源须为偶数尺寸且不超过本地 1920×1080 边界，实际时长与参数一致');
  if([input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4')||input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>MAX_VIDEO_BYTES))throw localFail('来源须为预算内 MP4');
  if(request.prompt!==undefined&&request.prompt!==''&&request.prompt!==DEPTH_PROMPT)throw localFail('视频深度不使用提示词，不会忽略用户文字');
  let bytes,url;if(typeof input.url==='string'&&input.url.startsWith('data:')){bytes=mp4Bytes(input.url,apiKey);if(input.sizeBytes!==undefined&&input.sizeBytes!==bytes.length)throw localFail('来源声明大小与实际 MP4 不一致');}else url=httpsMedia(input.url);
  return {input,bytes,url};
 }
 async function readVideo(url,{signal,expectedBytes}={}){
  const controller=new AbortController(),combined=AbortSignal.any([AbortSignal.timeout(mediaTimeoutMs),controller.signal,...signal?[signal]:[]]);let resource,iterator,complete=false,abort;
  const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});stopped.catch(()=>{});
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};const wait=(operation,disposeLate)=>{check();return Promise.race([Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;}),stopped]);};
  try{
   resource=await wait(()=>downloadVideo(url,{kind:'video',signal:combined}),late=>late.close?.());
   if(resource?.mime!=='video/mp4'||!resource.stream?.[Symbol.asyncIterator]||resource.expectedBytes!==undefined&&(!Number.isSafeInteger(resource.expectedBytes)||resource.expectedBytes<1||resource.expectedBytes>MAX_VIDEO_BYTES))throw unknown();
   iterator=resource.stream[Symbol.asyncIterator]();let size=0;const parts=[];
   for(;;){const next=await wait(()=>iterator.next());if(next.done)break;if(!(next.value instanceof Uint8Array)||(size+=next.value.byteLength)>MAX_VIDEO_BYTES)throw unknown();parts.push(Buffer.from(next.value));}
   if(!size||resource.expectedBytes!==undefined&&size!==resource.expectedBytes||expectedBytes!=null&&size!==expectedBytes)throw unknown();const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);mp4Type(bytes);check();complete=true;return bytes;
  }finally{combined.removeEventListener('abort',abort);if(!complete){controller.abort();void Promise.resolve(iterator?.return?.()).catch(()=>{});}resource?.close?.();}
 }
 function checkedMetadata(actual){
  if(!object(actual)||![actual.width,actual.height].every(n=>Number.isSafeInteger(n)&&n>=2&&n%2===0)||actual.width>1920||actual.height>1080||!Number.isFinite(actual.fps)||actual.fps<5||actual.fps>30||!Number.isInteger(actual.numFrames)||actual.numFrames<1||actual.numFrames>2400||!Number.isFinite(actual.duration)||Math.abs(actual.duration-actual.numFrames/actual.fps)>.0001||!Array.isArray(actual.pts)||actual.pts.length!==actual.numFrames||actual.pts.some((t,i)=>!Number.isFinite(t)||Math.abs(t-i/actual.fps)>.0001))throw localFail('视频须为完整可解码、方形像素、无旋转的 5–30 FPS 恒定帧率 MP4，最多 2400 帧');
  return [actual.width,actual.height,actual.duration,actual.fps,actual.numFrames];
 }
 const envelope=(id,actual)=>'vd1.'+Buffer.from(JSON.stringify([MODEL,ALIAS,id,actual])).toString('base64url');
 function identity(id){let value;try{if(typeof id!=='string'||id.length>1500||!/^vd1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));const m=value[3];if(!Array.isArray(value)||value.length!==4||value[0]!==MODEL||value[1]!==ALIAS||!taskId(value[2])||!Array.isArray(m)||m.length!==5||!m.every(Number.isFinite)||![m[0],m[1]].every(n=>Number.isSafeInteger(n)&&n>=2&&n%2===0)||m[0]>1920||m[1]>1080||m[2]<=0||m[3]<5||m[3]>30||!Number.isInteger(m[4])||m[4]<1||m[4]>2400||Math.abs(m[2]-m[4]/m[3])>.0001||envelope(value[2],m)!==id)throw Error();assertCredentialFree(value,apiKey);}catch{throw fail('视频深度原任务身份无效','provider_identity_mismatch');}if(!configured)throw fail('原视频深度后端未配置','configuration_required');return {requestId:value[2],actual:value[3]};}
 async function receipt(value,actual,expected,{signal}={}){
  if(!object(value)||!taskId(value.requestId)||expected!==undefined&&expected!==value.requestId)throw fail('视频深度回执身份未确认','provider_identity_mismatch');const id=envelope(value.requestId,actual);
  if(!['queued','running','succeeded','failed','unknown'].includes(value.status))throw unknown();const result={id,status:value.status};
  if(value.status==='succeeded'){
   try{
    const output=value.result,file=output?.video;if(!object(output)||Object.keys(output).some(key=>!['video','raw_depths','request_id'].includes(key))||output.raw_depths!=null||!object(file)||Object.keys(file).some(key=>!['url','content_type','file_size','file_name'].includes(key))||file.content_type!=null&&file.content_type!=='video/mp4'||file.file_size!=null&&(!Number.isSafeInteger(file.file_size)||file.file_size<1||file.file_size>MAX_VIDEO_BYTES)||file.file_name!=null&&typeof file.file_name!=='string')throw unknown();assertCredentialFree(output,apiKey);
    const bytes=await readVideo(httpsMedia(file.url),{signal,expectedBytes:file.file_size}),inspection=await media().inspectVideo({bytes,mime:'video/mp4'},{signal});if(inspection.hasAudio!==false)throw unknown();const measured=checkedMetadata(inspection);
    if(measured.some((n,i)=>i===2?Math.abs(n-actual[i])>.0001:i===3?Math.abs(n-actual[i])>.000001:n!==actual[i]))throw unknown();
    result.progress=100;result.outputs=[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),mime:'video/mp4',width:measured[0],height:measured[1],duration:measured[2],sourceFileId:value.requestId}];
   }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  }else if(value.status==='failed'){result.code='provider_failed';result.error='视频深度供应商未完成原任务';}else if(value.status==='unknown'){result.code='unknown';result.error='视频深度原任务尚未确认，不会重复提交';}return result;
 }
 async function submit(request,{signal}={}){
  const resolved=resolve(request);let bytes,actual;
  try{bytes=resolved.bytes||await readVideo(resolved.url,{signal,expectedBytes:resolved.input.sizeBytes});actual=checkedMetadata(await media().inspectVideo({bytes,mime:'video/mp4'},{signal}));if(actual[0]!==resolved.input.width||actual[1]!==resolved.input.height||Math.abs(actual[2]-resolved.input.duration)>.0001)throw localFail('来源真实 MP4 宽高或时长与声明不一致');}
  catch(error){if(signal?.aborted)throw signal.reason;if(error.code==='media_tool_unavailable')throw Object.assign(error,{providerDispatched:false});throw localFail('来源实际 MP4 解码、帧时序或尺寸检查未通过，尚未提交深度任务');}
  const body={video_url:'data:video/mp4;base64,'+bytes.toString('base64'),model:'VDA-Large',colormap:'grayscale',resolution:'auto',max_frames:actual[4],output_fps:null,side_by_side:false,include_raw_depths:false};
  return receipt(await queue.submit(MODEL,body,{signal}),actual,undefined,{signal});
 }
 async function poll(id,{signal}={}){const original=identity(id);return receipt(await queue.poll(MODEL,original.requestId,{signal}),original.actual,original.requestId,{signal});}
 async function cancel(id,{signal}={}){const original=identity(id),value=await queue.cancel(MODEL,original.requestId,{signal});if(value.requestId!==original.requestId)throw fail('视频深度取消任务身份不一致','provider_identity_mismatch');return {id,status:'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('视频深度轮询预算无效');const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{let value=await submit(request,{signal:combined});await onTaskIdentity(value.id);while(['queued','running'].includes(value.status)){onProgress(0);await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});value=await poll(value.id,{signal:combined});}if(value.status!=='succeeded')throw fail('视频深度原任务未完成',value.status==='unknown'?'unknown':'provider_failed');return value;}catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,cancel,generate};
}
module.exports={createVideoDepthProvider,parseVideoDepthModelMap,MODEL,ALIAS,PROTOCOL,MAX_VIDEO_BYTES};
