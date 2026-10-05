(() => {
  'use strict';
  const session=new URLSearchParams(location.search).get('session')||'manual-duplicate',namespace='qa-canvas-duplicate:'+encodeURIComponent(session)+':';
  let hash=2166136261;for(const character of session)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const projectId='qa_duplicate_'+(hash>>>0).toString(16),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';window.TEMPLATE_DB_NAME=namespace+'templates';preferences.set('tapnow-playlist-intro-hidden','true');
  function pixels(color){const canvas=document.createElement('canvas');canvas.width=440;canvas.height=320;const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,440,320);context.fillStyle='#c6b98f';context.fillRect(30,30,90,140);context.fillStyle='#a57857';context.fillRect(195,170,180,85);return canvas.toDataURL('image/png');}
  const current=pixels('#596a59'),previous=pixels('#51657a');
  const group={id:'qa-duplicate-group',type:'group',title:'公开分组 · 子节点副本脱离',x:420.25,y:100.5,width:300,height:300,color:'#343434'};
  const source={id:'qa-duplicate-source',type:'image',title:'右键此图 → 副本',parentId:group.id,extent:'parent',image:current,fullImage:current,x:450.75,y:140.5,width:220,height:160,pixelWidth:440,pixelHeight:320,currentSourceFileId:'qa-current-file',currentImageOptionId:'qa-current-option',generation:{prompt:'公开图片的独立参数',model:'Tap Nano 2',count:1,cameraEnabled:false,refs:[]},provenance:{kind:'imported',mediaSource:current,model:null},imageHistory:[{id:'qa-old-batch',prompt:'公开旧历史',options:[{id:'qa-current-option',image:current,width:440,height:320},{id:'qa-old-option',image:previous,width:440,height:320}]}],versions:[{image:current},{image:previous}],historyVariantCount:2,historyVariantsHidden:false};
  const upstream={id:'qa-duplicate-upstream',type:'text',title:'原入边来源',textMode:'pure',content:'公开输入正文',x:120.25,y:120.5,width:220,height:180};
  const downstream={id:'qa-duplicate-downstream',type:'image',title:'原出边目标',image:previous,x:1130.75,y:140.5,width:220,height:160};
  const other={id:'qa-duplicate-other',type:'text',title:'目标已有参考',textMode:'pure',content:'已有order=9',x:1130.75,y:420.5,width:220,height:130};
  const seed={referenceWidth:1500,referenceHeight:900,nodes:[group,upstream,source,downstream,other],edges:[{id:'qa-incoming',source:upstream.id,target:source.id,order:3,sourceHandle:'right',targetHandle:'left',selected:true,custom:{purpose:'keep-input-meta'}},{id:'qa-outgoing',source:source.id,target:downstream.id,order:4,sourceHandle:'right',targetHandle:'left',purpose:'generation-input',custom:{purpose:'keep-output-meta'}},{id:'qa-target-existing',source:other.id,target:downstream.id,order:9,sourceHandle:'right',targetHandle:'left'}]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.CanvasDuplicateFixture={session,namespace,projectId,seed:structuredClone(seed),blockedAPIs:[],externalAttempts:[],saves:[],completedSaves:0};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),existing=store.get('project:'+projectId),now=Date.now();existing.onsuccess=()=>{if(!existing.result)store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'普通副本公开QA',createdAt:now,updatedAt:now},view:{x:0,y:0,scale:1},history:[],future:[]},'project:'+projectId);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('副本QA初始图未保存'));};};
  });
  window.fetch=async(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(target.origin!==location.origin&&!['blob:','data:'].includes(target.protocol)){fixture.externalAttempts.push(target.hostname);throw Error('副本QA禁止外部请求');}
    if(['/api/generation/config','/api/agent/config'].includes(target.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
    if(target.pathname.startsWith('/api/')){fixture.blockedAPIs.push(target.pathname);throw Error('副本QA不派发真实API');}
    return nativeFetch(input,options);
  };
})();
