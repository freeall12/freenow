const test = require('node:test'), assert = require('node:assert/strict'), {readFileSync} = require('node:fs'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom'); if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/timeline.mjs'), tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};}
async function fixture(overrides = {}) {
  const module = await modulePromise, dom = new JSDOM('<head></head><body><main class="studio-v3"></main><input id="outside"></body>', {pretendToBeVisual: true});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  const calls = [], errors = [], frames = new Map(); let frameId = 0;
  let state = {setupId: 'setup-a', visible: true, readOnly: false, baseline: false, durationMs: 3000, durationMinimum: {kind: 'system', durationMs: 1000}, playheadMs: 0, playing: false, looping: false, playbackShortcutAvailable: true};
  state.track = {id: 'track-a', entityId: 'actor-a', kind: 'actor', label: '演员甲', selectedKeyId: 'key-b', keyItems: [{id: 'key-a', timeMs: 0, moveRange: {minTimeMs: 0, maxTimeMs: 999}}, {id: 'key-b', timeMs: 1000, moveRange: {minTimeMs: 1, maxTimeMs: 2999}}, {id: 'key-c', timeMs: 3000}],
    onSelectKey(id) {calls.push(['select', id]); state.track.selectedKeyId = id;}, onSaveKeyAt(ms) {calls.push(['save', ms]); return overrides.save?.(ms);}, onDeleteKey(id) {calls.push(['delete', id]); return overrides.remove?.(id);}, onDeleteTrack() {calls.push(['delete-track']);}, onRedistributeTimingForUniformSpeed() {calls.push(['redistribute']);},
    onKeyMoveStart(id) {calls.push(['begin', id]); if (overrides.begin) return overrides.begin(id); return {onMove(ms) {calls.push(['move', ms]); return overrides.move?.(ms);}, onEnd(ms) {calls.push(['end', ms]); return overrides.end?.(ms);}, onCancel() {calls.push(['cancel']); return overrides.cancel?.();}};}};
  if (overrides.state) state = {...state, ...overrides.state};
  const panel = module.createTimeline({read: () => state, getReturnFocus: overrides.getReturnFocus, onPlayheadChange(ms, options) {calls.push(['seek', ms, options]); state.playheadMs = ms; return overrides.seek?.(ms, options);}, onPlayingChange(value) {calls.push(['playing', value]); state.playing = value; return overrides.play?.(value);}, onLoopingChange(value) {calls.push(['loop', value]); state.looping = value;}, onScrubEnd() {calls.push(['scrub-end']);}, onDurationChange(ms) {calls.push(['duration', ms]); state.durationMs = ms; return overrides.duration?.(ms);}, close() {calls.push(['close']);}, onError(error) {errors.push(error);}, requestFrame(callback) {const id = ++frameId; frames.set(id, callback); return id;}, cancelFrame(id) {frames.delete(id);}});
  dom.window.document.querySelector('main').append(panel);
  const slider = panel.querySelector('[role=slider]'); slider.getBoundingClientRect = () => ({left: 0, right: 336, width: 336, top: 0, bottom: 40, height: 40}); panel.refresh();
  const key = (target, value, extra = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key: value, code: value === ' ' ? 'Space' : value, bubbles: true, cancelable: true, ...extra}); target.dispatchEvent(event); return event;};
  const pointer = (target, type, x = 18, extra = {}) => {if (!target.setPointerCapture) {let held = null; target.setPointerCapture = id => {held = id;}; target.hasPointerCapture = id => held === id; target.releasePointerCapture = () => {held = null; target.dispatchEvent(new dom.window.Event('lostpointercapture'));};}
    const event = new dom.window.MouseEvent(type, {clientX: x, button: 0, bubbles: true, cancelable: true, ...extra}); Object.defineProperty(event, 'pointerId', {value: extra.pointerId ?? 7}); target.dispatchEvent(event); return event;};
  return {module, dom, panel, calls, errors, slider, key, pointer, dot: id => panel.querySelector(`[data-key-id="${id}"]`), button: label => panel.querySelector(`button[aria-label="${label}"]`), action: name => panel.querySelector(`[data-timeline-action="${name}"]`), get state() {return state;}, update(patch) {state = {...state, ...patch}; panel.refresh();}, frames() {for (const [id, callback] of [...frames]) {frames.delete(id); callback();}}, finish() {panel.dispose(); dom.window.close(); if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;}};
}

