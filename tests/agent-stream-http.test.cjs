const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises'),os=require('node:os');
const project=path.resolve(__dirname,'..');
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}],status:'completed'});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function startApp(t,config={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'agent-stream-http-'));
 // The real entrypoint owns durable writer leases. Each HTTP fixture must use
 // its own stores rather than acquiring the running application's stores.
 await fs.mkdir(path.join(directory,'server'));
 for(const name of await fs.readdir(path.join(project,'server')))if(name.endsWith('.cjs'))await fs.copyFile(path.join(project,'server',name),path.join(directory,'server',name));
 for(const name of ['agent-tools.js','generation-api.js'])await fs.copyFile(path.join(project,name),path.join(directory,name));
 for(const name of ['node_modules','src'])await fs.symlink(path.join(project,name),path.join(directory,name),'dir');
 const reservation=http.createServer();const port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server/server.cjs'],{cwd:directory,env:{...process.env,PORT:String(port),OPENAI_API_KEY:'',OPENAI_MODEL:'',OPENAI_BASE_URL:'',AGENT_MODEL_MAP:'',AGENT_REASONING_MAP:'',GENERATION_API_KEY:'',GENERATION_API_BASE_URL:'',...config},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}await fs.rm(directory,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='',errors='';child.stderr.on('data',chunk=>{errors+=chunk;});const timeout=setTimeout(()=>reject(Error('isolated test server did not start')),5000);child.once('exit',code=>{clearTimeout(timeout);reject(Error('isolated server exited '+code+': '+errors));});child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Canvas replica:')){clearTimeout(timeout);resolve();}});});
 return 'http://127.0.0.1:'+port;
}
function post(base,route,input,{stream=true,signal}={}){return fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...(stream?{accept:'application/x-ndjson'}:{})},body:JSON.stringify(input),signal});}
function lines(response){const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';return {reader,async next(){for(;;){const end=buffer.indexOf('\n');if(end>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line)return JSON.parse(line);continue;}const {value,done}=await reader.read();if(done)return null;buffer+=decoder.decode(value,{stream:true});}}};}
function event(res,value){res.write('data: '+JSON.stringify(value)+'\n\n');}

test('unconfigured live HTTP endpoint returns JSON 503 even when NDJSON is requested', {timeout:10000},async t=>{
 const base=await startApp(t),response=await post(base,'/api/agent/turn',{message:'你好'});assert.equal(response.status,503);assert.match(response.headers.get('content-type'),/application\/json/);assert.equal((await response.json()).code,'configuration_required');
});

test('real SDK SSE transport streams Chinese, rejects EOF, keeps JSON compatible and aborts upstream on browser disconnect', {timeout:15000},async t=>{
 const requests=[],upstreamClosed=deferred();let held;
 const provider=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const input=JSON.parse(body);requests.push(input);
  if(!input.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',output:[message('旧 JSON')]}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();const prompt=input.input[0].content;
  if(prompt.startsWith('disconnect')){held=res;res.on('close',upstreamClosed.resolve);event(res,{type:'response.output_text.delta',delta:'等待'});return;}
  // Split the provider's UTF-8 bytes inside a Chinese codepoint. The actual SDK
  // decoder, then our NDJSON writer, must preserve both chunks' complete text.
  const data=Buffer.from('data: '+JSON.stringify({type:'response.output_text.delta',delta:'你好，画布'})+'\n\n'),index=data.indexOf(Buffer.from('你'))+1;res.write(data.subarray(0,index));res.write(data.subarray(index));
  if(prompt.startsWith('eof')){res.end();return;}
  if(prompt.startsWith('failure')){res.end('data: '+JSON.stringify({type:'response.failed'})+'\n\n');return;}
  event(res,{type:'response.completed',response:{status:'completed',output:[message('你好，画布')]}});res.end('data: [DONE]\n\n');
 });
 const providerPort=await listen(provider);t.after(()=>{held?.destroy();provider.closeAllConnections();return new Promise(resolve=>provider.close(resolve));});
 const base=await startApp(t,{OPENAI_API_KEY:'integration-test-not-a-real-key',OPENAI_MODEL:'local-mock',OPENAI_BASE_URL:'http://127.0.0.1:'+providerPort+'/v1'});
 const response=await post(base,'/api/agent/turn',{message:'中文'});assert.match(response.headers.get('content-type'),/application\/x-ndjson/);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.type),['session','text_delta','result']);assert.equal(events[1].delta,'你好，画布');assert.equal(events[2].result.text,'你好，画布');
 for(const message of ['eof','failure']){const result=await post(base,'/api/agent/turn',{message});const events=(await result.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.type),['session','text_delta','error']);assert.equal(events.at(-1).code,message==='eof'?'stream_incomplete':'response_failed');}
 const legacy=await post(base,'/api/agent/turn',{message:'JSON'},{stream:false});assert.match(legacy.headers.get('content-type'),/application\/json/);const json=await legacy.json();assert.equal(json.text,'旧 JSON');assert.equal(json.segments,undefined);
 const controller=new AbortController(),stream=lines(await post(base,'/api/agent/turn',{message:'disconnect'},{signal:controller.signal}));const session=await stream.next();assert.equal(session.type,'session');assert.equal((await stream.next()).delta,'等待');controller.abort();await upstreamClosed.promise;
 const resume=await post(base,'/api/agent/continue',{sessionId:session.sessionId,results:[]},{stream:false});assert.equal(resume.status,409);assert.equal((await resume.json()).code,'agent_resume_blocked');assert.equal(requests.length,5);
});

