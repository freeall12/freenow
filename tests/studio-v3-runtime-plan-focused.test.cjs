const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/runtime.mjs')]);
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
async function fixture({autoRender = false} = {}) {
  const [THREE, schema, domain, {createStudioV3Runtime}] = await modules;
  let state = schema.createState({worldNodeId: 'plan-world', now: 1}), revision = 1, source = null, pendingSource = null, failRender = false, rendererDisposals = 0, nextFrame = 0;
  for (const [id, kind] of [['actor', 'actor'], ['prop', 'prop'], ['camera', 'camera']]) {
    const entity = schema.createEntity({id, kind, label: id, now: 2, ...kind === 'prop' ? {asset: {sourceFormat: 'glb', sourceUrl: '/prop.glb'}} : {}});
    const setupState = schema.createSetupState(id, 2); if (kind === 'actor') setupState.pose = 'Standing';
    if (kind === 'camera') setupState.camera = {position: {x: 0, y: 1.6, z: 0}, rotation: {x: 0, y: 0, z: 0}, fov: 45, frameAspectRatio: 16 / 9};
    state = domain.addEntity(state, entity, {setupId: 'setup:state-1', setupState});
  }
  class Surface {
    constructor() {this.listeners = new Map();} addEventListener(type, callback) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback);}
    removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}
  }
  const doc = new Surface(); doc.defaultView = new Surface(); doc.visibilityState = 'visible';
  const canvas = Object.assign(new Surface(), {ownerDocument: doc, style: {}, clientWidth: 400, clientHeight: 300, width: 400, height: 300, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})});
  class Controls extends THREE.EventDispatcher {constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;} update() {return false;} dispose() {}}
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(root) {this.object = root;} detach() {this.object = null;} setMode() {} dispose() {}}
  const scheduled = new Map(), snapshots = [], frames = []; let color = new THREE.Color('#101010'), alpha = .4, target = null;
  const renderer = {domElement: canvas, autoClear: false, setPixelRatio() {}, setSize(width, height) {canvas.width = width; canvas.height = height;},
    getRenderTarget: () => target, setRenderTarget(value) {target = value;}, getClearColor: value => value.copy(color), getClearAlpha: () => alpha,
    setClearColor(value, opacity) {color = new THREE.Color(value); alpha = opacity;},
    render(scene, camera) {
      const visible = []; scene.traverse(object => {if (!object.isMesh || !camera.layers.test(object.layers)) return; for (let ancestor = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return; visible.push(object);});
      frames.push({camera, visible, background: scene.background, color: color.getHexString(), target}); if (failRender) throw Error('ortho GPU failed');
    }, dispose() {rendererDisposals++;}, forceContextLoss() {}};
  const runtime = createStudioV3Runtime({canvas, getState: () => state, getFence: () => ({owner: 'owner-a', revision}), getSourceResource: () => source,
    autoRender, requestFrame(callback) {const id = ++nextFrame; scheduled.set(id, callback); return id;}, cancelFrame(id) {scheduled.delete(id);}, onPlanFrame: snapshot => snapshots.push(snapshot),
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: () => new Transform(),
    loader: {async load(descriptor) {
      if (descriptor.sourceUrl.startsWith('/world') && pendingSource) await pendingSource.promise;
      const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return {root, format: 'glb', animations: descriptor.sourceUrl.includes('character') ? [new THREE.AnimationClip('Standing', 1, [])] : [], dispose() {root.traverse(object => {object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose();});}};
    }}});
  await runtime.sync();
  return {runtime, THREE, domain, schema, frames, snapshots, scheduled, renderer,
    get state() {return state;}, set state(value) {state = value; revision++;}, set source(value) {source = value;}, set pendingSource(value) {pendingSource = value;}, set failRender(value) {failRender = value;},
    get rendererDisposals() {return rendererDisposals;}, flush(time) {const [id, callback] = scheduled.entries().next().value || []; if (!callback) return false; scheduled.delete(id); callback(time); return true;}};
}
test('runtime plan uses successful displayed snapshots, disables native inputs and drives navigation damping itself', async t => {
  const f = await fixture({autoRender: true}); t.after(() => f.runtime.dispose()); const {runtime} = f;
  const position = runtime.orbitCamera.position.clone(), orientation = runtime.orbitCamera.quaternion.clone();
  runtime.selectEntity('prop'); runtime.attachTransform('prop'); runtime.setView('plan');
  assert.equal(runtime.plan.read().ready, false); assert.equal(runtime.plan.read().projection, null); assert.equal(runtime.controls.enabled, false); assert.equal(runtime.transformControls.enabled, false); assert.equal(runtime.transformControls.object, null); assert.equal(runtime.attachTransform('prop'), false);
  assert(f.flush(100)); const first = runtime.plan.read(); assert.equal(first.ready, true); assert.equal(first.projection.zoom, 1); assert.equal(runtime.camera, runtime.planCamera);
  assert.deepEqual(runtime.orbitCamera.position.toArray(), position.toArray()); assert.deepEqual(runtime.orbitCamera.quaternion.toArray(), orientation.toArray());
  const actor = runtime.entityObject('actor'), camera = runtime.entityObject('camera'); assert(f.frames.at(-1).visible.some(object => actor.getObjectById(object.id))); assert(f.frames.at(-1).visible.every(object => !camera.getObjectById(object.id)));
  runtime.plan.zoomBy(2); runtime.plan.rotateBy(Math.PI / 4); assert.deepEqual(runtime.plan.read().projection, first.projection);
  assert(f.flush(150)); const moved = runtime.plan.read(); assert(moved.zoom > 1 && moved.zoom < 2); assert(moved.rotation > 0); assert.equal(moved.sceneRevision, first.sceneRevision); assert(f.scheduled.size > 0);
  const snapshot = runtime.plan.read().projection; runtime.plan.panPixels({dx: 20, dy: 10}); assert.deepEqual(runtime.plan.read().projection, snapshot); runtime.render(); assert.notDeepEqual(runtime.plan.read().projection.target, snapshot.target);
  const stableIdentity = runtime.plan.read().sceneRevision; f.state = f.domain.patchEntity(f.state, 'prop', {label: 'renamed'}, 3); await runtime.sync(); assert.equal(runtime.plan.read().sceneRevision, stableIdentity); assert.equal(runtime.plan.read().ready, true);
  runtime.setView('orbit'); assert.equal(runtime.plan.read().active, false); assert.equal(runtime.plan.read().projection, null); assert.equal(runtime.controls.enabled, true); assert.equal(runtime.transformControls.enabled, true);
});
test('source changes invalidate the displayed frame before async decoding and plan failures require explicit retry', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const {runtime} = f; runtime.setView('plan'); runtime.render(); const previous = runtime.plan.read();
  const gate = deferred(); f.pendingSource = gate; f.source = {sourceUrl: '/world-next.glb', sourceFormat: 'glb'};
  const syncing = runtime.sync(); const loading = runtime.plan.read(); assert.equal(loading.ready, false); assert.equal(loading.projection, null); assert.notEqual(loading.sourceKey, previous.sourceKey); assert(loading.sceneRevision > previous.sceneRevision); assert.equal(runtime.render(), false);
  gate.resolve(); await syncing; assert.equal(runtime.plan.read().projection, null); runtime.render(); assert.equal(runtime.plan.read().ready, true);
  const sceneRevision = runtime.plan.read().sceneRevision; f.failRender = true; assert.equal(runtime.render(), false); assert.equal(runtime.plan.read().projection, null); assert.match(runtime.plan.read().error, /GPU failed/); assert.equal(f.rendererDisposals, 0);
  f.failRender = false; runtime.render(); assert.equal(runtime.plan.read().ready, false); assert.equal(f.frames.at(-1).camera, runtime.orbitCamera); assert.equal(runtime.plan.retry(), true); runtime.render(); assert.equal(runtime.plan.read().ready, true); assert.equal(runtime.plan.read().sceneRevision, sceneRevision);
  assert(f.snapshots.some(snapshot => snapshot.error && snapshot.projection === null)); assert(f.snapshots.some(snapshot => snapshot.ready));
});
test('room bounds exclude the default ground, section clips the actual ceiling, and control/gallery pause leave plan', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const {runtime, THREE} = f;
  const state = structuredClone(f.state); state.scenePlay.worldSpace.source = {kind: 'mesh-preset', preset: 'room'}; f.state = state; await runtime.sync(); runtime.setView('plan'); runtime.render();
  const room = runtime.graph.worldRoot.children.find(root => root.userData.roomConfig); assert(room); const first = runtime.plan.read();
  assert(Math.abs(first.bounds.min.x + 2.5) < 1e-6); assert(Math.abs(first.bounds.max.z - 6) < 1e-6); assert(Math.abs(first.bounds.max.y - 3.2) < 1e-6); assert(Math.abs(first.projection.near - 48.4) < 1e-6);
  assert(new THREE.Vector3(0, 3.2, 0).project(runtime.planCamera).z < -1); assert(new THREE.Vector3(0, 0, 0).project(runtime.planCamera).z >= -1);
  runtime.plan.setSection('all'); runtime.render(); assert(new THREE.Vector3(0, 3.2, 0).project(runtime.planCamera).z >= -1); runtime.plan.reset(); runtime.render(); assert.equal(runtime.plan.read().sectionHeight, 1.6);
  const changed = structuredClone(f.state); changed.scenePlay.worldSpace.roomConfig.width = 8; f.state = changed; const sync = runtime.sync(); assert.equal(runtime.plan.read().projection, null); await sync; runtime.render(); assert(Math.abs(runtime.plan.read().bounds.min.x + 4) < 1e-6); assert.equal(room.parent, null);
  assert(runtime.startControl('actor')); assert.equal(runtime.plan.read().active, false); assert.equal(runtime.plan.read().projection, null); runtime.cancelControl(); assert.equal(runtime.view, 'orbit');
  runtime.setView('plan'); runtime.render(); const release = runtime.acquireRenderingPause(); assert.equal(runtime.view, 'orbit'); assert.equal(runtime.plan.read().active, false); release(); assert.equal(runtime.controls.enabled, true);
  runtime.setView('plan'); runtime.render(); assert(runtime.startCameraControl('camera')); assert.equal(runtime.plan.read().active, false); runtime.cancelCameraControl(); assert.equal(runtime.view, 'orbit');
});
