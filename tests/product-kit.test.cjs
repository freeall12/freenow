const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const filename = 'src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html', html = fs.readFileSync(filename, 'utf8');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=';
function fixture(locale = 'zh-CN') {
  const start = html.indexOf('U_={version:1,locale:'), end = html.indexOf(',wm=document', start);
  const source = vm.runInNewContext('(' + html.slice(start + 3, end) + ')');
  return {...structuredClone(source), locale, product: {...source.product, thumbnail_url: png}};
}
function official() {
  const source = html.slice(html.indexOf('function km('), html.indexOf('function j_('));
  return vm.runInNewContext(source + ';({km,S_,I_,z_})', {encodeURIComponent, JSON, Set});
}
test('official source hash and actual proxy correction prove the local transport compatibility difference', async () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), '758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535');
  const original = 'thumbnail_url:f().url().refine(e=>e.startsWith("https://"))';
  assert.equal(html.split(original).length, 2);
  const f = () => {const checks = [];const parser = {url(){checks.push(value => {try {new URL(value);return true;} catch {return false;}});return parser;}, refine(fn){checks.push(fn);return parser;}, max(n){checks.push(value => value.length <= n);return parser;}, regex(rx){checks.push(value => rx.test(value));return parser;}, parse(value){return checks.every(fn => fn(value));}};return parser;};
  const proxy = fs.readFileSync('src/features/agent-apps/resources/mcp-app-proxy.html', 'utf8');
  const transport = proxy.slice(proxy.indexOf('// PRODUCT_KIT_LOCAL_TRANSPORT:BEGIN'), proxy.indexOf('// PRODUCT_KIT_LOCAL_TRANSPORT:END'));
  const localize = vm.runInNewContext(transport + ';localizeProductKitTransport', {crypto: crypto.webcrypto, TextEncoder, Uint8Array});
  const derivative = await localize(html, 'product-kit', 'v1');assert.notEqual(derivative, html);
  assert.equal(await localize(html, 'different-app', 'v9'), html);
  await assert.rejects(localize(html, 'product-kit', 'v2'), /version/);
  await assert.rejects(localize(html + ' ', 'product-kit', 'v1'), /integrity/);
  await assert.rejects(localize(html.replace(original, original + original), 'product-kit', 'v1'), /integrity/);
  assert.equal(derivative.split('thumbnail_url:f().max(500000)').length, 2);
  const expression = derivative.slice(derivative.indexOf('thumbnail_url:f().max(500000)') + 'thumbnail_url:'.length, derivative.indexOf('}),kit_version:', derivative.indexOf('thumbnail_url:f().max(500000)')));
  const native = vm.runInNewContext('f().url().refine(e=>e.startsWith("https://"))', {f}), local = vm.runInNewContext(expression, {f});
  assert.equal(native.parse(png), false);assert.equal(native.parse('https://files.tapnow.ai/demo/product-kit.webp'), true);
  assert.equal(local.parse(png), true);assert.equal(local.parse('https://files.tapnow.ai/demo/product-kit.webp'), false);assert.equal(local.parse('data:image/svg+xml;base64,AAAA'), false);assert.equal(local.parse('data:image/png;base64,' + 'A'.repeat(500000)), false);
});
test('initial state, edited projection and exact PK1 match the official functions in five locales', async () => {
  const m = await import('../src/features/agent-apps/product-kit.mjs'), src = official();
  for (const locale of m.productKitLocales) {
    const data = m.prepareProductKit(fixture(locale)), state = m.initialProductKitState(data);
    assert.equal(JSON.stringify(state), JSON.stringify(src.km(data)));
    state.palette[0] = {role: 'scene', ...data.palette[0].alternatives[0]};state.tone_words = ['精密', '克制'];state.product_bans[0].on = false;state.voice = '情绪种草';state.confirmed_ids = ['h1'];state.view = 'recall';
    assert.equal(JSON.stringify(m.validateProductKitState(state, data)), JSON.stringify(src.S_(state, data)));
    assert.equal(JSON.stringify(m.productKitProjection(data, state)), JSON.stringify(src.I_(data, state)));
    assert.equal(m.productKitToken(data, state), src.z_(data, state));
    const message = m.productKitMessage(data, state);assert.equal(message, 'PRODUCT KIT v2: 4 colors, 2 tones, 1 confirmed specs.\n' + src.z_(data, state));
    const reply = await m.resolveProductKitReply(message, data, state);assert.equal(reply.kind, 'confirmed');assert.match(reply.metadata.handoffId, /^product_kit_[a-f0-9]{64}$/);assert.equal(reply.result.confirmed_hypotheses[0].id, 'h1');assert.deepEqual(reply.result.blocked_hypotheses, []);assert.equal(reply.text.includes(png), false);
    assert.equal((await m.resolveProductKitReply(message, data, structuredClone(state))).metadata.handoffId, reply.metadata.handoffId);
  }
});
test('source palette/language locks, selection limits, unsupported fields and dates reject forged edits', async () => {
  const m = await import('../src/features/agent-apps/product-kit.mjs'), data = m.prepareProductKit(fixture()), state = m.initialProductKitState(data);
  for (const change of [s => s.kit_version++, s => s.palette[1].hex = '#FFFFFF', s => s.palette.reverse(), s => s.tone_words = ['克制', '克制'], s => s.tone_words = ['fake'], s => s.look_state = 'locked', s => s.product_bans[0].name = 'fake', s => s.voice = 'fake', s => s.confirmed_ids = ['unknown'], s => s.confirmed_ids = ['h1', 'h1'], s => s.copy = {language: 'French'}]) {const value = structuredClone(state);change(value);assert.throws(() => m.validateProductKitState(value, data));}
  for (const change of [d => d.product.thumbnail_url = 'https://files.tapnow.ai/demo/product-kit.webp', d => d.updated_at = '2026-02-30', d => d.updated_at = '0000-01-01', d => d.palette[1].alternatives = [{name: '假设', hex: '#FFFFFF'}], d => d.palette[0].source = 'fake', d => d.palette[0].name = '两个  空格', d => d.copy.language.locked = false, d => d.copy.voice.options = ['same', 'same'], d => d.hypotheses[0].auto_ban = false, d => d.palette[0].hex = '#d8d1c7']) {const value = fixture();change(value);assert.throws(() => m.prepareProductKit(value));}
  state.tone_words = [];assert.equal(m.validateProductKitState(state, data).tone_words.length, 0);
  const locked = fixture();locked.look = {...locked.look, state: 'locked', locked_at: '2026-08-18'};const unlocked = m.initialProductKitState(locked);unlocked.look_state = 'unlocked';assert.equal(m.productKitProjection(locked, unlocked).look.state, 'unlocked');
});
test('exact saved-state confirmation rejects alternate encodings, forged specs and missing state', async () => {
  const m = await import('../src/features/agent-apps/product-kit.mjs'), data = m.prepareProductKit(fixture()), state = m.initialProductKitState(data), message = m.productKitMessage(data, state);
  const reply = await m.resolveProductKitReply(message, data, state);assert.equal(reply.result.blocked_hypotheses.length, 1);assert.equal(reply.result.confirmed_hypotheses.length, 0);
  for (const altered of [message + '\n', message.replace('confirmed=-', 'confirmed=h1'), message.replace('4 colors', '5 colors'), message.replace('%7B', '%7b'), message.replace('action=apply', 'action=generate')]) await assert.rejects(m.resolveProductKitReply(altered, data, state));
  await assert.rejects(m.resolveProductKitReply(message, data, undefined));
  const different = fixture();different.product.name = '另一真实产品';assert.notEqual((await m.resolveProductKitReply(message, different, state)).metadata.handoffId, reply.metadata.handoffId);
});
