'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');
const extract = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, startMarker); return source.slice(start, end);
};
const cancellation = extract('  function cancelPlanGesture()', '\n  function cancelRoomEdit()');
const placement = extract('  async function beginPlanPlacement(', '\n  function placementMenuContent(');
const structuralWrite = extract('  async function allowStructuralWrite()', '\n  const switchSetup =');
const menuEntrances = extract("  for (const name of ['toggle', 'openAt', 'openNested'])", '\n  function finishControlScope()');
const keyMenu = extract('  function planPathContextMenu(', '\n  function cancelCameraCreation(');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};

function fixture() {
  let author = {setupId: 'setup-a', source: {kind: 'empty'}, roomConfig: {}, revision: 0};
  const calls = [], begins = [], menuActions = [];
  const context = vm.createContext({alive: true, closing: null, planPending: null, placementRequestId: 0,
    runtime: {view: 'plan', cancelTransform() {calls.push('transform-cancel');}},
    session: {isCurrent: () => true}, temporal: {beforeWrite: async () => ({ok: true})}, lastSync: Promise.resolve(),
    select: id => {calls.push(id === null ? 'selection-clear' : 'selection-change'); return true;},
    space: () => ({activeSetupId: author.setupId, source: author.source, roomConfig: author.roomConfig}),
    roomFence: () => author.revision, finishControlScope: () => true, cameraCreationAllowed: () => true,
    refresh: () => calls.push('refresh'), character: {focus() {}}, cancelCameraCreation: () => calls.push('camera-cancel'),
    planView: {cancelGesture: () => calls.push('view-cancel'), element: {focus: () => calls.push('focus')}},
    planWorkspace: {cancel: () => calls.push('workspace-cancel')}, planTrajectories: {cancel: () => calls.push('trajectory-cancel')},
    planPlacement: {cancel: () => calls.push('placement-cancel'), begin: hit => {begins.push(hit); return Promise.resolve(null);}},
    menuController: Object.fromEntries(['toggle', 'openAt', 'openNested'].map(name => [name, (...args) => menuActions.push([name, ...args])])),
    menus: {close: () => calls.push('menus-close')}, row: (_icon, label, action) => ({label, action, classList: {add() {}}}), menu: (_label, rows) => rows});
  vm.runInContext(`${cancellation}\n${structuralWrite}\n${placement}\n${menuEntrances}\n${keyMenu}\nglobalThis.actions = {beginPlanPlacement, beginPlanPlacementGesture, cancelPlanPlacement, cancelPlanGesture, planPathContextMenu};`, context);
  return {context, calls, begins, menuActions, replace(patch) {author = {...author, ...patch};}};
}

test('entry menu entrances cancel pending placement and reject a late domain lease', async () => {
  for (const entrance of ['toggle', 'openAt', 'openNested']) {
    const f = fixture(), gate = deferred(), late = {onCancel: () => f.calls.push('late-cancel'), onEnd: () => f.calls.push('late-end')};
    await f.context.actions.beginPlanPlacement({kind: 'actor', label: '甲'});
    f.context.planPlacement.begin = hit => {f.begins.push(hit); return gate.promise;};
    const pending = f.context.actions.beginPlanPlacementGesture({point: {x: 1, y: 0, z: 2}});
    f.context.menus[entrance]({}, () => {}); gate.resolve(late);
    assert.equal(await pending, null, entrance); assert.equal(f.context.planPending, null);
    assert.equal(f.calls.filter(call => call === 'late-cancel').length, 1); assert(!f.calls.includes('late-end'));
    assert(f.calls.includes('workspace-cancel')); assert(f.calls.includes('trajectory-cancel'));
  }
});

test('old direct-hit preparation cannot cancel a newer queued placement', async () => {
  const f = fixture(), gate = deferred(); f.context.planPlacement.begin = hit => {f.begins.push(hit); return gate.promise;};
  const first = f.context.actions.beginPlanPlacement({kind: 'actor', label: '旧'}, {point: {x: 1, y: 0, z: 2}});
  await tick(); assert.equal(f.begins.length, 1);
  assert.equal(await f.context.actions.beginPlanPlacement({kind: 'actor', label: '新'}), true);
  const current = f.context.planPending, request = f.context.placementRequestId;
  gate.resolve(null); assert.equal(await first, false);
  assert.equal(f.context.planPending, current); assert.equal(f.context.planPending.label, '新');
  assert.equal(f.context.placementRequestId, request);
});

