import * as THREE from 'three';
import {assertState} from './schema.mjs';
import {renderSetup} from './world-space.mjs';
import {listCameraShots} from './camera-shots.mjs';
import {createStudioV3Runtime} from './runtime.mjs';
import {applyCameraOptics} from './camera-optics.mjs';
import {encodeShotWebM, ShotVideoUnsupportedError} from './webm-encoder.mjs';

export const SHOT_EXPORT = Object.freeze({still: {width: 4096, height: 2304, type: 'image/jpeg', quality: .92},
  video: {width: 1280, height: 720, fps: 30}, contactFrames: 6});
const fail = (code, message) => Object.assign(new Error(message), {code});
const copy = value => structuredClone(value);
const abort = signal => {if (signal?.aborted) throw signal.reason || new DOMException('镜头导出已取消', 'AbortError');};
const createCanvas = () => globalThis.document?.createElement('canvas');
const titleOf = shot => `S${String(shot.index + 1).padStart(2, '0')}${shot.title ? ` ${shot.title}` : ''}`;

/** Official F0 cover: retain optical aspect and crop, never stretch its pixels. */
export function drawShotCover(context, image, width, height, left = 0, top = 0) {
  const sourceWidth = image?.displayWidth ?? image?.width, sourceHeight = image?.displayHeight ?? image?.height;
  if (!(sourceWidth > 0 && sourceHeight > 0) || !context?.drawImage) throw fail('studio_v3_shot_frame', '镜头渲染没有返回真实画面');
  const scale = Math.max(width / sourceWidth, height / sourceHeight), drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  context.save?.(); context.beginPath?.(); context.rect?.(left, top, width, height); context.clip?.();
  try {context.fillStyle = '#000'; context.fillRect(left, top, width, height); context.drawImage(image, left + (width - drawWidth) / 2, top + (height - drawHeight) / 2, drawWidth, drawHeight);}
  finally {context.restore?.();}
}
function outputCanvas(factory, width, height) {
  const canvas = factory(); if (!canvas) throw fail('studio_v3_shot_canvas', '镜头导出需要本地 canvas');
  canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', {alpha: false});
  if (!context) throw fail('studio_v3_shot_canvas', '无法创建镜头输出画布'); return {canvas, context};
}
async function canvasBlob(canvas, type, quality, check) {
  check(); const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value?.size ? resolve(value) : reject(fail('studio_v3_shot_encode', '镜头图片编码没有返回内容')), type, quality));
  check(); if (blob.type !== type) throw fail('studio_v3_shot_encode', '图片实际编码格式与导出请求不符'); return blob;
}
function cameraFrom(config, runtime) {
  const camera = new THREE.PerspectiveCamera(); applyCameraOptics(camera, config);
  const {position, rotation} = config; camera.position.set(position.x, position.y, position.z); camera.rotation.set(rotation.x, rotation.y, rotation.z, rotation.order || 'XYZ'); const look = config.lookAt;
  const target = look?.mode === 'point' ? new THREE.Vector3(look.target.x, look.target.y, look.target.z) : look?.mode === 'entity' ? runtime?.entityObject?.(look.entityId)?.getWorldPosition(new THREE.Vector3()) : null;
  if (target) camera.lookAt(target); camera.updateMatrixWorld(true); return camera;
}

