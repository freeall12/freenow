'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const coreSource=fs.readFileSync(require.resolve('../src/features/canvas-projects/core.js'),'utf8');
const storeSource=fs.readFileSync(require.resolve('../canvas-store.js'),'utf8');
const appSource=fs.readFileSync(require.resolve('../app.js'),'utf8');
const tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function page({id='canvas',href='http://localhost:4173/?session=keep',values=new Map(),store,app}={}){
  const navigations=[],listeners={},button={textContent:'',setAttribute(){}},saved=[],reads=[],transactions=[];
  let openRequest;
  const db={transaction:(_name,mode)=>{
    const tx={abort(){queueMicrotask(()=>tx.onabort?.());},objectStore:()=>({
      put:(snapshot,key)=>{tx.snapshot=structuredClone(snapshot);tx.key=key;transactions.push(tx);},
      get:key=>{const request={};reads.push(key);queueMicrotask(()=>{request.result=structuredClone(values.get(key));request.onsuccess?.();});return request;},
      openCursor:()=>{const request={},entries=[...values],next=()=>queueMicrotask(()=>{const entry=entries.shift();request.result=entry?{key:entry[0],value:structuredClone(entry[1]),continue:next}:null;request.onsuccess?.();});next();return request;}
    })};return tx;
  }};
  const location={href:id==='canvas'?href:href+'&project='+id,assign:url=>navigations.push(url)};
  const window={addEventListener:(event,handler)=>listeners[event]=handler,CanvasApp:app||{prepareProjectNavigation:async()=>{}},CanvasStore:store};
  const context=vm.createContext({window,document:{querySelector:()=>button,title:''},location,URL,Date,Error,crypto:{randomUUID:()=> 'created-project'},structuredClone,indexedDB:{open:()=>openRequest={}},queueMicrotask});
  vm.runInContext(coreSource,context);
  if(!store){vm.runInContext(storeSource,context);openRequest.result=db;openRequest.onsuccess();}
  return {projects:window.CanvasProjects,store:window.CanvasStore,window,context,listeners,location,navigations,button,values,reads,transactions,commit(index=0){const tx=transactions[index];values.set(tx.key,tx.snapshot);tx.oncomplete();},abort(index=0,error=Object.assign(Error('full'),{name:'QuotaExceededError'})){const tx=transactions[index];tx.error=error;tx.onabort();}};
}
const graph=(id,title)=>({version:1,nodes:[{id,type:'image',x:1,y:2,width:100,height:100,title}],edges:[]});