async function realWorkspaceFixture() {
  const f = await fixture(); f.panel.dispose(); f.panel.remove();
  const [schema, world, {createHistory}, {createTemporalWorkspace}, actions] = await Promise.all(['schema', 'world-space', 'history', 'temporal-workspace', 'temporal-actions'].map(name => import(`../src/features/studio-v3/${name}.mjs`)));
  let state = schema.createState({worldNodeId: 'world', now: 1}); const setupId = state.scenePlay.worldSpace.activeSetupId;
  state = world.addEntity(state, schema.createEntity({id: 'chair', kind: 'prop', label: '餐椅', asset: {sourceFormat: 'glb', sourceUrl: '/chair.glb'}, now: 1}), {setupId});
  for (const ms of [0, 2000, 3000]) {const snapshot = structuredClone(state.scenePlay.worldSpace.setups.find(item => item.id === setupId).entityStates[0]); snapshot.transform.position.x = ms / 1000;
    const result = actions.reduceTemporalAction(state, {type: 'save-key', entityId: 'chair', setupId, timeMs: ms, keyId: `chair:${ms}`, snapshot}, {now: 10}); assert(result.ok); state = result.state;}
  const engine = createHistory(state), notices = [], rendered = []; let epoch = 0, host, restoreWait = null, applyWait = null;
  const notify = () => {epoch++; host?.refresh();};
  const history = {...engine, preview(fn) {const result = engine.preview(fn); if (result) notify(); return result;}, commit() {const result = engine.commit(); if (result) notify(); return result;}, cancel() {const result = engine.cancel(); if (result) notify(); return result;}};
  const session = {history, getState: engine.getState, getFence: () => ({owner: 'owner', editEpoch: epoch}), isCurrent: () => true, change(fn, options) {const result = engine.transact(options.lane, options.label, fn, options.scope); if (result) notify(); return result;}};
  const frames = new Map(); let frameId = 0;
  host = createTemporalWorkspace({getState: engine.getState, session, getRuntime: () => ({sync: async () => {}, render() {}}), readCurrentSelection: () => 'chair', getSourceKey: () => 'world-source', isHidden: () => false, notice: message => notices.push(message),
    previewAdapters: {capturePreview: () => ({}), async applyPreview(payload) {const gate = applyWait; applyWait = null; if (gate) await gate; payload.assertCurrent(); rendered.push(payload.timeMs);}, async restorePreview(payload) {const gate = restoreWait; restoreWait = null; if (gate) await gate;}},
    createTimelineView: options => f.module.createTimeline({...options, requestFrame(callback) {const id = ++frameId; frames.set(id, callback); return id;}, cancelFrame(id) {frames.delete(id);}}), playbackOptions: {autoSchedule: false}});
  const panel = host.mount(f.dom.window.document.querySelector('main')); host.setVisible(true);
  const slider = panel.querySelector('[role=slider]'); slider.getBoundingClientRect = () => ({left: 0, right: 336, width: 336}); panel.refresh();
  return {...f, panel, slider, host, session, notices, rendered, state: engine.getState, dot: id => panel.querySelector(`[data-key-id="${id}"]`), keys: () => engine.getState().scenePlay.worldSpace.setups.find(item => item.id === setupId).temporal.tracks[0].keys.map(key => key.timeMs),
    blockRestore(promise) {restoreWait = promise;}, blockApply(promise) {applyWait = promise;}, frames() {for (const [id, callback] of [...frames]) {frames.delete(id); callback();}}, async finish() {await host.dispose(); f.finish();}};
}

