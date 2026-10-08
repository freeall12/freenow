const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/room-scene.mjs'), import('../src/features/studio-v3/schema.mjs')]);
async function fixture(patch = {}, groundY = 0) {
  const [THREE, room, schema] = await modules, defaults = schema.createState({worldNodeId: 'room', now: 1}).scenePlay.worldSpace.roomConfig;
  const config = {...defaults, ...patch, trackingGuides: {...defaults.trackingGuides, ...patch.trackingGuides}};
  return {THREE, room, config, root: room.createRoomScene({config, groundY})};
}
function close(actual, expected) {assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);}
function pixel(texture, x, y) {return Array.from(texture.image.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));}

test('room comprises real floor, ceiling and four inward facing walls at groundY, with actual geometry bounds', async () => {
  const f = await fixture({width: 8, depth: 14, height: 4}, -2.25), surfaces = f.root.children.filter(item => item.isMesh);
  assert.equal(surfaces.length, 6);assert.equal(surfaces.filter(item => item.name === 'mesh-preset-wall').length, 4);
  assert.equal(surfaces[0].position.y, -2.25);assert.equal(surfaces[1].position.y, 1.75);
  for (const mesh of surfaces) {
    assert.equal(mesh.geometry.type, 'PlaneGeometry');
    const normal = new f.THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion), center = new f.THREE.Vector3(0, -0.25, 0).sub(mesh.position);
    assert.ok(normal.dot(center) > 0);assert.equal(mesh.material.side, f.THREE.FrontSide);
  }
  const actual = new f.THREE.Box3().setFromObject(f.root, true), bounds = f.root.userData.bounds;
  for (const axis of ['x', 'y', 'z']) {close(actual.min[axis], bounds.min[axis]);close(actual.max[axis], bounds.max[axis]);}
  close(bounds.min.x, -4);close(bounds.max.x, 4);close(bounds.min.y, -2.25);close(bounds.max.y, 1.75);close(bounds.min.z, -7);close(bounds.max.z, 7);
  assert.deepEqual(f.root.userData.spaceSource, {kind: 'mesh-preset', preset: 'room'});assert.equal(f.root.userData.surfaceCount, 6);
  f.config.width = 99;assert.equal(f.root.userData.roomConfig.width, 8);
  f.room.disposeRoomScene(f.root);
});
test('standard and calibration 64px RGBA textures match official checker/markers and physical spacing', async () => {
  const f = await fixture(), map = f.root.children[0].material.map;
  assert.equal(map.image.width, 64);assert.equal(map.image.height, 64);assert.equal(map.image.data.length, 64 * 64 * 4);
  assert.deepEqual(pixel(map, 0, 0), [112, 112, 112, 255]);assert.deepEqual(pixel(map, 40, 0), [255, 255, 255, 255]);
  assert.equal(map.repeat.x, 5);assert.equal(map.repeat.y, 12);assert.equal(map.anisotropy, 8);assert.equal(map.colorSpace, f.THREE.SRGBColorSpace);
  assert.equal(map.wrapS, f.THREE.RepeatWrapping);assert.equal(map.wrapT, f.THREE.RepeatWrapping);assert.equal(map.generateMipmaps, true);
  assert.equal(map.magFilter, f.THREE.NearestFilter);assert.equal(map.minFilter, f.THREE.LinearMipmapLinearFilter);
  const c = await fixture({trackingGuides: {mode: 'calibration', spacingMeters: 2}}), calibration = c.root.children[0].material.map;
  assert.deepEqual(pixel(calibration, 0, 0), [95, 95, 95, 255]);assert.deepEqual(pixel(calibration, 9, 9), [255, 255, 255, 255]);
  assert.deepEqual(pixel(calibration, 32 + 6, 6), [95, 95, 95, 255]);assert.deepEqual(pixel(calibration, 32, 0), [255, 255, 255, 255]);
  assert.equal(calibration.repeat.x, 1.25);assert.equal(calibration.repeat.y, 3);
  f.room.disposeRoomScene(f.root);c.room.disposeRoomScene(c.root);
});
test('white mode suppresses textures and guides; disabled standard is the official grey material', async () => {
  const white = await fixture({trackingGuides: {mode: 'white', lineMarkers: true}}), disabled = await fixture({trackingGuides: {enabled: false, lineMarkers: true}});
  for (const mesh of white.root.children) {assert.equal(mesh.material.map, null);assert.equal(mesh.material.color.getHex(), 0xffffff);assert.equal(mesh.material.roughness, 0.82);}
  assert.equal(white.root.children.length, 6);assert.equal(disabled.root.children.length, 6);
  for (const mesh of disabled.root.children) {assert.equal(mesh.material.map, null);assert.equal(mesh.material.color.getHex(), 7895160);assert.equal(mesh.material.roughness, 0.9);}
  white.room.disposeRoomScene(white.root);disabled.room.disposeRoomScene(disabled.root);
});
test('line markers are real x/y/z cylinders and instanced meshes, kept separate from room bounds', async () => {
  const f = await fixture({trackingGuides: {lineMarkers: true}}, 7), guides = f.root.children.at(-1), edges = guides.children[0], lines = guides.children[1];
  assert.equal(guides.name, 'mesh-preset-tracking-guides');assert.equal(edges.children.length, 12);assert.equal(lines.children.length, 3);
  for (const [index, mesh] of lines.children.entries()) {assert.ok(mesh.isInstancedMesh);assert.ok(mesh.count > 0);assert.equal(mesh.userData.meshPresetGuideAxis, ['x', 'y', 'z'][index]);assert.equal(mesh.geometry.type, 'CylinderGeometry');assert.equal(mesh.material.depthWrite, false);}
  const expectedBounds = f.root.userData.bounds.clone(), external = new f.THREE.CameraHelper(new f.THREE.PerspectiveCamera());external.position.set(500, 500, 500);f.root.add(external);f.root.updateMatrixWorld(true);
  assert.deepEqual(f.root.userData.bounds, expectedBounds);close(expectedBounds.min.y, 7);close(expectedBounds.max.y, 10.2);
  external.dispose();f.room.disposeRoomScene(f.root);
});
test('room disposal releases only owned assets once and preserves external geometry/material/texture', async () => {
  const f = await fixture({trackingGuides: {lineMarkers: true}}), owned = new Set();
  f.root.traverse(object => {if (!object.isMesh) return;owned.add(object.geometry);owned.add(object.material);if (object.material.map) owned.add(object.material.map);if (object.isInstancedMesh) owned.add(object);});
  const counts = new Map();for (const resource of owned) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1));
  const texture = new f.THREE.Texture(), material = new f.THREE.MeshBasicMaterial({map: texture}), geometry = new f.THREE.BoxGeometry(), external = new f.THREE.Mesh(geometry, material);let externalDisposals = 0;
  for (const resource of [texture, material, geometry]) resource.addEventListener('dispose', () => externalDisposals++);
  f.root.add(external);assert.equal(f.room.disposeRoomScene(f.root), true);assert.equal(f.room.disposeRoomScene(f.root), false);
  assert.equal(f.root.userData.disposed, true);assert.equal(externalDisposals, 0);assert.equal(external.parent, f.root);
  for (const resource of owned) assert.equal(counts.get(resource), 1);
  assert.equal(f.room.disposeRoomScene(new f.THREE.Group()), false);texture.dispose();material.dispose();geometry.dispose();
});
test('invalid room config and ground values fail before allocating a room', async () => {
  const [, room, schema] = await modules, config = schema.createState({worldNodeId: 'room', now: 1}).scenePlay.worldSpace.roomConfig;
  for (const patch of [{width: 0}, {depth: 101}, {height: 1.9}, {height: 21}, {width: NaN}, {trackingGuides: {...config.trackingGuides, spacingMeters: 0.3}}, {trackingGuides: {...config.trackingGuides, mode: 'fake'}}]) assert.throws(() => room.createRoomScene({config: {...config, ...patch}}));
  assert.throws(() => room.createRoomScene({config, groundY: Infinity}), /finite/);
});
