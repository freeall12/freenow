const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/photo-renderer.mjs')]);
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
async function fixture(options = {}) {
  const [THREE, {createPhotoRenderer}] = await modules, scene = new THREE.Scene(), source = new THREE.PerspectiveCamera(60, 2, .1, 100);
  scene.background = new THREE.Color('#152030'); scene.overrideMaterial = new THREE.MeshBasicMaterial(); source.position.set(2, 3, 4); source.rotation.set(.1, .2, .3, 'YXZ'); source.layers.enableAll();
  const helper = new THREE.Group(); helper.userData.helper = true; const marker = new THREE.Group(); marker.layers.set(5); marker.userData.captureExcluded = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial()); ground.layers.set(4); ground.userData.helper = true;
  scene.add(helper, marker, ground); const hidden = new THREE.Group(); hidden.userData.helper = true; hidden.visible = false; scene.add(hidden);
  const spark = {target: {name: 'old-spark-target'}, renderSize: new THREE.Vector2(640, 480), encodeLinear: false, focalDistance: 9, apertureAngle: .002, visible: true};
  let target = {name: 'old-target'}, cube = 2, mip = 3, pixelRatio = 2, viewport = new THREE.Vector4(5, 6, 320, 240), scissor = new THREE.Vector4(7, 8, 200, 180), scissorTest = true;
  let color = new THREE.Color('#254565'), clearAlpha = .4, size = new THREE.Vector2(640, 480), current = true, fence = {node: 'node-a', revision: 1};
  const draws = [], targets = [], canvases = [], readerCalls = [];
  const renderer = {autoClear: false, toneMapping: 4, toneMappingExposure: 1.5, outputColorSpace: THREE.SRGBColorSpace,
    getRenderTarget: () => target, getActiveCubeFace: () => cube, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, face = 0, level = 0) {target = value; cube = face; mip = level;},
    getViewport: value => value.copy(viewport), setViewport(x, y, z, w) {viewport = x.isVector4 ? x.clone() : new THREE.Vector4(x, y, z, w);},
    getScissor: value => value.copy(scissor), setScissor(x, y, z, w) {scissor = x.isVector4 ? x.clone() : new THREE.Vector4(x, y, z, w);},
    getScissorTest: () => scissorTest, setScissorTest: value => {scissorTest = value;}, getPixelRatio: () => pixelRatio, setPixelRatio: value => {pixelRatio = value;},
    getSize: value => value.copy(size), setSize: (w, h) => {size.set(w, h);}, getClearColor: value => value.copy(color), getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha) {color.copy(value); clearAlpha = alpha;},
    render(currentScene, camera) {
      draws.push({camera, target, mask: camera.layers.mask, background: currentScene.background, override: currentScene.overrideMaterial,
        helper: helper.visible, marker: marker.visible, ground: ground.visible, spark: {...spark, renderSize: spark.renderSize.clone()}, pixelRatio});
      options.onDraw?.({renderer, camera, scene, spark});
    },
    async readRenderTargetPixelsAsync(value, x, y, width, height, pixels) {
      readerCalls.push({value, width, height, pixels}); options.onReadBegin?.({renderer, scene, spark, target}); for (let row = 0; row < height; row++) pixels.fill(row + 1, row * width * 4, (row + 1) * width * 4);
      if (options.read) await options.read();
    }};
  if (options.syncRead) {renderer.readRenderTargetPixels = (value, x, y, width, height, pixels) => {readerCalls.push({value, width, height, pixels}); pixels.fill(7);}; delete renderer.readRenderTargetPixelsAsync;}
  const adapters = {renderer, scene, getFence: () => structuredClone(fence), isCurrent: () => current,
    settle: options.settle || (async () => {}), getSpark: () => spark, getHelperRoots: () => [helper], renderFrame: options.renderFrame,
    createRenderTarget(width, height) {const value = new THREE.WebGLRenderTarget(width, height); value.disposals = 0; value.addEventListener('dispose', () => value.disposals++); targets.push(value); return value;},
    createCanvas() {
      const canvas = {width: 0, height: 0, image: null, encoding: null,
        getContext: () => ({createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}), putImageData: image => {canvas.image = image;}}),
        toBlob(callback, type, quality) {canvas.encoding = {type, quality}; if (options.encode) options.encode(callback, type); else callback(new Blob(['jpeg'], {type}));}};
      canvases.push(canvas); return canvas;
    }};
  if (!adapters.renderFrame) delete adapters.renderFrame;
  const photo = createPhotoRenderer(adapters), args = {camera: source, frameAspectRatio: 2048, frameHeightRatio: .5,
    optics: {focalLength: 35, frameAspectRatio: 3 / 2, depthOfFieldMode: 'aperture', focusDistance: 6, apertureFNumber: 2}};
  const snapshot = () => ({target, cube, mip, pixelRatio, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest,
    color: color.getHexString(), clearAlpha, size: size.toArray(), autoClear: renderer.autoClear, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    colorSpace: renderer.outputColorSpace, background: scene.background, override: scene.overrideMaterial,
    helper: helper.visible, marker: marker.visible, ground: ground.visible, hidden: hidden.visible, spark: {...spark, renderSize: spark.renderSize.toArray()}});
  return {THREE, photo, args, renderer, scene, source, spark, helper, marker, ground, hidden, draws, targets, canvases, readerCalls, adapters, snapshot,
    stale() {fence = {...fence, revision: 2};}, expire() {current = false;}};
}

