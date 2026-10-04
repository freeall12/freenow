'use strict';
const {createHash}=require('node:crypto');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {publicMediaUrl,createGenerationMediaDownloader}=require('./generation-media-download.cjs');
const {validateMP3,waveMetadata}=require('./generation-openai-speech.cjs');
const MAX_JSON_BYTES=1024*1024,MAX_AUDIO_BYTES=50*1024*1024;
const MODELS=['mureka-8','mureka-o2'];
const DEFAULT_MUREKA_MODEL_MAP=Object.freeze(Object.fromEntries(MODELS.map(model=>[model,Object.freeze({kind:'audio.generate',model})])));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('Mureka 任务状态未确认，请查询原任务；未自动重试或重新提交','unknown');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value);
function parseMurekaModelMap(value){
 const map=value===undefined?DEFAULT_MUREKA_MODEL_MAP:typeof value==='string'?JSON.parse(value):value;
 if(!object(map)||Object.keys(map).length>20)throw fail('Mureka 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map))if(!/^[-\w.]{1,128}$/.test(alias)||!object(entry)||entry.kind!=='audio.generate'||!MODELS.includes(entry.model)||MODELS.includes(alias)&&entry.model!==alias||Object.keys(entry).some(key=>!['kind','model'].includes(key)))throw fail('Mureka 仅支持明确的 mureka-8 / mureka-o2 合同；未替换公开型号','configuration_invalid');
 return Object.fromEntries(Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).map(([alias,entry])=>[alias,{kind:entry.kind,model:entry.model}]));
}
// download is a trusted server-only testing seam. Request bodies cannot supply
// its implementation, download headers, destination overrides or credentials.
function createMurekaProvider({apiKey,baseUrl='https://api.mureka.ai',modelMap,fetchImpl=fetch,localPort,timeoutMs=30000,download=createGenerationMediaDownloader().download,mediaTimeoutMs=120000}={}){
 let mapping={},origin='',configurationError=null;
 try{
  mapping=parseMurekaModelMap(modelMap);origin=endpoint(baseUrl===''?'https://api.mureka.ai':baseUrl,{localPort});
  const url=new URL(origin);if(url.pathname!=='/')throw fail('Mureka 地址须为 API origin','configuration_invalid');
  if(typeof fetchImpl!=='function'||typeof download!=='function'||!Number.isSafeInteger(mediaTimeoutMs)||mediaTimeoutMs<1||mediaTimeoutMs>120000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||apiKey!==undefined&&(typeof apiKey!=='string'||!apiKey.trim()||apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw fail('Mureka 配置无效','configuration_invalid');
  assertCredentialFree({origin,mapping},apiKey);
 }catch(error){configurationError=error.code||'configuration_invalid';mapping={};origin='';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'mureka-native',origin,mapping})).digest('hex');
 const originIdentity=createHash('sha256').update(origin).digest('hex').slice(0,24);
 const metadata={configured,protocol:'mureka-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'audio.generate'}])),music:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{scene:'Music',lyricsModes:['auto','custom'],maxPromptCharacters:2000,customLyrics:{maxPromptCharacters:1024,maxCharacters:5000},maxCount:1,maxAudioBytes:MAX_AUDIO_BYTES}])),references:false,textReferences:true,remoteRecovery:true,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 const transport=protectGenerationFetch(fetchImpl);
 function resolve(request){
  if(!configured)throw fail('Mureka 原生音乐尚未配置，请检查 Key、地址与模型映射','configuration_required');
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>MAX_JSON_BYTES)throw fail('Mureka 仅支持有界的音乐生成请求');
  assertCredentialFree(request,apiKey);
  const p=request.parameters??{};if(!object(p))throw fail('Mureka 音乐参数须为对象');
  const allowed=new Set(['model','modelId','virtualModel','scene','lyric_mode','lyrics','count','times']);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw fail('请求含 Mureka 尚未支持的格式、时长或其他参数；未忽略后提交');
  const alias=p.modelId??p.model,entry=typeof alias==='string'&&Object.hasOwn(mapping,alias)?mapping[alias]:null;
  if(!entry)throw fail('此型号未映射到 Mureka 原生音乐','configuration_required');
  if([p.model,p.modelId].some(value=>value!==undefined&&value!==alias))throw fail('Mureka 模型标识不一致');
  const virtual=entry.model==='mureka-8'?'mureka-v8':'mureka-o2';
  if(p.virtualModel!==undefined&&p.virtualModel!==virtual||p.scene!=='Music')throw fail('Mureka 音乐模型或场景不匹配');
  for(const count of [request.count,p.count,p.times])if(count!==undefined&&count!==1)throw fail('Mureka 每个任务明确只生成一首歌曲');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('Mureka 参考素材须展开为文字 inputs');
  const inputs=request.inputs??[];
  if(!Array.isArray(inputs)||inputs.length>30||inputs.some(input=>!object(input)||input.type!=='text'||typeof input.text!=='string'||!input.text.trim()))throw fail('Mureka 本批只支持文字参考；音频参考和克隆未接入');
  if(typeof request.prompt!=='string')throw fail('Mureka 音乐描述须为文字');
  const prefix=inputs.map(input=>input.text).join('\n');let prompt=request.prompt;if(prefix&&prompt!==prefix&&!prompt.startsWith(prefix+'\n'))prompt=prefix+(prompt?'\n'+prompt:'');
  if(p.lyric_mode!==undefined&&typeof p.lyric_mode!=='boolean'||p.lyrics!==undefined&&typeof p.lyrics!=='string')throw fail('Mureka 歌词参数类型无效');
  const custom=p.lyric_mode??false,lyrics=p.lyrics??'',mode=custom?'custom':'auto';
  if(Array.from(prompt).length>(custom?1024:2000)||!custom&&!prompt.trim())throw fail(custom?'Mureka 自定义歌词描述最多 1024 字符；未截断':'Mureka 自动歌词描述须为 1–2000 字符；未截断');
  if(custom&&(!lyrics.trim()||Array.from(lyrics).length>5000)||!custom&&lyrics.length)throw fail('Mureka 自定义歌词须为 1–5000 字符；自动模式不可同时提交歌词');
  return {model:entry.model,mode,path:custom?'v1/song/generate':'v1/song/easy-generate',body:{model:entry.model,n:1,stream:false,prompt,...custom?{lyrics}:{}}};
 }
 async function read(path,method,body,signal){
  if(!configured)throw fail('Mureka 原任务供应商尚未配置','configuration_required');
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let reader,response,complete=false,abort;const timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();return Promise.race([Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;}),stopped]);}
  try{
   response=await wait(()=>transport(new URL(path,origin),{method,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity'},...body!==undefined?{body:JSON.stringify(body)}:{},signal:combined}),late=>late.body?.cancel());
   const encoding=response.headers?.get('content-encoding'),mime=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers?.get('content-length');
   if(response.status!==200||!response.ok||response.redirected||!response.body?.getReader||mime!=='application/json'||encoding&&encoding!=='identity'||length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)<1||Number(length)>MAX_JSON_BYTES))throw unknown();
   reader=response.body.getReader();const parts=[];let size=0;
   for(;;){const next=await wait(()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_JSON_BYTES)throw unknown();parts.push(Buffer.from(next.value));}
   check();if(!size||length!==null&&Number(length)!==size)throw unknown();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(!object(value))throw unknown();assertCredentialFree(value,apiKey);complete=true;return value;
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{clearTimeout(timer);combined.removeEventListener('abort',abort);if(!complete){controller.abort();if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
 }
 const envelope=(model,mode,taskId)=>'mu1.'+Buffer.from(JSON.stringify([originIdentity,model,mode,taskId])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1024||!/^mu1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==4||!MODELS.includes(value[1])||!['auto','custom'].includes(value[2])||!validId(value[3])||envelope(...value.slice(1))!==id)throw Error();}catch{throw fail('Mureka 任务身份无效或地址已变更','provider_identity_mismatch');}
  if(!configured)throw fail('Mureka 原任务供应商尚未配置','configuration_required');
  if(!Object.values(mapping).some(entry=>entry.model===value[1]))throw fail('Mureka 原任务型号映射已变更','provider_configuration_changed');
  return {model:value[1],mode:value[2],taskId:value[3]};
 }
 async function audio(url,signal){
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let resource,iterator,complete=false,abort;
  const timer=setTimeout(()=>controller.abort(unknown()),mediaTimeoutMs),stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();return Promise.race([Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;}),stopped]);}
  try{
   // Safe downloader enforces public DNS/peer identity, no redirects, bounded
   // bytes and complete containers. It receives no Mureka API authorization.
   resource=await wait(()=>download(url,{kind:'audio',signal:combined}),late=>late.close());
   if(!resource||!['audio/mpeg','audio/wav'].includes(resource.mime)||!resource.stream?.[Symbol.asyncIterator]||resource.expectedBytes!==undefined&&(!Number.isSafeInteger(resource.expectedBytes)||resource.expectedBytes<1||resource.expectedBytes>MAX_AUDIO_BYTES))throw unknown();
   iterator=resource.stream[Symbol.asyncIterator]();const parts=[];let size=0;
   for(;;){const next=await wait(()=>iterator.next());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_AUDIO_BYTES)throw unknown();parts.push(Buffer.from(next.value));}
   check();if(!size||resource.expectedBytes!==undefined&&resource.expectedBytes!==size)throw unknown();const bytes=Buffer.concat(parts);
   if(resource.mime==='audio/mpeg')validateMP3(bytes);else waveMetadata(bytes);
   assertCredentialFreeBytes(bytes,apiKey);check();complete=true;return 'data:'+resource.mime+';base64,'+bytes.toString('base64');
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{clearTimeout(timer);combined.removeEventListener('abort',abort);if(!complete){controller.abort();void Promise.resolve(iterator?.return?.()).catch(()=>{});}resource?.close();}
 }
 async function receipt(value,stored,id,{signal,deferResult=false}={}){
  if(value.id!==stored.taskId||value.model!==stored.model)throw fail('Mureka 查询回执任务或型号与原任务不一致','provider_identity_mismatch');
  if(!['preparing','queued','running','streaming','succeeded','failed','timeouted','cancelled'].includes(value.status)||Object.hasOwn(value,'error'))throw unknown();
  if(value.status!=='succeeded'&&value.choices!==undefined&&(!Array.isArray(value.choices)||value.choices.length))throw unknown();
  if(['failed','timeouted','cancelled'].includes(value.status))return {id,status:value.status==='cancelled'?'cancelled':'failed',code:'provider_'+value.status,error:'Mureka 未完成歌曲生成'};
  if(value.status!=='succeeded')return {id,status:['preparing','queued'].includes(value.status)?'queued':'running'};
  // Persist a known task identity before fetching media. Even an immediate
  // success POST receipt must not lose recovery when its CDN download fails.
  if(deferResult)return {id,status:'running'};
  // n=1 must yield exactly one stable choice; never silently select from a
  // supplier's larger, billable batch or accept a streaming preview as final.
  const choices=value.choices;if(!Array.isArray(choices)||choices.length!==1)throw unknown();const song=choices[0];
  if(!object(song)||song.index!==0||!validId(song.id)||!Number.isSafeInteger(song.duration)||song.duration<=0||song.duration>86400000)throw unknown();
  let url;try{const parsed=publicMediaUrl(song.url);if(parsed.protocol!=='https:')throw Error();url=parsed.href;}catch{throw unknown();}
  // duration is provider metadata in milliseconds, not measured decoding.
  // Complete protected bytes go to the shared local materializer; it will not
  // perform a second CDN download or persist an unchecked binary response.
  return {id,status:'succeeded',outputs:[{type:'audio',url:await audio(url,signal),sourceFileId:song.id,duration:song.duration/1000}]};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  const value=await read(prepared.path,'POST',prepared.body,signal);
  if(!validId(value.id))throw unknown();const id=envelope(prepared.model,prepared.mode,value.id);
  return receipt(value,{model:prepared.model,mode:prepared.mode,taskId:value.id},id,{signal,deferResult:true});
 }
 async function poll(id,{signal}={}){const stored=identity(id);return receipt(await read('v1/song/query/'+encodeURIComponent(stored.taskId),'GET',undefined,signal),stored,id,{signal});}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw fail('Mureka 轮询预算无效');
  const timed=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timed]):timed;
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    // The official song schema has no numeric progress; report no invented
    // percentage while waiting for the original task.
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw fail('Mureka 未完成歌曲生成',value.status==='cancelled'?'cancelled':'provider_failed');return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate,isConfigured:()=>configured,isPollable:()=>true};
}
module.exports={createMurekaProvider,parseMurekaModelMap,DEFAULT_MUREKA_MODEL_MAP,MAX_JSON_BYTES,MAX_AUDIO_BYTES};
