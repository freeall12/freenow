'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const source = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');
function extract(startMarker, endMarker) {const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length); assert(start >= 0 && end > start, startMarker); return source.slice(start, end);}
const entry = {
  finish: extract('  function finishControlScope(', '\n  const state ='),
  gate: extract('  async function allowStructuralWrite()', '\n  const switchSetup ='),
  sync: extract('  const sync = (strict = false)', '\n  const change ='),
  wiring: extract('    savedViews = createSavedViewWorkspace(', '\n    const timelineHost ='),
  menus: extract('  function showViewMenu()', '\n  const roomFence ='),
  close: extract('  instance.close = async', '\n  try {\n    session =')
};
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
// Execute the production entry callbacks against a real session and render
// graph. Only WebGL drawing and native controls are replaced in this fixture;
// native input/damping has its own runtime navigation regression coverage.
async function fixture() {
  const [THREE, schema, world, {createStudioSession}, {createStudioV3Runtime}, {createSavedViewWorkspace}, {createSavedViewMenu}, {createMenus}, {el, button}, {cameraOpticsPatch}] = await Promise.all([
    import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'),
    import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/runtime.mjs'), import('../src/features/studio-v3/saved-view-workspace.mjs'),
    import('../src/features/studio-v3/saved-view-menu.mjs'), import('../src/features/studio-v3/menus.mjs'), import('../src/features/studio-v3/dom.mjs'), import('../src/features/studio-v3/camera-optics.mjs')]);
  const dom = new JSDOM('<body><section id="root"><canvas></canvas><button id="view">3D</button></section></body>', {pretendToBeVisual: true});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: dom.window.document, configurable: true, writable: true});
  const root = dom.window.document.querySelector('#root'), canvas = root.querySelector('canvas'), viewButton = root.querySelector('#view');
  let initial = schema.createState({worldNodeId: 'owner', now: 1});
  initial = world.addEntity(initial, schema.createEntity({id: 'camera-entity', kind: 'camera', label: 'Author', now: 1}), {setupState: {...schema.createSetupState('camera-entity', 1), camera: cameraOpticsPatch({}, {position: {x: 99, y: 2, z: 5}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}})}});
  initial = world.addStage(initial, schema.createStage({worldNodeId: 'owner', id: 'stage-two', label: '舞台二', now: 1}));
  const stored = cameraOpticsPatch({}, {position: {x: -4, y: 3, z: 9}, rotation: {x: .2, y: -.4, z: .1, order: 'ZYX'}, focalLength: 85, frameAspectRatio: 9 / 16, apertureFNumber: 2, depthOfFieldMode: 'aperture', focusDistance: 7});
  initial = world.addView(initial, schema.createView({id: 'view-two', stageId: 'stage-two', setupId: schema.initialSetupId('stage-two'), label: '另一舞台', camera: stored, now: 1}));
  initial = world.setActiveSetup(initial, 'setup:state-1');
  const sourceNode = {id: 'source', worldResource: {url: '/scene.glb', format: 'glb'}}, target = {id: 'owner', studioV3: {version: 3, state: initial, revision: 0, sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(sourceNode.worldResource)}}};
  let guard, failures = 0, serial = 0, time = 1000, publishGate = null; const frames = new Map(), events = [], edits = [], notices = [], writes = [];
  const app = {getState: () => ({nodes: [target, sourceNode]}), projectIdentity: () => ({id: 'project'}), registerNodeWriteGuard(_id, cb) {guard = cb; return () => {guard = null;};}, select() {}};
  const instance = {}, context = vm.createContext({instance, active: instance, alive: true, closing: null, savedViews: null, savedViewMenu: null,
    lastSync: Promise.resolve(), selected: 'camera-entity', lastLane: 'world', roomEdit: null, cameraCreation: null, photoHistory: null, cameraBatch: null, cameraCapture: null,
    planPlacement: null, planTrajectories: null, planWorkspace: null, planView: null, observer: null, toastTimer: null, controlHUD: {dispose() {}}, cameraHUD: null, shotExporter: null, shotPreview: null, cameraHistory: null,
    cancelRoomEdit: () => true, cancelPlanGesture() {events.push('cancel-plan');}, cancelCameraCreation() {context.cameraCreation = null;}, refresh() {context.savedViewMenu?.refresh();}, notice: message => notices.push(message), clearTimeout,
    root, canvas, viewButton, app, node: {id: 'owner'}, returnFocus: null, document: dom.window.document, window: dom.window,
    el, createSavedViewMenu, createSavedViewWorkspace: options => createSavedViewWorkspace({...options, createId: () => 'entry-created', now: () => 10}),
    state: () => session.getState(), displayState: () => session.getState(), space: () => session.getState().scenePlay.worldSpace,
    workspaceSourceKey: () => ({resource: sourceNode.worldResource}), roomFence: () => {const {revision, ...fence} = session.getFence(); return JSON.stringify(fence);},
    select: id => {context.selected = runtime.selectEntity(id); events.push(`select:${id}`); return true;}});
  const session = createStudioSession({nodeId: 'owner', app, autosaveMs: null, getSourceSnapshot: node => node.worldResource,
    onChange: () => context.sync?.(), isCurrentSession: () => context.alive && context.active === instance,
    store: {flush: async () => events.push('flush')}, publishNode: async (_id, patch, {beforeCommit}) => {
      events.push('publish'); writes.push(structuredClone(patch.studioV3)); const gate = publishGate; publishGate = null; if (gate) await gate.promise;
      if (failures) {failures--; throw Error('disk unavailable');} assert.equal(beforeCommit(), true);
      const candidate = {...target, studioV3: structuredClone(patch.studioV3)}; assert.equal(guard(candidate), true); target.studioV3 = candidate.studioV3;
    }});
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} detach() {this.object = null;} setMode() {} dispose() {}}
  const runtime = createStudioV3Runtime({canvas, getState: session.getState, getFence: session.getFence, isCurrent: () => context.alive && session.isCurrent(), getSourceResource: () => null,
    rendererFactory: () => ({domElement: canvas, setPixelRatio() {}, setSize() {}, render() {}, dispose() {}, forceContextLoss() {}}),
    controlsFactory: camera => ({object: camera, target: new THREE.Vector3(), enabled: true, update: () => false, dispose() {}, addEventListener() {}, removeEventListener() {}}),
    transformFactory: () => new Transform(), requestFrame: cb => {frames.set(++serial, cb); return serial;}, cancelFrame: id => frames.delete(id),
    onCameraEdit: event => edits.push(event), onTransform: event => edits.push(event), onControl: event => edits.push(event), getTemporalStatus: () => ({}), canControlInput: () => !context.menus.isOpen()});
  context.session = session; context.runtime = runtime; context.temporal = {confirming: false, async beforeWrite() {return {ok: true};}, getTemporalStatus: () => ({}), clearSelectedKey() {events.push('clear-key'); return true;}, onAuthorStateChanged() {}, dispose() {}};
  const nativeMenus = createMenus({root, onError: error => notices.push(error.message)}); context.menus = {...nativeMenus};
  for (const name of ['toggle', 'openAt', 'openNested']) context.menus[name] = (...args) => {if (!context.finishControlScope()) return false; return nativeMenus[name](...args);};
  context.row = (name, label, action) => button(name, label, async event => {try {await action(event);} catch (error) {notices.push(error.message);}}, {className: 'sv3-menu-row', text: label});
  context.menu = (label, rows) => {const node = el('div'); node.ariaLabel = label; node.append(...rows); return node;};
  vm.runInContext(`${entry.finish}\n${entry.gate}\n${entry.sync}\nglobalThis.sync = sync;\n${entry.wiring}\n${entry.menus}\n${entry.close}`, context);
  await runtime.sync();
  return {context, session, runtime, stored, initial, root, dom, sourceNode, target, events, edits, notices, writes, world,
    fail(count = 1) {failures += count;}, holdPublish() {return publishGate = deferred();},
    step(count = 20) {for (let i = 0; i < count; i++) {const entry = frames.entries().next().value; if (!entry) break; frames.delete(entry[0]); entry[1](time += 50);}},
    async cleanup() {context.savedViews.dispose(); if (session.history.getActiveTransaction()) session.history.cancel(); if (session.isCurrent()) {failures = 0; await session.closeGuard();} nativeMenus.dispose(); await runtime.dispose(); dom.window.close(); if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;}};
}

