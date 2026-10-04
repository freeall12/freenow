import {resolveProviderConfiguration,providerConfigurationStatus} from '../node-composer/provider-configuration.mjs';
const model=request=>request?.parameters?.modelId??request?.parameters?.model;
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const protocol=metadata=>metadata?.protocol;
const musicProtocols=['elevenlabs-music-native','mureka-native'];
const promptWithReferences=request=>{
 if(typeof request.prompt!=='string')return null;
 const prefix=(request.inputs??[]).filter(input=>input.type==='text').map(input=>input.text).join('\n');
 return prefix&&request.prompt!==prefix&&!request.prompt.startsWith(prefix+'\n')?prefix+(request.prompt?'\n'+request.prompt:''):request.prompt;
};
export function audioNativeProfile(metadata,request){
 const selected=resolveProviderConfiguration(metadata,request),alias=model(request);
 if(musicProtocols.includes(protocol(selected)))return selected.capabilities?.music?.[alias]??null;
 return protocol(selected)==='seed-audio-native'?selected.capabilities?.seedAudio?.[alias]??null:null;
}
export function audioNativeParameters(metadata,request,{nodeDraft=false,explicitOverrides}={}){
 const parameters={...request.parameters},selected=resolveProviderConfiguration(metadata,request),profile=audioNativeProfile(metadata,request);
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
export function audioNativeRequestState(metadata,request,options){
 const availability=providerConfigurationStatus(metadata,request);
 if(availability.configured===false)return {ready:false,reason:availability.message,hint:''};
 const profile=audioNativeProfile(metadata,request);if(!profile)return {ready:true,reason:'',hint:''};
 let p;try{p=audioNativeParameters(metadata,request,options);}catch(error){return {ready:false,reason:error.message,hint:''};}
 const selected=resolveProviderConfiguration(metadata,request),inputs=request.inputs??[];
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
