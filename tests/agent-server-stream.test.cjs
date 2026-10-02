const test=require('node:test'),assert=require('node:assert/strict');
const {AgentRuntime}=require('../server/agent.cjs');
const {writeAgentStream,wantsAgentStream}=require('../server/agent-stream.cjs');
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]}),call=(name,args,id='call-1')=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id});
const completed=(output,status='completed')=>({type:'response.completed',response:{status,output}});
const delta=text=>({type:'response.output_text.delta',delta:text});
function fixture(rounds,options={}){
 const requests=[],events=[];
 const client={responses:{async create(request,opts){requests.push({request,opts});const events=rounds.shift();return (async function*(){for(const event of events){if(typeof event==='function')await event(opts.signal);else yield event;}})();}}};
 const runtime=new AgentRuntime({client,model:'test-model',...options});return {runtime,requests,events,emit:event=>events.push(event)};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test('Chinese deltas are live but tool arguments are accepted only from response.completed',async()=>{
 const entered=deferred(),release=deferred(),f=fixture([[delta('你好'),delta('，画布'),{type:'response.function_call_arguments.delta',delta:'{"x":999}'},{type:'response.output_item.done',item:call('canvas_add',{type:'text',title:'unsafe partial',x:999,y:0})},()=>{entered.resolve();return release.promise;},completed([message('你好，画布'),call('canvas_read',{})])]]);
 let settled=false;const pending=f.runtime.start({message:'读取画布'},undefined,f.emit).then(result=>{settled=true;return result;});await entered.promise;
 assert.equal(settled,false);assert.equal(f.events[0].type,'session');assert.equal(f.events[0].round,1);assert.equal(f.events.filter(e=>e.type==='text_delta').map(e=>e.delta).join(''),'你好，画布');
 const session=f.runtime.sessions.get(f.events[0].sessionId);assert.deepEqual(session.pending,[]);assert.equal(session.input.some(item=>item.type==='function_call'),false);
 release.resolve();const result=await pending;assert.deepEqual(result.calls.map(c=>c.name),['canvas_read']);assert.equal(result.text,'你好，画布');assert.deepEqual(result.segments,[{round:1,text:'你好，画布'}]);
 assert.equal(f.requests[0].request.stream,true);assert.equal(f.requests[0].request.store,false);assert.equal(f.requests[0].opts.maxRetries,0);
});

test('reasoning item lifecycle emits only activity and never hidden reasoning or summary text',async()=>{
 const f=fixture([[{type:'response.reasoning_text.delta',delta:'SECRET reasoning'},delta('visible'),{type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:'r',summary:[{text:'SECRET summary'}]}},{type:'response.reasoning_summary_text.delta',delta:'SECRET'}, {type:'response.output_item.done',output_index:0,item:{type:'reasoning',id:'r'}},completed([message('visible')])]]);
 await f.runtime.start({message:'read'},undefined,f.emit);assert.deepEqual(f.events.filter(e=>e.type==='thinking').map(e=>e.active),[true,false]);assert.ok(!JSON.stringify(f.events).includes('SECRET'));
 const noReasoning=fixture([[delta('plain'),completed([message('plain')])]]);await noReasoning.runtime.start({message:'plain'},undefined,noReasoning.emit);assert.equal(noReasoning.events.some(e=>e.type==='thinking'),false);
});

test('failed, incomplete, mismatched completed status and clean EOF never expose calls or allow replay',async()=>{
 for(const tail of [{type:'response.failed',response:{error:{message:'private provider detail'}}},{type:'response.incomplete'},completed([call('canvas_read',{})],'incomplete'),completed([{...call('canvas_read',{}),status:'in_progress'}]),null]){
  const f=fixture([[delta('部分文本'),{type:'response.output_item.done',item:call('canvas_read',{})},...(tail?[tail]:[])]]);
  await assert.rejects(()=>f.runtime.start({message:'read'},undefined,f.emit),error=>['response_failed','response_incomplete','stream_incomplete'].includes(error.code));
  const session=f.runtime.sessions.get(f.events[0].sessionId),uncertain=!tail||tail.type==='response.failed';assert.equal(session.status,uncertain?'unknown':'failed');assert.equal(session.done,!uncertain);assert.deepEqual(session.pending,[]);assert.equal(session.input.some(item=>item.type==='function_call'),false);assert.equal(f.requests.length,1);
  await assert.rejects(()=>f.runtime.resume(session.id,[],undefined,f.emit),error=>uncertain?error.code==='agent_resume_blocked':/结束/.test(error.message));assert.equal(f.requests.length,1);assert.ok(!JSON.stringify(f.events).includes('private provider'));
 }
});

