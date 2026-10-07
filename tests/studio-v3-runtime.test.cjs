const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/render-graph.mjs'), import('../src/features/studio-v3/runtime.mjs'), import('../src/features/studio-v3/asset-loader.mjs'), import('../src/features/studio-v3/surface-hit.mjs')]);
const wait = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
async function world() {
  const [THREE, schema, domain] = await modules; let state = schema.createState({worldNodeId: 'v3-owner', now: 1});
  const add = (id, kind = 'prop', setupId = 'setup:state-1', options = {}) => {
    const entity = schema.createEntity({id, kind, label: id, now: 2, ...kind === 'prop' ? {asset: {sourceUrl: '/assets/studio/library/chair-dining.glb', sourceFormat: 'glb'}} : {}, ...options});
    const setupState = schema.createSetupState(id, 2); if (kind === 'actor') setupState.pose = 'Standing';
    state = domain.addEntity(state, entity, {setupId, setupState}); return setupState;
  };
  return {THREE, schema, domain, add, get state() {return state;}, set state(value) {state = value;}};
}
function fakeAsset(THREE, {actor = false, dispose = () => {}} = {}) {
  const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  return {root, format: 'glb', animations: actor ? [new THREE.AnimationClip('Standing', 1, []), new THREE.AnimationClip('Idle', 1, [])] : [], dispose};
}
test('graph renders shared baseline first and independent entities, with real Three transforms and independent IDs', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('shared', 'prop', 'setup-default'); f.add('local');
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'local', {transform: {position: {x: 3, y: 2, z: 1}, rotation: {x: .1, y: .5, z: .2}, scale: {x: 2, y: 3, z: 4}}}, 3);
  const scene = new f.THREE.Scene(), graph = createRenderGraph({scene, loader: {load: async () => fakeAsset(f.THREE)}});
  const report = await graph.sync(f.state); assert.deepEqual([...graph.entities.keys()], ['shared', 'local']); assert.equal(report.entities.every(value => value.status === 'ready'), true);
  assert.deepEqual(graph.entity('local').root.position.toArray(), [3, 2, 1]); assert.deepEqual(graph.entity('local').root.scale.toArray(), [2, 3, 4]); assert.equal(graph.entity('local').root.rotation.y, .5);
  const root = graph.entity('shared').root;
  f.state = f.domain.setActiveSetup(f.state, 'setup-default'); await graph.sync(f.state); assert.equal(graph.entities.size, 1); assert.equal(graph.entity('shared').root, root);
  assert.equal(root.userData.entityId, 'shared'); assert.equal(root.userData.studioId, undefined); graph.dispose();
});
test('pose, visibility, locking and separate camera optics synchronize without replacing decoded assets', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('actor', 'actor'); f.add('camera', 'camera'); let loads = 0;
  const graph = createRenderGraph({scene: new f.THREE.Scene(), loader: {load: async descriptor => {loads++; return fakeAsset(f.THREE, {actor: descriptor.sourceUrl.includes('character')});}}});
  await graph.sync(f.state); const root = graph.entity('actor').root; assert.equal(graph.entity('actor').pose, 'Standing');
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'actor', {pose: 'Idle', visible: false}, 3);
  f.state = f.domain.patchEntity(f.state, 'actor', {locked: true}, 3);
  const camera = {position: {x: 4, y: 5, z: 6}, rotation: {x: .1, y: .2, z: .3}, fov: 37, focalLength: 48, frameAspectRatio: 2.35, apertureFNumber: 2.8, focusDistance: 8};
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'camera', {camera}, 3); await graph.sync(f.state);
  assert.equal(graph.entity('actor').root, root); assert.equal(loads, 2); assert.equal(root.visible, false); assert.equal(root.userData.locked, true); assert.equal(graph.entity('actor').pose, 'Idle');
  const {focalLengthToFov, normalizeCameraOptics} = await import('../src/features/studio-v3/camera-optics.mjs');
  const lens = graph.entity('camera').camera; assert.deepEqual(lens.position.toArray(), [4, 5, 6]); assert.equal(lens.fov, focalLengthToFov(48, 2.35)); assert.equal(lens.aspect, 2.35); assert.deepEqual(lens.userData.studioV3Optics, normalizeCameraOptics(camera));
  assert.deepEqual(graph.entity('camera').root.position.toArray(), lens.position.toArray());assert.deepEqual(graph.entity('camera').root.quaternion.toArray(), lens.quaternion.toArray());
  assert(graph.entity('camera').root.userData.captureExcluded); assert(graph.entity('camera').cameraHelper.userData.captureExcluded); graph.dispose();
});
test('async session changes release late results and never publish a stale or failed ghost', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('late'); const gate = deferred(), statuses = []; let sessionToken = 'one', released = 0, loads = 0;
  const graph = createRenderGraph({scene: new f.THREE.Scene(), getFence: () => ({sessionToken, revision: 1}), onStatus: value => statuses.push(value), loader: {async load() {loads++; if (loads === 1) {await gate.promise; return fakeAsset(f.THREE, {dispose: () => released++});} return fakeAsset(f.THREE);}}});
  const pending = graph.sync(f.state); await wait(); sessionToken = 'two'; const next = graph.sync(f.state); await next; gate.resolve(); await pending;
  assert.equal(released, 1); assert.equal(graph.entities.size, 1); assert.equal(graph.entity('late').status, 'ready'); assert.equal(graph.entityRoot.children.length, 1); assert.equal(statuses.filter(value => value.status === 'ready').length, 1);
  graph.dispose();
  const failed = createRenderGraph({scene: new f.THREE.Scene(), loader: {load: async () => {throw Error('decoder failed');}}}); const report = await failed.sync(f.state);
  assert.equal(report.entities[0].status, 'failed'); assert.match(report.entities[0].error, /decoder failed/); assert.equal(failed.entityRoot.children.length, 0); failed.dispose();
});
test('same-asset sync renews pending revision/edit fences without decoding again and applies the latest domain snapshot', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('pending'); const gate = deferred(); let revision = 1, editEpoch = 0, loads = 0, released = 0;
  const graph = createRenderGraph({scene: new f.THREE.Scene(), getFence: () => ({nodeId: 'v3-owner', sessionToken: 'one', revision, editEpoch}), loader: {async load() {loads++; await gate.promise; return fakeAsset(f.THREE, {dispose: () => released++});}}});
  const pending = graph.sync(f.state); await wait();
  f.state = f.domain.patchEntity(f.state, 'pending', {label: 'Latest title'}, 3); revision++;
  const transform = structuredClone(graph.entity('pending').state.transform); transform.position = {x: 7, y: 2, z: -3};
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'pending', {transform}, 3); editEpoch++;
  const latest = graph.sync(f.state); await wait(); assert.equal(loads, 1); gate.resolve(); await Promise.all([pending, latest]);
  assert.equal(graph.entity('pending').status, 'ready'); assert.equal(graph.entity('pending').root.name, 'Latest title'); assert.deepEqual(graph.entity('pending').root.position.toArray(), [7, 2, -3]); assert.equal(released, 0);
  graph.dispose(); assert.equal(released, 1);
});
test('setup switches cancel pending geometry while unsynchronized revision changes cannot publish late results', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('pending'); const gate = deferred(); let revision = 1, released = 0;
  const graph = createRenderGraph({scene: new f.THREE.Scene(), getFence: () => ({revision}), loader: {async load() {await gate.promise; return fakeAsset(f.THREE, {dispose: () => released++});}}});
  const pending = graph.sync(f.state); await wait(); f.state = f.domain.setActiveSetup(f.state, 'setup-default'); await graph.sync(f.state); gate.resolve(); await pending;
  assert.equal(graph.entities.size, 0); assert.equal(graph.entityRoot.children.length, 0); assert.equal(released, 1); graph.dispose();
  const otherGate = deferred(), unsynchronized = createRenderGraph({scene: new f.THREE.Scene(), getFence: () => ({revision}), loader: {async load() {await otherGate.promise; return fakeAsset(f.THREE, {dispose: () => released++});}}});
  f.state = f.domain.setActiveSetup(f.state, 'setup:state-1'); const stale = unsynchronized.sync(f.state); await wait(); revision++; otherGate.resolve(); await stale;
  assert.equal(unsynchronized.entityRoot.children.length, 0); assert.equal(released, 2); unsynchronized.dispose();
});
test('real official Standing pose is static; moving Idle clips render only while visible', async () => {
  const f = await world(), [, , , {createRenderGraph}, , {decodeGlb}] = await modules; f.add('actor', 'actor');
  const bytes = fs.readFileSync(require.resolve('../assets/studio/character.glb'));
  const graph = createRenderGraph({scene: new f.THREE.Scene(), loader: {load: () => decodeGlb(new Blob([bytes]))}}); await graph.sync(f.state);
  assert.equal(graph.needsAnimation(), false); assert.equal(graph.tick(.1), false); assert.equal(graph.entity('actor').action.paused, true);
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'actor', {pose: 'Idle'}, 3); await graph.sync(f.state);
  assert.equal(graph.needsAnimation(), true); assert.equal(graph.entity('actor').action.paused, false); assert.equal(graph.tick(.1), true);
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'actor', {visible: false}, 4); await graph.sync(f.state); assert.equal(graph.needsAnimation(), false); assert.equal(graph.tick(.1), false); graph.dispose();
});
test('unknown actor pose disposes the failed renderable and explicit retry works', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('actor', 'actor'); f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'actor', {pose: 'Unknown'}, 3); let released = 0;
  const graph = createRenderGraph({scene: new f.THREE.Scene(), loader: {load: async () => fakeAsset(f.THREE, {actor: true, dispose: () => released++})}});
  const report = await graph.sync(f.state); assert.equal(report.entities[0].status, 'failed'); assert.equal(released, 1); assert.equal(graph.entityRoot.children.length, 0);
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'actor', {pose: 'Idle'}, 4); assert(graph.retry('actor')); await graph.sync(f.state); assert.equal(graph.entity('actor').pose, 'Idle'); graph.dispose(); assert.equal(released, 2);
});
test('clay switching retains source texture references and disposal releases their owning asset', async () => {
  const f = await world(), [, , , {createRenderGraph}] = await modules; f.add('prop'); const asset = fakeAsset(f.THREE), material = asset.root.children[0].material, texture = new f.THREE.Texture(); material.map = texture; let disposed = false;
  asset.dispose = () => {assert.equal(material.map, texture); disposed = true;};
  const graph = createRenderGraph({scene: new f.THREE.Scene(), loader: {load: async () => asset}}); await graph.sync(f.state);
  f.state = f.domain.patchEntity(f.state, 'prop', {materialMode: 'clay'}, 3); await graph.sync(f.state); assert.equal(material.map, null);
  f.state = f.domain.patchEntity(f.state, 'prop', {materialMode: 'source'}, 4); await graph.sync(f.state); assert.equal(material.map, texture);
  f.state = f.domain.patchEntity(f.state, 'prop', {materialMode: 'clay'}, 5); await graph.sync(f.state); graph.dispose(); assert(disposed);
});

