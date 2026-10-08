'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), {readFileSync} = require('node:fs'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/camera-manager.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((accept, fail) => {resolve = accept; reject = fail;}); return {promise, resolve, reject};}
const makeShots = () => [
  {id: 'wide', setupId: 'first', label: '全景', cameraId: 'camera-a', camera: {position: {x: 0, y: 2, z: 5}, rotation: {x: 0, y: 0, z: 0}, focalLength: 24, frameAspectRatio: 16 / 9}},
  {id: 'portrait', setupId: 'first', label: '肖像', camera: {position: {x: 1, y: 2, z: 3}, focalLength: 50, frameAspectRatio: 9 / 16}},
  {id: 'dynamic', setupId: 'second', label: '移动镜头', durationMs: 2400, camera: {focalLength: 35, frameAspectRatio: 3 / 2}}
];
async function fixture(overrides = {}) {
  const module = await modulePromise, dom = new JSDOM('<head></head><body><div class="studio-v3"></div></body>', {pretendToBeVisual: true});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  let state = {shots: makeShots(), setupLabels: {first: 'Default Setup', second: 'Example State'}, readOnly: false, busy: false, playing: false, activeCameraId: 'camera-a'};
  if (overrides.initialState) state = {...state, ...overrides.initialState};
  const calls = [], errors = [], thumbnails = [];
  const panel = module.createCameraManager({read: () => state,
    openShot: async shot => {calls.push({action: 'open', id: shot.id}); return overrides.openShot ? overrides.openShot(shot) : true;},
    renameShot: async (shot, name) => {calls.push({action: 'rename', id: shot.id, name}); if (overrides.renameShot) return overrides.renameShot(shot, name); state.shots = state.shots.map(item => item.id === shot.id ? {...item, label: name} : item); return true;},
    removeShot: async shot => {calls.push({action: 'remove', id: shot.id}); if (overrides.removeShot) return overrides.removeShot(shot); state.shots = state.shots.filter(item => item.id !== shot.id); return true;},
    exportShots: async shots => {calls.push({action: 'export', ids: shots.map(shot => shot.id), shots}); return overrides.exportShots ? overrides.exportShots(shots) : {ok: true};},
    loadThumbnail: async (shot, options) => {thumbnails.push({shot, options}); return overrides.loadThumbnail ? overrides.loadThumbnail(shot, options) : `data:image/png;base64,${shot.id}`;},
    close: () => calls.push({action: 'close'}), onError: error => errors.push(error)
  }); dom.window.document.querySelector('.studio-v3').append(panel);
  const shot = id => panel.querySelector(`[data-shot-id="${id}"]`), key = (target, key, options = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...options}); target.dispatchEvent(event); return event;};
  return {module, dom, panel, calls, errors, thumbnails, shot, key, get state() {return state;}, update(patch) {state = {...state, ...patch}; panel.refresh();}, button(label) {return panel.querySelector(`button[aria-label="${label}"]`);},
    batch() {panel.querySelector('.sv3-camera-manager-header button').click();}, choose(id) {const checkbox = shot(id).querySelector('input[type=checkbox]'); checkbox.click();},
    finish() {panel.dispose(); dom.window.close(); if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;}
  };
}

