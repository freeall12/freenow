const failure=(code,message,cause)=>Object.assign(Error(message),{code,...(cause?{cause}:{})});
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const validate=items=>{
  if(!Array.isArray(items)||items.some(s=>!s||typeof s!=='object'||typeof s.id!=='string'||!Array.isArray(s.assets))||new Set(items.map(s=>s.id)).size!==items.length)throw failure('library_unreadable','主体库结构无效，未修改原数据');
  return items;
};
const instances=[];
// Personal subjects stay shared across canvases. Agent and UI share the committed cache;
// old localStorage snapshots remain read-only migration sources.
export function getSubjectStore({storage=globalThis.localStorage,store=globalThis.CanvasStore||globalThis.window?.CanvasStore,storageKey,
  root=globalThis.window,notify=()=>globalThis.document?.dispatchEvent(new Event('subjects:changed'))}={}) {
  const base=storageKey||globalThis.window?.SUBJECT_LIBRARY_KEY||'tapnow-subject-library-v1';
  const legacyKey=base,recordKey='agent-subject-library:'+encodeURIComponent(base);
  const existing=instances.find(item=>item.storage===storage&&item.store===store&&item.legacyKey===legacyKey&&item.recordKey===recordKey);if(existing)return existing.api;
  const durable=typeof store?.readRecord==='function'&&typeof store?.writeRecord==='function';
  let items=[],loaded=false,hydration=null,latest=Promise.resolve(),pendingCount=0,migrationReport=null;
  const migrations=new Set();
  function legacy(){let raw,value;try{raw=storage?.getItem(legacyKey)??null;value=raw===null?[]:JSON.parse(raw);}catch(error){throw failure('library_unreadable','主体库读取失败或数据损坏，未修改原数据',error);}return {raw,items:validate(value)};}
  function emit(){try{notify();}catch{/* A notification cannot invalidate a committed receipt. */}}
  function enqueue(work){pendingCount++;const pending=latest.catch(()=>{}).then(work).finally(()=>{pendingCount--;});latest=pending;return pending;}
  async function persist(next){
    try{if(durable){if(await store.writeRecord(recordKey,{version:1,libraryKey:base,subjects:next})===false)throw Error('本地记录未能提交');}else storage.setItem(legacyKey,JSON.stringify(next));}
    catch(error){throw failure('subject_save_failed','主体保存失败：'+error.message+'；原主体库保持不变',error);}
    if(durable)items=next;migrationReport=null;emit();
  }
  const api={
    ready(){
      if(!durable)return Promise.resolve();if(loaded)return Promise.resolve();if(hydration)return hydration;
      hydration=Promise.resolve().then(async()=>{
        const record=await store.readRecord(recordKey);let next;
        if(record==null){next=legacy().items;if(next.length&&await store.writeRecord(recordKey,{version:1,libraryKey:base,subjects:next})===false)throw failure('subject_save_failed','旧主体库未能迁移，原数据保持不变');}
        else {if(record.version!==1||record.libraryKey!==base)throw failure('library_unreadable','主体库标识或版本不匹配，未修改原数据');next=validate(record.subjects);}
        items=structuredClone(next);loaded=true;emit();
      }).finally(()=>{hydration=null;});return hydration;
    },
    snapshot(){
      if(!durable)return legacy();if(!loaded)throw failure('library_not_ready','主体库尚未读取完成，请稍后重试');
      return {raw:JSON.stringify(items),items:structuredClone(items)};
    },
    list(scope){const values=durable?loaded?items:[]:legacy().items;return structuredClone(values.filter(s=>!s.deletedAt&&(!scope||s.scope===scope)));},
    async recoverySource(){
      await api.ready();const current=api.snapshot().items,serialized=JSON.stringify(current);
      // Keep old checkpoint fingerprints only while the legacy serialization
      // describes the exact authoritative contents; never use it as source data.
      try{const raw=storage?.getItem(legacyKey)??null;if(canonical(raw===null?[]:JSON.parse(raw))===canonical(current))return raw;}catch{/* An unavailable legacy mirror cannot invalidate authoritative subjects. */}
      return serialized;
    },
    write(snapshot,next,{guard=()=>{}}={}){
      const captured=structuredClone(validate(next));
      return enqueue(async()=>{
        await api.ready();guard();if(api.snapshot().raw!==snapshot.raw)throw failure('version_conflict','主体库在执行期间发生变化，请重新读取版本');
        await persist(captured);
      });
    },
    save(subject){
      const captured=structuredClone(subject);
      return enqueue(async()=>{
        await api.ready();const snapshot=api.snapshot(),at=snapshot.items.findIndex(s=>s.id===captured.id);
        // A stale editor must retain Agent receipts committed while it was open.
        if(at<0)snapshot.items.push(captured);else snapshot.items[at]={...captured,...(Array.isArray(snapshot.items[at].agentOperations)?{agentOperations:snapshot.items[at].agentOperations}:{})};
        await persist(validate(snapshot.items));
      });
    },
    archive(id){return enqueue(async()=>{await api.ready();const next=api.snapshot().items,subject=next.find(s=>s.id===id&&!s.deletedAt);if(subject){subject.deletedAt=Date.now();await persist(next);}});},
    migrationStatus(){return structuredClone(migrationReport);},
    migrateResources({indexState,index,fetchIndex,hashSource,migrate}={}){
      const pending=Promise.resolve().then(async()=>{
        await api.ready();
        if(!durable)throw failure('subject_store_unavailable','主体资源迁移需要本地数据库');
        const snapshot=api.snapshot();
        const resources=indexState||(index?{index,state:'ready'}:await(await import('../local-resource-migration/canvas-load.mjs')).loadResourceIndex({...(fetchIndex?{fetchIndex}:{})}));
        const report=value=>{migrationReport=value;emit();return structuredClone(value);};
        if(resources.state!=='ready')return report({status:resources.state,persisted:false,summary:null,diagnostics:[]});
        const migrateSnapshot=migrate||(await import('../local-resource-migration/snapshot.mjs')).migrateSubjectSnapshot;
        const result=await migrateSnapshot({version:1,libraryKey:base,subjects:snapshot.items},{index:resources.index,...(hashSource?{hashSource}:{})});
        const diagnostics=result.unresolved.map(({path,code})=>({path,code}));
        const summary={...result.summary},status=diagnostics.length?'pending_import':'ready';
        if(api.snapshot().raw!==snapshot.raw)return report({status:'local_edits',persisted:false,summary,diagnostics});
        if(!result.changes.length)return report({status,persisted:false,summary,diagnostics});
        try{await api.write(snapshot,result.snapshot.subjects);}
        catch(error){
          if(error.code==='version_conflict'||error.cause?.name==='AgentConversationConflictError')return report({status:'local_edits',persisted:false,summary,diagnostics});
          throw error;
        }
        return report({status,persisted:true,summary,diagnostics});
      }).catch(error=>{migrationReport={status:'migration_failed',persisted:false,summary:null,diagnostics:[]};emit();throw error;}).finally(()=>{migrations.delete(pending);});
      migrations.add(pending);return pending;
    },
    get pending(){return pendingCount>0||!!hydration||migrations.size>0;},
    async flush(){let pending;do{if(hydration)await hydration;await Promise.all([...migrations]);pending=latest;await pending;}while(pending!==latest||migrations.size||hydration);}
  };
  root?.CanvasProjects?.registerNavigationGuard(async()=>{
    if(!api.pending)return null;
    try{await api.flush();return null;}catch(error){return '主体库保存未完成：'+error.message;}
  });
  root?.addEventListener?.('beforeunload',event=>{if(api.pending){event.preventDefault();event.returnValue='';}});
  instances.push({storage,store,legacyKey,recordKey,api});return api;
}
export function readySubjects(){return getSubjectStore().ready();}
export function listSubjects(scope){return getSubjectStore().list(scope);}
export function saveSubject(subject){return getSubjectStore().save(subject);}
export function archiveSubject(id){return getSubjectStore().archive(id);}
export function assetFromNode(n) {
  const url = n.type === 'video' ? n.video || window.EDITOR_DATA?.nodes[n.id]?.video : n.type === 'audio' ? n.audio : n.fullImage || n.image;
  return {id:n.id, sourceNodeId:n.id, source:'canvas', type:n.type, name:n.title, url, image:n.image, text:n.content, durationMs:n.durationMs};
}
