(() => {
  'use strict';
  const session=new URLSearchParams(location.search).get('session')||'manual-context',namespace='qa-canvas-context-menu:'+encodeURIComponent(session)+':';
  let hash=2166136261;for(const character of session)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const projectId='qa_context_menu_'+(hash>>>0).toString(16),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';window.TEMPLATE_DB_NAME=namespace+'templates';preferences.set('tapnow-playlist-intro-hidden','true');
  const node={id:'qa-context-image',type:'image',title:'公开菜单测试图片 · 不含用户数据',image:'/assets/tap-logo.webp',x:400.25,y:100.5,width:250,height:160,versions:[{image:'/assets/tap-logo.webp',label:'公开版本一'},{image:'/assets/tap-logo.webp',label:'公开版本二'}]};
  const seed={referenceWidth:1400,referenceHeight:900,nodes:[node],edges:[]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.CanvasContextMenuFixture={session,namespace,projectId,seed:structuredClone(seed),blockedAPIs:[],externalAttempts:[]};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('documents','readwrite');const now=Date.now();tx.objectStore('documents').put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'短视口菜单 QA',createdAt:now,updatedAt:now},view:{x:0,y:0,scale:1},history:[],future:[]},'project:'+projectId);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('菜单QA初始图未保存'));};};
  });
  window.fetch=async(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(target.origin!==location.origin&&!['blob:','data:'].includes(target.protocol)){fixture.externalAttempts.push(target.hostname);throw Error('菜单QA禁止外部请求');}
    if(['/api/generation/config','/api/agent/config'].includes(target.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
    if(target.pathname.startsWith('/api/')){fixture.blockedAPIs.push(target.pathname);throw Error('菜单QA未配置模型，不派发生产API');}
    return nativeFetch(input,options);
  };
})();
