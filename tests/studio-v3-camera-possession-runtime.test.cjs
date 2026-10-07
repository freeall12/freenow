const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), import('../src/features/studio-v3/runtime.mjs'),
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/history.mjs')]);
const near = (actual, expected, tolerance = 1e-7) => assert(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function surface(extra = {}) {
  const listeners = new Map(), capture = options => typeof options === 'boolean' ? options : !!options?.capture;
  return Object.assign({listeners,
    addEventListener(type, callback, options) {const entries = listeners.get(type) || []; if (!entries.some(entry => entry.callback === callback && entry.capture === capture(options))) entries.push({callback, capture: capture(options)}); listeners.set(type, entries);},
    removeEventListener(type, callback, options) {const entries = (listeners.get(type) || []).filter(entry => entry.callback !== callback || entry.capture !== capture(options)); if (entries.length) listeners.set(type, entries); else listeners.delete(type);},
    emit(type, fields = {}) {
      const event = {type, target: this, defaultPrevented: false, pointerType: 'mouse', pointerId: 7, button: 0, buttons: 1, clientX: 220, clientY: 230, pageX: 220, pageY: 230,
        deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        preventDefault() {this.defaultPrevented = true;}, stopPropagation() {}, stopImmediatePropagation() {this.immediateStopped = true;}, ...fields};
      event.composedPath ||= () => [event.target]; for (const {callback} of [...listeners.get(type) || []]) {callback(event); if (event.immediateStopped) break;} return event;
    }, count() {return [...listeners.values()].reduce((sum, entries) => sum + entries.length, 0);}
  }, extra);
}
const pose = camera => ({position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect, zoom: camera.zoom});
function samePose(actual, expected) {
  actual.position.forEach((value, index) => near(value, expected.position[index])); actual.quaternion.forEach((value, index) => near(value, expected.quaternion[index]));
  if (expected.fov !== undefined) near(actual.fov, expected.fov); if (expected.aspect !== undefined) near(actual.aspect, expected.aspect); near(actual.zoom, expected.zoom);
}
async function fixture({initial, rejectPhase, enforceOwnership = false} = {}) {
  const [THREE, {OrbitControls}, {createStudioV3Runtime}, schema, actions, world, {createHistory}] = await modules;
  const window = surface(), document = surface({visibilityState: 'visible', defaultView: window}), captures = new Set();
  const canvas = surface({ownerDocument: document, style: {}, clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({left: 20, top: 30, width: 800, height: 600}), getRootNode: () => document,
    setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id)});
  const setupId = 'setup:state-1', lane = `setup:${setupId}`;
  let state = schema.createState({worldNodeId: 'possession-owner', now: 1});
  for (const id of ['camera-a', 'camera-b']) state = actions.reduceEntityAction(state, {type: 'create', kind: 'camera', id,
    camera: {position: {x: id === 'camera-a' ? 3 : -2, y: 2, z: 7}, rotation: {x: .25, y: .48, z: .16, order: 'YXZ'}, focalLength: 35, frameAspectRatio: 2.39}}, {now: 2}).state;
  state = world.patchEntityState(state, setupId, 'camera-a', {camera: {...state.scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(item => item.entityId === 'camera-a').camera,
    lookAt: {mode: 'point', target: {x: 0, y: 1, z: -3}}}}, 2);
  if (initial) state = initial(state, {schema, actions, world, setupId});
  let sequence = 0, current = true, fence = {nodeId: 'possession-owner', projectId: 'local', sessionToken: 'first', revision: 1, editEpoch: 0};
  const history = createHistory(state, {createId: () => `possession-edit:${++sequence}`, now: () => 3}), phases = [], statuses = [], draws = [];
  const frames = new Map(); let frameId = 0, time = 1000, viewport = [0, 0, 800, 600], scissor = viewport, scissorTest = false, rendererDisposals = 0, renderFailure = null;
  const renderer = {domElement: canvas, setPixelRatio() {}, setSize() {}, setViewport(...value) {viewport = value;}, setScissor(...value) {scissor = value;}, setScissorTest(value) {scissorTest = value;},
    getClearColor: color => color.set('#15171b'), getClearAlpha: () => 1, setClearColor() {}, clear() {},
    render(scene, camera) {
      const markers = {}; scene.traverse(object => {if (object.name.startsWith('director-camera:')) markers[object.userData.entityId] = object.visible;});
      draws.push({camera, viewport: [...viewport], scissor: [...scissor], scissorTest, markers}); if (renderFailure) throw renderFailure;
    }, dispose() {rendererDisposals++;}};
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(object) {this.object = object;} detach() {this.object = null;} setMode() {} dispose() {}}
  const runtime = createStudioV3Runtime({canvas, getState: history.getState, getFence: () => structuredClone(fence), isCurrent: () => current,
    autoRender: true, requestFrame: callback => {const id = ++frameId; frames.set(id, callback); return id;}, cancelFrame: id => frames.delete(id),
    rendererFactory: () => renderer, controlsFactory: camera => new OrbitControls(camera, canvas), transformFactory: () => new Transform(), onStatus: event => statuses.push(event),
    loader: {async load() {const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); return {root, format: 'glb', animations: [], dispose() {}};}},
    onCameraEdit(event) {
      phases.push(structuredClone(event)); if (enforceOwnership && !current || rejectPhase?.(event)) return false;
      if (event.phase === 'begin') return history.begin(lane, 'director.editCamera');
      if (event.phase === 'preview') {
        history.preview(previous => {
          if (event.clearLookAt) {
            const camera = structuredClone(previous.scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(item => item.entityId === event.entityId).camera);
            delete camera.lookAt; previous = world.patchEntityState(previous, setupId, event.entityId, {camera}, 3);
          }
          const result = actions.reduceEntityAction(previous, {type: 'update', entityId: event.entityId, setupId, patch: {camera: event.camera, transform: event.transform}}, {now: 3});
          assert.equal(result.ok, true); return result.state;
        }); fence = {...fence, revision: fence.revision + 1, editEpoch: fence.editEpoch + 1}; return true;
      }
      if (event.phase === 'commit') return history.commit();
      if (event.phase === 'cancel') return history.cancel();
      return false;
    }});
  await runtime.sync();
  const f = {THREE, runtime, canvas, document, window, captures, history, phases, statuses, draws, lane, world, setupId,
    local(id = 'camera-a') {return history.getState().scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(item => item.entityId === id);},
    step(count = 1) {for (let index = 0; index < count; index++) {const next = frames.entries().next().value; if (!next) break; frames.delete(next[0]); time += 50; next[1](time);}},
    key(code) {return window.emit('keydown', {code});}, release(code) {return window.emit('keyup', {code});},
    drag({release = true} = {}) {canvas.emit('pointerdown'); document.emit('pointermove', {target: canvas, clientX: 255, clientY: 245}); f.step(1); if (release) document.emit('pointerup', {target: canvas});},
    records() {return history.getHistory().lanes[lane]?.undoStack || [];}, setCurrent(value) {current = value;},
    replaceIdentity() {fence = {...fence, sessionToken: 'replacement'};}, setRenderFailure(value) {renderFailure = value;},
    get rendererDisposals() {return rendererDisposals;}, get frameCount() {return frames.size;}};
  f.step(2); return f;
}
function enter(f, id = 'camera-a') {assert.equal(f.runtime.startCameraControl(id), true); f.step(20); const failures = f.statuses.filter(event => event.status === 'failed'); assert.equal(failures.length, 0, JSON.stringify(failures));}

