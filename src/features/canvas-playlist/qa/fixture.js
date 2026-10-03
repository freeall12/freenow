(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-playlist-contract:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 // UI preferences are disposable. Full origin quota cannot prevent this QA
 // from starting; real canvas snapshots still use its isolated IndexedDB.
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 if(localStorage.getItem('tapnow-canvas-view-v1')===null)localStorage.setItem('tapnow-canvas-view-v1',JSON.stringify({x:240,y:110,scale:.75}));
 localStorage.setItem('tapnow-playlist-intro-hidden','true');
 const clips=()=>[{id:'qa-red-first',sourceId:'qa-red',title:'红色测试片段',url:'/qa/playlist-contract-red.mp4',poster:'/assets/agent-casting.png',sourceDuration:8,trimStart:1,duration:4},{id:'qa-blue',sourceId:'qa-blue',title:'蓝色测试片段',url:'/qa/playlist-contract-blue.mp4',poster:'/assets/agent-casting.png',sourceDuration:8,trimStart:2,duration:3},{id:'qa-red-second',sourceId:'qa-red',title:'重复红色源',url:'/qa/playlist-contract-red.mp4',poster:'/assets/agent-casting.png',sourceDuration:8,trimStart:5,duration:2}];
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[{id:'qa-red',type:'video',title:'QA 红色原视频 · 非模型',video:'/qa/playlist-contract-red.mp4',image:'/assets/agent-casting.png',x:40,y:120,width:435,height:250},{id:'qa-blue',type:'video',title:'QA 蓝色原视频 · 非模型',video:'/qa/playlist-contract-blue.mp4',image:'/assets/agent-casting.png',x:520,y:120,width:435,height:250},{id:'qa-playlist',type:'playlist',title:'QA 红蓝时间线 · 非模型',x:40,y:600,width:960,height:104,clips:clips()}],edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.PlaylistContractFixture={clips,namespace:prefix,reads:[],posts:[],downloads:[],delayMerged:0,delayConversion:0};
 const changed=()=>window.dispatchEvent(new Event('qa:playlist-contract'));
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=(options.method||'GET').toUpperCase();
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('独立播放列表 QA 禁止外部请求');
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api/media/playlist'&&method==='POST'){
   const inputBody=JSON.parse(options.body);state.posts.push({clips:inputBody.clips.map(clip=>({start:clip.start,duration:clip.duration,bytes:atob(clip.data).length}))});changed();
   const response=await nativeFetch(input,options);if(state.delayMerged){const ms=state.delayMerged;state.delayMerged=0;await new Promise(resolve=>setTimeout(resolve,ms));}return response;
  }
  if(url.pathname==='/api/media/trim')return nativeFetch(input,options);
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('独立播放列表 QA 禁止模型或其他 API');
  if(url.pathname.startsWith('/qa/playlist-contract-')&&url.pathname.endsWith('.mp4')){state.reads.push(url.pathname);changed();}
  return nativeFetch(input,options);
 };
})();
