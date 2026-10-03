const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskService,isLocalMediaSource}=require('../generation-api.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((ready,failed)=>{resolve=ready;reject=failed;});return {promise,resolve,reject};};
const source=fs.readFileSync(require.resolve('../generation-ui.js'),'utf8');
const identity={version:1,projectId:'project',runId:'run',groupId:'group',nodeId:'node'};
const request=()=>({kind:'text.generate',workflowId:'group',nodeId:'node',prompt:'prompt',parameters:{count:1,workflowRecovery:{...identity}}});
const outputs=[{type:'text',text:'generated'}];

async function fixture({provider,save}={}){
  const calls=[],nodes=[{id:'group',type:'group'},{id:'node',type:'text',parentId:'group',content:'before'}];
  const service=new TaskService({prepareInputs:async value=>({...value,materialized:true})});
  service.setProvider(provider||{generate:async()=>{calls.push('POST');return {outputs:structuredClone(outputs)};}});
  let projectId='project';
  const context={service,GenerationCore:{isLocalMediaSource},inPlace:new Map(),inPlaceRecoveries:new Map(),draftGuards:new Map(),videoTargets:new Map(),imageTargets:new Map(),derivedTargets:new Map(),failureSources:new Map(),applicationListeners:new Set(),audioSubtitleReceipts:new Map(),audioSubtitleBindings:new Map(),audioSubtitleMedia:new Map(),failureBridge:undefined,resultWorkflow:null,structuredClone,Promise,DOMException,JSON,AbortSignal,fetch,
    provenanceReady:Promise.resolve({resultProvenance:()=>({})}),render(){},validateOutputMedia:async()=>{},
    app:{getState:()=>({nodes,edges:[]}),projectIdentity:()=>({id:projectId}),notify(){},render(){},updateNode(id,patch){calls.push('mutate');Object.assign(nodes.find(node=>node.id===id),patch);}},
    window:{CanvasStore:{save:async(state,id,options)=>{calls.push('save');assert.equal(id,'project');assert.equal(options.beforeCommit(),true);if(save)await save();calls.push('saved');}}},submitJob:(...args)=>service.submit(...args)};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function validateWorkflowProposal('),source.indexOf('  function cancel(')),context);
  const {createApplicationRunner}=await import('../src/features/generation-results/application.mjs');
  context.applicationReady=Promise.resolve(createApplicationRunner({getJob:id=>service.jobs.get(id),apply:context.applyResults,changed:context.applicationChanged}));
  vm.runInContext(source.slice(source.indexOf('  async function recover(id,'),source.indexOf('  function configure(')),context);
  vm.runInContext(source.slice(source.indexOf('  function runInPlace('),source.indexOf('  function videoSignature(')),context);
  const target=(options={})=>({guard(){},type:'text',async beforeApply(proposed,job){calls.push('intent');proposed.workflowRecoveryResult={...identity,taskId:job.id,resultVersion:'result-version'};return {taskId:job.id,beforeVersion:'before',afterVersion:'after',resultVersion:'result-version',proposedNode:structuredClone(proposed),createdAt:job.createdAt};},async onApplied(){calls.push('applied');},...options});
  return {context,service,nodes,calls,target,setProject:id=>{projectId=id;}};
}

test('final prepared transport body waits for host commit and rechecks source and abort authority',async()=>{
  for(const outcome of ['commit','changed','aborted','failed']){
    const gate=deferred(),service=new TaskService({prepareInputs:async value=>({...value,inputs:[{type:'text',text:'materialized'}]})});let sent=0,valid=true,seen;
    service.setProvider({generate:async()=>{sent++;return {outputs};}});
    const job=service.submit(request(),{beforeDispatch(){if(!valid)throw Error('source changed');},beforeTransportReady:async({jobId})=>{seen=service.jobs.get(jobId).request;await gate.promise;}});
    await tick();assert.equal(sent,0);assert.equal(seen.inputs[0].text,'materialized');assert.equal(Object.keys(job).includes('beforeTransportReady'),false);assert.equal(JSON.stringify(job).includes('beforeTransportReady'),false);
    if(outcome==='changed')valid=false;else if(outcome==='aborted')service.cancel(job.id);
    if(outcome==='failed')gate.reject(Error('storage failed'));else gate.resolve();await tick();assert.equal(sent,outcome==='commit'?1:0);
  }
  assert.throws(()=>new TaskService().submit(request(),{beforeTransportReady:'untrusted request data'}),/host function/);
});

test('in-place workflow waits for final request journal, application intent, actual graph save and applied receipt',async()=>{
  const prepared=deferred(),intent=deferred(),saved=deferred(),applied=deferred(),f=await fixture({save:()=>saved.promise});let settled=false;
  const base=f.target();
  const pending=f.context.runInPlace(request(),f.target({async beforeApply(node,job){const receipt=await base.beforeApply(node,job);await intent.promise;return receipt;},async onApplied(job,receipt){assert.equal(receipt.taskId,job.id);f.calls.push('applied');await applied.promise;}}),{onPrepared(job){assert.equal(job.request.materialized,true);return prepared.promise;}}).then(job=>{settled=true;return job;});
  await tick();assert.deepEqual(f.calls,[]);prepared.resolve();await tick();assert.deepEqual(f.calls,['POST','intent']);assert.equal(f.nodes[1].content,'before');
  intent.resolve();await tick();assert.deepEqual(f.calls,['POST','intent','mutate','save']);assert.equal(settled,false);assert.equal(f.nodes[1].workflowRecoveryResult.taskId,[...f.service.jobs.keys()][0]);
  saved.resolve();await tick();assert.equal(settled,false);assert.equal(f.calls.at(-1),'applied');applied.resolve();const job=await pending;assert.equal(job.applied,true);assert.equal(job.workflowApplicationReceipt.afterVersion,'after');
});

test('intent and graph-save failures never complete the workflow layer or redispatch its result',async()=>{
  for(const failAt of ['intent','save']){
    const f=await fixture({save:()=>{if(failAt==='save')throw Error('graph storage failed');}});
    const target=f.target(failAt==='intent'?{beforeApply:async()=>{throw Error('intent storage failed');}}:{});
    await assert.rejects(f.context.runInPlace(request(),target),/storage failed/);assert.equal(f.calls.filter(call=>call==='POST').length,1);assert.equal(f.calls.includes('applied'),false);
    assert.equal(f.calls.includes('mutate'),failAt==='save');assert.equal([...f.service.jobs.values()][0].applied,false);
  }
});

test('recovery registers workflow_existing ownership before succeeded notifications and GET-only applies once',async()=>{
  const calls=[],f=await fixture({provider:{generate:async()=>assert.fail('no POST during recovery'),lookup:async()=>{calls.push('GET');return {id:'remote',request:request(),status:'succeeded',createdAt:10,outputs:structuredClone(outputs)};}}});
  const a=f.context.recoverInPlace('original-task',f.target(),{verifyRequest:(value,job)=>job.id==='original-task'&&value.materialized!==true});
  const b=f.context.recoverInPlace('original-task',f.target(),{verifyRequest:()=>assert.fail('second verifier must not replace first authority')});assert.equal(a,b);
  const job=await a;assert.equal(job.id,'original-task');assert.equal(job.recovered,true);assert.equal(job.recoveryMode,'workflow_existing');assert.deepEqual(calls,['GET']);assert.equal(f.calls.filter(call=>call==='mutate').length,1);assert.equal(f.service.jobs.size,1);assert.equal(job.workflowApplicationReceipt.taskId,job.id);
  await assert.rejects(f.context.applyRecovered(job.id,'new_nodes'),/原分组/);
});

test('generic concurrent recovery cannot bypass specialized request validation or leave task unregistered',async()=>{
  const gate=deferred(),f=await fixture({provider:{generate:async()=>assert.fail('no POST'),lookup:()=>gate.promise}});
  const generic=f.context.recover('original-task'),specialized=f.context.recoverInPlace('original-task',f.target(),{verifyRequest:()=>true});
  gate.resolve({id:'remote',request:request(),status:'succeeded',outputs:structuredClone(outputs),createdAt:10});await generic;const job=await specialized;
  assert.equal(job.applied,true);assert.equal(f.calls.filter(call=>call==='mutate').length,1);
});

test('request mismatch, project/source changes, unknown and missing authority fail closed without applying or POST',async()=>{
  for(const failure of ['verify','node','ownership','project','unknown','missing']){
    const remote={id:'remote',request:request(),status:failure==='unknown'?'unknown':'succeeded',outputs:structuredClone(outputs),createdAt:10},gate=deferred();
    const f=await fixture({provider:{generate:async()=>assert.fail('no POST'),lookup:()=>gate.promise}});
    const promise=f.context.recoverInPlace('original-task',f.target(),failure==='missing'?{}:{verifyRequest:()=>failure!=='verify'});
    const rejected=assert.rejects(promise);await tick();
    if(failure==='node')remote.request.nodeId='different';else if(failure==='ownership')f.nodes[1].parentId='another';else if(failure==='project')f.setProject('another');
    gate.resolve(remote);await rejected;assert.equal(f.calls.includes('mutate'),false);assert.equal(f.calls.includes('save'),false);
  }
});

test('existing succeeded task still invokes verifier and current remote request replaces stale local unknown body',async()=>{
  const service=new TaskService();service.setProvider({generate:async()=>{},lookup:async()=>({id:'remote',status:'succeeded',request:{...request(),prompt:'persisted final body'},outputs})});
  const original={id:'key',request:request(),status:'unknown',controller:new AbortController()};service.jobs.set('key',original);
  await assert.rejects(service.recover('key',{beforeRestore(job){assert.equal(job.request.prompt,'persisted final body');throw Error('hash mismatch');}}),/hash mismatch/);assert.equal(original.status,'unknown');assert.equal(original.request.prompt,'prompt');
  original.status='succeeded';let verified=0;await service.recover('key',{beforeRestore(){verified++;}});assert.equal(verified,1);
});

test('saved application proposal retains current geometry, title and selection without rebuilding histories or changing the original createdAt',async()=>{
  const f=await fixture({provider:{generate:async()=>assert.fail('no POST'),lookup:async()=>({id:'remote',request:request(),status:'succeeded',outputs:structuredClone(outputs),createdAt:999})}});
  const proposedNode={...f.nodes[1],x:1,y:2,width:30,height:40,title:'old title',selected:false,content:'original durable proposal',generation:{prompt:'original'},workflowRecoveryResult:{...identity,taskId:'key',resultVersion:'result-version'}},base=f.target();
  Object.assign(f.nodes[1],{x:100,y:200,width:300,height:400,title:'current title',selected:true});
  const job=await f.context.recoverInPlace('key',f.target({restoredProposal:{taskId:'key',proposedNode,createdAt:10},async beforeApply(proposed,current){assert.equal(current.createdAt,10);assert.equal(proposed.content,'original durable proposal');return base.beforeApply(proposed,current);}}),{verifyRequest:()=>true});
  assert.equal(f.nodes[1].content,'original durable proposal');assert.equal(job.workflowApplicationReceipt.createdAt,10);assert.equal(f.calls.filter(call=>call==='mutate').length,1);
  assert.equal(f.nodes[1].x,100);assert.equal(f.nodes[1].y,200);assert.equal(f.nodes[1].width,300);assert.equal(f.nodes[1].height,400);assert.equal(f.nodes[1].title,'current title');assert.equal(f.nodes[1].selected,true);
  assert.equal(job.workflowApplicationReceipt.proposedNode.x,1);assert.equal(job.workflowApplicationReceipt.proposedNode.title,'old title');
});

test('a submitted task original timestamp is restored before preparing its first application proposal',async()=>{
  const f=await fixture({provider:{generate:async()=>assert.fail('no POST'),lookup:async()=>({id:'remote',request:request(),status:'succeeded',outputs:structuredClone(outputs),createdAt:999})}}),base=f.target();
  const job=await f.context.recoverInPlace('key',f.target({originalCreatedAt:10,beforeApply(proposed,current){assert.equal(current.createdAt,10);return base.beforeApply(proposed,current);}}),{verifyRequest:()=>true});
  assert.equal(job.createdAt,10);assert.equal(job.workflowApplicationReceipt.createdAt,10);
});

test('media decoder enrichment cannot alter the original output snapshot used by the application journal',async()=>{
  const f=await fixture(),base=f.target();
  f.context.validateOutputMedia=async output=>{output.width=640;output.height=480;};
  const job=await f.context.runInPlace(request(),f.target({beforeApply(proposed,current){assert.equal(current.outputs[0].width,undefined);assert.equal(current.outputs[0].height,undefined);return base.beforeApply(proposed,current);}}));
  assert.deepEqual(job.outputs,outputs);assert.equal(f.calls.filter(call=>call==='mutate').length,1);
});
