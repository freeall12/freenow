'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const modules = Promise.all([import('../src/features/studio-v3/camera-control-hud.mjs'), import('../src/features/studio-v3/camera-optics.mjs')]);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((accept, fail) => {resolve = accept; reject = fail;}); return {promise, resolve, reject};}
async function fixture(overrides = {}) {
  const [module, optics] = await modules, dom = new JSDOM('<head></head><body><div class="studio-v3" id="root"></div></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  dom.window.matchMedia = () => ({matches: true});
  let camera = optics.normalizeCameraOptics({position: {x: 1, y: 2, z: 3}, rotation: {x: .1, y: .2, z: .3, order: 'YXZ'}, focalLength: 24, frameAspectRatio: 16 / 9, apertureFNumber: 11, depthOfFieldMode: 'deepFocus', focusDistance: 10}), busy = false, picking = false, depthOfField = true, pendingCapture = false;
  const initial = structuredClone(camera), calls = [], errors = [];
  const options = {read: () => camera, getBusy: () => busy, getPendingCapture: () => pendingCapture, onError: error => errors.push(error),
    apply: patch => {calls.push({name: 'apply', patch}); const result = overrides.apply?.(patch); if (overrides.apply && result !== true) return result; camera = optics.cameraOpticsPatch(camera, patch); return true;},
    capture: async () => {calls.push({name: 'capture'}); return overrides.capture ? overrides.capture() : {ok: true, nodeId: 'real-image'};},
    cancel: () => {calls.push({name: 'cancel'}); if (overrides.cancel) return overrides.cancel(); camera = null; return true;},
    finish: () => {calls.push({name: 'finish'}); if (overrides.finish) return overrides.finish(); camera = null; return true;},
    toggleFocusPicking: () => {calls.push({name: 'focus'}); picking = !picking; return true;}, getFocusPicking: () => picking, getDepthOfFieldSupported: () => depthOfField
  };
  const hud = module.createCameraControlHUD(options); dom.window.document.querySelector('#root').append(hud);
  const ruler = field => hud.querySelector(`fieldset[data-field="${field}"]`);
  const key = (target, key, patch = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...patch}); target.dispatchEvent(event); return event;};
  const pointer = (target, type, x, extra = {}) => {const event = new dom.window.MouseEvent(type, {clientX: x, button: 0, bubbles: true, cancelable: true, ...extra}); Object.defineProperty(event, 'pointerId', {value: 1}); target.dispatchEvent(event); return event;};
  const capturePointer = field => {const target = ruler(field).querySelector('.sv3-camera-ruler-window'); let captured = null; target.setPointerCapture = id => {captured = id;}; target.hasPointerCapture = id => captured === id; target.releasePointerCapture = () => {captured = null;}; return target;};
  return {module, optics, dom, hud, options, calls, errors, initial, ruler, key, pointer, capturePointer,
    button: label => hud.querySelector(`button[aria-label="${label}"]`), get camera() {return camera;}, get picking() {return picking;},
    setBusy(value) {busy = value; hud.refresh();}, setCamera(value) {camera = value; hud.refresh();},
    setDepthOfField(value) {depthOfField = value; hud.refresh();},
    setPendingCapture(value) {pendingCapture = value; hud.refresh();},
    finish() {hud.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}

test('official toolbar order and original ratio/shutter/undo/check geometry, exact fixed log ruler constants', async () => {
  const f = await fixture(); try {
    assert.deepEqual([...f.hud.children].filter(node => node.tagName === 'BUTTON' || node.tagName === 'FIELDSET').map(node => node.dataset.field || node.getAttribute('aria-label')), ['画幅比例', 'focalLength', 'apertureFNumber', '选择对焦点', '拍摄到画布', '还原并退出', '完成']);
    const geometry = f.button('画幅比例').querySelector('rect'); assert.equal(geometry.getAttribute('rx'), '1.5'); assert.equal(geometry.getAttribute('stroke-width'), '1.5'); assert.equal(geometry.getAttribute('width'), '13');
    const shutter = f.button('拍摄到画布'); assert.equal(shutter.querySelector('svg'), null); assert(shutter.querySelector('.sv3-camera-shutter-ring')); assert(shutter.querySelector('.sv3-camera-shutter-center'));
    assert.equal(f.button('还原并退出').querySelector('svg').getAttribute('width'), '18'); assert.equal(f.button('还原并退出').querySelector('svg').getAttribute('stroke-width'), '1.8');
    assert.equal(f.button('完成').getAttribute('aria-keyshortcuts'), 'Escape'); assert.equal(f.button('完成').querySelector('svg').getAttribute('stroke-width'), '1.9');
    assert.equal(f.ruler('focalLength').querySelector('.sv3-camera-ruler-track').style.width, '534px'); assert.equal(f.ruler('apertureFNumber').querySelector('.sv3-camera-ruler-track').style.width, '234px');
    assert.equal(f.ruler('focalLength').querySelector('.sv3-camera-ruler-window').style.width, '74px'); assert.equal(f.ruler('apertureFNumber').querySelector('.sv3-camera-ruler-window').style.width, '66px');
    assert.equal(f.ruler('apertureFNumber').querySelector('.sv3-camera-ruler-readout').textContent, '泛焦');
    assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-camera-hud]').length, 1);
  } finally {f.finish();}
});
test('log ruler transforms invert accurately and major ticks follow installed equally spaced preset geometry', async () => {
  const f = await fixture(); try {
    for (const value of [8, 16, 24, 35, 50, 85, 135, 400]) {
      const position = f.module.cameraRulerPosition(value, 8, 400, 534); assert(Math.abs(f.module.cameraRulerValue(position, 8, 400, 534) - value) < 1e-10);
    }
    const majors = [...f.ruler('focalLength').querySelectorAll('[data-preset]')]; assert.deepEqual(majors.map(node => Number(node.dataset.preset)), [8, 16, 24, 35, 50, 85, 135, 400]);
    majors.forEach((node, index) => assert.equal(Number(node.dataset.tickX), 534 * index / 7)); assert(f.ruler('focalLength').querySelectorAll('.sv3-camera-ruler-minor').length > 60);
    assert.equal(f.module.cameraRulerValue(-10, 8, 400, 534), 8); assert.equal(f.module.cameraRulerValue(900, 8, 400, 534), 400);
  } finally {f.finish();}
});
test('preset focal and aperture patches update real optical projection, preserve camera pose, and never finish possession', async () => {
  const f = await fixture(); try {
    f.ruler('focalLength').querySelector('[data-preset="85"]').click(); assert.equal(f.camera.focalLength, 85); assert.equal(f.camera.fov, f.optics.focalLengthToFov(85, 16 / 9));
    f.ruler('apertureFNumber').querySelector('[data-preset="2.8"]').click(); assert.equal(f.camera.apertureFNumber, 2.8); assert.equal(f.camera.depthOfFieldMode, 'aperture');
    f.ruler('apertureFNumber').querySelector('.sv3-camera-ruler-terminal').click(); assert.equal(f.camera.depthOfFieldMode, 'deepFocus');
    f.ruler('apertureFNumber').querySelector('.sv3-camera-ruler-terminal-readout').click(); assert.equal(f.camera.depthOfFieldMode, 'aperture');
    assert.deepEqual(f.camera.position, f.initial.position); assert.deepEqual(f.camera.rotation, f.initial.rotation); assert.equal(f.calls.some(item => item.name === 'finish'), false); assert.equal(f.hud.hidden, false);
  } finally {f.finish();}
});
test('pointer drag threshold, log preview, local Escape and pointercancel retain accepted previews without finishing camera', async () => {
  const f = await fixture(); try {
    const target = f.capturePointer('focalLength'); f.pointer(target, 'pointerdown', 100); f.pointer(target, 'pointermove', 102); assert.equal(f.calls.length, 0);
    f.pointer(target, 'pointermove', 80); assert(f.camera.focalLength > 24); const accepted = f.camera.focalLength;
    assert.equal(f.key(target, 'Escape').defaultPrevented, true); assert.equal(f.camera.focalLength, accepted); assert.equal(f.calls.some(item => item.name === 'finish'), false); assert(f.camera);
    f.pointer(target, 'pointerdown', 100); f.pointer(target, 'pointermove', 85); const last = f.camera.focalLength; f.pointer(target, 'pointercancel', 85); assert.equal(f.camera.focalLength, last); assert.equal(f.hud.hidden, false);
    f.key(f.hud, 'Escape'); await tick(); assert.equal(f.calls.at(-1).name, 'finish'); assert.equal(f.hud.hidden, true);
  } finally {f.finish();}
});
test('ratio menu has exact groups and five-column original choices, commits real aspect and preserves focal length', async () => {
  const f = await fixture(); try {
    f.button('画幅比例').click(); const menu = f.dom.window.document.querySelector('.sv3-camera-ratio-menu'); assert(menu);
    assert.equal(menu.querySelectorAll('.sv3-camera-ratio-grid').length, 2);
    assert.deepEqual([...menu.querySelectorAll('[data-ratio]')].map(node => node.dataset.ratio), ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '4:5', '9:19.5', '9:21', '1.33:1', '1.37:1', '1.43:1', '1.66:1', '1.85:1', '2.00:1', '2.20:1', '2.35:1', '2.39:1']);
    menu.querySelector('[data-ratio="9:16"]').click(); assert.equal(f.camera.frameAspectRatio, 9 / 16); assert.equal(f.camera.focalLength, 24); assert.equal(f.camera.fov, f.optics.focalLengthToFov(24, 9 / 16)); assert.equal(f.hud.hidden, false);
  } finally {f.finish();}
});
test('focus uses real host picking toggle; Escape cancels picking first and leaves possession active', async () => {
  const f = await fixture(); try {
    f.hud.querySelector('.sv3-camera-focus').click(); assert.equal(f.picking, true); assert.equal(f.hud.querySelector('.sv3-camera-focus').getAttribute('aria-pressed'), 'true');
    f.key(f.ruler('focalLength').querySelector('[role=slider]'), 'Escape'); assert.equal(f.picking, false); assert.equal(f.hud.querySelector('.sv3-camera-focus').getAttribute('aria-pressed'), 'false'); assert(f.camera); assert.equal(f.calls.some(item => item.name === 'finish'), false);
    f.setCamera(f.optics.cameraOpticsPatch(f.camera, {focusDistance: null})); assert.equal(f.hud.querySelector('.sv3-camera-focus span').textContent, '远焦');
    f.key(f.hud, 'Escape'); await tick(); assert.equal(f.camera, null);
  } finally {f.finish();}
});
test('stale hidden HUD cannot invoke a host action after possession ends', async () => {
  const f = await fixture(); try {
    f.setCamera(null); assert.equal(f.hud.hidden, true);
    f.button('拍摄到画布').click(); f.button('还原并退出').click(); f.button('完成').click(); f.button('画幅比例').click(); f.hud.querySelector('.sv3-camera-focus').click(); f.key(f.hud, 'Escape'); await tick();
    assert.deepEqual(f.calls, []); assert.equal(f.dom.window.document.querySelector('.sv3-camera-ratio-menu'), null);
  } finally {f.finish();}
});
test('capturing disables every optical/end action until actual result; a failure preserves HUD with readable error', async () => {
  const pending = deferred(), f = await fixture({capture: () => pending.promise}); try {
    f.button('拍摄到画布').click(); assert.equal(f.button('完成').disabled, true); assert.equal(f.ruler('focalLength').disabled, true); assert.equal(f.button('画幅比例').disabled, true);
    f.button('完成').click(); f.ruler('focalLength').querySelector('[data-preset="85"]').click(); f.key(f.hud, 'Escape'); assert.deepEqual(f.calls.map(item => item.name), ['capture']);
    pending.reject(Error('图片保存失败')); await tick(); assert.equal(f.hud.hidden, false); assert.equal(f.button('完成').disabled, false); assert.equal(f.ruler('focalLength').disabled, false); assert.match(f.hud.querySelector('[role=alert]').textContent, /图片保存失败/); assert.equal(f.errors.length, 1);
  } finally {f.finish();}
});
test('external getBusy disables capture, sliders, menus and endings without cancelling a host transaction', async () => {
  const f = await fixture(); try {
    f.setBusy(true); f.button('拍摄到画布').click(); f.button('画幅比例').click(); f.button('还原并退出').click(); f.key(f.hud, 'Escape');
    assert.equal(f.calls.length, 0); assert(f.camera); assert.equal(f.hud.hidden, false); assert.equal(f.hud.getAttribute('aria-busy'), 'true');
    f.setBusy(false); assert.equal(f.button('完成').disabled, false);
  } finally {f.finish();}
});
test('pending capture locks optics and camera lease, keeps only save retry available, and preserves original failure message', async () => {
  const failure = Error('照片已加入画布，保存失败；再次拍摄可重试保存：storage-write-failed'), f = await fixture({capture: async () => {throw failure;}}); try {
    f.button('画幅比例').click(); assert(f.dom.window.document.querySelector('.sv3-camera-ratio-menu'));
    f.setPendingCapture(true); assert.equal(f.dom.window.document.querySelector('.sv3-camera-ratio-menu'), null);
    for (const label of ['画幅比例', '还原并退出', '完成']) assert.equal(f.button(label).disabled, true);
    for (const field of ['focalLength', 'apertureFNumber']) assert.equal(f.ruler(field).disabled, true);
    assert.equal(f.hud.querySelector('.sv3-camera-focus').disabled, true);
    const shutter = f.button('重试保存照片'); assert.equal(shutter.disabled, false); assert.equal(shutter.title, '重试保存照片');
    f.button('还原并退出').onclick(); f.button('完成').onclick(); f.button('画幅比例').onclick(); f.hud.querySelector('.sv3-camera-focus').onclick();
    f.ruler('focalLength').querySelector('[data-preset="85"]').onclick(); f.ruler('apertureFNumber').querySelector('[data-preset="2.8"]').onclick();
    f.key(f.hud, 'Escape'); f.key(f.ruler('focalLength').querySelector('[role=slider]'), 'Escape'); f.key(f.ruler('focalLength').querySelector('[role=slider]'), 'ArrowRight');
    assert.deepEqual(f.calls, []); assert.deepEqual(f.camera, f.initial);
    shutter.click(); await tick(); assert.deepEqual(f.calls.map(item => item.name), ['capture']); assert.equal(f.errors[0], failure); assert.equal(f.hud.querySelector('[role=alert]').textContent, failure.message);
    assert.equal(shutter.disabled, false); assert.equal(f.button('完成').disabled, true); assert.equal(f.hud.hidden, false);
  } finally {f.finish();}
});
test('pending capture retry obeys busy fences and unlocks the original camera only after host receipt clears', async () => {
  const saved = deferred(), f = await fixture({capture: () => saved.promise}); try {
    f.setPendingCapture(true); const shutter = f.button('重试保存照片');
    f.setBusy(true); assert.equal(shutter.disabled, true); shutter.onclick(); f.key(f.hud, 'Escape'); assert.deepEqual(f.calls, []);
    f.setBusy(false); assert.equal(shutter.disabled, false); shutter.click(); assert.equal(shutter.disabled, true); assert.equal(f.hud.getAttribute('aria-busy'), 'true');
    shutter.onclick(); f.button('完成').onclick(); assert.deepEqual(f.calls.map(item => item.name), ['capture']);
    f.setPendingCapture(false); assert.equal(shutter.disabled, true); assert.equal(f.button('完成').disabled, true);
    saved.resolve({ok: true}); await tick(); assert.equal(f.button('拍摄到画布'), shutter); assert.equal(shutter.disabled, false); assert.equal(f.button('完成').disabled, false); assert.equal(f.ruler('focalLength').disabled, false); assert.deepEqual(f.camera, f.initial);
    f.button('完成').click(); await tick(); assert.equal(f.camera, null); assert.deepEqual(f.calls.map(item => item.name), ['capture', 'finish']);
  } finally {f.finish();}
});
test('false apply/finish/cancel do not claim saving or exiting; refused ratio leaves menu open for recovery', async () => {
  const f = await fixture({apply: () => false, finish: () => false, cancel: () => false}); try {
    f.ruler('focalLength').querySelector('[data-preset="85"]').click(); assert.equal(f.camera.focalLength, 24); assert.equal(f.errors.length, 1);
    f.button('画幅比例').click(); const option = f.dom.window.document.querySelector('[data-ratio="1:1"]'); option.click(); assert.equal(f.camera.frameAspectRatio, 16 / 9); assert(option.isConnected);
    f.button('完成').click(); await tick(); assert.equal(f.hud.hidden, false); f.button('还原并退出').click(); await tick(); assert(f.camera); assert.equal(f.hud.querySelector('[role=alert]').hidden, false);
  } finally {f.finish();}
});
test('camera HUD exposes the official movement-hotkey blocking marker for every descendant', async () => {
  const f = await fixture(); try {
    const selector = '[data-world-workspace-block-movement-hotkeys="true"]';
    assert.equal(f.hud.getAttribute('data-world-workspace-block-movement-hotkeys'), 'true');
    for (const target of [f.ruler('focalLength').querySelector('[role=slider]'), f.ruler('apertureFNumber').querySelector('[role=slider]'), f.button('拍摄到画布'), f.button('完成')]) assert.equal(target.closest(selector), f.hud);
  } finally {f.finish();}
});
test('real camera navigation window capture leaves HUD ArrowRight to focal editing and cannot rotate or move its camera', async () => {
  const {createCameraNavigation} = await import('../src/features/studio-v3/camera-navigation.mjs'), f = await fixture(); let navigation;
  try {
    const canvas = f.dom.window.document.createElement('canvas'); f.hud.parentElement.append(canvas); const writes = [];
    navigation = createCameraNavigation({canvas, eventTarget: f.dom.window, readCamera: () => f.camera, applyCamera: (camera, context) => {writes.push(context); f.setCamera(camera); return true;}, onError: error => f.errors.push(error)});
    assert.equal(navigation.start(), true); const slider = f.ruler('focalLength').querySelector('[role=slider]'); slider.focus();
    const arrow = f.key(slider, 'ArrowRight', {code: 'ArrowRight'}); assert.equal(arrow.defaultPrevented, true); assert(f.camera.focalLength > f.initial.focalLength);
    assert.equal(navigation.needsFrame(), false); assert.equal(navigation.tick(.05), false); assert.deepEqual(writes, []);
    assert.deepEqual(f.camera.rotation, f.initial.rotation); assert.deepEqual(f.camera.position, f.initial.position);
    f.key(slider, 'w', {code: 'KeyW'}); f.key(f.button('拍摄到画布'), 'ArrowRight', {code: 'ArrowRight'}); assert.equal(navigation.needsFrame(), false); assert.equal(navigation.tick(.05), false); assert.deepEqual(writes, []);
    const sceneArrow = f.key(canvas, 'ArrowRight', {code: 'ArrowRight'}); assert.equal(sceneArrow.defaultPrevented, true); assert.equal(navigation.needsFrame(), true); assert.equal(navigation.tick(.05), true);
    assert.equal(writes[0].reason, 'arrow-look'); assert.notEqual(f.camera.rotation.y, f.initial.rotation.y); assert.deepEqual(f.errors, []);
  } finally {navigation?.dispose(); f.finish();}
});
test('IME, local slider keys and pointer events are isolated from camera navigation', async () => {
  const f = await fixture(); try {
    let leaked = 0; f.dom.window.addEventListener('keydown', () => leaked++); f.dom.window.addEventListener('pointerdown', () => leaked++);
    f.key(f.hud, 'Escape', {isComposing: true}); f.key(f.hud, 'Escape', {keyCode: 229}); assert.equal(f.calls.length, 0);
    const slider = f.ruler('focalLength').querySelector('[role=slider]'); f.key(slider, 'ArrowRight'); assert(f.camera.focalLength > 24); assert.equal(leaked, 0);
    f.ruler('focalLength').querySelector('.sv3-camera-ruler-window').dispatchEvent(new f.dom.window.Event('pointerdown', {bubbles: true})); assert.equal(leaked, 0);
  } finally {f.finish();}
});
test('fixed ruler schedules finite original spring and tick highlight animation and dispose cancels it', async () => {
  const f = await fixture(); try {
    f.dom.window.matchMedia = () => ({matches: false}); const frames = new Map(); let sequence = 0;
    f.dom.window.requestAnimationFrame = callback => {frames.set(++sequence, callback); return sequence;}; f.dom.window.cancelAnimationFrame = id => frames.delete(id);
    f.ruler('focalLength').querySelector('[data-preset="135"]').click(); assert(frames.size > 0);
    for (let time = 0; time < 2000 && frames.size; time += 16) {const batch = [...frames]; frames.clear(); for (const [, callback] of batch) callback(time);}
    assert.equal(frames.size, 0); const position = f.module.cameraRulerPosition(135, 8, 400, 534); assert.equal(f.ruler('focalLength').querySelector('.sv3-camera-ruler-track').style.transform, `translateX(${37 - position}px)`);
    f.ruler('focalLength').querySelector('[data-preset="24"]').click(); assert(frames.size > 0); f.hud.dispose(); assert.equal(frames.size, 0); f.button('完成').click(); assert.equal(f.calls.some(item => item.name === 'finish'), false); assert(f.camera);
  } finally {f.finish();}
});
test('unchanged and pose-only per-frame refresh never schedules empty ruler animation work', async () => {
  const f = await fixture(); try {
    f.dom.window.matchMedia = () => ({matches: false}); let requested = 0; f.dom.window.requestAnimationFrame = () => {requested++; return requested;}; f.dom.window.cancelAnimationFrame = () => {};
    for (let index = 0; index < 100; index++) {f.hud.refresh(); f.setCamera({...f.camera, position: {x: index, y: 2, z: 3}});}
    assert.equal(requested, 0);
  } finally {f.finish();}
});
test('standalone preview shutter loads shared original ring style even before a camera HUD exists', async () => {
  const f = await fixture(); try {
    f.dom.window.document.querySelector('link[data-studio-v3-camera-hud]').remove(); let captured = 0;
    const shutter = f.module.createCameraShutter(() => {captured++;}); assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-camera-hud]').length, 1);
    shutter.click(); assert.equal(captured, 1); assert.equal(shutter.getAttribute('aria-label'), '拍摄到画布');
  } finally {f.finish();}
});
test('ordinary GLB profile hides and disables DOF controls while retaining real ratio/focal/capture, Spark profile restores them', async () => {
  const f = await fixture(); try {
    f.setDepthOfField(false); assert.equal(f.ruler('apertureFNumber').hidden, true); assert.equal(f.ruler('apertureFNumber').disabled, true); assert.equal(f.hud.querySelector('.sv3-camera-focus').hidden, true); assert.equal(f.hud.querySelector('.sv3-camera-focus').disabled, true);
    f.ruler('apertureFNumber').querySelector('[data-preset="2.8"]').click(); f.hud.querySelector('.sv3-camera-focus').click(); assert.equal(f.calls.length, 0);
    assert.equal(f.ruler('focalLength').hidden, false); assert.equal(f.ruler('focalLength').disabled, false); assert.equal(f.button('拍摄到画布').disabled, false);
    f.ruler('focalLength').querySelector('[data-preset="50"]').click(); assert.equal(f.camera.focalLength, 50);
    f.setDepthOfField(true); assert.equal(f.ruler('apertureFNumber').hidden, false); assert.equal(f.hud.querySelector('.sv3-camera-focus').hidden, false);
  } finally {f.finish();}
});
