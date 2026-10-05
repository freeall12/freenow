// Production UI/TaskService with public synthetic media. No segmentation or
// generation success is mocked; all external requests fail closed.
(()=>{
 const q=new URLSearchParams(location.search),mode=['native','delayed','pipeline'].includes(q.get('mode'))?q.get('mode'):'unconfigured',session=q.get('session')||crypto.randomUUID(),prefix='qa-video-mask:'+session+':',originalFetch=window.fetch.bind(window),releases=new Set(),dbNames=new Set();
 const state=window.VideoMaskFixture={mode,session,prefix,ready:false,posts:0,segmentationPosts:0,mediaPrepares:0,localMediaReads:0,blockedAPI:0,blockedExternal:0,configCalls:0,pendingConfigs:0,armDelay:false,requests:[],dbNames:()=>[...dbNames]};
 const config={configured:mode!=='unconfigured',protocol:'fal-video-mask-native',missing:mode==='unconfigured'?['GENERATION_API_KEY']:[],capabilities:{kinds:['video.erase','video.replace'],models:{'video.erase':{kind:'video.erase'},'video.replace':{kind:'video.replace'}},videoMask:{semantics:'explicit-native-alternative',label:'Wan VACE 14B Inpainting',temporalMask:true,maskEncoding:'rle-zero-based-row-major',preservesSourceAudio:'local-remux',resolution:'720p',aspectRatio:'adaptive',maxCount:1,sourceFrames:{min:81,max:241},sourceFps:{min:5,max:30},maxFullMaskFrames:2400,maxSourceBytes:33554432,maxReferenceBytes:20971520,requiresExistingMask:true}}};
 state.release=()=>{for(const release of [...releases])release();};
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(u.origin!==location.origin&&!['blob:','data:'].includes(u.protocol)){state.blockedExternal++;throw Error('隔离视频蒙层夹具禁止外部请求');}
  if(mode==='pipeline'&&state.ready&&u.pathname.startsWith('/api/generation/')){if(u.pathname==='/api/generation/tasks'&&method==='POST')state.posts++;return originalFetch(input,options);}
  if(u.pathname==='/api/generation/config'){
   state.configCalls++;if(mode==='delayed'&&state.armDelay){state.armDelay=false;state.pendingConfigs++;await new Promise(resolve=>{let timer;const release=()=>{clearTimeout(timer);releases.delete(release);state.pendingConfigs--;resolve();};releases.add(release);timer=setTimeout(release,10000);});}
   return Response.json(state.ready?config:{configured:false,configurationError:'QA storage isolation failed'});
  }
  if(u.pathname==='/api/video-segmentation/config'||u.pathname==='/api/agent/config')return Response.json({configured:false});
  if(u.pathname==='/api/video-segmentation/segment'){state.segmentationPosts++;throw Error('没有真实分割服务；夹具不模拟识别成功');}
  if(u.pathname==='/api/generation/tasks'&&method==='POST'){
   state.posts++;const body=JSON.parse(options.body),r=body.request??body;state.requests.push({kind:r.kind,sourceClip:r.parameters?.sourceClip,maskFrames:r.parameters?.mask?.frames?.length,maskFps:r.parameters?.mask?.fps,inputs:r.inputs?.map(i=>({type:i.type,role:i.role,width:i.width,height:i.height,duration:i.duration,durationMs:i.durationMs,transport:i.url?.split(',')[0],bytes:i.url?.length}))});
   return Response.json({error:'隔离夹具禁止供应商提交；没有模拟成品',code:'fixture_blocked'},{status:403});
  }
  if(u.pathname.startsWith('/api/')){state.blockedAPI++;throw Error('隔离夹具禁止其他 API');}
  if(!state.ready)throw Error('QA storage isolation failed');if(['/qa/trim-scenes.mp4','/qa/native-video-mask-source.mp4'].includes(u.pathname))state.localMediaReads++;
  return originalFetch(input,options);
 };
 try{
  window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
  const storage=window.localStorage;Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k),key:i=>Object.keys(storage).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length)??null,get length(){return Object.keys(storage).filter(k=>k.startsWith(prefix)).length;}}});
  const open=indexedDB.open.bind(indexedDB),isolatedOpen=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbNames.add(name);return version===undefined?open(name):open(name,version);};indexedDB.open=isolatedOpen;if(indexedDB.open!==isolatedOpen)throw Error('IndexedDB wrapper could not be installed');state.ready=true;
 }catch(error){state.ready=false;state.lastError='Storage isolation failed: '+error.message;try{indexedDB.open=()=>{throw Error(state.lastError);};}catch{}document.documentElement.dataset.qaIsolation='failed';document.write('<meta http-equiv="Content-Security-Policy" content="script-src &#39;none&#39;">');}
})();
