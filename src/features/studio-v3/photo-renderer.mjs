import * as THREE from 'three';
import {assertJson, same} from './invariants.mjs';
import {cameraOpticsPatch, sparkDepthOfField} from './camera-optics.mjs';

export const PHOTO_RENDER_PROFILE = Object.freeze({longEdge: 4096, mimeType: 'image/jpeg', quality: .92,
  editorEntitiesLayer: 5, editorOverlayLayer: 3, groundLayer: 4, outlineLayers: [6, 7]});
const reservations = new WeakMap();
const error = (code, message) => Object.assign(new Error(message), {code});
export function photoDimensions(aspectRatio, longEdge = PHOTO_RENDER_PROFILE.longEdge) {
  if (!Number.isInteger(longEdge) || longEdge < 1 || longEdge > PHOTO_RENDER_PROFILE.longEdge) throw new TypeError('Photo longEdge must be an integer from 1 to 4096');
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.5, edge = longEdge;
  return ratio >= 1 ? {width: edge, height: Math.max(1, Math.round(edge / ratio))} : {width: Math.max(1, Math.round(edge * ratio)), height: edge};
}
export function flipPhotoPixels(pixels, width, height) {
  if (!(pixels instanceof Uint8Array) || !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || pixels.length !== width * height * 4) throw new TypeError('Photo pixels require a complete RGBA8 frame');
  const flipped = new Uint8Array(pixels.length), rowSize = width * 4;
  for (let row = 0; row < height; row++) flipped.set(pixels.subarray((height - row - 1) * rowSize, (height - row) * rowSize), row * rowSize);
  return flipped;
}
const defaultTarget = (width, height) => new THREE.WebGLRenderTarget(width, height, {depthBuffer: true, stencilBuffer: false, format: THREE.RGBAFormat, type: THREE.UnsignedByteType});
const defaultCanvas = () => globalThis.document?.createElement('canvas');
function restoreAll(callbacks) {
  const failures = [];
  for (const callback of callbacks.reverse()) try {callback();} catch (failure) {failures.push(failure);}
  if (failures.length) throw new AggregateError(failures, 'Photo render state restoration failed');
}

