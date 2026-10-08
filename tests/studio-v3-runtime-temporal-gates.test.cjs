const {test} = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/runtime.mjs'),
  import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/world-space.mjs')]);

function surface(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, callback) {const items = listeners.get(type) || new Set(); items.add(callback); listeners.set(type, items);},
    removeEventListener(type, callback) {listeners.get(type)?.delete(callback);},
    emit(type, fields = {}) {
      const event = {type, target: this, code: '', pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: 200, clientY: 150, deltaY: 0, defaultPrevented: false,
        preventDefault() {this.defaultPrevented = true;}, stopPropagation() {}, stopImmediatePropagation() {}, ...fields};
      event.composedPath ||= () => [event.target];
      for (const callback of [...listeners.get(type) || []]) callback(event);
      return event;
    }
  }, extra);
}

async function fixture({keyed = false} = {}) {
  const [THREE, {createStudioV3Runtime}, schema, actions, world] = await modules;
  const setupId = 'setup:state-1';
  let state = schema.createState({worldNodeId: 'temporal-gates', now: 1});
  for (const [id, kind] of [['actor', 'actor'], ['prop', 'prop'], ['camera', 'camera'], ['other-camera', 'camera']]) {
    state = actions.reduceEntityAction(state, {type: 'create', id, kind,
      ...kind === 'prop' ? {assetId: 'chair-dining'} : {},
      ...kind === 'actor' ? {roleId: 'actor-role', pose: 'Standing'} : {},
      ...kind === 'camera' ? {camera: {position: {x: 3, y: 2, z: 7}, rotation: {x: .2, y: .4, z: 0, order: 'YXZ'}, focalLength: 35, frameAspectRatio: 2.39}} : {}
    }, {now: 2}).state;
  }
  if (keyed) state = world.setTemporal(state, setupId, {durationMs: 1000, tracks: ['camera', 'other-camera'].map(id => ({
    id: `track:${id}`, owner: {kind: 'entity', entityId: id}, keys: [{id: 'start', timeMs: 0}],
    channels: [{id: `focal:${id}`, property: 'camera.focalLength', values: [{keyId: 'start', value: {kind: 'number', value: 35}}]}]
  }))}, 2);
  const window = surface(), document = surface({visibilityState: 'visible', defaultView: window});
  const canvas = surface({ownerDocument: document, style: {}, clientWidth: 400, clientHeight: 300,
    getBoundingClientRect: () => ({left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight}),
    setPointerCapture() {}, releasePointerCapture() {}});
  let temporal = {}, current = true, nextFrame = 0, time = 1000, disposals = 0, pixelRatio = 1;
  const allowed = new Set(), frames = new Map(), edits = [], failures = [], draws = [], sizes = [];
  let viewport = new THREE.Vector4(0, 0, 400, 300), scissor = viewport.clone(), scissorTest = false;
  const renderer = {domElement: canvas, autoClear: true,
    setPixelRatio(value) {pixelRatio = value;}, getPixelRatio: () => pixelRatio,
    setSize(width, height) {sizes.push([width, height]); canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;},
    getRenderTarget: () => null, setRenderTarget() {},
    getViewport: target => target.copy(viewport), setViewport(...args) {viewport = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args);},
    getScissor: target => target.copy(scissor), setScissor(...args) {scissor = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args);},
    getScissorTest: () => scissorTest, setScissorTest(value) {scissorTest = value;},
    getClearColor: target => target.set('#15171b'), getClearAlpha: () => 1, setClearColor() {}, clear() {},
    render(scene, camera) {draws.push(camera);}, dispose() {disposals++;}, forceContextLoss() {}};
  class Controls extends THREE.EventDispatcher {
    constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;}
    update() {return false;} dispose() {}
  }
  class Transform extends THREE.EventDispatcher {
    constructor() {super(); this.helper = new THREE.Group();}
    getHelper() {return this.helper;} attach(object) {this.object = object;} detach() {this.object = null;}
    setMode(mode) {this.mode = mode;} dispose() {}
  }
  const author = kind => event => {edits.push({kind, ...structuredClone(event)}); return true;};
  const runtime = createStudioV3Runtime({canvas, getState: () => state, getFence: () => ({owner: 'temporal-gates'}),
    isCurrent: () => current, getTemporalStatus: () => temporal, canEditAnimatedEntity: id => allowed.has(id),
    autoRender: true, requestFrame(callback) {const id = ++nextFrame; frames.set(id, callback); return id;}, cancelFrame: id => frames.delete(id),
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: () => new Transform(),
    onTransform: author('transform'), onControl: author('control'), onCameraEdit: author('camera'),
    onStatus: event => {if (event.status === 'failed') failures.push(event.error);},
    loader: {async load() {const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
      return {root, format: 'glb', animations: [new THREE.AnimationClip('Standing', 1, [])], dispose() {root.traverse(object => {object.geometry?.dispose(); object.material?.dispose();});}};}}
  });
  await runtime.sync();
  const f = {runtime, state, canvas, window, document, edits, failures, draws, sizes, frames, allowed,
    setTemporal(value) {temporal = value;}, setCurrent(value) {current = value;},
    step(count = 1) {for (let i = 0; i < count; i++) {const next = frames.entries().next().value; if (!next) break; frames.delete(next[0]); time += 50; next[1](time);}},
    get disposals() {return disposals;}};
  f.step(2); assert.deepEqual(f.failures, []); return f;
}

