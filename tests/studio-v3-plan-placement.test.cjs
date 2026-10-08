const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all(['schema', 'world-space', 'session', 'runtime', 'plan-placement', 'transform-coordinates', 'surface-hit', 'plan-projection'].map(name => import(`../src/features/studio-v3/${name}.mjs`)).concat(import('three')));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
async function fixture({baseline = false, sourceWorld = false} = {}) {
  const [schema, world, {createStudioSession}, {createStudioV3Runtime}, {createPlanPlacement}, coordinates, surface, projection, THREE] = await modules;
  let initial = schema.createState({worldNodeId: 'world', now: 1});
  if (!sourceWorld) initial.scenePlay.worldSpace.source = {kind: 'mesh-preset', preset: 'room'};
  if (baseline) initial = world.setActiveSetup(initial, 'setup-default');
  const source = {id: 'source', worldResource: {url: '/world.glb', format: 'glb'}}, target = {id: 'world', studioV3: {version: 3, state: initial, revision: 0, sourceBinding: {sourceNodeId: 'source', sourceKind: 'world', sourceSnapshot: structuredClone(source.worldResource)}}};
  let session, runtime, selected = null, guard, current = true, busy = false, revisionAck = 0, id = 0, assetGate = null, writeGate = null, failAsset = false, loads = 0, releases = 0, nativeSource = source.worldResource;
  const errors = [], syncs = [], lanes = [];
  const app = {getState: () => ({nodes: [source, target]}), projectIdentity: () => ({id: 'project'}), registerNodeWriteGuard(nodeId, value) {guard = value; return () => {guard = null;};}};
  session = createStudioSession({nodeId: 'world', app, store: {flush: async () => {}}, autosaveMs: null, getSourceSnapshot: node => node.worldResource,
    publishNode: async (nodeId, patch, {beforeCommit}) => {assert.equal(beforeCommit(), true); const candidate = {...target, studioV3: structuredClone(patch.studioV3)}; assert.equal(guard(candidate), true); target.studioV3 = candidate.studioV3;},
    onChange() {if (runtime && current) syncs.push(runtime.sync(session.getState()));}});
  class Surface {constructor() {this.listeners = new Map();} addEventListener(type, callback) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback);} removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}}
  const doc = new Surface(); doc.defaultView = new Surface(); doc.visibilityState = 'visible';
  const canvas = Object.assign(new Surface(), {ownerDocument: doc, style: {}, clientWidth: 400, clientHeight: 300, width: 400, height: 300, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})});
  class Controls extends THREE.EventDispatcher {constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;} update() {return false;} dispose() {}}
  class Transform extends THREE.EventDispatcher {constructor() {super(); this.helper = new THREE.Group();} getHelper() {return this.helper;} attach(root) {this.object = root;} detach() {this.object = null;} setMode() {} dispose() {}}
  let color = new THREE.Color('#101010'), alpha = .4, targetFrame = null;
  const renderer = {domElement: canvas, autoClear: false, setPixelRatio() {}, setSize() {}, getRenderTarget: () => targetFrame, setRenderTarget(value) {targetFrame = value;}, getClearColor: value => value.copy(color), getClearAlpha: () => alpha, setClearColor(value, opacity) {color = new THREE.Color(value); alpha = opacity;}, render() {}, dispose() {}, forceContextLoss() {}};
  runtime = createStudioV3Runtime({canvas, getState: session.getState, getFence: session.getFence, getSourceResource: () => nativeSource, autoRender: false,
    rendererFactory: () => renderer, controlsFactory: camera => new Controls(camera), transformFactory: () => new Transform(), loader: {async load() {
      loads++; if (assetGate) await assetGate.promise; if (failAsset) throw Error('asset decode failed');
      const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return {root, format: 'glb', animations: [new THREE.AnimationClip('Standing', 1, [])], dispose() {releases++; root.traverse(mesh => {mesh.geometry?.dispose(); mesh.material?.dispose();});}};
    }}});
  await runtime.sync(); runtime.setView('plan'); runtime.render();
  const placement = createPlanPlacement({getState: session.getState, session: {...session, getFence: () => ({...session.getFence(), revision: session.getFence().revision + revisionAck})}, getRuntime: () => runtime,
    isCurrent: () => current, getBusy: () => busy, beforeWrite: async () => {if (writeGate) await writeGate.promise; return {ok: true};}, createId: () => `entity-${++id}`, now: () => 10,
    onSelect: entityId => {selected = entityId; runtime.selectEntity(entityId); return true;}, onLane: lane => lanes.push(lane), onError: error => errors.push(error)});
  const local = entityId => coordinates.applyEntityTransform(session.getState().scenePlay.worldSpace.entities.find(entity => entity.id === entityId).kind, world.renderSetup(session.getState()).entityStates.find(entity => entity.entityId === entityId));
  return {placement, session, runtime, schema, world, coordinates, surface, projection, THREE, local, errors, lanes, syncs,
    get state() {return session.getState();}, get selected() {return selected;}, get loads() {return loads;}, get releases() {return releases;},
    set assetGate(value) {assetGate = value;}, set writeGate(value) {writeGate = value;}, set failAsset(value) {failAsset = value;}, set busy(value) {busy = value;}, set current(value) {current = value;}, acknowledge() {revisionAck++;}, replaceNativeSource(value) {nativeSource = value;},
    async close() {placement.dispose(); current = true; await Promise.all(syncs); await runtime.dispose(); await session.closeGuard();}};
}

