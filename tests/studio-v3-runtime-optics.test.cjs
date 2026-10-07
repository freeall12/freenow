const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/runtime.mjs')]);
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
async function fixture({splat = true, autoRender = false} = {}) {
  const [THREE, schema, actions, {createStudioV3Runtime}] = await modules;
  let state = schema.createState({worldNodeId: 'runtime-optics', now: 1}), current = true, resource = splat ? {sourceUrl: '/local-test.spz', sourceFormat: 'spz'} : null;
  const action = value => {state = actions.reduceEntityAction(state, value, {now: 2}).state;return state;};
  action({type: 'create', kind: 'camera', id: 'camera-a', camera: {focalLength: 50, apertureFNumber: 2, depthOfFieldMode: 'aperture', focusDistance: 4}});
  action({type: 'create', kind: 'camera', id: 'camera-b', camera: {focalLength: 85, apertureFNumber: 11, depthOfFieldMode: 'aperture', position: {x: 0, y: 0, z: -2}, focus: {mode: 'point', target: {x: 0, y: 0, z: -20}}}});
  action({type: 'create', kind: 'prop', id: 'target', assetId: 'chair-office', transform: {position: {x: 1, y: 1, z: -6}}});
  const frames = [], clears = [], pending = new Map(), cancelled = [], spark = {focalDistance: 0, apertureAngle: 0}; let nextFrame = 0, controlsUpdates = 0, renderFailure = null, disposalCount = 0, settleGate = null;
  let viewport = [0, 0, 400, 300], scissor = [...viewport], scissorTest = false, clearColor = new THREE.Color('#39464a'), clearAlpha = .8, canvasBounds = {left: 0, top: 0, width: 400, height: 300};
  class Controls extends THREE.EventDispatcher {constructor(camera) {super();this.object = camera;this.target = new THREE.Vector3();this.enabled = true;} update() {controlsUpdates++;return false;} dispose() {}}
  class Transform extends THREE.EventDispatcher {constructor(camera) {super();this.camera = camera;this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(root) {this.object = root;} detach() {this.object = null;} setMode(mode) {this.mode = mode;} dispose() {}}
  const canvas = {clientWidth: 400, clientHeight: 300, style: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({...canvasBounds})};
  const renderer = {domElement: canvas, setPixelRatio() {}, setSize() {},
    setViewport(...value) {viewport = value;}, setScissor(...value) {scissor = value;}, setScissorTest(value) {scissorTest = value;},
    getClearColor(target) {return target.copy(clearColor);}, getClearAlpha() {return clearAlpha;}, setClearColor(color, alpha = 1) {clearColor.set(color);clearAlpha = alpha;}, clear() {clears.push({viewport: [...viewport], scissorTest, clearColor: clearColor.getHex(), clearAlpha});},
    render(scene, camera) {if (renderFailure) throw renderFailure;frames.push({camera, focalDistance: spark.focalDistance, apertureAngle: spark.apertureAngle, viewport: [...viewport], scissor: [...scissor], scissorTest});}, dispose() {}, forceContextLoss() {}};
  const context = {entries: new Map(), layer: new THREE.Group(), async settle() {if (settleGate) await settleGate;this.spark = spark;}, render(root, camera, draw) {return draw();}, prune(root) {for (const proxy of this.entries.keys()) {let found = false;root.traverse(node => {if (node === proxy) found = true;});if (!found) this.entries.delete(proxy);}}, async dispose() {assert.equal(spark.focalDistance, 0);assert.equal(spark.apertureAngle, 0);disposalCount++;this.spark = null;}};
  const runtime = createStudioV3Runtime({canvas, getState: () => state, getSourceResource: () => resource, isCurrent: () => current, autoRender,
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: camera => new Transform(camera), splatFactory: () => context,
    requestFrame(fn) {const id = ++nextFrame;pending.set(id, fn);return id;}, cancelFrame(id) {cancelled.push(id);pending.delete(id);},
    loader: {async load(descriptor) {const root = new THREE.Group(); if (descriptor.sourceFormat === 'spz') {root.userData.worldSplat = {version: 1, format: 'spz', url: descriptor.sourceUrl, count: 1, bounds: [[-10, -1, -10], [10, 10, 10]]};return {root, format: 'spz', animations: [], splatMesh: new THREE.Group(), transferSplat() {}, dispose() {}};}root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));return {root, format: 'glb', animations: [], dispose() {}};}}});
  await runtime.sync();
  return {runtime, action, frames, clears, spark, context, pending, cancelled, get state() {return state;}, get controlsUpdates() {return controlsUpdates;}, get disposalCount() {return disposalCount;}, get rendererState() {return {viewport: [...viewport], scissor: [...scissor], scissorTest, clearColor: clearColor.getHex(), clearAlpha};},
    stale() {current = false;}, failRender(value) {renderFailure = value;}, source(value) {resource = value;}, gateSettle(value) {settleGate = value;}, setState(value) {state = value;},
    canvasBounds(value) {canvasBounds = value;canvas.clientWidth = value.width;canvas.clientHeight = value.height;},
    pump(time = 100) {const [id, fn] = pending.entries().next().value || [];if (fn) {pending.delete(id);fn(time);}}};
}
test('selected camera optics do not affect actual orbit/plan render, and valid read-only preview uses only its camera', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    assert.equal(runtime.depthOfFieldSupported, true);runtime.selectEntity('camera-a');runtime.render();assert.equal(f.frames.at(-1).camera, runtime.orbitCamera);assert.equal(f.spark.focalDistance, 0);
    assert.equal(runtime.previewCamera('camera-b'), true);assert.equal(runtime.view, 'camera');assert.equal(runtime.previewCameraEntityId, 'camera-b');assert.equal(runtime.camera, runtime.entityCamera('camera-b'));
    assert.equal(runtime.controls.enabled, false);assert.equal(runtime.attachTransform('target'), false);assert.equal(runtime.focusEntity('target'), false);
    runtime.render();assert.equal(f.frames.at(-1).camera, runtime.entityCamera('camera-b'));assert.equal(f.spark.focalDistance, 18);near(f.spark.apertureAngle, 2 * Math.atan(1 / 22) * .03);
    runtime.selectEntity('camera-a');runtime.render();assert.equal(f.spark.focalDistance, 18, 'selection does not change preview optical source');
    runtime.resize(700, 500);assert.equal(runtime.entityCamera('camera-b').aspect, 16 / 9);
    assert.equal(runtime.clearCameraPreview(), 'orbit');assert.equal(f.spark.focalDistance, 0);runtime.setView('plan');runtime.previewCamera('camera-a');assert.equal(runtime.cameraPreviewReturnView, 'plan');assert.equal(runtime.clearCameraPreview(), 'plan');
    runtime.previewCamera('camera-a');runtime.setView('orbit');assert.equal(runtime.previewCameraEntityId, null);assert.equal(runtime.controls.enabled, true);assert.equal(f.spark.apertureAngle, 0);
  } finally {await runtime.dispose();}
});
test('preview sync uses updated aperture and object focus with local offset, and visibility/removal leave preview safely', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    runtime.previewCamera('camera-a');runtime.render();assert.equal(f.spark.focalDistance, 4);
    f.action({type: 'update', entityId: 'camera-a', patch: {camera: {apertureFNumber: 4, focus: {mode: 'object', entityId: 'target', offset: {x: 0, y: 0, z: -1}}}}});await runtime.sync();runtime.render();near(f.spark.focalDistance, 7.05);near(f.spark.apertureAngle, 2 * Math.atan(1 / 8) * .03);
    f.action({type: 'update', entityId: 'target', patch: {transform: {position: {z: -9}}}});await runtime.sync();runtime.render();near(f.spark.focalDistance, 10.05);
    f.action({type: 'update', entityId: 'camera-a', patch: {camera: {depthOfFieldMode: 'deepFocus'}}});await runtime.sync();assert.equal(f.spark.focalDistance, 0);assert.equal(f.spark.apertureAngle, 0);
    f.action({type: 'update', entityId: 'camera-a', patch: {visible: false}});await runtime.sync();assert.equal(runtime.view, 'orbit');assert.equal(runtime.previewCamera('camera-a'), false);assert.equal(runtime.previewCamera('target'), false);
    runtime.previewCamera('camera-b');f.action({type: 'remove', entityId: 'camera-b', mode: 'global'});await runtime.sync();assert.equal(runtime.view, 'orbit');assert.equal(runtime.camera, runtime.orbitCamera);assert.equal(f.spark.focalDistance, 0);
  } finally {await runtime.dispose();}
});
test('temporary photographic capture assigns captured lens and restores actual visible preview on success and throw', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    runtime.previewCamera('camera-a');await runtime.renderCapture(runtime.entityCamera('camera-b'));
    assert.equal(f.frames.at(-1).camera, runtime.entityCamera('camera-b'));assert.equal(f.frames.at(-1).focalDistance, 18);assert.equal(f.spark.focalDistance, 4);
    f.failRender(Error('GPU draw failed'));await assert.rejects(runtime.renderCapture(runtime.entityCamera('camera-b')), /GPU draw failed/);assert.equal(f.spark.focalDistance, 4);assert.equal(runtime.graph.entity('camera-a').root.visible, true);
    f.failRender(null);runtime.clearCameraPreview();await runtime.renderCapture(runtime.entityCamera('camera-a'));assert.equal(f.frames.at(-1).focalDistance, 4);assert.equal(f.spark.focalDistance, 0);assert.equal(f.spark.apertureAngle, 0);
  } finally {await runtime.dispose();}
});
test('failed async capture and stale ownership clear Spark parameters and never render a late capture', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    runtime.previewCamera('camera-a');f.gateSettle(Promise.reject(Error('sort failed')));
    await assert.rejects(runtime.renderCapture(runtime.entityCamera('camera-b')), /sort failed/);assert.equal(f.spark.focalDistance, 4);
    let release;f.gateSettle(new Promise(resolve => {release = resolve;}));const capture = runtime.renderCapture(runtime.entityCamera('camera-b')), draws = f.frames.length;
    f.stale();release();await assert.rejects(capture, /所有权已变化/);assert.equal(f.frames.length, draws);assert.equal(f.spark.focalDistance, 0);assert.equal(f.spark.apertureAngle, 0);
    assert.deepEqual(runtime.sparkDepthOfFieldParameters(), {focalDistance: 0, apertureAngle: 0});assert.throws(() => runtime.render(), /所有权已变化/);assert.equal(runtime.previewCameraEntityId, null);assert.equal(runtime.depthOfFieldSupported, false);
  } finally {await runtime.dispose();}
});
test('source changes exit preview and scene setup changes cannot retain a previous camera or depth of field', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    runtime.setView('plan');runtime.previewCamera('camera-a');assert.equal(f.spark.focalDistance, 4);
    f.source(null);await runtime.sync();assert.equal(runtime.view, 'plan');assert.equal(runtime.previewCameraEntityId, null);assert.equal(f.spark.focalDistance, 0);
    runtime.previewCamera('camera-a');const {setActiveSetup} = await import('../src/features/studio-v3/world-space.mjs');f.setState(setActiveSetup(f.state, 'setup-default'));await runtime.sync();assert.equal(runtime.view, 'plan');assert.equal(runtime.entityCamera('camera-a'), null);assert.equal(f.spark.apertureAngle, 0);
  } finally {await runtime.dispose();}
});
test('static camera preview remains on-demand, suppresses orbit damping writes and disposes queued frames and Spark state', async () => {
  const f = await fixture({autoRender: true}), {runtime} = f;
  const authored = structuredClone(f.state.scenePlay.worldSpace.setups);
  assert.equal(f.pending.size, 1);runtime.previewCamera('camera-a');const controlsUpdates = f.controlsUpdates;f.pump();assert.equal(f.pending.size, 0);assert.equal(f.controlsUpdates, controlsUpdates);assert.equal(f.spark.focalDistance, 4);assert.deepEqual(f.state.scenePlay.worldSpace.setups, authored);
  runtime.resize(500, 300);assert.equal(f.pending.size, 1);await runtime.dispose();assert.equal(f.pending.size, 0);assert.equal(f.cancelled.length, 1);assert.equal(f.disposalCount, 1);assert.equal(runtime.depthOfFieldSupported, false);assert.equal(runtime.previewCameraEntityId, null);assert.equal(f.spark.focalDistance, 0);assert.equal(f.spark.apertureAngle, 0);await runtime.dispose();assert.equal(f.disposalCount, 1);
});
test('ordinary GLB scenes offer actual camera preview while accurately reporting no Gaussian depth-of-field renderer', async () => {
  const f = await fixture({splat: false}), {runtime} = f;
  try {assert.equal(runtime.depthOfFieldSupported, false);assert.equal(runtime.previewCamera('camera-a'), true);runtime.render();assert.equal(f.frames.at(-1).camera, runtime.entityCamera('camera-a'));assert.equal(f.context.spark, undefined);assert.equal(f.spark.focalDistance, 0);} finally {await runtime.dispose();}
});
test('source or camera removal during asynchronous capture rejects its obsolete frame and restores navigation optics', async () => {
  const f = await fixture(), {runtime} = f;
  try {
    runtime.previewCamera('camera-a');let release;f.gateSettle(new Promise(resolve => {release = resolve;}));
    const capture = runtime.renderCapture(runtime.entityCamera('camera-b')), draws = f.frames.length;
    f.source(null);await runtime.sync();release();await assert.rejects(capture, error => error.code === 'studio_v3_capture_stale');assert.equal(f.frames.length, draws);assert.equal(f.spark.focalDistance, 0);assert.equal(runtime.view, 'orbit');
    f.gateSettle(null);runtime.previewCamera('camera-a');let releaseAgain;f.gateSettle(new Promise(resolve => {releaseAgain = resolve;}));
    const removed = runtime.renderCapture(runtime.entityCamera('camera-a'));f.action({type: 'remove', entityId: 'camera-a', mode: 'global'});await runtime.sync();releaseAgain();await assert.rejects(removed, error => error.code === 'studio_v3_capture_stale');assert.equal(f.spark.apertureAngle, 0);
  } finally {await runtime.dispose();}
});
test('camera preview fits landscape and portrait frame without changing optical projection, then restores full renderer state', async () => {
  const f = await fixture({splat: false}), {runtime} = f;
  try {
    runtime.previewCamera('camera-a');const projection = runtime.camera.projectionMatrix.clone();runtime.render();
    assert.deepEqual(runtime.cameraPreviewRect, {left: 0, top: 37.5, width: 400, height: 225});assert.deepEqual(f.frames.at(-1).viewport, [0, 37.5, 400, 225]);assert.equal(f.frames.at(-1).scissorTest, true);
    near(f.frames.at(-1).viewport[2] / f.frames.at(-1).viewport[3], runtime.camera.aspect);assert(runtime.camera.projectionMatrix.equals(projection));
    assert.deepEqual(f.clears.at(-1), {viewport: [0, 0, 400, 300], scissorTest: false, clearColor: 0, clearAlpha: 1});
    assert.deepEqual(f.rendererState, {viewport: [0, 0, 400, 300], scissor: [0, 0, 400, 300], scissorTest: false, clearColor: 0x39464a, clearAlpha: .8});
    f.action({type: 'update', entityId: 'camera-b', patch: {camera: {frameAspectRatio: 9 / 16}}});await runtime.sync();runtime.previewCamera('camera-b');runtime.render();
    assert.deepEqual(runtime.cameraPreviewRect, {left: 115.625, top: 0, width: 168.75, height: 300});assert.deepEqual(f.frames.at(-1).viewport, [115.625, 0, 168.75, 300]);near(f.frames.at(-1).viewport[2] / f.frames.at(-1).viewport[3], 9 / 16);
    f.canvasBounds({left: 20, top: 30, width: 800, height: 600});runtime.resize(800, 600);assert.deepEqual(runtime.cameraPreviewRect, {left: 231.25, top: 0, width: 337.5, height: 600});runtime.render();assert.deepEqual(f.frames.at(-1).viewport, [231.25, 0, 337.5, 600]);
    runtime.clearCameraPreview();assert.equal(runtime.cameraPreviewRect, null);runtime.render();assert.deepEqual(f.frames.at(-1).viewport, [0, 0, 800, 600]);assert.equal(f.frames.at(-1).scissorTest, false);
    runtime.previewCamera('camera-b');f.action({type: 'remove', entityId: 'camera-b', mode: 'global'});await runtime.sync();assert.equal(runtime.cameraPreviewRect, null);assert.equal(f.rendererState.scissorTest, false);
  } finally {await runtime.dispose();}
});
test('preview picking projects through the fitted CSS frame and rejects matte for entity and surface rays', async () => {
  const f = await fixture({splat: false}), {runtime} = f, [THREE] = await modules;
  try {
    // CSS scales the backing surface and offsets it within the page. Use an
    // off-centre known target to detect both scaling and frame-coordinate drift.
    f.canvasBounds({left: 20, top: 30, width: 800, height: 600});runtime.previewCamera('camera-a');
    const object = runtime.entityObject('target'), point = object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .17, 0));
    const ndc = point.clone().project(runtime.camera), rect = runtime.cameraPreviewRect;
    const client = {clientX: 20 + rect.left + (ndc.x + 1) * rect.width / 2, clientY: 30 + rect.top + (1 - ndc.y) * rect.height / 2};
    assert.equal(runtime.hitEntity(client)?.entityId, 'target');const surface = runtime.hitSurface(client, {groundFallback: false});assert.equal(surface?.source, 'mesh');assert(surface.point.x > .5);assert(surface.point.y > 1);
    assert.equal(runtime.hitEntity({clientX: 400, clientY: 50}), null);assert.equal(runtime.hitSurface({clientX: 400, clientY: 50}), null);
    f.action({type: 'update', entityId: 'camera-a', patch: {camera: {frameAspectRatio: 9 / 16}}});await runtime.sync();
    assert.equal(runtime.hitEntity({clientX: 30, clientY: 300}), null);assert.equal(runtime.hitSurface({clientX: 30, clientY: 300}), null);
  } finally {await runtime.dispose();}
});
test('capture fits its supplied lens independently of preview and restores matte/scissor/clear state after success and errors', async () => {
  const f = await fixture({autoRender: true}), {runtime} = f;
  try {
    f.action({type: 'update', entityId: 'camera-b', patch: {camera: {frameAspectRatio: 9 / 16}}});await runtime.sync();runtime.previewCamera('camera-b');f.pump();assert.equal(f.pending.size, 0);
    const preview = {...runtime.cameraPreviewRect};assert.deepEqual(f.frames.at(-1).viewport, [115.625, 0, 168.75, 300]);
    await runtime.renderCapture(runtime.entityCamera('camera-a'));assert.deepEqual(f.frames.at(-1).viewport, [0, 37.5, 400, 225]);assert.equal(f.frames.at(-1).camera, runtime.entityCamera('camera-a'));assert.deepEqual(runtime.cameraPreviewRect, preview);assert.equal(f.rendererState.scissorTest, false);
    assert.equal(f.pending.size, 1);f.pump(120);assert.deepEqual(f.frames.at(-1).viewport, [115.625, 0, 168.75, 300]);assert.equal(f.pending.size, 0, 'capture restoration schedules one frame without a permanent loop');
    f.failRender(Error('preview draw failed'));assert.throws(() => runtime.render(), /preview draw failed/);assert.deepEqual(f.rendererState.viewport, [0, 0, 400, 300]);assert.equal(f.rendererState.scissorTest, false);assert.equal(f.rendererState.clearColor, 0x39464a);
    await assert.rejects(runtime.renderCapture(runtime.entityCamera('camera-a')), /preview draw failed/);assert.deepEqual(runtime.cameraPreviewRect, preview);assert.equal(f.rendererState.scissorTest, false);near(f.spark.focalDistance, 18);
    f.failRender(null);runtime.setView('plan');runtime.render();assert.equal(runtime.cameraPreviewRect, null);assert.deepEqual(f.frames.at(-1).viewport, [0, 0, 400, 300]);assert.equal(f.frames.at(-1).scissorTest, false);
  } finally {await runtime.dispose();}
});
