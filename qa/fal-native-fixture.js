// This isolated fixture returns submitted source bytes; it does not run an AI model.
(()=>{
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-fal-native:'+session+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,String(v)),removeItem:k=>storage.removeItem(prefix+k)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const state=window.FalNativeFixture={posts:0,mediaReads:0,lastRequest:null};
 const config={configured:true,protocol:'routed',providers:{fal:{protocol:'fal-native',configured:true,missing:[],capabilities:{kinds:['image.upscale','image.remove-background'],models:{'image.upscale:topazlabs':{kind:'image.upscale'},'image.remove-background':{kind:'image.remove-background'}}}}},routes:{'image.upscale':{models:{'image.upscale:topazlabs':'fal'}},'image.remove-background':{default:'fal',models:{}}}};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),route=url.pathname;
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('隔离验收禁止外部请求');
  if(route==='/api/generation/config')return Response.json(config);
  if(route==='/api/agent/config')return Response.json({configured:false});
  if(route==='/api/generation/tasks'&&options.method==='POST'){
   const request=JSON.parse(options.body),source=request.inputs?.[0];
   if(!['image.upscale','image.remove-background'].includes(request.kind)||!source?.url.startsWith('data:image/png;base64,')||request.kind==='image.upscale'&&![2,4].includes(request.parameters.scale))throw Error('图片操作或内联素材未正确准备');
   state.posts++;state.lastRequest={kind:request.kind,parameters:request.parameters,input:source.url.slice(0,22)};window.dispatchEvent(new Event('qa:fal-native'));
   return Response.json({id:'qa-fal-'+state.posts,status:'succeeded',outputs:[{type:'image',url:source.url,mimeType:'image/png'}]});
  }
  if(route==='/api'||route.startsWith('/api/'))throw Error('隔离验收禁止其他 API');
  if(url.protocol==='blob:'){state.mediaReads++;window.dispatchEvent(new Event('qa:fal-native'));}
  return nativeFetch(input,options);
 };
})();
