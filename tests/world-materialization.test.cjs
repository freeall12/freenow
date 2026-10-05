const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const moduleReady = import('../src/features/world-node/materialization.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};

test('model download preserves bytes and rejects declared or streamed oversized responses', async () => {
  const {materializationScope, readModelBlob} = await moduleReady;
  const bytes = Uint8Array.of(103, 108, 84, 70, 0, 255), scope = materializationScope();
  try {
    const blob = await readModelBlob(new Response(bytes), scope, 6);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes); assert.equal(blob.type, 'model/gltf-binary');
    let cancelled = false, reads = 0;
    const declared = {ok: true, headers: {get: () => '7'}, body: {cancel: async () => {cancelled = true;}, getReader: () => {reads++;}}};
    await assert.rejects(readModelBlob(declared, scope, 6), {code: 'size'}); assert.equal(cancelled, true); assert.equal(reads, 0);
    const stream = new ReadableStream({start(controller) {controller.enqueue(bytes); controller.enqueue(Uint8Array.of(1));}, cancel() {cancelled = true;}});
    cancelled = false; await assert.rejects(readModelBlob(new Response(stream), scope, 6), /12 MiB.*原任务/); assert.equal(cancelled, true);
    await assert.rejects(readModelBlob({ok: true, headers: new Headers(), blob() {assert.fail('unbounded blob fallback');}}, scope, 6), {code: 'world_download_unreadable'});
  } finally {scope.close();}
});

test('source changes stop a stalled download; cancellation and deadline reject promptly', async () => {
  const {materializationScope, readModelBlob} = await moduleReady;
  let changed = false, cancelled = false;
  const scope = materializationScope({pollMs: 5, validateSources() {if (changed) throw Object.assign(Error('source changed'), {code: 'world_source_changed'});}});
  const stream = new ReadableStream({cancel() {cancelled = true;}}), pending = readModelBlob(new Response(stream), scope, 10);
  changed = true;
  try {await assert.rejects(pending, {code: 'world_source_changed'}); assert.equal(cancelled, true);} finally {scope.close();}
  const controller = new AbortController(), aborted = materializationScope({signal: controller.signal});
  const blocked = aborted.wait(() => new Promise(() => {})); controller.abort();
  try {await assert.rejects(blocked, {name: 'AbortError'});} finally {aborted.close();}
  const timed = materializationScope({timeoutMs: 5});
  try {await assert.rejects(timed.wait(() => new Promise(() => {})), {code: 'world_materialization_timeout'});} finally {timed.close();}
});

test('a late decoded model is disposed once when cancelled or guard rejects after decoding', async () => {
  const {materializationScope} = await moduleReady, controller = new AbortController(), gate = deferred(); let disposals = 0;
  const scope = materializationScope({signal: controller.signal}), pending = scope.wait(() => gate.promise, {disposeLate() {disposals++;}});
  await tick(); controller.abort(); await assert.rejects(pending, {name: 'AbortError'}); scope.close();
  gate.resolve({scenes: []}); await tick(); assert.equal(disposals, 1);
  let changed = false; const guarded = materializationScope({validateSources() {if (changed) throw Error('changed');}});
  try {await assert.rejects(guarded.wait(() => {changed = true; return {};}, {disposeLate() {disposals++;}}), /changed/); assert.equal(disposals, 2);} finally {guarded.close();}
});

