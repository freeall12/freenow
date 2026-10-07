const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-edit-session.mjs'), import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/history.mjs'),
  import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/transform-coordinates.mjs'), import('three')]);

async function fixture(options = {}) {
  const [{createCameraEditSession}, schema, world, {createHistory}, {reduceEntityAction}, coordinates, THREE] = await modules;
  const setupId = 'setup:state-1', lane = `setup:${setupId}`;
  let state = schema.createState({worldNodeId: 'camera-owner', now: 1});
  for (const entityId of ['camera-a', 'camera-b']) {
    const camera = {position: {x: 1, y: 2, z: 3}, rotation: {x: .25, y: .6, z: -.12, order: 'YXZ'}, fov: 45,
      lookAt: {mode: 'point', target: {x: 0, y: 1, z: -3}}};
    const transform = {position: structuredClone(camera.position), rotation: coordinates.cameraRotationToPlan(camera.rotation), scale: {x: 2, y: 3, z: 4}};
    state = world.addEntity(state, schema.createEntity({id: entityId, kind: 'camera', label: entityId, now: 1}),
      {setupId, setupState: {...schema.createSetupState(entityId, 1), camera, transform}});
  }
  let historyId = 0;
  const before = structuredClone(state), history = options.history || createHistory(state, {createId: () => `camera-edit:${++historyId}`, now: () => 2});
  const phases = [], previews = [], errors = [], starts = [], ends = [];
  let owner = 'one', eligible = true, visual = null, lease = false, editEpoch = 0, session;
  const local = (id = 'camera-a') => history.getState().scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(value => value.entityId === id);
  session = createCameraEditSession({
    getSubject: entityId => eligible && local(entityId) ? {entityId, label: entityId, camera: local(entityId).camera, transform: local(entityId).transform} : null,
    getFence: () => ({owner, setupId}),
    onEdit(event) {
      phases.push(structuredClone(event));
      if (options.onEdit) {const override = options.onEdit(event, {session, history}); if (override !== 'default') return override;}
      if (event.phase === 'begin') return history.begin(lane, 'director.editCamera');
      if (event.phase === 'preview') {
        history.preview(previous => {
          if (event.clearLookAt) {
            const camera = structuredClone(previous.scenePlay.worldSpace.setups.find(setup => setup.id === setupId).entityStates.find(value => value.entityId === event.entityId).camera);
            delete camera.lookAt; previous = world.patchEntityState(previous, setupId, event.entityId, {camera}, 2);
          }
          const result = reduceEntityAction(previous, {type: 'update', entityId: event.entityId, setupId, patch: {camera: event.camera, transform: event.transform}}, {now: 2});
          assert.equal(result.ok, true); return result.state;
        }); editEpoch++; return true;
      }
      if (event.phase === 'commit') {history.commit(); return true;}
      if (event.phase === 'cancel') return history.cancel();
      return false;
    },
    onPreview(event) {previews.push(structuredClone(event)); const result = options.onPreview?.(event, session); if (result === false) return false; visual = structuredClone(event.camera);},
    onStart(event) {lease = true; starts.push(event); visual = structuredClone(event.camera); options.onStart?.(event, session);},
    onEnd(event) {lease = false; ends.push(event); options.onEnd?.(event, session);},
    onError(error) {errors.push(error); options.onError?.(error, session);}
  });
  const pose = (dx = 1) => {const camera = session.active.camera; camera.position.x += dx; return camera;};
  return {session, history, schema, world, coordinates, THREE, phases, previews, errors, starts, ends, local, before, pose, lane,
    get lease() {return lease;}, get visual() {return visual;}, get editEpoch() {return editEpoch;},
    stale() {owner = 'two';}, rejectSubject() {eligible = false;}, records: () => history.getHistory().lanes[lane]?.undoStack ?? []};
}