test('placement from a selected camera clears obsolete entity and key targets before showing guidance', async () => {
  const f = fixture(); let key = 'old-key';
  f.context.temporal.clearSelectedKey = () => {key = null; f.calls.push('key-clear'); return true;};
  assert.equal(await f.context.actions.beginPlanPlacement({kind: 'camera'}), true);
  assert.equal(key, null); assert(f.calls.includes('selection-clear'));
  assert(f.calls.indexOf('key-clear') < f.calls.indexOf('selection-clear'));
  assert.equal(f.context.planPending.kind, 'camera');
  f.context.actions.cancelPlanPlacement();
  f.context.temporal.clearSelectedKey = () => false;
  assert.equal(await f.context.actions.beginPlanPlacement({kind: 'camera'}), false);
  assert.equal(f.context.planPending, null);
});

test('source, setup, close and explicit cancellation stop pending author preparation', async () => {
  for (const mode of ['source', 'setup', 'close', 'cancel']) {
    const f = fixture(), gate = deferred(); f.context.temporal.beforeWrite = () => gate.promise;
    const pending = f.context.actions.beginPlanPlacement({kind: 'actor', label: '甲'});
    if (mode === 'source') f.replace({source: {kind: 'mesh-preset', preset: 'room'}});
    else if (mode === 'setup') f.replace({setupId: 'setup-b'});
    else if (mode === 'close') f.context.closing = Promise.resolve();
    else f.context.actions.cancelPlanPlacement();
    gate.resolve({ok: true});
    if (mode === 'source' || mode === 'setup') await assert.rejects(pending, /片场已变化/);
    else assert.equal(await pending, false);
    assert.equal(f.context.planPending, null); assert.equal(f.begins.length, 0);
  }
});

test('direct placement forwards the displayed hit and commits only its matching lease', async () => {
  const f = fixture(), hit = {point: {x: 3, y: 50, z: 4}, projection: {displayed: true}, nx: .6, ny: .7};
  let ends = 0; f.context.planPlacement.begin = value => {f.begins.push(value); return Promise.resolve({onCancel() {}, onEnd() {ends++; return true;}});};
  assert.equal(await f.context.actions.beginPlanPlacement({kind: 'actor', label: '甲'}, hit), true);
  assert.equal(f.begins[0].point, hit.point); assert.equal(f.begins[0].projection, hit.projection);
  assert.equal(f.begins[0].setupId, 'setup-a'); assert.equal(f.begins[0].nx, .6); assert.equal(ends, 1); assert.equal(f.context.planPending, null);
  f.context.cameraCreationAllowed = () => false;
  await assert.rejects(f.context.actions.beginPlanPlacement({kind: 'camera'}, hit), /独立状态/);
  assert.equal(f.begins.length, 1);
});

test('key menu captures the fixed deletion context and offers no key creation action', async () => {
  const f = fixture(), deleted = [], opened = [];
  let selectedKey = 'key-a';
  f.context.planTrajectories.readContext = descriptor => {const keyId = descriptor.keyId; return {onDelete: () => {deleted.push(keyId); return {ok: true};}};};
  f.context.menus.openAt = (_point, factory) => opened.push(factory());
  assert.equal(f.context.actions.planPathContextMenu({kind: 'key', keyId: selectedKey, clientX: 2, clientY: 3}), true);
  selectedKey = 'key-b'; assert.equal(opened[0].length, 1); assert.equal(opened[0][0].label, '删除关键帧');
  await opened[0][0].action(); assert.deepEqual(deleted, ['key-a']);
});

