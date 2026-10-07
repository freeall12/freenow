const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs')
]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
async function fixture(options = {}) {
  const [{createStudioSession}, schema, world] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 100});
  state = world.addEntity(state, schema.createEntity({id: 'prop', label: 'Original', kind: 'prop', now: 100}));
  const source = {id: 'source', worldResource: {url: 'local.glb', format: 'glb'}};
  const target = {id: 'owner', type: 'threeDStudioV3', studioV3: {version: 3, state, revision: 0,
    sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  let projectId = 'canvas-a', guard, durable = null, writes = [], fail = null, hold = null, prepublish = null;
  const nodes = [target, source], timers = new Map(); let timerId = 0;
  const app = {
    getState: () => ({nodes}), projectIdentity: () => ({id: projectId}),
    registerNodeWriteGuard(id, callback) { guard = callback; return () => {
      if (guard !== callback) return;
      if (nodes.includes(target) && !callback(structuredClone(target))) throw Error('cannot unregister invalid node guard');
      guard = null;
    }; }
  };
  const publishNode = async (id, patch, {beforeCommit}) => {
    assert.equal(id, target.id); assert.equal(beforeCommit(), true);
    if (prepublish) prepublish();
    if (options.stagedHost) target.studioV3 = structuredClone(patch.studioV3);
    const captured = {...structuredClone(target), studioV3: structuredClone(patch.studioV3)}, capturedGuard = guard;
    writes.push(captured);
    const waiting = hold; hold = null;
    if (waiting) await waiting.promise;
    if (fail) { const error = fail; fail = null; throw error; }
    if (!beforeCommit() || !capturedGuard(captured)) throw Object.assign(Error('commit fence rejected'), {code: 'stale-owner'});
    durable = captured;
    if (!beforeCommit()) throw Object.assign(Error('ack fence rejected'), {code: 'stale-owner'});
    if (!options.stagedHost) target.studioV3 = structuredClone(patch.studioV3);
  };
  const config = {nodeId: 'owner', app, store: {flush: async () => {}}, publishNode,
    getSourceSnapshot: node => node.worldResource, autosaveMs: null,
    historyOptions: {createId: (() => { let i = 0; return () => `record-${++i}`; })(), now: () => 101},
    schedule: callback => { const id = ++timerId; timers.set(id, callback); return id; }, unschedule: id => timers.delete(id), ...options};
  const session = createStudioSession(config);
  return {session, target, source, nodes, app, config, createStudioSession, schema, world, writes, timers,
    rename: label => state => world.patchEntity(state, 'prop', {label}, 102),
    hold: () => { hold = deferred(); return hold; }, fail: () => { fail = Error('disk unavailable'); },
    project: id => { projectId = id; }, guard: () => guard, durable: () => durable,
    beforePublish: callback => { prepublish = callback; }};
}

test('committed session change saves explicit schema4 V3 marker and supports reopen', async () => {
  const f = await fixture(); assert.equal(f.session.change(f.rename('Saved')), true);
  assert.equal(f.session.getStatus().contentDirty, true); assert.equal(f.session.getStatus().revision, 1);
  assert.deepEqual(await f.session.flush(), {ok: true});
  assert.equal(f.durable().studioV3.version, 3); assert.equal(f.durable().studioV3.state.schemaVersion, 4);
  assert.equal(f.durable().studioV3.revision, 1); assert.equal(f.session.getStatus().dirty, false);
  await f.session.closeGuard(); const reopened = f.createStudioSession(f.config);
  assert.equal(reopened.getState().scenePlay.worldSpace.entities[0].label, 'Saved');
  assert.equal(reopened.getStatus().revision, 1);
});

test('preview defers flush; cancel and noop never persist provisional state', async () => {
  const f = await fixture(); f.session.history.begin('world', 'preview'); f.session.history.preview(f.rename('Preview'));
  assert.deepEqual(await f.session.flush(), {ok: true}); assert.equal(f.writes.length, 0);
  await assert.rejects(f.session.closeGuard(), error => error.code === 'transaction-active');
  f.session.history.cancel(); assert.equal(f.session.getState().scenePlay.worldSpace.entities[0].label, 'Original');
  f.session.history.begin('world', 'noop'); assert.equal(f.session.history.commit(), false);
  await f.session.flush(); assert.equal(f.writes.length, 0); assert.equal(f.session.getStatus().dirtySeq, 0);
  f.session.change(f.rename('Committed')); f.session.history.begin('world', 'next preview'); f.session.history.preview(f.rename('Temporary'));
  assert.deepEqual(await f.session.flush(), {ok: false, reason: 'transaction-active'}); assert.equal(f.writes.length, 0);
  f.session.history.cancel(); await f.session.flush(); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Committed');
});

test('serialized saves capture immutable snapshots and retain dirty edits made in flight', async () => {
  const statuses = [], f = await fixture({onStatus: value => statuses.push(value)});
  f.session.change(f.rename('First')); const held = f.hold(), saving = f.session.flush();
  assert.equal(f.session.flush(), saving); await Promise.resolve();
  f.session.change(f.rename('Second')); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].studioV3.state.scenePlay.worldSpace.entities[0].label, 'First');
  held.resolve(); await saving;
  assert.equal(f.writes.length, 2); assert.equal(f.durable().studioV3.revision, 2);
  assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Second');
  assert.equal(f.session.getStatus().dirty, false);
  assert.ok(statuses.some(status => status.savedSeq === 1 && status.dirtySeq === 2 && status.contentDirty));
});

