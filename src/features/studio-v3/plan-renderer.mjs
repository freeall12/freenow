import * as THREE from 'three';
import {spatialBounds} from '../world-node/splat-io.mjs';
import {createPlanProjection} from './plan-projection.mjs';

const failure = (code, message) => Object.assign(Error(message), {code});
const finiteBounds = box => box && !box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite);
const plainBounds = box => ({min: {x: box.min.x, y: box.min.y, z: box.min.z}, max: {x: box.max.x, y: box.max.y, z: box.max.z}});

// A cleanup returned by an older profile must never release its replacement.
export function createPlanProfileRegistry() {
  let current = null;
  return {activate(profile) {current = profile; let released = false; return () => {if (released) return false; released = true; if (current !== profile) return false; current = null; return true;};}, read: () => current, clear() {current = null;}};
}

export function readPlanBounds(graph) {
  const union = new THREE.Box3();
  const source = graph?.source;
  const sceneBounds = graph?.sceneBounds;
  if (finiteBounds(sceneBounds)) union.copy(sceneBounds);
  else if (source?.status === 'ready' && source.root) {
    const bounds = spatialBounds(source.root);
    if (finiteBounds(bounds)) union.union(bounds);
  } else if (!source && graph?.worldRoot) {
    for (const root of graph.worldRoot.children) {
      root.updateWorldMatrix(true, true);
      const bounds = finiteBounds(root.userData.bounds) ? root.userData.bounds.clone().applyMatrix4(root.matrixWorld) : spatialBounds(root);
      if (finiteBounds(bounds)) union.union(bounds);
    }
  }
  for (const record of graph?.entities?.values() || []) {
    if (record.status !== 'ready' || !record.root || !record.state?.visible) continue;
    // Camera glyph/frustum geometry is editor content. Its actual optical
    // position contributes to framing without expanding to helper endpoints.
    if (record.camera) {record.camera.updateWorldMatrix(true, false); union.expandByPoint(record.camera.getWorldPosition(new THREE.Vector3()));}
    else {const bounds = spatialBounds(record.root); if (finiteBounds(bounds)) union.union(bounds);}
  }
  return finiteBounds(union) ? plainBounds(union) : null;
}

export function withPlanRenderState({renderer, scene, camera, spark = null, sparkRoots = [], outputTarget = null}, draw) {
  const saved = {background: scene.background, overrideMaterial: scene.overrideMaterial, target: renderer.getRenderTarget?.(), autoClear: renderer.autoClear,
    clearColor: renderer.getClearColor?.(new THREE.Color())?.clone(), clearAlpha: renderer.getClearAlpha?.(), mask: camera.layers.mask,
    viewport: renderer.getViewport?.(new THREE.Vector4())?.clone(), scissor: renderer.getScissor?.(new THREE.Vector4())?.clone(), scissorTest: renderer.getScissorTest?.(),
    apertureAngle: spark?.apertureAngle, focalDistance: spark?.focalDistance};
  const hidden = [], culling = [...new Set(sparkRoots.filter(Boolean))].map(root => [root, root.frustumCulled]);
  try {
    scene.traverse(object => {if (object !== scene && (object.userData.helper || object.userData.captureExcluded || object.userData.entityKind === 'camera')) {hidden.push([object, object.visible]); object.visible = false;}});
    scene.background = null; scene.overrideMaterial = null;
    renderer.setRenderTarget?.(outputTarget); renderer.setClearColor?.(0x030507, 1); renderer.autoClear = true;
    for (const layer of [3, 5, 6, 7]) camera.layers.disable(layer);
    if (spark) {spark.apertureAngle = 0; spark.focalDistance = 0;}
    for (const [root] of culling) root.frustumCulled = false;
    return draw();
  } finally {
    for (const [root, value] of culling) root.frustumCulled = value;
    for (const [object, visible] of hidden) object.visible = visible;
    if (spark) {spark.apertureAngle = saved.apertureAngle; spark.focalDistance = saved.focalDistance;}
    scene.background = saved.background; scene.overrideMaterial = saved.overrideMaterial; camera.layers.mask = saved.mask;
    renderer.autoClear = saved.autoClear; renderer.setRenderTarget?.(saved.target);
    if (saved.clearColor) renderer.setClearColor?.(saved.clearColor, saved.clearAlpha);
    if (saved.viewport) renderer.setViewport?.(saved.viewport);
    if (saved.scissor) renderer.setScissor?.(saved.scissor);
    if (saved.scissorTest !== undefined) renderer.setScissorTest?.(saved.scissorTest);
  }
}

export function createPlanRenderer({renderer, scene, camera = new THREE.OrthographicCamera(), getSpark = () => null, getSparkRoots = () => [], renderFrame} = {}) {
  if (!renderer || !scene || !camera.isOrthographicCamera) throw failure('studio_v3_plan_renderer_options', '俯视图需要独立正交摄像机和真实场景');
  let projection = null;
  function render({bounds, width, height, groundY = 0, pan = {x: 0, z: 0}, zoom = 1, rotation = 0, sectionHeight = 1.6}) {
    try {
      const next = createPlanProjection({bounds, width, height, groundY, pan, zoom, rotation, sectionHeight});
      camera.position.set(next.cameraPosition.x, next.cameraPosition.y, next.cameraPosition.z);
      camera.up.set(-next.down.x, -next.down.y, -next.down.z); camera.lookAt(next.target.x, next.target.y, next.target.z);
      camera.left = -next.halfWidth; camera.right = next.halfWidth; camera.top = next.halfHeight; camera.bottom = -next.halfHeight;
      camera.near = next.near; camera.far = next.far; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      withPlanRenderState({renderer, scene, camera, spark: getSpark(), sparkRoots: getSparkRoots()}, () => {
        renderer.setViewport?.(0, 0, next.width, next.height); renderer.setScissor?.(0, 0, next.width, next.height); renderer.setScissorTest?.(false);
        const draw = () => renderer.render(scene, camera);
        if (renderFrame) renderFrame(camera, draw); else draw();
      });
      // Consumers must use the displayed frame, never a navigation target.
      projection = structuredClone(next); return structuredClone(projection);
    } catch (error) {projection = null; throw error;}
  }
  return {camera, render, read: () => projection && structuredClone(projection), clear() {projection = null;}, dispose() {projection = null;}};
}
