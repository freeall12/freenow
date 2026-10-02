// Opt-in isolated QA transport. No model/API request can leave this fixture.
(()=>{
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-provider-routing:'+session+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const state={posts:0,mediaReads:0,blocked:0};window.ProviderRoutingFixture=state;
 const change=()=>window.dispatchEvent(new Event('qa:routing-change'));
 const config={protocol:'routed',configured:true,missing:[],providers:{images:{protocol:'openai-native',configured:true,missing:[],capabilities:{kinds:['image.generate'],models:{'gpt-image-2':{kind:'image.generate'}}}},video:{protocol:'ark-native',configured:false,missing:['GENERATION_API_KEY'],capabilities:{kinds:['video.generate'],models:{'seedance-2.0':{kind:'video.generate'}}}}},routes:{'image.generate':{default:'images',models:{}},'video.generate':{default:'video',models:{}},'video.analyze':{default:'video',models:{}}}};
 window.fetch=async(input,options={})=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
  if(typeof target!=='string')throw Error('隔离验收地址无效');const url=new URL(target,location.href),path=decodeURIComponent(url.pathname);
  if(url.origin!==location.origin){state.blocked++;change();throw Error('隔离验收禁止外部请求');}
  if(path==='/api/generation/config')return Response.json(config);
  if(path==='/api/agent/config')return Response.json({configured:false,missing:['OPENAI_API_KEY']});
  if(path==='/api/generation/tasks'&&options.method==='POST'){
   const request=JSON.parse(options.body);if(request.kind!=='image.generate')throw Error('未配置任务不得派发');state.posts++;change();
   return Response.json({id:'qa-routing-image-'+state.posts,status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII='}]});
  }
  if(path==='/qa/trim-scenes.mp4'){state.mediaReads++;change();return nativeFetch(input,options);}
  if(path==='/api'||path.startsWith('/api/')){state.blocked++;change();throw Error('隔离验收禁止未声明 API');}
  return nativeFetch(input,options);
 };
})();