test('request abort and early session cancellation abort SDK and discard even late completed calls',async()=>{
 for(const mode of ['request','session']){
  const entered=deferred(),release=deferred(),controller=new AbortController(),f=fixture([[delta('准备'),()=>{entered.resolve();return release.promise;},completed([call('canvas_read',{})])]]);
  const pending=f.runtime.start({message:'read'},controller.signal,f.emit);await entered.promise;const id=f.events[0].sessionId;
  if(mode==='request')controller.abort();else f.runtime.cancel(id);
  assert.equal(f.requests[0].opts.signal.aborted,true);release.resolve();await assert.rejects(pending,error=>error.code==='cancelled');assert.deepEqual(f.runtime.sessions.get(id).pending,[]);
 }
 const early=fixture([[completed([call('canvas_read',{})])]]);await assert.rejects(()=>early.runtime.start({message:'read'},undefined,event=>{early.emit(event);if(event.type==='session')early.runtime.cancel(event.sessionId);}),/取消/);assert.equal(early.requests.length,0);
 const controller=new AbortController();controller.abort();const pre=fixture([]);await assert.rejects(()=>pre.runtime.start({message:'read'},controller.signal,pre.emit),/取消/);assert.equal(pre.requests.length,0);
});

test('automatic invalid-tool rounds preserve segments and stay busy; continuations use fixed round identities',async()=>{
 const entered=deferred(),release=deferred(),f=fixture([[delta('先检查'),completed([message('先检查'),call('unknown_tool',{},'invalid-first')])],[delta('读取'),()=>{entered.resolve();return release.promise;},completed([message('读取'),call('canvas_read',{})])],[delta('完成'),completed([message('完成')])]]);
 const pending=f.runtime.start({message:'read'},undefined,f.emit);await entered.promise;const id=f.events[0].sessionId;assert.equal(f.runtime.sessions.get(id).busy,true);await assert.rejects(()=>f.runtime.resume(id,[],undefined,f.emit),/正在执行/);release.resolve();
 const result=await pending;assert.equal(result.text,'读取');assert.deepEqual(result.segments,[{round:1,text:'先检查'},{round:2,text:'读取'}]);assert.deepEqual(f.events.filter(e=>e.type==='session').map(e=>e.round),[1,2]);assert.ok(f.requests[1].request.input.some(item=>item.type==='function_call_output'&&/Unknown/.test(item.output)));
 const done=await f.runtime.resume(id,[{callId:'call-1',result:{nodes:[]}}],undefined,f.emit);assert.equal(done.round,3);assert.deepEqual(done.segments,[{round:3,text:'完成'}]);
});

test('streaming question barrier and round cap retain real user-decision requirements',async()=>{
 const form={title:'确认',fields:[{id:'brief',type:'text',label:'内容'}]},f=fixture([[completed([call('canvas_read',{},'read'),call('show_form',form,'form')])],[completed([message('继续')])]]);
 const first=await f.runtime.start({message:'确认'},undefined,f.emit);assert.deepEqual(first.calls.map(c=>c.name),['show_form']);assert.match(f.runtime.sessions.get(first.sessionId).input.find(item=>item.call_id==='read'&&item.type==='function_call_output').output,/未执行/);
 await assert.rejects(()=>f.runtime.resume(first.sessionId,[{callId:'form',result:{}}],undefined,f.emit));assert.equal(f.requests.length,1);
 const cap=fixture([[delta('检查'),completed([message('检查'),call('unknown_tool',{})])]],{maxRounds:1});const end=await cap.runtime.start({message:'read'},undefined,cap.emit);assert.equal(cap.requests.length,1);assert.equal(end.done,true);assert.match(end.text,/上限/);assert.deepEqual(end.segments.map(s=>s.round),[1,2]);assert.equal(end.segments[0].text,'检查');assert.equal(end.round,2);
});

