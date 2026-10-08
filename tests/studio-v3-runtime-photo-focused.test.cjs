const {test} = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/runtime.mjs')]);
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
class Surface {
  constructor() {this.events = new Map();}
  addEventListener(type, callback) {if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback);}
  removeEventListener(type, callback) {this.events.get(type)?.delete(callback);}
}
function release(root) {root.traverse(object => {object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose();});}
async function fixture({gaussian = false, settleGate, readGate, encodeGate, encodeNull = false,
  loaderGate, loadWait = 'prop', loadFailure, sourceResource = false, hiddenProp = false, skipInitialSync = false} = {}) {
  const [THREE, schema, domain, {createStudioV3Runtime}] = await modules;
  let state = schema.createState({worldNodeId: 'photo-world', now: 1}), token = 'owner-a', revision = 1, alive = true;
  for (const [id, kind] of [['prop', 'prop'], ['camera', 'camera']]) {
    const entity = schema.createEntity({id, kind, label: id, now: 2, ...kind === 'prop' ? {asset: {sourceUrl: '/assets/studio/library/chair-dining.glb', sourceFormat: 'glb'}} : {}});
    state = domain.addEntity(state, entity, {setupId: 'setup:state-1', setupState: {...schema.createSetupState(id, 2), visible: !(hiddenProp && kind === 'prop')}});
  }
  const canvas = Object.assign(new Surface(), {clientWidth: 400, clientHeight: 300, width: 400, height: 300, style: {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})});
  const doc = Object.assign(new Surface(), {visibilityState: 'visible', defaultView: new Surface()}); canvas.ownerDocument = doc;
  const photoCanvases = [], toBlobCalls = [], passes = [], reads = [], settleCalls = [], settledCalls = [];
  const settleReached = deferred(), readReached = deferred(), encodeReached = deferred(), loaderReached = deferred();
  doc.createElement = tag => {
    assert.equal(tag, 'canvas'); const output = {width: 0, height: 0, image: null,
      getContext(kind) {assert.equal(kind, '2d'); return {createImageData(width, height) {return {data: new Uint8ClampedArray(width * height * 4)};}, putImageData(image) {output.image = image;}};},
      toBlob(done, mimeType, quality) {toBlobCalls.push({mimeType, quality}); encodeReached.resolve(); const finish = () => done(encodeNull ? null : new Blob(['mock-jpeg'], {type: mimeType})); if (encodeGate) encodeGate.promise.then(finish); else finish();}};
    photoCanvases.push(output); return output;
  };
  let target = null, cube = 0, mip = 0, size = new THREE.Vector2(400, 300), pixelRatio = 1;
  let viewport = new THREE.Vector4(0, 0, 400, 300), scissor = viewport.clone(), scissorTest = false, clearColor = new THREE.Color('#000'), clearAlpha = 1, rendererDisposals = 0, losses = 0, invalidations = 0;
  const renderer = {domElement: canvas, autoClear: true, toneMappingExposure: 1,
    setPixelRatio(value) {pixelRatio = value; canvas.width = size.x * value; canvas.height = size.y * value;}, getPixelRatio: () => pixelRatio,
    setSize(width, height) {size.set(width, height); canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;}, getSize(value) {return value.copy(size);},
    getRenderTarget: () => target, getActiveCubeFace: () => cube, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, face = 0, level = 0) {target = value; cube = face; mip = level;},
    getViewport(value) {return value.copy(viewport);}, setViewport(...value) {viewport = value[0]?.isVector4 ? value[0].clone() : new THREE.Vector4(...value);},
    getScissor(value) {return value.copy(scissor);}, setScissor(...value) {scissor = value[0]?.isVector4 ? value[0].clone() : new THREE.Vector4(...value);},
    getScissorTest: () => scissorTest, setScissorTest(value) {scissorTest = value;},
    getClearColor(value) {return value.copy(clearColor);}, getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha = clearAlpha) {clearColor = new THREE.Color(value); clearAlpha = alpha;}, clear() {},
    render(scene, camera) {
      const visible = object => {for (let node = object; node; node = node.parent) if (!node.visible) return false; return true;};
      const meshes = []; scene.traverse(object => {if (object.isMesh && camera.layers.test(object.layers) && visible(object)) meshes.push(object);});
      passes.push({camera, mask: camera.layers.mask, target, meshes, background: scene.background, override: scene.overrideMaterial, autoClear: renderer.autoClear,
        spark: spark ? {target: spark.target, size: spark.renderSize.toArray(), encodeLinear: spark.encodeLinear, visible: spark.visible} : null});
    },
    async readRenderTargetPixelsAsync(value, x, y, width, height, pixels) {
      value.disposals = 0; value.addEventListener('dispose', () => value.disposals++);
      reads.push({target: value, bound: target, width, height});
      for (let row = 0; row < height; row++) pixels.fill((row + 1) % 256, row * width * 4, (row + 1) * width * 4);
      readReached.resolve(); if (readGate) await readGate.promise;
    }, dispose() {rendererDisposals++;}, forceContextLoss() {losses++;}};
  let spark = null, splatContext = null;
  function splatFactory(activeRenderer, scene) {
    assert.equal(activeRenderer, renderer);
    const layer = new THREE.Group(); scene.add(layer);
    spark = {target: {name: 'viewport-spark'}, renderSize: new THREE.Vector2(400, 300), encodeLinear: false, visible: true, focalDistance: 0, apertureAngle: 0, autoUpdate: false};
    splatContext = {layer, entries: new Map(), spark, async settle() {}, prune() {},
      async settleOffscreen(root, camera, options) {settleCalls.push({root, camera, ...options}); options.assertCurrent(); settleReached.resolve(); if (settleGate) await settleGate.promise; options.assertCurrent();},
      renderSettled(root, camera, draw, options) {settledCalls.push({root, camera, ...options}); options.assertCurrent(); return draw();},
      render(root, camera, draw) {return draw();}, async dispose() {layer.removeFromParent();}};
    return splatContext;
  }
  class Controls extends THREE.EventDispatcher {constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;} update() {return false;} dispose() {}}
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(object) {this.object = object;} detach() {this.object = null;} setMode() {} dispose() {}}
  const runtime = createStudioV3Runtime({canvas, getState: () => state, getSourceResource: () => sourceResource ? {url: '/source.glb', format: 'glb'} : null,
    getFence: () => ({token, revision}), isCurrent: () => alive, autoRender: false,
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: () => new Transform(), splatFactory, onInvalidate() {invalidations++;},
    loader: {async load(descriptor) {
      const kind = descriptor.sourceUrl.includes('chair') ? 'prop' : descriptor.sourceUrl.includes('camera') ? 'camera' : 'source';
      if (loaderGate && kind === loadWait) {loaderReached.resolve(); await loaderGate.promise;}
      if (loadFailure === kind) throw Error(`${kind} decode failed`);
      const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      const splat = gaussian && descriptor.sourceUrl.includes('chair') ? {splatMesh: new THREE.Group(), transferSplat() {}} : {};
      return {root, format: 'glb', animations: [], ...splat, dispose() {release(root);}};}}});
  const initialSync = runtime.sync(); initialSync.catch(() => {}); if (!skipInitialSync) await initialSync;
  const snapshot = () => ({target, cube, mip, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest, size: size.toArray(), pixelRatio,
    clear: clearColor.getHexString(), clearAlpha, autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
    background: runtime.scene.background, override: runtime.scene.overrideMaterial, spark: spark ? {...spark, renderSize: spark.renderSize.toArray()} : null});
  return {THREE, domain, runtime, renderer, canvas, doc, passes, reads, photoCanvases, toBlobCalls, settleCalls, settledCalls, settleReached, readReached, encodeReached, loaderReached, initialSync, snapshot,
    get state() {return state;}, set state(value) {state = value; revision++;}, changeOwner() {token = 'owner-b';}, expire() {alive = false;}, get spark() {return spark;}, get splatContext() {return splatContext;}, get rendererDisposals() {return rendererDisposals;}, get losses() {return losses;}, get invalidations() {return invalidations;}};
}

