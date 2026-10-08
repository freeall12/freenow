import * as THREE from 'three';
import {assertJson, clone} from './invariants.mjs';
import {assertCamera, assertState, baselineId} from './schema.mjs';
import {applyCameraOptics, automaticFrameAspectRatio} from './camera-optics.mjs';
import {createStudioV3Runtime} from './runtime.mjs';

const MAX_ENTRIES = 96, MAX_BYTES = 16 * 1024 * 1024;
const failure = (code, message, cause) => Object.assign(new Error(message, cause ? {cause} : undefined), {code});
const aborted = () => failure('studio_v3_shot_preview_aborted', '镜头缩略图请求已取消');
const unavailable = message => failure('studio_v3_shot_preview_unavailable', message);

/** Fold the resolved shot baseline into an isolated independent setup. The
 * returned strict domain snapshot is render-only and must never be persisted. */
export function createCameraShotPreviewState(state, shot) {
  assertState(state); assertJson(shot, 'shot'); assertCamera(shot?.camera);
  const next = clone(state), space = next.scenePlay.worldSpace;
  const setup = space.setups.find(item => item.id === shot.setupId);
  if (!setup || setup.kind !== 'independent' || setup.stageId !== shot.stageId || shot.setup?.id !== setup.id || shot.setup.stageId !== setup.stageId) throw unavailable('镜头状态已不存在');
  space.entities = clone(shot.entities);
  space.setups = space.setups.map(item => item.id === baselineId(shot.stageId) ? {...item, entityStates: []}
    : item.id === setup.id ? clone(shot.setup) : item);
  space.activeStageId = shot.stageId; space.activeSetupId = shot.setupId; space.activeViewId = null;
  assertState(next); assertCamera(shot.camera, 'shot.camera', new Map(space.entities.map(item => [item.id, item])), shot.stageId); return next;
}

export function cameraShotPreviewDimensions(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new TypeError('Thumbnail ratio must be finite and positive');
  const longEdge = ratio >= 1 ? Math.max(1, Math.round(Math.min(320, 180 * ratio))) : 180;
  return ratio >= 1 ? {longEdge, width: longEdge, height: Math.max(1, Math.round(longEdge / ratio))}
    : {longEdge, width: Math.max(1, Math.round(longEdge * ratio)), height: longEdge};
}

function opticalCamera(shot, runtime, ratio) {
  const config = shot.camera, camera = new THREE.PerspectiveCamera(config.fov, ratio, .01, 10000);
  camera.position.set(config.position.x, config.position.y, config.position.z);
  camera.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z, config.rotation.order || 'XYZ');
  applyCameraOptics(camera, {...config, frameAspectRatio: ratio});
  const look = config.lookAt;
  const target = look?.mode === 'point' ? new THREE.Vector3(look.target.x, look.target.y, look.target.z)
    : look?.mode === 'entity' ? runtime.entityObject?.(look.entityId)?.getWorldPosition(new THREE.Vector3()) : null;
  if (target) camera.lookAt(target);
  camera.layers.enable(4); camera.updateMatrixWorld(true); return camera;
}

function cacheKey(state, shot, resource) {
  const space = state.scenePlay.worldSpace;
  return JSON.stringify([state.scenePlay.worldNodeId, state.scenePlay.environment, space.source, space.roomConfig,
    space.stages.find(item => item.id === shot.stageId), space.characterRoles, space.entities,
    space.setups.find(item => item.id === shot.setupId), shot.camera, resource]);
}

/** Serial isolated scene renderer with bounded encoded-image caching. No live
 * viewport, authored camera, RAF loop or placeholder imagery is borrowed. */