function responseWriter(){return {headersSent:false,writableEnded:false,destroyed:false,lines:[],writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},flushHeaders(){},write(line){this.lines.push(line);},end(){this.writableEnded=true;}};}
test('HTTP NDJSON sends one terminal result or error and keeps validation failures as pre-header JSON errors',async()=>{
 const res=responseWriter();await writeAgentStream(res,async emit=>{emit({type:'session',sessionId:'s',round:1});emit({type:'text_delta',sessionId:'s',round:1,delta:'中文'});return {done:true,text:'中文',calls:[]};});
 assert.equal(res.status,200);assert.match(res.headers['Content-Type'],/application\/x-ndjson/);assert.deepEqual(res.lines.map(line=>JSON.parse(line).type),['session','text_delta','result']);assert.equal(JSON.parse(res.lines[1]).delta,'中文');
 const error=responseWriter();await writeAgentStream(error,async emit=>{emit({type:'session',sessionId:'s',round:1});throw Object.assign(Error('EOF'),{code:'stream_incomplete'});});assert.deepEqual(error.lines.map(line=>JSON.parse(line).type),['session','error']);assert.equal(error.writableEnded,true);
 const before=responseWriter();await assert.rejects(()=>writeAgentStream(before,async()=>{throw Object.assign(Error('missing'),{code:'configuration_required'});}),error=>error.code==='configuration_required');assert.equal(before.headersSent,false);
});

test('explicit NDJSON negotiation preserves legacy requests and disconnected writers never emit late results',async()=>{
 for(const accept of ['', '*/*','application/json','application/x-ndjson;q=0'])assert.equal(wantsAgentStream({headers:{accept}}),false);
 for(const accept of ['application/x-ndjson','application/json, application/x-ndjson; q=1'])assert.equal(wantsAgentStream({headers:{accept}}),true);
 const controller=new AbortController(),res=responseWriter();await writeAgentStream(res,async emit=>{emit({type:'session',sessionId:'s',round:1});controller.abort();res.destroyed=true;return {done:false,calls:[call('canvas_read',{})]};},{signal:controller.signal});assert.deepEqual(res.lines.map(line=>JSON.parse(line).type),['session']);
});

test('all final tool IDs are nonempty and unique before any output is committed, in streaming and JSON modes',async()=>{
 for(const stream of [false,true])for(const badId of ['', '   ',null,'same']){
  const output=[message('partial'),call('canvas_read',{},'same'),call('canvas_read',{},badId)],events=[];
  const agent=new AgentRuntime({model:'test-model',client:{responses:{create:async()=>stream?(async function*(){yield completed(output);})():{output}}}});
  await assert.rejects(()=>agent.start({message:'read'},undefined,stream?event=>events.push(event):undefined),e=>e.code==='invalid_tool_call_ids');
  const session=[...agent.sessions.values()][0];assert.equal(session.input.length,1);assert.deepEqual(session.pending,[]);assert.equal(session.done,true);
 }
});

test('cross-round call ID replay rejects the whole batch even when another call is fresh',async()=>{
 for(const stream of [false,true]){
  const batches=[[call('canvas_read',{},'used')],[call('canvas_read',{},'fresh'),call('canvas_read',{},'used')]];
  const agent=new AgentRuntime({model:'test-model',client:{responses:{create:async()=>{const output=batches.shift();return stream?(async function*(){yield completed(output);})():{output};}}}});
  const first=await agent.start({message:'read'},undefined,stream?()=>{}:undefined);
  await assert.rejects(()=>agent.resume(first.sessionId,[{callId:'used',result:{nodes:[]}}],undefined,stream?()=>{}:undefined),e=>e.code==='invalid_tool_call_ids');
  const session=agent.sessions.get(first.sessionId);assert.equal(session.input.some(item=>item.call_id==='fresh'),false);assert.deepEqual(session.pending,[]);assert.equal(session.done,true);
 }
});
