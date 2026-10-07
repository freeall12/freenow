const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('real camera GLB stays behind the optical origin after current-view creation', async t => {
  const [THREE, {decodeGlb}, {createRenderGraph}, schema, actions] = await Promise.all([
    import('three'), import('../src/features/studio-v3/asset-loader.mjs'),
    import('../src/features/studio-v3/render-graph.mjs'), import('../src/features/studio-v3/schema.mjs'),
    import('../src/features/studio-v3/entity-actions.mjs')
  ]);
  // Node decodes the embedded PNG metadata only. The browser evidence covers
  // actual texture rendering; this regression checks the real mesh geometry.
  const previous = {self: global.self, createImageBitmap: global.createImageBitmap, ProgressEvent: global.ProgressEvent};
  global.self = global;
  global.ProgressEvent = class extends Event {constructor(type, fields) {super(type); Object.assign(this, fields);}};
  global.createImageBitmap = async blob => {const bytes = new DataView(await blob.arrayBuffer());return {width: bytes.getUint32(16), height: bytes.getUint32(20), close() {}};};
  t.after(() => {for (const [key, value] of Object.entries(previous)) if (value === undefined) delete global[key]; else global[key] = value;});
  const bytes = fs.readFileSync(require.resolve('../assets/studio/camera.glb'));
  const state = actions.reduceEntityAction(schema.createState({worldNodeId: 'marker-owner', now: 1}), {
    type: 'create', kind: 'camera', id: 'camera', transform: {position: {x: 0, y: 0, z: 0}},
    camera: {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, focalLength: 35, frameAspectRatio: 9 / 16}
  }).state;
  const graph = createRenderGraph({scene: new THREE.Scene(), loader: {load: () => decodeGlb(new Blob([bytes]))}});
  t.after(() => graph.dispose());
  await graph.sync(state);
  const record = graph.entity('camera'); assert.equal(record.status, 'ready');
  const bounds = new THREE.Box3().setFromObject(record.asset.root), size = bounds.getSize(new THREE.Vector3());
  assert(Math.abs(Math.max(size.x, size.y, size.z) - .25) < 1e-6);
  assert(Math.abs(bounds.getCenter(new THREE.Vector3()).z - .13) < 1e-6);
  assert(bounds.min.z > 0, 'editor body must stay behind a camera looking down local -Z');
  assert.deepEqual(record.camera.position.toArray(), [0, 0, 0]);
  assert.deepEqual(record.root.position.toArray(), [0, 0, 0]);
  assert.equal(record.camera.aspect, 9 / 16);
  assert(Math.abs(record.camera.getFocalLength() - 35) < 1e-6);
  const ray = new THREE.Raycaster(record.camera.position, new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(record.root, true).length, 0, 'lens ray must not intersect its own body');
});
