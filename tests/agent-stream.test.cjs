const test=require('node:test'),assert=require('node:assert/strict');
const transport=()=>import('../src/features/agent-stream/transport.mjs');
const stateModule=()=>import('../src/features/agent-stream/state.mjs');
const event=(type,extra={})=>({type,sessionId:'session',round:1,...extra});
const result=(extra={})=>({sessionId:'session',round:1,text:'你好世界',done:true,calls:[],...extra});
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)+'\n');
const response=body=>new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8'}});
const pause=()=>new Promise(resolve=>setImmediate(resolve));

test('NDJSON delivers early session/text, decodes UTF-8 byte splits, and returns tools only at terminal result',async()=>{
 const {requestAgent}=await transport();let writer,finished=false,calls=0,request;
 const readable=new ReadableStream({start(controller){writer=controller;}}),received=[];
 const pending=requestAgent('turn',{message:'开始'},{fetchImpl:async(url,options)=>{calls++;request={url,...options};return response(readable);},onEvent:value=>received.push(value)}).then(value=>{finished=true;return value;});
 for(const item of [event('session'),event('thinking',{active:true}),event('text_delta',{delta:'你好😀'})])for(const byte of bytes(item))writer.enqueue(Uint8Array.of(byte));
 await pause();assert.equal(finished,false);assert.deepEqual(received.map(item=>item.type),['session','thinking','text_delta']);assert.equal(received[2].delta,'你好😀');assert.equal(request.headers.Accept,'application/x-ndjson');
 const final=result({text:'你好😀',done:false,calls:[{callId:'read1',name:'canvas_read',args:{}}]});writer.enqueue(bytes({type:'result',result:final}));
 assert.deepEqual(await pending,final);assert.equal(calls,1);assert.equal(received.some(item=>item.type==='result'),false);
});

test('JSON fallback supports old servers, preserves missing-key errors, and advertises streams only for turn/continue',async()=>{
 const {requestAgent}=await transport();let options;
 const fallback=await requestAgent('continue',{sessionId:'session'},{fetchImpl:async(_,input)=>{options=input;return Response.json(result());}});assert.equal(fallback.text,'你好世界');assert.equal(options.headers.Accept,'application/x-ndjson');
 await assert.rejects(requestAgent('turn',{}, {fetchImpl:async()=>Response.json({error:'请配置KEY',code:'configuration_required'},{status:503})}),error=>error.message==='请配置KEY'&&error.code==='configuration_required'&&error.status===503);
 assert.deepEqual(await requestAgent('cancel',{}, {fetchImpl:async(_,input)=>{options=input;return Response.json({cancelled:true});}}),{cancelled:true});assert.equal(options.headers.Accept,undefined);
});

test('EOF, malformed events and explicit errors never trigger automatic replays',async()=>{
 const {requestAgent}=await transport();
 for(const [body,code] of [
  [JSON.stringify(event('text_delta',{delta:'部分内容'}))+'\n','stream_interrupted'],
  ['not-json\n','stream_protocol_error'],
  [JSON.stringify(event('text_delta',{delta:42}))+'\n','stream_protocol_error'],
  [JSON.stringify({type:'error',error:'模型断开',code:'provider_failed'})+'\n','provider_failed'],
 ]){
  let requests=0;await assert.rejects(requestAgent('turn',{}, {fetchImpl:async()=>{requests++;return response(body);}}),error=>error.code===code);assert.equal(requests,1);
 }
 const final=await requestAgent('turn',{}, {fetchImpl:async()=>response(JSON.stringify({type:'result',result:result()}))});assert.equal(final.text,'你好世界','last line need not end in a newline');
});

test('abort cancels an idle reader promptly even when the fetch adapter ignores its signal',async()=>{
 const {requestAgent}=await transport();const controller=new AbortController();let cancelled=0,received=[];
 const readable=new ReadableStream({start(writer){writer.enqueue(bytes(event('session')));writer.enqueue(bytes(event('text_delta',{delta:'已收到'})));},cancel(){cancelled++;}});
 const pending=requestAgent('turn',{}, {signal:controller.signal,fetchImpl:async()=>response(readable),onEvent:item=>received.push(item)});await pause();controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(received.at(-1).delta,'已收到');assert.equal(cancelled,1);
 let requested=false;await assert.rejects(requestAgent('turn',{}, {signal:controller.signal,fetchImpl:async()=>{requested=true;}}),{name:'AbortError'});assert.equal(requested,false);
});