test('background changes track separate content sequence, including edits during save', async () => {
  const statuses = [], f = await fixture({onStatus: value => statuses.push(value)});
  f.session.change(f.rename('Content')); const held = f.hold(), saving = f.session.flush(); await Promise.resolve();
  f.session.change(f.rename('Background'), {content: false});
  assert.equal(f.session.getStatus().dirtySeq, 2); assert.equal(f.session.getStatus().contentDirtySeq, 1);
  held.resolve(); await saving;
  assert.ok(statuses.some(status => status.savedSeq === 1 && status.dirty && !status.contentDirty));
  f.session.change(f.rename('Only Background'), {content: false}); assert.equal(f.session.getStatus().status, 'background-dirty');
});

test('transaction starting in flight prevents follow-on save until committed or cancelled', async () => {
  const f = await fixture(); f.session.change(f.rename('One')); const held = f.hold(), saving = f.session.flush(); await Promise.resolve();
  f.session.change(f.rename('Two')); f.session.history.begin('world', 'drag'); f.session.history.preview(f.rename('Preview'));
  held.resolve(); assert.deepEqual(await saving, {ok: false, reason: 'transaction-active'});
  assert.equal(f.writes.length, 1); assert.equal(f.session.getStatus().dirty, true);
  f.session.history.cancel(); await f.session.flush(); assert.equal(f.writes.length, 2);
  assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Two');
});

test('failed close retains live session, pending revision and supports retry with newer edits', async () => {
  const f = await fixture(); f.session.change(f.rename('Failed')); f.fail();
  await assert.rejects(f.session.closeGuard(), /disk unavailable/);
  assert.equal(f.session.isCurrent(), true); assert.equal(f.session.getStatus().status, 'failed'); assert.ok(f.guard());
  assert.equal(f.target.studioV3.revision, 0); assert.equal(f.session.getStatus().savedSeq, 0);
  f.session.change(f.rename('Retry Newer')); await f.session.closeGuard();
  assert.equal(f.durable().studioV3.revision, 2); assert.equal(f.session.isCurrent(), false); assert.equal(f.guard(), null);
  assert.throws(() => f.session.change(f.rename('Closed')), error => error.code === 'closed-session');
});

test('same revision retry does not advance saved sequences before durable success', async () => {
  const f = await fixture(); f.session.change(f.rename('Retry')); f.fail(); await assert.rejects(f.session.flush(), /disk/);
  await f.session.flush(); assert.deepEqual(f.writes.map(node => node.studioV3.revision), [1, 1]);
  assert.equal(f.session.getStatus().savedSeq, 1);
});

test('compatibility staged host failure permits newer private edit retry', async () => {
  const f = await fixture({stagedHost: true}); f.session.change(f.rename('Staged')); f.fail(); await assert.rejects(f.session.flush());
  assert.equal(f.target.studioV3.revision, 1); f.session.change(f.rename('Newer')); await f.session.closeGuard();
  assert.equal(f.durable().studioV3.revision, 2); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Newer');
});

