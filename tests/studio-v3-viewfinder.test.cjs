const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), import('../src/features/studio-v3/runtime.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/camera-create.mjs'), import('../src/features/studio-v3/transform-coordinates.mjs')]);
const near = (actual, expected, tolerance = 1e-8) => assert(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function surface(extra = {}) {
  const listeners = new Map();
  const capture = options => typeof options === 'boolean' ? options : !!options?.capture;
  return Object.assign({listeners,
    addEventListener(type, callback, options) {const entries = listeners.get(type) || [];if (!entries.some(entry => entry.callback === callback && entry.capture === capture(options))) entries.push({callback, capture: capture(options)});listeners.set(type, entries);},
    removeEventListener(type, callback, options) {const entries = (listeners.get(type) || []).filter(entry => entry.callback !== callback || entry.capture !== capture(options));if (entries.length) listeners.set(type, entries);else listeners.delete(type);},
    emit(type, fields = {}) {const event = {type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...fields};for (const {callback} of [...listeners.get(type) || []]) callback(event);},
    count() {return [...listeners.values()].reduce((sum, entries) => sum + entries.length, 0);}
  }, extra);
}
function pose(camera) {return {position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, fov: camera.fov, aspect: camera.aspect, up: camera.up.toArray()};}
function nativeDrag(t, {release = true} = {}) {
  const event = {pointerType: 'mouse', pointerId: 7, button: 0, clientX: 220, clientY: 230, pageX: 220, pageY: 230, ctrlKey: false, metaKey: false, shiftKey: false};
  t.canvas.emit('pointerdown', event);t.document.emit('pointermove', {...event, button: -1, clientX: 285, clientY: 255, pageX: 285, pageY: 255});
  if (release) t.document.emit('pointerup', event);
}
async function fixture() {
  const [THREE, {OrbitControls}, {createStudioV3Runtime}, schema, actions, world, creation, coordinates] = await modules;
  const window = surface(), document = surface({visibilityState: 'visible', defaultView: window}), canvas = surface({ownerDocument: document, style: {}, clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({left: 20, top: 30, width: 800, height: 600}), getRootNode: () => document, setPointerCapture() {}, releasePointerCapture() {}});
  let state = schema.createState({worldNodeId: 'viewfinder-owner', now: 1}), current = true, sourceResource = null, fence = {nodeId: 'viewfinder-owner', projectId: 'local', sessionToken: 'first', revision: 1, editEpoch: 0, sourceBinding: null};
  state = actions.reduceEntityAction(state, {type: 'create', kind: 'camera', id: 'authored', camera: {position: {x: 3, y: 2, z: 7}, rotation: {x: -.18, y: .48, z: .16, order: 'YXZ'}, focalLength: 35, frameAspectRatio: 2.39}}, {now: 2}).state;
  const navigations = [], draws = [];let viewport = null, scissor = null, scissorTest = false, rendererDisposals = 0, clearCount = 0, invalidations = 0;
  const renderer = {domElement: canvas, setPixelRatio() {}, setSize() {}, setViewport(...value) {viewport = value;}, setScissor(...value) {scissor = value;}, setScissorTest(value) {scissorTest = value;},
    getClearColor: color => color.set('#15171b'), getClearAlpha: () => 1, setClearColor() {}, clear() {clearCount++;},
    render(scene, camera) {draws.push({camera, viewport: [...viewport], scissor: [...scissor], scissorTest});}, dispose() {rendererDisposals++;}};
  class Transform extends THREE.EventDispatcher {constructor() {super();this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(object) {this.object = object;} detach() {this.object = null;} setMode() {} dispose() {}}
  const runtime = createStudioV3Runtime({canvas, getState: () => state, getFence: () => structuredClone(fence), isCurrent: () => current, getSourceResource: () => sourceResource, autoRender: false,
    rendererFactory: () => renderer, controlsFactory: camera => {const controls = new OrbitControls(camera, canvas);navigations.push(controls);return controls;}, transformFactory: () => new Transform(),
    onInvalidate() {invalidations++;}, loader: {async load() {const root = new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));return {root, format: 'glb', animations: [], dispose() {}};}}});
  await runtime.sync();
  return {THREE, schema, actions, world, creation, coordinates, runtime, canvas, document, window, navigations, draws,
    get state() {return state;}, set state(value) {state = value;}, get fence() {return fence;}, set fence(value) {fence = value;}, setCurrent(value) {current = value;}, setSource(value) {sourceResource = value;},
    get rendererDisposals() {return rendererDisposals;}, get clearCount() {return clearCount;}, get invalidations() {return invalidations;}};
}

