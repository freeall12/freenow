// Opt-in browser fixture: fixed Agent responses and real locally decoded clips.
// No Agent/generation request is forwarded to a remote model.
(() => {
 const query=new URLSearchParams(location.search),session=query.get('session')||'manual';
 const prefix='qa-agent-video-analysis:'+session+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>{try{storage.setItem(prefix+k,String(v));}catch(error){console.warn("QA storage write failed",error.name);throw error;}},removeItem:k=>storage.removeItem(prefix+k)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const state={configured:query.get('configured')!=='false',repeat:query.has('repeat'),posts:[],turns:0,continues:0,mediaReads:0,runs:new Map()};
 const changed=()=>window.dispatchEvent(new Event('qa-agent-analysis:change'));
 window.AgentVideoAnalysisFixture={state,setConfigured(value){state.configured=value;changed();}};
 const json=value=>Response.json(value),call=(id,number)=>({callId:id+'-call-'+number,name:'video_analyze',args:{operationId:'qa-analysis-'+session,nodeId:'analysis-source'},mutates:true});
 window.fetch=async(input,options={})=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
  if(typeof target!=='string')throw TypeError('隔离验收不支持此请求地址');
  const url=new URL(target,location.href),path=decodeURIComponent(url.pathname);
  if(url.origin!==location.origin)throw Error('隔离验收禁止外部请求');
  if(path==='/qa/trim-scenes.mp4'){state.mediaReads++;changed();return nativeFetch(input,options);}
  if(path==='/api/agent/config')return json({configured:true,model:'固定本地验收响应'});
  if(path==='/api/generation/config')return json({configured:state.configured,protocol:'openai-native',missing:state.configured?[]:['GENERATION_API_KEY'],capabilities:{videoAnalysis:{'video.analyze':{kind:'video.analyze',operation:'film_scene_breakdown',transport:'inline',maxVideos:1}}}});
  if(path==='/api/generation/tasks'||path.startsWith('/api/generation/tasks/')){
   if(options.method!=='POST')return json({status:'cancelled'});
   const request=JSON.parse(options.body),headers=new Headers(options.headers),id=headers.get('Idempotency-Key');
   const record=window.CanvasStore?.readRecord?await window.CanvasStore.readRecord('agent-conversations:'+(window.CanvasProjects?.id()||'canvas')):null;
   const chats=window.CanvasStore?.readRecord?(record?.chats||[]):JSON.parse(localStorage.getItem('tapnow-agent-chats')||'[]');
   const acknowledged=chats.some(chat=>chat.messages?.some(trace=>trace.name==='video_analyze'&&trace.submittedTaskId===id));
   if(!state.configured||request.kind!=='video.analyze'||!request.inputs[0].url.startsWith('data:video/mp4;base64,')||!acknowledged)throw Error('验收失败：配置、视频或持久回执缺失');
   state.posts.push({id,acknowledged,kind:request.kind,source:request.nodeId});changed();
   const result=await nativeFetch('/qa/video-analysis-native-result.json').then(r=>r.json());
   return json({id,status:'succeeded',outputs:result.outputs});
  }
  if(path==='/api/agent/turn'){
   state.turns++;const body=JSON.parse(options.body),id='qa-agent-analysis-'+crypto.randomUUID();state.runs.set(id,{binding:body.binding,round:1});changed();
   return json({sessionId:id,round:1,done:false,text:'固定本地验收：解析合成测试片，生成三个真实裁片。描述文字使用固定夹具，未调用模型。',calls:[call(id,1)]});
  }
  if(path==='/api/agent/continue'){
   const body=JSON.parse(options.body),run=state.runs.get(body.sessionId);if(!run||JSON.stringify(run.binding)!==JSON.stringify(body.binding))throw Error('隔离验收会话绑定不匹配');
   state.continues++;run.round++;changed();
   if(state.repeat&&run.round===2)return json({sessionId:body.sessionId,round:run.round,done:false,text:'固定验收：使用相同 operationId 再查询一次，不应重复派发。',calls:[call(body.sessionId,2)]});
   return json({sessionId:body.sessionId,round:run.round,done:true,text:'固定验收已收到工具回执；解析和画布应用状态以执行卡为准。',calls:[]});
  }
  if(path==='/api/agent/cancel')return json({cancelled:true});
  // Same-origin API routes may proxy to configured remote providers. Reject
  // anything outside the fixed fixture above rather than forwarding it.
  if(path==='/api'||path.startsWith('/api/'))throw Error('隔离验收不支持此 API 路由');
  return nativeFetch(input,options);
 };
})();