test('official selected single-track ruler, controls and geometry use installed icons without invented easing', async () => {
  const f = await fixture(); try {
    assert.equal(f.panel.querySelectorAll('.sv3-timeline-key').length, 3); assert.equal(f.panel.querySelector('select'), null); assert.equal(f.panel.dataset.worldWorkspaceBlockMovementHotkeys, 'true');
    assert.equal(f.panel.querySelector('.sv3-timeline-beta').textContent, '测试版'); assert.equal(f.slider.getAttribute('aria-label'), '定位时间轴'); assert.equal(f.action('delete-key').getAttribute('aria-label'), '删除所选关键帧');
    assert.equal(f.dot('key-b').getAttribute('aria-label'), '演员甲 1.0s'); assert.equal(f.dot('key-b').getAttribute('aria-pressed'), 'true');
    assert.equal(f.button('播放时间调度').querySelector('svg').getAttribute('width'), '19'); assert.equal(f.button('播放时间调度').querySelector('svg').getAttribute('stroke-width'), '2.35'); assert.equal(f.button('开启循环播放').querySelector('svg').getAttribute('width'), '18');
    assert.equal(f.slider.getAttribute('aria-valuemax'), '3000'); assert.equal(f.slider.getAttribute('aria-valuenow'), '0'); assert.equal(f.panel.querySelectorAll('.sv3-timeline-segments>span').length, 2);
    assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-timeline]').length, 1);
    const css = readFileSync(require.resolve('../src/features/studio-v3/timeline.css'), 'utf8'); for (const value of ['width:min(92vw,640px)', 'margin-right:-12px', 'padding-left:6px', '280ms 180ms', 'min-width:148px', 'top:33px', 'left:18px', 'height:40px', 'width:20px']) assert(css.includes(value), value);
  } finally {f.finish();}
});

test('play/pause, loop and Space dispatch host actions and block editable/IME/repeat contexts', async () => {
  const f = await fixture(); try {
    f.button('播放时间调度').click(); await tick(); assert.deepEqual(f.calls[0], ['playing', true]); assert(f.button('暂停时间调度')); f.button('暂停时间调度').click(); await tick();
    f.button('开启循环播放').click(); await tick(); assert.equal(f.button('关闭循环播放').getAttribute('aria-pressed'), 'true');
    f.key(f.dom.window.document.body, ' '); await tick(); assert.equal(f.calls.at(-1)[0], 'playing'); assert.equal(f.state.playing, true);
    const before = f.calls.length; f.key(f.dom.window.document.querySelector('#outside'), ' '); f.key(f.panel, ' ', {isComposing: true}); f.key(f.panel, ' ', {repeat: true}); assert.equal(f.calls.length, before);
    f.update({playbackShortcutAvailable: false}); f.key(f.panel, ' '); assert.equal(f.calls.length, before); assert.equal(f.button('暂停时间调度').hasAttribute('aria-keyshortcuts'), false);
  } finally {f.finish();}
});

test('ruler keys seek by 500ms and boundaries while playing; selection uses real actor/camera/prop callbacks', async () => {
  const f = await fixture(); try {
    f.key(f.slider, 'ArrowRight'); assert.equal(f.state.playheadMs, 500); f.key(f.slider, 'ArrowLeft'); assert.equal(f.state.playheadMs, 0); f.key(f.slider, 'ArrowLeft'); assert.equal(f.state.playheadMs, 0); f.key(f.slider, 'End'); assert.equal(f.state.playheadMs, 3000); f.key(f.slider, 'Home'); assert.equal(f.state.playheadMs, 0);
    for (const kind of ['actor', 'camera', 'prop']) {f.update({track: {...f.state.track, kind, label: kind}}); f.dot('key-b').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['select', 'key-b']);}
    f.update({playing: true}); f.key(f.slider, 'ArrowRight'); assert.equal(f.state.playheadMs, 500); f.dot('key-a').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['select', 'key-a']);
  } finally {f.finish();}
});

