'use strict';
const {createHash}=require('node:crypto');
const {rejectCredentials}=require('./generation-durable.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {waveMetadata}=require('./generation-openai-speech.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const VIDEO_AUDIO_MODEL='fal-ai/thinksound/audio';
const MAX_VIDEO_BYTES=50000000,MAX_AUDIO_BYTES=50*1024*1024,MAX_JSON_BYTES=1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const unknown=()=>fail('ThinkSound 原任务结果尚未确认，请查询原任务；未自动重试或重新提交','unknown');
const taskId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function parseVideoAudioModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).length>1)throw fail('视频拟音模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map))if(alias!=='sonilo-sfx'||!object(entry)||Object.keys(entry).some(key=>!['kind','model','semantics'].includes(key))||entry.kind!=='audio.generate'||entry.model!==VIDEO_AUDIO_MODEL||entry.semantics!=='explicit-native-alternative')throw fail('须显式将 sonilo-sfx 映射为 ThinkSound 替代后端；不支持冒用 Sonilo 原生型号','configuration_invalid');
 return structuredClone(map);
}
function httpsMedia(value){
 try{const url=publicMediaUrl(value);if(url.protocol!=='https:')throw Error();return url.href;}
 catch{throw localFail('视频拟音素材须为有效内联 MP4 或无凭据的公网 HTTPS 地址');}
}
function mp4Children(bytes,start,end){
 const list=[];
 while(start<end){if(start+8>end||list.length>=10000)throw localFail('MP4 索引无效');const length=bytes.readUInt32BE(start);if(length<8||start+length>end)throw localFail('MP4 索引无效');list.push({type:bytes.toString('ascii',start+4,start+8),start,payload:start+8,end:start+length});start+=length;}
 return list;
}
function indexedVideoTrack(bytes,track,mediaRanges){
 const one=(list,type)=>{const matches=list.filter(atom=>atom.type===type);if(matches.length!==1)throw localFail('MP4 视频轨索引缺失或重复');return matches[0];};
 const mdia=one(mp4Children(bytes,track.payload,track.end),'mdia'),media=mp4Children(bytes,mdia.payload,mdia.end),hdlr=one(media,'hdlr');
 if(hdlr.payload+12>hdlr.end||bytes.toString('ascii',hdlr.payload+8,hdlr.payload+12)!=='vide')return false;
 const minf=one(media,'minf'),stbl=one(mp4Children(bytes,minf.payload,minf.end),'stbl'),tables=mp4Children(bytes,stbl.payload,stbl.end);
 const stsd=one(tables,'stsd'),stsz=one(tables,'stsz'),stts=one(tables,'stts'),stsc=one(tables,'stsc'),offsets=tables.filter(atom=>['stco','co64'].includes(atom.type));
 if(offsets.length!==1||stsd.payload+8>stsd.end||stsz.payload+12>stsz.end||stts.payload+8>stts.end||stsc.payload+8>stsc.end||offsets[0].payload+8>offsets[0].end)throw localFail('MP4 视频样本索引无效');
 const descriptions=mp4Children(bytes,stsd.payload+8,stsd.end),descriptionCount=bytes.readUInt32BE(stsd.payload+4);
 if(!descriptionCount||descriptionCount!==descriptions.length||descriptions.some(atom=>!['avc1','avc3','hvc1','hev1','av01','vp09','mp4v'].includes(atom.type)||atom.payload+28>atom.end||!bytes.readUInt16BE(atom.payload+24)||!bytes.readUInt16BE(atom.payload+26)))throw localFail('MP4 没有可用的视觉样本描述');
 const fixedSize=bytes.readUInt32BE(stsz.payload+4),sampleCount=bytes.readUInt32BE(stsz.payload+8);
 if(!sampleCount||sampleCount>bytes.length||stsz.payload+12+(fixedSize?0:sampleCount*4)!==stsz.end)throw localFail('MP4 视频样本为空或大小索引无效');
 const sizes=Array.from({length:sampleCount},(_,i)=>fixedSize||bytes.readUInt32BE(stsz.payload+12+i*4));if(sizes.some(size=>!size))throw localFail('MP4 视频样本为空');
 const timeCount=bytes.readUInt32BE(stts.payload+4);if(!timeCount||stts.payload+8+timeCount*8!==stts.end)throw localFail('MP4 视频时间索引无效');let timedSamples=0;
 for(let i=0;i<timeCount;i++){const at=stts.payload+8+i*8,count=bytes.readUInt32BE(at),ticks=bytes.readUInt32BE(at+4);if(!count||!ticks)throw localFail('MP4 视频时间索引为空');timedSamples+=count;}
 if(timedSamples!==sampleCount)throw localFail('MP4 视频时间与样本数量不一致');
 const chunkTable=offsets[0],chunkCount=bytes.readUInt32BE(chunkTable.payload+4),offsetSize=chunkTable.type==='co64'?8:4,mappingCount=bytes.readUInt32BE(stsc.payload+4);
 if(!chunkCount||chunkTable.payload+8+chunkCount*offsetSize!==chunkTable.end||!mappingCount||stsc.payload+8+mappingCount*12!==stsc.end)throw localFail('MP4 视频分块索引无效');
 const mappings=[];
 for(let i=0;i<mappingCount;i++){const at=stsc.payload+8+i*12,first=bytes.readUInt32BE(at),count=bytes.readUInt32BE(at+4),description=bytes.readUInt32BE(at+8);if(!first||first>chunkCount||!count||!description||description>descriptionCount||i===0&&first!==1||i>0&&first<=mappings.at(-1).first)throw localFail('MP4 视频分块映射无效');mappings.push({first,count});}
 let sample=0,mapping=0;
 for(let chunk=1;chunk<=chunkCount;chunk++){
  if(mapping+1<mappings.length&&chunk>=mappings[mapping+1].first)mapping++;
  const at=chunkTable.payload+8+(chunk-1)*offsetSize,offset=offsetSize===8?Number(bytes.readBigUInt64BE(at)):bytes.readUInt32BE(at),count=mappings[mapping].count;
  if(!Number.isSafeInteger(offset)||sample+count>sampleCount)throw localFail('MP4 视频分块越界');let length=0;for(let i=0;i<count;i++)length+=sizes[sample++];
  if(!mediaRanges.some(range=>offset>=range.start&&offset+length<=range.end))throw localFail('MP4 视频样本未引用实际媒体数据');
 }
 if(sample!==sampleCount)throw localFail('MP4 视频样本索引不完整');return true;
}
function inlineMp4(url,apiKey){
 const match=/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
 if(!match||match[1].length%4||match[1].length>Math.ceil(MAX_VIDEO_BYTES/3)*4)throw localFail('参考视频须为不超过 50 MB 的有效内联 MP4');
 const bytes=Buffer.from(match[1],'base64');
 if(!bytes.length||bytes.length>MAX_VIDEO_BYTES||bytes.toString('base64')!==match[1])throw localFail('参考视频编码或大小无效');
 assertCredentialFreeBytes(bytes,apiKey);
 let offset=0,duration;const atoms=new Set(),tracks=[],mediaRanges=[];
 while(offset<bytes.length){
  if(offset+8>bytes.length)throw localFail('MP4 文件结构无效');
  let size=bytes.readUInt32BE(offset),header=8;const type=bytes.toString('ascii',offset+4,offset+8);
  if(size===1){if(offset+16>bytes.length)throw localFail('MP4 文件结构无效');const extended=bytes.readBigUInt64BE(offset+8);if(extended>BigInt(Number.MAX_SAFE_INTEGER))throw localFail('MP4 文件结构无效');size=Number(extended);header=16;}
  else if(size===0)size=bytes.length-offset;
  if(size<header||offset+size>bytes.length)throw localFail('MP4 文件结构无效');
  if(type==='ftyp'&&(offset!==0||size<header+8||! /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(bytes.toString('ascii',offset+header,offset+header+4))))throw localFail('参考视频须为 MP4，不能以 MOV 或图片替代');
  if(type==='moov'){
   let child=offset+header;const end=offset+size;
   while(child<end){
    if(child+8>end)throw localFail('MP4 索引无效');const length=bytes.readUInt32BE(child),name=bytes.toString('ascii',child+4,child+8);
    if(length<8||child+length>end)throw localFail('MP4 索引无效');
    if(name==='mvhd'){
     const version=bytes[child+8],timeOffset=child+(version===0?20:version===1?28:0);
     if(!timeOffset||timeOffset+(version?12:8)>child+length||duration!==undefined)throw localFail('MP4 时长索引无效');
     const scale=bytes.readUInt32BE(timeOffset),ticks=version?Number(bytes.readBigUInt64BE(timeOffset+4)):bytes.readUInt32BE(timeOffset+4);
     if(!scale||!Number.isSafeInteger(ticks)||ticks<1)throw localFail('MP4 时长索引无效');duration=ticks/scale;
    }
    if(name==='trak')tracks.push({payload:child+8,end:child+length});
    child+=length;
   }
  }
  if(type==='mdat'){if(size===header)throw localFail('MP4 媒体数据为空');mediaRanges.push({start:offset+header,end:offset+size});}
  atoms.add(type);offset+=size;
 }
 if(!['ftyp','moov','mdat'].every(type=>atoms.has(type))||!Number.isFinite(duration))throw localFail('参考视频缺少 MP4 媒体数据或有效时长索引');
 if(!tracks.some(track=>indexedVideoTrack(bytes,track,mediaRanges)))throw localFail('参考 MP4 没有有效视频轨和真实媒体样本');
 return {size:bytes.length,duration};
}
// Response links and even unused provider fields can echo authentication. Read
// the bounded JSON before the shared queue projects it into a public receipt.
function guardedJsonFetch(fetchImpl,apiKey){return async(url,options)=>{
 const target=new URL(url);if(target.origin!=='https://queue.fal.run'||!target.pathname.startsWith('/fal-ai/thinksound')||target.username||target.password)throw unknown();
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
function createVideoAudioProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,download=createGenerationMediaDownloader().download,mediaTimeoutMs=120000}={}){
 let mapping={},origin='https://queue.fal.run',configurationError=null;
 try{
  mapping=parseVideoAudioModelMap(modelMap);
  if(typeof baseUrl!=='string')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!==origin||url.pathname!=='/'||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#'))throw Error();}
  if(typeof fetchImpl!=='function'||typeof download!=='function'||!Number.isSafeInteger(mediaTimeoutMs)||mediaTimeoutMs<1||mediaTimeoutMs>120000||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
  assertCredentialFree(mapping,apiKey);
 }catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'fal-video-audio-native',origin,mapping})).digest('hex');
 const profile={scene:'Sound',label:'ThinkSound Video-to-Audio',model:VIDEO_AUDIO_MODEL,semantics:'explicit-native-alternative',durationMode:'source-video',providerMaxVideoDuration:null,localVideoDuration:{min:1,max:180},maxVideos:1,maxCount:1,maxCharacters:2000,maxVideoBytes:MAX_VIDEO_BYTES,maxAudioBytes:MAX_AUDIO_BYTES,segments:false,textOnly:false,formats:['wav']};
 const metadata={configured,protocol:'fal-video-audio-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'audio.generate',label:profile.label,model:VIDEO_AUDIO_MODEL,semantics:profile.semantics}])),videoAudio:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,structuredClone(profile)])),references:true,textReferences:false,videoReferences:{maxVideos:1,mimeTypes:['video/mp4'],transport:'inline-or-public-https'},remoteRecovery:true,remoteCancellation:'best-effort',verified:'official-schema-and-local-contract'}};
 const queue=createFalQueue({baseUrl:origin,apiKey,fetchImpl:guardedJsonFetch(fetchImpl,apiKey)});
 function resolve(request){
  if(!configured)throw fail('ThinkSound 视频拟音替代后端尚未显式配置，请检查服务端 Key 与模型映射','configuration_required');
  rejectCredentials(request);assertCredentialFree(request,apiKey);
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFail('视频拟音仅支持不超过 64 MiB 的单视频音频生成请求');
  if(Object.keys(request).some(key=>!['kind','nodeId','label','prompt','inputs','parameters','references','count'].includes(key)))throw localFail('视频拟音请求包含片段或未知设置，不会忽略后提交');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire))throw localFail('视频拟音参数无效');
  const alias=wire.model??p.modelId??p.model;
  if(alias!=='sonilo-sfx'||!Object.hasOwn(mapping,alias))throw fail('当前音频型号未显式映射到 ThinkSound 视频拟音','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias)||p.virtualModel!==undefined&&p.virtualModel!=='sonilo-music'||p.scene!=='Sound')throw localFail('ThinkSound 替代仅支持 Sonilo 选择器的音效场景，不支持音乐');
  const allowed=new Set(['model','modelId','virtualModel','scene','duration','providerParameters','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout']);
  if(Object.keys(p).some(key=>!allowed.has(key))||Object.keys(wire).some(key=>!['model','seed','num_inference_steps','cfg_scale'].includes(key)))throw localFail('视频拟音含不支持的设置、分段或时长控制，不会忽略后提交');
  for(const value of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw localFail('视频拟音每个任务仅生成一个音频结果');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||!Array.isArray(request.inputs)||request.inputs.length!==1||!object(request.inputs[0])||request.inputs[0].type!=='video')throw localFail('视频拟音须且只能绑定一个参考视频；不支持额外引用或纯文字');
  const input=request.inputs[0];
  const inputKeys=new Set(['id','nodeId','type','url','title','role','duration','sizeBytes','mime','mimeType']);
  if(Object.keys(input).some(key=>!inputKeys.has(key))||[request.sourceClip,request.clip,request.trim,request.segments].some(value=>value!==undefined)||input.role!==undefined&&!['source_video','reference_video'].includes(input.role))throw localFail('参考视频含片段、分段或未知属性；须先导出真实 MP4，不会处理整片替代选段');
  if(!Number.isFinite(input.duration)||input.duration<1||input.duration>180||p.duration!==input.duration)throw localFail('视频拟音时长须与已读取的参考视频一致且在本地 1–180 秒边界内；供应商未公开最大时长，不会截断或扩展');
  if([input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4'))throw localFail('参考视频 MIME 须为 MP4');
  let videoUrl,size;
  if(typeof input.url==='string'&&input.url.startsWith('data:')){const actual=inlineMp4(input.url,apiKey);size=actual.size;if(Math.abs(actual.duration-input.duration)>.01)throw localFail('参考视频声明时长与实际 MP4 索引不一致，不会忽略后提交');videoUrl=input.url;}else videoUrl=httpsMedia(input.url);
  if(input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>MAX_VIDEO_BYTES||size!==undefined&&input.sizeBytes!==size))throw localFail('参考视频大小须在 50 MB 内并与实际字节一致');
  const prompt=request.prompt??'';if(typeof prompt!=='string'||prompt.length>2000)throw localFail('视频拟音提示词须为不超过 2000 字符的文字');
  const body={video_url:videoUrl,prompt};
  if(wire.seed!==undefined){if(wire.seed!==null&&!Number.isSafeInteger(wire.seed))throw localFail('ThinkSound 随机种子须为安全整数或 null');body.seed=wire.seed;}
  if(wire.num_inference_steps!==undefined){if(!Number.isSafeInteger(wire.num_inference_steps)||wire.num_inference_steps<2||wire.num_inference_steps>100)throw localFail('ThinkSound 推理步数须为 2–100 整数');body.num_inference_steps=wire.num_inference_steps;}
  if(wire.cfg_scale!==undefined){if(!Number.isFinite(wire.cfg_scale)||wire.cfg_scale<1||wire.cfg_scale>20)throw localFail('ThinkSound 引导强度须为 1–20');body.cfg_scale=wire.cfg_scale;}
  return {body,duration:input.duration,sizeBytes:input.sizeBytes};
 }
 const envelope=(id,duration)=>'va1.'+Buffer.from(JSON.stringify([VIDEO_AUDIO_MODEL,id,'sonilo-sfx','explicit-native-alternative',duration])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1500||!/^va1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==5||value[0]!==VIDEO_AUDIO_MODEL||!taskId(value[1])||value[2]!=='sonilo-sfx'||value[3]!=='explicit-native-alternative'||!Number.isFinite(value[4])||value[4]<1||value[4]>180||envelope(value[1],value[4])!==id)throw Error();}catch{throw fail('视频拟音原任务身份无效','provider_identity_mismatch');}
  if(!configured)throw fail('原 ThinkSound 替代后端尚未配置','configuration_required');
  return {requestId:value[1],duration:value[4]};
 }
 async function media(url,kind,signal,expectedBytes,expectedDuration){
  const timed=AbortSignal.timeout(mediaTimeoutMs),controller=new AbortController(),combined=AbortSignal.any([timed,controller.signal,...signal?[signal]:[]]);let resource,iterator,complete=false,abort;
  const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();return Promise.race([Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;}),stopped]);}
  try{
   // The default downloader pins public DNS and verifies the connected peer,
   // refuses redirects and has no queue API authorization on CDN requests.
   const limit=kind==='video'?MAX_VIDEO_BYTES:MAX_AUDIO_BYTES,mime=kind==='video'?'video/mp4':'audio/wav';
   resource=await wait(()=>download(url,{kind,signal:combined}),late=>late.close());
   if(!resource||resource.mime!==mime||!resource.stream?.[Symbol.asyncIterator]||resource.expectedBytes!==undefined&&(!Number.isSafeInteger(resource.expectedBytes)||resource.expectedBytes<1||resource.expectedBytes>limit))throw unknown();
   iterator=resource.stream[Symbol.asyncIterator]();let size=0;const parts=[];
   for(;;){const next=await wait(()=>iterator.next());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>limit)throw unknown();parts.push(Buffer.from(next.value));}
   check();if(!size||resource.expectedBytes!==undefined&&resource.expectedBytes!==size||expectedBytes!=null&&size!==expectedBytes)throw unknown();const bytes=Buffer.concat(parts);assertCredentialFreeBytes(bytes,apiKey);
   const encoded='data:'+mime+';base64,'+bytes.toString('base64'),info=kind==='video'?inlineMp4(encoded,apiKey):waveMetadata(bytes);
   if(Math.abs(info.duration-expectedDuration)>(kind==='video'?.01:.1))throw unknown();check();complete=true;
   return {url:encoded,duration:info.duration};
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{combined.removeEventListener('abort',abort);if(!complete){controller.abort();void Promise.resolve(iterator?.return?.()).catch(()=>{});}resource?.close();}
 }
 async function receipt(value,duration,expected,{signal}={}){
  if(!object(value)||!taskId(value.requestId)||expected!==undefined&&value.requestId!==expected)throw fail('视频拟音回执任务身份不一致','provider_identity_mismatch');
  if(!['queued','running','succeeded','failed','unknown'].includes(value.status))throw unknown();
  const id=envelope(value.requestId,duration),result={id,status:value.status};
  if(value.status==='succeeded'){
   const file=value.result?.audio;let url;
   try{
    if(!object(file)||Object.keys(value.result).some(key=>!['audio','prompt','request_id'].includes(key))||typeof file.url!=='string'||typeof value.result.prompt!=='string'||file.content_type!=null&&!['audio/wav','audio/x-wav','application/octet-stream'].includes(file.content_type)||file.file_name!=null&&typeof file.file_name!=='string'||file.file_size!=null&&(!Number.isSafeInteger(file.file_size)||file.file_size<1||file.file_size>MAX_AUDIO_BYTES))throw Error();
    url=httpsMedia(file.url);assertCredentialFree(value.result,apiKey);
   }catch{throw unknown();}
   const checked=await media(url,'audio',signal,file.file_size,duration);result.outputs=[{type:'audio',...checked,mime:'audio/wav',sourceFileId:value.requestId}];
  }else if(value.status==='failed'){result.code='provider_failed';result.error='ThinkSound 视频拟音未完成';}
  else if(value.status==='unknown'){result.code='unknown';result.error='ThinkSound 原任务尚未确认，不会重复提交';}
  return result;
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  if(!prepared.body.video_url.startsWith('data:')){
   try{prepared.body.video_url=(await media(prepared.body.video_url,'video',signal,prepared.sizeBytes,prepared.duration)).url;}
   catch(error){if(signal?.aborted)throw signal.reason;throw localFail('参考视频尚未安全读取或实际 MP4 字节、时长不匹配；未提交 ThinkSound');}
  }
  return receipt(await queue.submit(VIDEO_AUDIO_MODEL,prepared.body,{signal}),prepared.duration,undefined,{signal});
 }
 async function poll(id,{signal}={}){const original=identity(id);return receipt(await queue.poll(VIDEO_AUDIO_MODEL,original.requestId,{signal}),original.duration,original.requestId,{signal});}
 async function cancel(id,{signal}={}){const original=identity(id),value=await queue.cancel(VIDEO_AUDIO_MODEL,original.requestId,{signal});if(value.requestId!==original.requestId)throw fail('视频拟音取消任务身份不一致','provider_identity_mismatch');return {id,status:'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('视频拟音轮询预算无效');
  const timed=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){onProgress(0);await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});value=await poll(value.id,{signal:combined});}
   if(value.status!=='succeeded')throw fail('ThinkSound 视频拟音未完成',value.status==='unknown'?'unknown':'provider_failed');return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,cancel,generate};
}
module.exports={createVideoAudioProvider,parseVideoAudioModelMap,VIDEO_AUDIO_MODEL,MAX_AUDIO_BYTES,MAX_VIDEO_BYTES};
