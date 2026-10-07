const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/camera-marker.mjs')]);
const near = (actual, expected, epsilon = 1e-7) => assert(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
function lines(marker) {return marker.frustumRoot.children;}
function bodyMeshes(marker) {const meshes = []; marker.iconRoot.traverse(object => {if (object.isMesh) meshes.push(object);}); return meshes;}
function segments(line) {
  const start = line.geometry.getAttribute('instanceStart'), end = line.geometry.getAttribute('instanceEnd');
  return Array.from({length: start.count}, (_, i) => [[start.getX(i), start.getY(i), start.getZ(i)], [end.getX(i), end.getY(i), end.getZ(i)]]);
}
function simpleAsset(THREE) {
  const asset = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), new THREE.MeshBasicMaterial({color: 'red'}));
  mesh.position.set(8, 5, -3); asset.add(mesh); return asset;
}
function disposeRaw(root) {root.traverse(object => {object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose();});}

test('official camera GLB retains caller resources and fits its normalized body behind the optical origin', async t => {
  const [THREE, {createCameraMarker}] = await modules, {decodeGlb} = await import('../src/features/studio-v3/asset-loader.mjs');
  const previous = {self: global.self, createImageBitmap: global.createImageBitmap, ProgressEvent: global.ProgressEvent};
  global.self = global;
  global.ProgressEvent = class extends Event {constructor(type, fields) {super(type); Object.assign(this, fields);}};
  // Decode embedded PNG dimensions only. This is real GLB geometry validation,
  // not a GPU render or verification of the PNG texture's visual appearance.
  global.createImageBitmap = async blob => {const view = new DataView(await blob.arrayBuffer()); return {width: view.getUint32(16), height: view.getUint32(20), close() {}};};
  t.after(() => {for (const [key, value] of Object.entries(previous)) if (value === undefined) delete global[key]; else global[key] = value;});
  const bytes = fs.readFileSync(require.resolve('../assets/studio/camera.glb'));
  assert.equal(bytes.length, 14948);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '00f5a46007aee91cf8a9accd2584ad83b7dc3ce2396c1dd325ff61c3304004e7');
  const asset = await decodeGlb(new Blob([bytes])); t.after(() => asset.dispose());
  const owner = new THREE.Group(); owner.add(asset.root);
  const originalMaterials = [], originalGeometry = []; asset.root.traverse(object => {if (object.isMesh) {originalMaterials.push(object.material); originalGeometry.push(object.geometry);}});
  const marker = createCameraMarker({assetRoot: asset.root, entityId: 'official-camera'}); t.after(() => marker.dispose());
  assert.equal(asset.root.parent, owner);
  assert.equal(marker.root.name, 'director-camera:official-camera');
  assert.deepEqual(marker.root.children.map(child => child.name), ['director-camera-frustum', 'director-camera-body']);
  assert.equal(marker.transformRoot, marker.root); assert.equal(marker.transformPivot, marker.bodyRoot);
  assert.equal(marker.pickTarget, marker.iconRoot); assert.equal(marker.outlineTarget, marker.iconRoot);
  assert.equal(marker.iconRoot.children[0].name, 'director-camera-icon-normalized'); near(marker.iconRoot.rotation.y, Math.PI / 2);
  const bounds = new THREE.Box3().setFromObject(marker.iconRoot), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  near(Math.max(size.x, size.y, size.z), .25); near(center.x, 0); near(center.y, 0); near(center.z, .13);
  assert(bounds.min.z > 0, 'body must be behind the local -Z optical direction');
  for (const [index, mesh] of bodyMeshes(marker).entries()) {
    assert.equal(mesh.geometry, originalGeometry[index]); assert.notEqual(mesh.material, originalMaterials[index]);
    assert(mesh.material.isMeshStandardMaterial); assert.equal(mesh.material.map, null); assert.equal(mesh.material.side, THREE.DoubleSide);
    near(mesh.material.metalness, .06); near(mesh.material.roughness, .78); near(mesh.material.envMapIntensity, .18);
    assert(mesh.material.depthTest && mesh.material.depthWrite && mesh.material.toneMapped); assert.equal(mesh.frustumCulled, false); assert.equal(mesh.renderOrder, 22);
  }
  assert.equal(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)).intersectObject(marker.pickTarget, true).length, 0);
  marker.root.traverse(object => {assert.equal(object.layers.mask, 32); assert.equal(object.userData.helper, true); assert.equal(object.userData.captureExcluded, true);});
  assert.equal(marker.root.userData.entityId, 'official-camera');
});

