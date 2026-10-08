const {test} = require('node:test'), assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs'), {createHash} = require('node:crypto'), vm = require('node:vm');
const modules = Promise.all([import('../src/features/studio-v3/temporal-actions.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/history.mjs'), import('../src/features/studio-v3/camera-shot-sampling.mjs'), import('three')]);
const vec = (x, y = 0, z = 0) => ({x, y, z}), near = (a, b, e = 1e-8) => assert(Math.abs(a - b) <= e, `${a} differs from ${b}`);
const domain = fn => assert.throws(fn, error => error.name === 'StudioDomainError');
async function fixture() {
  const [actions, schema, world, history, sampling, THREE] = await modules;
  let state = schema.createState({worldNodeId: 'temporal', now: 1});
  for (const [id, kind, setupId] of [['actor', 'actor', 'setup:state-1'], ['prop', 'prop', 'setup:state-1'], ['cam', 'camera', 'setup:state-1'], ['shared', 'prop', 'setup-default']]) {
    const local = schema.createSetupState(id, 1);
    if (kind === 'actor') local.pose = 'Standing';
    if (kind === 'camera') local.camera = {position: vec(0, 1.6), rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, fov: 60, focalLength: 20, frameAspectRatio: 16 / 9, focusDistance: 10, apertureFNumber: 8, focus: {mode: 'distance', distance: 10}, lookAt: {mode: 'none'}, depthOfFieldMode: 'deepFocus'};
    if (kind === 'camera') local.transform.position = vec(0, 1.6);
    state = world.addEntity(state, schema.createEntity({id, kind, label: id, now: 1}), {setupId, setupState: local});
  }
  const f = {actions, schema, world, history, sampling, THREE, state, setupId: 'setup:state-1', counter: 0};
  f.local = id => structuredClone(f.state.scenePlay.worldSpace.setups.find(setup => setup.id === f.setupId).entityStates.find(item => item.entityId === id));
  f.track = id => f.state.scenePlay.worldSpace.setups.find(setup => setup.id === f.setupId).temporal?.tracks.find(track => track.owner.entityId === id);
  f.write = action => {const result = actions.reduceTemporalAction(f.state, action, {now: 5, createId: () => `generated:${++f.counter}`}); if (result.ok) f.state = result.state; return result;};
  f.save = (id, at, x, keyId = `${id}:${at}`) => {const snapshot = f.local(id); if (x !== undefined) {snapshot.transform.position = vec(x); if (snapshot.camera) snapshot.camera.position = vec(x);} return f.write({type: 'save-key', entityId: id, timeMs: at, keyId, snapshot});};
  f.sample = at => sampling.sampleTemporalSetupState(f.state, {setupId: f.setupId}, at);
  return f;
}

test('official snapshot channel set keeps camera optical rotation and discrete fields, not implicit relation channels', async () => {
  const f = await fixture(), camera = f.local('cam'), actor = f.local('actor');
  actor.lookTarget = {kind: 'entity', entityId: 'prop'}; actor.heldEntityId = 'prop';
  const actorChannels = f.actions.snapshotEntityChannels(f.state.scenePlay.worldSpace.entities.find(entity => entity.id === 'actor'), actor);
  assert.deepEqual(actorChannels.map(channel => channel.property), ['entity.transform.position', 'entity.transform.scale', 'entity.visibility', 'entity.transform.rotation', 'entity.pose']);
  assert.equal(actorChannels.find(channel => channel.property === 'entity.pose').interpolation, 'hold');
  delete camera.camera.focalLength; camera.camera.frameAspectRatio = null; camera.camera.focusDistance = null;
  const cameraChannels = f.actions.snapshotEntityChannels(f.state.scenePlay.worldSpace.entities.find(entity => entity.id === 'cam'), camera);
  assert(cameraChannels.some(channel => channel.property === 'camera.focalLength' && channel.value.value > 0));
  for (const property of ['entity.transform.rotation', 'camera.fov', 'camera.frameAspectRatio', 'camera.focusDistance']) assert(!cameraChannels.some(channel => channel.property === property));
  assert(cameraChannels.some(channel => channel.property === 'camera.rotation'));
});

