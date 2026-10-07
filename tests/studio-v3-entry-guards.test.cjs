const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');

// Execute the production closures with small host spies, rather than copying
// their routing logic or constructing the full editor DOM/GPU environment.
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `production entry closure: ${startMarker}`);
  return source.slice(start, end);
}
const keyboard = extract("    root.addEventListener('keydown',", '\n    await sync(true);');
const groundHeight = extract('  const groundHeight =', '\n  const control =');
const entityAction = extract('  const entityAction =', '\n  const dropSelected =');
const dropSelected = extract('  const dropSelected =', '\n  const addEntity =');
const addEntity = extract('  const addEntity =', '\n  const switchSetup =');

function keyboardHost() {
  const calls = [], pending = [];
  let handler, menuOpen = false;
  const context = vm.createContext({
    root: {addEventListener(type, fn) {assert.equal(type, 'keydown'); handler = fn;}},
    menus: {isOpen: () => menuOpen, close: () => calls.push('menu-close')}, selected: 'actor',
    runtime: {view: 'orbit', focusEntity: () => calls.push('focus'), cancelTransform: () => false},
    control: () => ({canToggleLock: true, locked: false}),
    safe: action => () => {pending.push(Promise.resolve().then(action));},
    dropSelected: () => calls.push('drop'), entityAction: () => calls.push('lock'),
    removeSelected: () => calls.push('remove'), replay: () => calls.push('undo'),
    select: () => calls.push('select'), refresh() {}, instance: {close: () => calls.push('close')}
  });
  vm.runInContext(keyboard, context, {filename: 'studio-v3-entry-keyboard-production-extract.js'});
  return {calls, open: value => {menuOpen = value;}, async key(key, options = {}) {
    handler({key, defaultPrevented: false, isComposing: false, keyCode: 0,
      target: {closest: () => null}, preventDefault() {}, stopPropagation() {}, ...options});
    await Promise.all(pending.splice(0));
  }};
}

test('menu button focus owns Delete/G/L/Cmd-Z and the scene shortcuts resume after dismissal', async () => {
  const f = keyboardHost();
  f.open(true);
  for (const [key, options] of [['Delete'], ['Backspace'], ['g'], ['l'], ['z', {metaKey: true}], ['z', {ctrlKey: true}]]) await f.key(key, options);
  assert.deepEqual(f.calls, []);
  f.open(false);
  for (const [key, options] of [['Delete'], ['g'], ['l'], ['z', {metaKey: true}]]) await f.key(key, options);
  assert.deepEqual(f.calls, ['remove', 'drop', 'lock', 'undo']);
});

test('a previously consumed key cannot invoke a scene action', async () => {
  const f = keyboardHost();
  for (const [key, options] of [['Delete'], ['g'], ['l'], ['z', {metaKey: true}]]) await f.key(key, {...options, defaultPrevented: true});
  assert.deepEqual(f.calls, []);
});