test('one begin, many real reducer previews and one history commit preserve camera scale and plan orientation', async () => {
  const f = await fixture(); assert.equal(f.session.start('camera-a'), true);
  assert.equal(f.session.start('camera-a'), true); assert.equal(f.starts.length, 1);
  for (let index = 0; index < 4; index++) assert.equal(f.session.applyCamera(f.pose(.4), {kind: 'navigation', reason: 'fly'}), true);
  assert.equal(f.records().length, 0); assert.equal(f.history.getActiveTransaction().label, 'director.editCamera');
  const camera = f.session.active.camera; camera.rotation = {x: -.3, y: 1.4, z: .2, order: 'YXZ'};
  assert.equal(f.session.applyCamera(camera), true);
  assert.deepEqual(f.local().transform.scale, {x: 2, y: 3, z: 4});
  assert(f.coordinates.sameRotation(f.coordinates.planRotationToCamera(f.local().transform.rotation), f.local().camera.rotation));
  assert.equal(Object.hasOwn(f.local().camera, 'lookAt'), false); assert.equal(f.phases.at(-1).clearLookAt, true);
  assert.equal(f.session.finish('escape'), true); assert.equal(f.session.active, null); assert.equal(f.lease, false);
  assert.deepEqual(f.phases.map(event => event.phase), ['begin', 'preview', 'preview', 'preview', 'preview', 'preview', 'commit']);
  assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null);
  const after = f.history.getState(); assert.deepEqual(f.history.undo(f.lane), {ok: true}); assert.deepEqual(f.history.getState(), f.before);
  assert.deepEqual(f.history.redo(f.lane), {ok: true}); assert.deepEqual(f.history.getState(), after);
});

test('cancel sends exact sparse domain baseline and restores the complete state with no history', async () => {
  const f = await fixture(), original = structuredClone(f.local()); f.session.start('camera-a');
  assert.equal(Object.hasOwn(f.session.active.camera, 'focalLength'), true); assert.equal(Object.hasOwn(original.camera, 'focalLength'), false);
  f.session.applyCamera(f.pose()); f.session.patchOptics({focalLength: 85, apertureFNumber: 2});
  assert.equal(f.session.cancel('restore'), true);
  assert.deepEqual(f.phases.at(-1).camera, original.camera); assert.deepEqual(f.phases.at(-1).transform, original.transform);
  assert.deepEqual(f.history.getState(), f.before); assert.equal(f.records().length, 0); assert.equal(f.history.getActiveTransaction(), null);
  assert.deepEqual(f.ends, [{entityId: 'camera-a', reason: 'restore', cancelled: true}]);
});

test('no input and quaternion-equivalent/sub-threshold input cancel empty transactions without writing normalized defaults', async () => {
  for (const kind of ['none', 'equivalent', 'small']) {
    const f = await fixture(); f.session.start('camera-a'); const camera = f.session.active.camera;
    if (kind === 'equivalent') {
      const rotation = new f.THREE.Euler().setFromQuaternion(new f.THREE.Quaternion().setFromEuler(new f.THREE.Euler(camera.rotation.x, camera.rotation.y, camera.rotation.z, camera.rotation.order)), 'XYZ');
      camera.rotation = {x: rotation.x, y: rotation.y, z: rotation.z, order: 'XYZ'};
      assert.equal(f.session.applyCamera(camera), true);
    } else if (kind === 'small') {camera.position.x += .00001; camera.fov += .00001; assert.equal(f.session.applyCamera(camera), true);}
    assert.equal(f.session.active.dirty, false, kind); assert.equal(f.session.finish(), true);
    assert.deepEqual(f.phases.map(event => event.phase), ['begin', 'cancel']); assert.equal(f.ends.at(-1).cancelled, false);
    assert.deepEqual(f.history.getState(), f.before); assert.equal(f.records().length, 0); assert.equal(f.history.getActiveTransaction(), null);
  }
});

