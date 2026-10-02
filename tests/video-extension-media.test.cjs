const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../generation-api.js');
const load=()=>import('../src/features/video-creation/media.mjs');
const request={kind:'video.extend',inputs:[{type:'video',url:'asset:source',role:'source_video'}],parameters:{sourceClip:{start:2,end:4}}};
const tick=()=>new Promise(r=>setImmediate(r));
test('extension resolves the selected clip into physical media before transport, without double crop',async()=>{
 const {prepareExtensionMedia}=await load();let passed;
 const result=await prepareExtensionMedia(request,{resolveMedia:async node=>{assert.deepEqual(node.clip,{start:2,end:4});assert.equal(node.video,'asset:source');return {url:'data:video/mp4;base64,AAAA',duration:2,width:320,height:180};},transport:async value=>{passed=value;return value;}});
 assert.equal(result.inputs[0].url,'data:video/mp4;base64,AAAA');assert.equal(passed.parameters.sourceClip,null);assert.deepEqual(passed.inputs[0].sourceRange,{start:2,end:4});assert.equal(passed.inputs[0].durationMs,2000);assert.equal(request.parameters.sourceClip.start,2);
});
test('extension transports source and references with source checks between async reads',async()=>{
 const {prepareExtensionMedia}=await load();let checks=0,reads=0;
 const value=await prepareExtensionMedia({...request,inputs:[...request.inputs,{type:'video',url:'asset:reference',clip:{start:1,end:3}},{type:'text',text:'参考'}]},{validateSources:()=>checks++,resolveMedia:async node=>{reads++;return {url:'data:video/mp4;base64,AAAA',duration:2};},transport:async input=>input});
 assert.equal(reads,2);assert.ok(checks>=6);assert.deepEqual(value.inputs[1].sourceRange,{start:1,end:3});assert.equal(value.inputs[1].clip,undefined);assert.equal(value.inputs[2].text,'参考');
});
test('cancel or source changes during extension media resolution prevent transport and generation',async()=>{
 const {prepareExtensionMedia}=await load();for(const cancel of [false,true]){const controller=new AbortController();let changed=false;
 await assert.rejects(prepareExtensionMedia(request,{signal:controller.signal,validateSources:()=>{if(changed)throw Error('source changed');},resolveMedia:async()=>{if(cancel)controller.abort(Error('cancelled'));else changed=true;return {url:'data:video/mp4;base64,AAAA'};},transport:()=>assert.fail('must not transmit')}),/cancelled|source changed/);}
});
test('unconfigured extension is blocked before any local media work by the production task service',async()=>{
 const {prepareExtensionMedia}=await load();const service=new TaskService({prepareInputs:r=>prepareExtensionMedia(r,{resolveMedia:()=>assert.fail('must not read media')})});service.setProvider({isConfigured:async({request:actual})=>{assert.equal(actual.kind,'video.extend');return false;},generate:()=>assert.fail('must not dispatch')});const job=service.submit(request);for(let i=0;i<20&&job.status==='queued';i++)await tick();assert.equal(job.status,'configuration_required');
});
