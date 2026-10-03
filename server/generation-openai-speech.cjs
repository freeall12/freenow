'use strict';
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const voices=new Set(['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse','marin','cedar']);
const legacyVoices=new Set(['alloy','ash','coral','echo','fable','onyx','nova','sage','shimmer']);
const formats=new Set(['wav','mp3']);
const MAX_AUDIO_BYTES=32*1024*1024;
const supportedSpeed=value=>typeof value==='number'&&Number.isFinite(value)&&value>=.25&&value<=4;

function validateSpeechProfile(entry){
 if(!object(entry)||entry.kind!=='audio.generate'||entry.scene!=='Text-to-Speech'||typeof entry.model!=='string'||!entry.model.trim())throw fail('原生语音模型映射无效','configuration_invalid');
 const profileKeys=new Set(['kind','scene','model','maxCount','defaultVoice','voiceMap','formatMap','defaultFormat','speedMap','defaultSpeed','wavSampleRate']);
 if(Object.keys(entry).some(key=>!profileKeys.has(key)))throw fail('原生语音模型映射包含未支持的能力配置','configuration_invalid');
 if(entry.maxCount!==undefined&&entry.maxCount!==1)throw fail('原生语音仅支持单个结果','configuration_invalid');
 const acceptsVoice=voice=>voices.has(voice)&&(!['tts-1','tts-1-hd'].includes(entry.model)||legacyVoices.has(voice));
 if(entry.defaultVoice!==undefined&&!acceptsVoice(entry.defaultVoice))throw fail('原生语音默认音色无效','configuration_invalid');
 if(entry.voiceMap!==undefined&&(!object(entry.voiceMap)||Object.entries(entry.voiceMap).some(([key,value])=>!key.trim()||!acceptsVoice(value))))throw fail('原生语音音色映射无效','configuration_invalid');
 if(!entry.defaultVoice&&!Object.keys(entry.voiceMap||{}).length)throw fail('原生语音需要显式音色映射或默认音色','configuration_invalid');
 if(!object(entry.formatMap)||!Object.keys(entry.formatMap).length||Object.entries(entry.formatMap).some(([key,value])=>!formats.has(value)||key.toLowerCase()!==value))throw fail('原生语音格式映射无效','configuration_invalid');
 if(typeof entry.defaultFormat!=='string'||!Object.hasOwn(entry.formatMap,entry.defaultFormat))throw fail('原生语音默认格式尚未映射','configuration_invalid');
 if(entry.speedMap!==undefined&&(!object(entry.speedMap)||Object.entries(entry.speedMap).some(([key,value])=>!key.trim()||!Number.isFinite(Number(key))||!supportedSpeed(value)||Math.abs(value-(1+Number(key)/100))>1e-10)))throw fail('原生语音语速映射须保持百分比倍率含义','configuration_invalid');
 if(entry.defaultSpeed!==undefined&&!supportedSpeed(entry.defaultSpeed))throw fail('原生语音默认语速无效','configuration_invalid');
 if(entry.wavSampleRate!==undefined&&(!Number.isSafeInteger(entry.wavSampleRate)||entry.wavSampleRate<8000||entry.wavSampleRate>192000||!Object.values(entry.formatMap).includes('wav')))throw fail('原生语音 WAV 采样率约束无效','configuration_invalid');
 return structuredClone(entry);
}

function speechCapabilities(entry){
 const profile=validateSpeechProfile(entry);
 return {scene:'Text-to-Speech',voiceAliases:Object.keys(profile.voiceMap||{}),defaultVoiceConfigured:!!profile.defaultVoice,formats:Object.keys(profile.formatMap),speechRates:Object.keys(profile.speedMap||{}),maxCount:1,maxInputChars:4096,mediaReferences:false,customVoices:false,remoteRecovery:false,remoteCancellation:false,verified:'local-contract-only'};
}

