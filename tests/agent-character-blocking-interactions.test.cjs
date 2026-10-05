const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const original = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/character-blocking@v3.f1fd0e23.html'), 'utf8');
const modulePromise = import('../src/features/agent-apps/character-blocking-local-interactions.mjs');
const tick = () => new Promise(setImmediate), deferred = () => {let resolve, reject;const promise = new Promise((a, b) => {resolve = a;reject = b;});return {promise, resolve, reject};};
async function harness(request = async () => {}, send = async () => {}) {
  const html = await (await modulePromise).localizeCharacterBlockingInteractions(original, 'character-blocking', 'v3');
  const state = {positions: {lin: {x: 300, y: 350}, zhou: {x: 750, y: 700}}, facings: {lin: 90, zhou: 270}, selected_id: 'lin', snap: false, target: 'image', aspect_ratio: '16:9'};
  const rootHandlers = new Map(), windowHandlers = new Map(), saved = [], messages = [], focused = {isConnected: true, count: 0, focus() {this.count++;}};
  const context = {Promise, JSON, clearTimeout, state, navigator: {userActivation: {isActive: true}}, document: {activeElement: focused}, ae: {locale: 'zh-CN'}, Mt: false, je: null, se: {textContent: ''}, Wm: {inert: false, contains: () => true, addEventListener: (type, fn) => rootHandlers.set(type, fn)}, window: {addEventListener: (type, fn) => windowHandlers.set(type, fn)}, Q: () => ({}), Oe() {}, db: () => structuredClone(state), kb: () => '确认人物走位', Xm: () => ['lin', 'zhou'], Vt: {request: async args => {saved.push(args.params.state);await request(args.params.state);}, sendMessage: async args => {messages.push(args);await send();}}};
  vm.createContext(context);
  vm.runInContext('const Be=50,Bm=180,Km=/^[a-z0-9][a-z0-9_-]{0,23}$/;' + original.slice(original.indexOf('function fr(e)'), original.indexOf('const Gm=')), context);
  vm.runInContext(html.slice(html.indexOf('const blockingLocalCopy='), html.indexOf('function db(){')) + html.slice(html.indexOf('async function Sb()'), html.indexOf('function Ei()')) + html.slice(html.indexOf('for(const type of ['), html.indexOf(';(function(){let pending=')), context);
  return {context, html, state, saved, messages, rootHandlers, windowHandlers, run: code => vm.runInContext(code, context)};
}
test('only the complete pinned v3 source receives the repair and the full official bundle remains parseable', async () => {
  const {localizeCharacterBlockingInteractions, characterBlockingReferenceSha256} = await modulePromise;
  assert.equal(require('node:crypto').createHash('sha256').update(original).digest('hex'), characterBlockingReferenceSha256);
  await assert.rejects(localizeCharacterBlockingInteractions(original + ' ', 'character-blocking', 'v3'), /integrity mismatch/);
  await assert.rejects(localizeCharacterBlockingInteractions(original, 'character-blocking', 'v1'), /unsupported/);
  assert.equal(await localizeCharacterBlockingInteractions('other', 'story-room', 'v1'), 'other');
  const {html} = await harness();require('esbuild').transformSync(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], {loader: 'js', format: 'esm'});
});
test('confirmation locks before a delayed commit, sends its exact saved multi-actor snapshot once and restores focus', async () => {
  const gate = deferred(), h = await harness(() => gate.promise);
  h.state.positions.lin = {x: 411, y: 622};h.state.facings.zhou = 359;h.state.target = 'video';h.state.aspect_ratio = '9:16';
  const pending = h.run('Sb()');await h.run('Sb()');await tick();
  assert.equal(h.context.Mt, true);assert.equal(h.context.Wm.inert, true);assert.equal(h.saved.length, 1);assert.equal(h.messages.length, 0);
  gate.resolve();await pending;
  assert.match(h.messages[0].content[0].text, /CB3 v=3;target=video;ratio=9:16;actors=lin~411~622~90,zhou~750~700~359$/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved[0])), h.state);assert.equal(h.messages.length, 1);assert.equal(h.context.Mt, false);assert.equal(h.context.Wm.inert, false);assert.equal(h.context.document.activeElement.count, 1);
});
test('a failed commit is visible, never dispatches and can retry from the same page without caching failure', async () => {
  let fail = true;const h = await harness(() => {if (fail) throw Error('事务失败');});
  await h.run('Sb()');assert.equal(h.messages.length, 0);assert.match(h.context.se.textContent, /事务失败/);assert.equal(h.context.Wm.inert, false);
  fail = false;await h.run('Sb()');assert.equal(h.saved.length, 2);assert.equal(h.messages.length, 1);assert.match(h.context.se.textContent, /交给 Agent/);
});
test('expired activation after slow save asks for a new click; only successful same-state commits are reused', async () => {
  const gate = deferred(), h = await harness(() => gate.promise), pending = h.run('Sb()');await tick();
  h.context.navigator.userActivation.isActive = false;gate.resolve();await pending;
  assert.equal(h.messages.length, 0);assert.match(h.context.se.textContent, /已保存.*再次点击/);
  h.context.navigator.userActivation.isActive = true;await h.run('Sb()');assert.equal(h.saved.length, 1);assert.equal(h.messages.length, 1);
  h.state.positions.lin.x = 412;await h.run('Sb()');assert.equal(h.saved.length, 2);assert.equal(h.messages.length, 2);
});
test('changed source epoch or score during a slow commit cannot send a stale confirmation', async () => {
  for (const mutate of [h => {h.state.target = 'video';}, h => h.run('blockingEpoch++')]) {
    const gate = deferred(), h = await harness(() => gate.promise), pending = h.run('Sb()');await tick();mutate(h);gate.resolve();await pending;
    assert.equal(h.messages.length, 0);assert.match(h.context.se.textContent, /来源|状态/);assert.equal(h.context.Wm.inert, false);
  }
});
test('completed pointer and keyboard gestures flush the unchanged official coordinates immediately and co-deduplicate commits', async () => {
  const h = await harness();h.state.positions.zhou = {x: 650, y: 555};h.state.facings.zhou = 123;
  h.rootHandlers.get('pointercancel')();await tick();
  assert.equal(h.saved.length, 1);assert.equal(h.saved[0].positions.zhou.x, 650);assert.equal(h.saved[0].facings.zhou, 123);
  h.rootHandlers.get('pointerup')();h.rootHandlers.get('keyup')({key: 'ArrowRight'});h.rootHandlers.get('focusout')();await tick();assert.equal(h.saved.length, 1);
  h.state.selected_id = 'zhou';h.rootHandlers.get('click')();await tick();assert.equal(h.saved.length, 2);assert.equal(h.saved[1].selected_id, 'zhou');assert.equal(h.messages.length, 0);
});
test('disposing the iframe during a delayed confirmation never sends a late message', async () => {
  const gate = deferred(), h = await harness(() => gate.promise), pending = h.run('Sb()');await tick();h.windowHandlers.get('pagehide')();gate.resolve();await pending;
  assert.equal(h.messages.length, 0);assert.equal(h.context.Mt, false);assert.equal(h.context.document.activeElement.count, 0);
});
