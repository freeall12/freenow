const test = require('node:test'), assert = require('node:assert/strict');
const {placeOutputs} = require('../canvas-geometry.js');
const modules = Promise.all([import('../src/features/studio-v3/camera-batch-publish.mjs'),
  import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs')]);
const defer = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const until = async predicate => {for (let i = 0; i < 30 && !predicate(); i++) await new Promise(done => setImmediate(done)); assert(predicate());};
const image = title => ({type: 'image', blob: new Blob(['jpeg'], {type: 'image/jpeg'}), width: 4096, height: 2304, title});
const video = () => ({type: 'video', blob: new Blob(['webm'], {type: 'video/webm'}), posterBlob: new Blob(['poster'], {type: 'image/jpeg'}),
  width: 1280, height: 720, duration: 2.5, provenance: {cameraEntityId: 'camera'}});

async function fixture({readonly = false, touchProjectDuringWrites = false, identityAsString = false} = {}) {
  const [{createCameraBatchPublish}, {createStudioSession}, schema, world] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 1});
  state = world.addEntity(state, schema.createEntity({id: 'camera', kind: 'camera', label: 'Camera', now: 1}));
  const source = {id: 'source', worldResource: {url: '/local.glb', format: 'glb'}};
  const owner = {id: 'owner', type: 'studio', x: 0, y: 0, width: 375, height: 250,
    studioV3: {version: 3, state, revision: 0, sourceBinding: {sourceNodeId: source.id, sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  const nodes = [owner, source], events = [], calls = {renders: [], puts: [], adds: 0, saves: 0};
  let project = 'project', updatedAt = 1, current = true, failPut = 0, saveFailure = false, addFailure = false, durable, gate, observedSignal, observer;
  let render = shot => [image(shot.title)];
  const app = {getState: () => ({nodes}), projectIdentity: () => identityAsString ? project : ({id: project, updatedAt}), registerNodeWriteGuard: () => () => {},
    createConnected(id, outputs) {
      calls.adds++; const added = placeOutputs(owner, outputs, nodes).map((item, index) => ({...item, id: `media:${calls.adds}:${index}`, sourceId: id}));
      nodes.push(...added); if (touchProjectDuringWrites) updatedAt++;
      if (addFailure) {addFailure = false; throw Error('rebuild failed after add');} return added;
    }, async saveProject({beforeCommit}) {
      calls.saves++; assert.equal(beforeCommit(), true);
      if (touchProjectDuringWrites) updatedAt++;
      if (gate?.stage === 'save') {const pending = gate; gate = null; await pending.promise;}
      if (saveFailure) {saveFailure = false; throw Error('disk unavailable');}
      if (!beforeCommit()) throw Error('save fence rejected'); durable = structuredClone(nodes);
    }};
  const session = createStudioSession({nodeId: owner.id, app, readonly, autosaveMs: null, store: {flush: async () => {}},
    getSourceSnapshot: node => node.worldResource,
    publishNode: async (id, patch, {beforeCommit}) => {assert.equal(beforeCommit(), true); owner.studioV3 = structuredClone(patch.studioV3);}});
  const wrappedSession = {...session, async flush() {
    if (gate?.stage === 'flush') {const pending = gate; gate = null; await pending.promise;}
    return session.flush();
  }};
  const exporter = createCameraBatchPublish({app, session: wrappedSession, nodeId: owner.id, createId: () => 'batch', now: () => 10,
    isCurrent: () => current && session.isCurrent(),
    renderer: {async render(shot, {state, signal}) {
      calls.renders.push(shot.id); observedSignal = signal;
      if (gate?.stage === 'render') {const pending = gate; gate = null; await pending.promise;}
      return render(shot, state, signal);
    }}, assets: {async put(blob) {
      assert(blob instanceof Blob); calls.puts.push(blob);
      if (touchProjectDuringWrites) updatedAt++;
      if (gate?.stage === 'asset') {const pending = gate; gate = null; await pending.promise;}
      if (calls.puts.length === failPut) throw Error('asset unavailable');
      return `asset:${calls.puts.length}`;
    }}, onStatus(status) {events.push(status); observer?.(status);}});
  const space = session.getState().scenePlay.worldSpace;
  const shots = ['s1', 's2'].map(id => ({id, title: id, stageId: space.activeStageId, setupId: space.activeSetupId}));
  return {exporter, session, shots, owner, source, nodes, calls, events, world,
    rendered: fn => {render = fn;}, failPut: n => {failPut = n;}, failSave: () => {saveFailure = true;}, failAdd: () => {addFailure = true;},
    hold: stage => {gate = {...defer(), stage}; return gate;}, signal: () => observedSignal,
    project: () => {project = 'other';}, stale: () => {current = false;}, durable: () => durable, observe: fn => {observer = fn;}};
}

test('project identity ignores normal updatedAt changes during asset/add/save but rejects real project ID changes', async () => {
  for (const identityAsString of [false, true]) {
    const f = await fixture({touchProjectDuringWrites: true, identityAsString});
    const result = await f.exporter.export(f.shots);
    assert.equal(result.ok, true); assert.equal(result.nodeIds.length, 2); assert.deepEqual(f.durable(), f.nodes);
    assert.equal(f.calls.adds, 1); assert.equal(f.calls.saves, 1); assert.equal(f.exporter.pendingReceipt, null);
  }
  for (const stage of ['asset', 'save']) {
    const f = await fixture({touchProjectDuringWrites: true}), gate = f.hold(stage), pending = f.exporter.export(f.shots);
    await until(() => stage === 'asset' ? f.calls.puts.length : f.calls.saves);
    f.project(); gate.resolve();
    await assert.rejects(pending, error => error.code === 'studio_v3_batch_stale' || error.message === 'save fence rejected');
    assert.equal(f.durable(), undefined); assert.equal(f.events.some(event => event.status === 'saved'), false);
    assert.equal(f.calls.adds, stage === 'save' ? 1 : 0);
  }
});

test('serial batch retains actual image/video/poster blobs, publishes one group and reports partial shot failures', async () => {
  const f = await fixture(), picture = {...image('contact sheet'), duration: 2.5}, movie = video();
  f.rendered(shot => {if (shot.id === 's2') throw Error('camera missing'); return [picture, movie];});
  const result = await f.exporter.export(f.shots);
  assert.equal(result.ok, true); assert.deepEqual([result.successCount, result.errorCount, result.itemCount], [1, 1, 2]);
  assert.deepEqual(result.errors, [{shotId: 's2', message: 'camera missing'}]);
  assert.deepEqual(f.calls.renders, ['s1', 's2']); assert.deepEqual(f.calls.puts, [picture.blob, movie.blob, movie.posterBlob]);
  assert.equal(f.calls.adds, 1); assert.equal(f.calls.saves, 1); assert.equal(f.exporter.pendingReceipt, null);
  const [photo, clip] = f.nodes.slice(2); assert.equal(photo.image, 'asset:1'); assert.equal(photo.duration, 2.5); assert.equal(clip.video, 'asset:2'); assert.equal(clip.image, 'asset:3');
  assert.equal(clip.duration, 2.5); assert.equal(clip.provenance.cameraEntityId, 'camera');
  assert.equal(photo.provenance.batchExportId, 'batch'); assert.notEqual(photo.provenance.itemId, clip.provenance.itemId);
  assert.deepEqual(f.durable(), f.nodes); assert.equal(f.events.filter(event => event.status === 'saved').length, 1);
});

test('asset and poster failures retry the same snapshots without rendering or putting successful assets again', async () => {
  for (const withPoster of [false, true]) {
    const f = await fixture(); if (withPoster) f.rendered(() => [video()]);
    const shots = withPoster ? f.shots.slice(0, 1) : f.shots; f.failPut(2);
    await assert.rejects(f.exporter.export(shots), error => error.pending && !error.applied && error.retryable);
    assert.deepEqual(f.exporter.pendingReceipt, {exportId: 'batch', shotIds: shots.map(shot => shot.id), nodeIds: [], applied: false});
    await assert.rejects(f.exporter.export([{id: 'different'}]), error => error.code === 'studio_v3_batch_pending');
    const result = await f.exporter.export(); assert.equal(result.ok, true);
    assert.equal(f.calls.renders.length, shots.length); assert.equal(f.calls.puts.length, 3); assert.equal(f.calls.adds, 1);
    assert.equal(f.calls.puts[1], f.calls.puts[2]); assert.equal(f.exporter.pendingReceipt, null);
  }
});

test('save and post-add rebuild failures recover uniquely tagged nodes and never recreate the batch', async () => {
  for (const mode of ['failSave', 'failAdd']) {
    const f = await fixture(); f[mode]();
    await assert.rejects(f.exporter.export(f.shots), error => error.applied && error.pending && error.retryable && error.nodeIds.length === 2);
    assert.equal(f.events.some(event => event.status === 'saved'), false);
    const result = await f.exporter.export(f.shots); assert.equal(result.nodeIds.length, 2);
    assert.equal(f.calls.renders.length, 2); assert.equal(f.calls.puts.length, 2); assert.equal(f.calls.adds, 1); assert.equal(f.nodes.length, 4);
    assert.equal(f.calls.saves, mode === 'failSave' ? 2 : 1);
  }
});

test('all failed or invalid renders clear their receipt and throw specific no-results errors', async () => {
  const f = await fixture();
  f.rendered(shot => {if (shot.id === 's1') throw Object.assign(Error('unsupported codec'), {code: 'codec'}); return [{...image('bad'), blob: null}];});
  await assert.rejects(f.exporter.export(f.shots), error => error.code === 'studio_v3_batch_no_results' &&
    error.errors.length === 2 && error.errors[0].code === 'codec' && !error.applied && !error.pending && !error.retryable);
  assert.equal(f.exporter.pendingReceipt, null); assert.equal(f.calls.puts.length, 0); assert.equal(f.calls.adds, 0);
  assert.equal(f.events.filter(event => event.status === 'shot-failed').length, 2);
  assert.equal(f.events.some(event => event.status === 'shot-rendered'), false);
  assert.equal(f.events.find(event => event.status === 'failed').errorCount, 2);
  f.rendered(() => [image('retry')]); assert.equal((await f.exporter.export(f.shots)).ok, true);
});

test('render/asset/save asynchronous boundaries reject source, owner, project, content and setup changes', async () => {
  for (const stage of ['render', 'asset', 'save']) {
    for (const mutation of ['source', 'owner', 'project', 'content', 'setup']) {
      const f = await fixture(), gate = f.hold(stage), pending = f.exporter.export(f.shots);
      await until(() => stage === 'render' ? f.calls.renders.length : stage === 'asset' ? f.calls.puts.length : f.calls.saves);
      if (mutation === 'source') f.source.worldResource.url = '/changed.glb';
      if (mutation === 'owner') f.nodes[0] = structuredClone(f.owner);
      if (mutation === 'project') f.project();
      if (mutation === 'content') f.session.change(state => f.world.patchEntity(state, 'camera', {label: 'Changed'}, 3), {label: 'External camera name'});
      if (mutation === 'setup') f.session.change(state => f.world.setActiveSetup(state, 'setup-default'), {label: 'External setup'});
      gate.resolve(); await assert.rejects(pending, error => error.code === 'studio_v3_batch_stale' || error.message === 'save fence rejected');
      assert.equal(f.exporter.busy, false); assert.equal(f.events.some(event => event.status === 'saved'), false);
      assert.equal(f.durable(), undefined); assert.equal(f.calls.adds, stage === 'save' ? 1 : 0);
    }
  }
});

test('initial flush rejects content changes but accepts the revision from its own successful save', async () => {
  const f = await fixture(); f.session.change(state => f.world.patchEntity(state, 'camera', {label: 'Saved name'}, 2), {label: 'Rename'});
  assert.equal((await f.exporter.export(f.shots)).ok, true); assert.equal(f.owner.studioV3.revision, 1);
  const stale = await fixture(), gate = stale.hold('flush'), pending = stale.exporter.export(stale.shots);
  stale.session.change(state => stale.world.patchEntity(state, 'camera', {label: 'Late name'}, 2), {label: 'Late rename'});
  gate.resolve(); await assert.rejects(pending, error => error.code === 'studio_v3_batch_stale');
  assert.equal(stale.calls.renders.length, 0); assert.equal(stale.exporter.pendingReceipt, null);
});

test('dispose aborts renderer signal and concurrent calls reject without consuming another renderer', async () => {
  const f = await fixture(), gate = f.hold('render'), pending = f.exporter.export(f.shots);
  await until(() => f.calls.renders.length);
  await assert.rejects(f.exporter.export(f.shots), error => error.code === 'studio_v3_batch_busy');
  f.exporter.dispose(); assert.equal(f.signal().aborted, true); gate.resolve();
  await assert.rejects(pending, error => error.code === 'studio_v3_batch_stale' && !error.pending && !error.retryable);
  assert.equal(f.exporter.pendingReceipt, null); assert.equal(f.calls.puts.length, 0); assert.equal(f.calls.adds, 0);
});

test('renderer gets detached JSON snapshots and retained receipts reject edited, deleted or duplicate nodes', async () => {
  const safe = await fixture(), original = safe.session.getState();
  safe.rendered((shot, state) => {state.scenePlay.worldSpace.activeSetupId = 'renderer-mutated'; shot.title = 'renderer title'; return [image('still')];});
  await safe.exporter.export(safe.shots); assert.deepEqual(safe.session.getState(), original); assert.equal(safe.shots[0].title, 's1');
  for (const mutate of [f => f.nodes.pop(), f => {f.nodes.at(-1).image = 'asset:other';}, f => {f.nodes.push(structuredClone(f.nodes.at(-1)));}]) {
    const f = await fixture(); f.failSave(); await assert.rejects(f.exporter.export(f.shots)); mutate(f);
    await assert.rejects(f.exporter.export(), error => error.code === 'studio_v3_batch_receipt_stale'); assert.equal(f.calls.adds, 1);
  }
});

test('status callback mutations are fenced before writes; readonly and active authors render nothing', async () => {
  const f = await fixture(); f.observe(event => {if (event.status === 'saving-asset') f.source.worldResource.url = '/changed.glb';});
  await assert.rejects(f.exporter.export(f.shots), error => error.code === 'studio_v3_batch_stale'); assert.equal(f.calls.puts.length, 0);
  const readonly = await fixture({readonly: true});
  await assert.rejects(readonly.exporter.export(readonly.shots), error => error.code === 'studio_v3_batch_scene_save'); assert.equal(readonly.calls.renders.length, 0);
  const active = await fixture(); active.session.history.begin('world', 'External author');
  await assert.rejects(active.exporter.export(active.shots), error => error.code === 'studio_v3_batch_transaction'); assert.equal(active.calls.renders.length, 0);
});