test('optics-only edits normalize focal/FOV, retain lookAt and keep original transform unchanged', async () => {
  const f = await fixture(), original = structuredClone(f.local()); f.session.start('camera-a');
  assert.equal(f.session.patchOptics({focalLength: 900, frameAspectRatio: 9 / 16, focusDistance: .01}), true);
  assert.equal(f.local().camera.focalLength, 400); assert.equal(f.local().camera.focusDistance, .1);
  assert.deepEqual(f.local().camera.lookAt, original.camera.lookAt); assert.deepEqual(f.local().transform, original.transform);
  assert.equal(f.phases.at(-1).kind, 'optics'); assert.equal(Object.hasOwn(f.phases.at(-1), 'clearLookAt'), false); f.schema.assertCamera(f.local().camera);
  assert.equal(f.session.patchOptics({fov: 30}), true); assert(Math.abs(f.local().camera.fov - 30) < 1e-10);
  assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1);
});

test('invalid optics/camera snapshots fail before domain preview and remain recoverable', async () => {
  for (const operation of ['bad-focus', 'null-lookAt', 'wrong-kind', 'undefined', 'position-optics']) {
    const f = await fixture(); f.session.start('camera-a'); const previous = f.session.active;
    const result = operation === 'bad-focus' ? f.session.patchOptics({focus: {mode: 'nonsense'}}) : operation === 'position-optics' ? f.session.patchOptics({position: {x: 2, y: 3, z: 4}}) :
      f.session.applyCamera({...previous.camera, ...(operation === 'null-lookAt' ? {lookAt: null} : operation === 'undefined' ? {focus: undefined} : {kind: 'camera-optics'})});
    assert.equal(result, false); assert.deepEqual(f.session.active.camera, previous.camera); assert.deepEqual(f.history.getState(), f.before);
    assert.equal(f.phases.length, 1); assert.equal(f.errors.length, 1); assert.equal(f.session.active.failed, true); assert.equal(f.session.cancel(), true);
  }
});

test('begin and preview require literal true; rejected begin acquires no viewport lease or opponent cleanup', async () => {
  for (const response of [false, undefined, {ok: true}, Promise.resolve(true)]) {
    const f = await fixture({onEdit: () => response}); assert.equal(f.session.start('camera-a'), false);
    assert.equal(f.session.active, null); assert.equal(f.starts.length, 0); assert.equal(f.ends.length, 0); assert.equal(f.lease, false);
  }
});

test('failed authoring preview restores accepted optical preview, keeps session/history and can retry', async () => {
  let reject = true;
  const f = await fixture({onEdit: event => event.phase === 'preview' && reject ? false : 'default'}); f.session.start('camera-a');
  const accepted = f.session.active.camera; assert.equal(f.session.applyCamera(f.pose()), false);
  assert.deepEqual(f.session.active.camera, accepted); assert.deepEqual(f.visual, accepted); assert.deepEqual(f.history.getState(), f.before);
  assert.equal(f.session.active.failed, true); assert.equal(f.lease, true); assert(f.history.getActiveTransaction());
  reject = false; assert.equal(f.session.applyCamera(f.pose()), true); assert.equal(f.session.active.failed, false);
  assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1);
});

test('renderer preview exception does not author wrong current camera and cancel restores domain', async () => {
  let fail = true;
  const f = await fixture({onPreview: event => {if (fail && event.reason !== 'preview-failed') throw new Error('temporary camera failed');}});
  f.session.start('camera-a'); const accepted = f.session.active.camera;
  assert.equal(f.session.applyCamera(f.pose()), false); assert.deepEqual(f.session.active.camera, accepted);
  assert.deepEqual(f.history.getState(), f.before); assert.deepEqual(f.phases.map(event => event.phase), ['begin']);
  fail = false; assert.equal(f.session.cancel(), true); assert.equal(f.lease, false);
});

test('failed finish does not exit or switch camera; retry commits once', async () => {
  let reject = true;
  const f = await fixture({onEdit: event => event.phase === 'commit' && reject ? false : 'default'}); f.session.start('camera-a'); f.session.applyCamera(f.pose());
  assert.equal(f.session.finish(), false); assert.equal(f.session.active.entityId, 'camera-a'); assert.equal(f.lease, true); assert.equal(f.ends.length, 0);
  assert.equal(f.session.start('camera-b'), false); assert.equal(f.session.active.entityId, 'camera-a'); assert.equal(f.starts.length, 1);
  reject = false; assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null);
});