test('runtime photo uses the detached physical frame, excludes editors, flips readback and supports unencoded output', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const camera = f.runtime.camera, pose = camera.toJSON();
  f.runtime.selectEntity('camera'); f.runtime.setHoverEntity('prop');
  f.renderer.setPixelRatio(2); f.renderer.setSize(400, 300); const previous = new f.THREE.WebGLRenderTarget(9, 7); t.after(() => previous.dispose()); f.renderer.setRenderTarget(previous, 2, 3);
  f.renderer.setViewport(5, 6, 90, 80); f.renderer.setScissor(7, 8, 70, 60); f.renderer.setScissorTest(true); const before = f.snapshot();
  const result = await f.runtime.renderPhoto(camera, {frameAspectRatio: 2, frameHeightRatio: .5, longEdge: 64, encode: false});
  assert.equal(result.width, 64); assert.equal(result.height, 32); assert.equal(Object.hasOwn(result, 'blob'), false); assert.equal(f.toBlobCalls.length, 0);
  assert.equal(f.passes.length, 2); const [content, ground] = f.passes;
  assert.notEqual(content.camera, camera); assert(content.target.isWebGLRenderTarget); assert.equal(content.target.width, 64); assert.equal(content.target.height, 32); assert.equal(ground.target, content.target);
  assert.equal(content.mask & (8 | 16 | 32 | 64 | 128), 0); assert.equal(content.autoClear, true); assert.equal(ground.mask, 16); assert.equal(ground.autoClear, false); assert.equal(ground.background, null); assert.equal(ground.override, null);
  assert.equal(content.meshes.some(mesh => {for (let node = mesh; node; node = node.parent) if (node.userData.entityKind === 'camera') return true; return false;}), false);
  assert(content.meshes.some(mesh => {for (let node = mesh; node; node = node.parent) if (node.userData.entityId === 'prop') return true; return false;}));
  assert.equal(f.reads[0].bound, content.target); assert.equal(f.reads[0].target, content.target); assert.equal(content.target.disposals, 1);
  assert.equal(result.canvas.image.data[0], 32); assert.equal(result.canvas.image.data[64 * 4], 31);
  assert.deepEqual(camera.toJSON(), pose); assert.deepEqual(f.snapshot(), before); assert.equal(f.runtime.capturing, false);
  const encoded = await f.runtime.renderPhoto(camera, {frameAspectRatio: 2, longEdge: 64}); assert.equal(encoded.blob.type, 'image/jpeg'); assert.deepEqual(f.toBlobCalls, [{mimeType: 'image/jpeg', quality: .92}]);
});

