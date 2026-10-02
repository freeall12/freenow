const test=require('node:test'),assert=require('node:assert/strict');
const {createDelegationManager}=require('../server/agent-delegation.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tasks=Array.from({length:3},(_,i)=>({id:'t'+i,title:'检查 '+i,instructions:'只读检查 '+i}));
const response=(id,done=true,extra={})=>({sessionId:'worker-'+id,done,text:'result '+id,calls:done?[]:[{callId:id+'-read',name:'canvas_read',args:{}}],round:1,...extra});
function harness(factory){const parent={id:'parent',pending:[{name:'agent_delegate',callId:'batch',args:{tasks:structuredClone(tasks)}}],busy:false,done:false,controller:new AbortController(),model:'local',workspaceContext:'scope'};const calls=[],manager=createDelegationManager({getParent:id=>id==='parent'?parent:null,createWorker:(p,task)=>{calls.push(task.id);assert.equal(p,parent);return factory(task);}});const input=taskId=>({sessionId:'parent',callId:parent.pending[0].callId,taskId});return {parent,manager,calls,input};}
test('three immutable tasks share two model slots; duplicate starts merge and completed receipts do not spend again',async()=>{
 const gates=tasks.map(()=>deferred());let active=0,peak=0;const h=harness(task=>({async start(payload){assert.deepEqual(payload,{});active++;peak=Math.max(peak,active);await gates[Number(task.id.slice(1))].promise;active--;return response(task.id);},resume(){assert.fail();},cancel(){}}));
 const a=h.manager.start(h.input('t0')),again=h.manager.start(h.input('t0')),b=h.manager.start(h.input('t1')),c=h.manager.start(h.input('t2'));assert.equal(a,again);await tick();assert.deepEqual(h.calls,['t0','t1']);assert.throws(()=>h.manager.settle({sessionId:'parent',callId:'batch'}),/尚未/);
 gates[0].resolve();await a;await tick();assert.deepEqual(h.calls,['t0','t1','t2']);gates[1].resolve();gates[2].resolve();await Promise.all([b,c]);assert.equal(peak,2);assert.equal((await h.manager.start(h.input('t0'))).status,'completed');assert.equal(h.calls.length,3);
 const receipt=h.manager.settle({sessionId:'parent',callId:'batch'});assert.equal(receipt.status,'completed');assert.equal(receipt.tasks.length,3);assert.deepEqual(receipt.tasks[0].response,{text:'result t0'});
});
test('resumes bind exact child call IDs and canonical receipts replay once without poisoning future valid results',async()=>{
 const gate=deferred();let resumes=0;const h=harness(task=>({start:async()=>response(task.id,false),async resume(id,results){resumes++;assert.equal(id,'worker-t0');await gate.promise;return response(task.id);},cancel(){}}));
 await h.manager.start(h.input('t0'));assert.throws(()=>h.manager.resume({...h.input('t0'),results:[{callId:'forged',result:{nodes:[]}}]}),/不匹配/);assert.equal(resumes,0);
 const results=[{callId:'t0-read',result:{nodes:[],total:0}}],first=h.manager.resume({...h.input('t0'),results}),again=h.manager.resume({...h.input('t0'),results:[{result:{total:0,nodes:[]},callId:'t0-read'}]});assert.equal(first,again);await tick();assert.equal(resumes,1);gate.resolve();assert.equal((await first).status,'completed');assert.equal((await h.manager.resume({...h.input('t0'),results})).status,'completed');assert.equal(resumes,1);
 assert.throws(()=>h.manager.resume({...h.input('t0'),results:[{callId:'t0-read',result:{nodes:['changed']}}]}),/不等待/);assert.throws(()=>h.manager.start({...h.input('t0'),callId:'wrong'}),/不匹配/);h.parent.pending[0].args.tasks[0].instructions='changed';assert.throws(()=>h.manager.start(h.input('t0')),/定义已变化/);
});
test('parent abort and request disconnect cancel queued work before creation and discard late worker success',async()=>{
 for(const useRequest of [false,true]){
  const gates=tasks.map(()=>deferred()),cancelled=[];const h=harness(task=>({start:async()=>{await gates[Number(task.id.slice(1))].promise;return response(task.id);},resume(){assert.fail();},cancel:id=>cancelled.push(id)})),controller=new AbortController();
  const promises=tasks.map(task=>h.manager.start(h.input(task.id),useRequest?controller.signal:undefined));await tick();assert.equal(h.calls.length,2);if(useRequest)controller.abort();else h.parent.controller.abort();const results=await Promise.all(promises);assert.ok(results.every(result=>result.status==='cancelled'));assert.equal(h.calls.length,2);gates.forEach(gate=>gate.resolve());await tick();assert.equal(h.calls.length,2);assert.deepEqual(cancelled.sort(),['worker-t0','worker-t1']);
 }
});
test('two-batch parent budget survives completion; unknown task, wrong parent and malformed definitions consume nothing',async()=>{
 const h=harness(task=>({start:async()=>response(task.id),resume(){assert.fail();},cancel(){}}));
 assert.throws(()=>h.manager.start({...h.input('t0'),sessionId:'other'}),/不存在/);assert.throws(()=>h.manager.start(h.input('wrong')),/不匹配/);h.parent.pending[0].args.tasks.push(...Array.from({length:4},(_,i)=>({id:'extra'+i,title:'extra',instructions:'extra'})));assert.throws(()=>h.manager.start(h.input('t0')),/tasks/);h.parent.pending[0].args.tasks.splice(3);
 await h.manager.start(h.input('t0'));h.manager.cancelCall('parent','batch');assert.equal(h.manager.settle({sessionId:'parent',callId:'batch'}).status,'partial_failure');h.parent.pending[0]={name:'agent_delegate',callId:'second',args:{tasks:[tasks[0]]}};await h.manager.start(h.input('t0'));h.parent.pending[0]={name:'agent_delegate',callId:'third',args:{tasks:[tasks[0]]}};assert.throws(()=>h.manager.start(h.input('t0')),/预算/);assert.equal(h.calls.length,2);
});
test('worker errors and round limits are independent terminal failures, never aggregate success',async()=>{
 const h=harness(task=>({start:async()=>{if(task.id==='t1')throw Error('provider offline');return response(task.id,true,task.id==='t2'?{limitReached:true}:{});},resume(){assert.fail();},cancel(){}}));
 const receipts=await Promise.all(tasks.map(task=>h.manager.start(h.input(task.id))));assert.deepEqual(receipts.map(value=>value.status),['completed','failed','limited']);const settled=h.manager.settle({sessionId:'parent',callId:'batch'});assert.equal(settled.status,'partial_failure');assert.match(settled.tasks[1].error,/provider offline/);assert.match(settled.tasks[2].error,/预算/);assert.equal(h.parent.done,false);
});

test('visual receipts validate actual pending identity before dispatch and fingerprints include pixel inputs',async()=>{
 const gate=deferred();let resumes=0,received;const h=harness(task=>({start:async()=>response(task.id,false,{calls:[{callId:'inspect',name:'canvas_inspect_media',args:{ids:['image']}}]}),async resume(id,results){resumes++;received=results;await gate.promise;return response(task.id);},cancel(){}}));
 await h.manager.start(h.input('t0'));const result={nodes:[{id:'image'}]},mediaInputs=[{nodeId:'image',name:'image',mime:'image/jpeg',imageUrl:'data:image/jpeg;base64,/9j/AA==',type:'image'}];
 assert.throws(()=>h.manager.resume({...h.input('t0'),results:[{callId:'inspect',result}]}),/缺少实际画面/);assert.throws(()=>h.manager.resume({...h.input('t0'),results:[{callId:'inspect',result,mediaInputs:[{...mediaInputs[0],nodeId:'other'}]}]}),/不匹配/);assert.equal(resumes,0);
 const results=[{callId:'inspect',result,mediaInputs}],first=h.manager.resume({...h.input('t0'),results}),same=h.manager.resume({...h.input('t0'),results:structuredClone(results)});assert.equal(first,same);
 assert.throws(()=>h.manager.resume({...h.input('t0'),results:[{callId:'inspect',result,mediaInputs:[{...mediaInputs[0],imageUrl:'data:image/jpeg;base64,/9j/AAA='}]}]}),/不等待/);await tick();assert.equal(resumes,1);assert.deepEqual(received,results);gate.resolve();assert.equal((await first).status,'completed');assert.equal((await h.manager.resume({...h.input('t0'),results})).status,'completed');assert.equal(resumes,1);
});
