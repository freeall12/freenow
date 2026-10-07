const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const storeSource = fs.readFileSync(require.resolve('../canvas-store.js'), 'utf8');
const modules = Promise.all([
  import('../src/features/studio-v3/session.mjs'),
  import('../src/features/studio-v3/source.mjs')
]);
function named(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, `production helper ${name}`);
  return appSource.slice(start, end);
}
function method(name, next, async = false) {
  const start = appSource.indexOf(`    ${async ? 'async ' : ''}${name}(`);
  const end = appSource.indexOf(`\n    ${next}`, start + 1);
  assert.ok(start >= 0 && end > start, `production method ${name}`);
  return appSource.slice(start, end).trim().replace(/,$/, '');
}
function property(name) {
  const line = appSource.split('\n').find(line => line.startsWith(`    ${name}:`));
  assert.ok(line, `production property ${name}`);
  return line.trim().replace(/,$/, '');
}

// Only IndexedDB events and rendering are controlled substitutes. All snapshot
// capture, lease gates, candidate publication, CAS and save queue code is real.
async function fixture() {
  const [{createStudioSession}, {createStoredStudio, sourceSnapshot}] = await modules;
  const source = {id: 'source', type: 'image', title: 'Source', worldResource: {format: 'glb', url: 'assets/local.glb'}};
  const target = {id: 'owner', type: 'studio', title: 'Director', x: 0, y: 0, width: 375, height: 250};
  target.studioV3 = createStoredStudio(target, source);
  const graph = {version: 1, nodes: [target, source], edges: [], project: {id: 'production-save'}, storageRevision: 1};
  const records = new Map([['project:production-save', structuredClone(graph)]]);
  const transactions = [], errors = [], renders = [], notices = [];
  let openRequest;
  const db = {
    transaction(_name, mode) {
      let request, putKey;
      const tx = {
        error: null, pending: null, aborted: false,
        objectStore: () => ({
          get(key) {
            request = {};
            tx.read = () => { request.result = structuredClone(records.get(key)); request.onsuccess(); };
            if (mode !== 'readwrite') queueMicrotask(tx.read);
            return request;
          },
          put(value, key) { tx.pending = structuredClone(value); putKey = key; }
        }),
        abort() { tx.aborted = true; tx.onabort(); },
        commit() { assert.equal(tx.aborted, false); assert.ok(tx.pending); records.set(putKey, structuredClone(tx.pending)); tx.oncomplete(); },
        fail() { tx.error = Object.assign(Error('disk full'), {name: 'QuotaExceededError'}); tx.aborted = true; tx.onabort(); }
      };
      if (mode === 'readwrite') transactions.push(tx);
      return tx;
    }
  };
  const context = vm.createContext({
    structuredClone, queueMicrotask, graph, renders, errors,
    window: {
      CanvasNodeTitles: {flushAll() {}},
      CanvasProjects: {
        id: () => 'production-save', current: () => ({id: 'production-save', title: 'Production'}),
        isDefault: () => false, markDirty() {},
        snapshot: (value, view, history, future) => ({...value, project: {id: 'production-save'}, view, history, future})
      }
    },
    document: {createElement: () => ({dataset: {}, setAttribute() {}, remove() {}}), body: {append: notice => notices.push(notice)}},
    localStorage: {setItem() {}}, indexedDB: {open: () => openRequest = {}}
  });
  vm.runInContext(`
    const clone=value=>structuredClone(value),original=new Map(graph.nodes.map(node=>[node.id,clone(node)]));
    let nodes=clone(graph.nodes),edges=clone(graph.edges),selected=new Set(),view={},history=[],future=[],localChanges=0,saveRevision=0,graphLoaded=true,graphReadFailed=false;
    const nodeWriteGuards=new Map(),$=()=>null,flushGesture=()=>{},notify=()=>{};
    function rebuild(options){renders.push(options);}
    ${['remember', 'captureNodeWriteGuards', 'persist', 'storageError'].map(named).join('\n')}
    const originalStorageError=storageError;storageError=(error)=>{errors.push(error);originalStorageError(error);};
    globalThis.api={
      ${method('registerNodeWriteGuard', 'async publishStudioV3(')},
      ${method('publishStudioV3', 'createDirectorNode(', true)},
      ${['getState', 'projectIdentity', 'projectSnapshot', 'captureSnapshotWriteGuard'].map(property).join(',\n')}
    };
    window.CanvasApp=api;
    globalThis.probe={
      graph:()=>clone({nodes,edges}),history:()=>clone(history),
      live:id=>nodes.find(node=>node.id===id),
      remove:id=>{nodes.splice(nodes.findIndex(node=>node.id===id),1);},
      replace:id=>{const index=nodes.findIndex(node=>node.id===id);nodes[index]=clone(nodes[index]);},
      remember,persist
    };
  `, context, {filename: 'studio-v3-app-production-extract.js'});
  vm.runInContext(storeSource, context, {filename: 'canvas-store.js'});
  openRequest.result = db; openRequest.onsuccess();
  const store = context.window.CanvasStore, app = context.api, probe = context.probe;
  await store.load();
  const config = {nodeId: 'owner', app, store, publishNode: (id, patch, options) => app.publishStudioV3(id, patch, options),
    getSourceSnapshot: sourceSnapshot, autosaveMs: null};
  const session = createStudioSession(config);
  let used = 0;
  const nextTransaction = async () => {
    for (let i = 0; i < 30 && transactions.length <= used; i++) await Promise.resolve();
    assert.ok(transactions.length > used, 'a real store transaction started');
    return transactions[used++];
  };
  return {
    session, app, store, probe, config, createStudioSession, transactions, renders, errors,
    nextTransaction, durable: () => records.get('project:production-save'),
    rename: label => state => { state.scenePlay.worldSpace.stages[0].label = label; return state; }
  };
}

