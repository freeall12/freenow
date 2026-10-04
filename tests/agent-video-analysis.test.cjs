const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskService}=require('../generation-api.js');
const modulePromise=import('../src/features/agent-workflows/video-analysis.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const input={operationId:'analyze-first',nodeId:'source'};
function memoryStorage(){const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),rows};}
const output={type:'video',url:'data:video/mp4;base64,AAAA',poster:'data:image/jpeg;base64,AAAA',title:'协议测试镜头',text:'协议替身描述',width:640,height:360,duration:2,sourceRange:{start:2.125,end:4.125}};
async function fixture(overrides={}){
  const {createAgentVideoAnalysis}=await modulePromise,{createApplicationRunner}=await import('../src/features/generation-results/application.mjs');
  const state={nodes:[{id:'source',type:'video',video:'asset:source',clip:{start:2.125,end:5.5},x:12.5,y:40.25}],edges:[]},calls={decode:[],transport:[],availability:[],submit:0,generate:0,authorize:0,apply:0},storage=memoryStorage(),derivedTargets=new Map(),listeners=new Set(),document=new EventTarget(),window=new EventTarget(),navigation=new Set();
  let project='project-a',saveFails=false,configured=true;
  const projects={registerNavigationGuard:fn=>{navigation.add(fn);return()=>navigation.delete(fn);}};
  const service=new TaskService({prepareRequest:overrides.prepareRequest,prepareInputs:overrides.prepareInputs});service.setProvider({isConfigured:async()=>configured,generate:async(request,options)=>{calls.generate++;return overrides.generate?overrides.generate(request,options):{outputs:[structuredClone(output)]};}});
  const runner=createApplicationRunner({getJob:id=>service.jobs.get(id),apply:async job=>{
    const target=derivedTargets.get(job.id);target.guard();if(!job.resultIds){calls.apply++;state.nodes.push({id:'result-'+calls.apply,...job.outputs[0],video:job.outputs[0].url});job.resultIds=[state.nodes.at(-1).id];}
    if(saveFails)throw Error('disk full');
  },changed:job=>{for(const fn of listeners)fn({...job,controller:undefined});}});
  service.subscribe(job=>{for(const fn of listeners)fn(job);if(job.status==='succeeded')void runner.run(job.id);});
  // Read the actual UI adapter, so this test requires the dispatch receipt hook
  // to be wired through submitDerived rather than a separate test substitute.
  const ui=fs.readFileSync(require.resolve('../generation-ui.js'),'utf8'),context={service,localProvider:null,submitJob:(request,options)=>{calls.submit++;return service.submit(request,overrides.beforeDispatchReady?{...options,beforeDispatchReady:context=>overrides.beforeDispatchReady(context,options.beforeDispatchReady)}:options);},derivedTargets};
  vm.runInNewContext(ui.slice(ui.indexOf('  async function availability('),ui.indexOf('  function submitJob(')),context);
  vm.runInNewContext(ui.slice(ui.indexOf('  function submitDerived('),ui.indexOf('  window.GenerationAPI=')),context);
  const api={availability:options=>{calls.availability.push(options);return overrides.availability?overrides.availability(options):context.availability(options);},submitDerived:context.submitDerived,getJobs:()=>[...service.jobs.values()],cancel:id=>service.cancel(id),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},retryApplication:id=>runner.run(id)};
  const options={app:{getState:()=>state},generationAPI:api,storage,document,window,projects,getProjectId:()=>project,baseUrl:'http://localhost:4173/',
    resolveMedia:async(node,{signal})=>{calls.decode.push(structuredClone(node));return overrides.decode?overrides.decode(node,{signal}):{url:'blob:full-source',width:640,height:360,duration:8};},
    transport:async(request,options)=>{calls.transport.push(structuredClone(request));options.validateSources();return overrides.transport?overrides.transport(request,options):{...request,inputs:request.inputs.map(value=>({...value,url:'data:video/mp4;base64,AAAA'}))};},...overrides.options};
  const host=createAgentVideoAnalysis(options),authorize=(name,args)=>{assert.equal(name,'video_analyze');assert.deepEqual(args,input);calls.authorize++;};
  return {host,newHost:()=>createAgentVideoAnalysis(options),state,calls,storage,api,service,authorize,document,window,navigation,render:()=>document.dispatchEvent(new Event('canvas:render')),setConfigured:value=>{configured=value;},setProject:value=>{project=value;},setSaveFailure:value=>{saveFails=value;}};
}
async function settled(f,id){for(let count=0;count<100;count++){const job=f.api.getJobs().find(job=>job.id===id);if(job&&(['failed','unknown','cancelled','configuration_required'].includes(job.status)||job.status==='succeeded'&&!job.applying&&job.applicationStatus))return job;await tick();}throw Error('task did not settle');}