for (const [name, mutate] of [
  ['source content', f => { f.source.worldResource.url = 'changed.glb'; }],
  ['source deletion', f => { f.nodes.splice(f.nodes.indexOf(f.source), 1); }],
  ['source replacement', f => { f.nodes[f.nodes.indexOf(f.source)] = structuredClone(f.source); }],
  ['target deletion', f => { f.nodes.splice(f.nodes.indexOf(f.target), 1); }],
  ['target replacement', f => { f.nodes[f.nodes.indexOf(f.target)] = structuredClone(f.target); }],
  ['external stored revision', f => { f.target.studioV3.revision++; }],
  ['external stored content', f => { f.target.studioV3.state.scenePlay.worldSpace.entities[0].label = 'external'; }],
  ['owner version', f => { f.target.studioV3.version = 2; }],
  ['canvas switch', f => f.project('canvas-b')]
]) test(`${name} rejects late commit and keeps edits dirty`, async () => {
  const f = await fixture(); f.session.change(f.rename('Pending')); const held = f.hold(), saving = f.session.flush(); await Promise.resolve();
  mutate(f); held.resolve(); await assert.rejects(saving, error => error.code === 'stale-owner');
  assert.equal(f.durable(), null); assert.equal(f.session.getStatus().savedSeq, 0); assert.equal(f.session.getStatus().dirty, true);
});

test('session handover rejects queued old callbacks without unregistering the new guard', async () => {
  const f = await fixture(); f.session.change(f.rename('Old')); const held = f.hold(), saving = f.session.flush(); await Promise.resolve();
  const oldGuard = f.guard(), next = f.createStudioSession({...f.config, sessionToken: 'next'});
  assert.equal(f.session.isCurrent(), false); assert.equal(next.isCurrent(), true);
  assert.equal(next.getStatus().dirty, false);
  assert.equal(oldGuard(f.writes[0]), false); held.resolve(); await assert.rejects(saving, error => error.code === 'stale-owner');
  await assert.rejects(f.session.closeGuard(), error => error.code === 'stale-owner'); assert.ok(f.guard());
  next.change(f.rename('New')); await next.flush(); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'New');
});

test('handover inherits a staged failed save as dirty and flushes before closing', async () => {
  const f = await fixture({stagedHost: true}); f.session.change(f.rename('Unsaved Host')); f.fail(); await assert.rejects(f.session.flush());
  const next = f.createStudioSession(f.config); assert.equal(next.getStatus().dirty, true);
  await next.closeGuard(); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Unsaved Host');
  assert.deepEqual(f.writes.map(node => node.studioV3.revision), [1, 1]);
});

test('default adapter writes before publication and failure leaves host and durable baseline unchanged', async () => {
  const f = await fixture(), baseline = structuredClone(f.target);
  f.session.change(f.rename('Private')); const held = f.hold(), saving = f.session.flush(); await Promise.resolve();
  assert.deepEqual(f.target, baseline); assert.equal(f.guard()(f.writes[0]), true);
  f.fail(); held.resolve(); await assert.rejects(saving, /disk/);
  assert.deepEqual(f.target, baseline); assert.equal(f.durable(), null); assert.equal(f.session.getStatus().dirty, true);
  await f.session.closeGuard(); assert.equal(f.target.studioV3.state.scenePlay.worldSpace.entities[0].label, 'Private');
});

test('runtime fence tracks private previews, cancellation and committed revision', async () => {
  const f = await fixture(), initial = f.session.getFence();
  f.session.history.begin('world', 'Preview'); f.session.history.preview(f.rename('Temporary'));
  assert.equal(f.session.getFence().revision, initial.revision); assert.ok(f.session.getFence().editEpoch > initial.editEpoch);
  const previewEpoch = f.session.getFence().editEpoch; f.session.history.cancel(); assert.ok(f.session.getFence().editEpoch > previewEpoch);
  f.session.change(f.rename('Commit')); assert.equal(f.session.getFence().revision, initial.revision + 1);
});

test('CanvasApp string project identity is fenced across canvas changes', async () => {
  const f = await fixture(); await f.session.closeGuard();
  let projectId = 'actual-canvas'; f.app.projectIdentity = () => projectId;
  const session = f.createStudioSession(f.config); assert.equal(session.getFence().projectId, 'actual-canvas');
  session.change(f.rename('Private')); projectId = 'other-canvas';
  await assert.rejects(session.flush(), error => error.code === 'stale-owner'); assert.equal(f.writes.length, 0);
});

test('persistent node guard rejects captured old snapshots after a newer publish and after close', async () => {
  const f = await fixture(), baseline = structuredClone(f.target), guard = f.guard();
  assert.equal(guard(baseline), true); f.session.change(f.rename('New')); await f.session.flush();
  assert.equal(guard(baseline), false); assert.equal(guard(structuredClone(f.target)), true);
  await f.session.closeGuard(); assert.equal(guard(structuredClone(f.target)), false);
});

