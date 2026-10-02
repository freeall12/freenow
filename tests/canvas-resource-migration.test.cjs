'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const loaded=import('../src/features/local-resource-migration/canvas-load.mjs');
const source='https://files.tapnow.media/private/source.png?signature=private-value';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const index={version:1,algorithm:'sha256-exact-utf8',entries:{[digest(source)]:{ref:'/assets/known.png',sha256:'a'.repeat(64),bytes:128}}};
function snapshot(){return {version:1,storageRevision:7,project:{id:'a',title:'Personal name',createdAt:12,updatedAt:20},view:{x:15.125,y:-2.625,scale:.7},nodes:[{id:'node',type:'image',x:1,y:2,width:100,height:100,image:source,generation:{prompt:source}}],edges:[],history:[{nodes:[{id:'undo',type:'video',x:3,y:4,width:100,height:100,video:source}],edges:[]}],future:[{nodes:[{id:'redo',type:'image',x:5,y:6,width:100,height:100,fullImage:source}],edges:[]}]};}
function optimisticStore(initial,{beforeSave,readError,saveError}={}){
  let record=structuredClone(initial),expected=initial.storageRevision||0;
  const calls={loads:0,saves:[],options:[]};
  const store={
    async load(){calls.loads++;if(readError)throw readError;expected=record.storageRevision||0;return structuredClone(record);},
    async save(next,id,options){calls.saves.push(structuredClone(next));calls.options.push(options);await beforeSave?.(calls.saves.length,{replace:value=>record=structuredClone(value)});if(options.beforeCommit()!==true)throw Object.assign(Error('edited'),{name:'CanvasSnapshotChangedError'});if(saveError)throw saveError;if(expected!==(record.storageRevision||0))throw Object.assign(Error('stale'),{name:'CanvasProjectConflictError'});record={...structuredClone(next),storageRevision:expected+1};expected++;}
  };
  return {store,calls,get:()=>structuredClone(record)};
}
const ready={index,state:'ready'};

