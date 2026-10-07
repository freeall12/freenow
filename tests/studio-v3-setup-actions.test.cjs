const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/setup-actions.mjs'), import('../src/features/studio-v3/history.mjs')]);
async function fixture() {
  const [schema, world, actions, history] = await modules;
  let state = schema.createState({worldNodeId: 'setup-owner', now: 1});
  const role = schema.createRole({id: 'actor-role', label: '角色', now: 1});
  state = world.addRole(state, role);
  state = world.addEntity(state, schema.createActorFromRole({id: 'actor', role, now: 1}));
  state = world.addEntity(state, schema.createEntity({id: 'shared', kind: 'prop', label: '基准道具', now: 1}), {setupId: 'setup-default'});
  const camera = {position: {x: 2, y: 1, z: 3}, rotation: {x: 0, y: 0, z: 0}, fov: 50, focus: {mode: 'object', entityId: 'actor'}, lookAt: {mode: 'entity', entityId: 'actor'}};
  state = world.addEntity(state, schema.createEntity({id: 'camera', kind: 'camera', label: '镜头', now: 1}), {setupState: {...schema.createSetupState('camera', 1), camera}});
  state = world.patchEntityState(state, 'setup:state-1', 'actor', {lookTarget: {kind: 'entity', entityId: 'shared'}, heldEntityId: 'camera'}, 2);
  state = world.addView(state, schema.createView({id: 'view', label: '机位', camera, sourceCameraEntityId: 'camera', now: 2}), {activate: true});
  state = world.addOutput(state, {id: 'output', source: {kind: 'view', id: 'view'}});
  state = world.addReference(state, {id: 'reference', targets: [{kind: 'setup', id: 'setup:state-1'}, {kind: 'entity', id: 'actor'}, {kind: 'view', id: 'view'}, {kind: 'entity', id: 'shared'}]});
  const createId = (kind, id) => `copy:${kind}:${id}`;
  return {schema, world, actions, history, state, camera, createId};
}
test('clone creates fresh local entity/role/view IDs, preserves shared baseline and remaps targets', async () => {
  const f = await fixture(), before = structuredClone(f.state), next = f.actions.cloneIndependentSetup(f.state, 'setup:state-1', {createId: f.createId, now: 5}), space = next.scenePlay.worldSpace;
  const setup = space.setups.at(-1), actor = setup.entityStates.find(item => item.entityId === 'copy:entity:actor'), camera = setup.entityStates.find(item => item.entityId === 'copy:entity:camera');
  assert.equal(setup.id, 'copy:setup:setup:state-1'); assert.equal(setup.label, 'State 1 副本');
  assert.deepEqual(actor.lookTarget, {kind: 'entity', entityId: 'shared'}); assert.equal(actor.heldEntityId, 'copy:entity:camera');
  assert.equal(camera.camera.focus.entityId, 'copy:entity:actor'); assert.equal(camera.camera.lookAt.entityId, 'copy:entity:actor');
  assert.equal(space.entities.find(item => item.id === 'copy:entity:actor').roleId, 'copy:role:actor-role');
  assert.equal(space.views.at(-1).setupId, setup.id); assert.equal(space.views.at(-1).sourceCameraEntityId, 'copy:entity:camera'); assert.equal(space.views.at(-1).camera.focus.entityId, 'copy:entity:actor');
  assert.equal(space.entities.filter(item => item.id === 'shared').length, 1); assert.equal(f.world.renderSetup(next).entityStates[0].entityId, 'shared');
  assert.equal(space.outputs.length, 1); assert.equal(space.references.length, 1); assert.equal(space.activeViewId, null);
  assert.deepEqual(f.state, before); assert.equal(f.schema.assertState(next), next);
});
test('clone keeps local temporal IDs but remaps owners and entity-valued channels', async () => {
  const f = await fixture();
  const state = f.world.setTemporal(f.state, 'setup:state-1', {durationMs: 1000, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'actor'}, keys: [{id: 'key', timeMs: 0}], channels: [
    {id: 'held', property: 'entity.heldEntityId', values: [{keyId: 'key', value: {kind: 'text', value: 'camera'}}]},
    {id: 'look', property: 'entity.lookTarget', values: [{keyId: 'key', value: {kind: 'look-target', value: {kind: 'entity', entityId: 'shared'}}}]}
  ]}]}, 3);
  const next = f.actions.cloneIndependentSetup(state, 'setup:state-1', {createId: f.createId, now: 5}), track = next.scenePlay.worldSpace.setups.at(-1).temporal.tracks[0];
  assert.equal(track.id, 'track'); assert.equal(track.keys[0].id, 'key'); assert.equal(track.owner.entityId, 'copy:entity:actor');
  assert.equal(track.channels[0].values[0].value.value, 'copy:entity:camera'); assert.equal(track.channels[1].values[0].value.value.entityId, 'shared');
});
test('cloning inactive state works without changing original and rejects reused IDs atomically', async () => {
  const f = await fixture(), source = f.world.addSetup(f.state, f.schema.createIndependentSetup({id: 'other', now: 3}), {activate: true});
  const next = f.actions.cloneIndependentSetup(source, 'setup:state-1', {createId: f.createId, activate: false, label: '分镜副本', now: 5});
  assert.equal(next.scenePlay.worldSpace.activeSetupId, 'other'); assert.equal(next.scenePlay.worldSpace.setups.at(-1).label, '分镜副本');
  assert.throws(() => f.actions.cloneIndependentSetup(source, 'setup:state-1', {createId: () => 'actor', now: 5}), /unique/);
  assert.throws(() => f.actions.cloneIndependentSetup(source, 'setup-default', {createId: f.createId, now: 5}), /independent/);
});
test('deleting last independent state replaces it, removes private entities/roles/views/output and filters reference targets', async () => {
  const f = await fixture(), before = structuredClone(f.state), next = f.actions.removeIndependentSetup(f.state, 'setup:state-1', {replacementId: 'fresh', now: 5}), space = next.scenePlay.worldSpace;
  assert.equal(space.activeSetupId, 'fresh'); assert.equal(space.setups[1].label, '状态 1'); assert.deepEqual(space.setups[1].entityStates, []);
  assert.deepEqual(space.entities.map(item => item.id), ['shared']); assert.deepEqual(space.characterRoles, []); assert.deepEqual(space.views, []); assert.deepEqual(space.outputs, []); assert.equal(space.activeViewId, null);
  assert.deepEqual(space.references[0].targets, [{kind: 'entity', id: 'shared'}]); assert.deepEqual(f.state, before);
});
test('deletion retains shared local instances and roles, prunes only candidate roles and switches to first remaining state', async () => {
  const f = await fixture();
  let state = f.world.addSetup(f.state, f.schema.createIndependentSetup({id: 'other', now: 3}));
  state = f.world.addEntityState(state, 'other', f.schema.createSetupState('actor', 3));
  state = f.world.addRole(state, f.schema.createRole({id: 'unrelated-unused', label: '未使用角色', now: 3}));
  const next = f.actions.removeIndependentSetup(state, 'setup:state-1', {now: 5}), space = next.scenePlay.worldSpace;
  assert.equal(space.activeSetupId, 'other'); assert.deepEqual(space.entities.map(item => item.id), ['actor', 'shared']);
  assert.deepEqual(space.characterRoles.map(item => item.id), ['actor-role', 'unrelated-unused']);
});
test('baseline/missing deletion is no-op, last replacement ID is required and collision is rejected', async () => {
  const f = await fixture();
  assert.equal(f.actions.removeIndependentSetup(f.state, 'setup-default'), f.state); assert.equal(f.actions.removeIndependentSetup(f.state, 'missing'), f.state);
  assert.throws(() => f.actions.removeIndependentSetup(f.state, 'setup:state-1'), /fresh/);
  assert.throws(() => f.actions.removeIndependentSetup(f.state, 'setup:state-1', {replacementId: 'setup-default'}), /fresh/);
});
test('clone and delete each produce one undoable world transaction with exact state recovery', async () => {
  const f = await fixture(), engine = f.history.createHistory(f.state);
  engine.transact('world', '复制状态', state => f.actions.cloneIndependentSetup(state, 'setup:state-1', {createId: f.createId, now: 5}));
  const copied = engine.getState();
  engine.transact('world', '删除状态', state => f.actions.removeIndependentSetup(state, 'copy:setup:setup:state-1', {now: 6}));
  assert.equal(engine.getHistory().lanes.world.undoStack.length, 2); assert.equal(engine.undo('world').ok, true); assert.deepEqual(engine.getState(), copied);
  assert.equal(engine.undo('world').ok, true); assert.deepEqual(engine.getState(), f.state);
  assert.equal(engine.redo('world').ok, true); assert.deepEqual(engine.getState(), copied); assert.equal(engine.redo('world').ok, true);
});
