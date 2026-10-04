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
