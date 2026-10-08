'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const source = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, startMarker); return source.slice(start, end);
}
const spaceActions = extract('  const roomFence =', '\n  function showSpaceMenu()');
const finishControlScope = extract('  function finishControlScope()', '\n  const state =');
const cancelRoomEdit = extract('  function cancelRoomEdit()', '\n  async function switchViewport');
const allowStructuralWrite = extract('  async function allowStructuralWrite()', '\n  const switchSetup =');
const viewport = extract('  async function switchViewport(', '\n  function updateViewTrigger()');
const close = extract('  instance.close = async', '\n  try {\n    session =');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
async function fixture() {
  const [{createStudioSession}, schema, {reduceSpaceAction}, {createTemporalWorkspace}, {createSpaceMenu}] = await Promise.all([
    import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/schema.mjs'),
    import('../src/features/studio-v3/space-actions.mjs'), import('../src/features/studio-v3/temporal-workspace.mjs'), import('../src/features/studio-v3/space-menu.mjs')
  ]);
  let initial = schema.createState({worldNodeId: 'owner', now: 100});
  initial = reduceSpaceAction(initial, {type: 'set-space-source', source: {kind: 'mesh-preset', preset: 'room'}}).state;
  const sourceNode = {id: 'source', worldResource: {url: 'local.glb', format: 'glb'}};
  const target = {id: 'owner', studioV3: {version: 3, state: initial, revision: 0, sourceBinding: {
    sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(sourceNode.worldResource)}}};
  const app = {getState: () => ({nodes: [target, sourceNode]}), projectIdentity: () => ({id: 'project'}), registerNodeWriteGuard: () => () => {}, select() {}};
  const session = createStudioSession({nodeId: 'owner', app, autosaveMs: null, sessionToken: 'review',
    store: {flush: async () => {}}, getSourceSnapshot: node => node.worldResource,
    publishNode: async (_id, patch) => {target.studioV3 = structuredClone(patch.studioV3);},
    historyOptions: {createId: (() => {let id = 0; return () => `review-${++id}`;})(), now: () => 101}});
  const temporal = createTemporalWorkspace({getState: session.getState, session, isHidden: () => false});
  const calls = [], instance = {};
  // VM-created object literals have a different Object prototype. Bridge the
  // scope/action data without replacing actual session/history semantics.
  const vmSession = {...session, history: {...session.history,
    begin: (lane, label, scope) => session.history.begin(lane, label, structuredClone(scope))}};
  const context = vm.createContext({session: vmSession, temporal, instance, active: instance, alive: true, closing: null, roomEdit: null, spacePanel: {}, roomRequestId: 0,
    lastLane: 'world', lastSync: Promise.resolve(), state: session.getState, space: () => session.getState().scenePlay.worldSpace,
    runtime: {cancelTransform() {}, setView: mode => {calls.push(['view', mode]); return true;}, dispose: async () => calls.push('disposed')},
    notice() {}, cancelPlanGesture: () => {}, cancelCameraCreation() {}, menus: {close() {}, dispose() {}},
    reduceSpaceAction: (state, action) => reduceSpaceAction(state, structuredClone(action)), change: (reducer, label, lane) => session.change(reducer, {label, lane, scope: {kind: 'world-space'}}),
    workspaceSourceResource: () => null, app, node: {id: 'owner'}, refresh() {}, planView: {element: {focus() {}}, dispose() {}}, canvas: {focus() {}},
    planWorkspace: null, planPlacement: null, planTrajectories: null, cameraBatch: null, cameraCapture: null, cameraHUD: null, cameraHistory: null, shotExporter: null, shotPreview: null,
    photoHistory: null, observer: null, toastTimer: null, clearTimeout, controlHUD: {dispose() {}}, root: {remove() {}},
    document: {body: {classList: {remove() {}}}, querySelector: () => null}, window: {}, returnFocus: null});
  vm.runInContext(`${finishControlScope}\n${cancelRoomEdit}\n${spaceActions}\n${allowStructuralWrite}\n${viewport}\n${close}\nglobalThis.actions = {spaceAction, beginRoomEdit, switchViewport};`, context);
  const mutate = action => session.change(state => reduceSpaceAction(state, action).state, {label: 'external', lane: 'world', scope: {kind: 'world-space'}});
  return {session, temporal, context, calls, mutate, createSpaceMenu};
}

