const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), import('../src/features/studio-v3/runtime.mjs'),
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/camera-optics.mjs')]);
const near = (actual, expected, tolerance = 1e-7) => assert(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function surface(extra = {}) {
  const listeners = new Map(), capture = options => typeof options === 'boolean' ? options : !!options?.capture;
  return Object.assign({
    addEventListener(type, callback, options) {const entries = listeners.get(type) || []; entries.push({callback, capture: capture(options)}); listeners.set(type, entries);},
    removeEventListener(type, callback, options) {const entries = (listeners.get(type) || []).filter(entry => entry.callback !== callback || entry.capture !== capture(options)); if (entries.length) listeners.set(type, entries); else listeners.delete(type);},
    emit(type, fields = {}) {
      const event = {type, target: this, pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, clientX: 200, clientY: 200, pageX: 200, pageY: 200,
        deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        preventDefault() {this.defaultPrevented = true;}, stopPropagation() {}, stopImmediatePropagation() {this.stopped = true;}, ...fields};
      event.composedPath ||= () => [event.target];
      for (const {callback} of [...listeners.get(type) || []].sort((a, b) => Number(b.capture) - Number(a.capture))) {callback(event); if (event.stopped) break;}
      return event;
    }, count() {return [...listeners.values()].reduce((total, entries) => total + entries.length, 0);}
  }, extra);
}
async function fixture({autoRender = true} = {}) {
  const [THREE, {OrbitControls}, {createStudioV3Runtime}, schema, actions, world, optics] = await modules;
  const window = surface(), document = surface({defaultView: window, visibilityState: 'visible'}), captures = new Set();
  const canvas = surface({ownerDocument: document, style: {}, clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600}), getRootNode: () => document,
    setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id)});
  let state = schema.createState({worldNodeId: 'saved-view-owner', now: 1});
  for (const [id, kind] of [['camera-a', 'camera'], ['prop-a', 'prop']]) state = actions.reduceEntityAction(state, {type: 'create', id, kind, ...kind === 'prop' ? {assetId: 'chair-office'} : {}}, {now: 2}).state;
  let current = true, temporal = {}, resource = null, fence = {nodeId: 'saved-view-owner', sessionToken: 'one', nativeId: 'native:one', revision: 1, editEpoch: 0}, renderFailure = null, inputEnabled = true;
  const frames = new Map(), edits = [], draws = [], statuses = []; let serial = 0, time = 1000, disposals = 0;
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} detach() {this.object = null;} attach(object) {this.object = object;} setMode() {} dispose() {}}
  const runtime = createStudioV3Runtime({canvas, getState: () => state, isCurrent: () => current, getFence: () => structuredClone(fence), getSourceResource: () => resource, getTemporalStatus: () => temporal,
    autoRender, now: () => time, requestFrame(callback) {frames.set(++serial, callback); return serial;}, cancelFrame: id => frames.delete(id),
    controlsFactory: camera => new OrbitControls(camera, canvas), transformFactory: () => new Transform(),
    rendererFactory: () => ({domElement: canvas, setPixelRatio() {}, setSize() {}, getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget() {}, render(scene, camera) {if (renderFailure) throw renderFailure; draws.push(camera);}, dispose() {disposals++;}, forceContextLoss() {}}),
    loader: {async load() {const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())); return {root, format: 'glb', animations: [], dispose() {}};}},
    onStatus: event => statuses.push(event), canControlInput: () => inputEnabled,
    onCameraEdit(event) {edits.push(['camera', event]); return true;}, onControl(event) {edits.push(['control', event]); return true;}, onTransform(event) {edits.push(['transform', event]); return true;}});
  await runtime.sync();
  const f = {THREE, optics, runtime, canvas, window, document, captures, frames, edits, draws, statuses, world,
    get state() {return state;}, setState(value) {state = value;}, setCurrent(value) {current = value;}, setResource(value) {resource = value;}, setTemporal(value) {temporal = value;}, setInput(value) {inputEnabled = value;},
    setFence(value) {fence = {...fence, ...value};}, failRender(value) {renderFailure = value;}, get disposals() {return disposals;},
    step(count = 1, gapMs = 50) {for (let i = 0; i < count; i++) {const entry = frames.entries().next().value; if (!entry) break; frames.delete(entry[0]); time += gapMs; entry[1](time);}},
    idle(gapMs) {time += gapMs;},
    stored(patch = {}) {return optics.cameraOpticsPatch({}, {position: {x: -3, y: 4, z: 2}, rotation: {x: .24, y: -.51, z: .31, order: 'ZYX'}, focalLength: 85, frameAspectRatio: 9 / 16, apertureFNumber: 2, depthOfFieldMode: 'aperture', focusDistance: 7, ...patch});}
  };
  f.step(2); return f;
}
function poseNear(f, expected) {
  const camera = f.runtime.orbitCamera, quaternion = new f.THREE.Quaternion().setFromEuler(new f.THREE.Euler(expected.rotation.x, expected.rotation.y, expected.rotation.z, expected.rotation.order || 'XYZ'));
  near(camera.position.distanceTo(new f.THREE.Vector3(expected.position.x, expected.position.y, expected.position.z)), 0);
  near(Math.abs(camera.quaternion.dot(quaternion)), 1); near(camera.fov, expected.fov);
  const target = camera.position.clone().addScaledVector(new f.THREE.Vector3(0, 0, -1).applyQuaternion(quaternion), expected.focusDistance ?? 10);
  near(f.runtime.controls.target.distanceTo(target), 0);
}
test('navigation snapshots use the detached target during the official .8s transition and the endpoint keeps full optics, pose and pivot', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const {runtime} = f, authored = structuredClone(f.state), camera = f.stored(), expected = structuredClone(camera), start = runtime.orbitCamera.position.clone(), fov = runtime.orbitCamera.fov;
  let settled = null; const restore = runtime.restoreNavigationCamera(camera).then(value => {settled = value; return value;});
  assert.equal(runtime.camera, runtime.orbitCamera); assert.equal(runtime.view, 'orbit'); assert.equal(runtime.controls.enabled, false);
  assert.deepEqual(runtime.getNavigationCameraState(), expected); assert.notDeepEqual(runtime.getVisibleCameraState().position, expected.position);
  camera.position.x = 999; camera.focus.distance = 100; const detached = runtime.getNavigationCameraState(); detached.position.x = 888;
  f.step(8); near(runtime.orbitCamera.position.x, (start.x + expected.position.x) / 2); near(runtime.orbitCamera.fov, (fov + expected.fov) / 2);
  assert.deepEqual(runtime.getNavigationCameraState(), expected); assert.equal(settled, null);
  f.step(7); await Promise.resolve(); assert.equal(settled, null); f.step(1); assert.equal(await restore, true); poseNear(f, expected);
  assert.equal(runtime.controls.enabled, true); assert.deepEqual(runtime.orbitCamera.userData.studioV3Optics, expected); near(runtime.orbitCamera.getFocalLength(), expected.focalLength);
  const endpoint = runtime.getNavigationCameraState(); assert.equal(endpoint.rotation.order, expected.rotation.order); for (const axis of ['x', 'y', 'z']) near(endpoint.rotation[axis], expected.rotation[axis]);
  f.step(10); poseNear(f, expected); assert.equal(f.frames.size, 0); assert.deepEqual(f.state, authored); assert.deepEqual(f.edits, []); assert.equal(runtime.possessing, null); assert.equal(runtime.capturing, false);
});
test('saved-view duration follows wall-clock delivery gaps without accelerating legacy animation or physics, and hidden still cancels', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const camera = f.stored(), authored = structuredClone(f.state);
  f.idle(5000); const start = f.runtime.orbitCamera.position.clone(), restore = f.runtime.restoreNavigationCamera(camera);
  f.step(1, 400); near(f.runtime.orbitCamera.position.x, (start.x + camera.position.x) / 2); assert.equal(f.runtime.controls.enabled, false);
  f.step(1, 400); assert.equal(await restore, true); poseNear(f, camera); assert.equal(f.runtime.controls.enabled, true);
  const delayed = f.runtime.restoreNavigationCamera(f.stored({position: {x: 7, y: 2, z: 5}})); f.step(1, 5000); assert.equal(await delayed, true); assert.equal(f.runtime.controls.enabled, true);
  // graph.tick and native controls still receive the existing .05s maximum.
  const ticks = [], graphTick = f.runtime.graph.tick; f.runtime.graph.tick = delta => {ticks.push(delta); return graphTick(delta);};
  assert.equal(f.runtime.startCameraControl('camera-a'), true); const possessionStart = f.runtime.camera.position.clone(); f.step(1, 5000);
  assert(f.runtime.camera.position.distanceTo(possessionStart) < .1, 'existing possession transition advances only its capped frame delta'); near(ticks.at(-1), .05);
  f.runtime.finishCameraControl(); const returningStart = f.runtime.orbitCamera.position.clone(); f.step(1, 5000);
  assert.equal(f.runtime.controls.enabled, false, 'existing .55s return still advances by capped delta'); assert(f.runtime.orbitCamera.position.distanceTo(returningStart) < .1); f.step(15);
  const hiddenRestore = f.runtime.restoreNavigationCamera(camera); f.step(1, 200); const visible = f.runtime.orbitCamera.position.clone(); f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange');
  assert.equal(await hiddenRestore, false); f.idle(5000); f.document.visibilityState = 'visible'; f.document.emit('visibilitychange'); f.step(1, 5000); near(f.runtime.orbitCamera.position.distanceTo(visible), 0);
  assert.deepEqual(f.state, authored); assert(f.edits.every(([kind]) => kind === 'camera'), 'only the explicitly exercised legacy possession emits edit callbacks');
});
test('viewport resizing never changes fixed photographic ratio, FOV, aperture or focus, and visible API retains its viewport contract', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const camera = f.stored();
  assert.equal(f.runtime.getNavigationCameraState().frameAspectRatio, null); f.runtime.resize(1000, 400); assert.equal(f.runtime.getNavigationCameraState().frameAspectRatio, null);
  const restore = f.runtime.restoreNavigationCamera(camera); f.step(4); f.runtime.resize(1000, 400);
  assert.equal(f.runtime.getNavigationCameraState().frameAspectRatio, 9 / 16); near(f.runtime.orbitCamera.aspect, 2.5); f.step(12); assert.equal(await restore, true);
  for (const [width, height] of [[400, 1000], [1600, 900]]) {
    f.runtime.resize(width, height); near(f.runtime.orbitCamera.aspect, width / height); poseNear(f, camera); near(f.runtime.orbitCamera.getFocalLength(), 85);
    const navigation = f.runtime.getNavigationCameraState(); near(navigation.frameAspectRatio, 9 / 16); near(navigation.apertureFNumber, 2); assert.deepEqual(navigation.focus, camera.focus);
    near(f.runtime.getVisibleCameraState().frameAspectRatio, width / height);
  }
});
test('orbit-only snapshot rejects plan, preview, possession, entity control and viewfinder instead of inventing a perspective pose', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  for (const enter of [() => f.runtime.setView('plan'), () => f.runtime.previewCamera('camera-a'), () => f.runtime.beginViewfinder(), () => f.runtime.startCameraControl('camera-a'), () => f.runtime.startControl('prop-a')]) {
    f.runtime.setView('orbit'); f.step(20); enter(); assert.equal(f.runtime.getNavigationCameraState(), null); assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false);
  }
});
test('native pointer and wheel interrupt at the visible pose, while a newer restore settles its predecessor false', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  for (const type of ['pointerdown', 'wheel']) {
    const restore = f.runtime.restoreNavigationCamera(f.stored()); f.step(4); const visible = f.runtime.orbitCamera.position.clone();
    f.canvas.emit(type, type === 'wheel' ? {deltaY: 0} : {}); assert.equal(await restore, false); near(f.runtime.orbitCamera.position.distanceTo(visible), 0);
    if (type === 'pointerdown') f.document.emit('pointerup', {target: f.canvas}); f.step(10); assert.equal(f.runtime.controls.enabled, true);
  }
  const first = f.runtime.restoreNavigationCamera(f.stored()); f.step(4); const secondCamera = f.stored({position: {x: 5, y: 3, z: 1}}), second = f.runtime.restoreNavigationCamera(secondCamera);
  assert.equal(await first, false); assert.deepEqual(f.runtime.getNavigationCameraState(), secondCamera); f.step(16); assert.equal(await second, true); poseNear(f, secondCamera);
  const predecessor = f.runtime.restoreNavigationCamera(f.stored()); f.step(2); const visible = f.runtime.orbitCamera.position.clone(); assert.equal(await f.runtime.restoreNavigationCamera({}), false); assert.equal(await predecessor, false); near(f.runtime.orbitCamera.position.distanceTo(visible), 0); assert.equal(f.runtime.controls.enabled, true);
});
test('setView/home, focus, preview, viewfinder and control transitions cancel pending restores without changing legacy return semantics', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  for (const change of [() => f.runtime.setView('orbit'), () => f.runtime.setView('plan'), () => f.runtime.focusEntity('prop-a'), () => f.runtime.previewCamera('camera-a'), () => f.runtime.beginViewfinder(), () => f.runtime.startCameraControl('camera-a'), () => f.runtime.startControl('prop-a')]) {
    f.runtime.setView('orbit'); f.step(20); const restore = f.runtime.restoreNavigationCamera(f.stored()); f.step(2); change(); assert.equal(await restore, false);
  }
});
test('source, setup, session, native identity and host current fences refuse late application before or after sync', async t => {
  for (const change of [f => f.setResource({url: '/new-scene.glb', format: 'glb'}), f => f.setState(f.world.setActiveSetup(f.state, 'setup-default')), f => f.setFence({sessionToken: 'two'}), f => f.setFence({nativeId: 'native:two'}), f => f.setCurrent(false)]) {
    const f = await fixture(); t.after(() => f.runtime.dispose()); const restore = f.runtime.restoreNavigationCamera(f.stored()); f.step(2); const position = f.runtime.orbitCamera.position.clone(); change(f); f.step(1);
    assert.equal(await restore, false); near(f.runtime.orbitCamera.position.distanceTo(position), 0); assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false);
    if (f.runtime.controls.enabled) {await f.runtime.sync(); f.step(20); near(f.runtime.orbitCamera.position.distanceTo(position), 0);}
  }
  const f = await fixture(); t.after(() => f.runtime.dispose()); let current = true; const restore = f.runtime.restoreNavigationCamera(f.stored(), {isCurrent: () => current}); f.step(2); current = false; f.step(1); assert.equal(await restore, false); assert.equal(f.runtime.controls.enabled, true);
  const pending = f.runtime.restoreNavigationCamera(f.stored()); f.setResource({url: '/third-scene.glb', format: 'glb'}); await f.runtime.sync(); assert.equal(await pending, false); f.step(20); assert.equal(f.runtime.controls.enabled, true);
});
test('capture, pause, hidden, temporal and rendering failure cancellation settle false and release navigation locks', async t => {
  for (const block of ['capture', 'photo', 'pause', 'hidden', 'playing', 'scrubbing', 'render']) {
    const f = await fixture(); t.after(() => f.runtime.dispose()); const restore = f.runtime.restoreNavigationCamera(f.stored()); f.step(2); let release;
    if (block === 'capture') f.runtime.setCapturing(true);
    if (block === 'photo') await assert.rejects(f.runtime.renderPhoto(undefined, {encode: false, width: 20, height: 20}));
    if (block === 'pause') release = f.runtime.acquireRenderingPause();
    if (block === 'hidden') {f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange');}
    if (block === 'playing' || block === 'scrubbing') f.setTemporal({[block]: true});
    if (block === 'render') f.failRender(Error('draw failed'));
    f.step(1); assert.equal(await restore, false); assert.equal(await f.runtime.restoreNavigationCamera(f.stored(), {isCurrent: () => false}), false);
    if (block === 'capture') {assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false); f.runtime.setCapturing(false);}
    if (block === 'pause') {assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false); release();}
    if (block === 'hidden') {assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false); f.document.visibilityState = 'visible'; f.document.emit('visibilitychange');}
    if (block === 'playing' || block === 'scrubbing') {assert.equal(await f.runtime.restoreNavigationCamera(f.stored()), false); f.setTemporal({});}
    f.failRender(null); assert.equal(f.runtime.controls.enabled, true); assert.deepEqual(f.edits, []);
  }
});
test('malformed inputs and stale host guard refuse restoration, menus do not block programmatic restore, null focus uses a stable optical pivot', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  for (const camera of [null, {}, f.stored({position: {x: NaN, y: 1, z: 2}}), {...f.stored(), fov: 180}, {...f.stored(), rotation: {x: 0, y: 0, z: 0, order: 'bad'}}, {...f.stored(), focus: {mode: 'point'}}]) {
    assert.equal(await f.runtime.restoreNavigationCamera(camera), false); assert.equal(f.runtime.controls.enabled, true);
  }
  assert.equal(await f.runtime.restoreNavigationCamera(f.stored(), {duration: -1}), false);
  const camera = f.stored({focusDistance: null}); f.setInput(false); const restore = f.runtime.restoreNavigationCamera(camera); f.step(16); assert.equal(await restore, true); poseNear(f, camera);
  assert.equal(f.runtime.orbitCamera.userData.studioV3Optics.focusDistance, null);
  const automatic = f.stored({frameAspectRatio: null}); f.runtime.resize(400, 1000); assert.equal(await f.runtime.restoreNavigationCamera(automatic, {duration: 0}), true); assert.equal(f.runtime.getNavigationCameraState().frameAspectRatio, null); near(f.runtime.orbitCamera.getFocalLength(), automatic.focalLength); poseNear(f, automatic);
  const manual = await fixture({autoRender: false}); t.after(() => manual.runtime.dispose()); assert.equal(await manual.runtime.restoreNavigationCamera(manual.stored()), false); assert.equal(manual.runtime.controls.enabled, true); assert.equal(await manual.runtime.restoreNavigationCamera(manual.stored(), {duration: 0}), true);
});
test('old native damping cannot drift a restored endpoint, and destroy settles pending restore and releases all native listeners', async () => {
  const f = await fixture(); f.canvas.emit('pointerdown'); f.document.emit('pointermove', {target: f.canvas, clientX: 280, clientY: 230}); f.document.emit('pointerup', {target: f.canvas});
  const camera = f.stored(), restore = f.runtime.restoreNavigationCamera(camera); f.step(16); assert.equal(await restore, true); f.step(15); poseNear(f, camera); assert.equal(f.frames.size, 0);
  const pending = f.runtime.restoreNavigationCamera(f.stored({position: {x: 8, y: 5, z: 3}})); f.step(2); await f.runtime.dispose(); assert.equal(await pending, false);
  assert.equal(f.runtime.disposed, true); assert.equal(f.frames.size, 0); assert.equal(f.runtime.getNavigationCameraState(), null); assert.equal(await f.runtime.restoreNavigationCamera(camera), false); assert.equal(f.disposals, 1);
  assert.equal(f.canvas.count() + f.document.count() + f.window.count(), 0);
});
test('existing camera and entity return animations still restore their original orbit lease, whose target is readable during interpolation', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const camera = f.stored(); assert.equal(await f.runtime.restoreNavigationCamera(camera, {duration: 0}), true);
  for (const [start, finish] of [[() => f.runtime.startCameraControl('camera-a'), () => f.runtime.finishCameraControl()], [() => f.runtime.startControl('prop-a'), () => f.runtime.cancelControl()]]) {
    const home = f.runtime.getNavigationCameraState(), homePosition = f.runtime.orbitCamera.position.clone(), target = f.runtime.controls.target.clone();
    assert.equal(start(), true); f.step(20); assert.equal(f.runtime.getNavigationCameraState(), null); finish();
    const returning = f.runtime.getNavigationCameraState(); assert.deepEqual(returning.position, home.position); near(returning.fov, home.fov); near(returning.frameAspectRatio, home.frameAspectRatio);
    f.step(15); near(f.runtime.orbitCamera.position.distanceTo(homePosition), 0); near(f.runtime.controls.target.distanceTo(target), 0); near(f.runtime.orbitCamera.fov, home.fov); assert.equal(f.runtime.controls.enabled, true); assert.equal(f.runtime.view, 'orbit');
  }
  assert.deepEqual(f.statuses.filter(event => event.status === 'failed'), []);
});
