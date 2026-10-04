const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const core = import('../src/features/workflow-templates/recent.mjs');
function storageFixture() {
  const databases = new Map(); let failWrite = false;
  const indexedDB = {open(name) {
    const request = {}; queueMicrotask(() => {
      const existed = databases.has(name), records = databases.get(name) || new Map(); databases.set(name, records);
      request.result = {createObjectStore() {}, transaction(_store, mode) {
        let pending = 0, scheduled = false; const staged = new Map();
        const tx = {objectStore: () => ({get: key => {const read = {}; pending++; queueMicrotask(() => {read.result = structuredClone(records.get(key)); read.onsuccess?.(); pending--; complete();}); return read;}, put: value => staged.set(value.id, structuredClone(value))})};
        function complete() {if (scheduled) return; scheduled = true; queueMicrotask(() => {scheduled = false; if (pending) return; if (mode === 'readwrite' && failWrite) {tx.error = Error('disk full'); tx.onabort?.(); return;} for (const [key,value] of staged) records.set(key,value); tx.oncomplete?.();});}
        complete(); return tx;
      }};
      if (!existed) request.onupgradeneeded?.(); request.onsuccess?.();
    }); return request;
  }};
  return {indexedDB, databases, setFailure: value => failWrite = value};
}
test('recent public and personal applications persist across reopened stores with namespace isolation', async () => {
  const {createRecentTemplateStore} = await core, f = storageFixture();
  const one = createRecentTemplateStore({indexedDB: f.indexedDB, databaseName: 'session-one:templates:recent', now: () => 123}); await one.ready;
  await one.record('official', 'public'); await one.record('mine', 'personal'); await one.record('official', 'public');
  const refreshed = createRecentTemplateStore({indexedDB: f.indexedDB, databaseName: 'session-one:templates:recent'}); await refreshed.ready;
  assert.deepEqual(refreshed.list().map(row => [row.id,row.kind]), [['official','public'],['mine','personal']]);
  const two = createRecentTemplateStore({indexedDB: f.indexedDB, databaseName: 'session-two:templates:recent'}); await two.ready; assert.deepEqual(two.list(), []);
  for (let index = 0; index < 40; index++) await refreshed.record('id-' + index, 'public');
  assert.equal(refreshed.list().length, 30); assert.equal(refreshed.list()[0].id, 'id-39');
});
test('failed recent write keeps committed history and public application is never retried', async () => {
  const {createRecentTemplateStore} = await core, {apply} = await import('../src/features/workflow-templates/entry.mjs'), f = storageFixture();
  const store = createRecentTemplateStore({indexedDB: f.indexedDB, databaseName: 'failure'}); await store.ready; await store.record('before', 'public'); f.setFailure(true);
  await assert.rejects(store.record('lost', 'personal'), /disk full/); assert.equal(store.list()[0].id, 'before');
  let inserted = 0; const notices = [], app = {getState: () => ({nodes: [],view: {x:0,y:0,scale:1}}), insertGraph: () => inserted++, focusNode() {}, notify: text => notices.push(text)};
  const item = {id:'official',name:'Official',graph:{version:1,width:100,height:100,nodes:[{id:'n',type:'image',x:0,y:0,width:50,height:50}],edges:[]}};
  const group = await apply(item, {app, templateAPI: {recordRecent: (id,kind) => store.record(id,kind)}, templatesCore: {instantiate: () => ({group:{id:'group'},nodes:[],edges:[]})}, projectId:'a',currentProjectId:()=> 'a',bounds:()=>({width:800,height:600})});
  assert.equal(group.id,'group'); assert.equal(inserted,1); assert.match(notices[0],/模板已应用，但最近使用记录未保存/);
});
test('TemplateAPI personal use records once and returns the inserted group when recent persistence fails', async () => {
  const source = fs.readFileSync(require.resolve('../templates-ui.js'),'utf8').replace(/import\(([^)]+)\)/g,'__import($1)');
  const item = {id:'personal',name:'Mine',graph:{width:100,height:100,nodes:[],edges:[]}}, notices=[], recorded=[]; let inserted=0;
  const app={getState:()=>({nodes:[],edges:[],view:{x:0,y:0,scale:1}}),insertGraph:()=>inserted++,focusNode(){},notify:value=>notices.push(value)};
  const window={CanvasApp:app,location:{href:'http://localhost/'},addEventListener(){},TemplatesCore:{instantiate:()=>({group:{id:'g'},nodes:[],edges:[]})},TEMPLATE_DB_NAME:'session:templates'};
  const document={addEventListener(){},dispatchEvent(){},querySelector:()=>({getBoundingClientRect:()=>({width:800,height:600})})};
  const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){const read={result:[item]},tx={objectStore:()=>({getAll:()=>read})};queueMicrotask(()=>tx.oncomplete());return tx;}};request.onsuccess();});return request;}};
  const __import=specifier=>specifier.includes('recent.mjs')?Promise.resolve({createRecentTemplateStore:options=>{assert.equal(options.databaseName,'session:templates:recent');return{ready:Promise.resolve(),list:()=>[],record:async(id,kind)=>{recorded.push([id,kind]);throw Error('disk full');}};}}):new Promise(()=>{});
  vm.runInNewContext(source,{window,document,indexedDB,__import,URL,CustomEvent:class{},structuredClone});
  const group=await window.TemplateAPI.use('personal'); assert.equal(group.id,'g'); assert.equal(inserted,1); assert.deepEqual(recorded,[['personal','personal']]); assert.match(notices[0],/模板已应用，但最近使用记录未保存/);
  await assert.rejects(window.TemplateAPI.use('personal',{canApply:()=>false}),/应用已取消/); assert.equal(inserted,1); assert.equal(recorded.length,1);
});