function prepareSpeechRequest(request,entry){
 const profile=validateSpeechProfile(entry);
 if(!object(request)||request.kind!=='audio.generate')throw fail('原生语音不支持此任务');
 const p=request.parameters||{};if(!object(p))throw fail('语音参数须为对象');
 const allowed=new Set(['model','modelId','scene','virtualModel','voice_id','voice','format','response_format','speech_rate','speed','sample_rate','pitch_rate','loudness_rate','enable_subtitle','count','times']);
 if(Object.keys(p).some(key=>!allowed.has(key)))throw fail('请求包含 OpenAI 语音不支持的参数，未提交模型');
 if(p.scene!=='Text-to-Speech')throw fail('原生 Speech 仅支持文字转语音，音乐与音效须使用对应供应商');
 if(p.modelId!==undefined&&p.model!==undefined&&p.modelId!==p.model)throw fail('语音模型标识不一致');
 for(const value of [p.model,p.modelId,p.virtualModel])if(value!==undefined&&(typeof value!=='string'||!value.trim()))throw fail('语音模型标识无效');
 if([p.count,p.times].some(value=>value!==undefined&&value!==1))throw fail('原生语音仅支持单个结果');
 if(p.pitch_rate!==undefined&&p.pitch_rate!==0||p.loudness_rate!==undefined&&p.loudness_rate!==0||p.enable_subtitle!==undefined&&p.enable_subtitle!==false)throw fail('原生 Speech 不支持声调、音量或字幕参数，未提交模型');
 const inputs=request.inputs||[];
 if(!Array.isArray(inputs)||inputs.some(input=>!object(input)||input.type!=='text'||typeof input.text!=='string'||!input.text.trim()))throw fail('原生 Speech 仅支持文字参考，不支持图片、音频参考或克隆声线');
 if(typeof request.prompt!=='string')throw fail('请输入需要朗读的文本');
 const prefix=inputs.map(input=>input.text).join('\n');let input=request.prompt;
 // AudioUI already prepends these references. Keep that resolved input stable
 // across preparation/retry, while direct callers may provide unexpanded text.
 if(prefix&&input!==prefix&&!input.startsWith(prefix+'\n'))input=prefix+(input?'\n'+input:'');
 if(!input.trim()||input.length>4096)throw fail('朗读文本须为1–4096字符，未提交模型');
 const voiceAlias=p.voice_id??p.voice;
 if(p.voice_id!==undefined&&p.voice!==undefined&&p.voice_id!==p.voice)throw fail('语音音色参数不一致');
 const voice=voiceAlias===undefined?profile.defaultVoice:typeof voiceAlias==='string'&&Object.hasOwn(profile.voiceMap||{},voiceAlias)?profile.voiceMap[voiceAlias]:null;
 if(!voice)throw fail('所选音色尚未显式映射到 OpenAI 内置音色','configuration_required');
 const formatAlias=p.format??p.response_format??profile.defaultFormat;
 if(p.format!==undefined&&p.response_format!==undefined&&p.format!==p.response_format)throw fail('语音格式参数不一致');
 if(typeof formatAlias!=='string'||!Object.hasOwn(profile.formatMap,formatAlias))throw fail('当前音频格式尚未映射到受支持的输出格式','configuration_required');
 const format=profile.formatMap[formatAlias];
 let speed=profile.defaultSpeed??1;
 if(p.speech_rate!==undefined){if(typeof p.speech_rate!=='number'||!Number.isFinite(p.speech_rate)||!Object.hasOwn(profile.speedMap||{},String(p.speech_rate)))throw fail('当前语速尚未显式映射到 OpenAI 倍率','configuration_required');speed=profile.speedMap[String(p.speech_rate)];}
 if(p.speed!==undefined){if(!supportedSpeed(p.speed))throw fail('语音倍率须在0.25–4.0之间');if(p.speech_rate!==undefined&&p.speed!==speed)throw fail('语音倍率与百分比语速不一致');speed=p.speed;}
 let expectedSampleRate=format==='wav'?profile.wavSampleRate:undefined;
 if(p.sample_rate!==undefined){if(format!=='wav'||expectedSampleRate===undefined||p.sample_rate!==expectedSampleRate)throw fail('Speech 不提供采样率设置，当前选择未匹配 WAV 输出验收约束，未提交模型');}
 return {kind:'audio.generate',body:{model:profile.model,input,voice,response_format:format,speed,stream_format:'audio'},expectedSampleRate};
}

function waveMetadata(bytes){
 if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('供应商未返回 WAV 音频','unknown');
 const riff=bytes.readUInt32LE(4);if(riff!==0xffffffff&&riff+8!==bytes.length)throw fail('WAV 音频被截断或长度无效','unknown');
 let offset=12,format,dataSize;
 while(offset+8<=bytes.length){const type=bytes.toString('ascii',offset,offset+4),declared=bytes.readUInt32LE(offset+4),start=offset+8,length=declared===0xffffffff&&type==='data'?bytes.length-start:declared,end=start+length;if(end>bytes.length)throw fail('WAV 音频块被截断','unknown');
  if(type==='fmt '){if(format||length<16)throw fail('WAV 格式块无效','unknown');format={codec:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),blockAlign:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};}
  if(type==='data'){if(dataSize!==undefined)throw fail('WAV 音频数据块无效','unknown');dataSize=length;}
  offset=end+(length%2);
 }
 if(offset!==bytes.length||!format||!dataSize||format.codec!==1||format.bits!==16||format.channels<1||format.channels>2||format.sampleRate<8000||format.sampleRate>192000||format.blockAlign!==format.channels*2||format.byteRate!==format.sampleRate*format.blockAlign||dataSize%format.blockAlign)throw fail('WAV 音频没有有效的16位 PCM 数据','unknown');
 return {duration:dataSize/format.byteRate,sampleRate:format.sampleRate};
}