test('possession admission uses an independent editable camera and creates one temporary optical camera and transaction', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const {runtime} = f, home = pose(runtime.orbitCamera), authored = runtime.entityCamera('camera-a'), listeners = [f.canvas.count(), f.document.count(), f.window.count()];
  assert.equal(runtime.startCameraControl('missing'), false); assert.equal(runtime.possessing, null); assert.equal(f.phases.length, 0);
  runtime.setCapturing(true); assert.equal(runtime.startCameraControl('camera-a'), false); runtime.setCapturing(false);
  enter(f); assert.equal(runtime.view, 'camera-control'); assert.equal(runtime.possessing.entityId, 'camera-a'); assert.notEqual(runtime.camera, authored); assert.notEqual(runtime.camera, runtime.orbitCamera);
  assert.equal(runtime.controls.enabled, false); samePose(pose(runtime.orbitCamera), home); near(runtime.camera.position.distanceTo(authored.position), 0);
  const rotation = f.local().camera.rotation, expectedRotation = new f.THREE.Quaternion().setFromEuler(new f.THREE.Euler(rotation.x, rotation.y, rotation.z, rotation.order));
  near(runtime.camera.quaternion.angleTo(expectedRotation), 0);
  const attached = [f.canvas.count(), f.document.count(), f.window.count()]; assert(attached.some((value, index) => value > listeners[index]));
  assert.equal(runtime.startCameraControl('camera-a'), true); assert.deepEqual([f.canvas.count(), f.document.count(), f.window.count()], attached); assert.deepEqual(f.phases.map(event => event.phase), ['begin']);
  assert.equal(runtime.cancelCameraControl(), true);
});

