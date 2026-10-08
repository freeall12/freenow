const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
  import('../src/features/studio-v3/saved-view-actions.mjs'), import('../src/features/studio-v3/history.mjs'),
  import('../src/features/studio-v3/history-patches.mjs'), import('../src/features/studio-v3/camera-shots.mjs')
]);
async function fixture() {
  const [schema, world, actions, history, patches, shots] = await modules;
  let state = schema.createState({worldNodeId: 'saved-view-owner', now: 1});
  const camera = {position: {x: 2, y: 1, z: 3}, rotation: {x: .1, y: .2, z: 0, order: 'YXZ'}, fov: 45,
    frameAspectRatio: 16 / 9, focalLength: 24, apertureFNumber: 2.8, depthOfFieldMode: 'aperture', focusDistance: null,
    focus: {mode: 'object', entityId: 'actor'}, lookAt: {mode: 'entity', entityId: 'actor', offset: {x: 0, y: 1, z: 0}}};
  state = world.addEntity(state, schema.createEntity({id: 'actor', kind: 'actor', label: '角色', now: 1}));
  state = world.addEntity(state, schema.createEntity({id: 'camera', kind: 'camera', label: '真实摄像机', now: 1}),
    {setupState: {...schema.createSetupState('camera', 1), camera}});
  state = world.addSetup(state, schema.createIndependentSetup({id: 'other', label: '其他状态', now: 2}));
  state = world.addStage(state, schema.createStage({worldNodeId: 'saved-view-owner', id: 'stage-b', label: '舞台 B', now: 2}));
  state = world.addView(state, schema.createView({id: 'capture', label: '只保存视角', camera, now: 3}));
  state = world.addView(state, schema.createView({id: 'shot', label: '关联镜头', camera, sourceCameraEntityId: 'camera', tags: ['capture', 'shot'], now: 3}), {activate: false});
  state = world.addView(state, schema.createView({id: 'other-view', setupId: 'other', label: '跨状态视角', camera, tags: [], now: 3}), {activate: false});
  const otherCamera = {position: {x: -1, y: 2, z: 7}, rotation: {x: 0, y: 0, z: 0}, fov: 55, frameAspectRatio: null, focus: {mode: 'point', target: {x: 0, y: 0, z: 0}}};
  state = world.addView(state, schema.createView({id: 'stage-view', stageId: 'stage-b', label: '跨舞台视角', camera: otherCamera, now: 3}), {activate: false});
  state = world.addOutput(state, {id: 'capture-output', source: {kind: 'view', id: 'capture'}, canvasNodeId: 'exported-image'});
  state = world.addOutput(state, {id: 'shot-output', source: {kind: 'view', id: 'shot'}});
  state = world.addReference(state, {id: 'reference', targets: [{kind: 'view', id: 'capture'}, {kind: 'view', id: 'shot'}, {kind: 'entity', id: 'camera'}, {kind: 'setup', id: 'other'}]});
  state = world.setTemporal(state, 'setup:state-1', {durationMs: 1000, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'camera'}, keys: [{id: 'key', timeMs: 0}],
    channels: [{id: 'fov', property: 'camera.fov', values: [{keyId: 'key', value: {kind: 'number', value: 45}}]}]}]}, 4);
  state.capturedPhotos.push({id: 'photo', src: 'existing-photo.png', cameraState: camera});
  state.worldGenerationTasks.push({id: 'existing-task', state: 'complete'});
  return {schema, world, actions, history, patches, shots, state, camera, otherCamera,
    reduce: (action, options = {}) => actions.reduceSavedViewAction(state, action, {now: 10, ...options})};
}
const spaceOf = state => state.scenePlay.worldSpace;
function commit(engine, result) {
  return result.ok && result.changed && engine.transact(result.lane, result.historyLabel, () => result.state, {kind: 'world-space'});
}

