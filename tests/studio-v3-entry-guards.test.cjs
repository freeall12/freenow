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
const finishControlScope = extract('  function finishControlScope()', '\n  const state =');
const menuOwnership = extract('  const menus = {...menuController};', '\n  function finishControlScope()');
const groundHeight = extract('  const groundHeight =', '\n  const control =');
const entityAction = extract('  const entityAction =', '\n  const dropSelected =');
const dropSelected = extract('  const dropSelected =', '\n  const addEntity =');
const addEntity = extract('  const addEntity =', '\n  function cancelCameraCreation');
const cancelCameraCreation = extract('  function cancelCameraCreation', '\n  const cameraCreationAllowed =');
const beginCameraCreation = extract('  const beginCameraCreation =', '\n  const cameraMenuContent =');
const startSelectedControl = extract('  const startSelectedControl =', '\n  const switchSetup =');

function keyboardHost() {
  const calls = [], pending = [];
  let handler, menuOpen = false, entityKind = 'actor', cameraFinishAllowed = true;
  const context = vm.createContext({
    root: {addEventListener(type, fn) {assert.equal(type, 'keydown'); handler = fn;}},
    menus: {isOpen: () => menuOpen, close: () => calls.push('menu-close')}, selected: 'actor', cameraCreation: null, cameraCapture: null, focusPicking: false,
    runtime: {view: 'orbit', controlling: false, possessing: null, focusEntity: () => calls.push('focus'), cancelTransform: () => false,
      finishCameraControl() {calls.push('camera-finish'); if (cameraFinishAllowed) this.possessing = null; return cameraFinishAllowed;},
      cancelControl() {}, clearCameraPreview: () => calls.push('preview-close')},
    control: () => ({definition: {kind: entityKind}, canToggleLock: entityKind !== 'camera', locked: false}),
    safe: action => () => {pending.push(Promise.resolve().then(action));},
    dropSelected: () => calls.push('drop'), entityAction: () => calls.push('lock'),
    removeSelected: () => calls.push('remove'), replay: () => calls.push('undo'),
    startSelectedControl: () => calls.push('control'), createCamera: () => calls.push('camera-create'),
    cancelCameraCreation: options => calls.push(['camera-cancel', structuredClone(options)]),
    select: () => calls.push('select'), refresh() {}, updateModeChrome: () => calls.push('chrome'), notice: () => calls.push('notice'), instance: {close: () => calls.push('close')}
  });
  vm.runInContext(keyboard, context, {filename: 'studio-v3-entry-keyboard-production-extract.js'});
  return {calls, open: value => {menuOpen = value;}, controlling: value => {context.runtime.controlling = value;},
    possessing: value => {context.runtime.possessing = value ? {entityId: 'camera'} : null;}, hasPossession: () => !!context.runtime.possessing,
    captureBusy: value => {context.cameraCapture = value ? {busy: true} : null;}, pickingFocus: value => {context.focusPicking = value;}, isPickingFocus: () => context.focusPicking,
    kind: value => {entityKind = value;}, allowCameraFinish: value => {cameraFinishAllowed = value;},
    creation: kind => {context.cameraCreation = kind ? {kind} : null;}, async key(key, options = {}) {
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

test('control, ground creation, view creation and menus own scene keys with distinct Escape behavior', async () => {
  const sceneKeys = [['Delete'], ['Backspace'], ['g'], ['l'], ['z', {metaKey: true}], ['z', {ctrlKey: true}], ['f'], ['c']];
  for (const mode of ['control', 'ground', 'view', 'menu']) {
    const f = keyboardHost();
    if (mode === 'control') f.controlling(true);
    else if (mode === 'menu') {f.creation('view'); f.open(true);}
    else f.creation(mode);
    for (const [key, options] of sceneKeys) await f.key(key, options);
    assert.deepEqual(f.calls, [], `${mode} must own every scene shortcut`);
    await f.key('Escape');
    assert.deepEqual(f.calls, mode === 'view' ? ['camera-create'] : mode === 'ground' ? [['camera-cancel', {restoreFocus: true}]] : [], `${mode} Escape`);
  }
  const f = keyboardHost();
  await f.key('c'); await f.key('f');
  assert.deepEqual(f.calls, ['control', 'focus'], 'ordinary scene shortcuts remain available outside a mode');
});

test('camera possession owns scene shortcuts and Escape closes focus picking before finishing; failed finish retains its scope', async () => {
  const f = keyboardHost();f.possessing(true);f.pickingFocus(true);
  for (const [key, options] of [['Delete'], ['Backspace'], ['g'], ['l'], ['z', {metaKey: true}], ['z', {ctrlKey: true}], ['f'], ['c']]) await f.key(key, options);
  assert.deepEqual(f.calls, []);await f.key('Escape');assert.deepEqual(f.calls, ['chrome']);assert.equal(f.isPickingFocus(), false);assert.equal(f.hasPossession(), true);
  f.calls.length = 0;f.allowCameraFinish(false);await f.key('Escape');assert.deepEqual(f.calls, ['camera-finish', 'notice']);assert.equal(f.hasPossession(), true);
  f.calls.length = 0;f.allowCameraFinish(true);await f.key('Escape');assert.deepEqual(f.calls, ['camera-finish']);assert.equal(f.hasPossession(), false);
});

test('capture busy owns every scene shortcut including Escape, and C cannot enter actor control for a camera', async () => {
  const f = keyboardHost();f.captureBusy(true);f.possessing(true);f.pickingFocus(true);
  for (const [key, options] of [['Delete'], ['Backspace'], ['g'], ['l'], ['z', {metaKey: true}], ['z', {ctrlKey: true}], ['f'], ['c'], ['Escape']]) await f.key(key, options);
  assert.deepEqual(f.calls, []);assert.equal(f.hasPossession(), true);assert.equal(f.isPickingFocus(), true);
  f.captureBusy(false);f.possessing(false);f.kind('camera');await f.key('c');await f.key('C');assert.deepEqual(f.calls, []);
  f.kind('prop');await f.key('c');assert.deepEqual(f.calls, ['control']);
});

test('menu opening waits for camera capture and successful camera scope finish before closing creation or invoking any menu', () => {
  const calls = [], context = vm.createContext({calls, cameraCapture: {busy: true},
    runtime: {controlling: null, possessing: {entityId: 'camera'}, finishCameraControl() {calls.push('camera-finish');if (context.allowFinish) {this.possessing = null;return true;}return false;}},
    allowFinish: false, notice: () => calls.push('notice'), cancelCameraCreation: () => calls.push('creation-exit'),
    menuController: Object.fromEntries(['toggle', 'openAt', 'openNested', 'close'].map(name => [name, () => {calls.push(`menu-${name}`);return 'opened';}]))});
  vm.runInContext(`${finishControlScope}\n${menuOwnership}\nglobalThis.openMenu = name => menus[name]({x: 1, y: 2});`, context);
  for (const name of ['toggle', 'openAt', 'openNested']) assert.equal(context.openMenu(name), false);assert.deepEqual(calls, ['notice', 'notice', 'notice']);assert(context.runtime.possessing);
  calls.length = 0;context.cameraCapture.busy = false;assert.equal(context.openMenu('openAt'), false);assert.deepEqual(calls, ['camera-finish', 'notice']);assert(context.runtime.possessing);
  calls.length = 0;context.allowFinish = true;assert.equal(context.openMenu('openAt'), 'opened');assert.deepEqual(calls, ['camera-finish', 'creation-exit', 'menu-openAt']);assert.equal(context.runtime.possessing, null);
});

test('production camera creation finishes control and exits the previous creation mode before starting the next', async () => {
  const calls = [];
  const ownedOptics = {dispose: () => calls.push('optics-dispose'), remove: () => calls.push('optics-remove')};
  const context = vm.createContext({calls, cameraCapture: null, currentSetup: () => ({id: 'setup', kind: 'independent'}), cameraCreationAllowed: () => true,
    ownedOptics, createViewfinderOptics: () => ownedOptics, cameraCreateTools: {prepend: optics => assert.equal(optics, ownedOptics)},
    menus: {close: () => calls.push('menu-close')},
    runtime: {view: 'camera', controlling: true, possessing: null, finishControl() {calls.push('control-finish'); this.controlling = false; return true;}, cancelTransform: () => calls.push('transform-cancel'),
      endViewfinder: () => calls.push('view-end'), beginViewfinder: () => calls.push('view-begin'), clearCameraPreview: () => calls.push('preview-close'),
      startControl: id => {calls.push(['control-start', id]); return true;}},
    updateModeChrome: () => calls.push('chrome'), updatePreviewFrame: () => calls.push('frame'),
    cameraButton: {focus: options => calls.push(['camera-focus', structuredClone(options)])}, canvas: {focus: () => calls.push('canvas-focus')},
    notice: message => {throw Error(message);}});
  vm.runInContext(`
    let cameraCreation = {kind: 'view'}, viewfinderOptics = ownedOptics, selected = 'actor', lastSync = Promise.resolve();
    ${finishControlScope}
    ${cancelCameraCreation}
    ${beginCameraCreation}
    ${startSelectedControl}
    globalThis.begin = beginCameraCreation; globalThis.start = startSelectedControl;
    globalThis.cancel = cancelCameraCreation; globalThis.mode = () => cameraCreation;
  `, context);
  await context.begin('ground');
  assert.deepEqual(calls, ['control-finish', 'menu-close', 'transform-cancel', 'optics-dispose', 'optics-remove', 'view-end', 'chrome', 'frame', 'preview-close', 'chrome', 'frame', 'canvas-focus']);
  assert.deepEqual(structuredClone(context.mode()), {kind: 'ground', setupId: 'setup'});
  calls.length = 0;
  await context.start();
  assert.deepEqual(calls, ['menu-close', 'chrome', 'frame', ['control-start', 'actor'], 'chrome', 'canvas-focus']);
  assert.equal(context.mode(), null);
  calls.length = 0;
  await context.begin('view');
  assert(calls.indexOf('view-begin') > calls.indexOf('transform-cancel'));
  calls.length = 0;
  assert.equal(context.cancel({restoreFocus: true}), true);
  assert.deepEqual(calls, ['optics-dispose', 'optics-remove', 'view-end', 'chrome', 'frame', ['camera-focus', {preventScroll: true}]]);
  calls.length = 0;
  assert.equal(context.cancel(), false);
  assert.deepEqual(calls, [], 'cancelling an absent mode is inert');
});

test('actual control finish guard blocks creation and menus on failure, then preserves committed pose before continuing', async () => {
  const [schema, world, history, actions] = await Promise.all([
    import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
    import('../src/features/studio-v3/history.mjs'), import('../src/features/studio-v3/entity-actions.mjs')
  ]);
  for (const scope of ['entity', 'camera']) for (const target of ['create', 'add-entity', 'menu', 'camera-mode']) {
    let initial = schema.createState({worldNodeId: 'finish-owner', now: 1});
    initial = world.addEntity(initial, schema.createEntity({id: 'prop', kind: 'prop', label: 'Prop', now: 1}));
    const engine = history.createHistory(initial), lane = history.setupLane('setup:state-1');
    const transform = initial.scenePlay.worldSpace.setups[1].entityStates[0].transform;
    engine.begin(lane, 'control movement');
    engine.preview(state => world.patchEntityState(state, 'setup:state-1', 'prop', {transform: {...transform, position: {x: 4, y: 0, z: 2}}}, 2));
    const pending = engine.getState(), calls = [];
    let permitCommit = false;
    const finishCall = scope === 'camera' ? 'camera-finish' : 'finish';
    const runtime = {controlling: scope === 'entity', possessing: scope === 'camera' ? {entityId: 'camera'} : null, view: scope === 'camera' ? 'camera-control' : 'orbit', controls: {target: {x: 0, z: 0}}, focusEntity: () => calls.push('entity-focus'),
      finishControl() {calls.push('finish'); if (!permitCommit) return false; assert.equal(engine.commit(), true); this.controlling = false; return true;},
      finishCameraControl() {calls.push('camera-finish');if (!permitCommit) return false;assert.equal(engine.commit(), true);this.possessing = null;return true;},
      cancelTransform: () => calls.push('transform-cancel'), beginViewfinder: () => calls.push('view-begin')};
    const context = vm.createContext({engine, runtime, calls, cameraCapture: null, currentSetup: () => ({id: 'setup:state-1'}), cameraCreationAllowed: () => true,
      crypto: {randomUUID: () => {calls.push('id'); return 'new-camera';}},
      createViewfinderOptics: () => ({dispose() {}, remove() {}}), cameraCreateTools: {prepend() {}},
      menuController: Object.fromEntries(['toggle', 'openAt', 'openNested', 'close'].map(name => [name, () => {calls.push(`menu-${name}`); return 'opened';}])),
      notice: () => calls.push('notice'), cancelCameraCreation: () => calls.push('creation-exit'),
      updateModeChrome: () => calls.push('chrome'), updatePreviewFrame: () => calls.push('frame'), canvas: {focus: () => calls.push('focus')},
      reduceEntityAction: (state, action) => {calls.push('reduce'); return actions.reduceEntityAction(state, structuredClone(action), {now: 3});}});
    vm.runInContext(`
      let cameraCreation = null, viewfinderOptics = null, lastSync = Promise.resolve();
      const state = () => engine.getState();
      const change = (reducer, label, targetLane) => {calls.push('change'); return engine.transact(targetLane, label, reducer);};
      const select = () => calls.push('select');
      ${finishControlScope}
      ${menuOwnership}
      ${entityAction}
      ${groundHeight}
      ${addEntity}
      ${beginCameraCreation}
      globalThis.attempt = () => ${target === 'create' ? "entityAction({type: 'create', kind: 'camera', id: 'new-camera'})" : target === 'add-entity' ? "addEntity('camera')" : target === 'menu' ? "menus.openAt({x: 1, y: 2})" : "beginCameraCreation('view')"};
    `, context);
    const denied = await context.attempt();
    if (['create', 'add-entity'].includes(target)) assert.equal(denied.ok, false);
    if (target === 'menu') assert.equal(denied, false);
    assert.deepEqual(calls, [finishCall, 'notice'], `${scope} ${target} failure must stop before the next action`);
    assert.deepEqual(engine.getState(), pending);
    assert(engine.getActiveTransaction(), 'failed commit retains the pending control transaction');
    calls.length = 0; permitCommit = true;
    const result = await context.attempt();
    if (['create', 'add-entity'].includes(target)) assert.equal(result.ok, true);
    if (target === 'menu') assert.equal(result, 'opened');
    const continuation = ['create', 'add-entity'].includes(target) ? 'reduce' : target === 'menu' ? 'menu-openAt' : 'view-begin';
    assert.equal(calls[0], finishCall); assert(calls.indexOf(continuation) > 0);
    if (target === 'add-entity') assert(calls.indexOf('entity-focus') > calls.indexOf('change'), 'only successful creation focuses the new entity');
    assert.equal(engine.getActiveTransaction(), null);
    assert.equal(engine.getHistory().lanes[lane].undoStack.length, 1);
    assert.deepEqual(engine.getState().scenePlay.worldSpace.setups[1].entityStates.find(item => item.entityId === 'prop').transform.position, {x: 4, y: 0, z: 2}, `${target} must retain the controlled pose`);
  }
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
  const context = vm.createContext({engine, object, trace, syncGate, structuredClone, cameraCapture: null,
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
      cancelControl() {},
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
    ${finishControlScope}
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
    const context = vm.createContext({engine, selected, focused, cameraCapture: null,
      crypto: {randomUUID: () => `entity-${++serial}`},
      reduceEntityAction: (state, action) => actions.reduceEntityAction(state, structuredClone(action)),
      runtime: {controls: {target: {x: 3, z: -4}}, cancelControl() {}, cancelTransform() {}, focusEntity: id => focused.push(id)},
      menus: {close() {}}});
    vm.runInContext(`
      let lastSync = Promise.resolve();
      const state = () => engine.getState();
      const change = (reducer, label, lane) => engine.transact(lane, label, reducer);
      const select = id => selected.push(id), notice = message => {throw Error(message);};
      ${finishControlScope}
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
