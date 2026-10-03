const {test}=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
globalThis.crypto||=webcrypto;
const modules=Promise.all([import('../src/features/workflow-recovery/host.mjs'),import('../src/features/workflow-recovery/context.mjs')]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<80;i++){if(check())return;await tick();}throw Error('fixture did not settle');}
async function fixture({unknown=false}={}){
 const [{createWorkflowHost},context]=await modules;
 const records=new Map(),jobs=new Map(),events=[],posts=[],gets=[],waiting=new Map(),ownership=new Map();let persistError=null;
 const state={nodes:[{id:'g',type:'group'},...['a','b','c'].map(id=>({id,type:'text',parentId:'g',content:'',generation:{prompt:id,model:'local'}}))],edges:[{source:'a',target:'c'},{source:'b',target:'c'}]};
 let saved=structuredClone(state);
 const config=node=>node.generation||{},piles={index:()=>({owner:new Map()})};
 const store={async readRecord(key){return structuredClone(records.get(key));},async writeRecord(key,value,{expectedRevision,canCommit}){assert.equal(records.get(key)?.storageRevision||0,expectedRevision);assert.equal(canCommit(),true);const storageRevision=expectedRevision+1;records.set(key,{...structuredClone(value),storageRevision});return {storageRevision};},async save(){if(persistError)throw persistError;saved=structuredClone(state);},async flush(){if(persistError)throw persistError;}};
 const root={navigator:{locks:{async request(key,_options,handler){if(ownership.has(key))return handler(null);ownership.set(key,true);try{return await handler({name:key});}finally{ownership.delete(key);}}}},crypto:webcrypto,CanvasStore:store,CanvasProjectContext:{resolve:()=>({id:'p'})},CanvasPiles:piles,WorkflowCore:require('../workflow-core.js'),CustomEvent:class{constructor(name,options){this.type=name;this.detail=options.detail;}},document:{dispatchEvent:event=>events.push(event)},addEventListener(){}};
 const app={getState:()=>state,render(){},async saveProject(){await store.save();await store.flush();}};
 function prepare(groupId){const plan=root.WorkflowCore.plan(state.nodes.filter(node=>node.parentId===groupId),state.edges,()=>true),tracked=new Map(state.nodes.filter(node=>node.parentId===groupId).map(node=>[node.id,context.nodeVersion(node,state.edges,config)]));
   const guard=()=>{for(const [id,value]of tracked)assert.equal(context.nodeVersion(state.nodes.find(node=>node.id===id),state.edges,config),value,'source changed');};
   const targetFor=id=>({guard,type:'text',patch:{},didApply:()=>tracked.set(id,context.nodeVersion(state.nodes.find(node=>node.id===id),state.edges,config))});
   return {plan,guard,context:()=>context.readContext({state,projectId:'p',groupId,trackedIds:[...tracked.keys()],config,piles}),members:[...tracked.keys()],versions:Object.fromEntries(tracked),targetFor,execute:async(id,durable)=>durable.run({nodeId:id,workflowId:groupId,kind:'text.generate',prompt:id,inputs:[],parameters:{count:1,workflowRecovery:durable.identity(id)}},targetFor(id))};
 }
 async function apply(job,target){const old=state.nodes.find(node=>node.id===job.request.nodeId),proposal=target.restoredProposal?structuredClone(target.restoredProposal.proposedNode):{...old,content:job.outputs[0].text};if(target.restoredProposal)job.createdAt=target.restoredProposal.createdAt;
   const receipt=await target.beforeApply(proposal,job);Object.assign(old,proposal);target.didApply();target.guard();await store.save();await store.flush();await target.onApplied(job,receipt);job.workflowApplicationReceipt=receipt;return job;
 }
 root.GenerationAPI={isConfigured:()=>true,getJobs:()=>[...jobs.values()],async runInPlace(request,target,options){target.dispatchGuard();const job={id:'task-'+request.nodeId,createdAt:100+posts.length,request:structuredClone(request),status:'queued',outputs:[]};jobs.set(job.id,job);await options.onSubmitted(job);await options.onPrepared(job);target.dispatchGuard();posts.push(job.id);return new Promise((resolve,reject)=>waiting.set(job.id,async()=>{try{job.status='succeeded';job.outputs=[{type:'text',text:'output '+request.nodeId}];resolve(await apply(job,target));}catch(error){reject(error);}}));},async recover(id){gets.push(id);const job=structuredClone(jobs.get(id));job.status=unknown&&id==='task-a'?'unknown':'succeeded';job.outputs=job.status==='succeeded'?[{type:'text',text:'output '+job.request.nodeId}]:[];return job;},async recoverInPlace(id,target,{verifyRequest}){const job=await root.GenerationAPI.recover(id);assert.equal(await verifyRequest(job.request,job),true);return apply(job,target);},async validateWorkflowProposal(){}};
 const create=()=>createWorkflowHost({root,app,prepare,config}),host=create();await host.ready;
 return {host,create,root,state,posts,gets,jobs,waiting,records,events,setSaveError:error=>{persistError=error;},restoreSaved:()=>{state.nodes=structuredClone(saved.nodes);state.edges=structuredClone(saved.edges);}};
}
test('refresh queries original sibling IDs and only explicit continuation submits the next layer',async()=>{
 const f=await fixture(),execution=f.host.start('g');await until(()=>f.posts.length===2);f.host.close();await tick();const restored=f.create();await restored.ready;
 assert.equal(restored.getRun('g').status,'recoverable');assert.deepEqual(f.posts,['task-a','task-b']);
 const result=await restored.query('g');assert.deepEqual(result.results.map(row=>row.status),['applied','applied']);assert.equal(result.continuation.ok,true);assert.deepEqual(f.posts,['task-a','task-b']);
 assert.ok(f.gets.every(id=>['task-a','task-b'].includes(id)));assert.ok(f.state.nodes.find(node=>node.id==='a').workflowRecoveryResult);
 const continued=await restored.continue('g');await until(()=>f.posts.length===3);await f.waiting.get('task-c')();await continued.completion;assert.equal(continued.status,'succeeded');restored.close();
 assert.equal(execution.status,'running','old remote promises are not cancelled by closing a page');
});
test('unknown original task is retained, siblings apply, and pending descendants cannot be resubmitted',async()=>{
 const f=await fixture({unknown:true});f.host.start('g');await until(()=>f.posts.length===2);f.host.close();await tick();const restored=f.create();await restored.ready;await restored.query('g');
 const snapshot=restored.recovery('g');assert.equal(snapshot.tasks.a.state,'unknown');assert.equal(snapshot.tasks.a.taskId,'task-a');assert.equal(snapshot.tasks.b.state,'applied');assert.equal(snapshot.tasks.c.state,'pending');
 await assert.rejects(()=>restored.continue('g'),/先查询/);assert.deepEqual(f.posts,['task-a','task-b']);assert.equal(restored.canRestart('g'),false);restored.close();
});
test('stop drains submitted siblings without abort or starting a descendant',async()=>{
 const f=await fixture(),execution=f.host.start('g');await until(()=>f.posts.length===2);await f.host.stop('g');assert.equal(execution.status,'stopping');await Promise.all([f.waiting.get('task-a')(),f.waiting.get('task-b')()]);await execution.completion;
 assert.equal(execution.status,'stopped');assert.deepEqual(f.posts,['task-a','task-b']);assert.deepEqual(execution.completed.sort(),['a','b']);assert.equal(f.host.continuation('g').ok,false);f.host.close();
});
test('intent saved but graph save failed recovers the exact saved proposal after refresh',async()=>{
 const f=await fixture(),execution=f.host.start('g');await until(()=>f.posts.length===2);f.setSaveError(Error('disk full'));await Promise.all([f.waiting.get('task-a')(),f.waiting.get('task-b')()]);await execution.completion;
 const before=f.host.recovery('g');assert.ok(before.tasks.a.application.proposedNode);assert.equal(before.tasks.a.state,'unknown');assert.equal(before.tasks.a.application.createdAt,100);
 const proposal=structuredClone(before.tasks.a.application.proposedNode);f.host.close();f.restoreSaved();f.setSaveError(null);await tick();const restored=f.create();await restored.ready;
 f.jobs.get('task-a').createdAt=999;await restored.query('g');assert.equal(restored.recovery('g').tasks.a.state,'applied');assert.deepEqual(f.state.nodes.find(node=>node.id==='a'),proposal);assert.deepEqual(f.posts,['task-a','task-b']);restored.close();
});
test('an in-memory afterVersion needs a successful guarded graph save before becoming applied',async()=>{
 const f=await fixture(),execution=f.host.start('g');await until(()=>f.posts.length===2);f.setSaveError(Error('disk full'));await Promise.all([f.waiting.get('task-a')(),f.waiting.get('task-b')()]);await execution.completion;
 await f.host.query('g');assert.equal(f.host.recovery('g').tasks.a.state,'unknown','failed save is not proof of persisted result');assert.equal(f.host.recovery('g').tasks.b.state,'unknown');f.setSaveError(null);
 await f.host.query('g');assert.equal(f.host.recovery('g').tasks.a.state,'applied');assert.equal(f.host.recovery('g').tasks.b.state,'applied');assert.deepEqual(f.posts,['task-a','task-b']);f.host.close();
});