test('real derived submission preserves complete source metadata/absolute clip and applies physical outputs once',async()=>{
  const f=await fixture(),receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);
  assert.equal(f.calls.decode[0].clip,undefined);assert.equal(f.calls.decode[0].trim,undefined);assert.equal(f.calls.decode[0].video,'asset:source');
  const job=f.service.jobs.get(receipt.taskId);assert.equal(job.request.kind,'video.analyze');assert.equal(job.request.inputs[0].duration,8);assert.deepEqual(job.request.inputs[0].clip,{start:2.125,end:5.5});assert.deepEqual(job.request.parameters.nodePosition,{x:12.5,y:40.25});
  assert.deepEqual(job.request.agentVideoAnalysis,input);const done=f.host.get(input.operationId);assert.equal(done.status,'succeeded');assert.equal(done.applied,true);assert.deepEqual(done.resultIds,['result-1']);assert.deepEqual(done.nodeIds,done.resultIds);
  assert.equal(f.state.nodes[1].clip,undefined);assert.deepEqual(f.state.nodes[1].sourceRange,output.sourceRange);assert.ok(!JSON.stringify(done).includes('asset:'));assert.ok(!JSON.stringify(done).includes('data:'));
  await f.host.execute(input,{authorize:f.authorize});assert.equal(f.calls.submit,1);assert.equal(f.calls.generate,1);assert.equal(f.calls.apply,1);
});

test('host acknowledgement commits before provider dispatch and concurrent identical calls share one task',async()=>{
  const gate=deferred(),entered=deferred(),f=await fixture(),onSubmitted=job=>{entered.resolve(job);return gate.promise;};
  const first=f.host.execute(input,{authorize:f.authorize,onSubmitted});const job=await entered.promise;
  const second=f.host.execute(input,{authorize:f.authorize,onSubmitted});await tick();assert.equal(f.calls.generate,0);assert.equal(f.calls.submit,1);assert.ok([...f.storage.rows.values()].some(raw=>JSON.parse(raw).operations[0].taskId===job.id));
  gate.resolve();const [a,b]=await Promise.all([first,second]);assert.equal(a.taskId,b.taskId);await settled(f,a.taskId);assert.equal(f.calls.generate,1);
});

test('failed acknowledgement, missing authorization and failed operation storage never dispatch a model',async()=>{
  const f=await fixture();await assert.rejects(f.host.execute(input),error=>error.code==='authorization_required');assert.equal(f.calls.submit,0);
  await assert.rejects(f.host.execute(input,{authorize:f.authorize,onSubmitted:async()=>{throw Error('checkpoint failed');}}),/checkpoint failed/);await tick();assert.equal(f.calls.generate,0);
  const broken=await fixture({options:{storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}}});await assert.rejects(broken.host.execute(input,{authorize:broken.authorize}),error=>error.code==='operation_save_failed');assert.equal(broken.calls.decode.length,0);assert.equal(broken.calls.submit,0);
});

