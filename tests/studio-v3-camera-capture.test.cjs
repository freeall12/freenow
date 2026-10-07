const test = require('node:test');
const assert = require('node:assert/strict');
const {placeOutputs} = require('../canvas-geometry.js');
const modules = Promise.all([import('../src/features/studio-v3/camera-capture.mjs'), import('../src/features/studio-v3/session.mjs'),
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs')]);
const defer = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

async function fixture({aspect = 16 / 9, width = 800, height = 600, readonly = false} = {}) {
  const [{createCameraCapture}, {createStudioSession}, schema, world] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 1});
  state = world.addEntity(state, schema.createEntity({id: 'camera', kind: 'camera', label: 'Camera', now: 1}));
  const cameraState = {position: {x: 1, y: 2, z: 3}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, fov: 40, frameAspectRatio: aspect};
  const setup = state.scenePlay.worldSpace.setups.find(item => item.kind === 'independent');
  setup.entityStates.find(item => item.entityId === 'camera').camera = structuredClone(cameraState);
  const source = {id: 'source', worldResource: {url: '/local.glb', format: 'glb'}};
  const owner = {id: 'owner', type: 'studio', x: 0, y: 0, width: 375, height: 250, studioV3: {version: 3, state, revision: 0,
    sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  const nodes = [owner, source], stats = {renders: 0, encodes: 0, assets: 0, adds: 0, saves: 0, checkpoints: 0, draws: [], statuses: []};
  let current = true, projectId = 'project', durable, saveError, assetError, encodeError, renderError, saveGate, renderGate, assetGate, encodeGate, checkpointAccepted = true;
  const app = {
    getState: () => ({nodes}), projectIdentity: () => ({id: projectId}), registerNodeWriteGuard: () => () => {},
    createConnected(id, outputs) {
      stats.adds++; const source = nodes.find(node => node.id === id), added = placeOutputs(source, outputs, nodes).map(output => ({...output, id: 'image-' + stats.adds, sourceId: id}));
      nodes.push(...added); return added;
    },
    async saveProject({beforeCommit}) {
      stats.saves++; assert.equal(beforeCommit(), true);
      const snapshot = structuredClone({nodes}); if (saveGate) {const gate = saveGate; saveGate = null; await gate.promise;}
      if (saveError) {const error = saveError; saveError = null; throw error;}
      if (!beforeCommit()) throw Error('save fence rejected'); durable = snapshot;
    }
  };
  const session = createStudioSession({nodeId: owner.id, app, store: {flush: async () => {}}, readonly,
    getSourceSnapshot: node => node.worldResource, isCurrentSession: () => current, autosaveMs: null,
    publishNode: async (id, patch, {beforeCommit}) => {assert.equal(beforeCommit(), true); owner.studioV3 = structuredClone(patch.studioV3);}});
  const camera = {isPerspectiveCamera: true, aspect}, rendered = {width, height}; let capturing = false, possessing = true;
  const runtime = {
    camera, disposed: false, previewCameraEntityId: null,
    get possessing() {return possessing ? {entityId: 'camera'} : null;},
    getVisibleCameraState: () => structuredClone(cameraState),
    checkpointCameraControl() {
      stats.checkpoints++; if (!checkpointAccepted) return false;
      if (session.history.getActiveTransaction()) {if (!session.history.commit()) session.history.cancel();} return true;
    },
    setCapturing(value) {capturing = value;},
    async renderCapture(value) {
      assert.equal(value, camera); assert.equal(capturing, true); stats.renders++;
      if (renderGate) {const gate = renderGate; renderGate = null; await gate.promise;}
      if (renderError) throw renderError; return rendered;
    }
  };
  const assets = {async put(blob) {
    assert.equal(blob.type, 'image/png'); stats.assets++;
    if (assetGate) {const gate = assetGate; assetGate = null; await gate.promise;}
    if (assetError) {const error = assetError; assetError = null; throw error;} return 'asset:photo';
  }};
  const createCanvas = () => ({getContext: () => ({drawImage: (...args) => stats.draws.push(args)}), toBlob(callback, type) {
    assert.equal(capturing, true); stats.encodes++;
    const finish = () => callback(encodeError ? null : new Blob(['png-bytes'], {type}));
    if (encodeGate) {const gate = encodeGate; encodeGate = null; gate.promise.then(finish);} else finish();
  }});
  const capture = createCameraCapture({app, session, runtime, nodeId: owner.id, assets, createCanvas, createId: () => 'capture-1', now: () => 10,
    onStatus: value => stats.statuses.push(value)});
  return {capture, session, owner, source, nodes, app, runtime, stats, cameraState, durable: () => durable, capturing: () => capturing,
    failSave: () => {saveError = Error('disk unavailable');}, failAsset: () => {assetError = Error('asset write failed');},
    failEncode: () => {encodeError = true;}, failRender: () => {renderError = Error('GPU draw failed');},
    holdSave: () => (saveGate = defer()), holdRender: () => (renderGate = defer()), holdAsset: () => (assetGate = defer()), holdEncode: () => (encodeGate = defer()),
    stale: () => {current = false;}, project: () => {projectId = 'another';}, checkpoint: value => {checkpointAccepted = value;}, preview: () => {possessing = false; runtime.previewCameraEntityId = 'camera';}};
}
const until = async predicate => {for (let i = 0; i < 20 && !predicate(); i++) await new Promise(done => setImmediate(done)); assert.ok(predicate());};

test('shutter saves an aspect-correct PNG asset and connected image, preserving director state and mode', async () => {
  const f = await fixture(), before = f.session.getState();
  const result = await f.capture.capture(); assert.equal(result.ok, true); assert.deepEqual([result.width, result.height], [800, 450]);
  assert.deepEqual(f.stats.draws[0].slice(1), [0, 75, 800, 450, 0, 0, 800, 450]);
  const image = f.nodes.at(-1); assert.equal(image.image, 'asset:photo'); assert.equal(image.sourceId, 'owner');
  assert.equal(image.width, 446); assert.equal(image.height, 446 * 450 / 800); assert.equal(image.pixelWidth, 800);
  assert.equal(image.provenance.sourceCameraEntityId, 'camera'); assert.equal(image.provenance.sourceNodeId, 'source');
  assert.equal(image.provenance.setupId, before.scenePlay.worldSpace.activeSetupId); assert.deepEqual(image.provenance.camera, f.cameraState);
  assert.deepEqual(f.session.getState(), before); assert.deepEqual(f.owner.studioV3.state.capturedPhotos, []);
  assert.equal(f.owner.studioV3.state.scenePlay.worldSpace.views.length, 0); assert.equal(f.durable().nodes.at(-1).id, image.id);
  assert.ok(f.runtime.possessing); assert.equal(f.capture.busy, false); assert.equal(f.capturing(), false); assert.equal(f.capture.pendingReceipt, null);
});

test('portrait crop and 4096 maximum never stretch the viewport matte or enlarge native detail', async () => {
  const [{cameraCaptureGeometry}] = await modules;
  assert.deepEqual(cameraCaptureGeometry(800, 600, 9 / 16), {left: 231.25, top: 0, sourceWidth: 337.5, sourceHeight: 600, width: 338, height: 600});
  assert.deepEqual(cameraCaptureGeometry(9000, 6000, 3 / 2), {left: 0, top: 0, sourceWidth: 9000, sourceHeight: 6000, width: 4096, height: 2731});
  assert.throws(() => cameraCaptureGeometry(0, 600, 1), /尺寸无效/);
  const f = await fixture({aspect: 9 / 16}); const result = await f.capture.capture(); assert.deepEqual([result.width, result.height], [338, 600]);
  assert.equal(f.stats.draws[0][1], 231.25); assert.equal(f.stats.draws[0][3], 337.5);
});

test('checkpoint commits preview pose before shutter; rejected checkpoint and foreign transactions create no asset', async () => {
  const f = await fixture(); f.session.history.begin('director', 'camera-edit');
  f.session.history.preview(state => {state.scenePlay.worldSpace.setups.find(item => item.kind === 'independent').entityStates[0].camera.position.x = 7; return state;});
  const result = await f.capture.capture(); assert.equal(result.ok, true); assert.equal(f.owner.studioV3.state.scenePlay.worldSpace.setups[1].entityStates[0].camera.position.x, 7);
  const blocked = await fixture(); blocked.checkpoint(false); await assert.rejects(blocked.capture.capture(), error => error.code === 'studio_v3_capture_checkpoint'); assert.equal(blocked.stats.renders, 0);
  const foreign = await fixture(); foreign.preview(); foreign.session.history.begin('world', 'other edit');
  await assert.rejects(foreign.capture.capture(), error => error.code === 'studio_v3_capture_transaction'); assert.equal(foreign.stats.assets, 0);
});

test('durable save failure keeps receipt and retries the same image without another render, asset, or node', async () => {
  const f = await fixture(); f.failSave();
  await assert.rejects(f.capture.capture(), error => error.applied === true && error.nodeId === 'image-1' && error.retryable === true);
  assert.equal(f.capture.pendingReceipt.nodeId, 'image-1'); assert.equal(f.stats.statuses.some(value => value.status === 'saved'), false);
  const result = await f.capture.capture(); assert.equal(result.nodeId, 'image-1');
  assert.deepEqual([f.stats.renders, f.stats.encodes, f.stats.assets, f.stats.adds, f.stats.saves], [1, 1, 1, 1, 2]);
  assert.equal(f.nodes.length, 3); assert.equal(f.capture.pendingReceipt, null);
});

test('asset failure is retryable from the encoded snapshot; encode and renderer failures make no image', async () => {
  const f = await fixture(); f.failAsset(); await assert.rejects(f.capture.capture(), /asset write failed/);
  await f.capture.capture(); assert.deepEqual([f.stats.renders, f.stats.encodes, f.stats.assets, f.stats.adds], [1, 1, 2, 1]);
  for (const fail of ['failEncode', 'failRender']) {const broken = await fixture(); broken[fail](); await assert.rejects(broken.capture.capture()); assert.equal(broken.nodes.length, 2); assert.equal(broken.stats.assets, 0); assert.equal(broken.capturing(), false);}
});

test('render, encode, and asset awaits reject stale source/pose or disposal before any image write', async () => {
  for (const stage of ['holdRender', 'holdEncode', 'holdAsset']) {
    const f = await fixture(), gate = f[stage](), pending = f.capture.capture();
    await until(() => stage === 'holdRender' ? f.stats.renders : stage === 'holdEncode' ? f.stats.encodes : f.stats.assets);
    f.source.worldResource.url = '/changed.glb'; gate.resolve(); await assert.rejects(pending, /变化|停止/); assert.equal(f.stats.adds, 0); assert.equal(f.capturing(), false);
  }
  const disposed = await fixture(), gate = disposed.holdRender(), pending = disposed.capture.capture(); await until(() => disposed.stats.renders);
  disposed.capture.dispose(); gate.resolve(); await assert.rejects(pending, error => error.code === 'studio_v3_capture_stale'); assert.equal(disposed.stats.adds, 0);
  const moved = await fixture(), encoding = moved.holdEncode(), work = moved.capture.capture(); await until(() => moved.stats.encodes);
  moved.cameraState.position.x = 99; encoding.resolve(); await assert.rejects(work, error => error.code === 'studio_v3_capture_stale'); assert.equal(moved.stats.assets, 0);
});

test('concurrent capture is blocked; commit guard rejects a stale owner and preserves applied status', async () => {
  const f = await fixture(), gate = f.holdSave(), pending = f.capture.capture(); await until(() => f.stats.saves);
  await assert.rejects(f.capture.capture(), error => error.code === 'studio_v3_capture_busy'); f.project(); gate.resolve();
  await assert.rejects(pending, error => error.applied === true && error.nodeId === 'image-1'); assert.equal(f.durable(), undefined); assert.equal(f.capture.busy, false);
});

test('retry refuses deleted or modified image receipts and readonly never creates a photo', async () => {
  for (const mutate of [f => f.nodes.pop(), f => {f.nodes.at(-1).image = 'asset:other';}]) {
    const f = await fixture(); f.failSave(); await assert.rejects(f.capture.capture()); mutate(f);
    await assert.rejects(f.capture.capture(), error => error.code === 'studio_v3_capture_receipt_stale'); assert.equal(f.stats.adds, 1);
  }
  const readonly = await fixture({readonly: true}); await assert.rejects(readonly.capture.capture(), error => error.code === 'studio_v3_capture_scene_save'); assert.equal(readonly.stats.renders, 0);
});