test('room lease uses actual session preview boolean semantics', async () => {
  const f = await fixture(), before = f.session.getState().scenePlay.worldSpace.roomConfig.width;
  const lease = await f.context.actions.beginRoomEdit(); assert(lease);
  assert.equal(lease.onMove({width: before + 1}), true);
  assert.equal(lease.onMove({width: before + 1}), true, 'unchanged reducer is accepted without another history preview');
  assert.equal(lease.onCancel(), true); assert.equal(f.session.getState().scenePlay.worldSpace.roomConfig.width, before);
  await f.temporal.dispose(); await f.session.closeGuard();
});

test('queued space mutation cannot apply into author content replaced while the write gate drains', async () => {
  const f = await fixture(), gate = deferred(); f.context.temporal = {...f.temporal, beforeWrite: () => gate.promise};
  const pending = f.context.actions.spaceAction({type: 'set-space-source', source: {kind: 'empty'}});
  f.mutate({type: 'update-room', patch: {width: 37}}); gate.resolve(true);
  await assert.rejects(pending, /片场已变化/, 'the old menu action must reject its stale entrance fence');
  assert.equal(f.session.getState().scenePlay.worldSpace.source.kind, 'mesh-preset');
});

test('queued room lease cannot begin against changed author content after its async gate', async () => {
  const f = await fixture(), gate = deferred(); f.context.temporal = {...f.temporal, beforeWrite: () => gate.promise};
  const pending = f.context.actions.beginRoomEdit(); f.mutate({type: 'update-room', patch: {width: 37}}); gate.resolve(true);
  await assert.rejects(pending, /片场已变化/, 'room lease must retain its pre-await author fence');
  assert.equal(f.session.history.getActiveTransaction(), null);
});

test('queued viewport action stops when its editor closes during the write gate', async () => {
  const f = await fixture(), gate = deferred(); f.context.temporal = {...f.temporal, beforeWrite: () => gate.promise};
  const pending = f.context.actions.switchViewport('plan'); f.context.alive = false; gate.resolve(true);
  await assert.rejects(pending, /片场已变化/); assert.deepEqual(f.calls, []);
});

test('close cancels the active plan transaction before structural and session close guards', async () => {
  const f = await fixture(), lane = `setup:${f.session.getState().scenePlay.worldSpace.activeSetupId}`;
  f.session.history.begin(lane, 'plan gesture', {kind: 'world-space'});
  f.context.cancelPlanGesture = () => {f.calls.push('plan-cancel'); if (f.session.history.getActiveTransaction()) f.session.history.cancel();};
  await f.context.instance.close();
  assert.equal(f.session.history.getActiveTransaction(), null); assert.equal(f.session.isCurrent(), false);
  assert(f.calls.indexOf('plan-cancel') < f.calls.indexOf('disposed'));
});