test('photo resource readiness waits for visible content before creating any target or encoder', async t => {
  const gate = deferred(), f = await fixture({loaderGate: gate, skipInitialSync: true}); t.after(() => f.runtime.dispose());
  await f.loaderReached.promise;
  const request = f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, resourceTimeoutMs: 1000});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.capturing, true); assert.equal(f.reads.length, 0); assert.equal(f.toBlobCalls.length, 0);
  await assert.rejects(f.runtime.renderPhoto(f.runtime.camera), {code: 'studio_v3_photo_busy'});
  gate.resolve(); const result = await request;
  assert.equal(result.blob.type, 'image/jpeg'); assert.equal(f.runtime.graph.entity('prop').status, 'ready');
  assert.equal(f.toBlobCalls.length, 1); assert.equal(f.runtime.capturing, false);
  assert(f.passes[0].meshes.some(mesh => {for (let node = mesh; node; node = node.parent) if (node.userData.entityId === 'prop') return true; return false;}));
});

test('photo resource readiness rejects failed source and visible entities with their actual errors before encoding', async t => {
  for (const kind of ['source', 'prop']) {
    const f = await fixture({loadFailure: kind, sourceResource: kind === 'source'}); t.after(() => f.runtime.dispose());
    await assert.rejects(f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32}), error =>
      error.code === 'studio_v3_photo_resources_failed' && error.message.includes(`${kind} decode failed`));
    assert.equal(f.reads.length, 0); assert.equal(f.toBlobCalls.length, 0); assert.equal(f.photoCanvases.length, 0);
    assert.equal(f.runtime.capturing, false);
  }
});