test('support surfaces choose the highest upward table and preserve world-space normal/source while excluding helpers/cameras', async () => {
  const [THREE, , , , , , hit] = await modules, scene = new THREE.Group();
  const box = (y, size = 1) => {const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, size, 4), new THREE.MeshStandardMaterial()); mesh.position.y = y; return mesh;};
  const bottom = box(1), top = box(3), helper = box(6), camera = box(8); helper.userData.helper = true; camera.userData.entityKind = 'camera'; scene.add(bottom, top, helper, camera);
  const found = hit.supportSurface({x: 0, z: 0}, {meshes: [scene]}); assert.equal(found.point.y, 3.5); assert.deepEqual(found.normal, {x: 0, y: 1, z: 0}); assert.equal(found.source, 'mesh');
  top.visible = false; assert.equal(hit.supportSurface({x: 0, z: 0}, {meshes: [scene]}).point.y, 1.5);
  const collider = box(4); assert.equal(hit.supportSurface({x: 0, z: 0}, {meshes: [scene], colliders: [collider]}).source, 'collider');
  assert.equal(hit.supportSurface({x: 9, z: 9}, {meshes: [scene], groundFallback: false}), null); assert.equal(hit.supportSurface({x: 9, z: 9}, {meshes: [scene]}).source, 'ground-plane');
});
test('sloped normals use the normal matrix and wall support is rejected; viewport direct hit returns closest source', async () => {
  const [THREE, , , , , , hit] = await modules;
  const slope = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({side: THREE.DoubleSide})); slope.rotation.x = -Math.PI / 3; slope.scale.set(2, 1, 3); slope.position.y = 2;
  const found = hit.supportSurface({x: 0, z: 0}, {meshes: [slope], groundFallback: false}); assert(Math.abs(found.normal.y - Math.sin(Math.PI / 3)) < 1e-6); assert(Math.abs(found.point.y - 2) < 1e-6);
  slope.rotation.x = 0; assert.equal(hit.supportSurface({x: 0, z: 0}, {meshes: [slope], groundFallback: false}), null);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial()); plane.rotation.x = -Math.PI / 2; plane.position.y = 2;
  const ray = hit.viewportRay({clientX: 50, clientY: 50}, {left: 0, top: 0, width: 100, height: 100}, camera);
  assert.equal(hit.directSurface(ray, {meshes: [plane]}).source, 'mesh'); assert.equal(hit.surfaceHit(ray, {mode: 'support-surface', meshes: [plane]}).point.y, 2);
});
test('capture exclusion restores camera/helper visibility on success, throw and async rejection', async () => {
  const [THREE, , , , , , {withCaptureVisibility}] = await modules, scene = new THREE.Scene(), excluded = new THREE.Group(), included = new THREE.Group(); excluded.userData.captureExcluded = true; scene.add(excluded, included);
  const inspect = () => {assert.equal(excluded.visible, false); assert.equal(included.visible, true);};
  withCaptureVisibility(scene, inspect); assert(excluded.visible); assert.throws(() => withCaptureVisibility(scene, () => {inspect(); throw Error('capture failed');}), /capture failed/); assert(excluded.visible);
  await assert.rejects(withCaptureVisibility(scene, async () => {await wait(); inspect(); throw Error('late failure');}), /late failure/); assert(excluded.visible);
});