/** Render-only: no asset store, canvas node, network provider or save operation. */
export function createCameraShotExporter({getState, getSourceResource = () => null, isCurrent = () => true, getFence = () => null,
  onProgress = () => {}, runtimeFactory = createStudioV3Runtime, canvasFactory = createCanvas,
  sampleState = async (state, shot, timeMs) => {
    if (shot.kind !== 'dynamic' && !shot.setup.entityStates.some(item => item.entityId === shot.cameraEntityId && item.camera)) {
      const {createCameraShotPreviewState} = await import('./camera-shot-preview.mjs');
      return {state: createCameraShotPreviewState(state, shot), camera: copy(shot.camera)};
    }
    return (await import('./camera-shot-sampling.mjs')).sampleCameraShotState(state, shot, timeMs);
  },
  encodeVideo = encodeShotWebM, encoderOptions = {}} = {}) {
  if (typeof getState !== 'function') throw new TypeError('Camera shot export requires a state snapshot adapter');
  for (const adapter of [getSourceResource, isCurrent, getFence, onProgress, runtimeFactory, canvasFactory, sampleState, encodeVideo]) if (typeof adapter !== 'function') throw new TypeError('Camera shot exporter adapters must be functions');
  let disposed = false, active = null;
  function progress(task, phase, details = {}) {try {onProgress({phase, shotId: task.shot.id, title: titleOf(task.shot), ...details});} catch { /* Observers cannot change export ownership. */ }}
  async function render(requestedShot, {signal, state: suppliedState} = {}) {
    if (disposed) throw fail('studio_v3_shot_export_closed', '镜头导出器已关闭');
    if (active) throw fail('studio_v3_shot_export_busy', '镜头正在导出，请等待当前镜头完成');
    abort(signal); const state = copy(suppliedState ?? getState()); assertState(state);
    const shot = listCameraShots(state, {stageId: requestedShot?.stageId, setupId: requestedShot?.setupId}).find(item => item.id === requestedShot?.id);
    if (!shot) throw fail('studio_v3_shot_export_missing', '镜头不在已捕获的状态快照中');
    const fence = copy(getFence()), resource = copy(getSourceResource(shot.stageId)), controller = new AbortController();
    const cancelled = () => controller.abort(signal.reason || new DOMException('镜头导出已取消', 'AbortError'));
    if (signal?.aborted) cancelled(); else signal?.addEventListener('abort', cancelled, {once: true});
    const task = {shot, state, fence, resource, controller}; active = task; let runtime, frameState = state, pendingRender = null, previousFrameTime = null;
    const check = () => {
      abort(controller.signal);
      if (disposed || active !== task || !isCurrent() || JSON.stringify(getFence()) !== JSON.stringify(fence)) throw fail('studio_v3_shot_export_stale', '来源片场或镜头导出所有权已变化');
    };
    const provenance = extra => ({kind: 'studio-v3-camera-shot', worldNodeId: state.scenePlay.worldNodeId, shotId: shot.id, setupId: shot.setupId, cameraEntityId: shot.cameraEntityId, renderer: 'independent-photographic', ...extra});
    async function frame(timeMs, longEdge) {
      check(); const sampled = await sampleState(state, shot, timeMs); check();
      if (!sampled?.camera || !sampled.state) throw fail('studio_v3_shot_sample', '镜头时间采样没有返回摄像机与实体状态');
      frameState = sampled.state; assertState(frameState);
      // Sampling a valid domain relationship does not make it renderable. Do
      // not publish an unheld prop as though the authored attachment existed.
      if (renderSetup(frameState).entityStates.some(item => item.heldEntityId)) throw fail('studio_v3_shot_render_unsupported', '当前本地渲染器尚未实现持握关系，无法忠实导出此镜头');
      const report = await runtime.sync(frameState); check();
      if (report?.source?.status === 'failed' || report?.entities?.some(item => item.status === 'failed')) throw fail('studio_v3_shot_resource_failed', '镜头模型未全部成功加载，无法导出不完整画面');
      if (sampled.camera.depthOfFieldMode === 'aperture' && runtime.depthOfFieldSupported !== true) throw fail('studio_v3_shot_render_unsupported', '当前普通模型渲染器尚未实现光圈景深，请使用深景或支持景深的 Gaussian 场景');
      const delta = previousFrameTime === null ? 0 : Math.max(0, (timeMs - previousFrameTime) / 1000); previousFrameTime = timeMs;
      runtime.graph?.tick?.(delta);
      const camera = shot.cameraEntityId ? runtime.entityCamera(shot.cameraEntityId) : null, optical = camera || cameraFrom(sampled.camera, runtime);
      // The photographic adapter preserves this camera's optical frame ratio;
      // fixed 16:9 output is composed below with the official cover crop.
      const rendered = await runtime.renderPhoto(optical, {longEdge, encode: false, signal: controller.signal, optics: sampled.camera}); check();
      if (!rendered?.canvas) throw fail('studio_v3_shot_frame', '片场没有返回离屏 GPU 画面'); return rendered.canvas;
    }
    const renderFrame = (timeMs, edge) => {pendingRender = frame(timeMs, edge); return pendingRender.finally(() => {pendingRender = null;});};
    try {
      check(); progress(task, 'preparing', {progress: 0});
      const runtimeCanvas = canvasFactory(); if (!runtimeCanvas) throw fail('studio_v3_shot_canvas', '无法创建独立片场画布');
      runtime = runtimeFactory({canvas: runtimeCanvas, getState: () => frameState, getSourceResource: () => resource, getFence: () => fence,
        isCurrent: () => {try {check(); return true;} catch {return false;}}, autoRender: false});
      const still = SHOT_EXPORT.still;
      if (shot.kind !== 'dynamic') {
        const image = await renderFrame(0, still.width), output = outputCanvas(canvasFactory, still.width, still.height);
        drawShotCover(output.context, image, still.width, still.height); progress(task, 'encoding', {progress: .9});
        const blob = await canvasBlob(output.canvas, still.type, still.quality, check); check(); progress(task, 'completed', {progress: 1});
        return [{type: 'image', blob, width: still.width, height: still.height, title: titleOf(shot), provenance: provenance({exportKind: 'still', mimeType: blob.type})}];
      }
      if (!shot.cameraEntityId || !shot.setup.entityStates.some(item => item.entityId === shot.cameraEntityId && item.camera) || !(shot.durationMs > 0)) throw fail('studio_v3_shot_dynamic_camera', '动态镜头必须关联状态中的真实摄像机和有效时长');
      const video = SHOT_EXPORT.video, output = outputCanvas(canvasFactory, video.width, video.height); let posterBlob;
      try {
        const result = await encodeVideo({...encoderOptions, width: video.width, height: video.height, fps: video.fps, durationMs: shot.durationMs, signal: controller.signal, check,
          async drawFrame(timeMs) {
            const image = await renderFrame(timeMs, video.width); drawShotCover(output.context, image, video.width, video.height);
            if (!posterBlob) posterBlob = await canvasBlob(output.canvas, still.type, still.quality, check); return output.canvas;
          }, onProgress: info => progress(task, 'rendering', info)});
        check(); if (!(result?.blob instanceof Blob) || !result.blob.size || !result.blob.type.startsWith('video/webm')) throw fail('studio_v3_shot_video_result', '镜头编码没有返回真实 WebM 视频');
        if (result.width !== video.width || result.height !== video.height || result.fps !== video.fps || result.durationMs !== shot.durationMs) throw fail('studio_v3_shot_video_result', '视频实际尺寸或帧率与镜头导出合同不符');
        progress(task, 'completed', {progress: 1});
        return [{type: 'video', blob: result.blob, posterBlob, width: result.width, height: result.height, duration: result.durationMs / 1000, title: titleOf(shot),
          provenance: provenance({exportKind: 'video', mimeType: result.blob.type, codec: result.codec, fps: result.fps, frameCount: result.frameCount, durationMs: result.durationMs})}];
      } catch (error) {
        check(); if (!(error instanceof ShotVideoUnsupportedError)) throw error;
        progress(task, 'contact-sheet', {progress: 0, reason: error.message});
        const contact = outputCanvas(canvasFactory, still.width, still.height), count = SHOT_EXPORT.contactFrames;
        for (let index = 0; index < count; index++) {
          check(); const image = await renderFrame(index / (count - 1) * shot.durationMs, still.height), left = Math.round(index * still.width / count), right = Math.round((index + 1) * still.width / count);
          drawShotCover(contact.context, image, right - left, still.height, left); progress(task, 'contact-sheet', {frame: index + 1, total: count, progress: (index + 1) / count});
        }
        const blob = await canvasBlob(contact.canvas, 'image/webp', .82, check); check(); progress(task, 'completed', {progress: 1});
        return [{type: 'image', blob, width: still.width, height: still.height, duration: shot.durationMs / 1000, title: titleOf(shot),
          provenance: provenance({exportKind: 'contact-sheet', fallbackReason: 'native-video-codec-unavailable', frameCount: count, sampleTimesMs: Array.from({length: count}, (_, index) => index / (count - 1) * shot.durationMs), mimeType: blob.type})}];
      }
    } finally {
      signal?.removeEventListener('abort', cancelled);
      // An interrupted encoder may still have an in-flight GPU readback. Keep
      // that renderer alive until its draw settles, then dispose exactly once.
      try {await pendingRender?.catch(() => {}); await runtime?.dispose();} finally {if (active === task) active = null;}
    }
  }
  return {render, get busy() {return active !== null;}, dispose() {if (disposed) return false; disposed = true; active?.controller.abort(fail('studio_v3_shot_export_closed', '镜头导出器已关闭')); return true;}};
}