test('production drop cancels preview, waits for cancellation sync, then reads and drops only the baseline', async () => {
  const [THREE, schema, world, history, actions, placement, graph] = await Promise.all([
    import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
    import('../src/features/studio-v3/history.mjs'), import('../src/features/studio-v3/entity-actions.mjs'),
    import('../src/features/studio-v3/drop-placement.mjs'), import('../src/features/studio-v3/render-graph.mjs')
  ]);
  let initial = schema.createState({worldNodeId: 'drop-owner', now: 1});
  initial = world.addEntity(initial, schema.createEntity({id: 'prop', kind: 'prop', label: 'Prop', now: 1}));
  const transform = initial.scenePlay.worldSpace.setups[1].entityStates[0].transform;
  initial = world.patchEntityState(initial, 'setup:state-1', 'prop', {transform: {...transform, position: {x: 0, y: 5, z: 0}}}, 2);
  const engine = history.createHistory(initial), lane = history.setupLane('setup:state-1');
  engine.begin(lane, 'uncommitted drag');
  engine.preview(state => world.patchEntityState(state, 'setup:state-1', 'prop', {transform: {...transform, position: {x: 9, y: 8, z: 0}}}, 3));
  const object = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.y = .5; object.add(mesh);
  graph.applyTransform(object, engine.getState().scenePlay.worldSpace.setups[1].entityStates[0].transform);
  let release; const syncGate = new Promise(resolve => {release = resolve;}), trace = [];
  const context = vm.createContext({engine, object, trace, syncGate, structuredClone,
    applyTransform: graph.applyTransform, resolveDropPlacement: placement.resolveDropPlacement,
    // VM object literals have a foreign prototype; bridge their JSON into the
    // domain module's realm while keeping the actual reducer and validation.
    reduceEntityAction: (state, action) => actions.reduceEntityAction(state, structuredClone(action)), resolveEntityControl: actions.resolveEntityControl,
    worldRoot: new THREE.Group(), lane});
  vm.runInContext(`
    let lastSync = Promise.resolve();
    const pose = () => engine.getState().scenePlay.worldSpace.setups[1].entityStates[0].transform;
    const state = () => {trace.push('read-state'); return engine.getState();};
    const runtime = {
      graph: {worldRoot, entities: new Map([['prop', {id: 'prop', status: 'ready', root: object}]])},
      entityObject() {trace.push('read-object'); return object;},
      cancelTransform() {
        trace.push('cancel');
        if (engine.cancel()) lastSync = syncGate.then(() => {applyTransform(object, pose()); trace.push('cancel-sync');});
      }
    };
    const change = (reducer, label, targetLane) => {
      const changed = engine.transact(targetLane, label, reducer);
      lastSync = Promise.resolve().then(() => applyTransform(object, pose())); return changed;
    };
    const select = () => {}, notice = message => {throw Error(message);};
    ${groundHeight}
    ${entityAction}
    ${dropSelected}
    globalThis.drop = dropSelected;
  `, context, {filename: 'studio-v3-entry-drop-production-extract.js'});
  try {
    const dropping = context.drop('prop');
    await Promise.resolve();
    assert.deepEqual(trace, ['cancel'], 'no state or rendered bounds may be read before cancelled render sync settles');
    release(); const result = await dropping;
    assert.equal(result.ok, true);
    assert.deepEqual(engine.getState().scenePlay.worldSpace.setups[1].entityStates[0].transform.position, {x: 0, y: 0, z: 0});
    assert.equal(engine.getActiveTransaction(), null);
    assert.equal(engine.getHistory().lanes[lane].undoStack.length, 1);
    assert(trace.indexOf('cancel-sync') < trace.indexOf('read-state'));
    assert.deepEqual(engine.undo(lane), {ok: true});
    assert.deepEqual(engine.getState(), initial);
  } finally {mesh.geometry.dispose(); mesh.material.dispose();}
});

test('production creation uses finite ground fallback and camera height offset with actual entity reducers', async () => {
  const [schema, history, actions] = await Promise.all([
    import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/history.mjs'),
    import('../src/features/studio-v3/entity-actions.mjs')
  ]);
  for (const ground of [{}, {y: -2.5}]) {
    const initial = schema.createState({worldNodeId: 'ground-owner', now: 1});
    initial.scenePlay.environment.ground = ground;
    const engine = history.createHistory(initial), selected = [], focused = [];
    let serial = 0;
    const context = vm.createContext({engine, selected, focused,
      crypto: {randomUUID: () => `entity-${++serial}`},
      reduceEntityAction: (state, action) => actions.reduceEntityAction(state, structuredClone(action)),
      runtime: {controls: {target: {x: 3, z: -4}}, cancelTransform() {}, focusEntity: id => focused.push(id)},
      menus: {close() {}}});
    vm.runInContext(`
      let lastSync = Promise.resolve();
      const state = () => engine.getState();
      const change = (reducer, label, lane) => engine.transact(lane, label, reducer);
      const select = id => selected.push(id), notice = message => {throw Error(message);};
      ${groundHeight}
      ${entityAction}
      ${addEntity}
      globalThis.create = addEntity;
    `, context, {filename: 'studio-v3-entry-ground-production-extract.js'});
    await context.create('actor');
    await context.create('camera');
    const final = engine.getState(), world = final.scenePlay.worldSpace, setup = world.setups.find(item => item.id === world.activeSetupId);
    assert.equal(schema.assertState(final), final);
    for (const [index, kind] of ['actor', 'camera'].entries()) {
      const entity = world.entities.find(item => item.kind === kind), instance = setup.entityStates.find(item => item.entityId === entity.id);
      const expected = {x: 3, y: (ground.y ?? 0) + (kind === 'camera' ? 1.6 : 0), z: -4};
      assert.deepEqual(instance.transform.position, expected, `${kind} ground ${JSON.stringify(ground)}`);
      assert(Object.values(instance.transform.position).every(Number.isFinite));
      if (kind === 'camera') assert.deepEqual(instance.camera.position, expected);
      assert.equal(selected[index], entity.id);
      assert.equal(focused[index], entity.id);
    }
    assert.equal(engine.getHistory().lanes.world.undoStack.length, 2);
  }
});
