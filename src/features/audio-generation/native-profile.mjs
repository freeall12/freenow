import {resolveProviderConfiguration,providerConfigurationStatus} from '../node-composer/provider-configuration.mjs';
const model=request=>request?.parameters?.modelId??request?.parameters?.model;
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
export function audioNativeProfile(metadata,request){
 const selected=resolveProviderConfiguration(metadata,request),alias=model(request);
 return selected?.protocol==='elevenlabs-music-native'?selected.capabilities?.music?.[alias]??null:null;
}
export function audioNativeParameters(metadata,request,{nodeDraft=false,explicitOverrides}={}){
 const parameters={...request.parameters},profile=audioNativeProfile(metadata,request);
 if(!profile)return parameters;
 // A hidden node textarea is an editable draft. Native wire inputs only carry
 // active lyrics; explicit Agent lyrics remain an instruction and must conflict.
 if(explicitOverrides&&typeof explicitOverrides.lyrics==='string'&&explicitOverrides.lyrics.trim()&&!parameters.lyric_mode)throw fail('自动歌词或纯音乐模式含有明确的自定义歌词，请清空歌词或选择自定义');
 if(nodeDraft&&!parameters.lyric_mode)parameters.lyrics='';
 return parameters;
}
export function audioNativeRequestState(metadata,request,options){
 const availability=providerConfigurationStatus(metadata,request);
 if(availability.configured===false)return {ready:false,reason:availability.message,hint:''};
 const profile=audioNativeProfile(metadata,request);if(!profile)return {ready:true,reason:'',hint:''};
 let p;try{p=audioNativeParameters(metadata,request,options);}catch(error){return {ready:false,reason:error.message,hint:''};}
 const custom=p.lyric_mode===true,instrumental=p.force_instrumental===true,limit=custom?profile.customLyrics?.duration:profile.duration;
 const visibleMin=Math.max(profile.duration?.min??3,options?.catalogDuration?.min??3),visibleMax=Math.min(profile.duration?.max??600,options?.catalogDuration?.max??600);
 const hint=custom?'ElevenLabs Music 自定义歌词须指定 3–120 秒；最多 30 行，每行 200 字符。':'ElevenLabs Music 当前节点支持自动时长或 '+visibleMin+'–'+visibleMax+' 秒；返回 MP3。';
 const reject=reason=>({ready:false,reason,hint});
 if(custom&&instrumental)return reject('自定义歌词与纯音乐模式冲突，请选择一个歌词模式');
 if(!custom&&p.lyrics?.trim())return reject('自动歌词或纯音乐模式含有自定义歌词，请清空歌词或选择自定义');
 const duration=p.music_length_ms;
 if(custom&&duration==null)return reject('ElevenLabs Music 自定义歌词不能使用自动时长，请指定 3–120 秒');
 if(duration!=null&&(!Number.isInteger(duration)||duration<(limit?.min??3)*1000||duration>(limit?.max??600)*1000))return reject(custom?'ElevenLabs Music 自定义歌词时长须为 3–120 秒':'ElevenLabs Music 时长须为 3–600 秒且精确到整数毫秒');
 if(custom){const lyrics=p.lyrics??'',lines=lyrics.split(/\r\n|\n|\r/),limits=profile.customLyrics;if(!lyrics.trim()||lines.length>limits.maxLines||lines.some(line=>Array.from(line).length>limits.maxLineCharacters))return reject('自定义歌词须非空、最多 30 行且每行不超过 200 字符');}
 return {ready:true,reason:'',hint};
}
export async function prepareAudioNativeRequest(api,request,options){
 // Use the public availability refresh and its matching public metadata; no
 // private routing state or provider credentials are read by the editor.
 const availability=await api.availability?.({request});
 if(availability?.configured===false)throw Object.assign(Error(availability.reason||'音乐生成服务尚未配置'),{code:'configuration_required',providerDispatched:false});
 const metadata=await api.configuration?.(),state=audioNativeRequestState(metadata,request,options);
 if(!state.ready)throw fail(state.reason);
 return {...request,parameters:audioNativeParameters(metadata,request,options)};
}