test('click creates actor at the highest fixed support; independent placement is one local undo and no duplicate resource loading', async () => {
  const f = await fixture(); const before = f.state;
  const support = new f.THREE.Mesh(new f.THREE.BoxGeometry(3, 2, 3), new f.THREE.MeshBasicMaterial()); support.position.set(1, 2, 1); f.runtime.graph.worldRoot.add(support);
  f.runtime.render(); const snapshot = f.runtime.plan.read().projection;
  const lease = await f.placement.begin({kind: 'actor', label: '  甲  ', point: {x: 1, y: -999, z: 1}, projection: snapshot}); assert(lease);
  assert.deepEqual(f.local(lease.entityId).position, {x: 1, y: 3, z: 1}); assert.equal(f.coordinates.entityStateHeadingRadians('actor', f.world.renderSetup(f.state).entityStates[0]), 0);
  assert.equal(f.state.scenePlay.worldSpace.entities[0].label, '甲'); assert.equal(f.loads, 1); assert.equal(f.selected, lease.entityId);
  assert.equal(f.session.history.getHistory().lanes['setup:setup:state-1'], undefined); assert.equal(lease.onEnd(), true);
  const lane = f.lanes[0]; assert.equal(lane, `setup:${f.state.scenePlay.worldSpace.activeSetupId}`); assert.equal(f.session.history.getHistory().lanes[lane].undoStack.length, 1);
  assert.equal(f.session.history.undo(lane).ok, true); assert.deepEqual(f.state, before); await f.close();
});

test('heading drag retains the first support point and commits one step for a baseline role shared by every setup', async () => {
  const f = await fixture({baseline: true}), before = f.state;
  const lease = await f.placement.begin({kind: 'actor', label: '共享角色', color: '#abc123', point: {x: 1, z: 2}}); assert(lease);
  assert.equal(lease.onMove({position: {x: 2, y: 200, z: 2}}), true); const placed = f.local(lease.entityId).position; assert.equal(placed.x, 1); assert.equal(placed.z, 2); assert(Math.abs(placed.y) < 1e-8); assert(Math.abs(f.coordinates.rotationHeading(f.local(lease.entityId).rotation) - Math.PI / 2) < 1e-8);
  f.acknowledge(); assert.equal(lease.onMove({heading: -.75}), true); assert.equal(lease.onEnd(), true); assert.equal(f.lanes[0], 'world');
  for (const setup of f.state.scenePlay.worldSpace.setups) assert(f.world.renderSetup(f.state, setup.id).entityStates.some(value => value.entityId === lease.entityId));
  assert.equal(f.state.scenePlay.worldSpace.characterRoles[0].color, '#abc123'); assert.equal(f.session.history.undo('world').ok, true); assert.deepEqual(f.state, before); await f.close();
});

test('camera uses support plus 1.6m and optical heading, while baseline camera and invalid role input are refused', async () => {
  const f = await fixture(), visible = f.runtime.getVisibleCameraState(), lease = await f.placement.begin({kind: 'camera', label: '镜头', point: {x: 0, z: 0}}); assert(lease);
  assert.deepEqual(f.local(lease.entityId).position, {x: 0, y: 1.6, z: 0}); assert.equal(lease.onMove({position: {x: 0, z: -2}}), true); assert.equal(lease.onMove({heading: 1.25}), true);
  const state = f.world.renderSetup(f.state).entityStates.find(value => value.entityId === lease.entityId); assert(Math.abs(f.coordinates.rotationHeading(state.camera.rotation) - 1.25) < 1e-8); assert.deepEqual(state.transform.position, state.camera.position); assert.equal(state.camera.frameAspectRatio, visible.frameAspectRatio); assert.equal(Object.hasOwn(state.camera, 'lookAt'), false);
  assert.equal(lease.onCancel(), true); assert.equal(await f.placement.begin({kind: 'actor', label: '   ', point: {x: 0, z: 0}}), null); assert.equal(await f.placement.begin({kind: 'actor', roleId: 'missing', point: {x: 0, z: 0}}), null); assert.equal(f.state.scenePlay.worldSpace.entities.length, 0); await f.close();
  const g = await fixture({baseline: true}); assert.equal(await g.placement.begin({kind: 'camera', point: {x: 0, z: 0}}), null); assert.equal(g.loads, 0); await g.close();
});