test('save-key creates real persistent sorted tracks, retains existing time ID and leaves base unchanged', async () => {
  const f = await fixture(), base = f.local('actor'), before = structuredClone(f.state);
  const first = f.save('actor', 1000.4, 10, 'end'); assert.equal(first.selection.keyId, 'end'); assert.equal(first.lane, 'setup:setup:state-1');
  f.save('actor', 0, 0, 'start'); const repeated = f.save('actor', 1000, 20, 'ignored-at-same-time');
  assert.equal(repeated.selection.keyId, 'end'); assert.deepEqual(f.track('actor').keys.map(key => [key.id, key.timeMs]), [['start', 0], ['end', 1000]]);
  assert.deepEqual(f.local('actor'), base); assert.equal(before.scenePlay.worldSpace.setups[1].temporal, undefined);
  const payload = JSON.parse(JSON.stringify(f.state)); f.schema.assertState(payload);
  const sampled = f.sampling.sampleTemporalSetupState(payload, {setupId: f.setupId}, 500); near(sampled.entityStates.find(item => item.entityId === 'actor').transform.position.x, 10);
});

test('selection decision matches Kn: valid own selected key, own no-key base, exact-time key, otherwise time key', async () => {
  const f = await fixture(), resolve = request => f.actions.resolveTemporalEditTarget(f.state, {entityId: 'actor', ...request});
  assert.deepEqual(resolve({timeMs: 500}), {kind: 'base'}); f.save('prop', 0, 0); assert.deepEqual(resolve({timeMs: 500}), {kind: 'base'});
  f.save('actor', 0, 0, 'zero'); f.save('actor', 1000, 10, 'end');
  assert.deepEqual(resolve({timeMs: 500, selectedKeyId: 'end'}), {kind: 'selected-key', entityId: 'actor', keyId: 'end'});
  assert.deepEqual(resolve({timeMs: 0, selectedKeyId: 'missing'}), {kind: 'selected-key', entityId: 'actor', keyId: 'zero'});
  assert.deepEqual(resolve({timeMs: 500, selectedKey: {entityId: 'prop', keyId: 'prop:0'}}), {kind: 'time-key', timeMs: 500});
  assert.deepEqual(resolve({timeMs: 500, target: {kind: 'base'}}), {kind: 'base'});
  assert.deepEqual(resolve({timeMs: 12, target: {kind: 'selected-key', entityId: 'prop', keyId: 'prop:0'}}), {kind: 'time-key', timeMs: 12});
});

test('non-key edit prepares confirmation, cancel changes nothing, confirmed edit stores sampled key without altering base', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); f.save('actor', 1000, 10, 'end'); const before = structuredClone(f.state), base = f.local('actor');
  const prepared = f.actions.prepareTemporalEdit(f.state, {entityId: 'actor', timeMs: 500, patch: {pose: 'Sitting'}}, {now: 5});
  assert(prepared.needsConfirmation); assert(prepared.impact.willCreateKey); assert(!prepared.impact.willCreateTrack); assert.equal(prepared.intent.entity.label, 'actor'); assert.deepEqual(f.state, before);
  assert.equal(f.actions.applyPreparedTemporalEdit(f.state, prepared).reason, 'confirmation-required');
  assert.equal(f.actions.applyPreparedTemporalEdit(f.state, prepared, {confirmed: false}).reason, 'cancelled'); assert.deepEqual(f.state, before);
  const accepted = f.actions.applyPreparedTemporalEdit(f.state, prepared, {confirmed: true, now: 5, createId: () => 'middle'}); assert(accepted.ok); f.state = accepted.state;
  assert.equal(accepted.selection.keyId, 'middle'); assert.deepEqual(f.local('actor'), base);
  const mid = f.sample(500).entityStates.find(entity => entity.entityId === 'actor'); near(mid.transform.position.x, 5); assert.equal(mid.pose, 'Sitting');
});

