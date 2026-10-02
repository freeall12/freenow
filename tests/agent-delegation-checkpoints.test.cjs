'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {AgentRuntime}=require('../server/agent.cjs');
const {createAgentSessionStore}=require('../server/agent-session-store.cjs');
const binding={projectId:'p',conversationId:'c',submissionId:'s'};
const definitions=[{id:'review',title:'review',instructions:'read actual evidence'},{id:'plan',title:'plan',instructions:'plan using evidence',dependsOn:['review']}];
const call=(id,name,args={})=>({status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]});
const reply=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'delegation-checkpoint-'));const store=createAgentSessionStore({directory});await store.ready;t.after(async()=>{await store.close();await fs.rm(directory,{recursive:true,force:true});});return store;}
const runtime=(store,create,options={})=>new AgentRuntime({sessionStore:store,providerIdentity:'local-fixture',model:'stub',client:{responses:{create}},...options});
const input=(first,taskId='review')=>({sessionId:first.sessionId,callId:'batch',taskId});

test('durable child receipts retain exact historical replay, pixels and original calls while DAG handoff uses latest canonical results',async t=>{
 const store=await fixture(t);let requests=0;
 const create=async request=>{requests++;if(requests===1)return call('batch','agent_delegate',{tasks:definitions});if(requests===2)return call('pixels','canvas_inspect_media',{ids:['image']});if(requests===3){assert(request.input.find(x=>x.call_id==='pixels'&&x.type==='function_call_output').output.some(x=>x.type==='input_image'));return call('source','canvas_read_node',{id:'image'});}if(requests===4)return reply('actual final review');if(requests===5){assert(request.input.some(x=>x.role==='user'&&String(x.content).includes('actual final review')));return reply('actual plan');}assert(request.input.find(x=>x.call_id==='batch'&&x.type==='function_call_output').output.includes('actual plan'));return reply('canonical summary');};
 const previous=runtime(store,create),first=await previous.start({message:'read image',binding});await previous.delegateStart(input(first));
 const pixels=[{callId:'pixels',result:{nodes:[{id:'image'}]},mediaInputs:[{nodeId:'image',name:'image',imageUrl:'data:image/jpeg;base64,/9j/AA=='}]}];
 const historical=await previous.delegateContinue({...input(first),results:pixels});assert.equal(historical.status,'waiting');
 const final=await previous.delegateContinue({...input(first),results:[{callId:'source',result:{id:'image',prompt:'observed'}}]});assert.equal(final.status,'completed');await previous.close();
 const restored=runtime(store,create);await restored.ready;const state=await restored.readState({sessionId:first.sessionId,binding});assert.equal(state.delegation.tasks[0].status,'completed');assert.equal(state.delegation.tasks[1].status,'not_started');assert(!JSON.stringify(state).includes('data:image'));assert(!JSON.stringify(state).includes('actual final review'));
 assert.deepEqual(await restored.delegateContinue({...input(first),results:pixels}),historical);assert.equal(requests,4);
 await restored.delegateStart(input(first,'plan'));const aggregate=await restored.delegateResult(input(first));assert.equal(aggregate.status,'completed');
 assert.equal((await restored.resume(first.sessionId,[{callId:'batch',result:{status:'completed',tasks:[],text:'fabricated'}}],undefined,undefined,binding)).text,'canonical summary');assert.equal(requests,6);await restored.close();
});

test('graceful close preserves waiting and completed children; active requests become unknown and queued tasks need explicit dispatch',async t=>{
 const store=await fixture(t),entered=deferred(),late=deferred();let requests=0,active=0,peak=0;
 const tasks=Array.from({length:5},(_,i)=>({id:'t'+i,title:'t'+i,instructions:'read only'}));
 const previous=runtime(store,async()=>{requests++;if(requests===1)return call('batch','agent_delegate',{tasks});if(requests===2)return reply('durable completed');if(requests===3)return call('original','canvas_read');active++;peak=Math.max(peak,active);if(active===2)entered.resolve();await late.promise;active--;return reply('late must not overwrite');});
 const first=await previous.start({message:'parallel',binding});await previous.delegateStart(input(first,'t0'));await previous.delegateStart(input(first,'t1'));
 const pending=['t2','t3','t4'].map(taskId=>previous.delegateStart(input(first,taskId)));await entered.promise;await previous.close();await Promise.all(pending);
 const saved=(await store.list())[0],states=saved.delegationCheckpoint.batches[0].tasks.map(task=>task.status);assert.deepEqual(states,['completed','waiting','unknown','unknown','queued']);assert.equal(requests,5);assert.equal(peak,2);
 const restored=runtime(store,async()=>{requests++;return reply('explicit queued first dispatch');});const summary=await restored.readState({sessionId:first.sessionId,binding});assert.deepEqual(summary.delegation.tasks.map(task=>task.status),states);assert.equal(requests,5);
 await assert.rejects(restored.delegateStart(input(first,'t2')),error=>error.code==='delegation_resume_blocked');assert.equal((await restored.delegateState(input(first,'t1'))).response.calls[0].callId,'original');
 assert.equal((await restored.delegateStart(input(first,'t4'))).status,'completed');assert.equal(requests,6);await restored.close();const before=JSON.stringify(await store.list());late.resolve();await new Promise(resolve=>setImmediate(resolve));await previous.flush();assert.equal(JSON.stringify(await store.list()),before);
});