test('switch finishes old owner before new fence/lease, and stale refresh cancels exact old baseline', async () => {
  const f = await fixture(); f.session.start('camera-a');
  assert.equal(f.session.start('camera-b'), true); assert.equal(f.session.active.entityId, 'camera-b');
  assert.deepEqual(f.phases.map(event => `${event.entityId}:${event.phase}`), ['camera-a:begin', 'camera-a:cancel', 'camera-b:begin']);
  assert.equal(f.ends[0].reason, 'switch-camera'); assert.equal(f.ends[0].cancelled, false); assert.equal(f.lease, true);
  f.session.applyCamera(f.pose()); f.stale(); assert.equal(f.session.refresh(), false);
  assert.equal(f.session.active, null); assert.equal(f.phases.at(-1).entityId, 'camera-b'); assert.equal(f.phases.at(-1).reason, 'stale');
  assert.deepEqual(f.history.getState(), f.before); assert.equal(f.history.getActiveTransaction(), null); assert.equal(f.lease, false);
});

test('ineligible subjects cancel while own preview epochs and object fence copies keep the owner', async () => {
  const f = await fixture(); f.session.start('camera-a'); f.session.applyCamera(f.pose());
  assert.equal(f.editEpoch, 1); assert.equal(f.session.refresh(), true); assert.equal(f.session.active.entityId, 'camera-a');
  const snapshot = f.session.active; snapshot.camera.position.x = 999; snapshot.transform.scale.x = 999; snapshot.fence.owner = 'wrong';
  assert.notEqual(f.session.active.camera.position.x, 999); assert.equal(f.session.refresh(), true);
  f.rejectSubject(); assert.equal(f.session.refresh(), false); assert.deepEqual(f.history.getState(), f.before);
});

test('start/end errors and dispose reentrancy clean once, without leaving a transaction or lease', async () => {
  for (const phase of ['start-error', 'end-error', 'dispose-begin', 'dispose-preview', 'dispose-start']) {
    const f = await fixture({
      onEdit: (event, {session}) => {if (event.phase === 'begin' && phase === 'dispose-begin' || event.phase === 'preview' && phase === 'dispose-preview') session.dispose(); return 'default';},
      onStart: (event, session) => {if (phase === 'start-error') throw new Error('start failed'); if (phase === 'dispose-start') session.dispose();},
      onEnd: () => {if (phase === 'end-error') throw new Error('end failed');}
    });
    const started = f.session.start('camera-a');
    if (phase === 'end-error') {assert.equal(started, true); assert.equal(f.session.cancel(), true);}
    else if (phase === 'dispose-preview') {assert.equal(started, true); assert.equal(f.session.applyCamera(f.pose()), false);}
    else assert.equal(started, false);
    assert.equal(f.session.active, null, phase); assert.equal(f.history.getActiveTransaction(), null, phase); assert.equal(f.lease, false, phase);
    assert.equal(f.ends.length, phase === 'dispose-begin' ? 0 : 1); assert.deepEqual(f.history.getState(), f.before);
    f.session.dispose(); assert.equal(f.session.start('camera-a'), false);
  }
});

test('callbacks cannot recursively preview, commit, cancel or acquire a second owner', async () => {
  const recursive = [];
  const f = await fixture({onEdit: (event, {session}) => {
    recursive.push(session.start('camera-b'), session.cancel('nested'), session.finish('nested'));
    if (event.phase === 'preview') recursive.push(session.applyCamera(event.camera)); return 'default';
  }});
  assert.equal(f.session.start('camera-a'), true); assert.equal(f.session.applyCamera(f.pose()), true); assert.equal(f.session.finish(), true);
  assert(recursive.every(value => value === false)); assert.equal(f.records().length, 1); assert.equal(f.ends.length, 1); assert.equal(f.history.getActiveTransaction(), null);
});