test('known resources in current nodes and undo/redo migrate once without changing project view prompt or graph structure',async()=>{
  const {migrateLoadedCanvas}=await loaded,original=snapshot(),f=optimisticStore(original);
  const report=await migrateLoadedCanvas({saved:original,store:f.store,id:'a',indexState:ready});assert.equal(report.persisted,true);assert.equal(report.summary.changed,3);assert.equal(report.status,'ready');assert.equal(f.calls.saves.length,1);assert.equal(f.calls.options[0].preserveSnapshot,true);assert.equal(original.nodes[0].image,source);
  const saved=f.get();assert.equal(saved.nodes[0].image,'/assets/known.png');assert.equal(saved.history[0].nodes[0].video,'/assets/known.png');assert.equal(saved.future[0].nodes[0].fullImage,'/assets/known.png');assert.equal(saved.nodes[0].generation.prompt,source);assert.deepEqual(saved.project,original.project);assert.deepEqual(saved.view,original.view);assert.deepEqual(saved.edges,original.edges);assert.equal(saved.storageRevision,8);
});
test('local or unmatched resources remain intact; an empty legal public index reports pending import without writing',async()=>{
  const {migrateLoadedCanvas,migrationNoticeText}=await loaded,original=snapshot(),f=optimisticStore(original),empty={version:1,algorithm:index.algorithm,entries:{}};
  const report=await migrateLoadedCanvas({saved:original,store:f.store,id:'a',indexState:{index:empty,state:'ready'}});assert.equal(report.status,'pending_import');assert.equal(report.persisted,false);assert.equal(report.summary.unresolved,3);assert.equal(f.calls.saves.length,0);assert.equal(report.snapshot.nodes[0].image,source);const notice=migrationNoticeText(report);assert.match(notice,/3 项/);assert.equal(notice.includes('private-value'),false);assert.equal(notice.includes('tapnow'),false);
  const local=snapshot();local.nodes[0].image='/assets/local.png';local.history=[];local.future=[];const report2=await migrateLoadedCanvas({saved:local,store:f.store,id:'a',indexState:ready});assert.equal(report2.status,'ready');assert.equal(report2.persisted,false);assert.equal(f.calls.saves.length,0);
});
test('404 missing index and invalid JSON schema remain explicit repair states, preserving original snapshot',async()=>{
  const {loadResourceIndex,migrateLoadedCanvas,migrationNoticeText}=await loaded;
  for(const [response,state]of [[{ok:false,status:404},'index_missing'],[{ok:true,json:async()=>({entries:{}})},'index_invalid'],[{ok:true,json:async()=>{throw Error('signed secret');}},'index_invalid']]){
    const indexState=await loadResourceIndex({fetchIndex:async()=>response});assert.equal(indexState.state,state);const f=optimisticStore(snapshot());const report=await migrateLoadedCanvas({saved:snapshot(),store:f.store,id:'a',indexState});assert.equal(report.status,state);assert.equal(report.persisted,false);assert.equal(f.calls.saves.length,0);assert.equal(report.snapshot.nodes[0].image,source);assert.match(migrationNoticeText(report),/待修复/);assert.equal(migrationNoticeText(report).includes('secret'),false);
  }
});
test('same-origin index loading keeps successful empty table distinct from unavailable fetch',async()=>{
  const {loadResourceIndex}=await loaded;let observed;
  const result=await loadResourceIndex({fetchIndex:async(...args)=>{observed=args;return {ok:true,json:async()=>({version:1,algorithm:index.algorithm,entries:{}})};}});assert.equal(result.state,'ready');assert.equal(observed[0],'/assets/local-resource-index.json');assert.equal(observed[1].cache,'no-store');assert.equal(observed[1].credentials,'same-origin');assert.equal((await loadResourceIndex({fetchIndex:async()=>{throw Error('secret');}})).state,'index_unavailable');
});
test('CAS conflict re-reads the new graph and migrates that exact newer state without replacing other-window edits',async()=>{
  const {migrateLoadedCanvas}=await loaded,initial=snapshot(),newer=snapshot();newer.storageRevision=8;newer.project.title='Other window title';newer.nodes.push({id:'new',type:'text',x:0,y:0,width:100,height:100,content:'Other window work'});
  const f=optimisticStore(initial,{beforeSave:(attempt,control)=>{if(attempt===1)control.replace(newer);}});const report=await migrateLoadedCanvas({saved:initial,store:f.store,id:'a',indexState:ready});assert.equal(report.persisted,true);assert.equal(f.calls.loads,1);assert.equal(f.calls.saves.length,2);assert.equal(f.get().storageRevision,9);assert.equal(f.get().project.title,'Other window title');assert.equal(f.get().nodes[1].content,'Other window work');assert.equal(f.get().nodes[0].image,'/assets/known.png');
});
test('new local edits during asynchronous migration stop all writes and retain original snapshot',async()=>{
  const {migrateLoadedCanvas}=await loaded,{migrateCanvasSnapshot}=await import('../src/features/local-resource-migration/snapshot.mjs');let editing=false;const f=optimisticStore(snapshot());
  const report=await migrateLoadedCanvas({saved:snapshot(),store:f.store,id:'a',indexState:ready,canCommit:()=>!editing,migrate:async(...args)=>{const result=await migrateCanvasSnapshot(...args);editing=true;return result;}});assert.equal(report.status,'local_edits');assert.equal(report.persisted,false);assert.equal(f.calls.saves.length,0);assert.equal(report.snapshot.nodes[0].image,source);
});
test('transaction commit gate refuses writes queued before local edits begin',async()=>{
  const {migrateLoadedCanvas}=await loaded;let editing=false;const f=optimisticStore(snapshot(),{beforeSave:()=>{editing=true;}});const report=await migrateLoadedCanvas({saved:snapshot(),store:f.store,id:'a',indexState:ready,canCommit:()=>!editing});assert.equal(report.status,'local_edits');assert.equal(report.persisted,false);assert.equal(f.get().storageRevision,7);assert.equal(f.get().nodes[0].image,source);
});
test('conflict retries are bounded and failed re-read or save stays rejected instead of reporting completion',async()=>{
  const {migrateLoadedCanvas}=await loaded;
  const alwaysConflict=Object.assign(Error('stale'),{name:'CanvasProjectConflictError'}),f=optimisticStore(snapshot(),{saveError:alwaysConflict});await assert.rejects(migrateLoadedCanvas({saved:snapshot(),store:f.store,id:'a',indexState:ready}),{name:'CanvasProjectConflictError'});assert.equal(f.calls.saves.length,3);assert.equal(f.calls.loads,2);
  const unreadable=optimisticStore(snapshot(),{saveError:alwaysConflict,readError:Error('read failed')});await assert.rejects(migrateLoadedCanvas({saved:snapshot(),store:unreadable.store,id:'a',indexState:ready}),/read failed/);
  const full=optimisticStore(snapshot(),{saveError:Object.assign(Error('full'),{name:'QuotaExceededError'})});await assert.rejects(migrateLoadedCanvas({saved:snapshot(),store:full.store,id:'a',indexState:ready}),{name:'QuotaExceededError'});assert.equal(full.calls.loads,0);
});
test('invalid initial or conflict-reloaded graphs can never be written by migration',async()=>{
  const {migrateLoadedCanvas}=await loaded,f=optimisticStore(snapshot());await assert.rejects(migrateLoadedCanvas({saved:{nodes:[],edges:[]},store:f.store,id:'a',indexState:ready}),/格式无效/);assert.equal(f.calls.saves.length,0);
  const broken=optimisticStore(snapshot(),{beforeSave:(attempt,control)=>{if(attempt===1)control.replace({storageRevision:8,nodes:[],edges:[]});}});await assert.rejects(migrateLoadedCanvas({saved:snapshot(),store:broken.store,id:'a',indexState:ready}),/读取的画布数据无效/);assert.equal(broken.get().storageRevision,8);
});