test('real candidate save publishes exactly one history entry after transaction commit', async () => {
  const f = await fixture(), before = structuredClone(f.probe.graph());
  f.session.change(f.rename('Published')); const saving = f.session.flush(), tx = await f.nextTransaction();
  assert.deepEqual(f.probe.graph(), before); assert.equal(f.probe.history().length, 0); assert.equal(f.renders.length, 0);
  tx.read(); assert.equal(tx.pending.nodes[0].studioV3.revision, 1); assert.equal(tx.pending.history.length, 1);
  assert.deepEqual(f.probe.graph(), before); tx.commit(); await saving;
  assert.equal(f.probe.live('owner').studioV3.state.scenePlay.worldSpace.stages[0].label, 'Published');
  assert.equal(f.probe.history().length, 1); assert.equal(f.renders.length, 1);
  assert.equal(f.durable().storageRevision, 2); assert.equal(f.session.getStatus().dirty, false);
  await f.session.flush(); assert.equal(f.transactions.length, 1);
});

test('real save failure retains host/history and retry commits newer private payload once', async () => {
  const f = await fixture(), before = structuredClone(f.probe.graph()), stored = structuredClone(f.durable());
  f.session.change(f.rename('Failed')); const saving = f.session.flush(), tx = await f.nextTransaction(); tx.read(); tx.fail();
  await assert.rejects(saving, {name: 'QuotaExceededError'});
  assert.deepEqual(f.probe.graph(), before); assert.deepEqual(f.durable(), stored); assert.equal(f.probe.history().length, 0);
  assert.equal(f.session.isCurrent(), true); assert.equal(f.session.getStatus().dirty, true);
  f.session.change(f.rename('Retry New')); const retry = f.session.flush(), next = await f.nextTransaction(); next.read(); next.commit(); await retry;
  assert.equal(f.durable().nodes[0].studioV3.revision, 2); assert.equal(f.durable().nodes[0].studioV3.state.scenePlay.worldSpace.stages[0].label, 'Retry New');
  assert.equal(f.probe.history().length, 1); assert.equal(f.renders.length, 1);
});

test('direct CanvasStore.save uses captured session gate even without caller beforeCommit', async () => {
  const f = await fixture(), snapshot = f.app.projectSnapshot(), stored = structuredClone(f.durable());
  const saving = f.store.save(snapshot), tx = await f.nextTransaction();
  f.probe.live('source').worldResource.url = 'assets/new-source.glb'; tx.read();
  await assert.rejects(saving, {name: 'CanvasSnapshotChangedError'});
  assert.equal(tx.aborted, true); assert.deepEqual(f.durable(), stored);
});

test('session handover rejects old queued direct snapshot while new writer saves successfully', async () => {
  const f = await fixture(), saving = f.store.save(f.app.projectSnapshot()), old = await f.nextTransaction();
  const nextSession = f.createStudioSession({...f.config, sessionToken: 'handover'});
  assert.equal(f.session.isCurrent(), false); assert.equal(nextSession.isCurrent(), true);
  nextSession.change(f.rename('New Session')); const nextSaving = nextSession.flush();
  old.read(); await assert.rejects(saving, {name: 'CanvasSnapshotChangedError'});
  const next = await f.nextTransaction(); next.read(); next.commit(); await nextSaving;
  assert.equal(f.durable().nodes[0].studioV3.state.scenePlay.worldSpace.stages[0].label, 'New Session');
  assert.equal(f.probe.history().length, 1);
});

for (const [name, mutate] of [
  ['source resource changed', f => { f.probe.live('source').worldResource.url = 'assets/replaced.glb'; }],
  ['source deleted', f => f.probe.remove('source')],
  ['source identity replaced', f => f.probe.replace('source')],
  ['owner deleted', f => f.probe.remove('owner')],
  ['owner identity replaced', f => f.probe.replace('owner')]
]) test(`real candidate transaction rejects ${name} before storage writes`, async () => {
  const f = await fixture(), stored = structuredClone(f.durable());
  f.session.change(f.rename('Private')); const saving = f.session.flush(), tx = await f.nextTransaction();
  mutate(f); tx.read(); await assert.rejects(saving, {name: 'CanvasSnapshotChangedError'});
  assert.equal(tx.pending, null); assert.equal(tx.aborted, true); assert.deepEqual(f.durable(), stored);
  assert.equal(f.probe.history().length, 0); assert.equal(f.session.getStatus().dirty, true);
});

test('failed candidate never enters later ordinary canvas history or direct graph save', async () => {
  const f = await fixture(); f.session.change(f.rename('Never Publish')); const saving = f.session.flush(), tx = await f.nextTransaction();
  tx.read(); tx.fail(); await assert.rejects(saving);
  f.probe.remember();
  assert.equal(f.probe.history()[0].nodes[0].studioV3.revision, 0);
  const direct = f.store.save(f.app.projectSnapshot()), next = await f.nextTransaction(); next.read();
  await assert.rejects(direct, {name: 'CanvasSnapshotChangedError'});
  assert.equal(f.durable().nodes[0].studioV3.revision, 0);
});
