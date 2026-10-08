import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';

export const PHOTO_HISTORY_NOTICE = '以下历史照片仅供查看。新拍摄的照片会直接添加到画布，不再保存在片场中。';
export const PHOTO_HISTORY_LAYOUT = Object.freeze({thumbnailWidth: 160, fallbackHeight: 76, closeDuration: 160, topPadding: 136, bottomPadding: 72, mediaHeightInset: 196});
const composing = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const aborted = () => Object.assign(Error('历史照片预览已取消'), {name: 'AbortError'});
// Source Bw -> index.fd -> tabler x_n/Xeo, at index offset 4263526.
const historicalNoticeIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/></svg>';

/** Refuse remote image navigation before assigning src. Resolution never grants
 * permission to download a missing legacy photograph from an external service. */
export function assertLocalPhotoURL(value, baseURL) {
  if (typeof value !== 'string' || !value.trim()) throw Error('历史照片没有可用的本地图片');
  if (/^data:image\//i.test(value)) return value;
  let url, base; try {base = new URL(baseURL); url = new URL(value, base);} catch {throw Error('历史照片本地图片地址无效');}
  const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (url.protocol === 'file:' || url.protocol === 'blob:' && (url.origin === base.origin || url.origin === 'null') || ['http:', 'https:'].includes(url.protocol) && url.origin === base.origin && loopback(url.hostname)) return value;
  throw Error('历史照片未保存在本地，无法查看');
}
function loadStyle(document) {
  const href = new URL('photo-history.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioV3PhotoHistory = ''; document.head.append(link);
}
async function decodeNative(image, signal) {
  if (signal.aborted) throw aborted(); let onAbort;
  const cancel = new Promise((_, reject) => {onAbort = () => reject(aborted()); signal.addEventListener('abort', onAbort, {once: true});});
  try {
    const decoding = typeof image.decode === 'function' ? image.decode() : image.complete && image.naturalWidth > 0 ? Promise.resolve() : new Promise((resolve, reject) => {image.onload = resolve; image.onerror = () => reject(Error('历史照片无法解码'));});
    await Promise.race([decoding, cancel]);
    if (signal.aborted) throw aborted();
    if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw Error('历史照片无法解码');
  } finally {signal.removeEventListener('abort', onAbort); image.onload = image.onerror = null;}
}

/** Original S2 / yk gallery: immutable saved images, never camera renders. */
export function createPhotoHistory({read, resolveImage, assets = globalThis.window?.LocalAssets, onOpen = () => {}, onClose = () => {}, onError = () => {}} = {}) {
  if (typeof read !== 'function') throw TypeError('历史照片相册需要 read');
  const root = el('section', 'sv3-photo-history'), document = root.ownerDocument, view = document.defaultView;
  root.element = root; root.ready = Promise.resolve([]); root.tabIndex = -1; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '历史照片'); root.dataset.worldWorkspaceBlockMovementHotkeys = 'true'; loadStyle(document);
  const backdrop = button(null, '关闭遮罩', () => requestClose(), {className: 'sv3-photo-history-backdrop'}); backdrop.setAttribute('aria-label', '关闭遮罩'); backdrop.tabIndex = -1;
  const header = el('div', 'sv3-photo-history-header'), capsule = el('div', 'sv3-capsule'), closeButton = button(null, '关闭相册', () => requestClose()); closeButton.title = '关闭相册并返回片场'; closeButton.setAttribute('aria-label', '关闭相册'); closeButton.innerHTML = icon('back', {size: 20, strokeWidth: 1.75}); closeButton.autofocus = true; capsule.append(closeButton); header.append(capsule);
  const stage = el('div', 'sv3-photo-history-stage'), composition = el('div', 'sv3-photo-history-composition'), notice = el('div', 'sv3-photo-history-notice'), noteIcon = el('span'), main = el('section', 'sv3-photo-history-main'), aside = el('aside', 'sv3-photo-history-aside'), strip = el('div', 'sv3-photo-history-strip'), feedback = el('div', 'sv3-photo-history-feedback');
  const noticeId = `sv3-photo-history-notice-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`; notice.id = noticeId; notice.setAttribute('role', 'note'); root.setAttribute('aria-describedby', noticeId); noteIcon.innerHTML = historicalNoticeIcon; notice.append(noteIcon, el('span', '', PHOTO_HISTORY_NOTICE));
  feedback.setAttribute('role', 'status'); feedback.hidden = true; aside.append(strip); composition.append(notice, main, aside); stage.append(composition); root.append(backdrop, header, stage, feedback);
  let disposed = false, closing = false, closed = false, index = 0, items = [], signature = null, timer = null, frame = null, releaseOpen = null;
  const records = new Map(), listeners = [];
  const listen = (target, type, handler, options) => {target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options));};
  const report = error => {if (!disposed) onError(error);};
  const release = result => {try {result?.dispose?.();} catch (error) {report(error);}};
  const releaseLease = () => {const action = releaseOpen; releaseOpen = null; try {action?.();} catch (error) {report(error);}};
  const sourceOf = photo => photo.src ?? photo.localSrc;
  const resolve = resolveImage || (async photo => {
    for (const source of [sourceOf(photo), photo.localSrc]) {
      if (typeof source !== 'string' || !source) continue;
      if (source.startsWith('asset:')) {if (typeof assets?.url !== 'function') throw Error('历史照片本地素材解析不可用'); return assets.url(source);}
      try {return assertLocalPhotoURL(source, document.baseURI);} catch { /* An actual local copy may follow the original remote reference. */ }
    }
    throw Error('历史照片未保存在本地，无法查看');
  });
  const keyOf = (photo, position) => JSON.stringify([photo.id, position]);
  function disposeRecord(rec) {rec.controller.abort(); rec.result && release(rec.result); rec.result = null; rec.thumbnail.onclick = null; rec.image?.removeAttribute('src'); rec.thumbnail.querySelector('img')?.removeAttribute('src');}
  function measure() {
    if (disposed) return; const image = main.querySelector('img'), bounds = image?.getBoundingClientRect();
    aside.style.height = bounds?.height > 0 ? `${Math.max(bounds.height, 76)}px` : ''; strip.dataset.centered = String(strip.scrollHeight <= strip.clientHeight + 1);
  }
  function paint() {
    if (disposed) return; const current = items[index], rec = current && records.get(current.key); main.replaceChildren(); feedback.hidden = true;
    if (rec?.status === 'ready') {main.append(rec.image); root.dataset.preview = 'ready';}
    else if (rec?.status === 'error') {root.dataset.preview = 'error'; feedback.textContent = rec.error.message || String(rec.error); feedback.hidden = false;}
    else root.dataset.preview = 'loading';
    root.dataset.index = String(index); for (const [key, record] of records) {const active = current?.key === key; record.thumbnail.dataset.active = String(active); record.thumbnail.setAttribute('aria-pressed', String(active));}
    measure();
  }
  function select(next) {if (disposed || closing || !items.length) return; index = Math.max(0, Math.min(items.length - 1, next)); paint();}
  function makeRecord(photo, key) {
    const thumbnail = button(null, `历史照片 ${photo.sequence ?? ''}`, () => select(items.findIndex(item => item.key === key)), {className: 'sv3-photo-history-thumbnail'}), height = photo.width > 0 && photo.height > 0 ? Math.round(160 * photo.height / photo.width) : 76;
    thumbnail.setAttribute('aria-label', `历史照片 ${photo.sequence ?? ''}`.trim()); thumbnail.style.width = '160px'; thumbnail.style.height = `${height}px`;
    const rec = {photo, key, thumbnail, controller: new AbortController(), result: null, image: null, status: 'loading'}; records.set(key, rec);
    rec.ready = (async () => {
      let result; try {
        result = await resolve(photo, {signal: rec.controller.signal});
        if (disposed || rec.controller.signal.aborted || records.get(key) !== rec) {release(result); return false;}
        const url = assertLocalPhotoURL(typeof result === 'string' ? result : result?.url, document.baseURI), image = document.createElement('img'); image.alt = ''; image.draggable = false; image.src = url;
        await decodeNative(image, rec.controller.signal);
        if (disposed || rec.controller.signal.aborted || records.get(key) !== rec) {image.removeAttribute('src'); release(result); return false;}
        rec.result = result; rec.image = image; rec.status = 'ready';
        const thumb = document.createElement('img'); thumb.src = url; thumb.alt = ''; thumb.draggable = false; thumbnail.append(thumb); paint(); return true;
      } catch (error) {
        release(result); if (disposed || rec.controller.signal.aborted || records.get(key) !== rec) return false;
        rec.status = 'error'; rec.error = error; report(error); paint(); return false;
      }
    })(); return rec;
  }
  function finishClose() {
    if (disposed || closed) return; closed = true; root.hidden = true; releaseLease(); onClose();
  }
  function requestClose(immediate = false) {
    if (disposed) return false; if (closing) return true; closing = true; root.dataset.visible = 'false';
    if (immediate) finishClose(); else timer = view.setTimeout(() => {timer = null; finishClose();}, 160); return true;
  }
  function refresh() {
    if (disposed || closed || closing) return;
    try {
      const original = read(); if (!Array.isArray(original)) throw TypeError('历史照片 read 必须返回原图片数组');
      const reversed = [...original].reverse(), nextSignature = JSON.stringify(reversed.map(photo => [photo.id, photo.src, photo.localSrc, photo.width, photo.height, photo.sequence]));
      if (!reversed.length) {requestClose(true); return;}
      if (signature === nextSignature) return; signature = nextSignature;
      for (const rec of records.values()) disposeRecord(rec); records.clear(); strip.replaceChildren();
      items = reversed.map((photo, position) => ({photo, key: keyOf(photo, position)})); index = Math.max(0, Math.min(index, items.length - 1));
      for (const item of items) strip.append(makeRecord(item.photo, item.key).thumbnail);
      root.ready = Promise.all([...records.values()].map(rec => rec.ready)); paint();
    } catch (error) {feedback.textContent = error.message || String(error); feedback.hidden = false; report(error);}
  }
  listen(root, 'keydown', event => {
    if (event.defaultPrevented || composing(event) || event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')) {event.stopPropagation(); return;}
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); requestClose();}
    else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {event.preventDefault(); event.stopPropagation(); select(index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1));}
  });
  // Source gallery does not prove a focus trap. This local modal boundary keeps
  // Tab and Escape from reaching the paused workspace's capture listeners.
  listen(view, 'keydown', event => {
    if (disposed || closed || event.defaultPrevented || composing(event)) return;
    if (event.key === 'Escape' && !event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')) {event.preventDefault(); event.stopPropagation(); requestClose(); return;}
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(node => node.tabIndex >= 0 && !node.closest('[hidden],[inert],[aria-hidden="true"]'));
    event.preventDefault(); event.stopPropagation();
    const current = focusable.indexOf(document.activeElement), next = current < 0 ? event.shiftKey ? focusable.length - 1 : 0 : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    (focusable[next] || root).focus({preventScroll: true});
  }, true);
  for (const type of ['keyup', 'pointerdown', 'pointermove', 'pointerup', 'click', 'wheel', 'contextmenu']) listen(root, type, event => event.stopPropagation());
  listen(view, 'resize', measure); root.refresh = refresh; root.handleEscape = () => requestClose();
  root.dispose = () => {
    if (disposed) return; disposed = true; if (frame !== null) view.cancelAnimationFrame(frame); if (timer !== null) view.clearTimeout(timer); releaseLease(); for (const rec of records.values()) disposeRecord(rec); records.clear();
    for (const remove of listeners) remove(); backdrop.onclick = closeButton.onclick = null; closeButton.disabled = true;
  };
  refresh();
  if (!closing) {
    try {const cleanup = onOpen(); releaseOpen = typeof cleanup === 'function' ? cleanup : cleanup?.release ? () => cleanup.release() : null;} catch (error) {report(error);}
    frame = view.requestAnimationFrame(() => {frame = null; if (!disposed && !closing) {root.dataset.visible = 'true'; if (root.isConnected) closeButton.focus({preventScroll: true});}});
  }
  return root;
}
