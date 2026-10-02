const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
function part(from,to){const start=source.indexOf(from),end=source.indexOf(to,start+from.length);assert.ok(start>=0&&end>start);return source.slice(start,end);}
const modules=Promise.all([import('../src/features/agent-queue/model.mjs'),import('../src/features/agent-execution/trace.mjs')]);
async function fixture(){
 const [queue]=await modules,trace={role:'tool',id:'widget',callId:'call',name:'show_widget',status:'done',args:{title:'Widget'},result:{kind:'widget'}},chat={id:'chat',text:'保留草稿',composerDoc:{type:'doc',content:[]},refs:['image'],skills:[],uploads:[{id:'upload'}],artifactRefs:[{artifact_path:'source.md'}],queuedMessages:[],queuePauseReason:'previous',messages:[trace]};
 const metrics={saves:0,renders:0,drains:0},context={chat,trace,busy:false,recoveryRunning:false,appQueueSaving:false,panel:{},pageLeaving:false,draft:()=>chat,queueModule:queue,queueRunner:{drain(){metrics.drains++;}},modelModule:{prepareSessionSelection:()=>({id:'auto'})},composerModule:{textDocument:text=>({type:'doc',text})},validateSubmission(){},persistQueue(){metrics.saves++;},flushConversation:async()=>{},track:operation=>operation(),render(){metrics.renders++;},crypto:require('node:crypto').webcrypto};
 vm.createContext(context);vm.runInContext(part(' function queueWidgetPrompt(', ' function send(){'),context);
 return {chat,trace,context,metrics,submit:text=>context.queueWidgetPrompt(text,trace,chat)};
}
test('widget queues a provenance-bound new message without consuming composer, attachments or answering a form',async()=>{
 const f=await fixture(),before=structuredClone(f.chat);assert.equal(f.submit('组件选择 A'),true);
 const item=f.chat.queuedMessages[0];assert.equal(item.text,'组件选择 A');assert.deepEqual(item.refs,[]);assert.deepEqual(item.uploads,[]);assert.equal(item.widgetOrigin.traceId,'widget');assert.equal(item.widgetOrigin.callId,'call');
 for(const key of ['text','composerDoc','refs','uploads','artifactRefs'])assert.deepEqual(f.chat[key],before[key]);
 assert.deepEqual(f.metrics,{saves:1,renders:1,drains:1});assert.equal(f.chat.queuePauseReason,null);
});
test('failed queue persistence rolls back queue and pause reason and never drains',async()=>{
 const f=await fixture(),queue=f.chat.queuedMessages;f.context.persistQueue=()=>{throw Error('full');};assert.throws(()=>f.submit('选择'),/full/);assert.equal(f.chat.queuedMessages,queue);assert.equal(f.chat.queuePauseReason,'previous');assert.equal(f.metrics.drains,0);assert.equal(f.chat.text,'保留草稿');
});
test('stale or failed widget cannot enqueue and message limits use the real queue validator',async()=>{
 for(const change of [f=>f.context.pageLeaving=true,f=>f.context.panel=null,f=>f.context.draft=()=>({id:'other'}),f=>f.chat.messages=[],f=>f.trace.status='error',f=>f.trace.result={error:'failed'}]){const f=await fixture();change(f);assert.throws(()=>f.submit('继续'));assert.equal(f.metrics.saves,0);assert.equal(f.metrics.drains,0);}
 const f=await fixture();assert.throws(()=>f.submit('a'.repeat(20001)),/20000/);assert.equal(f.metrics.drains,0);
});
test('a failed display-record save cannot return a successful tool continuation',async()=>{
 const [,{executeTracedCall}]=await modules;const chat={messages:[]};let count=0,executions=0;
 const changed=source.match(/changed:trace=>(\{trace.confirmationMode[\s\S]*?\})\n     \};/)[1];
 const context={d:chat,confirmationModule:{getMode:()=> 'ask'},window:{GenerationAPI:{getJobs:()=>[]}},generationJobs:null,save:()=>++count<2,render(){}};
 vm.createContext(context);vm.runInContext('this.changed=trace=>'+changed,context);
 await assert.rejects(executeTracedCall({name:'show_widget',callId:'call',args:{widget_code:'<p>hello</p>'}},{runId:'run',createId:()=> 'trace',changed:context.changed,execute:async()=>{executions++;return {kind:'widget'};}}),/未能保存/);
 assert.equal(executions,1);assert.equal(chat.messages[0].status,'error');assert.match(chat.messages[0].result.error,/未能保存/);
});
test('widget-origin mutation uses normal manual confirmation even if composer mode is automatic',async()=>{
 const [,{needsToolConfirmation}]=await modules,expression=source.match(/confirm:(executionModule\.needsToolConfirmation\([^?]+item\.widgetOrigin\?'ask':confirmationModule\?\.getMode\(\)\))/)?.[1];
 assert.ok(expression);const check=(origin,mutates)=>vm.runInNewContext(expression,{executionModule:{needsToolConfirmation},definition:{name:'canvas_add',mutates},item:{widgetOrigin:origin},confirmationModule:{getMode:()=> 'auto'}});
 assert.equal(check({traceId:'widget'},true),true);assert.equal(check(undefined,true),false);assert.equal(check({traceId:'widget'},false),false);
});

