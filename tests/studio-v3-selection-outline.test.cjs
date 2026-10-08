const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/selection-outline.mjs')]);
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
function fixture(THREE) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, .1, 100);
  const parent = new THREE.Group(), mesh = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), new THREE.MeshStandardMaterial()), line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  parent.add(mesh, line); scene.add(parent); return {scene, camera, parent, mesh, line};
}
function disposeAssets(root) {
  root.traverse(object => {object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose(); object.skeleton?.dispose();});
}
function rendererFixture({width = 1200, height = 800, pixelRatio = 2, render = () => {}} = {}) {
  let target = {name: 'previous-target'}; const previousTarget = target, calls = [];
  const renderer = {domElement: {width, height}, autoClear: true, getPixelRatio: () => pixelRatio,
    getRenderTarget: () => target, setRenderTarget(value) {calls.push(value); target = value;},
    render(scene, camera) {render(scene, camera, renderer);}};
  return {renderer, calls, previousTarget, get target() {return target;}};
}

test('silhouette shaders exactly retain official deformed screen-space inverted-hull source and material depth policy', async t => {
  const [THREE, {createSelectionOutline}] = await modules, f = fixture(THREE); t.after(() => disposeAssets(f.scene));
  const outline = createSelectionOutline({scene: f.scene, camera: f.camera}); t.after(() => outline.dispose());
  const material = outline.material;
  assert(material.isShaderMaterial); assert.equal(material.name, 'WorkspaceSelectionSilhouetteMaterial');
  // Hashes are the exact official Ia shader templates, extracted directly from
  // WorkspaceViewfinderButton-BHqIWibq.js. No installed app is needed to run CI.
  assert.equal(hash(material.vertexShader), 'd2c20089715c9ec2cb595a52c0d7009601e7f912fed36e3769b5a2451d7b2703');
  assert.equal(hash(material.fragmentShader), '8279d8c8648be0bfc7221eadf441d04e86d24a690ef993d96b80ade3fea7b8e4');
  // The installed local Three is newer than the official bundle: every
  // recursively referenced chunk must still exist before a browser compiles it.
  const chunks = new Set();
  function resolveChunks(source) {for (const match of source.matchAll(/#include <([\w]+)>/g)) {const name = match[1]; if (chunks.has(name)) continue; assert.equal(typeof THREE.ShaderChunk[name], 'string', `missing Three shader chunk: ${name}`); chunks.add(name); resolveChunks(THREE.ShaderChunk[name]);}}
  resolveChunks(material.vertexShader); resolveChunks(material.fragmentShader); assert.equal(chunks.size, 24);
  assert.equal(material.side, THREE.BackSide); assert.equal(material.blending, THREE.NoBlending); assert.equal(material.depthFunc, THREE.LessEqualDepth);
  assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false); assert.equal(material.clipping, true); assert.equal(material.toneMapped, false); assert.equal(material.transparent, false);
  assert(outline.uniforms.outlineColor.value.equals(new THREE.Color('#ff6b00')));
  assert.equal(outline.layer, 6); assert.equal(outline.edgeWidthCssPx, 3);
  const hover = createSelectionOutline({scene: f.scene, camera: f.camera, presentation: 'hover'}); t.after(() => hover.dispose());
  assert.equal(hover.layer, 7); assert.equal(hover.edgeWidthCssPx, 2); assert.notEqual(hover.material, material);
});

test('object membership adds only mesh layers, preserves materials and supports independent selection and hover', async t => {
  const [THREE, {createSelectionOutline}] = await modules, f = fixture(THREE); t.after(() => disposeAssets(f.scene));
  const selection = createSelectionOutline({scene: f.scene, camera: f.camera}), hover = createSelectionOutline({scene: f.scene, camera: f.camera, presentation: 'hover'});
  t.after(() => {selection.dispose(); hover.dispose();});
  const originalMaterial = f.mesh.material, originalGeometry = f.mesh.geometry;
  selection.setObjects([f.parent, f.parent]); hover.setObjects([f.parent]);
  assert.deepEqual(selection.selectedObjects, [f.parent]); assert.equal(f.mesh.layers.mask, 1 | 64 | 128); assert.equal(f.parent.layers.mask, 1); assert.equal(f.line.layers.mask, 1);
  assert.equal(f.mesh.material, originalMaterial); assert.equal(f.mesh.geometry, originalGeometry);
  const externalList = selection.selectedObjects; externalList.length = 0; assert.equal(selection.selectedObjects.length, 1);
  selection.setObjects([]); assert.equal(f.mesh.layers.mask, 1 | 128); assert.equal(hover.selectedObjects.length, 1);
  f.parent.visible = false; hover.setObjects([f.parent]); assert.equal(f.mesh.layers.mask, 1); assert.equal(hover.selectedObjects.length, 0);
  assert.throws(() => selection.setObjects([{}]), TypeError); assert.equal(selection.selectedObjects.length, 0);
  f.parent.visible = true; selection.setObjects([f.parent]); assert.equal(f.mesh.layers.mask, 1 | 64);
});

test('camera outline targets exclude frustum, while real skinned, morph and instanced entity meshes share the same pass', async t => {
  const [THREE, {createSelectionOutline}] = await modules, {createCameraMarker} = await import('../src/features/studio-v3/camera-marker.mjs');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), raw = new THREE.Group(); raw.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial())); t.after(() => disposeAssets(raw));
  const marker = createCameraMarker({assetRoot: raw, entityId: 'camera'}); scene.add(marker.root); t.after(() => marker.dispose());
  const actorRoot = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 2, 1), count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({length: count}, () => [1, 0, 0, 0]).flat(), 4));
  const actor = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()), bone = new THREE.Bone(); actor.add(bone); actor.bind(new THREE.Skeleton([bone])); actorRoot.add(actor); scene.add(actorRoot);
  const propRoot = new THREE.Group(), morphGeometry = new THREE.BoxGeometry(); morphGeometry.morphAttributes.position = [morphGeometry.attributes.position.clone()];
  const prop = new THREE.Mesh(morphGeometry, new THREE.MeshStandardMaterial()), instances = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2); propRoot.add(prop, instances); scene.add(propRoot);
  t.after(() => {disposeAssets(actorRoot); disposeAssets(propRoot);});
  const outline = createSelectionOutline({scene, camera}); t.after(() => outline.dispose());
  outline.setObjects([marker.outlineTarget, actorRoot, propRoot]);
  marker.iconRoot.traverse(object => {if (object.isMesh) assert.equal(object.layers.mask, 32 | 64);});
  marker.frustumRoot.traverse(object => assert.equal(object.layers.mask, 32));
  for (const mesh of [actor, prop, instances]) assert.equal(mesh.layers.mask, 1 | 64);
  assert(actor.isSkinnedMesh && actor.skeleton); assert(prop.morphTargetInfluences); assert(instances.isInstancedMesh);
  const render = rendererFixture({render(renderScene, renderCamera) {
    assert.equal(renderScene, scene); assert.equal(renderCamera, camera); assert.equal(renderScene.overrideMaterial, outline.material);
    for (const mesh of [actor, prop, instances]) assert(renderCamera.layers.test(mesh.layers));
    for (const line of marker.frustumRoot.children) assert.equal(renderCamera.layers.test(line.layers), false);
  }});
  assert.equal(outline.render({renderer: render.renderer}), true);
});

