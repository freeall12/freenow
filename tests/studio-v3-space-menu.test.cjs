'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/space-menu.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const room = {kind: 'mesh-preset', preset: 'room'};
async function fixture(options = {}) {
  const api = await modulePromise, dom = new JSDOM('<head></head><body><div class="studio-v3" id="root"><button id="anchor">场地</button></div></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value: dom.window.document, configurable: true, writable: true});
  const snapshot = {source: room, roomConfig: {width: 5.123456, depth: 12, height: 3.2, trackingGuides: {enabled: true, lineMarkers: false, mode: 'standard', spacingMeters: .5}}, busy: false, scenes: [], hasOriginal: true, ...options.snapshot};
  const sourceCalls = [], patches = [], errors = [], closes = [], phases = [];
  const anchor = dom.window.document.querySelector('#anchor'); anchor.focus();
  const merge = patch => {snapshot.roomConfig = {...snapshot.roomConfig, ...patch, trackingGuides: {...snapshot.roomConfig.trackingGuides, ...patch.trackingGuides}};};
  const node = api.createSpaceMenu({read: () => snapshot,
    setSource: async source => {sourceCalls.push(source); if (options.setSource) return options.setSource(source); snapshot.source = source; return {ok: true};},
    updateRoom: async patch => {patches.push(patch); if (options.updateRoom) return options.updateRoom(patch, merge); merge(patch); return {ok: true};},
    beginRoomEdit: async () => {phases.push('begin'); if (options.beginRoomEdit) return options.beginRoomEdit({snapshot, phases, merge}); const before = structuredClone(snapshot.roomConfig); return {
      onMove: patch => {phases.push(['move', patch]); merge(patch); return true;}, onEnd: () => {phases.push('end'); return true;}, onCancel: () => {phases.push('cancel'); snapshot.roomConfig = before; return true;}
    };}, resolveThumbnail: options.resolveThumbnail, close: () => closes.push(true), onError: error => errors.push(error)});
  dom.window.document.querySelector('#root').append(node);
  const query = selector => node.querySelector(selector), input = key => query(`[data-room-dimension="${key}"]`);
  const key = (target, value, props = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...props}); target.dispatchEvent(event); return event;};
  const emit = (target, type, props = {}) => {const event = new dom.window.Event(type, {bubbles: true, cancelable: true}); for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, {value}); target.dispatchEvent(event); return event;};
  const edit = (field, value) => {const target = input(field); target.parentElement.querySelector('button').click(); target.value = value; emit(target, 'input'); return target;};
  return {api, dom, node, snapshot, sourceCalls, patches, errors, closes, phases, anchor, merge, query, input, key, emit, edit,
    settings: () => query('[aria-label="房间 设置"]').click(),
    finish() {node.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}};
}