test('default identity preserves legacy document URL options and original storage keys',()=>{
  const f=page();assert.equal(f.projects.id(),'canvas');assert.equal(f.projects.current().title,'未命名画布');assert.equal(f.projects.storageKey('tapnow-canvas-view-v1'),'tapnow-canvas-view-v1');assert.equal(f.projects.namespace('assets'),'assets');assert.equal(new URL(f.projects.url('new')).searchParams.get('session'),'keep');assert.equal(new URL(f.projects.url('canvas')).searchParams.has('project'),false);
});
test('identity and storage namespace stay fixed even if another tab or same-page URL changes',()=>{
  const a=page({id:'a'}),b=page({id:'b'});a.location.href='http://localhost:4173/?project=b';assert.equal(a.projects.id(),'a');assert.equal(b.projects.id(),'b');assert.equal(a.projects.storageKey('view'),'view:project:a');assert.equal(a.projects.namespace('assets'),'assets:project:a');
});
test('two tabs save identical node IDs under distinct project keys and preserve the legacy canvas',async()=>{
  const values=new Map([['canvas',graph('legacy','Legacy')]]),a=page({id:'a',values}),b=page({id:'b',values});
  const first=graph('same','Project A'),sa=a.store.save(first),sb=b.store.save(graph('same','Project B'));first.nodes[0].title='Later edit';await tick();a.commit();b.commit();await Promise.all([sa,sb]);
  assert.equal(values.get('project:a').nodes[0].title,'Project A');assert.equal(values.get('project:b').nodes[0].title,'Project B');assert.equal(values.get('canvas').nodes[0].title,'Legacy');assert.equal((await a.store.load()).nodes[0].title,'Project A');assert.equal((await b.store.load()).nodes[0].title,'Project B');
});
test('save captures the project key before crossing the async database boundary',async()=>{
  const f=page({id:'a'}),save=f.store.save(graph('node','A'));f.window.CanvasProjects={id:()=> 'b'};await tick();assert.equal(f.transactions[0].key,'project:a');f.commit();await save;
});
test('list includes legacy default and saved projects without unrelated documents or fabricated projects',async()=>{
  const f=page({values:new Map([['canvas',graph('old','Old')],['project:a',{...graph('a','A'),project:{id:'a',title:'中文项目',updatedAt:100}}],['unrelated',{title:'Keep private'}]])});
  const result=await f.store.listProjects();assert.equal(result.length,2);assert.equal(result[0].title,'中文项目');assert.equal(result[0].nodeCount,1);assert.equal(result[1].id,'canvas');assert.equal(f.transactions.length,0);
});
test('new project is empty with independent viewport/history and creates only after current save succeeds',async()=>{
  let currentFlushed=false;const f=page({app:{prepareProjectNavigation:async()=>{currentFlushed=true;}}});
  const create=f.projects.create('  我的项目  ');await tick();assert.equal(currentFlushed,true);assert.equal(f.transactions[0].key,'project:created-project');assert.deepEqual(f.transactions[0].snapshot.nodes,[]);assert.deepEqual(f.transactions[0].snapshot.edges,[]);assert.deepEqual(f.transactions[0].snapshot.view,{x:0,y:0,scale:1});assert.deepEqual(f.transactions[0].snapshot.history,[]);f.commit();assert.equal((await create).title,'我的项目');assert.deepEqual(f.navigations,[]);
});
test('failed new-project transaction rejects and never navigates or changes active identity',async()=>{
  const f=page(),creating=f.projects.create('Failure');await tick();f.abort();await assert.rejects(creating,{name:'QuotaExceededError'});assert.equal(f.projects.id(),'canvas');assert.equal(f.values.has('project:created-project'),false);assert.deepEqual(f.navigations,[]);
});
test('save failure prevents switching and creating without mutating stored records',async()=>{
  const saved=graph('a','A'),f=page({values:new Map([['project:a',saved]]),app:{prepareProjectNavigation:async()=>{throw Error('save failed');}}});
  await assert.rejects(f.projects.switchTo('a'),/save failed/);await assert.rejects(f.projects.create('New'),/save failed/);assert.deepEqual(f.navigations,[]);assert.equal(f.transactions.length,0);assert.deepEqual(f.values.get('project:a'),saved);
});
test('pending editor/scene/generation and externally registered agent guards prevent project navigation',async()=>{
  for(const setup of [f=>f.window.CanvasImageEditor={current:{}},f=>f.window.StudioAPI={active:{}},f=>f.window.GenerationAPI={getJobs:()=>[{status:'running'}]},f=>f.projects.registerNavigationGuard(()=> 'Agent仍在运行')]){
    const f=page({values:new Map([['project:a',graph('a','A')]])});setup(f);await assert.rejects(f.projects.switchTo('a'));await assert.rejects(f.projects.create('New'));assert.deepEqual(f.navigations,[]);assert.equal(f.transactions.length,0);
  }
});
test('task starting while destination is being read blocks navigation after read, retaining original page',async()=>{
  let resolve;const f=page({store:{load:()=>new Promise(done=>resolve=done)}}),switching=f.projects.switchTo('a');await tick();f.window.CanvasImageEditor={current:{}};resolve(graph('a','A'));await assert.rejects(switching,/图片编辑器/);assert.deepEqual(f.navigations,[]);
});
test('switch reads destination then awaits current flush and keeps project URL explicit',async()=>{
  const sequence=[],f=page({store:{load:async()=>{sequence.push('read');return graph('a','A');}},app:{prepareProjectNavigation:async()=>sequence.push('flush')}});await f.projects.switchTo('a');assert.deepEqual(sequence,['read','flush']);assert.equal(new URL(f.navigations[0]).searchParams.get('project'),'a');
});
test('missing project and invalid project ID cannot overwrite legacy canvas or navigate',async()=>{
  const f=page();await assert.rejects(f.projects.switchTo('missing'),/未找到/);await assert.rejects(f.projects.switchTo('../canvas'),/无效/);const invalid=page({id:'../canvas'});await assert.rejects(invalid.store.load(),/无效/);assert.throws(()=>invalid.store.save(graph('x','X')),/无效/);assert.equal(f.transactions.length,0);assert.equal(invalid.transactions.length,0);
});
test('project snapshot and hydration retain title, viewport and separate undo/redo without changing seed data',()=>{
  const f=page({id:'a'}),history=[graph('old','Undo')],future=[graph('next','Redo')];f.projects.setTitle('持久名称');const snapshot=f.projects.snapshot(graph('current','Current'),{x:30,y:-40,scale:.7},history,future);
  assert.equal(snapshot.project.id,'a');assert.equal(snapshot.project.title,'持久名称');assert.equal(snapshot.history[0].nodes[0].title,'Undo');assert.equal(snapshot.future[0].nodes[0].title,'Redo');assert.equal(snapshot.view.scale,.7);
  const reopened=page({id:'a'});reopened.projects.hydrate(snapshot);assert.equal(reopened.button.textContent,'持久名称');assert.throws(()=>page({id:'b'}).projects.hydrate(snapshot),/不匹配/);
});
test('production persist writes project metadata plus complete graph and clears dirty only after latest commit',async()=>{
  const f=page({id:'a'});f.context.nodes=graph('node','Title').nodes;f.context.edges=[];f.context.view={x:5,y:6,scale:.5};f.context.history=[graph('undo','Before')];f.context.future=[];f.context.graphLoaded=true;f.context.graphReadFailed=false;f.context.saveRevision=0;f.context.original=new Map();f.context.$=()=>null;f.context.storageError=error=>{throw error;};
  const start=appSource.indexOf('  function persist() {'),end=appSource.indexOf('\n  function storageError',start);vm.runInContext(appSource.slice(start,end)+'\nglobalThis.persist=persist;',f.context);f.context.persist();await tick();
  const state=f.transactions[0].snapshot;assert.equal(state.project.id,'a');assert.deepEqual(state.view,{x:5,y:6,scale:.5});assert.equal(state.history[0].nodes[0].id,'undo');const before={preventDefault(){this.prevented=true;}};f.listeners.beforeunload(before);assert.equal(before.prevented,true);f.commit();await tick();const after={preventDefault(){this.prevented=true;}};f.listeners.beforeunload(after);assert.equal(after.prevented,undefined);
});
test('title validates empty and overlong input before any create/save operation',async()=>{
  const f=page();for(const value of ['', '   ','长'.repeat(121)])await assert.rejects(f.projects.create(value));assert.equal(f.transactions.length,0);
});

