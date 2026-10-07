const test = require('node:test');
const assert = require('node:assert/strict');

test('legacy camera locked flag does not block transforms while actor and prop locks still do', async () => {
  const [THREE, schema, world, {createStudioV3Runtime}] = await Promise.all([
    import('three'), import('../src/features/studio-v3/schema.mjs'),
    import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/runtime.mjs')
  ]);
  let state = schema.createState({worldNodeId: 'locks-owner', now: 1});
  for (const kind of ['camera', 'actor', 'prop']) {
    const entity = schema.createEntity({id: kind, kind, label: kind, locked: true, now: 1,
      ...kind === 'prop' ? {asset: {sourceUrl: '/local-prop.glb', sourceFormat: 'glb'}} : {}});
    state = world.addEntity(state, entity);
  }
  assert.equal(schema.assertState(state), state, 'old camera.locked:true remains legal stored V3 data');
  const phases = [], edits = [];
  class Controls extends THREE.EventDispatcher {
    constructor(camera) {super(); this.object = camera; this.target = new THREE.Vector3(); this.enabled = true;}
    update() {return false;} dispose() {}
  }
  class Transform extends THREE.EventDispatcher {
    constructor(camera) {super(); this.camera = camera; this.helper = new THREE.Group();}
    getHelper() {return this.helper;} attach(root) {this.object = root;}
    detach() {this.object = null; this.axis = null;} setMode(mode) {this.mode = mode;} dispose() {}
  }
  const canvas = {clientWidth: 400, clientHeight: 300, getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})};
  const failures = [], runtime = createStudioV3Runtime({canvas, getState: () => state, autoRender: false,
    controlsFactory: camera => new Controls(camera), transformFactory: camera => new Transform(camera),
    rendererFactory: () => ({setPixelRatio() {}, setSize() {}, dispose() {}, forceContextLoss() {}}),
    onTransform: event => {phases.push(event.phase);edits.push(event);}, onStatus: report => {if (report.status === 'failed') failures.push(report.error);},
    loader: {async load() {
      const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); root.add(mesh);
      return {root, format: 'glb', animations: [new THREE.AnimationClip('Standing', 1, [])], dispose() {mesh.geometry.dispose(); mesh.material.dispose();}};
    }}});
  try {
    await runtime.sync();
    assert.deepEqual(failures, []);
    assert.equal(runtime.graph.entity('camera').definition.locked, true, 'stored legacy flag is retained');
    assert.equal(runtime.entityObject('camera').userData.locked, false, 'render permissions ignore camera lock');
    assert.equal(runtime.attachTransform('camera', 'translate'), true);
    const object = runtime.entityObject('camera'), marker = runtime.graph.entity('camera').cameraMarker, proxy = runtime.transformControls.object;
    assert.notEqual(proxy.uuid, object.uuid, 'camera gizmo owns the body-pivot proxy, not the optical-root origin');
    assert.equal(proxy.userData.entityId, 'camera');assert.equal(proxy.userData.helper, true);assert.equal(proxy.userData.captureExcluded, true);
    assert(proxy.position.distanceTo(marker.transformPivot.getWorldPosition(new THREE.Vector3())) < 1e-10, 'proxy is placed at the actual body pivot');
    await runtime.sync();
    assert.equal(runtime.transformControls.object?.uuid, proxy.uuid, 'sync must not detach a legal camera gizmo');
    const beforePosition = object.position.clone();
    runtime.transformControls.dispatchEvent({type: 'mouseDown'});
    proxy.position.x += 1; runtime.transformControls.dispatchEvent({type: 'objectChange'});
    runtime.transformControls.dispatchEvent({type: 'mouseUp'});
    assert.deepEqual(phases, ['begin', 'preview', 'commit']);
    assert(Math.abs(object.position.x - beforePosition.x - 1) < 1e-10, 'proxy translation moves the editable legacy camera optical root');
    assert(Math.abs(edits.at(-1).transform.position.x - object.position.x) < 1e-10, 'committed domain pose is read from the optical root');
    assert.equal(runtime.attachTransform('camera', 'scale'), false, 'camera marker size is fixed even for editable legacy cameras');
    assert.equal(runtime.attachTransform('camera', 'rotate'), true);const pivot = marker.transformPivot.getWorldPosition(new THREE.Vector3()), lensBefore = object.getWorldPosition(new THREE.Vector3());
    runtime.transformControls.dispatchEvent({type: 'mouseDown'});proxy.rotation.y += Math.PI / 2;runtime.transformControls.dispatchEvent({type: 'objectChange'});runtime.transformControls.dispatchEvent({type: 'mouseUp'});
    assert(marker.transformPivot.getWorldPosition(new THREE.Vector3()).distanceTo(pivot) < 1e-10, 'camera rotation retains the body pivot');
    assert(object.getWorldPosition(new THREE.Vector3()).distanceTo(lensBefore) > .1, 'the optical origin orbits the body pivot rather than staying fixed');
    assert.deepEqual(phases, ['begin', 'preview', 'commit', 'begin', 'preview', 'commit']);const completedPhases = [...phases];
    for (const kind of ['actor', 'prop']) {
      assert.equal(runtime.entityObject(kind).userData.locked, true);
      assert.equal(runtime.attachTransform(kind), false);
      runtime.transformControls.attach(runtime.entityObject(kind));
      runtime.transformControls.dispatchEvent({type: 'mouseDown'});
      assert.deepEqual(phases, completedPhases, `${kind} locked drag cannot begin`);
      await runtime.sync();
      assert.equal(runtime.transformControls.object, null, `${kind} lock detaches a stale native attachment`);
    }
    assert.deepEqual(failures, []);
  } finally {await runtime.dispose();}
});