test('real SDK form preparation ends its run and submissions or revisions use separate HTTP user turns', {timeout:15000},async t=>{
 const {createProvider,form}=require('../qa/agent-form-provider.cjs'),{server:provider,records}=createProvider(),providerPort=await listen(provider);
 t.after(()=>{provider.closeAllConnections();return new Promise(resolve=>provider.close(resolve));});
 const base=await startApp(t,{OPENAI_API_KEY:'local-form-fixture-not-a-real-key',OPENAI_MODEL:'local-form-fixture',OPENAI_BASE_URL:`http://127.0.0.1:${providerPort}/v1`});
 const parse=async response=>(await response.text()).trim().split('\n').map(JSON.parse).findLast(event=>event.type==='result').result;
 const first=await parse(await post(base,'/api/agent/turn',{message:'请展示表单'})),call=first.calls[0];assert.equal(call.name,'show_form');assert.equal(first.done,false);assert.equal(records.length,1);
 const prepared=await parse(await post(base,'/api/agent/continue',{sessionId:first.sessionId,results:[{callId:call.callId,result:{form,awaiting_submission:true}}]}));assert.equal(prepared.done,true);assert.equal(records.length,1);
 const {normalizeForm,formSubmission}=await import('../src/features/agent-forms/model.mjs'),answer=formSubmission(normalizeForm({args:form}),{style:'film',brief:'灯光'},call.callId);
 const second=await parse(await post(base,'/api/agent/turn',{message:'',formSubmission:{form,result:answer}}));assert.notEqual(second.sessionId,first.sessionId);assert.equal(second.done,true);assert.equal(records.length,2);assert.equal(records[1].input.some(item=>item.type==='function_call_output'),false);assert.match(records[1].input[0].content,/User-submitted form submission/);
 const ended=await post(base,'/api/agent/continue',{sessionId:first.sessionId,results:[{callId:call.callId,result:answer}]},{stream:false});assert.equal(ended.status,400);
 await parse(await post(base,'/api/agent/turn',{message:'',formSubmission:{form,result:{...answer,skipped:true,values:[]}}}));assert.equal(records.length,3);assert.match(records[2].input[0].content,/"skipped":true/);
});
