import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {icons as queueIcons} from '../agent-queue/icons.mjs';

function localSource(value, document) {
  if (typeof value !== 'string' || !value.trim()) throw Error('附件资源缺失');
  if (/^asset:[^\s]+$/.test(value)) return value;
  const url = new URL(value, document.baseURI);
  if (url.protocol === 'blob:' && url.origin === new URL(document.baseURI).origin || /^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
  if (['http:', 'https:'].includes(url.protocol) && url.origin === new URL(document.baseURI).origin && !url.username && !url.password) return url.href;
  throw Error('附件尚未导入本地');
}

// Message attachments are retained data, never permission to fetch their old
// remote URLs. Blob URL ownership remains with the shared LocalAssets cache.
export function createMessageAttachments(items, {document = globalThis.document, assets = document.defaultView?.LocalAssets} = {}) {
  const element = document.createElement('div');element.className = 'agent-message-attachments';element.setAttribute('aria-label', '消息附件');
  let disposed = false;const releases = [];
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const thumb = document.createElement('div');thumb.className = 'agent-message-attachment';
    const name = typeof item.name === 'string' && item.name || '附件';thumb.title = name;thumb.setAttribute('role', 'img');thumb.setAttribute('aria-label', name);
    const type = typeof item.mime === 'string' ? item.mime.startsWith('video/') ? 'video' : item.mime.startsWith('image/') ? 'image' : 'file' : item.type;
    const fallback = reason => {
      if (disposed) return;
      thumb.dataset.state = 'unavailable';thumb.dataset.reason = reason;thumb.dataset.media = 'false';thumb.innerHTML = type === 'video' ? referenceIcons.video : queueIcons.file;
      thumb.querySelector('svg')?.setAttribute('aria-hidden', 'true');thumb.setAttribute('aria-label', name + '（预览不可用）');
    };
    fallback('loading');thumb.dataset.state = 'loading';element.append(thumb);
    if (!['image', 'video'].includes(type)) {fallback('unsupported');continue;}
    let media = null;
    releases.push(() => {if (!media) return;media.onerror = null;media.onload = null;media.onloadeddata = null;if (type === 'video') {media.pause();media.removeAttribute('src');media.load();}else media.removeAttribute('src');});
    Promise.resolve().then(async () => {
      if (disposed) return;
      const source = localSource(item.asset, document);
      const url = source.startsWith('asset:') ? await assets?.url(source) : source;
      if (disposed) return;
      const safe = localSource(url, document);if (safe.startsWith('asset:')) throw Error('附件资源未能解析');
      media = document.createElement(type === 'video' ? 'video' : 'img');
      const loaded = () => {if (!disposed && thumb.firstElementChild === media) {thumb.dataset.state = 'ready';thumb.setAttribute('aria-label', name);}};
      media.onerror = () => {if (!disposed) {media.onerror = null;if (type === 'video') {media.pause();media.removeAttribute('src');media.load();}fallback('decode_failed');}};
      if (type === 'video') {media.muted = true;media.playsInline = true;media.preload = 'metadata';media.onloadeddata = loaded;media.src = safe.replace(/#.*$/, '') + '#t=0.1';}
      else {media.alt = '';media.decoding = 'async';media.onload = loaded;media.src = safe;}
      thumb.dataset.media = 'true';thumb.replaceChildren(media);
    }).catch(() => {if (!disposed) fallback('source_unavailable');});
  }
  return {element, destroy() {if (disposed) return;disposed = true;releases.forEach(release => release());element.remove();}};
}