test('playing and scrubbing deny entity control, camera possession and gizmo admission without author writes', async t => {
  const f = await fixture({keyed: true}); t.after(() => f.runtime.dispose());
  f.allowed.add('camera');
  const before = structuredClone(f.state), optical = f.runtime.entityCamera('camera');
  assert(optical.isPerspectiveCamera, 'the admission guard is exercised against an actual Three entity camera');
  for (const status of [{playing: true}, {scrubbing: true}, {playing: true, scrubbing: true}]) {
    f.setTemporal(status);
    for (const id of ['actor', 'prop']) assert.equal(f.runtime.startControl(id), false);
    assert.equal(f.runtime.startCameraControl('camera'), false, 'priming cannot override playback or scrubbing');
    for (const id of ['actor', 'prop', 'camera']) for (const mode of ['translate', 'rotate']) assert.equal(f.runtime.attachTransform(id, mode), false);
    assert.equal(f.runtime.controlling, null); assert.equal(f.runtime.possessing, null);
    assert.equal(f.runtime.transformControls.object, null); assert.deepEqual(f.edits, []); assert.deepEqual(f.state, before);
  }
  f.setTemporal({}); assert.equal(f.runtime.attachTransform('prop'), true);
  f.runtime.transformControls.dispatchEvent({type: 'mouseDown'});
  assert.equal(f.edits.at(-1).phase, 'begin', 'idle time restores legal authoring'); f.runtime.cancelTransform();
});

test('a keyed camera needs its own primed edit target and revalidates permission on re-entry', async t => {
  const f = await fixture({keyed: true}); t.after(() => f.runtime.dispose()); const before = structuredClone(f.state);
  assert.equal(f.runtime.startCameraControl('camera'), false); assert.deepEqual(f.edits, []);
  f.allowed.add('other-camera'); assert.equal(f.runtime.startCameraControl('camera'), false);
  f.allowed.add('camera'); assert.equal(f.runtime.startCameraControl('camera'), true);
  assert.equal(f.runtime.possessing.entityId, 'camera'); assert.deepEqual(f.edits.map(event => event.phase), ['begin']);
  assert.equal(f.runtime.cancelCameraControl(), true); f.allowed.delete('camera');
  const count = f.edits.length; assert.equal(f.runtime.startCameraControl('camera'), false); assert.equal(f.edits.length, count);
  assert.deepEqual(f.state, before); assert.deepEqual(f.failures, []);
});

test('an already attached gizmo cannot begin authoring after playback or scrubbing starts', async t => {
  for (const status of [{playing: true}, {scrubbing: true}]) {
    const f = await fixture(); t.after(() => f.runtime.dispose());
    assert.equal(f.runtime.attachTransform('prop'), true); const before = structuredClone(f.state);
    f.setTemporal(status); f.runtime.transformControls.dispatchEvent({type: 'mouseDown'});
    f.runtime.transformControls.dispatchEvent({type: 'objectChange'}); f.runtime.transformControls.dispatchEvent({type: 'mouseUp'});
    assert.deepEqual(f.edits, [], 'native events on a stale attachment must obey the same temporal author gate');
    assert.deepEqual(f.state, before);
  }
});