test('list contains all saved Views in stored order with labels, optional filters and no implicit camera shots', async () => {
  const f = await fixture(), list = f.actions.listSavedViews(f.state);
  assert.deepEqual(list.map(view => view.id), ['capture', 'shot', 'other-view', 'stage-view']);
  assert.equal(list[0].stageLabel, 'Stage 1'); assert.equal(list[0].setupLabel, 'State 1'); assert.equal(list[0].isActive, true);
  assert.equal(list[2].setupLabel, '其他状态'); assert.equal(list[3].stageLabel, '舞台 B');
  assert.deepEqual(f.actions.listSavedViews(f.state, {setupId: 'other'}).map(view => view.id), ['other-view']);
  assert.deepEqual(f.actions.listSavedViews(f.state, {stageId: 'stage-b'}).map(view => view.id), ['stage-view']);
  assert.deepEqual(f.actions.listSavedViews(f.state, {stageId: 'stage-b', setupId: 'other'}), []);
  assert.deepEqual(f.actions.listSavedViews(f.state, {setupId: 'absent'}), []);
  const before = structuredClone(f.state); list[0].camera.position.x = 900; list[0].tags.push('detached');
  assert.deepEqual(f.state, before);
});

test('create uses current independent setup, global View N and capture tags, then activates only a real detached View', async () => {
  const f = await fixture(), before = structuredClone(f.state), camera = structuredClone(f.camera);
  const selected = f.reduce({type: 'set-active', viewId: 'other-view'}).state;
  const result = f.actions.reduceSavedViewAction(selected, {type: 'create', id: 'saved', camera, notes: '观察位置'}, {now: 10});
  assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(result.viewId, 'saved'); assert.equal(result.lane, 'setup:other');
  const space = spaceOf(result.state), view = space.views.at(-1);
  assert.equal(view.label, 'View 5'); assert.equal(view.setupId, 'other'); assert.equal(view.stageId, 'stage-default');
  assert.deepEqual(view.tags, ['capture']); assert.equal(view.notes, '观察位置'); assert.equal(view.createdAt, 10); assert.equal(view.updatedAt, 10);
  assert.equal(space.activeViewId, 'saved'); assert.equal(space.activeSetupId, 'other'); assert.equal(Object.hasOwn(view, 'sourceCameraEntityId'), false);
  assert.deepEqual(space.entities, spaceOf(f.state).entities); assert.deepEqual(result.state.capturedPhotos, f.state.capturedPhotos);
  camera.position.x = 800; assert.equal(view.camera.position.x, 2);
  view.camera.position.x = 700; space.setups[0].label = 'mutated detached result';
  assert.deepEqual(f.state, before); assert.equal(spaceOf(selected).setups[0].label, 'Scene baseline');
});

test('create accepts explicit shot tags without synthesizing camera linkage; empty label and baseline are denied', async () => {
  const f = await fixture(), result = f.reduce({type: 'create', id: 'unlinked-shot', camera: f.camera, label: '  分镜  ', tags: ['capture', 'shot']});
  assert.equal(spaceOf(result.state).views.at(-1).label, '分镜');
  const shot = f.shots.listCameraShots(result.state).find(item => item.id === 'unlinked-shot');
  assert.equal(shot.cameraEntityId, null); assert.deepEqual(shot.camera, f.camera);
  assert.equal(f.reduce({type: 'create', id: 'empty', camera: f.camera, label: ' \n '}).reason, 'empty-label');
  const baseline = f.world.setActiveSetup(f.state, 'setup-default');
  const denied = f.actions.reduceSavedViewAction(baseline, {type: 'create', id: 'blocked', camera: f.camera}, {now: 10});
  assert.equal(denied.reason, 'baseline-readonly'); assert.equal(denied.state, baseline); assert.equal(denied.lane, 'setup:setup-default');
});