test('MCP app handoff is committed atomically with the queue and deduplicated without consuming the draft',async()=>{
 const f=await fixture();f.trace.name='show_app';f.trace.result={kind:'mcp_app',resource_uri:'ui://tapnow/motion-picker@v1'};
 assert.equal(await f.context.queueWidgetPrompt('选择 T01',f.trace,f.chat,{handoffId:'handoff-123'}),true);
 assert.equal(f.context.queueWidgetPrompt('选择 T01',f.trace,f.chat,{handoffId:'handoff-123'}),true);
 assert.equal(f.chat.queuedMessages.length,1);assert.equal(f.metrics.saves,1);assert.equal(f.chat.queuedMessages[0].widgetOrigin.resourceUri,f.trace.result.resource_uri);assert.equal(f.chat.text,'保留草稿');
 const fail=await fixture();fail.trace.name='show_app';fail.trace.result=f.trace.result;fail.context.persistQueue=()=>{throw Error('full');};
 assert.throws(()=>fail.context.queueWidgetPrompt('选择 T01',fail.trace,fail.chat,{handoffId:'handoff-123'}),/full/);
 assert.equal(fail.trace.appHandoffs,undefined);assert.equal(fail.chat.queuedMessages.length,0);assert.equal(fail.metrics.drains,0);
});

test('MCP app queue waits for actual commit, rolls back failed commits, and rejects a switched source',async()=>{
 for(const outcome of ['success','storage-failure','source-switch','reload','rollback-failure']){
  const f=await fixture();f.trace.name='show_app';f.trace.result={kind:'mcp_app',resource_uri:'ui://tapnow/director-markup@v1'};
  let resolve,reject,flushes=0;const commit=new Promise((yes,no)=>{resolve=yes;reject=no;});
  f.context.flushConversation=()=>++flushes===1?commit:outcome==='rollback-failure'?Promise.reject(Error('rollback disk failure')):Promise.resolve();
  let sourceCurrent=true;const queued=f.context.queueWidgetPrompt('DM1 verified',f.trace,f.chat,{handoffId:'director-receipt'},()=>sourceCurrent);
  assert.equal(f.context.appQueueSaving,true);assert.equal(f.metrics.drains,0);
  assert.equal(f.context.queueWidgetPrompt('duplicate',f.trace,f.chat,{handoffId:'director-receipt'}),false);
  if(outcome==='storage-failure')reject(Error('transaction abort'));
  else {if(outcome==='reload')sourceCurrent=false;else if(outcome!=='success')f.context.draft=()=>({id:'other'});resolve();}
  if(outcome==='success'){assert.equal(await queued,true);assert.equal(f.metrics.drains,1);assert.deepEqual(Array.from(f.trace.appHandoffs),['director-receipt']);}
  else {await assert.rejects(queued,outcome==='rollback-failure'?/撤销未能保存/:outcome==='source-switch'||outcome==='reload'?/来源已切换/:/transaction abort/);assert.equal(f.chat.queuedMessages.length,0);assert.equal(f.trace.appHandoffs,undefined);assert.equal(f.metrics.drains,0);assert.equal(f.chat.text,'保留草稿');assert.equal(f.chat.queuePauseReason,'previous');}
  assert.equal(f.context.appQueueSaving,false);assert.equal(flushes,outcome==='source-switch'||outcome==='reload'||outcome==='rollback-failure'?2:1);
 }
});