test('actual possession native keyboard and pointer input edit the domain in three dimensions and retain the home viewport', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const home = pose(f.runtime.orbitCamera); enter(f);
  const start = f.runtime.camera.position.clone(); f.key('KeyW'); f.key('KeyE'); f.step(2); f.release('KeyW'); f.release('KeyE');
  const moved = f.runtime.camera.position.clone().sub(start); assert(moved.y > 0); assert(Math.hypot(moved.x, moved.z) > 0);
  assert.deepEqual(f.local().camera.position, {x: f.runtime.camera.position.x, y: f.runtime.camera.position.y, z: f.runtime.camera.position.z}); assert.equal(Object.hasOwn(f.local().camera, 'lookAt'), false);
  f.window.emit('blur'); const beforeTurn = f.runtime.camera.quaternion.clone(); f.drag(); assert(f.runtime.camera.quaternion.angleTo(beforeTurn) > .02);
  assert(f.phases.some(event => event.phase === 'preview' && event.kind === 'pose')); assert.equal(f.records().length, 0); samePose(pose(f.runtime.orbitCamera), home);
  const beforeWheel = f.runtime.camera.quaternion.clone(), previousFocal = f.local().camera.focalLength; f.canvas.emit('wheel', {deltaY: 100});
  assert(f.local().camera.focalLength < previousFocal); near(f.runtime.camera.quaternion.angleTo(beforeWheel), 0); assert.equal(f.phases.at(-1).kind, 'optics');
});

test('optics-only possession changes preserve authored lookAt and pose, including letterbox and actual render', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); enter(f); const before = structuredClone(f.local()), optical = pose(f.runtime.camera);
  assert.equal(f.runtime.patchCameraControl({focalLength: 85, frameAspectRatio: 9 / 16}), true);
  assert.deepEqual(f.local().camera.lookAt, before.camera.lookAt); assert.deepEqual(f.local().transform, before.transform); assert.deepEqual(f.local().camera.position, before.camera.position);
  optical.position.forEach((value, index) => near(f.runtime.camera.position.toArray()[index], value)); optical.quaternion.forEach((value, index) => near(f.runtime.camera.quaternion.toArray()[index], value));
  assert.deepEqual(f.runtime.cameraPreviewRect, {left: 231.25, top: 0, width: 337.5, height: 600}); f.runtime.render(); const draw = f.draws.at(-1);
  assert.equal(draw.camera, f.runtime.camera); assert.deepEqual(draw.viewport, [231.25, 0, 337.5, 600]); assert.equal(draw.scissorTest, true);
  assert.equal(f.runtime.hitSurface({clientX: 30, clientY: 330}), null); assert.equal(f.runtime.finishCameraControl('finish'), true); f.step(15);
  assert.deepEqual(f.local().camera.lookAt, before.camera.lookAt); assert.equal(f.records().length, 1);
});

