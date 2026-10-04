(() => {
  'use strict';
  const query=new URLSearchParams(location.search),session=query.get('session')||'manual-panorama',mode=query.get('case')||'success',namespace='qa-hunyuan-panorama:'+encodeURIComponent(session)+':';
  const projectId='qa_panorama_'+session.replace(/[^a-z0-9]/gi,'_').slice(-60),url=new URL(location.href);url.searchParams.set('project',projectId);history.replaceState(null,'',url);
  const preferences=new Map(),nativeFetch=window.fetch.bind(window);
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
  window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';window.TEMPLATE_DB_NAME=namespace+'templates';preferences.set('tapnow-playlist-intro-hidden','true');
  function pixels(width,height){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.fillStyle='#bfa082';context.fillRect(0,0,width,height);context.fillStyle='#697b69';context.fillRect(0,height*.65,width,height*.35);context.fillStyle='#f0e5d1';context.fillRect(width*.2,height*.15,width*.2,height*.5);return canvas.toDataURL('image/png');}
  const source={id:'qa-panorama-source',type:'image',title:'公开源图夹具',image:pixels(512,320),x:260,y:100,width:250,height:160};
  const target={id:'qa-panorama-target',type:'image',title:'图生360全景 · 公开测试',x:650,y:100,width:350,height:175,generation:{model:'Hunyuan World Panorama',modelId:'hunyuan-world-panorama',prompt:'保持公开测试房间结构，扩展完整360度空间',ratio:'2:1',isPanoramaPrompt:true,count:1,cameraEnabled:false,refs:[]}};
  const seed={referenceWidth:1400,referenceHeight:900,nodes:[source,target],edges:[{id:'qa-panorama-edge',source:source.id,target:target.id,sourceHandle:'right',targetHandle:'left'}]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
  const fixture=window.PanoramaNativeFixture={session,namespace,projectId,mode,seed:structuredClone(seed),requests:[],blockedAPIs:[],externalAttempts:[],receipts:new Map()};
  fixture.metadata={configured:mode!=='unconfigured',protocol:'fal-panorama-native',capabilities:{kinds:['image.generate'],models:{'hunyuan-world-panorama':{kind:'image.generate'}},panorama:{'hunyuan-world-panorama':{source:'image',maxImages:1,maxCount:1,projection:'equirectangular',fixedAspectRatio:'2:1',nativeSize:true,editing:false,maxInputBytes:20971520,maxOutputBytes:33554432,inputMimeTypes:['image/png'],outputMimeTypes:['image/png'],pngProfile:'noninterlaced-8bit-rgb-rgba'}},imageReferences:{'hunyuan-world-panorama':{maxImages:1,mimeTypes:['image/png'],transport:'inline'}}}};
  fixture.seedReady=new Promise((resolve,reject)=>{
    const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),now=Date.now(),existing=store.get('project:'+projectId);existing.onsuccess=()=>{if(!existing.result)store.put({...structuredClone(seed),version:1,storageRevision:1,project:{id:projectId,title:'Hunyuan全景公开QA',createdAt:now,updatedAt:now},view:{x:0,y:0,scale:1},history:[],future:[]},'project:'+projectId);};const receipts=store.get('qa-panorama-receipts');receipts.onsuccess=()=>{for(const [id,receipt]of receipts.result||[])fixture.receipts.set(id,receipt);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error||Error('全景QA初始图未保存'));};};
  });
  fixture.persistReceipts=async()=>{await fixture.seedReady;return new Promise((resolve,reject)=>{const request=indexedDB.open(window.CANVAS_DB_NAME,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('documents','readwrite');tx.objectStore('documents').put([...fixture.receipts],'qa-panorama-receipts');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});};
  fixture.finish=async()=>{for(const receipt of fixture.receipts.values())receipt.status='succeeded';await fixture.persistReceipts();};
  window.fetch=async(input,options={})=>{
    const targetUrl=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(targetUrl.origin!==location.origin&&!['blob:','data:'].includes(targetUrl.protocol)){fixture.externalAttempts.push(targetUrl.hostname);throw Error('全景QA禁止外部请求');}
    if(targetUrl.pathname==='/api/generation/config')return Response.json(fixture.metadata);
    if(targetUrl.pathname==='/api/agent/config')return Response.json({configured:false});
    if(targetUrl.pathname==='/api/generation/tasks'&&options.method==='POST'){
      await fixture.seedReady;const request=JSON.parse(options.body);fixture.requests.push(request);const id='qa-panorama-task-'+(fixture.receipts.size+1);
      const output={type:'image',url:mode==='decode-fail'?'data:image/png;base64,YmFk':pixels(mode==='wrong-ratio'?128:256,128),mime:'image/png',width:256,height:128,sourceFileId:id};
      const receipt={id,status:mode==='deferred'?'running':mode==='unknown'?'unknown':'succeeded',outputs:[output],request,progress:100};fixture.receipts.set(id,receipt);await fixture.persistReceipts();return Response.json(receipt);
    }
    if(targetUrl.pathname.startsWith('/api/generation/tasks/')){
      await fixture.seedReady;const id=decodeURIComponent(targetUrl.pathname.split('/').at(-1)),receipt=fixture.receipts.get(id);if(!receipt)return Response.json({error:'公开夹具任务不存在'},{status:404});
      if(options.method==='DELETE'){receipt.status='cancelled';await fixture.persistReceipts();return Response.json({...receipt,cancellation:{outcome:'cancel_requested',providerCancellation:'unconfirmed'}});}
      return Response.json(receipt);
    }
    if(targetUrl.pathname.startsWith('/api/')){fixture.blockedAPIs.push(targetUrl.pathname);throw Error('全景QA未配置真实API');}
    return nativeFetch(input,options);
  };
})();