test('production IndexedDB save commit guard rejects before put and leaves revision/record unchanged',async()=>{
  const code=fs.readFileSync(require.resolve('../canvas-store.js'),'utf8'),original=snapshot(),values=new Map([['project:a',original]]);let openRequest,puts=0;
  const db={transaction:()=>{const tx={abort(){queueMicrotask(()=>tx.onabort());},objectStore:()=>({get:key=>{const request={};queueMicrotask(()=>{request.result=structuredClone(values.get(key));request.onsuccess();});return request;},put:(state,key)=>{puts++;values.set(key,structuredClone(state));queueMicrotask(()=>tx.oncomplete());}})};return tx;}};
  const context=vm.createContext({window:{CanvasProjects:{id:()=> 'a'},CanvasApp:{projectSnapshot:()=>{throw Error('must not enrich migrating snapshot');}}},structuredClone,queueMicrotask,indexedDB:{open:()=>openRequest={}}});vm.runInContext(code,context);openRequest.result=db;openRequest.onsuccess();await context.window.CanvasStore.load();await assert.rejects(context.window.CanvasStore.save(original,'a',{preserveSnapshot:true,beforeCommit:()=>false}),{name:'CanvasSnapshotChangedError'});assert.equal(puts,0);assert.deepEqual(values.get('project:a'),original);
});

test('field-level repair diagnostics expose only safe positions and never source URL prompt or node ID',async()=>{
  const {migrateLoadedCanvas,diagnosticLabel}=await loaded,original=snapshot(),f=optimisticStore(original),empty={version:1,algorithm:index.algorithm,entries:{}};original.nodes[0].id='private-node-secret';
  const report=await migrateLoadedCanvas({saved:original,store:f.store,id:'a',indexState:{index:empty,state:'ready'}});const serialized=JSON.stringify(report.diagnostics);assert.equal(serialized.includes('private-value'),false);assert.equal(serialized.includes('private-node-secret'),false);assert.equal(serialized.includes(source),false);assert.equal(report.diagnostics.length,3);assert.match(diagnosticLabel(report.diagnostics[0]),/当前画布 · 节点 1 · 图片/);assert.match(diagnosticLabel(report.diagnostics[1]),/撤销历史 1 · 节点 1 · 视频/);assert.equal(diagnosticLabel({path:'private-node-secret/'+source,code:'private-value'}).includes('private'),false);
});