test('a rejected network reader preserves delivered text and reports interruption without replay',async()=>{
 const {requestAgent}=await transport();let writer,requests=0;const received=[];
 const readable=new ReadableStream({start(controller){writer=controller;}});
 const pending=requestAgent('turn',{}, {fetchImpl:async()=>{requests++;return response(readable);},onEvent:item=>received.push(item)});
 writer.enqueue(bytes(event('text_delta',{delta:'已经收到的正文'})));await pause();
 const rejected=assert.rejects(pending,error=>error.code==='stream_interrupted'&&error.message.includes('已保留收到的内容'));
 writer.error(new TypeError('network error'));await rejected;
 assert.equal(received.at(-1).delta,'已经收到的正文');assert.equal(requests,1);
});

test('empty, duplicate and previously accepted tool call IDs reject the entire terminal batch',async()=>{
 const {requestAgent,validateResult}=await transport(),seen=new Set(['earlier']);
 for(const ids of [['ok',''],['same','same'],['ok','earlier']]){
  const value=result({done:false,calls:ids.map(callId=>({callId,name:'canvas_read',args:{}}))});
  assert.throws(()=>validateResult(value,seen),error=>error.code==='invalid_tool_calls');assert.deepEqual([...seen],['earlier']);
  await assert.rejects(requestAgent('turn',{}, {seenCallIds:seen,fetchImpl:async()=>response(JSON.stringify({type:'result',result:value})+'\n')}),error=>error.code==='invalid_tool_calls');
 }
 const accepted=result({done:false,calls:[{callId:'new',name:'canvas_read',args:{}}]});validateResult(accepted,seen);assert.ok(seen.has('new'));assert.throws(()=>validateResult(accepted,seen),/重复/);
});

test('stream state reconciles repair rounds by segments without appending aggregate final text',async()=>{
 const {createStreamState}=await stateModule(),messages=[],sessions=[],changed=[];
 const stream=createStreamState({messages,requestId:'request1',now:()=>100,onChange:item=>changed.push(item),onSession:id=>sessions.push(id)});
 assert.equal(messages.length,1);assert.equal(messages[0].stream.thinking,false);assert.equal(messages[0].stream.startedAt,100);
 stream.event(event('session'));stream.event(event('thinking',{active:true}));assert.equal(messages[0].stream.thinking,true);
 stream.event(event('text_delta',{delta:'第一轮'}));assert.equal(messages[0].stream.thinking,false);
 stream.event(event('session',{round:2}));stream.event(event('text_delta',{round:2,delta:'第二轮部'}));
 stream.finish(result({round:2,text:'第一轮修正第二轮完成',segments:[{round:1,text:'第一轮修正'},{round:2,text:'第二轮完成'}]}));
 assert.deepEqual(messages.map(item=>item.text),['第一轮修正','第二轮完成']);assert.deepEqual(messages.map(item=>item.stream.status),['done','done']);assert.deepEqual(messages.map(item=>item.stream.round),[1,2]);assert.equal(sessions[0],'session');
 const count=messages.length;stream.event(event('text_delta',{round:2,delta:'late'}));stream.interrupt();assert.equal(messages.length,count);assert.equal(messages[1].text,'第二轮完成');
 const continued=createStreamState({messages,requestId:'request2'});continued.finish(result({text:'后续JSON回复'}));assert.deepEqual(messages.map(item=>item.text),['第一轮修正','第二轮完成','后续JSON回复']);
});