test('pointer scrubbing coalesces RAF, uses inset18, ends once and cancellation retains reached time', async () => {
  const f = await fixture(); try {
    f.pointer(f.slider, 'pointerdown', 18); f.pointer(f.slider, 'pointermove', 168); f.pointer(f.slider, 'pointermove', 318); assert.equal(f.state.playheadMs, 0); f.frames(); assert.equal(f.state.playheadMs, 3000);
    f.pointer(f.slider, 'pointerup', 168); assert.equal(f.state.playheadMs, 1500); assert.equal(f.calls.filter(call => call[0] === 'scrub-end').length, 1); assert.equal(f.calls.at(-2)[2].previewMode, 'viewing');
    f.pointer(f.slider, 'pointerdown', 168); f.pointer(f.slider, 'pointermove', 218); f.frames(); const reached = f.state.playheadMs; f.pointer(f.slider, 'pointercancel', 18); assert.equal(f.state.playheadMs, reached); assert.equal(f.calls.filter(call => call[0] === 'scrub-end').length, 2);
  } finally {f.finish();}
});

test('save rounds real playhead, delete selected/key keyboard and redistribution use track capabilities', async () => {
  const f = await fixture(); try {
    f.update({playheadMs: 1250.6}); f.action('save-key').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['save', 1251]);
    f.action('delete-key').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['delete', 'key-b']); f.key(f.dot('key-a'), 'Delete'); await tick(); assert.deepEqual(f.calls.at(-1), ['delete', 'key-a']);
    f.button('按匀速重新分配').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['redistribute']);
    f.update({track: {...f.state.track, onRedistributeTimingForUniformSpeed: undefined}}); assert.equal(f.button('按匀速重新分配').disabled, true); assert.match(f.button('按匀速重新分配').title, /三个形成连续/);
  } finally {f.finish();}
});

test('director control keeps save/select available while structural writes and Space shortcut are gated', async () => {
  const f = await fixture(); try {
    f.update({structureEditingDisabledReason: '完成当前操控后，才能修改时间轴', playbackShortcutAvailable: false}); assert.equal(f.action('save-key').disabled, false); assert.equal(f.action('delete-key').disabled, true); assert.equal(f.dot('key-b').dataset.movable, 'false');
    f.action('save-key').click(); await tick(); f.dot('key-a').click(); await tick(); assert.deepEqual(f.calls.map(call => call[0]), ['save', 'select']);
    f.pointer(f.dot('key-b'), 'pointerdown', 118); f.key(f.dot('key-b'), 'Delete'); f.key(f.panel, ' '); assert.equal(f.calls.length, 2);
    f.button('时间轴操作').click(); const longer = [...f.panel.querySelectorAll('.sv3-timeline-menu button')].find(node => node.textContent.includes('延长')); assert.equal(longer.disabled, true);
  } finally {f.finish();}
});

test('duration menu shortens to highest all-track key minimum and extends to next whole second', async () => {
  const f = await fixture(); try {
    f.update({durationMs: 2500, durationMinimum: {kind: 'blocking-key', durationMs: 2300, timeMs: 2300, trackLabel: '远景'}}); f.button('时间轴操作').click();
    f.button('缩短时间轴到 2.3s').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['duration', 2300]); assert.equal(f.button('缩短时间轴到 2.3s').disabled, true); assert.match(f.button('缩短时间轴到 2.3s').title, /远景/);
    f.button('延长时间轴到 3s').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['duration', 3000]); f.button('延长时间轴 1 秒').click(); await tick(); assert.deepEqual(f.calls.at(-1), ['duration', 4000]);
    assert.equal(f.module.nextTimelineDuration(1500), 2000); assert.equal(f.module.nextTimelineDuration(2000), 3000); assert(f.module.timelineTicks(3000, 420).some(item => item.label === '3s'));
  } finally {f.finish();}
});