test('official photo dimensions always use 4096 long edge and RGBA readback flips rows without stretching', async () => {
  const [, {photoDimensions, flipPhotoPixels}] = await modules;
  assert.deepEqual(photoDimensions(3 / 2), {width: 4096, height: 2731}); assert.deepEqual(photoDimensions(9 / 16), {width: 2304, height: 4096});
  assert.deepEqual(photoDimensions(NaN), {width: 4096, height: 2731}); assert.deepEqual(photoDimensions(1), {width: 4096, height: 4096});
  assert.deepEqual([...flipPhotoPixels(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 1, 2)], [5, 6, 7, 8, 1, 2, 3, 4]);
  assert.throws(() => flipPhotoPixels(new Uint8Array(3), 1, 1), TypeError);
});

test('photo renders a real detached target at 4K, preserves camera, excludes editor passes, keeps ground and encodes JPEG .92', async () => {
  const f = await fixture(), before = f.snapshot(), sourcePose = f.source.toJSON(); let settled;
  const [, {createPhotoRenderer}] = await modules; const photo = createPhotoRenderer({...f.adapters, settle: async value => {settled = value;}});
  const result = await photo.capture(f.args); assert.equal(result.width, 4096); assert.equal(result.height, 2); assert.equal(result.blob.type, 'image/jpeg'); assert.equal(result.quality, .92);
  assert.deepEqual(result.canvas.encoding, {type: 'image/jpeg', quality: .92}); assert.equal(f.targets.length, 1); assert.equal(f.targets[0].disposals, 1);
  assert.equal(f.readerCalls[0].value, f.targets[0]); assert.equal(f.readerCalls[0].width, 4096); assert.equal(result.canvas.image.data[0], 2); assert.equal(result.canvas.image.data[4096 * 4], 1);
  assert.notEqual(settled.camera, f.source); assert.equal(settled.width, 4096); assert.equal(settled.height, 2); assert.equal(settled.signal.aborted, false);
  assert.equal(f.draws.length, 2); const [content, ground] = f.draws; assert.equal(content.target, f.targets[0]); assert.equal(ground.target, f.targets[0]);
  for (const layer of [3, 4, 5, 6, 7]) assert.equal(content.mask & 1 << layer, 0); assert.equal(ground.mask, 1 << 4); assert.equal(ground.background, null);
  assert.equal(content.helper, false); assert.equal(content.marker, false); assert.equal(content.ground, true); assert.equal(content.spark.target, f.targets[0]); assert.deepEqual(content.spark.renderSize.toArray(), [4096, 2]);
  assert.equal(content.spark.encodeLinear, true); near(content.spark.focalDistance, 6); assert(content.spark.apertureAngle > 0); assert.equal(ground.spark.visible, false);
  near(content.camera.fov, 2 * Math.atan(Math.tan(Math.PI / 6) * .5) * 180 / Math.PI); assert.equal(content.pixelRatio, 2); assert.deepEqual(f.source.toJSON(), sourcePose); assert.deepEqual(f.snapshot(), before);
});