test('viewfinder leases a separate real Orbit camera, native pointer navigation leaves home untouched, and end/restart releases its listeners', async t => {
  const f = await fixture();t.after(() => f.runtime.dispose());const {runtime} = f, home = pose(runtime.orbitCamera), target = runtime.controls.target.toArray(), baseline = [f.canvas.count(), f.document.count()];
  assert.equal(runtime.beginViewfinder(), true);const leased = runtime.camera, navigation = f.navigations.at(-1);assert.notEqual(leased, runtime.orbitCamera);assert.equal(navigation.object, leased);assert.equal(runtime.controls.enabled, false);assert.deepEqual(pose(runtime.orbitCamera), home);
  const before = pose(leased);nativeDrag(f);assert.notDeepEqual(pose(leased), before);assert.deepEqual(pose(runtime.orbitCamera), home);assert.deepEqual(runtime.controls.target.toArray(), target);
  nativeDrag(f, {release: false});assert.equal(f.document.listeners.get('pointermove').length, 1);assert.equal(runtime.endViewfinder(), true);assert.equal(runtime.camera, runtime.orbitCamera);assert.equal(runtime.controls.enabled, true);assert.deepEqual([f.canvas.count(), f.document.count()], baseline);assert.equal(f.document.listeners.has('pointermove'), false);assert.equal(f.document.listeners.has('pointerup'), false);
  assert.equal(runtime.endViewfinder(), false);runtime.beginViewfinder();const count = [f.canvas.count(), f.document.count()];runtime.beginViewfinder();assert.deepEqual([f.canvas.count(), f.document.count()], count);runtime.endViewfinder();assert.deepEqual([f.canvas.count(), f.document.count()], baseline);
});

test('preview clone optics and portrait letterbox match the actual draw and cameraFromCurrentView while authored camera and home remain unchanged', async t => {
  const f = await fixture();t.after(() => f.runtime.dispose());const {runtime, THREE} = f, authored = runtime.entityCamera('authored'), authoredPose = pose(authored), home = pose(runtime.orbitCamera), state = structuredClone(f.state);
  runtime.previewCamera('authored');const visibleBefore = runtime.getVisibleCameraState();runtime.beginViewfinder();assert.notEqual(runtime.camera, authored);assert.equal(runtime.view, 'viewfinder');assert.equal(runtime.controls.enabled, false);
  near(runtime.camera.position.distanceTo(authored.position), 0);near(runtime.camera.quaternion.angleTo(authored.quaternion), 0, 1e-7);near(runtime.camera.getFocalLength(), visibleBefore.focalLength);
  const clonedPosition = runtime.camera.position.clone(), clonedOrientation = runtime.camera.quaternion.clone();
  assert.equal(runtime.patchViewfinder({focalLength: 85, frameAspectRatio: 9 / 16, apertureFNumber: 2, depthOfFieldMode: 'aperture', focusDistance: 8}), true);const camera = runtime.camera;
  near(camera.position.distanceTo(clonedPosition), 0);near(camera.quaternion.angleTo(clonedOrientation), 0, 1e-7);
  near(camera.getFocalLength(), 85);near(camera.fov, 2 * Math.atan(36 / (2 * 85)) * 180 / Math.PI);near(camera.aspect, 9 / 16);assert.deepEqual(runtime.cameraPreviewRect, {left: 231.25, top: 0, width: 337.5, height: 600});
  runtime.render();const draw = f.draws.at(-1);assert.equal(draw.camera, camera);assert.deepEqual(draw.viewport, [231.25, 0, 337.5, 600]);assert.deepEqual(draw.scissor, draw.viewport);assert.equal(draw.scissorTest, true);assert(f.clearCount > 0);
  assert.equal(runtime.hitSurface({clientX: 30, clientY: 330}), null, 'black matte is outside the optical frame');
  const visible = runtime.getVisibleCameraState(), created = f.creation.cameraFromCurrentView(visible);assert.deepEqual(created.camera.position, visible.position);near(created.camera.focalLength, camera.getFocalLength());near(created.camera.fov, camera.fov);near(created.camera.frameAspectRatio, camera.aspect);
  const world = f.coordinates.applyEntityTransform('camera', created), expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(world.rotation.x, world.rotation.y, world.rotation.z, world.rotation.order));near(expected.angleTo(camera.quaternion), 0, 1e-7);assert.equal(Object.hasOwn(created.camera, 'lookAt'), false);
  visible.position.x = 999;near(runtime.getVisibleCameraState().position.x, camera.position.x);nativeDrag(f);
  const navigated = f.creation.cameraFromCurrentView(runtime.getVisibleCameraState()), navigatedRotation = navigated.camera.rotation;
  assert.deepEqual(navigated.camera.position, {x: camera.position.x, y: camera.position.y, z: camera.position.z});near(new THREE.Quaternion().setFromEuler(new THREE.Euler(navigatedRotation.x, navigatedRotation.y, navigatedRotation.z, navigatedRotation.order)).angleTo(camera.quaternion), 0, 1e-7);
  assert.deepEqual(pose(authored), authoredPose);assert.deepEqual(pose(runtime.orbitCamera), home);assert.deepEqual(f.state, state);
  runtime.endViewfinder();assert.equal(runtime.camera, authored);assert.equal(runtime.view, 'camera');assert.equal(runtime.previewCameraEntityId, 'authored');assert.equal(runtime.controls.enabled, false);assert.deepEqual(pose(authored), authoredPose);
});

