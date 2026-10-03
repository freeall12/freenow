'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sourceCode=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
async function fixture(scenario){
 const model=await import('../src/features/agent-recovery/model.mjs'),journal=await import('../src/features/agent-recovery/journal.mjs'),delegation=await import('../src/features/agent-recovery/terminal-delegation.mjs');
 const binding={projectId:'p',conversationId:'c',submissionId:'s'},record={submissionId:'s',sessionId:'session',binding},chat={id:'c',interruptedRuns:[record],messages:[]};
 await journal.initializeJournal(record,{submission:{id:'s',studioNodeId:null},sourceVersion:'a'.repeat(64)});
 record.state={status:'planned',round:0,pending:[],canResumeWithReceipts:true};
 let entered,release,continued=0,loops=0,currentSource='a'.repeat(64);const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const context=vm.createContext({record,scope:{chat,projectId:'p',conversationId:'c',epoch:5},panel:{},recoveryEpoch:5,pageLeaving:false,busy:false,recoveryRunning:false,recoveryPreparing:false,
  queueRunner:null,chats:[chat],draft:()=>chat,project:{id:'p'},controller:null,sessionId:null,pendingResolve:null,pendingTraceId:null,
  AbortController,DOMException,Error,Date,Set,Map,structuredClone,recoveryModule:{...model,...journal,...delegation},executionReady:Promise.resolve(),render(){},notice(){},save:()=>true,
  flushConversation:async()=>{if(scenario==='changed-source'&&chat.activeRun)currentSource='b'.repeat(64);},recoverySourceVersion:async()=>{if(scenario==='final-source-ownership'&&chat.activeRun){entered();await gate;}return currentSource;},
  validateSubmission(){},depthHostFor:async()=>({beginTurn(){}}),request:async path=>{
   if(path==='state'){if(scenario==='preparation-collapse'){entered();await gate;}return {sessionId:'session',binding,status:'planned',round:0,pending:[],canResumeWithReceipts:true,text:'',done:false};}
   assert.equal(path,'continue');continued++;if(scenario==='active-collapse'){entered();await gate;}return {sessionId:'session',done:true,round:1,calls:[],text:'actual response'};
  },runToolLoop:async()=>{loops++;return true;}});
 vm.runInContext(sourceCode.slice(sourceCode.indexOf(' function ownsAgentRun('),sourceCode.indexOf(' async function recoverySourceVersion(')),context);
 vm.runInContext(sourceCode.slice(sourceCode.indexOf(' async function resumeInterruptedRun('),sourceCode.indexOf(' async function runToolLoop(')),context);
 return {context,chat,record,reached,release:()=>release(),count:()=>({continued,loops})};
}

test('closing during the actual recovery preparation keeps the interrupted run and sends no continue or tools',async()=>{
 const f=await fixture('preparation-collapse'),running=f.context.resumeInterruptedRun(f.record,f.context.scope);await f.reached;
 f.context.panel=null;f.context.recoveryEpoch++;if(f.context.recoveryPreparing)f.context.controller.abort();f.release();await running;
 assert.deepEqual(f.count(),{continued:0,loops:0});assert.equal(f.chat.interruptedRuns[0],f.record);assert.equal(f.chat.activeRun,undefined);assert.equal(f.context.recoveryRunning,false);
});

test('collapse after dispatch retains normal active-run completion instead of fabricating cancellation',async()=>{
 const f=await fixture('active-collapse'),running=f.context.resumeInterruptedRun(f.record,f.context.scope);await f.reached;
 assert.equal(f.context.recoveryPreparing,false);f.context.panel=null;f.context.recoveryEpoch++;if(f.context.recoveryPreparing)f.context.controller.abort();f.release();await running;
 assert.deepEqual(f.count(),{continued:1,loops:1});assert.equal(f.chat.interruptedRuns.length,0);assert.equal(f.chat.activeRun,undefined);
});

test('source changes while activating and flushing the recovery run stop before any continue request',async()=>{
 const f=await fixture('changed-source');await f.context.resumeInterruptedRun(f.record,f.context.scope);
 assert.deepEqual(f.count(),{continued:0,loops:0});assert.equal(f.chat.interruptedRuns.length,1);assert.deepEqual(f.chat.interruptedRuns[0].binding,f.record.binding);assert.equal(f.chat.activeRun,undefined);
 assert.match(f.chat.interruptedRuns[0].resumeError,/来源版本已变化/);
});