test('prepared target can preview latest patches repeatedly at one key, and history commit/cancel is one transaction', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); const before = structuredClone(f.state);
  const history = f.history.createHistory(before, {createId: () => 'history', now: () => 6});
  let prepared = f.actions.prepareTemporalEdit(history.getState(), {entityId: 'actor', timeMs: 500, patch: {transform: {position: vec(5)}}}, {now: 5});
  assert(history.begin(prepared.lane, 'drag', prepared.scope));
  for (const x of [5, 7, 12]) history.preview(state => {const result = f.actions.applyPreparedTemporalEdit(state, prepared, {confirmed: true, patch: {transform: {position: vec(x)}}, now: 5, createId: () => 'middle'}); assert(result.ok); prepared = result.prepared; return result.state;});
  assert(history.commit()); assert.equal(history.getHistory().lanes[prepared.lane].undoStack.length, 1);
  const after = history.getState(); assert.equal(after.scenePlay.worldSpace.setups[1].temporal.tracks[0].keys.length, 2);
  assert.deepEqual(after.scenePlay.worldSpace.setups[1].entityStates, before.scenePlay.worldSpace.setups[1].entityStates);
  assert(history.undo(prepared.lane).ok); assert.deepEqual(history.getState(), before); assert(history.redo(prepared.lane).ok); assert.deepEqual(history.getState(), after);
  prepared = f.actions.prepareTemporalEdit(history.getState(), {entityId: 'actor', selectedKeyId: 'middle', patch: {visible: false}}, {now: 6});
  history.begin(prepared.lane, 'cancel', prepared.scope); history.preview(state => f.actions.applyPreparedTemporalEdit(state, prepared, {now: 6}).state); history.cancel(); assert.deepEqual(history.getState(), after);
});

test('base edit creates no temporal data, selected-key edit uses selected time, relations persist only when explicitly edited', async () => {
  const f = await fixture(); let result = f.write({type: 'edit-entity', entityId: 'actor', timeMs: 700, patch: {pose: 'Sitting'}});
  assert(result.ok); assert.equal(f.local('actor').pose, 'Sitting'); assert.equal(f.track('actor'), undefined);
  f.save('actor', 0, 0, 'zero'); f.save('actor', 1000, 10, 'end'); const base = f.local('actor');
  result = f.write({type: 'edit-entity', entityId: 'actor', timeMs: 500, selectedKeyId: 'zero', patch: {lookTarget: {kind: 'entity', entityId: 'prop'}}});
  assert(result.ok); assert.equal(result.selection.keyId, 'zero'); assert.deepEqual(f.local('actor'), base);
  assert.equal(f.track('actor').channels.find(channel => channel.property === 'entity.lookTarget').values[0].keyId, 'zero');
  assert.equal(f.sample(0).entityStates.find(entity => entity.entityId === 'actor').lookTarget.entityId, 'prop');
});

test('preparation rejects stale setup or definition state and rechecks readonly/playback/scrub permission', async () => {
  const f = await fixture(), prepared = f.actions.prepareTemporalEdit(f.state, {entityId: 'actor', patch: {pose: 'Sitting'}});
  const changed = f.world.patchEntity(f.state, 'actor', {label: 'renamed'}, 5);
  assert.equal(f.actions.applyPreparedTemporalEdit(changed, prepared).reason, 'stale-preparation');
  for (const [flag, reason] of [['readonly', 'readonly'], ['playing', 'playback'], ['scrubbing', 'scrubbing']]) assert.equal(f.actions.applyPreparedTemporalEdit(f.state, prepared, {[flag]: true}).reason, reason);
});

test('duration clamps to 1000 and ALL keys; shot duration considers used keys and lone zero is static', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); assert.equal(f.actions.temporalUsedDurationMs(f.state), null);
  f.save('actor', 1000, 1, 'used');
  const temporal = structuredClone(f.state.scenePlay.worldSpace.setups[1].temporal); temporal.durationMs = 5000; temporal.tracks[0].keys.push({id: 'unused', timeMs: 4500}); f.state = f.world.setTemporal(f.state, f.setupId, temporal, 5);
  assert.equal(f.actions.temporalUsedDurationMs(f.state), 1000); assert.equal(f.actions.temporalDurationMinimum(f.state).keyId, 'unused');
  const changed = f.write({type: 'set-duration', durationMs: 20}); assert.equal(changed.durationMs, 4500);
  f.write({type: 'remove-track', entityId: 'actor'}); assert.equal(f.actions.temporalUsedDurationMs(f.state), null);
  assert.equal(f.write({type: 'set-duration', durationMs: 0}).durationMs, 1000);
  f.save('actor', 100, 0, 'positive'); assert.equal(f.actions.temporalUsedDurationMs(f.state), 100); assert.equal(f.state.scenePlay.worldSpace.setups[1].temporal.durationMs, 3000);
});

