(()=>{
 const session=new URLSearchParams(location.search).get('session')||'panorama-edit-frontend-1005',prefix='qa-panorama-edit:'+session+':',memory=new Map(),originalFetch=window.fetch.bind(window),dbs=new Set();
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(session))throw Error('Invalid isolated QA session');
 const f=window.PanoramaEditFixture={session,prefix,ready:false,configured:true,posts:0,blockedExternal:0,blockedAPI:0,pendingConfigurations:0,armDelay:false,requests:[],saveAttempts:0,failSave:false};
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key),key:index=>[...memory.keys()][index]??null,get length(){return memory.size;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';const originalOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;dbs.add(name);return version===undefined?originalOpen(name):originalOpen(name,version);};f.databases=()=>[...dbs];f.ready=true;
 const releases=new Set();f.release=()=>{for(const release of [...releases])release();};
 window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=options.method??input?.method??'GET';
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){f.blockedExternal++;throw Error('External network blocked by isolated fixture');}
  if(url.pathname.startsWith('/api/generation/')){
   if(url.pathname==='/api/generation/tasks'&&method==='POST'){f.posts++;const r=JSON.parse(options.body);f.requests.push({kind:r.kind,parameters:r.parameters,inputImages:r.inputs.map(i=>({type:i.type,projection:i.projection,mime:i.image?.split(',')[0],length:i.image?.length}))});}
   let response=await originalFetch(input,options);if(url.pathname==='/api/generation/config'&&!f.configured){const missing=await response.json();missing.configured=false;for(const config of Object.values(missing.providers||{})){config.configured=false;config.missing=['GENERATION_API_KEY'];}response=Response.json(missing);}
   if(url.pathname==='/api/generation/config'&&f.armDelay){f.armDelay=false;f.pendingConfigurations++;await new Promise(resolve=>{const release=()=>{releases.delete(release);f.pendingConfigurations--;resolve();};releases.add(release);});}return response;
  }
  if(['/api/agent/config','/api/audio/config','/api/video-segmentation/config'].includes(url.pathname))return Response.json({configured:false});
  if(url.pathname.startsWith('/api/')){f.blockedAPI++;throw Error('Other production APIs blocked');}return originalFetch(input,options);
 };
})();
