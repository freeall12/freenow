// Only this opt-in QA document loads the fixed local HTTP simulation. It never
// forwards Agent/task requests or reuses production browser storage.
(() => {
 const query=new URLSearchParams(location.search),session=query.get('session')||'manual';
 const prefix='qa-agent-recovery:'+session+':',read=Storage.prototype.getItem,write=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
 Storage.prototype.getItem=function(key){return read.call(this,prefix+key);};
 Storage.prototype.setItem=function(key,value){return write.call(this,prefix+key,value);};
 Storage.prototype.removeItem=function(key){return remove.call(this,prefix+key);};
 window.CANVAS_DB_NAME='tapnow-agent-recovery-qa-'+session;window.LOCAL_ASSETS_DB_NAME='tapnow-agent-recovery-assets-qa-'+session;
 const nativeFetch=window.fetch.bind(window),key='fixture-state';
 const saved=()=>JSON.parse(sessionStorage.getItem(key)||JSON.stringify({mode:query.get('mode')||'waiting_tools',requests:[],runs:{}}));
 const commit=value=>{sessionStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('qa-recovery:state'));};
 const call=(id,title,x)=>({callId:id,name:'canvas_add',args:{type:'text',title,x,y:100,content:'固定本地响应的真实画布节点',textMode:'pure'},mutates:true});
 const delegationCall=id=>({callId:id+'-delegate',name:'agent_delegate',mutates:false,args:{tasks:[
  {id:'qa-plan',title:'QA 模拟 · 原始规划',instructions:'固定本地隔离验收：输出模拟规划正文，不执行任何画布操作。',dependsOn:[]},
  {id:'qa-review',title:'QA 模拟 · 依赖复核',instructions:'固定本地隔离验收：复核模拟规划，不连接真实模型。',dependsOn:['qa-plan']}
 ]}});
 const terminalAggregate=run=>({status:'completed',tasks:run.pending[0].args.tasks.map(task=>({taskId:task.id,title:task.title,dependsOn:task.dependsOn,status:'completed',response:{text:task.id==='qa-plan'?'【QA 固定模拟正文 · 非真实模型】规划：只核对原父调用的恢复流程；不创建任何媒体或画布节点。':'【QA 固定模拟正文 · 非真实模型】复核：已读取模拟规划，恢复应保留原父调用 ID，并且不重发子任务。'}}))});
 const json=value=>Response.json(value),stream=events=>new Response(events.map(event=>JSON.stringify(event)+'\n').join(''),{headers:{'content-type':'application/x-ndjson'}});
 window.AgentRecoveryFixture={state:saved,setMode(mode){const state=saved();state.mode=mode;commit(state);}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),path=url.pathname;
  if(path==='/api/agent/config')return json({configured:true,model:'固定本地验收响应'});
  if(path.startsWith('/api/generation/'))return json(path.endsWith('/tasks')?[]:{configured:false,missing:['隔离验收不连接生成服务']});
  if(!['/api/agent/turn','/api/agent/continue','/api/agent/state','/api/agent/cancel','/api/agent/delegated-start','/api/agent/delegated-state','/api/agent/delegated-continue','/api/agent/delegated-result'].includes(path))return nativeFetch(input,options);
  const body=JSON.parse(options.body||'{}'),state=saved();state.requests.push({path,sessionId:body.sessionId||null,callIds:(body.results||[]).map(item=>item.callId),...(body.callId?{parentCallId:body.callId}:{}),...(body.taskId?{taskId:body.taskId}:{})});
  if(path.endsWith('/turn')){
   const id='qa-recovery-'+crypto.randomUUID(),mode=state.mode,first=mode==='terminal_delegation'?delegationCall(id):call(id+'-old','QA 原调用 · 仅一次',100);
   const run={id,binding:body.binding,round:mode==='planned'?0:1,status:mode==='planned'?'planned':'waiting_tools',pending:mode==='planned'?[]:[first],mode,continues:0};state.runs[id]=run;commit(state);
   if(mode==='planned'||mode==='missing_receipts')return stream([{type:'session',sessionId:id,round:run.round},{type:'error',error:'固定本地夹具：模拟回包中断，未自动继续',code:'qa_interruption'}]);
   if(mode==='terminal_delegation')return json({sessionId:id,round:1,done:false,text:'【QA 固定本地模拟 · 非真实模型】发出原父委派调用；执行通道将中断，须核对后显式继续。',calls:[first]});
   return json({sessionId:id,round:1,done:false,text:'固定本地响应：先创建一个验收文本节点。',calls:[first]});
  }
  const run=state.runs[body.sessionId];
  const delegated=path.includes('/delegated-');
  if(!run||(!delegated||body.binding!==undefined)&&JSON.stringify(run.binding)!==JSON.stringify(body.binding)||delegated&&(run.mode!=='terminal_delegation'||body.callId!==run.pending[0]?.callId)){
   commit(state);return new Response(JSON.stringify({error:'隔离任务绑定或原父调用不匹配'}),{status:409,headers:{'content-type':'application/json'}});
  }
  if(delegated){
   if(path.endsWith('/delegated-start')){
    if(!run.pending[0].args.tasks.some(task=>task.id===body.taskId)||run.channelInterrupted){commit(state);return json({error:'QA 禁止重复派发原子任务',code:'qa_delegation_replayed'});}
    // Only the simulated HTTP service record changes. Production frontend code
    // has already persisted the original pending journal before this request.
    run.aggregate=terminalAggregate(run);run.channelInterrupted=true;commit(state);
    throw new DOMException('QA 固定模拟：委派执行通道中断；没有父工具回执，须核对后显式继续','AbortError');
   }
   commit(state);
   if(path.endsWith('/delegated-result'))return run.aggregate?json(run.aggregate):new Response(JSON.stringify({error:'QA 模拟委派尚未终结'}),{status:409,headers:{'content-type':'application/json'}});
   if(path.endsWith('/delegated-state')){const task=run.aggregate?.tasks.find(task=>task.taskId===body.taskId);return task?json({...task,started:true}):json({taskId:body.taskId,status:'not_started',started:false});}
   return new Response(JSON.stringify({error:'QA 终态恢复不接受子任务续轮'}),{status:409,headers:{'content-type':'application/json'}});
  }
  if(path.endsWith('/state')){commit(state);return json({sessionId:run.id,binding:run.binding,status:run.status,round:run.round,done:run.status==='completed',restored:true,canResumeWithReceipts:['planned','waiting_tools','receipts_saved'].includes(run.status),pending:run.pending.map(({callId,name})=>({callId,name})),text:run.status==='completed'?'固定验收任务完成。':'',...(run.aggregate&&run.pending.length?{delegation:{callId:run.pending[0].callId,tasks:run.aggregate.tasks.map(({response,...task})=>({...task,started:true}))}}:{}),...(run.status==='unknown'?{reason:'request_outcome_unknown'}:{})});}
  if(path.endsWith('/cancel')){run.status='cancelled';run.pending=[];commit(state);return json({cancelled:true});}
  run.continues++;
  if(run.mode==='terminal_delegation'){
   if(!run.aggregate||body.results?.length!==1||body.results[0].callId!==run.pending[0]?.callId||JSON.stringify(body.results[0].result)!==JSON.stringify(run.aggregate)){
    commit(state);return new Response(JSON.stringify({error:'QA 继续必须携带原父调用的完整模拟终态回执'}),{status:409,headers:{'content-type':'application/json'}});
   }
   run.round=2;run.status='completed';run.pending=[];commit(state);
   return json({sessionId:run.id,round:2,done:true,text:'【QA 固定模拟完成 · 非真实模型】已保留两项完整模拟正文，并通过原父调用显式继续；没有重跑子任务或创建媒体。',calls:[]});
  }
  if(run.continues===1&&run.mode!=='planned'){
   run.firstResults=JSON.stringify(body.results);
   if(run.mode==='receipts_saved'){run.status='receipts_saved';run.pending=[];}
   if(run.mode==='unknown')run.status='unknown';commit(state);
   throw new TypeError('固定本地夹具：模拟continue请求断线，服务端状态需手动核对');
  }
  if(run.firstResults&&run.round===1&&JSON.stringify(body.results)!==run.firstResults)return new Response(JSON.stringify({error:'原回执被改变，隔离夹具拒绝继续'}),{status:409,headers:{'content-type':'application/json'}});
  if(run.mode==='stale'&&run.round===1){commit(state);return json({sessionId:run.id,round:1,done:false,text:'固定旧回包，应被客户端拒绝。',calls:[call(run.id+'-old','QA 原调用 · 仅一次',100)]});}
  if(run.round<2){run.round=2;run.status='waiting_tools';run.pending=[call(run.id+'-new','QA 后续新调用',420)];commit(state);return json({sessionId:run.id,round:2,done:false,text:'固定本地响应：原调用不再执行，仅新增下一轮调用。',calls:run.pending});}
  run.round=3;run.status='completed';run.pending=[];commit(state);return json({sessionId:run.id,round:3,done:true,text:'固定本地验收完成：原调用最多一次，后续调用最多一次。',calls:[]});
 };
})();
