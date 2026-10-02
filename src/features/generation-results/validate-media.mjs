import {assertReadableResultMedia} from './media-ref.mjs';

// Resolve and decode before creating nodes. A late asset lookup must not start a
// new network request after the validation has already timed out.
export async function validateResultMedia(output, {
  resolveSource = source => globalThis.window?.LocalAssets?.url(source) || source,
  createMedia = type => type === 'image' ? new Image() : document.createElement('video'),
  timeoutMs = 20000,
} = {}) {
  if (!['image', 'video'].includes(output.type)) return;
  assertReadableResultMedia(output);
  const source = output.type === 'video' ? output.video || output.url : output.fullImage || output.image || output.url;
  const media = createMedia(output.type);
  let settled = false;
  try {
    await new Promise((resolve, reject) => {
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => finish(Error('生成媒体读取超时')), timeoutMs);
      media.onerror = () => finish(Error('生成媒体无法读取'));
      if (output.type === 'image') {
        media.onload = () => finish(media.naturalWidth > 0 && media.naturalHeight > 0 ? null : Error('图片内容为空'));
      } else {
        media.preload = 'metadata';
        media.onloadedmetadata = () => finish(media.videoWidth > 0 && media.videoHeight > 0 && Number.isFinite(media.duration) && media.duration > 0 ? null : Error('视频内容无效'));
      }
      Promise.resolve().then(() => resolveSource(source)).then(url => {
        if (settled) return;
        if (typeof url !== 'string' || !url) return finish(Error('生成媒体无法读取'));
        media.src = url;
      }).catch(finish);
    });
    if (output.type === 'video') Object.assign(output, {width: media.videoWidth, height: media.videoHeight, duration: media.duration});
    else Object.assign(output, {width: media.naturalWidth, height: media.naturalHeight});
  } finally {
    settled = true;
    media.onload = media.onerror = media.onloadedmetadata = null;
    media.removeAttribute('src');
    if (output.type === 'video') media.load();
  }
}
