'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../audio-core.js'),{createVideoAudioProvider}=require('../server/generation-video-audio.cjs');
const ready=import('../src/features/audio-generation/native-profile.mjs');
const metadata=createVideoAudioProvider({apiKey:'synthetic-video-audio-ui-key',modelMap:{'sonilo-sfx':{kind:'audio.generate',model:'fal-ai/thinksound/audio',semantics:'explicit-native-alternative'}}}).metadata;
const video={id:'reference',type:'video',url:'asset:video',duration:4};
// UI contract fixtures mock native video metadata events and byte conversion.
// They do not prove MP4 decoding, supplier execution, or playable output.
const request={kind:'audio.generate',prompt:'',inputs:[video],parameters:{model:'sonilo-sfx',virtualModel:'sonilo-music',scene:'Sound',duration:4}};
const changed=(parameters={},extra={})=>({...request,...extra,parameters:{...request.parameters,...parameters}});
const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8');
test('ThinkSound direct and routed public profiles disclose the explicit alternative and require one complete video',async()=>{
 const module=await ready,routed={protocol:'routed',configured:true,providers:{videoAudio:metadata},routes:{'audio.generate':{models:{'sonilo-sfx':'videoAudio'}}}};
 for(const config of [metadata,routed]){
  const profile=module.audioNativeProfile(config,request);assert.equal(profile.semantics,'explicit-native-alternative');assert.equal(profile.providerMaxVideoDuration,null);
  const state=module.audioNativeRequestState(config,request);assert.equal(state.ready,true);assert.match(state.hint,/ThinkSound.*显式替代 Sonilo/);assert.match(state.hint,/供应商未公开最大时长/);
  for(const inputs of [[],[video,video],[{type:'text',text:'描述'}],[video,{type:'text',text:'附加'}],[{...video,url:''}]])assert.equal(module.audioNativeRequestState(config,changed({}, {inputs})).ready,false);
  for(const key of ['clip','trim','sourceClip','segments'])for(const location of ['input','request','parameters']){const extra=location==='input'?{inputs:[{...video,[key]:{start:0,end:1}}]}:location==='request'?{[key]:{start:0,end:1}}:{};assert.equal(module.audioNativeRequestState(config,changed(location==='parameters'?{[key]:{start:0,end:1}}:{},extra)).ready,false,key+':'+location);}
  for(const parameters of [{scene:'Music'},{count:2},{times:2},{loop:false},{enable_subtitle:false},{lyrics:''},{format:'wav'},{duration:5},{providerParameters:{num_inference_steps:1}},{providerParameters:{cfg_scale:21}},{providerParameters:{seed:.1}}])assert.equal(module.audioNativeRequestState(config,changed(parameters)).ready,false,JSON.stringify(parameters));
  assert.equal(module.audioNativeRequestState(config,changed({providerParameters:{model:'sonilo-sfx',seed:null,num_inference_steps:2,cfg_scale:1}})).ready,true);
 }
 assert.equal(module.audioNativeRequestState({protocol:'tasks-v1',configured:true},changed({loop:true},{inputs:[],prompt:'通用网关描述'})).ready,true,'generic Sonilo semantics stay unchanged');
});
test('video duration is deferred only for node preview; final and explicit Agent durations are checked without dropping settings',async()=>{
 const module=await ready,unknown=changed({duration:10},{inputs:[{...video,duration:undefined}]});
 assert.equal(module.audioNativeRequestState(metadata,unknown,{deferVideoDuration:true}).ready,true);
 assert.equal(module.audioNativeRequestState(metadata,unknown).ready,false);
 for(const duration of [NaN,Infinity,0,.99,180.01])assert.equal(module.audioNativeRequestState(metadata,changed({duration},{inputs:[{...video,duration}]}),{deferVideoDuration:true}).ready,false);
 for(const duration of [1,180])assert.equal(module.audioNativeRequestState(metadata,changed({duration},{inputs:[{...video,duration}]})).ready,true);
 for(const overrides of [{loop:false},{subtitle:false},{lyrics:''},{audioFormat:'wav'},{count:2},{duration:5},{duration:null}])assert.equal(module.audioNativeRequestState(metadata,request,{explicitOverrides:overrides}).ready,false,JSON.stringify(overrides));
 assert.equal(module.audioNativeRequestState(metadata,request,{explicitOverrides:{kind:'audio.generate',nodeId:'source',model:'sonilo',audioScene:'Sound',duration:4,prompt:'',referenceIds:['reference']}}).ready,true);
 const options={sourceParameters:{duration:10,providerParameters:{seed:123}}};
 assert.deepEqual(module.applyAudioNativeConfiguration(metadata,request,options).parameters.providerParameters,{seed:123});assert.equal(options.sourceParameters.duration,10);
 assert.equal(module.audioNativeRequestState(metadata,request,{sourceParameters:{loop:false}}).ready,false,'Agent normalization cannot conceal an unsupported source setting');
});
function buildHarness(module,{mode='valid',overrides={},configuration=metadata,duration=4}={}){
 const audioConfig=core.transition({prompt:''},'sonilo-music','Sound'),node={id:'source',type:'audio',audioConfig},reference={id:'reference',type:'video',video:'asset:video'};
 audioConfig.references=[{id:reference.id,type:'video'}];
 if(['clip','trim','sourceClip','segments'].includes(mode))reference[mode]={start:0,end:1};
 if(mode==='unsupported')audioConfig.params.loop=false;
 if(mode==='extra-text')audioConfig.references.push({id:'text',type:'text'});
 const state={nodes:[node,reference,...(mode==='extra-text'?[{id:'text',type:'text',content:'附加文字'}]:[])],edges:[]};
 let reads=0,fetches=0,metadataReads=0,releaseAvailability,releaseVideo;
 const availabilityHold=new Promise(resolve=>releaseAvailability=resolve),videoHold=new Promise(resolve=>releaseVideo=resolve);
 const context={app:{getState:()=>state,projectIdentity:()=>({id:'project'})},core,nativeUnderTest:module,agentUnderTest:null,drafts:new Map(),saveTimers:new Map(),structuredClone,setTimeout,clearTimeout,
  window:{GenerationAPI:{availability:async()=>{if(mode==='source-change')await availabilityHold;return {configured:mode!=='missing',reason:'ThinkSound 缺少显式配置'};},configuration:async()=>{metadataReads++;return configuration;}},LocalAssets:{url:async()=>{reads++;return 'blob:real-video';}}},
  document:{createElement:()=>({preload:'',duration,set src(value){this.url=value;const notify=()=>this.onloadedmetadata();if(mode==='reference-change')videoHold.then(notify);else queueMicrotask(notify);},removeAttribute(){},load(){}})},
  fetch:async()=>{fetches++;return {blob:async()=>({})};},FileReader:class{readAsDataURL(){this.result='data:video/mp4;base64,AAAA';this.onload();}}};
 const start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start);
 const body=source.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest').replace("await import('./src/features/agent-generation/audio.mjs')",'agentUnderTest');
 vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
 return {node,reference,state,context,overrides,releaseAvailability,releaseVideo,stats:()=>({reads,fetches,metadataReads})};
}
test('production AudioAPI rejects missing config, selections, hidden instructions and extra text before local video reads',async()=>{
 const module=await ready,agent=await import('../src/features/agent-generation/audio.mjs');
 for(const mode of ['missing','clip','trim','sourceClip','segments','unsupported','extra-text','agent-unsupported','agent-source-hidden','source-change']){
  const f=buildHarness(module,{mode:mode==='agent-source-hidden'?'unsupported':mode});f.context.agentUnderTest=agent;
  const overrides=mode.startsWith('agent')?{kind:'audio.generate',nodeId:'source',model:'sonilo',audioScene:'Sound',...(mode==='agent-unsupported'?{loop:false}:{})}:{};
  const pending=f.context.buildUnderTest('source',overrides);
  if(mode==='source-change'){await new Promise(resolve=>setImmediate(resolve));f.node.audioConfig.prompt='后来修改';f.releaseAvailability();}
  await assert.rejects(pending);assert.equal(f.stats().reads,0,mode);assert.equal(f.stats().fetches,0,mode);
 }
});
test('production AudioAPI checks video metadata duration, conflicts and stale references before reading bytes',async()=>{
 const module=await ready,agent=await import('../src/features/agent-generation/audio.mjs');
 for(const mode of ['valid','agent-valid','agent-source-seed','long','zero','not-finite','agent-duration-conflict','reference-change']){
  const f=buildHarness(module,{mode,duration:mode==='long'?181:mode==='zero'?0:mode==='not-finite'?NaN:4});f.context.agentUnderTest=agent;
  if(mode==='agent-source-seed')f.node.audioConfig.params.providerParameters={seed:321};
  const overrides=mode.startsWith('agent')?{kind:'audio.generate',nodeId:'source',model:'sonilo',audioScene:'Sound',...(mode==='agent-duration-conflict'?{duration:5}:{})}:{};
  const pending=f.context.buildUnderTest('source',overrides);
  if(mode==='reference-change'){await new Promise(resolve=>setImmediate(resolve));f.reference.video='asset:replaced';f.releaseVideo();}
  if(['valid','agent-valid','agent-source-seed'].includes(mode)){const output=await pending;assert.equal(output.prompt,'');assert.equal(output.parameters.duration,4);assert.equal(output.inputs[0].duration,4);assert.equal(f.stats().fetches,1);assert.equal(f.node.audioConfig.params.duration,10);if(mode==='agent-source-seed')assert.equal(output.parameters.providerParameters.seed,321);}
  else{await assert.rejects(pending);assert.equal(f.stats().fetches,0,mode);}
  assert.equal(f.stats().reads,['valid','agent-valid','agent-source-seed'].includes(mode)?2:1);
 }
});
test('production Sonilo Sound button displays the actual ThinkSound alternative, defers preview metadata and rejects unmaterialized segments',async()=>{
 const module=await ready,start=source.indexOf(' function updateGenerateState(){'),end=source.indexOf('\n function position(){',start),refsStart=source.indexOf(' function refsForRequest(){'),refsEnd=source.indexOf(' function picker(',refsStart);
 const button={disabled:false,title:''},status={textContent:'',dataset:{}},panel={querySelector:selector=>selector==='.audio-generate'?button:status,setAttribute(){}};
 const config=core.transition({prompt:''},'sonilo-music','Sound'),references=[{id:'reference',type:'video',video:'asset:video'}];
 const context={panel,current:{id:'source'},config,core,referenceNodes:()=>references,generationBusy:()=>false,lastGenerationBusy:null,audioNativeModule:module,audioNativeMetadata:metadata,audioNativePending:false,audioNativeError:'',audioNativeAvailability:{configured:true},refreshAudioNativeProfile(){},generationAction:null};
 vm.createContext(context);vm.runInContext(source.slice(refsStart,refsEnd)+source.slice(start,end)+'\nupdateGenerateState();',context);
 assert.equal(button.disabled,false);assert.match(status.textContent,/ThinkSound.*显式替代 Sonilo/);assert.match(status.textContent,/生成前读取真实视频时长/);
 references[0].segments=[{start:0,end:1}];context.updateGenerateState();assert.equal(button.disabled,true);assert.match(status.textContent,/选区或分段/);assert.match(status.textContent,/实际供应商：ThinkSound/);
 delete references[0].segments;context.audioNativeAvailability={configured:false,reason:'ThinkSound 缺Key'};context.updateGenerateState();assert.equal(button.disabled,true);assert.match(status.textContent,/缺Key/);
});
test('production native metadata cache follows public model alias and ignores late configuration from an older selection',async()=>{
 const start=source.indexOf(' function refreshAudioNativeProfile('),end=source.indexOf('\n\n import(',start),held=[],metadataReads=[];
 const context={current:{id:'source'},audioNativeScope:'',audioNativeModule:await ready,audioNativeRevision:0,audioNativePending:false,audioNativeError:'',audioNativeMetadata:null,audioNativeAvailability:null,updateGenerateState(){},
  window:{GenerationAPI:{availability:({request})=>new Promise(resolve=>held.push({request,resolve})),configuration:async()=>{metadataReads.push(1);return metadata;}}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.refreshAudioNativeProfile(request);context.refreshAudioNativeProfile(request);await new Promise(resolve=>setImmediate(resolve));assert.equal(held.length,1);
 const other=changed({providerParameters:{model:'another-public-alias'}});context.refreshAudioNativeProfile(other);await new Promise(resolve=>setImmediate(resolve));assert.equal(held.length,2);
 held[1].resolve({configured:false,reason:'new-alias-unmapped'});await new Promise(resolve=>setImmediate(resolve));assert.equal(context.audioNativeAvailability.reason,'new-alias-unmapped');
 held[0].resolve({configured:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(context.audioNativeAvailability.reason,'new-alias-unmapped','older selection cannot restore stale readiness');
 context.current={id:'new-node'};context.refreshAudioNativeProfile(request);await new Promise(resolve=>setImmediate(resolve));assert.equal(held.length,3);
 held[2].resolve({configured:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(context.audioNativeAvailability.configured,true);assert.equal(context.audioNativePending,false);assert.equal(metadataReads.length,3);
});
