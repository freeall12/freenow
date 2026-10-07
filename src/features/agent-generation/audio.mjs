import {audioIcons} from './audio-assets.mjs';
import {videoModels} from './video-catalog.mjs';
import {resolveProviderConfiguration,providerConfigurationStatus} from '../node-composer/provider-configuration.mjs';
import {audioNativeRequestState} from '../audio-generation/native-profile.mjs';
// Official Agent registry/schema, release eb1c357; MiniMax follows the verified native API extension.
export const audioModels=[
 {id:'minimax-music-26',name:'MiniMax Music 2.6',icon:videoModels.find(model=>model.id==='MiniMax-H3').icon,virtual:'minimax-music-26',scenes:{Music:'music-2.6'}},
 {id:'elevenlabs',name:'ElevenLabs V3',icon:audioIcons.ELEVENLAB,virtual:'elevenlabs-v3',scenes:{'Text-to-Speech':'eleven_v3',Music:'music_v1',Sound:'eleven_sound_effect'}},
 {id:'sonilo',name:'Sonilo Music',icon:audioIcons.SONILO,virtual:'sonilo-music',scenes:{Music:'sonilo-music',Sound:'sonilo-sfx'}},
 {id:'doubao-seed-audio',name:'Seed audio 1.0',icon:audioIcons.SEEDANCE,virtual:'seed-audio-1-0',scenes:{'Text-to-Speech':'doubao-seed-audio-1-0'}}
];
export const audioLabels={audioScene:'场景',lyricsMode:'歌词',voice:'音色',stability:'稳定性',promptInfluence:'提示词影响度',loop:'循环',subtitle:'字幕',audioFormat:'输出格式',sampleRate:'采样率',speechRate:'语速',pitchRate:'声调',loudnessRate:'音量'};
export const sceneNames={'Text-to-Speech':'文字转语音',Music:'音乐',Sound:'音效'};
export const audioFields=['audioScene','lyricsMode','lyrics','voice','stability','promptInfluence','loop','subtitle','audioFormat','sampleRate','speechRate','pitchRate','loudnessRate','segments'];
const rates=[-50,-25,0,25,50,100];
const spec={
 'music-2.6':{limit:2000,lyricsLimit:3500,customWithoutPrompt:true,preserveLyrics:true,defaults:{lyricsMode:'auto',lyrics:'',audioFormat:'mp3',sampleRate:44100},options:{lyricsMode:['auto','custom','instrumental'],audioFormat:['mp3','wav'],sampleRate:[16000,24000,32000,44100]}},
 eleven_v3:{limit:3000,defaults:{stability:.5},options:{stability:[0,.5,1]},voice:true},
 music_v1:{limit:4100,defaults:{lyricsMode:'auto',lyrics:'',duration:null},options:{lyricsMode:['auto','custom','instrumental'],duration:[null,30,60]},duration:{min:3,max:300,step:1,key:'music_length_ms',scale:1000}},
 eleven_sound_effect:{limit:1000,defaults:{duration:null,loop:false,promptInfluence:.3},options:{duration:[null,1,5],loop:[false,true],promptInfluence:Array.from({length:11},(_,i)=>i/10)},duration:{min:1,max:22,step:1,key:'duration_seconds'}},
 'sonilo-music':{limit:1000,defaults:{duration:60},options:{duration:[30,60,120]},duration:{min:5,max:360,step:1,key:'duration'},video:true},
 'sonilo-sfx':{limit:2000,defaults:{duration:10},options:{duration:[5,10,30]},duration:{min:.5,max:480,step:.1,key:'duration'},video:true},
 'doubao-seed-audio-1-0':{limit:3000,defaults:{audioFormat:'wav',sampleRate:24000,speechRate:0,pitchRate:0,loudnessRate:0,subtitle:false},options:{audioFormat:['wav','mp3','ogg_opus'],subtitle:[false,true],sampleRate:[8000,16000,24000,32000,44100,48000],speechRate:rates,pitchRate:[-12,-6,-3,0,3,6,12],loudnessRate:rates},images:1,audios:3}
};
const aliases={'eleven-v3':'eleven_v3','eleven-music-v1':'music_v1','eleven-sound-effect':'eleven_sound_effect'};
export function audioModel(value){value=aliases[value]||value;return audioModels.find(m=>m.id===value||m.virtual===value||Object.values(m.scenes).includes(value));}
export function audioWire(draft){const m=audioModel(draft.model);return m?.scenes[draft.audioScene];}
export const audioSpec=draft=>spec[audioWire(draft)];
export function normalizeAudio(draft){
 const model=audioModel(draft.model);if(!model)return {...draft};
 const wire=aliases[draft.model]||draft.model;
 const audioScene=model.scenes[draft.audioScene]?draft.audioScene:Object.entries(model.scenes).find(([,id])=>id===wire)?.[0]||Object.keys(model.scenes)[0];
 const s=spec[model.scenes[audioScene]],next={...draft,model:model.id,audioScene};
 for(const key of [...audioFields,'duration','aspect','imageSize','quality','resolution','generateAudio','videoMode']){
  if(key==='audioScene'||key==='segments'||['promptInfluence','audioFormat'].includes(key)&&['sonilo-music','sonilo-sfx'].includes(model.scenes[audioScene]))continue;
  if(key in s.defaults)next[key]=draft[key]??s.defaults[key];else if(key!=='voice'||!s.voice)delete next[key];
 }
 // Null is an explicit automatic duration, distinct from an omitted override.
 if(s.duration&&draft.duration===null)next.duration=null;
 if(s.duration&&next.duration!==null&&(next.duration<s.duration.min||next.duration>s.duration.max)&&!(['sonilo-music','sonilo-sfx'].includes(model.scenes[audioScene])&&next.audioDurationExplicit))next.duration=s.defaults.duration;
 // Native MiniMax rejects residual lyrics in auto/instrumental mode; keep user input visible.
 if(next.lyricsMode!=='custom'&&!s.preserveLyrics)next.lyrics='';
 if(!('lyricsMode'in next))delete next.lyrics;
 return next;
}
const paramKeys={voice:'voice_id',stability:'stability',promptInfluence:'prompt_influence',loop:'loop',subtitle:'enable_subtitle',audioFormat:'format',sampleRate:'sample_rate',speechRate:'speech_rate',pitchRate:'pitch_rate',loudnessRate:'loudness_rate'};
export function createAudioDraft(args,nodes=[]){
 const source=nodes.find(n=>n.id===args.nodeId)?.audioConfig||{},params=source.params||{};
 const base={kind:args.kind,nodeId:args.nodeId,prompt:source.prompt||'',model:args.model||source.model||'elevenlabs',audioScene:source.scene,audioDurationExplicit:args.duration!==undefined};
 const model=audioModel(base.model),wire=aliases[args.model]||args.model;
 if(args.model)base.audioScene=args.audioScene||Object.entries(model?.scenes||{}).find(([,id])=>id===wire)?.[0]||(model?.scenes[base.audioScene]?base.audioScene:undefined);
 const same=audioWire(normalizeAudio(base))===source.model;
 if(same&&source.model==='music-2.6'&&params.lyric_mode&&params.force_instrumental)throw Error('源音频的自定义歌词与纯音乐参数冲突，请先修正歌词模式');
 if(same){if(params.count!==undefined||params.times!==undefined)base.count=params.count??params.times;if(params.segments!==undefined)base.segments=structuredClone(params.segments);for(const [key,param]of Object.entries(paramKeys))if(params[param]!==undefined)base[key]=params[param];const d=audioSpec(normalizeAudio(base))?.duration;if(d)base.duration=params[d.key]==null?null:params[d.key]/(d.scale||1);base.lyricsMode=params.force_instrumental?'instrumental':params.lyric_mode?'custom':'auto';base.lyrics=params.lyrics||'';}
 return normalizeAudio({...base,...structuredClone(args)});
}
export function audioCompatibility(draft,shape){
 const s=audioSpec(draft);if(!s)return '音频模型或场景未识别';
 if(shape.video)return s.video&&shape.video===1&&!shape.image&&!shape.audio?'':'当前模型不支持这些参考视频';
 if(shape.image>(s.images||0)||shape.audio>(s.audios||0)||shape.image&&shape.audio)return '当前模型不支持这些参考素材';return '';
}
export function audioOptions(draft){return {...audioSpec(draft)?.options,audioScene:Object.keys(audioModel(draft.model)?.scenes||{})};}
// Duration provenance belongs to the local confirmation draft, never tool args.
export function audioSourceVideoState(metadata,draft,nodes=[]){
 const alias=audioWire(draft);if(!['sonilo-sfx','sonilo-music'].includes(alias))return {candidate:false,active:false};
 const refs=(draft.referenceIds??[]).map(id=>nodes.find(node=>node.id===id));
 const video=refs.length===1&&!!refs[0]?.video;if(!video&&alias!=='sonilo-sfx')return {candidate:false,active:false};
 const request={kind:'audio.generate',parameters:{model:alias}},selected=resolveProviderConfiguration(metadata,request);
 if(!metadata)return {candidate:true,active:false,pending:true,label:'视频拟音供应商待确认'};
 const profile=selected?.capabilities?.videoAudio?.[alias]??selected?.capabilities?.music?.[alias];
 if(alias==='sonilo-sfx'&&selected?.protocol==='sonilo-native'){const availability=providerConfigurationStatus(metadata,request);if(availability.configured!==true)return {candidate:true,active:false,reason:availability.message};if(profile?.semantics!=='native'||profile.durationMode!=='source-video-or-explicit')return {candidate:true,active:false,reason:'Sonilo 原生音效身份未明确配置'};
 const parameters={model:alias,virtualModel:'sonilo-music',scene:'Sound',duration:draft.duration,...draft.count!==undefined?{count:draft.count}:{},...draft.segments!==undefined?{segments:draft.segments}:{},...draft.audioFormat!==undefined?{format:draft.audioFormat}:{},...draft.promptInfluence!==undefined?{providerParameters:{prompt_influence:draft.promptInfluence}}:{}};
 const inputs=refs.map(node=>({id:node?.id,type:node?.video?'video':node?.image?'image':node?.audio?'audio':'text',url:node?.video||node?.image||node?.audio,text:node?.content,title:node?.title,...Object.fromEntries(['clip','trim','sourceClip','segments'].filter(key=>node?.[key]!=null).map(key=>[key,node[key]]))}));
 // Optional text/undefined fields are omitted so strict native input validation
 // sees the same video contract that production preparation will submit.
 for(const input of inputs)for(const key of Object.keys(input))if(input[key]===undefined)delete input[key];
 const source=nodes.find(node=>node.id===draft.nodeId)?.audioConfig,check=audioNativeRequestState(metadata,{kind:'audio.generate',prompt:draft.prompt??'',inputs,parameters},{deferVideoDuration:true,...source?.model===alias?{sourceParameters:source.params}:{}});
 if(!check.ready)return {candidate:true,active:video,nativeSfx:true,reason:check.reason,hint:check.hint};
 return {candidate:true,active:video,nativeSfx:true,label:video?'跟随视频':'指定时长',hint:'Sonilo SFX 原生音效：单个 WAV；文字 0.5–180 秒；完整 MP4 本地 0.5–480 秒、50 MB 内；分段仅视频，start/end 连续。'+(video?' 生成前读取真实视频时长。':'')};}
 if(!video&&selected?.protocol==='fal-video-audio-native')return {candidate:true,active:false,reason:'ThinkSound 显式替代需要一个完整 MP4 视频，不支持纯文字音效'};
 if(!video)return {candidate:false,active:false};
 if(alias==='sonilo-music'){if(selected?.protocol!=='sonilo-native')return {candidate:true,active:false};const availability=providerConfigurationStatus(metadata,request);if(availability.configured!==true)return {candidate:true,active:false,reason:availability.message};if(profile?.semantics!=='native'||profile.durationMode!=='source-video-or-explicit')return {candidate:true,active:false,reason:'Sonilo 原生音乐身份未明确配置'};return {candidate:true,active:true,label:'跟随视频',hint:'Sonilo Music 原生音乐：完整 MP4 5–360 秒、50 MB 内；生成前读取真实时长；单任务 1–10 个 WAV 变体。'+(draft.audioDurationExplicit===true?' 明确指定 '+draft.duration+' 秒；提交前须与源视频实测时长一致。':'')};}
 if(selected?.protocol!=='fal-video-audio-native')return {candidate:true,active:false};
 const availability=providerConfigurationStatus(metadata,request);
 if(availability.configured!==true)return {candidate:true,active:false,reason:availability.message};
 if(profile?.semantics!=='explicit-native-alternative'||profile.durationMode!=='source-video')return {candidate:true,active:false,reason:'视频拟音替代身份未明确配置'};
 return {candidate:true,active:true,label:'跟随视频',hint:'实际供应商：ThinkSound Video-to-Audio（显式替代 Sonilo 音效）。生成前读取真实视频时长；未指定时长时跟随源视频。'};
}
export function audioConfirmationArguments(metadata,original,draft,next,nodes=[]){
 const state=audioSourceVideoState(metadata,next,nodes),alias=audioWire(next),selected=resolveProviderConfiguration(metadata,{kind:'audio.generate',parameters:{model:alias}});
 if(alias==='sonilo-sfx'&&selected?.protocol==='sonilo-native'){if(state.reason)throw Error(state.reason);if(Object.keys(original).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','segments','position','audioFormat'].includes(key)))throw Error('Sonilo 原生音效不支持原始 Agent 设置，不会在确认时忽略指令');if(original.count!==undefined&&original.count!==1)throw Error('Sonilo 原生音效每个任务仅生成一个 WAV 结果');if(next.audioFormat!==undefined&&next.audioFormat!=='wav')throw Error('Sonilo 原生音效固定返回 WAV');if(state.active&&original.duration===undefined&&draft.audioDurationExplicit!==true)delete next.duration;return next;}
 if(alias==='sonilo-music'){if(Object.keys(original).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','segments','position','promptInfluence','audioFormat'].includes(key)))throw Error('Sonilo 原生音乐不支持原始 Agent 设置，不会在确认时忽略指令');if(original.count!==undefined&&(!Number.isInteger(original.count)||original.count<1||original.count>10))throw Error('Sonilo 原生音乐单任务数量须为 1–10');if(state.active&&original.duration===undefined&&draft.audioDurationExplicit!==true)delete next.duration;return next;}
 if(state.active&&Object.keys(original).some(key=>!['kind','nodeId','model','audioScene','prompt','referenceIds','duration','count','position'].includes(key)))throw Error('ThinkSound 视频拟音不支持原始 Agent 设置，不会在确认时忽略指令');
 if(state.active&&original.count!==undefined&&original.count!==1)throw Error('ThinkSound 视频拟音每个任务仅生成一个音频结果');
 if(state.active&&original.duration===undefined&&draft.audioDurationExplicit!==true)delete next.duration;
 return next;
}
export function validateAudioDraft(draft,refs=[]){
 const s=audioSpec(draft);if(!s)throw Error('音频模型或场景未识别');
 const reason=audioCompatibility(draft,{image:refs.filter(n=>n.type==='image').length,video:refs.filter(n=>n.type==='video').length,audio:refs.filter(n=>n.type==='audio').length});if(reason)throw Error(reason);
 const prompt=[...refs.filter(n=>n.type==='text').map(n=>n.content),draft.prompt].filter(Boolean).join('\n');
 if(!prompt.trim()&&!(s.customWithoutPrompt&&draft.lyricsMode==='custom')&&!refs.some(n=>n.type==='video'&&s.video))throw Error('请输入生成内容或连接参考视频');
 if(prompt.length>s.limit)throw Error('文字超过 '+s.limit+' 字限制');
 if(draft.lyricsMode==='custom'&&!draft.lyrics?.trim())throw Error('请输入自定义歌词');
 if(draft.lyrics?.length>(s.lyricsLimit||12000))throw Error('歌词不能超过 '+(s.lyricsLimit||12000)+' 字');
 if(s.preserveLyrics&&draft.lyricsMode!=='custom'&&draft.lyrics?.trim())throw Error('自动歌词或纯音乐模式含有自定义歌词，请清空歌词或选择自定义');
 for(const [key,values]of Object.entries(s.options||{})){
  const value=draft[key];if(key==='duration')continue;
  const range=({speechRate:[-50,100],pitchRate:[-12,12],loudnessRate:[-50,100],promptInfluence:[0,1]})[key];
  if(value!==undefined&&(range?(!Number.isFinite(value)||value<range[0]||value>range[1]):!values.includes(value)))throw Error('音频参数无效：'+(audioLabels[key]||key));
 }
 if(draft.count!==undefined&&(!Number.isInteger(draft.count)||draft.count<1||draft.count>(audioWire(draft)==='sonilo-music'?10:1)))throw Error('当前音频模型数量超出支持范围');
 if(s.duration){const v=draft.duration;if(v===undefined&&['sonilo-music','sonilo-sfx'].includes(audioWire(draft))&&refs.length===1&&refs[0].video)return;if(v===null&&!s.options.duration.includes(null))throw Error('当前模型需要指定时长');if(v!==null&&(!Number.isFinite(v)||v<s.duration.min||v>s.duration.max))throw Error('音频时长超出支持范围');}
}
export function audioRequestConfig(core,current,overrides){
 const draft=createAudioDraft(overrides,[{id:overrides.nodeId,audioConfig:current}]);
 if(audioWire(draft)==='music-2.6'&&draft.lyricsMode!=='custom'&&draft.lyrics?.trim())throw Error('自动歌词或纯音乐模式含有自定义歌词，请清空歌词或选择自定义');
 const model=audioModel(draft.model);if(!model)throw Error('音频模型未识别，请选择支持的模型');const target=core.transition({},model.virtual,draft.audioScene);target.prompt=draft.prompt;
 for(const [key,param]of Object.entries(paramKeys))if(draft[key]!==undefined&&!(['sonilo-music','sonilo-sfx'].includes(audioWire(draft))&&key==='promptInfluence'))target.params[param]=draft[key];
 if(draft.lyricsMode){target.params.lyric_mode=draft.lyricsMode==='custom';target.params.force_instrumental=draft.lyricsMode==='instrumental';target.params.lyrics=draft.lyricsMode==='custom'?draft.lyrics:'';}
 for(const key of ['count','segments'])if(draft[key]!==undefined)target.params[key]=structuredClone(draft[key]);
 if(['sonilo-music','sonilo-sfx'].includes(audioWire(draft))&&draft.promptInfluence!==undefined)target.params.providerParameters={...target.params.providerParameters,prompt_influence:draft.promptInfluence};
 const duration=audioSpec(draft).duration;if(duration){if(draft.duration===null)delete target.params[duration.key];else target.params[duration.key]=draft.duration*(duration.scale||1);}
 target.references=current.references||[];return target;
}
export function snapshotAudioCall(call,state){
 if(call.name!=='generation_submit'||call.args.kind!=='audio.generate'||call.args.referenceIds!==undefined)return call;
 const node=state.nodes.find(n=>n.id===call.args.nodeId),ids=[...(node?.audioConfig?.references||[]).map(r=>r.id),...state.edges.filter(e=>e.target===call.args.nodeId).map(e=>e.source)];
 return {...call,originalArgs:structuredClone(call.args),args:{...call.args,referenceIds:[...new Set(ids)]}};
}
