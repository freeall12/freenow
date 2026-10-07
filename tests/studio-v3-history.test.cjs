const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
  import('../src/features/studio-v3/history.mjs'), import('../src/features/studio-v3/history-patches.mjs')
]);
async function fixture() {
  const [schema, world, history, patches] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 100});
  state = world.addEntity(state, schema.createEntity({id: 'prop-a', label: 'A', kind: 'prop', now: 100}));
  state = world.addSetup(state, schema.createIndependentSetup({id: 'setup-b', now: 100}));
  state = world.addEntity(state, schema.createEntity({id: 'prop-b', label: 'B', kind: 'prop', now: 100}), {setupId: 'setup-b'});
  let id = 0;
  const engine = history.createHistory(state, {createId: () => `record-${++id}`, now: () => 1000});
  return {schema, world, history, patches, state, engine, a: history.setupLane('setup:state-1'), b: history.setupLane('setup-b')};
}
const rename = (f, id, name, now = 101) => state => f.world.patchEntity(state, id, {label: name}, now);

test('a drag preview commits once with granular forward and inverse patches, never whole-world records', async () => {
  const f = await fixture(), initial = f.engine.getState();
  assert.equal(f.engine.begin('director', 'director.moveEntity'), true);
  assert.equal(f.engine.begin('world', 'nested'), false);
  for (let x = 1; x <= 3; x++) f.engine.preview(state => f.world.patchEntityState(state, 'setup:state-1', 'prop-a', {transform: {position: {x, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}}}, 101));
  assert.equal(f.engine.getHistory().nextSequence, 1); assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'transaction-active'});
  assert.equal(f.engine.commit(), true);
  const record = f.engine.getHistory().lanes[f.a].undoStack[0];
  assert.equal(record.sequence, 1); assert.equal(record.lane, f.a); assert.equal(record.createdAt, 1000);
  assert.deepEqual(record.forward.map(patch => patch.type), ['setup.patchMeta', 'setupState.upsert']);
  assert.deepEqual(record.touched.setupIds, ['setup:state-1']);
  assert.equal('before' in record, false); assert.equal('worldSpace' in record, false);
  assert.equal(record.forward.some(patch => 'worldSpace' in patch), false);
  const after = f.engine.getState(); assert.deepEqual(f.engine.undo(f.a), {ok: true}); assert.deepEqual(f.engine.getState(), initial);
  assert.deepEqual(f.engine.redo(f.a), {ok: true}); assert.deepEqual(f.engine.getState(), after);
});
test('cancel restores the exact transaction baseline and preserves all history lanes and sequence', async () => {
  const f = await fixture(); f.engine.transact(f.b, 'rename B', rename(f, 'prop-b', 'B2'));
  const before = f.engine.getState(), history = f.engine.getHistory();
  f.engine.begin(f.a, 'preview'); f.engine.preview(rename(f, 'prop-a', 'Temporary')); f.engine.preview(rename(f, 'prop-b', 'Temporary B'));
  assert.equal(f.engine.cancel(), true); assert.deepEqual(f.engine.getState(), before); assert.deepEqual(f.engine.getHistory(), history);
  assert.equal(f.engine.cancel(), false); assert.equal(f.engine.commit(), false);
});
test('no change and preview-return-to-baseline produce no record and no sequence increment', async () => {
  const f = await fixture(); f.engine.begin(f.a, 'same'); assert.equal(f.engine.preview(state => state), false); assert.equal(f.engine.commit(), false);
  const original = f.engine.getState(); f.engine.begin(f.a, 'back'); f.engine.preview(rename(f, 'prop-a', 'Changed')); f.engine.preview(() => original); assert.equal(f.engine.commit(), false);
  assert.equal(f.engine.getHistory().nextSequence, 1); assert.deepEqual(f.engine.getHistory().lanes, {world: {undoStack: [], redoStack: []}});
  f.engine.begin('scout', 'no-op field'); assert.equal(f.engine.preview(rename(f, 'prop-a', 'A')), false); assert.equal(f.engine.commit(), false);
});
test('invalid previews and reducer errors cannot leak mutation; transact rolls back on error', async () => {
  const f = await fixture(), before = f.engine.getState(); f.engine.begin('world', 'invalid');
  assert.throws(() => f.engine.preview(state => {state.scenePlay.worldSpace.entities[0].label = ''; return state;}));
  assert.deepEqual(f.engine.getState(), before);
  assert.throws(() => f.engine.preview(state => {state.scenePlay.worldSpace.entities[0].label = 'Leaked'; throw Error('failed');}), /failed/);
  assert.deepEqual(f.engine.getState(), before); f.engine.cancel();
  assert.throws(() => f.engine.transact('world', 'throw', () => {throw Error('failed');}), /failed/);
  assert.equal(f.engine.getActiveTransaction(), null); assert.deepEqual(f.engine.getState(), before);
  f.engine.begin('world', 'async'); assert.throws(() => f.engine.preview(async state => state), /synchronously/); f.engine.cancel();
});
test('out-of-scope envelope, owner and environment writes are rejected atomically', async () => {
  const f = await fixture(), before = f.engine.getState(); f.engine.begin('world', 'world edit');
  for (const reducer of [
    state => {state.scenePlay.id = 'another-session'; return state;},
    state => {state.scenePlay.environment.ground = {groundY: 2}; return state;},
    state => {state.capturedPhotos.push({id: 'photo'}); return state;}
  ]) assert.throws(() => f.engine.preview(reducer), error => error.code === 'out-of-scope');
  assert.deepEqual(f.engine.getState(), before); f.engine.cancel();
  f.engine.begin('world', 'lighting only', {kind: 'environment', fields: ['lighting']});
  assert.throws(() => f.engine.preview(state => {state.scenePlay.environment.ground = {}; state.scenePlay.environment.skyboxSource = {kind: 'lighting'}; return state;}), error => error.code === 'out-of-scope');
  assert.throws(() => f.engine.preview(rename(f, 'prop-a', 'Changed')), error => error.code === 'out-of-scope'); f.engine.cancel();
});
test('cross-lane later overlapping entity edit blocks undo without changing state or history', async () => {
  const f = await fixture(); f.engine.transact(f.a, 'A edit', rename(f, 'prop-a', 'First')); f.engine.transact(f.b, 'B edits same definition', rename(f, 'prop-a', 'Second', 102));
  const state = f.engine.getState(), history = f.engine.getHistory();
  assert.deepEqual(f.engine.getUndoAvailability(f.a), {ok: false, reason: 'conflict'}); assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'conflict'});
  assert.deepEqual(f.engine.getState(), state); assert.deepEqual(f.engine.getHistory(), history);
  assert.deepEqual(f.engine.undo(f.b), {ok: true}); assert.deepEqual(f.engine.undo(f.a), {ok: true}); assert.deepEqual(f.engine.getState(), f.state);
});
test('disjoint setup/entity edits can undo independently while global sequence stays ordered', async () => {
  const f = await fixture(); f.engine.transact(f.a, 'A', rename(f, 'prop-a', 'A2')); f.engine.transact(f.b, 'B', rename(f, 'prop-b', 'B2'));
  assert.deepEqual(f.engine.undo(f.a), {ok: true}); const space = f.engine.getState().scenePlay.worldSpace;
  assert.equal(space.entities.find(item => item.id === 'prop-a').label, 'A'); assert.equal(space.entities.find(item => item.id === 'prop-b').label, 'B2');
  assert.deepEqual(f.engine.redo(f.a), {ok: true}); assert.equal(f.engine.getHistory().lanes[f.a].undoStack[0].sequence, 3);
  assert.equal(f.engine.getHistory().nextSequence, 4);
});
test('local state edits of the same definition in two setups remain independent lanes', async () => {
  const f = await fixture(); let state = f.world.addEntityState(f.state, 'setup-b', f.schema.createSetupState('prop-a', 100));
  const engine = f.history.createHistory(state);
  engine.transact(f.a, 'hide A', value => f.world.patchEntityState(value, 'setup:state-1', 'prop-a', {visible: false}, 101));
  engine.transact(f.b, 'hide B', value => f.world.patchEntityState(value, 'setup-b', 'prop-a', {visible: false}, 101));
  assert.deepEqual(engine.undo(f.a), {ok: true}); const setups = engine.getState().scenePlay.worldSpace.setups;
  assert.equal(setups.find(setup => setup.id === 'setup:state-1').entityStates.find(item => item.entityId === 'prop-a').visible, true);
  assert.equal(setups.find(setup => setup.id === 'setup-b').entityStates.find(item => item.entityId === 'prop-a').visible, false);
});
test('redo detects a later overlapping record in another lane', async () => {
  const f = await fixture(); f.engine.transact(f.a, 'A', rename(f, 'prop-a', 'First')); f.engine.undo(f.a);
  f.engine.transact(f.b, 'B', rename(f, 'prop-a', 'Second'));
  assert.deepEqual(f.engine.getRedoAvailability(f.a), {ok: false, reason: 'conflict'}); assert.deepEqual(f.engine.redo(f.a), {ok: false, reason: 'conflict'});
});
test('new commits clear only their own redo lane', async () => {
  const f = await fixture(); f.engine.transact(f.a, 'A', rename(f, 'prop-a', 'A2')); f.engine.transact(f.b, 'B', rename(f, 'prop-b', 'B2'));
  f.engine.undo(f.a); f.engine.undo(f.b); f.engine.transact(f.a, 'A3', rename(f, 'prop-a', 'A3'));
  assert.equal(f.engine.getHistory().lanes[f.a].redoStack.length, 0); assert.equal(f.engine.getHistory().lanes[f.b].redoStack.length, 1);
  assert.deepEqual(f.engine.redo(f.b), {ok: true});
});
test('each lane retains 50 records, undo keeps sequence and redo assigns fresh sequence', async () => {
  const f = await fixture();
  for (let index = 0; index < 51; index++) f.engine.transact(f.a, `A ${index}`, rename(f, 'prop-a', `Name ${index}`, 101 + index));
  f.engine.transact(f.b, 'B', rename(f, 'prop-b', 'B2', 152));
  assert.equal(f.engine.getHistory().lanes[f.a].undoStack.length, 50); assert.equal(f.engine.getHistory().lanes[f.b].undoStack.length, 1);
  assert.equal(f.engine.getHistory().lanes[f.a].undoStack[0].sequence, 2);
  for (let index = 0; index < 50; index++) assert.deepEqual(f.engine.undo(f.a), {ok: true});
  assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'empty'}); assert.equal(f.engine.getHistory().nextSequence, 53);
  assert.equal(f.engine.getState().scenePlay.worldSpace.entities[0].label, 'Name 0');
  assert.deepEqual(f.engine.redo(f.a), {ok: true}); assert.equal(f.engine.getHistory().lanes[f.a].undoStack[0].sequence, 53);
});
test('environment patches preserve unselected fields and conflict across lanes as official n1', async () => {
  const f = await fixture(), initial = f.engine.getState();
  f.engine.transact('world', 'ground', state => {state.scenePlay.environment.ground = {groundY: 2}; return state;}, {kind: 'environment', fields: ['ground']});
  const record = f.engine.getHistory().lanes.world.undoStack[0]; assert.deepEqual(record.forward, [{type: 'environment.set', field: 'ground', value: {groundY: 2}}]);
  f.engine.transact(f.a, 'lighting', state => {state.scenePlay.environment.lighting = {intensity: 2}; return state;}, {kind: 'environment', fields: ['lighting']});
  assert.deepEqual(f.engine.undo('world'), {ok: false, reason: 'conflict'}); f.engine.undo(f.a); f.engine.undo('world'); assert.deepEqual(f.engine.getState(), initial);
});
test('cascade undo restores entity order, dependent views/outputs/references and active view exactly', async () => {
  const f = await fixture(), xyz = {x: 0, y: 0, z: 0};
  let state = f.world.addEntity(f.state, f.schema.createEntity({id: 'camera', kind: 'camera', label: 'Camera', now: 100}));
  state = f.world.addView(state, f.schema.createView({id: 'view', label: 'View', sourceCameraEntityId: 'camera', camera: {position: xyz, rotation: xyz, fov: 45}, now: 100}), {activate: true});
  state = f.world.addReference(state, {id: 'ref', targets: [{kind: 'entity', id: 'camera'}, {kind: 'view', id: 'view'}]});
  state = f.world.addOutput(state, {id: 'output', source: {kind: 'view', id: 'view'}});
  const engine = f.history.createHistory(state); engine.transact(f.a, 'delete camera', value => f.world.removeEntity(value, 'camera', 101));
  const removed = engine.getState(), types = engine.getHistory().lanes[f.a].undoStack[0].forward.map(patch => patch.type);
  for (const type of ['entity.remove', 'setupState.remove', 'view.remove', 'reference.upsert', 'output.remove', 'world.setActive']) assert.ok(types.includes(type), type);
  assert.deepEqual(engine.undo(f.a), {ok: true}); assert.deepEqual(engine.getState(), state);
  assert.deepEqual(engine.redo(f.a), {ok: true}); assert.deepEqual(engine.getState(), removed);
});
test('stage and setup creation produce item patches with reversible relationships', async () => {
  const f = await fixture(), initial = f.engine.getState();
  f.engine.transact('world', 'stage', state => f.world.addStage(state, f.schema.createStage({id: 'second-stage', worldNodeId: 'owner', now: 100}), {activate: true}));
  const record = f.engine.getHistory().lanes.world.undoStack[0]; assert.ok(record.forward.some(patch => patch.type === 'stage.upsert'));
  assert.equal(record.forward.filter(patch => patch.type === 'setup.upsert').length, 2);
  const after = f.engine.getState(); f.engine.undo('world'); assert.deepEqual(f.engine.getState(), initial); f.engine.redo('world'); assert.deepEqual(f.engine.getState(), after);
});
test('late dependent reference prevents undoing its entity creation', async () => {
  const f = await fixture();
  f.engine.transact(f.a, 'add prop', state => f.world.addEntity(state, f.schema.createEntity({id: 'new-prop', label: 'New', kind: 'prop', now: 100})));
  f.engine.transact(f.b, 'reference prop', state => f.world.addReference(state, {id: 'new-reference', targets: [{kind: 'entity', id: 'new-prop'}]}));
  assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'conflict'});
  f.engine.undo(f.b); assert.deepEqual(f.engine.undo(f.a), {ok: true});
});
test('late role use blocks role creation undo while disjoint role reads do not collide', async () => {
  const f = await fixture();
  f.engine.transact(f.a, 'role', state => f.world.addRole(state, f.schema.createRole({id: 'role', label: 'Role', now: 100})));
  f.engine.transact(f.b, 'actor', state => f.world.addEntity(state, f.schema.createEntity({id: 'actor', roleId: 'role', kind: 'actor', label: 'Actor', now: 100}), {setupId: 'setup-b'}));
  assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'conflict'});
  f.engine.undo(f.b); assert.deepEqual(f.engine.undo(f.a), {ok: true});
});
test('late stage role and active selection dependencies both prevent orphaning stage undo', async () => {
  for (const dependent of ['role', 'selection']) {
    const f = await fixture();
    f.engine.transact('world', 'stage', state => f.world.addStage(state, f.schema.createStage({id: 'stage-2', worldNodeId: 'owner', now: 100})));
    f.engine.transact(f.a, dependent, state => dependent === 'role' ?
      f.world.addRole(state, f.schema.createRole({id: 'role-2', stageId: 'stage-2', label: 'Role', now: 100})) : f.world.setActiveSetup(state, 'setup:stage-2:state-1'));
    assert.deepEqual(f.engine.undo('world'), {ok: false, reason: 'conflict'}, dependent);
    f.engine.undo(f.a); assert.deepEqual(f.engine.undo('world'), {ok: true}); assert.deepEqual(f.engine.getState(), f.state);
  }
});
test('late temporal or setup-state target references prevent entity creation undo', async () => {
  const f = await fixture();
  f.engine.transact(f.a, 'target', state => f.world.addEntity(state, f.schema.createEntity({id: 'target', label: 'Target', kind: 'prop', now: 100})));
  f.engine.transact(f.b, 'look target', state => f.world.patchEntityState(state, 'setup-b', 'prop-b', {lookTarget: {kind: 'entity', entityId: 'target'}}, 101));
  assert.deepEqual(f.engine.undo(f.a), {ok: false, reason: 'conflict'});
  f.engine.undo(f.b); assert.deepEqual(f.engine.undo(f.a), {ok: true});
});
test('interleaved camera view/output cascade restores the exact original array order', async () => {
  const f = await fixture(), xyz = {x: 0, y: 0, z: 0};
  let state = f.world.addEntity(f.state, f.schema.createEntity({id: 'camera', kind: 'camera', label: 'Camera', now: 100}));
  for (const id of ['A', 'B', 'C', 'D']) {
    state = f.world.addView(state, f.schema.createView({id, label: id, ...['A', 'C'].includes(id) ? {sourceCameraEntityId: 'camera'} : {}, camera: {position: xyz, rotation: xyz, fov: 45}, now: 100}));
    state = f.world.addOutput(state, {id: `output-${id}`, source: {kind: 'view', id}});
  }
  const engine = f.history.createHistory(state); engine.transact(f.a, 'delete', value => f.world.removeEntity(value, 'camera', 101));
  const removed = engine.getState(); assert.deepEqual(removed.scenePlay.worldSpace.views.map(view => view.id), ['B', 'D']);
  engine.undo(f.a); assert.deepEqual(engine.getState(), state); engine.redo(f.a); assert.deepEqual(engine.getState(), removed);
});
test('interleaved collection/state removals restore neighbouring IDs even with reversed inverses', async () => {
  const f = await fixture(); let state = f.state;
  for (const id of ['prop-c', 'prop-d']) state = f.world.addEntity(state, f.schema.createEntity({id, label: id, kind: 'prop', now: 100}));
  const removed = f.world.removeEntity(f.world.removeEntity(state, 'prop-a', 101), 'prop-c', 101), diff = f.patches.diffState(state, removed);
  assert.deepEqual(f.patches.applyPatches(removed, diff.inverse), state);
  const setups = f.world.addSetup(f.world.addSetup(state, f.schema.createIndependentSetup({id: 'setup-c', now: 100})), f.schema.createIndependentSetup({id: 'setup-d', now: 100}));
  const fewer = structuredClone(setups); fewer.scenePlay.worldSpace.setups = fewer.scenePlay.worldSpace.setups.filter(setup => !['setup-b', 'setup-c'].includes(setup.id));
  fewer.scenePlay.worldSpace.entities = fewer.scenePlay.worldSpace.entities.filter(entity => entity.id !== 'prop-b');
  const setupDiff = f.patches.diffState(setups, fewer); assert.deepEqual(f.patches.applyPatches(fewer, setupDiff.inverse), setups);
});
test('later removal of both restoration anchors blocks undo in another lane', async () => {
  const f = await fixture(), xyz = {x: 0, y: 0, z: 0}; let state = f.state;
  for (const id of ['A', 'B', 'C', 'D', 'E']) state = f.world.addView(state, f.schema.createView({id, label: id, camera: {position: xyz, rotation: xyz, fov: 45}, now: 100}), {activate: false});
  const engine = f.history.createHistory(state);
  engine.transact(f.a, 'remove B', value => f.world.removeView(value, 'B'));
  engine.transact(f.b, 'remove anchors A/C', value => f.world.removeView(f.world.removeView(value, 'A'), 'C'));
  assert.deepEqual(engine.getState().scenePlay.worldSpace.views.map(view => view.id), ['D', 'E']);
  const before = engine.getState(); assert.deepEqual(engine.getUndoAvailability(f.a), {ok: false, reason: 'conflict'});
  assert.deepEqual(engine.undo(f.a), {ok: false, reason: 'conflict'}); assert.deepEqual(engine.getState(), before);
  engine.undo(f.b); engine.undo(f.a); assert.deepEqual(engine.getState(), state);
});
test('later collection order conflicts with the insertion anchors of an older undo', async () => {
  const f = await fixture(), xyz = {x: 0, y: 0, z: 0}; let state = f.state;
  for (const id of ['A', 'B', 'C', 'D', 'E']) state = f.world.addView(state, f.schema.createView({id, label: id, camera: {position: xyz, rotation: xyz, fov: 45}, now: 100}), {activate: false});
  const engine = f.history.createHistory(state);
  engine.transact(f.a, 'remove B', value => f.world.removeView(value, 'B'));
  engine.transact(f.b, 'reverse surviving views', value => {value.scenePlay.worldSpace.views.reverse(); return value;});
  const reordered = engine.getState(); assert.deepEqual(reordered.scenePlay.worldSpace.views.map(view => view.id), ['E', 'D', 'C', 'A']);
  assert.deepEqual(engine.getUndoAvailability(f.a), {ok: false, reason: 'conflict'});
  assert.deepEqual(engine.undo(f.a), {ok: false, reason: 'conflict'}); assert.deepEqual(engine.getState(), reordered);
  engine.undo(f.b); engine.undo(f.a); assert.deepEqual(engine.getState(), state);
});
test('collection reorder and removed middle items round-trip without snapshot patches', async () => {
  const f = await fixture(), before = f.engine.getState();
  f.engine.transact('world', 'reorder', state => {state.scenePlay.worldSpace.entities.reverse(); return state;});
  assert.ok(f.engine.getHistory().lanes.world.undoStack[0].forward.some(patch => patch.type === 'entity.order'));
  f.engine.undo('world'); assert.deepEqual(f.engine.getState(), before);
  const changed = f.world.removeEntity(before, 'prop-a', 101), diff = f.patches.diffState(before, changed);
  assert.deepEqual(f.patches.applyPatches(before, diff.forward), changed); assert.deepEqual(f.patches.applyPatches(changed, diff.inverse), before);
});
test('getters cannot mutate private state/records and clear refuses a live transaction', async () => {
  const f = await fixture(); const external = f.engine.getState(); external.scenePlay.worldSpace.entities[0].label = 'Mutated';
  assert.equal(f.engine.getState().scenePlay.worldSpace.entities[0].label, 'A');
  f.engine.transact(f.a, 'A', rename(f, 'prop-a', 'A2')); const history = f.engine.getHistory(); history.lanes[f.a].undoStack[0].forward[0].entity.label = 'Mutated record';
  f.engine.undo(f.a); f.engine.redo(f.a); assert.equal(f.engine.getState().scenePlay.worldSpace.entities[0].label, 'A2');
  f.engine.begin('world', 'active'); assert.throws(() => f.engine.clear(), error => error.code === 'transaction-active'); f.engine.cancel(); f.engine.clear();
  assert.deepEqual(f.engine.getHistory(), {lanes: {world: {undoStack: [], redoStack: []}}, nextSequence: 1});
});
test('unknown lanes, patch types and invalid atomic replays fail without mutating input', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  assert.throws(() => f.engine.begin('unknown', 'bad')); assert.throws(() => f.engine.begin('setup:missing', 'bad'));
  assert.throws(() => f.patches.applyPatches(f.state, [{type: 'scene.replace', value: {}}]));
  assert.throws(() => f.patches.applyPatches(f.state, [{type: 'stage.remove', stageId: 'stage-default'}])); assert.deepEqual(f.state, before);
});
