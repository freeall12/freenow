const test=require('node:test'),assert=require('node:assert/strict');
const {AgentRuntime}=require('../server/agent.cjs');
const {compactContext,validateCompaction}=require('../server/agent-compaction.cjs');
const compacted=input=>({object:'response.compaction',output:[...input.filter(item=>item.role==='user'),{type:'compaction',encrypted_content:'opaque-provider-summary'}]});
test('long tool loop compacts complete old exchanges while retaining recent receipts and duplicate-call protection',async()=>{
 let calls=0;const summaries=[],requests=[];
 const client={responses:{compact:async request=>{summaries.push(structuredClone(request));return compacted(request.input);},create:async request=>{requests.push(structuredClone(request));calls++;return {status:'completed',output:[{type:'function_call',name:'canvas_read',call_id:calls===4?'call-1':'call-'+calls,arguments:'{}'}]};}}};
 const runtime=new AgentRuntime({client,model:'configured-model',maxContextChars:1000});
 let response=await runtime.start({message:'检查真实画布后继续编排，不重新生成已有素材'});
 for(let i=1;i<=2;i++)response=await runtime.resume(response.sessionId,[{callId:'call-'+i,result:{version:i,text:'actual-node-data '.repeat(700)}}]);
 await assert.rejects(runtime.resume(response.sessionId,[{callId:'call-3',result:{version:3,text:'actual-node-data '.repeat(700)}}]),error=>error.code==='invalid_tool_call_ids');
 assert.equal(summaries.length,1);assert(summaries[0].input.some(item=>item.call_id==='call-1'));
 assert(!summaries[0].input.some(item=>item.call_id==='call-2'));
 const input=requests[3].input;
 assert(input.some(item=>item.type==='compaction'));
 for(const id of ['call-2','call-3'])assert.deepEqual(input.filter(item=>item.call_id===id).map(item=>item.type),['function_call','function_call_output']);
 assert(input.some(item=>item.role==='user'&&item.content.includes('不重新生成已有素材')));
 assert.equal(runtime.sessions.get(response.sessionId).contextCompaction.count,1);
});
function fixture(){const input=[{role:'user',content:'exact user request'},{role:'assistant',content:'x'.repeat(5000)},{role:'user',content:'latest exact request'}];return {id:'s',input,pending:[],rounds:3,initialHistoryCount:2,responseBoundaries:[],controller:new AbortController()};}
test('compaction preserves structural user content regardless of object key order',()=>{
 const original=[{role:'user',content:[{type:'input_text',text:'exact'},{type:'input_image',image_url:'https://example.com/image.png',detail:'auto'}]}];
 const response={object:'response.compaction',output:[{role:'user',content:[{text:'exact',type:'input_text'},{detail:'auto',image_url:'https://example.com/image.png',type:'input_image'}]},{type:'compaction',encrypted_content:'opaque'}]};
 assert.equal(validateCompaction(response,original),response.output);
 response.output[0].content.reverse();
 assert.throws(()=>validateCompaction(response,original),/改变了用户输入/);
});
test('unsupported or malformed compaction keeps the exact input and never repeatedly requests compaction',async()=>{
 for(const response of [new Error('unsupported endpoint'),{object:'response.compaction',output:[{role:'user',content:'changed'},{type:'compaction',encrypted_content:'opaque'}]}]){
  const session=fixture(),original=session.input,events=[];let calls=0;
  const client={responses:{compact:async()=>{calls++;if(response instanceof Error)throw response;return response;}}};
  await compactContext({client,session,threshold:1000,onEvent:event=>events.push(event)});
  assert.equal(session.input,original);assert.equal(events.at(-1).status,'unavailable');
  await compactContext({client,session,threshold:1000});assert.equal(calls,1);
 }
});
test('cancellation discards a late compaction result and preserves original input',async()=>{
 const session=fixture(),original=session.input;let resolve;
 const pending=compactContext({session,threshold:1000,client:{responses:{compact:()=>new Promise(done=>{resolve=done;})}}});
 session.controller.abort();resolve(compacted(original.slice(0,2)));
 await assert.rejects(pending,error=>error.code==='cancelled');assert.equal(session.input,original);
});
test('compaction progress is validated, retained in message history and interrupted honestly on reload',async()=>{
 const {requestAgent}=await import('../src/features/agent-stream/transport.mjs');
 const {createStreamState,recoverStreams}=await import('../src/features/agent-stream/state.mjs');
 const messages=[],state=createStreamState({messages,requestId:'r'});
 const event={type:'context_compaction',sessionId:'s',round:1,status:'completed',beforeChars:4000,afterChars:1000};
 const body=[{...event,status:'running'},event,{type:'result',result:{sessionId:'s',round:1,text:'',done:false,calls:[]}}].map(x=>JSON.stringify(x)).join('\n');
 const result=await requestAgent('turn',{}, {fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/x-ndjson'}}),onEvent:event=>state.event(event)});state.finish(result);
 assert.equal(messages.length,1);assert.equal(messages[0].stream.compaction.status,'completed');
 const running=createStreamState({messages,requestId:'other'});running.event({...event,status:'running'});recoverStreams(messages);assert.equal(messages.at(-1).stream.compaction.status,'interrupted');
 await assert.rejects(requestAgent('turn',{}, {fetchImpl:async()=>new Response(JSON.stringify({...event,afterChars:5000})+'\n',{headers:{'content-type':'application/x-ndjson'}})}),error=>error.code==='stream_protocol_error');
});
