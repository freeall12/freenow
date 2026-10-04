'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createElevenLabsMusicProvider}=require('../server/generation-elevenlabs-music.cjs');
const ready=import('../src/features/audio-generation/native-profile.mjs'),metadata=createElevenLabsMusicProvider({apiKey:'synthetic-key'}).metadata;
const request={kind:'audio.generate',parameters:{model:'music_v1',scene:'Music',lyric_mode:true,force_instrumental:false,lyrics:'第一行\n第二行',music_length_ms:47000}};
test('native public direct+routed profile provides early custom duration and line limits',async()=>{
 const module=await ready,routed={protocol:'routed',configured:true,providers:{music:metadata},routes:{'audio.generate':{models:{music_v1:'music'}}}};
 for(const config of [metadata,routed]){assert.equal(module.audioNativeProfile(config,request).customLyrics.duration.max,120);assert.equal(module.audioNativeRequestState(config,request).ready,true);for(const duration of [undefined,null,121000,47000.1]){const value=module.audioNativeRequestState(config,{...request,parameters:{...request.parameters,music_length_ms:duration}});assert.equal(value.ready,false);assert.match(value.reason,/3–120/);}assert.equal(module.audioNativeRequestState(config,{...request,parameters:{...request.parameters,lyrics:'a'.repeat(201)}}).ready,false);assert.equal(module.audioNativeRequestState(config,{...request,parameters:{...request.parameters,lyrics:Array(31).fill('行').join('\n')}}).ready,false);}
});
test('native node draft lyrics stay in local config but only active mode reaches wire; explicit Agent conflict preserved',async()=>{
 const module=await ready,parameters={...request.parameters,lyric_mode:false,force_instrumental:true},draft={...request,parameters};
 const prepared=module.audioNativeParameters(metadata,draft,{nodeDraft:true});assert.equal(prepared.lyrics,'');assert.equal(parameters.lyrics,request.parameters.lyrics);assert.equal(module.audioNativeRequestState(metadata,draft,{nodeDraft:true}).ready,true);
 assert.equal(module.audioNativeRequestState(metadata,draft).ready,false);assert.throws(()=>module.audioNativeParameters(metadata,draft,{explicitOverrides:{lyricsMode:'instrumental',lyrics:'explicit'}}),{code:'unsupported_generation',providerDispatched:false});assert.equal(module.audioNativeParameters(metadata,request,{explicitOverrides:{lyricsMode:'custom',lyrics:'explicit'}}).lyrics,request.parameters.lyrics);
});
test('tasks gateway and custom providers keep their own contract, regardless native-only bounds',async()=>{
 const module=await ready,gateway={protocol:'tasks-v1',configured:true},long={...request,parameters:{...request.parameters,music_length_ms:300000}};
 assert.equal(module.audioNativeRequestState(gateway,long).ready,true);assert.equal(module.audioNativeProfile(gateway,long),null);assert.deepEqual(module.audioNativeParameters(gateway,long,{nodeDraft:true}),long.parameters);
 assert.equal(module.audioNativeRequestState(null,long).ready,true);
});
test('public availability/configuration rejects unconfigured, custom-auto and explicit conflict before GenerationAPI.submit',async()=>{
 const module=await ready;let submitted=0;
 for(const mode of ['unconfigured','automatic','explicit']){const api={availability:async()=>mode==='unconfigured'?{configured:false,reason:'未配置Music'}:{configured:true},configuration:async()=>metadata,submit:()=>submitted++};const value={...request,parameters:{...request.parameters,...(mode==='automatic'?{music_length_ms:null}:mode==='explicit'?{lyric_mode:false}:{})}};
 await assert.rejects(module.prepareAudioNativeRequest(api,value,{explicitOverrides:mode==='explicit'?{lyrics:'explicit',lyricsMode:'auto'}:undefined}).then(req=>api.submit(req)),error=>error.providerDispatched===false);}
 assert.equal(submitted,0);
});
test('production generate button shows native hint and disables unsupported input before click',async()=>{
 const module=await ready,source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' function updateGenerateState(){'),end=source.indexOf('\n function position(){',start),button={disabled:false,title:''},status={textContent:'',dataset:{}},panel={querySelector:selector=>selector==='.audio-generate'?button:status,setAttribute(){}};
 const config={model:'music_v1',scene:'Music',virtualModel:'elevenlabs-v3',prompt:'音乐',params:{...request.parameters,music_length_ms:null}};
 const context={panel,current:{id:'source'},config,core:{validate(){},specs:{music_v1:{duration:{min:3,max:300}}}},refsForRequest:()=>[],generationBusy:()=>false,lastGenerationBusy:null,audioNativeModule:module,audioNativeMetadata:metadata,audioNativePending:false,audioNativeError:'',audioNativeAvailability:{configured:true},refreshAudioNativeProfile(){},generationAction:null};vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nupdateGenerateState();',context);assert.equal(button.disabled,true);assert.match(status.textContent,/不能使用自动时长/);config.params.music_length_ms=47000;context.updateGenerateState();assert.equal(button.disabled,false);assert.match(status.textContent,/3–120 秒/);config.params.lyric_mode=false;config.params.force_instrumental=true;context.updateGenerateState();assert.equal(button.disabled,false);assert.equal(config.params.lyrics,request.parameters.lyrics);assert.match(status.textContent,/3–300 秒/);context.audioNativeAvailability={configured:false,reason:'缺少Key'};context.updateGenerateState();assert.equal(button.disabled,true);assert.equal(status.textContent,'缺少Key');
});
const {createMurekaProvider}=require('../server/generation-mureka.cjs'),{createSeedAudioProvider}=require('../server/generation-seed-audio.cjs');
const murekaMetadata=createMurekaProvider({apiKey:'synthetic-ui-mureka-key'}).metadata,seedMetadata=createSeedAudioProvider({apiKey:'synthetic-ui-seed-key'}).metadata;
const mureka={kind:'audio.generate',prompt:'描述',inputs:[],parameters:{model:'mureka-8',scene:'Music',virtualModel:'mureka-v8',lyric_mode:false,lyrics:''}};
const seed={kind:'audio.generate',prompt:'朗读你好',inputs:[],parameters:{model:'doubao-seed-audio-1-0',scene:'Text-to-Speech',virtualModel:'seed-audio-1-0',format:'wav',sample_rate:24000,speech_rate:0,pitch_rate:0,loudness_rate:0,enable_subtitle:false}};
const changed=(request,parameters={},extra={})=>({...request,...extra,parameters:{...request.parameters,...parameters}});
test('Mureka route metadata limits prompt and lyrics by mode, combines text once and retains node draft',async()=>{
 const module=await ready,routed={protocol:'routed',configured:true,providers:{mureka:murekaMetadata},routes:{'audio.generate':{models:{'mureka-8':'mureka','mureka-o2':'mureka'}}}};
 for(const config of [murekaMetadata,routed]){
  assert.equal(module.audioNativeProfile(config,mureka).maxPromptCharacters,2000);
  assert.equal(module.audioNativeRequestState(config,changed(mureka,{}, {prompt:'😀'.repeat(2000)})).ready,true);
  assert.equal(module.audioNativeRequestState(config,changed(mureka,{}, {prompt:'a'.repeat(2001)})).ready,false);
  const custom=changed(mureka,{lyric_mode:true,lyrics:'a'.repeat(5000)},{prompt:'a'.repeat(1024)});assert.equal(module.audioNativeRequestState(config,custom).ready,true);
  assert.equal(module.audioNativeRequestState(config,changed(custom,{}, {prompt:'a'.repeat(1025)})).ready,false);assert.equal(module.audioNativeRequestState(config,changed(custom,{lyrics:'a'.repeat(5001)})).ready,false);
  const refs=[{type:'text',text:'x'.repeat(1000)}],description='x'.repeat(1000)+'\n'+'y'.repeat(999);assert.equal(module.audioNativeRequestState(config,changed(mureka,{}, {prompt:description,inputs:refs})).ready,true);assert.equal(module.audioNativeRequestState(config,changed(mureka,{}, {prompt:'y'.repeat(1000),inputs:refs})).ready,false);
  for(const p of [{duration:60},{music_length_ms:60000},{force_instrumental:false},{force_instrumental:true},{format:'mp3'},{count:2}])assert.equal(module.audioNativeRequestState(config,changed(mureka,p)).ready,false);
  const draft=changed(mureka,{lyrics:'保留本地草稿'});assert.equal(module.audioNativeParameters(config,draft,{nodeDraft:true}).lyrics,'');assert.equal(draft.parameters.lyrics,'保留本地草稿');assert.equal(module.audioNativeRequestState(config,draft,{nodeDraft:true}).ready,true);assert.equal(module.audioNativeRequestState(config,draft).ready,false);
 }
 assert.equal(module.audioNativeRequestState({protocol:'tasks-v1',configured:true},changed(mureka,{duration:60,force_instrumental:true},{prompt:'x'.repeat(4100)})).ready,true);
});
test('Seed formats keep original parameters and reject unsupported rates, decimal controls and subtitle combinations',async()=>{
 const module=await ready;
 for(const [format,rates]of Object.entries(seedMetadata.capabilities.seedAudio['doubao-seed-audio-1-0'].sampleRates))for(const sample_rate of rates){const request=changed(seed,{format,sample_rate,enable_subtitle:true});assert.equal(module.audioNativeRequestState(seedMetadata,request).ready,true);assert.deepEqual(module.audioNativeParameters(seedMetadata,request),request.parameters);}
 for(const p of [{format:'ogg_opus',sample_rate:24000},{format:'mp3',sample_rate:40000},{format:'pcm'},{response_format:'mp3'},{speech_rate:100.1},{speech_rate:-51},{pitch_rate:12.1},{pitch_rate:13},{loudness_rate:101},{loudness_rate:'0'},{enable_subtitle:1},{duration:20},{lyrics:'unavailable'},{count:2}])assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,p)).ready,false,JSON.stringify(p));
 const unsupported=changed(seed,{format:'ogg_opus',sample_rate:24000});assert.match(module.audioNativeRequestState(seedMetadata,unsupported).reason,/48000/);assert.equal(unsupported.parameters.sample_rate,24000);
 assert.equal(module.audioNativeRequestState({protocol:'tasks-v1',configured:true},unsupported).ready,true);
});
test('Seed reference shapes, known duration, inline size/MIME and text audio bindings are checked without media reads',async()=>{
 const module=await ready,audio={type:'audio',url:'asset:local',duration:30},image={type:'image',url:'asset:image'};
 for(const inputs of [[audio],[audio,audio,audio],[image]])assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {inputs})).ready,true);
 for(const inputs of [[audio,image],Array(4).fill(audio),[image,image],[{type:'video',url:'asset:video'}],[{...audio,duration:30.01}],[{type:'image',url:'data:image/png;base64,AAAA'}],[{type:'audio',url:'data:audio/flac;base64,AAAA'}],[{type:'audio',url:'data:audio/wav;base64,!'}]])assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {inputs})).ready,false);
 assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {inputs:[{...audio,url:'https://cdn.example/reference.wav',duration:999}]})).ready,true);
 for(const key of ['clip','trim','sourceClip'])for(const input of [audio,image,{...audio,url:'https://cdn.example/reference.wav'}]){const result=module.audioNativeRequestState(seedMetadata,changed(seed,{}, {inputs:[{...input,[key]:{start:0,end:.5}}]}));assert.equal(result.ready,false);assert.match(result.reason,/选区须先物化/);}
 assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {prompt:'@音频1 你好',inputs:[audio]})).ready,true);assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {prompt:'@音频2 你好',inputs:[audio]})).ready,false);
 assert.equal(module.audioNativeRequestState(seedMetadata,changed(seed,{}, {prompt:'x'.repeat(3000),inputs:[{type:'text',text:'额外文字'}]})).ready,false);
});
test('production buildRequest native preflight stops invalid Seed and Mureka before LocalAssets and retains async source guard',async()=>{
 const module=await ready,core=require('../audio-core.js'),source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start),body=source.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest');
 for(const mode of ['seed-invalid','seed-clip','seed-trim','seed-sourceClip','seed-source-edit','mureka-invalid','mureka-auto-draft']){
  const audioConfig=mode.startsWith('seed')?core.transition({prompt:'朗读'},'seed-audio-1-0','Text-to-Speech'):core.transition({prompt:mode==='mureka-invalid'?'x'.repeat(2001):'描述'},'mureka-v8','Music');
  if(mode==='seed-invalid')Object.assign(audioConfig.params,{format:'ogg_opus',sample_rate:24000});if(mode==='mureka-auto-draft')audioConfig.params.lyrics='原歌词草稿';
  const node={id:'source',type:'audio',audioConfig},ref={id:'ref',type:'audio',audio:'asset:reference',audioDuration:1};if(mode.startsWith('seed'))node.audioConfig.references=[{id:'ref',type:'audio'}];
  if(['seed-clip','seed-trim','seed-sourceClip'].includes(mode))ref[mode.slice(5)]={start:0,end:.5};
  const state={nodes:[node,ref],edges:[]};let assetReads=0,release;const held=new Promise(resolve=>{release=resolve;}),metadata=mode.startsWith('seed')?seedMetadata:murekaMetadata;
  const context={app:{getState:()=>state,projectIdentity:()=>({id:'project'})},core,nativeUnderTest:module,drafts:new Map(),saveTimers:new Map(),structuredClone,window:{GenerationAPI:{availability:async()=>{if(mode==='seed-source-edit')await held;return {configured:true};},configuration:async()=>metadata},LocalAssets:{url:async()=>{assetReads++;throw Error('must not read invalid input');}}}};vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
  const pending=context.buildUnderTest('source');if(mode==='seed-source-edit'){await new Promise(resolve=>setImmediate(resolve));node.audioConfig.prompt='用户改了';release();}
  if(mode==='mureka-auto-draft'){const output=await pending;assert.equal(output.parameters.lyrics,'');assert.equal(node.audioConfig.params.lyrics,'原歌词草稿');}else await assert.rejects(pending);
  assert.equal(assetReads,0);
 }
});
test('production Seed button reflects format-rate changes immediately and preserves failure messaging',async()=>{
 const module=await ready,core=require('../audio-core.js'),source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' function updateGenerateState(){'),end=source.indexOf('\n function position(){',start),button={disabled:false,title:''},status={textContent:'',dataset:{}},panel={querySelector:selector=>selector==='.audio-generate'?button:status,setAttribute(){}};
 const config=core.transition({prompt:'你好'},'seed-audio-1-0','Text-to-Speech'),references=[];Object.assign(config.params,{format:'ogg_opus',sample_rate:24000});const context={panel,current:{id:'source'},config,core,referenceNodes:()=>references,generationBusy:()=>false,lastGenerationBusy:null,audioNativeModule:module,audioNativeMetadata:seedMetadata,audioNativePending:false,audioNativeError:'',audioNativeAvailability:{configured:true},refreshAudioNativeProfile(){},generationAction:null};vm.createContext(context);const refsStart=source.indexOf(' function refsForRequest(){'),refsEnd=source.indexOf(' function picker(',refsStart);vm.runInContext(source.slice(refsStart,refsEnd)+source.slice(start,end)+'\nupdateGenerateState();',context);assert.equal(button.disabled,true);assert.match(status.textContent,/48000/);assert.equal(config.params.sample_rate,24000);config.params.sample_rate=48000;context.updateGenerateState();assert.equal(button.disabled,false);references.push({id:'ref',type:'audio',audio:'asset:reference',audioDuration:1,clip:{start:0,end:.5}});context.updateGenerateState();assert.equal(button.disabled,true);assert.match(status.textContent,/选区须先物化/);delete references[0].clip;context.updateGenerateState();assert.equal(button.disabled,false);context.audioNativeError='供应商状态未确认，未重试';context.updateGenerateState();assert.equal(status.textContent,context.audioNativeError);
});
