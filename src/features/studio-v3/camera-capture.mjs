import {assertJson, clone, same} from './invariants.mjs';
import {assertCamera} from './schema.mjs';

export const CAMERA_CAPTURE_MAX_EDGE = 4096;
const failure = (code, message) => Object.assign(new Error(message), {code});
const boundary = fence => {const {revision, editEpoch, ...identity} = fence; return identity;};

/** Crop the fitted optical frame, preserving its aspect and native detail.
 * Official ii caps the long edge at 4096. A viewport capture cannot synthesize
 * the reference's offscreen 4K detail, so this path never enlarges its pixels. */
export function cameraCaptureGeometry(width, height, aspect) {
  if (![width, height, aspect].every(value => Number.isFinite(value) && value > 0)) {
    throw failure('studio_v3_capture_frame', '拍摄画幅或画布尺寸无效');
  }
  const sourceWidth = Math.min(width, height * aspect), sourceHeight = sourceWidth / aspect;
  const scale = Math.min(1, CAMERA_CAPTURE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  return {left: (width - sourceWidth) / 2, top: (height - sourceHeight) / 2,
    sourceWidth, sourceHeight, width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale))};
}

export function createCameraCapture({app, session, runtime, nodeId, getFence = session?.getFence,
  isCurrent = session?.isCurrent, onStatus = () => {}, assets = globalThis.window?.LocalAssets,
  createCanvas = () => (runtime.renderer?.domElement?.ownerDocument || globalThis.document).createElement('canvas'),
  createId = () => crypto.randomUUID(), now = Date.now} = {}) {
  for (const [name, value] of Object.entries({getFence, isCurrent, onStatus, createCanvas, createId, now})) {
    if (typeof value !== 'function') throw new TypeError(`cameraCapture.${name} requires a callback`);
  }
  for (const [name, value] of Object.entries({getState: app?.getState, createConnected: app?.createConnected,
    saveProject: app?.saveProject, flush: session?.flush, read: session?.getState, renderCapture: runtime?.renderCapture,
    setCapturing: runtime?.setCapturing, getVisibleCameraState: runtime?.getVisibleCameraState, put: assets?.put})) {
    if (typeof value !== 'function') throw new TypeError(`cameraCapture.${name} requires an adapter`);
  }
  if (typeof nodeId !== 'string' || !nodeId) throw new TypeError('cameraCapture.nodeId requires the Studio owner');
  let busy = false, disposed = false, receipt = null;
  const emit = status => {try {onStatus({status, busy, ...publicReceipt()});} catch {}};
  const publicReceipt = () => receipt ? {captureId: receipt.captureId, nodeId: receipt.nodeId,
    applied: !!receipt.nodeId, width: receipt.width, height: receipt.height} : {};
  const nodes = () => app.getState().nodes;
  const owner = () => nodes().find(node => node.id === nodeId);
  const ready = () => {
    if (disposed || runtime.disposed || !isCurrent() || !owner()) throw failure('studio_v3_capture_stale', '片场所有权或来源已变化，本次拍摄停止');
    if (session.history?.getActiveTransaction?.()) throw failure('studio_v3_capture_transaction', '请先完成或还原当前片场编辑，再拍摄');
  };
  const scope = () => {
    const state = session.getState(), space = state.scenePlay.worldSpace;
    return {worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId, source: clone(space.source)};
  };
  const check = (item, full = false) => {
    ready();
    if (owner() !== item.owner || !same(boundary(getFence()), item.boundary) || !same(scope(), item.scope) ||
        full && (!same(getFence(), item.fence) || runtime.camera !== item.camera || !same(runtime.getVisibleCameraState(), item.cameraState))) {
      throw failure('studio_v3_capture_stale', '来源、状态或镜头已变化，本次照片未继续写入');
    }
    if (item.nodeId) {
      const image = nodes().find(node => node.id === item.nodeId);
      if (!image || image.type !== 'image' || image.image !== item.asset || image.pixelWidth !== item.width ||
          image.pixelHeight !== item.height || !same(image.provenance, item.provenance)) {
        throw failure('studio_v3_capture_receipt_stale', '拍摄图片已删除或修改，不能重复创建或覆盖它');
      }
    }
    return true;
  };
  const durableScene = async () => {
    const result = await session.flush();
    if (!result?.ok || result.readonly || session.getStatus?.().dirty) throw failure('studio_v3_capture_scene_save', '片场尚未成功保存，照片未创建');
    ready();
  };
  async function render() {
    if (runtime.possessing) {
      if (typeof runtime.checkpointCameraControl !== 'function' || await runtime.checkpointCameraControl() !== true) {
        throw failure('studio_v3_capture_checkpoint', '当前镜头编辑尚未提交，照片未创建');
      }
    }
    ready();
    // Saving the committed director pose precedes all external picture writes.
    // The checkpoint keeps the possession camera and viewport lease in place.
    await durableScene(); runtime.setCapturing(true);
    const camera = runtime.camera, cameraState = clone(runtime.getVisibleCameraState());
    if (!camera?.isPerspectiveCamera) throw failure('studio_v3_capture_camera', '请使用摄像机或取景器拍摄，平面视图不能拍摄');
    assertJson(cameraState, 'capture.camera'); assertCamera(cameraState, 'capture.camera');
    const aspect = cameraState.frameAspectRatio ?? camera.aspect;
    const captureId = createId(), createdAt = now();
    if (typeof captureId !== 'string' || !captureId || !Number.isFinite(createdAt) || createdAt < 0) throw failure('studio_v3_capture_identity', '拍摄标识或时间无效');
    const fence = clone(getFence()), scene = scope(), sourceCameraEntityId = runtime.possessing?.entityId ?? runtime.previewCameraEntityId ?? null;
    const item = {captureId, createdAt, owner: owner(), fence, boundary: boundary(fence), scope: scene,
      camera, cameraState, sourceCameraEntityId, source: runtime.possessing ? 'possession' : 'camera', nodeId: null, asset: null, blob: null};
    emit('rendering');
    const rendered = await runtime.renderCapture(camera); check(item, true);
    if (runtime.renderer?.getContext?.().isContextLost?.()) throw failure('studio_v3_capture_context', '镜头渲染已中断，照片未创建');
    const frame = cameraCaptureGeometry(rendered?.width, rendered?.height, aspect), output = createCanvas();
    output.width = frame.width; output.height = frame.height;
    const context = output.getContext('2d');
    if (!context) throw failure('studio_v3_capture_encode', '照片画布不可用，照片未创建');
    // Copy immediately; an invalidation can repaint the shared renderer canvas
    // after this task yields. Crop black mattes instead of stretching them.
    context.drawImage(rendered, frame.left, frame.top, frame.sourceWidth, frame.sourceHeight, 0, 0, frame.width, frame.height);
    emit('encoding');
    const blob = await new Promise((resolve, reject) => {
      try {output.toBlob(value => value?.size && value.type === 'image/png' ? resolve(value) : reject(failure('studio_v3_capture_encode', 'PNG 编码失败，照片未创建')), 'image/png');}
      catch (error) {reject(error);}
    });
    check(item, true); Object.assign(item, {blob, width: frame.width, height: frame.height});
    item.provenance = {kind: 'studio-render', sceneId: nodeId, sceneVersion: 3, captureId,
      source: item.source, sourceNodeId: fence.sourceBinding?.sourceNodeId ?? nodeId,
      sourceKind: fence.sourceBinding?.sourceKind ?? 'studio', stageId: scene.stageId, setupId: scene.setupId,
      sourceCameraEntityId, camera: clone(cameraState), revision: fence.revision, createdAt};
    assertJson(item.provenance, 'capture.provenance'); receipt = item;
  }
  async function publish() {
    const item = receipt; check(item, !item.nodeId);
    if (!item.asset) {
      emit('saving-asset'); const asset = await assets.put(item.blob); check(item, true);
      if (typeof asset !== 'string' || !asset.startsWith('asset:') || asset.length <= 6) {
        throw failure('studio_v3_capture_asset', 'PNG 未保存为本地素材，照片未创建');
      }
      item.asset = asset;
    }
    if (!item.nodeId) {
      check(item, true); emit('adding-to-canvas');
      try {
        const added = app.createConnected(nodeId, [{type: 'image', title: '3D 世界拍摄照片', image: item.asset,
          width: item.width, height: item.height, pixelWidth: item.width, pixelHeight: item.height,
          provenance: clone(item.provenance), createdAt: new Date(item.createdAt).toISOString()}]);
        item.nodeId = added?.[0]?.id ?? null;
      } catch (error) {
        // createConnected mutates synchronously before rebuild. If rebuild
        // throws, retain the already applied image for an idempotent retry.
        const applied = nodes().filter(node => node.provenance?.captureId === item.captureId);
        if (applied.length === 1) item.nodeId = applied[0].id;
        throw error;
      }
      if (!item.nodeId) throw failure('studio_v3_capture_node', '画布未创建拍摄图片节点');
    }
    check(item); emit('saving-canvas');
    // flush alone would replay a failed latestSave. saveProject creates a fresh
    // guarded snapshot and then awaits CanvasStore.flush, including its queue.
    await app.saveProject({beforeCommit: () => {try {return check(item);} catch {return false;}}});
    check(item);
    const result = {ok: true, captureId: item.captureId, nodeId: item.nodeId, asset: item.asset,
      width: item.width, height: item.height, provenance: clone(item.provenance)};
    receipt = null; emit('saved'); return result;
  }
  return Object.freeze({
    async capture() {
      if (busy) throw failure('studio_v3_capture_busy', '镜头正在拍摄，请等待完成');
      busy = true; emit(receipt ? 'retrying' : 'preparing');
      try {
        if (receipt) {ready(); check(receipt, !receipt.nodeId); await durableScene(); runtime.setCapturing(true);}
        else {if (disposed || !isCurrent()) ready(); await render();}
        return await publish();
      } catch (error) {
        if (receipt) Object.assign(error, publicReceipt(), {retryable: !disposed && isCurrent()});
        emit('failed'); throw error;
      } finally {
        if (!runtime.disposed) {try {runtime.setCapturing(false);} catch {}}
        busy = false; emit('idle'); if (disposed) receipt = null;
      }
    },
    dispose() {disposed = true; if (!busy) receipt = null;},
    get busy() {return busy;},
    get pendingReceipt() {return receipt ? clone(publicReceipt()) : null;}
  });
}