test('official grouping, metadata, aspect ratios, icons and native selection geometry are preserved', async () => {
  const f = await fixture(); try {
    await tick(); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); assert.deepEqual([...f.panel.querySelectorAll('h3')].map(node => node.textContent), ['状态1', '示例状态']);
    assert.equal(f.shot('wide').querySelector('.sv3-camera-manager-metadata').textContent, '24 mm'); assert.equal(f.shot('dynamic').querySelector('.sv3-camera-manager-metadata').textContent, '动态 · 2.4 秒 · 35 mm');
    assert.equal(f.shot('portrait').querySelector('.sv3-camera-manager-preview').style.aspectRatio, String(9 / 16)); assert.equal(f.shot('wide').dataset.active, 'true');
    assert.equal(f.button('重命名“全景”').querySelector('svg').getAttribute('width'), '14'); assert.equal(f.button('重命名“全景”').querySelector('svg').getAttribute('stroke-width'), '1.75'); assert.equal(f.button('删除“全景”').querySelector('svg').getAttribute('width'), '14');
    assert.equal(f.button('导出到画布').querySelector('svg').getAttribute('width'), '16'); assert.equal(f.button('导出到画布').querySelector('svg').getAttribute('stroke-width'), '1.9');
    assert.equal(f.panel.dataset.worldWorkspaceBlockMovementHotkeys, 'true'); assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-camera-manager]').length, 1);
    const css = readFileSync(require.resolve('../src/features/studio-v3/camera-manager.css'), 'utf8'); for (const geometry of ['width:560px', 'max-height:620px', 'border-radius:16px', 'blur(56px)', 'minmax(156px,1fr)', 'gap:12px', 'width:18px', 'height:28px']) assert(css.includes(geometry));
  } finally {f.finish();}
});
test('metadata uses real focal conversion and official setup labels without baseline substitution', async () => {
  const f = await fixture(); try {
    assert.equal(f.module.cameraManagerSetupLabel('State 3'), '状态3'); assert.equal(f.module.cameraManagerSetupLabel('Setup 12'), '状态12'); assert.equal(f.module.cameraManagerSetupLabel(''), '未命名状态'); assert.equal(f.module.cameraManagerSetupLabel('晨间状态'), '晨间状态');
    const optics = await import('../src/features/studio-v3/camera-optics.mjs'); assert.equal(f.module.cameraManagerMetadata({camera: {fov: optics.focalLengthToFov(85, 9 / 16), frameAspectRatio: 9 / 16}}), '85 mm');
  } finally {f.finish();}
});
test('normal item opens a real shot and false host result keeps manager with its error', async () => {
  const f = await fixture({openShot: () => ({ok: false, message: '机位仍在接管中'})}); try {
    f.shot('wide').querySelector('.sv3-camera-manager-open').click(); await tick(); assert.deepEqual(f.calls.map(call => call.action), ['open']); assert.equal(f.panel.querySelector('[role=alert]').textContent, '机位仍在接管中'); assert.equal(f.panel.hidden, false);
  } finally {f.finish();}
});
test('rename focuses and selects, trims accepted input, commits Enter and Blur once, and ignores IME', async () => {
  const f = await fixture(); try {
    f.button('重命名“全景”').click(); let input = f.panel.querySelector('.sv3-camera-manager-name'); assert.equal(f.dom.window.document.activeElement, input); assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, 2);
    input.value = '  新全景  '; f.key(input, 'Enter', {isComposing: true}); f.key(input, 'Enter', {keyCode: 229}); assert.equal(f.calls.length, 0);
    f.key(input, 'Enter'); input.dispatchEvent(new f.dom.window.Event('blur')); await tick(); assert.deepEqual(f.calls.map(call => [call.action, call.name]), [['rename', '新全景']]); assert.equal(f.shot('wide').querySelector('.sv3-camera-manager-title').textContent, '新全景'); assert.equal(f.panel.querySelector('.sv3-camera-manager-name'), null);
    f.button('重命名“肖像”').click(); input = f.panel.querySelector('.sv3-camera-manager-name'); input.value = '特写'; input.dispatchEvent(new f.dom.window.Event('blur')); await tick(); assert.equal(f.calls.at(-1).name, '特写');
  } finally {f.finish();}
});
test('rename cancellation and empty drafts do not mutate; rejected rename preserves draft and page', async () => {
  const f = await fixture({renameShot: () => false}); try {
    f.button('重命名“全景”').click(); let input = f.panel.querySelector('.sv3-camera-manager-name'); input.value = 'cancel'; f.key(input, 'Escape'); input.dispatchEvent(new f.dom.window.Event('blur')); await tick(); assert.equal(f.calls.length, 0);
    f.button('重命名“全景”').click(); input = f.panel.querySelector('.sv3-camera-manager-name'); input.value = '   '; f.key(input, 'Enter'); await tick(); assert.equal(f.calls.length, 0);
    f.button('重命名“全景”').click(); input = f.panel.querySelector('.sv3-camera-manager-name'); input.value = '新名称'; f.key(input, 'Enter'); await tick(); assert.equal(f.panel.querySelector('.sv3-camera-manager-name'), input); assert.equal(input.value, '新名称'); assert.equal(input.disabled, false); assert.equal(f.state.shots[0].label, '全景'); assert.equal(f.errors.length, 1);
  } finally {f.finish();}
});
test('rename completion and cancellation restore a live trigger, preserve new input focus, and use panel fallback when disabled', async () => {
  const f = await fixture(); try {
    assert.equal(f.panel.tabIndex, -1); f.button('重命名“全景”').click(); let input = f.panel.querySelector('.sv3-camera-manager-name'); input.value = '新全景'; f.key(input, 'Enter'); await tick();
    assert.equal(f.dom.window.document.activeElement, f.button('重命名“新全景”'));
    f.button('重命名“新全景”').click(); input = f.panel.querySelector('.sv3-camera-manager-name'); f.key(input, 'Escape'); assert.equal(f.dom.window.document.activeElement, f.button('重命名“新全景”'));
    f.button('重命名“新全景”').click(); f.button('重命名“肖像”').click(); input = f.panel.querySelector('.sv3-camera-manager-name'); assert.equal(input.value, '肖像'); assert.equal(f.dom.window.document.activeElement, input);
    f.update({busy: true}); f.key(input, 'Escape'); assert.equal(f.dom.window.document.activeElement, f.panel);
    f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
  } finally {f.finish();}
});
test('delete and batch Escape keep focus inside manager so a second Escape can close, including disabled-trigger fallback', async () => {
  const f = await fixture(); try {
    f.button('删除“全景”').click(); f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.dom.window.document.activeElement, f.button('删除“全景”'));
    f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
    f.button('删除“全景”').click(); f.update({busy: true}); f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.dom.window.document.activeElement, f.panel);
    f.update({busy: false}); f.batch(); const checkbox = f.shot('wide').querySelector('input[type=checkbox]'); checkbox.focus(); f.key(checkbox, 'Escape'); assert.equal(f.dom.window.document.activeElement, f.button('导出到画布'));
    f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
    f.batch(); f.update({busy: true}); f.panel.handleEscape(); assert.equal(f.dom.window.document.activeElement, f.panel); f.key(f.panel, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
  } finally {f.finish();}
});
test('delete requires the source confirmation, cancellation is local, and failure preserves confirmation', async () => {
  let reject = true; const f = await fixture({removeShot: () => !reject}); try {
    f.button('删除“全景”').click(); const confirmation = f.panel.querySelector('[role=alertdialog]'); assert.equal(confirmation.hidden, false); assert.equal(confirmation.querySelector('strong').textContent, '删除“全景”？'); assert.equal(confirmation.querySelector('p').textContent, '关联的机位和动画也会一并删除'); assert.equal(f.calls.length, 0);
    f.key(f.panel, 'Escape'); assert.equal(confirmation.hidden, true); assert.equal(f.calls.length, 0);
    f.button('删除“全景”').click(); confirmation.querySelector('button[aria-label=删除]').click(); await tick(); assert.equal(confirmation.hidden, false); assert.equal(f.errors.length, 1); assert(f.shot('wide'));
    reject = false; confirmation.querySelector('button[aria-label=删除]').click(); await tick(); assert.equal(confirmation.hidden, true); assert.equal(f.calls.length, 2);
  } finally {f.finish();}
});
test('readonly, busy, playback and stale shot callbacks enforce source permission boundaries', async () => {
  const f = await fixture(); try {
    f.update({playing: true}); assert.equal(f.button('删除“全景”').disabled, true); assert.equal(f.button('重命名“全景”').disabled, false); f.button('删除“全景”').onclick(); assert.equal(f.panel.querySelector('[role=alertdialog]').hidden, true);
    f.update({busy: true}); f.button('重命名“全景”').onclick(); f.shot('wide').querySelector('.sv3-camera-manager-open').onclick(); f.button('导出到画布').onclick(); assert.equal(f.calls.length, 0); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理');
    f.update({busy: false, readOnly: true}); assert.equal(f.panel.hidden, true); f.button('重命名“全景”').onclick(); assert.equal(f.calls.length, 0);
    f.update({readOnly: false}); const stale = f.shot('wide').querySelector('.sv3-camera-manager-open').onclick; f.update({shots: f.state.shots.slice(1)}); stale(); assert.equal(f.calls.length, 0);
  } finally {f.finish();}
});
test('batch has native label checkboxes, ordered export, select all, prunes stale selections and cancels locally', async () => {
  const f = await fixture(); try {
    f.batch(); assert.equal(f.panel.querySelector('header strong').textContent, '批量导出'); assert.equal(f.button('导出').disabled, true);
    assert.equal(f.shot('wide').querySelector('label input').type, 'checkbox'); assert.equal(f.shot('wide').querySelector('.sv3-camera-manager-actions').hidden, true);
    f.choose('dynamic'); f.choose('wide'); f.button('导出').click(); await tick(); assert.deepEqual(f.calls[0].ids, ['wide', 'dynamic']); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理');
    f.batch(); f.button('全选').click(); assert([...f.panel.querySelectorAll('input[type=checkbox]')].every(input => input.checked)); f.button('全选').click(); assert([...f.panel.querySelectorAll('input[type=checkbox]')].every(input => input.checked)); for (const id of ['wide', 'portrait', 'dynamic']) f.choose(id);
    f.choose('wide'); f.update({shots: f.state.shots.slice(1)}); assert.equal(f.button('导出').disabled, true); f.key(f.panel, 'Escape'); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); f.key(f.panel, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
  } finally {f.finish();}
});
test('partial export receipt freezes the same batch for idempotent host retry and busy blocks double export', async () => {
  const saved = deferred(); let attempt = 0; const f = await fixture({exportShots: async () => {if (++attempt === 1) throw Object.assign(Error('照片已加入画布，保存失败'), {applied: true, retryable: true}); return saved.promise;}}); try {
    f.batch(); f.choose('wide'); f.button('导出').click(); await tick(); assert.equal(f.panel.querySelector('header strong').textContent, '批量导出'); assert.equal(f.panel.querySelector('[role=alert]').textContent, '照片已加入画布，保存失败'); assert.equal(f.shot('wide').querySelector('input').disabled, true); assert.equal(f.button('全选').disabled, true);
    assert.equal(f.button('重试保存').disabled, false); f.button('重试保存').click(); assert.equal(f.button('重试保存').disabled, true); assert.equal(f.button('重试保存').textContent, '导出中…'); f.button('重试保存').onclick();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].shots, f.calls[1].shots); saved.resolve({ok: true}); await tick(); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); assert.equal(f.errors.length, 1);
  } finally {f.finish();}
});
test('host pending export rehydrates once on reopen with exact frozen batch and retry-save, without rerendering on retry', async () => {
  const saved = deferred(), f = await fixture({initialState: {pendingExportShotIds: ['dynamic', 'wide']}, exportShots: () => saved.promise}); try {
    await tick(); const thumbnails = f.thumbnails.length; assert.equal(f.panel.querySelector('header strong').textContent, '批量导出'); assert.equal(f.panel.querySelector('[role=alert]').textContent, '上次导出尚未保存，请重试保存');
    assert.equal(f.button('全选').disabled, true); assert.equal(f.button('重试保存').disabled, false); assert.equal(f.button('重试保存').textContent, '重试保存'); assert(f.shot('dynamic').querySelector('input').checked); assert(f.shot('wide').querySelector('input').checked); assert.equal(f.shot('portrait').querySelector('input').checked, false);
    f.button('重试保存').click(); assert.deepEqual(f.calls[0].ids, ['dynamic', 'wide']); assert.equal(f.button('重试保存').disabled, true); f.button('重试保存').onclick(); assert.equal(f.calls.length, 1);
    saved.resolve({ok: true}); await tick(); assert.equal(f.thumbnails.length, thumbnails); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); f.panel.refresh(); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理');
  } finally {f.finish();}
});
test('missing host pending export shot disables save with specific error and never substitutes a different batch', async () => {
  const f = await fixture({initialState: {pendingExportShotIds: ['wide', 'removed-shot']}}); try {
    assert.equal(f.button('重试保存').disabled, true); assert.equal(f.panel.querySelector('[role=alert]').textContent, '上次导出的镜头不存在，无法重试保存：removed-shot'); f.button('重试保存').onclick(); assert.equal(f.calls.length, 0);
    f.update({pendingExportShotIds: ['portrait']}); assert.equal(f.button('重试保存').disabled, true); assert(f.shot('wide').querySelector('input').checked); assert.equal(f.shot('portrait').querySelector('input').checked, false);
    f.update({busy: true}); f.key(f.panel, 'Escape'); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); f.panel.refresh(); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); f.key(f.panel, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
  } finally {f.finish();}
});
test('Escape dismisses confirm, rename, batch and panel even when busy; a late export cannot recreate cancelled UI receipt', async () => {
  const pending = deferred(), f = await fixture({exportShots: () => pending.promise}); try {
    f.button('删除“全景”').click(); f.update({busy: true}); f.panel.handleEscape(); assert.equal(f.panel.querySelector('[role=alertdialog]').hidden, true); assert.equal(f.calls.length, 0);
    f.update({busy: false}); f.button('重命名“全景”').click(); const input = f.panel.querySelector('.sv3-camera-manager-name'); f.update({busy: true}); f.key(input, 'Escape'); assert.equal(f.panel.querySelector('.sv3-camera-manager-name'), null); assert.equal(f.calls.length, 0);
    f.update({busy: false}); f.batch(); f.choose('wide'); f.button('导出').click(); assert.equal(f.button('导出').disabled, true);
    f.key(f.panel, 'Escape'); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); f.key(f.panel, 'Escape'); assert.equal(f.calls.at(-1).action, 'close');
    pending.reject(Object.assign(Error('宿主保留receipt'), {applied: true, retryable: true})); await tick(); assert.equal(f.panel.querySelector('header strong').textContent, '镜头管理'); assert.equal(f.button('导出到画布').disabled, false);
  } finally {f.finish();}
});
test('real thumbnails load strictly serially, obsolete results are released and changed camera gets a fresh preview', async () => {
  const first = deferred(), second = deferred(), third = deferred(), fourth = deferred(); let index = 0, active = 0, maxActive = 0, released = 0;
  const f = await fixture({loadThumbnail: async () => {active++; maxActive = Math.max(maxActive, active); const result = await [first, second, third, fourth][index++].promise; active--; return result;}}); try {
    assert.equal(f.thumbnails.length, 1); const aborted = f.thumbnails[0].options.signal; const shots = f.state.shots.map(shot => shot.id === 'wide' ? {...shot, camera: {...shot.camera, focalLength: 85}} : shot); f.update({shots}); assert.equal(aborted.aborted, true);
    first.resolve({url: 'data:image/png;base64,stale', dispose: () => released++}); await tick(); assert.equal(released, 1); assert.equal(f.thumbnails[1].shot.id, 'portrait'); assert.equal(f.shot('wide').querySelector('img'), null);
    second.resolve('data:image/png;base64,portrait'); await tick(); assert.equal(f.thumbnails[2].shot.id, 'dynamic'); third.resolve('data:image/png;base64,dynamic'); await tick(); assert.equal(maxActive, 1); assert.equal(f.thumbnails.at(-1).shot.camera.focalLength, 85);
    fourth.resolve('data:image/png;base64,fresh85'); await tick(); assert.equal(f.shot('wide').querySelector('img').getAttribute('src'), 'data:image/png;base64,fresh85'); assert.equal(active, 0);
  } finally {f.finish();}
});
test('thumbnail failure is honest, disposing aborts pending work and releases every late result without applying it', async () => {
  const late = deferred(); let calls = 0, released = 0;
  const f = await fixture({loadThumbnail: async () => {if (++calls === 1) throw Error('WebGL不可用'); return late.promise;}}); try {
    await tick(); assert.equal(f.shot('wide').querySelector('.sv3-camera-manager-preview').textContent, '预览不可用'); assert.equal(f.shot('wide').querySelector('img'), null); const signal = f.thumbnails[1].options.signal;
    f.panel.dispose(); assert.equal(signal.aborted, true); late.resolve({url: 'data:image/png;base64,late', dispose: () => released++}); await tick(); assert.equal(released, 1); assert.equal(f.shot('portrait').querySelector('img'), null); assert.equal(calls, 2);
  } finally {f.finish();}
});
test('empty manager uses official copy and hides export; dispose fences outstanding action results', async () => {
  const pending = deferred(), f = await fixture({openShot: () => pending.promise}); try {
    f.shot('wide').querySelector('.sv3-camera-manager-open').click(); f.panel.dispose(); pending.reject(Error('迟到的失败')); await tick(); assert.equal(f.errors.length, 0);
  } finally {f.finish();}
  const empty = await fixture(); try {empty.update({shots: []}); assert.equal(empty.panel.querySelector('.sv3-camera-manager-empty').textContent, '暂无镜头'); assert.equal(empty.button('导出到画布').hidden, true);} finally {empty.finish();}
});
