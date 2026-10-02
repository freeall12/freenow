'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AgentRuntime}=require('../server/agent.cjs');
const binding={projectId:'project',conversationId:'conversation',submissionId:'submission'};
const call=(id,name='canvas_read',args={})=>({status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]});
const reply=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function store(){const records=new Map();return {ready:Promise.resolve(),list:async()=>structuredClone([...records.values()]),put:async record=>records.set(record.id,structuredClone(record))};}
const runtime=(sessionStore,create,options={})=>new AgentRuntime({sessionStore,providerIdentity:'stub-provider',model:'stub-model',client:{responses:{create}},...options});
function heldStore(saved,status){
 const entered=deferred(),release=deferred();let held=false;
 return {entered,release,store:{ready:saved.ready,list:()=>saved.list(),put:async record=>{await saved.put(record);if(record.status===status&&!held){held=true;entered.resolve();await release.promise;}}}};
}
async function stopAt(agent,held,running){
 const rejected=assert.rejects(running,/关闭|取消/);await held.entered.promise;
 const closing=agent.close();await new Promise(resolve=>setImmediate(resolve));held.release.resolve();await closing;await rejected;
}

test('empty saved-receipt continuation bypasses an earlier planned empty hash and never appends a fabricated receipt',async()=>{
 const saved=store(),planned=heldStore(saved,'planned');let requests=0;
 const initial=runtime(planned.store,async()=>assert.fail('planned start must not dispatch'));
 await stopAt(initial,planned,initial.start({message:'inspect',binding}));const id=(await saved.list())[0].id;
 const firstAgent=runtime(saved,async()=>{requests++;return call('first');});
 const first=await firstAgent.resume(id,[],undefined,undefined,binding);assert.equal(first.round,1);await firstAgent.close();
 const held=heldStore(saved,'receipts_saved'),accepting=runtime(held.store,async()=>assert.fail('saved receipt must not dispatch before shutdown'));
 const receipts=[{callId:'first',result:{nodes:[],observed:'actual'}}],running=accepting.resume(id,receipts,undefined,undefined,binding),rejected=assert.rejects(running,/关闭|取消/);
 await held.entered.promise;
 await assert.rejects(accepting.resume(id,[],undefined,undefined,binding),error=>error.code==='agent_receipt_busy');
 await assert.rejects(accepting.resume(id,[],undefined,undefined,{...binding,projectId:'other'}),error=>error.code==='agent_binding_mismatch');
 const closing=accepting.close();held.release.resolve();await closing;await rejected;
 const before=(await saved.list())[0];assert.equal(before.status,'receipts_saved');assert.equal(before.receiptLedger.length,2);
 const restored=runtime(saved,async request=>{requests++;assert.equal(request.input.filter(item=>item.type==='function_call_output'&&item.call_id==='first').length,1);return call('second');});
 const second=await restored.resume(id,[],undefined,undefined,binding);assert.equal(second.round,2);assert.equal(second.calls[0].callId,'second');assert.equal(requests,2);
 const after=(await saved.list())[0];assert.equal(after.receiptLedger.length,2);assert.equal(after.input.filter(item=>item.type==='function_call_output').length,1);
 assert.deepEqual(await restored.resume(id,receipts,undefined,undefined,binding),second);assert.equal(requests,2);await restored.close();
});

test('empty continuation consumes only already saved outputs and unknown/configuration guards still reject it',async()=>{
 const saved=store();let requests=0;const initial=runtime(saved,async()=>{requests++;return call('actual');}),first=await initial.start({message:'inspect',binding});await initial.close();
 const held=heldStore(saved,'receipts_saved'),accepting=runtime(held.store,async()=>assert.fail('no premature dispatch'));
 await stopAt(accepting,held,accepting.resume(first.sessionId,[{callId:'actual',result:{nodes:[]}}],undefined,undefined,binding));
 const blocked=runtime(saved,async()=>assert.fail('configuration change must not dispatch'),{providerIdentity:'changed'});
 await assert.rejects(blocked.resume(first.sessionId,[],undefined,undefined,binding),error=>error.code==='agent_resume_blocked');await blocked.close();
 const dispatch=deferred(),late=deferred(),restored=runtime(saved,async request=>{requests++;assert.equal(request.input.filter(item=>item.type==='function_call_output').length,1);dispatch.resolve();await late.promise;return reply('late');});
 const running=restored.resume(first.sessionId,[],undefined,undefined,binding),rejected=assert.rejects(running,/取消/);await dispatch.promise;await restored.close();
 const uncertain=runtime(saved,async()=>assert.fail('unknown must not dispatch'));await assert.rejects(uncertain.resume(first.sessionId,[],undefined,undefined,binding),error=>error.code==='agent_resume_blocked');
 const record=(await saved.list())[0];assert.equal(record.receiptLedger.length,1);assert.equal(record.input.filter(item=>item.type==='function_call_output').length,1);assert.equal(requests,2);
 late.resolve();await rejected;await uncertain.close();
});

test('empty saved show_form continuation completes preparation without any model request or user-answer receipt',async()=>{
 const saved=store(),form={title:'创作参数',fields:[{id:'brief',type:'text',label:'描述',required:true}]};let requests=0;
 const initial=runtime(saved,async()=>{requests++;return call('form','show_form',form);}),first=await initial.start({message:'prepare form',binding});await initial.close();
 const held=heldStore(saved,'receipts_saved'),accepting=runtime(held.store,async()=>assert.fail('show_form preparation must not dispatch'));
 await stopAt(accepting,held,accepting.resume(first.sessionId,[{callId:'form',result:{form,awaiting_submission:true}}],undefined,undefined,binding));
 const restored=runtime(saved,async()=>assert.fail('show_form preparation is terminal'));
 const response=await restored.resume(first.sessionId,[],undefined,undefined,binding);assert.equal(response.done,true);assert.deepEqual(response.calls,[]);assert.equal(response.text,'');assert.equal(requests,1);
 const record=(await saved.list())[0];assert.equal(record.status,'completed');assert.equal(record.receiptLedger.length,1);assert.equal(record.receiptLedger[0].formPrepared,true);assert.equal(record.input.filter(item=>item.type==='function_call_output').length,1);
 assert(JSON.parse(record.input.find(item=>item.type==='function_call_output').output).awaiting_submission);await restored.close();
});