test('unknown task/reload with absent live task retains original identity and never automatically resubmits',async()=>{
  const f=await fixture({generate:async()=>{throw Object.assign(Error('lost reply'),{code:'unknown'});}}),receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);
  const retry=await f.host.execute(input,{authorize:f.authorize});assert.equal(retry.status,'unknown');assert.equal(retry.recoveryRequired,true);assert.equal(f.calls.generate,1);
  f.service.jobs.clear();const restored=f.newHost(),after=await restored.execute(input,{authorize:f.authorize});assert.equal(after.status,'unknown');assert.equal(after.taskId,receipt.taskId);assert.deepEqual(after.resultIds,[]);assert.equal(f.calls.submit,1);
  await assert.rejects(restored.execute({...input,nodeId:'other'},{authorize:()=>{}}),error=>error.code==='operation_conflict');
});

test('refresh during preparation remains uncertain without a task identity and is not replayed',async()=>{
  const gate=deferred(),entered=deferred(),f=await fixture({decode:async()=>{entered.resolve();return gate.promise;}});
  const first=f.host.execute(input,{authorize:f.authorize});await entered.promise;const restored=f.newHost(),receipt=await restored.execute(input,{authorize:f.authorize});assert.equal(receipt.status,'unknown');assert.equal(receipt.recoveryRequired,true);assert.equal(receipt.taskId,undefined);assert.equal(f.calls.decode.length,1);
  gate.resolve({url:'blob:source',width:640,height:360,duration:8});const started=await first;await settled(f,started.taskId);assert.equal(f.calls.submit,1);
});

test('actual application retry retains outputs/result IDs and never prepares or generates again',async()=>{
  const f=await fixture();f.setSaveFailure(true);const receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);
  const failed=f.host.get(input.operationId);assert.equal(failed.status,'succeeded');assert.equal(failed.applied,false);assert.match(failed.applicationError,/disk full/);assert.deepEqual(failed.resultIds,['result-1']);
  await f.host.execute(input,{authorize:f.authorize});assert.equal(f.calls.generate,1);f.setSaveFailure(false);await f.api.retryApplication(receipt.taskId);assert.equal(f.host.get(input.operationId).applied,true);assert.equal(f.calls.apply,1);assert.equal(f.calls.decode.length,1);
});

test('source/clip/identity/project changes during preparation reject late output without submitting',async()=>{
  for(const change of [f=>{f.state.nodes[0].clip.end=6;},f=>{f.state.nodes[0]={...f.state.nodes[0]};},f=>f.setProject('another')]){
    const gate=deferred(),entered=deferred(),f=await fixture({decode:async()=>{entered.resolve();return gate.promise;}}),pending=f.host.execute(input,{authorize:f.authorize});await entered.promise;change(f);gate.resolve({url:'blob:source',width:640,height:360,duration:8});await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.submit,0);
  }
});

test('source changes during dispatch acknowledgement and after provider start block application',async()=>{
  const gate=deferred(),entered=deferred(),f=await fixture(),pending=f.host.execute(input,{authorize:f.authorize,onSubmitted:()=>{entered.resolve();return gate.promise;}});await entered.promise;f.state.nodes[0].video='asset:replacement';gate.resolve();await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.generate,0);
  const remote=deferred(),running=deferred(),g=await fixture({generate:()=>{running.resolve();return remote.promise;}}),receipt=await g.host.execute(input,{authorize:g.authorize});await running.promise;g.state.nodes[0].clip.start=3;remote.resolve({outputs:[output]});await settled(g,receipt.taskId);assert.equal(g.calls.apply,0);assert.equal(g.host.get(input.operationId).applied,false);assert.match(g.host.get(input.operationId).applicationError,/来源/);
});

test('cancellation and timeout bound uncooperative preparation; late media never submits',async()=>{
  for(const timeout of [false,true]){
    const gate=deferred(),entered=deferred(),f=await fixture({decode:async()=>{entered.resolve();return gate.promise;},options:timeout?{timeoutMs:10}:{}}),controller=new AbortController();
    const pending=f.host.execute(input,{authorize:f.authorize,signal:controller.signal});await entered.promise;if(!timeout)controller.abort();await assert.rejects(pending,error=>timeout?error.code==='media_timeout':error.name==='AbortError');gate.resolve({url:'blob:late',width:640,height:360,duration:8});await tick();assert.equal(f.calls.submit,0);
  }
});