test('same-project stale tab cannot replace another tab’s committed graph and remains blocked on retry',async()=>{
  const values=new Map([['project:a',graph('saved','Original')]]),a=page({id:'a',values}),b=page({id:'a',values});await Promise.all([a.store.load(),b.store.load()]);
  const first=a.store.save(graph('first','Window A'));await tick();a.commit();await first;assert.equal(values.get('project:a').storageRevision,1);
  const stale=b.store.save(graph('second','Window B'));await assert.rejects(stale,{name:'CanvasProjectConflictError'});assert.equal(values.get('project:a').nodes[0].title,'Window A');assert.equal(b.transactions.length,0);
  await assert.rejects(b.store.save(graph('second','Retry must preserve A')),{name:'CanvasProjectConflictError'});await assert.rejects(b.store.flush(),{name:'CanvasProjectConflictError'});assert.equal(values.get('project:a').nodes[0].title,'Window A');
});
test('one page serializes rapid saves and advances its own committed revision without false conflicts',async()=>{
  const f=page({id:'a'});await f.store.load();const first=f.store.save(graph('node','First')),second=f.store.save(graph('node','Second'));await tick();assert.equal(f.transactions.length,1);f.commit(0);await first;await tick();assert.equal(f.transactions.length,2);assert.equal(f.transactions[1].snapshot.storageRevision,2);f.commit(1);await second;await f.store.flush();assert.equal(f.values.get('project:a').nodes[0].title,'Second');
});
test('Agent record writes retain scoped records and participate in the same transaction flush without appearing as projects',async()=>{
  const f=page(),chat=[{id:'chat',title:'Saved chat'}],saving=f.store.writeRecord('agent-chats:a',chat),flushing=f.store.flush();chat[0].title='Later';await tick();assert.equal(f.transactions[0].snapshot[0].title,'Saved chat');f.commit();await saving;await flushing;assert.equal((await f.store.readRecord('agent-chats:a'))[0].title,'Saved chat');assert.equal((await f.store.listProjects()).length,1);assert.throws(()=>f.store.writeRecord('canvas',[]),/无效/);
});
test('a synchronous production snapshot failure cannot turn a previously successful flush into successful navigation',async()=>{
  let flushes=0;const f=page({store:{load:async()=>graph('a','Destination'),save:()=>Promise.resolve(),flush:async()=>flushes++}});
  Object.assign(f.context,{nodes:[],edges:[],view:{x:0,y:0,scale:1},history:[],future:[],graphLoaded:true,graphReadFailed:false,saveRevision:0,original:new Map(),$:()=>null,flushGesture:()=>{},saveView:()=>{},storageError:()=>{}});
  f.projects.snapshot=()=>{throw Object.assign(Error('cannot clone'),{name:'DataCloneError'});};
  const start=appSource.indexOf('  function persist() {'),end=appSource.indexOf('\n  function storageError',start),body=appSource.match(/async saveProject\(\)\{([^\n]+)\},/)[1];
  vm.runInContext(appSource.slice(start,end)+`\nglobalThis.saveProject=async function(){${body}};`,f.context);f.window.CanvasApp.prepareProjectNavigation=()=>f.context.saveProject();
  await assert.rejects(f.projects.switchTo('a'),/未能保存/);assert.equal(flushes,0);assert.deepEqual(f.navigations,[]);
});
test('production mutation gate rejects editing before project hydration without altering the previous graph',()=>{
  const f=page({id:'a'});Object.assign(f.context,{graphLoaded:false,localChanges:0,nodes:[{id:'retained'}],edges:[],history:[],future:[],notify:()=>{},flushGesture:()=>{},clone:structuredClone});
  const start=appSource.indexOf('  function remember()'),end=appSource.indexOf('\n  function persist()',start);vm.runInContext(appSource.slice(start,end)+'\nglobalThis.remember=remember;',f.context);assert.throws(()=>f.context.remember(),/尚未完成读取/);assert.equal(f.context.localChanges,0);assert.equal(f.context.history.length,0);assert.equal(f.context.nodes[0].id,'retained');
});