test('finish and restore exit release native listeners and restore the original orbit or plan lease', async t => {
  for (const view of ['orbit', 'plan']) for (const cancel of [false, true]) {
    const f = await fixture(); t.after(() => f.runtime.dispose()); f.runtime.setView(view); f.step(2);
    const home = pose(f.runtime.camera), target = f.runtime.controls.target.toArray(), baseline = [f.canvas.count(), f.document.count(), f.window.count()], before = f.history.getState(); enter(f);
    f.runtime.patchCameraControl({focalLength: 85}); f.drag({release: false}); assert(f.captures.size > 0);
    assert.equal(cancel ? f.runtime.cancelCameraControl('restore') : f.runtime.finishCameraControl('finish'), true); f.step(15);
    assert.equal(f.runtime.possessing, null); assert.equal(f.runtime.view, view); assert.equal(f.runtime.camera, view === 'orbit' ? f.runtime.orbitCamera : f.runtime.planCamera);
    samePose(pose(f.runtime.camera), home); f.runtime.controls.target.toArray().forEach((value, index) => near(value, target[index])); assert.equal(f.runtime.controls.enabled, true);
    assert.deepEqual([f.canvas.count(), f.document.count(), f.window.count()], baseline); assert.equal(f.captures.size, 0); assert.equal(f.history.getActiveTransaction(), null);
    assert.equal(f.records().length, cancel ? 0 : 1); if (cancel) assert.deepEqual(f.history.getState(), before);
  }
});

test('capture checkpoint commits camera but keeps possession alive and lazy subsequent input can restore to the captured camera', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); enter(f); f.runtime.patchCameraControl({focalLength: 85});
  assert.equal(f.runtime.checkpointCameraControl(), true); const captured = structuredClone(f.local()), camera = f.runtime.camera;
  assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null); assert.equal(f.runtime.possessing.entityId, 'camera-a');
  f.runtime.setCapturing(true); const captureCanvas = await f.runtime.renderCapture(); assert.equal(captureCanvas, f.canvas); assert.equal(f.draws.at(-1).camera, camera); f.runtime.setCapturing(false);
  assert.equal(f.runtime.checkpointCameraControl(), true); assert.equal(f.records().length, 1);
  assert.equal(f.runtime.patchCameraControl({focalLength: 135}), true); assert(f.history.getActiveTransaction()); assert.equal(f.runtime.cancelCameraControl(), true);
  assert.deepEqual(f.local(), captured); assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null);
});

test('blur and hidden clear native motion while retaining the possession and open edit transaction', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); enter(f); f.key('KeyW'); f.step(2); const afterInput = pose(f.runtime.camera), phases = f.phases.length;
  f.window.emit('blur'); f.step(4); samePose(pose(f.runtime.camera), afterInput); assert.equal(f.phases.length, phases); assert(f.runtime.possessing); assert(f.history.getActiveTransaction());
  f.key('KeyW'); f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange'); assert(f.runtime.possessing); assert(f.history.getActiveTransaction());
  f.document.visibilityState = 'visible'; f.document.emit('visibilitychange'); f.step(3); samePose(pose(f.runtime.camera), afterInput); assert.equal(f.phases.some(event => event.phase === 'cancel'), false);
});

test('only the controlled camera key track blocks base possession; unrelated keyed camera and empty own track do not', async t => {
  for (const [owner, keys, accepted] of [['camera-a', [{id: 'key-0', timeMs: 0}], false], ['camera-b', [{id: 'key-0', timeMs: 0}], true], ['camera-a', [], true]]) {
    const f = await fixture({initial: (state, {world, setupId}) => world.setTemporal(state, setupId, {durationMs: 1000, tracks: [{id: 'camera-track', owner: {kind: 'entity', entityId: owner}, keys, channels: []}]}, 2)});
    t.after(() => f.runtime.dispose()); assert.equal(f.runtime.startCameraControl('camera-a'), accepted); assert.equal(!!f.runtime.possessing, accepted);
    if (!accepted) {assert.equal(f.phases.length, 0); assert.equal(f.history.getActiveTransaction(), null); assert.equal(f.runtime.camera, f.runtime.orbitCamera);}
  }
});

