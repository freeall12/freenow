/* Original public catalog values; providers remain replaceable. */
(function(root){
 'use strict';
 const models=[
  {id:'seed-audio-1-0',name:'Seed audio 1.0',scenes:{'Text-to-Speech':'doubao-seed-audio-1-0'}},
  {id:'minimax-music-26',name:'MiniMax Music 2.6',scenes:{Music:'music-2.6'}},
  {id:'elevenlabs-v3',name:'ElevenLabs V3',scenes:{'Text-to-Speech':'eleven_v3',Music:'music_v1',Sound:'eleven_sound_effect'}},
  {id:'mureka-v8',name:'Mureka V8',scenes:{Music:'mureka-8'}},
  {id:'mureka-o2',name:'Mureka O2',scenes:{Music:'mureka-o2'}},
  {id:'sonilo-music',name:'Sonilo Music',scenes:{Music:'sonilo-music',Sound:'sonilo-sfx'}}
 ];
 const specs={
  'doubao-seed-audio-1-0':{limit:3000,images:1,audios:3,mixed:false,defaults:{format:'wav',sample_rate:24000,speech_rate:0,pitch_rate:0,loudness_rate:0,enable_subtitle:false}},
  'music-2.6':{limit:3500,lyrics:true,instrumental:true,defaults:{lyric_mode:false,force_instrumental:false,lyrics:''}},
  eleven_v3:{limit:3000,voice:true,defaults:{stability:.5}},
  music_v1:{limit:4100,lyrics:true,instrumental:true,duration:{key:'music_length_ms',scale:1000,min:3,max:300,presets:[null,30,60]},defaults:{lyric_mode:false,force_instrumental:false,lyrics:''}},
  eleven_sound_effect:{limit:1000,duration:{key:'duration_seconds',min:.5,max:30,presets:[null,1,5]},defaults:{loop:false,prompt_influence:.3}},
  'mureka-8':{limit:4100,lyrics:true,defaults:{lyric_mode:false,lyrics:''}},
  'mureka-o2':{limit:4100,lyrics:true,defaults:{lyric_mode:false,lyrics:''}},
  'sonilo-music':{limit:1000,video:true,duration:{key:'duration',min:5,max:360,presets:[30,60,120]},defaults:{duration:60}},
  'sonilo-sfx':{limit:2000,video:true,maxVideoDuration:180,duration:{key:'duration',min:1,max:180,presets:[5,10,30]},defaults:{duration:10}}
 };
 const scenes={'Text-to-Speech':'文字转语音',Music:'音乐',Sound:'音效'};
 function transition(current={},virtual=current.virtualModel||'mureka-v8',scene=current.scene||'Music'){
  const entry=models.find(m=>m.id===virtual);if(!entry)throw Error('未知音频模型');
  if(!entry.scenes[scene])scene=Object.keys(entry.scenes)[0];const model=entry.scenes[scene];
  return {virtualModel:virtual,scene,model,prompt:current.prompt||'',params:{...structuredClone(specs[model].defaults),...(current.model===model?current.params:{})},references:(current.references||[]).filter(ref=>compatible(model,ref.type))};
 }
 function compatible(model,type){const s=specs[model];return type==='text'||type==='video'&&!!s.video||type==='image'&&!!s.images||type==='audio'&&!!s.audios;}
 function validate(config,refs=[]){const s=specs[config.model];if(!s)throw Error('未知音频模型');const prompt=[...refs.filter(r=>r.type==='text').map(r=>r.text),config.prompt].filter(Boolean).join('\n');
  if(!prompt.trim()&&!refs.some(r=>r.type==='video'&&s.video))throw Error('请输入生成内容或连接参考视频');if(prompt.length>s.limit)throw Error('文字超过 '+s.limit+' 字限制');
  if(refs.some(r=>!compatible(config.model,r.type)))throw Error('当前模型不支持该参考素材');
  const images=refs.filter(r=>r.type==='image').length,audios=refs.filter(r=>r.type==='audio').length,videos=refs.filter(r=>r.type==='video').length;
  if(images>(s.images||0)||audios>(s.audios||0)||videos>1)throw Error('参考素材数量超过模型限制');if(s.mixed===false&&images&&audios)throw Error('参考图片和参考音频不能混用');
  if(s.maxVideoDuration&&refs.some(r=>r.type==='video'&&r.duration>s.maxVideoDuration))throw Error('源视频超过 '+s.maxVideoDuration+' 秒上限');
  if(s.lyrics&&config.params.lyric_mode&&!config.params.force_instrumental&&!config.params.lyrics?.trim())throw Error('请输入自定义歌词');
  const duration=s.duration,value=duration&&config.params[duration.key];if(value!=null&&(!Number.isFinite(value)||value/(duration.scale||1)<duration.min||value/(duration.scale||1)>duration.max))throw Error('音频时长超出支持范围');
  return prompt;
 }
 function peaks(channels,count=100){if(!channels.length||!channels[0].length)return [];const length=channels[0].length,bins=Math.max(1,Math.min(length,Math.round(count)));return Array.from({length:bins},(_,i)=>{let peak=0;const start=Math.floor(i*length/bins),end=Math.floor((i+1)*length/bins);for(const data of channels)for(let j=start;j<end;j++)peak=Math.max(peak,Math.abs(data[j]||0));return Math.min(1,peak);});}
 function validateFile(file){if(file.size>50*1024*1024)throw Error('音频大小不能超过 50MB');if(!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name))throw Error('不支持的音频格式');if(!file.size)throw Error('音频文件为空');}
 const api={models,specs,scenes,transition,compatible,validate,peaks,validateFile};if(typeof module!=='undefined')module.exports=api;else root.AudioCore=api;
})(typeof window!=='undefined'?window:globalThis);