test('cancellation during receipt saves original task identity and prevents provider dispatch',async()=>{
  const gate=deferred(),entered=deferred(),f=await fixture(),controller=new AbortController();const pending=f.host.execute(input,{authorize:f.authorize,signal:controller.signal,onSubmitted:job=>{entered.resolve(job);return gate.promise;}});const job=await entered.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');gate.resolve();await tick();assert.equal(f.calls.generate,0);assert.equal(f.host.get(input.operationId).taskId,job.id);assert.equal(f.host.get(input.operationId).status,'cancelled');
});

test('existing manual queued/unknown/succeeded-unapplied task prevents a second dispatch',async()=>{
  for(const status of ['queued','unknown','succeeded']){
    const f=await fixture();f.service.jobs.set('manual',{id:'manual',request:{kind:'video.analyze',nodeId:input.nodeId},status});await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='source_busy');assert.equal(f.calls.submit,0);
  }
});

test('request validation rejects extras/invalid clip and already aborted caller cannot reuse success',async()=>{
  const {videoAnalysisRequest}=await modulePromise;assert.throws(()=>videoAnalysisRequest({...input,model:'invented'}),error=>error.code==='invalid_request');
  const f=await fixture();f.state.nodes[0].clip.end=9;await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='invalid_clip');assert.equal(f.calls.submit,0);
  const g=await fixture(),receipt=await g.host.execute(input,{authorize:g.authorize});await settled(g,receipt.taskId);const controller=new AbortController();controller.abort();await assert.rejects(g.host.execute(input,{signal:controller.signal,authorize:g.authorize}),error=>error.name==='AbortError');assert.equal(g.calls.submit,1);
});

test('explicitly unconfigured preflight reads no media, saves no operation and permits the same operation after configuration',async()=>{
  const f=await fixture();f.setConfigured(false);
  const receipt=await f.host.execute(input,{authorize:f.authorize});
  assert.equal(receipt.status,'configuration_required');assert.equal(receipt.taskId,undefined);assert.equal(f.host.get(input.operationId),null);
  assert.equal(f.calls.availability.length,1);assert.equal(f.calls.decode.length,0);assert.equal(f.calls.transport.length,0);assert.equal(f.calls.submit,0);assert.equal(f.calls.generate,0);assert.equal(f.storage.rows.size,0);assert.equal(await [...f.navigation][0](),null);
  f.setConfigured(true);f.state.nodes[0].clip={start:1,end:6};f.state.nodes[0].x=45.5;
  const restored=f.newHost(),started=await restored.execute(input,{authorize:f.authorize});await settled(f,started.taskId);
  assert.equal(f.calls.availability.length,2);assert.equal(f.calls.submit,1);assert.deepEqual(f.service.jobs.get(started.taskId).request.inputs[0].clip,{start:1,end:6});assert.equal(f.service.jobs.get(started.taskId).request.parameters.nodePosition.x,45.5);
  restored.dispose();f.host.dispose();assert.equal(f.navigation.size,0);
});

test('availability errors do not burn the operation and null configuration retains the real API semantics',async()=>{
  let first=true;const f=await fixture({availability:async()=>{if(first){first=false;throw Error('configuration lookup failed');}return {configured:null};}});
  await assert.rejects(f.host.execute(input,{authorize:f.authorize}),/configuration lookup failed/);assert.equal(f.storage.rows.size,0);assert.equal(f.calls.decode.length,0);assert.equal(f.host.get(input.operationId),null);
  const receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);assert.equal(f.calls.submit,1);f.host.dispose();
});