test('short optical frustum has eight complete edges, capped dimensions and two ordered screen-space strokes', async t => {
  const [THREE, {createCameraMarker}] = await modules, assetRoot = simpleAsset(THREE); t.after(() => disposeRaw(assetRoot));
  const marker = createCameraMarker({assetRoot, entityId: 'optics'}); t.after(() => marker.dispose());
  const [outline, stroke] = lines(marker);
  assert(outline.isLineSegments2 && stroke.isLineSegments2); assert(outline.material.isLineMaterial && stroke.material.isLineMaterial);
  assert.deepEqual([outline.renderOrder, stroke.renderOrder], [20, 21]);
  assert.notEqual(outline.geometry, stroke.geometry); assert.notEqual(outline.material, stroke.material);
  for (const line of lines(marker)) assert(line.material.depthTest && line.material.depthWrite && !line.material.toneMapped && !line.frustumCulled);
  const landscape = segments(stroke); assert.equal(landscape.length, 8); assert.deepEqual(landscape, segments(outline));
  assert.equal(new Set(landscape.map(edge => JSON.stringify(edge))).size, 8);
  for (const endpoint of landscape.slice(0, 4).flat()) {near(Math.abs(endpoint[0]), .07125); near(Math.abs(endpoint[1]), .04125); near(endpoint[2], -.18);}
  for (const [start] of landscape.slice(4)) assert.deepEqual(start, [0, 0, 0]);
  marker.update({camera: {fov: 50, frameAspectRatio: 9 / 16}});
  for (const endpoint of segments(stroke).slice(0, 4).flat()) {near(Math.abs(endpoint[0]), .023203125); near(Math.abs(endpoint[1]), .04125);}
  marker.update({camera: {fov: 10, frameAspectRatio: 16 / 9}});
  // An independently calculated 10-degree optical cross-section at 18 cm.
  for (const endpoint of segments(stroke).slice(0, 4).flat()) {near(Math.abs(endpoint[0]), .0279963723); near(Math.abs(endpoint[1]), .0157479594);}
  const renderer = {getViewport(target) {target.set(10, 20, 960, 540);}, getPixelRatio() {return 2;}};
  outline.onBeforeRender(renderer); stroke.onBeforeRender(renderer);
  assert.deepEqual(outline.material.resolution.toArray(), [960, 540]); near(outline.material.linewidth, 3.4); near(stroke.material.linewidth, 1.8);
  marker.update({selected: true}); outline.onBeforeRender(renderer); stroke.onBeforeRender(renderer);
  near(outline.material.linewidth, 4.8); near(stroke.material.linewidth, 2.1);
});

test('selected outline preserves body accent, deselection darkens in linear color and visibility stays separate', async t => {
  const [THREE, {createCameraMarker}] = await modules, assetRoot = simpleAsset(THREE); t.after(() => disposeRaw(assetRoot));
  const marker = createCameraMarker({assetRoot, entityId: 'color', color: '#3388cc', selected: true}); t.after(() => marker.dispose());
  const [outline, stroke] = lines(marker), expected = new THREE.Color('#3388cc');
  assert(outline.material.color.equals(new THREE.Color(16739072))); assert(stroke.material.color.equals(expected));
  assert(bodyMeshes(marker).every(mesh => mesh.material.color.equals(expected)));
  marker.update({color: '#cc8844', selected: true, visible: false});
  assert.equal(marker.root.visible, false); assert(outline.material.color.equals(new THREE.Color(16739072)));
  assert(bodyMeshes(marker).every(mesh => mesh.material.color.equals(new THREE.Color('#cc8844'))));
  marker.update({selected: false, visible: true});
  assert.equal(marker.root.visible, true); assert(outline.material.color.equals(new THREE.Color('#cc8844').multiplyScalar(.58)));
  assert(stroke.material.color.equals(new THREE.Color('#cc8844'))); near(outline.material.linewidth, 1.7); near(stroke.material.linewidth, .9);
  marker.update({color: null}); assert(stroke.material.color.equals(new THREE.Color(15399156)));
  marker.root.traverse(object => assert.equal(object.layers.mask, 32));
});