test('plan-derived perspective preserves actual ground-plane framing at ordinary zoom but is not equivalent away from that plane', async t => {
  const f = await fixture();t.after(() => f.runtime.dispose());const {runtime, THREE} = f;runtime.setView('plan');runtime.planCamera.zoom = 2;runtime.planCamera.updateProjectionMatrix();runtime.planCamera.updateMatrixWorld(true);
  const plan = runtime.planCamera, home = pose(plan), groundY = runtime.controls.target.y, points = [new THREE.Vector3(0, groundY, 0), new THREE.Vector3(4, groundY, 3), new THREE.Vector3(-4, groundY, -3)], projections = points.map(point => point.clone().project(plan));
  const raised = new THREE.Vector3(4, groundY + 20, 3), originalRaised = raised.clone().project(plan);runtime.beginViewfinder();runtime.camera.updateMatrixWorld(true);assert.equal(runtime.camera.isPerspectiveCamera, true);
  points.forEach((point, index) => {const projected = point.clone().project(runtime.camera);near(projected.x, projections[index].x, 1e-5);near(projected.y, projections[index].y, 1e-5);});
  const raisedProjection = raised.clone().project(runtime.camera);assert(Math.hypot(raisedProjection.x - originalRaised.x, raisedProjection.y - originalRaised.y) > .05, 'height changes perspective scale even though the ground plane matches');assert.deepEqual(pose(plan), home);
  runtime.endViewfinder();assert.equal(runtime.camera, plan);assert.equal(runtime.view, 'plan');assert.deepEqual(pose(plan), home);
});

test('identity/source/setup changes release the viewfinder lease and native listeners; normal revision sync preserves it', async t => {
  for (const mode of ['identity', 'source', 'setup', 'ownership']) {
    const f = await fixture();t.after(() => f.runtime.dispose());const {runtime} = f, baseline = [f.canvas.count(), f.document.count()];runtime.beginViewfinder();const leased = runtime.camera;
    f.fence = {...f.fence, revision: 2, editEpoch: 3};await runtime.sync();assert.equal(runtime.camera, leased);assert.equal(runtime.view, 'viewfinder');nativeDrag(f, {release: false});
    if (mode === 'identity') {f.fence = {...f.fence, sessionToken: 'replacement'};await runtime.sync();}
    if (mode === 'source') {f.setSource({url: '/assets/studio/library/chair-office.glb', format: 'glb'});await runtime.sync();}
    if (mode === 'setup') {f.state = f.world.setActiveSetup(f.state, 'setup-default');await runtime.sync();}
    if (mode === 'ownership') {f.setCurrent(false);assert.throws(() => runtime.patchViewfinder({focalLength: 50}), {code: 'studio_v3_runtime_stale'});}
    assert.notEqual(runtime.camera, leased, `${mode} must release the old camera`);assert.notEqual(runtime.view, 'viewfinder');assert.deepEqual([f.canvas.count(), f.document.count()], baseline);assert.equal(f.document.listeners.has('pointermove'), false);assert.equal(f.document.listeners.has('pointerup'), false);
    if (mode !== 'ownership') assert.equal(runtime.patchViewfinder({focalLength: 50}), false);await runtime.dispose();
  }
});

test('dispose during a native viewfinder drag removes all runtime and Orbit listeners and is idempotent', async () => {
  const f = await fixture(), {runtime} = f;runtime.beginViewfinder();const leased = runtime.camera;nativeDrag(f, {release: false});assert(f.canvas.count() > 0);assert(f.document.count() > 0);
  await runtime.dispose();assert.equal(runtime.disposed, true);assert.equal(f.canvas.count(), 0);assert.equal(f.document.count(), 0);assert.equal(f.window.count(), 0);assert.equal(f.rendererDisposals, 1);
  const position = leased.position.toArray();f.document.emit('pointermove', {pointerType: 'mouse', pointerId: 7, clientX: 700, clientY: 500});assert.deepEqual(leased.position.toArray(), position);await runtime.dispose();assert.equal(f.rendererDisposals, 1);assert.throws(() => runtime.beginViewfinder(), {code: 'studio_v3_runtime_stale'});
});
