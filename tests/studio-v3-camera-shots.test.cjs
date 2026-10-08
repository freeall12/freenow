const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-shots.mjs'), import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/history.mjs'), import('../src/features/studio-v3/transform-coordinates.mjs')]);

async function fixture({temporal = false} = {}) {
  const [shots, schema, world, history, coordinates] = await modules;
  const setupId = 'setup:state-1', otherSetupId = 'other-state'; let state = schema.createState({worldNodeId: 'owner', now: 1});
  state = world.addSetup(state, schema.createIndependentSetup({id: otherSetupId, label: 'Other state', now: 1}));
  const cameras = {};
  for (const [id, createdAt, ownerSetup, visible] of [['shared', 1, 'setup-default', true], ['camera-a', 2, setupId, true], ['camera-b', 2, setupId, true], ['hidden', 3, setupId, false], ['hidden-implicit', 4, setupId, false]]) {
    const camera = {position: {x: createdAt, y: 2, z: 3}, rotation: {x: .2, y: .5, z: 0, order: 'YXZ'}, fov: 45}; cameras[id] = camera;
    state = world.addEntity(state, schema.createEntity({id, kind: 'camera', label: `Camera ${id}`, now: createdAt}), {setupId: ownerSetup,
      setupState: {...schema.createSetupState(id, createdAt), visible, camera, transform: {position: camera.position, rotation: coordinates.cameraRotationToPlan(camera.rotation), scale: {x: 1, y: 1, z: 1}}}});
  }
  const cameraState = state.scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(item => item.entityId === 'camera-a');
  state = world.addEntityState(state, otherSetupId, cameraState);
  const oldCamera = {...cameras['camera-a'], position: {x: 99, y: 10, z: 8}};
  for (const [id, cameraId, tags, now, targetSetup] of [['view-z', 'camera-a', ['shot', 'capture'], 5, setupId], ['view-a', 'camera-a', ['shot'], 5, setupId],
    ['hidden-view', 'hidden', ['shot'], 6, setupId], ['unlinked-view', undefined, ['shot'], 7, setupId],
    ['capture-a', 'camera-a', ['capture'], 1, setupId], ['capture-b', 'camera-b', ['capture'], 1, setupId],
    ['note-a', 'camera-a', ['other'], 1, setupId], ['other-a', 'camera-a', ['shot'], 1, otherSetupId], ['other-shared', 'shared', ['capture'], 1, otherSetupId]]) {
    state = world.addView(state, schema.createView({id, label: id, sourceCameraEntityId: cameraId, setupId: targetSetup, camera: oldCamera, tags, durationMs: 123, now}), {activate: id === 'view-a'});
  }
  if (temporal) state = world.setTemporal(state, setupId, {durationMs: 2500, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'camera-b'},
    keys: [{id: 'key', timeMs: 1000}], channels: [{id: 'channel', property: 'camera.fov', values: [{keyId: 'key', value: {kind: 'number', value: 50}, interpolation: 'linear'}]}]}]}, 7);
  state = world.addOutput(state, {id: 'view-output', source: {kind: 'view', id: 'view-a'}});
  state = world.addOutput(state, {id: 'other-output', source: {kind: 'view', id: 'other-a'}});
  state = world.addOutput(state, {id: 'shared-output', source: {kind: 'view', id: 'other-shared'}});
  state = world.addReference(state, {id: 'references', targets: [{kind: 'view', id: 'view-a'}, {kind: 'entity', id: 'camera-a'}, {kind: 'view', id: 'other-a'}, {kind: 'entity', id: 'shared'}]});
  return {shots, schema, world, history, state, cameras, setupId, otherSetupId,
    reduce(action) {return shots.reduceCameraShotAction(state, action, {now: 20});}};
}