test('key movement rounds and clamps between neighbors without changing IDs/values; descriptor exposes range', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'start'); f.save('actor', 500, 5, 'middle'); f.save('actor', 1000, 10, 'end');
  const samples = structuredClone(f.track('actor').channels);
  assert.deepEqual(f.actions.temporalTrackDescriptor(f.state, {entityId: 'actor', selectedKeyId: 'middle'}).keyItems[1].moveRange, {minTimeMs: 1, maxTimeMs: 999});
  f.write({type: 'move-key', entityId: 'actor', keyId: 'middle', timeMs: 10000}); assert.equal(f.track('actor').keys[1].timeMs, 999);
  f.write({type: 'move-key', entityId: 'actor', keyId: 'middle', timeMs: -30}); assert.equal(f.track('actor').keys[1].timeMs, 1);
  f.write({type: 'move-key', entityId: 'actor', keyId: 'middle', timeMs: 400.6}); assert.equal(f.track('actor').keys[1].timeMs, 401); assert.deepEqual(f.track('actor').channels, samples);
  f.write({type: 'rename-key', entityId: 'actor', keyId: 'middle', label: 'Middle'}); assert.equal(f.track('actor').keys[1].label, 'Middle');
  domain(() => f.write({type: 'move-key', entityId: 'actor', keyId: 'middle', timeMs: Infinity}));
});

test('key deletion prunes values, dangling segments, unused keys, empty tracks and changed endpoint controls', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'start'); f.save('actor', 1000, 10, 'end');
  f.write({type: 'set-endpoint-control', entityId: 'actor', endpoint: 'start', point: vec(0, 5)}); f.write({type: 'set-endpoint-control', entityId: 'actor', endpoint: 'end', point: vec(10, 5)});
  f.write({type: 'set-segment-bend', entityId: 'actor', fromKeyId: 'start', toKeyId: 'end', point: vec(5, 4), t: .5});
  f.write({type: 'remove-key', entityId: 'actor', keyId: 'start'}); assert.equal(f.track('actor').pathEndpointControls.start, undefined); assert(f.track('actor').pathEndpointControls.end);
  assert.equal(f.track('actor').segments.length, 0); for (const channel of f.track('actor').channels) assert.deepEqual(channel.values.map(sample => sample.keyId), ['end']);
  f.write({type: 'remove-key', entityId: 'actor', keyId: 'end'}); assert.equal(f.track('actor'), undefined); assert.deepEqual(f.state.scenePlay.worldSpace.setups[1].temporal.tracks, []);
});

test('official move/delete-track normalizes unused keys in other tracks too', async () => {
  for (const type of ['move-key', 'remove-track']) {
    const f = await fixture(); f.save('actor', 0, 0, 'zero'); f.save('actor', 1000, 1, 'end'); f.save('prop', 0, 0, 'prop-zero');
    const temporal = structuredClone(f.state.scenePlay.worldSpace.setups[1].temporal); temporal.tracks.find(track => track.owner.entityId === 'prop').keys.push({id: 'unused', timeMs: 2000});
    f.state = f.world.setTemporal(f.state, f.setupId, temporal, 5);
    f.write(type === 'move-key' ? {type, entityId: 'actor', keyId: 'end', timeMs: 900} : {type, entityId: 'actor'});
    assert.deepEqual(f.track('prop').keys.map(key => key.id), ['prop-zero']);
  }
});

test('channel upsert/remove persists sparse values and cleans keys when final references disappear', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); f.save('actor', 1000, 10, 'end');
  f.write({type: 'set-key-value', entityId: 'actor', keyId: 'zero', property: 'entity.heldEntityId', value: {kind: 'text', value: 'prop'}, interpolation: 'hold', channelId: 'custom-held'});
  f.write({type: 'set-channel', entityId: 'actor', property: 'entity.heldEntityId', values: [{keyId: 'end', value: {kind: 'text', value: null}, interpolation: 'hold'}]});
  assert.equal(f.track('actor').channels.find(channel => channel.property === 'entity.heldEntityId').id, 'custom-held');
  for (const channel of f.track('actor').channels.slice()) if (channel.property !== 'entity.heldEntityId') f.write({type: 'remove-channel', entityId: 'actor', property: channel.property});
  assert.deepEqual(f.track('actor').keys.map(key => key.id), ['end']);
  f.write({type: 'remove-key-value', entityId: 'actor', keyId: 'end', property: 'entity.heldEntityId'}); assert.equal(f.track('actor'), undefined);
});