test('canonical final text replaces deltas once, tool-only rounds disappear, and interrupted text survives refresh',async()=>{
 const {createStreamState,recoverStreams}=await stateModule(),messages=[];
 const first=createStreamState({messages,requestId:'first'});first.event(event('text_delta',{delta:'部分'}));first.finish(result({text:'完整'}));assert.deepEqual(messages.map(item=>item.text),['完整']);
 const tools=createStreamState({messages,requestId:'tools'});tools.event(event('session'));tools.finish(result({text:'',calls:[{callId:'tool'}],done:false}));assert.equal(messages.length,1);
 const active=createStreamState({messages,requestId:'active'});active.event(event('text_delta',{delta:'未完成内容'}));assert.equal(active.interrupt('网络已中断'),true);assert.equal(messages.at(-1).text,'未完成内容');assert.equal(messages.at(-1).stream.status,'interrupted');assert.equal(messages.at(-1).stream.error,'网络已中断');
 const refresh=createStreamState({messages,requestId:'refresh'});refresh.event(event('text_delta',{delta:'刷新前文本'}));const stored=JSON.parse(JSON.stringify(messages));assert.equal(recoverStreams(stored),true);assert.equal(stored.at(-1).text,'刷新前文本');assert.equal(stored.at(-1).stream.status,'interrupted');assert.equal(recoverStreams(stored),false);
});

test('segments restore a completed round that had no delta before the later repair round',async()=>{
 const {createStreamState}=await stateModule(),messages=[];
 const stream=createStreamState({messages,requestId:'missing-delta'});stream.event(event('session'));stream.event(event('session',{round:2}));stream.event(event('text_delta',{round:2,delta:'修复中'}));
 assert.equal(messages.length,1);assert.equal(messages[0].stream.round,2);
 stream.finish(result({round:2,text:'第一轮修复完成',segments:[{round:1,text:'第一轮'},{round:2,text:'修复完成'}]}));
 assert.deepEqual(messages.map(message=>message.stream.round),[1,2]);assert.deepEqual(messages.map(message=>message.text),['第一轮','修复完成']);
});

test('session identity mismatches fail without overwriting text or switching cancellation identity',async()=>{
 const {createStreamState}=await stateModule(),messages=[],sessions=[];const stream=createStreamState({messages,requestId:'identity',onSession:id=>sessions.push(id)});
 stream.event(event('text_delta',{delta:'保留'}));assert.throws(()=>stream.event(event('session',{sessionId:'other'})),/身份/);assert.throws(()=>stream.finish(result({sessionId:'other'})),/身份/);assert.equal(messages[0].text,'保留');assert.deepEqual(sessions,['session']);
});

test('frame batching updates each dirty message once per frame and can synchronously flush terminal state',async()=>{
 const {createFrameBatch}=await stateModule();let scheduled=0,cancelled=[],callback;const updates=[];
 const batch=createFrameBatch(items=>updates.push(items),{schedule:fn=>{callback=fn;return scheduled++;},cancel:id=>cancelled.push(id)});
 const message={text:''};for(let i=0;i<100;i++){message.text+='字';batch.add(message);}assert.equal(scheduled,1);assert.equal(updates.length,0);callback();assert.equal(updates.length,1);assert.equal(updates[0][0].text.length,100);
 const next={text:'后续'};batch.add(next);batch.add(message);batch.flush();assert.deepEqual(updates[1],[next,message]);assert.deepEqual(cancelled,[1]);batch.add(next);batch.destroy();assert.deepEqual(cancelled,[1,2]);
});