test('official explicit-first ordering, linked-camera precedence, visible implicit cameras and capture-only filtering', async () => {
  const f = await fixture(), before = structuredClone(f.state), list = f.shots.listCameraShots(f.state);
  assert.deepEqual(list.map(item => item.id), ['view-a', 'view-z', 'hidden-view', 'unlinked-view', 'implicit-camera-shot:setup:state-1:shared', 'implicit-camera-shot:setup:state-1:camera-b']);
  assert.deepEqual(list.map(item => item.index), [0, 1, 2, 3, 4, 5]); assert.deepEqual(list.map(item => item.source), ['view', 'view', 'view', 'view', 'camera', 'camera']);
  assert.deepEqual(list[0].camera, f.cameras['camera-a']); assert.deepEqual(list[0].view.camera, f.cameras['camera-a']);
  assert.equal(list[2].cameraEntityId, 'hidden'); assert.equal(list[2].setup.entityStates.find(item => item.entityId === 'hidden').visible, false);
  assert.equal(list[3].cameraEntityId, null); assert.equal(list[3].camera.position.x, 99); assert.equal(list[3].durationMs, 123);
  assert.deepEqual(list[4].view.tags, ['shot']); assert.equal(list[4].view.sourceCameraEntityId, 'shared'); assert.equal(list[4].setup.id, f.setupId);
  assert.deepEqual(f.state, before); list[0].camera.position.x = 900; list[0].view.camera.position.x = 900; list[0].entities[0].label = 'Mutated'; list[0].setup.entityStates.length = 0;
  assert.deepEqual(f.state, before); assert.equal(f.shots.listCameraShots(f.state)[0].camera.position.x, 2);
});

test('listing merges baseline, scopes setup/stage exactly and omits baseline editor shots', async () => {
  const f = await fixture(); const other = f.shots.listCameraShots(f.state, {stageId: 'stage-default', setupId: f.otherSetupId});
  assert.deepEqual(other.map(item => item.id), ['other-a', `implicit-camera-shot:${f.otherSetupId}:shared`]);
  assert.deepEqual(f.shots.listCameraShots(f.state, {stageId: 'stage-default', setupId: 'setup-default'}), []);
  assert.throws(() => f.shots.listCameraShots(f.state, {setupId: 'missing'}));
  const next = f.world.addStage(f.state, f.schema.createStage({worldNodeId: 'owner', id: 'second', now: 1}));
  assert.throws(() => f.shots.listCameraShots(next, {stageId: 'second', setupId: f.setupId}), error => error.code === 'cross-stage');
  assert.deepEqual(f.shots.listCameraShots(next, {stageId: 'second', setupId: 'setup:second:state-1'}), []);
});

test('dynamic kind uses last referenced setup key even when another camera owns it, without temporal pose sampling', async () => {
  const f = await fixture({temporal: true}), list = f.shots.listCameraShots(f.state);
  for (const item of list.filter(item => item.cameraEntityId)) {assert.equal(item.kind, 'dynamic'); assert.equal(item.durationMs, 1000);}
  assert.equal(list.find(item => item.id === 'unlinked-view').kind, 'static'); assert.equal(list.find(item => item.id === 'unlinked-view').durationMs, 123);
  assert.deepEqual(list.find(item => item.id === 'view-a').camera, f.cameras['camera-a']);
});

test('unused temporal keys and only referenced 0ms stay static; duration uses the last used positive key', async () => {
  const f = await fixture({temporal: true});
  for (const [variant, expectedKind, expectedDuration] of [['unused', 'static', 123], ['zero', 'static', 123], ['unused-last', 'dynamic', 1000], ['used-last', 'dynamic', 2000]]) {
    const state = structuredClone(f.state), track = state.scenePlay.worldSpace.setups.find(setup => setup.id === f.setupId).temporal.tracks[0];
    if (variant === 'unused') track.channels = [];
    else if (variant === 'zero') track.keys[0].timeMs = 0;
    else {
      track.keys.push({id: 'later', timeMs: 2000});
      if (variant === 'used-last') track.channels[0].values.push({keyId: 'later', value: {kind: 'number', value: 60}, interpolation: 'linear'});
    }
    const selected = f.shots.listCameraShots(state).find(item => item.id === 'view-a');
    assert.equal(selected.kind, expectedKind, variant); assert.equal(selected.durationMs, expectedDuration, variant);
  }
});

