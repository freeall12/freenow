const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskService}=require('../generation-api.js');
const modulePromise=import('../src/features/generation-results/application.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('application failure retains provider result and retry applies without a second provider dispatch or new task',async()=>{
 const {createApplicationRunner}=await modulePromise,service=new TaskService();let providerCalls=0,applications=0;const changes=[];
 service.setProvider({generate:async()=>{providerCalls++;return {outputs:[{type:'text',text:'真实返回的原结果'}]};}});
 const job=service.submit({kind:'text.generate'});await tick();const outputs=job.outputs;
 const runner=createApplicationRunner({getJob:id=>service.jobs.get(id),apply:async current=>{applications++;assert.equal(current.outputs,outputs);if(applications===1)throw Error('storage unavailable');current.resultIds=['target'];},changed:current=>changes.push([current.applicationStatus,current.applying])});
 const failed=await runner.run(job.id);assert.equal(failed.status,'succeeded');assert.equal(failed.applicationStatus,'failed');assert.equal(failed.applied,false);assert.match(failed.applicationError,/storage unavailable/);
 const applied=await runner.run(job.id);assert.equal(applied.applicationStatus,'applied');assert.equal(applied.applicationError,undefined);assert.equal(applied.applicationAttempts,2);assert.deepEqual(applied.resultIds,['target']);assert.equal(providerCalls,1);assert.equal(service.jobs.size,1);assert.equal(job.outputs,outputs);
 await runner.run(job.id);assert.equal(applications,2);assert.deepEqual(changes,[['applying',true],['failed',false],['applying',true],['applied',false]]);
});
test('concurrent and reentrant requests share one application and unknown or unfinished tasks never apply',async()=>{
 const {createApplicationRunner}=await modulePromise;let finish,calls=0,reentered;const job={id:'job',status:'succeeded',outputs:[{type:'text',text:'A'}]};
 const runner=createApplicationRunner({getJob:id=>id===job.id?job:null,apply:()=>{calls++;return new Promise(resolve=>finish=resolve);},changed:current=>{if(current.applying)reentered=runner.run(current.id);}});
 const first=runner.run(job.id),second=runner.run(job.id);assert.equal(first,second);assert.equal(first,reentered);await tick();assert.equal(calls,1);finish();await first;
 await assert.rejects(()=>runner.run('missing'),/不存在/);for(const status of ['queued','running','cancelled','failed','configuration_required']){job.status=status;await assert.rejects(()=>runner.run('job'),/只有/);}assert.equal(calls,1);
});
function applicationHarness(){
 const source=fs.readFileSync(require.resolve('../generation-ui.js'),'utf8'),jobs=new Map(),nodes=[{id:'source',type:'studio'}],calls={connected:0,scene:0,cleared:0},context={service:{jobs},draftGuards:new Map(),inPlace:new Map(),videoTargets:new Map(),imageTargets:new Map(),derivedTargets:new Map(),resultWorkflow:{has:()=>false,clear:()=>calls.cleared++},app:{getState:()=>({nodes}),createConnected:()=>{calls.connected++;return [{id:'result'}];}},validateOutputMedia:async()=>{},window:{StudioAPI:{acceptGeneration:async()=>{calls.scene++;if(calls.scene===1)throw Error('scene not ready');return {objectIds:['object']};}}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function applyResults('),source.indexOf('  function applicationChanged(')),context);return {context,jobs,nodes,calls};
}
test('partial canvas output is reused when scene placement fails and retry cannot create duplicate canvas results',async()=>{
 const {createApplicationRunner}=await modulePromise,{context,jobs,calls}=applicationHarness(),job={id:'job',status:'succeeded',request:{kind:'model.generate',nodeId:'source'},outputs:[{type:'model',url:'https://example.test/model.glb'}]};jobs.set(job.id,job);
 const runner=createApplicationRunner({getJob:id=>jobs.get(id),apply:context.applyResults});await runner.run(job.id);assert.equal(job.applied,false);assert.equal(job.resultIds[0],'result');assert.equal(calls.connected,1);
 const result=await runner.run(job.id);assert.equal(result.applied,true);assert.equal(calls.connected,1);assert.equal(calls.scene,2);assert.equal(calls.cleared,0);
});
test('failed plan application retains its ownership and stale target guard still rejects the retry',async()=>{
 const {createApplicationRunner}=await modulePromise,{context,jobs,calls}=applicationHarness();let attempts=0;
 context.resultWorkflow={has:()=>true,clear:()=>calls.cleared++,apply:async()=>{attempts++;throw Error(attempts===1?'media unavailable':'target changed');}};
 const job={id:'job',status:'succeeded',request:{kind:'text.generate',nodeId:'source'},outputs:[{type:'text',text:'new'}]};jobs.set(job.id,job);
 const runner=createApplicationRunner({getJob:id=>jobs.get(id),apply:context.applyResults});await runner.run(job.id);const result=await runner.run(job.id);assert.equal(result.applied,false);assert.match(result.applicationError,/target changed/);assert.equal(calls.cleared,0);assert.equal(calls.connected,0);
});
test('panorama rejected scene binding remains unapplied and recoverable without duplicating its canvas result',async()=>{
 const {createApplicationRunner}=await modulePromise,{context,jobs,calls}=applicationHarness();let accepted=false;context.window.StudioAPI.acceptPanoramaGeneration=async()=>({applied:accepted,reason:'session changed'});
 const job={id:'job',status:'succeeded',request:{kind:'panorama.edit',nodeId:'source'},outputs:[{type:'image',url:'https://example.test/panorama.png'}]};jobs.set(job.id,job);
 const runner=createApplicationRunner({getJob:id=>jobs.get(id),apply:context.applyResults});const failure=await runner.run(job.id);assert.equal(failure.applied,false);assert.match(failure.applicationError,/session changed/);accepted=true;assert.equal((await runner.run(job.id)).applied,true);assert.equal(calls.connected,1);
});
test('Agent task snapshots expose application attempts and refresh does not claim lost application jobs are recoverable',async()=>{
 const {attachGenerationJob,recoverGenerationJobs}=await import('../src/features/agent-generation/jobs.mjs'),trace={name:'generation_submit',result:{taskId:'job'}};
 attachGenerationJob(trace,{id:'job',status:'succeeded',applied:false,applying:false,applicationStatus:'failed',applicationAttempts:2,applicationError:'decode failed',outputs:[{text:'private result'}]});assert.equal(trace.generationJob.applicationAttempts,2);assert.equal(trace.generationJob.outputs,undefined);recoverGenerationJobs([trace],[]);assert.equal(trace.generationJob.status,'unknown');assert.match(trace.generationJob.error,/勿自动重新生成/);
});
