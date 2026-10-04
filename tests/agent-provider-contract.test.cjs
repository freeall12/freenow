const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises'),os=require('node:os');
const project=path.resolve(__dirname,'..');
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}],status:'completed'});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function startApp(t,config={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'agent-provider-contract-'));
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

// Loopback contract fixtures are not real provider access or model-quality tests.
test('all Agent menu aliases route through real HTTP and the installed SDK without fallback', {timeout:20000}, async t=>{
 const {models}=await import('../src/features/agent-composer/model-catalog.mjs');
 const {normalizeThinking}=await import('../src/features/agent-composer/thinking-settings.mjs');
 const routes=Object.fromEntries(models.filter(m=>m.id!=='auto').map(m=>[m.id,'fixture-'+m.id]));
 const reasoning=Object.fromEntries(models.map(m=>[m.id,{off:'none',enabled:'medium',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'high'}]));
 const requests=[],provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({url:req.url,body:JSON.parse(raw),authorization:req.headers.authorization});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',output:[message('fixture only')]}));});
 const providerPort=await listen(provider);t.after(()=>{provider.closeAllConnections();provider.close();});
 const base=await startApp(t,{OPENAI_API_KEY:'contract-fixture-nonsecret',OPENAI_MODEL:'fixture-auto',OPENAI_BASE_URL:`http://127.0.0.1:${providerPort}/v1`,AGENT_MODEL_MAP:JSON.stringify(routes),AGENT_REASONING_MAP:JSON.stringify(reasoning)});
 const config=await fetch(base+'/api/agent/config').then(r=>r.json());assert.equal(config.configured,true);assert.equal(requests.length,0);
 for(const model of models){
  const thinking=normalizeThinking(model.id),selection={id:model.id,...(thinking?{thinking}:{})};
  const response=await post(base,'/api/agent/turn',{message:'inspect local canvas',modelSelection:selection},{stream:false});assert.equal(response.status,200,model.id);assert.equal((await response.json()).done,true);
  const sent=requests.at(-1);assert.equal(sent.url,'/v1/responses');assert.equal(sent.authorization,'Bearer contract-fixture-nonsecret');assert.equal(sent.body.model,model.id==='auto'?'fixture-auto':routes[model.id]);assert.equal(sent.body.store,false);assert.equal(sent.body.max_output_tokens,4000);
  assert(sent.body.tools.every(tool=>tool.type==='function'&&tool.strict===false&&!Object.hasOwn(tool,'mutates')));
  assert.deepEqual(sent.body.reasoning,thinking?{effort:reasoning[model.id][thinking.enabled?thinking.level||'enabled':'off']}:undefined);
 }
 const before=requests.length,missing=await post(base,'/api/agent/turn',{message:'inspect',modelSelection:{id:'unmapped-alias'}},{stream:false});assert.equal(missing.status,503);assert.equal((await missing.json()).code,'configuration_required');assert.equal(requests.length,before);
});
for(const streaming of [false,true])test(`real SDK ${streaming?'SSE':'JSON'} continuation removes output-only fields while preserving reasoning and call identity`,{timeout:15000},async t=>{
 const requests=[],provider=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  if(body.input.some(item=>Object.hasOwn(item,'created_by')||Object.hasOwn(item,'parsed_arguments')||item.content?.some?.(part=>Object.hasOwn(part,'parsed')))){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'output-only provenance cannot be replayed',type:'invalid_request_error'}}));return;}
  const output=requests.length===1?[
   {type:'reasoning',id:'reasoning-original',summary:[],encrypted_content:'opaque-fixture-reasoning',created_by:'output-provenance'},
   {...message('inspect'),id:'message-original',phase:'commentary',created_by:'output-provenance',content:[{type:'output_text',text:'inspect',annotations:[],parsed:{sdk_only:true}}]},
   {type:'function_call',id:'tool-original',call_id:'call-original',name:'canvas_read',arguments:'{}',parsed_arguments:{sdk_only:true},status:'completed',created_by:'output-provenance'}
  ]:[message('done')];
  const response={id:'response-fixture-'+requests.length,status:'completed',output};
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});event(res,{type:'response.completed',response});res.end('data: [DONE]\n\n');}
  else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));}
 });
 const providerPort=await listen(provider);t.after(()=>{provider.closeAllConnections();provider.close();});
 const base=await startApp(t,{OPENAI_API_KEY:'contract-fixture-nonsecret',OPENAI_MODEL:'fixture-reasoning',OPENAI_BASE_URL:`http://127.0.0.1:${providerPort}/v1`});
 const firstResponse=await post(base,'/api/agent/turn',{message:'inspect'},{stream:streaming});
 async function result(response){if(!streaming)return response.json();const events=lines(response);for(;;){const e=await events.next();assert(e,'no terminal result');assert.notEqual(e.type,'error',e.error);if(e.type==='result')return e.result;}}
 const first=await result(firstResponse);assert.equal(first.calls[0].callId,'call-original');
 const continued=await post(base,'/api/agent/continue',{sessionId:first.sessionId,results:[{callId:'call-original',result:{nodes:[]}}]},{stream:streaming});assert.equal(continued.status,200);const final=await result(continued);assert.equal(final.done,true);assert.equal(requests.length,2);
 const input=requests[1].input;assert.deepEqual(input.map(item=>item.type||item.role),['user','reasoning','message','function_call','function_call_output']);assert.equal(input[1].encrypted_content,'opaque-fixture-reasoning');assert.equal(input[2].phase,'commentary');assert.equal(input[3].call_id,'call-original');assert.equal(input[4].call_id,'call-original');
});