test('explicit rename edits only source view; implicit rename edits entity definition globally', async () => {
  const f = await fixture(), renamedView = f.reduce({type: 'rename', shotId: 'view-a', title: '  主镜头  '});
  assert.equal(renamedView.ok, true); assert.equal(renamedView.changed, true); assert.equal(renamedView.lane, 'setup:setup:state-1'); assert.equal(renamedView.shot.title, '主镜头');
  assert.equal(renamedView.state.scenePlay.worldSpace.entities.find(item => item.id === 'camera-a').label, 'Camera camera-a');
  assert.equal(renamedView.state.scenePlay.worldSpace.views.find(item => item.id === 'view-z').label, 'view-z');
  const renamedEntity = f.reduce({type: 'rename', shotId: 'implicit-camera-shot:setup:state-1:shared', title: '共享镜头'});
  assert.equal(renamedEntity.ok, true); assert.equal(renamedEntity.lane, 'world'); assert.equal(renamedEntity.entityId, 'shared');
  assert.equal(f.shots.listCameraShots(renamedEntity.state, {setupId: f.otherSetupId})[1].title, '共享镜头');
  assert.equal(renamedEntity.state.scenePlay.worldSpace.views.find(item => item.id === 'other-shared').label, 'other-shared');
  for (const [title, reason] of [[' ', 'empty-title'], ['view-a', 'unchanged']]) {
    const rejected = f.reduce({type: 'rename', shotId: 'view-a', title}); assert.equal(rejected.ok, false); assert.equal(rejected.changed, false); assert.equal(rejected.reason, reason); assert.equal(rejected.state, f.state);
  }
});

test('explicit removal deletes source first and all same-setup camera views, preserving another setup camera/state/views', async () => {
  const f = await fixture(), result = f.reduce({type: 'remove', shotId: 'view-z'}); assert.equal(result.ok, true); assert.equal(result.removal, 'local');
  assert.deepEqual(result.removedViewIds, ['view-z', 'view-a', 'capture-a', 'note-a']); assert.equal(result.lane, 'setup:setup:state-1');
  const space = result.state.scenePlay.worldSpace;
  assert.equal(space.setups.find(item => item.id === f.setupId).entityStates.some(item => item.entityId === 'camera-a'), false);
  assert.equal(space.setups.find(item => item.id === f.otherSetupId).entityStates.some(item => item.entityId === 'camera-a'), true);
  assert.equal(space.entities.some(item => item.id === 'camera-a'), true); assert.equal(space.views.some(item => item.id === 'other-a'), true);
  assert.equal(space.activeViewId, null); assert.equal(space.outputs.some(item => item.id === 'view-output'), false); assert.equal(space.outputs.some(item => item.id === 'other-output'), true);
  assert.deepEqual(space.references[0].targets, [{kind: 'entity', id: 'camera-a'}, {kind: 'view', id: 'other-a'}, {kind: 'entity', id: 'shared'}]); f.schema.assertState(result.state);
});

test('implicit removal deletes capture-only linked views then garbage-collects unreferenced camera definition', async () => {
  const f = await fixture({temporal: true}), result = f.reduce({type: 'remove', shotId: 'implicit-camera-shot:setup:state-1:camera-b'});
  assert.equal(result.ok, true); assert.equal(result.removal, 'global'); assert.equal(result.lane, 'world'); assert.deepEqual(result.removedViewIds, ['capture-b']);
  assert.equal(result.state.scenePlay.worldSpace.entities.some(item => item.id === 'camera-b'), false);
  assert.equal(result.state.scenePlay.worldSpace.setups.find(item => item.id === f.setupId).temporal.tracks.length, 0); f.schema.assertState(result.state);
});