test('locked track authoring disables key edits but duration remains available; pending/no-selected track has real empty state', async () => {
  const f = await fixture(); try {
    f.update({track: {...f.state.track, authoringDisabledReason: '先解锁场景对象', onDeleteTrack: undefined}}); assert.equal(f.action('save-key').disabled, true); assert.equal(f.action('delete-key').disabled, true);
    f.button('时间轴操作').click(); assert.equal(f.button('延长时间轴 1 秒').disabled, false); assert.equal(f.panel.querySelector('.sv3-timeline-menu button:last-child').hidden, true); f.panel.handleEscape();
    f.update({track: {...f.state.track, id: 'pending:actor-a', keyItems: [], selectedKeyId: null, authoringDisabledReason: null}}); assert.equal(f.panel.querySelectorAll('.sv3-timeline-key').length, 0); assert.equal(f.action('save-key').disabled, false); assert.equal(f.action('delete-key').disabled, true);
    assert.equal(f.action('delete-key').getAttribute('aria-label'), '选择要删除的关键帧。');
    f.update({track: null}); assert.equal(f.action('save-key').disabled, true); assert.match(f.action('save-key').title, /选择角色/);
  } finally {f.finish();}
});

test('key drag uses synchronous host lease, threshold4, moveRange and a single final commit', async () => {
  const f = await fixture(); try {
    const dot = f.dot('key-b'); f.pointer(dot, 'pointerdown', 118); f.pointer(dot, 'pointermove', 122); f.frames(); assert.equal(f.calls.filter(call => call[0] === 'move').length, 0);
    f.pointer(dot, 'pointermove', 168); f.pointer(dot, 'pointermove', 336); f.frames(); assert.deepEqual(f.calls.find(call => call[0] === 'move'), ['move', 2999]); assert.equal(f.calls.find(call => call[0] === 'seek')[2].preserveSelectedKey, true);
    f.pointer(dot, 'pointerup', 218); assert.deepEqual(f.calls.find(call => call[0] === 'end'), ['end', 2000]); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 0); dot.click(); await tick(); assert.equal(f.calls.filter(call => call[0] === 'select').length, 0);
    f.pointer(dot, 'pointerdown', 118); f.pointer(dot, 'pointerup', 118); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1); dot.click(); await tick(); assert.deepEqual(f.calls.at(-1), ['select', 'key-b']);
  } finally {f.finish();}
});

test('key pointercancel/Escape/blur/owner change cancel queued previews and restore original time only to same owner', async () => {
  const f = await fixture(); try {
    for (const mode of ['pointer', 'escape', 'blur', 'owner']) {
      const dot = f.dot('key-b'); f.pointer(dot, 'pointerdown', 118); f.pointer(dot, 'pointermove', 168); f.frames();
      if (mode === 'pointer') f.pointer(dot, 'pointercancel', 18); else if (mode === 'escape') f.key(dot, 'Escape'); else if (mode === 'blur') f.dom.window.dispatchEvent(new f.dom.window.Event('blur')); else f.update({setupId: 'setup-b'});
      assert.equal(f.calls.filter(call => call[0] === 'cancel').length, ['pointer', 'escape', 'blur', 'owner'].indexOf(mode) + 1); if (mode !== 'owner') assert.equal(f.state.playheadMs, 1000);
    }
    assert.equal(f.calls.at(-1)[0], 'cancel');
  } finally {f.finish();}
});

test('false drag preview rolls back; failed cancellation retains lease for Escape retry', async () => {
  let rejectCancel = true; const f = await fixture({move: () => false, cancel: () => !rejectCancel}); try {
    const dot = f.dot('key-b'); f.pointer(dot, 'pointerdown', 118); f.pointer(dot, 'pointermove', 168); f.frames(); assert.equal(f.calls.filter(call => call[0] === 'end').length, 0); assert(f.errors.length);
    rejectCancel = false; f.key(dot, 'Escape'); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 2); assert.equal(f.state.playheadMs, 1000); assert.equal(f.dot('key-b').dataset.dragging, 'false');
  } finally {f.finish();}
});

