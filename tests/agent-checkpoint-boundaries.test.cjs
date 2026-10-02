'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {AgentRuntime}=require('../server/agent.cjs');
const {createAgentSessionStore}=require('../server/agent-session-store.cjs');
const binding={projectId:'project',conversationId:'conversation',submissionId:'submission'};
const reply=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const calls=(name='canvas_read',args={})=>({status:'completed',output:[{type:'function_call',call_id:'exact-call',name,arguments:JSON.stringify(args)}]});
const receipt=[{callId:'exact-call',result:{nodes:[],text:'actual receipt'}}];
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'agent-checkpoint-'));const store=createAgentSessionStore({directory});await store.ready;t.after(async()=>{await store.close();await fs.rm(directory,{recursive:true,force:true});});return store;}
function runtime(store,create,options={}){return new AgentRuntime({sessionStore:store,providerIdentity:'provider-config',model:'stub-model',client:{responses:{create}},...options});}

test('durable intent precedes SDK; waiting calls retain exact input and original identities across runtime replacement',async t=>{
 const store=await fixture(t);let requests=0;
 const create=async request=>{requests++;const records=await store.list();assert.equal(records[0].status,'request_in_flight');assert.deepEqual(records[0].input,request.input);return requests===1?calls():reply('receipt accepted');};
 const previous=runtime(store,create),first=await previous.start({message:'exact private input',binding});await previous.close();
 const restored=runtime(store,create);await restored.ready;const state=await restored.readState({sessionId:first.sessionId,binding});
 assert.equal(state.restored,true);assert.equal(state.canResumeWithReceipts,true);assert.deepEqual(state.pending,[{callId:'exact-call',name:'canvas_read'}]);assert(!JSON.stringify(state).includes('exact private input'));
 assert.equal(requests,1);assert.equal((await restored.resume(first.sessionId,receipt,undefined,undefined,binding)).done,true);assert.equal(requests,2);
 const saved=(await store.list())[0];assert.equal(saved.input.filter(item=>item.type==='function_call_output').length,1);assert(saved.seenCallIds.includes('exact-call'));assert.equal(saved.receiptLedger.length,1);
 await restored.close();
 const completed=runtime(store,create);assert.equal((await completed.readState({sessionId:first.sessionId,binding})).status,'completed');await completed.close();
});

test('accepted identical receipts replay only their durable response, even after completion and restoration',async t=>{
 const store=await fixture(t);let requests=0;const create=async()=>++requests===1?calls():reply('done');
 const previous=runtime(store,create),first=await previous.start({message:'inspect',binding}),done=await previous.resume(first.sessionId,receipt,undefined,undefined,binding);
 assert.deepEqual(await previous.resume(first.sessionId,receipt,undefined,undefined,binding),done);await previous.close();
 const restored=runtime(store,create);assert.deepEqual(await restored.resume(first.sessionId,receipt,undefined,undefined,binding),done);assert.equal(requests,2);await restored.close();
});

test('accepted receipts cannot race a second model request, and uncertain requests never auto replay',async t=>{
 const store=await fixture(t);let release,entered;const reached=new Promise(resolve=>{entered=resolve;});let requests=0;
 const previous=runtime(store,async()=>{requests++;if(requests===1)return calls();entered();return new Promise(resolve=>{release=resolve;});});
 const first=await previous.start({message:'inspect',binding});const running=previous.resume(first.sessionId,receipt,undefined,undefined,binding);const rejected=assert.rejects(running,/取消/);await reached;
 await assert.rejects(previous.resume(first.sessionId,receipt,undefined,undefined,binding),error=>error.code==='agent_receipt_busy');
 await previous.close();const restored=runtime(store,async()=>{throw Error('must never request');});const state=await restored.readState({sessionId:first.sessionId,binding});assert.equal(state.status,'unknown');assert.equal(state.canResumeWithReceipts,false);
 await assert.rejects(restored.resume(first.sessionId,receipt,undefined,undefined,binding),error=>error.code==='agent_receipt_unknown');assert.equal(requests,2);
 release(reply('late forbidden'));await rejected;assert.equal((await store.list())[0].status,'unknown');await restored.close();
});

