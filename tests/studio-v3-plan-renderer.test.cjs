const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/plan-renderer.mjs')]);
function rendererFixture(THREE) {
  let target = {id: 'leased-target'}, color = new THREE.Color('#aabbcc'), alpha = .3, viewport = new THREE.Vector4(2, 3, 80, 90), scissor = viewport.clone(), scissorTest = true, disposed = 0;
  const renderer = {autoClear: false, getRenderTarget: () => target, setRenderTarget: value => {target = value;},
    getClearColor: value => value.copy(color), getClearAlpha: () => alpha, setClearColor(value, opacity) {color = new THREE.Color(value); alpha = opacity;},
    getViewport: value => value.copy(viewport), setViewport(...value) {viewport = value[0]?.isVector4 ? value[0].clone() : new THREE.Vector4(...value);},
    getScissor: value => value.copy(scissor), setScissor(...value) {scissor = value[0]?.isVector4 ? value[0].clone() : new THREE.Vector4(...value);},
    getScissorTest: () => scissorTest, setScissorTest: value => {scissorTest = value;}, render() {}, dispose() {disposed++;}};
  return {renderer, read: () => ({target, color: color.getHexString(), alpha, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest, autoClear: renderer.autoClear, disposed})};
}
test('plan profile release is idempotent and identity-safe', async () => {
  const [, {createPlanProfileRegistry}] = await modules, profiles = createPlanProfileRegistry(), first = {}, second = {};
  const releaseFirst = profiles.activate(first), releaseSecond = profiles.activate(second);
  assert.equal(releaseFirst(), false); assert.equal(profiles.read(), second); assert.equal(releaseFirst(), false);
  assert.equal(releaseSecond(), true); assert.equal(profiles.read(), null); assert.equal(releaseSecond(), false);
});
test('plan bounds union actual world and visible entity geometry without editor-camera or infinite-ground inflation', async () => {
  const [THREE, {readPlanBounds}] = await modules;
  const sourceRoot = new THREE.Group(), actorRoot = new THREE.Group(), cameraRoot = new THREE.Group();
  sourceRoot.add(new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 12))); sourceRoot.position.y = 1.6;
  actorRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1))); actorRoot.position.set(8, 1, 0);
  cameraRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000)));
  const camera = new THREE.PerspectiveCamera(); camera.position.set(-6, 1.6, 0);
  const graph = {source: {status: 'ready', root: sourceRoot}, entities: new Map([
    ['actor', {status: 'ready', root: actorRoot, state: {visible: true}}],
    ['hidden', {status: 'ready', root: cameraRoot, state: {visible: false}}],
    ['camera', {status: 'ready', root: cameraRoot, camera, state: {visible: true}}]])};
  const bounds = readPlanBounds(graph); assert.equal(bounds.min.x, -6); assert.equal(bounds.max.x, 8.5);
  assert(Math.abs(bounds.max.y - 3.2) < 1e-6); assert.equal(bounds.min.z, -6); assert.equal(bounds.max.z, 6);
  assert.equal(readPlanBounds({worldRoot: new THREE.Group(), entities: new Map()}), null);
});
test('plan render restores background, helpers, Spark, target, clear, masks and viewport on success and failure', async () => {
  const [THREE, {createPlanRenderer}] = await modules, fixture = rendererFixture(THREE), {renderer} = fixture;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#15171b'); const background = scene.background;
  const material = new THREE.MeshBasicMaterial(); scene.overrideMaterial = material;
  const actor = new THREE.Mesh(new THREE.BoxGeometry()), helper = new THREE.Group(), cameraGlyph = new THREE.Group(), alreadyHidden = new THREE.Group();
  helper.userData.helper = true; cameraGlyph.userData.entityKind = 'camera'; alreadyHidden.userData.captureExcluded = true; alreadyHidden.visible = false; scene.add(actor, helper, cameraGlyph, alreadyHidden);
  const spark = {apertureAngle: .04, focalDistance: 7}, splat = new THREE.Group(); splat.frustumCulled = true;
  const camera = new THREE.OrthographicCamera(); for (const layer of [3, 4, 5, 6, 7]) camera.layers.enable(layer); const mask = camera.layers.mask, original = fixture.read();
  let throwing = false;
  const plan = createPlanRenderer({renderer, scene, camera, getSpark: () => spark, getSparkRoots: () => [splat], renderFrame(view, draw) {draw();}});
  renderer.render = (_scene, view) => {
    assert.equal(scene.background, null); assert.equal(scene.overrideMaterial, null); assert.equal(helper.visible, false); assert.equal(cameraGlyph.visible, false); assert.equal(actor.visible, true);
    assert.equal(spark.apertureAngle, 0); assert.equal(spark.focalDistance, 0); assert.equal(splat.frustumCulled, false);
    assert.equal(renderer.autoClear, true); assert.equal(renderer.getRenderTarget(), null); assert.equal(fixture.read().color, '030507'); assert.equal(fixture.read().alpha, 1);
    assert.equal(view.isOrthographicCamera, true); assert.equal(view.layers.mask, 17); if (throwing) throw Error('plan GPU failed');
  };
  const input = {bounds: {min: {x: -2.5, y: 0, z: -6}, max: {x: 2.5, y: 3.2, z: 6}}, width: 400, height: 300};
  const snapshot = plan.render(input); assert.equal(snapshot.sectionHeight, 1.6); assert.equal(snapshot.near, 48.4); snapshot.target.x = 500; assert.equal(plan.read().target.x, 0);
  assert.deepEqual(fixture.read(), original); assert.equal(camera.layers.mask, mask); assert.equal(scene.background, background); assert.equal(scene.overrideMaterial, material);
  assert.equal(helper.visible, true); assert.equal(cameraGlyph.visible, true); assert.equal(alreadyHidden.visible, false); assert.equal(splat.frustumCulled, true); assert.deepEqual(spark, {apertureAngle: .04, focalDistance: 7});
  throwing = true; assert.throws(() => plan.render({...input, zoom: 2}), /plan GPU failed/); assert.equal(plan.read(), null); assert.deepEqual(fixture.read(), original);
  throwing = false; plan.render(input); assert.throws(() => plan.render({...input, bounds: null}), /finite/); assert.equal(plan.read(), null);
  plan.dispose(); assert.equal(fixture.read().disposed, 0);
});