test('delayed preflight shares one lookup and source or project restoration cannot revive an invalidated call',async()=>{
  for(const change of ['video','clip','trim','identity','delete','project']){
    const gate=deferred(),entered=deferred(),f=await fixture({availability:()=>{entered.resolve();return gate.promise;}});
    const pending=f.host.execute(input,{authorize:f.authorize});await entered.promise;
    const duplicate=f.host.execute(input,{authorize:f.authorize}),original=f.state.nodes[0],clip=structuredClone(original.clip);
    const outcomes=Promise.allSettled([pending,duplicate]);assert.ok(await [...f.navigation][0]());
    if(change==='video')original.video='asset:new';else if(change==='clip')original.clip.end=7;else if(change==='trim')original.trim={start:0};else if(change==='identity')f.state.nodes[0]={...original};else if(change==='delete')f.state.nodes.length=0;else f.setProject('project-b');
    f.render();f.state.nodes[0]=original;original.video='asset:source';original.clip=clip;delete original.trim;f.setProject('project-a');f.render();
    for(const outcome of await outcomes){assert.equal(outcome.status,'rejected');assert.equal(outcome.reason.code,'source_changed',change);}
    assert.equal(f.calls.availability.length,1);assert.equal(f.calls.availability[0].signal.aborted,true);assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.equal(f.storage.rows.size,0);assert.equal(await [...f.navigation][0](),null);
    gate.resolve({configured:true});await tick();assert.equal(f.calls.submit,0);f.host.dispose();
  }
});

test('caller cancellation, pagehide and disposal abort preflight without late reads and release navigation guards',async()=>{
  for(const stop of ['signal','pagehide','dispose']){
    const gate=deferred(),entered=deferred(),f=await fixture({availability:()=>{entered.resolve();return gate.promise;}}),controller=new AbortController();
    const pending=f.host.execute(input,{authorize:f.authorize,signal:controller.signal});await entered.promise;
    if(stop==='signal')controller.abort();else if(stop==='pagehide')f.window.dispatchEvent(new Event('pagehide'));else f.host.dispose();
    await assert.rejects(pending,error=>error.name==='AbortError'||error.code==='source_changed');assert.equal(f.calls.availability[0].signal.aborted,true);assert.equal(f.storage.rows.size,0);assert.equal(f.calls.decode.length,0);
    gate.resolve({configured:false});await tick();assert.equal(f.calls.submit,0);
    if(stop==='pagehide')await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='host_closed');
    f.host.dispose();assert.equal(f.navigation.size,0);
  }
});

test('event invalidation during decode, transport or acknowledgement stays sticky after the original source returns',async()=>{
  for(const stage of ['decode','transport','ack']){
    const gate=deferred(),entered=deferred(),f=await fixture(stage==='decode'?{decode:()=>{entered.resolve();return gate.promise;}}:stage==='transport'?{transport:()=>{entered.resolve();return gate.promise;}}:{});
    const pending=f.host.execute(input,{authorize:f.authorize,...stage==='ack'?{onSubmitted:()=>{entered.resolve();return gate.promise;}}:{}});await entered.promise;
    f.state.nodes[0].clip.end=7;f.render();f.state.nodes[0].clip.end=5.5;f.render();
    await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.generate,0);assert.equal(f.calls.submit,stage==='ack'?1:0);
    gate.resolve({url:'blob:late',width:640,height:360,duration:8});await tick();assert.equal(f.calls.generate,0);f.host.dispose();
  }
});

test('running source invalidation retains the real task but blocks application even after source restoration',async()=>{
  const gate=deferred(),running=deferred(),f=await fixture({generate:()=>{running.resolve();return gate.promise;}}),receipt=await f.host.execute(input,{authorize:f.authorize});await running.promise;
  f.state.nodes[0].video='asset:new';f.render();f.state.nodes[0].video='asset:source';f.render();assert.equal(f.service.jobs.get(receipt.taskId).status,'running');
  gate.resolve({outputs:[output]});await settled(f,receipt.taskId);assert.equal(f.calls.apply,0);assert.match(f.host.get(input.operationId).applicationError,/来源/);
  const retry=await f.api.retryApplication(receipt.taskId);assert.match(retry.applicationError,/来源/);assert.equal(retry.applied,false);assert.equal(f.calls.generate,1);f.host.dispose();
});

