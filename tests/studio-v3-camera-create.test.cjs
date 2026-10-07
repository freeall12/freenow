const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const modules = Promise.all([
  import('../src/features/studio-v3/camera-create.mjs'),
  import('../src/features/studio-v3/camera-optics.mjs'),
  import('../src/features/studio-v3/transform-coordinates.mjs'),
  import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/entity-actions.mjs')
]);

function visibleCamera(optics) {
  return {position: {x: 3, y: 2, z: -4}, rotation: {x: .2, y: .7, z: -.1, order: 'YXZ'},
    focalLength: 50, frameAspectRatio: 2.39, fov: optics.focalLengthToFov(50, 2.39),
    apertureFNumber: 2.8, depthOfFieldMode: 'aperture', focusDistance: 7, focus: {mode: 'distance', distance: 7},
    lookAt: {mode: 'point', target: {x: 0, y: 1, z: 0}}};
}

function assertOptics(actual, visible) {
  for (const field of ['focalLength', 'frameAspectRatio', 'fov', 'apertureFNumber', 'depthOfFieldMode', 'focusDistance', 'focus']) {
    assert.deepEqual(actual[field], visible[field], field);
  }
  assert.equal(Object.hasOwn(actual, 'lookAt'), false, 'new cameras must not inherit a tracking target');
}

test('surface creation uses surface elevation plus 1.6m and reflects plan yaw into the optical camera', async () => {
  const [creation, optics, coordinates, schema] = await modules;
  const visible = visibleCamera(optics), point = {x: -5, y: -2.5, z: 11}, before = structuredClone({visible, point});
  const pose = creation.cameraAtSurface({point, yaw: .4, visibleCamera: visible});
  assert.equal(pose.transform.position.x, -5); assert.equal(pose.transform.position.z, 11);
  assert(Math.abs(pose.transform.position.y - -.9) < 1e-12, 'negative surface elevation retains the 1.6m offset');
  assert.deepEqual(pose.transform.rotation, {x: 0, y: .4, z: 0, order: 'XYZ'});
  assert.deepEqual(pose.transform.scale, {x: 1, y: 1, z: 1});
  assert.deepEqual(pose.camera.position, pose.transform.position);
  assert(coordinates.sameRotation(pose.camera.rotation, {x: 0, y: -.4, z: 0, order: 'XYZ'}));
  assertOptics(pose.camera, visible);
  schema.assertCamera(pose.camera);
  assert.deepEqual({visible, point}, before, 'creation cannot mutate either input');
  pose.camera.position.x = 100; pose.camera.focus.distance = 20;
  assert.deepEqual({visible, point}, before, 'returned camera data must be detached');
  assert.equal(pose.transform.position.x, -5, 'camera and plan positions must also be detached');
});

test('current-view creation retains visible pose and optics and yields the corresponding plan rotation', async () => {
  const [creation, optics, coordinates] = await modules;
  const visible = visibleCamera(optics), before = structuredClone(visible);
  const pose = creation.cameraFromCurrentView(visible);
  assert.deepEqual(pose.camera.position, visible.position);
  assert(coordinates.sameRotation(pose.camera.rotation, visible.rotation));
  assert(coordinates.sameRotation(coordinates.planRotationToCamera(pose.transform.rotation), visible.rotation));
  assert.deepEqual(pose.transform.scale, {x: 1, y: 1, z: 1});
  assertOptics(pose.camera, visible);
  assert.deepEqual(visible, before);
  pose.transform.position.y = 500; pose.camera.rotation.x = 1; pose.camera.focus.distance = 4;
  assert.deepEqual(visible, before);
  assert.equal(pose.camera.position.y, 2, 'plan edits cannot mutate optical position');
});

test('both creation poses pass the real entity reducer and retain the plan-to-camera pose contract', async () => {
  const [creation, optics, coordinates, schema, actions] = await modules;
  const visible = visibleCamera(optics);
  for (const [id, pose] of [['view', creation.cameraFromCurrentView(visible)], ['surface', creation.cameraAtSurface({point: {x: 8, y: 4, z: -9}, yaw: -.8, visibleCamera: visible})]]) {
    const initial = schema.createState({worldNodeId: 'camera-owner', now: 1}), before = structuredClone(initial);
    const result = actions.reduceEntityAction(initial, {type: 'create', kind: 'camera', id, ...pose}, {now: 2});
    assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(result.lane, 'world');
    schema.assertState(result.state);
    const space = result.state.scenePlay.worldSpace, setup = space.setups.find(item => item.id === space.activeSetupId);
    const stored = setup.entityStates.find(item => item.entityId === id);
    assert.deepEqual(stored.camera, pose.camera);
    assert.deepEqual(stored.transform.position, pose.transform.position);
    assert(coordinates.sameRotation(stored.transform.rotation, pose.transform.rotation));
    assert(coordinates.sameRotation(coordinates.applyEntityTransform('camera', stored).rotation, pose.camera.rotation));
    assert.deepEqual(initial, before, 'creation reducer must preserve the initial state');
  }
});

test('invalid creation inputs throw before IDs, history actions or mode exits occur in the actual entry closure', async () => {
  const [creation, optics] = await modules;
  const visible = visibleCamera(optics), before = structuredClone(visible);
  for (const input of [
    {point: {x: NaN, y: 0, z: 0}, visibleCamera: visible},
    {point: {x: 0, y: 0, z: 0}, yaw: NaN, visibleCamera: visible},
    {point: {x: 0, y: 0, z: 0}, visibleCamera: {...visible, fov: 180}}
  ]) assert.throws(() => creation.cameraAtSurface(input));
  assert.throws(() => creation.cameraFromCurrentView({...visible, position: {x: 0, y: Infinity, z: 0}}));
  assert.deepEqual(visible, before);

  const source = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');
  const start = source.indexOf('  const createCamera ='), end = source.indexOf('\n  const beginCameraCreation =', start);
  assert(start >= 0 && end > start);
  for (const scenario of ['disallowed', 'invalid-view', 'invalid-surface']) {
    const calls = [], context = vm.createContext({
      cameraCreationAllowed: () => scenario !== 'disallowed',
      cameraAtSurface: input => creation.cameraAtSurface(structuredClone(input)), cameraFromCurrentView: creation.cameraFromCurrentView,
      runtime: {getVisibleCameraState: () => {calls.push('visible-read'); return scenario === 'invalid-view' ? {...visible, fov: 180} : visible;}},
      crypto: {randomUUID: () => {calls.push('id'); return 'camera';}},
      entityAction: () => {calls.push('history-action'); return {ok: true, entityId: 'camera'};},
      cancelCameraCreation: () => calls.push('mode-exit'), select: () => calls.push('select')
    });
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.create = createCamera;`, context);
    await assert.rejects(context.create(scenario === 'invalid-surface' ? {x: 0, y: Infinity, z: 0} : undefined));
    assert.deepEqual(calls, scenario === 'disallowed' ? [] : ['visible-read'], `${scenario} must abort before mutation`);
  }
  assert.deepEqual(visible, before);
});
