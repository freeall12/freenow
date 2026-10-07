(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-audio-player-gestures:'+encodeURIComponent(session)+':';
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const preferences=new Map([['tapnow-canvas-view-v1',JSON.stringify({x:160,y:180,scale:1})],['tapnow-playlist-intro-hidden','true']]);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[
  {id:'qa-audio-player',type:'audio',title:'本地音频 · 拖动与波形定位',x:120,y:160,width:300,height:300,audioMode:'upload'},
  {id:'qa-audio-text',type:'text',title:'对照文本节点',x:580,y:160,width:300,height:200,content:'拖动播放器边缘和按钮间的空白可以移动音频节点；波形拖动只改变播放位置。'}
 ],edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const originalFetch=window.fetch.bind(window);
 window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(!['blob:','data:'].includes(url.protocol)&&url.origin!==location.origin)throw Error('音频交互QA只读取本机资源');
  if(url.pathname.startsWith('/api/')&&String(options.method||input?.method||'GET').toUpperCase()!=='GET')throw Error('音频交互QA禁止生成派发');
  return originalFetch(input,options);
 };
})();