async function productionHydration({beforeSave}={}){
  const migration=await loaded,saved=snapshot(),store=optimisticStore(saved,{beforeSave}),sourceCode=fs.readFileSync(require.resolve('../app.js'),'utf8'),notices=[],hydrations=[];
  const context=vm.createContext({window:{CanvasStore:store.store,CanvasProjects:{id:()=> 'a',isDefault:()=>false,hydrate:state=>hydrations.push(structuredClone(state)),markDirty:()=>{}},CanvasNavigation:require('../canvas-navigation.js'),fetch:async()=>({ok:true,json:async()=>index})},migrationModule:{...migration,showMigrationNotice:report=>notices.push(structuredClone(report))},structuredClone,nodes:[],edges:[],original:new Map(),view:{x:0,y:0,scale:1},viewStorageKey:'view',lastSavedView:'',history:[],future:[],localChanges:0,graphLoaded:false,graphReadFailed:false,resourceMigrationStatus:null,localStorage:{getItem:()=>null},generationSignature:()=>'',clearOrphanGenerationState:()=>{},rebuild:()=>{},persist:()=>{throw Error('hydration must not persist edited initial graph');},storageError:error=>notices.push({error:error.name||'Error'})});
  let tail=sourceCode.slice(sourceCode.indexOf('  window.CanvasStore.load().then'),sourceCode.lastIndexOf('\n})();')).trim().replace("await import('./src/features/local-resource-migration/canvas-load.mjs')",'migrationModule');
  return {context,store,notices,hydrations,run(){vm.runInContext('globalThis.hydration='+tail,context);return context.hydration;}};
}
test('production hydration receives the persisted mapped snapshot with original title viewport and undo/redo',async()=>{
  const f=await productionHydration();await f.run();assert.equal(f.context.graphLoaded,true);assert.equal(f.context.graphReadFailed,false);assert.equal(f.context.nodes[0].image,'/assets/known.png');assert.equal(f.context.history[0].nodes[0].video,'/assets/known.png');assert.equal(f.context.future[0].nodes[0].fullImage,'/assets/known.png');assert.equal(f.context.view.x,15.125);assert.equal(f.hydrations[0].project.title,'Personal name');assert.equal(f.store.get().storageRevision,8);
});
test('production hydration refuses to replace or auto-save local work that starts while migration commit waits',async()=>{
  let page;page=await productionHydration({beforeSave:()=>{page.context.localChanges++;page.context.nodes=[{id:'local-edit',title:'Keep in memory'}];}});await page.run();assert.equal(page.context.graphLoaded,false);assert.equal(page.context.graphReadFailed,true);assert.equal(page.context.nodes[0].title,'Keep in memory');assert.equal(page.hydrations.length,0);assert.equal(page.store.get().storageRevision,7);assert.equal(page.store.get().nodes[0].image,source);assert.equal(page.context.resourceMigrationStatus.status,'local_edits');
});

test('production hydration protects edits arriving after migration put while its commit completion is pending',async()=>{
  const f=await productionHydration(),save=f.store.store.save;
  f.store.store.save=async(...args)=>{await save(...args);await new Promise(resolve=>setImmediate(resolve));f.context.localChanges++;f.context.nodes=[{id:'late-edit',title:'Keep late edit'}];};
  await f.run();assert.equal(f.store.calls.saves.length,1);assert.equal(f.store.get().storageRevision,8);assert.equal(f.store.get().nodes[0].image,'/assets/known.png');assert.equal(f.context.graphLoaded,false);assert.equal(f.context.graphReadFailed,true);assert.equal(f.context.nodes[0].title,'Keep late edit');assert.equal(f.hydrations.length,0);assert.equal(f.context.resourceMigrationStatus.status,'local_edits');assert.equal(f.context.resourceMigrationStatus.persisted,true);
});
