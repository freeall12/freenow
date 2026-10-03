(() => {
  'use strict';
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(window.CANVAS_DB_NAME || 'tapnow-canvas-replica', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本地数据库被其他窗口占用'));
  });
  let latestSave = Promise.resolve();
  const revisions=new Map();
  const revisionOf=value=>Number.isSafeInteger(value?.storageRevision)?value.storageRevision:0;
  const currentId = () => window.CanvasProjects?.id() || 'canvas';
  function keyFor(id) {
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('画布项目标识无效');
    return id==='canvas'?'canvas':'project:'+id;
  }
  window.CanvasStore = {
    async readRecord(key) {
      if(typeof key!=='string'||!(/^(agent|comments)-/).test(key))throw Error('本地记录标识无效');
      const db=await database;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('documents'),request=tx.objectStore('documents').get(key);
        request.onsuccess=()=>{revisions.set(key,revisionOf(request.result));resolve(request.result);};request.onerror=()=>reject(request.error);
        tx.onabort=()=>reject(tx.error||new Error('本地记录读取中断'));
      });
    },
    writeRecord(key,value) {
      if(typeof key!=='string'||!(/^(agent|comments)-/).test(key))throw Error('本地记录标识无效');
      if(value===null||typeof value!=='object')throw Error('本地记录必须为对象');
      const snapshot=structuredClone(value),previous=latestSave;
      latestSave=previous.catch(()=>{}).then(()=>database).then(db=>new Promise((resolve,reject)=>{
        const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),request=store.get(key);
        let conflict=null,nextRevision=null;
        request.onsuccess=()=>{
          const expected=revisions.get(key),actual=revisionOf(request.result);
          if((expected===undefined&&request.result!==undefined)||(expected!==undefined&&expected!==actual)){
            const comments=key.startsWith('comments-');
            conflict=new Error('另一窗口已更新此项目的'+(comments?'评论':' Agent 会话')+'，当前修改尚未保存。请保留此页面并先处理版本冲突');conflict.name=comments?'CanvasCommentsConflictError':'AgentConversationConflictError';tx.abort();return;
          }
          nextRevision=actual+1;snapshot.storageRevision=nextRevision;store.put(snapshot,key);
        };
        request.onerror=()=>reject(request.error);
        tx.oncomplete=()=>{revisions.set(key,nextRevision);resolve();};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict||tx.error||new Error('本地记录保存中断'));
      }));
      return latestSave;
    },
    async load(id=currentId()) {
      const key=keyFor(id);
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx=db.transaction('documents'),request = tx.objectStore('documents').get(key);
        request.onsuccess = () => {revisions.set(key,revisionOf(request.result));resolve(request.result);};
        request.onerror = () => reject(request.error);
        tx.onabort=()=>reject(tx.error||new Error('本地画布读取中断'));
      });
    },
    save(state,id=currentId(),{preserveSnapshot=false,beforeCommit}={}) {
      // Capture synchronously; flush waits for the transaction, including writes queued during its wait.
      const complete=!preserveSnapshot&&window.CanvasProjects&&id===currentId()&&!state.project?window.CanvasApp?.projectSnapshot?.():null;
      const snapshot = structuredClone(complete?{...complete,...state}:state),key=keyFor(id);
      if(snapshot.project?.id&&snapshot.project.id!==id)throw Error('画布快照与保存项目不匹配');
      const previous=latestSave;
      const ready=window.CanvasProjects?previous.catch(()=>{}).then(()=>database):database;
      latestSave = ready.then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        let conflict=null,nextRevision=null;
        const store=tx.objectStore('documents');
        const canCommit=()=>{
          if(typeof beforeCommit!=='function')return true;
          try{if(beforeCommit()===true)return true;conflict=new Error('画布快照已变化，已停止资源迁移以保护当前修改');conflict.name='CanvasSnapshotChangedError';}
          catch(error){conflict=error;}
          tx.abort();return false;
        };
        // Compare inside the same read/write transaction. Another tab cannot
        // replace a newer graph with a stale whole-document snapshot.
        if(window.CanvasProjects){
          const request=store.get(key);
          request.onsuccess=()=>{
            if(!canCommit())return;
            const expected=revisions.get(key),actual=revisionOf(request.result);
            if((expected===undefined&&request.result!==undefined)||(expected!==undefined&&expected!==actual)){
              conflict=new Error('另一窗口已更新此画布，当前修改尚未保存。请保留此页面并先处理版本冲突');conflict.name='CanvasProjectConflictError';tx.abort();return;
            }
            // Older feature adapters save only the graph. Retain metadata even
            // before the app snapshot adapter is available; active saves use its
            // current history and viewport above.
            for(const field of ['project','view','history','future'])if(snapshot[field]===undefined&&request.result?.[field]!==undefined)snapshot[field]=request.result[field];
            nextRevision=actual+1;snapshot.storageRevision=nextRevision;store.put(snapshot,key);
          };
          request.onerror=()=>reject(request.error);
        }else if(canCommit())store.put(snapshot,key);
        tx.oncomplete = () => {if(nextRevision!==null)revisions.set(key,nextRevision);resolve();};
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(conflict||tx.error || new Error('本地保存中断'));
      }));
      return latestSave;
    },
    async listProjects() {
      await window.CanvasResourceDisplayReady;
      const displayRef=value=>window.CanvasResourceDisplay?.displayMediaRef(value)??(typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:'');
      const db=await database;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('documents'),request=tx.objectStore('documents').openCursor(),projects=[];
        request.onsuccess=()=>{
          const cursor=request.result;
          if(!cursor){
            if(!projects.some(project=>project.id==='canvas'))projects.push({id:'canvas',title:'Waste to energy (copy)',updatedAt:null,nodeCount:null,thumbnail:null});
            resolve(projects.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));return;
          }
          const key=cursor.key,id=key==='canvas'?'canvas':typeof key==='string'&&key.startsWith('project:')?key.slice(8):null;
          if(id&&/^[A-Za-z0-9_-]{1,100}$/.test(id)){
            const value=cursor.value,metadata=value?.project||{},nodes=Array.isArray(value?.nodes)?value.nodes:[];
            const images=nodes.filter(node=>typeof node.image==='string'&&!node.image.startsWith('blob:')),thumbnail=images.map(node=>displayRef(node.image)).find(Boolean)||null,thumbnailPendingImport=images.some(node=>!displayRef(node.image));
            projects.push({id,title:metadata.title||(id==='canvas'?'Waste to energy (copy)':'未命名画布'),createdAt:metadata.createdAt||null,updatedAt:metadata.updatedAt||null,nodeCount:nodes.length,thumbnail,thumbnailPendingImport});
          }
          cursor.continue();
        };
        request.onerror=()=>reject(request.error);
        tx.onabort=()=>reject(tx.error||new Error('本地画布列表读取中断'));
      });
    },
    async flush() {
      let pending;
      do { pending = latestSave; await pending; } while (pending !== latestSave);
    }
  };
})();