test('cross-stage creation follows selected independent setup and validates focus targets in that stage', async () => {
  const f = await fixture(), selected = f.reduce({type: 'set-active', viewId: 'stage-view'}).state;
  const result = f.actions.reduceSavedViewAction(selected, {type: 'create', id: 'stage-new', camera: f.otherCamera}, {now: 10});
  assert.equal(result.lane, 'setup:setup:stage-b:state-1'); assert.equal(spaceOf(result.state).views.at(-1).stageId, 'stage-b');
  assert.throws(() => f.actions.reduceSavedViewAction(selected, {type: 'create', id: 'cross-focus', camera: f.camera}, {now: 10}), /cross-stage/);
});

test('update-camera replaces only the target snapshot and updatedAt, retaining links, metadata and all other state', async () => {
  const f = await fixture(), state = structuredClone(f.state), view = spaceOf(state).views.find(item => item.id === 'other-view');
  Object.assign(view, {sourceCameraEntityId: 'camera', notes: '保留', referenceIds: ['reference'], durationMs: 1200, generationContext: {prompt: 'context'}, viewportDrawing: {strokes: []}});
  f.schema.assertState(state); const before = structuredClone(state), camera = structuredClone(f.camera); camera.position.z = 30;
  camera.focalLength = 85; camera.apertureFNumber = 1.4; camera.depthOfFieldMode = 'deepFocus'; camera.focusDistance = 4; camera.focus = {mode: 'distance', distance: 4};
  const result = f.actions.reduceSavedViewAction(state, {type: 'update-camera', viewId: 'other-view', camera}, {now: 10});
  assert.equal(result.lane, 'setup:other'); assert.equal(spaceOf(result.state).activeViewId, 'capture');
  const expected = structuredClone(before); Object.assign(spaceOf(expected).views.find(item => item.id === 'other-view'), {camera, updatedAt: 10});
  assert.deepEqual(result.state, expected); assert.deepEqual(state, before);
  camera.focus.distance = 90; assert.equal(spaceOf(result.state).views.find(item => item.id === 'other-view').camera.focus.distance, 4);
  spaceOf(result.state).views[0].camera.position.x = 100; assert.deepEqual(state, before);
});

test('rename trims only target label; unchanged camera/name and repeated selection omit historyLabel', async () => {
  const f = await fixture(), renamed = f.reduce({type: 'rename', viewId: 'other-view', label: '  新名称  '});
  assert.equal(renamed.lane, 'setup:other'); assert.equal(spaceOf(renamed.state).views[2].label, '新名称');
  assert.equal(spaceOf(renamed.state).views[2].updatedAt, 10); assert.equal(spaceOf(renamed.state).activeViewId, 'capture');
  for (const result of [f.reduce({type: 'rename', viewId: 'capture', label: '  只保存视角 '}, {now: 99}),
    f.reduce({type: 'update-camera', viewId: 'capture', camera: f.camera}, {now: 99}), f.reduce({type: 'set-active', viewId: 'capture'})]) {
    assert.equal(result.ok, true); assert.equal(result.changed, false); assert.equal(result.state, f.state); assert.equal(Object.hasOwn(result, 'historyLabel'), false);
  }
  assert.equal(f.reduce({type: 'rename', viewId: 'capture', label: '\t'}).reason, 'empty-label');
  const engine = f.history.createHistory(f.state), result = f.reduce({type: 'rename', viewId: 'capture', label: '只保存视角'});
  assert.equal(commit(engine, result), false); assert.deepEqual(engine.getHistory().lanes.world.undoStack, []);
});

test('set-active selects across setups/stages on world lane without changing camera, content or source; null clears only View', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  for (const viewId of ['other-view', 'stage-view']) {
    const result = f.reduce({type: 'set-active', viewId}), expected = structuredClone(before), selected = spaceOf(expected).views.find(view => view.id === viewId);
    Object.assign(spaceOf(expected), {activeViewId: viewId, activeStageId: selected.stageId, activeSetupId: selected.setupId});
    assert.equal(result.lane, 'world'); assert.deepEqual(result.state, expected); assert.deepEqual(f.state, before);
  }
  const selected = f.reduce({type: 'set-active', viewId: 'stage-view'}).state;
  const cleared = f.actions.reduceSavedViewAction(selected, {type: 'set-active', viewId: null}, {now: 10});
  const expected = structuredClone(selected); spaceOf(expected).activeViewId = null;
  assert.equal(cleared.viewId, null); assert.deepEqual(cleared.state, expected);
  const noOp = f.actions.reduceSavedViewAction(cleared.state, {type: 'set-active', viewId: null}); assert.equal(noOp.changed, false);
});