test('MCP app state save acknowledges the committed revision and rolls back a rejected transaction',async()=>{
 for(const outcome of ['success','storage-failure']){
  const trace={name:'show_app',status:'done',result:{kind:'mcp_app'},appState:{draft:'previous'}},previous=trace.appState,chat={messages:[trace]};
  let resolve,reject,completed=false;const commit=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const context={chat,trace,pageLeaving:false,panel:{},draft:()=>chat,save:()=>true,flushConversation:()=>commit};
  vm.createContext(context);vm.runInContext(part(' async function saveAppState(', ' function queueWidgetPrompt('),context);
  const state={draft:'edited'},saved=context.saveAppState(chat,trace,state).then(()=>{completed=true;});
  await Promise.resolve();assert.equal(completed,false);assert.equal(trace.appState,state);
  if(outcome==='success'){resolve();await saved;assert.equal(completed,true);assert.equal(trace.appState,state);}
  else {reject(Error('transaction abort'));await assert.rejects(saved,/transaction abort/);assert.equal(trace.appState,previous);}
 }
});


test('MCP hidden handoff preserves raw data and provenance; visible widgets cannot opt into hidden messages',async()=>{
 const f=await fixture();f.trace.name='show_app';f.trace.result={kind:'mcp_app',resource_uri:'ui://tapnow/motion-picker@v1'};
 const raw='Use the tapnow-motion skill. phase: awaiting-content';
 await f.context.queueWidgetPrompt(raw,f.trace,f.chat,{hidden:true,handoffId:'hidden-handoff'});
 const item=f.chat.queuedMessages[0];assert.equal(item.hidden,true);assert.equal(item.text,raw);assert.equal(item.widgetOrigin.traceId,f.trace.id);assert.equal(f.chat.text,'保留草稿');
 const visible=await fixture();visible.context.queueWidgetPrompt(raw,visible.trace,visible.chat,{hidden:true});assert.equal(visible.chat.queuedMessages[0].hidden,undefined);
 const prefix=part(' async function runSubmission(d,item){',"  if(d.title==='新建对话')");
 const previous={role:'user',text:'previous internal handoff',hidden:true};f.chat.messages.push(previous);
 const runtime={d:f.chat,item,clone:structuredClone,composerModule:{referenceNodes:()=>[]}};
 vm.runInNewContext(prefix.replace(' async function runSubmission(d,item){','')+'this.history=history;',runtime);
 const message=f.chat.messages.at(-1);assert.equal(message.hidden,true);assert.equal(message.text,raw);assert.equal(message.widgetOrigin.resourceUri,f.trace.result.resource_uri);
 assert.equal(runtime.history.at(-1).content,previous.text,'hidden text remains in subsequent model history');
});
test('MCP app refuses a busy turn without saving or consuming its handoff receipt',async()=>{
 for(const change of [f=>f.context.recoveryRunning=true,f=>f.context.busy=true,f=>f.context.queueRunner.running=true,f=>f.chat.queuedMessages.push({id:'other'})]){
  const f=await fixture();f.trace.name='show_app';f.trace.result={kind:'mcp_app',resource_uri:'ui://tapnow/motion-picker@v1'};change(f);
  assert.equal(f.context.queueWidgetPrompt('choice',f.trace,f.chat,{hidden:true,handoffId:'hidden-handoff'}),false);
  assert.equal(f.metrics.saves,0);assert.equal(f.trace.appHandoffs,undefined);assert.equal(f.metrics.drains,0);
 }
});
test('production conversation rendering omits hidden rows while retaining raw fork indices',()=>{
 const fragment=part('   const lastAssistant=d.messages.findLastIndex(',"   if(reconcileMessages)");
 const messages=[{role:'user',text:'visible'},{role:'user',text:'handoff',hidden:true},{role:'assistant',text:'followup'}];
 const context={d:{id:'chat',messages},rows:[],groupKeys:[],messageRows:new WeakMap(),busy:false,executionRenderer:null,messageRenderer:{render:(message,options)=>({text:message.text,index:options.index,lastAssistant:options.lastAssistant})},pendingQuestion:()=>null};
 vm.runInNewContext(fragment,context);assert.deepEqual(context.rows.map(row=>row.text),['visible','followup']);assert.equal(context.rows[1].index,2);assert.equal(context.rows[1].lastAssistant,true);assert.equal(context.messageRows.has(messages[1]),false);assert.equal(messages.length,3);
});