test('legacy bare-graph adapters retain project metadata and use the current app viewport and undo state',async()=>{
  const previous={...graph('node','Before'),project:{id:'a',title:'Named project'},view:{x:1,y:2,scale:.2},history:[graph('old','Old undo')],future:[graph('next','Old redo')]};
  const f=page({id:'a',values:new Map([['project:a',previous]])});await f.store.load();
  f.window.CanvasApp.projectSnapshot=()=>({...previous,view:{x:25.5,y:-80.25,scale:.75},history:[graph('node','Before')],future:[]});
  const saving=f.store.save(graph('node','After'));await tick();f.commit();await saving;
  const saved=f.values.get('project:a');assert.equal(saved.project.title,'Named project');assert.deepEqual(saved.view,{x:25.5,y:-80.25,scale:.75});assert.equal(saved.history[0].nodes[0].title,'Before');assert.deepEqual(saved.future,[]);assert.equal(saved.nodes[0].title,'After');
});
test('bare-graph adapter before app initialization cannot erase stored project fields',async()=>{
  const previous={...graph('node','Before'),project:{id:'a',title:'Keep metadata'},view:{x:2,y:3,scale:.5},history:[graph('old','Undo')],future:[]};
  const f=page({id:'a',values:new Map([['project:a',previous]])});await f.store.load();const saving=f.store.save(graph('node','After'));await tick();f.commit();await saving;for(const field of ['project','view','history','future'])assert.deepEqual(f.values.get('project:a')[field],previous[field]);
});

