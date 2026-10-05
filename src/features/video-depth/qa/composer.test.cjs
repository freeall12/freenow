'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source={id:'source',type:'video',video:'data:video/mp4;base64,AAAA'},input={id:source.id,type:'video',url:source.video,title:'真实来源'};
async function modules(){return {composer:await import('../composer.mjs'),profile:await import('../native-profile.mjs'),contract:await import('../../agent-workflows/depth-video.mjs')};}
function metadata(maxCount=2){return {configured:true,protocol:'fal-video-depth-native',capabilities:{kinds:['video.depth'],models:{'depth-anything-video':{kind:'video.depth'}},videoDepth:{'depth-anything-video':{kind:'video.depth',model:'fal-ai/depth-anything-video',semantics:'per-frame-depth',tapNowEquivalent:false,sourceMimeTypes:['video/mp4'],audioPolicy:'discard',resolutions:['source'],colormaps:['grayscale'],preserveDuration:true,preserveDimensions:true,promptUsed:false,maxVideos:1,maxCount,maxSourceFrames:2400,maxInputBytes:33554432,maxOutputBytes:33554432,localMediaProfile:'mp4-cfr-even-square-pixels-5-30fps',maxWidth:1920,maxHeight:1080,minFps:5,maxFps:30,maxDuration:480}}}};}
async function raw(count=1){const {composer}=await modules();return composer.depthComposerRequest({nodeId:'target',settings:composer.depthComposerSettings({count}),inputs:[input],sourceNodes:[source]});}

