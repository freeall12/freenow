(()=>{
 const query=new URLSearchParams(location.search),mode=['native','delayed','normal'].includes(query.get('mode'))?query.get('mode'):'unconfigured',session=query.get('session')||crypto.randomUUID(),prefix='qa-video-extension:'+session+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key),key:i=>Object.keys(storage).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length)??null,get length(){return Object.keys(storage).filter(k=>k.startsWith(prefix)).length;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 const open=indexedDB.open.bind(indexedDB),dbNames=new Set();indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbNames.add(name);return version===undefined?open(name):open(name,version);};
 const state=window.ExtensionFixture={mode,session,prefix,posts:0,trimCalls:0,mediaPrepares:0,localMediaReads:0,blockedAPI:0,blockedExternal:0,configCalls:0,configResolved:0,pendingConfigs:0,armDelay:false,holdResult:false,resultReady:true,taskGets:0,failApply:false,applyFailures:0,failSave:false,saveFailures:0,explicitSaves:0,dbNames:()=>[...dbNames]},releases=new Set();
 state.release=()=>{for(const release of releases)release();};
 state.releaseResult=()=>{state.resultReady=true;};
 const profile={ratios:['adaptive'],durations:Array.from({length:27},(_,index)=>index+4),resolutions:['720p','1080p'],audio:true,maxImages:4,maxVideos:4,maxAudios:2,videoDurationRange:{min:2,max:30,totalMax:30},audioDurationRange:{min:2,max:30,totalMax:30}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),pathname=url.pathname,method=options.method??input?.method??'GET';
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.blockedExternal++;throw Error('视频延长隔离验收禁止外部请求');}
  if(pathname==='/api/generation/config'){
   state.configCalls++;
   if(mode==='delayed'&&state.armDelay){state.armDelay=false;state.pendingConfigs++;await new Promise(resolve=>{const release=()=>{releases.delete(release);state.pendingConfigs--;resolve();};releases.add(release);});}
   state.configResolved++;
   if(['delayed','normal'].includes(mode))return Response.json({configured:true,protocol:'tasks-v1',capabilities:{kinds:['video.extend']}});
   return Response.json({configured:mode==='native',protocol:'ark-video-extend-reference',missing:mode==='unconfigured'?['GENERATION_API_KEY']:[],capabilities:{kinds:['video.extend'],models:{'seedance-2.5':{kind:'video.extend'}},videoExtend:{models:{'seedance-2.5':{resolution:'720p',generateAudio:true,profile}}}}});
  }
  if(pathname==='/api/agent/config')return Response.json({configured:false});
  // Synthetic receipt/output only. Bytes are a distinct tracked QA MP4; this
  // tests lifecycle and result application, never a model continuation effect.
  const result=()=>({id:'synthetic-extension-'+state.posts,status:'succeeded',outputs:[{type:'video',url:window.ExtensionFixtureOutput,title:'合成应用结果 · 非模型延长效果'}]});
  if(pathname==='/api/generation/tasks'&&method==='POST'){
   state.posts++;if(!['delayed','normal'].includes(mode))throw Error('本地 Ark 前置限制应在提交之前发现');
   state.resultReady=!state.holdResult;return Response.json(state.resultReady?result():{id:'synthetic-extension-'+state.posts,status:'running',progress:30});
  }
  if(/^\/api\/generation\/tasks\/synthetic-extension-\d+$/.test(pathname)&&method==='GET'){state.taskGets++;return Response.json(state.resultReady?result():{id:pathname.split('/').pop(),status:'running',progress:30});}
  if(pathname==='/api/media/trim'){state.trimCalls++;throw Error('夹具不允许裁片');}
  if(pathname.startsWith('/api/')){state.blockedAPI++;throw Error('视频延长隔离验收禁止其他 API');}
  if(pathname==='/qa/trim-scenes.mp4')state.localMediaReads++;
  return nativeFetch(input,options);
 };
})();