test('real sampling gives discrete hold, shortest quaternion orientation and logarithmic focal values', async () => {
  const f = await fixture();
  const start = f.local('cam'), end = f.local('cam'); start.camera.focalLength = 20; end.camera.focalLength = 80;
  start.camera.rotation.y = 170 * Math.PI / 180; end.camera.rotation.y = -170 * Math.PI / 180;
  f.write({type: 'save-key', entityId: 'cam', timeMs: 0, keyId: 'start', snapshot: start}); f.write({type: 'save-key', entityId: 'cam', timeMs: 1000, keyId: 'end', snapshot: end});
  const sample = f.sample(500).entityStates.find(item => item.entityId === 'cam'); near(sample.camera.focalLength, 40); near(Math.abs(sample.camera.rotation.y), Math.PI);
  f.save('actor', 0, 0, 'actor-start'); const actorEnd = f.local('actor'); actorEnd.pose = 'Sitting'; actorEnd.visible = false;
  f.write({type: 'save-key', entityId: 'actor', timeMs: 1000, keyId: 'actor-end', snapshot: actorEnd});
  assert.equal(f.sample(999).entityStates.find(item => item.entityId === 'actor').pose, 'Standing'); assert.equal(f.sample(1000).entityStates.find(item => item.entityId === 'actor').pose, 'Sitting');
  assert.equal(f.sample(999).entityStates.find(item => item.entityId === 'actor').visible, true); assert.equal(f.sample(1000).entityStates.find(item => item.entityId === 'actor').visible, false);
});

test('camera key patch stores optical and plan consistently without writing camera base', async () => {
  const f = await fixture(); f.save('cam', 0, undefined, 'zero'); const base = f.local('cam');
  const prepared = f.actions.prepareTemporalEdit(f.state, {entityId: 'cam', selectedKeyId: 'zero', patch: {camera: {rotation: {x: .3, y: .8, z: -.2, order: 'ZYX'}, focalLength: 50}}}, {now: 5});
  const changed = f.actions.applyPreparedTemporalEdit(f.state, prepared, {now: 5}); assert(changed.ok); f.state = changed.state;
  assert.deepEqual(f.local('cam'), base); const sampled = f.sample(0).entityStates.find(item => item.entityId === 'cam'); near(sampled.camera.focalLength, 50);
  const q = r => new f.THREE.Quaternion().setFromEuler(new f.THREE.Euler(r.x, r.y, r.z, r.order)); near(q(sampled.camera.rotation).angleTo(q({x: .3, y: .8, z: -.2, order: 'ZYX'})), 0, 1e-7);
  assert(!f.track('cam').channels.some(channel => channel.property === 'entity.transform.rotation'));
});

test('first camera key preserves renderer optical position in legal older unsynchronized plan snapshots', async () => {
  const f = await fixture();
  const camera = f.local('cam').camera; camera.position = vec(5, 2, 3);
  f.state = f.world.patchEntityState(f.state, f.setupId, 'cam', {camera}, 2);
  const before = f.local('cam'); assert.notDeepEqual(before.camera.position, before.transform.position);
  f.write({type: 'save-key', entityId: 'cam', timeMs: 0, keyId: 'first'});
  assert.deepEqual(f.local('cam'), before); assert.deepEqual(f.sample(0).entityStates.find(item => item.entityId === 'cam').camera.position, camera.position);
});