test('lost acknowledgement for child receipt commit fails closed without cancelling or replaying the uncertain request',async t=>{
 const store=await fixture(t);let fail=true,requests=0;
 const flaky={ready:store.ready,list:()=>store.list(),put:async record=>{await store.put(record);if(fail&&record.delegationCheckpoint?.batches[0].tasks[0].checkpoint?.status==='receipts_saved'){fail=false;throw Error('receipt acknowledgement lost');}}};
 const previous=runtime(flaky,async()=>++requests===1?call('batch','agent_delegate',{tasks:[definitions[0]]}):call('original','canvas_read'));
 const first=await previous.start({message:'review',binding});await previous.delegateStart(input(first));const results=[{callId:'original',result:{nodes:[]}}];
 const uncertain=await previous.delegateContinue({...input(first),results});assert.equal(uncertain.status,'unknown');await assert.rejects(previous.close(),/acknowledgement lost/);assert.equal(requests,2);
 const saved=(await store.list())[0];assert.equal(saved.delegationCheckpoint.batches[0].tasks[0].checkpoint.status,'unknown');
 const restored=runtime(store,async()=>assert.fail('no dispatch'));assert.equal((await restored.delegateState(input(first))).status,'unknown');await assert.rejects(restored.delegateContinue({...input(first),results}),error=>error.code==='delegation_resume_blocked');assert.equal(requests,2);await restored.close();
});

test('known never-started batch restores explicitly and child pending arguments cannot be fabricated',async t=>{
 const store=await fixture(t);let requests=0;const previous=runtime(store,async()=>{requests++;return requests===1?call('batch','agent_delegate',{tasks:[definitions[0]]}):call('original','canvas_read_node',{id:'actual'});});
 const first=await previous.start({message:'review',binding});await previous.close();const restored=runtime(store,async()=>{requests++;return call('original','canvas_read_node',{id:'actual'});});
 assert.equal((await restored.delegateState(input(first))).status,'not_started');assert.equal(requests,1);await restored.delegateStart(input(first));assert.equal(requests,2);await restored.close();
 const record=(await store.list())[0],task=record.delegationCheckpoint.batches[0].tasks[0];task.checkpoint.pending[0].args.id='fabricated';task.checkpoint.lastResponse.calls[0].args.id='fabricated';task.response.calls[0].args.id='fabricated';await store.put(record);
 const invalid=runtime(store,async()=>assert.fail('no dispatch'));await assert.rejects(invalid.ready,error=>error.code==='agent_checkpoint_invalid');await assert.rejects(invalid.close(),error=>error.code==='agent_checkpoint_invalid');assert.equal(requests,2);
});

test('provider changes retain factual completed child result while blocking waiting continuation without dispatch',async t=>{
 const store=await fixture(t);let requests=0;const previous=runtime(store,async()=>{requests++;return requests===1?call('batch','agent_delegate',{tasks:[definitions[0],{id:'other',title:'other',instructions:'read'}]}):requests===2?reply('saved evidence'):call('original','canvas_read');});
 const first=await previous.start({message:'review',binding});await previous.delegateStart(input(first));await previous.delegateStart(input(first,'other'));await previous.close();
 const restored=runtime(store,async()=>assert.fail('no dispatch'),{providerIdentity:'changed',client:null});const state=await restored.readState({sessionId:first.sessionId,binding});assert.equal(state.reason,'configuration_changed');assert.deepEqual(state.delegation.tasks.map(task=>task.status),['completed','blocked']);assert.equal((await restored.delegateState(input(first))).response.text,'saved evidence');await assert.rejects(restored.delegateContinue({...input(first,'other'),results:[{callId:'original',result:{nodes:[]}}]}),error=>error.code==='agent_resume_blocked');assert.equal(requests,3);await restored.close();
});