test('stale same-project Agent conversation record rejects atomically instead of replacing a newer window history',async()=>{
  const key='agent-conversations:a',values=new Map([[key,{chats:[{id:'original'}],activeId:'original'}]]),a=page({id:'a',values}),b=page({id:'a',values});await Promise.all([a.store.readRecord(key),b.store.readRecord(key)]);
  const saved=a.store.writeRecord(key,{chats:[{id:'newer'}],activeId:'newer'});await tick();a.commit();await saved;assert.equal(values.get(key).storageRevision,1);
  await assert.rejects(b.store.writeRecord(key,{chats:[{id:'stale'}],activeId:'stale'}),{name:'AgentConversationConflictError'});assert.equal(values.get(key).chats[0].id,'newer');assert.equal(b.transactions.length,0);await assert.rejects(b.store.flush(),{name:'AgentConversationConflictError'});
});

test('comments records use project-specific CAS without changing canvas or Agent records',async()=>{
  const key='comments-canvas:a',values=new Map([[key,{comments:[{id:'old'}]}],['canvas',graph('node','Keep canvas')]]),a=page({id:'a',values}),b=page({id:'a',values});await Promise.all([a.store.readRecord(key),b.store.readRecord(key)]);
  const write=a.store.writeRecord(key,{comments:[{id:'new'}]});await tick();a.commit();await write;await assert.rejects(b.store.writeRecord(key,{comments:[{id:'stale'}]}),{name:'CanvasCommentsConflictError'});assert.equal(values.get(key).comments[0].id,'new');assert.equal(values.get('canvas').nodes[0].title,'Keep canvas');assert.equal((await a.store.listProjects()).length,1);
});

test('video operation journals reuse existing records and reject stale identities atomically',async()=>{
 const key='agent-video-analysis-operations:a',request={operationId:'operation',nodeId:'source'},initial={version:1,projectId:'a',operations:[]},values=new Map([[key,initial]]),a=page({id:'a',values}),b=page({id:'a',values});
 await Promise.all([a.store.readRecord(key),b.store.readRecord(key)]);
 const record={...initial,operations:[{request,fingerprint:JSON.stringify(request),status:'queued',taskId:'original-task'}]},write=a.store.writeRecord(key,record);await tick();
 let flushed=false;const flush=a.store.flush().then(()=>{flushed=true;});assert.equal(flushed,false);a.commit();await write;await flush;
 await assert.rejects(b.store.writeRecord(key,{...initial,operations:[{...record.operations[0],taskId:'different-task'}]}),{name:'AgentConversationConflictError'});
 assert.equal(values.get(key).operations[0].taskId,'original-task');assert.equal(b.transactions.length,0);assert.equal((await a.store.listProjects()).length,1);
});