test('canonical camera no-look target suppresses inherited lookAt in key sampling and base editing', async () => {
  const f = await fixture();
  f.state = f.world.patchEntityState(f.state, f.setupId, 'cam', {camera: {...f.local('cam').camera, lookAt: {mode: 'entity', entityId: 'prop'}}}, 2);
  const baseClear = f.actions.prepareTemporalEdit(f.state, {entityId: 'cam', patch: {camera: {lookAt: {mode: 'none'}}}}, {now: 3});
  const cleared = f.actions.applyPreparedTemporalEdit(f.state, baseClear, {now: 3}); assert.equal(cleared.state.scenePlay.worldSpace.setups[1].entityStates.find(item => item.entityId === 'cam').camera.lookAt.mode, 'none');
  f.save('cam', 0, undefined, 'zero');
  const prepared = f.actions.prepareTemporalEdit(f.state, {entityId: 'cam', timeMs: 500, patch: {camera: {lookAt: {mode: 'none'}}}}, {now: 5});
  const out = f.actions.applyPreparedTemporalEdit(f.state, prepared, {confirmed: true, now: 5}); f.state = out.state;
  assert.equal(f.local('cam').camera.lookAt.mode, 'entity'); assert.equal(f.sample(500).entityStates.find(item => item.entityId === 'cam').camera.lookAt.mode, 'none');
});

test('interior insertion saves the original curve sub-midpoint constraints and clears changed endpoints', async () => {
  const f = await fixture(); f.save('prop', 0, 0, 'start'); f.save('prop', 1000, 10, 'end');
  f.write({type: 'set-endpoint-control', entityId: 'prop', endpoint: 'start', point: vec(0, 10)}); f.write({type: 'set-endpoint-control', entityId: 'prop', endpoint: 'end', point: vec(10, 10)});
  const split = f.sampling.resolveTemporalPathSplit(f.track('prop'), 500), sample = f.sample(500).entityStates.find(item => item.entityId === 'prop');
  f.write({type: 'save-key', entityId: 'prop', timeMs: 500, keyId: 'middle'});
  const segments = f.track('prop').segments; assert.deepEqual(segments.map(item => [item.fromKeyId, item.toKeyId]), [['start', 'middle'], ['middle', 'end']]);
  assert.deepEqual(segments[0].transition.spatialBend, split.leftBend); assert.deepEqual(segments[1].transition.spatialBend, split.rightBend);
  assert.deepEqual(f.sample(500).entityStates.find(item => item.entityId === 'prop').transform.position, sample.transform.position);
  f.save('prop', 1500, 15, 'new-end'); assert(f.track('prop').pathEndpointControls.start); assert.equal(f.track('prop').pathEndpointControls.end, undefined);
});

test('sparse position segment insertion cannot attach a bend across intervening non-position keys', async () => {
  const f = await fixture();
  f.state = f.world.setTemporal(f.state, f.setupId, {durationMs: 3000, tracks: [{id: 'sparse', owner: {kind: 'entity', entityId: 'actor'},
    keys: [{id: 'a', timeMs: 0}, {id: 'pose-only', timeMs: 500}, {id: 'b', timeMs: 1000}], channels: [
      {id: 'position', property: 'entity.transform.position', values: [{keyId: 'a', value: {kind: 'vec3', value: vec(0)}}, {keyId: 'b', value: {kind: 'vec3', value: vec(10)}}]},
      {id: 'pose', property: 'entity.pose', values: [{keyId: 'pose-only', value: {kind: 'pose', value: 'Sitting'}, interpolation: 'hold'}]}
    ]}]}, 2);
  assert(f.sampling.resolveTemporalPathSplit(f.track('actor'), 750)); f.write({type: 'save-key', entityId: 'actor', timeMs: 750, keyId: 'inserted'});
  assert.equal(f.track('actor').segments, undefined);
});

test('uniform speed redistribution changes interior times by path distance and preserves holds and total span', async () => {
  const f = await fixture(); f.save('prop', 0, 0, 'a'); f.save('prop', 100, 1, 'b'); f.save('prop', 1000, 10, 'c');
  const values = structuredClone(f.track('prop').channels); const segments = f.sampling.temporalPositionPathSegments(f.track('prop'));
  const expected = Math.round(1000 * segments[0].length / (segments[0].length + segments[1].length));
  f.write({type: 'redistribute-timing', entityId: 'prop'}); assert.equal(f.track('prop').keys[1].timeMs, expected); assert.deepEqual(f.track('prop').channels, values); assert.equal(f.track('prop').keys.at(-1).timeMs, 1000);
  f.write({type: 'set-key-value', entityId: 'prop', keyId: 'a', property: 'entity.transform.position', value: {kind: 'vec3', value: vec(0)}, interpolation: 'hold'});
  const before = structuredClone(f.state); assert.equal(f.write({type: 'redistribute-timing', entityId: 'prop'}).changed, false); assert.deepEqual(f.state, before);
});