test('scope mismatch and changed provider/budgets block continuation before SDK',async t=>{
 const store=await fixture(t);let requests=0;const previous=runtime(store,async()=>{requests++;return calls();});const first=await previous.start({message:'inspect',binding});
 await assert.rejects(previous.readState({sessionId:first.sessionId,binding:{...binding,projectId:'other'}}),error=>error.code==='agent_binding_mismatch');
 await assert.rejects(previous.resume(first.sessionId,receipt),error=>error.code==='agent_binding_mismatch');await previous.close();
 for(const options of [{providerIdentity:'changed'},{maxRounds:99},{toolNames:['canvas_read']}]){const restored=runtime(store,async()=>{throw Error('no SDK');},options);assert.equal((await restored.readState({sessionId:first.sessionId,binding})).reason,'configuration_changed');await assert.rejects(restored.resume(first.sessionId,receipt,undefined,undefined,binding),error=>error.code==='agent_resume_blocked');await restored.close();}
 assert.equal(requests,1);
});

test('legacy delegation without durable batch evidence is explicitly blocked and cannot consume fabricated success or restart workers',async t=>{
 const store=await fixture(t),previous=runtime(store,async()=>calls('agent_delegate',{tasks:[{id:'review',title:'review',instructions:'read only'}]}));const first=await previous.start({message:'review',binding});await previous.close();
 const legacy=(await store.list())[0];delete legacy.delegationCheckpoint;await store.put(legacy);
 const restored=runtime(store,async()=>{throw Error('must not request');});assert.equal((await restored.readState({sessionId:first.sessionId,binding})).reason,'delegation_state_not_persisted');
 await assert.rejects(restored.resume(first.sessionId,[{callId:'exact-call',result:{status:'completed',tasks:[]}}],undefined,undefined,binding),error=>error.code==='agent_resume_blocked');
 await assert.rejects(restored.delegateStart({sessionId:first.sessionId,callId:'exact-call',taskId:'review'}),error=>error.code==='agent_resume_blocked');await restored.close();
});

test('cancel persists before acknowledgement and late SDK cannot overwrite the terminal checkpoint',async t=>{
 const store=await fixture(t);let release,entered;const reached=new Promise(resolve=>{entered=resolve;});const previous=runtime(store,async()=>{entered();return new Promise(resolve=>{release=resolve;});});
 const running=previous.start({message:'slow',binding}),rejected=assert.rejects(running,/取消/);await reached;const sessionId=[...previous.sessions.keys()][0];
 assert.deepEqual(await previous.cancelDurable(sessionId,binding),{cancelled:true});assert.equal((await store.list())[0].status,'cancelled');release(reply('late'));await rejected;assert.equal((await store.list())[0].status,'cancelled');await previous.close();
 const restored=runtime(store,null,{client:null});assert.equal((await restored.readState({sessionId,binding})).status,'cancelled');await restored.close();
});

test('failed request-intent write prevents any SDK call and close exposes the storage failure',async t=>{
 const store=await fixture(t);let requests=0;const failing={ready:store.ready,list:()=>store.list(),put:async()=>{throw Error('disk unavailable');}};
 const agent=runtime(failing,async()=>{requests++;return reply('forbidden');});await assert.rejects(agent.start({message:'inspect',binding}),/disk unavailable/);assert.equal(requests,0);await assert.rejects(agent.close(),/disk unavailable/);
});

test('same stable submission is admitted once, survives pruning, and rejects changed input',async t=>{
 const store=await fixture(t);let requests=0;const agent=runtime(store,async()=>{requests++;return reply('durable done');});
 const outcomes=await Promise.allSettled([agent.start({message:'same',binding}),agent.start({message:'same',binding})]);assert.equal(requests,1);const first=outcomes.find(outcome=>outcome.status==='fulfilled').value;
 const replay=await agent.start({message:'same',binding});assert.deepEqual(replay,first);assert.equal(requests,1);
 await assert.rejects(agent.start({message:'changed',binding}),error=>error.code==='agent_submission_conflict');agent.sessions.get(first.sessionId).updated=0;agent.prune();assert.equal(agent.sessions.has(first.sessionId),false);
 assert.equal((await agent.readState({sessionId:first.sessionId,binding})).status,'completed');assert.deepEqual(await agent.start({message:'same',binding}),first);assert.equal(requests,1);await agent.close();
});

test('receipt saved before dispatch can explicitly continue without appending its outputs again',async t=>{
 const store=await fixture(t);let requests=0,fail=true;
 const flaky={ready:store.ready,list:()=>store.list(),put:async record=>{await store.put(record);if(record.status==='receipts_saved'&&fail){fail=false;throw Error('receipt acknowledgement lost');}}};
 const previous=runtime(flaky,async()=>{requests++;return calls();});const first=await previous.start({message:'inspect',binding});await assert.rejects(previous.resume(first.sessionId,receipt,undefined,undefined,binding),/acknowledgement lost/);await assert.rejects(previous.close(),/acknowledgement lost/);assert.equal(requests,1);
 const restored=runtime(store,async request=>{requests++;assert.equal(request.input.filter(item=>item.type==='function_call_output').length,1);return reply('actual continuation');});
 const state=await restored.readState({sessionId:first.sessionId,binding});assert.equal(state.status,'receipts_saved');assert.equal(state.reason,'request_not_dispatched');assert.equal(state.canResumeWithReceipts,true);
 assert.equal((await restored.resume(first.sessionId,receipt,undefined,undefined,binding)).text,'actual continuation');assert.equal(requests,2);await restored.close();
});