async function runtimeFixture({onTransform = () => {}, nativeTransform = false} = {}) {
  const f = await world(), [, , , , {createStudioV3Runtime}] = await modules; f.add('prop'); let revision = 1, draws = 0, rendererDisposals = 0, controlDisposals = 0; const transformEvents = [], frames = [];
  class Controls extends f.THREE.EventDispatcher {constructor(camera) {super(); this.object = camera; this.target = new f.THREE.Vector3(); this.enabled = true;} update() {} dispose() {controlDisposals++;}}
  class Transform extends f.THREE.EventDispatcher {constructor() {super(); this.helper = new f.THREE.Group();} getHelper() {return this.helper;} attach(root) {this.object = root;} detach() {this.object = null;} setMode(mode) {this.mode = mode;} dispose() {controlDisposals++;}}
  const canvas = {clientWidth: 400, clientHeight: 300, style: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})};
  const NativeTransform = nativeTransform ? (await import('three/addons/controls/TransformControls.js')).TransformControls : null;
  const renderer = {domElement: canvas, setPixelRatio() {}, setSize() {}, render(scene) {draws++; frames.push({cameraExcluded: scene.children.some(object => object.visible && object.userData.captureExcluded)});}, dispose() {rendererDisposals++;}, forceContextLoss() {}};
  const runtime = createStudioV3Runtime({canvas, getState: () => f.state, getFence: () => ({revision}), loader: {load: async () => fakeAsset(f.THREE)}, autoRender: false,
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: camera => nativeTransform ? new NativeTransform(camera, canvas) : new Transform(), onTransform: value => {transformEvents.push(value); onTransform(value);}});
  await runtime.sync();
  return {f, runtime, renderer, transformEvents, frames, get draws() {return draws;}, get rendererDisposals() {return rendererDisposals;}, get controlDisposals() {return controlDisposals;}, bumpRevision() {revision++;}};
}
test('runtime exposes real scene cameras/controls, preserves selection on revision edits and excludes helpers in capture', async () => {
  const t = await runtimeFixture(), {runtime, f} = t; assert(runtime.scene.isScene); assert(runtime.camera.isPerspectiveCamera); runtime.selectEntity('prop'); assert(runtime.attachTransform('prop'));
  f.state = f.domain.patchEntity(f.state, 'prop', {label: 'renamed'}, 3); t.bumpRevision(); await runtime.sync(); assert.equal(runtime.selectedEntityId, 'prop'); assert.equal(runtime.transformControls.object, runtime.entityObject('prop'));
  runtime.setView('plan'); assert(runtime.camera.isOrthographicCamera); assert.equal(runtime.controls.object, runtime.planCamera); assert.equal(runtime.controls.enableRotate, false); runtime.render();
  await runtime.renderCapture(); assert.equal(t.frames.at(-1).cameraExcluded, false); await runtime.dispose(); assert.equal(t.rendererDisposals, 1); assert.equal(t.controlDisposals, 2); await runtime.dispose(); assert.equal(t.rendererDisposals, 1);
});
test('runtime transform previews emit transaction phases, cancel restores transform, locked entities cannot attach', async () => {
  const t = await runtimeFixture(), {runtime, f} = t, transform = runtime.transformControls; runtime.attachTransform('prop'); transform.dispatchEvent({type: 'mouseDown'});
  runtime.entityObject('prop').position.x = 12; transform.dispatchEvent({type: 'objectChange'}); assert.equal(t.transformEvents[1].phase, 'preview'); assert.equal(t.transformEvents[1].transform.position.x, 12);
  assert(runtime.cancelTransform()); assert.equal(runtime.entityObject('prop').position.x, 0); assert.equal(t.transformEvents.at(-1).phase, 'cancel');
  runtime.attachTransform('prop'); transform.dispatchEvent({type: 'mouseDown'}); transform.dispatchEvent({type: 'mouseUp'}); assert.equal(t.transformEvents.at(-1).phase, 'commit');
  f.state = f.domain.patchEntity(f.state, 'prop', {locked: true}, 3); await runtime.sync(); assert.equal(transform.object, null); assert.equal(runtime.attachTransform('prop'), false); await runtime.dispose();
});
test('runtime keeps an active drag across caller preview revision sync and detaches if the entity is hidden', async () => {
  const t = await runtimeFixture(), {runtime, f} = t, transform = runtime.transformControls; runtime.attachTransform('prop'); transform.dispatchEvent({type: 'mouseDown'});
  runtime.entityObject('prop').position.x = 4; transform.dispatchEvent({type: 'objectChange'});
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'prop', {transform: t.transformEvents.at(-1).transform}, 3); t.bumpRevision(); await runtime.sync();
  assert.equal(t.transformEvents.at(-1).phase, 'preview'); assert.equal(transform.object, runtime.entityObject('prop')); transform.dispatchEvent({type: 'mouseUp'}); assert.equal(t.transformEvents.at(-1).phase, 'commit'); assert.equal(t.transformEvents.at(-1).transform.position.x, 4);
  f.state = f.domain.patchEntityState(f.state, 'setup:state-1', 'prop', {visible: false}, 4); await runtime.sync(); assert.equal(transform.object, null); assert.equal(runtime.attachTransform('prop'), false); await runtime.dispose();
});
test('failed or stale transform transaction callbacks restore preview and cannot block renderer cleanup', async () => {
  const t = await runtimeFixture({onTransform: value => {if (value.phase === 'preview' || value.phase === 'cancel') throw Error('transaction is fenced out');}}), {runtime} = t;
  runtime.attachTransform('prop'); runtime.transformControls.dispatchEvent({type: 'mouseDown'}); runtime.entityObject('prop').position.x = 9;
  assert.doesNotThrow(() => runtime.transformControls.dispatchEvent({type: 'objectChange'})); assert.equal(runtime.entityObject('prop').position.x, 0); assert.equal(runtime.controls.enabled, true);
  runtime.attachTransform('prop'); runtime.transformControls.dispatchEvent({type: 'mouseDown'}); await runtime.dispose(); assert.equal(t.rendererDisposals, 1); assert.equal(t.controlDisposals, 2);
});
test('cancel ends native Three dragging and detaches so held-pointer moves or release cannot mutate or commit', async () => {
  const t = await runtimeFixture({nativeTransform: true}), {runtime} = t, transform = runtime.transformControls, root = runtime.entityObject('prop'); runtime.attachTransform('prop');
  transform.axis = 'X'; transform.dragging = true; transform.dispatchEvent({type: 'mouseDown'}); assert.equal(runtime.controls.enabled, false);
  root.position.x = 4; transform.dispatchEvent({type: 'objectChange'}); assert.equal(t.transformEvents.at(-1).phase, 'preview');
  assert.equal(runtime.cancelTransform(), true); assert.equal(transform.dragging, false); assert.equal(transform.axis, null); assert.equal(transform.object, undefined); assert.equal(runtime.controls.enabled, true); assert.equal(root.position.x, 0);
  const phases = t.transformEvents.map(event => event.phase); transform.pointerMove({x: .5, y: .2, button: -1}); transform.pointerUp({button: 0});
  assert.equal(root.position.x, 0); assert.deepEqual(t.transformEvents.map(event => event.phase), phases); assert.deepEqual(phases, ['begin', 'preview', 'cancel']); await runtime.dispose();
});
test('changing selection cancels native drag before detach and closes the domain transaction exactly once', async () => {
  let open = 0; const t = await runtimeFixture({nativeTransform: true, onTransform: event => {if (event.phase === 'begin') open++; if (event.phase === 'cancel' || event.phase === 'commit') open--;}}), {runtime, f} = t;
  f.add('second'); await runtime.sync(); runtime.attachTransform('prop'); const transform = runtime.transformControls, root = runtime.entityObject('prop'); transform.axis = 'X'; transform.dragging = true; transform.dispatchEvent({type: 'mouseDown'});
  root.position.x = 6; transform.dispatchEvent({type: 'objectChange'}); runtime.selectEntity('second'); assert.equal(runtime.selectedEntityId, 'second'); assert.equal(root.position.x, 0); assert.equal(open, 0);
  assert.equal(transform.dragging, false); assert.equal(transform.axis, null); assert.equal(transform.object, undefined); assert.equal(runtime.controls.enabled, true);
  transform.pointerMove({x: .5, y: .2, button: -1}); transform.pointerUp({button: 0}); assert.equal(open, 0); assert.deepEqual(t.transformEvents.map(event => event.phase), ['begin', 'preview', 'cancel']);
  runtime.selectEntity('second'); assert.equal(open, 0); await runtime.dispose();
});
test('repeated selection and caller preview sync preserve the active native drag through normal release', async () => {
  let t; const synchronizations = [];
  t = await runtimeFixture({nativeTransform: true, onTransform: event => {if (event.phase === 'preview') {
    t.f.state = t.f.domain.patchEntityState(t.f.state, 'setup:state-1', event.entityId, {transform: event.transform}, 3); t.bumpRevision();
    synchronizations.push(t.runtime.sync().then(() => t.runtime.selectEntity(event.entityId)));
  }}});
  const {runtime} = t, transform = runtime.transformControls, root = runtime.entityObject('prop'); runtime.attachTransform('prop'); transform.axis = 'X'; transform.dragging = true; transform.dispatchEvent({type: 'mouseDown'});
  runtime.selectEntity('prop'); root.position.x = 8; transform.dispatchEvent({type: 'objectChange'}); await Promise.all(synchronizations); runtime.selectEntity('prop');
  assert.equal(transform.dragging, true); assert.equal(transform.axis, 'X'); assert.equal(transform.object, root); assert.equal(runtime.controls.enabled, false); assert.deepEqual(t.transformEvents.map(event => event.phase), ['begin', 'preview']);
  transform.pointerUp({button: 0}); assert.equal(transform.dragging, false); assert.equal(transform.axis, null); assert.equal(runtime.controls.enabled, true); assert.deepEqual(t.transformEvents.map(event => event.phase), ['begin', 'preview', 'commit']); assert.equal(t.transformEvents.at(-1).transform.position.x, 8); await runtime.dispose();
});
test('runtime schedules at most one RAF even when orbit update invalidates during draw', async () => {
  const f = await world(), [, , , , {createStudioV3Runtime}] = await modules, scheduled = new Map(); let serial = 0;
  class Controls extends f.THREE.EventDispatcher {constructor() {super(); this.target = new f.THREE.Vector3();} update() {this.dispatchEvent({type: 'change'});} dispose() {}}
  class Transform extends f.THREE.EventDispatcher {getHelper() {return new f.THREE.Group();} detach() {} dispose() {}}
  const canvas = {clientWidth: 300, clientHeight: 200}; const runtime = createStudioV3Runtime({canvas, getState: () => f.state,
    rendererFactory: () => ({setPixelRatio() {}, setSize() {}, render() {}, dispose() {}}), controlsFactory: () => new Controls(), transformFactory: () => new Transform(),
    requestFrame: fn => {scheduled.set(++serial, fn); return serial;}, cancelFrame: id => scheduled.delete(id)});
  assert.equal(scheduled.size, 1); for (let i = 0; i < 20; i++) {const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); callback(i * 16); assert.equal(scheduled.size, 1);}
  await runtime.dispose(); assert.equal(scheduled.size, 0);
});
test('runtime stops RAF for static scenes, finishes damping, and suspends hidden documents until visibility resumes', async () => {
  const f = await world(), [, , , , {createStudioV3Runtime}] = await modules, scheduled = new Map(), listeners = new Map(); let serial = 0, dampingFrames = 2, draws = 0;
  const document = {visibilityState: 'visible', addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event)};
  class Controls extends f.THREE.EventDispatcher {constructor() {super(); this.target = new f.THREE.Vector3();} update() {if (dampingFrames > 0) {dampingFrames--; return true;} return false;} dispose() {}}
  class Transform extends f.THREE.EventDispatcher {getHelper() {return new f.THREE.Group();} detach() {} dispose() {}}
  const canvas = {clientWidth: 300, clientHeight: 200, ownerDocument: document}; const runtime = createStudioV3Runtime({canvas, getState: () => f.state,
    rendererFactory: () => ({setPixelRatio() {}, setSize() {}, render() {draws++;}, dispose() {}}), controlsFactory: () => new Controls(), transformFactory: () => new Transform(),
    requestFrame: fn => {scheduled.set(++serial, fn); return serial;}, cancelFrame: id => scheduled.delete(id)});
  const drawNext = time => {const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); callback(time);};
  drawNext(16); assert.equal(scheduled.size, 1); drawNext(32); assert.equal(scheduled.size, 1); drawNext(48); assert.equal(scheduled.size, 0); assert.equal(draws, 3);
  runtime.resize(); assert.equal(scheduled.size, 1); document.visibilityState = 'hidden'; listeners.get('visibilitychange')(); assert.equal(scheduled.size, 0);
  runtime.resize(); assert.equal(scheduled.size, 0); document.visibilityState = 'visible'; listeners.get('visibilitychange')(); assert.equal(scheduled.size, 1);
  drawNext(10000); assert.equal(scheduled.size, 0); assert.equal(draws, 4); await runtime.dispose(); assert.equal(listeners.has('visibilitychange'), false);
});
