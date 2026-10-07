const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/runtime.mjs'), import('../src/features/studio-v3/control-session.mjs'), import('../src/features/studio-v3/history.mjs')]);
class Target extends EventTarget {
  constructor() {super(); this.listeners = new Map();}
  addEventListener(type, listener, options) {super.addEventListener(type, listener, options); const set = this.listeners.get(type) || new Set(); set.add(listener); this.listeners.set(type, set);}
  removeEventListener(type, listener, options) {super.removeEventListener(type, listener, options); this.listeners.get(type)?.delete(listener);}
  get listenerCount() {return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);}
}
function input(target, type, fields = {}) {const event = new Event(type, {cancelable: true}); for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, {value, configurable: true}); target.dispatchEvent(event); return event;}
const keys = fields => ({forward: false, backward: false, left: false, right: false, up: false, down: false, sprint: false, ...fields});
async function fixture({kind = 'actor', onControl, current = () => true, realAsset = false} = {}) {
  const [THREE, schema, world, {createStudioV3Runtime}, , {createHistory}] = await modules;
  let initial = schema.createState({worldNodeId: 'control-owner', now: 1});
  for (const [id, type, setupId, extra] of [[kind, kind, 'setup:state-1', {}], ['locked', 'prop', 'setup:state-1', {locked: true}], ['shared', 'prop', 'setup-default', {}], ['camera', 'camera', 'setup:state-1', {}]]) {
    const entity = schema.createEntity({id, kind: type, label: id, now: 1, ...type === 'prop' ? {asset: {sourceUrl: '/local-prop.glb', sourceFormat: 'glb'}} : {}, ...extra});
    initial = world.addEntity(initial, entity, {setupId});
    if (id !== kind) initial = world.patchEntityState(initial, setupId, id, {transform: {...schema.createSetupState(id, 1).transform, position: {x: 20, y: 0, z: 20}}}, 1);
  }
  const history = createHistory(initial), document = new Target(), window = new Target(), canvas = new Target(); document.defaultView = window; document.visibilityState = 'visible';
  Object.assign(canvas, {ownerDocument: document, clientWidth: 400, clientHeight: 300, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300}), setPointerCapture() {}, releasePointerCapture() {}});
  class Controls extends THREE.EventDispatcher {constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3();} update() {return false;} dispose() {}}
  class Transform extends THREE.EventDispatcher {constructor(camera) {super(); this.camera = camera; this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(root) {this.object = root;} detach() {this.object = null;} setMode(mode) {this.mode = mode;} dispose() {}}
  const queued = new Map(), phases = [], failures = []; let serial = 0, time = 1, editEpoch = 0, sessionToken = 'one', sourceResource = null;
  const runtime = createStudioV3Runtime({canvas, getState: history.getState, getSourceResource: () => sourceResource, getFence: () => ({sessionToken, revision: 1, editEpoch}), isCurrent: current,
    onControl(event) {
      phases.push(event); const result = onControl?.(event); if (result === false) return false;
      if (event.phase === 'begin') return history.begin('setup:setup:state-1', 'control');
      if (event.phase === 'preview') {editEpoch++; return history.preview(state => world.patchEntityState(state, 'setup:state-1', event.entityId, {transform: event.transform}, 2));}
      if (event.phase === 'cancel') return history.cancel();
      if (event.phase === 'commit') {history.commit(); return true;}
    }, onStatus: value => {if (value.status === 'failed') failures.push(value);},
    requestFrame: callback => {queued.set(++serial, callback); return serial;}, cancelFrame: id => queued.delete(id),
    rendererFactory: () => ({setPixelRatio() {}, setSize() {}, render() {}, dispose() {}, forceContextLoss() {}}), controlsFactory: camera => new Controls(camera), transformFactory: camera => new Transform(camera),
    loader: {async load(descriptor) {if (realAsset && descriptor.sourceUrl.includes('character')) {const {decodeGlb} = await import('../src/features/studio-v3/asset-loader.mjs'); return decodeGlb(new Blob([fs.readFileSync(require.resolve('../assets/studio/character.glb'))]));} const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.7, .4), new THREE.MeshBasicMaterial()); root.add(mesh); return {root, format: 'glb', animations: [new THREE.AnimationClip('Standing', 1, [])], dispose() {mesh.geometry.dispose(); mesh.material.dispose();}};}}});
  await runtime.sync();
  function frames(count = 1) {for (let index = 0; index < count && queued.size; index++) {const [id, callback] = queued.entries().next().value; queued.delete(id); callback(time += 50);}}
  const drain = () => frames(40); drain();
  return {runtime, history, phases, failures, document, window, canvas, queued, frames, drain, schema, world, THREE,
    state: () => history.getState(), change(reducer) {history.transact('world', 'test', reducer);}, staleFence() {sessionToken = 'two';}, switchSource() {sourceResource = {url: '/another-scene.glb', format: 'glb'};},
    close: () => runtime.dispose()};
}