test('a one-time completion write failure cannot persist or replay uncommitted success after recovery',async t=>{
 const store=await fixture(t);let requests=0,fail=true;
 const flaky={ready:store.ready,list:()=>store.list(),put:async record=>{if(record.status==='completed'&&fail){fail=false;throw Error('completion write failed');}await store.put(record);}};
 const previous=runtime(flaky,async()=>++requests===1?calls():reply('must not replay uncommitted text'));const first=await previous.start({message:'inspect',binding});
 await assert.rejects(previous.resume(first.sessionId,receipt,undefined,undefined,binding),/completion write failed/);assert.equal((await store.list())[0].status,'unknown');assert.equal((await store.list())[0].receiptLedger[0].response,undefined);await assert.rejects(previous.close(),/completion write failed/);
 const restored=runtime(store,async()=>{requests++;return reply('forbidden retry');});assert.equal((await restored.readState({sessionId:first.sessionId,binding})).status,'unknown');await assert.rejects(restored.resume(first.sessionId,receipt,undefined,undefined,binding),error=>error.code==='agent_receipt_unknown');assert.equal(requests,2);await restored.close();
});

test('configuration changes reject a previously accepted receipt instead of replaying its old calls',async t=>{
 const store=await fixture(t);let requests=0;const previous=runtime(store,async()=>({status:'completed',output:[{type:'function_call',call_id:'call-'+ ++requests,name:'canvas_read',arguments:'{}'}]}));
 const first=await previous.start({message:'inspect',binding}),results=[{callId:'call-1',result:{nodes:[]}}];await previous.resume(first.sessionId,results,undefined,undefined,binding);await previous.close();
 const restored=runtime(store,async()=>{throw Error('no SDK');},{providerIdentity:'changed'});await assert.rejects(restored.resume(first.sessionId,results,undefined,undefined,binding),error=>error.code==='agent_resume_blocked');assert.equal(requests,2);await restored.close();
});

test('compaction intent is durable and an interrupted compact request preserves input as unknown',async t=>{
 const store=await fixture(t);let release,entered;const reached=new Promise(resolve=>{entered=resolve;});let requests=0;
 const previous=runtime(store,async()=>{requests++;return reply('forbidden');},{maxContextChars:1000});previous.client.responses.compact=async request=>{assert.equal((await store.list())[0].status,'compacting');entered();return new Promise(resolve=>{release=()=>resolve({object:'response.compaction',output:[...request.input.filter(item=>item.role==='user'),{type:'compaction',encrypted_content:'opaque'}]});});};
 const running=previous.start({message:'latest input',history:[{role:'user',content:'exact early input'},{role:'assistant',content:'x'.repeat(2000)}],binding}),rejected=assert.rejects(running,/取消/);await reached;const original=(await store.list())[0].input;
 await previous.close();release();await rejected;const record=(await store.list())[0];assert.equal(record.status,'unknown');assert.deepEqual(record.input,original);assert.equal(requests,0);
 const restored=runtime(store,async()=>{throw Error('no SDK');},{maxContextChars:1000});assert.equal((await restored.readState({sessionId:record.id,binding})).status,'unknown');await restored.close();
});

test('malformed checkpoint relationships fail closed while changed tool schemas yield a readable blocked state',async t=>{
 const store=await fixture(t),previous=runtime(store,async()=>calls());const first=await previous.start({message:'inspect',binding});await previous.close();const original=(await store.list())[0];
 await store.put({...original,lastResponse:{...original.lastResponse,done:true}});const invalid=runtime(store,async()=>{throw Error('no SDK');});await assert.rejects(invalid.ready,error=>error.code==='agent_checkpoint_invalid');await assert.rejects(invalid.close(),error=>error.code==='agent_checkpoint_invalid');
 const changed=structuredClone(original);changed.config='f'.repeat(64);changed.pending[0].name='removed_tool';changed.lastResponse.calls[0].name='removed_tool';changed.input.find(item=>item.type==='function_call').name='removed_tool';await store.put(changed);
 const restored=runtime(store,async()=>{throw Error('no SDK');});assert.equal((await restored.readState({sessionId:first.sessionId,binding})).reason,'configuration_changed');await restored.close();
});

