const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/features/studio-v3/plan-navigation.mjs');
const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const settle = navigation => {
  let frames = 0;
  while (navigation.active && frames++ < 1000) navigation.tick(1 / 60);
  assert.ok(frames < 1000); assert.equal(navigation.active, false);
};

test('local navigation starts at the official defaults with detached current and target snapshots', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation(), expected = {pan: {x: 0, z: 0}, zoom: 1, rotation: 0, sectionHeight: 1.6};
  assert.deepEqual(navigation.read(), expected); assert.equal(navigation.active, false);
  const current = navigation.current, target = navigation.target, read = navigation.read();
  current.pan.x = 90; target.zoom = 99; read.sectionHeight = 'all';
  assert.deepEqual(navigation.read(), expected); assert.deepEqual(navigation.target, expected);
  assert.equal(navigation.tick(1 / 60), false);
});

test('zoom controls modify target and damp current with official speed 12', async () => {
  const {createPlanNavigation, PLAN_NAVIGATION} = await modulePromise;
  const navigation = createPlanNavigation();
  assert.equal(navigation.zoomBy(PLAN_NAVIGATION.zoomStep), true);
  assert.equal(navigation.read().zoom, 1); near(navigation.target.zoom, 1.12);
  assert.equal(navigation.active, true); assert.equal(navigation.tick(.02), true);
  near(navigation.read().zoom, 1 + .12 * (1 - Math.exp(-12 * .02)));
  settle(navigation); near(navigation.read().zoom, 1.12); assert.equal(navigation.tick(.02), false);
});

test('zoom clamps .5..3 and rejects nonpositive or nonfinite factors without corrupting state', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation();
  navigation.zoomBy(Number.MAX_VALUE); assert.equal(navigation.target.zoom, 3); settle(navigation);
  assert.equal(navigation.zoomBy(2), false); navigation.zoomBy(Number.MIN_VALUE); assert.equal(navigation.target.zoom, .5);
  settle(navigation); const before = navigation.read();
  for (const value of [0, -1, NaN, Infinity, '2']) assert.equal(navigation.zoomBy(value), false);
  assert.deepEqual(navigation.read(), before); assert.deepEqual(navigation.target, before);
});

test('pan defaults to synchronous current like native drag and supports damped requests at speed 10', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation(), delta = {x: 3, z: -4};
  assert.equal(navigation.panBy(delta), true); delta.x = 90;
  assert.deepEqual(navigation.read().pan, {x: 3, z: -4}); assert.equal(navigation.active, false);
  navigation.panBy({x: 10, z: 2}, {syncCurrent: false});
  assert.deepEqual(navigation.read().pan, {x: 3, z: -4}); assert.deepEqual(navigation.target.pan, {x: 13, z: -2});
  navigation.tick(.02); near(navigation.read().pan.x, 3 + 10 * (1 - Math.exp(-.2)));
  near(navigation.read().pan.z, -4 + 2 * (1 - Math.exp(-.2))); settle(navigation);
  assert.deepEqual(navigation.read().pan, {x: 13, z: -2});
});

test('pan snap tests both axes together and sync changes report true even with unchanged target', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation();
  navigation.panBy({x: .0001, z: 3}, {syncCurrent: false}); navigation.tick(.02);
  assert.ok(navigation.current.pan.x > 0 && navigation.current.pan.x < .0001);
  const current = navigation.current.pan, target = navigation.target.pan;
  assert.equal(navigation.panBy({x: target.x - current.x, z: target.z - current.z}), true);
  assert.deepEqual(navigation.current.pan, target); assert.equal(navigation.active, false);
});

test('rotation follows shortest wrapped arc with speed 14 and settles across the pi boundary', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation(); navigation.rotateBy(Math.PI - .05); settle(navigation);
  navigation.rotateBy(.2); const before = navigation.read().rotation;
  assert.ok(navigation.target.rotation < 0); navigation.tick(.02);
  const travelled = Math.atan2(Math.sin(navigation.read().rotation - before), Math.cos(navigation.read().rotation - before));
  near(travelled, .2 * (1 - Math.exp(-14 * .02))); settle(navigation);
  near(navigation.read().rotation, -Math.PI + .15);
  const previous = navigation.read(); for (const value of [NaN, Infinity, '1']) assert.equal(navigation.rotateBy(value), false);
  assert.deepEqual(navigation.read(), previous);
});

test('large dt is capped at .08 and zero, negative or nonfinite dt leaves current untouched', async () => {
  const {createPlanNavigation} = await modulePromise;
  const a = createPlanNavigation(), b = createPlanNavigation();
  for (const navigation of [a, b]) {navigation.zoomBy(2); navigation.rotateBy(1); navigation.panBy({x: 4, z: -3}, {syncCurrent: false});}
  a.tick(2); b.tick(.08); assert.deepEqual(a.read(), b.read());
  const before = a.read(); for (const dt of [0, -1, NaN, Infinity, '1']) assert.equal(a.tick(dt), false);
  assert.deepEqual(a.read(), before);
});

test('section is immediate, accepts all, clamps negatives and preserves current for invalid input', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation(); assert.equal(navigation.setSection('all'), true);
  assert.equal(navigation.current.sectionHeight, 'all'); assert.equal(navigation.target.sectionHeight, 'all');
  assert.equal(navigation.active, false); assert.equal(navigation.setSection('all'), false);
  navigation.setSection(-5); assert.equal(navigation.read().sectionHeight, 0);
  for (const height of [NaN, Infinity, '2', null]) assert.equal(navigation.setSection(height), false);
  assert.equal(navigation.read().sectionHeight, 0);
});

test('reset synchronously clears current, pending targets and section while other viewports remain independent', async () => {
  const {createPlanNavigation} = await modulePromise;
  const a = createPlanNavigation(), b = createPlanNavigation();
  a.panBy({x: 4, z: 5}); a.zoomBy(2); a.rotateBy(1); a.setSection('all'); a.tick(.04);
  assert.equal(a.reset(), true); assert.equal(a.active, false); assert.equal(a.reset(), false);
  assert.deepEqual(a.read(), b.read()); assert.deepEqual(a.target, b.target);
});

test('invalid pan requests and overflowing addition retain finite state; extreme interpolation stays finite', async () => {
  const {createPlanNavigation} = await modulePromise;
  const navigation = createPlanNavigation();
  for (const delta of [null, {x: NaN, z: 0}, {x: 1, z: Infinity}]) assert.equal(navigation.panBy(delta), false);
  navigation.panBy({x: Number.MAX_VALUE, z: 0});
  assert.equal(navigation.panBy({x: Number.MAX_VALUE, z: 0}), false);
  navigation.panBy({x: -Number.MAX_VALUE, z: 0}, {syncCurrent: false}); navigation.tick(.08);
  for (const snapshot of [navigation.current, navigation.target]) {
    assert.ok(Number.isFinite(snapshot.pan.x)); assert.ok(Number.isFinite(snapshot.pan.z));
    assert.ok(Number.isFinite(snapshot.zoom)); assert.ok(Number.isFinite(snapshot.rotation));
  }
});