test('official movement accelerates to six, normalizes diagonals, smoothly sprints and stops immediately', async () => {
  const [, , , , {stepControlMovement}] = await modules; let velocity = {x: 0, z: 0}, multiplier = 1;
  const first = stepControlMovement({dt: .05, keys: keys({forward: true}), yaw: 0, velocity, speedMultiplier: multiplier}); assert.equal(first.velocity.z, -2.4000000000000004);
  for (let index = 0; index < 10; index++) {const step = stepControlMovement({dt: .05, keys: keys({forward: true, right: true}), yaw: 0, velocity, speedMultiplier: multiplier}); velocity = step.velocity; multiplier = step.speedMultiplier;}
  assert(Math.abs(Math.hypot(velocity.x, velocity.z) - 6) < 1e-8);
  const sprint = stepControlMovement({dt: .05, keys: keys({forward: true, sprint: true}), yaw: 0, velocity, speedMultiplier: multiplier}); assert.equal(sprint.speedMultiplier, 1.4); assert(Math.abs(Math.hypot(sprint.velocity.x, sprint.velocity.z) - 8.4) < 1e-8);
  const released = stepControlMovement({dt: .05, keys: keys({}), yaw: 0, velocity: sprint.velocity, speedMultiplier: sprint.speedMultiplier}); assert.deepEqual(released.velocity, {x: 0, z: 0});
});

test('native keyboard moves a real actor, yields one history step, preserves preview sync and idle has no RAF', async () => {
  const t = await fixture(); try {
    const beforeCamera = t.runtime.orbitCamera.position.clone(); assert.equal(t.runtime.startControl('actor'), true); assert.equal(t.runtime.view, 'control'); assert.equal(t.runtime.controls.enabled, false); assert.equal(t.runtime.transformControls.object, null);
    t.drain(); assert.equal(t.queued.size, 0, 'control entry alone does not maintain a frame loop');
    assert.equal(input(t.window, 'keydown', {code: 'KeyW'}).defaultPrevented, true); t.frames(8);
    assert(t.runtime.entityObject('actor').position.z < -1); assert.equal(t.runtime.controlling.inputActive, true); assert.equal((t.history.getHistory().lanes['setup:setup:state-1']?.undoStack.length || 0), 0, 'live previews have not committed');
    await t.runtime.sync(); assert.equal(t.runtime.controlling.entityId, 'actor', 'caller preview revision sync retains its lease');
    input(t.window, 'keyup', {code: 'KeyW'}); t.drain(); const end = t.runtime.entityObject('actor').position.clone(); assert.equal(t.queued.size, 0); t.frames(10); assert.deepEqual(t.runtime.entityObject('actor').position.toArray(), end.toArray());
    input(t.window, 'keydown', {code: 'Escape', key: 'Escape'}); assert.equal(t.runtime.controlling, null); assert.equal(t.phases.at(-1).phase, 'commit'); assert.equal((t.history.getHistory().lanes['setup:setup:state-1']?.undoStack.length || 0), 1); t.drain(); assert.equal(t.queued.size, 0); assert(t.runtime.orbitCamera.position.distanceTo(beforeCamera) < 1e-8); assert.equal(t.window.listenerCount, 0);
    assert.deepEqual(t.failures, []);
  } finally {await t.close();}
});

