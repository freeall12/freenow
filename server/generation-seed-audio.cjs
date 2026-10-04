'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {endpoint,protectGenerationFetch,assertIndependentMediaInputs}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');
const {inlineImage}=require('./generation-image-input.cjs');
const {waveMetadata,validateMP3}=require('./generation-openai-speech.cjs');
const {checkedAudioSubtitle}=require('./generation-audio-subtitle.cjs');
const {publicMediaUrl}=require('./generation-media-download.cjs');
const MAX_AUDIO_BYTES=32*1024*1024,MAX_JSON_BYTES=48*1024*1024,MAX_REFERENCE_BYTES=10*1024*1024;
const DEFAULT_SEED_AUDIO_MODEL_MAP=Object.freeze({'doubao-seed-audio-1-0':Object.freeze({kind:'audio.generate',model:'seed-audio-1.0'})});
const object=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('Seed Audio 生成状态未确认；未自动重试或重新提交','unknown');
const rates={wav:[8000,16000,24000,32000,40000,44100,48000],mp3:[8000,16000,24000,32000,44100,48000],ogg_opus:[48000]};
const mime={wav:'audio/wav',mp3:'audio/mpeg',ogg_opus:'audio/ogg'};
function base64(value,max){
 if(typeof value!=='string'||!value||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw unknown();
 const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>max||bytes.toString('base64')!==value)throw unknown();return bytes;
}
function mp3Metadata(bytes){
 validateMP3(bytes);let offset=0,end=bytes.length,duration=0,sampleRate;
 if(bytes.toString('ascii',0,3)==='ID3')offset=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9]+((bytes[5]&16)?10:0);
 if(end>=128&&bytes.toString('ascii',end-128,end-125)==='TAG')end-=128;
 while(offset<end){const h=bytes.readUInt32BE(offset),v=(h>>>19)&3,index=(h>>>12)&15,rate=[44100,48000,32000][(h>>>10)&3]/(v===3?1:v===2?2:4),bitrate=(v===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index];if(sampleRate!==undefined&&sampleRate!==rate)throw unknown();sampleRate=rate;duration+=(v===3?1152:576)/rate;offset+=Math.floor((v===3?144:72)*bitrate*1000/rate)+((h>>>9)&1);}
 return {sampleRate,duration};
}
// Ogg pages have a CRC and an exact lacing table. Do not accept OggS alone as
// Opus, or trust caller duration metadata for a chargeable audio reference.
function oggOpusMetadata(bytes){
 let offset=0,serial,sequence=0,packets=0,pending=[],pendingSize=0,preSkip=0,lastGranule=0n,ended=false,audioPackets=0,decodedSamples=0,lastPacketSamples=0;
 while(offset<bytes.length){
  if(ended||offset+27>bytes.length||bytes.toString('ascii',offset,offset+4)!=='OggS'||bytes[offset+4]!==0)throw unknown();
  const flags=bytes[offset+5],segments=bytes[offset+26],tableEnd=offset+27+segments;if(flags&~7||tableEnd>bytes.length)throw unknown();
  const sizes=bytes.subarray(offset+27,tableEnd),size=[...sizes].reduce((a,b)=>a+b,0),end=tableEnd+size;if(end>bytes.length)throw unknown();
  const page=bytes.subarray(offset,end),expected=page.readUInt32LE(22);let crc=0;
  for(let i=0;i<page.length;i++){crc^=(i>=22&&i<26?0:page[i])<<24;for(let b=0;b<8;b++)crc=(crc&0x80000000)?(crc<<1)^0x04c11db7:crc<<1;}
  if((crc>>>0)!==expected||page.readUInt32LE(18)!==sequence++||(flags&1)!==(pendingSize?1:0))throw unknown();
  const pageSerial=page.readUInt32LE(14);if(serial===undefined){serial=pageSerial;if(!(flags&2)||flags&1)throw unknown();}else if(serial!==pageSerial||flags&2)throw unknown();
  let cursor=tableEnd;
  for(const length of sizes){pending.push(bytes.subarray(cursor,cursor+length));pendingSize+=length;cursor+=length;if(pendingSize>1024*1024)throw unknown();if(length===255)continue;const packet=Buffer.concat(pending);pending=[];pendingSize=0;
   if(packets===0){if(packet.length!==19||packet.toString('ascii',0,8)!=='OpusHead'||packet[8]!==1||![1,2].includes(packet[9])||packet[18]!==0)throw unknown();preSkip=packet.readUInt16LE(10);}
   else if(packets===1){if(packet.length<16||packet.toString('ascii',0,8)!=='OpusTags')throw unknown();let p=12+packet.readUInt32LE(8);if(p+4>packet.length)throw unknown();const count=packet.readUInt32LE(p);p+=4;if(count>10000)throw unknown();for(let i=0;i<count;i++){if(p+4>packet.length)throw unknown();const n=packet.readUInt32LE(p);p+=4+n;if(p>packet.length)throw unknown();}}
   else {if(!packet.length)throw unknown();const config=packet[0]>>>3,code=packet[0]&3,frames=code===0?1:code===3?(packet[1]||0)&63:2,frameMs=config<12?[10,20,40,60][config&3]:config<16?[10,20][config&1]:[2.5,5,10,20][config&3];if(!frames||frames*frameMs>120||code&&packet.length<2||code===1&&(packet.length-1)%2)throw unknown();lastPacketSamples=frames*frameMs*48;decodedSamples+=lastPacketSamples;audioPackets++;}
   packets++;
  }
  const granule=page.readBigUInt64LE(6);if(granule!==0xffffffffffffffffn){if(granule<lastGranule||granule>BigInt(48000*600))throw unknown();lastGranule=granule;}
  if(flags&4){if(pendingSize||!audioPackets||granule===0xffffffffffffffffn||granule<=BigInt(preSkip)||granule>BigInt(decodedSamples)||granule<BigInt(decodedSamples-lastPacketSamples))throw unknown();ended=true;}
  offset=end;
 }
 if(!ended||packets<3)throw unknown();return {sampleRate:48000,duration:Number(lastGranule-BigInt(preSkip))/48000};
}
function audioMetadata(bytes,format){return format==='wav'?waveMetadata(bytes):format==='mp3'?mp3Metadata(bytes):oggOpusMetadata(bytes);}
function parseSeedAudioModelMap(value){
 const mapping=value===undefined?DEFAULT_SEED_AUDIO_MODEL_MAP:typeof value==='string'?JSON.parse(value):value;
 if(!object(mapping)||Object.keys(mapping).length>20)throw fail('Seed Audio 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(mapping))if(!/^[-\w.]{1,128}$/.test(alias)||!object(entry)||Object.keys(entry).some(key=>!['kind','model'].includes(key))||entry.kind!=='audio.generate'||entry.model!=='seed-audio-1.0')throw fail('Seed Audio 仅支持已核实的 seed-audio-1.0','configuration_invalid');
 return structuredClone(mapping);
}
function createSeedAudioProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,timeoutMs=180000}={}){
 let mapping={},origin='',configurationError=null;
 try{mapping=parseSeedAudioModelMap(modelMap);origin=endpoint(baseUrl||'https://openspeech.bytedance.com');if(new URL(origin).pathname!=='/'||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();assertCredentialFree(origin,apiKey);assertCredentialFree(mapping,apiKey);}catch{configurationError='configuration_invalid';mapping={};origin='';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'seed-audio-native',origin,mapping})).digest('hex');
 const seedAudio=Object.fromEntries(Object.entries(mapping).map(([alias])=>[alias,{scene:'Text-to-Speech',model:'seed-audio-1.0',formats:Object.keys(rates),sampleRates:structuredClone(rates),defaultSampleRates:{wav:40000,mp3:44100,ogg_opus:48000},speechRate:{min:-50,max:100},loudnessRate:{min:-50,max:100},pitchRate:{min:-12,max:12},subtitle:'provider-text',maxCharacters:3000,maxCount:1,maxImages:1,maxAudios:3,mixedReferences:false,referenceTransport:'inline-or-public-https',remoteReferenceValidation:'provider',referenceFormats:{image:['image/png','image/jpeg','image/webp'],audio:['audio/wav','audio/x-wav','audio/wave','audio/mpeg','audio/mp3','audio/ogg']},minReferenceImageBytes:1024,maxReferenceBytes:MAX_REFERENCE_BYTES,maxReferenceAudioSeconds:30,maxOriginalDuration:120}]));
 const metadata={configured,protocol:'seed-audio-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['audio.generate']:[],models:Object.fromEntries(Object.entries(mapping).map(([alias])=>[alias,{kind:'audio.generate'}])),seedAudio,references:true,textReferences:true,remoteRecovery:false,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 const transport=protectGenerationFetch(fetchImpl);
 function resolve(request){
  if(!configured)throw fail('Seed Audio 原生接口尚未配置，请检查服务端 API Key、地址与模型映射','configuration_required');
  if(!object(request)||request.kind!=='audio.generate'||Buffer.byteLength(JSON.stringify(request))>MAX_JSON_BYTES)throw fail('Seed Audio 仅支持有界的音频生成请求');assertCredentialFree(request,apiKey);assertIndependentMediaInputs(request);
  const p=request.parameters??{};if(!object(p))throw fail('Seed Audio 参数须为对象');
  const allowed=new Set(['model','modelId','virtualModel','scene','format','response_format','sample_rate','speech_rate','pitch_rate','loudness_rate','enable_subtitle','count','times']);if(Object.keys(p).some(key=>!allowed.has(key)))throw fail('请求包含 Seed Audio 尚未支持的参数；未提交模型');
  const alias=p.modelId??p.model;if(typeof alias!=='string'||!Object.hasOwn(mapping,alias))throw fail('此模型尚未配置 Seed Audio 原生接口','configuration_required');
  if(p.model!==undefined&&p.model!==alias||p.modelId!==undefined&&p.modelId!==alias||p.virtualModel!==undefined&&p.virtualModel!=='seed-audio-1-0')throw fail('Seed Audio 模型标识不一致');if(p.scene!=='Text-to-Speech')throw fail('Seed Audio 此原生入口仅绑定文字转语音场景');
  for(const count of [request.count,p.count,p.times])if(count!==undefined&&count!==1)throw fail('Seed Audio 每个任务只生成一个音频结果');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('Seed Audio 不接受未展开参考素材');
  const inputs=request.inputs??[];if(!Array.isArray(inputs)||inputs.length>30||inputs.some(input=>!object(input)||!['text','image','audio'].includes(input.type)))throw fail('Seed Audio 只接受文字、图片或音频参考');
  if(typeof request.prompt!=='string')throw fail('请输入 Seed Audio 生成内容');const textInputs=inputs.filter(input=>input.type==='text');if(textInputs.some(input=>typeof input.text!=='string'||!input.text.trim()))throw fail('Seed Audio 文字参考无效');
  const prefix=textInputs.map(input=>input.text).join('\n');let text=request.prompt;if(prefix&&text!==prefix&&!text.startsWith(prefix+'\n'))text=prefix+(text?'\n'+text:'');if(!text.trim()||text.length>3000)throw fail('Seed Audio 提示词须为 1–3000 字符');
  const images=inputs.filter(input=>input.type==='image'),audios=inputs.filter(input=>input.type==='audio');if(images.length>1||audios.length>3||images.length&&audios.length)throw fail('Seed Audio 支持一张图片或最多三条音频参考，不能混用');
  const references=[];
  for(const [index,input]of inputs.filter(input=>input.type!=='text').entries()){
   if(['clip','trim','sourceClip'].some(key=>input[key]!=null))throw fail('Seed Audio 参考选区须先物化为实际媒体，未提交完整源素材');
   if(typeof input.url==='string'&&input.url.startsWith('https://')){try{publicMediaUrl(input.url);}catch{throw fail('Seed Audio 远端参考须为独立的公网 HTTPS 地址');}if(input.url.length>8192)throw fail('Seed Audio 远端参考地址过长');references.push({[input.type==='image'?'image_url':'audio_url']:input.url});continue;}
   if(input.type==='image'){const value=inlineImage(input,index);if(value.bytes.length<1024||value.bytes.length>MAX_REFERENCE_BYTES)throw fail('Seed Audio 参考图片须为 1 KB–10 MB');assertCredentialFreeBytes(value.bytes,apiKey);references.push({image_data:value.bytes.toString('base64')});}
   else {const match=typeof input.url==='string'&&/^data:(audio\/(?:wav|x-wav|wave|mpeg|mp3|ogg));base64,(.+)$/.exec(input.url);if(!match)throw fail('Seed Audio 音频参考须为公网 HTTPS 或内联 WAV、MP3、Ogg Opus');let bytes,info;try{bytes=base64(match[2],MAX_REFERENCE_BYTES);info=audioMetadata(bytes,/wav|wave/.test(match[1])?'wav':/mpeg|mp3/.test(match[1])?'mp3':'ogg_opus');}catch{throw fail('Seed Audio 音频参考格式、完整性或大小无效');}if(info.duration>30)throw fail('Seed Audio 每条音频参考不得超过 30 秒');assertCredentialFreeBytes(bytes,apiKey);references.push({audio_data:bytes.toString('base64')});}
  }
  for(const match of text.matchAll(/@音频(\d+)/g))if(!audios.length||Number(match[1])<1||Number(match[1])>audios.length)throw fail('Seed Audio 音频编号未绑定到对应参考素材');
  const format=p.format??p.response_format??'wav';if(p.format!==undefined&&p.response_format!==undefined&&p.format!==p.response_format||!Object.hasOwn(rates,format))throw fail('Seed Audio 输出格式无效');
  const sampleRate=p.sample_rate??(format==='wav'?40000:format==='mp3'?44100:48000);if(!rates[format].includes(sampleRate))throw fail(format==='ogg_opus'?'Seed Audio Ogg Opus 仅支持 48000 Hz；请修改采样率后提交':'Seed Audio 当前格式不支持所选采样率');
  const config={format,sample_rate:sampleRate};for(const [field,min,max]of [['speech_rate',-50,100],['loudness_rate',-50,100],['pitch_rate',-12,12]]){const value=p[field]??0;if(!Number.isInteger(value)||value<min||value>max)throw fail('Seed Audio 语速、音量或音调超出支持范围');config[field]=value;}
  const subtitle=p.enable_subtitle??false;if(typeof subtitle!=='boolean')throw fail('Seed Audio 字幕开关须为布尔值');config.enable_subtitle=subtitle;
  return {format,sampleRate,subtitle,body:{model:mapping[alias].model,text_prompt:text,...(references.length?{references}:{}),audio_config:config}};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let response,reader,completed=false;const timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  const check=()=>{if(combined.aborted)throw combined.reason||unknown();};
  async function wait(operation,disposeLate){check();let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(combined.reason||unknown());combined.addEventListener('abort',abort,{once:true});});const pending=Promise.resolve().then(()=>{check();return operation();}).then(value=>{if(combined.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});check();}return value;});try{return await Promise.race([pending,stopped]);}finally{combined.removeEventListener('abort',abort);}}
  try{
   response=await wait(()=>transport(new URL('/api/v3/tts/create',origin),{method:'POST',headers:{'X-Api-Key':apiKey,'X-Api-Request-Id':randomUUID(),'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity'},body:JSON.stringify(prepared.body),signal:combined}),late=>late.body?.cancel());
   if(response.redirected||!response.body)throw unknown();const encoding=response.headers.get('content-encoding'),contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers.get('content-length');if(encoding&&encoding!=='identity'||contentType!=='application/json'||length!==null&&(!/^\d{1,12}$/.test(length)||!Number(length)||Number(length)>MAX_JSON_BYTES))throw unknown();
   reader=response.body.getReader();const chunks=[];let size=0;for(;;){const next=await wait(()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array))throw unknown();size+=next.value.byteLength;if(size>MAX_JSON_BYTES)throw unknown();chunks.push(Buffer.from(next.value));}check();if(!size||length!==null&&Number(length)!==size)throw unknown();const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!object(receipt))throw unknown();assertCredentialFree(receipt,apiKey);
   // Official error document says code/message are optional and returned on
   // non-200 failures. Do not invent a success-code convention from TTS APIs.
   if(response.status!==200||!response.ok){if(Number.isInteger(receipt.code)&&/^[45]\d{7}$/.test(String(receipt.code))){completed=true;return {status:'failed',code:'provider_rejected',error:'Seed Audio 供应商拒绝了此次请求'};}throw unknown();}
   if(receipt.code!==undefined)throw unknown();const bytes=base64(receipt.audio,MAX_AUDIO_BYTES),info=audioMetadata(bytes,prepared.format);if(info.sampleRate!==prepared.sampleRate)throw unknown();assertCredentialFreeBytes(bytes,apiKey);
   for(const field of ['duration','original_duration'])if(receipt[field]!==undefined&&(!Number.isFinite(receipt[field])||receipt[field]<=0||receipt[field]>(field==='original_duration'?120:240)))throw unknown();if(info.duration>240)throw unknown();
   let subtitle;if(prepared.subtitle){if(!object(receipt.subtitle)||typeof receipt.subtitle.text!=='string')throw unknown();subtitle=checkedAudioSubtitle({type:'audio',subtitle:{text:receipt.subtitle.text}},{code:'unknown'});}else if(receipt.subtitle!==undefined)throw unknown();check();completed=true;
   return {status:'succeeded',outputs:[{type:'audio',url:'data:'+mime[prepared.format]+';base64,'+bytes.toString('base64'),duration:info.duration,...(subtitle?{subtitle}:{})}]};
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{clearTimeout(timer);if(!completed){controller.abort();if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createSeedAudioProvider,parseSeedAudioModelMap,DEFAULT_SEED_AUDIO_MODEL_MAP,MAX_AUDIO_BYTES,MAX_JSON_BYTES,mp3Metadata,oggOpusMetadata};