test('every advertised thinking level requires explicit provider effort mapping',async()=>{
 const {models}=await import('../src/features/agent-composer/model-catalog.mjs');
 const {thinkingCatalog}=await import('../src/features/agent-composer/thinking-catalog.mjs');
 const {resolveReasoning}=require('../server/agent-models.cjs');
 for(const {id}of models){const spec=thinkingCatalog[id];if(!spec?.switchable)continue;
  for(const level of spec.levels.length?spec.levels:[undefined]){
   const selection={id,thinking:{enabled:true,...(level?{level}:{})}};
   await assert.rejects(resolveReasoning(selection,{}),error=>error.code==='configuration_required');
   assert.deepEqual(await resolveReasoning(selection,{[id]:{[level||'enabled']:'medium'}}),{effort:'medium'});
  }
  if(spec.can_disable){const selection={id,thinking:{enabled:false,...(spec.levels.length?{level:spec.default.level}:{})}};assert.deepEqual(await resolveReasoning(selection,{[id]:{off:'none'}}),{effort:'none'});}
 }
});

test('standalone compaction uses real SDK HTTP with normalized input and preserves source evidence',{timeout:10000},async t=>{
 const {createConfiguredModelClient}=require('../server/outbound-client.cjs'),{compactContext}=require('../server/agent-compaction.cjs');
 let sent;
 const provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;sent={url:req.url,body:JSON.parse(raw)};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({object:'response.compaction',output:[sent.body.input[0],{type:'compaction',encrypted_content:'opaque-summary'}]}));});
 const providerPort=await listen(provider);t.after(()=>{provider.closeAllConnections();provider.close();});
 const {client}=createConfiguredModelClient({apiKey:'contract-fixture-nonsecret',baseUrl:`http://127.0.0.1:${providerPort}/v1`});
 const original=[{role:'user',content:'original user input'},{type:'reasoning',id:'reasoning-original',summary:[],encrypted_content:'x'.repeat(5000),created_by:'output-only'},{role:'user',content:'latest user input'}];
 const session={id:'compaction-fixture',model:'fixture',input:original,pending:[],rounds:3,initialHistoryCount:2,responseBoundaries:[],controller:new AbortController()};
 await compactContext({client,session,threshold:1000});assert.equal(sent.url,'/v1/responses/compact');assert.equal(sent.body.input[1].created_by,undefined);assert.equal(sent.body.input[1].encrypted_content,original[1].encrypted_content);assert.equal(original[1].created_by,'output-only');assert.equal(session.contextCompaction.count,1);assert.equal(session.input.at(-1),original.at(-1));
});

for(const mode of ['cancel-api','disconnect'])test(`real HTTP ${mode} aborts the SDK upstream and never exposes partial tools`,{timeout:10000},async t=>{
 const closed=deferred();let count=0;
 const provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;count++;res.on('close',closed.resolve);res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();event(res,{type:'response.output_text.delta',delta:'正在等待模型完成。'.repeat(30)});event(res,{type:'response.output_item.done',item:{type:'function_call',call_id:'partial-only',name:'canvas_read',arguments:'{}'}});});
 const providerPort=await listen(provider);t.after(()=>{provider.closeAllConnections();provider.close();});
 const base=await startApp(t,{OPENAI_API_KEY:'contract-fixture-nonsecret',OPENAI_MODEL:'fixture',OPENAI_BASE_URL:`http://127.0.0.1:${providerPort}/v1`});
 const controller=new AbortController(),stream=lines(await post(base,'/api/agent/turn',{message:'wait'},{signal:controller.signal})),session=await stream.next();assert.equal(session.type,'session');assert.equal((await stream.next()).type,'text_delta');
 if(mode==='cancel-api'){
  const cancelled=await post(base,'/api/agent/cancel',{sessionId:session.sessionId},{stream:false});assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).cancelled,true);
  const terminal=await stream.next();assert.equal(terminal.type,'error');assert.equal(terminal.code,'cancelled');
 }else controller.abort();
 await closed.promise;const state=await post(base,'/api/agent/state',{sessionId:session.sessionId},{stream:false});assert.equal(state.status,200);const body=await state.json();assert.deepEqual(body.pending,[]);assert.equal(body.canResumeWithReceipts,false);assert.equal(count,1);
});
