// Isolation and fault switches only. Agent, segmentation and save responses
// come from real HTTP/native/client paths; there are no synthetic task DTOs.
(()=>{
 const query=new URLSearchParams(location.search),prefix='qa-agent-segmentation:'+encodeURIComponent(query.get('session')||crypto.randomUUID())+':';
 const storage=window.localStorage,originalFetch=window.fetch.bind(window),dbOpen=indexedDB.open.bind(indexedDB);
 const state=window.AgentSegmentationFixture={prefix,ready:false,failSave:false,requests:[],dispatches:[],errors:[],sourceReads:0,assetPuts:[],sendState:'idle',agentTurnPosts:0};
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key),key:index=>Object.keys(storage).filter(key=>key.startsWith(prefix))[index]?.slice(prefix.length)??null,get length(){return Object.keys(storage).filter(key=>key.startsWith(prefix)).length;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;return version===undefined?dbOpen(name):dbOpen(name,version);};
 if(query.has('auto'))localStorage.setItem('tapnow-agent-confirm-mode','auto');
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('Agent SAM2 QA blocks external browser requests.');
  state.requests.push({path:url.protocol==='data:'?'data:local':url.protocol==='blob:'?'blob:local':url.pathname,method});
  if(url.pathname==='/api/agent/turn'&&method==='POST'){state.agentTurnPosts++;state.sendState='sending';}
  if(url.pathname==='/qa/sam2-source.mp4')state.sourceReads++;
  if(url.pathname==='/api/video-segmentation/tasks'&&method==='POST'){
   const id=new Headers(options.headers).get('Idempotency-Key'),record=await window.CanvasStore.readRecord('agent-conversations:'+(window.CanvasProjects?.id()||'canvas'));
   const trace=record?.chats?.flatMap(chat=>chat.messages||[]).find(trace=>trace.name==='video_segment_target'&&trace.submittedTaskId===id&&trace.segmentationTask?.id===id);
   state.dispatches.push({id,acknowledged:!!trace,checkpointStatus:trace?.segmentationTask?.status});
   if(!trace||trace.segmentationTask.status!=='unknown')throw Error('Actual persisted Agent trace is missing before SAM2 POST.');
  }
  try{return await originalFetch(input,options);}catch(error){state.errors.push({path:url.pathname,error:error.message});throw error;}
 };
 state.ready=true;
})();
