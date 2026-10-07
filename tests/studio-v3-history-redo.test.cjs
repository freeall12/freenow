const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs'),
  import('../src/features/studio-v3/history.mjs'),
  import('../src/features/studio-v3/setup-actions.mjs')
]);

async function fixture() {
  const [schema, world, history, setups] = await modules;
  let initial = schema.createState({worldNodeId: 'redo-owner', now: 1});
  initial = world.addEntity(initial, schema.createEntity({id: 'prop', kind: 'prop', label: 'Original', now: 1}));
  let id = 0;
  const engine = history.createHistory(initial, {createId: () => `record-${++id}`, now: () => 1});
  return {schema, world, history, setups, initial, engine};
}

test('world clone/delete redoes both overlapping records and keeps exact snapshots and fresh sequences', async () => {
  const f = await fixture();
  assert.equal(f.engine.transact('world', 'clone', state => f.setups.cloneIndependentSetup(state, 'setup:state-1', {
    createId: (kind, id) => `copy:${kind}:${id}`, now: 2
  })), true);
  const copied = f.engine.getState();
  assert.equal(f.engine.transact('world', 'delete', state => f.setups.removeIndependentSetup(state, 'copy:setup:setup:state-1', {now: 3})), true);
  const deleted = f.engine.getState();
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.getState(), copied);
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.getState(), f.initial);
  assert.deepEqual(f.engine.redo('world'), {ok: true});
  assert.deepEqual(f.engine.getState(), copied);
  assert.deepEqual(f.engine.getRedoAvailability('world'), {ok: true});
  assert.deepEqual(f.engine.redo('world'), {ok: true});
  assert.deepEqual(f.engine.getState(), deleted);
  assert.deepEqual(f.engine.getHistory().lanes.world.undoStack.map(record => record.sequence), [3, 4]);
  assert.equal(f.engine.getHistory().nextSequence, 5);
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.getState(), f.initial);
});

test('setup lane sequential edits support repeated full undo/redo cycles', async () => {
  const f = await fixture(), lane = f.history.setupLane('setup:state-1'), snapshots = [f.initial];
  for (let x = 1; x <= 3; x++) {
    assert.equal(f.engine.transact(lane, `move ${x}`, state => {
      const instance = state.scenePlay.worldSpace.setups.find(setup => setup.id === 'setup:state-1').entityStates[0];
      return f.world.patchEntityState(state, 'setup:state-1', 'prop', {
        transform: {...instance.transform, position: {x, y: 0, z: 0}}
      }, x + 1);
    }), true);
    snapshots.push(f.engine.getState());
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let index = 2; index >= 0; index--) {
      assert.deepEqual(f.engine.undo(lane), {ok: true});
      assert.deepEqual(f.engine.getState(), snapshots[index]);
    }
    for (let index = 1; index <= 3; index++) {
      assert.deepEqual(f.engine.getRedoAvailability(lane), {ok: true});
      assert.deepEqual(f.engine.redo(lane), {ok: true});
      assert.deepEqual(f.engine.getState(), snapshots[index]);
    }
  }
  assert.deepEqual(f.engine.getHistory().lanes[lane].undoStack.map(record => record.sequence), [7, 8, 9]);
});

test('later overlapping other-lane edits still block undo and pending redo atomically', async () => {
  const f = await fixture(), otherLane = f.history.setupLane('setup:state-1');
  f.engine.transact('world', 'first', state => f.world.patchEntity(state, 'prop', {label: 'First'}, 2));
  f.engine.transact('world', 'second', state => f.world.patchEntity(state, 'prop', {label: 'Second'}, 3));
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.undo('world'), {ok: true});
  assert.deepEqual(f.engine.redo('world'), {ok: true});
  f.engine.transact(otherLane, 'other lane', state => f.world.patchEntity(state, 'prop', {label: 'Other lane'}, 4));
  const state = f.engine.getState(), history = f.engine.getHistory();
  for (const direction of ['Undo', 'Redo']) {
    assert.deepEqual(f.engine[`get${direction}Availability`]('world'), {ok: false, reason: 'conflict'});
    assert.deepEqual(f.engine[direction.toLowerCase()]('world'), {ok: false, reason: 'conflict'});
    assert.deepEqual(f.engine.getState(), state);
    assert.deepEqual(f.engine.getHistory(), history);
  }
  assert.deepEqual(f.engine.undo(otherLane), {ok: true});
  assert.deepEqual(f.engine.redo('world'), {ok: true});
  assert.equal(f.engine.getState().scenePlay.worldSpace.entities[0].label, 'Second');
});