/** Independent offscreen renderer. Host owns the renderer lease and Spark/LOD settling. */
export function createPhotoRenderer({renderer, scene, getFence = () => null, isCurrent = () => true,
  settle = async () => {}, getSpark = () => null, getHelperRoots = () => [],
  renderFrame = ({draw}) => draw(), createCanvas = defaultCanvas, createRenderTarget = defaultTarget} = {}) {
  if (!renderer || !scene?.isScene || typeof renderer.render !== 'function' || typeof renderer.getRenderTarget !== 'function') throw new TypeError('Photo renderer requires an existing renderer and Three Scene');
  for (const callback of [getFence, isCurrent, settle, getSpark, getHelperRoots, renderFrame, createCanvas, createRenderTarget]) if (typeof callback !== 'function') throw new TypeError('Photo renderer adapters must be functions');
  let disposed = false, active = null;
  function check(task) {
    if (disposed || active !== task || !isCurrent() || !same(task.fence, getFence())) throw error('studio_v3_photo_stale', 'Photo renderer ownership or scene changed');
  }
  async function wait(task, operation) {check(task); const result = await operation(); check(task); return result;}
  function snapshotRenderer() {
    const target = renderer.getRenderTarget(), cube = renderer.getActiveCubeFace?.() || 0, mip = renderer.getActiveMipmapLevel?.() || 0;
    const viewport = renderer.getViewport(new THREE.Vector4()).clone(), scissor = renderer.getScissor(new THREE.Vector4()).clone(), scissorTest = renderer.getScissorTest();
    const pixelRatio = renderer.getPixelRatio(), size = renderer.getSize?.(new THREE.Vector2()).clone();
    const autoClear = renderer.autoClear, toneMapping = renderer.toneMapping, exposure = renderer.toneMappingExposure, colorSpace = renderer.outputColorSpace;
    const clearColor = renderer.getClearColor?.(new THREE.Color()).clone(), clearAlpha = renderer.getClearAlpha?.();
    return () => restoreAll([
      () => renderer.setScissorTest(scissorTest), () => renderer.setScissor(scissor), () => renderer.setViewport(viewport),
      () => renderer.setRenderTarget(target, cube, mip),
      () => {if (size && !renderer.getSize(new THREE.Vector2()).equals(size)) renderer.setSize(size.x, size.y, false);},
      () => {if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);},
      () => {renderer.autoClear = autoClear; renderer.toneMapping = toneMapping; renderer.toneMappingExposure = exposure; renderer.outputColorSpace = colorSpace;},
      () => {if (clearColor) renderer.setClearColor(clearColor, clearAlpha);}
    ]);
  }
  function renderPixels(task, camera, target, optics, focusOptions) {
    check(task);
    const restorers = [snapshotRenderer()], background = scene.background, overrideMaterial = scene.overrideMaterial;
    restorers.push(() => {scene.background = background; scene.overrideMaterial = overrideMaterial;});
    try {
      const spark = getSpark(), hidden = new Set(), helperRoots = new Set(getHelperRoots() || []);
      scene.traverse(node => {
        // Layer 4 is an explicit ground-reference pass, including its own helpers.
        const ground = node.layers.mask === 1 << PHOTO_RENDER_PROFILE.groundLayer || node.userData.photoGroundReference === true;
        if (node.visible && (helperRoots.has(node) || !ground && (node.userData.helper || node.userData.captureExcluded))) hidden.add(node);
      });
      for (const root of helperRoots) if (root?.visible) hidden.add(root);
      for (const node of hidden) node.visible = false;
      restorers.push(() => {for (const node of hidden) node.visible = true;});
      if (spark) {
        const previous = {target: spark.target, width: spark.renderSize?.x, height: spark.renderSize?.y, encodeLinear: spark.encodeLinear,
          focalDistance: spark.focalDistance, apertureAngle: spark.apertureAngle, visible: spark.visible};
        restorers.push(() => {spark.target = previous.target; spark.renderSize?.set(previous.width, previous.height); spark.encodeLinear = previous.encodeLinear;
          spark.focalDistance = previous.focalDistance; spark.apertureAngle = previous.apertureAngle; spark.visible = previous.visible;});
        spark.target = target; spark.renderSize?.set(target.width, target.height); spark.encodeLinear = true;
        const depth = sparkDepthOfField({...optics, fov: camera.fov}, {camera, ...focusOptions}); spark.focalDistance = depth.focalDistance; spark.apertureAngle = depth.apertureAngle;
      }
      target.viewport.set(0, 0, target.width, target.height); target.scissor.copy(target.viewport); target.scissorTest = false;
      // setRenderTarget uses target's physical viewport, independent of screen DPR.
      renderer.setViewport(0, 0, target.width, target.height); renderer.setScissor(0, 0, target.width, target.height); renderer.setScissorTest(false);
      const mask = camera.layers.mask; let drawCount = 0;
      const draw = () => {
        if (++drawCount > 1) throw error('studio_v3_photo_render_rejected', 'Photographic draw must run exactly once');
        check(task); renderer.setRenderTarget(target); renderer.autoClear = true;
        camera.layers.mask = mask;
        for (const layer of [3, 4, 5, 6, 7]) camera.layers.disable(layer);
        scene.overrideMaterial = overrideMaterial; renderer.render(scene, camera);
        check(task); renderer.autoClear = false; scene.background = null; scene.overrideMaterial = null;
        camera.layers.set(PHOTO_RENDER_PROFILE.groundLayer); if (spark) spark.visible = false;
        renderer.setRenderTarget(target); renderer.render(scene, camera);
        camera.layers.mask = mask; scene.background = background; scene.overrideMaterial = overrideMaterial;
        return true;
      };
      const accepted = renderFrame({camera, target, profile: 'photographic', draw, signal: task.abort.signal, fence: structuredClone(task.fence)});
      if (accepted !== true || drawCount !== 1) throw error('studio_v3_photo_render_rejected', 'Photographic renderFrame must draw exactly once, finish synchronously and return true');
      check(task);
      const pixels = new Uint8Array(target.width * target.height * 4);
      const read = () => renderer.readRenderTargetPixelsAsync ? renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, pixels)
        : renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      // Three starts framebuffer/PBO work before its first await. Restore shared
      // state after that dispatch, while keeping the target until GPU completion.
      task.readback = Promise.resolve(read()); task.readback.catch(() => {});
      return {pixels};
    } finally {restoreAll(restorers);}
  }
  async function run(args, encode) {
    if (disposed) throw error('studio_v3_photo_disposed', 'Photo renderer is disposed');
    if (active || reservations.has(renderer)) throw error('studio_v3_photo_busy', 'The renderer already has an active photo');
    const fence = getFence(); assertJson(fence, 'photo.fence');
    const task = {fence: structuredClone(fence), abort: new AbortController()};
    task.idle = new Promise(resolve => {task.resolveIdle = resolve;}); active = task; reservations.set(renderer, task);
    let target;
    try {
      check(task);
      const source = args?.camera;
      if (!source?.isPerspectiveCamera || !Number.isFinite(source.fov) || source.fov <= 0 || source.fov >= 180) throw new TypeError('Photo capture requires a real PerspectiveCamera');
      const selectedRatio = args.frameAspectRatio, ratio = Number.isFinite(selectedRatio) && selectedRatio > 0 ? selectedRatio : source.aspect;
      const {width, height} = photoDimensions(ratio, args.longEdge), camera = source.clone(); camera.aspect = width / height;
      if (Number.isFinite(selectedRatio) && selectedRatio > 0) {
        const crop = Number.isFinite(args.frameHeightRatio) ? Math.max(1e-6, Math.min(1, args.frameHeightRatio)) : 1;
        camera.fov = 2 * Math.atan(Math.tan(source.fov * Math.PI / 360) * crop) * 180 / Math.PI;
      }
      for (const layer of [3, 4, 5, 6, 7]) camera.layers.disable(layer);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const optics = cameraOpticsPatch(args.optics || source.userData.studioV3Optics || {fov: source.fov, frameAspectRatio: source.aspect});
      await wait(task, () => settle({camera, width, height, fence: structuredClone(task.fence), signal: task.abort.signal}));
      target = createRenderTarget(width, height);
      if (!target?.isWebGLRenderTarget || target.width !== width || target.height !== height) throw new TypeError('Photo render target must match the requested offscreen frame');
      target.texture.colorSpace = renderer.outputColorSpace; target.texture.minFilter = THREE.LinearFilter; target.texture.magFilter = THREE.LinearFilter;
      target.texture.wrapS = target.texture.wrapT = THREE.ClampToEdgeWrapping; target.texture.generateMipmaps = false;
      const readback = renderPixels(task, camera, target, optics, {resolveEntityPosition: args.resolveEntityPosition, boundsCenter: args.boundsCenter});
      await wait(task, () => task.readback); target.dispose(); target = null;
      const canvas = createCanvas(); if (!canvas) throw error('studio_v3_photo_canvas', 'Photo canvas is unavailable');
      canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
      if (!context) throw error('studio_v3_photo_canvas', 'Photo canvas requires a 2D context');
      const image = context.createImageData(width, height); image.data.set(flipPhotoPixels(readback.pixels, width, height)); context.putImageData(image, 0, 0); check(task);
      const result = {canvas, width, height, mimeType: PHOTO_RENDER_PROFILE.mimeType, quality: PHOTO_RENDER_PROFILE.quality};
      if (encode) {
        const blob = await wait(task, () => new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(error('studio_v3_photo_encode', 'Photo JPEG encoding returned no image')), result.mimeType, result.quality)));
        if (!blob.size || blob.type !== result.mimeType) throw error('studio_v3_photo_encode', 'Photo encoding did not produce a nonempty JPEG'); result.blob = blob;
      }
      check(task); return result;
    } finally {try {await task.readback?.catch(() => {}); target?.dispose();} finally {if (reservations.get(renderer) === task) reservations.delete(renderer); if (active === task) active = null; task.resolveIdle();}}
  }
  return {render: args => run(args, false), capture: args => run(args, true),
    whenIdle: () => active?.idle || Promise.resolve(),
    dispose() {if (disposed) return false; disposed = true; active?.abort.abort(error('studio_v3_photo_disposed', 'Photo renderer disposed during capture')); return true;},
    get busy() {return !!active;}, get disposed() {return disposed;}};
}
