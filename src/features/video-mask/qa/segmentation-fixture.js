// Only native mode is evidence for the server/codec chain. Frontend mode uses
// explicitly synthetic task DTOs to exercise lost receipts and UI persistence.
(()=>{
 const query=new URLSearchParams(location.search),native=['native','pipeline'].includes(query.get('mode')),session=query.get('session')||crypto.randomUUID(),prefix='qa-sam2:'+session+':',originalFetch=window.fetch.bind(window),storage=window.localStorage;
 const state=window.VideoSegmentationFixture={native,session,prefix,ready:false,posts:0,gets:0,resumes:0,cancels:0,blockedExternal:0,blockedAPI:0,failReceipt:false,failMaskSave:false,loseCreate:false,events:[]};
 const config=()=>({configured:true,protocol:'replicate-sam2-native',model:'meta/sam-2-video',version:state.changeVersion?'synthetic-v2':'synthetic-v1',providerFingerprint:'synthetic-origin',maxPredictions:2,availabilityVerified:false});
 const taskKey=id=>prefix+'synthetic-task:'+id,read=id=>{const raw=storage.getItem(taskKey(id));return raw?JSON.parse(raw):null;},write=task=>storage.setItem(taskKey(task.id),JSON.stringify(task));
 const taskResponse=task=>task?Response.json(task):Response.json({code:'segmentation_not_found',error:'没有该UUID的已存任务；未创建新任务'},{status:404});
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.blockedExternal++;throw Error('QA 禁止浏览器外部网络');}
  if(!state.ready)throw Error('QA storage isolation failed');
  if(url.pathname.startsWith('/api/video-segmentation/')){
   if(url.pathname.endsWith('/config'))return native?originalFetch(input,options):Response.json(config());
   if(method==='POST'&&url.pathname==='/api/video-segmentation/tasks')state.posts++;
   else if(method==='GET')state.gets++;else if(url.pathname.endsWith('/resume'))state.resumes++;else if(url.pathname.endsWith('/cancel'))state.cancels++;
   if(native)return originalFetch(input,options);
   if(method==='POST'&&url.pathname==='/api/video-segmentation/tasks'){
    const id=new Headers(options.headers).get('Idempotency-Key'),request=JSON.parse(options.body);if(!id)return Response.json({error:'missing UUID'},{status:400});let task=read(id);
    if(!task){const bytes=Uint8Array.from(atob(request.sourceVideoUrl.split(',')[1]),value=>value.charCodeAt(0)),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');task={id,protocol:'replicate-sam2-native',version:config().version,providerFingerprint:config().providerFingerprint,status:'needs_resume',canResume:true,source:{sha256,width:320,height:180,fps:30,numFrames:240,duration:8},prompt:{time:request.time},branches:[{direction:'forward',status:'succeeded',numFrames:165,downloadedFrames:165},{direction:'reverse',status:'pending',numFrames:76,downloadedFrames:0}]};write(task);}
    if(state.loseCreate){state.loseCreate=false;throw Error('Synthetic lost create response');}return taskResponse(task);
   }
   const match=/\/tasks\/([a-f0-9-]{36})(\/resume|\/cancel)?$/.exec(url.pathname),task=match&&read(match[1]);if(!task)return taskResponse(null);
   if(match[2]==='/resume'&&method==='POST'){task.status='running';task.canResume=false;task.branches[1].status='running';write(task);}
   else if(match[2]==='/cancel'&&method==='POST'){task.status='cancelled';task.canResume=false;task.branches.forEach(branch=>branch.remoteCancellation='requested');write(task);}
   else if(method==='GET'&&task.status==='running'){task.status='succeeded';task.branches.forEach(branch=>{branch.status='succeeded';branch.downloadedFrames=branch.numFrames;});task.mask={width:320,height:180,fps:30,frames:Array.from({length:240},(_,i)=>Array.from({length:30},(_,y)=>`${(50+y)*320+40+Math.floor(i/4)%160} 24`).join(' '))};write(task);}
   return taskResponse(task);
  }
  if(url.pathname==='/api/generation/config'||url.pathname==='/api/agent/config')return Response.json({configured:false,missing:['QA blocks downstream generation']});
  if(native&&url.pathname.startsWith('/qa/sam2-'))return originalFetch(input,options);
  if(url.pathname.startsWith('/api/')){state.blockedAPI++;throw Error('QA 禁止其他 API');}
  return originalFetch(input,options);
 };
 try{
  window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>{if(state.failReceipt&&key.startsWith('freenow:video-segmentation:'))throw Error('QA receipt disk failure');storage.setItem(prefix+key,String(value));},removeItem:key=>storage.removeItem(prefix+key),key:index=>Object.keys(storage).filter(key=>key.startsWith(prefix))[index]?.slice(prefix.length)??null,get length(){return Object.keys(storage).filter(key=>key.startsWith(prefix)).length;}}});
  const open=indexedDB.open.bind(indexedDB);indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;return version===undefined?open(name):open(name,version);};state.ready=true;
 }catch(error){state.lastError='QA storage isolation failed: '+error.message;state.ready=false;document.documentElement.dataset.qaIsolation='failed';}
})();