test('shutdown during start lookup denies registration and dispatch after the awaited lookup returns',async t=>{
 const store=await fixture(t);let release,entered;const reached=new Promise(resolve=>{entered=resolve;});let reads=0,requests=0;
 const held={ready:store.ready,put:record=>store.put(record),list:async()=>{if(++reads===1)return store.list();entered();return new Promise(resolve=>{release=()=>resolve([]);});}};
 const agent=runtime(held,async()=>{requests++;return reply('forbidden');});await agent.ready;const running=agent.start({message:'inspect',binding}),rejected=assert.rejects(running,/关闭/);await reached;await agent.close();release();await rejected;assert.equal(agent.sessions.size,0);assert.equal(requests,0);assert.equal((await store.list()).length,0);
});

test('planned start saved before dispatch survives shutdown and explicitly resumes once',async t=>{
 const store=await fixture(t);let release,entered;const reached=new Promise(resolve=>{entered=resolve;});let heldOnce=false,requests=0;
 const held={ready:store.ready,list:()=>store.list(),put:async record=>{await store.put(record);if(record.status==='planned'&&!heldOnce){heldOnce=true;entered();await new Promise(resolve=>{release=resolve;});}}};
 const previous=runtime(held,async()=>{requests++;return reply('forbidden old request');});const running=previous.start({message:'inspect',binding}),rejected=assert.rejects(running,/关闭/);await reached;const sessionId=(await store.list())[0].id;
 const closing=previous.close();release();await closing;await rejected;assert.equal(requests,0);
 const restored=runtime(store,async()=>{requests++;return reply('explicit first response');});const state=await restored.readState({sessionId,binding});assert.equal(state.status,'planned');assert.equal(state.reason,'request_not_dispatched');assert.equal(state.round,0);
 assert.equal((await restored.resume(sessionId,[],undefined,undefined,binding)).text,'explicit first response');assert.equal(requests,1);await restored.close();
});

test('actual multimodal tool outputs retain inspection pixel inputs across checkpoint restoration and the next request',async t=>{
 const store=await fixture(t);let requests=0;const imageUrl='data:image/jpeg;base64,/9j/AA==';
 const create=async request=>{requests++;if(requests===1)return calls('canvas_inspect_media',{ids:['image-node']});const visual=request.input.find(item=>item.type==='function_call_output'&&item.call_id==='exact-call');assert(Array.isArray(visual.output));assert(visual.output.some(part=>part.type==='input_image'&&part.image_url===imageUrl));return requests===2?{status:'completed',output:[{type:'function_call',name:'canvas_read',call_id:'read-after-pixels',arguments:'{}'}]}:reply('pixels retained');};
 const previous=runtime(store,create),first=await previous.start({message:'inspect existing image',binding});await previous.resume(first.sessionId,[{callId:'exact-call',result:{nodes:[{id:'image-node'}]},mediaInputs:[{nodeId:'image-node',name:'image-node',imageUrl}]}],undefined,undefined,binding);await previous.close();
 const saved=(await store.list())[0].input.find(item=>item.type==='function_call_output'&&item.call_id==='exact-call');assert(Array.isArray(saved.output));assert.equal(saved.output.find(part=>part.type==='input_image').image_url,imageUrl);
 const restored=runtime(store,create);assert.equal((await restored.readState({sessionId:first.sessionId,binding})).status,'waiting_tools');assert.equal((await restored.resume(first.sessionId,[{callId:'read-after-pixels',result:{nodes:[]}}],undefined,undefined,binding)).text,'pixels retained');assert.equal(requests,3);await restored.close();
});

test('matching-config pending arguments must equal the original provider call, including parent delegation definitions',async t=>{
 const store=await fixture(t),previous=runtime(store,async()=>calls('agent_delegate',{tasks:[{id:'review',title:'review',instructions:'actual instruction'}]}));const first=await previous.start({message:'review',binding});await previous.close();
 const record=(await store.list())[0];record.pending[0].args.tasks[0].instructions='fabricated';record.lastResponse.calls[0].args.tasks[0].instructions='fabricated';await store.put(record);
 const restored=runtime(store,async()=>assert.fail('no dispatch'));await assert.rejects(restored.ready,error=>error.code==='agent_checkpoint_invalid');await assert.rejects(restored.close(),error=>error.code==='agent_checkpoint_invalid');assert.equal(first.calls[0].args.tasks[0].instructions,'actual instruction');
});