test('capture checkpoint commits accepted camera and leaves possession/lease alive with history idle', async () => {
  const f = await fixture(); f.session.start('camera-a'); f.session.applyCamera(f.pose());
  const captured = structuredClone(f.local()); assert.equal(f.session.checkpoint(), true);
  assert.equal(f.session.active.transactionOpen, false); assert.equal(f.session.active.dirty, false);
  assert.equal(f.lease, true); assert.equal(f.ends.length, 0); assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null);
  assert.equal(f.session.checkpoint('capture-again'), true); assert.deepEqual(f.phases.map(event => event.phase), ['begin', 'preview', 'commit']);
  // The production save boundary can now flush the accepted domain snapshot.
  const persisted = f.history.getState(); assert.deepEqual(persisted.scenePlay.worldSpace.setups.find(setup => setup.id === 'setup:state-1').entityStates.find(value => value.entityId === 'camera-a'), captured);
  assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1); assert.equal(f.phases.length, 3); assert.equal(f.ends.length, 1);
});

test('empty capture checkpoint cancels only empty transaction; next real preview lazily begins one new history step', async () => {
  const f = await fixture(); f.session.start('camera-a'); assert.equal(f.session.checkpoint('photo'), true);
  assert.deepEqual(f.history.getState(), f.before); assert.equal(f.records().length, 0); assert.equal(f.session.active.transactionOpen, false);
  assert.equal(f.session.applyCamera(f.session.active.camera), true); assert.deepEqual(f.phases.map(event => event.phase), ['begin', 'cancel']);
  f.session.applyCamera(f.pose()); f.session.applyCamera(f.pose());
  assert.equal(f.session.active.transactionOpen, true); assert.equal(f.session.finish(), true); assert.equal(f.records().length, 1);
  assert.deepEqual(f.phases.map(event => event.phase), ['begin', 'cancel', 'begin', 'preview', 'preview', 'commit']);
});

test('after capture next authoring transaction cancels exactly back to checkpoint and retains captured history', async () => {
  const f = await fixture(); f.session.start('camera-a'); f.session.patchOptics({focalLength: 85}); assert.equal(f.session.checkpoint(), true);
  const captured = f.history.getState(), accepted = f.session.active.camera; f.session.applyCamera(f.pose()); f.session.patchOptics({focalLength: 35});
  assert.equal(f.session.cancel('restore-after-photo'), true); assert.deepEqual(f.history.getState(), captured);
  assert.deepEqual(f.phases.at(-1).camera, accepted); assert.equal(f.records().length, 1); assert.equal(f.history.getActiveTransaction(), null);
});

test('failed changed or empty checkpoint keeps transaction/baseline and permits retry or exact cancel', async () => {
  for (const dirty of [false, true]) {
    let reject = true;
    const f = await fixture({onEdit: event => event.reason === 'capture' && reject ? false : 'default'}); f.session.start('camera-a');
    if (dirty) f.session.applyCamera(f.pose()); const accepted = f.session.active;
    assert.equal(f.session.checkpoint(), false); assert.equal(f.session.active.transactionOpen, true); assert.equal(f.session.active.failed, true);
    assert.deepEqual(f.session.active.camera, accepted.camera); assert.equal(f.session.active.dirty, dirty); assert.equal(f.ends.length, 0); assert.equal(f.lease, true);
    reject = false; assert.equal(f.session.checkpoint(), true); assert.equal(f.session.active.transactionOpen, false); assert.equal(f.records().length, dirty ? 1 : 0);
    assert.equal(f.session.cancel(), true); assert.equal(f.history.getActiveTransaction(), null); assert.equal(f.records().length, dirty ? 1 : 0);
  }
  const f = await fixture({onEdit: event => event.reason === 'capture' ? false : 'default'}); f.session.start('camera-a'); f.session.applyCamera(f.pose());
  assert.equal(f.session.checkpoint(), false); assert.equal(f.session.cancel('restore'), true); assert.deepEqual(f.history.getState(), f.before);
});

