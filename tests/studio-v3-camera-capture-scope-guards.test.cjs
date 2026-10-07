const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {placeOutputs} = require('../canvas-geometry.js');
const entry = fs.readFileSync(require.resolve('../src/features/studio-v3/entry.mjs'), 'utf8');
const modules = Promise.all([import('../src/features/studio-v3/camera-capture.mjs'),
  import('../src/features/studio-v3/session.mjs'), import('../src/features/studio-v3/schema.mjs')]);

function extract(startMarker, endMarker) {
  const start = entry.indexOf(startMarker), end = entry.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `production closure: ${startMarker}`);
  return entry.slice(start, end);
}

async function fixture() {
  const [{createCameraCapture}, {createStudioSession}, schema] = await modules;
  const state = schema.createState({worldNodeId: 'owner', now: 1});
  const source = {id: 'source', worldResource: {url: '/local.glb', format: 'glb'}};
  const owner = {id: 'owner', type: 'studio', x: 0, y: 0, width: 375, height: 250,
    studioV3: {version: 3, state, revision: 0, sourceBinding: {sourceNodeId: source.id,
      sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  const nodes = [owner, source], stats = {renders: 0, encodes: 0, assets: 0, adds: 0, saves: 0};
  const app = {getState: () => ({nodes}), projectIdentity: () => ({id: 'project'}),
    registerNodeWriteGuard: () => () => {},
    createConnected(id, outputs) {
      stats.adds++;
      const images = placeOutputs(owner, outputs, nodes).map(output => ({...output, id: 'photo', sourceId: id}));
      nodes.push(...images); return images;
    },
    async saveProject({beforeCommit}) {assert.equal(beforeCommit(), true); stats.saves++;}};
  const session = createStudioSession({nodeId: owner.id, app, store: {flush: async () => {}}, autosaveMs: null,
    getSourceSnapshot: node => node.worldResource,
    publishNode: async (id, patch, {beforeCommit}) => {
      assert.equal(beforeCommit(), true); owner.studioV3 = structuredClone(patch.studioV3);
    }});
  const camera = {isPerspectiveCamera: true, aspect: 1}, calls = [], notices = [];
  const optics = {position: {x: 1, y: 2, z: 3}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ'}, fov: 45, frameAspectRatio: 1};
  const runtime = {camera, disposed: false, possessing: {entityId: 'camera'}, controlling: null,
    checkpointCameraControl: () => true, getVisibleCameraState: () => structuredClone(optics), setCapturing() {},
    async renderCapture(value) {assert.equal(value, camera); stats.renders++; return {width: 100, height: 100};},
    finishCameraControl() {calls.push('finish'); this.possessing = null; return true;},
    setView(mode) {calls.push(['view', mode]); this.camera = {isPerspectiveCamera: true, aspect: 1}; return mode;},
    selectEntity(id) {calls.push(['select', id]); this.possessing = null; this.camera = {isPerspectiveCamera: true, aspect: 1}; return id;},
    previewCamera: id => calls.push(['preview', id]), attachTransform: (id, mode) => calls.push(['transform', id, mode]),
    startCameraControl: id => calls.push(['camera-control', id]), startControl: id => calls.push(['control', id]),
    controls: {target: {set() {calls.push('target');}}, update() {}},
    orbitCamera: {position: {set() {calls.push('position');}}, lookAt() {}}, render() {}};
  const capture = createCameraCapture({app, session, runtime, nodeId: owner.id, createId: () => 'capture', now: () => 2,
    assets: {async put() {stats.assets++; if (stats.assets === 1) throw Error('asset write failed'); return 'asset:photo';}},
    createCanvas: () => ({getContext: () => ({drawImage() {}}), toBlob(callback, type) {
      stats.encodes++; callback(new Blob(['png'], {type}));
    }})});
  const buttons = new Map(), instance = {};
  const context = vm.createContext({runtime, session, instance, cameraCapture: capture, calls,
    notice: message => notices.push(message), cancelCameraCreation: () => calls.push('creation-exit'),
    refresh() {}, window: {}, button(icon, label, action) {buttons.set(label, action); return {};},
    menus: {close: () => calls.push('menu-close')}, updateModeChrome() {}, canvas: {focus() {}},
    viewCapsule: {append() {}}, trailing: {append() {}}, renderSetup: () => ({entityStates: []})});
  vm.runInContext(`let alive = true, closing = null, active = instance, selected = 'camera', lastSync = Promise.resolve();
    const state = () => session.getState();
    ${extract('  const safe =', '\n  const menuController =')}
    ${extract('  function finishControlScope()', '\n  const state =')}
    ${extract('  const select =', '\n  const updatePreviewFrame =')}
    ${extract('const home = button(', '\n  const help =')}
    ${extract("  const orbit = button('onSet', '3D 视图'", '\n  const selectionTools =')}
    ${extract('  const transformButtons =', '\n  const inspectorButton =')}
    ${extract('  const cameraPreview =', '\n  const controlButton =')}
    ${extract('  const startSelectedCameraControl =', '\n  const switchSetup =')}
    ${extract('  instance.execute =', '\n  instance.close =')}
    ${extract('  instance.close =', '\n  try {')}
    globalThis.selectEntity = select;
    globalThis.startCameraControl = startSelectedCameraControl;
    globalThis.startControl = startSelectedControl;
  `, context, {filename: 'camera-capture-scope-production-closures.js'});
  return {capture, session, runtime, camera, stats, calls, notices, buttons, context, instance, nodes};
}

test('unapplied capture receipt blocks production home, view, select and close while preserving an idempotent retry', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.capture.capture(), /asset write failed/);
    assert.equal(f.capture.pendingReceipt.applied, false);
    assert.equal(f.capture.pendingReceipt.nodeId, null);
    for (const label of ['恢复初始视图', '3D 视图', '俯视图', '移动', '旋转', '缩放', '预览摄像机']) await f.buttons.get(label)();
    await f.context.startCameraControl();
    await f.context.startControl();
    assert.equal(f.context.selectEntity(null), false);
    await assert.rejects(f.instance.execute('select', {id: null}), /照片尚未保存/);
    await assert.rejects(f.instance.close(), /照片尚未保存.*重试/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.runtime.camera, f.camera);
    assert.equal(f.runtime.possessing.entityId, 'camera');
    assert(f.notices.every(message => message.includes('照片尚未保存')));
    const result = await f.capture.capture();
    assert.equal(result.ok, true);
    assert.equal(result.nodeId, 'photo');
    assert.equal(f.capture.pendingReceipt, null);
    assert.deepEqual(f.stats, {renders: 1, encodes: 1, assets: 2, adds: 1, saves: 1});
    assert.equal(f.runtime.camera, f.camera);
    assert.equal(f.nodes.filter(node => node.type === 'image').length, 1);
    await f.buttons.get('恢复初始视图')();
    assert.deepEqual(f.calls.slice(0, 3), ['finish', 'creation-exit', ['view', 'orbit']]);
    assert.notEqual(f.runtime.camera, f.camera);
  } finally {f.capture.dispose(); await f.session.closeGuard();}
});
