'use strict';
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {createGenerationMediaDownloader,publicMediaUrl}=require('./generation-media-download.cjs');
const {decodePNG,crc32}=require('./generation-png-alpha.cjs');
const {ALIAS,MODEL,MAX_OUTPUT_BYTES,MAX_OUTPUT_PIXELS,magnificCapabilities,validateMagnificRequest}=require('./generation-magnific-profile.cjs');

const PROTOCOL='magnific-native',API_ORIGIN='https://api.magnific.com',TASK_PATH='/v1/ai/image-upscaler-precision-v2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(message,code='unknown')=>Object.assign(Error(message),{code});
const unknown=()=>failure('Magnific 原任务状态或完整结果尚未确认；请查询原任务，未自动重试');
const check=signal=>{if(signal?.aborted)throw signal.reason;};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

function parseMagnificModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(alias=>alias!==ALIAS))throw failure('Magnific 仅允许 image.upscale:magnific 映射','configuration_invalid');
 if(Object.hasOwn(map,ALIAS)){
  const entry=map[ALIAS];
  if(!object(entry)||Object.keys(entry).sort().join(',')!=='kind,model'||entry.kind!=='image.upscale'||entry.model!==MODEL)throw failure('Magnific 映射须明确 image.upscale 与 magnific-v2','configuration_invalid');
 }
 return structuredClone(map);
}

function resultUrl(value){const url=publicMediaUrl(value);if(url.protocol!=='https:')throw unknown();return url.href;}
async function follow(operation,signal){
 check(signal);let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([Promise.resolve().then(operation),stopped]);}finally{signal.removeEventListener('abort',abort);}
}

// Only private, locally written bytes reach the codec. No URL, protocol, filter,
// executable argument or output path can be supplied by the provider receipt.
function mediaCommand(binary,args,{signal,maxStdout=65536,onStdout}={}){
 check(signal);
 return new Promise((resolve,reject)=>{
  let child,reason,killTimer,stdoutBytes=0,stderrBytes=0;const chunks=[];
  const stop=error=>{reason||=error;child?.kill('SIGTERM');killTimer||=setTimeout(()=>child?.kill('SIGKILL'),500);};
  const abort=()=>stop(signal.reason);
  try{child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});}catch{return reject(failure('Magnific 结果解码工具不可用','media_tool_unavailable'));}
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>maxStdout)return stop(unknown());try{check(signal);if(onStdout)onStdout(chunk);else chunks.push(chunk);}catch(error){stop(error);}});
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>1024*1024)stop(unknown());});
  child.once('error',()=>stop(failure('Magnific 结果需要已有本机 FFmpeg/FFprobe','media_tool_unavailable')));
  child.once('close',code=>{clearTimeout(killTimer);signal?.removeEventListener('abort',abort);if(reason)return reject(reason);if(code!==0||stderrBytes)return reject(unknown());resolve({bytes:stdoutBytes,buffer:Buffer.concat(chunks)});});
 });
}
let decoding=0,processingOutputs=0;
async function decodeResult(bytes,mime,{apiKey,signal,ffmpegPath,ffprobePath}={}){
 check(signal);assertCredentialFreeBytes(bytes,apiKey);
 if(mime==='image/png'){
  let offset=8,sawEnd=false,transparency=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8);if(end>bytes.length||bytes.readUInt32BE(end-4)!==crc32(bytes.subarray(offset+4,end-4))||['zTXt','iTXt','iCCP','acTL','fcTL','fdAT'].includes(type))throw unknown();if(type==='tRNS')transparency=true;offset=end;if(type==='IEND'){if(length||end!==bytes.length)throw unknown();sawEnd=true;break;}}
  if(!sawEnd)throw unknown();
  // This existing decoder validates every CRC, zlib stream and actual pixel.
  // Its 32 MP ceiling is a local fast path; larger static PNGs use FFmpeg below.
  if(bytes.length>=33&&!transparency&&bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=32*1024*1024&&bytes[24]===8&&[2,6].includes(bytes[25])&&bytes[28]===0){
   const decoded=decodePNG(bytes);if(decoded.width>32768||decoded.height>32768)throw unknown();assertCredentialFreeBytes(decoded.pixels,apiKey);return {width:decoded.width,height:decoded.height};
  }
 }
 if(!['image/png','image/jpeg','image/webp'].includes(mime))throw unknown();
 if(decoding>=2)throw failure('Magnific 完整结果解码繁忙；可稍后查询原任务','media_tool_busy');
 decoding++;let directory;
 const timed=AbortSignal.timeout(120000),combined=signal?AbortSignal.any([signal,timed]):timed;
 try{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-magnific-'));const file=path.join(directory,'result.'+{ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]);
  await fs.writeFile(file,bytes,{mode:0o600,signal:combined});check(combined);
  const formats='png_pipe,jpeg_pipe,webp_pipe',probe=await mediaCommand(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_entries','stream=codec_type,codec_name,width,height:stream_side_data=rotation','-of','json',file],{signal:combined});
  const info=JSON.parse(probe.buffer.toString()),stream=info.streams?.[0],expectedCodec={'image/png':'png','image/jpeg':'mjpeg','image/webp':'webp'}[mime];
  if(!Array.isArray(info.streams)||info.streams.length!==1||stream.codec_type!=='video'||stream.codec_name!==expectedCodec||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||stream.width<1||stream.height<1||stream.width>32768||stream.height>32768||stream.width*stream.height>MAX_OUTPUT_PIXELS||stream.side_data_list?.some(side=>side.rotation!==undefined&&side.rotation!==0))throw unknown();
  let tail=Buffer.alloc(0);const hold=Math.max(4,6*Buffer.byteLength(apiKey||'')+4),expected=stream.width*stream.height*4;
  const decoded=await mediaCommand(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-xerror','-err_detect','explode','-max_pixels',String(MAX_OUTPUT_PIXELS),'-noautorotate','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-i',file,'-map','0:v:0','-an','-sn','-dn','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{
   signal:combined,maxStdout:expected,
   onStdout:chunk=>{const scan=Buffer.concat([tail,chunk]);assertCredentialFreeBytes(scan,apiKey);tail=scan.subarray(-hold);}
  });
  if(decoded.bytes!==expected)throw unknown();check(combined);
  return {width:stream.width,height:stream.height};
 }finally{decoding--;if(directory)await fs.rm(directory,{recursive:true,force:true});}
}

function createMagnificProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,downloadImpl,ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg',ffprobePath=process.env.FFPROBE_PATH||'ffprobe'}={}){
 let mapping={},configurationError=null;
 try{
  mapping=parseMagnificModelMap(modelMap);
  if(typeof baseUrl!=='string'||typeof fetchImpl!=='function'||downloadImpl!==undefined&&typeof downloadImpl!=='function'||typeof ffmpegPath!=='string'||!ffmpegPath||typeof ffprobePath!=='string'||!ffprobePath)throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!==API_ORIGIN||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#')||!['/','/v1','/v1/'].includes(url.pathname))throw Error();}
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
 }catch{configurationError='configuration_invalid';mapping={};}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.hasOwn(mapping,ALIAS)?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(canonical({protocol:PROTOCOL,endpoint:API_ORIGIN+TASK_PATH,mapping,contractVersion:'magnific-precision-v2-complete-source-v1'})).digest('hex');
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{
  kinds:Object.hasOwn(mapping,ALIAS)?['image.upscale']:[],models:Object.hasOwn(mapping,ALIAS)?{[ALIAS]:{kind:'image.upscale',model:MODEL,label:'Magnific Precision V2'}}:{},
  upscaleMagnific:magnificCapabilities(),references:false,remoteRecovery:true,remoteCancellation:false,verified:'official-schema-and-local-contract',vendorNative:true
 }};
 const fetchSafe=protectGenerationFetch(fetchImpl),download=downloadImpl||createGenerationMediaDownloader().download;
 function assertConfigured(){if(!configured)throw failure('Magnific 原生接口尚未配置，请检查 Key 与精确型号映射','configuration_required');}
 function prepare(request){assertConfigured();validateMagnificRequest(request,{apiKey});return request;}
 async function read(method,id,body,signal){
  assertConfigured();check(signal);const timed=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=operation=>Promise.race([Promise.resolve().then(()=>{check(combined);return operation();}),interrupted]);
  try{
   const response=await wait(()=>fetchSafe(API_ORIGIN+TASK_PATH+(id?'/'+encodeURIComponent(id):''),{method,headers:{'x-magnific-api-key':apiKey,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},signal:combined}));
   if(!response.ok||Number(response.headers?.get('content-length'))>1024*1024){void response.body?.cancel().catch(()=>{});throw unknown();}
   if(!response.body?.getReader)throw unknown();const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)throw unknown();parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  }catch{check(signal);throw unknown();}
  finally{combined.removeEventListener('abort',abort);}
 }
 async function outputs(generated,signal){
  if(processingOutputs>=2)throw unknown();processingOutputs++;
  let downloaded;const timed=AbortSignal.timeout(120000),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   if(!Array.isArray(generated)||generated.length!==1)throw unknown();const url=resultUrl(generated[0]);assertCredentialFree(url,apiKey);
   downloaded=await follow(()=>Promise.resolve(download(url,{kind:'image',signal:combined})).then(value=>{if(combined.aborted){value?.close?.();check(combined);}return value;}),combined);const parts=[];let size=0;
   const iterator=downloaded.stream[Symbol.asyncIterator]();
   for(;;){const part=await follow(()=>iterator.next(),combined);if(part.done)break;check(combined);if(!(part.value instanceof Uint8Array))throw unknown();size+=part.value.byteLength;if(size>MAX_OUTPUT_BYTES)throw unknown();parts.push(Buffer.from(part.value));}
   const bytes=Buffer.concat(parts);if(!bytes.length||downloaded.expectedBytes!==undefined&&bytes.length!==downloaded.expectedBytes)throw unknown();
   const dimensions=await decodeResult(bytes,downloaded.mime,{apiKey,signal:combined,ffmpegPath,ffprobePath});check(combined);
   // Archive these exact decoded original bytes via the host's materializer;
   // dimensions describe actual pixels, never inferred input×scale metadata.
   return [{type:'image',url:'data:'+downloaded.mime+';base64,'+bytes.toString('base64'),mime:downloaded.mime,...dimensions}];
  }catch{check(signal);throw unknown();}
  finally{processingOutputs--;downloaded?.close?.();}
 }
 async function receipt(value,{expectedId,signal,onTaskIdentity}={}){
  const data=value?.data;
  if(!object(value)||!object(data)||typeof data.task_id!=='string'||!UUID.test(data.task_id)||expectedId!==undefined&&expectedId!==data.task_id)throw failure('Magnific 原任务身份未确认','provider_identity_mismatch');
  assertCredentialFree(data.task_id,apiKey);
  // Persist the trustworthy original UUID before interpreting status or media.
  // Unknown status or a damaged first COMPLETED receipt still remains queryable.
  if(onTaskIdentity)await onTaskIdentity(data.task_id);check(signal);
  try{assertCredentialFree(value,apiKey);}catch{throw unknown();}
  if(!['CREATED','IN_PROGRESS','COMPLETED','FAILED'].includes(data.status)||!Array.isArray(data.generated))throw unknown();
  if(data.status!=='COMPLETED'&&data.generated.length)throw unknown();
  if(data.status==='COMPLETED')return {id:data.task_id,status:'succeeded',progress:100,outputs:await outputs(data.generated,signal)};
  if(data.status==='FAILED')return {id:data.task_id,status:'failed',code:'provider_failed',error:'Magnific 未完成高清放大'};
  return {id:data.task_id,status:data.status==='CREATED'?'queued':'running'};
 }
 async function submit(request,context={}){
  assertConfigured();const resolved=validateMagnificRequest(request,{apiKey}),p=resolved.parameters;
  const body={image:resolved.image.bytes.toString('base64'),scale_factor:p.scaleFactor,sharpen:p.sharpen,smart_grain:p.smartGrain,ultra_detail:p.ultraDetail};
  return receipt(await read('POST',undefined,body,context.signal),{signal:context.signal,onTaskIdentity:context.onTaskIdentity});
 }
 async function poll(id,context={}){
  assertConfigured();if(typeof id!=='string'||!UUID.test(id))throw failure('Magnific 原任务 UUID 无效','provider_identity_mismatch');
  assertCredentialFree(id,apiKey);return receipt(await read('GET',id,undefined,context.signal),{expectedId:id,signal:context.signal});
 }
 async function generate(request,{signal,onTaskIdentity,onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw Object.assign(failure('Magnific 轮询预算无效','unsupported_generation'),{providerDispatched:false});
  const timed=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   let value=await submit(request,{signal:combined,onTaskIdentity});
   while(['queued','running'].includes(value.status)){
    await new Promise((resolve,reject)=>{check(combined);const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw failure('Magnific 未完成高清放大','provider_failed');await onProgress(100);return value;
  }catch(error){check(signal);if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare,submit,poll,generate,isConfigured:()=>configured,isPollable:()=>configured};
}

module.exports={createMagnificProvider,parseMagnificModelMap,PROTOCOL,API_ORIGIN,TASK_PATH};