test('optical pose owns unit root scale, pivot rotates with body offset and preview avoids overwriting the live transform', async t => {
  const [THREE, {createCameraMarker}] = await modules, assetRoot = simpleAsset(THREE); t.after(() => disposeRaw(assetRoot));
  const marker = createCameraMarker({assetRoot, entityId: 'pose'}); t.after(() => marker.dispose());
  marker.update({camera: {camera: {position: {x: 1, y: 2, z: 3}, rotation: {x: 0, y: Math.PI / 2, z: 0, order: 'YXZ'}}, transform: {position: {x: 9, y: 9, z: 9}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 50, y: 50, z: 50}}}});
  assert.deepEqual(marker.root.position.toArray(), [1, 2, 3]); assert.deepEqual(marker.root.scale.toArray(), [1, 1, 1]);
  const pivot = marker.transformPivot.getWorldPosition(new THREE.Vector3()); near(pivot.x, 1.13); near(pivot.y, 2); near(pivot.z, 3);
  assert(marker.root.matrixWorld.elements.every(Number.isFinite)); assert(marker.transformPivot.matrixWorld.elements.every(Number.isFinite));
  marker.root.position.set(7, 8, 9); marker.root.rotation.set(.2, .3, .4);
  const previewQuaternion = marker.root.quaternion.clone();
  marker.update({camera: {position: {x: -1, y: -2, z: -3}, rotation: {x: 0, y: 0, z: 0}, frameAspectRatio: 1}, selected: true, transformPreviewActive: true});
  assert.deepEqual(marker.root.position.toArray(), [7, 8, 9]); assert(marker.root.quaternion.equals(previewQuaternion));
  marker.update({camera: {transform: {position: {x: 4, y: 5, z: 6}, rotation: {x: 0, y: Math.PI / 2, z: 0, order: 'XYZ'}}}});
  assert.deepEqual(marker.root.position.toArray(), [4, 5, 6]); near(marker.root.rotation.y, -Math.PI / 2);
  const matrixBefore = marker.root.matrixWorld.toArray(), geometryBefore = segments(lines(marker)[0]);
  for (const camera of [{position: {x: NaN, y: 0, z: 0}}, {rotation: {x: 0, y: Infinity, z: 0}}, {fov: NaN}, {frameAspectRatio: 0}]) assert.throws(() => marker.update({camera}), TypeError);
  assert.deepEqual(marker.root.matrixWorld.toArray(), matrixBefore); assert.deepEqual(segments(lines(marker)[0]), geometryBefore);
});

test('disposal is idempotent and construction failure cleans only helper-owned allocations', async t => {
  const [THREE, {createCameraMarker}] = await modules, assetRoot = simpleAsset(THREE); t.after(() => disposeRaw(assetRoot));
  const marker = createCameraMarker({assetRoot, entityId: 'lifecycle'}), scene = new THREE.Scene(); scene.add(marker.root);
  let originalGeometryDisposals = 0, originalMaterialDisposals = 0, ownMaterialDisposals = 0, ownGeometryDisposals = 0;
  assetRoot.children[0].geometry.addEventListener('dispose', () => originalGeometryDisposals++); assetRoot.children[0].material.addEventListener('dispose', () => originalMaterialDisposals++);
  for (const line of lines(marker)) {line.material.addEventListener('dispose', () => ownMaterialDisposals++); line.geometry.addEventListener('dispose', () => ownGeometryDisposals++);}
  for (const mesh of bodyMeshes(marker)) mesh.material.addEventListener('dispose', () => ownMaterialDisposals++);
  marker.dispose(); marker.dispose();
  assert.equal(marker.root.parent, null); assert.equal(marker.root.children.length, 0); assert.equal(marker.iconRoot.children.length, 0);
  assert.equal(ownMaterialDisposals, 3); assert.equal(ownGeometryDisposals, 2); assert.equal(originalMaterialDisposals, 0); assert.equal(originalGeometryDisposals, 0); assert.equal(marker.update({selected: true}), false);
  const {LineMaterial} = await import('three/addons/lines/LineMaterial.js'), {LineSegmentsGeometry} = await import('three/addons/lines/LineSegmentsGeometry.js');
  const materialDispose = THREE.Material.prototype.dispose, geometryDispose = LineSegmentsGeometry.prototype.dispose;
  let failedLineMaterials = 0, failedBodyMaterials = 0, failedLineGeometries = 0;
  THREE.Material.prototype.dispose = function () {if (this instanceof LineMaterial) failedLineMaterials++; else if (this.isMeshStandardMaterial) failedBodyMaterials++; return materialDispose.call(this);};
  LineSegmentsGeometry.prototype.dispose = function () {failedLineGeometries++; return geometryDispose.call(this);};
  t.after(() => {THREE.Material.prototype.dispose = materialDispose; LineSegmentsGeometry.prototype.dispose = geometryDispose;});
  const broken = simpleAsset(THREE); t.after(() => disposeRaw(broken));
  broken.clone = () => {const clone = simpleAsset(THREE); clone.children[0].geometry.dispose(); clone.children[0].material.dispose(); clone.children[0].geometry = broken.children[0].geometry; Object.defineProperty(clone.children[0], 'material', {get() {return broken.children[0].material;}, set() {throw Error('replacement rejected');}}); return clone;};
  assert.throws(() => createCameraMarker({assetRoot: broken, entityId: 'failure'}), /replacement rejected/);
  assert.equal(failedLineMaterials, 2); assert.equal(failedBodyMaterials, 1); assert.equal(failedLineGeometries, 2);
});
