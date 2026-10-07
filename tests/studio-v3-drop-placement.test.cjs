const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const load = import('../src/features/studio-v3/drop-placement.mjs');
const supportModule = import('../src/features/studio-v3/surface-hit.mjs');
const transform = (y = 0) => ({position: {x: 0, y, z: 0}, rotation: {x: 0, y: .3, z: 0, order: 'XYZ'}, scale: {x: 1, y: 1, z: 1}});
function box(width, height, depth, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial()); mesh.position.set(x, y, z); return mesh;
}
test('drop uses rendered base, excludes own meshes even inside an ancestor, preserves pose and never mutates renderable', async () => {
  const {resolveDropPlacement} = await load, scene = new THREE.Group(), object = box(2, 2, 2, 0, 6, 0), support = box(6, 1, 6, 0, 1.5, 0);
  scene.add(object, support); const before = transform(6), result = resolveDropPlacement({kind: 'prop', object, transform: before, meshes: [scene]});
  assert.equal(result.referenceY, 5); assert.equal(result.transform.position.y, 3); assert.equal(result.support.point.y, 2);
  assert.deepEqual(result.transform.rotation, before.rotation); assert.deepEqual(result.transform.scale, before.scale); assert.equal(object.position.y, 6); assert.equal(before.position.y, 6);
});
test('five base samples find a corner support which the center misses', async () => {
  const {resolveDropPlacement} = await load, object = box(4, 2, 4, 0, 6, 0), support = box(.6, 2, .6, 2, 2, 2);
  const result = resolveDropPlacement({kind: 'actor', object, transform: transform(6), meshes: [support]});
  assert.equal(result.points.length, 5); assert.equal(result.support.point.y, 3); assert.equal(result.transform.position.y, 4);
});
test('3 cm allowance is a support preference and all-above falls back to the lowest surface', async () => {
  const {placementSupport} = await supportModule, points = [{x: 0, z: 0}], low = box(4, .02, 4, 0, 1, 0), high = box(4, 1, 4, 0, 4, 0);
  assert(Math.abs(placementSupport(points, {meshes: [low, high], referenceY: 1, groundY: 0}).point.y - 1.01) < 1e-6);
  assert.equal(placementSupport(points, {meshes: [high], referenceY: -2, groundY: 0}).point.y, 0);
});
test('steep and hidden supports do not lift the object; empty renderables use stored base and local ground', async () => {
  const {resolveDropPlacement} = await load, {placementSupport} = await supportModule, slope = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  slope.rotation.x = -Math.PI / 6; slope.position.y = 3;
  assert.equal(placementSupport([{x: 0, z: 0}], {meshes: [slope], referenceY: 5}).point.y, 0);
  slope.rotation.x = -Math.PI / 2; slope.visible = false;
  assert.equal(placementSupport([{x: 0, z: 0}], {meshes: [slope], referenceY: 5}).point.y, 0);
  const result = resolveDropPlacement({kind: 'actor', object: new THREE.Group(), transform: transform(5), groundY: -2}); assert.equal(result.transform.position.y, -2);
});
test('camera drop is unavailable and scaled/rotated geometry lands by its real AABB', async () => {
  const {resolveDropPlacement} = await load, object = box(2, 2, 2, 0, 8, 0); object.scale.set(1, 2, 1); object.rotation.z = .5;
  assert.equal(resolveDropPlacement({kind: 'camera', object, transform: transform(8)}), null);
  const result = resolveDropPlacement({kind: 'prop', object, transform: transform(8)}), nextBase = result.referenceY + result.transform.position.y - 8;
  assert(Math.abs(nextBase) < 1e-10); assert(result.transform.position.y > 2);
});
