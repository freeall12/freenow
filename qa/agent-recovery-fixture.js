// Only this opt-in QA document loads the fixed local HTTP simulation. It never
// forwards Agent/task requests or reuses production browser storage.
(() => {
 const session=new URLSearchParams(location.search).get('session')||'manual';
 const prefix='qa-agent-recovery:'+session+':',read=Storage.prototype.getItem,write=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
 Storage.prototype.getItem=function(key){return read.call(this,prefix+key);};
 Storage.prototype.setItem=function(key,value){return write.call(this,prefix+key,value);};
 Storage.prototype.removeItem=function(key){return remove.call(this,prefix+key);};
 window.CANVAS_DB_NAME='tapnow-agent-recovery-qa-'+session;window.LOCAL_ASSETS_DB_NAME='tapnow-agent-recovery-assets-qa-'+session;
 const nativeFetch=window.fetch.bind(window),key='fixture-state';
 const saved=()=>JSON.parse(sessionStorage.getItem(key)||'{"mode":"waiting_tools","requests":[],"runs":{}}');
 const commit=value=>{sessionStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('qa-recovery:state'));};
 const call=(id,title,x)=>({callId:id,name:'canvas_add',args:{type:'text',title,x,y:100,content:'固定本地响应的真实画布节点',textMode:'pure'},mutates:true});
 const json=value=>Response.json(value),stream=events=>new Response(events.map(event=>JSON.stringify(event)+'\n').join(''),{headers:{'content-type':'application/x-ndjson'}});
 window.AgentRecoveryFixture={state:saved,setMode(mode){const state=saved();state.mode=mode;commit(state);}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),path=url.pathname;
  if(path==='/api/agent/config')return json({configured:true,model:'固定本地验收响应'});
  if(path.startsWith('/api/generation/'))return json(path.endsWith('/tasks')?[]:{configured:false,missing:['隔离验收不连接生成服务']});
  if(!['/api/agent/turn','/api/agent/continue','/api/agent/state','/api/agent/cancel'].includes(path))return nativeFetch(input,options);
  const body=JSON.parse(options.body||'{}'),state=saved();state.requests.push({path,sessionId:body.sessionId||null,callIds:(body.results||[]).map(item=>item.callId)});
  if(path.endsWith('/turn')){
   const id='qa-recovery-'+crypto.randomUUID(),first=call(id+'-old','QA 原调用 · 仅一次',100),mode=state.mode;
   const run={id,binding:body.binding,round:mode==='planned'?0:1,status:mode==='planned'?'planned':'waiting_tools',pending:mode==='planned'?[]:[first],mode,continues:0};state.runs[id]=run;commit(state);
   if(mode==='planned'||mode==='missing_receipts')return stream([{type:'session',sessionId:id,round:run.round},{type:'error',error:'固定本地夹具：模拟回包中断，未自动继续',code:'qa_interruption'}]);
   return json({sessionId:id,round:1,done:false,text:'固定本地响应：先创建一个验收文本节点。',calls:[first]});
  }
  const run=state.runs[body.sessionId];
  if(!run||JSON.stringify(run.binding)!==JSON.stringify(body.binding))return new Response(JSON.stringify({error:'隔离任务绑定不匹配'}),{status:409,headers:{'content-type':'application/json'}});
  if(path.endsWith('/state')){commit(state);return json({sessionId:run.id,binding:run.binding,status:run.status,round:run.round,done:run.status==='completed',restored:true,canResumeWithReceipts:['planned','waiting_tools','receipts_saved'].includes(run.status),pending:run.pending.map(({callId,name})=>({callId,name})),text:run.status==='completed'?'固定验收任务完成。':'',...(run.status==='unknown'?{reason:'request_outcome_unknown'}:{})});}
  if(path.endsWith('/cancel')){run.status='cancelled';run.pending=[];commit(state);return json({cancelled:true});}
  run.continues++;
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
