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
  let latest=Promise.resolve(),saved=null,pending=0,error=null,saveError=null,editVersion=0,migrationReport=null;
  const enqueue=operation=>{
   pending++;
   const promise=latest.catch(()=>{}).then(operation).finally(()=>{pending--;});
   latest=promise;promise.catch(()=>{});return promise;
  };
  const api={
   async load(){return store?.readRecord?store.readRecord(recordKey):null;},
   baseline(chats,activeId){saved=JSON.stringify({chats,activeId});},
   save(chats,activeId){
    const value={chats:structuredClone(chats),activeId},serialized=JSON.stringify(value);
    if(serialized===saved&&!error)return true;
    const mirror=()=>{storage.setItem(project.storageKey('tapnow-agent-chats'),JSON.stringify(value.chats));storage.setItem(project.storageKey('tapnow-agent-active-chat'),activeId);};
    if(!store?.writeRecord){try{mirror();}catch(failure){error=failure;return false;}saved=serialized;error=null;return true;}
    // Capture each revision before yielding; a newer draft can queue during a write.
    editVersion++;saved=serialized;migrationReport=null;
    // IndexedDB owns new revisions. Preserve legacy snapshots as read-only
    // migration sources instead of duplicating growing conversations there.
    enqueue(async()=>{try{if(await store.writeRecord(recordKey,value)===false)throw Error('会话记录未能提交');error=null;saveError=null;}catch(failure){error=failure;saveError=failure;throw failure;}});return true;
   },
   migrationStatus(){return migrationReport?structuredClone(migrationReport):null;},
   migrateResources({migrate,getCurrent,applyCommitted,canCommit=()=>true}={}){
    if(typeof migrate!=='function'||typeof getCurrent!=='function'||typeof applyCommitted!=='function')return Promise.reject(Error('会话附件迁移尚未配置'));
    const version=editVersion,captured=structuredClone(getCurrent()),baseline=JSON.stringify(captured);
    const unchanged=()=>editVersion===version&&JSON.stringify(getCurrent())===baseline&&canCommit();
    const report=value=>{migrationReport=value;return structuredClone(value);};
    return enqueue(async()=>{
     let persisted=false;
     try{
      if(!store?.readRecord||!store?.writeRecord)throw Error('会话附件迁移需要本地数据库');
      if(saveError)throw saveError;
      if(!unchanged())return report({status:'local_edits',persisted:false,summary:null,diagnostics:[]});
      for(let attempt=0;attempt<3;attempt++){
       const authoritative=await store.readRecord(recordKey),original=authoritative||structuredClone(captured);
       const result=await migrate(structuredClone(original)),candidate=result?.snapshot;
       // Prove that migration only changed media slots. Actor previews have a
       // separate display contract; their tool arguments and bindings stay exact.
       const expected=structuredClone(original);
       for(const change of result?.changes||[]){
        const match=change.path?.match(/^\$\.chats\[(\d+)\](?:\.(messages|queuedMessages)\[(\d+)\])?\.uploads\[(\d+)\]\.(asset|image)$/);
        if(match){
         if(typeof change.ref!=='string'||!/^asset:[^\s]+$/.test(change.ref))throw Error('会话迁移改变了非附件字段，未保存');
         const chat=expected.chats?.[Number(match[1])],container=match[2]?chat?.[match[2]]?.[Number(match[3])]:chat,upload=container?.uploads?.[Number(match[4])];
         if(!upload||!['image','video'].includes(upload.type))throw Error('会话迁移附件位置无效，未保存');
         upload[match[5]]=change.ref;continue;
        }
        const actor=change.path?.match(/^\$\.chats\[(\d+)\]\.messages\[(\d+)\]\.result\.response\.actor\.reference_nodes\[(\d+)\]\.preview_url$/);
        if(!actor)throw Error('会话迁移改变了非附件字段，未保存');
        const [{isActorPreviewDataUrl},{prepareActorEmotion,actorEmotionUri}]=await Promise.all([import('./src/features/local-resource-migration/actor-previews.mjs'),import('./src/features/agent-apps/actor-emotion.mjs')]);
        const trace=expected.chats?.[Number(actor[1])]?.messages?.[Number(actor[2])];
        if(!isActorPreviewDataUrl(change.ref)||trace?.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error||trace.result?.kind!=='mcp_app'||trace.args?.resource_uri!==actorEmotionUri||trace.result.resource_uri!==actorEmotionUri)throw Error('会话迁移改变了非附件字段，未保存');
        const validate=response=>{const {version,title,summary,...data}=response||{},prepared=prepareActorEmotion(data,title);if(version!==1||summary!==prepared.summary)throw Error('人物预览记录无效，未保存');};
        validate(trace.result.response);
        const reference=trace.result.response.actor.reference_nodes[Number(actor[3])];
        if(!reference)throw Error('人物预览位置无效，未保存');
        reference.preview_url=change.ref;validate(trace.result.response);
       }
       if(!candidate||JSON.stringify(candidate)!==JSON.stringify(expected))throw Error('会话迁移改变了非附件字段，未保存');
       const summary=result.summary||null,diagnostics=(result.unresolved||[]).map(({path,code})=>({path,code}));
       if(!unchanged())return report({status:'local_edits',persisted:false,summary,diagnostics});
       if(!(result.changes||[]).length&&(authoritative||result.summary===null)){
        const serialized=JSON.stringify({chats:candidate.chats,activeId:candidate.activeId});
        // A previous write may have succeeded while its UI refresh failed.
        // Retrying must reconcile that committed record even with no new slots.
        if(authoritative&&result.summary!==null&&serialized!==baseline){persisted=true;saved=serialized;applyCommitted(structuredClone(candidate));}
        error=null;return report({status:result.status||'ready',persisted:false,summary,diagnostics});
       }
       try{if(await store.writeRecord(recordKey,structuredClone(candidate))===false)throw Error('会话附件迁移未能提交');}
       catch(failure){
        if(failure.name!=='AgentConversationConflictError')throw failure;
        if(attempt===2)return report({status:'local_edits',persisted:false,summary,diagnostics});
        continue;
       }
       persisted=true;error=null;
       // A draft edited while IndexedDB was committing owns the next queued
       // save. Never replace that live draft with the older migration snapshot.
       if(!unchanged())return report({status:'local_edits',persisted:true,summary,diagnostics});
       saved=JSON.stringify({chats:candidate.chats,activeId:candidate.activeId});
       applyCommitted(structuredClone(candidate));
       return report({status:result.status||'ready',persisted:true,summary,diagnostics});
      }
     }catch(failure){error=failure;report({status:'migration_failed',persisted,summary:null,diagnostics:[]});failure.persisted=persisted;throw failure;}
    });
   },
   get pending(){return pending;},
   get unsaved(){return pending>0||!!error;},
   async flush(){let promise;do{promise=latest;await promise;}while(promise!==latest);if(error)throw error;}
  };return api;
 }
 root.CanvasProjectContext={resolve,createOperations,createConversations};
 if(typeof module!=='undefined')module.exports=root.CanvasProjectContext;
})(typeof window!=='undefined'?window:globalThis);
