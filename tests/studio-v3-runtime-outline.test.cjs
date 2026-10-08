const {test} = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/runtime.mjs')]);
class Surface {
  constructor() {this.listeners = new Map();}
  addEventListener(type, callback) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback);}
  removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}
  emit(type, fields = {}) {for (const callback of this.listeners.get(type) || []) callback({type, ...fields});}
  count() {return [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0);}
}
function release(root) {root.traverse(object => {object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose();});}
async function fixture({autoRender = false, failTransform = false, failResize = false, initializationChange = false} = {}) {
  const [THREE, schema, domain, {createStudioV3Runtime}] = await modules;
  let state = schema.createState({worldNodeId: 'outline-world', now: 1}), token = 'owner-a', revision = 1;
  for (const [id, kind] of [['prop', 'prop'], ['actor', 'actor'], ['camera', 'camera']]) {
    const entity = schema.createEntity({id, kind, label: id, now: 2, ...kind === 'prop' ? {asset: {sourceUrl: '/assets/studio/library/chair-dining.glb', sourceFormat: 'glb'}} : {}});
    const setupState = schema.createSetupState(id, 2); if (kind === 'actor') {setupState.pose = 'Standing'; setupState.transform.position.x = 3;}
    state = domain.addEntity(state, entity, {setupId: 'setup:state-1', setupState});
  }
  const doc = new Surface(), window = new Surface(); doc.defaultView = window; doc.visibilityState = 'visible';
  const canvas = Object.assign(new Surface(), {ownerDocument: doc, clientWidth: 400, clientHeight: 300, width: 400, height: 300, style: {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})});
  const scheduled = new Map(); let scheduleId = 0, rendererDisposals = 0, controlDisposals = 0, transformDisposals = 0, contextLosses = 0, pixelRatio = 1;
  let currentTarget = null, viewport = new THREE.Vector4(0, 0, 400, 300), scissor = viewport.clone(), scissorTest = false, clearColor = new THREE.Color('#000'), clearAlpha = 1, throwPass = null, depthGeneration = 0;
  const passes = [], manualClears = [], targetChanges = [];
  const renderer = {domElement: canvas, autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    setPixelRatio(value) {pixelRatio = value;}, getPixelRatio() {return pixelRatio;},
    setSize(width, height) {if (failResize) throw Error('initial resize failed'); canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;},
    getRenderTarget: () => currentTarget, setRenderTarget(value) {currentTarget = value; targetChanges.push(value);},
    getViewport(target) {return target.copy(viewport);}, setViewport(...values) {viewport = values[0]?.isVector4 ? values[0].clone() : new THREE.Vector4(...values);},
    getScissor(target) {return target.copy(scissor);}, setScissor(...values) {scissor = values[0]?.isVector4 ? values[0].clone() : new THREE.Vector4(...values);},
    getScissorTest: () => scissorTest, setScissorTest(value) {scissorTest = value;},
    getClearColor(target) {return target.copy(clearColor);}, getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha = clearAlpha) {clearColor = new THREE.Color(value); clearAlpha = alpha;},
    clear(...flags) {manualClears.push(flags);}, clearDepth() {manualClears.push(['depth']);},
    render(scene, camera) {
      const mask = camera.layers.mask, material = scene.overrideMaterial;
      const kind = material?.name === 'WorkspaceSelectionSilhouetteMaterial' ? mask === 128 ? 'hover' : 'selection' : mask === 8 ? 'overlay' : 'base';
      if (renderer.autoClear) depthGeneration++;
      const meshes = [];
      scene.traverse(object => {if (!object.isMesh || !camera.layers.test(object.layers)) return; for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return; meshes.push(object);});
      passes.push({kind, camera, mask, material, meshes, target: currentTarget, autoClear: renderer.autoClear, background: scene.background,
        depthGeneration, resolution: material?.uniforms?.resolution?.value.toArray(), thickness: material?.uniforms?.thicknessPx?.value, depthWrite: material?.depthWrite});
      if (kind === throwPass) throw Error(`${kind} render failed`);
    }, dispose() {rendererDisposals++;}, forceContextLoss() {contextLosses++;}};
  class Controls extends THREE.EventDispatcher {
    constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;}
    addEventListener(type, callback) {super.addEventListener(type, callback); if (initializationChange && type === 'change') this.dispatchEvent({type: 'change'});}
    update() {return false;} dispose() {controlDisposals++;}
  }
  class Transform extends THREE.EventDispatcher {
    constructor() {super(); this.helper = new THREE.Group(); this.helper.add(new THREE.Mesh(new THREE.SphereGeometry(.1), new THREE.MeshBasicMaterial()));}
    getHelper() {return this.helper;} attach(object) {this.object = object;} detach() {this.object = null;} setMode() {} dispose() {transformDisposals++;}
  }
  const options = {canvas, getState: () => state, getFence: () => ({token, revision}), autoRender,
    requestFrame(callback) {const id = ++scheduleId; scheduled.set(id, callback); return id;}, cancelFrame(id) {scheduled.delete(id);},
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory() {if (failTransform) throw Error('transform initialization failed'); return new Transform();},
    loader: {async load(descriptor) {const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial())); return {root, format: 'glb', animations: descriptor.sourceUrl.includes('character') ? [new THREE.AnimationClip('Standing', 1, [])] : [], dispose() {release(root);}};}}};
  const result = {THREE, schema, domain, renderer, canvas, doc, window, options, passes, manualClears, targetChanges, scheduled,
    get state() {return state;}, set state(value) {state = value; revision++;}, replaceOwner() {token = 'owner-b';},
    failPass(kind) {throwPass = kind;}, get rendererDisposals() {return rendererDisposals;}, get controlDisposals() {return controlDisposals;}, get transformDisposals() {return transformDisposals;}, get contextLosses() {return contextLosses;},
    resetPasses() {passes.length = 0; manualClears.length = 0; targetChanges.length = 0;}};
  if (!failTransform && !failResize) {result.runtime = createStudioV3Runtime(options); await result.runtime.sync();}
  return result;
}
function meshes(root) {const values = []; root.traverse(object => {if (object.isMesh) values.push(object);}); return values;}
function hasLayer(root, layer) {return meshes(root).some(object => object.layers.isEnabled(layer));}
function pointerAt(f, id) {
  const center = f.runtime.graph.bounds(id).getCenter(new f.THREE.Vector3()); f.runtime.camera.updateMatrixWorld(true); center.project(f.runtime.camera);
  return {clientX: (center.x + 1) * 200, clientY: (1 - center.y) * 150, buttons: 0};
}