test('photo resource readiness ignores failed or pending hidden content and excluded camera markers', async t => {
  for (const loadFailure of ['prop', 'camera']) {
    const f = await fixture({loadFailure, hiddenProp: loadFailure === 'prop'}); t.after(() => f.runtime.dispose());
    assert.equal((await f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32})).blob.type, 'image/jpeg');
  }
  for (const loadWait of ['prop', 'camera']) {
    const gate = deferred(), f = await fixture({loaderGate: gate, loadWait, hiddenProp: loadWait === 'prop', skipInitialSync: true});
    t.after(() => f.runtime.dispose()); await f.loaderReached.promise;
    assert.equal((await f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, resourceTimeoutMs: 10})).blob.type, 'image/jpeg');
    gate.resolve(); await f.initialSync;
  }
});

test('photo resource readiness times out stalled resources without a half-scene image and permits a later ready retry', async t => {
  const gate = deferred(), f = await fixture({loaderGate: gate, skipInitialSync: true}); t.after(() => f.runtime.dispose());
  await f.loaderReached.promise;
  await assert.rejects(f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, resourceTimeoutMs: 5}), {code: 'studio_v3_photo_resources_timeout'});
  assert.equal(f.toBlobCalls.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.runtime.capturing, false);
  gate.resolve(); await f.initialSync;
  assert.equal((await f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32})).blob.type, 'image/jpeg');
});

test('photo resource readiness aborts on dispose and fences state changes during loader awaits', async () => {
  for (const mutation of ['dispose', 'setup']) {
    const gate = deferred(), f = await fixture({loaderGate: gate, skipInitialSync: true}); await f.loaderReached.promise;
    const request = f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, resourceTimeoutMs: 1000});
    const rejected = assert.rejects(request, {code: 'studio_v3_photo_stale'});
    if (mutation === 'dispose') await f.runtime.dispose();
    else f.state = f.domain.setActiveSetup(f.state, 'setup-default');
    gate.resolve(); await rejected;
    if (mutation === 'dispose') await assert.rejects(f.initialSync, {code: 'studio_v3_runtime_stale'});
    else await f.initialSync;
    assert.equal(f.toBlobCalls.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.runtime.capturing, false);
    await f.runtime.dispose();
  }
});

test('runtime Spark adapters receive the same settled clone and physical dimensions before the synchronous photo draw', async t => {
  const gate = deferred(), f = await fixture({gaussian: true, settleGate: gate}); t.after(() => f.runtime.dispose());
  const camera = f.runtime.camera, request = f.runtime.renderPhoto(camera, {frameAspectRatio: 2048, encode: false});
  await f.settleReached.promise; assert.equal(f.runtime.capturing, true); assert.equal(f.runtime.render(), false); assert.equal(f.reads.length, 0);
  await assert.rejects(f.runtime.renderPhoto(camera, {encode: false}), {code: 'studio_v3_photo_busy'});
  const call = f.settleCalls[0]; assert.notEqual(call.camera, camera); assert.equal(call.width, 4096); assert.equal(call.height, 2); assert.equal(call.camera.layers.mask & (8 | 16 | 32 | 64 | 128), 0); assert.equal(call.signal.aborted, false);
  gate.resolve(); const result = await request;
  assert.equal(result.width, 4096); assert.equal(result.height, 2); assert.equal(f.settledCalls.length, 1);
  const settled = f.settledCalls[0]; assert.equal(settled.camera, call.camera); assert.equal(settled.root, call.root); assert.equal(settled.width, call.width); assert.equal(settled.height, call.height); assert.equal(settled.signal, call.signal);
  assert.equal(f.passes[0].spark.target, f.reads[0].target); assert.deepEqual(f.passes[0].spark.size, [4096, 2]); assert.equal(f.passes[0].spark.encodeLinear, true); assert.equal(f.passes[1].spark.visible, false);
  assert.equal(f.spark.encodeLinear, false); assert.deepEqual(f.spark.renderSize.toArray(), [400, 300]); assert.equal(f.runtime.capturing, false);
});

