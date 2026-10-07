const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs')]);
const identity = {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}};
const placed = {position: {x: 8, y: 3, z: -4}, rotation: {x: .1, y: .5, z: -.2, order: 'YXZ'}, scale: {x: 2, y: 2.5, z: .8}};
async function fixture() {
  const [actions, schema, world] = await modules;return {actions, schema, world, state: schema.createState({worldNodeId: 'menu-actions-owner', now: 100})};
}
const reduce = (f, state, action, now = 101) => f.actions.reduceEntityAction(state, action, {now});
const create = (f, state, kind, extra = {}) => reduce(f, state, {type: 'create', kind, id: kind + '-a', ...(kind === 'actor' ? {roleId: 'role-a'} : kind === 'prop' ? {assetId: 'chair-office'} : {}), transform: placed, ...extra}).state;
const control = (f, state, entityId, setupId) => f.actions.resolveEntityControl(state, {entityId, setupId});
test('actor and prop restore placement means identity, preserving role, pose, appearance and assets rather than creation transform', async () => {
  const f = await fixture();
  for (const kind of ['actor', 'prop']) {
    const state = create(f, f.state, kind, {locked: true}), before = control(f, state, kind + '-a'), restored = reduce(f, state, {type: 'restore-placement', entityId: kind + '-a'}, 102), after = control(f, restored.state, kind + '-a');
    assert.equal(restored.ok, true);assert.equal(restored.lane, 'setup:setup:state-1');assert.deepEqual(after.setupState.transform, identity);assert.deepEqual(after.definition, before.definition);assert.equal(after.setupState.visible, before.setupState.visible);assert.equal(after.setupState.pose, before.setupState.pose);assert.equal(after.locked, true);assert.deepEqual(control(f, state, kind + '-a').setupState.transform, placed);
  }
});
test('camera restore resets only placement to 1.6m and retains exact focal/FOV/ratio/aperture/focus/look and mode', async () => {
  const f = await fixture();let state = create(f, f.state, 'actor');state = create(f, state, 'camera', {camera: {focalLength: 85, frameAspectRatio: 2.35, apertureFNumber: 1.4, depthOfFieldMode: 'deepFocus', focusDistance: 7, focus: {mode: 'object', entityId: 'actor-a', offset: {x: 0, y: 1.7, z: 0}}, lookAt: {mode: 'entity', entityId: 'actor-a'}}});
  const before = control(f, state, 'camera-a'), restored = reduce(f, state, {type: 'restore-placement', entityId: 'camera-a'}, 102), after = control(f, restored.state, 'camera-a'), {position: oldPosition, rotation: oldRotation, ...optics} = before.setupState.camera;
  const {position, rotation, ...retained} = after.setupState.camera;assert.equal(restored.ok, true);assert.deepEqual(position, {x: 0, y: 1.6, z: 0});assert.deepEqual(rotation, {x: 0, y: 0, z: 0, order: 'XYZ'});assert.deepEqual(after.setupState.transform, {...identity, position: {x: 0, y: 1.6, z: 0}});assert.deepEqual(retained, optics);assert.deepEqual(after.definition, before.definition);assert.deepEqual(control(f, state, 'camera-a').setupState.camera.position, oldPosition);
});
test('camera without state requires actual navigation fallback, does not invent optics, and restore becomes no-op after exact identity reset', async () => {
  const f = await fixture();let state = create(f, f.state, 'camera'), w = structuredClone(state);delete w.scenePlay.worldSpace.setups[1].entityStates[0].camera;f.schema.assertState(w);
  const missing = reduce(f, w, {type: 'restore-placement', entityId: 'camera-a'});assert.equal(missing.ok, false);assert.equal(missing.reason, 'camera-state-unavailable');assert.equal(missing.state, w);
  const fallback = {position: {x: 8, y: 2, z: 5}, rotation: {x: 0, y: .3, z: 0, order: 'YXZ'}, fov: 40, focalLength: 46, frameAspectRatio: 1.85, apertureFNumber: 5.6, depthOfFieldMode: 'deepFocus', focusDistance: 8};
  const restored = reduce(f, w, {type: 'restore-placement', entityId: 'camera-a', fallbackCamera: fallback}, 102);assert.equal(control(f, restored.state, 'camera-a').setupState.camera.focalLength, 46);assert.deepEqual(fallback.position, {x: 8, y: 2, z: 5});
  const noop = reduce(f, restored.state, {type: 'restore-placement', entityId: 'camera-a'}, 103);assert.equal(noop.state, restored.state);assert.equal(noop.changed, false);
});
test('restore obeys baseline local read-only boundary and explicit baseline restore uses world lane', async () => {
  const f = await fixture(), state = create(f, f.state, 'actor', {setupId: 'setup-default'}), denied = reduce(f, state, {type: 'restore-placement', entityId: 'actor-a'});
  assert.equal(denied.reason, 'baseline-readonly');assert.equal(denied.state, state);assert.equal(denied.suggestedSetupId, 'setup-default');
  const restored = reduce(f, state, {type: 'restore-placement', entityId: 'actor-a', setupId: 'setup-default'}, 102);assert.equal(restored.lane, 'world');assert.deepEqual(control(f, restored.state, 'actor-a').setupState.transform, identity);assert.equal(restored.state.scenePlay.worldSpace.setups[1].entityStates.length, 0);
});
test('remove local inherited baseline resolves owner and deletes definition and all setup instances while retaining independent role', async () => {
  const f = await fixture(), state = create(f, f.state, 'actor', {setupId: 'setup-default'}), before = control(f, state, 'actor-a'), removed = reduce(f, state, {type: 'remove', entityId: 'actor-a', mode: 'local'}, 102), w = removed.state.scenePlay.worldSpace;
  assert.equal(before.baselineReadOnly, true);assert.equal(before.ownerSetupId, 'setup-default');assert.equal(removed.ok, true);assert.equal(removed.removal, 'global');assert.equal(removed.lane, 'world');assert.deepEqual(w.entities, []);assert.ok(w.setups.every(setup => setup.entityStates.length === 0));assert.equal(w.characterRoles.length, 1);assert.equal(state.scenePlay.worldSpace.entities.length, 1);
});
test('only actors and props have lock actions, camera requests fail without applying accompanying world fields', async () => {
  const f = await fixture(), state = create(f, f.state, 'camera');assert.equal(control(f, state, 'camera-a').canToggleLock, false);
  const denied = reduce(f, state, {type: 'update', entityId: 'camera-a', patch: {label: '不能部分改名', locked: true}});assert.equal(denied.reason, 'entity-not-lockable');assert.equal(denied.state, state);
  for (const locked of [true, false]) assert.throws(() => create(f, f.state, 'camera', {locked}), error => error.name === 'StudioDomainError');
  for (const kind of ['actor', 'prop']) {const actor = create(f, f.state, kind);assert.equal(control(f, actor, kind + '-a').canToggleLock, true);assert.equal(reduce(f, actor, {type: 'update', entityId: kind + '-a', patch: {locked: true}}, 102).ok, true);}
});
test('any nonempty keyed track across the whole world blocks new lock, including no channels; empty tracks permit lock and animated locked can unlock', async () => {
  const f = await fixture();let state = create(f, f.state, 'actor');state = f.world.addSetup(state, f.schema.createIndependentSetup({id: 'setup-other', now: 101}));state = f.world.addEntityState(state, 'setup-other', f.schema.createSetupState('actor-a', 101));
  const track = keys => ({durationMs: 500, tracks: [{id: 'track-other', owner: {kind: 'entity', entityId: 'actor-a'}, keys, channels: []}]});
  const empty = f.world.setTemporal(state, 'setup-other', track([]), 102);assert.equal(control(f, empty, 'actor-a').animated, false);assert.equal(reduce(f, empty, {type: 'update', entityId: 'actor-a', patch: {locked: true}}, 103).ok, true);
  const keyed = f.world.setTemporal(state, 'setup-other', track([{id: 'key-other', timeMs: 500}]), 102), read = control(f, keyed, 'actor-a');assert.equal(read.animated, true);assert.equal(read.lockDisabled, true);
  const denied = reduce(f, keyed, {type: 'update', entityId: 'actor-a', patch: {locked: true, color: '#ff0000'}}, 103);assert.equal(denied.reason, 'entity-animated');assert.match(denied.message, /有动画.*不能锁定/);assert.equal(denied.state, keyed);
  const locked = f.world.patchEntity(keyed, 'actor-a', {locked: true}, 103);assert.equal(control(f, locked, 'actor-a').lockDisabled, false);const unlocked = reduce(f, locked, {type: 'update', entityId: 'actor-a', patch: {locked: false}}, 104);assert.equal(unlocked.ok, true);assert.equal(unlocked.lane, 'world');assert.equal(control(f, unlocked.state, 'actor-a').locked, false);
});