test('remove only one View and its output/reference targets; retains linked entities, cameras, temporal data, photos and other Views', async () => {
  const f = await fixture(), before = structuredClone(f.state), result = f.reduce({type: 'remove', viewId: 'capture'}), expected = f.world.removeView(before, 'capture');
  assert.deepEqual(result.state, expected); assert.equal(result.lane, 'setup:setup:state-1'); assert.equal(spaceOf(result.state).activeViewId, null);
  assert.deepEqual(spaceOf(result.state).references[0].targets, [{kind: 'view', id: 'shot'}, {kind: 'entity', id: 'camera'}, {kind: 'setup', id: 'other'}]);
  const linked = f.reduce({type: 'remove', viewId: 'shot'});
  assert.deepEqual(spaceOf(linked.state).entities, spaceOf(f.state).entities); assert.deepEqual(spaceOf(linked.state).setups, spaceOf(f.state).setups);
  assert.deepEqual(linked.state.capturedPhotos, f.state.capturedPhotos); assert.equal(spaceOf(linked.state).activeViewId, 'capture');
  assert.equal(spaceOf(linked.state).views.some(view => view.id === 'other-view'), true); assert.deepEqual(f.state, before);
});

test('readonly rejects even persisted selection, playing/scrubbing block only writes and never mutate state', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const actions = [{type: 'create', id: 'blocked', camera: f.camera}, {type: 'update-camera', viewId: 'capture', camera: f.otherCamera},
    {type: 'rename', viewId: 'capture', label: '改变'}, {type: 'remove', viewId: 'capture'}];
  for (const guard of ['readonly', 'playing', 'scrubbing']) for (const action of actions) {
    const result = f.reduce(action, {[guard]: true}); assert.equal(result.ok, false); assert.equal(result.changed, false);
    assert.equal(result.reason, guard); assert.equal(result.state, f.state); assert.equal(Object.hasOwn(result, 'historyLabel'), false);
  }
  assert.equal(f.reduce({type: 'set-active', viewId: 'other-view'}, {readonly: true}).reason, 'readonly');
  assert.equal(f.reduce({type: 'set-active', viewId: 'stage-view'}, {playing: true, scrubbing: true}).ok, true);
  assert.deepEqual(f.state, before);
});

test('missing View returns a denial without hidden creation; malformed identities and field injection throw', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  for (const type of ['remove', 'set-active', 'rename', 'update-camera']) {
    const action = {type, viewId: 'absent', ...(type === 'rename' ? {label: 'name'} : type === 'update-camera' ? {camera: f.camera} : {})};
    const result = f.reduce(action); assert.equal(result.reason, 'view-missing'); assert.equal(result.changed, false); assert.equal(result.state, f.state);
  }
  for (const action of [{type: 'create', id: 'capture', camera: f.camera}, {type: 'create', id: ' ', camera: f.camera},
    {type: 'create', id: 'new', camera: f.camera, setupId: 'other'}, {type: 'create', id: 'new', camera: f.camera, sourceCameraEntityId: 'camera'},
    {type: 'update-camera', viewId: 'capture', camera: f.camera, tags: ['shot']}, {type: 'rename', viewId: 'capture', label: null},
    {type: 'remove', viewId: null}, {type: 'set-active', viewId: ''}, {type: 'restore', viewId: 'capture'}]) assert.throws(() => f.reduce(action));
  assert.throws(() => f.reduce({type: 'remove', viewId: 'capture'}, {now: -1}));
  assert.throws(() => f.reduce({type: 'rename', viewId: 'capture', label: 'new'}, {now: 2}), /predate/);
  assert.throws(() => f.actions.listSavedViews(f.state, {setupId: null}));
  assert.throws(() => f.actions.listSavedViews(f.state, {includeImplicit: true}));
  assert.deepEqual(f.state, before);
});