test('runtime preserves base depth then draws hover, selection and editor overlay on the active target', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  f.renderer.setPixelRatio(2); f.renderer.setSize(400, 300);
  f.runtime.selectEntity('prop'); f.runtime.setHoverEntity('actor'); f.resetPasses();
  const originalMask = f.runtime.camera.layers.mask;
  f.renderer.autoClear = false; assert.equal(f.runtime.render(), true);
  assert.deepEqual(f.passes.map(pass => pass.kind), ['base', 'hover', 'selection', 'overlay']);
  const [base, hover, selection, overlay] = f.passes;
  assert.equal(base.mask & (8 | 64 | 128), 0); assert.equal(base.autoClear, true);
  for (const pass of [hover, selection, overlay]) {assert.equal(pass.autoClear, false); assert.equal(pass.depthGeneration, base.depthGeneration); assert.equal(pass.target, null); assert.equal(pass.background, null);}
  assert.equal(hover.depthWrite, false); assert.equal(selection.depthWrite, false); assert.equal(hover.thickness, 4); assert.equal(selection.thickness, 6);
  assert.deepEqual(selection.resolution, [800, 600]); assert.equal(overlay.mask, 8); assert.equal(overlay.material, null);
  assert(hover.meshes.every(mesh => f.runtime.entityObject('actor').getObjectById(mesh.id))); assert(selection.meshes.every(mesh => f.runtime.entityObject('prop').getObjectById(mesh.id)));
  assert.equal(f.manualClears.length, 0); assert.equal(f.runtime.camera.layers.mask, originalMask); assert.equal(f.renderer.autoClear, false); assert.equal(f.runtime.scene.overrideMaterial, null);
  const target = new f.THREE.WebGLRenderTarget(320, 200); t.after(() => target.dispose()); f.renderer.setRenderTarget(target); f.resetPasses(); f.runtime.render();
  assert(f.passes.every(pass => pass.target === target)); assert.deepEqual(f.passes.find(pass => pass.kind === 'selection').resolution, [320, 200]); assert.equal(f.passes.find(pass => pass.kind === 'selection').thickness, 3);
  assert.equal(f.renderer.getRenderTarget(), target);
});

