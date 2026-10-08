const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-optics.mjs'), import('three'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/history.mjs')]);
const near = (actual, expected, epsilon = 1e-10) => assert(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
const domain = fn => assert.throws(fn, error => error.name === 'StudioDomainError');
function reflectedQuaternion(THREE, rotation) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, rotation.order || 'XYZ')), forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2 * Math.atan2(forward.x, -forward.z)).multiply(quaternion);
}
function quaternionNear(actual, expected) {assert(Math.abs(actual.dot(expected)) > 1 - 1e-10, 'rotations describe different orientations');}
test('full-frame crop optics have independent known dimensions and invert across landscape, square and portrait', async () => {
  const [optics] = await modules;
  const sizes = [[3 / 2, 36, 24], [16 / 9, 36, 20.25], [1, 24, 24], [2 / 3, 24, 36], [9 / 16, 20.25, 36], [4 / 5, 24, 30], [2.39, 36, 36 / 2.39]];
  for (const [ratio, width, height] of sizes) {
    assert.deepEqual(optics.sensorDimensions(ratio), {width, height});
    for (const focal of optics.FOCAL_LENGTH_PRESETS) near(optics.fovToFocalLength(optics.focalLengthToFov(focal, ratio), ratio), focal);
  }
  near(optics.focalLengthToFov(24, 3 / 2), 53.13010235415598);
  near(optics.focalLengthToFov(50, 16 / 9), 22.895192527371208);
  assert.equal(optics.automaticFrameAspectRatio(2), 3 / 2);assert.equal(optics.automaticFrameAspectRatio(.5), 2 / 3);
  assert.equal(optics.FRAME_ASPECT_RATIO_OPTIONS.length, 19);
});
test('real Three focal getters, FOV and projection matrices agree with cropped film across every lens preset', async () => {
  const [optics, THREE] = await modules;
  for (const ratio of [3 / 2, 16 / 9, 1, 9 / 16, 4 / 5, 2.39]) for (const focalLength of optics.FOCAL_LENGTH_PRESETS) {
    const camera = new THREE.PerspectiveCamera(50, ratio, .1, 1000);
    optics.applyCameraOptics(camera, {focalLength, fov: 50, frameAspectRatio: ratio});
    near(camera.getFocalLength(), focalLength);near(camera.fov, optics.focalLengthToFov(focalLength, ratio));
    const sensor = optics.sensorDimensions(ratio), matrix = camera.projectionMatrix.elements;
    near(matrix[0], 2 * focalLength / sensor.width);near(matrix[5], 2 * focalLength / sensor.height);
    near(camera.userData.studioV3Optics.fov, camera.fov);
  }
});
test('lens patches preserve one source, ratio keeps focal and FOV-only edits replace old focal', async () => {
  const [optics] = await modules, initial = optics.normalizeCameraOptics({focalLength: 35, fov: 50, position: {x: 1, y: 2, z: 3}}), before = structuredClone(initial);
  const focal = optics.cameraOpticsPatch(initial, {focalLength: 85});near(focal.fov, optics.focalLengthToFov(85, 16 / 9));
  const ratio = optics.cameraOpticsPatch(focal, {frameAspectRatio: 9 / 16});assert.equal(ratio.focalLength, 85);near(ratio.fov, optics.focalLengthToFov(85, 9 / 16));
  const fov = optics.cameraOpticsPatch(ratio, {fov: 50});near(fov.focalLength, optics.fovToFocalLength(50, 9 / 16));near(fov.fov, 50);
  const dual = optics.cameraOpticsPatch(initial, {focalLength: 50, fov: 65});assert.equal(dual.focalLength, 50);near(dual.fov, optics.focalLengthToFov(50, 16 / 9));
  assert.deepEqual(initial, before);assert.notEqual(focal.position, initial.position);
  assert.equal(optics.cameraOpticsPatch(initial, {frameAspectRatio: null}).frameAspectRatio, null);
  const legacy = optics.normalizeCameraOptics({fov: 50});near(legacy.fov, 50);
});
test('lens boundaries clamp valid out-of-range input and reject malformed or nonfinite values', async () => {
  const [optics] = await modules;
  assert.equal(optics.cameraOpticsPatch({}, {focalLength: 1}).focalLength, 8);assert.equal(optics.cameraOpticsPatch({}, {focalLength: 800}).focalLength, 400);
  assert.equal(optics.cameraOpticsPatch({}, {apertureFNumber: 1}).apertureFNumber, 1.4);assert.equal(optics.cameraOpticsPatch({}, {apertureFNumber: 50}).apertureFNumber, 22);
  assert.equal(optics.cameraOpticsPatch({}, {focusDistance: .001}).focusDistance, .1);
  for (const field of ['focalLength', 'apertureFNumber', 'focusDistance', 'frameAspectRatio', 'fov']) for (const value of [NaN, Infinity, 0, -1, '35']) domain(() => optics.cameraOpticsPatch({}, {[field]: value}));
  domain(() => optics.cameraOpticsPatch({}, {fov: 180}));domain(() => optics.cameraOpticsPatch({}, {apertureFNumber: null}));domain(() => optics.cameraOpticsPatch({}, {depthOfFieldMode: null}));
  assert.equal(optics.stepFocalLength(35, 'increase'), 50);assert.equal(optics.stepFocalLength(35, 'decrease'), 24);assert.equal(optics.stepFocalLength(400, 'increase'), 400);
});
test('deep focus, finite/infinite distance and point/object axial focus map to Spark without GPU execution', async () => {
  const [optics, THREE] = await modules;
  assert.deepEqual(optics.sparkDepthOfField({}), {focalDistance: 0, apertureAngle: 0});
  const lens = optics.cameraOpticsPatch({}, {focalLength: 50, apertureFNumber: 2, depthOfFieldMode: 'aperture', focus: {mode: 'distance', distance: 8}});
  const finite = optics.sparkDepthOfField(lens);assert.equal(finite.focalDistance, 8);near(finite.apertureAngle, 2 * Math.atan(1 / 4) * .03);
  const infinite = optics.cameraOpticsPatch(lens, {focusDistance: null});assert.deepEqual(infinite.focus, {mode: 'none'});assert.deepEqual(optics.sparkDepthOfField(infinite), {focalDistance: 0, apertureAngle: 0});
  const camera = new THREE.PerspectiveCamera();camera.position.set(2, 1, 3);
  const point = optics.cameraOpticsPatch(lens, {focus: {mode: 'point', target: {x: 5, y: 1, z: -4}}});assert.equal(point.focusDistance, null);
  assert.equal(optics.sparkDepthOfField(point, {camera}).focalDistance, 7, 'focus is axial depth, not Euclidean distance');
  const object = optics.cameraOpticsPatch(lens, {focus: {mode: 'object', entityId: 'target', offset: {x: 1, y: 0, z: 0}}});
  assert.equal(optics.sparkDepthOfField(object, {camera, resolveEntityPosition: (id, offset) => {assert.equal(id, 'target');assert.equal(offset.x, 1);return {x: 8, y: 1, z: -7};}}).focalDistance, 10);
  assert.deepEqual(optics.sparkDepthOfField({...point, depthOfFieldMode: 'deepFocus'}, {camera}), {focalDistance: 0, apertureAngle: 0});
});
test('entity lens edits synchronize persisted projection and plan-to-optical pose and remain undoable in the owning setup', async () => {
  const [optics, THREE, actions, schema, history] = await modules;
  const initial = schema.createState({worldNodeId: 'optics-owner', now: 1});
  let state = actions.reduceEntityAction(initial, {type: 'create', kind: 'camera', id: 'camera'}, {now: 2}).state;
  const camera = () => actions.resolveEntityControl(state, {entityId: 'camera'}).setupState;
  assert.equal(camera().camera.focalLength, 24);assert.equal(camera().camera.apertureFNumber, 11);assert.equal(camera().camera.depthOfFieldMode, 'deepFocus');
  const edit = actions.reduceEntityAction(state, {type: 'update', entityId: 'camera', patch: {camera: {focalLength: 135, frameAspectRatio: 4 / 5}, transform: {rotation: {x: .2, y: 1}}}}, {now: 3});
  const journal = history.createHistory(state, {now: () => 4, createId: () => 'optics-transaction'});journal.transact(edit.lane, 'lens and pose', () => edit.state, edit.scope);state = journal.getState();
  const optical = camera().camera.rotation;quaternionNear(new THREE.Quaternion().setFromEuler(new THREE.Euler(optical.x, optical.y, optical.z, optical.order || 'XYZ')), reflectedQuaternion(THREE, camera().transform.rotation));assert.notDeepEqual(optical, camera().transform.rotation);assert.equal(camera().camera.focalLength, 135);near(camera().camera.fov, optics.focalLengthToFov(135, 4 / 5));
  assert.equal(journal.undo(edit.lane).ok, true);state = journal.getState();assert.equal(camera().camera.focalLength, 24);assert.equal(camera().transform.rotation.y, 0);
  assert.equal(journal.redo(edit.lane).ok, true);state = journal.getState();assert.equal(camera().camera.focalLength, 135);
});
test('default prop material clears only instance color, preserves asset and is undoable in world history', async () => {
  const [, , actions, schema, history] = await modules;
  const initial = schema.createState({worldNodeId: 'optics-owner', now: 1});
  const state = actions.reduceEntityAction(initial, {type: 'create', kind: 'prop', id: 'chair', assetId: 'chair-office', color: '#aa7766'}, {now: 2}).state;
  const edit = actions.reduceEntityAction(state, {type: 'update', entityId: 'chair', patch: {color: null}}, {now: 3});
  assert.equal(edit.lane, 'world');assert.equal(Object.hasOwn(actions.resolveEntityControl(edit.state, {entityId: 'chair'}).definition, 'color'), false);schema.assertState(edit.state);
  assert.deepEqual(edit.state.scenePlay.worldSpace.setups, state.scenePlay.worldSpace.setups);assert.equal(actions.resolveEntityControl(state, {entityId: 'chair'}).definition.color, '#aa7766');
  const journal = history.createHistory(state, {now: () => 4, createId: () => 'material-transaction'});journal.transact(edit.lane, 'default material', () => edit.state, edit.scope);
  assert.equal(journal.undo('world').ok, true);assert.equal(actions.resolveEntityControl(journal.getState(), {entityId: 'chair'}).definition.color, '#aa7766');
  assert.equal(journal.redo('world').ok, true);assert.equal(Object.hasOwn(actions.resolveEntityControl(journal.getState(), {entityId: 'chair'}).definition, 'color'), false);
});
test('look-at target movement synchronizes camera model with derived optical rotation without rewriting authored pose', async () => {
  const [, THREE, actions, schema] = await modules, {createRenderGraph} = await import('../src/features/studio-v3/render-graph.mjs');
  let state = schema.createState({worldNodeId: 'look-owner', now: 1});
  state = actions.reduceEntityAction(state, {type: 'create', kind: 'prop', id: 'target', assetId: 'chair-office', transform: {position: {x: 2, y: 1, z: -5}}}, {now: 2}).state;
  state = actions.reduceEntityAction(state, {type: 'create', kind: 'camera', id: 'camera', transform: {position: {x: 1, y: 2, z: 3}, rotation: {x: .35, y: .7, z: -.2, order: 'ZXY'}}, camera: {lookAt: {mode: 'entity', entityId: 'target'}}}, {now: 2}).state;
  const authored = structuredClone(actions.resolveEntityControl(state, {entityId: 'camera'}).setupState);
  const graph = createRenderGraph({scene: new THREE.Scene(), loader: {async load() {const root = new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));return {root, format: 'glb', animations: [], dispose() {}};}}});
  try {
    await graph.sync(state);const record = graph.entity('camera'), before = record.camera.quaternion.clone();
    // Matrix decomposition can differ at machine precision; compare orientation.
    quaternionNear(record.root.quaternion, before);
    state = actions.reduceEntityAction(state, {type: 'update', entityId: 'target', patch: {transform: {position: {x: -3, y: 4, z: -7}}}}, {now: 3}).state;
    await graph.sync(state);assert(before.angleTo(record.camera.quaternion) > .1);quaternionNear(record.root.quaternion, record.camera.quaternion);
    assert.deepEqual(actions.resolveEntityControl(state, {entityId: 'camera'}).setupState, authored);
    const expected = new THREE.Vector3(-3, 4, -7).sub(record.camera.position).normalize(), direction = record.camera.getWorldDirection(new THREE.Vector3());near(direction.distanceTo(expected), 0);
    state = actions.reduceEntityAction(state, {type: 'update', entityId: 'camera', patch: {camera: {lookAt: {mode: 'none'}}}}, {now: 4}).state;await graph.sync(state);
    quaternionNear(record.camera.quaternion, reflectedQuaternion(THREE, authored.transform.rotation));quaternionNear(record.root.quaternion, record.camera.quaternion);
    assert.deepEqual(actions.resolveEntityControl(state, {entityId: 'camera'}).setupState.transform, authored.transform, 'removing derived lookAt restores the authored optical orientation without rewriting plan pose');
  } finally {graph.dispose();}
});
test('rendered camera uses authoritative optical snapshot once and converts tilted plan rotation only when camera state is absent', async () => {
  const [, THREE, actions, schema] = await modules, {createRenderGraph} = await import('../src/features/studio-v3/render-graph.mjs'), world = await import('../src/features/studio-v3/world-space.mjs');
  const plan = {x: .42, y: .71, z: -.26, order: 'YXZ'}, optical = {x: -.21, y: -.57, z: .32, order: 'ZYX'};
  let state = actions.reduceEntityAction(schema.createState({worldNodeId: 'camera-pose-owner', now: 1}), {type: 'create', kind: 'camera', id: 'camera', transform: {position: {x: 1, y: 2, z: 3}, rotation: plan}}, {now: 2}).state;
  const authored = actions.resolveEntityControl(state, {entityId: 'camera'}).setupState;
  state = world.patchEntityState(state, 'setup:state-1', 'camera', {camera: {...authored.camera, position: {x: 7, y: 4, z: -2}, rotation: optical}}, 3);const snapshot = structuredClone(state);let loads = 0;
  const graph = createRenderGraph({scene: new THREE.Scene(), loader: {async load() {loads++;const root = new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));return {root, format: 'glb', animations: [], dispose() {}};}}});
  try {
    await graph.sync(state);const record = graph.entity('camera'), expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(optical.x, optical.y, optical.z, optical.order));
    assert.deepEqual(record.camera.position.toArray(), [7, 4, -2]);assert.deepEqual(record.root.position.toArray(), [7, 4, -2]);quaternionNear(record.camera.quaternion, expected);quaternionNear(record.root.quaternion, expected);assert.deepEqual(state, snapshot);
    const fallback = structuredClone(state);delete fallback.scenePlay.worldSpace.setups[1].entityStates[0].camera;schema.assertState(fallback);await graph.sync(fallback);
    assert.equal(loads, 1);assert.deepEqual(record.camera.position.toArray(), [1, 2, 3]);quaternionNear(record.camera.quaternion, reflectedQuaternion(THREE, plan));quaternionNear(record.root.quaternion, record.camera.quaternion);assert.deepEqual(fallback.scenePlay.worldSpace.setups[1].entityStates[0].transform.rotation, plan);
  } finally {graph.dispose();}
});
