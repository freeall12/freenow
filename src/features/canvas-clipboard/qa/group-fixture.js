(() => {
  'use strict';
  const session=new URLSearchParams(location.search).get('session')||'manual-group-copy',namespace='qa-canvas-group-copy:'+encodeURIComponent(session)+':';
  let hash=2166136261;for(const character of session)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const projectId='qa_group_copy_'+(hash>>>0).toString(16),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';window.TEMPLATE_DB_NAME=namespace+'templates';preferences.set('tapnow-playlist-intro-hidden','true');
  function pixels(color){const canvas=document.createElement('canvas');canvas.width=440;canvas.height=320;const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,440,320);context.fillStyle='#c6b98f';context.fillRect(30,30,90,140);context.fillStyle='#a57857';context.fillRect(195,170,180,85);return canvas.toDataURL('image/png');}
  const current=pixels('#596a59'),previous=pixels('#51657a');
  const outer={id:'qa-copy-outer',type:'group',title:'原外层组 · 不随内组复制',x:280.125,y:80.25,width:580,height:520,groupColor:'#33403455'};
  const group={id:'qa-copy-group',type:'group',title:'复制此嵌套组',parentId:outer.id,extent:'parent',x:320.25,y:120.5,width:400,height:390,groupColor:'#4c443255'};
  const source={id:'qa-copy-image',type:'image',title:'复制此图片',parentId:group.id,extent:'parent',image:current,fullImage:current,x:350.75,y:165.5,width:220,height:160,pixelWidth:440,pixelHeight:320,currentSourceFileId:'qa-current-file',currentImageOptionId:'qa-current-option',generation:{prompt:'公开图片的独立参数',model:'Tap Nano 2',count:1,cameraEnabled:false,refs:[]},provenance:{kind:'imported',mediaSource:current,model:null},imageHistory:[{id:'qa-old-batch',options:[{id:'qa-current-option',image:current},{id:'qa-old-option',image:previous}]}],versions:[{image:current},{image:previous}],historyVariantCount:2,historyVariantsHidden:false,loading:true,taskInfo:{status:'PROCESSING'},workflowRecoveryResult:{nodeId:'qa-copy-image',runId:'qa-synthetic-owner'}};
  const peer={id:'qa-copy-text',type:'text',title:'Shift点此文本加入多选',parentId:group.id,extent:'parent',textMode:'pure',content:'多选图片 + 此文本；当前图内边order=4',x:365.5,y:375.75,width:240,height:100};
  const upstream={id:'qa-copy-upstream',type:'text',title:'外部入边保留',textMode:'pure',content:'入边order=3',x:60.25,y:145.5,width:220,height:140};
  const downstream={id:'qa-copy-downstream',type:'image',title:'外部出边不复制',image:previous,x:1120.75,y:210.5,width:220,height:160};
  const seed={referenceWidth:1500,referenceHeight:900,nodes:[outer,group,upstream,source,peer,downstream],edges:[{id:'qa-copy-incoming',source:upstream.id,target:source.id,order:3,sourceHandle:'right',targetHandle:'left',selected:true,custom:{purpose:'keep-external-input'}},{id:'qa-copy-internal',source:source.id,target:peer.id,order:4,sourceHandle:'right',targetHandle:'left',purpose:'generation-input',custom:{purpose:'keep-internal'}},{id:'qa-copy-outgoing',source:peer.id,target:downstream.id,order:9,sourceHandle:'right',targetHandle:'left',custom:{purpose:'exclude-outgoing'}}]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.CanvasDuplicateFixture={session,namespace,projectId,seed:structuredClone(seed),blockedAPIs:[],externalAttempts:[],saves:[],completedSaves:0};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),existing=store.get('project:'+projectId),now=Date.now();existing.onsuccess=()=>{if(!existing.result)store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'分组多选复制公开QA',createdAt:now,updatedAt:now},view:{x:0,y:0,scale:1},history:[],future:[]},'project:'+projectId);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('副本QA初始图未保存'));};};
  });
  window.fetch=async(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(target.origin!==location.origin&&!['blob:','data:'].includes(target.protocol)){fixture.externalAttempts.push(target.hostname);throw Error('副本QA禁止外部请求');}
    if(['/api/generation/config','/api/agent/config'].includes(target.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
    if(target.pathname.startsWith('/api/')){fixture.blockedAPIs.push(target.pathname);throw Error('副本QA不派发真实API');}
    return nativeFetch(input,options);
  };
})();