test('opening a saved project with full localStorage is read-only and cannot stale another window',async()=>{
  const stored={...graph('node','Stored'),project:{id:'a',title:'Keep title'},view:{x:15.125,y:-23.625,scale:.7},history:[],future:[],storageRevision:3},values=new Map([['project:a',stored]]),originalWindow=page({id:'a',values}),openedWindow=page({id:'a',values});await originalWindow.store.load();
  let mirrorWrites=0,automaticSaves=0;
  Object.assign(openedWindow.context,{view:{x:0,y:0,scale:1},viewStorageKey:'view:project:a',nodes:[],edges:[],selected:new Set(),original:new Map(),history:[],future:[],localChanges:0,graphLoaded:false,graphReadFailed:false,saveRevision:0,clearTimeout:()=>{},localStorage:{getItem:()=>null,setItem:()=>{mirrorWrites++;throw Object.assign(Error('full'),{name:'QuotaExceededError'});}},storageError:()=>{},clearOrphanGenerationState:()=>{},generationSignature:()=>''});
  openedWindow.window.CanvasNavigation=require('../canvas-navigation.js');
  const baseline=appSource.match(/  let viewSaveTimer=[^\n]+/)[0].replace('let ','var '),saveView=appSource.match(/  function saveView\(\)\{[^\n]+/)[0];
  vm.runInContext(baseline+'\n'+saveView+'\nglobalThis.persist=()=>{automaticSaves++;};',Object.assign(openedWindow.context,{automaticSaves:0}));
  openedWindow.context.rebuild=()=>{if(openedWindow.context.graphLoaded)openedWindow.context.persist();};
  const hydration=appSource.slice(appSource.indexOf('  window.CanvasStore.load().then'),appSource.lastIndexOf('\n})();')).trim();vm.runInContext('globalThis.hydration='+hydration,openedWindow.context);await openedWindow.context.hydration;
  assert.equal(openedWindow.context.graphLoaded,true);assert.equal(openedWindow.context.view.x,15.125);openedWindow.context.saveView();openedWindow.context.saveView();assert.equal(mirrorWrites,0);assert.equal(openedWindow.context.automaticSaves,0);assert.equal(values.get('project:a').storageRevision,3);assert.equal(openedWindow.transactions.length,0);
  const saving=originalWindow.store.save(graph('node','Original tab remains writable'));await tick();originalWindow.commit();await saving;assert.equal(values.get('project:a').storageRevision,4);
});
test('a genuine viewport change still attempts persistence after read-only hydration baseline',()=>{
  const f=page({id:'a'});Object.assign(f.context,{view:{x:0,y:0,scale:1},viewStorageKey:'view:project:a',graphLoaded:true,clearTimeout:()=>{},localStorage:{setItem(){throw Object.assign(Error('full'),{name:'QuotaExceededError'});}},fallbackSaves:0});
  const baseline=appSource.match(/  let viewSaveTimer=[^\n]+/)[0].replace('let ','var '),saveView=appSource.match(/  function saveView\(\)\{[^\n]+/)[0];vm.runInContext(baseline+'\n'+saveView+'\nfunction persist(){fallbackSaves++;}',f.context);f.context.saveView();assert.equal(f.context.fallbackSaves,0);f.context.view.x=20.5;f.context.saveView();assert.equal(f.context.fallbackSaves,1);
});

test('successful IndexedDB viewport fallback records its baseline and repeated renders do not create new revisions',async()=>{
  const f=page({id:'a'});Object.assign(f.context,{view:{x:0,y:0,scale:1},viewStorageKey:'view:project:a',graphLoaded:true,clearTimeout:()=>{},localStorage:{setItem(){throw Object.assign(Error('full'),{name:'QuotaExceededError'});}},fallbackSaves:0});
  const baseline=appSource.match(/  let viewSaveTimer=[^\n]+/)[0].replace('let ','var '),saveView=appSource.match(/  function saveView\(\)\{[^\n]+/)[0];vm.runInContext(baseline+'\n'+saveView+'\nfunction persist(){fallbackSaves++;return Promise.resolve();}',f.context);f.context.view.y=-8.25;f.context.saveView();await tick();f.context.saveView();f.context.saveView();assert.equal(f.context.fallbackSaves,1);
});
