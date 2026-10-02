const test = require('node:test'), assert = require('node:assert/strict');

async function fixture(t) {
  const THREE = await import('three');
  const {SceneRuntime} = await import('../src/features/studio-v2/runtime.mjs');
  const {ScenePlayback} = await import('../src/features/studio-v2/playback.mjs');
  const {exportGlb, disposeModel} = await import('../src/features/studio-v2/model-io.mjs');
  const {executeStudioTool} = await import('../src/features/agent-scene/studio-bridge.mjs');
  const prior = {window: global.window, location: global.location, FileReader: global.FileReader};
  let readHook = () => {}, assetHook = () => {}, putHook = () => {}, failSave = false, writes = 0, puts = 0;
  global.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => {readHook(); this.result = value; this.onloadend?.();}); }
  };
  const content = new THREE.Scene(), runtime = Object.assign(Object.create(SceneRuntime.prototype), {
    nodeId: 'studio', sessionId: 'current', loadStatus: 'ready', revision: 0, savedRevision: 0,
    content, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), animations: [], undoStack: [], redoStack: [],
    lighting: {azimuth: 0, elevation: 30}, grid: {visible: true}, shotId: null, shotRatios: {}, motionIndex: -1,
    selected: null, motion: {index: -1, close() {this.open = false;}, restoreContext() {}},
    transform: {detach() {}, attach() {}}, centeredTransform: {detach() {}, attach() {}},
    box: {visible: false, setFromObject() {}}, focus() {}, commit() {this.revision++;},
    async flush() {if (failSave) throw Error('disk full'); this.savedRevision = this.revision;}
  });
  runtime.scene.add(content); runtime.playback = new ScenePlayback(runtime);
  const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  model.children[0].userData.studioId = 'old-export-id';
  const blob = await exportGlb(model), url = URL.createObjectURL(blob);
  const nodes = [{id: 'studio', type: 'studio'}, {id: 'model', type: 'world', worldResource: {format: 'glb', url: 'asset:model'}}];
  runtime.hostNode = nodes[0];
  global.window = {CanvasApp: {getState: () => ({nodes}), updateNode(id, patch) {writes++; Object.assign(nodes.find(node => node.id === id), patch);}, async saveProject() {}},
    LocalAssets: {url: async () => {assetHook(); return url;}, async put() {puts++; putHook(); return 'asset:saved-' + puts;}}};
  global.location = new URL('http://localhost:4173/');
  t.after(() => {Object.assign(global, prior); URL.revokeObjectURL(url); disposeModel(runtime.content); disposeModel(model);});
  const instance = {runtime, execute: (action, args, options) => action === 'import' ? runtime.importModel(args, options) :
    action === 'redo' ? runtime.redoScene(args, options) : runtime.environmentSettings(args)};
  return {runtime, nodes, execute: (action, args, options) => executeStudioTool(instance, action, args, options),
    binding: () => ({sessionId: runtime.sessionId, expectedRevision: runtime.revision}),
    onRead: fn => {readHook = fn;}, onAsset: fn => {assetHook = fn;}, onPut: fn => {putHook = fn;},
    realFlush: () => {runtime.flush = SceneRuntime.prototype.flush;}, counts: () => ({writes, puts}), failSave: value => {failSave = value;}};
}

test('actual GLB import keeps precise transforms and source receipts, assigns independent IDs and reports applied save failures', async t => {
  const f = await fixture(t), args = {sourceNodeId: 'model', ...f.binding(), properties: {position: [2.375, 0, -.123456789], rotation: [0, Math.PI / 2, 0]}};
  const result = await f.execute('import', args), object = f.runtime.find(result.id);
  assert.deepEqual(object.position.toArray(), args.properties.position);
  assert.equal(object.rotation.y, Math.PI / 2); assert.equal(result.savedRevision, result.revision);
  assert.equal(object.userData.studioImport.sourceNodeId, 'model'); assert.equal(f.runtime.find('old-export-id'), undefined);
  f.failSave(true);
  const partial = await f.execute('import', {sourceNodeId: 'model', ...f.binding()});
  assert.equal(partial.applied, true); assert.match(partial.error, /保存失败/); assert.ok(f.runtime.find(partial.entityId));
  assert.notEqual(partial.entityId, result.id); assert.equal(f.runtime.content.children.length, 2);
  const ids = f.runtime.objects().map(object => object.id); assert.equal(new Set(ids).size, ids.length);
});

