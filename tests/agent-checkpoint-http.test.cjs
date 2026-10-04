'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const root=path.resolve(__dirname,'..');
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function fixture(t,respond){
 const requests=[],provider=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);requests.push(input);await respond(input,res,requests.length);});
 const providerPort=await listen(provider),directory=await fs.mkdtemp(path.join(os.tmpdir(),'agent-checkpoint-http-'));
 // Run the real HTTP entrypoint in a private disposable tree: neither store
 // may acquire the running application's production writer lease.
 await fs.mkdir(path.join(directory,'server'));
 for(const name of await fs.readdir(path.join(root,'server')))if(name.endsWith('.cjs'))await fs.copyFile(path.join(root,'server',name),path.join(directory,'server',name));
 for(const name of ['agent-tools.js','generation-api.js'])await fs.copyFile(path.join(root,name),path.join(directory,name));
 for(const name of ['node_modules','src'])await fs.symlink(path.join(root,name),path.join(directory,name),'dir');
 const reservation=http.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));let child;
 async function stop(signal='SIGTERM'){if(!child||child.exitCode!==null||child.signalCode)return;const pid=child.pid,exited=once(child,'exit');child.kill(signal);await exited;return pid;}
 t.after(async()=>{await stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 async function start({key='local-fixture-not-a-real-key'}={}){
  child=spawn(process.execPath,['server/server.cjs'],{cwd:directory,env:{...process.env,PORT:String(port),OPENAI_API_KEY:key,OPENAI_MODEL:'checkpoint-fixture',OPENAI_BASE_URL:`http://127.0.0.1:${providerPort}/v1`,AGENT_MODEL_MAP:'',AGENT_REASONING_MAP:'',GENERATION_API_KEY:'',GENERATION_API_BASE_URL:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let output='',errors='';child.stderr.on('data',chunk=>{errors+=chunk;});const timeout=setTimeout(()=>reject(Error('isolated checkpoint server did not start')),5000);child.once('exit',()=>{clearTimeout(timeout);reject(Error('isolated checkpoint server exited before ready: '+errors));});child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Canvas replica:')){clearTimeout(timeout);resolve();}});});
 }
 const base=`http://127.0.0.1:${port}`;
 const post=async(route,input)=>{const response=await fetch(base+'/api/agent/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
 return {requests,start,stop,post,base,directory};
}
async function recoverFixtureMediaLease(f,pid){
 // This is an explicit operator step in our private fixture, never startup
 // behavior: the media store deliberately keeps even a dead writer's lease.
 const mediaDirectory=path.join(f.directory,'server','.generation-media'),lease=path.join(mediaDirectory,'.writer-lock');
 const original=await fs.readFile(lease,'utf8'),owner=JSON.parse(original),stat=await fs.lstat(lease);
 assert.equal(owner.pid,pid);assert.equal(stat.isFile(),true);assert.equal(stat.mode&0o777,0o600);
 if(typeof process.getuid==='function')assert.equal(stat.uid,process.getuid());
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const snapshots=new Map();
 for(const name of await fs.readdir(path.join(f.directory,'server','.agent-sessions')))if(name.endsWith('.json'))snapshots.set(name,await fs.readFile(path.join(f.directory,'server','.agent-sessions',name),'utf8'));
 await assert.rejects(f.start(),/Local task stores unavailable; server was not started/);
 assert.equal(await fs.readFile(lease,'utf8'),original);
 const {createGenerationMediaStore}=require('../server/generation-media-store.cjs'),blocked=createGenerationMediaStore({directory:mediaDirectory});
 await assert.rejects(blocked.ready,{code:'media_store_locked'});await blocked.close();
 assert.equal(await fs.readFile(lease,'utf8'),original);
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const retired=path.join(f.directory,'operator-retired-media-lock');await fs.rename(lease,retired);
 assert.equal(await fs.readFile(retired,'utf8'),original);
 await f.start();
 for(const [name,json]of snapshots)assert.equal(await fs.readFile(path.join(f.directory,'server','.agent-sessions',name),'utf8'),json);
}
const binding={projectId:'local-project',conversationId:'local-conversation',submissionId:'local-submission'};
function reply(res,output){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',output}));}
test('real SDK + HTTP retains original pending calls across restart, enforces binding and reads without a key', {timeout:20000},async t=>{
 const f=await fixture(t,async(input,res)=>reply(res,input.input.some(item=>item.type==='function_call_output')?[{type:'message',role:'assistant',content:[{type:'output_text',text:'已读取原始回执。'}]}]:[{type:'function_call',name:'canvas_read',arguments:'{}',call_id:'original_call'}]));
 await f.start();const start=await f.post('turn',{message:'读取画布',binding});assert.equal(start.status,200);assert.equal(start.body.calls[0].callId,'original_call');const sessionId=start.body.sessionId;
 const repeated=await f.post('turn',{message:'读取画布',binding});assert.equal(repeated.status,200);assert.equal(repeated.body.sessionId,sessionId);assert.equal(f.requests.length,1);
 const changed=await f.post('turn',{message:'不同任务',binding});assert.equal(changed.status,409);assert.equal(f.requests.length,1);
 await f.stop();await f.start({key:''});
 const restored=await f.post('state',{sessionId,binding});assert.equal(restored.status,200);assert.equal(restored.body.status,'waiting_tools');assert.equal(restored.body.restored,true);assert.equal(restored.body.pending[0].callId,'original_call');assert.equal(restored.body.canResumeWithReceipts,false);assert.equal(f.requests.length,1);
 const crossed=await f.post('state',{sessionId,binding:{...binding,projectId:'different'}});assert.notEqual(crossed.status,200);assert.equal(crossed.body.pending,undefined);
 const blocked=await f.post('continue',{sessionId,binding,results:[{callId:'original_call',result:{nodes:[]}}]});assert.equal(blocked.status,503);assert.equal(f.requests.length,1);
 await f.stop();await f.start();const results=[{callId:'original_call',result:{nodes:[]}}],continued=await f.post('continue',{sessionId,binding,results});assert.equal(continued.status,200);assert.equal(continued.body.done,true);assert.equal(f.requests.length,2);
 const replay=await f.post('continue',{sessionId,binding,results});assert.equal(replay.status,200);assert.equal(replay.body.text,continued.body.text);assert.equal(f.requests.length,2);
 await f.stop();await f.start();const completed=await f.post('state',{sessionId,binding});assert.equal(completed.body.status,'completed');assert.equal(completed.body.text,'已读取原始回执。');assert.equal(f.requests.length,2);
 const privateFile=await fetch(f.base+'/server/.agent-sessions/'+sessionId+'.json');assert.equal(privateFile.status,403);
});
test('after explicit media lease recovery, an interrupted SDK request restores as unknown and state lookup never resubmits it', {timeout:20000},async t=>{
 let arrived;const reached=new Promise(resolve=>arrived=resolve);
 const f=await fixture(t,async()=>{arrived();});await f.start();
 const pending=f.post('turn',{message:'等待真实请求边界',binding}).catch(()=>null);await reached;
 const records=(await fs.readdir(path.join(f.directory,'server','.agent-sessions'))).filter(name=>name.endsWith('.json'));assert.equal(records.length,1);const sessionId=records[0].slice(0,-5);
 const pid=await f.stop('SIGKILL');await pending;await recoverFixtureMediaLease(f,pid);
 const state=await f.post('state',{sessionId,binding});assert.equal(state.status,200);assert.equal(state.body.status,'unknown');assert.equal(state.body.canResumeWithReceipts,false);assert.equal(f.requests.length,1);
 const crossed=await f.post('state',{sessionId,binding:{...binding,conversationId:'different'}});assert.notEqual(crossed.status,200);assert.equal(crossed.body.pending,undefined);
 const retry=await f.post('continue',{sessionId,binding,results:[]});assert.notEqual(retry.status,200);assert.equal(f.requests.length,1);
});
test('real HTTP restores child calls, dependency results and canonical parent aggregation without duplicate requests', {timeout:20000},async t=>{
 const tasks=[{id:'inspect',title:'读取画布',instructions:'读取当前画布并报告实际节点。'},{id:'plan',title:'制定计划',instructions:'使用前序的真实读取结论。',dependsOn:['inspect']}];
 const f=await fixture(t,async(input,res)=>{
  const parent=input.tools.some(tool=>tool.name==='agent_delegate'),outputs=input.input.filter(item=>item.type==='function_call_output');
  if(parent)return reply(res,outputs.length?[{type:'message',role:'assistant',content:[{type:'output_text',text:'父任务已收到规范子任务结论。'}]}]:[{type:'function_call',name:'agent_delegate',arguments:JSON.stringify({tasks}),call_id:'delegate_original'}]);
  const user=JSON.stringify(input.input[0]);
  if(user.includes('制定计划'))return reply(res,[{type:'message',role:'assistant',content:[{type:'output_text',text:'依据真实读取结论制定镜头计划。'}]}]);
  reply(res,outputs.length?[{type:'message',role:'assistant',content:[{type:'output_text',text:'已查到节点 original-node。'}]}]:[{type:'function_call',name:'canvas_read',arguments:'{}',call_id:'child_original_call'}]);
 });
 await f.start();const first=await f.post('turn',{message:'委派读取和依赖规划任务',binding});assert.equal(first.status,200);const sessionId=first.body.sessionId;
 const input={sessionId,callId:'delegate_original',taskId:'inspect'},plan={...input,taskId:'plan'};
 const before=await f.post('delegated-state',input);assert.equal(before.status,200);assert.equal(before.body.status,'not_started');assert.equal(f.requests.length,1);
 const child=await f.post('delegated-start',input);assert.equal(child.status,200);assert.equal(child.body.status,'waiting');const childId=child.body.response.sessionId;
 assert.equal(child.body.response.calls[0].callId,'child_original_call');assert.equal(f.requests.length,2);
 await f.stop();await f.start({key:''});
 const parentState=await f.post('state',{sessionId,binding});assert.equal(parentState.status,200);assert.equal(parentState.body.delegation.callId,'delegate_original');assert.equal(parentState.body.delegation.tasks[0].status,'waiting');
 const reread=await f.post('delegated-state',input);assert.equal(reread.status,200);assert.equal(reread.body.response.sessionId,childId);assert.equal(reread.body.response.calls[0].callId,'child_original_call');assert.equal(f.requests.length,2);
 await f.stop();await f.start();
 const receipt={...input,results:[{callId:'child_original_call',result:{nodes:[{id:'original-node'}]}}]};
 const continued=await f.post('delegated-continue',receipt);assert.equal(continued.status,200);assert.equal(continued.body.status,'completed');assert.equal(f.requests.length,3);
 const replay=await f.post('delegated-continue',receipt);assert.equal(replay.status,200);assert.deepEqual(replay.body,continued.body);assert.equal(f.requests.length,3);
 await f.stop();await f.start();
 const restored=await f.post('delegated-state',input);assert.equal(restored.status,200);assert.equal(restored.body.status,'completed');assert.equal(restored.body.response.text,'已查到节点 original-node。');
 const replayAfterRestart=await f.post('delegated-continue',receipt);assert.equal(replayAfterRestart.status,200);assert.equal(replayAfterRestart.body.response.text,continued.body.response.text);assert.equal(f.requests.length,3);
 const dependent=await f.post('delegated-start',plan);assert.equal(dependent.status,200);assert.equal(dependent.body.status,'completed');assert.equal(f.requests.length,4);assert.match(JSON.stringify(f.requests[3].input),/已查到节点 original-node/);
 await f.stop();await f.start({key:''});
 const aggregate=await f.post('delegated-result',input);assert.equal(aggregate.status,200);assert.equal(aggregate.body.status,'completed');assert.equal(aggregate.body.tasks.length,2);assert.equal(f.requests.length,4);
 await f.stop();await f.start();
 const parentReceipt={sessionId,binding,results:[{callId:'delegate_original',result:{status:'completed',tasks:[{taskId:'invented',response:{text:'FORGED BROWSER RESULT'}}]}}]};
 const finished=await f.post('continue',parentReceipt);assert.equal(finished.status,200);assert.equal(finished.body.done,true);assert.equal(f.requests.length,5);
 const canonical=JSON.stringify(f.requests[4].input);assert.match(canonical,/已查到节点 original-node/);assert.equal(canonical.includes('FORGED BROWSER RESULT'),false);
 const replayParent=await f.post('continue',parentReceipt);assert.equal(replayParent.status,200);assert.equal(f.requests.length,5);
});

test('after explicit media lease recovery, a child interrupted by process death stays unknown and its parent remains readable', {timeout:20000},async t=>{
 let arrived;const reached=new Promise(resolve=>arrived=resolve);
 const f=await fixture(t,async(input,res)=>{
  if(input.tools.some(tool=>tool.name==='agent_delegate'))return reply(res,[{type:'function_call',name:'agent_delegate',arguments:JSON.stringify({tasks:[{id:'inspect',title:'检查',instructions:'读取实际画布。'}]}),call_id:'delegate_crash'}]);
  arrived();
 });
 await f.start();const first=await f.post('turn',{message:'检查委派中断',binding});assert.equal(first.status,200);const sessionId=first.body.sessionId,input={sessionId,callId:'delegate_crash',taskId:'inspect'};
 const pending=f.post('delegated-start',input).catch(()=>null);await reached;const pid=await f.stop('SIGKILL');await pending;await recoverFixtureMediaLease(f,pid);
 const parent=await f.post('state',{sessionId,binding});assert.equal(parent.status,200);assert.equal(parent.body.delegation.tasks[0].status,'unknown');
 assert.equal(parent.body.delegation.callId,'delegate_crash');assert.equal(parent.body.delegation.tasks[0].taskId,'inspect');
 const child=await f.post('delegated-state',input);assert.equal(child.status,200);assert.equal(child.body.status,'unknown');assert.equal(f.requests.length,2);
 const restart=await f.post('delegated-start',input);assert.ok(restart.status!==200||restart.body.status==='unknown');assert.equal(f.requests.length,2);
 const result=await f.post('delegated-result',input);assert.notEqual(result.status,200);assert.equal(f.requests.length,2);
});
