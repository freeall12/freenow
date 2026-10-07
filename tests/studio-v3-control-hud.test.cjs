'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/control-hud.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((accept, fail) => {resolve = accept; reject = fail;}); return {promise, resolve, reject};}
async function fixture(overrides = {}) {
  const module = await modulePromise, dom = new JSDOM('<head></head><body><div class="studio-v3" id="root"></div><button id="outside">outside</button></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  let control = {entityId: 'actor-a', kind: 'actor', label: '角色 A', headingDeg: 30, dirty: false, inputActive: true, help: 'WASD 移动，Q/E 调整高度'}, height = 2;
  const calls = [], errors = [];
  const standard = {
    drop: () => {height = 0; control.dirty = true; return true;}, moveDown: () => {height -= .1; control.dirty = true; return true;}, moveUp: () => {height += .1; control.dirty = true; return true;},
    setHeading: value => {control.headingDeg = value; control.dirty = true; return true;},
    cancel: () => {control = null; height = 2; return true;}, finish: () => {control = null; return true;}
  };
  const options = {getControl: () => control, onError: error => errors.push(error)};
  for (const name of Object.keys(standard)) options[name] = async (...args) => {calls.push({name, args}); return overrides[name] ? overrides[name](...args, {getControl: () => control, setControl: value => {control = value;}, standard: standard[name]}) : standard[name](...args);};
  const hud = module.createControlHUD(options); dom.window.document.querySelector('#root').append(hud);
  const input = hud.querySelector('[data-field=heading-number]'), range = hud.querySelector('[data-field=heading-slider]');
  const key = (target, key, patch = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...patch}); target.dispatchEvent(event); return event;};
  const draft = value => {input.value = String(value); input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));};
  const change = node => node.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  return {module, dom, hud, input, range, calls, errors, options, key, draft, change,
    button: label => hud.querySelector(`button[aria-label="${label}"]`),
    get control() {return control;}, get height() {return height;}, setControl(value) {control = value; hud.refresh();},
    finish() {hud.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}

test('official action order, original SVG icons, shortcuts, heading ticks and ruler dimensions', async () => {
  const f = await fixture(); try {
    assert.deepEqual([...f.hud.children].filter(node => node.tagName === 'BUTTON').map(node => node.getAttribute('aria-label')), ['落到地面', '下移', '上移', '还原并退出', '完成']);
    for (const [label, shortcut] of [['落到地面', 'G'], ['下移', 'Q'], ['上移', 'E'], ['完成', 'Escape']]) {assert.equal(f.button(label).getAttribute('aria-keyshortcuts'), shortcut); assert(f.button(label).querySelector('svg'));}
    assert.deepEqual([...f.hud.querySelectorAll('[data-heading]')].map(node => Number(node.dataset.heading)), [0, 90, 180, 270, 359]);
    assert.equal(f.range.min, '0'); assert.equal(f.range.max, '359'); assert.equal(f.range.step, '1');
    assert.equal(f.module.CONTROL_HEADING_LAYOUT.trackWidth, 360); assert.equal(f.module.CONTROL_HEADING_LAYOUT.readoutWidth, 40); assert.equal(f.module.CONTROL_HEADING_LAYOUT.visibleTrackWidth, 74);
    assert.equal(f.hud.dataset.keyboardScope, 'local-tool'); assert.match(f.hud.getAttribute('aria-label'), /角色 A/); assert.equal(f.hud.title, f.control.help);
    assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-control-hud]').length, 1);
  } finally {f.finish();}
});
test('slider input and preset only preview heading and never finish the transaction', async () => {
  const f = await fixture(); try {
    f.range.value = '85'; f.range.dispatchEvent(new f.dom.window.Event('input', {bubbles: true})); await tick();
    assert.equal(f.control.headingDeg, 85); assert.equal(f.input.value, '85'); assert.equal(f.hud.hidden, false); assert.deepEqual(f.calls, [{name: 'setHeading', args: [85]}]);
    f.hud.querySelector('[data-heading="270"]').click(); await tick(); assert.equal(f.control.headingDeg, 270); assert.equal(f.calls.length, 2);
    assert.equal(f.calls.some(item => ['finish', 'cancel'].includes(item.name)), false); assert.equal(f.hud.dataset.dirty, 'true');
  } finally {f.finish();}
});
test('height and ground buttons invoke their real callbacks; restore and completion close only after successful callback', async () => {
  const f = await fixture(); try {
    f.button('下移').click(); await tick(); assert.equal(f.height, 1.9);
    f.button('上移').click(); await tick(); assert.equal(f.height, 2);
    f.button('落到地面').click(); await tick(); assert.equal(f.height, 0);
    f.button('还原并退出').click(); await tick(); assert.equal(f.height, 2); assert.equal(f.control, null); assert.equal(f.hud.hidden, true);
    assert.deepEqual(f.calls.map(item => item.name), ['moveDown', 'moveUp', 'drop', 'cancel']);
  } finally {f.finish();}
});
test('number Enter/native change/blur submit a single accepted preview, with no commit on untouched blur', async () => {
  const pending = deferred();
  const f = await fixture({setHeading: async (value, {standard}) => {await pending.promise; return standard(value);}}); try {
    f.input.dispatchEvent(new f.dom.window.Event('blur')); assert.equal(f.calls.length, 0);
    f.draft(180); f.key(f.input, 'Enter'); f.change(f.input); f.input.dispatchEvent(new f.dom.window.Event('blur')); f.key(f.input, 'Enter');
    assert.equal(f.input.readOnly, true); assert.equal(f.calls.length, 1); pending.resolve(); await tick();
    assert.equal(f.control.headingDeg, 180); assert.equal(f.input.value, '180'); assert.equal(f.input.readOnly, false);
    f.input.dispatchEvent(new f.dom.window.Event('blur')); assert.equal(f.calls.length, 1);
    assert.equal(f.calls.some(item => item.name === 'finish'), false);
  } finally {f.finish();}
});
test('invalid heading drafts recover accepted value; failed callbacks show readable feedback and preserve session', async () => {
  const f = await fixture({setHeading: async () => ({ok: false, message: '当前状态不允许操控'})}); try {
    for (const value of ['', -1, 360]) {f.draft(value); f.key(f.input, 'Enter'); await tick(); assert.equal(f.input.value, '30');}
    assert.equal(f.calls.length, 0); assert.equal(f.errors.length, 3);
    f.draft(90); f.key(f.input, 'Enter'); await tick(); assert.equal(f.input.value, '30'); assert.equal(f.control.headingDeg, 30);
    assert.equal(f.errors.length, 4, 'a rejected numeric mutation is reported once');
    assert.match(f.hud.querySelector('[role=alert]').textContent, /当前状态不允许操控/); assert.equal(f.hud.querySelector('[role=alert]').hidden, false);
    assert.equal(f.hud.hidden, false); assert.equal(f.input.readOnly, false);
  } finally {f.finish();}
});
test('undefined/false/throw button results are rejected, and a successful later retry clears the failure', async () => {
  for (const failure of [undefined, false, Error('操控保存失败')]) {
    let attempts = 0;
    const f = await fixture({finish: async (_args) => {attempts++; if (attempts === 1) {if (failure instanceof Error) throw failure; return failure;} return {ok: true};}}); try {
      f.button('完成').click(); await tick(); assert.equal(f.hud.hidden, false); assert.equal(f.errors.length, 1); assert.equal(f.hud.querySelector('[role=alert]').hidden, false);
      f.button('完成').click(); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.hud.querySelector('[role=alert]').hidden, true);
    } finally {f.finish();}
  }
});
test('IME Enter/Escape and composing native events do nothing; regular number Escape discards draft then finishes', async () => {
  const f = await fixture(); try {
    f.draft(220); f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
    f.key(f.input, 'Enter', {isComposing: true}); f.key(f.input, 'Escape', {keyCode: 229}); f.change(f.input); f.input.dispatchEvent(new f.dom.window.Event('blur')); await tick();
    assert.equal(f.calls.length, 0); assert(f.control);
    f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend')); f.key(f.input, 'Escape'); await tick();
    assert.deepEqual(f.calls.map(item => item.name), ['finish']); assert.equal(f.input.value, '30'); assert.equal(f.hud.hidden, true);
  } finally {f.finish();}
});
test('G/Q/E and Escape on HUD buttons execute locally once; text/range keys and pointer events never bubble to scene', async () => {
  const f = await fixture(); try {
    let leaked = 0; f.dom.window.addEventListener('keydown', () => leaked++); f.dom.window.addEventListener('keyup', () => leaked++); f.dom.window.addEventListener('pointerdown', () => leaked++);
    for (const key of ['G', 'q', 'E']) {const target = f.button('落到地面'); assert.equal(f.key(target, key).defaultPrevented, true); await tick(); target.dispatchEvent(new f.dom.window.KeyboardEvent('keyup', {key, bubbles: true}));}
    assert.deepEqual(f.calls.map(item => item.name), ['drop', 'moveDown', 'moveUp']);
    f.key(f.input, 'g'); f.key(f.range, 'q'); f.key(f.button('落到地面'), 'G', {repeat: true}); await tick(); assert.equal(f.calls.length, 3);
    f.button('下移').dispatchEvent(new f.dom.window.Event('pointerdown', {bubbles: true})); assert.equal(leaked, 0);
    f.key(f.range, 'Escape'); await tick(); assert.equal(f.control, null); assert.equal(f.calls.at(-1).name, 'finish');
  } finally {f.finish();}
});
test('async slider previews coalesce to last value without ending transaction, and pending actions cannot double execute', async () => {
  const pending = deferred(); let first = true;
  const f = await fixture({setHeading: async (value, {standard}) => {if (first) {first = false; await pending.promise;} return standard(value);}}); try {
    for (const value of [60, 70, 80, 90]) {f.range.value = String(value); f.range.dispatchEvent(new f.dom.window.Event('input', {bubbles: true}));}
    assert.equal(f.calls.length, 1); pending.resolve(); await tick(); assert.deepEqual(f.calls.map(item => item.args[0]), [60, 90]); assert.equal(f.control.headingDeg, 90);
    assert.equal(f.calls.some(item => item.name === 'finish'), false); assert.equal(f.input.value, '90');
  } finally {f.finish();}
});
test('refresh follows external headings without overwriting dirty number drafts; inputActive=false preserves editable session', async () => {
  const f = await fixture(); try {
    f.draft(55); f.setControl({...f.control, headingDeg: 120, inputActive: false}); assert.equal(f.input.value, '55'); assert.equal(f.range.value, '120'); assert.equal(f.input.disabled, false);
    f.key(f.input, 'Enter'); await tick(); assert.equal(f.control.headingDeg, 55); assert.equal(f.input.value, '55');
    f.setControl({...f.control, headingDeg: 200}); assert.equal(f.input.value, '200');
    f.setControl({...f.control, headingDeg: null}); assert.equal(f.hud.querySelector('.sv3-control-rotation-group').hidden, true);
    f.setControl(null); assert.equal(f.hud.hidden, true); assert.equal(f.button('完成').disabled, true);
  } finally {f.finish();}
});
test('dispose cancels drafts and queued previews, prevents future callbacks, and never cancels the host transaction itself', async () => {
  const f = await fixture(); try {
    f.draft(300); f.hud.dispose(); f.key(f.input, 'Enter'); f.input.dispatchEvent(new f.dom.window.Event('blur')); f.button('上移').click(); await tick();
    assert.equal(f.calls.length, 0); assert(f.control); assert.equal(f.control.headingDeg, 30);
  } finally {f.finish();}
});
test('pointer dragging moves the official ruler underneath its fixed indicator without completing control', async () => {
  const f = await fixture(); try {
    const viewport = f.hud.querySelector('.sv3-control-ruler-window'); let capture = null;
    viewport.setPointerCapture = id => {capture = id;}; viewport.hasPointerCapture = id => capture === id; viewport.releasePointerCapture = () => {capture = null;};
    const pointer = (type, x) => {const event = new f.dom.window.MouseEvent(type, {button: 0, clientX: x, bubbles: true, cancelable: true}); Object.defineProperty(event, 'pointerId', {value: 1}); viewport.dispatchEvent(event);};
    pointer('pointerdown', 100); pointer('pointermove', 70); await tick(); pointer('pointerup', 70);
    assert.equal(capture, null); assert.equal(f.control.headingDeg, 60); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'setHeading');
    assert.equal(f.hud.querySelector('.sv3-control-ruler-track').style.transform, `translateX(${37 - 60 / 359 * 360}px)`); assert(f.control);
  } finally {f.finish();}
});
test('real control-session captures coexist with HUD drafts and commit only accepted preview on Escape', async () => {
  const f = await fixture(); let hud, session;
  try {
    f.hud.dispose(); f.hud.remove();
    const {createControlSession} = await import('../src/features/studio-v3/control-session.mjs');
    const canvas = f.dom.window.document.createElement('canvas'); f.dom.window.document.querySelector('#root').append(canvas);
    const phases = [], rendered = [], transform = {position: {x: 0, y: 2, z: 0}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ'}, scale: {x: 1, y: 1, z: 1}};
    session = createControlSession({canvas, getSubject: () => ({kind: 'actor', label: '演员', transform}), getCameraPosition: () => ({x: 4, y: 3, z: 4}), setFollowCamera: () => {}, onControl: event => {phases.push(event); return true;}, onRenderTransform: (_id, value) => rendered.push(value)});
    assert.equal(session.start('actor-real'), true);
    hud = f.module.createControlHUD({getControl: () => session.active, drop: () => session.dropToGround(), moveDown: () => session.nudgeHeight('down'), moveUp: () => session.nudgeHeight('up'), setHeading: value => session.setHeading(value), cancel: () => session.cancel(), finish: () => session.finish(), onError: error => f.errors.push(error)});
    f.dom.window.document.querySelector('#root').append(hud);
    const input = hud.querySelector('[data-field=heading-number]'); input.focus(); input.value = '90'; input.dispatchEvent(new f.dom.window.Event('input', {bubbles: true}));
    f.key(input, 'w', {code: 'KeyW'}); assert(session.active); f.key(input, 'Enter'); await tick();
    assert.equal(Math.round(session.active.headingDeg), 90); assert.deepEqual(phases.map(item => item.phase), ['begin', 'preview']); assert(rendered.length > 0);
    input.value = '222'; input.dispatchEvent(new f.dom.window.Event('input', {bubbles: true})); f.key(input, 'Escape', {code: 'Escape'}); await tick();
    assert.equal(session.active, null); assert.deepEqual(phases.map(item => item.phase), ['begin', 'preview', 'commit']); assert.equal(hud.hidden, true); assert.equal(f.errors.length, 0);
    assert.deepEqual(phases[1].transform, phases[2].transform, 'Escape discards unaccepted 222-degree draft and commits the 90-degree preview');
  } finally {hud?.dispose(); session?.dispose(); f.finish();}
});
test('pointer focus into Restore clears the unaccepted number draft before native blur can preview it', async () => {
  const f = await fixture(); try {
    f.input.focus(); f.draft(260); const restore = f.button('还原并退出');
    restore.dispatchEvent(new f.dom.window.Event('pointerdown', {bubbles: true})); restore.focus(); restore.click(); await tick();
    assert.deepEqual(f.calls.map(item => item.name), ['cancel']); assert.equal(f.control, null); assert.equal(f.input.value, '30');
  } finally {f.finish();}
});