test('coordinates may move during preparation but latest coordinates must remain finite',async()=>{
  for(const valid of [true,false]){
    const gate=deferred(),entered=deferred(),f=await fixture({transport:async(request)=>{entered.resolve();await gate.promise;return request;}}),pending=f.host.execute(input,{authorize:f.authorize});await entered.promise;
    f.state.nodes[0].x=valid?71.625:NaN;f.state.nodes[0].y=-12.375;f.render();gate.resolve();
    if(valid){const receipt=await pending;await settled(f,receipt.taskId);assert.deepEqual(f.service.jobs.get(receipt.taskId).request.parameters.nodePosition,{x:71.625,y:-12.375});}
    else{await assert.rejects(pending,error=>error.code==='invalid_source');assert.equal(f.calls.submit,0);}
    f.host.dispose();
  }
});

test('pagehide cancels submitted jobs and pageshow cannot revive their original guards',async()=>{
  const gate=deferred(),running=deferred(),f=await fixture({generate:()=>{running.resolve();return gate.promise;}}),receipt=await f.host.execute(input,{authorize:f.authorize});await running.promise;
  assert.equal(await [...f.navigation][0](),null);f.window.dispatchEvent(new Event('pagehide'));f.window.dispatchEvent(new Event('pageshow'));
  assert.equal(f.host.get(input.operationId).status,'cancelled');assert.throws(()=>f.service.jobs.get(receipt.taskId).beforeDispatch(),error=>error.name==='AbortError');
  gate.resolve({outputs:[output]});await tick();assert.equal(f.calls.apply,0);const again=await f.host.execute(input,{authorize:f.authorize});assert.equal(again.taskId,receipt.taskId);assert.equal(f.calls.generate,1);f.host.dispose();
});

test('failure before the Agent acknowledgement settles promptly with its real task receipt',async()=>{
  const f=await fixture({beforeDispatchReady:async()=>{throw Error('history gate failed');},options:{timeoutMs:100}});
  await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='dispatch_stopped'&&error.message==='history gate failed'&&error.receipt.status==='failed'&&!!error.receipt.taskId);
  assert.equal(f.calls.generate,0);assert.equal(f.calls.submit,1);assert.equal(f.host.get(input.operationId).status,'failed');f.host.dispose();
});

test('an unavailable provider without an acknowledgement hook returns configuration_required and is never relabeled cancelled',async()=>{
  const f=await fixture({availability:async()=>({configured:true}),options:{timeoutMs:100}});f.setConfigured(false);
  // A host adapter which omits the dispatch hook still has a real TaskService
  // terminal state; waiting only for its absent ack would time out incorrectly.
  f.api.submitDerived=(request,target)=>{f.calls.submit++;return f.service.submit(request,{beforeDispatch:target.guard});};
  const receipt=await f.host.execute(input,{authorize:f.authorize});assert.equal(receipt.status,'configuration_required');assert.ok(receipt.taskId);assert.equal(f.service.jobs.get(receipt.taskId).status,'configuration_required');assert.equal(f.calls.generate,0);f.host.dispose();
});

test('global configuration does not bypass the existing native video profile validation',async()=>{
  const {prepareVideoAnalysisMedia}=await import('../src/features/node-composer/video-analysis-media.mjs');
  const f=await fixture({prepareInputs:(request,options)=>prepareVideoAnalysisMedia(request,{...options,nativeConfiguration:{protocol:'openai-native',capabilities:{videoAnalysis:{}}}})}),receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);
  const job=f.service.jobs.get(receipt.taskId);assert.equal(job.status,'configuration_required');assert.notEqual(job.providerDispatched,true);assert.equal(f.calls.generate,0);assert.match(f.host.get(input.operationId).error,/映射/);
  await f.host.execute(input,{authorize:f.authorize});assert.equal(f.calls.submit,1);f.host.dispose();
});

