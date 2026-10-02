/* Page identity is captured once: changing the URL cannot redirect a pending write. */
(function(root){
 'use strict';
 function resolve({projects=root.CanvasProjects,baseNamespace=root.CANVAS_DB_NAME||'tapnow-canvas-replica'}={}){
  const id=projects?.id()||'canvas',suffix=id==='canvas'?'':':project:'+id;
  return Object.freeze({id,storageKey:key=>key+suffix,namespace:baseNamespace+suffix});
 }
 function createOperations(){
  let pending=0;
  return {
   get pending(){return pending;},
   async track(operation){pending++;try{return await operation();}finally{pending--; }},
   guard({busy=false,running=false,activeRun=false}={}){
    if(busy||running||activeRun)return 'Agent 正在执行，请等待任务完成或明确停止后再切换项目';
    if(pending)return '附件、作品或 Agent 操作正在保存，请等待完成后再切换项目';
    return null;
   }
  };
 }
 function createConversations({project,storage,store}){
  const recordKey='agent-conversations:'+project.id;
  let latest=Promise.resolve(),saved=null,pending=0,error=null;
  return {
   async load(){return store?.readRecord?store.readRecord(recordKey):null;},
   baseline(chats,activeId){saved=JSON.stringify({chats,activeId});},
   save(chats,activeId){
    const value={chats:structuredClone(chats),activeId},serialized=JSON.stringify(value);
    if(serialized===saved&&!error)return true;
    const mirror=()=>{storage.setItem(project.storageKey('tapnow-agent-chats'),JSON.stringify(value.chats));storage.setItem(project.storageKey('tapnow-agent-active-chat'),activeId);};
    if(!store?.writeRecord){try{mirror();}catch(failure){error=failure;return false;}saved=serialized;error=null;return true;}
    // Capture each revision before yielding; a newer draft can queue during a write.
    pending++;saved=serialized;
    // IndexedDB owns new revisions. Preserve legacy snapshots as read-only
    // migration sources instead of duplicating growing conversations there.
    latest=latest.catch(()=>{}).then(()=>store.writeRecord(recordKey,value)).then(()=>{error=null;},failure=>{error=failure;throw failure;}).finally(()=>{pending--;});
    latest.catch(()=>{});return true;
   },
   get pending(){return pending;},
   get unsaved(){return pending>0||!!error;},
   async flush(){let promise;do{promise=latest;await promise;}while(promise!==latest);if(error)throw error;}
  };
 }
 root.CanvasProjectContext={resolve,createOperations,createConversations};
 if(typeof module!=='undefined')module.exports=root.CanvasProjectContext;
})(typeof window!=='undefined'?window:globalThis);