test('runtime restores an existing capture lease on success and encoding failure', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); f.runtime.setCapturing(true); const invalidations = f.invalidations;
  const photo = await f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, frameAspectRatio: 2, encode: false});
  assert.equal(photo.width, 32); assert.equal(f.runtime.capturing, true); assert.equal(f.invalidations, invalidations); assert.equal(f.runtime.render(), false);
  f.runtime.setCapturing(false);
  const failed = await fixture({encodeNull: true}); t.after(() => failed.runtime.dispose()); failed.runtime.setCapturing(true);
  await assert.rejects(failed.runtime.renderPhoto(failed.runtime.camera, {longEdge: 32, frameAspectRatio: 2}), {code: 'studio_v3_photo_encode'});
  assert.equal(failed.runtime.capturing, true); assert.equal(failed.reads[0].target.disposals, 1); failed.runtime.setCapturing(false);
});

test('source/setup and owner changes fence runtime photos across asynchronous settle and readback', async t => {
  const settling = deferred(), f = await fixture({gaussian: true, settleGate: settling}); t.after(() => f.runtime.dispose());
  const pending = f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, encode: false}); const caught = assert.rejects(pending, {code: 'studio_v3_photo_stale'}); await f.settleReached.promise;
  f.state = f.domain.setActiveSetup(f.state, 'setup-default'); await f.runtime.sync(); settling.resolve(); await caught;
  assert.equal(f.reads.length, 0); assert.equal(f.runtime.capturing, false);
  const reading = deferred(), owner = await fixture({readGate: reading}); t.after(() => owner.runtime.dispose()); const before = owner.snapshot();
  const another = owner.runtime.renderPhoto(owner.runtime.camera, {longEdge: 32, encode: false}); const rejected = assert.rejects(another, {code: 'studio_v3_photo_stale'}); await owner.readReached.promise;
  assert.deepEqual(owner.snapshot(), before); assert.equal(owner.reads[0].target.disposals, 0); owner.changeOwner(); reading.resolve(); await rejected;
  assert.equal(owner.reads[0].target.disposals, 1); assert.equal(owner.photoCanvases.length, 0); assert.equal(owner.runtime.capturing, false);
});

test('runtime disposal drains the lazy photo readback before losing context and never publishes a stale canvas', async () => {
  const reading = deferred(), f = await fixture({readGate: reading});
  const request = f.runtime.renderPhoto(f.runtime.camera, {longEdge: 32, encode: false}), rejected = assert.rejects(request, {code: 'studio_v3_photo_stale'}); await f.readReached.promise;
  const closing = f.runtime.dispose(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.disposed, true); assert.equal(f.rendererDisposals, 0); assert.equal(f.losses, 0);
  // The target and context remain owned by native readback until it completes.
  // This spy checks ordering/fencing; it does not emulate GL color conversion.
  assert.equal(f.reads[0].target.disposals, 0); reading.resolve(); await rejected; await closing;
  assert.equal(f.reads[0].target.disposals, 1); assert.equal(f.photoCanvases.length, 0); assert.equal(f.rendererDisposals, 1); assert.equal(f.losses, 1);
  await f.runtime.dispose(); assert.equal(f.rendererDisposals, 1);
});
