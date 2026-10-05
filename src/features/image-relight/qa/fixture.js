(()=>{
 const query=new URLSearchParams(location.search),pipeline=query.get('mode')==='pipeline',session=query.get('session')||'relight-frontend-1005',prefix='qa-relight:'+session+':',memory=new Map(),originalFetch=window.fetch.bind(window),dbs=new Set();
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(session))throw Error('Invalid isolated QA session');
 const f=window.RelightFixture={session,prefix,ready:false,pipeline,configured:pipeline,posts:0,blockedExternal:0,blockedAPI:0,pendingConfigurations:0,armDelay:false,requests:[],saveAttempts:0,failSave:false};
 try{Object.defineProperty(window,'localStorage',{value:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key),key:index=>[...memory.keys()][index]??null,get length(){return memory.size;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';const originalOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbs.add(name);return version===undefined?originalOpen(name):originalOpen(name,version);};f.databases=()=>[...dbs];f.ready=true;
 }catch(error){f.error='Storage isolation failed: '+error.message;document.write('<meta http-equiv="Content-Security-Policy" content="script-src &#39;none&#39;">');}
 const releases=new Set();f.release=()=>{for(const release of [...releases])release();};
 window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(!f.ready)throw Error('Storage isolation failed');if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){f.blockedExternal++;throw Error('External network blocked by isolated fixture');}
  if(pipeline&&url.pathname.startsWith('/api/generation/')){
   if(url.pathname==='/api/generation/tasks'&&method==='POST'){f.posts++;const r=JSON.parse(options.body);f.requests.push({kind:r.kind,parameters:r.parameters,inputs:r.inputs.map(i=>({role:i.role,width:i.width,height:i.height,mime:i.url.split(',')[0],length:i.url.length}))});}
   let response=await originalFetch(input,options);if(url.pathname==='/api/generation/config'&&!f.configured){const missing=await response.json();missing.configured=false;for(const config of Object.values(missing.providers||{})){config.configured=false;config.missing=['GENERATION_API_KEY'];}response=Response.json(missing);}
   if(url.pathname==='/api/generation/config'&&f.armDelay){f.armDelay=false;f.pendingConfigurations++;await new Promise(resolve=>{const release=()=>{releases.delete(release);f.pendingConfigurations--;resolve();};releases.add(release);});}return response;
  }
  if(url.pathname==='/api/generation/config'){
   const snapshot=structuredClone(window.RelightFixtureConfiguration);snapshot.configured=f.configured;snapshot.missing=f.configured?[]:['GENERATION_API_KEY'];snapshot.configurationId=f.configured?'synthetic-ready':'synthetic-missing';
   if(f.armDelay){f.armDelay=false;f.pendingConfigurations++;await new Promise(resolve=>{const release=()=>{releases.delete(release);f.pendingConfigurations--;resolve();};releases.add(release);});}return Response.json(snapshot);
  }
  if(url.pathname==='/api/generation/tasks'&&method==='POST'){
   f.posts++;const r=JSON.parse(options.body);f.requests.push({kind:r.kind,parameters:r.parameters,inputs:r.inputs.map(i=>({role:i.role,width:i.width,height:i.height,mime:i.url.split(',')[0],length:i.url.length}))});
   return Response.json({id:'synthetic-boundary-'+f.posts,status:'succeeded',outputs:[{type:'image',url:'/api/generation/media/10050000-0000-4000-8000-000000000001',width:768,height:512}],providerStatus:'succeeded',localization:{state:'ready'}});
  }
  if(url.pathname==='/api/generation/media/10050000-0000-4000-8000-000000000001')return originalFetch(input,options);
  if(['/api/agent/config','/api/audio/config','/api/video-segmentation/config'].includes(url.pathname))return Response.json({configured:false});
  if(url.pathname.startsWith('/api/')){f.blockedAPI++;throw Error('Other production APIs blocked');}return originalFetch(input,options);
 };
})();