function validateMP3(bytes){
 let offset=0,end=bytes.length,frames=0;
 if(bytes.length>=10&&bytes.toString('ascii',0,3)==='ID3'){if([...bytes.subarray(6,10)].some(byte=>byte>127))throw fail('MP3 标签无效','unknown');const size=bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9];offset=10+size+((bytes[5]&16)?10:0);}
 if(end>=128&&bytes.toString('ascii',end-128,end-125)==='TAG')end-=128;
 while(offset+4<=end){const header=bytes.readUInt32BE(offset),version=(header>>>19)&3,layer=(header>>>17)&3,bitrateIndex=(header>>>12)&15,rateIndex=(header>>>10)&3;
  if((header>>>21)!==2047||version===1||layer!==1||!bitrateIndex||bitrateIndex===15||rateIndex===3)throw fail('供应商未返回完整 MP3 音频帧','unknown');
  const rates=[44100,48000,32000],bitrates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const rate=rates[rateIndex]/(version===3?1:version===2?2:4),length=Math.floor((version===3?144:72)*bitrates[bitrateIndex]*1000/rate)+((header>>>9)&1);if(length<4||offset+length>end)throw fail('MP3 音频被截断','unknown');offset+=length;frames++;
 }
 if(offset!==end||frames<2)throw fail('MP3 音频为空或不完整','unknown');
 // Encoded frames include encoder delay/padding; browser decoding owns duration.
}

async function submitSpeech(prepared,{sdk,signal,timeoutMs=600000}={}){
 if(signal?.aborted)throw signal.reason;
 if(!sdk?.audio?.speech?.create)throw fail('原生语音客户端尚未配置','configuration_required');
 if(!object(prepared)||prepared.kind!=='audio.generate'||!object(prepared.body)||!formats.has(prepared.body.response_format))throw fail('语音请求尚未准备');
 const body=prepared.body;if(Object.keys(body).some(key=>!['model','input','voice','response_format','speed','stream_format'].includes(key))||typeof body.model!=='string'||!body.model.trim()||typeof body.input!=='string'||!body.input.trim()||body.input.length>4096||!voices.has(body.voice)||!supportedSpeed(body.speed)||body.stream_format!=='audio')throw fail('语音请求尚未完整准备');
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw fail('语音超时配置无效');
 const controller=new AbortController();let rejectAbort,reader,timer,completed=false;
 const interrupted=new Promise((_,reject)=>rejectAbort=reject);interrupted.catch(()=>{});
 const aborted=()=>rejectAbort(controller.signal.reason),cancel=()=>controller.abort(signal.reason);
 controller.signal.addEventListener('abort',aborted,{once:true});signal?.addEventListener('abort',cancel,{once:true});
 timer=setTimeout(()=>controller.abort(fail('语音请求超时，状态尚未确认','unknown')),timeoutMs);
 const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
 const wait=async operation=>{check();const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),interrupted]);check();return value;};
 try{
  const response=await wait(()=>sdk.audio.speech.create(prepared.body,{signal:controller.signal,maxRetries:0,timeout:timeoutMs}));
  if(!response?.ok||!response.body?.getReader)throw fail('语音服务未返回可读取的成功音频响应','unknown');
  const format=prepared.body.response_format,mime=format==='wav'?'audio/wav':'audio/mpeg',headerType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(headerType&&!['application/octet-stream',mime,...(format==='wav'?['audio/x-wav','audio/wave','audio/vnd.wave']:['audio/mp3'])].includes(headerType))throw fail('语音响应格式与请求不一致','unknown');
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>MAX_AUDIO_BYTES)throw fail('语音响应超过本地32 MiB预算','unknown');
  reader=response.body.getReader();const chunks=[];let size=0;
  for(;;){const item=await wait(()=>reader.read());if(item.done)break;if(!(item.value instanceof Uint8Array))throw fail('语音响应不是二进制数据','unknown');size+=item.value.byteLength;if(size>MAX_AUDIO_BYTES)throw fail('语音响应超过本地32 MiB预算','unknown');chunks.push(Buffer.from(item.value));}
  if(!size||Number.isFinite(declared)&&declared>0&&declared!==size)throw fail('语音响应为空或被截断','unknown');
  const bytes=Buffer.concat(chunks),metadata=format==='wav'?waveMetadata(bytes):{};if(format==='mp3')validateMP3(bytes);
  if(prepared.expectedSampleRate!==undefined&&metadata.sampleRate!==prepared.expectedSampleRate)throw fail('语音实际采样率与请求约束不一致','unknown');check();completed=true;
  return {status:'succeeded',outputs:[{type:'audio',url:'data:'+mime+';base64,'+bytes.toString('base64'),...(metadata.duration?{duration:metadata.duration}:{})}]};
 }catch(error){if(signal?.aborted)throw signal.reason;throw fail('语音生成状态未确认，未自动重新提交','unknown');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',aborted);if(!completed){controller.abort();if(reader)void reader.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
}

module.exports={validateSpeechProfile,speechCapabilities,prepareSpeechRequest,submitSpeech,MAX_AUDIO_BYTES,validateMP3,waveMetadata};
