'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ready=import('../src/features/audio-upload/guard.mjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(){
 const module=await ready;let node={id:'audio',type:'audio',audio:'asset:before',x:10,y:20,width:280,height:230,title:'old',audioConfig:{prompt:'keep'},sourceJournal:{id:'keep'}},project='first',latest=true,updates=0,puts=0,saves=0;
 const undo=[],app={getState:()=>({nodes:[node]}),projectIdentity:()=>({id:project}),updateNode:(_id,patch)=>{updates++;undo.push(structuredClone(node));Object.assign(node,patch);},saveProject:async()=>{saves++;}};
 const file={name:'new.wav',size:10},options={file,target:node,snapshot:structuredClone(node),projectId:project,app,isLatest:()=>latest,validateFile:()=>{},decodeFile:async()=>({duration:2}),assets:{put:async()=>{puts++;return 'asset:new';}}};
 return {module,app,options,node:()=>node,counts:()=>({updates,puts,saves}),undo,setNode:value=>{node=value;},setProject:value=>{project=value;},setLatest:value=>{latest=value;}};
}
test('ordinary upload preserves title/300x300 semantics, syncs durationMs and commits one undo',async()=>{
 const f=await fixture(),before=structuredClone(f.node()),result=await f.module.applyAudioUpload(f.options);assert.equal(result.persisted,true);assert.equal(f.node().title,'new.wav');assert.equal(f.node().width,300);assert.equal(f.node().height,300);assert.equal(f.node().audioDuration,2);assert.equal(f.node().durationMs,2000);assert.deepEqual(f.node().provenance,{kind:'imported',mediaSource:'asset:new',model:null});assert.deepEqual(f.node().audioConfig,before.audioConfig);assert.deepEqual(f.node().sourceJournal,before.sourceJournal);assert.deepEqual(f.undo,[before]);
});
test('later chooser/source/config/object/project changes at decode or put cannot publish a stale file',async()=>{
 for(const boundary of ['decode','put'])for(const mode of ['choice','source','config','identity','project','busy']){
  const f=await fixture(),normal=boundary==='decode'?f.options.decodeFile:f.options.assets.put;
  const change=async()=>{const value=await normal();if(mode==='choice')f.setLatest(false);if(mode==='source')f.node().audio='asset:later';if(mode==='config')f.node().audioConfig.prompt='later';if(mode==='identity')f.setNode(structuredClone(f.node()));if(mode==='project')f.setProject('other');if(mode==='busy')f.node().pendingOperation='audio.generate';return value;};
  if(boundary==='decode')f.options.decodeFile=change;else f.options.assets.put=change;
  await assert.rejects(f.module.applyAudioUpload(f.options));assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('save failure reports applied-unconfirmed and changes during save never claim this upload saved',async()=>{
 for(const mode of ['failure','project','source']){
  const f=await fixture();f.app.saveProject=async()=>{if(mode==='failure')throw Error('disk failure');if(mode==='project')f.setProject('other');if(mode==='source')f.node().audio='asset:edited-after';};const result=await f.module.applyAudioUpload(f.options);assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.ok(result.saveError);assert.equal(f.undo.length,1);
 }
});
test('production chooser latest opening wins, cancelling rejects older work, and pagehide invalidates only earlier epochs',async()=>{
 const f=await fixture(),source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8');
 const start=source.indexOf(' const uploadAttempts='),end=source.indexOf('\n function preview(',start),inputs=[],events={},decodeQueue=[],messages=[];
 const context={window:{addEventListener:(name,callback)=>{events[name]=callback;},LocalAssets:f.options.assets,GenerationAPI:{getJobs:()=>[]}},document:{body:{append:()=>{}}},app:f.app,core:{validateFile:()=>{}},structuredClone,WeakMap,Promise,analysis:new Map(),decode:async()=>{const item=decodeQueue.shift();return item?item.promise:{duration:4};},URL:{createObjectURL:()=> 'blob:qa',revokeObjectURL:()=>{}},el:()=>{const input={files:[],click:()=>{},remove:()=>{input.removed=true;}};inputs.push(input);return input;},helper:f.module};
 f.app.notify=message=>messages.push(message);vm.createContext(context);const code=source.slice(start,end).replace("import('./src/features/audio-upload/guard.mjs')",'Promise.resolve(helper)')+'\nglobalThis.uploadUnderTest=upload;';vm.runInContext(code,context);
 const first=deferred();decodeQueue.push(first);context.uploadUnderTest(f.node());inputs[0].files=[{name:'old.wav'}];const old=inputs[0].onchange();await new Promise(resolve=>setImmediate(resolve));
 context.uploadUnderTest(f.node());inputs[1].files=[{name:'new.wav'}];await inputs[1].onchange();first.resolve({duration:2});await old;assert.equal(f.node().title,'new.wav');assert.equal(f.node().durationMs,4000);assert.equal(f.counts().updates,1);
 const before=structuredClone(f.node()),held=deferred();decodeQueue.push(held);context.uploadUnderTest(f.node());inputs[2].files=[{name:'cancel-old.wav'}];const stale=inputs[2].onchange();await new Promise(resolve=>setImmediate(resolve));context.uploadUnderTest(f.node());inputs[3].oncancel();held.resolve({duration:6});await stale;assert.deepEqual(f.node(),before);
 const hide=deferred();decodeQueue.push(hide);context.uploadUnderTest(f.node());inputs[4].files=[{name:'hidden.wav'}];const pending=inputs[4].onchange();await new Promise(resolve=>setImmediate(resolve));events.pagehide();hide.resolve({duration:7});await pending;assert.deepEqual(f.node(),before);
 context.uploadUnderTest(f.node());inputs[5].files=[{name:'after-return.wav'}];await inputs[5].onchange();assert.equal(f.node().title,'after-return.wav');assert.equal(f.counts().updates,2);assert.equal(messages.length,0);assert.ok(inputs.every(input=>input.removed));
});
