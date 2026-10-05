// Local fixed bytes exercise production preparation and storage, not model depth.
(()=>{
 'use strict';const q=new URLSearchParams(location.search),session=/^[A-Za-z0-9_-]{1,80}$/.test(q.get('session')||'')?q.get('session'):crypto.randomUUID(),prefix='qa-video-depth:'+session+':',nativeFetch=window.fetch.bind(window),tasks=new Map(),dbNames=new Set();
 const state=window.VideoDepthFixture={session,prefix,mode:q.get('mode')||'native',ready:false,posts:0,configReads:0,mediaReads:0,mediaPrepares:0,blockedExternal:0,blockedAPI:0,requests:[],failSave:false,armDelay:false,pendingConfigs:0,errors:[],dbNames:()=>[...dbNames]};
 const profile={kind:'video.depth',model:'fal-ai/depth-anything-video',semantics:'per-frame-depth',tapNowEquivalent:false,sourceMimeTypes:['video/mp4'],audioPolicy:'discard',resolutions:['source'],colormaps:['grayscale'],preserveDuration:true,preserveDimensions:true,promptUsed:false,maxVideos:1,maxCount:1,maxSourceFrames:2400,maxInputBytes:33554432,maxOutputBytes:33554432,localMediaProfile:'mp4-cfr-even-square-pixels-5-30fps',maxWidth:1920,maxHeight:1080,minFps:5,maxFps:30,maxDuration:480};
 const configuration=()=>({configured:state.mode!=='unconfigured',protocol:'fal-video-depth-native',missing:state.mode==='unconfigured'?['GENERATION_API_KEY']:[],capabilities:{kinds:['video.depth'],models:{'depth-anything-video':{kind:'video.depth',model:'fal-ai/depth-anything-video'}},videoDepth:{'depth-anything-video':profile}}});
 let release;state.release=()=>release?.();
 try{
  const storage=window.localStorage;const keys=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix));Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k),clear:()=>keys().forEach(k=>storage.removeItem(k)),key:i=>keys()[i]?.slice(prefix.length)??null,get length(){return keys().length;}}});
  window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';const open=indexedDB.open.bind(indexedDB);indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbNames.add(name);return version===undefined?open(name):open(name,version);};state.ready=true;
 }catch(error){state.errors.push(error.message);Object.defineProperty(window,'fetch',{value:()=>Promise.reject(Error('QA isolation failed'))});document.write('<meta http-equiv="Content-Security-Policy" content="script-src &#39;none&#39;">');return;}
 const block=u=>{state.blockedAPI++;throw Error('隔离深度夹具禁止未声明 API：'+u.pathname);};
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(u.origin!==location.origin&&!['blob:','data:'].includes(u.protocol)){state.blockedExternal++;throw Error('隔离深度夹具禁止外部请求');}
  if(state.mode==='pipeline'&&u.pathname.startsWith('/api/generation/')){if(u.pathname==='/api/generation/config')state.configReads++;if(u.pathname==='/api/generation/tasks'&&method==='POST'){const r=JSON.parse(options.body);state.posts++;state.requests.push({kind:r.kind,targetId:r.nodeId,inputId:r.inputs?.[0]?.id,transport:r.inputs?.[0]?.url?.split(',')[0],bytes:r.inputs?.[0]?.url?.length,width:r.inputs?.[0]?.width,height:r.inputs?.[0]?.height,duration:r.inputs?.[0]?.duration,parameters:r.parameters});}return nativeFetch(input,options);}
  if(u.pathname==='/api/generation/config'){state.configReads++;if(state.armDelay){state.armDelay=false;state.pendingConfigs++;await new Promise(resolve=>{const timer=setTimeout(()=>state.release(),10000);release=()=>{clearTimeout(timer);release=null;state.pendingConfigs--;resolve();};});}return Response.json(configuration());}
  if(u.pathname==='/api/agent/config')return Response.json({configured:false});
  if(u.pathname==='/api/generation/tasks'&&method==='POST'){
   const r=JSON.parse(options.body),id=new Headers(options.headers).get('Idempotency-Key');if(!id||r.kind!=='video.depth'||r.inputs.length!==1||!r.inputs[0].url.startsWith('data:video/mp4;base64,')||r.inputs[0].width!==64||r.inputs[0].height!==48||r.inputs[0].duration!==2)throw Error('夹具需要实际完整MP4及原始尺寸时长');
   const raw=atob(r.inputs[0].url.split(',')[1]);if(raw.slice(4,8)!=='ftyp')throw Error('夹具来源并非实际MP4');state.posts++;state.requests.push({id,kind:r.kind,inputId:r.inputs[0].id,transport:'data:video/mp4',bytes:raw.length,width:64,height:48,duration:2,parameters:r.parameters});
   return Response.json({error:'隔离夹具禁止供应商提交，没有模拟成品',code:'fixture_blocked'},{status:403});
  }
  if(u.pathname.startsWith('/api/generation/tasks/')){const id=u.pathname.split('/').at(-1);return tasks.has(id)?Response.json(tasks.get(id)):Response.json({error:'无原任务'},{status:404});}
  if(u.pathname.startsWith('/api/'))return block(u);
  if(!state.ready)throw Error('QA storage isolation failed');if(['blob:','data:'].includes(u.protocol)||u.pathname.includes('/qa/media/'))state.mediaReads++;return nativeFetch(input,options);
 };
})();
