(() => {
 'use strict';
 const params=new URLSearchParams(location.search),session=params.get('session')||'manual-video-trim';
 let hash=2166136261;for(const character of session)hash=Math.imul(hash^character.charCodeAt(0),16777619);
 const projectId='qa_trim_'+(hash>>>0).toString(16),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
 const namespace='qa-video-trim:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';preferences.set('tapnow-playlist-intro-hidden','true');
 const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#ba3535"/><text x="35" y="140" fill="white" font-size="26">本机红 / 蓝测试片</text></svg>');
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[{id:'qa-trim-source',type:'video',title:'本机红蓝测试片 · 8秒',video:'/qa/trim-scenes.mp4',image,x:50.125,y:80.375,width:480,height:270}],edges:[]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const fixture=window.VideoTrimFixture={session,projectId,namespace,events:[],externalAttempts:[],processCount:0};
 fixture.seedReady=(async()=>{
  const response=await nativeFetch('/qa/trim-scenes.mp4');if(!response.ok)throw Error('本机红蓝测试片不可读取');
  const blob=await response.blob();
  seed.nodes[0].video=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  return new Promise((resolve,reject)=>{
  const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),read=store.get('project:'+projectId);
   read.onsuccess=()=>{if(read.result!==undefined)return;const now=Date.now();store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'本机视频剪辑保存 QA',createdAt:now,updatedAt:now},view:{x:60,y:70,scale:1},history:[],future:[]},'project:'+projectId);};
   tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('QA 初始画布未保存'));};tx.onerror=()=>reject(tx.error);
  };
  });
 })();
 window.fetch=async(input,options={})=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(target.origin!==location.origin&&!['blob:','data:'].includes(target.protocol)){fixture.externalAttempts.push(target.hostname);throw Error('剪辑 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(target.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(target.pathname==='/api/media/trim'){fixture.processCount++;return nativeFetch(input,options);}
  if(target.pathname.startsWith('/api/'))throw Error('剪辑 QA 只允许本机媒体裁剪');
  return nativeFetch(input,options);
 };
})();