function recordStore({read,write}={}){
 const rows=new Map(),calls=[];
 return {rows,calls,async readRecord(key){calls.push(['read',key]);return read?read(key,rows):structuredClone(rows.get(key));},async writeRecord(key,value){calls.push(['write',key,structuredClone(value)]);if(write)await write(key,value,rows);rows.set(key,structuredClone(value));}};
}
const operationKey='agent-video-analysis-operations:project-a';
const legacyKey='tapnow.agent.video-analysis.operations.v1.project-a';
const operationRecord=(status='unknown',taskId='original-task')=>({version:1,operations:[{request:input,fingerprint:JSON.stringify(input),status,...taskId?{taskId}:{}}]});

test('full localStorage does not gate IndexedDB operation receipts or duplicate dispatch',async()=>{
 const store=recordStore();let legacyWrites=0;
 const f=await fixture({options:{store,storage:{getItem:()=>null,setItem(){legacyWrites++;throw Error('localStorage quota');}}}});
 const [a,b]=await Promise.all([f.host.execute(input,{authorize:f.authorize}),f.host.execute(input,{authorize:f.authorize})]);
 assert.equal(a.taskId,b.taskId);await settled(f,a.taskId);await f.host.flush();
 const saved=store.rows.get(operationKey);assert.equal(saved.projectId,'project-a');assert.equal(saved.operations[0].taskId,a.taskId);assert.equal(saved.operations[0].status,'succeeded');assert.equal(f.calls.generate,1);assert.equal(legacyWrites,0);
 f.service.jobs.clear();const restored=f.newHost(),receipt=await restored.execute(input,{authorize:f.authorize});assert.equal(receipt.status,'unknown');assert.equal(receipt.taskId,a.taskId);assert.equal(f.calls.submit,1);restored.dispose();f.host.dispose();
});

test('legacy journal migration preserves original identity and leaves its localStorage value untouched',async()=>{
 const store=recordStore(),storage=memoryStorage(),raw=JSON.stringify(operationRecord());storage.setItem(legacyKey,raw);
 const f=await fixture({options:{store,storage}}),receipt=await f.host.execute(input,{authorize:f.authorize});
 assert.equal(receipt.status,'unknown');assert.equal(receipt.taskId,'original-task');assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);
 assert.equal(storage.getItem(legacyKey),raw);assert.deepEqual(store.rows.get(operationKey).operations,JSON.parse(raw).operations);f.host.dispose();
});

test('read, migration and preparing writes fail closed without falling back or reading media',async()=>{
 for(const stage of ['read','migration','preparing']){
  const storage=memoryStorage();if(stage==='migration')storage.setItem(legacyKey,JSON.stringify(operationRecord()));
  const before=storage.getItem(legacyKey),store=recordStore({read:stage==='read'?async()=>{throw Error('IDB read failed');}:undefined,write:stage!=='read'?async()=>{throw Error('IDB write failed');}:undefined});
  const f=await fixture({options:{store,storage}});await assert.rejects(f.host.execute(input,{authorize:f.authorize}),/IDB|记录未能保存/);
  assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.equal(storage.getItem(legacyKey),before);f.host.dispose();
 }
});

test('an invalid or wrong-project IndexedDB journal never falls back to a legacy receipt',async()=>{
 for(const value of [{version:2,operations:[]},{...operationRecord(),projectId:'project-b'}]){
  const store=recordStore(),storage=memoryStorage();store.rows.set(operationKey,value);storage.setItem(legacyKey,JSON.stringify(operationRecord()));
  const f=await fixture({options:{store,storage}});await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='operation_storage_invalid');
  assert.equal(f.calls.submit,0);assert.equal(store.calls.filter(([kind])=>kind==='write').length,0);f.host.dispose();
 }
});

test('slow preparing commit blocks media and navigation; cancellation cannot dispatch after the commit',async()=>{
 const gate=deferred(),entered=deferred(),store=recordStore({write:async(key,value)=>{if(value.operations[0].status==='preparing'){entered.resolve();await gate.promise;}}});
 const f=await fixture({options:{store}}),controller=new AbortController(),pending=f.host.execute(input,{authorize:f.authorize,signal:controller.signal});await entered.promise;
 assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.match(await [...f.navigation][0](),/正在准备/);
 const event=new Event('beforeunload',{cancelable:true});f.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 controller.abort();gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');await f.host.flush();assert.equal(f.calls.submit,0);
 const restored=f.newHost();await restored.execute(input,{authorize:f.authorize});assert.equal(f.calls.submit,0);restored.dispose();f.host.dispose();
});

