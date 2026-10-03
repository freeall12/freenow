(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-node-video-repair-main:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 preferences.set('tapnow-canvas-view-v1',JSON.stringify({x:180,y:130,scale:.85}));
 preferences.set('tapnow-playlist-intro-hidden','true');
 const old='https://files.tapnow.media/qa-main-unknown-video.mp4?token=synthetic-qa-only',nodes=['qa-video-selected','qa-video-fallback'].map((id,index)=>({id,type:'video',title:index?'QA 旧视频回退 · EDITOR_DATA':'QA 选择旧视频 · 人工替换',x:40+index*310,y:120,width:260,height:220,...(index?{}:{video:old}),image:old+'.jpg',poster:old+'.jpg',clip:{start:20,end:24},durationMs:30000,generation:{model:'QA旧模型',duration:8},sourceJournal:{source:old,signature:'synthetic-keep'},provenance:{kind:'generation-result',mediaSource:old,model:'QA旧模型'}}));
 let editorData={nodes:{'qa-video-fallback':{video:old}}};
 Object.defineProperty(window,'EDITOR_DATA',{get:()=>editorData,set:value=>{editorData={...value,nodes:{...value?.nodes,'qa-video-fallback':{...value?.nodes?.['qa-video-fallback'],video:old}}};}});
 const seed={referenceWidth:1400,referenceHeight:900,nodes,edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.NodeVideoRepairMainFixture={namespace:prefix,selectedId:nodes[0].id,otherId:nodes[1].id,fetches:[],externalAttempts:[],originalRef:old};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('独立主壳修复 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('独立主壳修复 QA 禁止模型或其他 API');
  state.fetches.push(url.protocol==='blob:'?'blob:local-byte-read':url.pathname);
  return nativeFetch(input,options);
 };
})();
