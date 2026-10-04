(() => {
  'use strict';
  const params=new URLSearchParams(location.search),session=params.get('session')||'manual-final-drop';
  const mode=['invalid','reverse','ordinary','compatible','occupied','escape'].includes(params.get('case'))?params.get('case'):'invalid';
  let hash=2166136261;for(const character of session+':'+mode)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const projectId='qa_final_drop_'+(hash>>>0).toString(16),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const namespace='qa-canvas-final-drop:'+encodeURIComponent(session)+':'+mode+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';preferences.set('tapnow-playlist-intro-hidden','true');
  const source={id:'qa-drop-source',type:'image',title:'图片来源 · 右侧加号',image:'/assets/tap-logo.webp',x:100.25,y:80.5,width:250,height:180};
  const target={id:'qa-drop-target',type:'video',title:'正式片 · 无效落点取消',image:null,video:null,x:700.25,y:80.5,width:320,height:180,hide_inputbar:true,generation:{model:'Seedance 2.5',draftVideoId:'qa-draft-file',draft:false,prompt:'',quality:'1080p',count:1}};
  if(['compatible','occupied'].includes(mode))Object.assign(source,{type:'video',title:'本地样片夹具 · 右侧加号',image:'/assets/tap-logo.webp',video:'/qa/playlist-red.mp4',currentSourceFileId:'qa-draft-file',generation:{model:'Seedance 2.5 Draft',draft:true,prompt:'本地视频仅用于连线测试'}});
  if(mode==='ordinary')Object.assign(target,{type:'text',title:'普通纯文本 · 无效落点保留菜单',textMode:'pure',content:'此节点不接受输入连线',generation:undefined,hide_inputbar:undefined});
  const seed={referenceWidth:1400,referenceHeight:900,nodes:[source,target],edges:mode==='occupied'?[{id:'qa-existing-draft-edge',source:source.id,target:target.id,purpose:'draft-reference'}]:[]};
  Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.CanvasFinalDropFixture={session,mode,projectId,namespace,seed:structuredClone(seed),events:[],externalAttempts:[],blockedAPIs:[]};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),read=store.get('project:'+projectId);
      read.onsuccess=()=>{if(read.result!==undefined)return;const now=Date.now();store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'正式片连线落点 QA',createdAt:now,updatedAt:now},view:{x:70,y:220,scale:.75},history:[],future:[]},'project:'+projectId);};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('QA 初始画布未保存'));};tx.onerror=()=>reject(tx.error);
    };
  });
  window.fetch=async(input,options={})=>{
    const targetURL=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(targetURL.origin!==location.origin&&!['blob:','data:'].includes(targetURL.protocol)){fixture.externalAttempts.push(targetURL.hostname);throw Error('连线 QA 禁止外部请求');}
    if(['/api/generation/config','/api/agent/config'].includes(targetURL.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
    if(targetURL.pathname.startsWith('/api/')){fixture.blockedAPIs.push(targetURL.pathname);throw Error('连线 QA 未配置生成；禁止调用生产 API');}
    return nativeFetch(input,options);
  };
})();
