const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/features/studio-v3/plan-projection.mjs');
const bounds = {min: {x: -2.5, y: 0, z: -6}, max: {x: 2.5, y: 3.2, z: 6}};
const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('room framing uses true bounds, aspect fit, padding and the default section near plane', async () => {
  const {createPlanProjection} = await modulePromise;
  const projection = createPlanProjection({bounds, width: 560, height: 420});
  near(projection.halfWidth, 8.8); near(projection.halfHeight, 6.6);
  assert.deepEqual(projection.target, {x: 0, y: 0, z: 0});
  assert.deepEqual(projection.cameraPosition, {x: 0, y: 50, z: 0});
  near(projection.near, 48.4); near(projection.far, 52);
  assert.equal(projection.sectionHeight, 1.6);
});

test('world and screen round trips preserve anchor height over aspect, zoom, pan and rotation', async () => {
  const {createPlanProjection, projectPlanPoint, unprojectPlanPoint} = await modulePromise;
  for (const [width, height] of [[560, 420], [320, 900], [1300, 200]]) {
    for (const zoom of [.5, 1, 3]) for (const rotation of [Math.PI / 12, Math.PI / 2, -2.7]) {
      const projection = createPlanProjection({bounds, width, height, zoom, rotation, groundY: 4, pan: {x: 2, z: -3}});
      for (const point of [{x: -2, y: 7.3, z: 5}, {x: 9, y: -3.2, z: -11}, projection.target]) {
        const screen = projectPlanPoint(projection, point);
        const roundTrip = unprojectPlanPoint(projection, screen, point);
        for (const axis of ['x', 'y', 'z']) near(roundTrip[axis], point[axis]);
        near(screen.x, screen.nx * projection.width); near(screen.y, screen.ny * projection.height);
      }
    }
  }
});

test('rotated basis remains orthonormal and camera faces ground from above', async () => {
  const {createPlanProjection} = await modulePromise;
  const projection = createPlanProjection({bounds, width: 600, height: 300, rotation: Math.PI / 2, groundY: 8});
  near(projection.right.x, 0); near(projection.right.z, 1);
  near(projection.down.x, -1); near(projection.down.z, 0);
  assert.deepEqual(projection.forward, {x: 0, y: -1, z: 0});
  for (const a of [projection.right, projection.down, projection.forward]) {
    near(Math.hypot(a.x, a.y, a.z), 1);
    for (const b of [projection.right, projection.down, projection.forward]) {
      if (a !== b) near(a.x * b.x + a.y * b.y + a.z * b.z, 0);
    }
  }
  near(projection.cameraPosition.y - projection.target.y, 50);
});

test('a high world requires increased camera distance and finite depth framing', async () => {
  const {createPlanProjection} = await modulePromise;
  const high = {min: {x: 10, y: -10, z: 20}, max: {x: 14, y: 100, z: 26}};
  const projection = createPlanProjection({bounds: high, width: 600, height: 300, groundY: 5, sectionHeight: 'all'});
  assert.deepEqual(projection.target, {x: 12, y: 5, z: 23});
  near(projection.cameraPosition.y, 110); near(projection.near, 8); near(projection.far, 122);
});

test('section changes clip real geometry by depth without hiding high markers', async () => {
  const {createPlanProjection, projectPlanPoint} = await modulePromise;
  const shiftedBounds = {min: {...bounds.min, y: 2}, max: {...bounds.max, y: 5.2}};
  const make = sectionHeight => createPlanProjection({bounds: shiftedBounds, width: 560, height: 420, groundY: 2, sectionHeight});
  const all = make('all'), cut = make(1.6), low = make(-1), high = make(1000);
  near(all.near, 44.8); near(cut.near, 48.4); near(low.near, 50); near(high.near, all.near);
  assert.equal(all.far, cut.far); assert.equal(low.sectionHeight, 0);
  const upperGeometryDepth = cut.cameraPosition.y - shiftedBounds.max.y;
  assert.ok(upperGeometryDepth < cut.near);
  assert.equal(projectPlanPoint(cut, {x: 0, y: 300, z: 0}).inView, true);
  assert.deepEqual(projectPlanPoint(all, {x: 1, y: 300, z: 2}), projectPlanPoint(cut, {x: 1, y: 300, z: 2}));
});

test('section near clamp preserves minimum visible depth for bounds below ground', async () => {
  const {createPlanProjection} = await modulePromise;
  const underground = {min: {x: 0, y: -100, z: 0}, max: {x: 1, y: -90, z: 1}};
  const projection = createPlanProjection({bounds: underground, width: 1, height: 1, sectionHeight: 0});
  near(projection.near, 138); near(projection.far, 152);
  const above = createPlanProjection({bounds: {min: {x: 0, y: 20, z: 0}, max: {x: 1, y: 21, z: 1}}, width: 1, height: 1, sectionHeight: 0});
  near(above.near, above.far - .5);
});

