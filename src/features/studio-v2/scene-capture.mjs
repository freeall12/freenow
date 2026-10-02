import {ShotRenderer} from './shot-renderer.mjs';

export async function captureScene(runtime) {
  runtime.assertReady();
  if (runtime.capturing) throw Error('镜头正在拍摄，请等待完成');
  const shotId = runtime.shotId, revision = runtime.revision;
  if (!runtime.find(shotId)?.isCamera) throw Error('请先添加并选择拍摄镜头');
  const assertCurrent = () => {
    runtime.assertReady();
    if (runtime.revision !== revision || runtime.shotId !== shotId ||
        !window.CanvasApp.getState().nodes.some(node => node.id === runtime.nodeId)) {
      throw Error('来源片场或镜头已改变，本次拍摄未添加到画布');
    }
  };
  runtime.capturing = true;
  let shot;
  try {
    await runtime.flush();
    assertCurrent();
    const canvas = document.createElement('canvas');
    shot = new ShotRenderer(runtime, canvas);
    shot.renderer.setPixelRatio(1);
    const camera = shot.camera();
    if (!camera) throw Error('拍摄镜头已不存在');
    const aspect = camera.isPerspectiveCamera ? camera.aspect :
      (camera.right - camera.left) / (camera.top - camera.bottom);
    if (!Number.isFinite(aspect) || aspect <= 0) throw Error('拍摄画幅无效');
    // Keep the requested projection without exporting the free-view camera or UI helpers.
    const width = aspect >= 1 ? 1280 : Math.max(1, Math.round(1280 * aspect));
    const height = aspect >= 1 ? Math.max(1, Math.round(1280 / aspect)) : 1280;
    const provenance = {
      kind: 'studio-render', sceneId: runtime.nodeId, sceneVersion: 2,
      revision, shotId, animation: runtime.playback.index,
      playbackTarget: runtime.playback.target, time: runtime.playback.time
    };
    runtime.updateLighting();
    if (!shot.render({width, height}) || shot.renderer.getContext().isContextLost()) {
      throw Error('镜头渲染失败，请重新打开片场后重试');
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value?.size && value.type === 'image/png' ? resolve(value) :
        reject(Error('PNG 编码失败，未添加拍摄结果')), 'image/png');
    });
    assertCurrent();
    const image = await window.LocalAssets.put(blob);
    assertCurrent();
    const nodes = window.CanvasApp.createConnected(runtime.nodeId, [{
      type: 'image', title: '3D 片场拍摄', image, width, height,
      pixelWidth: width, pixelHeight: height, provenance, createdAt: new Date().toISOString()
    }]);
    const nodeId = nodes[0]?.id;
    if (!nodeId) throw Error('画布未创建拍摄节点');
    try { await window.CanvasStore.flush(); }
    catch (cause) {
      const error = new Error('拍摄图片已添加，但画布保存失败：' + cause.message, {cause});
      error.applied = true;
      error.nodeId = nodeId;
      throw error;
    }
    return {nodeId, width, height};
  } finally {
    shot?.dispose();
    runtime.capturing = false;
  }
}