test('nested character draft Escape preserves parent; detached submit and late rejection stay inert', async () => {
  const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
  const canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
  require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
  const {JSDOM} = fabricRequire('jsdom');
  if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
  const [{createMenus}, {createCharacterDraft}] = await Promise.all([import('../src/features/studio-v3/menus.mjs'), import('../src/features/studio-v3/character-menu.mjs')]);
  const dom = new JSDOM('<head></head><body><div id="root"><button id="anchor"></button></div></body>', {pretendToBeVisual: true});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: dom.window.document, configurable: true, writable: true});
  const root = dom.window.document.querySelector('#root'), anchor = dom.window.document.querySelector('#anchor'), gate = deferred(), errors = [];
  let submits = 0, controller;
  try {
    controller = createMenus({root, onError: error => errors.push(error)});
    const parent = controller.toggle(anchor, () => {const item = dom.window.document.createElement('button'); item.textContent = '新建角色'; return item;});
    const childAnchor = parent.querySelector('button'); childAnchor.getBoundingClientRect = () => ({left: 990, right: 1010, top: 100, bottom: 130, width: 20, height: 30});
    const openChild = () => controller.openNested(childAnchor, ({close}) => createCharacterDraft({draft: {label: '  甲  ', color: '#C97984', actorGender: 'neutral'}, onDraftChange() {},
      onSubmit: draft => {submits++; assert.equal(draft.label, '甲'); return gate.promise;}, onCancel: close, onError: error => errors.push(error)}), {placement: 'right', width: 192});
    const first = openChild(); assert.equal(first.dataset.motion, 'fromRight');
    first.querySelector('input').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    assert.equal(controller.isOpen(), true); assert.equal(parent.getAttribute('aria-hidden'), null); assert.equal(first.getAttribute('aria-hidden'), 'true');
    first.querySelector('[title="添加并放置"]').click(); assert.equal(submits, 0);
    const second = openChild(); second.querySelector('[title="添加并放置"]').click(); assert.equal(submits, 1);
    controller.close({all: true}); gate.reject(Error('late asset failure')); await tick();
    assert.deepEqual(errors, []); assert.equal(controller.isOpen(), false); assert.equal(submits, 1);
  } finally {
    controller?.dispose(); dom.window.close();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  }
});

