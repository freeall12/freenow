(() => {
  'use strict';
  const params=new URLSearchParams(location.search),session=params.get('session')||'manual-layout';
  const count=Math.max(10,Math.min(4000,Number.parseInt(params.get('count')||'1000',10)||1000));
  let hash=2166136261;for(const character of session)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const projectId='qa_layout_'+(hash>>>0).toString(16)+'_'+count,url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const namespace='qa-canvas-layout:'+encodeURIComponent(session)+':'+count+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';
  preferences.set('tapnow-playlist-intro-hidden','true');
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#659882"/><path d="M0 36L24 12L64 48H0" fill="#31463d"/></svg>');
  const seed={referenceWidth:1400,referenceHeight:900,nodes:Array.from({length:count},(_,i)=>({id:'qa-layout-'+i,type:'image',title:'本机布局夹具 '+i,image,x:53240.125+(i*7%40)*90.25,y:-2697.875+Math.floor(i/40)*78.375,width:64.125,height:48.375})),edges:[]};
  Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.CanvasLayoutFixture={session,count,projectId,namespace,seed:structuredClone(seed),events:[],externalAttempts:[]};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),read=store.get('project:'+projectId);
      read.onsuccess=()=>{if(read.result!==undefined)return;const now=Date.now();store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'生产画布布局性能 QA',createdAt:now,updatedAt:now},view:{x:-7860,y:590,scale:.15},history:[],future:[]},'project:'+projectId);};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('QA 初始画布未保存'));};tx.onerror=()=>reject(tx.error);
    };
  });
  window.fetch=async(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(target.origin!==location.origin&&!['blob:','data:'].includes(target.protocol)){fixture.externalAttempts.push(target.hostname);throw Error('布局 QA 禁止外部请求');}
    if(['/api/generation/config','/api/agent/config'].includes(target.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
    if(target.pathname.startsWith('/api/'))throw Error('布局 QA 禁止调用生产 API');
    return nativeFetch(input,options);
  };
})();
