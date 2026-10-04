'use strict';
const {createHash}=require('node:crypto');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {validateMP3}=require('./generation-openai-speech.cjs');
const MAX_AUDIO_BYTES=32*1024*1024,MAX_TEXT_CHARACTERS=4100;
const DEFAULT_ELEVENLABS_MUSIC_MODEL_MAP=Object.freeze({music_v1:Object.freeze({kind:'audio.generate',model:'music_v1'})});
const OUTPUT_FORMAT='mp3_44100_128',MIME='audio/mpeg';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('ElevenLabs 音乐生成状态未确认；未自动重试或重新提交','unknown');
function validateOutput(bytes){
 validateMP3(bytes);let offset=0,end=bytes.length;
 if(bytes.toString('ascii',0,3)==='ID3')offset=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9]+((bytes[5]&16)?10:0);
 if(end>=128&&bytes.toString('ascii',end-128,end-125)==='TAG')end-=128;
 while(offset<end){const header=bytes.readUInt32BE(offset),version=(header>>>19)&3,index=(header>>>12)&15,rateIndex=(header>>>10)&3,rate=[44100,48000,32000][rateIndex]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index];if(rate!==44100||bitrate!==128)throw unknown();offset+=Math.floor((version===3?144:72)*bitrate*1000/rate)+((header>>>9)&1);}
}
function parseElevenLabsMusicModelMap(value){
 const mapping=value===undefined?DEFAULT_ELEVENLABS_MUSIC_MODEL_MAP:typeof value==='string'?JSON.parse(value):value;
 if(!object(mapping)||Object.keys(mapping).length>20)throw fail('ElevenLabs 音乐模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(mapping))if(!/^[-\w]{1,128}$/.test(alias)||!object(entry)||Object.keys(entry).some(key=>!['kind','model','outputFormat'].includes(key))||entry.kind!=='audio.generate'||entry.model!=='music_v1'||entry.outputFormat!==undefined&&entry.outputFormat!==OUTPUT_FORMAT)throw fail('ElevenLabs 音乐仅支持已核实的 music_v1 与 MP3 44.1 kHz 128 kbps','configuration_invalid');
 return structuredClone(mapping);
}
function createElevenLabsMusicProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,timeoutMs=600000}={}){
 let mapping={},origin='',configurationError=null;
 try{
  mapping=parseElevenLabsMusicModelMap(modelMap);origin=endpoint(baseUrl||'https://api.elevenlabs.io');const url=new URL(origin);if(url.pathname!=='/'||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();assertCredentialFree(origin,apiKey);assertCredentialFree(mapping,apiKey);
 }catch{configurationError='configuration_invalid';mapping={};origin='';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'elevenlabs-music-native',origin,mapping})).digest('hex');
 const music=Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{scene:'Music',duration:{min:3,max:600,automatic:true},lyricsModes:['auto','custom','instrumental'],customLyrics:{duration:{min:3,max:120,automatic:false},maxLines:30,maxLineCharacters:200,maxCharacters:12000,plan:'single-section'},formats:['mp3'],outputFormat:OUTPUT_FORMAT,maxPromptCharacters:MAX_TEXT_CHARACTERS,maxCount:1,maxAudioBytes:MAX_AUDIO_BYTES}]));
 const metadata={configured,protocol:'elevenlabs-music-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'audio.generate'}])),music,references:false,textReferences:true,remoteRecovery:false,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 const transport=protectGenerationFetch(fetchImpl);
 function resolve(request){
  if(!configured)throw fail('ElevenLabs 原生音乐尚未配置，请检查服务端 Key、地址与模型映射','configuration_required');
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>1024*1024)throw fail('ElevenLabs 原生音乐仅支持有界的音频生成请求');
  assertCredentialFree(request,apiKey);
  const p=request.parameters??{};if(!object(p))throw fail('ElevenLabs 音乐参数须为对象');
  const allowed=new Set(['model','modelId','virtualModel','scene','music_length_ms','lyric_mode','force_instrumental','lyrics','format','response_format','sample_rate','count','times']);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw fail('请求包含 ElevenLabs Music 尚未支持的参数；未提交模型');
  const alias=p.modelId??p.model;if(typeof alias!=='string'||!Object.hasOwn(mapping,alias))throw fail('此模型尚未配置 ElevenLabs 原生音乐','configuration_required');
  if(p.model!==undefined&&p.model!==alias||p.modelId!==undefined&&p.modelId!==alias)throw fail('ElevenLabs 音乐模型标识不一致');
  if(p.virtualModel!==undefined&&p.virtualModel!=='elevenlabs-v3')throw fail('ElevenLabs 音乐虚拟模型不匹配');
  if(p.scene!=='Music')throw fail('此 ElevenLabs 原生接口只支持音乐；语音/音效未提交');
  for(const count of [request.count,p.count,p.times])if(count!==undefined&&count!==1)throw fail('ElevenLabs 音乐每个任务只生成一个结果');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('ElevenLabs 音乐不接受未展开参考素材');
  const inputs=request.inputs??[];if(!Array.isArray(inputs)||inputs.length>30||inputs.some(input=>!object(input)||input.type!=='text'||typeof input.text!=='string'||!input.text.trim()))throw fail('ElevenLabs Music 只接受文字参考，不接受图片、音频或视频');
  if(typeof request.prompt!=='string')throw fail('请输入需要生成的音乐描述');
  const prefix=inputs.map(input=>input.text).join('\n');let prompt=request.prompt;if(prefix&&prompt!==prefix&&!prompt.startsWith(prefix+'\n'))prompt=prefix+(prompt?'\n'+prompt:'');if(!prompt.trim()||Array.from(prompt).length>MAX_TEXT_CHARACTERS)throw fail('ElevenLabs Music 描述须为 1–4100 字符；未截断或提交');
  const duration=p.music_length_ms;if(duration!=null&&(!Number.isInteger(duration)||duration<3000||duration>600000))throw fail('ElevenLabs Music 时长须为 3000–600000 整数毫秒或自动；未舍入或提交');
  if(p.lyric_mode!==undefined&&typeof p.lyric_mode!=='boolean'||p.force_instrumental!==undefined&&typeof p.force_instrumental!=='boolean'||p.lyrics!==undefined&&typeof p.lyrics!=='string')throw fail('ElevenLabs Music 歌词参数类型无效');
  const custom=p.lyric_mode??false,instrumental=p.force_instrumental??false,lyrics=p.lyrics??'';
  if(custom&&instrumental||!custom&&lyrics.trim())throw fail('ElevenLabs Music 歌词模式与歌词内容冲突，未忽略用户输入');
  if([p.format,p.response_format].some(value=>value!==undefined&&value!=='mp3')||p.sample_rate!==undefined&&p.sample_rate!==44100)throw fail('请求音频格式/采样率与已核实的 MP3 配置不一致；未转码或提交');
  if(!custom)return {body:{prompt,model_id:mapping[alias].model,force_instrumental:instrumental,...(duration!=null?{music_length_ms:duration}:{})}};
  // Public SDK exposes lyrics through a composition plan, not lyrics_text.
  // A bounded single section preserves submitted lines and explicit duration;
  // auto duration or inferred musical sections would invent user decisions.
  const lines=lyrics.split(/\r\n|\n|\r/);
  if(!lyrics.trim()||Array.from(lyrics).length>12000||lines.length>30||lines.some(line=>Array.from(line).length>200))throw fail('自定义歌词须非空、最多 30 行且每行不超过 200 字符；未拆行或截断');
  if(duration==null||duration>120000)throw fail('ElevenLabs Music 自定义歌词须指定 3–120 秒时长；当前单节合同不支持自动或更长歌词编排');
  return {body:{model_id:mapping[alias].model,respect_sections_durations:true,composition_plan:{positive_global_styles:[prompt],negative_global_styles:[],sections:[{section_name:'Song',positive_local_styles:[],negative_local_styles:[],duration_ms:duration,lines}]}}};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let reader,response,completed=false,timer;
  timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});});const pending=Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;});try{return await Promise.race([pending,stopped]);}finally{combined.removeEventListener('abort',abort);}}
  try{
   const url=new URL('v1/music',origin);url.searchParams.set('output_format',OUTPUT_FORMAT);
   response=await wait(()=>transport(url,{method:'POST',headers:{'xi-api-key':apiKey,'Content-Type':'application/json',Accept:MIME,'Accept-Encoding':'identity'},body:JSON.stringify(prepared.body),signal:combined}),late=>late.body?.cancel());
   if(response.status!==200||!response.ok||response.redirected||!response.body)throw unknown();
   const encoding=response.headers.get('content-encoding'),contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers.get('content-length');
   if(encoding&&encoding!=='identity'||!['application/octet-stream',MIME,'audio/mp3'].includes(contentType)||length!==null&&(!/^\d{1,12}$/.test(length)||!Number(length)||Number(length)>MAX_AUDIO_BYTES))throw unknown();
   reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const next=await wait(()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_AUDIO_BYTES)throw unknown();chunks.push(Buffer.from(next.value));}
   check();if(!size||length!==null&&Number(length)!==size)throw unknown();const bytes=Buffer.concat(chunks);validateOutput(bytes);assertCredentialFreeBytes(bytes,apiKey);check();completed=true;
   // The synchronous endpoint supplies no recoverable remote task identity.
   // Only complete verified bytes may enter the existing local materializer.
   return {status:'succeeded',outputs:[{type:'audio',url:'data:'+MIME+';base64,'+bytes.toString('base64')}]};
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{clearTimeout(timer);if(!completed){controller.abort();if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createElevenLabsMusicProvider,parseElevenLabsMusicModelMap,DEFAULT_ELEVENLABS_MUSIC_MODEL_MAP,MAX_AUDIO_BYTES};