test('model switch clears prompt/generic settings, preserves real bindings and official 1/2 choices',async()=>{
 const {composer}=await modules(),saved={model:'Wan 2.6',prompt:'旧镜头指令',refs:[source.video],referenceBindings:['source'],referenceOrder:['node:source'],ratio:'9:16',duration:10,audio:true,draftVideoId:'old',count:2,resultMode:'spread'},next=composer.depthComposerSettings(saved);
 assert.equal(next.prompt,'');assert.equal(next.videoMode,'VIDEO_EDIT');assert.equal(next.model,'Depth Anything Video');assert.equal(next.count,2);assert.equal(next.times,2);assert.deepEqual(next.referenceBindings,['source']);assert.equal(next.resultMode,'spread');for(const key of ['ratio','duration','audio','draftVideoId'])assert.equal(Object.hasOwn(next,key),false);assert.equal(saved.prompt,'旧镜头指令');
});
test('ordinary target is independent of source identity and unsupported references/selections stop',async()=>{
 const {composer}=await modules(),request=await raw();assert.equal(request.nodeId,'target');assert.equal(request.inputs[0].id,'source');assert.equal(request.parameters.composer,'video-depth-node-v1');assert.equal(request.prompt,'');
 const options={nodeId:'target',settings:composer.depthComposerSettings(),inputs:[input],sourceNodes:[source]};
 for(const inputs of [[],[input,input],[{...input,type:'image'}],[{...input,url:''}]])assert.throws(()=>composer.depthComposerRequest({...options,inputs}));
 assert.throws(()=>composer.depthComposerRequest({...options,sourceNodes:[{...source,video:''}]}),/已变化/);
 for(const field of ['clip','trim','sourceClip'])assert.throws(()=>composer.depthComposerRequest({...options,sourceNodes:[{...source,[field]:{start:0,end:1}}]}),/物化/);
 assert.throws(()=>composer.depthComposerRequest({...options,settings:{...options.settings,prompt:'extra'}}),/提示词/);
});
test('configuration and declared 2-result capability are checked before metadata reading',async()=>{
 const {composer}=await modules(),request=await raw(2);let reads=0;
 for(const config of [null,{...metadata(),configured:false},metadata(1),metadata(3)])await assert.rejects(composer.prepareDepthComposerRequest(request,{nativeConfiguration:config,resolveMedia:()=>{reads++;assert.fail('no read');}}));
 assert.equal(reads,0);
});
test('TaskService input preparation compiles actual metadata, strips internal marker and keeps target/count/layout',async()=>{
 const {composer,contract}=await modules(),request=await raw(2),before=structuredClone(request);let guarded=0;
 const result=await composer.prepareDepthComposerRequest(request,{nativeConfiguration:metadata(),validateSources:()=>guarded++,resolveMedia:async node=>{assert.equal(node.id,'source');assert.equal(node.video,input.url);return {...input,width:64,height:48,duration:2};}});
 assert.deepEqual(request,before);assert.equal(result.nodeId,'target');assert.equal(result.inputs[0].id,'source');assert.equal(result.inputs[0].width,64);assert.equal(result.parameters.duration,2);assert.equal(result.parameters.count,2);assert.equal(Object.hasOwn(result.parameters,'composer'),false);assert.equal(contract.prepareDepthTaskRequest(result),result);assert.ok(guarded>=3);
 for(const mutate of [r=>r.parameters.times=1,r=>r.parameters.canvasResults={targetNodeIds:['a']},r=>r.nodeId=' target',r=>r.nodeId='']){const invalid=structuredClone(result);mutate(invalid);assert.throws(()=>contract.prepareDepthTaskRequest(invalid));}
});
test('unprepared request extra intent, original-host URL, cancellation and stale source cannot reach task dispatch',async()=>{
 const {composer}=await modules();let reads=0;
 for(const mutate of [r=>r.parameters.duration=1,r=>r.parameters.times=2,r=>r.prompt='extra',r=>r.inputs[0].clip={start:0,end:1},r=>r.inputs[0].url='https://cdn.tapnow.ai/v.mp4']){const request=await raw();mutate(request);await assert.rejects(composer.prepareDepthComposerRequest(request,{nativeConfiguration:metadata(),resolveMedia:()=>{reads++;assert.fail('no read');}}));}
 assert.equal(reads,0);const controller=new AbortController();controller.abort(Error('cancelled'));await assert.rejects(composer.prepareDepthComposerRequest(await raw(),{nativeConfiguration:metadata(),signal:controller.signal,resolveMedia:()=>assert.fail('no read')}),/cancelled/);
 let stale=false;await assert.rejects(composer.prepareDepthComposerRequest(await raw(),{nativeConfiguration:metadata(),validateSources:()=>{if(stale)throw Error('source changed');},resolveMedia:async()=>{stale=true;return {...input,width:64,height:48,duration:2};}}),/source changed/);
});
test('prepared Agent requests remain strict and skip composer-only metadata compilation',async()=>{
 const {composer,contract}=await modules(),request=contract.buildDepthRequest({source:{...input,width:64,height:48,duration:2},modelId:'depth-anything-video'});
 assert.equal(await composer.prepareDepthComposerRequest(request,{resolveMedia:()=>assert.fail('already prepared')}),request);assert.equal(contract.prepareDepthTaskRequest(request),request);
});
test('real node-editor submit branch dispatches depth kind with current source rather than generic video.generate',async()=>{
 const {composer}=await modules(),code=fs.readFileSync(require.resolve('../../../../node-editor.js'),'utf8'),start=code.indexOf('  async function submitGeneration('),end=code.indexOf('\n  function updateBusyState',start),target={id:'target',type:'video'};let sent;
 const context={node:target,config:composer.depthComposerSettings({count:2}),draftFinalUI:null,busy:()=>false,frameError:()=>'',structuredClone,submitting:new Set(),updateBusyState(){},depthSelected:composer.isDepthModel,depthComposerReady:Promise.resolve(composer),panel:{hidden:false},inputs:()=>[input],app:{getState:()=>({nodes:[source,target]}),notify:message=>assert.fail(message)},window:{GenerationAPI:{submit:request=>{sent=request;return {id:'task'};}}}};
 vm.createContext(context);vm.runInContext(code.slice(start,end),context);const result=await context.submitGeneration();assert.equal(result.id,'task');assert.equal(sent.kind,'video.depth');assert.equal(sent.nodeId,'target');assert.equal(sent.inputs[0].id,'source');assert.equal(sent.parameters.count,2);assert.equal(context.submitting.size,0);
});
test('node media preparation shares one actual decode and transfers the complete MP4 under live guards',async()=>{
 const {composer}=await modules(),bytes=fs.readFileSync(require.resolve('../../video-generation/qa/media/2.mp4')),url='data:video/mp4;base64,'+bytes.toString('base64'),request=await raw(2);request.inputs[0].url=url;let probes=0,guards=0;
 const prepared=await composer.prepareDepthNodeMedia(request,{nativeConfiguration:metadata(),validateSources:()=>guards++,resolveMedia:async node=>{probes++;assert.equal(node.video,url);return {id:'source',type:'video',url,width:64,height:48,duration:2};}});
 assert.equal(probes,1);assert.equal(prepared.nodeId,'target');assert.equal(prepared.parameters.count,2);assert.deepEqual(Buffer.from(prepared.inputs[0].url.split(',')[1],'base64'),bytes);assert.ok(guards>=6);
 const contract=(await modules()).contract;prepared.parameters.batch_count=1;assert.equal(contract.prepareDepthTaskRequest(prepared),prepared);prepared.parameters.batch_count=2;assert.throws(()=>contract.prepareDepthTaskRequest(prepared),/逻辑批次/);
 prepared.parameters.canvasResults={targetNodeIds:['a','b'],requestPlans:[{requestId:'p1',targets:[{nodeId:'a',resultIndex:0}]},{requestId:'p2',targets:[{nodeId:'b',resultIndex:0}]}]};assert.equal(contract.prepareDepthTaskRequest(prepared),prepared);
});