test('runtime camera silhouettes tag only the normalized body, and plan profile skips both outline passes', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); const marker = f.runtime.graph.entity('camera').cameraMarker;
  f.runtime.selectEntity('camera'); f.runtime.setHoverEntity('camera'); f.resetPasses(); f.runtime.render();
  const outlineMeshes = f.passes.filter(pass => ['hover', 'selection'].includes(pass.kind)).flatMap(pass => pass.meshes);
  assert(outlineMeshes.length > 0); assert(outlineMeshes.every(mesh => marker.iconRoot.getObjectById(mesh.id))); assert(marker.frustumRoot.children.every(line => !line.layers.isEnabled(6) && !line.layers.isEnabled(7)));
  f.runtime.setView('plan'); f.resetPasses(); f.runtime.render();
  assert.equal(f.passes.some(pass => ['hover', 'selection'].includes(pass.kind)), false); assert.equal(hasLayer(marker.iconRoot, 7), false);
  f.runtime.setView('orbit'); f.resetPasses(); f.runtime.render();
  assert.equal(f.passes.some(pass => pass.kind === 'hover'), false); assert.equal(f.passes.some(pass => pass.kind === 'selection'), true);
});

test('pending and active hover cannot cross setup, owner, hidden-page or pointer-leave boundaries', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose()); let prop = f.runtime.entityObject('prop');
  f.runtime.setHoverEntity('prop'); assert(hasLayer(prop, 7)); f.canvas.emit('pointerleave'); assert.equal(hasLayer(prop, 7), false);
  f.canvas.emit('pointermove', pointerAt(f, 'prop')); f.runtime.render(); assert(hasLayer(prop, 7), 'manual render must process queued pointer hover');
  f.canvas.emit('pointermove', pointerAt(f, 'prop')); f.runtime.setView('plan'); f.runtime.setView('orbit'); f.runtime.render(); assert.equal(hasLayer(prop, 7), false);
  f.runtime.selectEntity('prop'); f.runtime.setHoverEntity('prop'); f.canvas.emit('pointermove', pointerAt(f, 'prop'));
  f.state = f.domain.setActiveSetup(f.state, 'setup-default'); const boundarySync = f.runtime.sync();
  assert.equal(hasLayer(prop, 6), false, 'scope change must immediately release old selection membership before async decoding');
  assert.equal(hasLayer(prop, 7), false); await boundarySync;
  f.state = f.domain.setActiveSetup(f.state, 'setup:state-1'); await f.runtime.sync(); prop = f.runtime.entityObject('prop'); f.resetPasses(); f.runtime.render(); assert.equal(hasLayer(prop, 7), false); assert.equal(f.passes.some(pass => pass.kind === 'hover'), false);
  f.runtime.setHoverEntity('prop'); f.canvas.emit('pointermove', pointerAt(f, 'prop')); f.replaceOwner(); f.runtime.render(); assert.equal(hasLayer(prop, 7), false);
  f.runtime.setHoverEntity('prop'); assert(hasLayer(prop, 7)); f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange'); assert.equal(hasLayer(prop, 7), false);
  f.doc.visibilityState = 'visible'; f.doc.emit('visibilitychange'); f.runtime.render(); assert.equal(hasLayer(prop, 7), false);
  f.runtime.setHoverEntity('prop'); f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'prop', {visible: false}, 3); await f.runtime.sync(); assert.equal(hasLayer(prop, 7), false);
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'prop', {visible: true}, 4); await f.runtime.sync(); assert.equal(hasLayer(prop, 7), false);
});