test('stale bindings, source replacement and cancellation during GLB preflight never mutate the scene', async t => {
  const f = await fixture(t), request = () => ({sourceNodeId: 'model', ...f.binding()});
  await assert.rejects(() => f.execute('import', {...request(), sessionId: 'previous'}), /会话或版本/);
  f.onAsset(() => {f.nodes[1].worldResource = {...f.nodes[1].worldResource, name: 'changed'};});
  await assert.rejects(() => f.execute('import', request()), /来源模型/);
  f.onAsset(() => {});
  const controller = new AbortController(); f.onRead(() => controller.abort());
  await assert.rejects(() => f.execute('import', request(), {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(f.runtime.content.children.length, 0); assert.equal(f.runtime.undoStack.length, 0); assert.equal(f.runtime.revision, 0);
});

test('mixed grid/light changes validate atomically and undo/redo preserve one transaction with version and cancel guards', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.execute('environment', {ground: {grid: false}, lighting: {elevation: 100}}), /光照/);
  assert.equal(f.runtime.grid.visible, true); assert.equal(f.runtime.undoStack.length, 0);
  const result = await f.execute('environment', {ground: {grid: false}, lighting: {azimuth: 180, elevation: -20}});
  assert.equal(result.grid, false); assert.equal(result.savedRevision, 1); assert.equal(f.runtime.undoStack.length, 1);
  await f.runtime.undo(); assert.equal(f.runtime.grid.visible, true); assert.equal(f.runtime.lighting.azimuth, 0);
  await assert.rejects(() => f.execute('redo', {...f.binding(), expectedRevision: 0}), /版本/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(() => f.execute('redo', f.binding(), {signal: canceled.signal}), {name: 'AbortError'});
  const restored = await f.execute('redo', f.binding());
  assert.equal(restored.applied, true); assert.equal(f.runtime.grid.visible, false); assert.equal(f.runtime.lighting.azimuth, 180);
  assert.equal(restored.history.canRedo, false);
});

test('same-ID target replacement during import preflight cannot mutate the old scene or the restored host node', async t => {
  const f = await fixture(t), target = f.nodes[0], replacement = structuredClone(target);
  f.onRead(() => {f.nodes[0] = replacement;});
  await assert.rejects(() => f.execute('import', {sourceNodeId: 'model', ...f.binding()}), /目标片场节点.*替换/);
  assert.equal(f.runtime.content.children.length, 0); assert.equal(f.runtime.undoStack.length, 0);
  assert.equal(f.runtime.revision, 0); assert.equal(replacement.studioV2, undefined); assert.equal(f.counts().writes, 0);
  f.nodes[0] = target; target.type = 'world'; f.onRead(() => {});
  await assert.rejects(() => f.execute('import', {sourceNodeId: 'model', ...f.binding()}), /切换版本/);
});

test('real flush keeps the host in-place binding and rejects target replacement after export or asset storage', async t => {
  const f = await fixture(t);
  await f.execute('import', {sourceNodeId: 'model', ...f.binding()});
  const target = f.nodes[0]; f.realFlush();
  f.runtime.setGrid(false); await f.runtime.flush();
  assert.equal(f.nodes[0], target); assert.equal(f.runtime.hostNode, target); assert.equal(f.runtime.savedRevision, f.runtime.revision);
  const savedRevision = f.runtime.savedRevision, counts = f.counts();
  f.runtime.setGrid(true);
  f.onRead(() => {f.nodes[0] = structuredClone(target);});
  await assert.rejects(() => f.runtime.flush(), /目标片场节点.*替换/);
  assert.deepEqual(f.counts(), counts); assert.equal(f.runtime.savedRevision, savedRevision);
  f.nodes[0] = target; f.onRead(() => {});
  f.onPut(() => {f.nodes[0] = structuredClone(target);});
  await assert.rejects(() => f.runtime.flush(), /目标片场节点.*替换/);
  assert.equal(f.counts().puts, counts.puts + 1); assert.equal(f.counts().writes, counts.writes);
  assert.equal(f.runtime.savedRevision, savedRevision); assert.equal(f.nodes[0].studioV2.grid, false);
  f.nodes[0] = target; f.onPut(() => {}); await f.runtime.flush();
  assert.equal(f.runtime.savedRevision, f.runtime.revision); assert.equal(target.studioV2.grid, true);
});
