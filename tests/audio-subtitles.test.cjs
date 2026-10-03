'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskService}=require('../generation-api.js');
const coreReady=import('../src/features/audio-subtitles/core.mjs');
const request={kind:'audio.generate',nodeId:'origin',prompt:'不能当作字幕',parameters:{model:'doubao-seed-audio-1-0',enable_subtitle:true}};
const appSource=fs.readFileSync(require.resolve('../app.js'),'utf8'),uiSource=fs.readFileSync(require.resolve('../generation-ui.js'),'utf8');
function fixture(){
 const audio={id:'result',type:'audio',audio:'asset:accepted',x:400,y:-50,width:300},c={window:{},nodes:[audio],edges:[],TextEncoder,crypto:require('node:crypto'),history:[],flushGesture(){},remember(){c.history.push(structuredClone({nodes:c.nodes,edges:c.edges}));},rebuildAndPersist(){}};
 vm.createContext(c);vm.runInContext('var api={'+appSource.slice(appSource.indexOf('    applyAudioSubtitle('),appSource.indexOf('    async commitGenerationPlan('))+'};',c);
 const app={getState:()=>({nodes:c.nodes,edges:c.edges}),applyAudioSubtitle:(...args)=>c.api.applyAudioSubtitle(...args),saveProject:async()=>{}};
 return {c,audio,app,job:{id:'job',request,status:'succeeded',outputs:[{type:'audio',audio:'data:audio/wav;base64,AA==',subtitle:{text:' 合同字幕\nSecond line '}}],resultIds:[audio.id]}};
}
test('explicit Seed subtitle contract gates accepted request, preserves text and never guesses prompt/text output',async()=>{
 const core=await coreReady;
 assert.equal(core.audioSubtitleEnabled(request),true);
 for(const parameters of [{model:'eleven_v3',enable_subtitle:true},{model:request.parameters.model,enable_subtitle:false},{model:request.parameters.model,enable_subtitle:'true'}])assert.equal(core.audioSubtitleEnabled({...request,parameters}),false);
 assert.equal(core.subtitleText({type:'audio',subtitle:{text:' \n\t'}}),null);assert.equal(core.subtitleText({type:'audio'}),null);assert.equal(core.subtitleText({type:'text',text:'不会猜'}),null);
 assert.equal(core.subtitleText({type:'audio',subtitle:{text:' 原始\n 文本 '}}),' 原始\n 文本 ');
 assert.equal(core.subtitleText({type:'audio',subtitle:{text:'a'.repeat(32768)}}).length,32768);
 for(const subtitle of [null,[],{text:1},{text:'x',extra:true},{text:'中'.repeat(10923)},{text:'\u0000'},{text:'\ud800'}])assert.throws(()=>core.subtitleText({type:'audio',subtitle}));
 assert.throws(()=>core.subtitleText({type:'text',subtitle:{text:'x'}}));
 const f=fixture();f.job.request={...request,parameters:{...request.parameters,enable_subtitle:false}};assert.deepEqual(await core.applyAudioSubtitles({...f,bindings:[]}),[]);assert.equal(f.c.history.length,0);
});
test('per-audio binding creates pure subtitle or updates unique existing node, retry adds no undo',async()=>{
 const core=await coreReady,f=fixture(),existing={id:'existing',type:'text',content:'old',sourceAudioNodeId:f.audio.id,x:800,y:9};f.c.nodes.push(existing);
 const binding=core.captureSubtitleBinding(f.audio,f.c.nodes);await core.applyAudioSubtitles({...f,bindings:[binding]});
 assert.equal(existing.content,' 合同字幕\nSecond line ');assert.equal(existing.x,800);assert.equal(f.c.edges.length,0);assert.equal(f.c.history.length,1);
 await core.applyAudioSubtitles({...f,bindings:[binding]});assert.equal(f.c.history.length,1);
 const second={...f.audio,id:'second',audio:'asset:second',x:900};f.c.nodes.push(second);f.job.outputs.push({type:'audio',audio:'data:audio/wav;base64,AA==',subtitle:{text:'第二个'}});f.job.resultIds.push(second.id);
 await core.applyAudioSubtitles({...f,bindings:[binding,core.captureSubtitleBinding(second,f.c.nodes)]});const subtitle=f.c.nodes.find(n=>n.sourceAudioNodeId==='second');assert.equal(subtitle.x,1280);assert.equal(subtitle.y,-50);assert.equal(subtitle.textMode,'pure');assert.equal(f.c.edges[0].source,'second');
});
test('actual audio ref, identity, unique IDs, user edits and ownership guards reject before mutation',async()=>{
 const core=await coreReady;
 for(const mode of ['audio','identity','existing','owner','duplicate']){
  const f=fixture(),binding=core.captureSubtitleBinding(f.audio,f.c.nodes);let isCurrent=()=>true;
  if(mode==='audio')f.audio.audio='asset:replacement';if(mode==='identity')f.c.nodes[0]={...f.audio};if(mode==='existing')f.c.nodes.push({id:'later',type:'text',content:'user',sourceAudioNodeId:f.audio.id});if(mode==='owner')isCurrent=()=>false;
  if(mode==='duplicate'){f.job.outputs.push(f.job.outputs[0]);f.job.resultIds.push(f.audio.id);}
  await assert.rejects(core.applyAudioSubtitles({...f,bindings:[binding,binding],isCurrent}));assert.equal(f.c.history.length,0);
 }
 const f=fixture();assert.throws(()=>core.captureSubtitleBinding(f.audio,f.c.nodes,'asset:not-accepted'));f.audio.x+=10;const binding=core.captureSubtitleBinding(f.audio,f.c.nodes);f.audio.x+=20;await core.applyAudioSubtitles({...f,bindings:[binding]});assert.equal(binding.applied.node.x,810);
});
test('save failure retains receipt; retry does not duplicate, while edit/undo never resurrect old subtitle',async()=>{
 const core=await coreReady;
 for(const mode of ['retry','edit','undo','source-during-save']){
  const f=fixture(),binding=core.captureSubtitleBinding(f.audio,f.c.nodes);f.app.saveProject=async()=>{if(mode==='source-during-save')f.audio.audio='asset:late';throw Error('disk failure');};
  await assert.rejects(core.applyAudioSubtitles({...f,bindings:[binding]}));assert.equal(f.c.history.length,1);f.app.saveProject=async()=>{};
  if(mode==='edit')binding.applied.node.content='user';if(mode==='undo'){const before=f.c.history[0];f.c.nodes=before.nodes;f.c.edges=before.edges;}
  if(mode==='retry'){await core.applyAudioSubtitles({...f,bindings:[binding]});assert.equal(f.c.nodes.length,2);}else await assert.rejects(core.applyAudioSubtitles({...f,bindings:[binding]}));assert.equal(f.c.history.length,1);
 }
});
async function production(){
 const core=await coreReady,f=fixture(),recovery=await import('../src/features/generation-results/recovery.mjs'),application=await import('../src/features/generation-results/application.mjs');
 f.c.nodes=[{id:'origin',type:'audio',title:'request',x:10,y:20,width:300}];const service=new TaskService(),maps={audioSubtitleReceipts:new Map(),audioSubtitleBindings:new Map(),audioSubtitleMedia:new Map(),latestAudioSubmissions:new WeakMap()};let project='qa',localizes=0,saved=null,saveHook=async()=>{};
 Object.assign(f.app,{projectIdentity:()=>({id:project}),notify:message=>f.notices.push(message),createConnected:(sourceId,outputs)=>outputs.map((o,index)=>{const n={...o,id:'created-'+(f.c.nodes.length+index),x:450,y:20,width:300};f.c.nodes.push(n);return n;}),saveProject:async()=>{await saveHook();saved=structuredClone(f.app.getState());}});f.notices=[];
 const c={...maps,app:f.app,service,window:{AudioAPI:{localize:async()=>{localizes++;return 'asset:localized-'+localizes;}},CanvasStore:{save:async state=>{await saveHook();saved=structuredClone(state);}}},audioSubtitlePageEpoch:0,audioSubtitleReady:Promise.resolve(core),provenanceReady:Promise.resolve({resultProvenance:()=>({})}),validateOutputMedia:async()=>{},draftGuards:new Map(),inPlace:new Map(),videoTargets:new Map(),imageTargets:new Map(),derivedTargets:new Map(),resultWorkflow:null,structuredClone,Promise,Map,WeakMap,Object,JSON,recovery};
 vm.createContext(c);let code=uiSource.slice(uiSource.indexOf('  const audioSourceSignature='),uiSource.indexOf('  const applicationReady='));
 code+=uiSource.slice(uiSource.indexOf('  async function applyResults('),uiSource.indexOf('  function applicationChanged(')).replaceAll("import('./src/features/generation-results/recovery.mjs')",'Promise.resolve(recovery)');code+='\nglobalThis.applyUnderTest=applyResults;';vm.runInContext(code,c);
 const runner=application.createApplicationRunner({getJob:id=>service.jobs.get(id),apply:c.applyUnderTest});
 service.setProvider({generate:async()=>({outputs:[{type:'audio',audio:'data:audio/wav;base64,AA==',subtitle:{text:'真实应用合同\n第二行'}}]})});
 const submit=()=>{const job=service.submit(request),source=f.c.nodes[0],receipt=c.audioReceipt(request,source);maps.audioSubtitleReceipts.set(job.id,receipt);maps.latestAudioSubmissions.set(source,job.id);return job;};
 const settle=async job=>{for(let n=0;n<20&&job.status!=='succeeded';n++)await new Promise(done=>setImmediate(done));assert.equal(job.status,'succeeded');return runner.run(job.id);};
 return {...f,runtime:c,service,runner,maps,submit,settle,saveHook:fn=>{saveHook=fn;},setProject:value=>{project=value;},localizes:()=>localizes,saved:()=>saved};
}
test('production TaskService → generation applyResults → application runner retains actual refs on save retry',async()=>{
 const f=await production(),job=f.submit();f.saveHook(async()=>{throw Error('save failed');});const first=await f.settle(job);assert.equal(first.applied,false);assert.equal(f.c.nodes.length,3);assert.equal(f.c.history.length,1);assert.equal(f.localizes(),1);
 f.saveHook(async()=>{});const retry=await f.runner.run(job.id);assert.equal(retry.applied,true);assert.equal(f.c.nodes.length,3);assert.equal(f.localizes(),1);assert.equal(f.saved().nodes.find(n=>n.type==='text').sourceAudioNodeId,job.resultIds[0]);
});
test('production recovered new_nodes captures before persist; refreshed retained graph never blindly rebinds',async()=>{
 const f=await production(),job=f.submit();await f.settle(job);const output=job.outputs;f.c.nodes.splice(1);f.c.edges=[];
 const recovered={id:'recovered',request:structuredClone(request),status:'succeeded',outputs:output,recovered:true,recoveryMode:'new_nodes',recoverySourceId:'origin'};f.service.jobs.set(recovered.id,recovered);
 let changed=false;f.saveHook(async()=>{if(!changed){changed=true;f.c.nodes[1].audio='asset:user-replaced';}});const rejected=await f.runner.run(recovered.id);assert.equal(rejected.applied,false);assert.match(rejected.applicationError,/变化/);assert.equal(f.c.nodes.filter(n=>n.type==='text').length,0);
 f.maps.audioSubtitleBindings.delete(recovered.id);f.maps.audioSubtitleMedia.delete(recovered.id);f.maps.audioSubtitleReceipts.delete(recovered.id);f.saveHook(async()=>{});const retained=await f.runner.run(recovered.id);assert.equal(retained.applied,true);assert.equal(f.c.nodes[1].audio,'asset:user-replaced');assert.equal(f.c.nodes.filter(n=>n.type==='text').length,0);assert.match(f.notices[0],/保留现有字幕/);
});
test('production old completion after newer task, project change or source mutation is rejected',async()=>{
 for(const mode of ['newer','project','source']){
  const f=await production(),job=f.submit();if(mode==='newer')f.submit();if(mode==='project')f.setProject('other');if(mode==='source')f.c.nodes[0].title='edited';const receipt=await f.settle(job);assert.equal(receipt.applied,false);assert.equal(f.c.nodes.length,1);assert.equal(f.c.history.length,0);
 }
});