test('baseline scope and hidden camera cannot open a camera edit or take the viewport', async t => {
  for (const initial of [
    (state, {world}) => world.setActiveSetup(state, 'setup-default'),
    (state, {world, setupId}) => world.patchEntityState(state, setupId, 'camera-a', {visible: false}, 2)
  ]) {
    const f = await fixture({initial}); t.after(() => f.runtime.dispose()); const home = pose(f.runtime.camera), listeners = [f.canvas.count(), f.document.count(), f.window.count()];
    assert.equal(f.runtime.startCameraControl('camera-a'), false); assert.equal(f.runtime.possessing, null); assert.equal(f.phases.length, 0);
    assert.equal(f.history.getActiveTransaction(), null); samePose(pose(f.runtime.camera), home); assert.deepEqual([f.canvas.count(), f.document.count(), f.window.count()], listeners);
  }
});

test('a rejected domain preview restores accepted optical pose and stops input while retaining the failed edit for explicit restore', async t => {
  let reject = true;
  const f = await fixture({rejectPhase: event => reject && event.phase === 'preview'}); t.after(() => f.runtime.dispose());
  const listeners = [f.canvas.count(), f.document.count(), f.window.count()]; enter(f); const accepted = pose(f.runtime.camera), before = f.history.getState();
  f.key('KeyW'); f.step(2); assert(f.runtime.possessing.failed); assert(f.history.getActiveTransaction()); assert.deepEqual(f.history.getState(), before); samePose(pose(f.runtime.camera), accepted);
  assert.deepEqual([f.canvas.count(), f.document.count(), f.window.count()], listeners); assert(f.statuses.some(event => event.status === 'failed'));
  const phases = f.phases.length; f.key('KeyE'); f.step(2); assert.equal(f.phases.length, phases); assert(f.runtime.possessing);
  reject = false; assert.equal(f.runtime.cancelCameraControl('restore'), true); assert.equal(f.runtime.possessing, null); assert.equal(f.history.getActiveTransaction(), null);
});

test('dispose in a live native drag cancels only its edit and releases all runtime, Orbit and navigation listeners', async () => {
  const f = await fixture(); enter(f); const before = f.history.getState(), leased = f.runtime.camera; f.drag({release: false}); assert(f.captures.size > 0);
  await f.runtime.dispose(); assert.equal(f.runtime.disposed, true); assert.equal(f.canvas.count(), 0); assert.equal(f.document.count(), 0); assert.equal(f.window.count(), 0); assert.equal(f.captures.size, 0);
  assert.equal(f.frameCount, 0); assert.equal(f.rendererDisposals, 1); assert.equal(f.history.getActiveTransaction(), null); assert.deepEqual(f.history.getState(), before);
  const position = leased.position.toArray(); f.document.emit('pointermove', {target: f.canvas, clientX: 600, clientY: 400}); assert.deepEqual(leased.position.toArray(), position);
  await f.runtime.dispose(); assert.equal(f.rendererDisposals, 1);
});

test('runtime-update possession draw hides every camera marker by role and restores visibility even on draw failure', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const a = f.runtime.graph.entity('camera-a'), b = f.runtime.graph.entity('camera-b');
  f.runtime.render(); assert.deepEqual(f.draws.at(-1).markers, {'camera-a': true, 'camera-b': true}); enter(f);
  assert.notEqual(f.runtime.camera, a.camera); assert.notEqual(f.runtime.camera, b.camera);
  f.runtime.render(); assert.deepEqual(f.draws.at(-1).markers, {'camera-a': false, 'camera-b': false}); assert.equal(a.cameraMarker.root.visible, true); assert.equal(b.cameraMarker.root.visible, true);
  b.cameraMarker.root.visible = false; f.setRenderFailure(Error('draw unavailable'));
  assert.throws(() => f.runtime.render(), /draw unavailable/); assert.deepEqual(f.draws.at(-1).markers, {'camera-a': false, 'camera-b': false});
  assert.equal(a.cameraMarker.root.visible, true); assert.equal(b.cameraMarker.root.visible, false, 'already hidden markers remain hidden'); f.setRenderFailure(null);
  b.cameraMarker.root.visible = true; assert.equal(f.runtime.finishCameraControl(), true); f.step(15); f.runtime.render(); assert.deepEqual(f.draws.at(-1).markers, {'camera-a': true, 'camera-b': true});
});

