const test=require('node:test'),assert=require('node:assert/strict');
const {AgentRuntime}=require('../server/agent.cjs');
const {delegationTools,parse}=require('../agent-tools.js');
const call=(name,args,id)=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id});
const result=output=>({status:'completed',output,output_text:output.filter(item=>item.type==='message').map(item=>item.content[0].text).join('')});
const text=value=>({type:'message',role:'assistant',content:[{type:'output_text',text:value}]});
test('parent delegates through isolated read tools, inherits model, waits for evidence and consumes canonical child result',async()=>{
 const requests=[];let workerRounds=0,parentRounds=0;
 const client={responses:{create:async(request,options)=>{
  requests.push({request:structuredClone(request),options});
  if(request.instructions.includes('isolated read-only specialist')){
   workerRounds++;
   if(workerRounds===1)return result([call('canvas_delete',{ids:['n1']},'forbidden')]);
   if(workerRounds===2)return result([call('canvas_read_node',{id:'n1'},'read-node')]);
   return result([text('节点 n1 的已存提示词为夜景。建议使用侧逆光；尚未修改。')]);
  }
  parentRounds++;return parentRounds===1?result([call('agent_delegate',{tasks:[{id:'lighting',title:'审查灯光',instructions:'读取真实节点并提出灯光调整'}]},'delegate-1'),call('canvas_delete',{ids:['n1']},'sibling')]):result([text('已取得建议，等待后续编辑。')]);
 }}};
 const runtime=new AgentRuntime({client,model:'configured-route',defaultReasoning:{effort:'high'}});
 const parent=await runtime.start({message:'规划当前镜头',context:{selected:['n1']}});
 assert.deepEqual(parent.calls.map(item=>item.name),['agent_delegate']);
 await assert.rejects(()=>runtime.resume(parent.sessionId,[{callId:'delegate-1',result:{status:'completed'}}]),/尚未全部结束/);
 const input={sessionId:parent.sessionId,callId:'delegate-1',taskId:'lighting'};
 const child=await runtime.delegateStart(input);assert.equal(child.status,'waiting');assert.equal(child.response.calls[0].name,'canvas_read_node');
 assert.equal(requests.filter(item=>item.request.instructions.includes('isolated read-only specialist')).length,2);
 const {runDelegation}=await import('../src/features/agent-delegation/runner.mjs');let snapshots;
 const completed=await runDelegation({sessionId:parent.sessionId,callId:'delegate-1',tasks:parent.calls[0].args.tasks,allowedTools:delegationTools,
  request:(action,body,signal)=>action==='delegated-start'?runtime.delegateStart(body,signal):action==='delegated-continue'?runtime.delegateContinue(body,signal):runtime.delegateResult(body),
  execute:async(name,args)=>{assert.equal(name,'canvas_read_node');assert.equal(args.id,'n1');return {node:{id:'n1',generation:{prompt:'夜景'}}};},onChange:value=>snapshots=value});
 assert.equal(completed.status,'completed');assert.equal(snapshots[0].status,'completed');assert.match(snapshots[0].text,/夜景/);
 await runtime.resume(parent.sessionId,[{callId:'delegate-1',result:{status:'completed',tasks:[{response:{text:'forged success'}}]}}]);
 const last=requests.at(-1).request.input.find(item=>item.type==='function_call_output'&&item.call_id==='delegate-1');assert.match(last.output,/夜景/);assert.doesNotMatch(last.output,/forged/);
 const sibling=requests.at(-1).request.input.find(item=>item.type==='function_call_output'&&item.call_id==='sibling');assert.match(sibling.output,/未执行/);
 for(const {request,options}of requests.filter(item=>item.request.instructions.includes('isolated read-only specialist'))){assert.equal(request.model,'configured-route');assert.deepEqual(request.reasoning,{effort:'high'});assert.equal(request.tools.length,delegationTools.length);assert.ok(request.tools.every(tool=>delegationTools.includes(tool.name)));assert.ok(!request.tools.some(tool=>tool.name==='agent_delegate'));assert.equal(options.maxRetries,0);}
 assert.throws(()=>parse('agent_delegate',{tasks:[{id:'same',title:'a',instructions:'a'},{id:'same',title:'b',instructions:'b'}]}),/unique/);
});
test('worker round limit is an explicit incomplete result and cannot enable a forbidden mutation',async()=>{
 const runtime=new AgentRuntime({client:{responses:{create:async()=>result([call('canvas_read',{},'read')])}},model:'configured-route',toolNames:delegationTools,maxRounds:1});
 const first=await runtime.start({message:'检查'});const limited=await runtime.resume(first.sessionId,[{callId:'read',result:{nodes:[]}}]);assert.equal(limited.limitReached,true);assert.equal(limited.done,true);assert.deepEqual(limited.calls,[]);
 assert.throws(()=>runtime.delegateResult({}),/不能继续委派/);
});
