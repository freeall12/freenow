// Opt-in protocol QA. Replies and result are fixed; media and approval use the production paths.
(()=>{
 let nativeFetch,nativeDB,prefix;
 try{nativeFetch=window.fetch.bind(window);}catch{}
 const blocked=async()=>{throw Error('隔离视频蒙层验收未初始化，禁止网络请求');};
 Object.defineProperty(window,'fetch',{configurable:true,writable:true,value:blocked});
 try{nativeDB=window.indexedDB;}catch{}
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:(name,version)=>{if(!prefix||typeof name!=='string'||!name.startsWith(prefix)||!nativeDB)throw Error('隔离视频蒙层验收禁止访问真实数据库');return nativeDB.open(name,version);},deleteDatabase:()=>{throw Error('隔离视频蒙层验收禁止删除数据库');}}});
 const storage=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>storage.get(String(key))??null,setItem:(key,value)=>storage.set(String(key),String(value)),removeItem:key=>storage.delete(String(key)),clear:()=>storage.clear(),key:index=>[...storage.keys()][index]??null,get length(){return storage.size;}}});
 try{
 const query=new URLSearchParams(location.search),session=query.get('session')||'manual';prefix='qa-agent-video-mask:'+encodeURIComponent(session)+':';
 if(!nativeFetch)throw Error('夹具无法安装本地素材读取');
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 localStorage.setItem('tapnow-agent-confirm-mode',query.has('auto')?'auto':'ask');
 const kind=query.get('kind')==='replace'?'video.replace':'video.erase',tasks=new Map();
 const state={configured:query.get('configured')!=='false',kind,missingMask:query.has('missing-mask'),maskReady:false,posts:[],taskRecords:'loading',sourceReads:0,replacementReads:0,thumbnailReads:0,maskReads:0,turns:0,runs:new Map(),namespace:prefix,preferences:'page-memory',requests:[],errors:[]};
 const change=()=>window.dispatchEvent(new Event('qa-agent-video-mask:change'));
 window.AgentVideoMaskFixture={state,setConfigured:value=>{state.configured=value;change();},change};
 const json=value=>Response.json(value);let restoring;
 const restoreTasks=()=>restoring||(restoring=(async()=>{const record=await window.CanvasStore.readRecord('agent-qa-video-mask-fixture-tasks');for(const [id,task]of record?.tasks||[])tasks.set(id,task);if(record?.posts)state.posts=record.posts;state.taskRecords='ready';change();})());
 window.AgentVideoMaskFixture.restoreTasks=restoreTasks;
 window.addEventListener?.('DOMContentLoaded',()=>{void restoreTasks().catch(error=>{state.taskRecords='failed';state.errors.push({storage:'fixture-tasks',error:String(error?.message||error)});change();});},{once:true});
 function bytes(url){const raw=atob(url.split(',')[1]),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);return data;}
 window.fetch=async(input,options={})=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input?.url;if(typeof target!=='string')throw Error('夹具请求地址无效');
  const url=new URL(target,document.baseURI||location.href),path=decodeURIComponent(url.pathname),method=(options.method||input?.method||'GET').toUpperCase();state.requests.push({path,method});change();
  try{
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('隔离视频蒙层验收禁止外部请求');
  if(path==='/qa/trim-scenes.mp4'&&method==='GET'){state.sourceReads++;change();return await nativeFetch(url.href,options);}
  if(path==='/qa/agent-image-processing-source.png'&&method==='GET'){state.replacementReads++;change();return await nativeFetch(url.href,options);}
  if(path==='/qa/agent-image-processing-thumbnail.png'&&method==='GET'){state.thumbnailReads++;change();return await nativeFetch(url.href,options);}
  if(url.protocol==='blob:'&&method==='GET'){state.maskReads++;change();return await nativeFetch(url.href,options);}
  if(path==='/runtime-reference/skills-catalog.json'&&method==='GET')return await nativeFetch(url.href,options);
  if(path==='/assets/local-resource-index.json'&&method==='GET')return json({version:1,algorithm:'sha256-exact-utf8',entries:{}});
  if(path==='/api/agent/config')return json({configured:true,model:'固定本地协议验收'});
  if(path==='/api/generation/config')return json({configured:state.configured,configurationId:'fixture-video-mask-config',protocol:'fal-video-mask-native',missing:state.configured?[]:['FAL_API_KEY'],capabilities:{kinds:['video.erase','video.replace'],models:{'video.erase':{kind:'video.erase'},'video.replace':{kind:'video.replace'}},videoMask:{semantics:'explicit-native-alternative',temporalMask:true,maskEncoding:'rle-zero-based-row-major',preservesSourceAudio:'local-remux',resolution:'720p',aspectRatio:'adaptive',maxCount:1,sourceFrames:{min:81,max:241},sourceFps:{min:5,max:30}}}});
  if(path==='/api/generation/tasks'&&method==='POST'){
   await restoreTasks();const request=JSON.parse(options.body),id=new Headers(options.headers).get('Idempotency-Key');
   const record=await window.CanvasStore.readRecord('agent-conversations:'+(window.CanvasProjects?.id()||'canvas'));
   const chats=record?.chats||JSON.parse(localStorage.getItem('tapnow-agent-chats')||'[]');
   const acknowledged=chats.some(chat=>chat.messages?.some(trace=>trace.name==='generation_submit'&&trace.submittedTaskId===id));
   const main=request.inputs?.[0],mask=request.parameters?.mask,clip=request.parameters?.sourceClip;
   if(!state.configured||request.kind!==kind||!acknowledged||!id||!main?.url.startsWith('data:video/mp4;base64,')||main.duration!==8||main.width!==320||main.height!==180)throw Error('夹具断言失败：真实完整来源、配置或派发前持久回执缺失');
   const source=bytes(main.url);if(new TextDecoder().decode(source.slice(4,8))!=='ftyp')throw Error('夹具来源不是实际MP4');
   if(JSON.stringify(clip)!=='{"start":1,"end":5}'||mask?.encoding!=='rle-zero-based-row-major'||mask.width!==320||mask.height!==180||mask.fps!==30||mask.frames.length!==240||mask.frames.some((frame,i)=>frame!==`${(20+Math.floor(i/10))*320+40} 20`))throw Error('夹具完整时序蒙层或原选段被改变');
   let replacement=null;if(kind==='video.replace'){const ref=request.inputs[1];if(request.inputs.length!==2||ref?.role!=='replacement_image'||!ref.url.startsWith('data:image/png;base64,'))throw Error('夹具替换图片不是真实PNG');const data=bytes(ref.url),view=new DataView(data.buffer);replacement={width:view.getUint32(16),height:view.getUint32(20),bytes:data.length};if(replacement.width!==512||replacement.height!==320)throw Error('夹具提交了缩略图');}else if(request.inputs.length!==1)throw Error('视频移除夹具不能包含替换图');
   state.posts.push({id,kind,acknowledged,source:{width:main.width,height:main.height,duration:main.duration,bytes:source.length},clip,mask:{width:mask.width,height:mask.height,fps:mask.fps,frames:mask.frames.length},replacement});
   const result={id,status:'succeeded',request,outputs:[{type:'video',url:new URL('/qa/agent-video-mask-result.mp4',location.href).href,width:320,height:180,duration:4,mimeType:'video/mp4'}]};tasks.set(id,result);await window.CanvasStore.writeRecord('agent-qa-video-mask-fixture-tasks',{tasks:[...tasks],posts:state.posts});change();return json(result);
  }
  if(path.startsWith('/api/generation/tasks/')){await restoreTasks();const id=path.slice('/api/generation/tasks/'.length),task=tasks.get(id);if(method==='POST')return json({id,status:'cancelled'});if(task)return json(task);return Response.json({error:'夹具原任务不存在'},{status:404});}
  if(path==='/api/agent/turn'){
   const body=JSON.parse(options.body),id='qa-video-mask-'+crypto.randomUUID();state.turns++;state.runs.set(id,{binding:body.binding});change();
   return json({sessionId:id,round:1,done:false,text:'固定协议验收：读取已保存的完整时序蒙层，通过生产审批提交。蒙层与输出为合成夹具，不代表真实分割或模型编辑效果。',calls:[{callId:id+'-call',name:'generation_submit',args:{nodeId:'video-mask-source',kind,prompt:'',...(kind==='video.replace'?{referenceIds:['video-mask-reference']}:{})},mutates:true}]});
  }
  if(path==='/api/agent/continue'){const body=JSON.parse(options.body),run=state.runs.get(body.sessionId);if(!run||JSON.stringify(run.binding)!==JSON.stringify(body.binding))throw Error('夹具Agent绑定不匹配');return json({sessionId:body.sessionId,round:2,done:true,text:'固定回复已收到工具回执；请以实际任务与结果应用状态判断成功。',calls:[]});}
  if(path==='/api/agent/cancel')return json({cancelled:true});
  if(method==='GET'&&(url.protocol==='data:'||path.startsWith('/qa/')))return await nativeFetch(url.href,options);
  throw Error('隔离视频蒙层验收禁止转发未声明请求');
  }catch(error){state.errors.push({path,error:String(error?.message||error)});change();throw error;}
 };
 window.addEventListener?.('securitypolicyviolation',event=>{state.errors.push({csp:event.effectiveDirective,blocked:event.blockedURI});change();});
 }catch(error){window.fetch=blocked;window.AgentVideoMaskFixture={state:{configured:false,bootstrapError:String(error?.message||error)}};}
})();
