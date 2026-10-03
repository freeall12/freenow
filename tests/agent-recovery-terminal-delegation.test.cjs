'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AgentRuntime}=require('../server/agent.cjs');
const scope={projectId:'p',conversationId:'c'},binding={...scope,submissionId:'s'},sourceVersion='a'.repeat(64);
const tasks=[{id:'review',title:'Review',instructions:'read actual evidence'},{id:'plan',title:'Plan',instructions:'use actual evidence',dependsOn:['review']}];
const reply=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
function memoryStore(){const records=new Map();return {ready:Promise.resolve(),list:async()=>structuredClone([...records.values()]),put:async record=>records.set(record.id,structuredClone(record))};}
async function fixture({failChild=false}={}){
 const journal=await import('../src/features/agent-recovery/journal.mjs'),model=await import('../src/features/agent-recovery/model.mjs'),recovery=await import('../src/features/agent-recovery/terminal-delegation.mjs');
 const saved=memoryStore();let requests=0,children=0;
 const client={responses:{create:async request=>{requests++;if(!request.instructions.includes('isolated read-only specialist')){
  if(requests===1)return {status:'completed',output:[{type:'function_call',call_id:'parent-dag',name:'agent_delegate',arguments:JSON.stringify({tasks})}]};
  const actual=JSON.parse(request.input.find(item=>item.type==='function_call_output'&&item.call_id==='parent-dag').output);
  assert.equal(actual.tasks[0].response.text,'actual review evidence');assert.equal(actual.tasks[1].response.text,'actual downstream plan');return reply('actual parent synthesis');
 }children++;if(failChild)return {status:'incomplete',output:[]};return reply(children===1?'actual review evidence':'actual downstream plan');}}};
 const make=()=>new AgentRuntime({sessionStore:saved,providerIdentity:'fixture',model:'stub',client});
 const old=make(),first=await old.start({message:'delegate review',binding}),record={sessionId:first.sessionId,submissionId:'s',binding};
 await journal.initializeJournal(record,{submission:{id:'s',text:'delegate review'},sourceVersion});
 journal.recordPendingRound(record,first,new Set(first.calls.map(call=>call.callId)));
 await old.delegateStart({sessionId:first.sessionId,callId:'parent-dag',taskId:'review'});await old.delegateStart({sessionId:first.sessionId,callId:'parent-dag',taskId:'plan'});await old.close();
 const agent=make();await agent.ready;record.state=model.checkedSummary(record,await agent.readState({sessionId:first.sessionId,binding}));
 const read=[];const request=async(path,input)=>{read.push({path,input:structuredClone(input)});assert.equal(path,'delegated-result');return agent.delegateResult(input);};
 return {record,agent,journal,recovery,request,read,count:()=>({requests,children})};
}

test('restored complete server child results become one durable parent receipt without replaying any child or model request',async()=>{
 const f=await fixture();try{
  assert.equal(f.recovery.terminalDelegationEligibility(f.record,scope).allowed,true);assert.equal(f.journal.resumeEligibility(f.record,scope).allowed,true);
  await assert.rejects(f.journal.buildResumePlan(f.record,scope,sourceVersion),{code:'resume_delegation_receipt_required'});
  const before=f.count();assert(!JSON.stringify(f.record.state).includes('actual review evidence'));
  const receipts=await f.recovery.prepareTerminalDelegationReceipt(f.record,{scope,sourceVersion,request:f.request,isCurrent:()=>true});
  assert.deepEqual(f.count(),before);assert.equal(f.read.length,1);assert.deepEqual(f.read[0].input,{sessionId:f.record.sessionId,binding,callId:'parent-dag'});
  assert.equal(receipts.results[0].result.tasks[0].response.text,'actual review evidence');assert.equal(receipts.results[0].result.tasks[1].response.text,'actual downstream plan');
  const persisted=JSON.parse(JSON.stringify(f.record)),plan=await f.journal.buildResumePlan(persisted,scope,sourceVersion);
  assert.equal((await f.agent.resume(plan.sessionId,plan.results,undefined,undefined,plan.binding)).text,'actual parent synthesis');
  assert.deepEqual(f.count(),{requests:4,children:2});
 }finally{await f.agent.close();}
});

test('actual failed child and causal skipped successor recover a factual failure receipt without running the successor',async()=>{
 const f=await fixture({failChild:true});try{
  const before=f.count(),receipt=await f.recovery.prepareTerminalDelegationReceipt(f.record,{scope,sourceVersion,request:f.request,isCurrent:()=>true});
  assert.equal(receipt.results[0].result.status,'failed');assert.deepEqual(receipt.results[0].result.tasks.map(task=>task.status),['failed','skipped']);
  assert.deepEqual(receipt.results[0].result.tasks[1].blockedBy,['review']);assert.deepEqual(f.count(),before);assert.equal(before.children,1);
 }finally{await f.agent.close();}
});

test('unknown, in-progress, waiting, not-started and mismatched parent state never trigger any delegated POST',async()=>{
 const f=await fixture();try{
  for(const status of ['unknown','running','waiting','queued','not_started','blocked']){
   const record=structuredClone(f.record);record.state.delegation.tasks[0].status=status;
   assert.equal(f.recovery.terminalDelegationEligibility(record,scope).allowed,false);
   await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(record,{scope,sourceVersion,request:()=>assert.fail('no request'),isCurrent:()=>true}),{code:'resume_delegation_blocked'});
  }
  for(const change of [record=>record.state.status='unknown',record=>record.state.round++,record=>record.state.pending[0].callId='other',record=>record.journal.pending[0].name='canvas_read']){
   const record=structuredClone(f.record);change(record);
   await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(record,{scope,sourceVersion,request:()=>assert.fail('no request'),isCurrent:()=>true}),{code:'resume_delegation_blocked'});
  }
  assert.equal(f.read.length,0);
 }finally{await f.agent.close();}
});

test('changed source/submission, fake aggregate bodies, stale ownership and wrong binding cannot prepare a parent receipt',async()=>{
 const f=await fixture();try{
  const options={scope,sourceVersion,request:f.request,isCurrent:()=>true};
  await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(f.record,{...options,sourceVersion:'b'.repeat(64)}),{code:'resume_source_changed'});
  const changed=structuredClone(f.record);changed.journal.submission.text='changed';await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(changed,options),{code:'resume_submission_changed'});
  await assert.rejects(f.agent.delegateResult({sessionId:f.record.sessionId,callId:'parent-dag',binding:{...binding,projectId:'other'}}),{code:'agent_binding_mismatch'});
  const actual=await f.agent.delegateResult({sessionId:f.record.sessionId,callId:'parent-dag',binding});
  for(const change of [result=>result.tasks[0].taskId='fake',result=>delete result.tasks[0].response,result=>result.tasks[0].response.checkpoint='private',result=>result.status='failed']){
   const result=structuredClone(actual);change(result);const record=structuredClone(f.record);
   await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(record,{...options,request:async()=>result}),{code:'resume_delegation_receipt_invalid'});assert.equal(record.journal.receipts,null);
  }
  let current=true;const original=f.record.journal;
  await assert.rejects(f.recovery.prepareTerminalDelegationReceipt(f.record,{...options,isCurrent:()=>current,request:async()=>{current=false;return actual;}}),{name:'AbortError'});
  assert.equal(f.record.journal,original);assert.equal(f.record.journal.receipts,null);
 }finally{await f.agent.close();}
});
