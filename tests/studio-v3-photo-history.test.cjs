'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), {readFileSync} = require('node:fs'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}}; const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/photo-history.mjs'), tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((accept, fail) => {resolve = accept; reject = fail;}); return {promise, resolve, reject};}
const photos = () => [{id: 'old', sequence: 9, width: 640, height: 360, source: 'camera', src: 'asset:old-photo', cameraState: {focalLength: 24}}, {id: 'middle', sequence: 3, width: 0, height: 0, src: 'asset:middle-photo'}, {id: 'new', sequence: 1, width: 360, height: 640, source: 'possession', src: 'asset:new-photo', cameraState: {focalLength: 85}}];
async function fixture(options = {}) {
  const module = await modulePromise, dom = new JSDOM('<head></head><body><div class="studio-v3"></div></body>', {pretendToBeVisual: true, url: 'http://localhost:9234/'}), previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  let items = options.items || photos(), opens = 0, closes = 0, releases = 0; const errors = [], resolved = [], decoded = [], timers = new Map(), frames = new Map(); let nextTimer = 0, nextFrame = 0;
  dom.window.setTimeout = (action, duration) => {timers.set(++nextTimer, {action, duration}); return nextTimer;}; dom.window.clearTimeout = id => timers.delete(id);
  dom.window.requestAnimationFrame = action => {frames.set(++nextFrame, action); return nextFrame;}; dom.window.cancelAnimationFrame = id => frames.delete(id);
  dom.window.HTMLImageElement.prototype.decode = async function () {decoded.push(this.getAttribute('src')); if (options.decode) await options.decode(this); Object.defineProperty(this, 'naturalWidth', {value: options.zeroPixels ? 0 : 640}); Object.defineProperty(this, 'naturalHeight', {value: options.zeroPixels ? 0 : 360});};
  const gallery = module.createPhotoHistory({read: () => items,
    assets: {url: async source => {resolved.push(source); return options.assetURL ? options.assetURL(source) : `http://localhost:9234/assets/${source.slice(6)}.png`;}},
    ...(options.resolveImage ? {resolveImage: options.resolveImage} : {}),
    onOpen: () => {opens++; return () => releases++;}, onClose: () => closes++, onError: error => errors.push(error)
  }); dom.window.document.querySelector('.studio-v3').append(gallery.element);
  const key = (target, key, extra = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...extra}); target.dispatchEvent(event); return event;};
  return {module, dom, gallery, errors, resolved, decoded, timers, frames, key, get items() {return items;}, get opens() {return opens;}, get closes() {return closes;}, get releases() {return releases;},
    refresh(next) {items = next; gallery.refresh();}, frame() {for (const [id, action] of [...frames]) {frames.delete(id); action(0);}}, closeTimers() {for (const [id, task] of [...timers]) {timers.delete(id); task.action();}},
    finish() {gallery.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}

test('gallery preserves official reverse-array order, real local image decoding, notice and ratio thumbnail geometry without authoring controls', async () => {
  const f = await fixture(); try {
    const original = JSON.stringify(f.items); await f.gallery.ready; f.frame(); assert.equal(f.gallery.element, f.gallery); assert.equal(f.gallery.getAttribute('role'), 'dialog'); assert.equal(f.gallery.getAttribute('aria-modal'), 'true'); assert.equal(f.gallery.getAttribute('aria-label'), '历史照片');
    assert.deepEqual([...f.gallery.querySelectorAll('.sv3-photo-history-thumbnail')].map(item => item.getAttribute('aria-label')), ['历史照片 1', '历史照片 3', '历史照片 9']); assert.equal(f.gallery.dataset.index, '0'); assert.equal(f.gallery.querySelector('.sv3-photo-history-main img').src, 'http://localhost:9234/assets/new-photo.png');
    assert.equal(f.decoded.length, 3); assert.equal(f.gallery.querySelector('.sv3-photo-history-thumbnail').style.width, '160px'); assert.equal(f.gallery.querySelector('.sv3-photo-history-thumbnail').style.height, '284px'); assert.equal(f.gallery.querySelectorAll('.sv3-photo-history-thumbnail')[1].style.height, '76px');
    assert.equal(f.gallery.querySelector('[role=note]').textContent, f.module.PHOTO_HISTORY_NOTICE); assert.equal(f.dom.window.document.activeElement, f.gallery.querySelector('button[aria-label=关闭相册]')); assert.equal(f.gallery.querySelector('button[aria-label=关闭相册] svg').getAttribute('stroke-width'), '1.75');
    assert.equal(f.gallery.querySelector('button[aria-label=关闭相册] path').getAttribute('d'), 'm12 19-7-7 7-7'); assert.equal(f.gallery.querySelector('[role=note] path:last-child').getAttribute('d'), 'M11 12h1v4h1'); assert.equal(f.gallery.querySelector('.sv3-photo-history-backdrop').getAttribute('aria-label'), '关闭遮罩');
    assert.equal(f.gallery.querySelector('button[aria-label*=导出],button[aria-label*=删除],button[aria-label*=下载],input'), null); assert.equal(JSON.stringify(f.items), original); assert.equal(f.opens, 1); assert.equal(f.gallery.dataset.worldWorkspaceBlockMovementHotkeys, 'true');
    const css = readFileSync(require.resolve('../src/features/studio-v3/photo-history.css'), 'utf8'); for (const style of ['z-index:82', 'blur(32px)', 'width:160px', '100vw - 220px', '100vh - 196px', 'border-radius:6px']) assert(css.includes(style));
  } finally {f.finish();}
});
test('gallery navigation clamps, thumbnail click selects, and refresh never sorts by sequence or mutates camera data', async () => {
  const f = await fixture(); try {
    await f.gallery.ready; f.key(f.gallery, 'ArrowLeft'); assert.equal(f.gallery.dataset.index, '0'); f.key(f.gallery, 'ArrowDown'); assert.equal(f.gallery.dataset.index, '1'); f.key(f.gallery, 'ArrowRight'); f.key(f.gallery, 'ArrowRight'); assert.equal(f.gallery.dataset.index, '2');
    f.gallery.querySelector('.sv3-photo-history-thumbnail').click(); assert.equal(f.gallery.dataset.index, '0'); f.key(f.gallery, 'ArrowUp'); assert.equal(f.gallery.dataset.index, '0');
    const decoded = f.decoded.length; f.gallery.refresh(); assert.equal(f.decoded.length, decoded); f.key(f.gallery, 'ArrowRight'); f.key(f.gallery, 'ArrowRight'); f.refresh([f.items[0]]); await f.gallery.ready; assert.equal(f.gallery.dataset.index, '0'); assert.equal(f.gallery.querySelector('.sv3-photo-history-main img').src, 'http://localhost:9234/assets/old-photo.png');
  } finally {f.finish();}
});
test('escape, backdrop and repeated close share the original 160ms once boundary and release pause lease once', async () => {
  const f = await fixture(); try {
    await f.gallery.ready; assert.equal(f.gallery.handleEscape(), true); assert.equal(f.closes, 0); assert.equal([...f.timers.values()][0].duration, 160); f.gallery.querySelector('.sv3-photo-history-backdrop').click(); f.gallery.handleEscape(); assert.equal(f.timers.size, 1);
    f.closeTimers(); assert.equal(f.closes, 1); assert.equal(f.releases, 1); assert.equal(f.gallery.hidden, true); f.gallery.dispose(); assert.equal(f.releases, 1); assert.equal(f.gallery.handleEscape(), false);
  } finally {f.finish();}
});
test('empty data closes immediately and disposal releases host pause lease without late close callbacks', async () => {
  const f = await fixture(); try {await f.gallery.ready; f.refresh([]); assert.equal(f.closes, 1); assert.equal(f.releases, 1); assert.equal(f.gallery.hidden, true);} finally {f.finish();}
  const g = await fixture(); try {g.gallery.handleEscape(); g.gallery.dispose(); g.closeTimers(); assert.equal(g.releases, 1); assert.equal(g.closes, 0); assert.equal(g.frames.size, 0);} finally {g.finish();}
});
test('IME and editable fields keep gallery navigation local; image interaction does not close its backdrop', async () => {
  const f = await fixture(); try {
    await f.gallery.ready; f.key(f.gallery, 'Escape', {isComposing: true}); f.key(f.gallery, 'ArrowRight', {keyCode: 229}); assert.equal(f.timers.size, 0); assert.equal(f.gallery.dataset.index, '0');
    const input = f.dom.window.document.createElement('input'); f.gallery.append(input); assert.equal(f.key(input, 'ArrowRight').defaultPrevented, false); assert.equal(f.key(input, 'Escape').defaultPrevented, false); assert.equal(f.timers.size, 0);
    f.gallery.querySelector('.sv3-photo-history-main img').click(); assert.equal(f.timers.size, 0); f.key(f.gallery, 'Escape'); assert.equal(f.timers.size, 1);
  } finally {f.finish();}
});
test('modal Tab cycles only live gallery controls and Escape never reaches background capture listeners', async () => {
  const f = await fixture(); try {
    await f.gallery.ready; f.frame(); const close = f.gallery.querySelector('button[aria-label=关闭相册]'), thumbnails = [...f.gallery.querySelectorAll('.sv3-photo-history-thumbnail')];
    assert.equal(f.key(close, 'Tab').defaultPrevented, true); assert.equal(f.dom.window.document.activeElement, thumbnails[0]);
    thumbnails.at(-1).focus(); f.key(thumbnails.at(-1), 'Tab'); assert.equal(f.dom.window.document.activeElement, close);
    f.key(close, 'Tab', {shiftKey: true}); assert.equal(f.dom.window.document.activeElement, thumbnails.at(-1));
    const outside = f.dom.window.document.createElement('button'); f.dom.window.document.body.append(outside); outside.focus(); f.key(outside, 'Tab'); assert.equal(f.dom.window.document.activeElement, close);
    let background = 0; f.dom.window.document.addEventListener('keydown', () => background++, true); const escape = f.key(close, 'Escape'); assert.equal(escape.defaultPrevented, true); assert.equal(background, 0); assert.equal(f.timers.size, 1);
  } finally {f.finish();}
});
test('original remote photos are refused before src and asset resolution, while a real local copy may be decoded', async () => {
  const f = await fixture({items: [{id: 'remote', src: 'https://official.example/photos/x.jpg', width: 100, height: 50}]}); try {
    assert.deepEqual(await f.gallery.ready, [false]); assert.equal(f.resolved.length, 0); assert.equal(f.decoded.length, 0); assert.equal(f.gallery.querySelector('img'), null); assert.equal(f.gallery.dataset.preview, 'error'); assert.match(f.gallery.querySelector('[role=status]').textContent, /未保存在本地/);
    f.refresh([{id: 'local-copy', src: 'https://official.example/photos/x.jpg', localSrc: '/assets/readable.png'}]); await f.gallery.ready; assert.equal(f.gallery.querySelector('.sv3-photo-history-main img').getAttribute('src'), '/assets/readable.png');
  } finally {f.finish();}
});
test('an adapter cannot promote remote URLs or zero decoded pixels into a successful preview', async () => {
  const f = await fixture({resolveImage: async () => 'https://official.example/photos/x.jpg'}); try {assert.deepEqual(await f.gallery.ready, [false, false, false]); assert.equal(f.decoded.length, 0); assert.equal(f.gallery.querySelector('img'), null);} finally {f.finish();}
  const g = await fixture({zeroPixels: true}); try {assert.deepEqual(await g.gallery.ready, [false, false, false]); assert.equal(g.gallery.querySelector('img'), null); assert.match(g.gallery.querySelector('[role=status]').textContent, /无法解码/);} finally {g.finish();}
});
test('obsolete and disposed local URL results are cancelled and released instead of replacing the current photograph', async () => {
  const old = deferred(); let released = 0, oldSignal;
  const f = await fixture({items: [photos()[0]], resolveImage: async (photo, {signal}) => {if (photo.id === 'old') {oldSignal = signal; return old.promise;} return {url: '/assets/current.png', dispose: () => released++};}}); try {
    f.refresh([photos()[2]]); assert.equal(oldSignal.aborted, true); await f.gallery.ready; old.resolve({url: '/assets/obsolete.png', dispose: () => released++}); await tick(); assert.equal(released, 1); assert.equal(f.gallery.querySelector('.sv3-photo-history-main img').getAttribute('src'), '/assets/current.png');
    f.gallery.dispose(); assert.equal(released, 2); assert.equal(f.errors.length, 0);
  } finally {f.finish();}
});
test('disposal interrupts actual image decoding and releases the resolved local URL without reporting cancelled work', async () => {
  const decode = deferred(); let released = 0; const f = await fixture({items: [photos()[0]], decode: () => decode.promise, resolveImage: async () => ({url: '/assets/loading.png', dispose: () => released++})}); try {
    await tick(); f.gallery.dispose(); assert.deepEqual(await f.gallery.ready, [false]); assert.equal(released, 1); decode.resolve(); await tick(); assert.equal(f.gallery.querySelector('img'), null); assert.equal(f.errors.length, 0);
  } finally {f.finish();}
});