test('outline rendering failure restores camera, background, override, target and auto-clear; teardown releases both passes', async t => {
  const f = await fixture(); const parentDispose = f.runtime.dispose.bind(f.runtime); t.after(() => parentDispose());
  f.runtime.selectEntity('prop'); f.runtime.setHoverEntity('actor'); f.runtime.render();
  const shaderMaterials = [...new Set(f.passes.filter(pass => ['hover', 'selection'].includes(pass.kind)).map(pass => pass.material))]; let disposals = 0;
  for (const material of shaderMaterials) material.addEventListener('dispose', () => disposals++);
  const background = f.runtime.scene.background, override = new f.THREE.MeshBasicMaterial(); t.after(() => override.dispose()); f.runtime.scene.overrideMaterial = override;
  const mask = f.runtime.camera.layers.mask, target = new f.THREE.WebGLRenderTarget(100, 100); t.after(() => target.dispose()); f.renderer.setRenderTarget(target); f.renderer.autoClear = false; f.failPass('selection');
  assert.throws(() => f.runtime.render(), /selection render failed/);
  assert.equal(f.runtime.scene.background, background); assert.equal(f.runtime.scene.overrideMaterial, override); assert.equal(f.runtime.camera.layers.mask, mask); assert.equal(f.renderer.getRenderTarget(), target); assert.equal(f.renderer.autoClear, false);
  f.failPass(null); f.resetPasses(); f.runtime.render(); assert.equal(f.passes.at(-1).material, null, 'editor overlays need their original materials even with a scene override'); assert.equal(f.runtime.scene.overrideMaterial, override);
  await parentDispose(); await parentDispose(); assert.equal(disposals, 2); assert.equal(f.canvas.count(), 0); assert.equal(f.doc.count(), 0); assert.equal(f.rendererDisposals, 1);
});

test('failed initialization disposes detached silhouette materials and any scheduled hover frame', async t => {
  const [THREE, , , {createStudioV3Runtime}] = await modules;
  const originalDispose = THREE.Material.prototype.dispose; let outlineDisposals = 0;
  THREE.Material.prototype.dispose = function () {if (this.name === 'WorkspaceSelectionSilhouetteMaterial') outlineDisposals++; return originalDispose.call(this);};
  t.after(() => {THREE.Material.prototype.dispose = originalDispose;});
  const early = await fixture({failTransform: true, initializationChange: true, autoRender: true});
  assert.throws(() => createStudioV3Runtime(early.options), /transform initialization failed/); assert.equal(outlineDisposals, 2); assert.equal(early.scheduled.size, 0); assert.equal(early.rendererDisposals, 1); assert.equal(early.controlDisposals, 1); assert.equal(early.contextLosses, 1);
  const late = await fixture({failResize: true, autoRender: true});
  assert.throws(() => createStudioV3Runtime(late.options), /initial resize failed/); assert.equal(outlineDisposals, 4); assert.equal(late.canvas.count(), 0); assert.equal(late.doc.count(), 0); assert.equal(late.scheduled.size, 0); assert.equal(late.rendererDisposals, 1); assert.equal(late.controlDisposals, 1); assert.equal(late.transformDisposals, 1);
});