test('draw, readback and wrapper failures restore every renderer/Spark/visibility field and dispose the target', async () => {
  for (const mode of ['draw', 'read', 'empty-wrapper', 'async-wrapper']) {
    const f = await fixture({onDraw: mode === 'draw' ? ({renderer, scene, spark}) => {renderer.setPixelRatio(1); renderer.setSize(12, 13); renderer.toneMapping = 9; scene.background = null; spark.focalDistance = 4; throw Error('draw failed');} : undefined,
      read: mode === 'read' ? async () => {throw Error('read failed');} : undefined,
      renderFrame: mode === 'empty-wrapper' ? () => true : mode === 'async-wrapper' ? async ({draw}) => draw() : undefined});
    const before = f.snapshot(); await assert.rejects(f.photo.render(f.args)); assert.deepEqual(f.snapshot(), before, mode); assert.equal(f.targets[0].disposals, 1); assert.equal(f.photo.busy, false);
  }
});

test('every settle/readback/encode await rejects stale ownership and retains targets until pending readback completes', async () => {
  for (const stage of ['settle', 'readback', 'encode']) {
    const pending = deferred(), reached = deferred(); let callback;
    const f = await fixture({settle: stage === 'settle' ? async () => {reached.resolve(); await pending.promise;} : undefined,
      read: stage === 'readback' ? async () => {reached.resolve(); await pending.promise;} : undefined,
      encode: stage === 'encode' ? (done, type) => {callback = () => done(new Blob(['jpeg'], {type})); reached.resolve();} : undefined});
    const before = f.snapshot(), request = f.photo.capture(f.args); await reached.promise;
    assert.deepEqual(f.snapshot(), before, 'shared GPU state is restored before asynchronous wait'); if (stage === 'readback') assert.equal(f.targets[0].disposals, 0);
    f.stale(); if (stage === 'encode') callback(); else pending.resolve(); await assert.rejects(request, {code: 'studio_v3_photo_stale'});
    assert.equal(f.photo.busy, false); assert(f.targets.every(value => value.disposals === 1)); assert.equal(f.canvases.length, stage === 'encode' ? 1 : 0);
  }
});

test('one renderer rejects concurrent photo owners and disposal fences a pending settle without creating GPU resources', async () => {
  const pending = deferred(), reached = deferred(), f = await fixture({settle: async () => {reached.resolve(); await pending.promise;}});
  const [, {createPhotoRenderer}] = await modules, second = createPhotoRenderer(f.adapters), request = f.photo.render(f.args); await reached.promise;
  await assert.rejects(f.photo.capture(f.args), {code: 'studio_v3_photo_busy'}); await assert.rejects(second.render(f.args), {code: 'studio_v3_photo_busy'});
  assert.equal(f.photo.dispose(), true); assert.equal(f.photo.dispose(), false); pending.resolve(); await assert.rejects(request, {code: 'studio_v3_photo_stale'});
  assert.equal(f.targets.length, 0); assert.equal(f.photo.busy, false); await assert.rejects(f.photo.render(f.args), {code: 'studio_v3_photo_disposed'});
});

