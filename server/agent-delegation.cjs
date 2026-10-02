'use strict';
const {createHash}=require('node:crypto');
const {toolOutputs}=require('./agent-vision.cjs');
const {parse}=require('../agent-tools.js');
const terminal=new Set(['completed','failed','cancelled','limited','skipped']);

function canonical(value){
 if(value===null||['string','boolean'].includes(typeof value))return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw Error('子任务结果必须为 JSON 数据');
}
function fingerprint(value){const text=canonical(value);if(text.length>2000000)throw Error('子任务结果过大');return createHash('sha256').update(text).digest('hex');}
function taskDefinitions(call){
 return parse('agent_delegate',{tasks:call.args?.tasks}).args.tasks;
}

/** Separate worker runtimes own tool validation. This manager owns scheduling,
 * immutable task binding, budgets and execution receipts, never model access. */
function createDelegationManager({getParent,createWorker,persist=()=>Promise.resolve()}){
 if(typeof getParent!=='function'||typeof createWorker!=='function')throw TypeError('Delegation requires parent lookup and worker factory');
 const parents=new Map(),queue=[];let running=0,closed=false;
 const save=parent=>persist(parent);
 function snapshot(task){return structuredClone({taskId:task.definition.id,title:task.definition.title,dependsOn:task.definition.dependsOn||[],status:task.status,...(task.response?{response:task.response}:{}),...(task.error?{error:task.error}:{}),...(task.blockedBy?{blockedBy:task.blockedBy}:{})});}
 function prerequisites(batch,task){return (task.definition.dependsOn||[]).map(id=>batch.tasks.get(id));}
 function propagateSkipped(batch){
  let changed;
  do{changed=false;for(const task of batch.tasks.values()){
   if(terminal.has(task.status))continue;
   const blocked=prerequisites(batch,task).filter(dependency=>terminal.has(dependency.status)&&dependency.status!=='completed');
   if(!blocked.length)continue;
   task.status='skipped';task.blockedBy=blocked.map(dependency=>dependency.definition.id);task.error='前序子任务未成功完成：'+task.blockedBy.join('、');
   delete task.response;task.controller.abort();task.finish?.();changed=true;
  }}while(changed);
 }
 function prerequisiteResults(batch,task){return prerequisites(batch,task).map(dependency=>{
  const text=String(dependency.response?.text||'');
  return {taskId:dependency.definition.id,title:dependency.definition.title,status:'completed',text:text.slice(0,4000),textLength:text.length,textTruncated:text.length>4000};
 });}
 function pump(){
  while(!closed&&running<2&&queue.length){const work=queue.shift();if(work.task.controller.signal.aborted){work.finish();continue;}
   running++;Promise.resolve().then(work.run).finally(()=>{running--;pump();}).catch(()=>{});
  }
 }
 function binding(sessionId,callId,readOnly=false){
  if(typeof sessionId!=='string'||!sessionId||typeof callId!=='string'||!callId)throw Error('父会话或委派调用 ID 无效');
  const parent=getParent(sessionId);
  if(!parent||!readOnly&&(closed||parent.done||parent.controller?.signal.aborted))throw Error('父会话已结束或不存在');
  if(!readOnly&&parent.busy)throw Error('父会话正在执行');
  const calls=(parent.pending||[]).filter(call=>call.callId===callId);
  if(calls.length!==1||calls[0].name!=='agent_delegate')throw Error('委派调用与父会话不匹配');
  const definitions=taskDefinitions(calls[0]),key=fingerprint(definitions),record=parents.get(sessionId);
  if(record&&record.parent!==parent)throw Error('父会话身份已变化');
  const batch=record?.batches.get(callId);
  if(batch&&batch.fingerprint!==key)throw Error('委派任务定义已变化');
  return {parent,definitions,key,record,batch};
 }
 function batchFor(sessionId,callId,taskId,create=false){
  const bound=binding(sessionId,callId);
  if(!bound.definitions.some(task=>task.id===taskId))throw Error('子任务 ID 与委派批次不匹配');
  if(!bound.batch&&create){
   let record=bound.record;if(!record){record={parent:bound.parent,batches:new Map()};parents.set(sessionId,record);}
   if(record.batches.size>=2)throw Error('父会话已达到两批委派预算');
   const batch={callId,fingerprint:bound.key,tasks:new Map(bound.definitions.map(definition=>[definition.id,{definition:structuredClone(definition),status:'queued',controller:new AbortController(),started:false,resumes:new Map()}]))};
   record.batches.set(callId,batch);batch.abort=()=>cancelCall(sessionId,callId);bound.parent.controller.signal.addEventListener('abort',batch.abort,{once:true});bound.batch=batch;
  }
  if(!bound.batch)throw Error('委派批次尚未启动');
  return {batch:bound.batch,parent:bound.parent,task:bound.batch.tasks.get(taskId)};
 }
 function cancelTask(task){
  if(terminal.has(task.status))return;
  task.status='cancelled';task.error='父会话或委派请求已停止';delete task.response;task.controller.abort();
  if(task.worker&&task.workerId){try{task.worker.cancel(task.workerId);}catch{/* Aborted signal still blocks late receipts. */}}
  task.finish?.();
 }
 function cancelCall(sessionId,callId){
  const record=parents.get(sessionId),batch=record?.batches.get(callId);if(!batch)return [];
  // Cancel ready roots first so dependent tasks retain the causal skipped state.
  const ready=[...batch.tasks.values()].filter(task=>!terminal.has(task.status)&&prerequisites(batch,task).every(dependency=>dependency.status==='completed'));
  for(const task of ready)cancelTask(task);
  propagateSkipped(batch);
  record.parent.controller.signal.removeEventListener('abort',batch.abort);save(record.parent).catch(()=>{});pump();return [...batch.tasks.values()].map(snapshot);
 }
 function cancelParent(sessionId){const record=parents.get(sessionId);if(!record)return [];return [...record.batches.keys()].flatMap(callId=>cancelCall(sessionId,callId));}
 function watch(signal,sessionId,promise){
  if(!signal)return promise;
  const abort=()=>cancelParent(sessionId);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  promise.then(()=>signal.removeEventListener('abort',abort),()=>signal.removeEventListener('abort',abort));return promise;
 }
 function perform(batch,task,invoke,parent,operation){
  let resolve;const promise=new Promise(done=>resolve=done);task.activePromise=promise;let finished=false;
  const finish=()=>{if(!finished){finished=true;resolve(snapshot(task));}};task.finish=finish;task.status='queued';task.operation=operation;task.dispatched=false;
  queue.push({task,finish,async run(){
   if(closed||task.controller.signal.aborted){finish();return;}
   try{
    await save(parent);if(closed||task.controller.signal.aborted){finish();return;}
    task.status='running';task.dispatched=true;await save(parent);if(closed||task.controller.signal.aborted){finish();return;}
    const response=await invoke();
    if(task.controller.signal.aborted){if(response?.sessionId)try{task.worker.cancel(response.sessionId);}catch{}return;}
    if(!response||typeof response.sessionId!=='string'||typeof response.done!=='boolean'||!Array.isArray(response.calls)||response.done&&response.calls.length||!response.done&&!response.calls.length)throw Error('子 Agent 返回无效执行回执');
    if(task.workerId&&task.workerId!==response.sessionId)throw Error('子 Agent 会话身份不匹配');
    task.workerId=response.sessionId;task.response=structuredClone(response);
    if(response.limitReached){task.status='limited';task.error='子 Agent 已达到执行预算';}
    else task.status=response.done?'completed':'waiting';
    delete task.operation;delete task.dispatched;await save(parent);
   }catch(error){if(!closed&&!task.controller.signal.aborted){try{await task.worker?.commit?.(task.workerId);}catch{}task.status=task.worker?.state?.(task.workerId)?.status==='unknown'||task.checkpoint&&['unknown','request_in_flight','compacting'].includes(task.checkpoint.status)?'unknown':'failed';task.error=error.message||String(error);if(task.status==='failed'&&task.workerId&&!task.worker?.state?.(task.workerId)?.done)try{task.worker.cancel(task.workerId);}catch{}}}
   finally{if(!closed)propagateSkipped(batch);try{await save(parent);}catch(error){task.status='unknown';task.error='子任务检查点提交失败';}finish();}
  }});pump();return promise;
 }
 function start({sessionId,callId,taskId},signal){
  const {batch,parent,task}=batchFor(sessionId,callId,taskId,true);
  if(signal?.aborted){cancelParent(sessionId);return Promise.resolve(snapshot(task));}
  propagateSkipped(batch);
  if(task.status==='unknown'||task.status==='blocked')throw Object.assign(Error('子任务执行结果未知或配置已变化，禁止重放'),{code:'delegation_resume_blocked',status:409});
  if(task.started&&task.status==='queued'&&!task.activePromise&&task.operation?.kind==='resume')throw Error('子任务等待原始工具回执续轮');
  if(terminal.has(task.status)||task.started&&!(task.status==='queued'&&!task.activePromise))return watch(signal,sessionId,terminal.has(task.status)||task.status==='waiting'?Promise.resolve(snapshot(task)):task.activePromise);
  const pendingDependencies=prerequisites(batch,task).filter(dependency=>dependency.status!=='completed').map(dependency=>dependency.definition.id);
  if(pendingDependencies.length)throw Object.assign(Error('前序子任务尚未完成：'+pendingDependencies.join('、')),{code:'delegation_dependencies_pending',status:409,pendingDependencies});
  task.started=true;
  task.startPromise=perform(batch,task,async()=>{
   binding(sessionId,callId);
   task.worker=await workerFor(parent,batch,task);
   if(task.controller.signal.aborted)throw Error('委派已取消');
   if(!task.worker||['start','resume','cancel'].some(name=>typeof task.worker[name]!=='function'))throw Error('子 Agent runtime 无效');
   return task.checkpoint?task.worker.resume(task.workerId,[],task.controller.signal):task.worker.start({},task.controller.signal);
  },parent,{kind:'start'});
  return watch(signal,sessionId,task.startPromise);
 }
 function resume({sessionId,callId,taskId,results},signal){
  const {batch,parent,task}=batchFor(sessionId,callId,taskId);
  if(signal?.aborted){cancelParent(sessionId);return Promise.resolve(snapshot(task));}
  if(!Array.isArray(results)||!results.length||results.some(item=>!item||typeof item.callId!=='string'||!Object.hasOwn(item,'result')||Object.keys(item).some(key=>!['callId','result','mediaInputs'].includes(key))))throw Error('子任务工具结果无效');
  const digest=fingerprint([...results].sort((a,b)=>a.callId.localeCompare(b.callId)));
  if(task.status==='cancelled'||task.status==='unknown'||task.status==='blocked')throw Object.assign(Error('子任务已取消、执行结果未知或配置已变化，禁止重放'),{code:'delegation_resume_blocked',status:409});
  if(task.resumes.has(digest))return watch(signal,sessionId,task.resumes.get(digest));
  const accepted=task.checkpoint?.receiptLedger?.find(entry=>entry.hash===digest);
  if(accepted?.response&&task.status!=='unknown'&&task.status!=='blocked')return Promise.resolve({...snapshot(task),status:accepted.response.limitReached?'limited':accepted.response.done?'completed':'waiting',response:structuredClone(accepted.response)});
  if(task.status==='unknown'||task.status==='blocked')throw Object.assign(Error('子任务执行结果未知或配置已变化，禁止重放'),{code:'delegation_resume_blocked',status:409});
  const saved=accepted&&!accepted.response&&task.checkpoint?.status==='receipts_saved';
  const queued=task.status==='queued'&&task.operation?.kind==='resume'&&!task.dispatched;
  if(!saved&&!queued&&task.status!=='waiting'||!task.workerId)throw Error('子任务当前不等待工具结果');
  if(queued&&fingerprint(task.operation.results)!==fingerprint(results))throw Error('子任务当前不等待此工具结果：已排队回执不匹配');
  const expected=task.response.calls.map(call=>call.callId);
  if(!saved&&(new Set(results.map(item=>item.callId)).size!==results.length||results.length!==expected.length||results.some(item=>!expected.includes(item.callId))))throw Error('子任务工具结果与待执行调用不匹配');
  // Use the runtime's pure validation before scheduling: rejected media must
  // not consume a model turn, poison an idempotency key or terminate the child.
  if(!saved)toolOutputs(results,task.response.calls);
  const fixed=structuredClone(results),promise=perform(batch,task,async()=>{binding(sessionId,callId);task.worker=await workerFor(parent,batch,task);return task.worker.resume(task.workerId,fixed,task.controller.signal);},parent,{kind:'resume',results:fixed});task.resumes.set(digest,promise);
  return watch(signal,sessionId,promise);
 }
 function read({sessionId,callId,taskId}){
  const {definitions,batch}=binding(sessionId,callId,true),definition=definitions.find(task=>task.id===taskId);
  if(!definition)throw Error('子任务 ID 与委派批次不匹配');
  const task=batch?.tasks.get(taskId);
  if(task&&(task.started||terminal.has(task.status)))return {...snapshot(task),started:task.started};
  return structuredClone({taskId:definition.id,title:definition.title,dependsOn:definition.dependsOn||[],status:'not_started',started:false});
 }
 function settle({sessionId,callId}){
  const {batch}=binding(sessionId,callId,true);
  if(!batch||[...batch.tasks.values()].some(task=>!terminal.has(task.status)))throw Error('委派子任务尚未全部结束');
  const tasks=[...batch.tasks.values()].map(task=>({taskId:task.definition.id,title:task.definition.title,dependsOn:task.definition.dependsOn||[],status:task.status,...(task.response?{response:{text:String(task.response.text||'').slice(0,20000)}}:{}),...(task.error?{error:task.error}:{}),...(task.blockedBy?{blockedBy:task.blockedBy}:{})}));
  const completed=tasks.filter(task=>task.status==='completed').length,status=completed===tasks.length?'completed':completed?'partial_failure':tasks.every(task=>['cancelled','skipped'].includes(task.status))?'cancelled':'failed';
  return structuredClone({status,tasks});
 }
 function ensurePending(parent){
  for(const call of parent.pending||[])if(call.name==='agent_delegate'){
   const definitions=taskDefinitions(call);let record=parents.get(parent.id);
   if(!record){record={parent,batches:new Map()};parents.set(parent.id,record);}
   if(record.batches.has(call.callId))continue;
   if(record.batches.size>=2)throw Error('父会话已达到两批委派预算');
   const batch={callId:call.callId,fingerprint:fingerprint(definitions),tasks:new Map(definitions.map(definition=>[definition.id,{definition:structuredClone(definition),status:'queued',controller:new AbortController(),started:false,resumes:new Map()}]))};
   batch.abort=()=>cancelCall(parent.id,call.callId);parent.controller.signal.addEventListener('abort',batch.abort,{once:true});record.batches.set(call.callId,batch);
  }
 }
 function checkpoint(sessionId){
  const record=parents.get(sessionId);if(!record)return undefined;
  return structuredClone({version:1,batches:[...record.batches.values()].map(batch=>({callId:batch.callId,fingerprint:batch.fingerprint,tasks:[...batch.tasks.values()].map(task=>({definition:task.definition,status:task.status,started:task.started,...(task.response?{response:task.response}:{}),...(task.error?{error:task.error}:{}),...(task.blockedBy?{blockedBy:task.blockedBy}:{}),...(task.workerId?{workerId:task.workerId}:{}),...(task.checkpoint?{checkpoint:task.checkpoint}:{}),...(task.operation?{operation:task.operation,dispatched:!!task.dispatched}:{})}))}))});
 }
 async function workerFor(parent,batch,task){
  if(closed)throw Error('Agent runtime 已关闭');
  if(task.worker){await task.worker.ready;if(closed)throw Error('Agent runtime 已关闭');return task.worker;}
  const store={ready:Promise.resolve(),list:async()=>task.checkpoint?[structuredClone(task.checkpoint)]:[],put:async record=>{
   const previous=task.checkpoint,previousId=task.workerId;task.checkpoint=structuredClone(record);task.workerId=record.id;
   try{await save(parent);}catch(error){task.checkpoint=previous;task.workerId=previousId;throw error;}
  }};
  task.worker=await createWorker(parent,structuredClone(task.definition),prerequisiteResults(batch,task),store);
  if(closed){await task.worker?.close?.();throw Error('Agent runtime 已关闭');}
  await task.worker?.ready;if(closed){await task.worker?.close?.();throw Error('Agent runtime 已关闭');}return task.worker;
 }
 function corrupt(){throw Object.assign(Error('子 Agent 检查点关联无效，未恢复执行'),{code:'agent_checkpoint_invalid',status:503});}
 async function restore(parent,evidence){
  if(!evidence)return;
  if(evidence.version!==1||!Array.isArray(evidence.batches)||evidence.batches.length>2)corrupt();
  const record={parent,batches:new Map()};parents.set(parent.id,record);
  for(const saved of evidence.batches){
   if(typeof saved.callId!=='string'||record.batches.has(saved.callId))corrupt();
   const original=parent.input.filter(item=>item.type==='function_call'&&item.call_id===saved.callId);
   if(original.length!==1||original[0].name!=='agent_delegate')corrupt();
   let definitions;try{definitions=taskDefinitions({args:parse('agent_delegate',original[0].arguments).args});}catch{corrupt();}
   if(saved.fingerprint!==fingerprint(definitions)||!Array.isArray(saved.tasks)||saved.tasks.length!==definitions.length)corrupt();
   const batch={callId:saved.callId,fingerprint:saved.fingerprint,tasks:new Map()};record.batches.set(saved.callId,batch);
   for(let i=0;i<definitions.length;i++){
    const item=saved.tasks[i];if(!item||canonical(item.definition)!==canonical(definitions[i])||typeof item.started!=='boolean'||!['queued','running','waiting','completed','failed','cancelled','limited','skipped','unknown','blocked'].includes(item.status)||item.error!==undefined&&typeof item.error!=='string'||item.blockedBy!==undefined&&(!Array.isArray(item.blockedBy)||item.blockedBy.some(id=>!definitions[i].dependsOn?.includes(id))))corrupt();
    if(!item.started&&(item.checkpoint||item.workerId||item.response||!['queued','skipped','cancelled'].includes(item.status)))corrupt();
    if(item.operation&&(!item.operation||typeof item.operation!=='object'||!['start','resume'].includes(item.operation.kind)||typeof item.dispatched!=='boolean'||item.operation.kind==='resume'&&(!Array.isArray(item.operation.results)||!item.operation.results.length)))corrupt();
    if(item.checkpoint){
     if(item.workerId!==item.checkpoint.id||item.response&&canonical(item.response)!==canonical(item.checkpoint.lastResponse)&&!item.operation||item.checkpoint.budgets?.maxRounds!==6||item.checkpoint.budgets?.maxOutputTokens!==2500||item.checkpoint.budgets?.maxContextChars!==160000||item.checkpoint.model!==parent.model||canonical(item.checkpoint.reasoning??null)!==canonical(parent.reasoning??null)||item.checkpoint.userMessage!==item.definition.title+'\n'+item.definition.instructions)corrupt();
     if(['completed','limited'].includes(item.status)&&(item.checkpoint.status!=='completed'||!item.checkpoint.lastResponse?.done||!!item.checkpoint.lastResponse.limitReached!==(item.status==='limited')))corrupt();
     if(item.status==='waiting'&&item.checkpoint.status!=='waiting_tools')corrupt();

    }else if(item.response||item.workerId||['waiting','completed','limited'].includes(item.status))corrupt();
    if(item.status==='skipped'&&(!item.blockedBy?.length||new Set(item.blockedBy).size!==item.blockedBy.length))corrupt();
    const task={...structuredClone(item),controller:new AbortController(),resumes:new Map()};batch.tasks.set(task.definition.id,task);
   }
   for(const task of batch.tasks.values()){
    if(task.blockedBy?.some(id=>!terminal.has(batch.tasks.get(id).status)||batch.tasks.get(id).status==='completed'))corrupt();
    if(task.started&&!['skipped','cancelled'].includes(task.status)&&prerequisites(batch,task).some(dependency=>dependency.status!=='completed'))corrupt();
    if(task.checkpoint){
     const worker=await workerFor(parent,batch,task),state=worker.state(task.workerId);
     if(!state)corrupt();
     if(!terminal.has(task.status)&&task.status!=='unknown'){
      if(state.status==='blocked'){task.status='blocked';task.error=state.reason;}
      else if(state.status==='unknown'){task.status='unknown';task.error=state.reason;}
      else if(state.status==='completed'){task.response=structuredClone(state.lastResponse);task.status=state.lastResponse.limitReached?'limited':'completed';delete task.operation;delete task.dispatched;}
      else if(state.status==='waiting_tools'){task.response=structuredClone(state.lastResponse);task.status=task.operation&&!task.dispatched?'queued':'waiting';if(task.status==='waiting'){delete task.operation;delete task.dispatched;}}
      else if(['planned','receipts_saved'].includes(state.status)){task.status='queued';task.dispatched=false;task.operation=state.status==='planned'?{kind:'start'}:task.operation;if(!task.operation)corrupt();}
      else if(['failed','cancelled'].includes(state.status)){task.status=state.status;task.error=state.reason;}
      else corrupt();
     }
    }else if(task.started&&!(task.operation&&!task.dispatched)){task.status='unknown';task.error='request_outcome_unknown';}
   }
   propagateSkipped(batch);batch.abort=()=>cancelCall(parent.id,batch.callId);if(!parent.done)parent.controller.signal.addEventListener('abort',batch.abort,{once:true});
  }
  const pending=(parent.pending||[]).find(call=>call.name==='agent_delegate');if(pending&&!record.batches.has(pending.callId))corrupt();
 }
 function safeError(task){return task.status==='skipped'?'前序子任务未成功完成：'+task.blockedBy.join('、'):task.status==='unknown'?'子任务执行结果未确认，禁止自动重放':task.status==='blocked'?'子任务配置已变化，无法安全续轮':task.status==='cancelled'?'父会话或委派请求已停止':task.status==='limited'?'子 Agent 已达到执行预算':'子 Agent 执行失败';}
 function summary(parent){
  const call=parent.pending?.find(call=>call.name==='agent_delegate'),batch=call&&parents.get(parent.id)?.batches.get(call.callId);if(!batch)return undefined;
  return {callId:call.callId,tasks:[...batch.tasks.values()].map(task=>({taskId:task.definition.id,title:task.definition.title,dependsOn:task.definition.dependsOn||[],status:task.started||terminal.has(task.status)?task.status:'not_started',started:task.started,...(task.blockedBy?{blockedBy:[...task.blockedBy]}:{}),...(task.error?{error:safeError(task)}:{})}))};
 }
 async function close(){
  closed=true;
  const workers=[];for(const record of parents.values())for(const batch of record.batches.values()){
   record.parent.controller.signal.removeEventListener('abort',batch.abort);
   for(const task of batch.tasks.values()){if(task.worker?.close)workers.push(Promise.resolve().then(()=>task.worker.close()));}
  }
  const failures=(await Promise.allSettled(workers)).filter(result=>result.status==='rejected').map(result=>result.reason);
  for(const record of parents.values()){
   for(const batch of record.batches.values())for(const task of batch.tasks.values()){
    if(task.worker&&task.workerId&&!terminal.has(task.status)&&task.status!=='unknown'){
     const state=task.worker.state(task.workerId);
     if(state?.status==='unknown'){task.status='unknown';task.error=state.reason;}
     else if(['planned','receipts_saved'].includes(state?.status)){task.status='queued';task.dispatched=false;}
     else if(state?.status==='waiting_tools'){task.status='waiting';task.response=structuredClone(state.lastResponse);delete task.operation;delete task.dispatched;}
    }
    if(!task.worker&&task.status==='running'){task.status='unknown';task.error='request_outcome_unknown';}
    task.finish?.();
   }
   try{await save(record.parent);}catch(error){failures.push(error);}
  }
  if(failures.length)throw failures[0];
 }
 function prune(){if(closed)return;for(const [id,record]of parents){const live=getParent(id);if(live!==record.parent||live.done||live.controller.signal.aborted){cancelParent(id);parents.delete(id);}}}
 return {start,resume,read,settle,cancelCall,cancelParent,prune,ensurePending,checkpoint,restore,summary,close};
}
module.exports={createDelegationManager};