test('readonly session cannot mutate or save and closes without publishing', async () => {
  const f = await fixture({readonly: true}); assert.throws(() => f.session.change(f.rename('Denied')), error => error.code === 'readonly');
  assert.throws(() => f.session.history.begin('world', 'Denied'), error => error.code === 'readonly');
  assert.deepEqual(await f.session.flush(), {ok: true, readonly: true}); await f.session.closeGuard(); assert.equal(f.writes.length, 0);
});

test('readonly preview cannot steal an active writer or strand its failed published edits', async () => {
  const f = await fixture({stagedHost: true}), guard = f.guard();
  assert.throws(() => f.createStudioSession({...f.config, readonly: true}), error => error.code === 'session-active');
  f.session.change(f.rename('Keep Editable')); f.fail(); await assert.rejects(f.session.flush());
  assert.throws(() => f.createStudioSession({...f.config, readonly: true}), error => error.code === 'session-active');
  assert.equal(f.session.isCurrent(), true); assert.equal(f.guard(), guard);
  await f.session.closeGuard(); const readonly = f.createStudioSession({...f.config, readonly: true});
  await readonly.closeGuard(); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Keep Editable');
});

test('undo and redo mark content dirty; consumers cannot mutate state, status or fences', async () => {
  const f = await fixture(); f.session.change(f.rename('Edited')); await f.session.flush();
  assert.deepEqual(f.session.history.undo(), {ok: true}); assert.equal(f.session.getStatus().contentDirtySeq, 2);
  assert.deepEqual(f.session.history.redo(), {ok: true}); assert.equal(f.session.getStatus().contentDirtySeq, 3);
  f.session.getState().scenePlay.worldSpace.entities[0].label = 'Mutated'; f.session.getFence().sourceBinding.sourceSnapshot.url = 'Mutated';
  f.session.getStatus().revision = 999;
  assert.equal(f.session.getState().scenePlay.worldSpace.entities[0].label, 'Edited'); assert.equal(f.session.isCurrent(), true);
  await f.session.flush(); assert.equal(f.durable().studioV3.revision, 3);
});

test('autosave schedules committed changes and reschedules after cancelled preview', async () => {
  const f = await fixture({autosaveMs: 500}); f.session.change(f.rename('Committed')); assert.equal(f.timers.size, 1);
  f.session.history.begin('world', 'Preview'); assert.equal(f.timers.size, 0); f.session.history.preview(f.rename('Preview')); f.session.history.cancel();
  assert.equal(f.timers.size, 1); const callback = [...f.timers.values()][0]; f.timers.clear(); callback();
  await f.session.flush(); assert.equal(f.writes.length, 1); assert.equal(f.durable().studioV3.state.scenePlay.worldSpace.entities[0].label, 'Committed');
});

test('legacy owners and malformed revision/source markers are rejected without migration', async () => {
  const f = await fixture(); await f.session.closeGuard();
  const original = structuredClone(f.target.studioV3);
  for (const mutate of [value => { value.version = 2; }, value => { value.revision = -1; }, value => { delete value.sourceBinding.sourceSnapshot; }, value => { value.state.scenePlay.worldNodeId = 'other'; }]) {
    f.target.studioV3 = structuredClone(original); mutate(f.target.studioV3);
    assert.throws(() => f.createStudioSession(f.config));
  }
});

test('revision exhaustion rejects before changing committed state/history and keeps previews cancellable', async () => {
  const f = await fixture(); await f.session.closeGuard(); f.target.studioV3.revision = Number.MAX_SAFE_INTEGER;
  const session = f.createStudioSession(f.config), before = session.getState();
  assert.throws(() => session.change(f.rename('Cannot Commit')), /revision exhausted/);
  assert.deepEqual(session.getState(), before); assert.equal(session.history.getHistory().nextSequence, 1);
  session.history.begin('world', 'Preview'); session.history.preview(f.rename('Preview'));
  assert.throws(() => session.history.commit(), /revision exhausted/); assert.ok(session.history.getActiveTransaction());
  session.history.cancel(); assert.deepEqual(session.getState(), before); await session.closeGuard(); assert.equal(f.writes.length, 0);
});

test('owner changed synchronously inside reducer cannot make committed private edits look clean', async () => {
  const f = await fixture(); assert.throws(() => f.session.change(state => {
    f.source.worldResource.url = 'changed-by-reducer.glb'; return f.rename('Private')(state);
  }), error => error.code === 'stale-owner');
  assert.equal(f.session.getStatus().dirty, true); assert.equal(f.session.getState().scenePlay.worldSpace.entities[0].label, 'Private');
  await assert.rejects(f.session.closeGuard(), error => error.code === 'stale-owner'); assert.ok(f.guard());
});