test('actual Saved Views entry crosses scene sync into detached navigation with full stored optics and no author-camera or temporal changes', async () => {
  const f = await fixture(); try {
    const before = f.session.getState(), restoring = f.context.savedViews.restore('view-two'); await tick();
    assert.equal(f.context.savedViews.busy, true); assert.equal(f.context.finishControlScope(), false); assert.equal(f.context.finishControlScope({allowSavedViews: true}), true);
    assert.equal(f.session.getState().scenePlay.worldSpace.activeViewId, 'view-two'); assert.equal(f.runtime.view, 'orbit');
    assert.deepEqual(f.runtime.getNavigationCameraState(), f.stored); f.step();
    const result = await restoring; assert.equal(result.restored, true); assert.equal(result.saved, true);
    assert.deepEqual(f.runtime.orbitCamera.userData.studioV3Optics, f.stored); assert.equal(f.context.selected, null);
    assert.deepEqual(f.session.getState().scenePlay.worldSpace.entities, before.scenePlay.worldSpace.entities);
    assert.deepEqual(f.session.getState().scenePlay.worldSpace.setups, before.scenePlay.worldSpace.setups); assert.deepEqual(f.edits, []);
    assert.equal(f.session.getStatus().contentDirtySeq, 0); assert.equal(f.session.history.getHistory().lanes.world.undoStack.length, 1);
    const same = f.context.savedViews.restore('view-two'); await tick(); f.step(); assert.equal((await same).restored, true); assert.equal(f.writes.length, 1);
  } finally {await f.cleanup();}
});

