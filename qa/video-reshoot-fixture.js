// Synthetic configuration only; production GenerationAPI, TaskService and panel
// still execute. No API route is forwarded and no generation success is mocked.
(()=>{
 const q=new URLSearchParams(location.search),mode=['native','delayed'].includes(q.get('mode'))?q.get('mode'):'unconfigured',session=q.get('session')||crypto.randomUUID(),prefix='qa-video-reshoot:'+session+':',originalFetch=window.fetch.bind(window),storage=window.localStorage;
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k),key:i=>Object.keys(storage).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length)??null,get length(){return Object.keys(storage).filter(k=>k.startsWith(prefix)).length;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 const open=indexedDB.open.bind(indexedDB),dbNames=new Set();indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbNames.add(name);return version===undefined?open(name):open(name,version);};
 const state=window.ReshootFixture={mode,session,prefix,posts:0,trimCalls:0,mediaPrepares:0,localMediaReads:0,blockedAPI:0,blockedExternal:0,configCalls:0,configResolved:0,pendingConfigs:0,armDelay:false,dbNames:()=>[...dbNames]},releases=new Set();
 const profile={ratios:['adaptive'],durations:[-1],resolutions:['720p','1080p'],audio:true,maxImages:0,maxVideos:1,maxAudios:0,videoDurationRange:{min:4,max:30,totalMax:30},omniReferenceTaskType:'edit'};
 const native={configured:mode!=='unconfigured',protocol:'ark-video-reshoot-edit',missing:mode==='unconfigured'?['GENERATION_API_KEY']:[],capabilities:{kinds:['video.reshoot'],models:{'seedance-2.5':{kind:'video.reshoot'}},videoReshoot:{capabilityMode:'prompt_simulation',nativeCameraControl:false,exactUnchangedSegments:false,models:{'seedance-2.5':{resolution:'720p',generateAudio:true,profile}}}}};
 // A tasks-v1 readiness receipt permits the local source in delayed mode so
 // CUA can click the real submit button, then close during its second lookup.
 // It does not simulate tasks or outputs; any accidental POST still fails.
 const delayed={configured:true,protocol:'tasks-v1',capabilities:{kinds:['video.reshoot']}};
 state.release=()=>{for(const release of releases)release();};
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(u.origin!==location.origin&&!['blob:','data:'].includes(u.protocol)){state.blockedExternal++;throw Error('隔离重拍夹具禁止外部请求');}
  if(u.pathname==='/api/generation/config'){
   state.configCalls++;
   if(mode==='delayed'&&state.armDelay){state.armDelay=false;state.pendingConfigs++;await new Promise(resolve=>{let timer;const release=()=>{clearTimeout(timer);releases.delete(release);state.pendingConfigs--;resolve();};releases.add(release);timer=setTimeout(release,3000);});}
   state.configResolved++;return Response.json(mode==='delayed'?delayed:native);
  }
  if(u.pathname==='/api/agent/config')return Response.json({configured:false});
  if(u.pathname==='/api/generation/tasks'&&method==='POST'){state.posts++;throw Error('隔离夹具禁止模型提交，不返回模拟成功');}
  if(u.pathname==='/api/media/trim'){state.trimCalls++;throw Error('夹具不允许裁片');}
  if(u.pathname.startsWith('/api/')){state.blockedAPI++;throw Error('隔离夹具禁止其他 API');}
  if(u.pathname==='/qa/trim-scenes.mp4')state.localMediaReads++;
  return originalFetch(input,options);
 };
})();