test('authoring permissions reject baseline/shared/locked/missing local states and readonly/playback/scrub', async () => {
  const f = await fixture(); assert.equal(f.write({type: 'save-key', entityId: 'shared', timeMs: 0}).reason, 'baseline-readonly');
  assert.equal(f.write({type: 'set-duration', setupId: 'setup-default', durationMs: 1000}).reason, 'baseline-no-temporal');
  f.state = f.world.patchEntity(f.state, 'actor', {locked: true}, 5); assert.equal(f.write({type: 'save-key', entityId: 'actor', timeMs: 0}).reason, 'locked');
  f.state.scenePlay.worldSpace.entities.push(f.schema.createEntity({id: 'unplaced', kind: 'prop', label: 'unplaced', now: 1}));
  assert.equal(f.write({type: 'save-key', entityId: 'unplaced', timeMs: 0}).reason, 'missing-state');
  for (const [flag, reason] of [['readonly', 'readonly'], ['playing', 'playback'], ['scrubbing', 'scrubbing']]) assert.equal(f.actions.reduceTemporalAction(f.state, {type: 'save-key', entityId: 'cam', timeMs: 0}, {[flag]: true}).reason, reason);
});

test('strict field/type/reference/optic validation fails atomically and never changes inputs', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); f.save('cam', 0, undefined, 'cam-zero'); const before = structuredClone(f.state);
  const bad = [
    {entityId: 'actor', keyId: 'zero', property: 'entity.visibility', value: {kind: 'number', value: 1}},
    {entityId: 'actor', keyId: 'zero', property: 'entity.transform.position', value: {kind: 'vec3', value: {x: 0, y: 0}}},
    {entityId: 'actor', keyId: 'zero', property: 'entity.transform.rotation', value: {kind: 'euler3', value: {x: 0, y: 0, z: 0, order: 'BAD'}}},
    {entityId: 'actor', keyId: 'zero', property: 'entity.transform.scale', value: {kind: 'vec3', value: vec(0)}},
    {entityId: 'actor', keyId: 'zero', property: 'entity.heldEntityId', value: {kind: 'text', value: 'missing'}},
    {entityId: 'actor', keyId: 'zero', property: 'camera.focalLength', value: {kind: 'number', value: 50}},
    {entityId: 'cam', keyId: 'cam-zero', property: 'camera.fov', value: {kind: 'number', value: 180}},
    {entityId: 'cam', keyId: 'cam-zero', property: 'camera.apertureFNumber', value: {kind: 'number', value: -1}},
    {entityId: 'cam', keyId: 'cam-zero', property: 'camera.focus', value: {kind: 'camera-focus', value: {mode: 'object', entityId: 'missing'}}},
    {entityId: 'cam', keyId: 'cam-zero', property: 'camera.rotation', value: {kind: 'euler3', value: {x: 0, y: 0, z: 0}}, interpolation: 'smooth'},
    {entityId: 'actor', keyId: 'zero', property: 'unknown', value: {kind: 'number', value: 1}}
  ];
  for (const action of bad) domain(() => f.write({type: 'set-key-value', ...action}));
  domain(() => f.write({type: 'set-duration', durationMs: NaN})); domain(() => f.write({type: 'set-duration', durationMs: 1000, secret: 'unsupported'}));
  domain(() => f.write({type: 'set-channel', entityId: 'actor', property: 'entity.visibility', values: [{keyId: 'zero', value: {kind: 'boolean', value: true}}, {keyId: 'zero', value: {kind: 'boolean', value: false}}]}));
  domain(() => f.actions.prepareTemporalEdit(f.state, {entityId: 'actor', patch: {pose: 'Sitting', entityId: 'new'}}));
  domain(() => f.actions.prepareTemporalEdit(f.state, {entityId: 'actor', patch: {pose: 'Sitting'}, source: 1}));
  domain(() => f.write({type: 'save-key', entityId: 'actor', timeMs: 0, keyId: ''}));
  domain(() => f.write({type: 'edit-entity', entityId: 'actor', patch: {pose: 'Sitting'}, confirmed: 'true'}));
  assert.deepEqual(f.state, before);
});