test('client request wiring publishes cancellation identity early and batches deltas without rebuilding the panel',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
 const code=source.slice(source.indexOf(' async function request(path,'),source.indexOf(' function persistQueue()'));
 const state=await stateModule(),chat={id:'chat',messages:[],activeRun:{binding:{projectId:'project-a'}}},frames=new Map(),updates=[];let nextFrame=0,resolveResult,persisted=0,seen;
 const terminal=new Promise(resolve=>{resolveResult=resolve;});
 const context={crypto,DOMException,Set,WeakMap,pageLeaving:false,chats:[chat],project:{id:'project-a'},sessionId:null,activeStream:null,draft:()=>chat,persistStreamingSoon(){},persistStreamingNow(){persisted++;},updateStreamRows:(current,messages)=>updates.push({current,messages}),streamReady:Promise.resolve({...state,
  createFrameBatch:flush=>state.createFrameBatch(flush,{schedule:fn=>{const id=nextFrame++;frames.set(id,fn);return id;},cancel:id=>frames.delete(id)}),
  requestAgent:async(path,data,options)=>{seen=options.seenCallIds;options.onEvent(event('session'));for(let i=0;i<100;i++)options.onEvent(event('text_delta',{delta:'字'}));return terminal;},
 })};
 vm.runInNewContext(code,context);const ids=new Set(),pending=context.request('turn',{},new AbortController().signal,{chat,seenCallIds:ids});await pause();
 assert.equal(context.sessionId,'session');assert.equal(chat.activeRun.sessionId,'session');assert.equal(chat.messages[0].text.length,100);assert.equal(frames.size,1);assert.equal(updates.length,0);assert.equal(seen,ids);
 const callback=[...frames.values()][0];frames.clear();callback();assert.equal(updates.length,1);assert.equal(updates[0].messages.length,1);
 resolveResult(result({text:'最终文本'}));await pending;assert.equal(chat.messages.length,1);assert.equal(chat.messages[0].text,'最终文本');assert.equal(chat.messages[0].stream.status,'done');assert.equal(context.activeStream,null);assert.equal(persisted,2,'session identity and terminal text are both persisted');
});

test('pagehide pauses the real queue before abort so later submissions remain queued; ordinary stop still continues',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),{createQueueRunner}=await import('../src/features/agent-queue/model.mjs');
 const lifecycle=source.split('\n').filter(line=>line.includes("window.addEventListener('pagehide'")||line.includes("window.addEventListener('pageshow'")).join('\n');
 const stop=source.slice(source.indexOf(' function stop(){'),source.indexOf(' function sanitize('));
 for(const leaving of [true,false]){
  const chat={queuedMessages:[{id:'first'},{id:'second'}],queuePauseReason:null,activeRun:{submissionId:'first',sessionId:'session',binding:{projectId:'project-a'}}},ran=[],events={};let release,persisted=0,cancelled=0,cardResets=0,rendered=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const context={pageLeaving:false,recoveryEpoch:0,recoveryModule:await import('../src/features/agent-recovery/model.mjs'),recoveryPreparing:false,draft:()=>chat,chats:[chat],appCards:null,artifactCards:{reset(){cardResets++;}},panel:{},render(){assert.equal(context.pageLeaving,false);rendered++;},activeStream:{state:{interrupt(){assert.ok(chat.queuePauseReason);}}},controller:{abort(){if(leaving){assert.ok(chat.queuePauseReason);assert.equal(cardResets,1,'stale iframe cards are reset before abort');}release();}},pendingResolve:null,sessionId:'session',persistStreamingNow(){persisted++;},request:async()=>{cancelled++;},window:{addEventListener(name,callback){events[name]=callback;}}};
  vm.runInNewContext(lifecycle+'\n'+stop,context);
  const runner=createQueueRunner({getChat:()=>chat,validate(){},persist(){},changed(){},failed(error){throw error;},run:async(_,item)=>{ran.push(item.id);if(item.id==='first')await pending;return{};}});
  const drained=runner.drain();await pause();if(leaving)events.pagehide();else context.stop();await drained;
  assert.deepEqual(ran,leaving?['first']:['first','second']);assert.equal(chat.queuedMessages.length,leaving?1:0);assert.equal(persisted,leaving?1:0);assert.equal(cancelled,leaving?0:1);assert.equal(cardResets,leaving?1:0);assert.equal(rendered,0);
  if(leaving){assert.equal(context.pageLeaving,true);events.pageshow();assert.equal(context.pageLeaving,false);assert.equal(rendered,1,'BFCache return redraws an open panel');assert.ok(chat.queuePauseReason,'BFCache return does not silently restart queued work');context.panel=null;events.pageshow();assert.equal(rendered,1,'a closed panel stays closed on pageshow');}
 }
});
