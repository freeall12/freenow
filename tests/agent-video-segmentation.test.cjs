'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parse}=require('../agent-tools.js'),root=path.resolve(__dirname,'..'),client=fs.readFileSync(path.join(root,'agent-client.js'),'utf8');
const id='30fca941-9dcb-4c36-a116-c40d6cb4c023',args={operationId:id,nodeId:'video',rect:{x:32,y:18,width:64,height:36},time:2.5};
const config={configured:true,protocol:'replicate-sam2-native',version:'pinned-model',providerFingerprint:'provider-a'};
const mask={encoding:'rle-zero-based-row-major',width:320,height:180,fps:10,frames:Array(80).fill('5792 64')};
const tick=()=>new Promise(r=>setTimeout(r,0));const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
async function fixture(options={}){
 const module=await import('../src/features/agent-generation/video-segmentation.mjs'),recovery=await import('../src/features/video-mask/recovery.mjs'),traceModule=await import('../src/features/agent-execution/trace.mjs');
 const node={id:'video',type:'video',video:'asset:video',clip:{start:1,end:4}},state={nodes:[node],edges:[]},storage=new Map(),events=[],assets=new Map();let project='p',savedTrace,trace,currentConfig=config,saveFails=false,assetCount=0,updates=0,postCount=0,getCount=0,resumeCount=0,cancelCount=0;
 const bytes=fs.readFileSync(path.join(root,'qa/trim-scenes.mp4')),data='data:video/mp4;base64,'+bytes.toString('base64'),sha=await recovery.fingerprintSourceData(data);
 const storageAPI={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(options.receiptFailure)throw Error('quota');storage.set(key,value);},removeItem:key=>storage.delete(key)};
 const receipts=recovery.createReceiptStore(storageAPI);
 const app={getState:()=>state,projectIdentity:()=>({id:project}),saveProject:async({beforeCommit}={})=>{events.push('project-save');beforeCommit?.();if(saveFails&&postCount)throw Error('disk full');if(options.saveGate)await options.saveGate.promise;beforeCommit?.();},updateNode:(target,patch)=>{assert.equal(target,node.id);Object.assign(node,patch);updates++;}};
 const localAssets={put:async blob=>{events.push('asset-put');const asset='asset:mask-'+(++assetCount);assets.set(asset,JSON.parse(await blob.text()));return asset;},url:async source=>{events.push('media-read');if(options.mediaGate)await options.mediaGate.promise;return source==='asset:video'?data:'data:application/json;base64,'+Buffer.from(JSON.stringify(assets.get(source))).toString('base64');}};
 const api={create:async(request,{idempotencyKey})=>{postCount++;events.push('POST');assert.equal(idempotencyKey,id);assert.equal(savedTrace.segmentationTask.id,id);assert.equal(savedTrace.segmentationTask.status,'unknown');assert.equal(receipts.read('p','video').dispatched,true);assert.equal(request.sourceVideoUrl,data);assert.equal(request.time,2.5);assert.deepEqual(request.selection,{x:.1,y:.1,width:.2,height:.2});assert.equal(request.duration,8);assert.equal(request.width,320);assert.equal(request.pointPrompts[0].x,64);if(options.createFailure)throw Error('network unknown');return task(options.taskStatus||'succeeded');},get:async taskId=>{getCount++;events.push('GET');assert.equal(taskId,id);return task(options.recoverStatus||'succeeded');},resume:async taskId=>{resumeCount++;events.push('resume');assert.equal(taskId,id);return task('succeeded');},cancel:async taskId=>{cancelCount++;events.push('cancel');return task('cancelled');}};
 const task=status=>({id,protocol:config.protocol,version:config.version,providerFingerprint:config.providerFingerprint,status,branches:[],source:{sha256:options.wrongSha?'different':sha,width:320,height:180,duration:8},...(status==='succeeded'?{mask:options.invalidMask||mask}:{})});
 const openFrames=async value=>{events.push('decode-source');assert.equal(value,data);if(options.decodeGate)await options.decodeGate.promise;return {width:320,height:180,duration:8,dispose:()=>{}};};
 const onCheckpoint=async record=>{events.push('trace-'+record.status);trace.submittedTaskId=record.id;trace.segmentationTask=record;if(options.traceFailure||options.appliedTraceFailure&&record.status==='applied')throw Error('trace disk full');savedTrace=structuredClone(trace);if(options.traceGate)await options.traceGate.promise;};
 const settings={app,localAssets,receiptStore:receipts,api,openFrames,onCheckpoint,loadConfiguration:async()=>currentConfig,fetchImpl:fetch};
 const branchStart=client.indexOf("  case 'video_segment_target':"),branchEnd=client.indexOf("  case 'video_analyze':",branchStart),branch=client.slice(branchStart,branchEnd).replace(/await import\('[^']+'\)/,'await getNative()');
 const dispatchContext={app,window:{LocalAssets:localAssets,CanvasStore:undefined},getNative:async()=>({...module,executeAgentSegmentation:(name,input,context)=>module.executeAgentSegmentation(name,input,{...settings,...context})})};
 vm.runInNewContext('async function dispatch(name,a,signal,segmentationApprovalGuard,approvedSegmentationConfiguration,onSegmentationCheckpoint){switch(name){'+branch+'}}this.dispatch=dispatch;',dispatchContext);
 async function run(name='video_segment_target',input=args,{mode='ask',confirm=async()=>true,signal}={}){
  const checked=parse(name,input),call={name,callId:'sam-call',args:checked.args},paid=['video_segment_target','video_segmentation_resume'].includes(name),approvalGuard=paid?module.captureAgentSegmentationApproval(input,{app,signal}):undefined,approvedConfiguration=paid?await module.segmentationApprovalConfiguration({loadConfiguration:settings.loadConfiguration,signal}):undefined;
  return traceModule.executeTracedCall(call,{signal,confirm:traceModule.needsToolConfirmation(checked.definition,mode)?confirm:null,changed:value=>trace=value,execute:()=>dispatchContext.dispatch(name,input,signal,approvalGuard,approvedConfiguration,onCheckpoint)});
 }
 return {run,module,settings,args,node,state,events,receipts,get trace(){return trace;},get savedTrace(){return savedTrace;},get postCount(){return postCount;},get getCount(){return getCount;},get resumeCount(){return resumeCount;},get cancelCount(){return cancelCount;},get assetCount(){return assetCount;},get updates(){return updates;},setProject:value=>project=value,setSaveFailure:value=>saveFails=value,setConfig:value=>currentConfig=value};
}
test('dedicated schema rejects invented normalized parameters and provider overrides',()=>{
 assert.equal(parse('video_segment_target',args).args.time,2.5);for(const patch of [{operationId:'opaque'},{model:'other'},{time:-1},{rect:{x:1,y:1,width:0,height:10}},{rect:{x:1,y:1,width:10,height:10,z:1}},{referenceIds:['x']}])assert.throws(()=>parse('video_segment_target',{...args,...patch}));
});
test('real Agent trace confirmation blocks media and POST in ask and auto; denial does neither',async()=>{
 for(const mode of ['ask','auto']){const f=await fixture(),gate=deferred(),pending=f.run(undefined,undefined,{mode,confirm:()=>gate.promise});await tick();assert.equal(f.trace.status,'pending');assert.deepEqual(f.events,[]);gate.resolve(true);const result=(await pending).result;assert.equal(result.status,'applied');assert.equal(result.saved,true);assert.equal(f.postCount,1);assert.equal(f.assetCount,1);assert.equal(f.updates,1);assert.equal(f.state.nodes.length,1);assert.equal(f.node.videoMask.timeline,'full-source');assert.equal(f.node.videoMask.time,2.5);assert.deepEqual(f.node.clip,{start:1,end:4});assert.equal(f.savedTrace.segmentationTask.status,'applied');assert(f.events.indexOf('trace-unknown')<f.events.indexOf('POST'));}
 const f=await fixture();const result=await f.run(undefined,undefined,{mode:'auto',confirm:()=>false});assert(result.result.error);assert.deepEqual(f.events,[]);
});
test('approval binds project, exact object, source, clip, mask and arguments before reads',async()=>{
 for(const mutate of [f=>f.setProject('q'),f=>f.state.nodes[0]={...f.node},f=>f.node.video='asset:other',f=>f.node.clip.end=5,f=>f.node.videoMask={asset:'asset:other'},f=>f.args.rect.x++]){
  const f=await fixture(),input=structuredClone(args);f.args=input;const gate=deferred(),pending=f.run(undefined,input,{confirm:()=>gate.promise});await tick();mutate(f);gate.resolve(true);const result=await pending;assert(result.result.error);assert.equal(f.postCount,0);assert(!f.events.includes('media-read'));
 }
});
test('source pixel/time bounds, fixed config, missing consent and wrong SHA fail without mask application',async()=>{
 for(const patch of [{rect:{x:300,y:0,width:64,height:30}},{time:8.5}]){const f=await fixture();assert((await f.run(undefined,{...args,...patch})).result.error);assert.equal(f.postCount,0);}
 const f=await fixture(),gate=deferred(),pending=f.run(undefined,undefined,{confirm:()=>gate.promise});await tick();f.setConfig({...config,providerFingerprint:'other'});gate.resolve(true);assert((await pending).result.error);assert.equal(f.postCount,0);
 const g=await fixture();await assert.rejects(g.module.executeAgentSegmentation('video_segment_target',args,g.settings),/独立明确确认/);assert.deepEqual(g.events,[]);
 const h=await fixture({wrongSha:true});assert((await h.run()).result.error);assert.equal(h.updates,0);
});
test('durable trace and shared receipt failures precede create; stop waiting on media cannot create',async()=>{
 for(const options of [{traceFailure:true},{receiptFailure:true}]){const f=await fixture(options);assert((await f.run()).result.error);assert.equal(f.postCount,0);}
 const gate=deferred(),f=await fixture({mediaGate:gate}),controller=new AbortController(),pending=f.run(undefined,undefined,{signal:controller.signal});await tick();controller.abort();gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.postCount,0);
});
test('unknown receipt and same operation replay only GET original UUID; new operation never overwrites',async()=>{
 const f=await fixture({createFailure:true});const initial=(await f.run()).result;assert.equal(initial.status,'unknown');assert.equal(initial.taskId,id);assert.equal(f.postCount,1);
 const replay=(await f.run()).result;assert.equal(replay.status,'applied');assert.equal(f.postCount,1);assert.equal(f.getCount,1);
 const another=(await f.run(undefined,{...args,operationId:'40fca941-9dcb-4c36-a116-c40d6cb4c023'})).result;assert.equal(another.status,'existing_task');assert.equal(another.taskId,id);assert.equal(f.postCount,1);
});
test('save failure/reload retries same local asset, one history patch, no provider request',async()=>{
 const f=await fixture();f.setSaveFailure(true);const initial=(await f.run()).result;assert.equal(initial.status,'save_failed');assert.equal(initial.saved,false);assert.equal(f.assetCount,1);assert.equal(f.updates,1);f.setSaveFailure(false);
 const result=(await f.run('video_segmentation_retry_save',{nodeId:'video',taskId:id},{mode:'auto'})).result;assert.equal(result.status,'applied');assert.equal(f.postCount,1);assert.equal(f.getCount,0);assert.equal(f.assetCount,1);assert.equal(f.updates,1);
});
test('applied conversation save failure is not ready; explicit resume confirms again and cancel preserves original',async()=>{
 const f=await fixture({appliedTraceFailure:true});assert.equal((await f.run()).result.status,'save_failed');assert.equal(f.postCount,1);
 const g=await fixture({taskStatus:'needs_resume'});assert.equal((await g.run()).result.status,'needs_resume');const gate=deferred(),pending=g.run('video_segmentation_resume',{nodeId:'video',taskId:id},{mode:'auto',confirm:()=>gate.promise});await tick();assert.equal(g.resumeCount,0);gate.resolve(true);assert.equal((await pending).result.status,'applied');assert.equal(g.resumeCount,1);assert.equal(g.postCount,1);
 const h=await fixture({taskStatus:'unknown'});await h.run();assert.equal((await h.run('video_segmentation_cancel',{nodeId:'video',taskId:id},{mode:'auto'})).result.status,'cancelled');assert.equal(h.cancelCount,1);assert.equal(h.postCount,1);
});
test('resume rejects receipt A / approved B / current A before paid dispatch',async()=>{
 const f=await fixture({taskStatus:'needs_resume'});await f.run();f.setConfig({...config,providerFingerprint:'unapproved-b'});const gate=deferred(),pending=f.run('video_segmentation_resume',{nodeId:'video',taskId:id},{mode:'auto',confirm:()=>gate.promise});await tick();f.setConfig(config);gate.resolve(true);assert((await pending).result.error);assert.equal(f.resumeCount,0);assert.equal(f.postCount,1);
});
test('actual Agent checkpoint callback awaits storage flush, guards conversation, and records applied before ready',async()=>{
 const start=client.indexOf('       const onSegmentationCheckpoint=async record=>'),end=client.indexOf('       const onDepthSubmitted=async job=>',start),gate=deferred(),trace={role:'tool',callId:'sam-call'},run={},chat={messages:[trace],activeRun:run},controller=new AbortController();let persisted,current=chat;
 const context={d:chat,run,runController:controller,call:{callId:'sam-call'},draft:()=>current,save:()=>{persisted=structuredClone(trace);return true;},flushConversation:()=>gate.promise,executionRenderer:{updateTrace:()=>{}},DOMException};vm.runInNewContext(client.slice(start,end)+'this.checkpoint=onSegmentationCheckpoint;',context);
 let returned=false;const pending=context.checkpoint({id,nodeId:'video',status:'unknown'}).then(()=>returned=true);await tick();assert.equal(persisted.submittedTaskId,id);assert.equal(returned,false);gate.resolve();await pending;
 await context.checkpoint({id,nodeId:'video',status:'applied'});assert.equal(persisted.result.applied,true);assert.equal(persisted.result.saved,true);
 current={};await assert.rejects(context.checkpoint({id,status:'unknown'}),{name:'AbortError'});context.save=()=>false;current=chat;await assert.rejects(context.checkpoint({id,status:'unknown'}),/未能保存/);
});
test('actual client preapproval config capture reads no media and binds conversation across config awaits',async()=>{
 const start=client.indexOf("     if(['video_segment_target','video_segmentation_resume'].includes(call.name))"),end=client.indexOf("     if(call.name==='generation_submit'",start),code=client.slice(start,end).replace(/await import\('[^']+'\)/,"await getNative()");
 const module=await import('../src/features/agent-generation/video-segmentation.mjs');
 for(const mutate of ['none','source','conversation']){
  const f=await fixture(),gate=deferred(),run={},chat={activeRun:run},controller=new AbortController();let current=chat;
  const context={app:f.settings.app,call:{name:'video_segment_target',args:structuredClone(args)},runController:controller,d:chat,run,draft:()=>current,getNative:async()=>({...module,segmentationApprovalConfiguration:async()=>{await gate.promise;return config;}}),DOMException};
  vm.runInNewContext('async function prepare(){let segmentationApprovalGuard,segmentationConfiguration,segmentationNotice;'+code+'return {guard:segmentationApprovalGuard,configuration:segmentationConfiguration,notice:segmentationNotice};}this.prepare=prepare;',context);
  const pending=context.prepare();await tick();assert.deepEqual(f.events,[]);if(mutate==='source')f.node.clip.end=5;if(mutate==='conversation')current={};gate.resolve();if(mutate==='none'){const approval=await pending;assert.match(approval.notice,/最多两次/);assert.match(approval.notice,/pinned-model/);}else await assert.rejects(pending);assert.deepEqual(f.events,[]);
 }
});
test('shared native UI receipt without Agent media metadata recovers full result using verified source SHA',async()=>{
 const f=await fixture({taskStatus:'unknown'});await f.run();const receipt=f.receipts.read('p','video');delete receipt.media;delete receipt.agentArguments;f.receipts.save(receipt);
 const result=(await f.run('video_segmentation_recover',{nodeId:'video',taskId:id},{mode:'auto'})).result;assert.equal(result.status,'applied');assert.equal(f.postCount,1);assert.equal(f.getCount,1);assert.deepEqual(f.receipts.read('p','video').media,{width:320,height:180,duration:8});
});
test('independent recovery card offers only same UUID actions, no new create or edited-video action',async()=>{
 const {createSegmentationRecoveryCard}=await import('../src/features/agent-generation/video-segmentation-card.mjs');
 const document={createElement:tag=>({tag,children:[],setAttribute(){},append(...nodes){this.children.push(...nodes);}})},calls=[];
 const trace={name:'video_segment_target',args,segmentationTask:{id,nodeId:'video',status:'needs_resume'},result:{status:'needs_resume'}};
 const card=createSegmentationRecoveryCard(trace,{document,onAction:(...values)=>calls.push(values)}),buttons=card.children.at(-1).children;for(const button of buttons)button.onclick();assert.deepEqual(calls.map(call=>call[0]),['video_segmentation_recover','video_segmentation_resume','video_segmentation_cancel']);assert(calls.every(call=>call[1].taskId===id));
 const failed=createSegmentationRecoveryCard({...trace,result:{status:'save_failed'},segmentationTask:{id,nodeId:'video',maskAsset:'asset:mask'}},{document,disabled:true});assert(failed.children.at(-1).children.every(button=>button.disabled));assert.equal(failed.children.at(-1).children[1].textContent,'重试保存同一蒙层');
});
test('cancel original UUID survives source/clip drift but rejects changed project, node object or receipt CAS',async()=>{
 const f=await fixture({taskStatus:'unknown'});await f.run();f.node.video=null;f.node.clip={start:2,end:3};f.node.videoMask={asset:'asset:manual'};
 const result=(await f.run('video_segmentation_cancel',{nodeId:'video',taskId:id},{mode:'auto'})).result;assert.equal(result.status,'cancelled');assert.equal(f.cancelCount,1);assert.equal(f.postCount,1);assert.equal(f.assetCount,0);assert.equal(f.updates,0);
 for(const change of ['project','node','receipt']){
  const g=await fixture({taskStatus:'unknown'});await g.run();const originalStore=g.settings.receiptStore;let firstRead=true;
  g.settings.receiptStore={...originalStore,read:(projectId,nodeId)=>{const value=originalStore.read(projectId,nodeId);if(firstRead){firstRead=false;if(change==='project')g.setProject('other');else if(change==='node')g.state.nodes[0]={...g.node};else {const changed=originalStore.read(projectId,nodeId);originalStore.save(changed);}}return value;}};
  assert((await g.run('video_segmentation_cancel',{nodeId:'video',taskId:id},{mode:'auto'})).result.error);assert.equal(g.cancelCount,0);assert.equal(g.postCount,1);assert.equal(g.updates,0);
 }
});
test('actual non-Studio canvas submission sends null activeScene before StudioAPI registers; Studio chat still refuses',async()=>{
 const validateStart=client.indexOf(' function validateSubmission('),validateEnd=client.indexOf(' function clearSubmittedDraft(',validateStart),turnStart=client.indexOf("   let response=await request('turn'"),turnEnd=client.indexOf('\n   completed=await runToolLoop',turnStart);let sent;
 const context={appQueueSaving:false,pageLeaving:false,modelModule:{},window:{},d:{studioNodeId:null},item:{studioNodeId:null,uploads:[]},run:{binding:{projectId:'p'}},text:'识别视频目标',history:[],selection:{},mediaInputs:[],conversationMemory:{},submittedReferences:[],referencedMaterials:[],submittedRefs:[],submittedSkills:[],controller:{signal:undefined},seenCallIds:new Set(),graph:async()=>({nodes:[],edges:[]}),artifactContext:async()=>[],request:async(path,payload)=>{assert.equal(path,'turn');sent=payload;return {done:true};}};
 vm.runInNewContext(client.slice(validateStart,validateEnd)+'async function submit(){validateSubmission(d,item);'+client.slice(turnStart,turnEnd)+'return response;}this.submit=submit;',context);
 assert.equal((await context.submit()).done,true);assert.equal(sent.context.activeScene,null);assert.equal(sent.context.studioNodeId,null);assert.equal(context.window.StudioAPI,undefined);
 context.d={studioNodeId:'studio-1'};context.item={studioNodeId:'studio-1',uploads:[]};await assert.rejects(context.submit(),/请先打开此对话对应的片场/);
});
test('save failure and successful retry messages follow canvas state; applied card removes retry while original failure remains',async()=>{
 const {createSegmentationRecoveryCard}=await import('../src/features/agent-generation/video-segmentation-card.mjs'),f=await fixture();f.setSaveFailure(true);const failure=(await f.run()).result;assert.equal(failure.status,'save_failed');assert.match(failure.message,/尚未确认保存/);assert.doesNotMatch(failure.message,/正在保存到画布/);
 const failedTrace={name:'video_segment_target',args,segmentationTask:structuredClone(f.trace.segmentationTask),result:structuredClone(failure)},before=structuredClone(failedTrace);f.setSaveFailure(false);const success=(await f.run('video_segmentation_retry_save',{nodeId:'video',taskId:id},{mode:'auto'})).result;assert.equal(success.status,'applied');assert.match(success.message,/已保存到画布/);assert.doesNotMatch(success.message,/正在保存/);assert.equal(f.postCount,1);assert.equal(f.assetCount,1);assert.equal(f.updates,1);
 const document={createElement:tag=>({tag,children:[],setAttribute(){},append(...nodes){this.children.push(...nodes);}})};
 const staleMessage='完整蒙层已归档，正在保存到画布';const successCard=createSegmentationRecoveryCard({name:'video_segmentation_retry_save',args:{nodeId:'video',taskId:id},segmentationTask:{id,nodeId:'video',status:'applied',maskAsset:f.node.videoMask.asset},result:{...success,message:staleMessage}},{document});assert.equal(successCard.children[1].textContent,'完整时序蒙层已保存到画布。');assert(!successCard.children.at(-1).children.some(button=>button.textContent.includes('重试保存')));
 const failureCard=createSegmentationRecoveryCard({...failedTrace,result:{...failedTrace.result,message:staleMessage}},{document});assert.match(failureCard.children[1].textContent,/尚未确认保存/);assert(failureCard.children.at(-1).children.some(button=>button.textContent.includes('重试保存')));assert.deepEqual(failedTrace,before);
});
test('saved SAM2 recovery stages the original pending receipt for explicit continue, without replay or hiding failure history',async()=>{
 const module=await import('../src/features/agent-generation/video-segmentation-receipt.mjs'),journal=await import('../src/features/agent-recovery/journal.mjs'),model=await import('../src/features/agent-recovery/model.mjs');
 async function recoveryFixture(){
  const f=await fixture(),chat={id:'chat',messages:[],interruptedRuns:[]},record=model.beginRun(chat,{projectId:'p',submissionId:'submission'});record.sessionId='original-session';
  const start=client.indexOf(' async function recoverySourceVersion('),end=client.indexOf(' async function resumeInterruptedRun(',start),code=client.slice(start,end).replace(/await import\('[^']+'\)/,"await getSubjectLibrary()");
  const context={app:f.settings.app,project:{id:'p'},window:{NodeEditor:{getConfig:()=>({})}},artifactsReady:Promise.resolve({list:async()=>[]}),catalog:async()=>[],customSkills:()=>[],disabledSkills:()=>[],liveLibrary:()=>({items:[]}),recoveryModule:journal,getSubjectLibrary:async()=>({readySubjects:async()=>{},getSubjectStore:()=>({recoverySource:async()=>[]})})};vm.runInNewContext(code+'this.sourceVersion=recoverySourceVersion;',context);
  const sourceVersion=options=>context.sourceVersion(chat,options);await journal.initializeJournal(record,{submission:{id:'submission',studioNodeId:null},sourceVersion:await sourceVersion()});journal.recordPendingRound(record,{sessionId:record.sessionId,round:1,calls:[{callId:'sam-call',name:'video_segment_target'}]},new Set(['sam-call']));
  f.setSaveFailure(true);const failure=(await f.run()).result,originalTrace=f.trace;originalTrace.runId='submission';chat.messages.push(originalTrace);journal.recordExecutedCalls(record,[{callId:'sam-call',result:failure}]);const interrupted=model.interruptRun(chat,record);interrupted.state={status:'waiting_tools',round:1,pending:[{callId:'sam-call',name:'video_segment_target'}],canResumeWithReceipts:true};
  f.setSaveFailure(false);const result=(await f.run('video_segmentation_retry_save',{nodeId:'video',taskId:id},{mode:'auto'})).result;assert.equal(result.status,'applied');
  return {f,chat,record:interrupted,originalTrace,result,sourceVersion,scope:{projectId:'p',conversationId:'chat'},before:structuredClone(originalTrace)};
 }
 const f=await recoveryFixture();assert.deepEqual(module.segmentationOriginFor({name:'video_segmentation_retry_save',args:{nodeId:'video'},result:f.result},f.chat),{traceId:f.originalTrace.id,runId:f.originalTrace.runId,callId:f.originalTrace.callId});const prepared=await module.prepareAppliedSegmentationReceipt({chat:f.chat,originTrace:f.originalTrace,result:f.result,app:f.f.settings.app,scope:f.scope,sourceVersion:f.sourceVersion,isCurrent:()=>true,receiptStore:f.f.receipts});assert.equal(prepared.record,f.record);assert.equal(journal.resumeEligibility(f.record,f.scope).allowed,true);
 // JSON persistence retains the exact original call identity and factual result.
 const hydrated=JSON.parse(JSON.stringify(f.record)),plan=await journal.buildResumePlan(hydrated,f.scope,await f.sourceVersion());assert.equal(plan.sessionId,'original-session');assert.equal(plan.results[0].callId,'sam-call');assert.equal(plan.results[0].result.taskId,id);assert.equal(plan.results[0].result.saved,true);assert.equal(f.f.postCount,1);assert.equal(f.f.assetCount,1);assert.equal(f.f.updates,1);assert.deepEqual(f.originalTrace,f.before);assert.equal(f.originalTrace.result.status,'save_failed');
 for(const change of ['source','unrelated','call','task','project','during-version','mask-source','mask-clip','mask-time','mask-width','mask-height','mask-duration','mask-timeline','mask-extra']){
  const g=await recoveryFixture();if(change==='source')g.f.node.clip.end=5;if(change==='unrelated')g.f.state.nodes.push({id:'unrelated',type:'text',content:'new'});if(change==='call')g.originalTrace.callId='another';if(change==='task')g.result.taskId='40fca941-9dcb-4c36-a116-c40d6cb4c023';if(change==='project')g.scope.projectId='another';if(change.startsWith('mask-'))g.f.node.videoMask[change.slice(5)]=change==='mask-extra'?'added':change==='mask-time'?3:change==='mask-width'?321:change==='mask-height'?181:change==='mask-duration'?9:'modified';
  const before=structuredClone(g.record.journal),readVersion=options=>{if(change==='during-version'&&!options?.segmentationBaseline)g.f.state.nodes.push({id:'late-edit',type:'text',content:'changed while snapshotting'});return g.sourceVersion(options);};let returned;try{returned=await module.prepareAppliedSegmentationReceipt({chat:g.chat,originTrace:g.originalTrace,result:g.result,app:g.f.settings.app,scope:g.scope,sourceVersion:readVersion,isCurrent:()=>true,receiptStore:g.f.receipts});}catch(error){assert.match(error.message,/来源|回执|蒙层/);}assert(!returned);assert.deepEqual(g.record.journal,before);assert.equal(g.f.postCount,1);
 }
});
test('actual recovery module failure persists on original card across final render instead of disappearing',async()=>{
 const {createSegmentationRecoveryCard}=await import('../src/features/agent-generation/video-segmentation-card.mjs'),trace={id:'old',name:'video_segment_target',role:'tool',args,segmentationTask:{id,nodeId:'video',status:'succeeded'},result:{status:'save_failed',error:'original disk full'}},chat={messages:[trace]},events=[];let persisted;
 const start=client.indexOf(' async function recoverSegmentationFromCard('),end=client.indexOf(' function appendResultCards(',start),code=client.slice(start,end).replace(/await import\('([^']+)'\)/g,(_all,name)=>'await modules('+JSON.stringify(name)+')');
 const context={busy:false,queueRunner:null,pageLeaving:false,panel:{},draft:()=>chat,app:{projectIdentity:()=>({id:'p'})},executionReady:Promise.resolve(),executionModule:{},controller:null,segmentationRecoveryActive:false,pendingResolve:null,pendingTraceId:null,AbortController,DOMException,Date,save:()=>{persisted=structuredClone(trace);events.push('save');return true;},flushConversation:async()=>events.push('flush'),render:()=>events.push('render'),notice:()=>events.push('notice'),modules:async name=>{if(name.endsWith('video-segmentation-receipt.mjs'))throw Error('Failed to fetch dynamically imported module: /video-segmentation-receipt.mjs');return {};}};
 vm.runInNewContext(code+'this.recover=recoverSegmentationFromCard;',context);await context.recover(trace,'video_segmentation_retry_save',{nodeId:'video',taskId:id});assert.equal(trace.segmentationRecoveryError.stage,'load_receipt');assert.equal(persisted.segmentationRecoveryError.stage,'load_receipt');assert.equal(events.at(-1),'notice');assert.equal(events.at(-2),'render');assert.equal(trace.result.error,'original disk full');assert.equal(chat.messages.length,1);
 const document={createElement:tag=>({tag,children:[],setAttribute(key,value){this[key]=value;},append(...nodes){this.children.push(...nodes);}})},card=createSegmentationRecoveryCard(JSON.parse(JSON.stringify(persisted)),{document});assert(card.children.some(node=>node.role==='alert'&&node.textContent.includes('加载原回执模块')&&node.textContent.includes('Failed to fetch')));
});
test('actual Agent result thumbnail resolves immutable assets, rejects late scope/source changes and keeps existing icon on failures',async()=>{
 const start=client.indexOf(' function appendResultThumbnail('),end=client.indexOf(' function appendResultCards(',start),code=client.slice(start,end);
 function thumbFixture(){const node={id:'video',type:'video',image:'asset:poster',video:'asset:source',title:'真实视频'},state={nodes:[node]},chat={},gate=deferred(),images=[],reads=[];let project='p',currentChat=chat;
  const card={isConnected:true,children:[],append(child){this.children.push(child);child.parentNode=this;}},el=(tag,className)=>{const element={tag,className,replaceWith(next){const index=this.parentNode.children.indexOf(this);this.parentNode.children[index]=next;next.parentNode=this.parentNode;this.parentNode=null;}};if(tag==='img')images.push(element);return element;};
  const context={app:{getState:()=>state,projectIdentity:()=>({id:project})},draft:()=>currentChat,pageLeaving:false,window:{UI_ICONS:{video:'existing-video-icon',cube:'existing-cube-icon',file:'existing-file-icon'},LocalAssets:{url:async source=>{reads.push(source);return gate.promise;}}},el};vm.runInNewContext(code+'this.paint=appendResultThumbnail;',context);context.paint(card,node);return {node,state,card,context,gate,images,reads,setProject:value=>project=value,setChat:value=>currentChat=value};
 }
 const f=thumbFixture();await tick();assert.deepEqual(f.reads,['asset:poster']);assert.equal(f.card.children[0].innerHTML,'existing-video-icon');f.gate.resolve('blob:resolved-poster');await tick();assert.equal(f.images[0].src,'blob:resolved-poster');assert.equal(f.card.children[0].tag,'span');f.images[0].onload();assert.equal(f.card.children[0].tag,'img');
 for(const mutation of ['project','chat','node','image','video','removed']){const g=thumbFixture();await tick();if(mutation==='project')g.setProject('q');if(mutation==='chat')g.setChat({});if(mutation==='node')g.state.nodes[0]={...g.node};if(mutation==='image')g.node.image='asset:new';if(mutation==='video')g.node.video='asset:new';if(mutation==='removed')g.card.isConnected=false;g.gate.resolve('blob:late');await tick();assert.equal(g.images.length,0);assert.equal(g.card.children[0].innerHTML,'existing-video-icon');}
 const loaded=thumbFixture();await tick();loaded.gate.resolve('blob:load-then-drift');await tick();loaded.node.image='asset:changed';loaded.images[0].onload();assert.equal(loaded.card.children[0].tag,'span');
 const failure=thumbFixture();failure.context.window.LocalAssets.url=async()=>{throw Error('missing asset / display policy blocked');};await tick();assert.equal(failure.images.length,0);assert.equal(failure.card.children[0].innerHTML,'existing-video-icon');
 const decode=thumbFixture();await tick();decode.gate.resolve('blob:bad-image');await tick();decode.images[0].onerror();assert.equal(decode.card.children[0].innerHTML,'existing-video-icon');
});
test('SAM2 trace titles require actual applied and saved result, not completed invocation or provider success',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const outcomes=[
  [{status:'applied',applied:true,saved:true},'完整视频蒙层已应用并保存'],
  [{status:'applied',applied:false,saved:true},'视频蒙层应用和保存尚未确认'],
  [{status:'applied',applied:true,saved:false},'视频蒙层应用和保存尚未确认'],
  [{status:'applied'},'视频蒙层应用和保存尚未确认'],
  [{status:'applied',applied:true,saved:true,error:'checkpoint failed'},'视频蒙层应用和保存尚未确认'],
  [{status:'succeeded',applied:true,saved:true},'视频识别已完成，蒙层应用和保存尚未确认'],
  [{status:'needs_resume',applied:false,saved:false},'视频识别等待确认续发分支'],
  [{status:'unknown'},'原视频识别任务状态未确认'],
  [{status:'cancelled'},'原视频识别任务已取消'],
  [{status:'save_failed',error:'disk full'},'完整视频蒙层保存失败，尚未确认保存'],
  [{status:'failed'},'原视频识别任务失败'],
  [{status:'intent'},'原视频识别意图已记录，派发尚未确认'],
  [{status:'existing_task',error:'original UUID exists'},'节点保留原视频识别任务，待查询'],
  [{status:'preparing'},'原视频识别任务正在准备'],
  [{status:'queued'},'原视频识别任务等待处理'],
  [{status:'running'},'原视频识别任务仍在处理中'],
  [{},'视频识别结果待核对'],
  [{error:'guard refused'},'视频识别操作失败']
 ];
 for(const name of ['video_segment_target','video_segmentation_recover','video_segmentation_resume','video_segmentation_cancel','video_segmentation_retry_save']){
  const trace={name,args:name==='video_segment_target'?args:{nodeId:'video',taskId:id},segmentationTask:{status:'applied'},status:'done'},pending=toolPresentation({...trace,status:'pending'});
  for(const [result,title] of outcomes){const view=toolPresentation({...trace,status:result.error?'error':'done',result});assert.equal(view.label,title+' · '+view.detail,name+' '+(result.status||'missing'));assert.equal(view.action,pending.action);assert.equal(view.icon,pending.icon);assert.equal(view.detail,pending.detail);}
  assert.equal(toolPresentation({...trace,status:'running',result:{status:'needs_resume'}}).label,'正在'+pending.action+' · '+pending.detail);
 }
});
