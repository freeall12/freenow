const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), {createHash} = require('node:crypto');
const ready = Promise.all([import('three'), import('../src/features/studio-v3/asset-loader.mjs'), import('../src/features/world-node/materialization.mjs'), import('../src/features/studio-v2/model-io.mjs')]);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {resolve, promise};}
test('V3 GLB budget is independent 100 MiB; old model budget remains 12 MiB and local source boundaries reject remote/credentialed URLs', async () => {
  const [, api, , legacy] = await ready; assert.equal(api.GLB_MAX_BYTES, 100 * 1024 * 1024); assert.equal(legacy.maxBytes, 12 * 1024 * 1024);
  assert.equal(api.localAssetSource('asset:owned'), 'asset:owned'); assert.equal(api.localAssetSource('/assets/studio/character.glb', 'http://localhost:4195/'), 'http://localhost:4195/assets/studio/character.glb');
  for (const source of ['https://provider.example/a.glb', 'http://user:secret@localhost/a.glb', '/api/agent/config', '/assets/a.glb?key=x', '/assets/a.glb#hash']) assert.throws(() => api.localAssetSource(source));
  const asset = api.catalogAsset('chair-dining'); assert.equal(asset.sourceUrl, '/assets/studio/library/chair-dining.glb'); assert.equal(asset.scale, 1); assert.throws(() => api.catalogAsset('nonexistent'));
});
test('bounded GLB reads accept a source above old 12 MiB without changing old code; oversized and empty streams fail before decode', async () => {
  const [, api, {materializationScope}] = await ready, scope = materializationScope();
  try {
    const bytes = new Uint8Array(12 * 1024 * 1024 + 1), blob = await api.readAssetBlob(new Response(bytes), scope); assert.equal(blob.size, bytes.length);
    let canceled = false, read = false; const response = {ok: true, headers: {get: () => String(api.GLB_MAX_BYTES + 1)}, body: {cancel: async () => {canceled = true;}, getReader() {read = true;}}};
    await assert.rejects(api.readAssetBlob(response, scope), {code: 'studio_v3_asset_size'}); assert(canceled); assert(!read);
    await assert.rejects(api.readAssetBlob(new Response(new Uint8Array()), scope), {code: 'studio_v3_asset_empty'});
  } finally {scope.close();}
});
test('actual pinned character GLB decodes real skinned geometry and all official clips with no DOM or GPU substitute', async () => {
  const [THREE, api] = await ready, bytes = fs.readFileSync(require.resolve('../assets/studio/character.glb'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2a9cad40a4625a695f4c3b87bb4d93cad8fd1d5d38783fc2414e577157d122bf');
  const item = await api.decodeGlb(new Blob([bytes], {type: 'model/gltf-binary'})); assert(item.root.isObject3D); let vertices = 0, skinned = 0;
  item.root.traverse(object => {if (object.isMesh) vertices += object.geometry.attributes.position.count; if (object.isSkinnedMesh) skinned++;}); assert(vertices > 1000); assert(skinned > 0);
  assert(item.animations.some(clip => clip.name === 'Standing')); assert(item.animations.some(clip => clip.name === 'Idle')); assert.equal(item.animations.length, 14);
  const mixer = new THREE.AnimationMixer(item.root); mixer.clipAction(item.animations.find(clip => clip.name === 'Idle')).play(); mixer.update(.2); item.root.updateMatrixWorld(true); assert(!new THREE.Box3().setFromObject(item.root).isEmpty());
  mixer.stopAllAction(); mixer.uncacheRoot(item.root); item.dispose(); item.dispose();
});
test('actual pinned camera GLB decodes geometry; embedded PNG requires a Node bitmap shim, not a browser rendering claim', async t => {
  const [, api] = await ready, bytes = fs.readFileSync(require.resolve('../assets/studio/camera.glb'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7');
  const previous = {self: global.self, createImageBitmap: global.createImageBitmap, ProgressEvent: global.ProgressEvent}; global.self = global;
  global.ProgressEvent = class extends Event {constructor(type, fields) {super(type); Object.assign(this, fields);}};
  global.createImageBitmap = async blob => {const data = await blob.arrayBuffer(), view = new DataView(data); assert.equal(view.getUint32(0), 0x89504e47); return {width: view.getUint32(16), height: view.getUint32(20), close() {}};};
  t.after(() => {for (const [key, value] of Object.entries(previous)) if (value === undefined) delete global[key]; else global[key] = value;});
  const item = await api.decodeGlb(new Blob([bytes], {type: 'model/gltf-binary'})); let meshes = 0; item.root.traverse(object => {if (object.isMesh) {meshes++; assert(object.geometry.attributes.position.count > 0);}}); assert(meshes > 0); item.dispose();
});
test('decode failures and stale unabortable callbacks release late assets; no success is returned', async () => {
  const [THREE, api] = await ready, gate = deferred(), source = {sourceFormat: 'glb', sourceUrl: '/assets/studio/character.glb'}; let current = true, disposed = 0;
  const loader = api.createAssetLoader({fetchImpl: async () => new Response(new Uint8Array([1])), decode: async () => {await gate.promise; return {root: new THREE.Group(), dispose() {disposed++;}};}, timeoutMs: 1000});
  const controller = new AbortController(), pending = loader.load(source, {signal: controller.signal, isCurrent: () => current}); await tick(); current = false; controller.abort(Error('new session')); await assert.rejects(pending, /new session/); gate.resolve(); await tick(); assert.equal(disposed, 1);
  await assert.rejects(api.decodeGlb(new Blob(['invalid GLB'])), {code: 'studio_v3_asset_invalid'});
});
test('asset loader bounds concurrent loads and timeout releases the active loading slot', async () => {
  const [THREE, api] = await ready, gate = deferred(); let decodes = 0;
  const loader = api.createAssetLoader({maxConcurrent: 2, fetchImpl: async () => new Response(new Uint8Array([1])), decode: async () => {decodes++; await gate.promise; return {root: new THREE.Group(), dispose() {}};}, timeoutMs: 1000});
  const source = {sourceFormat: 'glb', sourceUrl: '/assets/studio/character.glb'}, promises = [loader.load(source), loader.load(source), loader.load(source)]; await tick(); assert.equal(loader.active, 2); assert.equal(loader.queued, 1); assert.equal(decodes, 2); gate.resolve(); await Promise.all(promises); assert.equal(loader.active, 0); assert.equal(decodes, 3);
  const blocked = api.createAssetLoader({fetchImpl: async () => new Response(new Uint8Array([1])), decode: () => new Promise(() => {}), timeoutMs: 20}); await assert.rejects(blocked.load(source), {code: 'world_materialization_timeout'}); assert.equal(blocked.active, 0);
});
