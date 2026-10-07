const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-navigation.mjs'), import('three')]);
const near = (actual, expected, epsilon = 1e-9) => assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
class Surface {
  constructor() {this.listeners = new Map(); this.style = {}; this.clientHeight = 600; this.captures = new Set();}
  addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn);}
  removeEventListener(type, fn) {this.listeners.get(type)?.delete(fn);}
  setPointerCapture(id) {this.captures.add(id);}
  releasePointerCapture(id) {this.captures.delete(id);}
  emit(type, data = {}) {
    const event = {target: this, defaultPrevented: false, pointerId: 1, button: 0, buttons: 1, clientX: 0, clientY: 0,
      deltaX: 0, deltaY: 0, deltaMode: 0, altKey: false, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, ...data};
    event.composedPath ||= () => [event.target]; for (const fn of [...this.listeners.get(type) || []]) fn(event); return event;
  }
  count() {return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);}
}
async function fixture(options = {}) {
  const [{createCameraNavigation}] = await modules, window = new Surface(), document = new Surface(), canvas = new Surface();
  document.visibilityState = 'visible'; document.defaultView = window; canvas.ownerDocument = document;
  let pose = {position: {x: 0, y: 0, z: 10}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, focalLength: 24, fov: 53.13010235415598, frameAspectRatio: 3 / 2, near: .1, far: 100};
  let time = 0, scope = 'scope:a', permitted = true; const writes = [], errors = [], pivots = [];
  const navigation = createCameraNavigation({canvas, eventTarget: window, readCamera: () => pose,
    applyCamera: (next, context) => {writes.push({next, context}); pose = next; return true;},
    onError: error => errors.push(error), getScope: () => scope, canInput: () => permitted,
    now: () => time, onNavigationPivotChange: value => pivots.push(value), ...options});
  navigation.start();
  return {canvas, document, window, navigation, writes, errors, pivots, get pose() {return pose;}, set pose(value) {pose = value;},
    time(value) {time = value;}, scope(value) {scope = value;}, permit(value) {permitted = value;},
    key(code, data) {return window.emit('keydown', {code, ...data});}, release(code, data) {return window.emit('keyup', {code, ...data});},
    down(data) {return canvas.emit('pointerdown', data);}, move(data) {return document.emit('pointermove', {target: canvas, ...data});},
    up(data) {return document.emit('pointerup', {target: canvas, ...data});}, wheel(data) {return canvas.emit('wheel', data);}};
}
test('fly follows the full pitched quaternion; QE mixes world Y and diagonal intent remains normalized', async () => {
  const [{stepCameraMovement}] = await modules;
  const pitched = {x: Math.PI / 4, y: 0, z: 0, order: 'YXZ'};
  const first = stepCameraMovement({dt: .05, keys: {forward: true}, rotation: pitched});
  near(Math.hypot(...Object.values(first.velocity)), 1.5); assert(first.delta.y > 0); assert(first.delta.z < 0);
  const mixed = stepCameraMovement({dt: .05, keys: {forward: true, right: true, up: true}, rotation: pitched});
  near(Math.hypot(...Object.values(mixed.velocity)), 1.5);
  near(mixed.velocity.y / mixed.velocity.z, -(1 + Math.SQRT1_2) / Math.SQRT1_2);
  const release = stepCameraMovement({dt: .05, keys: {}, rotation: pitched, velocity: first.velocity});
  near(Math.hypot(...Object.values(release.velocity)), 1.5 * 1e-8 ** .05); assert(release.delta.y > 0, 'release preserves momentum');
});
test('speed preference clamps finite values, scales acceleration/deadzone, and sprint transitions toward five', async () => {
  const [{stepCameraMovement, cameraMoveSpeedMultiplier}] = await modules, rotation = {x: 0, y: 0, z: 0};
  assert.equal(cameraMoveSpeedMultiplier(NaN), 1); assert.equal(cameraMoveSpeedMultiplier(Infinity), 1);
  assert.equal(cameraMoveSpeedMultiplier(-3), .25); assert.equal(cameraMoveSpeedMultiplier(300), 100);
  const fast = stepCameraMovement({dt: .05, keys: {forward: true, sprint: true}, rotation, moveSpeedMultiplier: 2});
  near(fast.speedMultiplier, 1.4); near(fast.velocity.z, -3);
  const stopped = stepCameraMovement({dt: .05, rotation, velocity: {x: .02, y: 0, z: 0}, moveSpeedMultiplier: 2});
  assert.deepEqual(stopped.velocity, {x: 0, y: 0, z: 0});
});
test('left drag crosses four pixels, middle drag is immediate, and native captures cleanly release', async () => {
  const f = await fixture();
  assert.equal(f.down().defaultPrevented, false); assert(f.canvas.captures.has(1));
  f.move({clientX: 3}); assert.equal(f.navigation.tick(.05), false); near(f.pose.rotation.y, 0);
  f.move({clientX: 4}); assert.equal(f.navigation.tick(.05), true); near(f.pose.rotation.y, -.008);
  f.up(); assert.equal(f.canvas.captures.size, 0);
  f.navigation.cancelInput();
  assert.equal(f.down({button: 1, buttons: 4}).defaultPrevented, true);
  f.move({button: 1, buttons: 4, clientY: 1}); f.navigation.tick(.05); near(f.pose.rotation.x, -.002);
  f.up({button: 1}); f.navigation.dispose();
});
test('drag inertia uses recent last motion and stops for stale release or lost buttons', async () => {
  const f = await fixture(); f.down(); f.move({clientX: 10}); f.navigation.tick(.05); f.time(80); f.up();
  f.navigation.tick(.05); near(f.pose.rotation.y, -.04); f.navigation.tick(.05); near(f.pose.rotation.y, -.0584);
  f.navigation.cancelInput(); f.down(); f.move({clientX: 20}); f.navigation.tick(.05); f.time(161); f.up();
  assert.equal(f.navigation.needsFrame(), false); const before = structuredClone(f.pose); f.navigation.tick(.05); assert.deepEqual(f.pose, before);
  f.down(); f.move({clientX: 10, buttons: 0}); assert.equal(f.canvas.captures.size, 0); assert.equal(f.navigation.needsFrame(), false); f.navigation.dispose();
});
test('arrow rotation approaches target and decays after unconditional key release', async () => {
  const f = await fixture(); f.key('ArrowLeft'); f.navigation.tick(.05); near(f.pose.rotation.y, .03);
  f.navigation.tick(.05); near(f.pose.rotation.y, .09);
  f.release('ArrowLeft', {isComposing: true, defaultPrevented: true, target: {tagName: 'INPUT'}});
  f.navigation.tick(.05); near(f.pose.rotation.y, .09 + 1.2 * 1e-8 ** .05 * .05);
  f.navigation.dispose();
});
test('wheel intent stays locked for 180 ms, then reclassifies; focal writes use optics and preserve pose', async () => {
  const f = await fixture(), before = structuredClone(f.pose.position);
  f.wheel({deltaY: 100}); near(f.pose.focalLength, 24 * Math.exp(-.1)); assert.equal(f.writes.at(-1).context.kind, 'optics');
  f.time(180); f.wheel({deltaX: .5, deltaY: 1}); near(f.pose.focalLength, 24 * Math.exp(-.101)); near(f.pose.rotation.x, 0);
  f.time(361); f.wheel({deltaX: .5, deltaY: 1}); near(f.pose.rotation.y, -.0015); near(f.pose.rotation.x, -.003);
  assert.equal(f.writes.at(-1).context.kind, 'pose'); assert.deepEqual(f.pose.position, before);
  f.time(600); f.wheel({deltaMode: 1, deltaY: 2}); near(f.pose.focalLength, 24 * Math.exp(-.133));
  f.navigation.dispose();
});
test('disabled wheel zoom forces look, inversion reverses it, and look clamps pitch', async () => {
  const f = await fixture({getWheelZoomEnabled: () => false, getWheelLookInverted: () => true});
  f.wheel({deltaY: 100}); near(f.pose.rotation.x, .3); near(f.pose.focalLength, 24);
  f.wheel({deltaY: 1000}); near(f.pose.rotation.x, Math.PI * .45); f.navigation.dispose();
});
test('Alt orbit preserves pivot distance; Alt middle pan moves camera and pivot together', async () => {
  const f = await fixture({resolveNavigationPivot: () => ({position: {x: 0, y: 0, z: 0}, source: 'mesh-hit'})});
  assert.equal(f.down({altKey: true}).defaultPrevented, true); f.move({altKey: true, clientX: 10}); f.navigation.tick(.05);
  near(Math.hypot(...Object.values(f.pose.position)), 10); near(f.pose.position.x, 10 * Math.sin(-.02)); near(f.pose.rotation.y, -.02);
  f.up({altKey: true}); f.navigation.cancelInput(); f.pose = {...f.pose, position: {x: 0, y: 0, z: 10}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}};
  f.down({altKey: true, button: 1, buttons: 4}); f.move({altKey: true, button: 1, buttons: 4, clientX: 10, clientY: 5}); f.navigation.tick(.05);
  near(f.pose.position.x, -1 / 6); near(f.pose.position.y, 1 / 12);
  near(f.navigation.pivot.position.x, f.pose.position.x); near(f.navigation.pivot.position.y, f.pose.position.y);
  f.release('AltLeft'); assert.equal(f.navigation.pivot, null); assert.equal(f.canvas.captures.size, 0); f.navigation.dispose();
});
test('pivot wheel changes distance with near/far bounds; unresolved Alt start cannot invent a pivot', async () => {
  const f = await fixture({resolveNavigationPivot: () => ({position: {x: 0, y: 0, z: 0}})});
  f.down({altKey: true}); f.up({altKey: true}); f.wheel({altKey: true, deltaY: 100}); near(f.pose.position.z, 10 * Math.exp(.1)); near(f.pose.focalLength, 24);
  f.wheel({altKey: true, deltaY: -10000}); near(f.pose.position.z, .2); f.wheel({altKey: true, deltaY: 10000}); near(f.pose.position.z, 95);
  f.wheel({altKey: false, deltaY: 100}); assert.equal(f.navigation.pivot, null); assert(f.pose.focalLength < 24); f.navigation.dispose();
  const missing = await fixture(); assert.equal(missing.down({altKey: true}).defaultPrevented, false); assert.equal(missing.navigation.pivot, null); assert.equal(missing.canvas.captures.size, 0); missing.navigation.dispose();
});
test('IME/editable/blocked scope ignore keys; blur and hidden clear input; scope change detaches', async () => {
  const f = await fixture();
  for (const data of [{isComposing: true}, {keyCode: 229}, {target: {tagName: 'INPUT'}}, {target: {closest: () => ({})}}, {defaultPrevented: true}]) {
    assert.equal(f.key('KeyW', data).stopped, undefined); assert.equal(f.navigation.needsFrame(), false);
  }
  f.key('KeyW'); f.navigation.tick(.05); f.window.emit('blur'); assert.equal(f.navigation.needsFrame(), false); assert.equal(f.navigation.active, true);
  f.key('KeyW'); f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange'); assert.equal(f.navigation.needsFrame(), false);
  f.document.visibilityState = 'visible'; f.key('KeyE'); f.scope('scope:b'); f.navigation.tick(.05);
  assert.equal(f.navigation.active, false); assert.equal(f.canvas.count() + f.window.count() + f.document.count(), 0);
  assert.equal(f.navigation.start(), true); f.permit(false); f.key('KeyW'); assert.equal(f.navigation.needsFrame(), false); f.navigation.dispose();
});
test('rejected or throwing writes stop listeners without local success and stop can restart', async () => {
  for (const applyCamera of [() => false, () => {throw Error('domain unavailable');}]) {
    const f = await fixture({applyCamera}); const before = structuredClone(f.pose); f.key('KeyW');
    assert.equal(f.navigation.tick(.05), false); assert.equal(f.navigation.active, false); assert.deepEqual(f.pose, before);
    assert.equal(f.canvas.count() + f.window.count() + f.document.count(), 0); assert.equal(f.errors.length, 1);
    assert.equal(f.navigation.needsFrame(), false); assert.equal(f.navigation.start(), true); f.navigation.stop();
    assert.equal(f.canvas.count() + f.window.count() + f.document.count(), 0); f.navigation.dispose(); assert.equal(f.navigation.start(), false);
  }
});