test('existing role placement creates a current-setup instance without changing shared role identity', async () => {
  const f = await fixture(), role = f.schema.createRole({id: 'role-existing', label: '老角色', actorGender: 'neutral', color: '#aabbcc', asset: {sourceUrl: '/assets/studio/character.glb', sourceFormat: 'glb'}, now: 1});
  f.session.change(state => f.world.addRole(state, role), {label: 'seed'}); await Promise.all(f.syncs); f.runtime.render();
  const lease = await f.placement.begin({kind: 'actor', roleId: role.id, point: {x: -1, z: 2}}); assert(lease); assert.equal(lease.onEnd(), true); assert.deepEqual(f.state.scenePlay.worldSpace.characterRoles, [role]); assert.equal(f.state.scenePlay.worldSpace.entities[0].roleId, role.id);
  assert.equal(f.state.scenePlay.worldSpace.setups.find(setup => setup.kind === 'scene-baseline').entityStates.length, 0); await f.close();
});

test('pending asset cancellation restores author state and disposes a late asset without touching a foreign transaction', async () => {
  const f = await fixture(), before = f.state, gate = deferred(); f.assetGate = gate;
  const pending = f.placement.begin({kind: 'actor', label: '待加载', point: {x: 0, z: 0}}); await turn(); assert(f.session.history.getActiveTransaction()); assert.equal(f.placement.cancel(), true); assert.deepEqual(f.state, before);
  assert.equal(f.session.history.begin('world', 'foreign', {kind: 'world-space'}), true); gate.resolve(); assert.equal(await pending, null); assert.equal(f.session.history.getActiveTransaction().label, 'foreign'); assert.deepEqual(f.state, before); assert.equal(f.releases, 1); f.session.history.cancel(); await f.close();
});

test('cancelled author handoff and disposed pending placement cannot create a late lease', async () => {
  const f = await fixture(), before = f.state, gate = deferred(); f.writeGate = gate;
  const pending = f.placement.begin({kind: 'actor', label: '待切换', point: {x: 0, z: 0}}); await turn(); assert.equal(f.placement.cancel(), true); assert.equal(f.session.history.getActiveTransaction(), null); gate.resolve(); assert.equal(await pending, null); assert.deepEqual(f.state, before); assert.equal(f.loads, 0); await f.close();
  const g = await fixture(), assetGate = deferred(); g.assetGate = assetGate; const loading = g.placement.begin({kind: 'actor', label: '待释放', point: {x: 0, z: 0}}); await turn(); g.placement.dispose(); assetGate.resolve(); assert.equal(await loading, null); assert.equal(g.session.history.getActiveTransaction(), null); assert.equal(g.state.scenePlay.worldSpace.entities.length, 0); await g.close();
});

test('resource failures rollback all role/entity state; malformed moves and repeated cancellation leave foreign work intact', async () => {
  const f = await fixture(), before = f.state; f.failAsset = true; assert.equal(await f.placement.begin({kind: 'actor', label: '坏模型', point: {x: 0, z: 0}}), null); assert.deepEqual(f.state, before); assert.equal(f.session.history.getActiveTransaction(), null); assert(f.errors.some(error => /decode/.test(error.message))); await f.close();
  const g = await fixture(), lease = await g.placement.begin({kind: 'actor', label: '可取消', point: {x: 0, z: 0}}); assert(lease); assert.equal(lease.onMove({heading: Infinity}), false); assert.equal(lease.onMove({position: {x: NaN, z: 0}}), false); assert.equal(lease.onCancel(), true);
  g.session.history.begin('world', 'foreign', {kind: 'world-space'}); assert.equal(lease.onCancel(), true); assert.equal(lease.onEnd(), false); assert.equal(g.session.history.getActiveTransaction().label, 'foreign'); g.session.history.cancel(); await g.close();
});

