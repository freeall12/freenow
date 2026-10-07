'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/viewfinder-optics.mjs'), opticsPromise = import('../src/features/studio-v3/camera-optics.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(accept => {resolve = accept;}); return {promise, resolve};}
async function fixture(override) {
  const [module, optics] = await Promise.all([modulePromise, opticsPromise]);
  const dom = new JSDOM('<head></head><body><div class="studio-v3" id="root"></div><button id="outside">outside</button></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  let state = optics.cameraOpticsPatch({}, {focalLength: 24.25}), closed = 0;
  const calls = [], errors = [];
  const standard = patch => {state = optics.cameraOpticsPatch(state, patch); return true;};
  const panel = module.createViewfinderOptics({read: () => state, apply: patch => {calls.push(patch); return override ? override(patch, standard) : standard(patch);}, close: () => closed++, onError: error => errors.push(error)});
  dom.window.document.querySelector('#root').append(panel);
  const query = selector => [...dom.window.document.querySelectorAll(selector)].find(node => !node.closest('[aria-hidden="true"]'));
  const button = label => query(`button[aria-label="${label}"]`);
  const key = (node, key, patch = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...patch}); node.dispatchEvent(event); return event;};
  const event = (node, type) => node.dispatchEvent(new dom.window.Event(type, {bubbles: type !== 'blur'}));
  const draft = (node, value) => {node.value = String(value); event(node, 'input');};
  return {module, optics, dom, panel, calls, errors, query, button, key, event, draft, get state() {return state;}, get closed() {return closed;}, setState(patch) {state = optics.cameraOpticsPatch(state, patch); panel.refresh();},
    finish() {panel.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}
test('ratio display uses the official two groups, all 19 values, five-column menu and local stylesheet', async () => {
  const f = await fixture(); try {
    assert.equal(f.panel.dataset.keyboardScope, 'local-tool'); assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-viewfinder-optics]').length, 1);
    assert.deepEqual([...f.panel.children].filter(node => node.tagName === 'BUTTON').map(node => node.getAttribute('aria-label')), ['画幅比例', '焦距', '光圈与景深', '对焦距离', '关闭镜头参数']);
    f.button('画幅比例').click();
    assert.deepEqual([...f.dom.window.document.querySelectorAll('[data-ratio]')].map(node => node.dataset.ratio), ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '4:5', '9:19.5', '9:21', '1.33:1', '1.37:1', '1.43:1', '1.66:1', '1.85:1', '2.00:1', '2.20:1', '2.35:1', '2.39:1']);
    assert.equal(f.dom.window.document.querySelectorAll('.sv3-viewfinder-ratio-grid').length, 2); assert.equal(f.query('[data-ratio="16:9"]').getAttribute('aria-pressed'), 'true');
    assert.equal(f.query('.sv3-portal').parentElement, f.dom.window.document.querySelector('#root'), 'popover escapes transformed dock ancestors');
    f.query('[data-ratio="9:16"]').click(); await tick();
    assert.deepEqual(f.calls, [{frameAspectRatio: 9 / 16}]); assert.equal(f.state.focalLength, 24.25); assert.match(f.button('画幅比例').textContent, /9:16/); assert.equal(f.button('画幅比例').getAttribute('aria-expanded'), 'false');
    assert.equal(f.panel.querySelectorAll('[data-field^="position"],[data-field^="scale"],[data-field=fov]').length, 0);
  } finally {f.finish();}
});
test('lens presets write exact focal/aperture values and deep focus retains authored aperture', async () => {
  const f = await fixture(); try {
    f.button('焦距').click(); assert.deepEqual([...f.dom.window.document.querySelectorAll('[data-focal-length]')].map(node => Number(node.dataset.focalLength)), f.optics.FOCAL_LENGTH_PRESETS);
    f.query('[data-focal-length="85"]').click(); await tick(); assert.equal(f.state.focalLength, 85); assert.equal(f.button('焦距').textContent, '85mm');
    f.button('光圈与景深').click(); assert.deepEqual([...f.dom.window.document.querySelectorAll('[data-aperture]')].map(node => Number(node.dataset.aperture)), f.optics.APERTURE_PRESETS);
    f.query('[data-aperture="2.8"]').click(); await tick(); assert.equal(f.state.depthOfFieldMode, 'aperture'); assert.equal(f.button('光圈与景深').textContent, 'ƒ/2.8');
    f.button('光圈与景深').click(); f.button('全景深').click(); await tick(); assert.equal(f.state.depthOfFieldMode, 'deepFocus'); assert.equal(f.state.apertureFNumber, 2.8);
    assert.deepEqual(f.calls, [{focalLength: 85}, {apertureFNumber: 2.8, depthOfFieldMode: 'aperture'}, {depthOfFieldMode: 'deepFocus'}]);
  } finally {f.finish();}
});
test('rounded untouched input blur writes nothing; Enter/change/blur share one pending submission', async () => {
  const pending = deferred(), f = await fixture(async (patch, standard) => {await pending.promise; return standard(patch);}); try {
    f.button('焦距').click(); const input = f.query('[data-field=focalLength]'); assert.equal(input.value, '24');
    f.event(input, 'blur'); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.state.focalLength, 24.25);
    f.draft(input, 50); f.key(input, 'Enter'); f.event(input, 'change'); f.event(input, 'blur'); f.key(input, 'Enter');
    assert.equal(f.calls.length, 1); assert.equal(input.readOnly, true); assert.equal(f.button('光圈与景深').disabled, true);
    pending.resolve(); await tick(); assert.equal(f.state.focalLength, 50); assert.equal(input.value, '50'); assert.equal(input.readOnly, false); assert.equal(f.button('光圈与景深').disabled, false);
  } finally {f.finish();}
});
test('positive numeric inputs clamp through shared optics; distance synchronizes focus mode', async () => {
  const f = await fixture(); try {
    f.button('焦距').click(); let input = f.query('[data-field=focalLength]'); f.draft(input, 999); f.key(input, 'Enter'); await tick(); assert.equal(f.state.focalLength, 400); assert.equal(input.value, '400');
    f.button('光圈与景深').click(); input = f.query('[data-field=apertureFNumber]'); f.draft(input, .5); f.key(input, 'Enter'); await tick(); assert.equal(f.state.apertureFNumber, 1.4); assert.equal(f.state.depthOfFieldMode, 'aperture');
    f.button('对焦距离').click(); input = f.query('[data-field=focusDistance]'); f.draft(input, .01); f.key(input, 'Enter'); await tick(); assert.equal(f.state.focusDistance, .1); assert.deepEqual(f.state.focus, {mode: 'distance', distance: .1});
    f.button('无限远').click(); await tick(); assert.equal(f.state.focusDistance, null); assert.deepEqual(f.state.focus, {mode: 'none'}); assert.equal(f.button('对焦距离').textContent, '∞');
  } finally {f.finish();}
});
test('false/undefined/thrown results restore accepted input and report once; invalid drafts never apply', async () => {
  for (const result of [false, undefined, Error('临时相机会话已变化')]) {
    const f = await fixture(() => {if (result instanceof Error) throw result; return result;}); try {
      f.button('焦距').click(); const input = f.query('[data-field=focalLength]');
      f.draft(input, 35); f.key(input, 'Enter'); await tick(); assert.equal(input.value, '24'); assert.equal(f.errors.length, 1); assert.equal(f.state.focalLength, 24.25);
      for (const value of ['', 0, -5]) {f.draft(input, value); f.key(input, 'Enter'); await tick(); assert.equal(input.value, '24');}
      assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 4);
    } finally {f.finish();}
  }
});
test('IME suppresses submission/dismissal; numeric Escape cancels draft and restores anchor focus', async () => {
  const f = await fixture(); try {
    f.button('焦距').click(); const input = f.query('[data-field=focalLength]');
    f.draft(input, 135); input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart')); f.key(input, 'Enter', {isComposing: true}); f.key(input, 'Escape', {keyCode: 229}); f.event(input, 'change'); f.event(input, 'blur'); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.closed, 0);
    input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend')); f.key(input, 'Escape'); assert.equal(input.value, '24'); assert.equal(f.button('焦距').getAttribute('aria-expanded'), 'false'); assert.equal(f.dom.window.document.activeElement, f.button('焦距'));
    f.key(f.button('焦距'), 'Escape'); assert.equal(f.closed, 1); assert.equal(f.calls.length, 0);
  } finally {f.finish();}
});
test('outside click dismisses a menu; disposed menu nodes and panel never invoke mutations', async () => {
  const f = await fixture(); try {
    f.button('焦距').click(); const preset = f.query('[data-focal-length="85"]'), input = f.query('[data-field=focalLength]');
    f.dom.window.document.querySelector('#outside').dispatchEvent(new f.dom.window.Event('pointerdown', {bubbles: true})); assert.equal(f.button('焦距').getAttribute('aria-expanded'), 'false');
    preset.click(); f.draft(input, 50); f.key(input, 'Enter'); await tick(); assert.equal(f.calls.length, 0);
    f.button('对焦距离').click(); const infinity = f.button('无限远'); f.panel.dispose(); infinity.click(); f.button('画幅比例').click(); f.panel.refresh(); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.closed, 0);
  } finally {f.finish();}
});
test('pending completion after disposal does not report stale errors or re-enable controls', async () => {
  const pending = deferred(), f = await fixture(() => pending.promise); try {
    f.button('焦距').click(); const input = f.query('[data-field=focalLength]'); f.draft(input, 35); f.key(input, 'Enter'); assert.equal(f.calls.length, 1);
    f.panel.dispose(); pending.resolve(false); await tick(); assert.equal(f.errors.length, 0); assert.equal(f.button('焦距').disabled, true);
    f.draft(input, 135); f.key(input, 'Enter'); assert.equal(f.calls.length, 1);
  } finally {f.finish();}
});
test('refresh follows actual visible camera and successful structured apply results are accepted', async () => {
  const f = await fixture((patch, standard) => {standard(patch); return {ok: true};}); try {
    f.setState({focalLength: 50, frameAspectRatio: 2.39, apertureFNumber: 4.04, depthOfFieldMode: 'aperture', focusDistance: 12.35});
    assert.equal(f.button('焦距').textContent, '50mm'); assert.match(f.button('画幅比例').textContent, /2.39:1/); assert.equal(f.button('光圈与景深').textContent, 'ƒ/4'); assert.equal(f.button('对焦距离').textContent, '12.3m');
    f.button('焦距').click(); const input = f.query('[data-field=focalLength]'); f.draft(input, 35); f.key(input, 'Enter'); await tick(); assert.equal(f.state.focalLength, 35); assert.equal(f.errors.length, 0);
  } finally {f.finish();}
});