test('outline borrows the current depth buffer, sizes canvas and output target pixels correctly and restores render state', async t => {
  const [THREE, {createSelectionOutline}] = await modules, f = fixture(THREE); t.after(() => disposeAssets(f.scene));
  const background = new THREE.Color('#123456'), override = new THREE.MeshBasicMaterial(); t.after(() => override.dispose()); f.scene.background = background; f.scene.overrideMaterial = override;
  f.camera.layers.enable(4); f.camera.layers.enable(5); const mask = f.camera.layers.mask;
  const outline = createSelectionOutline({scene: f.scene, camera: f.camera}); t.after(() => outline.dispose()); outline.setObjects([f.parent]);
  let draws = 0;
  const r = rendererFixture({render(scene, camera, renderer) {draws++; assert.equal(renderer.autoClear, false); assert.equal(scene.background, null); assert.equal(scene.overrideMaterial, outline.material); assert.equal(camera.layers.mask, 64);}});
  assert.equal(outline.render({renderer: r.renderer}), true); assert.equal(draws, 1);
  assert.deepEqual(outline.uniforms.resolution.value.toArray(), [1200, 800]); assert.equal(outline.uniforms.thicknessPx.value, 6);
  assert.deepEqual(r.calls, [null, r.previousTarget]); assert.equal(r.renderer.autoClear, true); assert.equal(r.target, r.previousTarget);
  assert.equal(f.scene.background, background); assert.equal(f.scene.overrideMaterial, override); assert.equal(f.camera.layers.mask, mask);
  const target = new THREE.WebGLRenderTarget(640, 360); t.after(() => target.dispose());
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1); ortho.layers.enable(5); const orthoMask = ortho.layers.mask;
  outline.render({renderer: r.renderer, outputTarget: target, camera: ortho});
  assert.deepEqual(outline.uniforms.resolution.value.toArray(), [640, 360]); assert.equal(outline.uniforms.thicknessPx.value, 3);
  assert.equal(ortho.layers.mask, orthoMask); assert.equal(outline.camera, ortho); assert.equal(f.camera.layers.mask, mask);
  assert.equal(r.calls[2], target); assert.equal(r.calls[3], r.previousTarget);
});

test('renderer failures restore all borrowed state, and disposal releases only the silhouette material once', async t => {
  const [THREE, {createSelectionOutline}] = await modules, f = fixture(THREE); t.after(() => disposeAssets(f.scene));
  const outline = createSelectionOutline({scene: f.scene, camera: f.camera}), hover = createSelectionOutline({scene: f.scene, camera: f.camera, presentation: 'hover'}); t.after(() => hover.dispose());
  const originalMask = f.camera.layers.mask, originalMaterial = f.mesh.material, originalGeometry = f.mesh.geometry;
  const background = new THREE.Color('#222'); f.scene.background = background;
  let outlineDisposed = 0, geometryDisposed = 0, assetMaterialDisposed = 0;
  outline.material.addEventListener('dispose', () => outlineDisposed++); originalGeometry.addEventListener('dispose', () => geometryDisposed++); originalMaterial.addEventListener('dispose', () => assetMaterialDisposed++);
  const r = rendererFixture({render() {throw Error('render failed');}});
  assert.equal(outline.render({renderer: r.renderer}), false); assert.equal(r.calls.length, 0);
  outline.setObjects([f.parent]); hover.setObjects([f.parent]);
  assert.throws(() => outline.render({renderer: r.renderer}), /render failed/);
  assert.equal(f.camera.layers.mask, originalMask); assert.equal(f.scene.background, background); assert.equal(f.scene.overrideMaterial, null); assert.equal(r.renderer.autoClear, true); assert.equal(r.target, r.previousTarget);
  outline.dispose(); outline.dispose();
  assert.equal(outlineDisposed, 1); assert.equal(geometryDisposed, 0); assert.equal(assetMaterialDisposed, 0); assert.equal(f.mesh.layers.mask, 1 | 128);
  assert.equal(outline.selectedObjects.length, 0); assert.equal(outline.render({renderer: r.renderer}), false); assert.equal(outline.setObjects([f.parent]), false);
});
