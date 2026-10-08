'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modulePromise = import('../src/features/studio-v3/saved-view-menu.mjs');
const menusPromise = import('../src/features/studio-v3/menus.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
const items = () => [
  {id: 'a', label: '全景', stageId: 'stage-a', setupId: 'setup-a', stageLabel: '摄影棚', setupLabel: '晨间状态', camera: {focalLength: 35, frameAspectRatio: 16 / 9}, tags: ['capture'], createdAt: 1},
  {id: 'b', label: '肖像', stageId: 'stage-b', setupId: 'setup-b', stageLabel: '室外', setupLabel: '夜景状态', camera: {focalLength: 85, frameAspectRatio: 9 / 16}, tags: ['capture', 'shot'], createdAt: 2}
];
async function fixture(overrides = {}) {
  const module = await modulePromise, dom = new JSDOM('<head></head><body><div class="studio-v3"><button id="trigger">视图</button></div></body>', {pretendToBeVisual: true});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: dom.window.document});
  let state = {items: items(), activeViewId: 'a', canSave: true, busy: false, ...overrides.state}; const calls = [], errors = [];
  const call = (action, args, fallback) => {calls.push({action, args}); return overrides[action] ? overrides[action](...args) : fallback();};
  const root = dom.window.document.querySelector('.studio-v3');
  const panel = module.createSavedViewMenu({read: () => state,
    onSave: () => call('save', [], () => true), onRetrySave: () => call('retry', [], () => {state.pendingSave = null; return true;}),
    onRestore: id => call('restore', [id], () => {state.activeViewId = id; return {ok: true};}),
    onUpdate: id => call('update', [id], () => {state.items = state.items.map(item => item.id === id ? {...item, camera: {...item.camera, focalLength: 50}} : item); return true;}),
    onRename: (id, name) => call('rename', [id, name], () => {state.items = state.items.map(item => item.id === id ? {...item, label: name} : item); return true;}),
    onRemove: id => call('remove', [id], () => {state.items = state.items.filter(item => item.id !== id); return true;}),
    ...(overrides.select ? {onSelect: id => call('select', [id], () => true)} : {}), onError: error => errors.push(error)
  });
  root.append(panel);
  const key = (target, value, patch = {}) => {const event = new dom.window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...patch}); target.dispatchEvent(event); return event;};
  return {module, dom, root, panel, calls, errors, key, get state() {return state;}, update(patch) {state = {...state, ...patch}; panel.refresh();},
    row: id => panel.querySelector(`[data-view-id="${id}"]`), button: label => [...panel.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label),
    draft(value) {const input = panel.querySelector('input'); input.value = value; input.dispatchEvent(new dom.window.Event('input', {bubbles: true})); return input;},
    blur: target => target.dispatchEvent(new dom.window.Event('blur')),
    finish() {panel.dispose(); dom.window.close(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;}
  };
}
test('real fields, active status and native restore actions remain distinct from selection', async () => {
  const f = await fixture({select: true}); try {
    assert.equal(f.panel.element, f.panel); assert.equal(f.panel.querySelectorAll('img').length, 0);
    assert.equal(f.row('a').querySelector('.sv3-saved-view-ownership').textContent, '摄影棚 · 晨间状态');
    assert.equal(f.row('b').querySelector('.sv3-saved-view-metadata').textContent, '85 mm · 9:16'); assert.equal(f.row('b').querySelector('.sv3-saved-view-tags').textContent, 'capture · shot');
    assert.equal(f.button('恢复视图“全景”').tagName, 'BUTTON'); assert.equal(f.button('恢复视图“全景”').getAttribute('aria-pressed'), 'true');
    f.button('选中视图“肖像”').click(); await tick(); f.button('恢复视图“全景”').click(); await tick();
    assert.deepEqual(f.calls, [{action: 'select', args: ['b']}, {action: 'restore', args: ['a']}]);
    assert.equal(f.module.savedViewMetadata({camera: {}}), '焦距未提供 · 画幅未提供');
    assert.equal(f.dom.window.document.querySelectorAll('link[data-studio-v3-saved-view-menu]').length, 1);
  } finally {f.finish();}
});
test('canSave gates actual save and camera update while restore, rename and delete remain usable', async () => {
  const f = await fixture({state: {canSave: false, disabledReason: '仅支持独立状态的3D视角'}}); try {
    assert.equal(f.button('保存当前视角').disabled, true); assert.equal(f.button('更新视图“全景”为当前视角').disabled, true);
    f.button('保存当前视角').onclick(); f.button('更新视图“全景”为当前视角').onclick(); assert.equal(f.calls.length, 0);
    assert.equal(f.button('恢复视图“全景”').disabled, false); assert.equal(f.button('重命名视图“全景”').disabled, false);
    assert.match(f.panel.textContent, /仅支持独立状态/); f.update({canSave: true}); f.button('保存当前视角').click(); await tick();
    f.button('更新视图“肖像”为当前视角').click(); await tick(); assert.deepEqual(f.calls.map(call => call.action), ['save', 'update']); assert.equal(f.state.items[1].camera.focalLength, 50);
  } finally {f.finish();}
});
test('rename retains genuine draft and IME state through refresh, trims Enter and commits blur once', async () => {
  const request = deferred(), f = await fixture({rename: () => request.promise}); try {
    f.button('重命名视图“全景”').click(); const input = f.draft('  新的全景  '); assert.equal(f.dom.window.document.activeElement, input);
    input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart')); f.key(input, 'Enter', {isComposing: true}); f.blur(input); f.key(input, 'Escape', {keyCode: 229}); assert.equal(f.calls.length, 0);
    f.panel.refresh(); assert.equal(f.panel.querySelector('input'), input); assert.equal(input.value, '  新的全景  ');
    input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend')); f.key(input, 'Enter'); f.blur(input); f.key(input, 'Enter');
    assert.equal(input.readOnly, true); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].args, ['a', '新的全景']);
    f.update({activeViewId: 'b', items: f.state.items.map(item => item.id === 'a' ? {...item, label: '新的全景'} : item)}); request.resolve({ok: true}); await tick();
    assert.equal(f.panel.querySelector('input'), null); assert.equal(f.dom.window.document.activeElement, f.button('重命名视图“新的全景”'));
  } finally {f.finish();}
  const blur = await fixture(); try {blur.button('重命名视图“全景”').click(); const input = blur.draft('由失焦保存'); blur.blur(input); await tick(); assert.deepEqual(blur.calls[0].args, ['a', '由失焦保存']);} finally {blur.finish();}
});
test('late rejected rename keeps the original draft and focuses it for retry without claiming success', async () => {
  const request = deferred(), f = await fixture({rename: () => request.promise}); try {
    f.button('重命名视图“全景”').click(); const input = f.draft('失败后仍保留'); f.key(input, 'Enter'); request.resolve({ok: false, message: '磁盘写入失败'}); await tick();
    assert.equal(input.value, '失败后仍保留'); assert.equal(input.readOnly, false); assert.equal(f.dom.window.document.activeElement, input);
    assert.equal(f.row('a').querySelector('.sv3-saved-view-title').textContent, '全景'); assert.equal(f.panel.querySelector('[role=alert]').textContent, '磁盘写入失败'); assert.equal(f.errors.length, 1);
    f.key(input, 'Escape'); f.blur(input); await tick(); assert.equal(f.panel.querySelector('input'), null); assert.equal(f.calls.length, 1);
  } finally {f.finish();}
});
test('real blur releases a missing compositionend latch after final input, without weakening active IME guards', async () => {
  const f = await fixture(); try {
    f.button('重命名视图“全景”').click(); const input = f.draft("gai'zao");
    input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
    input.value = '房间 A · 全景'; input.dispatchEvent(new f.dom.window.InputEvent('input', {bubbles: true, isComposing: false}));
    f.key(input, 'Enter'); f.key(input, 'Enter', {isComposing: true}); f.key(input, 'Enter', {keyCode: 229}); f.blur(input); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.panel.querySelector('input'), input);
    f.root.querySelector('#trigger').focus();
    assert.equal(f.calls.length, 0); input.value = '房间 A · 最终全景'; input.dispatchEvent(new f.dom.window.InputEvent('input', {bubbles: true, isComposing: false}));
    await tick(); assert.deepEqual(f.calls, [{action: 'rename', args: ['a', '房间 A · 最终全景']}]);
    assert.equal(f.panel.querySelector('input'), null); assert.equal(f.dom.window.document.activeElement, f.button('重命名视图“房间 A · 最终全景”'));
  } finally {f.finish();}
});
test('blur recovery preserves a failed IME draft for ordinary Enter retry', async () => {
  let attempts = 0;
  const f = await fixture({rename: () => ++attempts === 1 ? {ok: false, message: '暂时无法保存'} : true}); try {
    f.button('重命名视图“全景”').click(); const input = f.draft('输入法中文草稿'); input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
    f.root.querySelector('#trigger').focus(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.dom.window.document.activeElement, input); assert.equal(input.value, '输入法中文草稿');
    f.key(input, 'Enter'); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.panel.querySelector('input'), null);
  } finally {f.finish();}
});
test('save restore and update restore their native button focus after asynchronous success or failure', async () => {
  for (const [action, label] of [['save', '保存当前视角'], ['restore', '恢复视图“肖像”'], ['update', '更新视图“肖像”为当前视角']]) for (const ok of [true, false]) {
    const request = deferred(), f = await fixture({[action]: () => request.promise}); try {
      const button = f.button(label); button.focus(); button.click(); assert.equal(button.disabled, true); f.panel.focus();
      assert.equal(f.dom.window.document.activeElement, f.panel); request.resolve({ok, message: '宿主拒绝'}); await tick();
      assert.equal(button.disabled, false); assert.equal(f.dom.window.document.activeElement, button); assert.equal(f.calls.length, 1);
    } finally {f.finish();}
  }
});
test('blank rename is rejected locally and accepted callback still renders only actual host name', async () => {
  const f = await fixture({rename: () => true}); try {
    f.button('重命名视图“全景”').click(); const input = f.draft('  '); f.key(input, 'Enter'); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.panel.querySelector('input'), input); assert.equal(f.panel.querySelector('[role=alert]').textContent, '视图名称不能为空');
    f.draft('宿主未应用的名称'); f.key(input, 'Enter'); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.row('a').querySelector('.sv3-saved-view-title').textContent, '全景'); assert.equal(f.panel.querySelector('input'), null);
  } finally {f.finish();}
});
test('nested confirmation Escape returns to rename then parent menu consumes ordinary Escape', async () => {
  const f = await fixture(), menus = (await menusPromise).createMenus({root: f.root, onError: error => f.errors.push(error)}); try {
    const trigger = f.root.querySelector('#trigger'); trigger.focus(); menus.toggle(trigger, () => f.panel, {role: 'presentation', width: 320});
    f.button('重命名视图“全景”').click(); const input = f.draft('未提交名字'); f.button('删除视图“全景”').click();
    const dialog = f.panel.querySelector('[role=alertdialog]'); assert.equal(dialog.hidden, false); assert.match(dialog.textContent, /不删除机位、照片/);
    assert.equal(f.dom.window.document.activeElement, f.button('取消删除视图'));
    f.key(f.button('取消删除视图'), 'Escape'); assert.equal(dialog.hidden, true); assert.equal(f.dom.window.document.activeElement, input); assert.equal(menus.isOpen(), true);
    f.key(input, 'Escape'); assert.equal(f.panel.querySelector('input'), null); assert.equal(menus.isOpen(), true);
    f.key(f.button('重命名视图“全景”'), 'Escape'); assert.equal(menus.isOpen(), false); assert.equal(f.dom.window.document.activeElement, trigger); assert.equal(f.calls.length, 0);
  } finally {menus.dispose(); f.finish();}
});
test('confirmation only removes fixed view ID, refuses repeated pending actions and returns usable focus', async () => {
  const request = deferred(), f = await fixture({remove: () => request.promise}); try {
    f.button('删除视图“全景”').click(); f.button('确认删除视图').click(); f.button('确认删除视图').onclick();
    f.update({activeViewId: 'b'}); f.button('恢复视图“肖像”').onclick(); assert.deepEqual(f.calls, [{action: 'remove', args: ['a']}]);
    f.update({items: f.state.items.filter(item => item.id !== 'a')}); request.resolve(true); await tick();
    assert.equal(f.row('a'), null); assert.equal(f.row('b') !== null, true); assert.equal(f.panel.querySelector('[role=alertdialog]').hidden, true); assert.equal(f.errors.length, 0);
  } finally {f.finish();}
});
test('false, undefined and thrown host failures are visible and no accepted local values are invented', async () => {
  for (const result of [false, undefined, Error('真实恢复失败')]) {
    const f = await fixture({restore: () => {if (result instanceof Error) throw result; return result;}}); try {
      f.button('恢复视图“肖像”').click(); await tick(); assert.equal(f.state.activeViewId, 'a'); assert.equal(f.errors.length, 1); assert.equal(f.panel.querySelector('[role=alert]').hidden, false); assert.equal(f.button('恢复视图“肖像”').disabled, false);
    } finally {f.finish();}
  }
});
test('applied failure shows real item and persistence receipt retries flush without creating twice', async () => {
  const retry = deferred(); let f;
  f = await fixture({save: () => {
    f.state.items.push({id: 'new', label: '新视图', stageId: 'stage-a', setupId: 'setup-a', camera: {focalLength: 50, frameAspectRatio: 1}, tags: ['capture']});
    f.state.pendingSave = {viewId: 'new', action: 'create', message: '已应用，磁盘保存失败'};
    return {ok: false, applied: true, viewId: 'new', message: '磁盘保存失败'};
  }, retry: () => retry.promise}); try {
    f.button('保存当前视角').click(); await tick(); assert.equal(f.row('new') !== null, true); assert.equal(f.panel.querySelector('[role=alert]').textContent, '磁盘保存失败');
    f.update({canSave: false}); assert.equal(f.button('重试保存视图').disabled, false); assert.equal(f.button('重命名视图“全景”').disabled, true); f.button('重命名视图“全景”').onclick(); assert.equal(f.panel.querySelector('input'), null);
    f.button('重试保存视图').click(); f.button('重试保存视图').onclick(); assert.deepEqual(f.calls.map(call => call.action), ['save', 'retry']);
    f.update({pendingSave: null}); retry.resolve({ok: true}); await tick(); assert.equal(f.button('保存当前视角').disabled, true); assert.equal(f.button('恢复视图“全景”').disabled, false);
  } finally {f.finish();}
});
test('busy and removed stale row callbacks refuse actions, and long Chinese label preserves actual accessible name', async () => {
  const long = '长中文视图名称'.repeat(40), f = await fixture(); try {
    f.update({items: [{...f.state.items[0], label: long}], busy: true}); const restore = f.button(`恢复视图“${long}”`);
    restore.onclick(); f.button('保存当前视角').onclick(); assert.equal(f.calls.length, 0); assert.equal(restore.type, 'button'); assert.equal(f.row('a').querySelector('.sv3-saved-view-title').title, long);
    f.update({busy: false, items: []}); restore.onclick(); assert.equal(f.calls.length, 0); assert.equal(f.panel.querySelector('.sv3-saved-view-empty').textContent, '暂无保存的视图');
  } finally {f.finish();}
});
test('removal applied before persistence failure still reports its receipt and does not delete again', async () => {
  let f;
  f = await fixture({remove: id => {
    f.state.items = f.state.items.filter(item => item.id !== id); f.state.pendingSave = {viewId: id, action: 'remove', message: '删除已应用，保存失败'};
    return {ok: false, applied: true, viewId: id, message: '删除已应用，保存失败'};
  }}); try {
    f.button('删除视图“全景”').click(); f.button('确认删除视图').click(); await tick();
    assert.equal(f.row('a'), null); assert.equal(f.panel.querySelector('[role=alert]').textContent, '删除已应用，保存失败'); assert.equal(f.errors.length, 1);
    f.button('重试保存视图').click(); await tick(); assert.deepEqual(f.calls.map(call => call.action), ['remove', 'retry']); assert.equal(f.state.items.length, 1);
  } finally {f.finish();}
});
test('dispose fences late success and rejection, blocks detached callbacks and leaves host receipt untouched', async () => {
  for (const reject of [false, true]) {
    const request = deferred(), receipt = {viewId: 'a', action: 'rename'}, f = await fixture({restore: () => request.promise}); try {
      const action = f.button('恢复视图“全景”'); action.click(); f.state.pendingSave = receipt; const before = f.panel.textContent; f.panel.dispose();
      if (reject) request.reject(Error('迟到错误')); else request.resolve(true); await tick(); f.panel.refresh(); assert.equal(f.panel.textContent, before); assert.deepEqual(f.errors, []); assert.equal(f.state.pendingSave, receipt);
      assert.equal(f.panel.inert, true); assert.equal(action.onclick, null); assert.equal(f.panel.handleEscape(), false);
    } finally {f.finish();}
  }
});