test('official exponential sizes, limits and local date/label search', async () => {
  const {roomScrubValue, filterSpaceScenes} = await modulePromise;
  assert.equal(roomScrubValue(5, 160, 1, 100), 10); assert.equal(roomScrubValue(5, -160, 1, 100), 2.5);
  assert.equal(roomScrubValue(5, 1200, 1, 100, 'wheel'), 10); assert.equal(roomScrubValue(19, 160, 2, 20), 20);
  assert.equal(roomScrubValue(2, -10000, 1, 100), 1); assert.throws(() => roomScrubValue(NaN, 3, 1, 100));
  const scenes = [{id: 'a', label: '片场 A', createdAtLabel: '创建于 10月8日', threedMeta: {src: '/a.glb'}}, {id: 'b', label: 'Garden', threedMeta: {src: '/b.spz'}}, {id: 'image', label: '片场图片'}];
  assert.deepEqual(filterSpaceScenes(scenes, '10月8日').map(item => item.id), ['a']); assert.deepEqual(filterSpaceScenes(scenes, ' GARDEN ').map(item => item.id), ['b']); assert.equal(filterSpaceScenes(scenes).length, 2);
});
test('source choices use exact domain shapes and close only after accepted result', async () => {
  for (const [selector, expected] of [['[data-space-source=empty]', {kind: 'empty'}], ['[data-space-source=original]', {kind: 'world-asset'}], ['[data-space-source=room]', room]]) {
    const f = await fixture({snapshot: {source: {kind: 'empty'}}}); try {
      if (selector.includes('original')) f.query('[data-space-source=world]').click();
      f.query(selector).click(); await tick();
      if (expected.kind === 'empty') assert.equal(f.sourceCalls.length, 0); else assert.deepEqual(f.sourceCalls, [expected]);
      assert.equal(f.closes.length, 1); assert.equal(f.dom.window.document.activeElement, f.anchor);
    } finally {f.finish();}
  }
  const f = await fixture({setSource: async () => ({ok: false, message: '场地保存失败'})}); try {
    f.query('[data-space-source=empty]').click(); await tick(); assert.equal(f.closes.length, 0); assert.equal(f.snapshot.source.kind, 'mesh-preset'); assert.match(f.node.textContent, /场地保存失败/);
  } finally {f.finish();}
});
test('exact draft commits once without rounding authored values; refresh preserves draft and pending', async () => {
  let accept;
  const pending = new Promise(resolve => {accept = resolve;});
  const f = await fixture({updateRoom: async (patch, merge) => {await pending; merge(patch); return {ok: true};}}); try {
    f.settings(); const input = f.input('width'); input.parentElement.querySelector('button').click(); input.focus(); f.emit(input, 'blur'); assert.equal(f.patches.length, 0); assert.equal(f.snapshot.roomConfig.width, 5.123456);
    f.edit('width', '7.654321'); f.node.refresh(); assert.equal(input.value, '7.654321'); f.key(input, 'Enter');
    assert.deepEqual(f.patches, [{width: 7.654321}]); assert.equal(input.readOnly, true); f.node.refresh(); assert.equal(input.value, '7.654321');
    f.emit(input, 'change'); f.emit(input, 'blur'); f.key(input, 'Enter'); assert.equal(f.patches.length, 1); accept(); await tick();
    assert.equal(f.snapshot.roomConfig.width, 7.654321); assert.equal(input.value, '7.7'); assert.equal(input.readOnly, false); f.emit(input, 'blur'); assert.equal(f.patches.length, 1);
  } finally {f.finish();}
});
test('invalid/rejected drafts keep errors and text; Escape cancels draft then pane then menu; IME does not commit', async () => {
  const f = await fixture({updateRoom: async () => ({ok: false, message: '房间保存失败'})}); try {
    f.settings(); const input = f.edit('width', 'bad'); f.key(input, 'Enter'); await tick();
    assert.equal(f.patches.length, 0); assert.equal(input.value, 'bad'); assert.match(f.node.textContent, /有效数值/); f.node.refresh(); assert.equal(input.value, 'bad');
    f.edit('width', '9'); f.key(input, 'Enter'); await tick(); assert.equal(input.value, '9'); assert.equal(f.errors.length, 2); assert.match(f.node.textContent, /房间保存失败/);
    f.key(input, 'Escape'); assert.equal(input.value, '5.1'); assert.equal(f.query('.sv3-space-secondary').hidden, false); assert.equal(f.closes.length, 0);
    f.key(input, 'Escape'); assert.equal(f.query('.sv3-space-secondary').hidden, true); assert.equal(f.dom.window.document.activeElement, f.query('[aria-label="房间 设置"]'));
    f.key(f.dom.window.document.activeElement, 'Escape'); assert.equal(f.closes.length, 1);
  } finally {f.finish();}
  const ime = await fixture(); try {
    ime.settings(); const input = ime.edit('height', '10'); ime.emit(input, 'compositionstart'); ime.key(input, 'Enter', {isComposing: true}); ime.key(input, 'Escape', {keyCode: 229}); ime.emit(input, 'blur');
    assert.equal(ime.patches.length, 0); assert.equal(ime.closes.length, 0); ime.emit(input, 'compositionend'); ime.key(input, 'Enter'); await tick(); assert.equal(ime.snapshot.roomConfig.height, 10);
  } finally {ime.finish();}
});
test('room guide patches merge without dropping dimensions, white hides markers, disabled pattern hides options', async () => {
  const f = await fixture(); try {
    f.settings(); f.query('[aria-label="样式 全白"]').click(); await tick(); assert.deepEqual(f.patches[0], {trackingGuides: {mode: 'white'}}); assert.equal(f.query('[aria-label="线标注"]').parentElement.hidden, true);
    assert.equal(f.snapshot.roomConfig.trackingGuides.spacingMeters, .5); assert.equal(f.snapshot.roomConfig.width, 5.123456);
    f.query('[aria-label="间距 0.25m"]').click(); await tick(); assert.equal(f.snapshot.roomConfig.trackingGuides.spacingMeters, .25);
    f.query('[aria-label="参考图案"]').click(); await tick(); assert.equal(f.query('.sv3-space-guide-options').hidden, true);
    const input = f.edit('height', '100'); f.key(input, 'Enter'); await tick(); assert.equal(f.snapshot.roomConfig.height, 20);
    f.snapshot.busy = true; f.node.refresh(); assert.equal(f.query('[data-space-source=empty]').disabled, true);
  } finally {f.finish();}
});
test('pointer scrubs own one async lease, ignore foreign pointers and cancel on Escape/dispose including late begin', async () => {
  const f = await fixture(); try {
    f.settings(); const trigger = f.input('depth').parentElement.querySelector('button');
    f.emit(trigger, 'pointerdown', {button: 0, pointerId: 4, clientX: 20}); f.emit(f.dom.window, 'pointermove', {pointerId: 4, clientX: 23}); await tick(); assert.equal(f.phases.length, 0);
    f.emit(f.dom.window, 'pointermove', {pointerId: 9, clientX: 180}); assert.equal(f.phases.length, 0);
    f.emit(f.dom.window, 'pointermove', {pointerId: 4, clientX: 180}); f.emit(f.dom.window, 'pointermove', {pointerId: 4, clientX: 100}); f.emit(f.dom.window, 'pointerup', {pointerId: 4}); await tick();
    assert.deepEqual(f.phases.map(item => Array.isArray(item) ? item[0] : item), ['begin', 'move', 'move', 'end']); assert.equal(f.snapshot.roomConfig.depth, 12 * Math.sqrt(2));
    f.emit(trigger, 'pointerdown', {button: 0, pointerId: 5, clientX: 0}); f.emit(f.dom.window, 'pointermove', {pointerId: 5, clientX: 160}); await tick();
    f.node.handleEscape(); await tick(); assert.equal(f.phases.at(-1), 'cancel'); assert.equal(f.snapshot.roomConfig.depth, 12 * Math.sqrt(2)); assert.equal(f.closes.length, 0);
  } finally {f.finish();}
  let ready;
  const late = await fixture({beginRoomEdit: () => new Promise(resolve => {ready = resolve;})}); try {
    late.settings(); const trigger = late.input('width').parentElement.querySelector('button'); late.emit(trigger, 'pointerdown', {button: 0, pointerId: 1, clientX: 0}); late.emit(late.dom.window, 'pointermove', {pointerId: 1, clientX: 100}); await tick(); late.node.dispose();
    ready({onMove: () => late.phases.push('move'), onEnd: () => late.phases.push('end'), onCancel: () => late.phases.push('cancel')}); await tick(); assert.deepEqual(late.phases, ['begin', 'cancel']);
  } finally {late.finish();}
});
test('wheel burst uses one transaction and source change cancels room editing', async () => {
  const f = await fixture(); try {
    f.settings(); const field = f.input('width').parentElement;
    const wheel = delta => f.emit(field, 'wheel', {deltaX: 0, deltaY: delta, deltaMode: 0, ctrlKey: false});
    assert.equal(wheel(-600).defaultPrevented, true); wheel(-600); await new Promise(resolve => setTimeout(resolve, 230)); await tick();
    assert.deepEqual(f.phases.map(item => Array.isArray(item) ? item[0] : item), ['begin', 'move', 'move', 'end']); assert.ok(Math.abs(f.snapshot.roomConfig.width - 5.123456 * 2) < 1e-12);
    wheel(-100); await tick(); f.snapshot.source = {kind: 'empty'}; f.node.refresh(); await tick(); assert.equal(f.phases.at(-1), 'cancel'); assert.equal(f.query('.sv3-space-secondary').hidden, true);
  } finally {f.finish();}
});
test('local scene thumbnails discard late results, never attach remote URLs, and selection keeps actual metadata', async () => {
  let resolveA;
  const meta = {localAsset: 'asset:scene-a', format: 'glb'};
  const f = await fixture({snapshot: {scenes: [{id: 'a', label: '本地片场', createdAtLabel: '创建于 10月8日', thumbnailSrc: 'asset:thumb-a', threedMeta: meta}]}, resolveThumbnail: () => new Promise(resolve => {resolveA = resolve;})}); try {
    f.query('[data-space-source=world]').click(); await tick(); const image = f.query('img'); assert.equal(image.hasAttribute('src'), false);
    const search = f.query('[aria-label="搜索场景"]'); search.value = '10月8日'; f.emit(search, 'input'); await tick(); resolveA('https://remote.invalid/thumb.jpg'); await tick(); assert.equal(f.query('img').hasAttribute('src'), false);
    f.query('[data-scene-id=a]').click(); await tick(); assert.deepEqual(f.sourceCalls, [{kind: 'history-world', historyAssetId: 'a', label: '本地片场', thumbnailSrc: 'asset:thumb-a', threedMeta: meta}]);
    assert.equal(f.closes.length, 1); assert.equal(image.hasAttribute('src'), false);
  } finally {f.finish();}
  const empty = await fixture({snapshot: {loading: true}}); try {
    empty.query('[data-space-source=world]').click(); assert.match(empty.node.textContent, /正在加载场景…/); assert.equal(empty.query('[aria-label="搜索场景"]').parentElement.hidden, true);
    empty.snapshot.loading = false; empty.node.refresh(); assert.match(empty.node.textContent, /暂无生成场景/); empty.snapshot.error = '本地场景读取失败'; empty.node.refresh(); assert.match(empty.node.textContent, /本地场景读取失败/);
    assert.equal(empty.dom.window.document.querySelectorAll('link[data-studio-v3-space-menu]').length, 1);
  } finally {empty.finish();}
});