export function createCameraShotPreview({getState, getSourceResource = () => null, runtimeFactory = createStudioV3Runtime,
  createCanvas = () => globalThis.document?.createElement('canvas'), createObjectURL = blob => URL.createObjectURL(blob),
  revokeObjectURL = url => URL.revokeObjectURL(url), maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES} = {}) {
  for (const callback of [getState, getSourceResource, runtimeFactory, createCanvas, createObjectURL, revokeObjectURL]) if (typeof callback !== 'function') throw new TypeError('Thumbnail adapters must be functions');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new TypeError('Thumbnail cache limits must fit 96 entries / 16 MiB');
  let disposed = false, serial = Promise.resolve(), bytes = 0;
  const cache = new Map(), tasks = new Set(), leases = new Set();
  function check(task) {
    if (disposed) throw failure('studio_v3_shot_preview_disposed', '镜头缩略图服务已关闭');
    if (task.abort.signal.aborted) throw aborted();
    if (task.isCurrent() !== true) throw failure('studio_v3_shot_preview_stale', '镜头缩略图所属状态已变化');
  }
  async function wait(task, work) {
    check(task); let remove;
    const cancel = new Promise((_, reject) => {const onAbort = () => reject(aborted()); task.abort.signal.addEventListener('abort', onAbort, {once: true}); remove = () => task.abort.signal.removeEventListener('abort', onAbort);});
    try {const result = await Promise.race([Promise.resolve().then(work), cancel]); check(task); return result;} finally {remove();}
  }
  function store(key, value) {
    const cost = value.blob.size + key.length * 2;
    if (cost > maxBytes) return;
    const old = cache.get(key); if (old) {bytes -= old.cost; cache.delete(key);}
    cache.set(key, {...value, cost}); bytes += cost;
    while (cache.size > maxEntries || bytes > maxBytes) {const first = cache.keys().next().value; bytes -= cache.get(first).cost; cache.delete(first);}
  }
  function lease(task, value) {
    check(task); const url = createObjectURL(value.blob);
    if (typeof url !== 'string' || !url) throw unavailable('镜头缩略图地址创建失败');
    let released = false;
    const result = {url, width: value.width, height: value.height, dispose() {
      if (released) return false; released = true; leases.delete(result); revokeObjectURL(url); return true;
    }};
    leases.add(result);
    try {check(task); return result;} catch (error) {result.dispose(); throw error;}
  }
  async function render(task) {
    check(task); const hit = cache.get(task.key);
    if (hit) {cache.delete(task.key); cache.set(task.key, hit); return lease(task, hit);}
    let runtime, closing, statusError, value;
    const close = () => runtime ? closing ||= Promise.resolve().then(() => runtime.dispose()) : Promise.resolve();
    const onAbort = () => {close().catch(() => {});}; task.abort.signal.addEventListener('abort', onAbort, {once: true});
    try {
      const canvas = createCanvas(); if (!canvas) throw unavailable('独立镜头渲染画布不可用');
      runtime = runtimeFactory({canvas, getState: () => task.state, getSourceResource: () => task.resource,
        getFence: () => ({shotId: task.shot.id, stageId: task.shot.stageId, setupId: task.shot.setupId}),
        isCurrent: () => !disposed && !task.abort.signal.aborted && task.isCurrent() === true,
        autoRender: false, canControlInput: () => false,
        onStatus(status) {if (status.status === 'failed') statusError = unavailable(status.error || '片场资源加载失败');}});
      check(task);
      if (!runtime || typeof runtime.sync !== 'function' || typeof runtime.renderPhoto !== 'function' || typeof runtime.dispose !== 'function') throw unavailable('独立片场渲染器不可用');
      const report = await wait(task, () => runtime.sync(task.state));
      if (statusError || report?.source?.status === 'failed' || report?.entities?.some(item => item.status !== 'ready')) throw statusError || unavailable('片场资源未就绪');
      if (task.resource && report?.source?.status !== 'ready') throw unavailable('片场源资源未就绪');
      const ratio = task.shot.camera.frameAspectRatio ?? automaticFrameAspectRatio(16 / 9), dimensions = cameraShotPreviewDimensions(ratio);
      const camera = opticalCamera(task.shot, runtime, ratio);
      const photo = await wait(task, () => runtime.renderPhoto(camera, {longEdge: dimensions.longEdge, frameAspectRatio: ratio}));
      if (statusError) throw statusError;
      if (!photo?.blob || photo.blob.type !== 'image/jpeg' || photo.blob.size <= 0 || photo.quality !== .92 || photo.width !== dimensions.width || photo.height !== dimensions.height || photo.width > 320 || photo.height > 180) throw unavailable('镜头渲染未返回有效 JPEG 缩略图');
      value = {blob: photo.blob, width: photo.width, height: photo.height};
    } finally {task.abort.signal.removeEventListener('abort', onAbort); await close();}
    check(task); const result = lease(task, value); store(task.key, value); return result;
  }
  function request(shot, {signal, isCurrent = () => true} = {}) {
    if (typeof isCurrent !== 'function' || signal && typeof signal.addEventListener !== 'function') return Promise.reject(new TypeError('Thumbnail request requires a current callback and optional AbortSignal'));
    const task = {abort: new AbortController(), isCurrent};
    try {
      if (signal?.aborted) task.abort.abort();
      check(task); task.shot = clone(shot); task.state = createCameraShotPreviewState(getState(), task.shot);
      const resource = getSourceResource(task.shot.stageId, task.shot); assertJson(resource, 'shot.resource'); task.resource = clone(resource);
      task.key = cacheKey(task.state, task.shot, task.resource);
    } catch (error) {return Promise.reject(error);}
    const onAbort = () => task.abort.abort(); signal?.addEventListener('abort', onAbort, {once: true}); if (signal?.aborted) onAbort(); tasks.add(task);
    const result = serial.then(() => render(task));
    serial = result.catch(() => {});
    return result.finally(() => {tasks.delete(task); signal?.removeEventListener('abort', onAbort);});
  }
  async function dispose() {
    if (disposed) return false; disposed = true;
    for (const task of tasks) task.abort.abort();
    cache.clear(); bytes = 0; for (const value of [...leases]) value.dispose(); await serial; return true;
  }
  return {request, dispose, get disposed() {return disposed;}, get cacheSize() {return cache.size;}, get cacheBytes() {return bytes;}};
}
