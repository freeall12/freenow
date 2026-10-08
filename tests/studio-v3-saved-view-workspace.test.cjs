const {test} = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all(['schema', 'world-space', 'session', 'saved-view-workspace'].map(name => import(`../src/features/studio-v3/${name}.mjs`)));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const turn = () => new Promise(resolve => setImmediate(resolve));
const camera = x => ({position: {x, y: 2, z: 8}, rotation: {x: .1, y: .2, z: 0, order: 'YXZ'}, fov: 42, frameAspectRatio: 2,
  focalLength: 46, focus: {mode: 'none'}, lookAt: {mode: 'none'}, focusDistance: 10, depthOfFieldMode: 'deepFocus', apertureFNumber: 2.8});

async function fixture({readonly = false, baseline = false, beforeWrite, waitForSync, prepareNavigation, onSelect} = {}) {
  const [schema, world, {createStudioSession}, {createSavedViewWorkspace}] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 1});
  state = world.addEntity(state, schema.createEntity({id: 'camera-entity', kind: 'camera', label: 'Author camera', now: 1}),
    {setupState: {...schema.createSetupState('camera-entity', 1), camera: camera(99)}});
  state = world.addSetup(state, schema.createIndependentSetup({id: 'setup-second', label: 'Second', now: 1}));
  state = world.addStage(state, schema.createStage({worldNodeId: 'owner', id: 'stage-second', label: 'Other stage', now: 1}));
  state = world.addView(state, schema.createView({id: 'view-second', stageId: 'stage-second', setupId: 'setup:stage-second:state-1', label: 'Other view', camera: camera(20), now: 1}));
  state = world.setActiveSetup(state, baseline ? 'setup-default' : 'setup:state-1');
  const source = {id: 'source', worldResource: {url: '/scene.glb', format: 'glb'}},
    target = {id: 'owner', studioV3: {version: 3, state, revision: 0, sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  let guard, current = true, flags = {readonly}, sourceKey = source.worldResource, failures = 0, publishGate = null, navGate = null,
    snapshot = camera(3), host, idCounter = 0, runtime;
  const writes = [], navigations = [], events = [], lanes = [];
  const app = {getState: () => ({nodes: [source, target]}), projectIdentity: () => ({id: 'project'}),
    registerNodeWriteGuard(id, callback) {guard = callback; return () => {guard = null;};}};
  const publishNode = async (id, patch, {beforeCommit}) => {
    events.push('publish'); writes.push(structuredClone(patch.studioV3));
    const gate = publishGate; publishGate = null; if (gate) await gate.promise;
    if (failures) {failures--; throw Error('disk unavailable');}
    assert.equal(beforeCommit(), true);
    const candidate = {...target, studioV3: structuredClone(patch.studioV3)}; assert.equal(guard(candidate), true);
    target.studioV3 = candidate.studioV3;
  };
  const config = {nodeId: 'owner', app, publishNode, store: {flush: async () => {events.push('flush');}}, autosaveMs: null, readonly,
    getSourceSnapshot: node => node.worldResource, sessionToken: 'saved-view-test'};
  const session = createStudioSession(config);
  runtime = {graph: {source: {}}, getNavigationCameraState: () => snapshot,
    async restoreNavigationCamera(value, options) {
      navigations.push({camera: structuredClone(value), options, state: session.getState()}); events.push('navigate');
      const gate = navGate; navGate = null; if (gate) await gate.promise;
      return options.isCurrent();
    }};
  const createHost = extra => createSavedViewWorkspace({getState: session.getState, session, getRuntime: () => runtime, isCurrent: () => current,
    getSourceKey: () => sourceKey, getBusy: () => flags, beforeWrite: beforeWrite ?? (() => ({ok: true})),
    waitForSync: waitForSync ?? (() => {events.push('sync');}), prepareNavigation: prepareNavigation ?? (() => {events.push('orbit');}),
    onSelect: onSelect ?? (id => {events.push(`entity:${id}`); return true;}), onLane: lane => {lanes.push(lane);}, createId: () => `view-new-${++idCounter}`, now: () => 10, ...extra});
  host = createHost();
  return {host, session, schema, world, source, target, config, createStudioSession, createHost, events, navigations, writes, lanes,
    get runtime() {return runtime;}, replaceRuntime: () => {runtime = {...runtime, graph: {source: {}}};}, setSnapshot: value => {snapshot = value;},
    setFlags: value => {flags = {...flags, ...value};}, setSourceKey: value => {sourceKey = value;}, expire: () => {current = false;},
    fail: () => {failures++;}, holdPublish: () => (publishGate = deferred()), holdNavigation: () => (navGate = deferred()),
    get state() {return session.getState();}, records: lane => session.history.getHistory().lanes[lane]?.undoStack ?? [],
    async close() {host.dispose(); current = true; if (session.isCurrent()) await session.closeGuard();}};
}

test('real current orbit creates one durable capture View, can reopen and undo/redo on its setup lane', async () => {
  const f = await fixture(), before = f.state, setupId = before.scenePlay.worldSpace.activeSetupId;
  assert.equal(f.host.read().canSave, true); assert.equal(f.host.read().busy, false);
  const result = await f.host.saveCurrent({label: ' My view ', notes: 'Framing', tags: ['capture']});
  assert.equal(result.ok, true); assert.equal(result.saved, true); assert.equal(result.applied, true); assert.equal(result.viewId, 'view-new-1');
  const item = f.host.read().items.find(view => view.id === result.viewId);
  assert.deepEqual(item.camera, camera(3)); assert.equal(item.label, 'My view'); assert.equal(item.isActive, true); assert.equal(item.setupId, setupId);
  assert.equal(f.session.getStatus().dirty, false); assert.equal(f.state.capturedPhotos.length, before.capturedPhotos.length);
  assert.deepEqual(f.state.scenePlay.worldSpace.entities, before.scenePlay.worldSpace.entities);
  assert.deepEqual(f.state.scenePlay.worldSpace.setups, before.scenePlay.worldSpace.setups); assert.equal(f.records(`setup:${setupId}`).length, 1);
  assert.equal(f.session.history.undo(`setup:${setupId}`).ok, true); assert.deepEqual(f.state, before);
  assert.equal(f.session.history.redo(`setup:${setupId}`).ok, true); await f.session.flush();
  await f.close(); const reopened = f.createStudioSession(f.config); assert.equal(reopened.getState().scenePlay.worldSpace.views.some(view => view.id === result.viewId), true); await reopened.closeGuard();
});

test('failed save retains same visible ID and receipt; reopening UI and retry flush never duplicates create/history', async () => {
  const f = await fixture(); f.fail(); const result = await f.host.saveCurrent();
  assert.equal(result.ok, false); assert.equal(result.applied, true); assert.equal(result.reason, 'save-failed'); assert.match(result.message, /disk unavailable/);
  assert.equal(f.host.read().items.filter(view => view.id === result.viewId).length, 1); assert.equal(f.host.read().pendingSave.viewId, result.viewId);
  const historyCount = f.records(result.lane ?? `setup:${f.state.scenePlay.worldSpace.activeSetupId}`).length;
  assert.equal((await f.host.saveCurrent()).reason, 'pending-save'); f.host.cancel(); assert.equal(f.host.read().pendingSave.viewId, result.viewId);
  const retry = await f.host.retrySave(); assert.equal(retry.ok, true); assert.equal(retry.changed, false); assert.equal(retry.viewId, result.viewId);
  assert.equal(f.host.read().pendingSave, null); assert.equal(f.host.read().items.filter(view => view.id === result.viewId).length, 1);
  assert.equal(f.records(`setup:${f.state.scenePlay.worldSpace.activeSetupId}`).length, historyCount); assert.deepEqual(f.writes.map(write => write.revision), [1, 1]); await f.close();
});

test('top-level same-source save clears failed receipt; content drift blocks receipt retry before that save', async () => {
  const f = await fixture(); f.fail(); const result = await f.host.saveCurrent();
  f.session.change(state => f.world.patchEntity(state, 'camera-entity', {label: 'Foreign edit'}, 10));
  assert.equal(f.host.read().pendingSave.reason, 'pending-drift'); assert.equal((await f.host.retrySave()).reason, 'pending-drift'); assert.equal(f.writes.length, 1);
  await f.session.flush(); assert.equal(f.host.read().pendingSave, null); assert.equal(f.state.scenePlay.worldSpace.views.some(view => view.id === result.viewId), true); await f.close();
});

test('single request is visibly busy and late canceled preparation cannot create a View', async () => {
  const gate = deferred(), f = await fixture({beforeWrite: () => gate.promise}), before = f.state;
  const saving = f.host.saveCurrent(); assert.equal(f.host.busy, true); assert.equal(f.host.read().busy, true); assert.equal(f.host.read().canSave, false);
  assert.equal((await f.host.saveCurrent()).reason, 'busy'); assert.equal(f.host.cancel(), true); gate.resolve({ok: true});
  assert.equal((await saving).reason, 'stale'); assert.deepEqual(f.state, before); assert.equal(f.writes.length, 0); await f.close();
});

test('save revision acknowledgements preserve the lease while editEpoch remains fenced', async () => {
  const f = await fixture(), gate = deferred(); let acknowledged = 0;
  const host = f.createHost({beforeWrite: () => gate.promise, session: {...f.session,
    getFence: () => ({...f.session.getFence(), revision: f.session.getFence().revision + acknowledged})}});
  const saving = host.saveCurrent(); acknowledged++; gate.resolve({ok: true});
  assert.equal((await saving).ok, true); assert.equal(f.state.scenePlay.worldSpace.views.filter(view => view.id === 'view-new-1').length, 1);
  host.dispose(); await f.close();
});

for (const [label, drift] of [
  ['setup', f => f.session.change(state => f.world.setActiveSetup(state, 'setup-second'), {content: false})],
  ['source key', f => f.setSourceKey({url: '/new.glb'})],
  ['runtime', f => f.replaceRuntime()],
  ['edit epoch', f => f.session.change(state => f.world.patchEntity(state, 'camera-entity', {label: 'Later'}, 10))],
  ['foreign transaction', f => f.session.history.begin('world', 'foreign')],
  ['dispose', f => f.host.dispose()]
]) test(`asynchronous preparation is fenced against ${label}`, async () => {
  const gate = deferred(), f = await fixture({beforeWrite: () => gate.promise}), previousViews = f.state.scenePlay.worldSpace.views;
  const saving = f.host.saveCurrent(); drift(f); gate.resolve({ok: true}); assert.equal((await saving).ok, false);
  assert.deepEqual(f.state.scenePlay.worldSpace.views, previousViews); assert.equal(f.writes.length, 0);
  if (f.session.history.getActiveTransaction()) {assert.equal(f.session.history.getActiveTransaction().label, 'foreign'); f.session.history.cancel();}
  await f.close();
});

test('restore crosses stage/setup, saves background selection and waits for sync before guarded orbit navigation', async () => {
  const f = await fixture(), before = f.state;
  const result = await f.host.restore('view-second'); assert.equal(result.ok, true); assert.equal(result.restored, true); assert.equal(result.saved, true);
  const space = f.state.scenePlay.worldSpace; assert.equal(space.activeStageId, 'stage-second'); assert.equal(space.activeSetupId, 'setup:stage-second:state-1');
  assert.equal(space.activeViewId, 'view-second'); assert.deepEqual(space.entities, before.scenePlay.worldSpace.entities); assert.deepEqual(space.setups, before.scenePlay.worldSpace.setups);
  assert.deepEqual(f.state.capturedPhotos, before.capturedPhotos); assert.equal(f.records('world').length, 1); assert.equal(f.session.getStatus().contentDirtySeq, 0);
  assert.deepEqual(f.navigations[0].camera, camera(20)); assert.equal(f.navigations[0].options.duration, .8);
  assert.deepEqual(f.events, ['publish', 'flush', 'sync', 'orbit', 'entity:null', 'navigate']);
  const writes = f.writes.length; const again = await f.host.restore('view-second'); assert.equal(again.ok, true); assert.equal(again.changed, false); assert.equal(again.restored, true);
  assert.equal(f.writes.length, writes); assert.equal(f.navigations.length, 2); assert.equal(f.records('world').length, 1); await f.close();
});

test('sync source/setup drift rejects restore navigation after applied selection without fake complete success', async () => {
  const gate = deferred(), f = await fixture({waitForSync: () => gate.promise}); const restoring = f.host.restore('view-second'); await turn();
  assert.equal(f.state.scenePlay.worldSpace.activeViewId, 'view-second'); f.session.change(state => f.world.setActiveSetup(state, 'setup-second'), {content: false}); gate.resolve();
  const result = await restoring; assert.equal(result.ok, false); assert.equal(result.applied, true); assert.equal(result.reason, 'stale'); assert.equal(f.navigations.length, 0); await f.close();
});

test('failed navigation reports applied persistent selection and disposed late navigation loses its lease', async () => {
  const f = await fixture({prepareNavigation: () => false}); const result = await f.host.restore('view-second');
  assert.equal(result.ok, false); assert.equal(result.applied, true); assert.equal(result.restored, false); assert.equal(result.saved, true); assert.equal(f.navigations.length, 0); await f.close();
  const g = await fixture(), gate = g.holdNavigation(), pending = g.host.restore('view-second'); await turn(); assert.equal(g.navigations.length, 1);
  g.host.dispose(); assert.equal(g.navigations[0].options.isCurrent(), false); gate.resolve(); const late = await pending;
  assert.equal(late.ok, false); assert.equal(late.applied, true); assert.equal(late.reason, 'stale'); await g.close();
});

test('a late foreign transaction stops navigation without canceling the foreign owner', async () => {
  const f = await fixture(), gate = f.holdNavigation(), restoring = f.host.restore('view-second'); await turn();
  assert.equal(f.navigations.length, 1); f.session.history.begin('world', 'foreign');
  assert.equal(f.navigations[0].options.isCurrent(), false); gate.resolve(); assert.equal((await restoring).ok, false);
  assert.equal(f.session.history.getActiveTransaction().label, 'foreign'); assert.equal(f.host.cancel(), false);
  f.session.history.cancel(); await f.close();
});

test('observers cannot interrupt the required flush after a content change', async () => {
  const f = await fixture(), host = f.createHost({onLane: () => {throw Error('observer');}, onChange: () => {throw Error('render');}});
  assert.equal((await host.saveCurrent()).ok, true); assert.equal(f.session.getStatus().dirty, false); assert.equal(f.writes.length, 1);
  host.dispose(); await f.close();
});

test('failed restore selection save retains retry receipt and retries only saving, without implicit camera movement', async () => {
  const f = await fixture(); f.fail(); const result = await f.host.restore('view-second'); assert.equal(result.ok, false); assert.equal(result.applied, true);
  assert.equal(f.state.scenePlay.worldSpace.activeViewId, 'view-second'); assert.equal(f.host.read().pendingSave.action.type, 'set-active'); assert.equal(f.navigations.length, 0);
  assert.equal((await f.host.retrySave()).ok, true); assert.equal(f.navigations.length, 0); assert.equal(f.records('world').length, 1);
  assert.equal((await f.host.restore('view-second')).restored, true); await f.close();
});

test('rename/update/remove use target setup lane and never author camera entities, temporals or photographs', async () => {
  const f = await fixture(); const created = await f.host.saveCurrent(); const before = f.state;
  assert.equal((await f.host.rename(created.viewId, 'Renamed')).ok, true); f.setSnapshot(camera(7)); assert.equal((await f.host.update(created.viewId)).ok, true);
  assert.deepEqual(f.host.read().items.find(view => view.id === created.viewId).camera, camera(7)); assert.equal((await f.host.remove(created.viewId)).ok, true);
  assert.equal(f.state.scenePlay.worldSpace.activeViewId, null); assert.deepEqual(f.state.scenePlay.worldSpace.entities, before.scenePlay.worldSpace.entities);
  assert.deepEqual(f.state.scenePlay.worldSpace.setups, before.scenePlay.worldSpace.setups); assert.deepEqual(f.state.capturedPhotos, before.capturedPhotos);
  assert.deepEqual(f.lanes, Array(4).fill(`setup:${before.scenePlay.worldSpace.activeSetupId}`)); await f.close();
});

test('readonly, playing, scrubbing, transaction, baseline and non-orbit capture are explicitly refused', async () => {
  const f = await fixture({readonly: true}); assert.equal(f.host.read().canSave, false); assert.equal((await f.host.restore('view-second')).reason, 'readonly'); assert.equal((await f.host.select(null)).reason, 'readonly'); await f.close();
  const g = await fixture(); for (const flag of ['playing', 'scrubbing', 'busy']) {g.setFlags({[flag]: true}); assert.equal((await g.host.saveCurrent()).reason, flag); assert.equal((await g.host.restore('view-second')).reason, flag); g.setFlags({[flag]: false});}
  g.session.history.begin('world', 'foreign'); assert.equal((await g.host.rename('view-second', 'Other')).reason, 'transaction-active'); g.session.history.cancel();
  g.setSnapshot(null); assert.equal(g.host.read().canSave, false); assert.equal((await g.host.saveCurrent()).reason, 'navigation-unavailable');
  assert.equal((await g.host.saveCurrent({camera: camera(100)})).reason, 'invalid-options'); await g.close();
  const h = await fixture({baseline: true}); assert.equal((await h.host.saveCurrent()).reason, 'baseline-readonly'); assert.equal(h.host.read().canSave, false); await h.close();
});

test('foreign source ownership during save retains unapplied acknowledgement and rejects retry', async () => {
  const f = await fixture(), gate = f.holdPublish(), saving = f.host.saveCurrent(); await turn(); f.source.worldResource.url = '/external.glb'; gate.resolve();
  const result = await saving; assert.equal(result.ok, false); assert.equal(result.applied, true); assert.equal(result.reason, 'stale'); assert.equal(f.session.getStatus().dirty, true);
  assert.equal(f.host.read().pendingSave.reason, 'stale'); assert.equal((await f.host.retrySave()).reason, 'stale'); assert.equal(f.writes.length, 1); f.host.dispose();
});