test('runtime-update point focus settles the entry transition and authors aperture focus from a real forward surface hit', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const {runtime, THREE} = f;
  assert.equal(runtime.pickCameraFocus({clientX: 620, clientY: 330}), false); const before = structuredClone(f.local()), rotation = before.camera.rotation;
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, rotation.order)), origin = new THREE.Vector3(before.camera.position.x, before.camera.position.y, before.camera.position.z);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation), mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  mesh.position.copy(origin).addScaledVector(direction, 5); mesh.quaternion.copy(orientation); runtime.graph.content.add(mesh);
  assert.equal(runtime.startCameraControl('camera-a'), true); assert(runtime.camera.position.distanceTo(origin) > 1, 'entry still starts from the viewport camera');
  assert.equal(runtime.pickCameraFocus({clientX: 620, clientY: 330}), true); near(runtime.camera.position.distanceTo(origin), 0); near(runtime.camera.quaternion.angleTo(orientation), 0);
  const focus = f.local().camera.focus, hit = runtime.hitSurface({clientX: 620, clientY: 330}); assert.equal(hit.source, 'mesh'); assert.equal(focus.mode, 'point');
  for (const axis of ['x', 'y', 'z']) near(focus.target[axis], hit.point[axis]); assert.equal(f.local().camera.depthOfFieldMode, 'aperture'); assert.deepEqual(f.local().camera.lookAt, before.camera.lookAt); assert.deepEqual(f.local().transform, before.transform);
  const target = new THREE.Vector3(focus.target.x, focus.target.y, focus.target.z), depth = target.clone().sub(origin).dot(direction);
  assert(depth > 0); near(depth, 5); assert(target.distanceTo(origin) > depth + .05, 'off-axis focus distance is axial depth'); near(runtime.sparkDepthOfFieldParameters().focalDistance, depth);
  const accepted = structuredClone(f.local()); assert.equal(runtime.pickCameraFocus({clientX: 420, clientY: 40}), false); assert.deepEqual(f.local(), accepted);
  runtime.setCapturing(true); assert.equal(runtime.pickCameraFocus({clientX: 620, clientY: 330}), false); runtime.setCapturing(false); f.step(3); near(runtime.camera.position.distanceTo(origin), 0);
});

test('runtime-update expired ownership force-releases its lease without domain mutation and same-id entry revalidates identity', async t => {
  const expired = await fixture({enforceOwnership: true}); t.after(() => expired.runtime.dispose()); const baseline = [expired.canvas.count(), expired.document.count(), expired.window.count()]; enter(expired);
  expired.runtime.patchCameraControl({focalLength: 85}); expired.drag({release: false}); const accepted = expired.history.getState(); expired.setCurrent(false);
  assert.throws(() => expired.runtime.startCameraControl('camera-a'), {code: 'studio_v3_runtime_stale'}); assert.equal(expired.runtime.possessing, null); assert.equal(expired.runtime.camera, expired.runtime.orbitCamera);
  assert.equal(expired.runtime.controls.enabled, false); assert.equal(expired.captures.size, 0); assert.deepEqual([expired.canvas.count(), expired.document.count(), expired.window.count()], baseline);
  assert.deepEqual(expired.history.getState(), accepted, 'rejected stale cleanup cannot roll back a domain owned elsewhere'); assert(expired.history.getActiveTransaction(), 'the host still owns cleanup of its rejected old transaction');
  const phases = expired.phases.length; expired.key('KeyW'); expired.document.emit('pointermove', {target: expired.canvas, clientX: 700, clientY: 500}); assert.equal(expired.phases.length, phases);
  const reentry = await fixture(); t.after(() => reentry.runtime.dispose()); const before = reentry.history.getState(); enter(reentry); reentry.runtime.patchCameraControl({focalLength: 85}); reentry.replaceIdentity();
  assert.equal(reentry.runtime.startCameraControl('camera-a'), false); assert.equal(reentry.runtime.possessing, null); assert.equal(reentry.history.getActiveTransaction(), null); assert.deepEqual(reentry.history.getState(), before);
  assert.equal(reentry.phases.at(-1).phase, 'cancel'); assert.equal(reentry.phases.at(-1).reason, 'stale');
});
