const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-history-adapter.mjs'), import('../src/features/studio-v3/camera-edit-session.mjs'),
  import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
  import('../src/features/studio-v3/transform-coordinates.mjs')]);

async function fixture({shared = false, tracks = false, gate, onLane, onStatus} = {}) {
  const [{createCameraHistoryAdapter}, {createCameraEditSession}, {createStudioSession}, schema, world, coordinates] = await modules;
  const entityId = 'camera', setupId = 'setup:state-1', ownerSetup = shared ? 'setup-default' : setupId, lane = `setup:${setupId}`;
  const camera = {position: {x: 1, y: 2, z: 3}, rotation: {x: .2, y: .6, z: -.1, order: 'YXZ'}, fov: 45,
    lookAt: {mode: 'point', target: {x: 0, y: 1, z: -4}}};
  const transform = {position: structuredClone(camera.position), rotation: coordinates.cameraRotationToPlan(camera.rotation), scale: {x: 2, y: 3, z: 4}};
  let state = schema.createState({worldNodeId: 'owner', now: 1});
  state = world.addEntity(state, schema.createEntity({id: entityId, kind: 'camera', label: 'Camera', now: 1}),
    {setupId: ownerSetup, setupState: {...schema.createSetupState(entityId, 1), camera, transform}});
  if (tracks) state = world.setTemporal(state, setupId, {durationMs: 1000, tracks: [{id: 'camera-track', owner: {kind: 'entity', entityId}, keys: [{id: 'camera-key', timeMs: 0}], channels: []}]}, 1);
  const before = structuredClone(state), source = {id: 'source', worldResource: {url: '/scene.glb', format: 'glb'}};
  const target = {id: 'owner', studioV3: {version: 3, state, revision: 0,
    sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  let guard, serial = 0, lease = false, saved = null, visual = null;
  const app = {getState: () => ({nodes: [target, source]}), projectIdentity: () => ({id: 'project'}),
    registerNodeWriteGuard(id, callback) {guard = callback; return () => {guard = null;};}};
  const domain = createStudioSession({nodeId: 'owner', app, autosaveMs: null, store: {flush: async () => {}},
    getSourceSnapshot: node => node.worldResource, historyOptions: {createId: () => `camera:${++serial}`, now: () => 2},
    publishNode: async (id, patch, {beforeCommit}) => {
      assert.equal(beforeCommit(), true); const candidate = {...target, studioV3: structuredClone(patch.studioV3)};
      assert.equal(guard(candidate), true); saved = structuredClone(candidate); target.studioV3 = structuredClone(patch.studioV3);
    }});
  const calls = [], statuses = [], lanes = [], events = [], errors = [], failures = {commit: false, cancel: false};
  const history = Object.fromEntries(['begin', 'preview', 'commit', 'cancel', 'getActiveTransaction'].map(name => [name, (...args) => {
    if (name !== 'getActiveTransaction') calls.push(name);
    if (failures[name] === 'false') return false;
    if (failures[name]) throw new Error(`${name} rejected`);
    return domain.history[name](...args);
  }]));
  const getState = () => {const value = domain.getState(); if (gate) value.scenePlay.worldSpace[gate] = true; return value;};
  const adapter = createCameraHistoryAdapter({getState, history,
    onLane(value) {lanes.push(value); onLane?.(value);}, onStatus(value) {statuses.push(value); onStatus?.(value);}});
  const local = () => domain.getState().scenePlay.worldSpace.setups.find(setup => setup.id === ownerSetup).entityStates.find(item => item.entityId === entityId);
  const session = createCameraEditSession({getSubject: id => id === entityId ? {entityId, label: 'Camera', camera: local().camera, transform: local().transform} : null,
    getFence: () => {const {revision, editEpoch, ...identity} = domain.getFence(); return identity;},
    onEdit(event) {events.push(structuredClone(event)); return adapter.handle(event);},
    onStart(event) {lease = true; visual = event.camera;}, onEnd() {lease = false;}, onPreview(event) {visual = event.camera;}, onError(error) {errors.push(error);}});
  const pose = (distance = 1) => {const next = session.active.camera; next.position.x += distance; return next;};
  return {domain, adapter, session, schema, world, coordinates, before, local, pose, calls, statuses, lanes, events, errors, failures, lane,
    get lease() {return lease;}, get visual() {return visual;}, get saved() {return saved;},
    records: () => domain.history.getHistory().lanes[lane]?.undoStack ?? [],
    async close() {session.dispose(); adapter.dispose(); if (domain.history.getActiveTransaction()) domain.history.cancel(); await domain.closeGuard();}};
}

test('adapter connects real session optics/pose previews to a single commit and durable camera state', async () => {
  const f = await fixture(); try {
    const original = structuredClone(f.local()); assert.equal(f.session.start('camera'), true); assert.equal(f.lease, true);
    assert.equal(f.session.patchOptics({focalLength: 85}), true); assert.deepEqual(f.local().camera.lookAt, original.camera.lookAt);
    assert.deepEqual(f.local().transform, original.transform);
    assert.equal(f.session.applyCamera(f.pose()), true); assert.equal(Object.hasOwn(f.local().camera, 'lookAt'), false);
    assert.deepEqual(f.local().transform.scale, original.transform.scale); f.schema.assertCamera(f.local().camera);
    assert(f.coordinates.sameRotation(f.coordinates.planRotationToCamera(f.local().transform.rotation), f.local().camera.rotation));
    assert.equal(f.records().length, 0); assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1);
    assert.deepEqual(f.calls, ['begin', 'preview', 'preview', 'commit']); assert.deepEqual(f.lanes, [f.lane]);
    assert.equal(f.domain.history.getActiveTransaction(), null); assert.deepEqual(await f.domain.flush(), {ok: true});
    assert.deepEqual(f.saved.studioV3.state, f.domain.getState()); assert.equal(f.lease, false);
    assert.deepEqual(f.domain.history.undo(f.lane), {ok: true}); assert.deepEqual(f.domain.getState(), f.before);
  } finally {await f.close();}
});

test('cancel uses owned transaction to restore sparse baseline and clearLookAt deletion exactly', async () => {
  const f = await fixture(); try {
    f.session.start('camera'); f.session.applyCamera(f.pose()); f.session.patchOptics({focalLength: 135});
    assert.equal(f.session.cancel(), true); assert.deepEqual(f.domain.getState(), f.before); assert.equal(f.records().length, 0);
    assert.equal(f.domain.getStatus().dirty, false); assert.equal(f.domain.history.getActiveTransaction(), null);
    assert.equal(f.lease, false); assert.deepEqual(f.calls, ['begin', 'preview', 'preview', 'cancel']);
  } finally {await f.close();}
});

test('atomic clearLookAt + real reducer failure does not leak deletion or contradictory plan pose', async () => {
  const f = await fixture(); try {
    f.session.start('camera'); const current = f.session.active, camera = structuredClone(current.camera); delete camera.lookAt; camera.position.x += 1;
    assert.equal(f.adapter.handle({phase: 'preview', entityId: 'camera', clearLookAt: true, camera, transform: current.transform}), false);
    assert.deepEqual(f.domain.getState(), f.before); assert.deepEqual(f.local().camera.lookAt, f.before.scenePlay.worldSpace.setups.find(setup => setup.id === 'setup:state-1').entityStates[0].camera.lookAt);
    assert.equal(f.domain.history.getActiveTransaction().label, '摄像机操控'); assert.equal(f.statuses.at(-1).phase, 'preview');
    assert.equal(f.session.applyCamera(f.pose()), true); assert.equal(f.session.cancel(), true); assert.deepEqual(f.domain.getState(), f.before);
  } finally {await f.close();}
});

test('adapter rejects baseline, keyed cameras and playing/scrubbing without beginning history', async () => {
  for (const options of [{shared: true}, {tracks: true}, {gate: 'temporalPlaybackPlaying'}, {gate: 'temporalPlayheadScrubbing'}]) {
    const f = await fixture(options); try {
      assert.equal(f.session.start('camera'), false); assert.equal(f.session.active, null); assert.equal(f.lease, false);
      assert.deepEqual(f.calls, []); assert.equal(f.domain.history.getActiveTransaction(), null); assert.deepEqual(f.domain.getState(), f.before);
      assert.equal(f.statuses.length, 1);
    } finally {await f.close();}
  }
});

test('no adapter owner can begin, preview, commit or cancel a foreign transaction', async () => {
  const f = await fixture(); try {
    f.domain.history.begin('world', 'Foreign edit'); f.domain.history.preview(state => f.world.patchEntity(state, 'camera', {label: 'Foreign name'}, 3));
    const previous = f.domain.getState();
    for (const phase of ['begin', 'preview', 'commit', 'cancel']) assert.equal(f.adapter.handle({phase, entityId: 'camera', camera: f.local().camera, transform: f.local().transform}), false);
    assert.equal(f.domain.history.getActiveTransaction().label, 'Foreign edit'); assert.deepEqual(f.domain.getState(), previous); assert.deepEqual(f.calls, []);
  } finally {await f.close();}
});

test('owned transaction descriptor fences changed lane, label or scope', async () => {
  for (const replacement of [{lane: 'world', label: '摄像机操控', scope: {kind: 'world-space'}},
    {lane: 'setup:setup:state-1', label: 'Foreign edit', scope: {kind: 'world-space'}},
    {lane: 'setup:setup:state-1', label: '摄像机操控', scope: {kind: 'environment', fields: ['ground']}}]) {
    const f = await fixture(); try {
      assert.equal(f.session.start('camera'), true); f.domain.history.cancel();
      f.domain.history.begin(replacement.lane, replacement.label, replacement.scope);
      assert.equal(f.adapter.handle({phase: 'cancel', entityId: 'camera'}), false);
      assert.deepEqual(f.domain.history.getActiveTransaction(), replacement); assert.deepEqual(f.calls, ['begin']);
      f.adapter.dispose(); assert.equal(f.domain.history.getActiveTransaction().label, replacement.label);
    } finally {await f.close();}
  }
});

test('failed commit/cancel retain local owner and camera session for retry', async () => {
  for (const phase of ['commit', 'cancel']) {
    const f = await fixture(); try {
      f.session.start('camera'); f.session.applyCamera(f.pose()); f.failures[phase] = true;
      assert.equal(phase === 'commit' ? f.session.finish() : f.session.cancel(), false);
      assert.equal(f.session.active.entityId, 'camera'); assert.equal(f.lease, true); assert(f.domain.history.getActiveTransaction());
      assert.equal(f.statuses.at(-1).phase, phase); f.failures[phase] = false;
      assert.equal(phase === 'commit' ? f.session.finish() : f.session.cancel(), true);
      assert.equal(f.session.active, null); assert.equal(f.domain.history.getActiveTransaction(), null);
      assert.equal(f.records().length, phase === 'commit' ? 1 : 0);
    } finally {f.failures.commit = f.failures.cancel = false; await f.close();}
  }
});

test('checkpoint clears adapter owner, saves accepted state and reopens independently for next pose', async () => {
  const f = await fixture(); try {
    f.session.start('camera'); f.session.applyCamera(f.pose()); assert.equal(f.session.checkpoint(), true);
    const captured = f.domain.getState(); assert.equal(f.records().length, 1); assert.equal(f.session.active.transactionOpen, false); assert.equal(f.lease, true);
    assert.deepEqual(await f.domain.flush(), {ok: true}); assert.deepEqual(f.saved.studioV3.state, captured);
    assert.equal(f.session.applyCamera(f.pose()), true); assert.equal(f.session.cancel(), true);
    assert.deepEqual(f.domain.getState(), captured); assert.equal(f.records().length, 1);
    assert.deepEqual(f.calls, ['begin', 'preview', 'commit', 'begin', 'preview', 'cancel']); assert.deepEqual(f.lanes, [f.lane, f.lane]);
  } finally {await f.close();}
});

test('empty checkpoint and closed owner exit never cancel a later external transaction', async () => {
  const f = await fixture(); try {
    f.session.start('camera'); assert.equal(f.session.checkpoint(), true); assert.deepEqual(f.calls, ['begin', 'cancel']);
    f.domain.history.begin('world', 'External owner'); const previous = f.domain.getState();
    assert.equal(f.adapter.handle({phase: 'cancel', entityId: 'camera'}), false);
    assert.equal(f.session.applyCamera(f.pose()), false); assert.equal(f.session.active.transactionOpen, false);
    assert.equal(f.session.finish(), true); assert.equal(f.domain.history.getActiveTransaction().label, 'External owner');
    assert.deepEqual(f.domain.getState(), previous); assert.deepEqual(f.calls, ['begin', 'cancel']);
  } finally {await f.close();}
});

test('adapter disposal abandons only its descriptor and observers cannot undo successful history operations', async () => {
  const f = await fixture({onLane: () => {throw new Error('lane observer failed');}, onStatus: () => {throw new Error('status observer failed');}}); try {
    assert.equal(f.session.start('camera'), true); assert.equal(f.domain.history.getActiveTransaction().label, '摄像机操控');
    assert.equal(f.adapter.dispose(), true); assert.equal(f.adapter.dispose(), false);
    assert.equal(f.adapter.handle({phase: 'cancel', entityId: 'camera'}), false);
    assert.equal(f.domain.history.getActiveTransaction().label, '摄像机操控'); assert.deepEqual(f.calls, ['begin']);
  } finally {await f.close();}
});

test('literal false terminal history callbacks report rejection, retain ownership and notify after successful retry', async () => {
  for (const phase of ['commit', 'cancel']) {
    const f = await fixture(); try {
      f.session.start('camera'); f.session.applyCamera(f.pose()); f.failures[phase] = 'false';
      assert.equal(phase === 'commit' ? f.session.finish() : f.session.cancel(), false);
      assert.equal(f.domain.history.getActiveTransaction().label, '摄像机操控'); assert.equal(f.statuses.at(-1).status, 'failed');
      f.failures[phase] = false; assert.equal(phase === 'commit' ? f.session.finish() : f.session.cancel(), true);
      assert.deepEqual(f.statuses.at(-1), {status: 'ready', phase, entityId: 'camera'}); assert.equal(f.domain.history.getActiveTransaction(), null);
    } finally {f.failures.commit = f.failures.cancel = false; await f.close();}
  }
});