test('losing ownership during the last source-version await prevents dispatch even when the source hash is unchanged',async()=>{
 const f=await fixture('final-source-ownership'),running=f.context.resumeInterruptedRun(f.record,f.context.scope);await f.reached;
 f.context.pageLeaving=true;f.release();await running;
 assert.deepEqual(f.count(),{continued:0,loops:0});assert.equal(f.chat.activeRun,undefined);assert.equal(f.chat.interruptedRuns.length,1);
 assert.deepEqual(f.chat.interruptedRuns[0].binding,f.record.binding);assert.match(f.chat.interruptedRuns[0].resumeError,/本次继续已中断/);
});

async function traceFixture(statuses=['completed','completed']){
 const f=await fixture('trace'),callId='original-delegate',tasks=statuses.map((status,index)=>({taskId:'task'+index,title:'Actual '+index,dependsOn:[],status,
  ...(status==='completed'?{response:{text:'actual server prose '+index}}:{error:'actual '+status})}));
 const result={status:statuses.every(status=>status==='completed')?'completed':statuses.includes('completed')?'partial_failure':statuses.every(status=>status==='cancelled')?'cancelled':'failed',tasks};
 const origin={kind:'server_terminal_delegation',sessionId:'session',callId,round:1};f.record.journal.receipts={origin};
 const plan={binding:f.record.binding,round:1,pending:[{callId,name:'agent_delegate'}],results:[{callId,result}]};
 const trace={id:'original-trace',role:'tool',runId:'s',callId,name:'agent_delegate',status:'cancelled',result:{error:'historical channel interruption'},error:'historical trace error',
  delegates:tasks.map(task=>({taskId:task.taskId,status:'cancelled',error:'historical task interruption',reason:'limited',calls:[{name:'canvas_read',status:'interrupted'}]}))};
 f.chat.messages.push({role:'assistant',text:'original interruption notice'},trace);
 return {...f,trace,plan};
}

test('complete authoritative receipt updates only the original delegation trace and preserves interruption history and local steps',async()=>{
 const f=await traceFixture(),steps=f.trace.delegates[0].calls;
 assert.equal(f.context.synchronizeTerminalDelegationTrace(f.chat,f.record,f.plan),true);
 assert.equal(f.trace.id,'original-trace');assert.equal(f.trace.status,'done');assert.equal(f.trace.error,undefined);
 assert.deepEqual(f.trace.delegates.map(task=>task.status),['completed','completed']);assert.equal(f.trace.delegates[0].text,'actual server prose 0');
 assert.equal(f.trace.delegates[0].error,undefined);assert.equal(f.trace.delegates[0].reason,undefined);assert.equal(f.trace.delegates[0].calls,steps);
 assert.equal(f.trace.recoveredDelegation.previous.resultError,'historical channel interruption');assert.equal(f.chat.messages[0].text,'original interruption notice');
});

test('actual failed and cancelled terminal tasks remain factual in the recovered delegation trace',async()=>{
 for(const statuses of [['completed','failed'],['failed','failed'],['cancelled','cancelled']]){
  const f=await traceFixture(statuses);assert.equal(f.context.synchronizeTerminalDelegationTrace(f.chat,f.record,f.plan),true);
  assert.deepEqual(f.trace.delegates.map(task=>task.status),statuses);assert.equal(f.trace.result.status,f.plan.results[0].result.status);
  for(const task of f.trace.delegates)if(task.status!=='completed'){assert.equal(task.text,'');assert.equal(task.error,'actual '+task.status);}
 }
});

test('different conversation, submission, call or receipt origin cannot update or fabricate a delegation card',async()=>{
 for(const change of [f=>f.chat.id='other-chat',f=>f.trace.runId='other-submission',f=>f.trace.callId='other-call',f=>f.record.journal.receipts.origin.sessionId='other-session',f=>f.chat.messages.pop(),f=>f.chat.messages.push({...f.trace,id:'duplicate'})]){
  const f=await traceFixture();change(f);const before=structuredClone(f.chat.messages);
  assert.equal(f.context.synchronizeTerminalDelegationTrace(f.chat,f.record,f.plan),false);assert.deepEqual(f.chat.messages,before);
 }
});