test('paused native camera input cannot author optics or cancel an existing possession lease', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  assert.equal(f.runtime.startCameraControl('camera'), true); f.step(20);
  const session = f.runtime.possessing, camera = f.runtime.camera, position = camera.position.toArray(), rotation = camera.quaternion.toArray();
  const before = structuredClone(f.state), edits = structuredClone(f.edits), release = f.runtime.acquireRenderingPause();
  f.window.emit('keydown', {code: 'KeyW'}); f.canvas.emit('wheel', {deltaY: 100});
  f.canvas.emit('pointerdown'); f.document.emit('pointermove', {target: f.canvas, clientX: 240, clientY: 170}); f.document.emit('pointerup', {target: f.canvas});
  f.step(3); assert.deepEqual(f.edits, edits); assert.deepEqual(f.runtime.possessing, session);
  assert.deepEqual(camera.position.toArray(), position); assert.deepEqual(camera.quaternion.toArray(), rotation); assert.deepEqual(f.state, before);
  assert.equal(f.frames.size, 0); assert.equal(release(), true);
  assert.equal(f.runtime.controls.enabled, false, 'home controls stay disabled while the camera owns the viewport');
  assert.equal(f.runtime.cancelCameraControl(), true);
});

test('nested gallery pause leases stop render and admission until the final idempotent release', async t => {
  const f = await fixture(); t.after(() => f.runtime.dispose());
  f.runtime.resize(); assert.equal(f.frames.size, 1);
  const releaseGallery = f.runtime.acquireRenderingPause(), releaseNested = f.runtime.acquireRenderingPause();
  assert.equal(f.runtime.renderingPaused, true); assert.equal(f.frames.size, 0);
  assert.equal(f.runtime.controls.enabled, false); assert.equal(f.runtime.transformControls.enabled, false);
  const draws = f.draws.length, sizes = f.sizes.length, before = structuredClone(f.state);
  f.canvas.clientWidth = 960; f.canvas.clientHeight = 540; f.runtime.resize();
  assert.equal(f.runtime.render(), false); assert.equal(f.runtime.startControl('actor'), false);
  assert.equal(f.runtime.startCameraControl('camera'), false); assert.equal(f.runtime.attachTransform('prop'), false);
  f.window.emit('keydown', {code: 'KeyW'}); f.canvas.emit('wheel', {deltaY: 100}); f.step(5);
  assert.equal(f.draws.length, draws); assert.equal(f.sizes.length, sizes); assert.equal(f.frames.size, 0); assert.deepEqual(f.edits, []);
  assert.equal(releaseGallery(), true); assert.equal(releaseGallery(), false);
  assert.equal(f.runtime.renderingPaused, true); assert.equal(f.frames.size, 0); assert.equal(f.runtime.controls.enabled, false);
  assert.equal(f.runtime.render(), false); assert.equal(f.sizes.length, sizes);
  assert.equal(releaseNested(), true); assert.equal(releaseNested(), false);
  assert.equal(f.runtime.renderingPaused, false); assert.equal(f.runtime.controls.enabled, true); assert.equal(f.runtime.transformControls.enabled, true);
  assert.deepEqual(f.sizes.slice(sizes), [[960, 540]]); assert.equal(f.frames.size, 1);
  f.step(); assert(f.draws.length > draws); assert.deepEqual(f.state, before); assert.deepEqual(f.failures, []);
});

test('pause release is safe after runtime disposal and cannot revive a stale owner', async () => {
  const f = await fixture(), releaseA = f.runtime.acquireRenderingPause(), releaseB = f.runtime.acquireRenderingPause();
  const draws = f.draws.length, sizes = f.sizes.length;
  await f.runtime.dispose(); assert.equal(f.disposals, 1); assert.equal(f.frames.size, 0);
  assert.equal(releaseA(), true); assert.equal(releaseA(), false); assert.equal(f.runtime.renderingPaused, true);
  assert.equal(releaseB(), true); assert.equal(releaseB(), false); assert.equal(f.runtime.renderingPaused, false);
  assert.equal(f.frames.size, 0); assert.equal(f.draws.length, draws); assert.equal(f.sizes.length, sizes); assert.equal(f.disposals, 1);
  const stale = await fixture(), releaseStale = stale.runtime.acquireRenderingPause();
  stale.setCurrent(false); const staleSizes = stale.sizes.length;
  assert.equal(releaseStale(), true); assert.equal(stale.frames.size, 0); assert.equal(stale.sizes.length, staleSizes); assert.equal(stale.runtime.controls.enabled, false);
  await stale.runtime.dispose();
});
