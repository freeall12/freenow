const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-shot-sampling.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs')]);
const vec = (x, y = 0, z = 0) => ({x, y, z});
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≈ ${b}`);
const channel = (property, kind, values, interpolation = 'linear') => ({id: property, property,
  values: values.map(([keyId, value]) => ({keyId, interpolation, value: {kind, value}}))});
const keys = [{id: 'start', timeMs: 0}, {id: 'end', timeMs: 1000}];
async function fixture(channels = [], extra = {}, {owner = 'cam', trackKeys = keys} = {}) {
  const [sampling, schema, world] = await modules; let state = schema.createState({worldNodeId: 'world', now: 1});
  const setupId = 'setup:state-1', camera = {position: vec(2, 3, 4), rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, fov: 60, frameAspectRatio: 16 / 9};
  for (const [id, kind, setup] of [['cam', 'camera', setupId], ['prop', 'prop', setupId], ['shared', 'camera', 'setup-default']]) {
    state = world.addEntity(state, schema.createEntity({id, kind, label: id, now: 1}), {setupId: setup,
      setupState: {...schema.createSetupState(id, 1), ...(kind === 'camera' ? {camera: structuredClone(camera)} : {})}});
  }
  if (channels.length) state = world.setTemporal(state, setupId, {durationMs: 1000,
    tracks: [{id: 'track', owner: {kind: 'entity', entityId: owner}, keys: trackKeys, channels, ...extra}]}, 2);
  const shot = {id: 'shot', stageId: 'stage-default', setupId, cameraEntityId: 'cam'};
  return {sampling, schema, world, state, shot, sample(time, descriptor = shot) {return sampling.sampleCameraShotState(state, descriptor, time);}};
}
test('snapshots retain baseline precedence, sample inactive target and detach every mutable result', async () => {
  const f = await fixture(); const other = f.schema.createIndependentSetup({id: 'other', label: 'Other', now: 1});
  let state = f.world.addSetup(f.state, other);
  const local = state.scenePlay.worldSpace.setups.find(setup => setup.id === f.shot.setupId).entityStates.find(item => item.entityId === 'cam');
  state = f.world.addEntityState(state, 'other', local); const before = structuredClone(state);
  const result = f.sampling.sampleCameraShotState(state, {...f.shot, setupId: 'other'}, 500);
  assert.equal(result.state.scenePlay.worldSpace.activeSetupId, 'other');
  assert.deepEqual(f.world.renderSetup(result.state, 'other').entityStates.map(item => item.entityId), ['shared', 'cam']);
  f.schema.assertState(result.state); result.state.scenePlay.worldSpace.setups[0].label = 'Mutated'; result.camera.position.x = 999;
  assert.deepEqual(state, before); assert.equal(f.world.renderSetup(result.state, 'other').entityStates.find(item => item.entityId === 'cam').camera.position.x, 2);
});
test('before first used key retains base; time rounds, clamps at zero and last key', async () => {
  const f = await fixture([channel('entity.transform.position', 'vec3', [['start', vec(10)], ['end', vec(20)]])], {},
    {trackKeys: [{id: 'start', timeMs: 200}, {id: 'end', timeMs: 1000}]});
  assert.deepEqual(f.sample(-50).camera.position, vec(2, 3, 4));
  assert.deepEqual(f.sample(199.4).camera.position, vec(2, 3, 4));
  assert.deepEqual(f.sample(199.6).camera.position, vec(10));
  assert.deepEqual(f.sample(600).camera.position, vec(15)); assert.deepEqual(f.sample(1200).camera.position, vec(20));
});
test('hold position advances exactly at the next key', async () => {
  const f = await fixture([channel('entity.transform.position', 'vec3', [['start', vec(0)], ['end', vec(10)]], 'hold')]);
  assert.deepEqual(f.sample(999).camera.position, vec(0)); assert.deepEqual(f.sample(1000).camera.position, vec(10));
});
test('endpoint controls produce a curve with equal-distance time rather than parameter-time Bezier', async () => {
  const f = await fixture([channel('entity.transform.position', 'vec3', [['start', vec(0)], ['end', vec(10)]])],
    {pathEndpointControls: {start: {point: vec(0, 10)}, end: {point: vec(10, 10)}}});
  const midpoint = f.sample(500).camera.position; near(midpoint.x, 5); near(midpoint.y, 7.5);
  const quarter = f.sample(250).camera.position;
  // Uniform Bezier parameter at .25 gives (1.5625,5.625); distance timing
  // reaches less far up this longer first portion of the arc.
  assert.ok(quarter.x < 1.5625 && quarter.y < 5.625); assert.ok(quarter.y > 4);
  assert.deepEqual(f.sample(0).camera.position, vec(0)); assert.deepEqual(f.sample(1000).camera.position, vec(10));
});
test('interior keys generate smooth neighboring tangents rather than two straight lines', async () => {
  const f = await fixture([channel('entity.transform.position', 'vec3', [['start', vec(0)], ['middle', vec(5, 5)], ['end', vec(10)]])], {},
    {trackKeys: [{id: 'start', timeMs: 0}, {id: 'middle', timeMs: 500}, {id: 'end', timeMs: 1000}]});
  assert.deepEqual(f.sample(500).camera.position, vec(5, 5));
  const a = f.sample(250).camera.position, b = f.sample(750).camera.position;
  assert.ok(a.y > a.x); near(a.x + b.x, 10); near(a.y, b.y);
});
test('spatial bend applies smooth correction and keeps both endpoints', async () => {
  const f = await fixture([channel('entity.transform.position', 'vec3', [['start', vec(0)], ['end', vec(10)]])],
    {segments: [{fromKeyId: 'start', toKeyId: 'end', transition: {spatialBend: {point: vec(5, 4), t: .5}}}]});
  const mid = f.sample(500).camera.position; near(mid.x, 5); near(mid.y, 4);
  assert.deepEqual(f.sample(0).camera.position, vec(0)); assert.deepEqual(f.sample(1000).camera.position, vec(10));
});
test('camera rotation uses shortest quaternion path across yaw wrap and overrides plan rotation channel', async () => {
  const radians = degrees => degrees * Math.PI / 180, euler = degrees => ({x: 0, y: radians(degrees), z: 0, order: 'YXZ'});
  const f = await fixture([channel('entity.transform.rotation', 'euler3', [['start', euler(0)], ['end', euler(0)]]),
    channel('camera.rotation', 'euler3', [['start', euler(170)], ['end', euler(-170)]])]);
  const result = f.sample(500); near(Math.abs(result.camera.rotation.y), Math.PI);
  const local = f.world.renderSetup(result.state).entityStates.find(item => item.entityId === 'cam'); near(Math.abs(local.transform.rotation.y), Math.PI);
});
test('plan rotation synchronizes camera orientation through official heading reflection', async () => {
  const f = await fixture([channel('entity.transform.rotation', 'euler3', [['start', {x: 0, y: 0, z: 0, order: 'XYZ'}],
    ['end', {x: 0, y: Math.PI / 2, z: 0, order: 'XYZ'}]])]);
  near(f.sample(500).camera.rotation.y, -Math.PI / 4);
});
test('focal/fov keys merge with focal precedence and logarithmic focal interpolation', async () => {
  const f = await fixture([channel('camera.fov', 'number', [['start', 80], ['end', 30]]),
    channel('camera.focalLength', 'number', [['start', 20]])]);
  const endFocal = (36 / (16 / 9)) / (2 * Math.tan(30 * Math.PI / 360));
  near(f.sample(0).camera.focalLength, 20); near(f.sample(500).camera.focalLength, Math.sqrt(20 * endFocal));
  near(f.sample(1000).camera.fov, 30); assert.notEqual(f.sample(500).camera.fov, 55);
});
test('fov converts at each key aspect, then ratio applies before interpolated focal projection', async () => {
  const f = await fixture([channel('camera.frameAspectRatio', 'number', [['start', 1], ['end', 2]]),
    channel('camera.fov', 'number', [['start', 60], ['end', 60]])]);
  const startFocal = 24 / (2 * Math.tan(Math.PI / 6)), endFocal = 18 / (2 * Math.tan(Math.PI / 6));
  const mid = f.sample(500).camera; near(mid.frameAspectRatio, 1.5); near(mid.focalLength, Math.sqrt(startFocal * endFocal));
  near(mid.fov, 2 * Math.atan(24 / (2 * mid.focalLength)) * 180 / Math.PI);
});
test('all known optical fields keep official discrete and linear semantics', async () => {
  const f = await fixture([channel('camera.focusDistance', 'number', [['start', 2], ['end', 8]]),
    channel('camera.apertureFNumber', 'number', [['start', 2], ['end', 4]]),
    channel('camera.focus', 'camera-focus', [['start', {mode: 'point', target: vec(1, 2, 3)}], ['end', {mode: 'distance', distance: 8}]]),
    channel('camera.lookAt', 'camera-look-at', [['start', {mode: 'point', target: vec(1)}], ['end', {mode: 'none'}]]),
    channel('camera.depthOfFieldMode', 'camera-depth-of-field-mode', [['start', 'aperture'], ['end', 'deepFocus']])]);
  const mid = f.sample(500).camera; near(mid.focusDistance, 5); near(mid.apertureFNumber, 3);
  assert.deepEqual(mid.focus, {mode: 'point', target: vec(1, 2, 3)}); assert.deepEqual(mid.lookAt, {mode: 'point', target: vec(1)});
  assert.equal(mid.depthOfFieldMode, 'aperture'); assert.equal(f.sample(1000).camera.depthOfFieldMode, 'deepFocus');
});
test('prop channels affect detached rendered world: scale, visibility, pose, target and held entity deletion', async () => {
  const f = await fixture([channel('entity.transform.scale', 'vec3', [['start', vec(1, 1, 1)], ['end', vec(3, 3, 3)]]),
    channel('entity.visibility', 'boolean', [['start', true], ['end', false]]), channel('entity.pose', 'pose', [['start', 'Standing'], ['end', 'Walking']]),
    channel('entity.lookTarget', 'look-target', [['start', {kind: 'entity', entityId: 'cam'}], ['end', {kind: 'none'}]]),
    channel('entity.heldEntityId', 'text', [['start', 'cam'], ['end', null]])], {}, {owner: 'prop'});
  const get = t => f.world.renderSetup(f.sample(t).state).entityStates.find(item => item.entityId === 'prop');
  assert.deepEqual(get(500).transform.scale, vec(2, 2, 2)); assert.equal(get(500).visible, true); assert.equal(get(500).pose, 'Standing');
  assert.deepEqual(get(500).lookTarget, {kind: 'entity', entityId: 'cam'}); assert.equal(get(500).heldEntityId, 'cam');
  assert.equal(get(1000).visible, false); assert.equal(get(1000).pose, 'Walking'); assert.equal(Object.hasOwn(get(1000), 'heldEntityId'), false);
});
test('unsupported/malformed channels, missing linkage and invalid sampled optics reject without touching state', async () => {
  const f = await fixture(); const before = structuredClone(f.state);
  for (const time of [NaN, Infinity]) assert.throws(() => f.sample(time), /finite/);
  assert.throws(() => f.sample(0, {...f.shot, cameraEntityId: null}), /real linked camera/);
  assert.throws(() => f.sample(0, {...f.shot, stageId: 'another'}), /stage mismatch/);
  const invalid = structuredClone(f.state), setup = invalid.scenePlay.worldSpace.setups.find(item => item.id === f.shot.setupId);
  setup.temporal = {durationMs: 1000, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'cam'}, keys,
    channels: [channel('camera.unsupported', 'number', [['start', 1]])]}]};
  assert.throws(() => f.sampling.sampleCameraShotState(invalid, f.shot, 0), /unknown temporal property/);
  const negative = await fixture([channel('camera.apertureFNumber', 'number', [['start', -2]])]);
  assert.throws(() => negative.sample(0), /finite number in range/); assert.deepEqual(f.state, before);
});