test('actor movement turns using domain/world heading while prop movement preserves authored rotation', async () => {
  for (const kind of ['actor', 'prop']) {const t = await fixture({kind}); try {
    assert(t.runtime.startControl(kind)); const before = t.runtime.entityObject(kind).quaternion.clone(); input(t.window, 'keydown', {code: 'KeyD'}); t.frames(5); input(t.window, 'keyup', {code: 'KeyD'}); t.drain();
    if (kind === 'actor') {assert(Math.abs(t.runtime.controlling.headingDeg - 90) < 1e-6); assert(Math.abs(t.phases.filter(event => event.phase === 'preview').at(-1).transform.rotation.y - Math.PI / 2) < 1e-6); assert(Math.abs(t.runtime.entityObject(kind).rotation.y + Math.PI / 2) < 1e-6);}
    else assert(Math.abs(t.runtime.entityObject(kind).quaternion.dot(before)) > .99999);
  } finally {await t.close();}}
});

test('native pointer drag and wheel own the follow camera without authoring entity transforms', async () => {
  const t = await fixture(); try {t.runtime.startControl('actor'); t.drain(); const before = t.runtime.orbitCamera.position.clone();
    assert(input(t.canvas, 'pointerdown', {button: 0, pointerId: 3, clientX: 0, clientY: 0}).defaultPrevented);
    input(t.window, 'pointermove', {pointerId: 3, clientX: 200, clientY: -100}); input(t.window, 'pointerup', {pointerId: 3}); assert(t.runtime.orbitCamera.position.distanceTo(before) > .5);
    const orbit = t.runtime.orbitCamera.position.clone(); input(t.canvas, 'wheel', {deltaX: 0, deltaY: 100, deltaMode: 0}); assert(t.runtime.orbitCamera.position.distanceTo(orbit) > .1); t.drain(); assert.equal(t.phases.length, 1); assert.equal(t.queued.size, 0); assert.equal(t.runtime.controlling.dirty, false);
  } finally {await t.close();}
});

test('held Q/E uses continuous authored height, manual release hovers, HUD nudge and G have finite transitions', async () => {
  const t = await fixture(); try {t.runtime.startControl('actor'); input(t.window, 'keydown', {code: 'KeyE'}); t.frames(5); input(t.window, 'keyup', {code: 'KeyE'}); t.drain();
    const y = t.runtime.entityObject('actor').position.y; assert(y > 1); assert.equal(t.queued.size, 0); t.frames(20); assert.equal(t.runtime.entityObject('actor').position.y, y);
    assert.equal(t.runtime.nudgeControlHeight('up'), true); t.drain(); assert(Math.abs(t.runtime.entityObject('actor').position.y - y - 1) < 1e-6); assert.equal(t.queued.size, 0);
    input(t.window, 'keydown', {code: 'KeyG'}); t.drain(); assert(Math.abs(t.runtime.entityObject('actor').position.y) < 1e-6); assert.equal(t.queued.size, 0); assert.equal(t.phases.at(-1).phase, 'preview');
  } finally {await t.close();}
});

test('readonly baseline and actor/prop locks reject entry; camera is a separate control branch', async () => {
  const t = await fixture(); try {for (const id of ['locked', 'shared', 'camera', 'missing']) assert.equal(t.runtime.startControl(id), false); assert.deepEqual(t.phases, []);
    t.change(state => t.world.patchEntityState(state, 'setup:state-1', 'actor', {visible: false}, 3)); await t.runtime.sync(); assert.equal(t.runtime.startControl('actor'), false);
  } finally {await t.close();}
});