test('inView uses screen margin and unanchored coordinates use the target plane', async () => {
  const {createPlanProjection, projectPlanPoint, unprojectPlanPoint} = await modulePromise;
  const projection = createPlanProjection({bounds, width: 560, height: 420, groundY: 4});
  for (const [nx, expected] of [[-.079, true], [1.079, true], [-.081, false], [1.081, false]]) {
    const world = unprojectPlanPoint(projection, {nx, ny: .5});
    assert.equal(world.y, 4); assert.equal(projectPlanPoint(projection, world).inView, expected);
  }
});

test('pan delta follows the displayed rotated axes and moves content with the pointer', async () => {
  const {createPlanProjection, projectPlanPoint, planPanDelta} = await modulePromise;
  for (const rotation of [0, Math.PI / 2, -.83]) {
    const options = {bounds, width: 800, height: 600, zoom: 2, rotation, sectionHeight: 'all'};
    const before = createPlanProjection(options), delta = planPanDelta(before, {dx: 31, dy: -17});
    const after = createPlanProjection({...options, pan: delta});
    const point = {x: 1, y: 2, z: -3};
    const oldScreen = projectPlanPoint(before, point), newScreen = projectPlanPoint(after, point);
    near(newScreen.x - oldScreen.x, 31); near(newScreen.y - oldScreen.y, -17);
  }
});

test('projection owns detached plain data and rejects invalid bounds or viewport', async () => {
  const {createPlanProjection, projectPlanPoint, unprojectPlanPoint, planPanDelta} = await modulePromise;
  const inputBounds = structuredClone(bounds), pan = {x: 1, z: 2}, before = structuredClone({bounds: inputBounds, pan});
  const projection = createPlanProjection({bounds: inputBounds, pan, width: 100.4, height: .3, zoom: 99});
  assert.equal(projection.width, 100); assert.equal(projection.height, 1); assert.equal(projection.zoom, 3);
  projection.target.x = 99; assert.deepEqual({bounds: inputBounds, pan}, before);
  for (const bad of [{bounds: null}, {bounds: {...bounds, min: {x: Infinity, y: 0, z: 0}}},
    {bounds: {...bounds, min: {x: 8, y: 0, z: 0}}}, {bounds, width: 0}, {bounds, height: NaN}, {bounds, rotation: Infinity}, {bounds, zoom: 0}]) {
    assert.throws(() => createPlanProjection(bad), TypeError);
  }
  assert.equal(projectPlanPoint(null, {x: 0, y: 0, z: 0}), null);
  assert.equal(projectPlanPoint(projection, {x: NaN, y: 0, z: 0}), null);
  assert.equal(unprojectPlanPoint(projection, {nx: .5, ny: Infinity}), null);
  assert.equal(unprojectPlanPoint(projection, {nx: .5, ny: .5}, {y: NaN}), null);
  assert.deepEqual(planPanDelta(projection, {dx: NaN, dy: 2}), {x: 0, z: 0});
});

test('degenerate finite bounds retain a nonzero view; overflowing geometry is rejected', async () => {
  const {createPlanProjection} = await modulePromise;
  const projection = createPlanProjection({bounds: {min: {x: 1, y: 2, z: 3}, max: {x: 1, y: 2, z: 3}}, width: 100, height: 100});
  assert.ok(projection.halfWidth > 0); assert.ok(projection.far - projection.near >= .5);
  assert.throws(() => createPlanProjection({bounds: {min: {x: -Number.MAX_VALUE, y: 0, z: 0}, max: {x: Number.MAX_VALUE, y: 2, z: 1}}, width: 100, height: 100}), RangeError);
});

test('nonlinear section slider round trips and exact all sentinel', async () => {
  const {sectionSliderValue, sectionHeightFromSlider} = await modulePromise;
  near(sectionSliderValue(1.6), .5); near(sectionHeightFromSlider(.75), 4.8);
  for (const height of [0, .2, 1.6, 12, 100]) near(sectionHeightFromSlider(sectionSliderValue(height)), height, 1e-9);
  assert.equal(sectionHeightFromSlider(1), 'all'); assert.equal(sectionSliderValue('all'), 1);
  assert.equal(sectionHeightFromSlider(2), 'all'); assert.equal(sectionHeightFromSlider(-1), 0);
  assert.equal(sectionHeightFromSlider(Infinity), 0); assert.equal(sectionSliderValue(NaN), 0);
});