test('channel relation targets cannot cross stages and pose fields are actor-only', async () => {
  const f = await fixture(); f.save('actor', 0, 0, 'zero'); f.save('prop', 0, 0, 'prop-zero');
  f.state = f.world.addStage(f.state, f.schema.createStage({worldNodeId: 'temporal', id: 'other-stage', label: 'Other', now: 1}));
  f.state = f.world.addEntity(f.state, f.schema.createEntity({id: 'other-prop', stageId: 'other-stage', kind: 'prop', label: 'Other prop', now: 1}), {setupId: f.schema.initialSetupId('other-stage')});
  domain(() => f.write({type: 'set-key-value', entityId: 'actor', keyId: 'zero', property: 'entity.lookTarget', value: {kind: 'look-target', value: {kind: 'entity', entityId: 'other-prop'}}}));
  domain(() => f.write({type: 'set-key-value', entityId: 'prop', keyId: 'prop-zero', property: 'entity.pose', value: {kind: 'pose', value: 'Sitting'}}));
});

const OFFICIAL_SOURCE = '/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js';
test('pinned official author CRUD agrees for valid canonical tracks, movement and cleanup', {skip: !existsSync(OFFICIAL_SOURCE)}, async () => {
  const f = await fixture(), source = readFileSync(OFFICIAL_SOURCE, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), '85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694');
  const names = ['Qx', 'hW', 'gW', 'yW', 'bW', '$l', 'nk', 'rk', 'fl', 'fW', 'pW', 'tk', 'dW', 'uW', 'FW'];
  const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`); assert(start >= 0);
    let end = source.indexOf('(', start) + 1, depth = 1;
    while (depth) {if (source[end] === '(') depth++; else if (source[end] === ')') depth--; end++;}
    const brace = source.indexOf('{', end); end = brace + 1; depth = 1;
    while (depth) {if (source[end] === '{') depth++; else if (source[end] === '}') depth--; end++;}
    return source.slice(start, end);
  });
  // Only pure author functions run. Imported normalizers are identity clones
  // for these already schema-valid canonical fixtures; no app bundle executes.
  const official = vm.runInNewContext(`const Eo=1000;function qt(x){return structuredClone(x)}function To(x){return {...structuredClone(x),keys:x.keys.slice().sort(fl)}}function Tv(x){return {...x,tracks:[]}}function cW(id){return 'entity-track:'+id}function lW(t,id){return t.owner.entityId===id}function Ii(t,ms){return t?.keys.find(k=>k.timeMs===ms)}function rt(t,id){return t?.tracks.find(t=>t.owner.entityId===id)}function Mv(c,v){return {...c,values:[...c.values.filter(x=>x.keyId!==v.keyId),v]}}${functions.join('\n')};({${names.join(',')}})`, {structuredClone});
  const definition = f.state.scenePlay.worldSpace.entities.find(item => item.id === 'actor');
  let reference;
  for (const [at, x, id] of [[0, 0, 'zero'], [1000, 10, 'end'], [1000, 15, 'ignored']]) {
    const snapshot = f.local('actor'); snapshot.transform.position = vec(x);
    reference = official.Qx({temporal: reference, entity: definition, state: snapshot, timeMs: at, createId: () => id});
    f.write({type: 'save-key', entityId: 'actor', timeMs: at, keyId: id, snapshot});
  }
  const normalized = temporal => JSON.parse(JSON.stringify(temporal));
  assert.deepEqual(normalized(f.state.scenePlay.worldSpace.setups[1].temporal), normalized(reference));
  reference = official.pW({temporal: reference, trackId: reference.tracks[0].id, keyId: 'end', toTimeMs: -500}); f.write({type: 'move-key', entityId: 'actor', keyId: 'end', timeMs: -500});
  assert.deepEqual(normalized(f.state.scenePlay.worldSpace.setups[1].temporal), normalized(reference));
  reference = official.fW({temporal: reference, trackId: reference.tracks[0].id, keyId: 'zero'}); f.write({type: 'remove-key', entityId: 'actor', keyId: 'zero'});
  assert.deepEqual(normalized(f.track('actor').channels), normalized(reference.tracks[0].channels)); assert.deepEqual(normalized(f.track('actor').keys), normalized(reference.tracks[0].keys));
});