async function fixture({inspect, rendererFailure = false, setupFailure = false} = {}) {
  const THREE = await import('three'), {disposeLoadedModel, maxBytes} = await import('../src/features/studio-v2/model-io.mjs');
  const {assertReadableMediaSource, assertReadableResultMedia} = await import('../src/features/generation-results/media-ref.mjs');
  const {assertWorldRendererSupport} = await import('../src/features/world-node/render-capabilities.mjs');
  const {materializationScope, readModelBlob} = await moduleReady, puts = [], disposed = [], geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  geometry.addEventListener('dispose', () => disposed.push('geometry')); material.addEventListener('dispose', () => disposed.push('material'));
  const scene = new THREE.Scene(), other = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material)); other.add(new THREE.Mesh(geometry, material));
  const onlyOther = new THREE.BoxGeometry(); onlyOther.addEventListener('dispose', () => disposed.push('other')); other.add(new THREE.Mesh(onlyOther, material));
  const loaded = {scene, scenes: [scene, other]}, bytes = Uint8Array.of(103, 108, 84, 70, 1, 2);
  class Renderer {
    setPixelRatio() {} setSize() {} render() {if (rendererFailure) throw Error('render failed');}
    dispose() {disposed.push('renderer');} forceContextLoss() {disposed.push('context');}
  }
  const context = {THREE: {...THREE, WebGLRenderer: Renderer}, disposeLoadedModel, disposeModel() {assert.fail('must dispose all loaded scenes');}, maxBytes,
    assertReadableMediaSource, assertReadableResultMedia, assertWorldRendererSupport, inspectModel: inspect || (async () => ({loaded})), materializationScope, readModelBlob, structuredClone, Blob, File, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval, devicePixelRatio: 1,
    previewLights() {if (setupFailure) throw Error('stage setup failed');}, DEFAULT_FOCAL: 35, viewportFov: () => 45,
    window: {CanvasApp: {}, LocalAssets: {url: async value => value, put: async value => {puts.push(value); return 'asset:' + puts.length;}}, LocalMedia: {asDataUrl: async () => 'data:image/png;base64,REAL'}},
    document: {createElement: () => ({toBlob: callback => callback(new Blob(['png'], {type: 'image/png'}))})}, fetch: async () => new Response(bytes)};
  const source = fs.readFileSync(require.resolve('../src/features/world-node/resource.mjs'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.createContext(context); vm.runInContext(source + '\nthis.materialize = materialize;', context);
  return {context, loaded, bytes, puts, disposed};
}

test('production materialize saves original GLB bytes and releases every scene exactly once', async () => {
  const f = await fixture(); const result = await f.context.materialize({url: 'https://provider.example/result.glb', filename: 'real.glb'}, 'asset');
  assert.deepEqual(new Uint8Array(await f.puts[0].arrayBuffer()), f.bytes); assert.equal(f.puts[0].name, 'real.glb');
  assert.equal(result.worldResource.url, 'asset:1'); assert.equal(result.worldResource.bytes, f.bytes.length); assert.equal(result.image, 'data:image/png;base64,REAL');
  assert.deepEqual(f.disposed.sort(), ['context', 'geometry', 'material', 'other', 'renderer'].sort());
});

test('production materialize releases model and renderer if rendering fails, and saves no output', async () => {
  const f = await fixture({rendererFailure: true}); await assert.rejects(f.context.materialize({url: 'https://provider.example/result.glb'}), /render failed/);
  assert.equal(f.puts.length, 0); assert.deepEqual(f.disposed.sort(), ['context', 'geometry', 'material', 'other', 'renderer'].sort());
});

test('production materialize releases renderer created before a stage setup failure', async () => {
  const f = await fixture({setupFailure: true}); await assert.rejects(f.context.materialize({url: 'https://provider.example/result.glb'}), /stage setup failed/);
  assert.equal(f.puts.length, 0); assert.deepEqual(f.disposed.sort(), ['context', 'geometry', 'material', 'other', 'renderer'].sort());
});

test('production materialize does not persist a decoder result after cancellation', async () => {
  const started = deferred(), gate = deferred(), f = await fixture({inspect() {started.resolve(); return gate.promise;}}), controller = new AbortController();
  const pending = f.context.materialize({url: 'https://provider.example/result.glb'}, 'asset', {signal: controller.signal});
  await started.promise; controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
  gate.resolve({loaded: f.loaded}); await tick(); assert.equal(f.puts.length, 0); assert.deepEqual(f.disposed.sort(), ['geometry', 'material', 'other'].sort());
});

test('failed GLTF dependency cleanup includes resources resolving after rejection without double disposal', async () => {
  const {modelResourceLifecycle} = await import('../src/features/studio-v2/model-resource-lifecycle.mjs');
  const tracker = modelResourceLifecycle(), gate = deferred(), resource = {isTexture: true, dispose() {count++;}}; let count = 0;
  const parser = {getDependency: () => gate.promise, loadGeometries: () => []}; tracker.plugin(parser);
  parser.getDependency('texture', 0); tracker.fail(); gate.resolve(resource); await tick(); assert.equal(count, 1);
  parser.getDependency('texture', 0); await tick(); tracker.fail(); assert.equal(count, 1);
});

function triangleGlb({invalid = false} = {}) {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}, {nodes: [1]}], nodes: [{mesh: 0}, {mesh: invalid ? 1 : 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}}]}, ...(invalid ? [{primitives: [{attributes: {POSITION: 9}}]}] : [])],
    buffers: [{byteLength: vertices.byteLength}], bufferViews: [{buffer: 0, byteOffset: 0, byteLength: vertices.byteLength}],
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0]}]};
  const jsonBytes = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 32); jsonBytes.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + vertices.byteLength);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  const offset = 20 + padded.length; glb.writeUInt32LE(vertices.byteLength, offset); glb.writeUInt32LE(0x004e4942, offset + 4);
  Buffer.from(vertices.buffer).copy(glb, offset + 8); return new File([glb], 'actual.glb', {type: 'model/gltf-binary'});
}