test('child receipt accepted before dispatch survives shutdown and explicit continuation appends each tool output once',async t=>{
 const store=await fixture(t),entered=deferred(),release=deferred();let held=false,requests=0;
 const gated={ready:store.ready,list:()=>store.list(),put:async record=>{await store.put(record);if(!held&&record.delegationCheckpoint?.batches[0].tasks[0].checkpoint?.status==='receipts_saved'){held=true;entered.resolve();await release.promise;}}};
 const previous=runtime(gated,async()=>++requests===1?call('batch','agent_delegate',{tasks:[definitions[0]]}):call('original','canvas_read'));
 const first=await previous.start({message:'review',binding});await previous.delegateStart(input(first));const results=[{callId:'original',result:{nodes:[]}}];const continuing=previous.delegateContinue({...input(first),results});await entered.promise;
 const closing=previous.close();await new Promise(resolve=>setImmediate(resolve));release.resolve();await closing;await continuing;assert.equal(requests,2);
 const restored=runtime(store,async request=>{requests++;assert.equal(request.input.filter(x=>x.type==='function_call_output'&&x.call_id==='original').length,1);return reply('explicit accepted continuation');});assert.equal((await restored.delegateState(input(first))).status,'queued');assert.equal((await restored.delegateContinue({...input(first),results})).status,'completed');assert.equal(requests,3);await restored.close();
});

test('completed historical batches retain the two-batch budget after parent continuation and restoration',async t=>{
 const store=await fixture(t);let requests=0,batches=0;const create=async request=>{requests++;if(request.tools.some(tool=>tool.name==='agent_delegate')){batches++;return call('batch'+batches,'agent_delegate',{tasks:[definitions[0]]});}return reply('canonical child');};
 const previous=runtime(store,create);const first=await previous.start({message:'review',binding});
 await previous.delegateStart({sessionId:first.sessionId,callId:'batch1',taskId:'review'});const next=await previous.resume(first.sessionId,[{callId:'batch1',result:{}}],undefined,undefined,binding);await previous.close();
 const restored=runtime(store,create);await restored.delegateStart({sessionId:first.sessionId,callId:'batch2',taskId:'review'});await assert.rejects(restored.resume(next.sessionId,[{callId:'batch2',result:{}}],undefined,undefined,binding),/两批委派预算/);assert.equal(requests,5);assert.equal((await store.list())[0].delegationCheckpoint.batches.length,2);await restored.close();
});

test('real child round limit and causal skipped dependency remain canonical across restart',async t=>{
 const store=await fixture(t);let requests=0;const previous=runtime(store,async()=>{requests++;return requests===1?call('batch','agent_delegate',{tasks:definitions}):call('read'+(requests-1),'canvas_read');});const first=await previous.start({message:'review',binding});await previous.delegateStart(input(first));
 for(let i=1;i<=6;i++)await previous.delegateContinue({...input(first),results:[{callId:'read'+i,result:{nodes:[]}}]});assert.equal(requests,7);await previous.close();
 const restored=runtime(store,async()=>assert.fail('no dispatch'));const aggregate=await restored.delegateResult(input(first));assert.equal(aggregate.status,'failed');assert.deepEqual(aggregate.tasks.map(task=>task.status),['limited','skipped']);assert.deepEqual(aggregate.tasks[1].blockedBy,['review']);await restored.close();
});

test('shutdown closes a worker resolved by a delayed factory without dispatching it and drains all close failures',async()=>{
 const {createDelegationManager}=require('../server/agent-delegation.cjs'),gate=deferred(),entered=deferred();let starts=0,closes=0;
 const parent={id:'parent',pending:[{name:'agent_delegate',callId:'batch',args:{tasks:[definitions[0]]}}],busy:false,done:false,controller:new AbortController()};
 const manager=createDelegationManager({getParent:()=>parent,createWorker:async()=>{entered.resolve();await gate.promise;return {start:async()=>{starts++;return {sessionId:'child',done:true,text:'forbidden',calls:[]};},resume:()=>assert.fail(),cancel(){},close:async()=>{closes++;}};}});
 const running=manager.start({sessionId:'parent',callId:'batch',taskId:'review'});await entered.promise;await manager.close();assert.equal((await running).status,'unknown');gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,0);assert.equal(closes,1);assert.equal(manager.read({sessionId:'parent',callId:'batch',taskId:'review'}).status,'unknown');
 const drain=deferred();let firstClosed=false,secondClosed=false,settled=false;const tasks=[definitions[0],{id:'other',title:'other',instructions:'read'}];parent.pending[0].args.tasks=tasks;
 const second=createDelegationManager({getParent:()=>parent,createWorker:(_p,task)=>({start:async()=>({sessionId:task.id,done:true,text:'done',calls:[]}),resume:()=>assert.fail(),cancel(){},close:async()=>{if(task.id==='review'){firstClosed=true;throw Error('fixture close failure');}await drain.promise;secondClosed=true;}})});
 await Promise.all(tasks.map(task=>second.start({sessionId:'parent',callId:'batch',taskId:task.id})));const closing=second.close();closing.catch(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert(firstClosed);assert.equal(settled,false);drain.resolve();await assert.rejects(closing,/fixture close failure/);assert(secondClosed);
});