test('close drains real room menu cancellation before checking the active transaction', async () => {
  const f = await fixture(), dom = new JSDOM('<body><div id="root"></div></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: dom.window.document, configurable: true, writable: true});
  let menu;
  try {
    menu = f.createSpaceMenu({read: () => ({...f.session.getState().scenePlay.worldSpace, busy: false, scenes: [], hasOriginal: true}),
      setSource: source => f.context.actions.spaceAction({type: 'set-space-source', source}),
      updateRoom: patch => f.context.actions.spaceAction({type: 'update-room', patch}), beginRoomEdit: f.context.actions.beginRoomEdit, close() {}});
    dom.window.document.querySelector('#root').append(menu); menu.querySelector('[aria-label="房间 设置"]').click();
    const trigger = menu.querySelector('[data-room-dimension="width"]').parentElement.querySelector('button');
    const down = new dom.window.Event('pointerdown', {bubbles: true, cancelable: true});
    for (const [key, value] of Object.entries({button: 0, pointerId: 4, clientX: 20})) Object.defineProperty(down, key, {value});
    trigger.dispatchEvent(down);
    const move = new dom.window.Event('pointermove', {bubbles: true, cancelable: true});
    for (const [key, value] of Object.entries({pointerId: 4, clientX: 50})) Object.defineProperty(move, key, {value});
    dom.window.dispatchEvent(move); await tick(); assert(f.session.history.getActiveTransaction());
    f.context.menus.close = () => menu.dispose();
    await f.context.instance.close(); assert.equal(f.session.history.getActiveTransaction(), null);
    assert.equal(f.session.isCurrent(), false);
  } finally {menu?.dispose(); await tick(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
});

for (const action of ['switchViewport', 'beginRoomEdit']) test(`${action} rechecks author identity after lastSync, beyond the structural gate`, async () => {
  const f = await fixture(), sync = deferred(), entered = deferred();
  f.context.lastSync = sync.promise;
  f.context.temporal = {...f.temporal, async beforeWrite() {const result = await f.temporal.beforeWrite(); entered.resolve(); return result;}};
  const pending = action === 'switchViewport' ? f.context.actions.switchViewport('plan') : f.context.actions.beginRoomEdit();
  await entered.promise; await tick();
  f.mutate({type: 'update-room', patch: {width: 37}}); sync.resolve();
  let result, error;
  try {result = await pending;} catch (caught) {error = caught;}
  if (error) assert.match(error.message, /片场已变化/);
  else assert.equal(result, action === 'switchViewport' ? false : null);
  if (action === 'switchViewport') assert.deepEqual(f.calls, []);
  else assert.equal(f.session.history.getActiveTransaction(), null);
});

test('dismissed room menu rejects its pending lease without creating a late transaction', async () => {
  const f = await fixture(), gate = deferred(); f.context.temporal = {...f.temporal, beforeWrite: () => gate.promise};
  const pending = f.context.actions.beginRoomEdit(); f.context.cancelRoomEdit(); f.context.spacePanel = null;
  gate.resolve({ok: true}); assert.equal(await pending, null); assert.equal(f.session.history.getActiveTransaction(), null);
  await f.temporal.dispose(); await f.session.closeGuard();
});

test('close invalidates pending room preparation before that preparation can create a transaction', async () => {
  const f = await fixture(), gate = deferred(); f.context.temporal = {...f.temporal, beforeWrite: () => gate.promise};
  const pending = f.context.actions.beginRoomEdit(), closing = f.context.instance.close(); gate.resolve({ok: true});
  assert.equal(await pending, null); await closing;
  assert.equal(f.session.history.getActiveTransaction(), null); assert.equal(f.session.isCurrent(), false);
});

test('room commit failure retains lease ownership so cancellation can restore the provisional dimensions', async () => {
  const f = await fixture(), before = f.session.getState().scenePlay.worldSpace.roomConfig.width;
  const lease = await f.context.actions.beginRoomEdit(); assert(lease); assert.equal(lease.onMove({width: before + 1}), true);
  f.context.session.history.commit = () => {throw Error('commit failed');};
  assert.throws(() => lease.onEnd(), /commit failed/); assert(f.session.history.getActiveTransaction());
  assert.equal(lease.onCancel(), true); assert.equal(f.session.history.getActiveTransaction(), null);
  assert.equal(f.session.getState().scenePlay.worldSpace.roomConfig.width, before);
  await f.temporal.dispose(); await f.session.closeGuard();
});
