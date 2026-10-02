(()=>{
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-local-workflows:'+session+':',storage=window.localStorage,nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>{if(k.includes('subject-library'))throw new DOMException('QA subject storage full','QuotaExceededError');storage.setItem(prefix+k,String(v));},removeItem:k=>storage.removeItem(prefix+k)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 window.LocalWorkflowFixture={posts:0,clip:null,inputSeconds:null,sourceClip:null};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),path=decodeURIComponent(url.pathname);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('隔离验收禁止外部请求');
  if(path==='/api/generation/config')return Response.json({configured:true,protocol:'tasks-v1',capabilities:{kinds:[]}});
  if(path==='/api/agent/config')return Response.json({configured:false});
  if(path==='/api/generation/tasks'&&options.method==='POST'){
   const request=JSON.parse(options.body),source=request.inputs.find(x=>x.role==='source_video');
   if(request.kind!=='video.extend'||!source.url.startsWith('data:video/')||source.duration!==2||request.parameters.sourceClip!==null)throw Error('裁片未正确准备');
   Object.assign(window.LocalWorkflowFixture,{posts:window.LocalWorkflowFixture.posts+1,clip:source.sourceRange,inputSeconds:source.duration,sourceClip:request.parameters.sourceClip});window.dispatchEvent(new Event('qa:local-workflows'));
   return Response.json({id:'qa-extension-'+window.LocalWorkflowFixture.posts,status:'succeeded',outputs:[{type:'video',url:source.url,poster:'/assets/agent.webp'}]});
  }
  if(path==='/api/media/trim')return nativeFetch(input,options);
  if(path==='/api'||path.startsWith('/api/'))throw Error('隔离验收禁止其他 API');
  return nativeFetch(input,options);
 };
})();