test('task identity must commit before dispatch and a failed identity commit keeps the original preparing receipt',async()=>{
 const store=recordStore({write:async(key,value)=>{if(value.operations[0].taskId)throw Error('identity write failed');}});
 const f=await fixture({options:{store}});await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='operation_save_failed'||error.code==='dispatch_stopped');
 await tick();assert.equal(f.calls.submit,1);assert.equal(f.calls.generate,0);assert.equal(store.rows.get(operationKey).operations[0].status,'preparing');assert.equal(store.rows.get(operationKey).operations[0].taskId,undefined);
 await assert.rejects(f.host.flush(),error=>error.code==='operation_save_failed');assert.match(await [...f.navigation][0](),/记录未能保存/);
 f.service.jobs.clear();const restored=f.newHost(),receipt=await restored.execute(input,{authorize:f.authorize});assert.equal(receipt.status,'unknown');assert.equal(receipt.recoveryRequired,true);assert.equal(f.calls.submit,1);restored.dispose();f.host.dispose();
});

test('flush and project navigation include journal writes queued while an older commit is pending',async()=>{
 const gate=deferred(),entered=deferred();let slow=false;
 const store=recordStore({write:async()=>{if(slow){entered.resolve();await gate.promise;}}}),f=await fixture({options:{store}}),receipt=await f.host.execute(input,{authorize:f.authorize});await settled(f,receipt.taskId);await f.host.flush();
 slow=true;const job=f.service.jobs.get(receipt.taskId);f.service.emit({...job,status:'unknown'});await entered.promise;
 let flushed=false,navigated=false;const flush=f.host.flush().then(()=>{flushed=true;}),navigation=[...f.navigation][0]().then(reason=>{navigated=true;return reason;});
 f.service.emit({...job,status:'succeeded'});await tick();assert.equal(flushed,false);assert.equal(navigated,false);
 gate.resolve();await flush;assert.equal(await navigation,null);assert.equal(store.rows.get(operationKey).operations[0].status,'succeeded');f.host.dispose();
});

test('project identity captured before a slow journal read cannot redirect a write to the destination',async()=>{
 const gate=deferred(),entered=deferred(),store=recordStore({read:async()=>{entered.resolve();return gate.promise;}}),f=await fixture({options:{store}}),pending=f.host.execute(input,{authorize:f.authorize});
 await entered.promise;f.setProject('project-b');gate.resolve(undefined);await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.equal(store.calls.filter(([kind])=>kind==='write').length,0);f.host.dispose();
});
test('source changes while loading a journal remain sticky even when the old source returns',async()=>{
 const gate=deferred(),entered=deferred(),store=recordStore({read:async()=>{entered.resolve();return gate.promise;}}),f=await fixture({options:{store}}),pending=f.host.execute(input,{authorize:f.authorize});
 await entered.promise;f.state.nodes[0].video='asset:replacement';f.render();f.state.nodes[0].video='asset:source';f.render();gate.resolve(undefined);
 await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.equal(store.calls.filter(([kind])=>kind==='write').length,0);f.host.dispose();
});
test('a conflicting IndexedDB journal commit cannot dispatch or replace legacy identity',async()=>{
 const store=recordStore({write:async()=>{throw Object.assign(Error('another window updated the journal'),{name:'AgentConversationConflictError'});}}),f=await fixture({options:{store}});
 await assert.rejects(f.host.execute(input,{authorize:f.authorize}),error=>error.code==='operation_save_failed'&&error.cause.name==='AgentConversationConflictError');assert.equal(f.calls.decode.length,0);assert.equal(f.calls.submit,0);assert.equal(f.storage.rows.size,0);f.host.dispose();
});