test('window blur, hidden, menu cancel, ownership fence and dispose roll back once and remove input listeners', async () => {
  for (const reason of ['blur', 'hidden', 'menu', 'fence', 'dispose']) {const t = await fixture(); try {t.runtime.startControl('actor'); input(t.window, 'keydown', {code: 'KeyW'}); t.frames(5); assert(t.runtime.entityObject('actor').position.z < 0);
    if (reason === 'blur') input(t.window, 'blur');
    else if (reason === 'hidden') {t.document.visibilityState = 'hidden'; input(t.document, 'visibilitychange');}
    else if (reason === 'menu') t.runtime.cancelControl('menu');
    else if (reason === 'fence') {t.staleFence(); await t.runtime.sync();}
    else await t.close();
    assert.equal(t.runtime.controlling, null); assert.equal(t.phases.filter(event => event.phase === 'cancel').length, 1); assert.equal(t.phases.filter(event => event.phase === 'commit').length, 0); assert.equal(t.window.listenerCount, 0); assert.equal(t.canvas.listenerCount, 0); assert.equal(t.history.getActiveTransaction(), null);
    assert.equal(t.state().scenePlay.worldSpace.setups.find(value => value.id === 'setup:state-1').entityStates.find(value => value.entityId === 'actor').transform.position.z, 0);
    input(t.window, 'keydown', {code: 'KeyW'}); t.drain(); assert.equal(t.phases.filter(event => event.phase === 'preview').length, 5);
  } finally {await t.close();}}
});

test('HUD editable focus pauses movement while external editable focus cancels, failed commit retains a stopped lease', async () => {
  let refuse = true; const t = await fixture({onControl: event => event.phase === 'commit' && refuse ? false : undefined}); try {
    t.runtime.startControl('actor'); input(t.window, 'keydown', {code: 'KeyW'}); t.frames(4);
    const hudInput = {tagName: 'INPUT', closest: selector => selector === '.sv3-control-hud' ? {} : null}; input(t.document, 'focusin', {target: hudInput}); t.drain(); assert.equal(t.runtime.controlling.inputActive, false); assert.equal(t.runtime.controlling.entityId, 'actor');
    assert.equal(t.runtime.setControlHeading(180), true); assert(Math.abs(t.runtime.controlling.headingDeg - 180) < 1e-6); assert.equal(t.runtime.finishControl(), false); assert.equal(t.runtime.controlling.inputActive, false); assert.equal(t.history.getActiveTransaction() !== null, true);
    refuse = false; assert(t.runtime.finishControl()); t.drain(); assert.equal((t.history.getHistory().lanes['setup:setup:state-1']?.undoStack.length || 0), 1);
    t.runtime.startControl('actor'); input(t.document, 'focusin', {target: {tagName: 'INPUT', closest: () => null}}); assert.equal(t.runtime.controlling, null); assert.equal(t.phases.at(-1).reason, 'input-takeover');
  } finally {await t.close();}
});

test('control support lands on meshes and respects model bottom; wall collision truncates XZ and camera occlusion prevents penetration', async () => {
  const t = await fixture(); try {
    const table = new t.THREE.Mesh(new t.THREE.BoxGeometry(4, .5, 4), new t.THREE.MeshBasicMaterial()); table.position.y = 1; t.runtime.graph.worldRoot.add(table);
    t.change(state => {const transform = state.scenePlay.worldSpace.setups.find(value => value.id === 'setup:state-1').entityStates.find(value => value.entityId === 'actor').transform; return t.world.patchEntityState(state, 'setup:state-1', 'actor', {transform: {...transform, position: {...transform.position, y: 3}}}, 4);}); await t.runtime.sync();
    assert(t.runtime.startControl('actor')); assert(t.runtime.dropControlToGround()); t.drain(); assert(Math.abs(t.runtime.entityObject('actor').position.y - 1.25) < 1e-6); t.runtime.finishControl(); t.drain();
    table.removeFromParent(); table.geometry.dispose(); table.material.dispose();
    const wall = new t.THREE.Mesh(new t.THREE.BoxGeometry(.2, 4, 5), new t.THREE.MeshBasicMaterial()); wall.position.set(1, 2, 0); t.runtime.graph.worldRoot.add(wall);
    assert(t.runtime.startControl('actor')); input(t.window, 'keydown', {code: 'KeyD'}); t.frames(30); input(t.window, 'keyup', {code: 'KeyD'}); t.drain();
    assert(t.runtime.entityObject('actor').position.x > .5 && t.runtime.entityObject('actor').position.x < .75, 'wall subtracts body radius and 2.5cm padding'); t.runtime.cancelControl('test'); t.drain();
    wall.removeFromParent(); wall.geometry.dispose(); wall.material.dispose();
    const cameraWall = new t.THREE.Mesh(new t.THREE.BoxGeometry(4, 4, .2), new t.THREE.MeshBasicMaterial()); cameraWall.position.set(0, 2, 1); t.runtime.graph.worldRoot.add(cameraWall);
    assert(t.runtime.startControl('actor')); assert(t.runtime.camera.position.z < 1, 'follow camera ray shortens distance before wall');
  } finally {await t.close();}
});