test('sync GPU readback also renders a target; null or wrong-type JPEG output fails without leaking ownership', async () => {
  const sync = await fixture({syncRead: true}), image = await sync.photo.render(sync.args); assert.equal(image.canvas.image.data[0], 7); assert.equal(sync.targets[0].disposals, 1);
  for (const encode of [callback => callback(null), callback => callback(new Blob(['png'], {type: 'image/png'}))]) {
    const f = await fixture({encode}); await assert.rejects(f.photo.capture(f.args), {code: 'studio_v3_photo_encode'}); assert.equal(f.photo.busy, false); assert.equal(f.targets[0].disposals, 1);
  }
});


test('thumbnail longEdge renders a genuinely smaller target and preserves JPEG profile', async () => {
  const [, {photoDimensions}] = await modules;
  assert.deepEqual(photoDimensions(3 / 2, 320), {width: 320, height: 213});
  assert.deepEqual(photoDimensions(9 / 16, 320), {width: 180, height: 320});
  for (const edge of [0, 4097, 320.5, '320', null, NaN]) assert.throws(() => photoDimensions(1, edge), TypeError);
  const f = await fixture(), result = await f.photo.capture({...f.args, frameAspectRatio: 1.5, longEdge: 320});
  assert.equal(result.width, 320); assert.equal(result.height, 213); assert.equal(f.targets[0].width, 320); assert.equal(f.readerCalls[0].width, 320);
  assert.deepEqual(result.canvas.encoding, {type: 'image/jpeg', quality: .92});
  assert.equal(f.draws[0].camera.layers.mask & (1 << 5), 0);
});

test('readback starts against the photographic target before restoration, including reader launch mutations', async () => {
  const pending = deferred(), reached = deferred(); let started;
  const f = await fixture({onReadBegin: ({renderer, scene, spark, target}) => {
    started = {target, bound: renderer.getRenderTarget(), size: spark.renderSize.toArray(), background: scene.background};
    renderer.setRenderTarget({name: 'reader-target'}); renderer.setViewport(40, 50, 60, 70); spark.renderSize.set(12, 13); scene.background = null;
  }, read: async () => {reached.resolve(); await pending.promise;}});
  const before = f.snapshot(), request = f.photo.render({...f.args, longEdge: 320}); await reached.promise;
  assert.equal(started.target, f.targets[0]); assert.equal(started.bound, f.targets[0]); assert.deepEqual(started.size, [320, 1]);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.targets[0].disposals, 0); pending.resolve(); await request; assert.equal(f.targets[0].disposals, 1);
});


test('dispose drains the whole pending readback and target cleanup before context loss, without propagating failure', async () => {
  for (const readFailure of [false, true]) {
    const pending = deferred(), reached = deferred(); let nativeFinished = false, contextReleased = false;
    const f = await fixture({read: async () => {reached.resolve(); await pending.promise; nativeFinished = true; if (readFailure) throw Error('native read failed');}});
    await f.photo.whenIdle(); const request = f.photo.render({...f.args, longEdge: 320});
    const rejected = assert.rejects(request, readFailure ? /native read failed/ : {code: 'studio_v3_photo_stale'}); await reached.promise;
    f.renderer.forceContextLoss = () => {assert.equal(nativeFinished, true); assert.equal(f.targets[0].disposals, 1); contextReleased = true;};
    assert.equal(f.photo.dispose(), true); assert.equal(f.photo.busy, true); let drained = false;
    const idle = f.photo.whenIdle().then(value => {assert.equal(value, undefined); drained = true;});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false); assert.equal(f.targets[0].disposals, 0); assert.equal(contextReleased, false);
    pending.resolve(); await idle; assert.equal(f.targets[0].disposals, 1); assert.equal(f.photo.busy, false); f.renderer.forceContextLoss(); assert.equal(contextReleased, true);
    await rejected; await f.photo.whenIdle(); assert.equal(f.canvases.length, 0);
  }
});
