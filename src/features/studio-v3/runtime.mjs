import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {createRenderGraph, readTransform, applyTransform} from './render-graph.mjs';
import {createAssetLoader} from './asset-loader.mjs';
import {assertState} from './schema.mjs';
import {viewportRay, surfaceHit, withCaptureVisibility} from './surface-hit.mjs';
import {SplatContext} from '../world-node/splat-io.mjs';
import {disposeModel} from '../studio-v2/model-io.mjs';
import {sparkDepthOfField} from './camera-optics.mjs';

const fail = (code, message) => Object.assign(Error(message), {code});
const entityLocked = record => ['actor', 'prop'].includes(record?.definition?.kind) && record.definition.locked === true;
export function createStudioV3Runtime({canvas, getState, getSourceResource = () => null, getFence = () => null, isCurrent = () => true,
  onStatus = () => {}, onInvalidate = () => {}, onTransform = () => {},
  loader = createAssetLoader(), rendererFactory = options => new THREE.WebGLRenderer(options), controlsFactory = (camera, canvas) => new OrbitControls(camera, canvas),
  transformFactory = (camera, canvas) => new TransformControls(camera, canvas), splatFactory = (...args) => new SplatContext(...args),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis), autoRender = true} = {}) {
  if (!canvas || typeof getState !== 'function') throw fail('studio_v3_runtime_options', '真实片场渲染需要 canvas 与领域 getState');
  const document = canvas.ownerDocument || globalThis.document;
  const hidden = () => document?.visibilityState === 'hidden';
  let disposed = false, frame = 0, lastTime = 0, selected = null, view = 'orbit', capturing = false, transformSession = null, gaussian = null, sourceKey, previewCameraEntityId = null, returnView = 'orbit';
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#15171b');
  const orbitCamera = new THREE.PerspectiveCamera(45, 1, .01, 10000); orbitCamera.position.set(7, 6, 9); orbitCamera.lookAt(0, 1, 0);
  const planCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, .01, 10000); planCamera.position.set(0, 100, 0); planCamera.up.set(0, 0, -1); planCamera.lookAt(0, 0, 0);
  let activeCamera = orbitCamera, renderer, controls, transformControls, graph, selectionOutline, viewportWidth = 1, viewportHeight = 1;
  const lighting = new THREE.Group(); lighting.name = 'V3 local scene lighting';
  lighting.add(new THREE.HemisphereLight('#dfe8fa', '#292422', 2));
  const sun = new THREE.DirectionalLight('#fff5e4', 3); sun.position.set(4, 9, 6); lighting.add(sun); scene.add(lighting);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color: '#24272b', roughness: .95})); ground.rotation.x = -Math.PI / 2; ground.name = 'V3 exact support ground'; scene.add(ground);
  const grid = new THREE.GridHelper(100, 100, '#686b70', '#3a3d42'); grid.position.y = .002; grid.userData.helper = grid.userData.captureExcluded = true; scene.add(grid);
  function clearDepthOfField() {if (gaussian?.spark) {gaussian.spark.focalDistance = 0; gaussian.spark.apertureAngle = 0;}}
  function check() {if (disposed || !isCurrent()) {
    clearDepthOfField();
    if (!disposed && previewCameraEntityId !== null) {previewCameraEntityId = null; view = returnView; activeCamera = view === 'plan' ? planCamera : orbitCamera; controls.enabled = false; transformControls.detach();}
    throw fail('studio_v3_runtime_stale', '片场会话已关闭或所有权已变化');
  }}
  function notify(failure) {clearDepthOfField(); if (!disposed) onStatus({kind: 'runtime', id: null, status: 'failed', error: failure.message, code: failure.code || 'studio_v3_render_failed'});}
  function sparkDepthOfFieldParameters(camera = activeCamera) {
    // Navigation never inherits a merely selected entity's lens. Only the
    // camera actually used by this draw owns its depth-of-field parameters.
    if (disposed || !isCurrent() || camera === orbitCamera || camera === planCamera || !camera?.isPerspectiveCamera) return {focalDistance: 0, apertureAngle: 0};
    const record = [...graph.entities.values()].find(item => item.status === 'ready' && item.camera === camera);
    if (record && !record.state.visible) return {focalDistance: 0, apertureAngle: 0};
    const config = record?.state.camera || camera.userData.studioV3Optics;
    if (!config) return {focalDistance: 0, apertureAngle: 0};
    if ((config.depthOfFieldMode ?? 'deepFocus') === 'deepFocus') return {focalDistance: 0, apertureAngle: 0};
    const bounds = graph.bounds(), boundsCenter = bounds && !bounds.isEmpty() ? bounds.getCenter(new THREE.Vector3()) : null;
    return sparkDepthOfField(config, {camera, boundsCenter, resolveEntityPosition(id, offset) {
      const target = graph.entity(id); if (target?.status !== 'ready' || !target.state.visible) return null;
      target.root.updateWorldMatrix(true, false);
      return offset ? target.root.localToWorld(new THREE.Vector3(offset.x, offset.y, offset.z)) : target.root.getWorldPosition(new THREE.Vector3());
    }});
  }
  function applyDepthOfField(camera = activeCamera) {
    const parameters = sparkDepthOfFieldParameters(camera);
    if (gaussian?.spark) {gaussian.spark.focalDistance = parameters.focalDistance; gaussian.spark.apertureAngle = parameters.apertureAngle;}
    return parameters;
  }
  function refreshVisibleCamera() {
    if (previewCameraEntityId === null) return;
    const record = graph.entity(previewCameraEntityId);
    if (record?.status === 'ready' && record.state.visible && record.camera) {activeCamera = record.camera; transformControls.camera = activeCamera;}
    else navigationView(returnView);
  }
  function fittedRect(camera) {
    const ratio = camera?.isPerspectiveCamera ? camera.aspect : camera?.isOrthographicCamera ? (camera.right - camera.left) / (camera.top - camera.bottom) : viewportWidth / viewportHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return {left: 0, top: 0, width: viewportWidth, height: viewportHeight};
    const width = Math.min(viewportWidth, viewportHeight * ratio), height = width / ratio;
    return {left: (viewportWidth - width) / 2, top: (viewportHeight - height) / 2, width, height};
  }
  function previewRect() {
    if (disposed || !isCurrent() || previewCameraEntityId === null) return null;
    const record = graph.entity(previewCameraEntityId); if (record?.status !== 'ready' || !record.state.visible || !record.camera) return null;
    const rect = fittedRect(record.camera), bounds = canvas.getBoundingClientRect(), scaleX = bounds.width / viewportWidth, scaleY = bounds.height / viewportHeight;
    return {left: rect.left * scaleX, top: rect.top * scaleY, width: rect.width * scaleX, height: rect.height * scaleY};
  }
  function restoreViewport() {renderer.setViewport?.(0, 0, viewportWidth, viewportHeight); renderer.setScissor?.(0, 0, viewportWidth, viewportHeight); renderer.setScissorTest?.(false);}
  function drawFrame(camera, fit) {
    const rect = fit ? fittedRect(camera) : {left: 0, top: 0, width: viewportWidth, height: viewportHeight};
    const clearColor = renderer.getClearColor?.(new THREE.Color()), clearAlpha = renderer.getClearAlpha?.();
    try {
      restoreViewport();
      // Clear the entire target before constraining the frame. Scene.background
      // fills the optical frame; the unused target stays an opaque black matte.
      if (fit) {renderer.setClearColor?.(0x000000, 1); renderer.clear?.();}
      const bottom = viewportHeight - rect.top - rect.height;
      renderer.setViewport?.(rect.left, bottom, rect.width, rect.height); renderer.setScissor?.(rect.left, bottom, rect.width, rect.height); renderer.setScissorTest?.(fit);
      applyDepthOfField(camera); renderer.render(scene, camera);
    } finally {restoreViewport(); if (clearColor) renderer.setClearColor?.(clearColor, clearAlpha);}
  }
  function rayAt(client) {
    refreshVisibleCamera(); const bounds = canvas.getBoundingClientRect(), frameRect = previewRect();
    if (!frameRect) return viewportRay(client, bounds, activeCamera);
    const rect = {...frameRect, left: bounds.left + frameRect.left, top: bounds.top + frameRect.top}, x = client.clientX ?? client.x, y = client.clientY ?? client.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) return null;
    return viewportRay(client, rect, activeCamera);
  }
  function invalidate() {if (disposed) return; onInvalidate(); if (autoRender && requestFrame && !frame && !capturing && !hidden()) frame = requestFrame(draw);}
  function visibilityChanged() {lastTime = 0; if (hidden()) {if (frame) cancelFrame?.(frame); frame = 0;} else invalidate();}
  function refreshSelection() {
    selectionOutline?.removeFromParent(); selectionOutline?.geometry.dispose(); selectionOutline?.material.dispose(); selectionOutline = null;
    const root = graph.entity(selected)?.root; if (!root || !root.visible || graph.entity(selected)?.status !== 'ready') return;
    selectionOutline = new THREE.BoxHelper(root, '#b5d4e4'); selectionOutline.userData.helper = selectionOutline.userData.captureExcluded = true; graph.helpers.add(selectionOutline);
  }
  const vector = value => ({x: value.x, y: value.y, z: value.z});
  function transformEvent(phase) {
    if (!transformSession) return;
    const record = graph.entity(transformSession.entityId);
    if (!record?.root || entityLocked(record) || !isCurrent()) {cancelTransform(); return;}
    const payload = {phase, entityId: transformSession.entityId, transform: readTransform(record.root)};
    try {onTransform(payload);} catch (failure) {cancelTransform(); notify(failure); return;}
    if (phase === 'commit') transformSession = null;
    selectionOutline?.update(); invalidate();
  }
  function cancelTransform() {
    const session = transformSession; if (!session && !transformControls?.dragging) return false; transformSession = null;
    // detach() alone leaves Three's native dragging flag set. Clear public
    // drag state without pointerUp(), which would emit a commit after cancel.
    transformControls.dragging = false; transformControls.axis = null; transformControls.detach();
    const root = session && graph.entity(session.entityId)?.root; if (root) applyTransform(root, session.before);
    // A domain transaction can already be fenced out when close/source switch
    // cancels its drag. Its callback failure must not prevent GPU cleanup.
    try {if (session) onTransform({phase: 'cancel', entityId: session.entityId, transform: structuredClone(session.before)});} catch (failure) {notify(failure);}
    controls.enabled = previewCameraEntityId === null; invalidate(); return true;
  }
  try {
    renderer = rendererFactory({canvas, antialias: true, alpha: false, preserveDrawingBuffer: true});
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    controls = controlsFactory(orbitCamera, canvas); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.dampingFactor = .12;
    controls.addEventListener('change', invalidate);
    transformControls = transformFactory(orbitCamera, canvas); const gizmo = transformControls.getHelper(); gizmo.userData.helper = gizmo.userData.captureExcluded = true; scene.add(gizmo);
    transformControls.addEventListener('dragging-changed', event => {controls.enabled = previewCameraEntityId === null && !event.value;});
    transformControls.addEventListener('mouseDown', () => {
      const entityId = transformControls.object?.userData.entityId, record = graph.entity(entityId); if (!record?.root || entityLocked(record)) return;
      transformSession = {entityId, before: readTransform(record.root), fence: sourceKey}; transformEvent('begin');
    });
    transformControls.addEventListener('objectChange', () => {if (transformSession) transformEvent('preview');});
    transformControls.addEventListener('mouseUp', () => transformEvent('commit'));
    graph = createRenderGraph({scene, loader, getFence, isCurrent, onStatus, onInvalidate: invalidate,
      async onAttach(record) {
        if (!record.asset.splatMesh) return;
        gaussian ||= splatFactory(renderer, scene, {onDirty: invalidate, onError: notify});
        gaussian.entries.set(record.asset.root, record.asset.splatMesh); gaussian.layer.add(record.asset.splatMesh); record.asset.transferSplat();
        await gaussian.settle(graph.content, activeCamera); check(); applyDepthOfField();
      },
      onDetach() {gaussian?.prune(graph.content);}
    });
  } catch (failure) {controls?.dispose(); transformControls?.dispose(); renderer?.dispose(); renderer?.forceContextLoss?.(); disposeModel(scene); throw failure;}
  function resize(width = canvas.clientWidth || 900, height = canvas.clientHeight || 600) {
    if (disposed || capturing) return; width = Math.max(1, width); height = Math.max(1, height); viewportWidth = width; viewportHeight = height; renderer.setSize(width, height, false); restoreViewport();
    orbitCamera.aspect = width / height; orbitCamera.updateProjectionMatrix();
    const half = 10; planCamera.left = -half * width / height; planCamera.right = half * width / height; planCamera.top = half; planCamera.bottom = -half; planCamera.updateProjectionMatrix(); invalidate();
  }
  function render() {if (disposed || capturing) return false; check(); refreshVisibleCamera(); scene.updateMatrixWorld(true); selectionOutline?.update();
    const drawScene = () => drawFrame(activeCamera, previewCameraEntityId !== null);
    if (gaussian) gaussian.render(graph.content, activeCamera, drawScene); else drawScene(); return true;
  }
  function draw(time) {
    frame = 0; if (disposed || capturing || hidden()) return;
    const delta = Math.min(.05, Math.max(0, (time - (lastTime || time)) / 1000)); lastTime = time;
    let dampingChanged = false;
    try {dampingChanged = controls.enabled && controls.update(delta) === true; graph.tick(delta); render();} catch (failure) {notify(failure); return;}
    if (dampingChanged || graph.needsAnimation()) invalidate();
  }
  async function sync(state = getState()) {
    check(); assertState(state);
    const resource = getSourceResource(state.scenePlay.worldSpace.activeStageId), boundary = JSON.stringify([state.scenePlay.worldNodeId, state.scenePlay.worldSpace.activeStageId, state.scenePlay.worldSpace.activeSetupId, resource]);
    if (transformSession && transformSession.fence !== boundary) cancelTransform();
    if (sourceKey !== boundary) {sourceKey = boundary; transformControls.detach(); selected = null; if (previewCameraEntityId !== null) navigationView(returnView); clearDepthOfField();}
    const groundY = Number.isFinite(state.scenePlay.environment.ground.y) ? state.scenePlay.environment.ground.y : 0; ground.position.y = groundY; grid.position.y = groundY + .002;
    const report = await graph.sync(state, resource); check();
    const attached = graph.entity(transformControls.object?.userData.entityId);
    if (transformControls.object && (!attached || attached.status !== 'ready' || entityLocked(attached) || !attached.state.visible)) {cancelTransform(); transformControls.detach();}
    if (selected && !graph.entity(selected)?.root) selected = null; refreshVisibleCamera(); applyDepthOfField(); refreshSelection(); invalidate(); return report;
  }
  function navigationView(value) {
    previewCameraEntityId = null; view = value; controls.enabled = true;
    activeCamera = value === 'plan' ? planCamera : orbitCamera; controls.object = activeCamera; controls.enableRotate = value === 'orbit'; controls.target.y = value === 'plan' ? ground.position.y : controls.target.y;
    if (value === 'plan') {const target = controls.target; planCamera.position.set(target.x, target.y + 100, target.z); planCamera.lookAt(target);}
    transformControls.camera = activeCamera; controls.update(); clearDepthOfField(); restoreViewport(); return view;
  }
  function setView(value) {
    check(); if (!['orbit', 'plan'].includes(value)) throw fail('studio_v3_view_mode', '未知片场视图'); cancelTransform(); navigationView(value); invalidate(); return view;
  }
  function previewCamera(entityId) {
    check(); const record = graph.entity(entityId);
    if (record?.status !== 'ready' || !record.state.visible || !record.camera) return false;
    cancelTransform(); transformControls.detach();
    if (previewCameraEntityId === null) returnView = view;
    previewCameraEntityId = entityId; view = 'camera'; activeCamera = record.camera;
    // Preview is read-only. Orbit damping and native gizmos must never mutate
    // the authored optical camera outside a domain action/history transaction.
    controls.enabled = false; transformControls.camera = activeCamera;
    applyDepthOfField(); invalidate(); return true;
  }
  function clearCameraPreview() {
    check(); if (previewCameraEntityId !== null) {navigationView(returnView); invalidate();}
    return view;
  }
  function entityObject(id) {const record = graph.entity(id); return record?.status === 'ready' ? record.root : null;}
  function entityCamera(id) {const record = graph.entity(id); return record?.status === 'ready' ? record.camera || null : null;}
  function selectEntity(id) {
    check(); const next = id && graph.entity(id)?.status === 'ready' ? id : null;
    if (next !== selected) cancelTransform(); selected = next;
    if (transformControls.object?.userData.entityId !== selected) transformControls.detach(); refreshSelection(); invalidate(); return selected;
  }
  function focusEntity(id) {
    check(); if (previewCameraEntityId !== null) return false; const bounds = graph.bounds(id); if (!bounds || bounds.isEmpty()) return false;
    const center = bounds.getCenter(new THREE.Vector3()), size = Math.max(.1, bounds.getSize(new THREE.Vector3()).length()); controls.target.copy(center);
    if (view === 'plan') {planCamera.position.set(center.x, center.y + 100, center.z); planCamera.lookAt(center);}
    else {const direction = orbitCamera.position.clone().sub(center).normalize(); if (!direction.lengthSq()) direction.set(1, .8, 1).normalize(); orbitCamera.position.copy(center).addScaledVector(direction, size * 1.8); orbitCamera.lookAt(center);}
    controls.update(); invalidate(); return true;
  }
  function hitEntity(client) {
    check(); const ray = rayAt(client); if (!ray) return null;
    scene.updateMatrixWorld(true); const roots = [...graph.entities.values()].filter(record => record.status === 'ready' && record.root.visible).map(record => record.root);
    const hit = ray.intersectObjects(roots, true).find(value => {for (let node = value.object; node; node = node.parent) if (!node.visible || node.userData.helper) return false; return true;}); if (!hit) return null;
    let owner = hit.object; while (owner && !owner.userData.entityId) owner = owner.parent;
    return owner ? {entityId: owner.userData.entityId, point: vector(hit.point), distance: hit.distance, locked: !!owner.userData.locked} : null;
  }
  function hitSurface(client, options = {}) {check(); const ray = rayAt(client); return surfaceHit(ray, {meshes: [graph.content], groundY: ground.position.y, groundFallback: true, ...options});}
  function attachTransform(id, mode = 'translate') {
    check(); if (previewCameraEntityId !== null) return false; const record = graph.entity(id); if (!record || record.status !== 'ready' || entityLocked(record) || !record.state.visible) return false;
    if (!['translate', 'rotate', 'scale'].includes(mode)) throw fail('studio_v3_transform_mode', '未知变换操作');
    cancelTransform(); selectEntity(id); transformControls.setMode(mode); transformControls.attach(record.root); invalidate(); return true;
  }
  async function settle(camera = activeCamera) {check(); applyDepthOfField(camera); if (gaussian) await gaussian.settle(graph.content, camera); check(); applyDepthOfField(camera);}
  async function renderCapture(camera = activeCamera) {
    check(); const boundary = sourceKey, entityId = [...graph.entities.values()].find(record => record.camera === camera)?.id;
    try {
      await settle(camera); check();
      if (sourceKey !== boundary || entityId && (entityCamera(entityId) !== camera || !graph.entity(entityId)?.state.visible)) throw fail('studio_v3_capture_stale', '拍摄场景或摄像机已变化');
      return withCaptureVisibility(scene, () => {
        scene.updateMatrixWorld(true); const drawScene = () => drawFrame(camera, true);
        if (gaussian) gaussian.render(graph.content, camera, drawScene); else drawScene(); return renderer.domElement;
      });
    } finally {if (!disposed && isCurrent()) {refreshVisibleCamera(); applyDepthOfField(); invalidate();} else clearDepthOfField();}
  }
  async function dispose() {
    if (disposed) return; cancelTransform(); clearDepthOfField(); previewCameraEntityId = null; disposed = true; if (frame) cancelFrame?.(frame); frame = 0;
    document?.removeEventListener('visibilitychange', visibilityChanged); transformControls.detach(); transformControls.dispose(); controls.dispose(); graph.dispose(); selectionOutline = null;
    await gaussian?.dispose(); gaussian = null; disposeModel(scene); scene.clear(); renderer.dispose(); renderer.forceContextLoss?.();
  }
  document?.addEventListener('visibilitychange', visibilityChanged); resize(); invalidate();
  return {scene, renderer, graph, controls, transformControls, orbitCamera, planCamera,
    get camera() {return activeCamera;}, get view() {return view;}, get selectedEntityId() {return selected;}, get disposed() {return disposed;}, get previewCameraEntityId() {return previewCameraEntityId;}, get cameraPreviewReturnView() {return returnView;}, get cameraPreviewRect() {return previewRect();}, get depthOfFieldSupported() {return !disposed && isCurrent() && !!gaussian?.spark;},
    sync, render, resize, setView, previewCamera, clearCameraPreview, sparkDepthOfFieldParameters, selectEntity, focusEntity, entityObject, entityCamera, hitEntity, hitSurface, attachTransform, cancelTransform, settle, dispose,
    retryEntity(id) {if (graph.retry(id)) return sync(); return Promise.resolve(false);},
    renderCapture,
    setCapturing(value) {capturing = !!value; if (!capturing) invalidate();}
  };
}