test('closed checkpoint owner exit/stale/dispose cannot cancel a later unrelated history transaction', async () => {
  for (const reason of ['finish', 'cancel', 'stale', 'dispose']) {
    const f = await fixture(); f.session.start('camera-a'); f.session.checkpoint();
    assert.equal(f.history.getActiveTransaction(), null);
    assert.equal(f.history.begin('world', 'external flush owner'), true);
    f.history.preview(state => f.world.patchEntity(state, 'camera-b', {label: 'External write'}, 3));
    const external = f.history.getState(), phaseCount = f.phases.length;
    if (reason === 'stale') {f.stale(); assert.equal(f.session.refresh(), false);}
    else assert.equal(f.session[reason](), true);
    assert.equal(f.session.active, null); assert.equal(f.lease, false); assert.equal(f.phases.length, phaseCount);
    assert.equal(f.history.getActiveTransaction().label, 'external flush owner'); assert.deepEqual(f.history.getState(), external);
    f.history.cancel();
  }
});

test('reopening after checkpoint refuses another owner history without changing accepted pose', async () => {
  const f = await fixture(); f.session.start('camera-a'); f.session.checkpoint(); const accepted = f.session.active.camera;
  f.history.begin('world', 'other edit'); const external = f.history.getState();
  assert.equal(f.session.applyCamera(f.pose()), false); assert.equal(f.session.active.transactionOpen, false);
  assert.deepEqual(f.session.active.camera, accepted); assert.deepEqual(f.visual, accepted); assert.deepEqual(f.history.getState(), external);
  assert.equal(f.history.getActiveTransaction().label, 'other edit'); assert.equal(f.session.cancel(), true);
  assert.equal(f.history.getActiveTransaction().label, 'other edit'); f.history.cancel();
});

test('real StudioSession flush persists captured camera while possession remains active without a transaction', async () => {
  const seed = await fixture(), {createStudioSession} = await import('../src/features/studio-v3/session.mjs');
  const source = {id: 'source', worldResource: {url: '/scene.glb', format: 'glb'}};
  const target = {id: 'camera-owner', studioV3: {version: 3, state: seed.before, revision: 0,
    sourceBinding: {sourceNodeId: source.id, sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  let guard, saved = null, serial = 0;
  const app = {getState: () => ({nodes: [target, source]}), projectIdentity: () => ({id: 'capture-project'}),
    registerNodeWriteGuard(id, callback) {guard = callback; return () => {guard = null;};}};
  const domain = createStudioSession({nodeId: target.id, app, store: {flush: async () => {}}, autosaveMs: null,
    getSourceSnapshot: node => node.worldResource, historyOptions: {createId: () => `persisted-camera:${++serial}`, now: () => 2},
    publishNode: async (id, patch, {beforeCommit}) => {
      assert.equal(beforeCommit(), true); const candidate = {...target, studioV3: structuredClone(patch.studioV3)};
      assert.equal(guard(candidate), true); saved = structuredClone(candidate); target.studioV3 = structuredClone(patch.studioV3);
    }});
  const f = await fixture({history: domain.history});
  try {
    domain.change(state => f.world.patchEntity(state, 'camera-b', {label: 'Prepared capture'}, 3));
    assert.equal(f.session.start('camera-a'), true); f.session.applyCamera(f.pose());
    assert.deepEqual(await domain.flush(), {ok: false, reason: 'transaction-active'}); assert.equal(saved, null);
    assert.equal(f.session.checkpoint(), true); const captured = domain.getState();
    assert.deepEqual(await domain.flush(), {ok: true}); assert.deepEqual(saved.studioV3.state, captured);
    assert.equal(domain.history.getActiveTransaction(), null); assert.equal(f.session.active.transactionOpen, false); assert.equal(f.lease, true);
    assert.equal(f.session.refresh(), true); assert.equal(f.session.finish(), true); assert.equal(f.ends.length, 1);
  } finally {f.session.dispose(); await domain.closeGuard(); seed.session.dispose();}
});