test('wheel classification follows official mouse/trackpad contract and session callbacks cannot reenter cancel', async () => {
  const [, , , , {normalizeControlWheel, createControlSession}] = await modules;
  assert.deepEqual(normalizeControlWheel({deltaX: 0, deltaY: 100}), {x: 0, y: 100, intent: 'zoom'});
  assert.equal(normalizeControlWheel({deltaX: 0, deltaY: 8}).intent, 'rotate'); assert.equal(normalizeControlWheel({deltaX: 1.2, deltaY: 30.2}).intent, 'rotate');
  assert.deepEqual(normalizeControlWheel({deltaY: 1, deltaMode: 2}, 500), {x: 0, y: 400, intent: 'zoom'});
  const canvas = new Target(), window = new Target(), transform = {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ'}, scale: {x: 1, y: 1, z: 1}}, phases = [];
  let controller; controller = createControlSession({canvas, eventTarget: window, getSubject: id => ({kind: 'actor', entityId: id, transform}), getCameraPosition: () => ({x: 0, y: 3, z: 4}), setFollowCamera() {},
    onControl(event) {phases.push(event.phase); if (event.phase === 'cancel') controller.cancel('nested');}});
  assert(controller.start('actor')); assert(controller.cancel('outer')); assert.deepEqual(phases, ['begin', 'cancel']); assert.equal(window.listenerCount, 0);
});

test('failed begin installs no control lease and rejected preview cannot leave movement running', async () => {
  let phaseToReject = 'begin'; const t = await fixture({onControl: event => event.phase === phaseToReject ? false : undefined}); try {
    assert.equal(t.runtime.startControl('actor'), false); assert.equal(t.runtime.controlling, null); assert.equal(t.window.listenerCount, 0); assert.equal(t.history.getActiveTransaction(), null);
    phaseToReject = 'preview'; assert(t.runtime.startControl('actor')); input(t.window, 'keydown', {code: 'KeyW'}); t.frames(4); t.drain(); assert.equal(t.runtime.entityObject('actor').position.z, 0); assert.equal(t.runtime.controlling.inputActive, false); assert.equal(t.queued.size, 0);
  } finally {await t.close();}
});

test('real official actor GLB temporarily walks/runs, preserves genuine Idle animation and restores authored Standing without persisting pose', async () => {
  const t = await fixture({realAsset: true}); try {
    const record = t.runtime.graph.entity('actor'), authoredPose = record.state.pose; assert.equal(record.pose, 'Standing'); assert.equal(record.action.paused, true);
    assert(t.runtime.startControl('actor')); t.drain(); assert.equal(t.runtime.controlling.inputActive, false); assert.equal(t.runtime.graph.needsAnimation(), true, 'genuine dynamic Idle remains drawable');
    input(t.window, 'keydown', {code: 'KeyW'}); t.frames(4); assert.equal(record.pose, 'Walking'); assert.equal(record.action.paused, false); assert(record.action.time > .01);
    input(t.window, 'keydown', {code: 'ShiftLeft'}); t.frames(4); assert.equal(record.pose, 'Running'); assert.equal(record.action.paused, false);
    input(t.window, 'keyup', {code: 'KeyW'}); input(t.window, 'keyup', {code: 'ShiftLeft'}); t.drain(); assert.equal(t.runtime.controlling.inputActive, false); assert.equal(t.runtime.graph.needsAnimation(), true); assert.equal(record.action.paused, false);
    const setupState = t.state().scenePlay.worldSpace.setups.find(value => value.id === 'setup:state-1').entityStates.find(value => value.entityId === 'actor'); assert.equal(setupState.pose, authoredPose, 'temporary clip choice never enters saved pose');
    assert(t.runtime.finishControl()); t.drain(); assert.equal(record.pose, 'Standing'); assert.equal(record.controlMotion, null); assert.equal(record.action.paused, true); assert.deepEqual(t.failures, []);
  } finally {await t.close();}
});

test('control cancellation during selection, gizmo attachment or source change cannot strand navigation disabled', async () => {
  for (const next of ['selection', 'gizmo', 'source']) {const t = await fixture(); try {
    assert(t.runtime.startControl('actor')); input(t.window, 'keydown', {code: 'KeyW'}); t.frames(3);
    if (next === 'selection') t.runtime.selectEntity('locked');
    else if (next === 'gizmo') assert(t.runtime.attachTransform('actor'));
    else {t.switchSource(); await t.runtime.sync();}
    assert.equal(t.runtime.controlling, null); t.drain(); assert.equal(t.runtime.controls.enabled, true, `${next} releases both authored control and navigation transition ownership`);
    assert.equal(t.history.getActiveTransaction(), null);
  } finally {await t.close();}}
});

test('prevented key release still clears held movement, reduced motion applies height immediately and observer errors cannot retain listeners', async () => {
  const [, , , , {createControlSession}] = await modules, canvas = new Target(), document = new Target(), window = new Target(), phases = [];
  canvas.ownerDocument = document; document.defaultView = window; document.visibilityState = 'visible'; window.matchMedia = () => ({matches: true});
  const transform = {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ'}, scale: {x: 1, y: 1, z: 1}};
  const controller = createControlSession({canvas, eventTarget: window, getSubject: () => ({kind: 'actor', transform}), getCameraPosition: () => ({x: 0, y: 3, z: 4}), setFollowCamera() {},
    onControl: event => {phases.push(event);}, onMotion: () => {throw Error('animation observer rejected');}, onError: () => {throw Error('status observer rejected');}});
  assert(controller.start('actor')); input(window, 'keydown', {code: 'KeyW'}); controller.tick(.05); assert.equal(controller.needsFrame, true);
  const release = new Event('keyup', {cancelable: true}); Object.defineProperty(release, 'code', {value: 'KeyW'}); release.preventDefault(); window.dispatchEvent(release);
  assert.equal(controller.needsFrame, false); assert(controller.nudgeHeight('up')); assert.equal(controller.needsFrame, false); assert.equal(phases.at(-1).transform.position.y, 1);
  assert.doesNotThrow(() => controller.cancel('test')); assert.equal(controller.active, null); assert.equal(window.listenerCount, 0); assert.equal(canvas.listenerCount, 0);
});

test('capture-phase descendant blur preserves control during button-to-canvas focus while actual window blur cancels', async () => {
  const t = await fixture(); try {
    assert(t.runtime.startControl('actor'));
    const toolbarButton = {tagName: 'BUTTON', closest: () => null}, canvas = t.canvas;
    input(t.window, 'blur', {target: toolbarButton});
    input(t.document, 'focusin', {target: canvas});
    assert.equal(t.runtime.controlling.entityId, 'actor', 'toolbar button blur captured at window must retain mode');
    assert.equal(t.phases.filter(event => event.phase === 'cancel').length, 0);
    input(t.window, 'keydown', {code: 'KeyW'}); t.frames(3); assert.equal(t.runtime.controlling.inputActive, true);
    const hudInput = {tagName: 'INPUT', closest: selector => selector === '.sv3-control-hud' ? {} : null};
    input(t.window, 'blur', {target: canvas}); input(t.document, 'focusin', {target: hudInput});
    assert.equal(t.runtime.controlling.entityId, 'actor'); assert.equal(t.runtime.controlling.inputActive, false, 'HUD focus clears held keys without ending control');
    input(t.window, 'blur', {target: hudInput}); input(t.document, 'focusin', {target: canvas}); assert.equal(t.runtime.controlling.entityId, 'actor');
    input(t.window, 'blur'); assert.equal(t.runtime.controlling, null); assert.equal(t.phases.filter(event => event.phase === 'cancel').length, 1); assert.equal(t.phases.at(-1).reason, 'window-blur'); assert.equal(t.window.listenerCount, 0);
  } finally {await t.close();}
});