test('non-key write confirmation has exact intent copy, safe cancel and failed/successful confirm with focus restore', async () => {
  let fail = true; const f = await fixture(); try {
    const origin = f.action('save-key'); origin.focus(); const intent = {entity: {id: 'actor-a', label: '演员甲'}, impact: {timeMs: 1234, willCreateTrack: true}};
    const args = {intent, onCancel() {f.calls.push(['key-cancel']);}, onConfirm() {f.calls.push(['key-confirm']); return !fail;}};
    assert.equal(f.panel.requestKeyCreationConfirmation(args), false); const modal = f.panel.querySelector('[role=alertdialog]'); assert.equal(modal.getAttribute('aria-label'), '开始时间轴？'); assert.equal(modal.querySelector('p').textContent, '将 演员甲 在 1.2s 的状态保存为关键帧。'); assert.equal(f.calls.length, 0); assert.equal(f.dom.window.document.activeElement, f.button('取消'));
    f.key(f.button('取消'), 'Tab'); assert.equal(f.dom.window.document.activeElement, f.button('创建')); f.key(f.button('创建'), 'Escape'); assert.deepEqual(f.calls.at(-1), ['key-cancel']); assert.equal(f.dom.window.document.activeElement, origin);
    f.panel.requestKeyCreationConfirmation({...args, intent: {...intent, impact: {...intent.impact, willCreateTrack: false}}}); assert.equal(modal.getAttribute('aria-label'), '创建关键帧？'); f.button('创建').click(); await tick(); assert.equal(f.panel.querySelector('.sv3-timeline-confirm-layer').hidden, false);
    fail = false; f.button('创建').click(); await tick(); assert.equal(f.panel.querySelector('.sv3-timeline-confirm-layer').hidden, true); assert.equal(f.dom.window.document.activeElement, origin);
  } finally {f.finish();}
});

test('host save can request confirmation during callback; hidden timeline still exposes genuine confirmation', async () => {
  let f; f = await fixture({save: ms => {f.panel.requestKeyCreationConfirmation({intent: {entity: {id: 'actor-a', label: '演员甲'}, impact: {timeMs: ms, willCreateTrack: false}}, onCancel: () => f.calls.push(['key-cancel']), onConfirm: () => f.calls.push(['key-confirm'])}); return true;}}); try {
    f.action('save-key').click(); await tick(); assert.equal(f.panel.querySelector('.sv3-timeline-confirm-layer').hidden, false); f.key(f.button('取消'), 'Escape');
    f.update({visible: false}); assert.equal(f.panel.hidden, true); f.panel.requestKeyCreationConfirmation({intent: {entity: {id: 'actor-a', label: '演员甲'}, impact: {timeMs: 500, willCreateTrack: true}}, onCancel: () => f.calls.push(['key-cancel']), onConfirm: () => true}); assert.equal(f.panel.hidden, false); assert.equal(f.panel.querySelector('.sv3-timeline-bar').hidden, true); f.key(f.button('取消'), 'Escape'); assert.equal(f.panel.hidden, true);
  } finally {f.finish();}
});

test('host input isolation getters track confirmation/drag/scrub and hidden confirmation restores explicit outside focus', async () => {
  const f = await fixture(); try {
    assert.equal(f.panel.confirming, false); assert.equal(f.panel.dragging, false); assert.equal(f.panel.scrubbing, false);
    const origin = f.dom.window.document.querySelector('#outside'); origin.focus(); f.update({visible: false});
    f.panel.requestKeyCreationConfirmation({intent: {entity: {id: 'actor-a', label: '演员甲'}, impact: {timeMs: 500, willCreateTrack: true}}, returnFocus: origin, onCancel() {}, onConfirm() {}}); assert.equal(f.panel.confirming, true); f.key(f.button('取消'), 'Escape'); assert.equal(f.panel.confirming, false); assert.equal(f.dom.window.document.activeElement, origin);
    f.update({visible: true}); f.pointer(f.dot('key-b'), 'pointerdown', 118); assert.equal(f.panel.dragging, true); f.key(f.dot('key-b'), 'Escape'); assert.equal(f.panel.dragging, false);
    f.pointer(f.slider, 'pointerdown', 18); assert.equal(f.panel.scrubbing, true); f.key(f.slider, 'Escape'); assert.equal(f.panel.scrubbing, false);
  } finally {f.finish();}
});

