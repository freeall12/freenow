// Opt-in isolated QA transport. No model/API request can leave this fixture.
(()=>{
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-provider-routing:'+session+':',storage=new Map(),nativeFetch=window.fetch.bind(window);
 // Origin storage may be full. QA preferences are page-local; the actual graph
 // and assets still use their isolated IndexedDB names and are never deleted.
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.get(prefix+k)??null,setItem:(k,v)=>storage.set(prefix+k,String(v)),removeItem:k=>storage.delete(prefix+k)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const state={posts:0,mediaReads:0,blocked:0,mode:'routed',preferences:'page-memory'};window.ProviderRoutingFixture=state;
 const change=()=>window.dispatchEvent(new Event('qa:routing-change'));
 const config={protocol:'routed',configured:true,missing:[],providers:{images:{protocol:'openai-native',configured:true,missing:[],capabilities:{kinds:['image.generate'],models:{'gpt-image-2':{kind:'image.generate'}}}},video:{protocol:'ark-native',configured:false,missing:['GENERATION_API_KEY'],capabilities:{kinds:['video.generate'],models:{'seedance-2.0':{kind:'video.generate'}}}}},routes:{'image.generate':{default:'images',models:{}},'video.generate':{default:'video',models:{}},'video.analyze':{default:'video',models:{}}}};
 // Public capability metadata only: this mode contains no Key or destination.
 const directArk={protocol:'ark-native',configured:true,missing:[],capabilities:{kinds:['video.generate'],video:{'seedance-2.5':{modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}},maxCount:1}}}};
 window.ProviderRoutingFixtureSetMode=mode=>{if(!['routed','direct-ark'].includes(mode))throw Error('未知验收模式');state.mode=mode;change();};
 window.fetch=async(input,options={})=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
  if(typeof target!=='string')throw Error('隔离验收地址无效');const url=new URL(target,location.href),path=decodeURIComponent(url.pathname);
  if(url.origin!==location.origin){state.blocked++;change();throw Error('隔离验收禁止外部请求');}
  if(path==='/api/generation/config')return Response.json(state.mode==='direct-ark'?directArk:config);
  if(path==='/api/agent/config')return Response.json({configured:false,missing:['OPENAI_API_KEY']});
  if(path==='/api/generation/tasks'&&options.method==='POST'){
   state.posts++;change();const request=JSON.parse(options.body);if(request.kind!=='image.generate'||state.mode==='direct-ark')throw Error('未映射验收任务不得派发');
   return Response.json({id:'qa-routing-image-'+state.posts,status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII='}]});
  }
  if(path==='/qa/trim-scenes.mp4'){state.mediaReads++;change();return nativeFetch(input,options);}
  if(path==='/api'||path.startsWith('/api/')){state.blocked++;change();throw Error('隔离验收禁止未声明 API');}
  return nativeFetch(input,options);
 };
})();
