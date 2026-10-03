(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-node-image-repair-main:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 preferences.set('tapnow-canvas-view-v1',JSON.stringify({x:180,y:130,scale:.85}));
 preferences.set('tapnow-playlist-intro-hidden','true');
 const old='https://files.tapnow.media/qa-main-unknown-image.png?token=synthetic-qa-only',nodes=['qa-repair-selected','qa-repair-other'].map((id,index)=>({id,type:'image',title:index?'QA 其他旧图片 · 保留待导入':'QA 选择旧图片 · 人工替换',x:40+index*310,y:120,width:260,height:260,image:old,fullImage:old,generation:{model:'QA旧模型'},sourceJournal:{source:old,signature:'synthetic-keep'},provenance:{kind:'generation-result',mediaSource:old,model:'QA旧模型'}}));
 const seed={referenceWidth:1400,referenceHeight:900,nodes,edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.NodeImageRepairMainFixture={namespace:prefix,selectedId:nodes[0].id,otherId:nodes[1].id,fetches:[],externalAttempts:[],originalRef:old};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('独立主壳修复 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('独立主壳修复 QA 禁止模型或其他 API');
  state.fetches.push(url.protocol==='blob:'?'blob:local-byte-read':url.pathname);
  return nativeFetch(input,options);
 };
})();