test('official wy fallback deletes shared baseline camera globally and cascades other setup linked views/outputs/references', async () => {
  const f = await fixture(), result = f.reduce({type: 'remove', shotId: 'implicit-camera-shot:setup:state-1:shared'});
  assert.equal(result.ok, true); assert.equal(result.removal, 'global'); assert.equal(result.lane, 'world');
  assert.deepEqual(result.removedViewIds, ['other-shared']);
  const space = result.state.scenePlay.worldSpace;
  assert.equal(space.entities.some(item => item.id === 'shared'), false); assert.equal(space.setups.some(setup => setup.entityStates.some(item => item.entityId === 'shared')), false);
  assert.equal(space.views.some(view => view.id === 'other-shared'), false); assert.equal(space.outputs.some(output => output.id === 'shared-output'), false);
  assert.equal(space.references[0].targets.some(target => target.kind === 'entity' && target.id === 'shared'), false); f.schema.assertState(result.state);
});

test('unlinked and missing-instance explicit shots delete their source views without deleting another setup state', async () => {
  const f = await fixture(), unlinked = f.reduce({type: 'remove', shotId: 'unlinked-view'});
  assert.equal(unlinked.ok, true); assert.equal(unlinked.entityId, null); assert.equal(unlinked.removal, 'views-only'); assert.deepEqual(unlinked.removedViewIds, ['unlinked-view']);
  const missingLocal = f.world.removeEntityFromSetup(f.state, 'camera-a', f.setupId, 20);
  const list = f.shots.listCameraShots(missingLocal), shot = list.find(item => item.id === 'view-a'); assert.equal(shot.camera.position.x, 99);
  const removed = f.shots.reduceCameraShotAction(missingLocal, {type: 'remove', shotId: 'view-a'}, {now: 21});
  assert.equal(removed.ok, true); assert.equal(removed.removal, 'views-only'); assert.equal(removed.state.scenePlay.worldSpace.entities.some(entity => entity.id === 'camera-a'), true);
  assert.equal(removed.state.scenePlay.worldSpace.setups.find(setup => setup.id === f.otherSetupId).entityStates.some(item => item.entityId === 'camera-a'), true);
});

test('actual history applies a complete cascade as one reversible transaction with exact undo/redo', async () => {
  const f = await fixture(), before = structuredClone(f.state), result = f.reduce({type: 'remove', shotId: 'implicit-camera-shot:setup:state-1:shared'});
  const engine = f.history.createHistory(f.state, {createId: () => 'camera-shot-removal', now: () => 21});
  assert.equal(engine.transact(result.lane, '删除镜头', () => result.state, result.scope), true); assert.equal(engine.getHistory().lanes.world.undoStack.length, 1);
  assert.deepEqual(engine.undo(result.lane), {ok: true}); assert.deepEqual(engine.getState(), before);
  assert.deepEqual(engine.redo(result.lane), {ok: true}); assert.deepEqual(engine.getState(), result.state); assert.deepEqual(f.state, before);
});

test('strict finite complete camera, current shot membership and action fields reject malformed input without mutation', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  for (const mutate of [state => {state.scenePlay.worldSpace.views[0].camera.fov = NaN;}, state => {delete state.scenePlay.worldSpace.views[0].camera.position;},
    state => {state.scenePlay.worldSpace.views[0].tags = null;}, state => {state.scenePlay.worldSpace.setups.find(setup => setup.id === f.setupId).entityStates[0].camera.rotation.y = Infinity;}]) {
    const invalid = structuredClone(f.state); mutate(invalid); assert.throws(() => f.shots.listCameraShots(invalid));
  }
  for (const action of [{type: 'rename', shotId: 'view-a', title: null}, {type: 'remove', shotId: 'view-a', title: 'extra'}, {type: 'delete', shotId: 'view-a'}]) assert.throws(() => f.reduce(action));
  const absent = f.reduce({type: 'remove', shotId: 'other-a'}); assert.equal(absent.ok, false); assert.equal(absent.reason, 'camera-shot-missing'); assert.equal(absent.state, f.state);
  assert.deepEqual(f.state, before);
});
