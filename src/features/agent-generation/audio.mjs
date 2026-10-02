import {audioIcons} from './audio-assets.mjs';
// Official Agent UT registry and Xw/uZe schema, release eb1c357. Node UI keeps its own limits.
export const audioModels=[
 {id:'elevenlabs',name:'ElevenLabs V3',icon:audioIcons.ELEVENLAB,virtual:'elevenlabs-v3',scenes:{'Text-to-Speech':'eleven_v3',Music:'music_v1',Sound:'eleven_sound_effect'}},
 {id:'sonilo',name:'Sonilo Music',icon:audioIcons.SONILO,virtual:'sonilo-music',scenes:{Music:'sonilo-music',Sound:'sonilo-sfx'}},
 {id:'doubao-seed-audio',name:'Seed audio 1.0',icon:audioIcons.SEEDANCE,virtual:'seed-audio-1-0',scenes:{'Text-to-Speech':'doubao-seed-audio-1-0'}}
];
export const audioLabels={audioScene:'场景',lyricsMode:'歌词',voice:'音色',stability:'稳定性',promptInfluence:'提示词影响度',loop:'循环',subtitle:'字幕',audioFormat:'输出格式',sampleRate:'采样率',speechRate:'语速',pitchRate:'声调',loudnessRate:'音量'};
export const sceneNames={'Text-to-Speech':'文字转语音',Music:'音乐',Sound:'音效'};
export const audioFields=['audioScene','lyricsMode','lyrics','voice','stability','promptInfluence','loop','subtitle','audioFormat','sampleRate','speechRate','pitchRate','loudnessRate'];
const rates=[-50,-25,0,25,50,100];
const spec={
 eleven_v3:{limit:3000,defaults:{stability:.5},options:{stability:[0,.5,1]},voice:true},
 music_v1:{limit:4100,defaults:{lyricsMode:'auto',lyrics:'',duration:null},options:{lyricsMode:['auto','custom','instrumental'],duration:[null,30,60]},duration:{min:3,max:300,step:1,key:'music_length_ms',scale:1000}},
 eleven_sound_effect:{limit:1000,defaults:{duration:null,loop:false,promptInfluence:.3},options:{duration:[null,1,5],loop:[false,true],promptInfluence:Array.from({length:11},(_,i)=>i/10)},duration:{min:1,max:22,step:1,key:'duration_seconds'}},
 'sonilo-music':{limit:1000,defaults:{duration:60},options:{duration:[30,60,120]},duration:{min:5,max:360,step:1,key:'duration'},video:true},
 'sonilo-sfx':{limit:2000,defaults:{duration:10},options:{duration:[5,10,30]},duration:{min:1,max:180,step:1,key:'duration'},video:true},
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
 for(const key of [...audioFields,'duration','aspect','imageSize','quality','count','resolution','generateAudio','videoMode']){
  if(key==='audioScene')continue;
  if(key in s.defaults)next[key]=draft[key]??s.defaults[key];else if(key!=='voice'||!s.voice)delete next[key];
 }
 // Null is an explicit automatic duration, distinct from an omitted override.
 if(s.duration&&draft.duration===null)next.duration=null;
 if(s.duration&&next.duration!==null&&(next.duration<s.duration.min||next.duration>s.duration.max))next.duration=s.defaults.duration;
 if(next.lyricsMode!=='custom')next.lyrics='';
 if(!('lyricsMode'in next))delete next.lyrics;
 return next;
}
const paramKeys={voice:'voice_id',stability:'stability',promptInfluence:'prompt_influence',loop:'loop',subtitle:'enable_subtitle',audioFormat:'format',sampleRate:'sample_rate',speechRate:'speech_rate',pitchRate:'pitch_rate',loudnessRate:'loudness_rate'};
export function createAudioDraft(args,nodes=[]){
 const source=nodes.find(n=>n.id===args.nodeId)?.audioConfig||{},params=source.params||{};
 const base={kind:args.kind,nodeId:args.nodeId,prompt:source.prompt||'',model:args.model||source.model||'elevenlabs',audioScene:source.scene};
 const model=audioModel(base.model),wire=aliases[args.model]||args.model;
 if(args.model)base.audioScene=args.audioScene||Object.entries(model?.scenes||{}).find(([,id])=>id===wire)?.[0]||(model?.scenes[base.audioScene]?base.audioScene:undefined);
 const same=audioWire(normalizeAudio(base))===source.model;
 if(same){for(const [key,param]of Object.entries(paramKeys))if(params[param]!==undefined)base[key]=params[param];const d=audioSpec(normalizeAudio(base))?.duration;if(d)base.duration=params[d.key]==null?null:params[d.key]/(d.scale||1);base.lyricsMode=params.force_instrumental?'instrumental':params.lyric_mode?'custom':'auto';base.lyrics=params.lyrics||'';}
 return normalizeAudio({...base,...structuredClone(args)});
}
export function audioCompatibility(draft,shape){
 const s=audioSpec(draft);if(!s)return '音频模型或场景未识别';
 if(shape.video)return s.video&&shape.video===1&&!shape.image&&!shape.audio?'':'当前模型不支持这些参考视频';
 if(shape.image>(s.images||0)||shape.audio>(s.audios||0)||shape.image&&shape.audio)return '当前模型不支持这些参考素材';return '';
}
export function audioOptions(draft){return {...audioSpec(draft)?.options,audioScene:Object.keys(audioModel(draft.model)?.scenes||{})};}
export function validateAudioDraft(draft,refs=[]){
 const s=audioSpec(draft);if(!s)throw Error('音频模型或场景未识别');
 const reason=audioCompatibility(draft,{image:refs.filter(n=>n.type==='image').length,video:refs.filter(n=>n.type==='video').length,audio:refs.filter(n=>n.type==='audio').length});if(reason)throw Error(reason);
 const prompt=[...refs.filter(n=>n.type==='text').map(n=>n.content),draft.prompt].filter(Boolean).join('\n');
 if(!prompt.trim()&&!refs.some(n=>n.type==='video'&&s.video))throw Error('请输入生成内容或连接参考视频');
 if(prompt.length>s.limit)throw Error('文字超过 '+s.limit+' 字限制');
 if(draft.lyricsMode==='custom'&&!draft.lyrics?.trim())throw Error('请输入自定义歌词');
 if(draft.lyrics?.length>12000)throw Error('歌词不能超过 12000 字');
 for(const [key,values]of Object.entries(s.options||{})){
  const value=draft[key];if(key==='duration')continue;
  const range=({speechRate:[-50,100],pitchRate:[-12,12],loudnessRate:[-50,100],promptInfluence:[0,1]})[key];
  if(value!==undefined&&(range?(!Number.isFinite(value)||value<range[0]||value>range[1]):!values.includes(value)))throw Error('音频参数无效：'+(audioLabels[key]||key));
 }
 if(s.duration){const v=draft.duration;if(v===null&&!s.options.duration.includes(null))throw Error('当前模型需要指定时长');if(v!==null&&(!Number.isFinite(v)||v<s.duration.min||v>s.duration.max))throw Error('音频时长超出支持范围');}
}
export function audioRequestConfig(core,current,overrides){
 const draft=createAudioDraft(overrides,[{id:overrides.nodeId,audioConfig:current}]);
 const model=audioModel(draft.model);if(!model)throw Error('音频模型未识别，请选择支持的模型');const target=core.transition({},model.virtual,draft.audioScene);target.prompt=draft.prompt;
 for(const [key,param]of Object.entries(paramKeys))if(draft[key]!==undefined)target.params[param]=draft[key];
 if(draft.lyricsMode){target.params.lyric_mode=draft.lyricsMode==='custom';target.params.force_instrumental=draft.lyricsMode==='instrumental';target.params.lyrics=draft.lyricsMode==='custom'?draft.lyrics:'';}
 const duration=audioSpec(draft).duration;if(duration){if(draft.duration===null)delete target.params[duration.key];else target.params[duration.key]=draft.duration*(duration.scale||1);}
 target.references=current.references||[];return target;
}
export function snapshotAudioCall(call,state){
 if(call.name!=='generation_submit'||call.args.kind!=='audio.generate'||call.args.referenceIds!==undefined)return call;
 const node=state.nodes.find(n=>n.id===call.args.nodeId),ids=[...(node?.audioConfig?.references||[]).map(r=>r.id),...state.edges.filter(e=>e.target===call.args.nodeId).map(e=>e.source)];
 return {...call,originalArgs:structuredClone(call.args),args:{...call.args,referenceIds:[...new Set(ids)]}};
}
