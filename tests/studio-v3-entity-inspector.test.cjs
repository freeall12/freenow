'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), oldCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (oldCanvas) require.cache[canvasPath] = oldCanvas; else delete require.cache[canvasPath];
const modules = Promise.all([import('../src/features/studio-v3/entity-inspector.mjs'), import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/camera-optics.mjs')]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const model = fs.readFileSync(path.join(__dirname, '../assets/studio/character.glb'));
const modelBuffer = () => model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
async function fixture({kind = 'actor', locked = false, baseline = false, applyAction, fetchAsset} = {}) {
  const [inspector, actions, schema, optics] = await modules;
  let state = schema.createState({worldNodeId: 'inspector-owner', now: 100});
  state = actions.reduceEntityAction(state, {type: 'create', kind, id: 'entity-a', ...(kind === 'actor' ? {roleId: 'role-a'} : kind === 'prop' ? {assetId: 'chair-office'} : {}), locked, ...(baseline ? {setupId: 'setup-default'} : {})}, {now: 101}).state;
  const dom = new JSDOM('<head></head><body><div class="studio-v3" id="root"></div><button id="outside">outside</button></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  const calls = [], errors = [], closed = [], baselineCalls = [];
  const control = () => actions.resolveEntityControl(state, {entityId: 'entity-a'});
  const apply = async action => {
    calls.push(action);
    if (applyAction) return applyAction(action, {state, setState: next => {state = next;}, actions});
    const result = actions.reduceEntityAction(state, action, {now: 102 + calls.length});
    if (result.ok) state = result.state;
    return result;
  };
  const panel = inspector.createEntityInspector({control, applyAction: apply, onError: error => errors.push(error), close: () => closed.push(true), onEditBaseline: id => baselineCalls.push(id), fetchAsset: fetchAsset || (async () => ({ok: true, arrayBuffer: async () => modelBuffer()}))});
  dom.window.document.querySelector('#root').append(panel); await panel.ready;
  const input = field => panel.querySelector(`[data-field="${field}"]`);
  const key = (target, key, patch = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...patch}); target.dispatchEvent(event); return event;};
  const draft = (target, value) => {target.value = String(value); target.dispatchEvent(new dom.window.Event('input', {bubbles: true}));};
  const change = target => target.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  return {inspector, actions, schema, optics, dom, panel, calls, errors, closed, baselineCalls, control, input, key, draft, change,
    blur: target => target.dispatchEvent(new dom.window.Event('blur')),
    get state() {return state;}, setState(next) {state = next;},
    finish() {panel.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}

test('actual local GLB has all nine official authorable clips, and non-authorable movement clips stay out of the menu', async () => {
  const f = await fixture(); try {
    const options = f.inspector.readCharacterPoseOptions(modelBuffer());
    assert.equal(options.length, 9); assert.equal(f.panel.querySelectorAll('[data-pose]').length, 9);
    assert.deepEqual(options.map(item => item.id), ['stand', 'sit', 'sit-floor', 'crouch', 'kneel', 'sleep-side', 'sleep-supine', 'lie-prone', 'sleep-supine-straight']);
    for (const name of ['Idle', 'Walking', 'Walking Backward', 'Jump', 'Running']) assert.equal(options.some(item => item.clipName === name), false);
    assert.throws(() => f.inspector.readCharacterPoseOptions(model.subarray(0, 28)), /完整/);
    for (const option of options) {
      f.panel.querySelector(`[data-pose="${option.id}"]`).click(); await tick();
      assert.equal(f.control().setupState.pose, option.clipName);
      assert.equal(f.panel.querySelector(`[data-pose="${option.id}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(f.calls.length, 9); assert.deepEqual(f.errors, []);
  } finally {f.finish();}
});
test('Enter, native change and blur share a single accepted commit; ordinary focus/blur never writes displayed rounding', async () => {
  let accept;
  const pending = new Promise(resolve => {accept = resolve;});
  const f = await fixture({applyAction: async (action, {state, setState, actions}) => {await pending; const result = actions.reduceEntityAction(state, action); setState(result.state); return result;}});
  try {
    const input = f.input('position.x'); f.blur(input); assert.equal(f.calls.length, 0);
    f.draft(input, '1.23456789'); assert.equal(f.key(input, 'Enter').defaultPrevented, true);
    assert.equal(input.readOnly, true); f.change(input); f.blur(input); f.key(input, 'Enter');
    assert.equal(f.calls.length, 1); accept(); await tick();
    assert.equal(input.value, '1.235'); assert.equal(input.readOnly, false); assert.equal(input.hasAttribute('aria-busy'), false);
    assert.equal(f.control().setupState.transform.position.x, 1.23456789); f.blur(input); assert.equal(f.calls.length, 1);
    const y = f.input('position.y'); f.draft(y, '4.2'); f.change(y); f.blur(y); await tick();
    assert.equal(f.calls.length, 2); assert.equal(f.control().setupState.transform.position.y, 4.2);
  } finally {f.finish();}
});
test('Escape discards all unaccepted drafts and closes; IME keys/blur/change never commit mid-composition', async () => {
  const f = await fixture(); try {
    const x = f.input('position.x'), y = f.input('position.y');
    f.draft(x, '8'); x.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
    f.key(x, 'Enter', {isComposing: true}); f.key(x, 'Escape', {keyCode: 229}); f.change(x); f.blur(x); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.closed.length, 0);
    x.dispatchEvent(new f.dom.window.CompositionEvent('compositionend')); f.draft(y, '9');
    f.key(x, 'Escape'); f.blur(x); f.blur(y); f.change(y); await tick();
    assert.equal(x.value, '0'); assert.equal(y.value, '0'); assert.equal(f.closed.length, 1); assert.equal(f.calls.length, 0);
  } finally {f.finish();}
});
test('rejected or thrown mutations restore accepted input and report error without marking a draft as saved', async () => {
  for (const failure of [{ok: false, message: '基准禁止编辑'}, undefined, Error('本地保存失败')]) {
    const f = await fixture({applyAction: async () => {if (failure instanceof Error) throw failure; return failure;}});
    try {
      const input = f.input('position.x'); f.draft(input, '7'); f.key(input, 'Enter'); await tick();
      assert.equal(input.value, '0'); assert.equal(f.control().setupState.transform.position.x, 0);
      assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 1); assert.equal(input.readOnly, false);
      f.blur(input); assert.equal(f.calls.length, 1);
    } finally {f.finish();}
  }
});
test('empty/invalid numbers and zero scale recover accepted values; rotations commit radians and preserve other axes', async () => {
  const f = await fixture(); try {
    for (const value of ['', '0']) {const input = f.input('scale.x'); f.draft(input, value); f.key(input, 'Enter'); await tick(); assert.equal(input.value, '1');}
    assert.equal(f.calls.length, 0); assert.equal(f.errors.length, 2);
    const rotation = f.input('rotation.y'); f.draft(rotation, '90'); f.blur(rotation); await tick();
    assert.equal(f.control().setupState.transform.rotation.y, Math.PI / 2); assert.equal(f.control().setupState.transform.rotation.x, 0);
    assert.deepEqual(f.calls[0].patch, {transform: {rotation: {y: Math.PI / 2}}});
  } finally {f.finish();}
});
test('locked permits definition color and setup visibility; baseline disables every setup field while allowing world definition edits', async () => {
  for (const baseline of [false, true]) {
    const f = await fixture({locked: true, baseline}); try {
      assert.equal(f.input('position.x').disabled, true); assert.equal(f.panel.querySelector('[data-pose]').disabled, true);
      const visible = f.panel.querySelector('input[type=checkbox]'); assert.equal(visible.disabled, baseline);
      const gold = f.panel.querySelector('[data-color=gold]'); assert.equal(gold.disabled, false); gold.click(); await tick(); assert.equal(f.control().definition.color, '#D0A552');
      if (!baseline) {visible.checked = false; f.change(visible); await tick(); assert.equal(f.control().setupState.visible, false);}
      else {f.panel.querySelector('button[aria-label="前往场景基准编辑"]').click(); assert.deepEqual(f.baselineCalls, ['setup-default']);}
    } finally {f.finish();}
  }
});
test('only prop offers default color and source/clay material; color is instance data without changing its shared role', async () => {
  const actor = await fixture(); try {
    const originalRole = structuredClone(actor.state.scenePlay.worldSpace.characterRoles[0]);
    assert.equal(actor.panel.querySelector('[data-default-material]'), null);
    assert.equal(actor.panel.querySelector('select[aria-label="材质"]'), null);
    actor.panel.querySelector('[data-color=teal]').click(); await tick();
    assert.equal(actor.control().definition.color, '#63B5A2'); assert.deepEqual(actor.state.scenePlay.worldSpace.characterRoles[0], originalRole);
  } finally {actor.finish();}
  const prop = await fixture({kind: 'prop'}); try {
    prop.panel.querySelector('[data-color=teal]').click(); await tick(); prop.panel.querySelector('[data-default-material]').click(); await tick();
    assert.equal(Object.hasOwn(prop.control().definition, 'color'), false); assert.deepEqual(prop.calls.at(-1).patch, {color: null});
    const select = prop.panel.querySelector('select[aria-label="材质"]'); select.value = 'clay'; prop.change(select); await tick(); assert.equal(prop.control().definition.materialMode, 'clay');
    select.value = 'source'; prop.change(select); await tick(); assert.equal(prop.control().definition.materialMode, 'source');
    assert.equal(prop.errors.length, 0);
  } finally {prop.finish();}
});
test('camera focal length, FOV, ratio, aperture and focus use real reducer projection and accepted fields', async () => {
  const f = await fixture({kind: 'camera'}); try {
    const edit = async (field, value) => {const input = f.input(`camera.${field}`); f.draft(input, value); f.key(input, 'Enter'); await tick();};
    await edit('focalLength', 85); assert.equal(f.control().setupState.camera.focalLength, 85);
    assert.equal(f.control().setupState.camera.fov, f.optics.focalLengthToFov(85, 16 / 9));
    assert.equal(f.input('camera.fov').value, String(Number(f.control().setupState.camera.fov.toFixed(3))));
    const ratio = f.panel.querySelector('select[aria-label="画幅比例"]'); ratio.value = '1'; f.change(ratio); await tick();
    assert.equal(f.control().setupState.camera.frameAspectRatio, 1); assert.equal(f.control().setupState.camera.focalLength, 85);
    await edit('fov', 40); assert.equal(f.control().setupState.camera.focalLength, f.optics.fovToFocalLength(40, 1));
    await edit('apertureFNumber', 2.8); assert.equal(f.control().setupState.camera.depthOfFieldMode, 'aperture');
    f.panel.querySelector('button[aria-label="全景深"]').click(); await tick(); assert.equal(f.control().setupState.camera.depthOfFieldMode, 'deepFocus');
    await edit('focusDistance', 12.5); assert.deepEqual(f.control().setupState.camera.focus, {mode: 'distance', distance: 12.5}); assert.equal(f.control().setupState.camera.focusDistance, 12.5);
    await edit('focalLength', -2); assert.equal(f.input('camera.focalLength').value, String(Number(f.control().setupState.camera.focalLength.toFixed(3)))); assert.equal(f.errors.length, 1);
    assert.match(f.panel.textContent, /尚未显示景深虚化/); assert.equal(f.panel.querySelector('[aria-label="点选对焦"]'), null);
  } finally {f.finish();}
});
test('failed actual GLB load disables poses, reports once and resolves ready without an unhandled rejection', async () => {
  const f = await fixture({fetchAsset: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(20)})}); try {
    assert.equal(await f.panel.ready, false); assert.equal(f.errors.length, 1); assert.equal(f.panel.querySelector('[data-pose]').disabled, true);
    assert.match(f.panel.textContent, /人物姿态读取失败/);
  } finally {f.finish();}
});
test('inspector stylesheet attaches once and disposing cancels pending model loading', async () => {
  const f = await fixture({kind: 'prop'}); try {
    let signal;
    const c = structuredClone(f.control()); c.definition.kind = 'actor'; c.definition.asset.sourceUrl = '/assets/studio/character.glb'; c.setupState.pose = 'Standing';
    const panel = f.inspector.createEntityInspector({control: c, applyAction: async () => ({ok: true}), fetchAsset: (_url, opts) => {signal = opts.signal; return new Promise((resolve, reject) => {signal.addEventListener('abort', () => reject(Error('aborted')));});}, onError: error => f.errors.push(error)});
    f.dom.window.document.querySelector('#root').append(panel); await tick(); panel.dispose();
    assert.equal(signal.aborted, true); assert.equal(await panel.ready, false); assert.deepEqual(f.errors, []);
    assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-inspector]').length, 1);
  } finally {f.finish();}
});
test('point focus displays no invented distance and explicit distance switches the actual focus mode', async () => {
  const f = await fixture({kind: 'camera'}); try {
    f.setState(f.actions.reduceEntityAction(f.state, {type: 'update', entityId: 'entity-a', patch: {camera: {focus: {mode: 'point', target: {x: 2, y: 1, z: -5}}}}}).state); f.panel.refresh();
    const distance = f.input('camera.focusDistance'); assert.equal(distance.value, ''); f.blur(distance); assert.equal(f.calls.length, 0);
    assert.match(f.panel.textContent, /按场景中的点对焦/);
    f.draft(distance, 4); f.key(distance, 'Enter'); await tick(); assert.deepEqual(f.control().setupState.camera.focus, {mode: 'distance', distance: 4});
  } finally {f.finish();}
});