test('native-like nested hover retains role focus, toggles on click and dismisses camera at 180ms without closing foreign menus', async () => {
  const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
  const canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
  require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
  const {JSDOM} = fabricRequire('jsdom');
  if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
  const [{createMenus}, {createCharacterDraft}, {el, button}, {icon}] = await Promise.all([
    import('../src/features/studio-v3/menus.mjs'), import('../src/features/studio-v3/character-menu.mjs'),
    import('../src/features/studio-v3/dom.mjs'), import('../src/features/studio-v3/icons.mjs')]);
  const dom = new JSDOM('<head></head><body><div id="root"><button id="anchor"></button><button id="foreign"></button></div><button id="outside"></button></body>', {pretendToBeVisual: true});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: dom.window.document, configurable: true, writable: true});
  const doc = dom.window.document, root = doc.querySelector('#root'), timers = new Map(), errors = [], disposed = [];
  let clock = 0, timerId = 0, controller;
  const originalSetTimeout = dom.window.setTimeout, originalClearTimeout = dom.window.clearTimeout;
  dom.window.setTimeout = (run, delay = 0) => {const id = ++timerId; timers.set(id, {run, at: clock + delay, delay}); return id;};
  dom.window.clearTimeout = id => timers.delete(id);
  const advance = ms => {
    const target = clock + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; clock = next[1].at; timers.delete(next[0]); next[1].run();
    }
    clock = target;
  };
  const pointer = (node, type, relatedTarget = null) => node.dispatchEvent(new dom.window.MouseEvent(type, {bubbles: type === 'pointerdown', relatedTarget, cancelable: true, button: 0}));
  const nativeClick = node => {pointer(node, 'pointerdown'); node.focus(); node.click();};
  try {
    controller = createMenus({root, onError: error => errors.push(error)});
    const context = vm.createContext({el, icon, menus: controller, actorDraft: {label: '甲', color: '#C97984', actorGender: 'neutral'},
      row: (name, label, action) => button(name, label, action, {text: label}), currentSetup: () => ({kind: 'independent'}),
      space: () => ({characterRoles: [], activeStageId: 'stage-a'}), cameraCreationAllowed: () => true,
      cameraMenuContent: () => {const content = el('div'); content.append(button(null, '放置在此处', () => {})); content.dispose = () => disposed.push('camera'); return content;},
      createCharacterDraft: options => {const panel = createCharacterDraft(options), dispose = panel.dispose; panel.dispose = () => {disposed.push('role'); dispose();}; return panel;},
      beginPlanPlacement() {}, notice: error => errors.push(error)});
    vm.runInContext(`${extract('  function placementMenuContent(', '\n  function showPlanPlacementMenu(')}\nglobalThis.content = placementMenuContent;`, context);
    const parent = controller.toggle(doc.querySelector('#anchor'), () => context.content());
    const role = parent.querySelector('button[title="新建角色"]'), camera = parent.querySelector('button[title="添加摄像机"]');
    pointer(role, 'pointerenter'); await tick();
    const roleSurface = doc.getElementById(role.getAttribute('aria-controls')), input = roleSurface.querySelector('input');
    assert.equal(doc.activeElement, input, 'official role autofocus retains its input after hover');
    pointer(role, 'pointerleave', roleSurface); pointer(roleSurface, 'pointerenter');
    assert.equal([...timers.values()].filter(item => item.delay === 180).length, 0, 'crossing into child keeps the submenu');
    pointer(roleSurface, 'pointerleave', doc.body); advance(180);
    assert.equal(role.getAttribute('aria-expanded'), 'true', 'focused role input prevents hover dismissal');
    nativeClick(role); assert.equal(role.getAttribute('aria-expanded'), 'false', 'anchor pointerdown and focus must preserve child until click toggles it');
    assert.equal(parent.getAttribute('aria-hidden'), null); assert.deepEqual(disposed, ['role']);
    pointer(camera, 'pointerenter'); const cameraSurface = doc.getElementById(camera.getAttribute('aria-controls'));
    assert.equal(doc.activeElement, role, 'camera hover focus:false preserves current focus');
    pointer(camera, 'pointerleave', cameraSurface); pointer(cameraSurface, 'pointerenter');
    pointer(cameraSurface, 'pointerleave', doc.body); advance(179);
    assert.equal(camera.getAttribute('aria-expanded'), 'true'); advance(1);
    assert.equal(camera.getAttribute('aria-expanded'), 'false'); assert.equal(parent.getAttribute('aria-hidden'), null);
    nativeClick(camera); assert.equal(camera.getAttribute('aria-expanded'), 'true');
    nativeClick(camera); assert.equal(camera.getAttribute('aria-expanded'), 'false', 'click can close its own submenu without reopening it');
    pointer(camera, 'pointerenter'); const oldSurface = doc.getElementById(camera.getAttribute('aria-controls'));
    pointer(oldSurface, 'pointerleave', doc.body); const oldLeave = [...timers.values()].find(item => item.delay === 180).run;
    const foreign = controller.toggle(doc.querySelector('#foreign'), () => el('button', '', '其他菜单'));
    oldLeave(); pointer(oldSurface, 'pointerleave', doc.body); pointer(camera, 'pointerleave', doc.body); advance(180);
    assert.equal(controller.isOpen(), true); assert.equal(foreign.getAttribute('aria-hidden'), null, 'disposed child callbacks cannot close the foreign menu');
    pointer(doc.querySelector('#outside'), 'pointerdown'); assert.equal(controller.isOpen(), false);
    assert.deepEqual(errors, []); assert.equal(disposed.filter(kind => kind === 'camera').length, 3);
  } finally {
    controller?.dispose(); dom.window.setTimeout = originalSetTimeout; dom.window.clearTimeout = originalClearTimeout; dom.window.close();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  }
});

