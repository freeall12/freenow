import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {createRenderGraph, readTransform, applyTransform} from './render-graph.mjs';
import {createAssetLoader} from './asset-loader.mjs';
import {assertState} from './schema.mjs';
import {viewportRay, surfaceHit, withCaptureVisibility} from './surface-hit.mjs';
import {SplatContext} from '../world-node/splat-io.mjs';
import {disposeModel} from '../studio-v2/model-io.mjs';
import {sparkDepthOfField, cameraOpticsPatch, applyCameraOptics} from './camera-optics.mjs';
import {createControlSession, controlSpatialProfile} from './control-session.mjs';
import {readEntityTransform} from './transform-coordinates.mjs';
import {resolveEntityControl} from './entity-actions.mjs';
import {visibleSurface} from './surface-hit.mjs';

const fail = (code, message) => Object.assign(Error(message), {code});
const entityLocked = record => ['actor', 'prop'].includes(record?.definition?.kind) && record.definition.locked === true;
export function createStudioV3Runtime({canvas, getState, getSourceResource = () => null, getFence = () => null, isCurrent = () => true,
  onStatus = () => {}, onInvalidate = () => {}, onTransform = () => {}, onControl = () => {}, canControlInput = () => true, controlEventTarget,
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
  let activeCamera = orbitCamera, renderer, controls, transformControls, graph, selectionOutline, viewportWidth = 1, viewportHeight = 1, entityControl, controlReturn = null, navigationTransition = null, viewfinder = null;
  const lighting = new THREE.Group(); lighting.name = 'V3 local scene lighting';
  lighting.add(new THREE.HemisphereLight('#dfe8fa', '#292422', 2));
  const sun = new THREE.DirectionalLight('#fff5e4', 3); sun.position.set(4, 9, 6); lighting.add(sun); scene.add(lighting);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({color: '#24272b', roughness: .95})); ground.rotation.x = -Math.PI / 2; ground.name = 'V3 exact support ground'; scene.add(ground);
  const grid = new THREE.GridHelper(100, 100, '#686b70', '#3a3d42'); grid.position.y = .002; grid.userData.helper = grid.userData.captureExcluded = true; scene.add(grid);
  function clearDepthOfField() {if (gaussian?.spark) {gaussian.spark.focalDistance = 0; gaussian.spark.apertureAngle = 0;}}
  function check() {if (disposed || !isCurrent()) {
    if (viewfinder) {const saved = viewfinder; viewfinder = null; saved.controls.dispose(); view = saved.view === 'plan' ? 'plan' : 'orbit'; activeCamera = view === 'plan' ? planCamera : orbitCamera;}
    clearDepthOfField(); entityControl?.cancel('ownership-stale'); navigationTransition = null; if (controls) controls.enabled = false; transformControls?.detach();
    if (!disposed && previewCameraEntityId !== null) {previewCameraEntityId = null; view = returnView; activeCamera = view === 'plan' ? planCamera : orbitCamera; controls.enabled = false; transformControls.detach();}
    throw fail('studio_v3_runtime_stale', '片场会话已关闭或所有权已变化');
  }}
  function viewportFence() {const {revision, editEpoch, ...identity} = getFence() || {}; return JSON.stringify([sourceKey, identity]);}
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
    if (disposed || !isCurrent() || (!viewfinder && previewCameraEntityId === null)) return null;
    const record = graph.entity(previewCameraEntityId); if (!viewfinder && (record?.status !== 'ready' || !record.state.visible || !record.camera)) return null;
    const rect = fittedRect(viewfinder?.camera || record.camera), bounds = canvas.getBoundingClientRect(), scaleX = bounds.width / viewportWidth, scaleY = bounds.height / viewportHeight;
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
  function visibilityChanged() {lastTime = 0; if (viewfinder) viewfinder.controls.enabled = !hidden(); if (hidden()) {entityControl?.cancel('hidden'); navigationTransition = null; if (frame) cancelFrame?.(frame); frame = 0;} else invalidate();}
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
    const payload = {phase, entityId: transformSession.entityId, transform: readEntityTransform(record.definition.kind, readTransform(record.root), record.state.transform)};
    try {if (onTransform(payload) === false) {cancelTransform(); return;}} catch (failure) {cancelTransform(); notify(failure); return;}
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
    try {if (session) onTransform({phase: 'cancel', entityId: session.entityId, transform: structuredClone(session.domainBefore)});} catch (failure) {notify(failure);}
    controls.enabled = previewCameraEntityId === null && !entityControl?.active; invalidate(); return true;
  }
  try {
    renderer = rendererFactory({canvas, antialias: true, alpha: false, preserveDrawingBuffer: true});
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    controls = controlsFactory(orbitCamera, canvas); controls.enabled = true; controls.target.set(0, 1, 0); controls.enableDamping = true; controls.dampingFactor = .12;
    controls.addEventListener('change', invalidate);
    transformControls = transformFactory(orbitCamera, canvas); const gizmo = transformControls.getHelper(); gizmo.userData.helper = gizmo.userData.captureExcluded = true; scene.add(gizmo);
    transformControls.addEventListener('dragging-changed', event => {controls.enabled = previewCameraEntityId === null && !entityControl?.active && !event.value;});
    transformControls.addEventListener('mouseDown', () => {
      const entityId = transformControls.object?.userData.entityId, record = graph.entity(entityId); if (!record?.root || entityLocked(record)) return;
      if (entityControl?.active) return;
      transformSession = {entityId, kind: record.definition.kind, before: readTransform(record.root), domainBefore: structuredClone(record.state.transform), fence: sourceKey}; transformEvent('begin');
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
  function controlSubject(id) {
    if (disposed || !isCurrent() || hidden() || capturing) return null;
    const record = graph.entity(id); if (record?.status !== 'ready' || !record.state.visible || !['actor', 'prop'].includes(record.definition.kind)) return null;
    try {
      const state = getState(), space = state.scenePlay.worldSpace, context = resolveEntityControl(state, {entityId: id});
      if (context.locked || context.baselineReadOnly || !context.setupState || space.temporalPlaybackPlaying || space.temporalPlayheadScrubbing) return null;
      return {entityId: id, kind: record.definition.kind, label: context.definition.label, transform: context.setupState.transform};
    } catch {return null;}
  }
  function controlFence() {
    const {revision, editEpoch, ...identity} = getFence() || {};
    const state = getState(), space = state.scenePlay.worldSpace;
    return JSON.stringify([sourceKey, state.scenePlay.worldNodeId, space.activeStageId, space.activeSetupId, identity]);
  }
  function controlMeshes() {
    const meshes = [], id = entityControl?.active?.entityId;
    graph.content.traverse(object => {
      if (!visibleSurface(object)) return;
      for (let node = object; node; node = node.parent) if (node.userData.entityId === id) return;
      meshes.push(object);
    });
    graph.content.updateWorldMatrix(true, true); return meshes;
  }
  function physicalNormal(hit) {return hit.face?.normal?.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();}
  function controlSupport({transform, body, maxSnapDistance = Infinity}) {
    const bottom = transform.position.y + body.bottomOffsetY, height = Math.max(bottom, transform.position.y) + .03, radius = body.radius * .7;
    let supportY = null; const meshes = controlMeshes();
    for (const [x, z] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(transform.position.x + x * radius, height, transform.position.z + z * radius), new THREE.Vector3(0, -1, 0), 0, Number.isFinite(maxSnapDistance) ? height - bottom + maxSnapDistance : Infinity);
      const hit = ray.intersectObjects(meshes, false).find(hit => {const normal = physicalNormal(hit); return normal && Math.abs(normal.y) >= .2;});
      if (hit) supportY = supportY === null ? hit.point.y : Math.max(supportY, hit.point.y);
    }
    const delta = (supportY ?? ground.position.y) - bottom;
    return Math.abs(delta) > maxSnapDistance ? {transform, supported: false} : {transform: {...transform, position: {...transform.position, y: transform.position.y + delta}}, supported: true};
  }
  function controlHorizontal({from, to, body}) {
    const dx = to.position.x - from.position.x, dz = to.position.z - from.position.z, distance = Math.hypot(dx, dz);
    if (distance < 1e-5) return to;
    const direction = new THREE.Vector3(dx / distance, 0, dz / distance), meshes = controlMeshes(); let allowed = distance;
    for (const height of body.sampleHeights) {
      const ray = new THREE.Raycaster(new THREE.Vector3(from.position.x, from.position.y + height, from.position.z), direction, 0, distance + body.radius + .025);
      const hit = ray.intersectObjects(meshes, false).find(hit => {const normal = physicalNormal(hit); return normal && Math.abs(normal.y) <= .45;});
      if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - body.radius - .025));
    }
    return allowed >= distance ? to : {...to, position: {...to.position, x: from.position.x + direction.x * allowed, z: from.position.z + direction.z * allowed}};
  }
  function followControlCamera({position, target}) {
    const center = new THREE.Vector3(target.x, target.y, target.z), desired = new THREE.Vector3(position.x, position.y, position.z), direction = desired.clone().sub(center), distance = direction.length();
    if (distance > .45) {
      direction.normalize(); const ray = new THREE.Raycaster(center, direction, .45, distance), hit = ray.intersectObjects(controlMeshes(), false)[0];
      if (hit) desired.copy(center).addScaledVector(direction, Math.max(.45, hit.distance - .18));
    }
    orbitCamera.position.copy(desired); orbitCamera.lookAt(center); orbitCamera.updateMatrixWorld(true); controls.target.copy(center);
  }
  function restoreControlCamera() {
    const saved = controlReturn; controlReturn = null; if (!saved) return;
    const from = {position: orbitCamera.position.clone(), quaternion: orbitCamera.quaternion.clone(), target: controls.target.clone()};
    navigationView(saved.view); controls.target.copy(saved.target); planCamera.position.copy(saved.planPosition); planCamera.quaternion.copy(saved.planQuaternion);
    if (!disposed && isCurrent() && !hidden() && saved.view === 'orbit') {
      orbitCamera.position.copy(from.position); orbitCamera.quaternion.copy(from.quaternion); controls.target.copy(from.target); controls.enabled = false;
      navigationTransition = {elapsed: 0, duration: .55, from, to: saved};
    } else {orbitCamera.position.copy(saved.position); orbitCamera.quaternion.copy(saved.quaternion);}
  }
  function tickNavigationTransition(delta) {
    const transition = navigationTransition; if (!transition) return false;
    transition.elapsed += delta; const fraction = Math.min(1, transition.elapsed / transition.duration), eased = 1 - (1 - fraction) ** 3;
    orbitCamera.position.lerpVectors(transition.from.position, transition.to.position, eased); orbitCamera.quaternion.slerpQuaternions(transition.from.quaternion, transition.to.quaternion, eased);
    controls.target.lerpVectors(transition.from.target, transition.to.target, eased);
    if (fraction === 1) {navigationTransition = null; controls.enabled = previewCameraEntityId === null && !entityControl?.active;}
    return !!navigationTransition;
  }
  function interruptNavigationTransition() {
    const transition = navigationTransition; navigationTransition = null;
    if (transition) {orbitCamera.position.copy(transition.to.position); orbitCamera.quaternion.copy(transition.to.quaternion); controls.target.copy(transition.to.target);}
    controls.enabled = previewCameraEntityId === null && !entityControl?.active && !viewfinder;
  }
  entityControl = createControlSession({canvas, eventTarget: controlEventTarget || document?.defaultView || globalThis.window,
    getSubject: controlSubject, getFence: controlFence, getCameraPosition: () => vector(activeCamera.position),
    getProfile(subject) {
      const box = graph.bounds(subject.entityId), size = box?.getSize(new THREE.Vector3()), center = box?.getCenter(new THREE.Vector3()), y = subject.transform.position.y;
      return controlSpatialProfile(subject.kind, size && !box.isEmpty() ? {height: size.y, width: size.x, depth: size.z, minHeight: box.min.y - y, centerHeight: center.y - y} : {});
    }, resolveHorizontal: controlHorizontal, resolveSupport: controlSupport, setFollowCamera: followControlCamera,
    onControl, canInput: canControlInput, onInvalidate: invalidate, onError: notify,
    onMotion: motion => graph.setControlMotion(motion.entityId, motion),
    onRenderTransform(id, world) {const record = graph.entity(id); if (record?.root) {applyTransform(record.root, world); selectionOutline?.update();}},
    onStart({entityId}) {
      navigationTransition = null; cancelTransform(); transformControls.detach();
      controlReturn = {view: previewCameraEntityId !== null ? returnView : view, position: orbitCamera.position.clone(), quaternion: orbitCamera.quaternion.clone(),
        planPosition: planCamera.position.clone(), planQuaternion: planCamera.quaternion.clone(), target: controls.target.clone()};
      previewCameraEntityId = null; activeCamera = orbitCamera; view = 'control'; controls.enabled = false; transformControls.camera = activeCamera; selected = entityId; clearDepthOfField(); refreshSelection();
    }, onEnd: restoreControlCamera});
  function startControl(id) {check(); if (entityControl.active?.entityId === id) return true; if (entityControl.active && !entityControl.finish('retarget')) return false; endViewfinder(); interruptNavigationTransition(); cancelTransform(); return entityControl.start(id);}
  function finishControl() {check(); return entityControl.finish();}
  function cancelControl(reason = 'cancel') {return entityControl.cancel(reason);}
  function resize(width = canvas.clientWidth || 900, height = canvas.clientHeight || 600) {
    if (disposed || capturing) return; width = Math.max(1, width); height = Math.max(1, height); viewportWidth = width; viewportHeight = height; renderer.setSize(width, height, false); restoreViewport();
    orbitCamera.aspect = width / height; orbitCamera.updateProjectionMatrix();
    const half = 10; planCamera.left = -half * width / height; planCamera.right = half * width / height; planCamera.top = half; planCamera.bottom = -half; planCamera.updateProjectionMatrix(); invalidate();
  }
  function render() {if (disposed || capturing) return false; check(); refreshVisibleCamera(); scene.updateMatrixWorld(true); selectionOutline?.update();
    const drawScene = () => drawFrame(activeCamera, !!viewfinder || previewCameraEntityId !== null);
    // A preview omits its own editor guides. The body offset in render-graph
    // keeps navigation outside camera.glb without an arbitrary proximity gate.
    const hiddenMarkers = [];
    for (const record of graph.entities.values()) if (record.status === 'ready' && record.camera === activeCamera) {
      for (const object of [record.root, record.cameraHelper, record.id === selected ? selectionOutline : null]) if (object?.visible) {hiddenMarkers.push(object); object.visible = false;}
    }
    try {if (gaussian) gaussian.render(graph.content, activeCamera, drawScene); else drawScene();}
    finally {for (const object of hiddenMarkers) object.visible = true;} return true;
  }
  function draw(time) {
    frame = 0; if (disposed || capturing || hidden()) return;
    const delta = Math.min(.05, Math.max(0, (time - (lastTime || time)) / 1000)); lastTime = time;
    let dampingChanged = false, controlChanged = false, navigationChanged = false;
    try {controlChanged = entityControl.tick(delta); navigationChanged = tickNavigationTransition(delta); const navigation = viewfinder?.controls || controls; dampingChanged = navigation.enabled && navigation.update(delta) === true; graph.tick(delta); render();} catch (failure) {notify(failure); return;}
    if (dampingChanged || controlChanged || entityControl.needsFrame || navigationChanged || graph.needsAnimation()) invalidate();
  }
  async function sync(state = getState()) {
    check(); assertState(state);
    const resource = getSourceResource(state.scenePlay.worldSpace.activeStageId), boundary = JSON.stringify([state.scenePlay.worldNodeId, state.scenePlay.worldSpace.activeStageId, state.scenePlay.worldSpace.activeSetupId, resource]);
    if (transformSession && transformSession.fence !== boundary) cancelTransform();
    if (sourceKey !== boundary) {endViewfinder(); cancelControl('boundary-change'); interruptNavigationTransition();}
    if (sourceKey !== boundary) {sourceKey = boundary; transformControls.detach(); selected = null; if (previewCameraEntityId !== null) navigationView(returnView); clearDepthOfField();}
    const groundY = Number.isFinite(state.scenePlay.environment.ground.y) ? state.scenePlay.environment.ground.y : 0; ground.position.y = groundY; grid.position.y = groundY + .002;
    if (viewfinder && viewfinder.fence !== viewportFence()) endViewfinder();
    const report = await graph.sync(state, resource); check();
    entityControl.refresh();
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
    check(); if (!['orbit', 'plan'].includes(value)) throw fail('studio_v3_view_mode', '未知片场视图'); endViewfinder(); cancelControl('view-change'); navigationTransition = null; cancelTransform(); navigationView(value); invalidate(); return view;
  }
  function previewCamera(entityId) {
    check(); const record = graph.entity(entityId);
    if (record?.status !== 'ready' || !record.state.visible || !record.camera) return false;
    endViewfinder(); cancelControl('camera-preview'); navigationTransition = null; cancelTransform(); transformControls.detach();
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
  function getVisibleCameraState() {
    check(); refreshVisibleCamera(); const camera = activeCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : THREE.MathUtils.radToDeg(2 * Math.atan((camera.top - camera.bottom) / (2 * camera.zoom * Math.max(.1, camera.position.distanceTo(controls.target)))));
    const ratio = camera.isPerspectiveCamera ? camera.aspect : (camera.right - camera.left) / (camera.top - camera.bottom);
    return cameraOpticsPatch(camera.userData.studioV3Optics || {}, {position: vector(camera.position), rotation: {...vector(camera.rotation), order: camera.rotation.order}, fov, frameAspectRatio: ratio});
  }
  function beginViewfinder() {
    check(); if (capturing) return false; endViewfinder(); cancelControl('viewfinder'); navigationTransition = null; cancelTransform();
    const optics = getVisibleCameraState(), camera = new THREE.PerspectiveCamera(optics.fov, optics.frameAspectRatio, .01, 10000);
    camera.position.set(optics.position.x, optics.position.y, optics.position.z); camera.rotation.set(optics.rotation.x, optics.rotation.y, optics.rotation.z, optics.rotation.order || 'XYZ');
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    applyCameraOptics(camera, optics);
    // OrbitControls performs an initial look-at in its constructor. Restore
    // the sampled optical pose before installing this camera's actual pivot.
    const position = camera.position.clone(), orientation = camera.quaternion.clone(), forward = camera.getWorldDirection(new THREE.Vector3());
    const navigation = controlsFactory(camera, canvas); navigation.enableDamping = true; navigation.dampingFactor = .12;
    camera.position.copy(position); camera.quaternion.copy(orientation);
    navigation.target.copy(position).addScaledVector(forward, optics.focusDistance || 10); navigation.addEventListener('change', invalidate);
    viewfinder = {camera, controls: navigation, view, previewId: previewCameraEntityId, fence: viewportFence()};
    previewCameraEntityId = null; activeCamera = camera; view = 'viewfinder'; transformControls.detach(); transformControls.camera = camera;
    controls.enabled = false; navigation.update(); invalidate(); return true;
  }
  function patchViewfinder(patch) {
    check(); if (!viewfinder || viewfinder.fence !== viewportFence()) {endViewfinder(); return false;}
    const optics = cameraOpticsPatch(getVisibleCameraState(), patch), camera = viewfinder.camera;
    camera.position.set(optics.position.x, optics.position.y, optics.position.z); camera.rotation.set(optics.rotation.x, optics.rotation.y, optics.rotation.z, optics.rotation.order || 'XYZ');
    if (patch.rotation) camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    applyCameraOptics(camera, optics); camera.updateMatrixWorld(true);
    if (patch.position || patch.rotation) viewfinder.controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), optics.focusDistance || 10);
    invalidate(); return true;
  }
  function endViewfinder() {
    const saved = viewfinder; if (!saved) return false; viewfinder = null; saved.controls.dispose();
    navigationView(saved.view === 'camera' ? returnView : saved.view);
    if (saved.previewId && graph.entity(saved.previewId)?.status === 'ready') {
      previewCameraEntityId = saved.previewId; view = 'camera'; activeCamera = graph.entity(saved.previewId).camera; controls.enabled = false; transformControls.camera = activeCamera;
    }
    invalidate(); return true;
  }
  function entityObject(id) {const record = graph.entity(id); return record?.status === 'ready' ? record.root : null;}
  function entityCamera(id) {const record = graph.entity(id); return record?.status === 'ready' ? record.camera || null : null;}
  function selectEntity(id) {
    check(); const next = id && graph.entity(id)?.status === 'ready' ? id : null;
    if (next !== selected) {cancelControl('selection-change'); interruptNavigationTransition(); cancelTransform();} selected = next;
    if (transformControls.object?.userData.entityId !== selected) transformControls.detach(); refreshSelection(); invalidate(); return selected;
  }
  function focusEntity(id) {
    check(); if (previewCameraEntityId !== null || entityControl.active) return false; endViewfinder(); interruptNavigationTransition(); const bounds = graph.bounds(id); if (!bounds || bounds.isEmpty()) return false;
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
    if (record.definition.kind === 'camera' && mode === 'scale') return false;
    if (!['translate', 'rotate', 'scale'].includes(mode)) throw fail('studio_v3_transform_mode', '未知变换操作');
    endViewfinder(); cancelControl('transform-gizmo'); interruptNavigationTransition(); cancelTransform(); selectEntity(id); transformControls.setMode(mode); transformControls.attach(record.root); invalidate(); return true;
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
    if (disposed) return; endViewfinder(); entityControl.dispose(); navigationTransition = null; cancelTransform(); clearDepthOfField(); previewCameraEntityId = null; disposed = true; if (frame) cancelFrame?.(frame); frame = 0;
    document?.removeEventListener('visibilitychange', visibilityChanged); transformControls.detach(); transformControls.dispose(); controls.dispose(); graph.dispose(); selectionOutline = null;
    await gaussian?.dispose(); gaussian = null; disposeModel(scene); scene.clear(); renderer.dispose(); renderer.forceContextLoss?.();
  }
  document?.addEventListener('visibilitychange', visibilityChanged); resize(); invalidate();
  return {scene, renderer, graph, controls, transformControls, orbitCamera, planCamera,
    get camera() {return activeCamera;}, get controlling() {return entityControl.active;}, get view() {return view;}, get selectedEntityId() {return selected;}, get disposed() {return disposed;}, get previewCameraEntityId() {return previewCameraEntityId;}, get cameraPreviewReturnView() {return returnView;}, get cameraPreviewRect() {return previewRect();}, get depthOfFieldSupported() {return !disposed && isCurrent() && !!gaussian?.spark;},
    startControl, finishControl, cancelControl, nudgeControlHeight: entityControl.nudgeHeight, dropControlToGround: entityControl.dropToGround, setControlHeading: entityControl.setHeading,
    getVisibleCameraState, beginViewfinder, patchViewfinder, endViewfinder,
    sync, render, resize, setView, previewCamera, clearCameraPreview, sparkDepthOfFieldParameters, selectEntity, focusEntity, entityObject, entityCamera, hitEntity, hitSurface, attachTransform, cancelTransform, settle, dispose,
    retryEntity(id) {if (graph.retry(id)) return sync(); return Promise.resolve(false);},
    renderCapture,
    setCapturing(value) {if (value) {cancelControl('capture'); navigationTransition = null;} capturing = !!value; if (!capturing) invalidate();}
  };
}
