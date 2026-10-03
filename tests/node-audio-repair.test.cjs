'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const ready=import('../src/features/local-resource-migration/node-audio-repair.mjs'),core=require('../audio-core.js');
const old='https://files.tapnow.media/unknown-audio.wav?token=synthetic-only',bytes=Buffer.from('synthetic-audio-contract');
const file=()=>new Blob([bytes],{type:'audio/wav'}),hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const {createNodeAudioRepair}=await ready;let node={id:'selected',type:'audio',audio:old,audioMode:'generate',audioDuration:100,durationMs:100000,x:10,y:20,width:280,height:230,title:'保留标题',audioConfig:{model:'old-model',prompt:'keep'},sourceJournal:{source:old,signature:'keep'}},project='qa',current=true,jobs=[],stored={nodes:[structuredClone(node)]};
 const other=structuredClone({...node,id:'other'}),undo=[];let blob,puts=0,updates=0,saves=0,reads=0;
 const options={nodeId:'selected',getNode:()=>node,getProjectId:()=>project,isCurrent:()=>current,getJobs:()=>jobs,assets:{put:async value=>{puts++;blob=value;return 'asset:audio-qa';}},readAsset:async()=>{reads++;return blob;},hashBytes:async value=>hash(value),decodeAudio:async blob=>{assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);return {duration:2,sampleRate:48000,channels:1,peaks:[.1,.7,0]};},updateNode:(_id,patch)=>{updates++;undo.push(structuredClone(node));Object.assign(node,patch);},saveProject:async()=>{saves++;stored={nodes:[structuredClone(node),structuredClone(other)]};},readProject:async()=>structuredClone(stored)};
 return {options,create:()=>createNodeAudioRepair(options),node:()=>node,other,undo,counts:()=>({puts,updates,saves,reads}),setProject:value=>{project=value;},setCurrent:value=>{current=value;},setJobs:value=>{jobs=value;},setNode:value=>{node=value;},stored:()=>stored};
}
test('audio replacement verifies actual bytes and durations, preserving geometry/config/title/journal/other node with one undo',async()=>{
 const f=await fixture(),before=structuredClone(f.node()),other=structuredClone(f.other),result=await f.create().repair(file());assert.equal(result.persisted,true);assert.equal(result.sha256,hash(bytes));assert.equal(result.waveformBins,3);assert.equal(f.node().audio,'asset:audio-qa');assert.equal(f.node().audioMode,'upload');assert.equal(f.node().audioDuration,2);assert.equal(f.node().durationMs,2000);assert.deepEqual(f.node().provenance,{kind:'imported',mediaSource:result.ref,model:null});assert.deepEqual(f.node().audioConfig,before.audioConfig);assert.deepEqual(f.node().sourceJournal,before.sourceJournal);assert.equal(f.node().title,before.title);assert.equal(f.node().width,280);assert.equal(f.node().height,230);assert.deepEqual(f.other,other);assert.deepEqual(f.undo,[before]);assert.deepEqual(f.counts(),{puts:1,updates:1,saves:1,reads:1});
});
test('bad file/decode/duration/sample rate/channels/waveform and saved bytes never publish an edit',async()=>{
 for(const mode of ['mime','empty','oversize','decode','duration','sampleRate','channels','peaks','bytes','type']){
  const f=await fixture(),before=structuredClone(f.node()),decode=f.options.decodeAudio;let input=file();if(mode==='mime')input=new Blob([bytes],{type:'text/plain'});if(mode==='empty')input=new Blob([],{type:'audio/wav'});if(mode==='oversize')input=new Blob([new Uint8Array(50*1024*1024+1)],{type:'audio/wav'});
  f.options.decodeAudio=async blob=>{if(mode==='decode')throw Error('bad audio');const metadata=await decode(blob);if(mode==='duration')metadata.duration=0;if(mode==='sampleRate')metadata.sampleRate=1;if(mode==='channels')metadata.channels=0;if(mode==='peaks')metadata.peaks=[NaN];return metadata;};if(mode==='bytes')f.options.readAsset=async()=>new Blob([Buffer.from(bytes).fill(1)],{type:'audio/wav'});if(mode==='type')f.options.readAsset=async()=>new Blob([bytes],{type:'audio/mpeg'});
  await assert.rejects(f.create().repair(input));assert.deepEqual(f.node(),before);assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('late content/node/project/current changes and active tasks prevent applying old audio replacement',async()=>{
 for(const mode of ['content','node','project','current','pending','queued','running','applying']){
  const f=await fixture(),read=f.options.readAsset;f.options.readAsset=async ref=>{const blob=await read(ref);if(mode==='content')f.node().audioConfig.prompt='later';if(mode==='node')f.setNode(structuredClone(f.node()));if(mode==='project')f.setProject('other');if(mode==='current')f.setCurrent(false);if(mode==='pending')f.node().pendingOperation='audio.generate';if(['queued','running','applying'].includes(mode))f.setJobs([{id:'job',status:mode==='applying'?'succeeded':mode,applying:true,request:{nodeId:'selected'}}]);return blob;};await assert.rejects(f.create().repair(file()));assert.equal(f.counts().updates,0);
 }
});
test('save failure is applied-unconfirmed, retry only saves and confirmed retry is idempotent',async()=>{
 const f=await fixture(),save=f.options.saveProject;let first=true;f.options.saveProject=async()=>{if(first){first=false;throw Error('disk failure');}await save();};const service=f.create(),result=await service.repair(file());assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.equal(f.stored().nodes[0].audio,old);assert.equal((await service.retrySave()).persisted,true);assert.equal(f.undo.length,1);assert.equal(f.counts().puts,1);const before=f.counts();assert.equal((await service.retrySave()).persisted,true);assert.deepEqual(f.counts(),before);
});
test('all applied audio fields and context are rechecked after save/read awaits without rollback',async()=>{
 for(const mode of ['project','identity','audio','mode','seconds','milliseconds','provenance']){
  const f=await fixture(),save=f.options.saveProject,read=f.options.readProject;if(mode==='project')f.options.saveProject=async()=>{await save();f.setProject('other');};else f.options.readProject=async()=>{const value=await read();if(mode==='identity')f.setNode(structuredClone(f.node()));if(mode==='audio')f.node().audio=old;if(mode==='mode')f.node().audioMode='generate';if(mode==='seconds')f.node().audioDuration=12;if(mode==='milliseconds')f.node().durationMs=12000;if(mode==='provenance')f.node().provenance.model='forged';return value;};const service=f.create(),result=await service.repair(file());assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.equal(service.status().persisted,false);
 }
 const f=await fixture(),read=f.options.readAsset;f.options.readAsset=async ref=>{f.node().x=800;return read(ref);};await f.create().repair(file());assert.equal(f.node().x,800);
});
test('audio decoder uses existing peaks and closes its private context on success, decoder failure and PCM budget rejection',async()=>{
 const {decodeRepairAudio}=await ready;
 for(const mode of ['success','failure','budget']){
  let closed=0;const channel=new Float32Array([.2,-.6,0,.8]),context={decodeAudioData:async()=>{if(mode==='failure')throw Error('invalid codec');return {duration:1,sampleRate:48000,numberOfChannels:1,length:mode==='budget'?67108865:4,getChannelData:()=>channel};},close:async()=>{closed++;}};
  const run=()=>decodeRepairAudio(file(),{core,createContext:()=>context});if(mode==='success'){const metadata=await run();assert.deepEqual(metadata.peaks,core.peaks([channel],600));assert.equal(metadata.duration,1);}else await assert.rejects(run());assert.equal(closed,1);
 }
});