test('trajectory and delegated key optics retain rollback ownership when commit throws or refuses an active transaction', async () => {
  const [schema, world, {createHistory}, {createTemporalWorkspace}, {reduceTemporalAction}, {createPlanWorkspace}, {createPlanTrajectories}] = await Promise.all([
    'schema', 'world-space', 'history', 'temporal-workspace', 'temporal-actions', 'plan-workspace', 'plan-trajectories'
  ].map(name => import(`../src/features/studio-v3/${name}.mjs`)));
  for (const kind of ['key', 'key-heading', 'key-fov']) for (const failure of ['throw', 'false']) {
    const entityKind = kind === 'key-fov' ? 'camera' : 'actor', entityId = entityKind;
    let state = schema.createState({worldNodeId: 'commit-review', now: 1}), epoch = 0, selected = entityId, id = 0, host;
    const setupId = state.scenePlay.worldSpace.activeSetupId;
    state = world.addEntity(state, schema.createEntity({id: entityId, kind: entityKind, label: entityId, now: 1}),
      {setupId, setupState: {...schema.createSetupState(entityId, 1), ...(entityKind === 'camera' ? {
        camera: {position: {x: 0, y: 1.6, z: 0}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, fov: 60, frameAspectRatio: 16 / 9}
      } : {})}});
    const engine = createHistory(state, {createId: () => `commit-review:${++id}`, now: () => 10});
    const notify = () => {epoch++; host?.refresh();};
    const history = {...engine, preview(fn) {const value = engine.preview(fn); if (value) notify(); return value;},
      commit() {const value = engine.commit(); if (value) notify(); return value;}, cancel() {const value = engine.cancel(); if (value) notify(); return value;}};
    const session = {getState: engine.getState, getFence: () => ({owner: 'review', editEpoch: epoch, revision: 0}), history, isCurrent: () => true,
      change(fn, options) {const value = engine.transact(options.lane, options.label, fn, options.scope); if (value) notify(); return value;}};
    const runtime = {graph: {source: {}}, async sync() {}, render() {}};
    host = createTemporalWorkspace({getState: engine.getState, session, getRuntime: () => runtime, readCurrentSelection: () => selected,
      select: value => {selected = value; return true;}, getSourceKey: () => 'source-review', isHidden: () => false, playbackOptions: {autoSchedule: false}});
    const plan = createPlanWorkspace({getState: () => host.displayState, getAuthorState: engine.getState, session, temporal: host, getRuntime: () => runtime});
    const trajectories = createPlanTrajectories({getState: () => host.displayState, getAuthorState: engine.getState, session, temporal: host,
      getRuntime: () => runtime, getSelected: () => selected, beginEntityEdit: plan.beginEdit});
    const commit = history.commit, cancel = history.cancel;
    try {
      for (const timeMs of [0, 1000]) {
        const snapshot = structuredClone(engine.getState().scenePlay.worldSpace.setups.find(item => item.id === setupId).entityStates[0]);
        snapshot.transform.position.x = timeMs / 100;
        if (snapshot.camera) snapshot.camera.position.x = timeMs / 100;
        const result = reduceTemporalAction(engine.getState(), {type: 'save-key', setupId, entityId, timeMs, snapshot, keyId: `${entityId}:${timeMs}`}, {now: 10});
        assert(result.ok); session.change(() => result.state, {lane: result.lane, label: 'seed', scope: result.scope});
      }
      const before = structuredClone(engine.getState()), path = trajectories.readPaths()[0];
      const lease = await trajectories.beginEdit({kind, pathId: path.id, keyId: `${entityId}:1000`}); assert(lease, kind);
      assert.equal(lease.onMove(kind === 'key' ? {position: {x: 20, y: 999, z: 5}} : {heading: .8, ...(kind === 'key-fov' ? {fov: 40} : {})}), true);
      history.commit = () => {if (failure === 'throw') throw Error('review commit failure'); return false;};
      let ended; try {ended = lease.onEnd();} catch (error) {assert.match(error.message, /review commit failure/);}
      assert.notEqual(ended, true, `${kind}/${failure} must not claim success`);
      assert(history.getActiveTransaction(), `${kind}/${failure} retains the provisional history transaction`);
      history.cancel = () => {throw Error('review rollback failure');};
      let cancelled; try {cancelled = lease.onCancel();} catch (error) {assert.match(error.message, /review rollback failure/);}
      assert.notEqual(cancelled, true, `${kind}/${failure} failed rollback must not claim success`);
      assert(history.getActiveTransaction(), `${kind}/${failure} failed rollback retains the provisional history transaction`);
      history.cancel = cancel;
      assert.equal(lease.onCancel(), true, `${kind}/${failure} must retain its cancellation owner`);
      assert.equal(history.getActiveTransaction(), null); assert.deepEqual(engine.getState(), before);
      history.commit = commit;
      const count = engine.getHistory().lanes[`setup:${setupId}`].undoStack.length;
      const noChange = await trajectories.beginEdit({kind, pathId: path.id, keyId: `${entityId}:1000`}); assert(noChange);
      assert.equal(noChange.onEnd(), true, `${kind}/${failure} no-change completion releases both host and surface owners`);
      assert.equal(history.getActiveTransaction(), null); assert.equal(host.editing, false);
      const next = await trajectories.beginEdit({kind, pathId: path.id, keyId: `${entityId}:1000`}); assert(next, `${kind}/${failure} can begin again after no-change completion`);
      assert.equal(next.onCancel(), true); assert.equal(engine.getHistory().lanes[`setup:${setupId}`].undoStack.length, count);
      assert.deepEqual(engine.getState(), before);
    } finally {
      history.commit = commit; history.cancel = cancel; if (history.getActiveTransaction()) history.cancel();
      trajectories.dispose(); plan.dispose(); await host.dispose();
    }
  }
});
