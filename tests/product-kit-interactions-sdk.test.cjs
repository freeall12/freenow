const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric')), domRequire = createRequire(fabricRequire.resolve('jsdom')), canvasPath = domRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
let JSDOM;try {({JSDOM} = fabricRequire('jsdom'));} finally {if (previousCanvas) require.cache[canvasPath] = previousCanvas;else delete require.cache[canvasPath];}
const original = fs.readFileSync('src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html', 'utf8');
const demo = fs.readFileSync('src/features/agent-apps/resources/apps/product-kit@v1.bf378d28.html', 'utf8');
const tick = () => new Promise(setImmediate), settle = async () => {for (let i = 0; i < 8; i++) await tick();};
const deferred = () => {let resolve;const promise = new Promise(yes => {resolve = yes;});return {promise, resolve};};
function fixture(patch = {}) {
  const start = demo.indexOf('U_={version:1,locale:'), end = demo.indexOf(',wm=document', start);
  return {...structuredClone(vm.runInNewContext('(' + demo.slice(start + 3, end) + ')')), ...patch};
}
async function harness({data = fixture(), state, saveGate, saveError, localized = true, onSaveReceipt} = {}) {
  const {localizeProductKitInteractions} = await import('../src/features/agent-apps/product-kit-local-interactions.mjs');
  const html = localized ? await localizeProductKitInteractions(demo, 'product-kit', 'v1') : demo;
  const dom = new JSDOM('<body><div id="root"></div></body>', {url: 'http://localhost:4173/', runScripts: 'outside-only', pretendToBeVisual: true}), window = dom.window, messages = [], errors = [];let initialized = false, error = saveError, gate = saveGate;
  window.ResizeObserver = class {observe() {}disconnect() {}};window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  window.console = {debug() {}, log() {}, warn(...args) {errors.push(args.join(' '));}, error(...args) {errors.push(args.join(' '));}};window.addEventListener('error', event => errors.push(event.message));
  const parent = {postMessage(data) {
    messages.push(data);
    if (data.method === 'ui/initialize') setImmediate(() => emit({id: data.id, result: {protocolVersion: '2026-01-26', hostInfo: {name: 'fixture', version: '1'}, hostCapabilities: {message: {text: {}}}, hostContext: {theme: 'dark', locale: 'zh-CN'}}}));
    if (data.method === 'ui/notifications/initialized') initialized = true;
    if (data.method === 'tapnow/setWidgetState') void Promise.resolve(gate).then(() => {emit({id: data.id, ...error ? {error: {code: -32000, message: error}} : {result: {}}});onSaveReceipt?.(data);});
    if (data.method === 'ui/message') setImmediate(() => emit({id: data.id, result: {}}));
  }};
  Object.defineProperty(window, 'parent', {value: parent});
  function emit(data) {window.dispatchEvent(new window.MessageEvent('message', {source: parent, data: {jsonrpc: '2.0', ...data}}));}
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.url', '"http://localhost:4173/product-kit-fixture.html"');
  vm.runInContext(script, dom.getInternalVMContext());for (let i = 0; i < 60 && !initialized; i++) await tick();assert.equal(initialized, true);
  function restore(next = state) {emit({method: 'ui/notifications/tool-result', params: {content: [], structuredContent: data, ...(next ? {_meta: {'tapnow/widgetState': next}} : {})}});}
  restore();await tick();
  const query = selector => window.document.querySelector(selector);
  return {window, messages, errors, emit, restore, close: () => window.close(), query, click: selector => {const button = query(selector);assert.ok(button, selector);button.click();},
    setError: value => {error = value;}, setGate: value => {gate = value;}, saves: () => messages.filter(row => row.method === 'tapnow/setWidgetState'), sends: () => messages.filter(row => row.method === 'ui/message'), replies: id => messages.filter(row => row.id === id)};
}