test('async drag preflight preserves first gesture including pointerup before preview restoration, then obtains one sync lease', async () => {
  const waiting = deferred(), f = await fixture(); try {
    let signal; f.update({track: {...f.state.track, onBeforeKeyMoveStart(id, options) {f.calls.push(['prepare', id]); signal = options.signal; return waiting.promise;}}});
    const dot = f.dot('key-b'); f.pointer(dot, 'pointerdown', 118); assert.equal(f.panel.dragging, true); assert.equal(f.calls.filter(call => call[0] === 'begin').length, 0);
    f.update({busy: true}); assert.equal(f.panel.dragging, true); f.pointer(dot, 'pointermove', 168); f.pointer(dot, 'pointerup', 218); dot.click(); assert.equal(f.calls.filter(call => call[0] === 'select').length, 0);
    f.update({busy: false}); waiting.resolve(true); await tick(); assert.equal(signal.aborted, false); assert.deepEqual(f.calls.find(call => call[0] === 'begin'), ['begin', 'key-b']); assert.deepEqual(f.calls.find(call => call[0] === 'end'), ['end', 2000]); assert.equal(f.panel.dragging, false);
  } finally {f.finish();}
});

test('async drag preflight buffers latest move and cancellation/owner changes/failure never open old history', async () => {
  for (const mode of ['continue', 'escape', 'cancel', 'owner', 'fail']) {
    const waiting = deferred(), f = await fixture(); try {
      let signal; f.update({track: {...f.state.track, onBeforeKeyMoveStart(id, options) {signal = options.signal; return waiting.promise;}}});
      const dot = f.dot('key-b'); f.pointer(dot, 'pointerdown', 118); f.pointer(dot, 'pointermove', 168); f.pointer(dot, 'pointermove', 218);
      if (mode === 'escape') f.key(dot, 'Escape'); else if (mode === 'cancel') f.pointer(dot, 'pointercancel', 18); else if (mode === 'owner') f.update({setupId: 'other'});
      waiting.resolve(mode === 'fail' ? false : true); await tick(); f.frames();
      if (mode === 'continue') {assert.deepEqual(f.calls.find(call => call[0] === 'move'), ['move', 2000]); f.pointer(dot, 'pointerup', 218); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);}
      else {assert.equal(f.calls.filter(call => call[0] === 'begin').length, 0, mode); assert.equal(f.panel.dragging, false, mode); assert.equal(signal.aborted, true, mode);}
    } finally {f.finish();}
  }
});

test('readonly/baseline/busy/playing and stale detached controls enforce current capabilities', async () => {
  const f = await fixture(); try {
    const staleDot = f.dot('key-a').onclick;
    for (const patch of [{readOnly: true}, {readOnly: false, baseline: true}, {baseline: false, busy: true}]) {f.update(patch); f.action('save-key').onclick(); f.key(f.slider, 'ArrowRight'); f.key(f.panel, ' '); assert.equal(f.calls.length, 0);}
    f.update({busy: false, playing: true}); assert.equal(f.action('save-key').disabled, true); assert.equal(f.action('delete-key').disabled, true); f.pointer(f.dot('key-b'), 'pointerdown', 118); assert.equal(f.calls.length, 0);
    f.update({playing: false, track: {...f.state.track, id: 'other-track', entityId: 'other'}}); staleDot({stopPropagation() {}}); await tick(); assert.equal(f.calls.length, 0);
    f.button('时间轴操作').click(); const staleMenu = f.button('延长时间轴 1 秒').onclick; f.update({setupId: 'new-owner'}); staleMenu(); await tick(); assert.equal(f.calls.length, 0);
  } finally {f.finish();}
});

