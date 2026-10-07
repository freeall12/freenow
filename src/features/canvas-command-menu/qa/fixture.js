(() => {
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-canvas-command-menu:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 preferences.set('tapnow-canvas-view-v1',JSON.stringify({x:240,y:180,scale:.85}));preferences.set('tapnow-playlist-intro-hidden','true');
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[{id:'qa-menu-image',type:'image',title:'QA 本地图片',x:0,y:60,width:300,height:220,image:'assets/agent-casting.png',fullImage:'assets/agent-casting.png'},{id:'qa-menu-empty',type:'image',title:'QA 空图片',x:400,y:60,width:300,height:220}],edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.CanvasCommandMenuFixture={namespace:prefix,externalAttempts:[]};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('菜单 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('菜单 QA 禁止模型或其他 API');
  return nativeFetch(input,options);
 };
})();