test('the official SDK reproduces the 220ms immediate-confirmation save gap', async () => {
  const h = await harness({localized: false});try {
    h.click('.ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');h.click('.footer .primary');await settle();
    assert.equal(h.sends().length, 1);assert.equal(h.saves().length, 0);assert.match(h.sends()[0].params.content[0].text, /%E7%A0%82%E5%B2%A9/);
  } finally {h.close();}
});
test('interaction derivation pins exact transport/demo SHA and leaves captured bytes unchanged', async () => {
  const m = await import('../src/features/agent-apps/product-kit-local-interactions.mjs');
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), m.productKitReferenceSha256);
  assert.equal(crypto.createHash('sha256').update(demo).digest('hex'), m.productKitDemoSha256);
  const {originalTransport, localTransport} = require('../scripts/derive-product-kit-demo.cjs');
  const transported = original.replace(originalTransport, localTransport);
  assert.equal(crypto.createHash('sha256').update(transported).digest('hex'), m.productKitTransportSha256);
  for (const html of [transported, demo]) {
    const local = await m.localizeProductKitInteractions(html, 'product-kit', 'v1');assert.match(local, /freenow\/lifecycleFlush/);assert.match(local, /async function Tm/);
    await assert.rejects(m.localizeProductKitInteractions(html + ' ', 'product-kit', 'v1'), /integrity/);
  }
  await assert.rejects(m.localizeProductKitInteractions(original, 'product-kit', 'v1'), /integrity/);
  await assert.rejects(m.localizeProductKitInteractions(demo, 'product-kit', 'v2'), /version/);
  assert.equal(await m.localizeProductKitInteractions(original, 'other', 'v1'), original);
});
test('all official locales, full/recall and plan modes keep actual labels, thumbnail and PK1 messages', async () => {
  const m = await import('../src/features/agent-apps/product-kit.mjs');
  for (const locale of m.productKitLocales) for (const variant of ['full', 'recall']) for (const plan_attached of [false, true]) {
    const data = fixture({locale, variant, plan_attached}), h = await harness({data});try {
      assert.equal(h.window.document.documentElement.lang, locale);assert.equal(h.query('img').src, data.product.thumbnail_url);
      assert.equal(h.query('.recall') !== null, variant === 'recall');assert.equal(h.query('.palette-board') !== null, variant === 'full');
      h.click(variant === 'recall' ? '.recall .primary' : '.footer .primary');await settle();assert.equal(h.saves().length, 1);assert.equal(h.sends().length, 1);
      const state = JSON.parse(JSON.stringify(h.saves()[0].params.state));assert.equal(h.sends()[0].params.content[0].text, m.productKitMessage(data, state));assert.deepEqual(h.errors, []);
    } finally {h.close();}
  }
});
test('actual editor cancel/save, locked palette, tone limit, bans, voice, six roles and hypotheses restore through SDK', async () => {
  const data = fixture();data.palette.push({role: 'brand', name: '品牌绿', hex: '#125544', locked: false, alternatives: [{name: '墨绿', hex: '#113322'}]}, {role: 'material', name: '木色', hex: '#A58866', locked: false, alternatives: [{name: '浅木', hex: '#CCAA88'}]});
  data.tones.options.push({word: '温暖', physical: '暖光与自然材质'});data.hypotheses.push({id: 'h2', text: '本地测试规格，需用户确认', auto_ban: true});
  const h = await harness({data});try {
    h.click('.header .ghost');assert.equal(h.window.document.querySelectorAll('.edit-palette').length, 6);assert.equal(h.query('.edit-palette.locked .color-choice').disabled, true);
    h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .secondary');await settle();assert.equal(h.query('.color-name').textContent, '暖灰');assert.equal(h.saves().length, 0);
    h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-section .option:nth-child(2)');h.click('.edit-section .option:nth-child(3)');assert.match(h.query('.translation').textContent, /精密/);assert.doesNotMatch(h.query('.translation').textContent, /温暖/);
    h.click('.ban-option');h.click('.split .option:last-child');h.click('.edit-actions .primary');await settle();assert.equal(h.saves().length, 1);
    h.click('.hypothesis-toggle');h.click('.hypothesis-row .amber-button');h.click('.hypothesis-row .amber-button');await settle();assert.equal(h.query('.hypothesis-toggle'), null);
    const state = JSON.parse(JSON.stringify(h.saves().at(-1).params.state));assert.equal(state.palette[0].name, '砂岩');assert.equal(state.palette[1].name, '炭黑');assert.deepEqual(state.tone_words, ['克制', '精密']);assert.equal(state.product_bans[0].on, false);assert.equal(state.voice, '情绪种草');assert.deepEqual(state.confirmed_ids, ['h1', 'h2']);
    h.restore(state);await tick();assert.equal(h.query('.color-name').textContent, '砂岩');assert.match(h.query('.copy-line').textContent, /情绪种草/);assert.equal(h.query('.hypothesis-toggle'), null);assert.deepEqual(h.errors, []);
  } finally {h.close();}
});
test('immediate save and confirmation wait for the actual transaction before sending exact PK1', async () => {
  const gate = deferred(), h = await harness({saveGate: gate.promise});try {
    h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');h.click('.footer .primary');await settle();
    assert.equal(h.saves().length, 1);assert.equal(h.sends().length, 0);assert.equal(h.window.document.getElementById('root').inert, true);
    gate.resolve();await settle();assert.equal(h.saves().length, 1);assert.equal(h.sends().length, 1);assert.equal(h.saves()[0].params.state.palette[0].name, '砂岩');assert.equal(h.window.document.getElementById('root').inert, false);assert.deepEqual(h.errors, []);
  } finally {gate.resolve();h.close();}
});
test('close flush waits, save failure stays visible, retry preserves edits and Cancel remains uncommitted', async () => {
  const gate = deferred(), h = await harness({saveGate: gate.promise});try {
    h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');h.emit({id: 'local-close-product-kit', method: 'freenow/lifecycleFlush', params: {}});await settle();
    assert.equal(h.replies('local-close-product-kit').length, 0);assert.equal(h.window.document.getElementById('root').inert, true);assert.equal(h.saves().length, 1);
    gate.resolve();await settle();assert.equal(h.replies('local-close-product-kit').length, 1);assert.equal(h.replies('local-close-product-kit')[0].result.flushed, true);assert.equal(h.sends().length, 0);
    h.emit({method: 'freenow/lifecycleResume', params: {id: 'local-close-product-kit'}});assert.equal(h.window.document.getElementById('root').inert, false);
    h.setError('transaction failed');h.click('.header .ghost');h.click('.edit-palette .color-choice:first-child');h.click('.edit-actions .primary');h.click('.footer .primary');await settle();assert.equal(h.sends().length, 0);assert.match(h.query('.status').textContent, /保存或交接失败/);assert.equal(h.query('.color-name').textContent, '暖灰');
    h.emit({id: 'local-close-product-kit-failed', method: 'freenow/lifecycleFlush', params: {}});await settle();assert.equal(h.replies('local-close-product-kit-failed')[0].error.code, -32000);assert.equal(h.window.document.getElementById('root').inert, false);
    h.setError(null);h.click('.footer .primary');await settle();assert.equal(h.sends().length, 1);assert.equal(h.saves().at(-1).params.state.palette[0].name, '暖灰');
    h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .secondary');h.emit({id: 'local-close-product-kit-cancel', method: 'freenow/lifecycleFlush', params: {}});await settle();assert.equal(h.replies('local-close-product-kit-cancel')[0].result.flushed, true);assert.equal(h.saves().at(-1).params.state.palette[0].name, '暖灰');assert.deepEqual(h.errors, []);
  } finally {gate.resolve();h.close();}
});
test('blur commits pending changes; recall failures and lost user activation retain a retry action', async () => {
  const h = await harness({data: fixture({variant: 'recall'}), saveError: 'recall disk failed'});try {
    h.click('.recall .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');h.window.dispatchEvent(new h.window.Event('blur'));await settle();assert.match(h.query('.status').textContent, /保存或交接失败/);
    h.setError(null);Object.defineProperty(h.window.navigator, 'userActivation', {value: {isActive: false}, configurable: true});h.click('.footer .primary');await settle();assert.equal(h.sends().length, 0);assert.match(h.query('.status').textContent, /再次点击/);
    h.window.navigator.userActivation.isActive = true;h.click('.footer .primary');await settle();assert.equal(h.sends().length, 1);assert.deepEqual(h.errors, []);
  } finally {h.close();}
  const recall = await harness({data: fixture({variant: 'recall'}), saveError: 'recall disk failed'});try {recall.click('.recall .primary');await settle();assert.equal(recall.sends().length, 0);assert.match(recall.query('.product-kit-local-status').textContent, /保存或交接失败/);} finally {recall.close();}
});
test('changed source and page disposal during a pending transaction never send the stale Kit', async () => {
  for (const closePage of [false, true]) {
    const gate = deferred(), h = await harness({saveGate: gate.promise});try {
      h.click('.footer .primary');await settle();assert.equal(h.saves().length, 1);
      if (closePage) h.window.dispatchEvent(new h.window.Event('pagehide'));else h.restore();
      gate.resolve();await settle();assert.equal(h.sends().length, 0);assert.deepEqual(h.errors, []);
    } finally {gate.resolve();h.close();}
  }
});
test('locked Look remains official and a recall edit saves full view without silently committing a draft on close', async () => {
  const data = fixture({variant: 'recall'});data.look = {...data.look, state: 'locked', locked_at: '2026-08-18'};
  const h = await harness({data});try {
    assert.match(h.query('.recall-identity').textContent, /已锁定/);h.click('.recall .ghost');h.click('.edit-palette .color-choice:last-child');
    h.emit({id: 'local-close-product-kit-draft', method: 'freenow/lifecycleFlush', params: {}});await settle();const saved = h.saves().at(-1).params.state;
    assert.equal(saved.view, 'recall');assert.equal(saved.palette[0].name, '暖灰');assert.equal(saved.look_state, 'locked');assert.equal(h.replies('local-close-product-kit-draft')[0].result.flushed, true);
    h.emit({method: 'freenow/lifecycleResume', params: {id: 'local-close-product-kit-draft'}});h.click('.edit-actions .primary');await settle();assert.equal(h.saves().at(-1).params.state.view, 'full');assert.equal(h.saves().at(-1).params.state.palette[0].name, '砂岩');assert.match(h.query('.look-summary .section-label').textContent, /已锁定/);assert.deepEqual(h.errors, []);
  } finally {h.close();}
});
test('slow repeated edits keep only one pending latest snapshot and confirmation freezes that snapshot', async () => {
  const gate = deferred(), h = await harness({saveGate: gate.promise});try {
    h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');await settle();assert.equal(h.saves().length, 1);
    for (let i = 0; i < 30; i++) {h.click('.header .ghost');h.click(i % 2 ? '.edit-palette .color-choice:last-child' : '.edit-palette .color-choice:first-child');h.click('.edit-actions .primary');}
    h.click('.footer .primary');await settle();assert.equal(h.saves().length, 1);assert.equal(h.sends().length, 0);assert.equal(h.window.document.getElementById('root').inert, true);
    gate.resolve();await settle();assert.equal(h.saves().length, 1, 'final snapshot matches the in-flight snapshot, so intermediate edits never become transactions');assert.equal(h.sends().length, 1);assert.equal(h.saves().at(-1).params.state.palette[0].name, '砂岩');assert.deepEqual(h.errors, []);
  } finally {gate.resolve();h.close();}
  const latestGate = deferred(), latest = await harness({saveGate: latestGate.promise});try {
    latest.click('.header .ghost');latest.click('.edit-palette .color-choice:last-child');latest.click('.edit-actions .primary');await settle();
    for (let i = 0; i < 31; i++) {latest.click('.header .ghost');latest.click(i % 2 ? '.edit-palette .color-choice:last-child' : '.edit-palette .color-choice:first-child');latest.click('.edit-actions .primary');}
    latest.emit({id: 'local-close-product-kit-coalesced', method: 'freenow/lifecycleFlush', params: {}});await settle();latestGate.resolve();await settle();assert.equal(latest.saves().length, 2);assert.equal(latest.saves().at(-1).params.state.palette[0].name, '暖灰');assert.equal(latest.replies('local-close-product-kit-coalesced')[0].result.flushed, true);assert.deepEqual(latest.errors, []);
  } finally {latestGate.resolve();latest.close();}
});
test('latest edits during SDK receipt/completion microtasks drain before reporting close success', async () => {
  for (let depth = 0; depth <= 10; depth++) {
    let h, injected = false, closing;const gate = deferred();
    h = await harness({saveGate: gate.promise, onSaveReceipt: () => {
      if (injected) return;injected = true;
      const inject = remaining => remaining ? queueMicrotask(() => inject(remaining - 1)) : (() => {
        h.click('.header .ghost');h.click('.edit-palette .color-choice:first-child');h.click('.edit-actions .primary');
        h.emit({id: 'local-close-product-kit-completion', method: 'freenow/lifecycleFlush', params: {}});closing = true;
      })();inject(depth);
    }});try {
      h.click('.header .ghost');h.click('.edit-palette .color-choice:last-child');h.click('.edit-actions .primary');await settle();gate.resolve();await settle();
      assert.equal(closing, true);assert.equal(h.saves().length, 2, 'microtask boundary ' + depth);assert.equal(h.saves().at(-1).params.state.palette[0].name, '暖灰');assert.equal(h.replies('local-close-product-kit-completion')[0].result.flushed, true);assert.equal(h.sends().length, 0);assert.deepEqual(h.errors, []);
    } finally {gate.resolve();h.close();}
  }
});
test('focused editor controls survive actual redraws and save/cancel focus the next view action', async () => {
  const h = await harness();try {
    h.query('.header .ghost').focus();h.click('.header .ghost');assert.equal(h.window.document.activeElement, h.query('.editor button:not(:disabled)'));
    for (const selector of ['.edit-palette .color-choice:last-child', '.edit-section .option:nth-child(2)', '.ban-option', '.split .option:last-child']) {
      const control = h.query(selector);control.focus();const index = [...h.window.document.querySelectorAll('.editor button')].indexOf(control);control.click();
      const next = h.window.document.querySelectorAll('.editor button')[index];assert.notEqual(next, control, 'the official editor redrew its DOM');assert.equal(h.window.document.activeElement, next, selector + ' retains focused control after redraw');
    }
    assert.equal(h.query('.edit-palette .color-choice:last-child').getAttribute('aria-pressed'), 'true');
    h.query('.edit-actions .primary').focus();h.click('.edit-actions .primary');assert.equal(h.window.document.activeElement, h.query('.header .ghost'));
    h.click('.header .ghost');h.query('.edit-actions .secondary').focus();h.click('.edit-actions .secondary');assert.equal(h.window.document.activeElement, h.query('.header .ghost'));await settle();assert.deepEqual(h.errors, []);
  } finally {h.close();}
  const recall = await harness({data: fixture({variant: 'recall'})});try {
    recall.query('.recall .ghost').focus();recall.click('.recall .ghost');assert.equal(recall.window.document.activeElement, recall.query('.editor button:not(:disabled)'));
    recall.query('.edit-actions .secondary').focus();recall.click('.edit-actions .secondary');assert.equal(recall.window.document.activeElement, recall.query('.recall .primary'));assert.deepEqual(recall.errors, []);
  } finally {recall.close();}
});
test('localized errors omit internal SDK details in all five languages and preserve confirmation/close retry', async () => {
  const m = await import('../src/features/agent-apps/product-kit.mjs');
  for (const locale of m.productKitLocales) for (const variant of ['full', 'recall']) {
    const h = await harness({data: fixture({locale, variant}), saveError: 'MCP error -32000: host action failed'});try {
      const action = variant === 'recall' ? '.recall .primary' : '.footer .primary';h.click(action);await settle();assert.equal(h.sends().length, 0);
      const status = h.query('.status').textContent;assert.doesNotMatch(status, /MCP|32000|host action|source_sha256|node_ref/);assert.match(status, /Product Kit/);
      h.emit({id: 'local-close-product-kit-localized-error', method: 'freenow/lifecycleFlush', params: {}});await settle();assert.equal(h.replies('local-close-product-kit-localized-error')[0].error.code, -32000);assert.doesNotMatch(h.query('.status').textContent, /MCP|host action/);assert.equal(h.window.document.getElementById('root').inert, false);
      h.setError(null);h.click(action);await settle();assert.equal(h.sends().length, 1);assert.deepEqual(h.errors, []);
    } finally {h.close();}
  }
});
test('specification expand/collapse and inline confirmation preserve a next actionable focus', async () => {
  const data = fixture();data.hypotheses.push({id: 'h2', text: '第二条公开测试规格', auto_ban: true});const h = await harness({data});try {
    h.query('.hypothesis-toggle').focus();h.click('.hypothesis-toggle');assert.equal(h.window.document.activeElement, h.query('.hypothesis-toggle'));assert.equal(h.query('.hypothesis-toggle').getAttribute('aria-expanded'), 'true');
    h.click('.hypothesis-toggle');assert.equal(h.window.document.activeElement, h.query('.hypothesis-toggle'));assert.equal(h.query('.hypothesis-toggle').getAttribute('aria-expanded'), 'false');
    h.click('.hypothesis-toggle');h.query('.hypothesis-row .amber-button').focus();h.click('.hypothesis-row .amber-button');assert.equal(h.window.document.activeElement, h.query('.hypothesis-row .amber-button'));
    h.click('.hypothesis-row .amber-button');assert.equal(h.query('.hypothesis-toggle'), null);assert.equal(h.window.document.activeElement, h.query('.footer .primary'));await settle();assert.deepEqual(h.errors, []);
  } finally {h.close();}
});