test('stale author lifecycle rolls back only its own placement, and lost history ownership never cancels foreign work', async () => {
  const f = await fixture(), before = f.state, lease = await f.placement.begin({kind: 'actor', label: '过期', point: {x: 0, z: 0}}); assert(lease); f.current = false; assert.equal(lease.onMove({heading: 1}), false); assert.deepEqual(f.state, before); assert.equal(f.session.history.getActiveTransaction(), null); await f.close();
  const g = await fixture(), second = await g.placement.begin({kind: 'actor', label: '旧事务', point: {x: 0, z: 0}}); assert(second); g.session.history.cancel(); g.session.history.begin('world', 'foreign', {kind: 'world-space'}); assert.equal(second.onMove({heading: 1}), false); assert.equal(g.placement.cancel(), false); assert.equal(g.session.history.getActiveTransaction().label, 'foreign'); g.session.history.cancel(); await g.close();
});

test('plan support resolves displayed projection x/z, rejects stale snapshots, and differs from existing depth-preserving unprojection', async () => {
  const f = await fixture(), displayed = f.runtime.plan.read().projection, point = f.projection.unprojectPlanPoint(displayed, {nx: .8, ny: .2});
  f.runtime.orbitCamera.position.set(900, 500, -900); f.runtime.plan.rotateBy(1); f.runtime.plan.zoomBy(2);
  assert.deepEqual(f.runtime.resolvePlanSurface({nx: .8, ny: .2, projection: displayed}).point, {...point, y: 0});
  assert.equal(f.projection.unprojectPlanPoint(displayed, {nx: .8, ny: .2}, {y: 7}).y, 7); f.runtime.plan.panPixels({dx: 10, dy: 0}); f.runtime.render(); assert.equal(f.runtime.resolvePlanSurface({nx: .8, ny: .2, projection: displayed}), null);
  f.runtime.setView('orbit'); assert.equal(f.runtime.resolvePlanSurface({point: {x: 0, z: 0}}), null); await f.close();
});

test('highest support includes eligible colliders and below-ground surfaces, excludes invisible/helper/camera/steep surfaces, and falls back only when absent', async () => {
  const [, , , , , , {topDownSupportSurface}, , THREE] = await modules;
  const plane = (y, rotation = -Math.PI / 2) => {const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({side: THREE.DoubleSide})); mesh.rotation.x = rotation; mesh.position.y = y; return mesh;};
  const below = plane(-4), above = plane(3), collider = plane(5), steep = plane(9, -.3), camera = plane(10), hidden = plane(12), helper = plane(14); camera.userData.entityKind = 'camera'; hidden.visible = false; helper.userData.helper = true;
  assert.equal(topDownSupportSurface({x: 0, z: 0}, {meshes: [below], groundY: 0}).point.y, -4);
  const hit = topDownSupportSurface({x: 0, z: 0}, {meshes: [below, above, steep, camera, hidden, helper], colliders: [collider], groundY: 0}); assert.equal(hit.point.y, 5); assert.equal(hit.source, 'collider');
  assert.deepEqual(topDownSupportSurface({x: 30, z: 30}, {meshes: [above], groundY: -2}).point, {x: 30, y: -2, z: 30}); assert.equal(topDownSupportSurface({x: Infinity, z: 0}), null);
});

test('navigation during author handoff retains the initial displayed anchor instead of rejecting its now older projection', async () => {
  const f = await fixture(), gate = deferred(), snapshot = f.runtime.plan.read().projection;
  const original = f.runtime.resolvePlanSurface({nx: .55, ny: .55, projection: snapshot}).point; f.writeGate = gate;
  const pending = f.placement.begin({kind: 'actor', label: '固定首点', nx: .55, ny: .55, projection: snapshot}); await turn();
  f.runtime.plan.panPixels({dx: 50, dy: 30}); f.runtime.render(); assert.notDeepEqual(f.runtime.plan.read().projection, snapshot); gate.resolve();
  const lease = await pending; assert(lease); assert.deepEqual(f.local(lease.entityId).position, original); assert.equal(lease.onEnd(), true); await f.close();
});

test('native source replacement fences and rolls back an active lease even while author ownership remains current', async () => {
  const f = await fixture({sourceWorld: true}), before = f.state, lease = await f.placement.begin({kind: 'actor', label: '来源已换', point: {x: 0, z: 0}}); assert(lease);
  const previousRecord = f.runtime.graph.source; f.replaceNativeSource({url: '/world-next.glb', format: 'glb'}); await f.runtime.sync(f.state); assert.notEqual(f.runtime.graph.source, previousRecord);
  assert.equal(lease.onEnd(), false); assert.equal(f.session.history.getActiveTransaction(), null); assert.deepEqual(f.state, before); await f.close();
});
