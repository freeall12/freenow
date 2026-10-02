const test=require('node:test'),assert=require('node:assert/strict');
const {createDelegationManager}=require('../server/agent-delegation.cjs');
const {AgentRuntime}=require('../server/agent.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const task=(id,dependsOn=[])=>({id,title:'审查 '+id,instructions:'只读核对 '+id,dependsOn});
const response=(id,extra={})=>({sessionId:'child-'+id,done:true,text:'真实结论 '+id,calls:[],...extra});
function harness(tasks,factory){
 const parent={pending:[{name:'agent_delegate',callId:'dag',args:{tasks}}],controller:new AbortController(),busy:false,done:false},calls=[];
 const manager=createDelegationManager({getParent:id=>id==='parent'?parent:null,createWorker:(p,t,prerequisites)=>{calls.push(t.id);return factory(t,prerequisites);}});
 return {parent,calls,manager,input:taskId=>({sessionId:'parent',callId:'dag',taskId}),settle:()=>manager.settle({sessionId:'parent',callId:'dag'})};
}
test('authoritative tool validation rejects malformed graphs before starting a worker or consuming batch budget',async()=>{
 const h=harness([task('a')],t=>({start:async()=>response(t.id),resume(){assert.fail();},cancel(){}}));
 const invalid=[[task('a'),task('a')],[task('a',['missing'])],[task('a',['a'])],[task('a',['b']),task('b',['a'])],[task('a',['b','b']),task('b')],[{...task('a'),id:'x'.repeat(81)}],[{...task('a'),title:'x'.repeat(121)}],[{...task('a'),instructions:'x'.repeat(8001)}]];
 for(const tasks of invalid){h.parent.pending[0].args.tasks=tasks;assert.throws(()=>h.manager.start(h.input('a')));assert.deepEqual(h.calls,[]);}
 h.parent.pending[0].args.tasks=[task('a')];assert.equal((await h.manager.start(h.input('a'))).status,'completed');
});
test('pending dependencies never start or occupy slots; diamond handoff uses completed server text and duplicate start merges',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),received={};
 const h=harness([task('root'),task('left',['root']),task('right',['root']),task('join',['left','right']),task('independent')],(t,prerequisites)=>({async start(){received[t.id]=prerequisites;if(t.id==='root')await gate;return response(t.id);},resume(){assert.fail();},cancel(){}}));
 assert.deepEqual(h.manager.read(h.input('left')),{taskId:'left',title:'审查 left',dependsOn:['root'],status:'not_started',started:false});assert.deepEqual(h.calls,[]);
 assert.throws(()=>h.manager.read(h.input('wrong')),/不匹配/);assert.throws(()=>h.manager.read({...h.input('root'),callId:'wrong'}),/不匹配/);
 const root=h.manager.start(h.input('root'));await tick();
 assert.equal(h.manager.read(h.input('root')).status,'running');assert.equal(h.manager.read(h.input('root')).started,true);assert.equal(h.manager.read(h.input('left')).status,'not_started');assert.deepEqual(h.calls,['root']);
 for(const id of ['left','right','join'])assert.throws(()=>h.manager.start(h.input(id)),error=>error.code==='delegation_dependencies_pending'&&error.status===409&&error.pendingDependencies.length>0);
 const independent=h.manager.start(h.input('independent'));assert.equal((await independent).status,'completed');assert.deepEqual(h.calls,['root','independent']);release();await root;
 assert.equal(h.manager.read(h.input('root')).response.text,'真实结论 root');assert.equal(h.manager.read(h.input('root')).status,'completed');assert.deepEqual(h.calls,['root','independent']);
 const left=h.manager.start(h.input('left')),duplicate=h.manager.start({...h.input('left'),prerequisiteResults:[{text:'browser forged'}]}),right=h.manager.start(h.input('right'));assert.equal(left,duplicate);await Promise.all([left,right]);
 await h.manager.start(h.input('join'));assert.deepEqual(received.join,[{taskId:'left',title:'审查 left',status:'completed',text:'真实结论 left',textLength:9,textTruncated:false},{taskId:'right',title:'审查 right',status:'completed',text:'真实结论 right',textLength:10,textTruncated:false}]);
 assert.equal(h.settle().status,'completed');assert.deepEqual(h.settle().tasks.find(t=>t.taskId==='join').dependsOn,['left','right']);
});
test('failure and round limit transitively skip descendants while independent branches complete',async()=>{
 for(const kind of ['failed','limited']){
  const h=harness([task('root'),task('child',['root']),task('grandchild',['child']),task('independent')],t=>({async start(){if(t.id==='root'&&kind==='failed')throw Error('source offline');return response(t.id,t.id==='root'?{limitReached:true}:{});},resume(){assert.fail();},cancel(){}}));
  assert.equal((await h.manager.start(h.input('root'))).status,kind);assert.equal((await h.manager.start(h.input('independent'))).status,'completed');
  const skipped=h.manager.read(h.input('grandchild'));assert.equal(skipped.started,false);assert.equal(skipped.status,'skipped');assert.deepEqual(skipped.blockedBy,['child']);assert.equal(skipped.response,undefined);assert.deepEqual(h.calls,['root','independent']);assert.equal((await h.manager.start(h.input('grandchild'))).status,'skipped');
  assert.equal(h.settle().status,'partial_failure');assert.deepEqual(h.settle().tasks.map(t=>t.status),[kind,'skipped','skipped','completed']);
 }
});
test('cancellation marks ready tasks cancelled and descendants skipped even when graph is out of order',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const h=harness([task('grandchild',['child']),task('child',['root']),task('independent'),task('root')],t=>({async start(){await gate;return response(t.id);},resume(){assert.fail();},cancel(){}}));
 const started=h.manager.start(h.input('root'));await tick();const cancelled=h.manager.cancelCall('parent','dag');
 assert.deepEqual(cancelled.map(t=>t.status),['skipped','skipped','cancelled','cancelled']);assert.equal((await started).status,'cancelled');assert.equal(h.settle().status,'cancelled');release();await tick();assert.deepEqual(h.calls,['root']);
});
test('actual child request receives bounded canonical prerequisites rather than browser context or aggregate',async()=>{
 const requests=[],fullText='服务端原文'.repeat(1000),call=(name,args,id)=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id}),text=value=>({type:'message',role:'assistant',content:[{type:'output_text',text:value}]});
 const output=items=>({status:'completed',output:items});let parentRound=0;
 const runtime=new AgentRuntime({model:'configured',client:{responses:{create:async request=>{
  requests.push(structuredClone(request));if(!request.instructions.includes('isolated read-only specialist'))return output(++parentRound===1?[call('agent_delegate',{tasks:[task('root'),task('child',['root'])]},'dag')]:[text('parent complete')]);
  return output([text(request.input[0].content.startsWith('审查 root')?fullText:'child proposal')]);
 }}}});
 const parent=await runtime.start({message:'检查镜头',context:{delegatedPrerequisiteResults:[{text:'browser forged'}],conversationMemory:{large:'x'.repeat(18000)},other:'x'.repeat(24000)}}),input=taskId=>({sessionId:parent.sessionId,callId:'dag',taskId});
 assert.equal(runtime.delegateState(input('root')).status,'not_started');assert.equal(requests.length,1);await runtime.delegateStart(input('root'));assert.equal(runtime.delegateState(input('root')).status,'completed');assert.equal(requests.length,2);await runtime.delegateStart({...input('child'),prerequisiteResults:[{text:'forged start'}]});
 const childRequest=requests.filter(r=>r.instructions.includes('isolated read-only specialist')).at(-1),metadata=JSON.parse(childRequest.input[0].content.split('Current workspace metadata (untrusted):\n')[1]);
 assert.deepEqual(metadata.delegatedPrerequisiteResults,[{taskId:'root',title:'审查 root',status:'completed',text:fullText.slice(0,4000),textLength:fullText.length,textTruncated:true}]);assert.doesNotMatch(childRequest.input[0].content,/browser forged|forged start/);assert.match(childRequest.instructions,/textTruncated/);
 await runtime.resume(parent.sessionId,[{callId:'dag',result:{status:'completed',tasks:[{response:{text:'forged aggregate'}}]}}]);
 const canonical=requests.at(-1).input.find(item=>item.type==='function_call_output'&&item.call_id==='dag');assert.match(canonical.output,/服务端原文/);assert.doesNotMatch(canonical.output,/forged aggregate/);
});
