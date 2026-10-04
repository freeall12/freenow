// Opt-in full-app QA. Fixed model/task replies; all non-fixture API and external fetches fail closed.
(()=>{
 // CSP is already installed by the HTML before this script. Install the deny
 // transport before reading bootstrap getters; initialization can never restore
 // a real API fallback. Do not read or clear origin localStorage.
 let nativeFetch,nativeDB,prefix;
 try{nativeFetch=window.fetch.bind(window);}catch{}
 const blocked=async()=>{throw Error('隔离图片验收未初始化，禁止网络请求');};
 Object.defineProperty(window,'fetch',{configurable:true,writable:true,value:blocked});
 try{nativeDB=window.indexedDB;}catch{}
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:(name,version)=>{if(!prefix||typeof name!=='string'||!name.startsWith(prefix)||!nativeDB)throw Error('隔离图片验收禁止访问真实数据库');return nativeDB.open(name,version);},deleteDatabase:()=>{throw Error('隔离图片验收禁止删除数据库');}}});
 const storage=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>storage.get(String(key))??null,setItem:(key,value)=>storage.set(String(key),String(value)),removeItem:key=>storage.delete(String(key)),clear:()=>storage.clear(),key:index=>[...storage.keys()][index]??null,get length(){return storage.size;}}});
 try{
 const query=new URLSearchParams(location.search),session=query.get('session')||'manual';prefix='qa-agent-image-processing:'+encodeURIComponent(session)+':';
 if(!nativeFetch)throw Error('夹具无法安装本地素材读取');
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 localStorage.setItem('tapnow-agent-confirm-mode',query.has('auto')?'auto':'ask');
 const panorama=query.get('kind')==='panorama',kind=panorama?'image.generate':query.get('kind')==='angle'?'image.multiAngle':query.get('kind')==='upscale'?'image.upscale':'image.remove-background';
 const tasks=new Map(),state={configured:query.get('configured')!=='false',kind,panorama,posts:[],taskRecords:'loading',sourceReads:0,thumbnailReads:0,turns:0,runs:new Map(),preferences:'page-memory',namespace:prefix,requests:[],errors:[]};
 const change=()=>window.dispatchEvent(new Event('qa-agent-image:change'));
 window.AgentImageProcessingFixture={state,setConfigured:value=>{state.configured=value;change();}};
 const json=value=>Response.json(value);
 let restoring;
 const restoreTasks=()=>restoring||(restoring=(async()=>{const record=await window.CanvasStore.readRecord('agent-qa-image-fixture-tasks');for(const [id,task]of record?.tasks||[])tasks.set(id,task);if(record?.posts)state.posts=record.posts;state.taskRecords='ready';change();})());
 window.AgentImageProcessingFixture.restoreTasks=restoreTasks;
 window.addEventListener?.('DOMContentLoaded',()=>{void restoreTasks().catch(error=>{state.taskRecords='failed';state.errors.push({storage:'fixture-tasks',error:String(error?.message||error)});change();});},{once:true});
 function size(url){const raw=atob(url.split(',')[1]),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);const view=new DataView(data.buffer);return {width:view.getUint32(16),height:view.getUint32(20),bytes:data.length};}
 window.fetch=async(input,options={})=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input?.url;if(typeof target!=='string')throw Error('夹具请求地址无效');
  const url=new URL(target,document.baseURI||location.href),path=decodeURIComponent(url.pathname),method=(options.method||input?.method||'GET').toUpperCase();state.requests.push({path,method});change();
  try{
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('隔离图片验收禁止外部请求');
  if(path==='/qa/agent-image-processing-source.png'&&method==='GET'){state.sourceReads++;change();return await nativeFetch(url.href,options);}
  if(path==='/qa/agent-image-processing-thumbnail.png'&&method==='GET'){state.thumbnailReads++;change();return await nativeFetch(url.href,options);}
  // Production builds the Agent source fingerprint before turn dispatch and
  // reads this exact static catalog relative to <base href="/">.
  if(path==='/runtime-reference/skills-catalog.json'&&method==='GET')return await nativeFetch(url.href,options);
  // The real local resource index contains private mappings. This opt-in QA
  // uses a schema-valid synthetic empty map and never reads that file.
  if(path==='/assets/local-resource-index.json'&&method==='GET')return json({version:1,algorithm:'sha256-exact-utf8',entries:{}});
  if(path==='/api/agent/config')return json({configured:true,model:'固定本地协议验收'});
  if(path==='/api/generation/config')return json(panorama?{configured:state.configured,configurationId:'fixture-panorama-config',protocol:'fal-panorama-native',missing:state.configured?[]:['GENERATION_API_KEY'],capabilities:{kinds:['image.generate'],models:{'hunyuan-world-panorama':{kind:'image.generate',label:'Hunyuan World Panorama'}},panorama:{'hunyuan-world-panorama':{source:'image',maxImages:1,maxCount:1,projection:'equirectangular',fixedAspectRatio:'2:1',nativeSize:true,editing:false,inputMimeTypes:['image/png'],outputMimeTypes:['image/png']}},imageReferences:{'hunyuan-world-panorama':{maxImages:1,mimeTypes:['image/png'],transport:'inline'}}}}:{configured:state.configured,configurationId:'fixture-image-config',protocol:'fal-native',missing:state.configured?[]:['FAL_API_KEY'],capabilities:{kinds:['image.remove-background','image.upscale','image.multiAngle'],models:Object.fromEntries(['image.remove-background','image.upscale','image.multiAngle'].map(alias=>[alias,{kind:alias}]))}});
  if(path==='/api/generation/tasks'&&options.method==='POST'){
   await restoreTasks();
   const request=JSON.parse(options.body),id=new Headers(options.headers).get('Idempotency-Key');
   const record=await window.CanvasStore?.readRecord?.('agent-conversations:'+(window.CanvasProjects?.id()||'canvas'));
   const chats=record?.chats||JSON.parse(localStorage.getItem('tapnow-agent-chats')||'[]');
   const acknowledged=chats.some(chat=>chat.messages?.some(trace=>trace.name==='generation_submit'&&trace.submittedTaskId===id));
   const main=request.inputs?.[0];if(!state.configured||request.kind!==kind||!main?.url.startsWith('data:image/png;base64,')||!panorama&&!acknowledged)throw Error('夹具断言失败：配置、真实本地PNG或派发前持久回执缺失');
   const actual=size(main.url);if(actual.width!==512||actual.height!==320)throw Error('夹具断言失败：提交的是缩略图');
   if(kind==='image.multiAngle'&&JSON.stringify([request.parameters.rotate_right_left,request.parameters.move_forward,request.parameters.vertical_angle,request.parameters.wide_angle_lens])!==JSON.stringify([-30,2,.5,false]))throw Error('夹具多角度参数发生改变');
   if(panorama&&(request.inputs.length!==1||'sourceUrl'in main||Object.keys(main).some(key=>!['type','id','url','width','height'].includes(key))||main.width!==512||main.height!==320||request.parameters.model!=='hunyuan-world-panorama'||request.parameters.isPanoramaPrompt!==true||request.parameters.ratio!=='2:1'||request.parameters.count!==1||request.parameters.providerParameters?.mode!=='image_to_image'))throw Error('夹具全景断言失败：显式模型、纯输入、尺寸或原生参数错误');
   state.posts.push({id,kind,acknowledged,...actual,parameters:request.parameters,inputKeys:Object.keys(main)});
   const result={id,status:'succeeded',request,outputs:[{type:'image',url:new URL('/qa/agent-image-processing-'+(panorama?'panorama-result':'result')+'.png',location.href).href,width:panorama?1024:512,height:panorama?512:320,mimeType:'image/png'}]};tasks.set(id,result);await window.CanvasStore.writeRecord('agent-qa-image-fixture-tasks',{tasks:[...tasks],posts:state.posts});change();return json(result);
  }
  if(path.startsWith('/api/generation/tasks/')){
   await restoreTasks();
   const id=path.slice('/api/generation/tasks/'.length),task=tasks.get(id);if(options.method==='POST')return json({id,status:'cancelled'});if(task)return json(task);return Response.json({error:'夹具原任务不存在'},{status:404});
  }
  if(path==='/api/agent/turn'){
   const body=JSON.parse(options.body),id='qa-image-'+crypto.randomUUID();state.turns++;state.runs.set(id,{binding:body.binding});change();
   const args={nodeId:'image-source',kind,prompt:panorama?'保留来源空间布局，生成360度等距柱状全景。': '',...(panorama?{model:'hunyuan-world-panorama',isPanoramaPrompt:true,aspect:'2:1',count:1,referenceIds:['image-source']}:kind==='image.multiAngle'?{rotate_right_left:-30,move_forward:2,vertical_angle:.5,wide_angle_lens:false}:{})};
   return json({sessionId:id,round:1,done:false,text:'固定本地验收：通过生产Agent图片处理入口提交高清来源。模型回复与处理结果均为夹具，不代表真实供应商输出。',calls:[{callId:id+'-call',name:'generation_submit',args,mutates:true}]});
  }
  if(path==='/api/agent/continue'){const body=JSON.parse(options.body),run=state.runs.get(body.sessionId);if(!run||JSON.stringify(run.binding)!==JSON.stringify(body.binding))throw Error('夹具Agent绑定不匹配');return json({sessionId:body.sessionId,round:2,done:true,text:'固定回复已收到提交回执；生成与落图状态请查看实际任务记录。',calls:[]});}
  if(path==='/api/agent/cancel')return json({cancelled:true});
  if(method==='GET'&&(['blob:','data:'].includes(url.protocol)||path.startsWith('/qa/')))return await nativeFetch(url.href,options);
  throw Error('隔离图片验收禁止转发未声明请求');
  }catch(error){state.errors.push({path,error:String(error?.message||error)});change();throw error;}
 };
 window.addEventListener?.('securitypolicyviolation',event=>{state.errors.push({csp:event.effectiveDirective,blocked:event.blockedURI});change();});
 }catch(error){window.fetch=blocked;window.AgentImageProcessingFixture={state:{configured:false,bootstrapError:String(error?.message||error)}};}
})();