test('async failures keep feedback, busy blocks repeats, stale confirmation cancels and disposal cancels active drag', async () => {
  const wait = deferred(), f = await fixture({remove: () => wait.promise}); try {
    f.action('delete-key').click(); assert.equal(f.action('save-key').disabled, true); f.action('delete-key').onclick(); assert.equal(f.calls.filter(call => call[0] === 'delete').length, 1); wait.resolve({ok: false, message: '保存失败'}); await tick(); assert.equal(f.panel.querySelector('[role=alert]').textContent, '保存失败');
    f.panel.requestKeyCreationConfirmation({intent: {entity: {id: 'actor-a', label: '演员甲'}, impact: {timeMs: 1000, willCreateTrack: false}}, onCancel: () => f.calls.push(['key-cancel']), onConfirm: () => f.calls.push(['key-confirm'])}); f.update({setupId: 'next'}); assert.deepEqual(f.calls.at(-1), ['key-cancel']); assert.equal(f.panel.querySelector('.sv3-timeline-confirm-layer').hidden, true);
    f.pointer(f.dot('key-b'), 'pointerdown', 118); f.panel.dispose(); assert.deepEqual(f.calls.at(-1), ['cancel']); const before = f.calls.length; f.key(f.dom.window.document.body, ' '); assert.equal(f.calls.length, before); f.panel.dispose();
  } finally {f.finish();}
});

test('asynchronous seek rejection is surfaced without an unhandled notification failure', async () => {
  const f = await fixture({seek: async () => {throw Error('场景采样失败');}}); try {
    f.key(f.slider, 'ArrowRight'); await tick(); assert.equal(f.panel.querySelector('[role=alert]').textContent, '场景采样失败'); assert.equal(f.errors.length, 1);
  } finally {f.finish();}
});

test('real workspace paused preview restoration keeps preflight pointer target enabled and commits first key drag once', async () => {
  const f = await realWorkspaceFixture(), wait = deferred(); try {
    await f.host.seek(1382, {previewMode: 'viewing'}); const before = f.state(); const historyBefore = f.session.history.getHistory();
    f.blockRestore(wait.promise); const dot = f.dot('chair:2000'); f.pointer(dot, 'pointerdown', 218); await tick();
    assert.equal(f.host.read().busy, true); assert.equal(f.panel.dragging, true); assert.equal(dot.disabled, false, 'owned pointer must survive its async restoration busy');
    f.pointer(dot, 'pointermove', 118); f.pointer(dot, 'pointerup', 118); wait.resolve(); await tick(); await f.host.playback.whenIdle(); await tick();
    assert.deepEqual(f.keys(), [0, 1000, 3000]); assert.equal(f.session.history.getActiveTransaction(), null);
    const lane = `setup:${f.host.read().setupId}`; assert.equal(f.session.history.getHistory().lanes[lane].undoStack.length, (historyBefore.lanes[lane]?.undoStack.length ?? 0) + 1); assert.deepEqual(f.notices, []);
    assert.equal(f.session.history.undo(`setup:${f.host.read().setupId}`).ok, true); assert.deepEqual(f.state(), before);
  } finally {wait.resolve(); await f.finish();}
});

test('real workspace rapid scrub survives own preview apply busy, reaches final time and never writes author/history', async () => {
  const f = await realWorkspaceFixture(), wait = deferred(); try {
    const before = f.state(), history = f.session.history.getHistory(); f.blockApply(wait.promise); f.pointer(f.slider, 'pointerdown', 18); await tick();
    assert.equal(f.host.read().busy, true); assert.equal(f.panel.scrubbing, true, 'own async sampling must not cancel the scrub');
    f.pointer(f.slider, 'pointermove', 168); f.frames(); f.pointer(f.slider, 'pointerup', 118); wait.resolve(); await f.host.playback.whenIdle(); await tick(); await f.host.playback.whenIdle(); await tick();
    assert.equal(f.host.read().playheadMs, 1000); assert.deepEqual(f.state(), before); assert.deepEqual(f.session.history.getHistory(), history); assert.deepEqual(f.notices, []);
  } finally {wait.resolve(); await f.finish();}
});