test('complete camera and optics validation rejects non-JSON, missing pose, invalid targets and unsupported projection without mutation', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const mutations = [camera => {delete camera.position;}, camera => {camera.position.x = NaN;}, camera => {camera.rotation.order = 'INVALID';},
    camera => {camera.fov = 180;}, camera => {camera.fov = 0;}, camera => {camera.focalLength = -1;}, camera => {camera.apertureFNumber = 0;},
    camera => {camera.frameAspectRatio = 0;}, camera => {camera.focusDistance = -1;}, camera => {camera.depthOfFieldMode = 'fake';},
    camera => {camera.focus = {mode: 'object', entityId: 'absent'};}, camera => {camera.lookAt.offset.x = Infinity;},
    camera => {camera.orthographic = true;}, camera => {camera.hidden = undefined;}, camera => {camera.position = new Date();},
    camera => {camera.self = camera;}];
  for (const mutate of mutations) {
    const camera = structuredClone(f.camera); mutate(camera);
    assert.throws(() => f.reduce({type: 'create', id: 'invalid', camera}));
    assert.throws(() => f.reduce({type: 'update-camera', viewId: 'other-view', camera}));
  }
  for (const tags of [['capture', 'capture'], [''], 'shot']) assert.throws(() => f.reduce({type: 'create', id: 'bad-tags', camera: f.camera, tags}));
  assert.throws(() => f.reduce({type: 'create', id: 'bad-notes', camera: f.camera, notes: 42}));
  assert.deepEqual(f.state, before);
});

test('strict pre-existing relations remain enforced, with no repair of malformed setup/source links', async () => {
  const f = await fixture();
  for (const mutate of [state => {spaceOf(state).views[0].setupId = 'setup-default';}, state => {spaceOf(state).views[0].sourceCameraEntityId = 'actor';},
    state => {spaceOf(state).activeViewId = 'other-view';}, state => {spaceOf(state).views[0].stageId = 'stage-b';}]) {
    const state = structuredClone(f.state); mutate(state);
    assert.throws(() => f.actions.listSavedViews(state)); assert.throws(() => f.actions.reduceSavedViewAction(state, {type: 'remove', viewId: 'capture'}));
  }
});

test('create/update/rename/remove and cross-stage selection each replay and undo precisely through existing history patches', async () => {
  const f = await fixture(), camera = structuredClone(f.camera); camera.position.z = 30;
  const actions = [{type: 'create', id: 'saved', camera: f.camera}, {type: 'update-camera', viewId: 'other-view', camera},
    {type: 'rename', viewId: 'other-view', label: '新名称'}, {type: 'remove', viewId: 'capture'}, {type: 'set-active', viewId: 'stage-view'}, {type: 'set-active', viewId: null}];
  for (const [index, action] of actions.entries()) {
    const before = structuredClone(f.state), result = f.reduce(action), engine = f.history.createHistory(before, {createId: () => `view-history:${index}`, now: () => 10});
    assert.equal(commit(engine, result), true); assert.equal(engine.getHistory().lanes[result.lane].undoStack.length, 1);
    assert.deepEqual(engine.getState(), result.state);
    const record = engine.getHistory().lanes[result.lane].undoStack[0];
    assert.deepEqual(f.patches.applyPatches(before, record.forward), result.state);
    assert.deepEqual(f.patches.applyPatches(result.state, record.inverse), before);
    assert.deepEqual(engine.undo(result.lane), {ok: true}); assert.deepEqual(engine.getState(), before);
    assert.deepEqual(engine.redo(result.lane), {ok: true}); assert.deepEqual(engine.getState(), result.state); assert.deepEqual(f.state, before);
  }
});
