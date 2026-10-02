// Runs inside the opaque widget only. The host still owns confirmation and writes.
function installMediaBridge(nonce) {
  const pending = new Map();
  window.tapnow.uploadToCanvas = function (blob, options = {}) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > 80 * 1024 * 1024 ||
      !['image/png', 'video/mp4', 'video/webm'].includes(blob.type.split(';')[0]) || blob.type==='image/png'&&blob.size>32*1024*1024) return Promise.reject(Error('请选择 PNG（最大32 MiB）、MP4 或 WebM（最大80 MiB）'));
    if (pending.size) return Promise.reject(Error('请先处理当前待加入画布的媒体'));
    if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['filename', 'duration', 'fps'].includes(key))) return Promise.reject(Error('媒体交接参数无效'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(requestId);reject(Error('媒体交接等待超时，请重新点击加入画布'));}, 300000);
      pending.set(requestId, {resolve, reject, timer});
      window.parent.postMessage({type: 'uploadToCanvas', nonce, requestId, blob, options}, '*');
    });
  };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== 'uploadToCanvasResult' || data.nonce !== nonce) return;
    const item = pending.get(data.requestId);if (!item) return;
    pending.delete(data.requestId);clearTimeout(item.timer);
    if (data.error) item.reject(Error(String(data.error)));else item.resolve(data.result);
  });
}
export const mediaBridgeSource = nonce => `(${installMediaBridge.toString()})(${JSON.stringify(nonce)});`;
