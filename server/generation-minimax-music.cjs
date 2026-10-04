'use strict';
const {createHash}=require('node:crypto');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {validateMP3,waveMetadata}=require('./generation-openai-speech.cjs');
const MAX_AUDIO_BYTES=50*1024*1024,MAX_JSON_BYTES=2*MAX_AUDIO_BYTES+65536;
const DEFAULT_MINIMAX_MUSIC_MODEL_MAP=Object.freeze({'music-2.6':Object.freeze({kind:'audio.generate',model:'music-2.6'})});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('MiniMax 音乐生成状态未确认；未自动重试或重新提交','unknown');
function audioSetting(value={}){
 if(!object(value)||Object.keys(value).some(key=>!['format','sampleRate','bitrate'].includes(key)))throw fail('MiniMax 音频输出配置无效','configuration_invalid');
 const format=value.format??'mp3',sampleRate=value.sampleRate??44100;
 if(!['mp3','wav'].includes(format)||![16000,24000,32000,44100].includes(sampleRate))throw fail('本批只支持官方 MP3/WAV 与已核实采样率','configuration_invalid');
 if(format==='wav'){if(value.bitrate!==undefined)throw fail('WAV 没有压缩码率参数，未忽略配置','configuration_invalid');return {format,sampleRate};}
 const bitrate=value.bitrate??128000;
 if(![32000,64000,128000,256000].includes(bitrate)||sampleRate<32000&&bitrate===256000)throw fail('MP3 码率配置无效或无法表示','configuration_invalid');
 return {format,sampleRate,bitrate};
}
function parseMiniMaxMusicModelMap(value){
 const map=value===undefined?DEFAULT_MINIMAX_MUSIC_MODEL_MAP:typeof value==='string'?JSON.parse(value):value;
 if(!object(map)||Object.keys(map).length>20)throw fail('MiniMax 音乐模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!/^[-\w.]{1,128}$/.test(alias)||!object(entry)||entry.kind!=='audio.generate'||entry.model!=='music-2.6'||Object.keys(entry).some(key=>!['kind','model','audioSetting'].includes(key)))throw fail('仅支持明确映射到 music-2.6 的音乐模型','configuration_invalid');
  audioSetting(entry.audioSetting);
 }
 return structuredClone(map);
}
function mp3Metadata(bytes,expected){
 validateMP3(bytes);let offset=0,end=bytes.length;
 if(bytes.toString('ascii',0,3)==='ID3')offset=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9]+((bytes[5]&16)?10:0);
 if(end>=128&&bytes.toString('ascii',end-128,end-125)==='TAG')end-=128;
 while(offset<end){const header=bytes.readUInt32BE(offset),version=(header>>>19)&3,index=(header>>>12)&15,rate=[44100,48000,32000][(header>>>10)&3]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index]*1000;
  if(rate!==expected.sampleRate||bitrate!==expected.bitrate)throw unknown();offset+=Math.floor((version===3?144:72)*bitrate/rate)+((header>>>9)&1);
 }
 return {sampleRate:expected.sampleRate};
}
function createMiniMaxMusicProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,timeoutMs=600000}={}){
 let mapping={},origin='',configurationError=null;
 try{
  mapping=parseMiniMaxMusicModelMap(modelMap);origin=endpoint(baseUrl||'https://api.minimax.io');const url=new URL(origin);
  if(url.pathname!=='/'||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();
  assertCredentialFree(origin,apiKey);assertCredentialFree(mapping,apiKey);
 }catch{configurationError='configuration_invalid';origin='';mapping={};}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'minimax-music-native',origin,mapping})).digest('hex');
 const music=Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{scene:'Music',lyricsModes:['auto','custom','instrumental'],maxPromptCharacters:2000,maxLyricsCharacters:3500,maxCount:1,maxAudioBytes:MAX_AUDIO_BYTES,audioSetting:audioSetting(entry.audioSetting)}]));
 const metadata={configured,protocol:'minimax-music-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'audio.generate'}])),music,references:false,textReferences:true,remoteRecovery:false,remoteCancellation:false,accountEligibility:'existing-paid-music-api-user',verified:'official-schema-and-local-contract'}};
 const transport=protectGenerationFetch(fetchImpl);
 function resolve(request){
  if(!configured)throw fail('MiniMax 原生音乐尚未配置，请检查 Key、模型映射与账号音乐 API 资格','configuration_required');
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>1024*1024)throw fail('MiniMax 音乐仅支持有界 audio.generate 请求');
  assertCredentialFree(request,apiKey);
  const p=request.parameters??{};if(!object(p))throw fail('MiniMax 音乐参数须为对象');
  const allowed=new Set(['model','modelId','virtualModel','scene','lyric_mode','force_instrumental','lyrics','format','sample_rate','bitrate','count','times']);
  if(Object.keys(p).some(key=>!allowed.has(key)))throw fail('MiniMax 音乐含未支持参数；未忽略或派发');
  const alias=p.modelId??p.model;if(typeof alias!=='string'||!Object.hasOwn(mapping,alias))throw fail('此模型未配置 MiniMax 原生音乐','configuration_required');
  if(p.model!==undefined&&p.model!==alias||p.modelId!==undefined&&p.modelId!==alias||p.virtualModel!==undefined&&p.virtualModel!=='minimax-music-26')throw fail('MiniMax 音乐模型标识不一致');
  if(p.scene!=='Music')throw fail('MiniMax Music 2.6 只支持 Music 场景');
  for(const count of [request.count,p.count,p.times])if(count!==undefined&&count!==1)throw fail('MiniMax 原生音乐每次只生成一个音频结果');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('MiniMax Music 2.6 不接受未展开参考');
  const inputs=request.inputs??[];if(!Array.isArray(inputs)||inputs.length>30||inputs.some(input=>!object(input)||input.type!=='text'||typeof input.text!=='string'||!input.text.trim()))throw fail('MiniMax Music 2.6 只接受文字参考，不支持 cover/图片/音频');
  if(typeof request.prompt!=='string')throw fail('请输入音乐描述');
  const prefix=inputs.map(input=>input.text).join('\n');let prompt=request.prompt;if(prefix&&prompt!==prefix&&!prompt.startsWith(prefix+'\n'))prompt=prefix+(prompt?'\n'+prompt:'');if(prompt.length>2000)throw fail('MiniMax 音乐描述最多 2000 字符，未截断或提交');
  if(p.lyric_mode!==undefined&&typeof p.lyric_mode!=='boolean'||p.force_instrumental!==undefined&&typeof p.force_instrumental!=='boolean'||p.lyrics!==undefined&&typeof p.lyrics!=='string')throw fail('MiniMax 歌词参数类型无效');
  const custom=p.lyric_mode??false,instrumental=p.force_instrumental??false,lyrics=p.lyrics??'';
  if(instrumental&&custom||!custom&&lyrics.trim())throw fail('歌词模式与歌词内容冲突，未忽略用户输入');
  if(custom?(!lyrics.trim()||lyrics.length>3500):!prompt.trim())throw fail(custom?'自定义歌词须为 1–3500 字符':'自动歌词或纯音乐须提供音乐描述');
  const setting=audioSetting(mapping[alias].audioSetting);
  if(p.format!==undefined&&p.format!==setting.format||p.sample_rate!==undefined&&p.sample_rate!==setting.sampleRate||p.bitrate!==undefined&&p.bitrate!==setting.bitrate)throw fail('请求音频格式、采样率或码率与服务端配置不一致');
  return {setting,body:{model:'music-2.6',prompt,stream:false,output_format:'hex',audio_setting:{format:setting.format,sample_rate:setting.sampleRate,...(setting.bitrate!==undefined?{bitrate:setting.bitrate}:{})},lyrics_optimizer:!custom&&!instrumental,is_instrumental:instrumental,...(custom?{lyrics}:{})}};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let reader,response,completed=false;
  const timer=setTimeout(()=>controller.abort(unknown()),timeoutMs),check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});});const pending=Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;});try{return await Promise.race([pending,stopped]);}finally{combined.removeEventListener('abort',abort);}}
  try{
   response=await wait(()=>transport(new URL('v1/music_generation',origin),{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity'},body:JSON.stringify(prepared.body),signal:combined}),late=>late.body?.cancel());
   if(response.status!==200||!response.ok||response.redirected||!response.body)throw unknown();
   const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),encoding=response.headers.get('content-encoding'),length=response.headers.get('content-length');
   if(contentType!=='application/json'||encoding&&encoding!=='identity'||length!==null&&(!/^\d{1,12}$/.test(length)||!Number(length)||Number(length)>MAX_JSON_BYTES))throw unknown();
   reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const next=await wait(()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_JSON_BYTES)throw unknown();chunks.push(Buffer.from(next.value));}
   check();if(!size||length!==null&&Number(length)!==size)throw unknown();
   const raw=Buffer.concat(chunks).toString('utf8');assertCredentialFree(raw,apiKey);const value=JSON.parse(raw);assertCredentialFree(value,apiKey);
   if(!object(value)||!object(value.base_resp)||!Number.isSafeInteger(value.base_resp.status_code))throw unknown();
   if(value.base_resp.status_code!==0){check();completed=true;return {status:'failed',code:'provider_rejected',error:'MiniMax 音乐 API 明确拒绝请求；请检查账号权限、额度和参数'};}
   const hex=value.data?.audio;if(value.data?.status!==2||typeof hex!=='string'||!hex.length||hex.length%2||hex.length>MAX_AUDIO_BYTES*2||!/^[0-9a-f]+$/i.test(hex))throw unknown();
   const bytes=Buffer.from(hex,'hex');assertCredentialFreeBytes(bytes,apiKey);const info=prepared.setting.format==='wav'?waveMetadata(bytes):mp3Metadata(bytes,prepared.setting);
   if(info.sampleRate!==prepared.setting.sampleRate||value.extra_info?.music_size!==undefined&&value.extra_info.music_size!==bytes.length||value.extra_info?.music_sample_rate!==undefined&&value.extra_info.music_sample_rate!==info.sampleRate)throw unknown();
   check();completed=true;return {status:'succeeded',outputs:[{type:'audio',url:'data:'+(prepared.setting.format==='wav'?'audio/wav':'audio/mpeg')+';base64,'+bytes.toString('base64'),...(info.duration?{duration:info.duration}:{})}]};
  }catch(error){if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{clearTimeout(timer);if(!completed){controller.abort();if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createMiniMaxMusicProvider,parseMiniMaxMusicModelMap,DEFAULT_MINIMAX_MUSIC_MODEL_MAP,MAX_AUDIO_BYTES,MAX_JSON_BYTES};