test('actual GLB inspector accepts shared geometry and cleans resources from a failed sibling scene', async () => {
  const THREE = await import('three'), {inspectModel, disposeLoadedModel} = await import('../src/features/studio-v2/model-io.mjs');
  const file = triangleGlb(), result = await inspectModel(file); assert.equal(result.loaded.scenes.length, 2);
  assert.equal(result.file, file); assert.equal(result.loaded.scene.children[0].geometry.attributes.position.count, 3);
  let disposed = 0; const geometry = result.loaded.scene.children[0].geometry;
  geometry.addEventListener('dispose', () => disposed++); disposeLoadedModel(result.loaded); assert.equal(disposed, 1);
  const original = THREE.BufferGeometry.prototype.dispose; let failedDisposals = 0;
  THREE.BufferGeometry.prototype.dispose = function () {failedDisposals++; return original.call(this);};
  try {await assert.rejects(inspectModel(triangleGlb({invalid: true})), {code: 'invalid'}); await tick(); assert.ok(failedDisposals >= 1, 'completed sibling geometry must be released on parse failure');}
  finally {THREE.BufferGeometry.prototype.dispose = original;}
});

test('actual inspector cancellation releases decoded dependencies and Draco once before a stalled parse returns', async () => {
  const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js'), {DRACOLoader} = await import('three/addons/loaders/DRACOLoader.js');
  const {inspectModel} = await import('../src/features/studio-v2/model-io.mjs'), originalParse = GLTFLoader.prototype.parseAsync, originalDispose = DRACOLoader.prototype.dispose;
  const started = deferred(), gate = deferred(), controller = new AbortController(); let geometryDisposals = 0, decoderDisposals = 0;
  GLTFLoader.prototype.parseAsync = async function (...args) {
    const loaded = await originalParse.apply(this, args); loaded.scene.children[0].geometry.addEventListener('dispose', () => geometryDisposals++);
    started.resolve(); await gate.promise; return loaded;
  };
  DRACOLoader.prototype.dispose = function () {decoderDisposals++; return originalDispose.call(this);};
  try {
    const pending = inspectModel(triangleGlb(), [], {signal: controller.signal}); await started.promise; controller.abort();
    await assert.rejects(pending, {name: 'AbortError'}); assert.equal(geometryDisposals, 1); assert.equal(decoderDisposals, 1);
    gate.resolve(); await tick(); assert.equal(geometryDisposals, 1); assert.equal(decoderDisposals, 1);
  } finally {gate.resolve(); GLTFLoader.prototype.parseAsync = originalParse; DRACOLoader.prototype.dispose = originalDispose;}
});


test('exact local GLB result preserves actual model bytes and complete source metadata without remote media reads', async () => {
  const f = await fixture(), ref = '/api/generation/media/12345678-1234-4234-8234-000000000001', reads = [];
  f.context.fetch = async source => {reads.push(source); return new Response(f.bytes);};
  const metadata = {mime:'model/gltf-binary',sourceFileId:'original-model',sourceUrl:ref,representation:'mesh',asset_metadata:{format:'glb',name:'Original'}};
  const result = await f.context.materialize({type:'model',url:ref,format:'glb',...metadata}, 'world');
  assert.deepEqual(reads,[ref]);assert.deepEqual(new Uint8Array(await f.puts[0].arrayBuffer()),f.bytes);
  for(const key of Object.keys(metadata))assert.deepEqual(result.worldResource[key],metadata[key]);
});

test('legacy TapNow sources and unsupported or inconsistent representations fail before fetching', async () => {
  const f = await fixture();let reads = 0;f.context.fetch = async () => {reads++;assert.fail('must not read remote or unsupported format');};
  await assert.rejects(f.context.materialize({type:'model',url:'https://files.tapnow.media/old.glb',format:'glb'}),{code:'media_localization_required'});
  await assert.rejects(f.context.materialize({type:'model',url:'/api/generation/media/12345678-1234-4234-8234-000000000001',format:'ply',representation:'gaussianSplat'}),/渲染器尚未接入/);
  await assert.rejects(f.context.materialize({type:'model',url:'/api/generation/media/12345678-1234-4234-8234-000000000001',format:'glb',representation:'gaussianSplat'}),{code:'world_renderer_unavailable'});
  assert.equal(reads,0);assert.equal(f.puts.length,0);
});
