import {resolveProviderConfiguration,providerConfigurationStatus} from '../node-composer/provider-configuration.mjs';
const model=request=>request?.parameters?.providerParameters?.model??request?.parameters?.modelId??request?.parameters?.model;
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const protocol=metadata=>metadata?.protocol;
const musicProtocols=['elevenlabs-music-native','mureka-native','sonilo-native'];
const promptWithReferences=request=>{
 if(typeof request.prompt!=='string')return null;
 const prefix=(request.inputs??[]).filter(input=>input.type==='text').map(input=>input.text).join('\n');
 return prefix&&request.prompt!==prefix&&!request.prompt.startsWith(prefix+'\n')?prefix+(request.prompt?'\n'+request.prompt:''):request.prompt;
};
export function audioNativeProfile(metadata,request){
 const selected=resolveProviderConfiguration(metadata,request),alias=model(request);
 if(musicProtocols.includes(protocol(selected)))return selected.capabilities?.music?.[alias]??selected.capabilities?.sound?.[alias]??selected.capabilities?.videoAudio?.[alias]??null;
 if(protocol(selected)==='fal-video-audio-native')return selected.capabilities?.videoAudio?.[alias]??null;
 return protocol(selected)==='seed-audio-native'?selected.capabilities?.seedAudio?.[alias]??null:null;
}
export function audioNativeParameters(metadata,request,{nodeDraft=false,explicitOverrides,sourceParameters}={}){
 const parameters={...request.parameters},selected=resolveProviderConfiguration(metadata,request),profile=audioNativeProfile(metadata,request);
 if(profile&&['fal-video-audio-native','sonilo-native'].includes(protocol(selected)))return {...sourceParameters,...parameters};
 if(!profile||!musicProtocols.includes(protocol(selected)))return parameters;
 // A hidden node textarea is an editable draft. Native wire inputs only carry
 // active lyrics; explicit Agent lyrics remain an instruction and must conflict.
 if(explicitOverrides&&typeof explicitOverrides.lyrics==='string'&&explicitOverrides.lyrics.trim()&&!parameters.lyric_mode)throw fail('自动歌词或纯音乐模式含有明确的自定义歌词，请清空歌词或选择自定义');
 if(nodeDraft&&!parameters.lyric_mode)parameters.lyrics='';
 return parameters;
}
function murekaState(profile,request,p){
 const custom=p.lyric_mode===true,prompt=promptWithReferences(request),limit=custom?profile.customLyrics.maxPromptCharacters:profile.maxPromptCharacters;
 const hint=custom?'Mureka 自定义歌词：描述最多 '+limit+' 字符，歌词最多 '+profile.customLyrics.maxCharacters+' 字符；时长由模型决定。':'Mureka 自动歌词：描述最多 '+limit+' 字符；时长由模型决定。';
 const reject=reason=>({ready:false,reason,hint});
 if(Object.keys(p).some(key=>!['model','modelId','virtualModel','scene','lyric_mode','lyrics','count','times'].includes(key)))return reject('Mureka 原生音乐不支持指定时长、纯音乐或所填其他参数；请明确修改参数');
 if(p.lyric_mode!==undefined&&typeof p.lyric_mode!=='boolean'||p.lyrics!==undefined&&typeof p.lyrics!=='string')return reject('Mureka 歌词参数类型无效');
 if(prompt!==null&&(Array.from(prompt).length>limit||!custom&&!prompt.trim()))return reject(custom?'Mureka 自定义歌词描述最多 '+limit+' 字符；请修改描述':'Mureka 自动歌词描述须为 1–'+limit+' 字符；请修改描述');
 if(custom&&(!p.lyrics?.trim()||Array.from(p.lyrics).length>profile.customLyrics.maxCharacters))return reject('Mureka 自定义歌词须为 1–'+profile.customLyrics.maxCharacters+' 字符；请修改歌词');
 if(!custom&&p.lyrics?.length)return reject('Mureka 自动模式含有自定义歌词，请选择自定义或清空明确输入');
 if((request.inputs??[]).some(input=>input.type!=='text'))return reject('Mureka 当前原生接口只支持文字参考');
 return {ready:true,reason:'',hint};
}
function seedState(profile,request,p){
 const format=p.format??p.response_format??'wav',rates=profile.sampleRates[format],rate=p.sample_rate??profile.defaultSampleRates?.[format];
 const hint='Seed Audio '+String(format).toUpperCase()+'：'+(rates?rates.join(' / '):'未支持')+' Hz；字幕由供应商返回；参考图片和音频不能混用。';
 const reject=reason=>({ready:false,reason,hint});
 if(Object.keys(p).some(key=>!['model','modelId','virtualModel','scene','format','response_format','sample_rate','speech_rate','pitch_rate','loudness_rate','enable_subtitle','count','times'].includes(key)))return reject('Seed Audio 原生接口不支持所填歌词、时长或其他参数；请明确修改参数');
 if(!profile.formats.includes(format)||p.format!==undefined&&p.response_format!==undefined&&p.format!==p.response_format)return reject('Seed Audio 输出格式无效或冲突，请明确修改格式');
 if(rate!==undefined&&!rates.includes(rate))return reject(format==='ogg_opus'?'Seed Audio Ogg Opus 仅支持 48000 Hz；请在高级设置修改采样率':'Seed Audio 当前格式不支持所选采样率；请明确修改采样率');
 for(const [key,label,range]of [['speech_rate','语速',profile.speechRate],['pitch_rate','声调',profile.pitchRate],['loudness_rate','音量',profile.loudnessRate]]){const value=p[key]??0;if(!Number.isInteger(value)||value<range.min||value>range.max)return reject('Seed Audio '+label+'须为 '+range.min+'–'+range.max+' 范围内的整数');}
 if(p.enable_subtitle!==undefined&&typeof p.enable_subtitle!=='boolean')return reject('Seed Audio 字幕开关须为布尔值');
 if(p.enable_subtitle&&profile.subtitle!=='provider-text')return reject('Seed Audio 当前供应商尚未公开字幕输出能力');
 const text=promptWithReferences(request);if(text!==null&&(!text.trim()||text.length>profile.maxCharacters))return reject('Seed Audio 提示词及文字参考须为 1–'+profile.maxCharacters+' 字符');
 const inputs=request.inputs??[],images=inputs.filter(input=>input.type==='image'),audios=inputs.filter(input=>input.type==='audio');
 if(inputs.some(input=>!['text','image','audio'].includes(input.type)))return reject('Seed Audio 仅支持文字、图片或音频参考');
 if(images.length>profile.maxImages||audios.length>profile.maxAudios||!profile.mixedReferences&&images.length&&audios.length)return reject('Seed Audio 支持 '+profile.maxImages+' 张图片或最多 '+profile.maxAudios+' 条音频参考，不能混用');
 for(const input of [...images,...audios]){
  if(['clip','trim','sourceClip'].some(key=>input[key]!=null))return reject('Seed Audio 参考选区须先物化为实际媒体；请使用已裁剪的独立素材');
  if(input.type==='audio'&&!/^https:/i.test(input.url??'')&&Number.isFinite(input.duration)&&input.duration>profile.maxReferenceAudioSeconds)return reject('Seed Audio 每条音频参考不得超过 '+profile.maxReferenceAudioSeconds+' 秒');
  const inline=typeof input.url==='string'&&/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.url);
  if(inline){const bytes=inline[2].length*3/4-(inline[2].endsWith('==')?2:inline[2].endsWith('=')?1:0),allowed=profile.referenceFormats?.[input.type];
   if(allowed&&!allowed.includes(inline[1]))return reject('Seed Audio 参考素材格式未支持，请重新导入支持的本地文件');
   if(!bytes||bytes>profile.maxReferenceBytes||input.type==='image'&&bytes<(profile.minReferenceImageBytes??0))return reject('Seed Audio 参考素材大小超出原生接口范围；请重新导入符合大小限制的文件');
  }else if(typeof input.url==='string'&&input.url.startsWith('data:'))return reject('Seed Audio 参考素材须为有效的内联 Base64');
 }
 if(text!==null)for(const match of text.matchAll(/@音频(\d+)/g))if(Number(match[1])<1||Number(match[1])>audios.length)return reject('Seed Audio 音频编号未绑定到对应参考素材');
 return {ready:true,reason:'',hint};
}
function videoAudioState(profile,request,p,options={}){
 const hint='实际供应商：ThinkSound Video-to-Audio（显式替代 Sonilo 音效）。仅一个完整 MP4 视频；音频跟随源视频，本地边界 1–180 秒，供应商未公开最大时长。';
 const reject=reason=>({ready:false,reason,hint});
 if(profile.semantics!=='explicit-native-alternative'||profile.durationMode!=='source-video'||model(request)!=='sonilo-sfx')return reject('ThinkSound 替代身份未明确配置，不能作为 Sonilo 原生接口提交');
 if(p.scene!==profile.scene)return reject('ThinkSound 显式替代仅支持音效场景');
 if(p.virtualModel!==undefined&&p.virtualModel!=='sonilo-music'||[p.model,p.modelId,p.providerParameters?.model].some(alias=>alias!==undefined&&alias!=='sonilo-sfx'))return reject('ThinkSound 显式替代只支持 Sonilo 选择器的音效场景');
 const keys=['model','modelId','virtualModel','scene','duration','providerParameters','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'];
 for(const parameters of [p,options.sourceParameters].filter(Boolean))if(Object.keys(parameters).some(key=>!keys.includes(key)))return reject('ThinkSound 视频拟音含不支持的参数或分段设置，请明确移除后重试');
 const overrides=options.explicitOverrides;
 if(overrides&&Object.keys(overrides).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','position'].includes(key)))return reject('ThinkSound 视频拟音不支持所填 Agent 设置，不会忽略指令后提交');
 for(const count of [request.count,p.count,p.times,p.batch_count,p.canvasResults?.targetNodeIds?.length,overrides?.count])if(count!==undefined&&count!==1)return reject('ThinkSound 视频拟音每个任务仅生成一个音频结果');
 const inputs=request.inputs??[];
 if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||inputs.length!==1||inputs[0]?.type!=='video')return reject('ThinkSound 视频拟音须且只能绑定一个真实参考视频，不支持文字参考或纯文字生成');
 const input=inputs[0],inputKeys=['id','nodeId','type','url','title','role','duration','sizeBytes','mime','mimeType'];
 if(Object.entries(input).some(([key,value])=>value!==undefined&&!inputKeys.includes(key))||['clip','trim','sourceClip','segments'].some(key=>request[key]!==undefined)||input.role!==undefined&&!['source_video','reference_video'].includes(input.role))return reject('ThinkSound 参考选区或分段须先导出为完整 MP4，不会使用整片代替选段');
 if(typeof input.url!=='string'||!input.url.trim())return reject('ThinkSound 参考视频尚未上传真实内容');
 if([input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4')||input.url.startsWith('data:')&&!input.url.startsWith('data:video/mp4;base64,'))return reject('ThinkSound 参考视频须为 MP4');
 if(input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>profile.maxVideoBytes))return reject('ThinkSound 参考视频大小须在 50 MB 内');
 if(request.prompt!==undefined&&(typeof request.prompt!=='string'||request.prompt.length>profile.maxCharacters))return reject('ThinkSound 提示词须为不超过 '+profile.maxCharacters+' 字符的文字');
 const wire=p.providerParameters??{};
 if(!wire||typeof wire!=='object'||Array.isArray(wire)||Object.keys(wire).some(key=>!['model','seed','num_inference_steps','cfg_scale'].includes(key)))return reject('ThinkSound 原生参数含不支持的设置');
 if(wire.seed!==undefined&&wire.seed!==null&&!Number.isSafeInteger(wire.seed)||wire.num_inference_steps!==undefined&&(!Number.isSafeInteger(wire.num_inference_steps)||wire.num_inference_steps<2||wire.num_inference_steps>100)||wire.cfg_scale!==undefined&&(!Number.isFinite(wire.cfg_scale)||wire.cfg_scale<1||wire.cfg_scale>20))return reject('ThinkSound 种子、推理步数或引导强度超出支持范围');
 const duration=input.duration,range=profile.localVideoDuration;
 if(overrides?.duration!==undefined&&(!Number.isFinite(overrides.duration)||overrides.duration<range.min||overrides.duration>range.max))return reject('明确指定的音频时长须在本地 '+range.min+'–'+range.max+' 秒范围内，且跟随源视频');
 if(duration===undefined&&options.deferVideoDuration)return {ready:true,reason:'',hint:hint+' 生成前读取真实视频时长。'};
 if(!Number.isFinite(duration)||duration<range.min||duration>range.max)return reject('ThinkSound 视频拟音须读取真实视频时长且在本地 '+range.min+'–'+range.max+' 秒范围内');
 if(!options.deferVideoDuration&&p.duration!==duration)return reject('ThinkSound 音频时长须跟随真实源视频，不支持指定另一时长');
 if(overrides?.duration!==undefined&&overrides.duration!==duration)return reject('明确指定的音频时长与源视频不一致，请修改指令；不会覆盖后提交');
 return {ready:true,reason:'',hint};
}
function soniloState(profile,request,p,options={}){
 const hint='Sonilo Music 原生音乐：文字音乐 5–360 秒；视频音乐跟随完整 MP4 的真实时长（5–360 秒、50 MB 内）；1–10 个 WAV 变体；音乐分段 1–30 段，每段至少 5 秒。';
 const reject=reason=>({ready:false,reason,hint});
 if(model(request)!=='sonilo-music'||p.scene!=='Music'||profile.semantics!=='native')return reject('Sonilo 原生音乐型号或场景未明确配置');
 const keys=['model','modelId','virtualModel','scene','duration','segments','providerParameters','count','times','format','response_format'];
 for(const parameters of [p,options.sourceParameters].filter(Boolean))if(Object.keys(parameters).some(key=>!keys.includes(key)))return reject('Sonilo 原生音乐含不支持的参数；不会忽略指令后提交');
 if(options.explicitOverrides&&Object.keys(options.explicitOverrides).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','segments','position','promptInfluence','audioFormat'].includes(key)))return reject('Sonilo 原生音乐不支持所填 Agent 设置；请明确修改指令');
 if([p.format,p.response_format].some(value=>value!==undefined&&value!=='wav'))return reject('Sonilo 本批固定返回 WAV，不会忽略格式或另行转码');
 const counts=[request.count,p.count,p.times,options.explicitOverrides?.count].filter(value=>value!==undefined);
 if(counts.some(value=>!Number.isInteger(value)||value<1||value>10)||new Set(counts).size>1)return reject('Sonilo 原生音乐单任务变体数量须为 1–10 且数量声明一致');
 const wire=p.providerParameters??{};
 if(!wire||typeof wire!=='object'||Array.isArray(wire)||Object.keys(wire).some(key=>!['model','prompt_influence'].includes(key))||wire.model!==undefined&&wire.model!=='sonilo-music'||wire.prompt_influence!==undefined&&(!Number.isFinite(wire.prompt_influence)||wire.prompt_influence<0||wire.prompt_influence>1))return reject('Sonilo 原生参数无效或不支持');
 if(p.virtualModel!==undefined&&p.virtualModel!=='sonilo-music'||[p.model,p.modelId].some(value=>value!==undefined&&value!=='sonilo-music'))return reject('Sonilo 原生音乐只支持 sonilo-music');
 const inputs=request.inputs??[];
 if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||inputs.length>1||inputs.some(input=>input.type!=='video'))return reject('Sonilo 原生音乐仅支持一个完整 MP4 视频参考或无参考文字生成');
 if(!inputs.length&&wire.prompt_influence!==undefined)return reject('Sonilo 提示词影响度仅适用于视频音乐');
 if(typeof request.prompt!=='string'||Array.from(request.prompt).length>1000||!inputs.length&&!request.prompt.trim())return reject('Sonilo 音乐描述最多 1000 字符；无视频时描述须非空');
 if(['clip','trim','sourceClip','segments'].some(key=>request[key]!==undefined))return reject('Sonilo 音乐分段须放入参数；参考选区须先物化为完整 MP4');
 let duration=p.duration;
 if(inputs.length){
  const input=inputs[0],inputKeys=['id','type','url','title','duration','sizeBytes','mime','mimeType','role'];
  if(Object.entries(input).some(([key,value])=>value!==undefined&&!inputKeys.includes(key))||input.role!==undefined&&!['source_video','reference_video'].includes(input.role))return reject('Sonilo 参考选区或分段须先物化为完整 MP4，不会使用整片代替选段');
  if(typeof input.url!=='string'||!input.url.trim())return reject('Sonilo 参考视频尚未上传真实内容');
  if([input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4')||input.url.startsWith('data:')&&!/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))return reject('Sonilo 参考视频须为完整 MP4');
  if(input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>50000000))return reject('Sonilo 参考视频大小须在 50 MB 内');
  if(input.url.startsWith('data:')){const encoded=input.url.split(',')[1],bytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);if(encoded.length%4||bytes<1||bytes>50000000||input.sizeBytes!==undefined&&input.sizeBytes!==bytes)return reject('Sonilo 参考视频字节数或编码无效');}
  duration=input.duration;
  if(duration!==undefined&&(!Number.isFinite(duration)||duration<5||duration>360))return reject('Sonilo 视频音乐须读取真实视频时长且在 5–360 秒内');
  if(!options.deferVideoDuration&&(!Number.isFinite(duration)||p.duration!==duration))return reject('Sonilo 音乐时长须跟随真实源视频，不能指定另一时长');
  const explicit=options.explicitOverrides?.duration;
  if(explicit!==undefined&&(!Number.isFinite(explicit)||explicit<5||explicit>360||duration!==undefined&&explicit!==duration))return reject('明确指定的 Sonilo 音乐时长与真实源视频不一致；不会覆盖后提交');
 }else if(!Number.isInteger(duration)||duration<5||duration>360)return reject('Sonilo 文字音乐时长须为 5–360 整数秒');
 if(p.segments!==undefined){
  if(!Array.isArray(p.segments)||p.segments.length<1||p.segments.length>30)return reject('Sonilo 音乐分段须为 1–30 段');
  const labels=['intro','verse','pre-chorus','chorus','bridge','break','silence','outro','none'];
  for(let i=0;i<p.segments.length;i++){const segment=p.segments[i];if(!segment||typeof segment!=='object'||Array.isArray(segment)||Object.keys(segment).some(key=>!['start','prompt','label'].includes(key))||!Number.isFinite(segment.start)||segment.start<0||i===0&&segment.start!==0||i>0&&segment.start-p.segments[i-1].start<5||duration!==undefined&&segment.start>duration-5||typeof segment.prompt!=='string'||!segment.prompt.trim()||Array.from(segment.prompt).length>200||segment.label!==undefined&&!labels.includes(segment.label))return reject('Sonilo 音乐分段须从 0 秒开始、相隔至少 5 秒并保留最后 5 秒；提示词 1–200 字符，标签须为官方枚举');}
 }
 return {ready:true,reason:'',hint:hint+(inputs.length&&duration===undefined?' 生成前读取真实视频时长。':'')};
}
function soniloSfxState(profile,request,p,options={}){
 const hint='Sonilo SFX 原生音效：文字音效 0.5–180 秒；视频跟随完整 MP4 的真实时长（本地 0.5–480 秒、50 MB 内）；固定单个 WAV 结果；分段仅视频，1–30 段，start/end 连续且原样提交。';
 const reject=reason=>({ready:false,reason,hint});
 if(model(request)!=='sonilo-sfx'||p.scene!=='Sound'||profile.semantics!=='native'||profile.durationMode!=='source-video-or-explicit')return reject('Sonilo 原生音效型号或场景未明确配置');
 const keys=['model','modelId','virtualModel','scene','duration','segments','providerParameters','count','times','format','response_format'];
 for(const parameters of [p,options.sourceParameters].filter(Boolean))if(Object.keys(parameters).some(key=>!keys.includes(key)))return reject('Sonilo 原生音效含不支持的参数；不会忽略指令后提交');
 if(options.explicitOverrides&&Object.keys(options.explicitOverrides).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','segments','position','audioFormat'].includes(key)))return reject('Sonilo 原生音效不支持所填 Agent 设置；请明确修改指令');
 if([p.format,p.response_format].some(value=>value!==undefined&&value!=='wav'))return reject('Sonilo 原生音效固定返回 WAV，不会忽略格式或另行转码');
 if([request.count,p.count,p.times,options.explicitOverrides?.count].some(value=>value!==undefined&&value!==1))return reject('Sonilo 原生音效每个任务仅生成一个 WAV 结果');
 const wire=p.providerParameters??{};
 if(!wire||typeof wire!=='object'||Array.isArray(wire)||Object.keys(wire).some(key=>key!=='model')||wire.model!==undefined&&wire.model!=='sonilo-sfx')return reject('Sonilo 原生音效不支持提示词影响度或其他供应商参数');
 if(p.virtualModel!==undefined&&!['sonilo-music','sonilo-sfx'].includes(p.virtualModel)||[p.model,p.modelId].some(value=>value!==undefined&&value!=='sonilo-sfx'))return reject('Sonilo 原生音效只支持 sonilo-sfx');
 const inputs=request.inputs??[];
 if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||inputs.length>1||inputs.some(input=>input.type!=='video'))return reject('Sonilo 原生音效仅支持一个完整 MP4 视频参考或无参考文字生成');
 if(typeof request.prompt!=='string'||Array.from(request.prompt).length>2000||!inputs.length&&!request.prompt.trim())return reject('Sonilo 音效描述最多 2000 字符；无视频时描述须非空');
 if(['clip','trim','sourceClip','segments'].some(key=>request[key]!==undefined))return reject('Sonilo 音效分段须放入参数；参考选区须先物化为完整 MP4');
 let duration=p.duration;
 if(inputs.length){
  const input=inputs[0],inputKeys=['id','type','url','title','duration','sizeBytes','mime','mimeType','role'];
  if(Object.entries(input).some(([key,value])=>value!==undefined&&!inputKeys.includes(key))||input.role!==undefined&&!['source_video','reference_video'].includes(input.role))return reject('Sonilo 参考选区或分段须先物化为完整 MP4，不会使用整片代替选段');
  if(typeof input.url!=='string'||!input.url.trim())return reject('Sonilo 参考视频尚未上传真实内容');
  if([input.mime,input.mimeType].some(value=>value!==undefined&&value!=='video/mp4')||input.url.startsWith('data:')&&!/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))return reject('Sonilo 参考视频须为完整 MP4');
  if(input.sizeBytes!==undefined&&(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||input.sizeBytes>50000000))return reject('Sonilo 参考视频大小须在 50 MB 内');
  if(input.url.startsWith('data:')){const encoded=input.url.split(',')[1],bytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);if(encoded.length%4||bytes<1||bytes>50000000||input.sizeBytes!==undefined&&input.sizeBytes!==bytes)return reject('Sonilo 参考视频字节数或编码无效');}
  duration=input.duration;
  if(duration!==undefined&&(!Number.isFinite(duration)||duration<.5||duration>480))return reject('Sonilo 原生视频音效须读取真实视频时长且在本地 0.5–480 秒内');
  if(!options.deferVideoDuration&&(!Number.isFinite(duration)||p.duration!==duration))return reject('Sonilo 音效时长须跟随真实源视频，不能指定另一时长');
  const explicit=options.explicitOverrides?.duration;
  if(explicit!==undefined&&(!Number.isFinite(explicit)||explicit<.5||explicit>480||duration!==undefined&&explicit!==duration))return reject('明确指定的 Sonilo 音效时长与真实源视频不一致；不会覆盖后提交');
 }else if(!Number.isFinite(duration)||duration<.5||duration>180)return reject('Sonilo 文字音效时长须为 0.5–180 秒，可使用小数');
 if(p.segments!==undefined){
  if(!inputs.length)return reject('Sonilo 音效分段仅支持视频参考，不支持文字音效');
  if(!Array.isArray(p.segments)||p.segments.length<1||p.segments.length>30)return reject('Sonilo 音效分段须为 1–30 段');
  for(let i=0;i<p.segments.length;i++){const segment=p.segments[i];if(!segment||typeof segment!=='object'||Array.isArray(segment)||Object.keys(segment).some(key=>!['start','end','prompt'].includes(key))||!Number.isFinite(segment.start)||!Number.isFinite(segment.end)||segment.start<0||segment.end<=segment.start||i===0&&segment.start!==0||i>0&&segment.start!==p.segments[i-1].end||duration!==undefined&&segment.end>duration||typeof segment.prompt!=='string'||!segment.prompt.trim()||Array.from(segment.prompt).length>200)return reject('Sonilo 音效分段须从 0 秒开始，start/end 严格连续且不超过真实视频；描述 1–200 字符，不支持音乐标签');}
 }
 return {ready:true,reason:'',hint:hint+(inputs.length&&duration===undefined?' 生成前读取真实视频时长。':'')};
}
export function audioNativeRequestState(metadata,request,options){
 const availability=providerConfigurationStatus(metadata,request);
 if(availability.configured===false)return {ready:false,reason:availability.message,hint:''};
 const profile=audioNativeProfile(metadata,request);if(!profile)return protocol(resolveProviderConfiguration(metadata,request))==='sonilo-native'?{ready:false,reason:'所选 Sonilo 原生音频别名尚未配置，请明确配置 Music 或 SFX 模型映射',hint:''}:{ready:true,reason:'',hint:''};
 let p;try{p=audioNativeParameters(metadata,request,options);}catch(error){return {ready:false,reason:error.message,hint:''};}
 const selected=resolveProviderConfiguration(metadata,request),inputs=request.inputs??[];
 if(protocol(selected)==='fal-video-audio-native')return videoAudioState(profile,request,p,options);
 if(protocol(selected)==='sonilo-native')return model(request)==='sonilo-sfx'?soniloSfxState(profile,request,p,options):soniloState(profile,request,p,options);
 if(inputs.length>30)return {ready:false,reason:'音频原生接口每个请求最多 30 个参考素材',hint:''};
 for(const count of [request.count,p.count,p.times])if(count!==undefined&&count!==profile.maxCount)return {ready:false,reason:'当前音频原生接口每个任务只生成一个结果',hint:''};
 if(p.scene!==profile.scene)return {ready:false,reason:'所选音频场景与实际供应商能力不一致',hint:''};
 if(protocol(selected)==='mureka-native')return murekaState(profile,request,p);
 if(protocol(selected)==='seed-audio-native')return seedState(profile,request,p);
 const custom=p.lyric_mode===true,instrumental=p.force_instrumental===true,limit=custom?profile.customLyrics?.duration:profile.duration;
 const visibleMin=Math.max(profile.duration?.min??3,options?.catalogDuration?.min??3),visibleMax=Math.min(profile.duration?.max??600,options?.catalogDuration?.max??600);
 const hint=custom?'ElevenLabs Music 自定义歌词须指定 3–120 秒；最多 30 行，每行 200 字符。':'ElevenLabs Music 当前节点支持自动时长或 '+visibleMin+'–'+visibleMax+' 秒；返回 MP3。';
 const reject=reason=>({ready:false,reason,hint});
 if(custom&&instrumental)return reject('自定义歌词与纯音乐模式冲突，请选择一个歌词模式');
 if(!custom&&p.lyrics?.trim())return reject('自动歌词或纯音乐模式含有自定义歌词，请清空歌词或选择自定义');
 const prompt=promptWithReferences(request);if(prompt!==null&&Array.from(prompt).length>profile.maxPromptCharacters)return reject('ElevenLabs Music 描述及文字参考不能超过 '+profile.maxPromptCharacters+' 字符');
 const duration=p.music_length_ms;
 if(custom&&duration==null)return reject('ElevenLabs Music 自定义歌词不能使用自动时长，请指定 3–120 秒');
 if(duration!=null&&(!Number.isInteger(duration)||duration<(limit?.min??3)*1000||duration>(limit?.max??600)*1000))return reject(custom?'ElevenLabs Music 自定义歌词时长须为 3–120 秒':'ElevenLabs Music 时长须为 3–600 秒且精确到整数毫秒');
 if(custom){const lyrics=p.lyrics??'',lines=lyrics.split(/\r\n|\n|\r/),limits=profile.customLyrics;if(!lyrics.trim()||lines.length>limits.maxLines||lines.some(line=>Array.from(line).length>limits.maxLineCharacters))return reject('自定义歌词须非空、最多 30 行且每行不超过 200 字符');}
 return {ready:true,reason:'',hint};
}
export async function audioNativeConfiguration(api,request){
 // Use the public availability refresh and its matching public metadata; no
 // private routing state or provider credentials are read by the editor.
 const availability=await api.availability?.({request});
 if(availability?.configured===false)throw Object.assign(Error(availability.reason||'音频生成服务尚未配置'),{code:'configuration_required',providerDispatched:false});
 return api.configuration?.();
}
export function applyAudioNativeConfiguration(metadata,request,options){
 const state=audioNativeRequestState(metadata,request,options);if(!state.ready)throw fail(state.reason);
 return {...request,parameters:audioNativeParameters(metadata,request,options)};
}
export async function prepareAudioNativeRequest(api,request,options){
 return applyAudioNativeConfiguration(await audioNativeConfiguration(api,request),request,options);
}
