(()=>{
 const query=new URLSearchParams(location.search),mode=query.get('mode')==='unconfigured'?'unconfigured':'native',prefix='qa-video-extension:'+(query.get('session')||'manual')+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 window.ExtensionFixture={mode,posts:0,trimCalls:0,blockedAPI:0};
 const profile={ratios:['adaptive'],durations:Array.from({length:27},(_,index)=>index+4),resolutions:['720p','1080p'],audio:true,maxImages:4,maxVideos:4,maxAudios:2,videoDurationRange:{min:2,max:30,totalMax:30},audioDurationRange:{min:2,max:30,totalMax:30}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),pathname=url.pathname;
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('视频延长隔离验收禁止外部请求');
  if(pathname==='/api/generation/config')return Response.json({configured:mode==='native',protocol:'ark-video-extend-reference',missing:mode==='unconfigured'?['GENERATION_API_KEY']:[],capabilities:{kinds:['video.extend'],models:{'seedance-2.5':{kind:'video.extend'}},videoExtend:{models:{'seedance-2.5':{resolution:'720p',generateAudio:true,profile}}}}});
  if(pathname==='/api/agent/config')return Response.json({configured:false});
  if(pathname==='/api/generation/tasks'&&options.method==='POST'){window.ExtensionFixture.posts++;throw Error('夹具不允许模型提交');}
  if(pathname==='/api/media/trim'){window.ExtensionFixture.trimCalls++;throw Error('本地 Ark 限制必须在裁片之前发现');}
  if(pathname.startsWith('/api/')){window.ExtensionFixture.blockedAPI++;throw Error('视频延长隔离验收禁止其他 API');}
  return nativeFetch(input,options);
 };
})();