test('parent/child entry dismissal preserves a failed save receipt across reopen and retries the same View without another create', async () => {
  const f = await fixture(); try {
    f.context.showViewMenu(); f.root.querySelector('.sv3-menu:not([data-exiting="true"]) button[title="已保存视图"]').click(); assert(f.context.savedViewMenu);
    f.fail(); f.context.savedViewMenu.querySelector('[aria-label="保存当前视角"]').click(); await tick(); await tick();
    assert.equal(f.context.savedViews.read().pendingSave.viewId, 'entry-created'); assert.equal(f.context.savedViews.busy, false);
    f.dom.window.document.body.dispatchEvent(new f.dom.window.Event('pointerdown', {bubbles: true}));
    assert.equal(f.context.savedViewMenu, null); assert.equal(f.context.menus.isOpen(), false);
    f.context.showViewMenu(); f.root.querySelector('.sv3-menu:not([data-exiting="true"]) button[title="已保存视图"]').click();
    const retry = f.context.savedViewMenu.querySelector('[aria-label="重试保存视图"]'); assert(retry); assert.equal(retry.disabled, false); retry.click(); await tick(); await tick();
    assert.equal(f.context.savedViews.read().pendingSave, null); assert.equal(f.session.getState().scenePlay.worldSpace.views.filter(view => view.id === 'entry-created').length, 1);
    assert.equal(f.session.history.getHistory().lanes[`setup:${f.initial.scenePlay.worldSpace.activeSetupId}`].undoStack.length, 1);
  } finally {await f.cleanup();}
});

test('entry close rejects busy Saved Views before menu disposal and failed closeGuard retains session and receipt for retry', async () => {
  const f = await fixture(); try {
    const gate = f.holdPublish(), saving = f.context.savedViews.saveCurrent(); await tick();
    await assert.rejects(f.context.instance.close(), /视图正在保存或恢复/); assert.equal(f.context.closing, null); assert.equal(f.context.alive, true); assert.equal(f.session.isCurrent(), true);
    gate.resolve(); assert.equal((await saving).saved, true);
    f.fail(2); const rename = await f.context.savedViews.rename('entry-created', 'Renamed'); assert.equal(rename.reason, 'save-failed');
    await assert.rejects(f.context.instance.close(), /disk unavailable/); assert.equal(f.context.closing, null); assert.equal(f.context.alive, true); assert.equal(f.session.isCurrent(), true); assert(f.root.isConnected);
    assert.equal(f.context.savedViews.read().pendingSave.viewId, 'entry-created'); assert.equal((await f.context.savedViews.retrySave()).saved, true);
    await f.context.instance.close(); assert.equal(f.context.alive, false); assert.equal(f.session.isCurrent(), false); assert.equal(f.root.isConnected, false);
  } finally {await f.cleanup();}
});

for (const kind of ['source', 'session', 'native revision', 'foreign transaction', 'closing', 'disposed']) test(`actual entry restores are fenced against ${kind} while scene synchronization is awaiting`, async () => {
  const f = await fixture(); try {
    const gate = deferred(), sync = f.runtime.sync; let held = true;
    f.runtime.sync = async value => {await sync(value); if (held) await gate.promise;};
    const pending = f.context.savedViews.restore('view-two'); await tick(); assert.equal(f.session.getState().scenePlay.worldSpace.activeViewId, 'view-two');
    if (kind === 'source') f.sourceNode.worldResource.url = '/different.glb';
    if (kind === 'session') f.context.active = null;
    if (kind === 'native revision') f.target.studioV3.revision++;
    if (kind === 'foreign transaction') f.session.history.begin('world', 'Foreign');
    if (kind === 'closing') f.context.closing = Promise.resolve();
    if (kind === 'disposed') f.context.savedViews.dispose();
    held = false; gate.resolve(); const result = await pending; assert.equal(result.ok, false); assert.equal(result.restored === true, false); assert.equal(f.runtime.controls.enabled, true);
    if (kind === 'foreign transaction') assert.equal(f.session.history.getActiveTransaction().label, 'Foreign');
    f.context.closing = null;
  } finally {await f.cleanup();}
});

test('actual entry propagates a refused structural write and refuses navigation when the temporal key selection cannot clear', async () => {
  const f = await fixture(); try {
    const originalGate = f.context.allowStructuralWrite;
    f.context.allowStructuralWrite = async () => false;
    const refused = await f.context.savedViews.saveCurrent(); assert.equal(refused.ok, false); assert.equal(f.writes.length, 0);
    f.context.allowStructuralWrite = originalGate;
    f.context.temporal.clearSelectedKey = () => false;
    const restored = await f.context.savedViews.restore('view-two'); assert.equal(restored.reason, 'navigation-failed'); assert.equal(restored.applied, true); assert.equal(restored.saved, true);
    assert.equal(f.context.selected, 'camera-entity'); assert.equal(f.runtime.controls.enabled, true);
  } finally {await f.cleanup();}
});
