const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/story-room@v1.dae7d235.html'), 'utf8');
const modulePromise = import('../src/features/agent-apps/story-room-local-interactions.mjs');
const deferred = () => {let resolve, reject;const promise = new Promise((a, b) => {resolve = a;reject = b;});return {promise, resolve, reject};};
async function fixture(request, sendMessage = async () => {}) {
  const {localizeStoryRoomInteractions} = await modulePromise, html = await localizeStoryRoomInteractions(source, 'story-room', 'v1');
  const status = {setAttribute() {}, style: {}, textContent: '', hidden: true};
  const active = {tagName: 'BUTTON', disabled: false, isConnected: true, focused: 0, focus() {this.focused++;}};
  const context = {Promise, JSON, navigator: {userActivation: {isActive: true}}, document: {activeElement: active, createElement: () => status}, j_: {querySelector: () => status, inert: false}, ge: {locale: 'zh-CN'}, w: {cols: [{act: 'A1', keys: ['S1']}], news: {}, nseq: 0, dels: [], filter: null, collapsed: {}, stripOpen: true}, An: 7, clearTimeout() {}, setTimeout() {}, Tt: {request, sendMessage}, Q: () => ({})};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('let localStorySaveWork='), html.indexOf('function cs()')) + ';globalThis.local={save:P_,send:Cs};', context);
  return {context, status, html};
}
test('only the pinned official Story Room source is derived and the evidence bytes stay unchanged', async () => {
  const {localizeStoryRoomInteractions, storyRoomReferenceSha256} = await modulePromise;
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), storyRoomReferenceSha256);
  await assert.rejects(localizeStoryRoomInteractions(source + ' ', 'story-room', 'v1'), /integrity mismatch/);
  await assert.rejects(localizeStoryRoomInteractions(source, 'story-room', 'v2'), /unsupported/);
  assert.equal(await localizeStoryRoomInteractions('another resource', 'character-blocking', 'v3'), 'another resource');
});
test('immediate confirmation commits a snapshot after any active save and dispatches only after both commits', async () => {
  const saves = [], events = [], first = deferred(), second = deferred();
  const {context} = await fixture(async args => {saves.push(args.params.state);events.push('save-' + saves.length);await (saves.length === 1 ? first : second).promise;}, async () => {events.push('message');});
  const earlier = context.local.save();await Promise.resolve();
  context.w.cols[0].keys.push('S2');const sending = context.local.send('confirmed');
  assert.equal(context.j_.inert, true);assert.equal(context.document.activeElement.disabled, true);
  context.w.cols[0].keys.push('S3');
  await Promise.resolve();assert.deepEqual(events, ['save-1']);first.resolve();await earlier;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(events, ['save-1', 'save-2']);assert.deepEqual(JSON.parse(JSON.stringify(saves.map(s => s.cols[0].keys))), [['S1'], ['S1', 'S2']]);
  second.resolve();await sending;assert.deepEqual(events, ['save-1', 'save-2', 'message']);assert.equal(context.An, null);
  assert.equal(context.j_.inert, false);assert.equal(context.document.activeElement.disabled, false);assert.equal(context.document.activeElement.focused, 1);
});
test('failed persistence never dispatches; the same page can retry and ignore a duplicate in-flight confirmation', async () => {
  let failing = true, sends = 0;const dispatch = deferred();
  const {context, status} = await fixture(async () => {if (failing) throw Error('事务未提交');}, async () => {sends++;await dispatch.promise;});
  await context.local.send('confirmed');assert.equal(sends, 0);assert.match(status.textContent, /失败.*事务未提交/);
  assert.equal(context.j_.inert, false);assert.equal(context.document.activeElement.disabled, false);
  failing = false;const retry = context.local.send('confirmed');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(sends, 1);await context.local.send('confirmed');assert.equal(sends, 1);dispatch.resolve();await retry;
  assert.match(status.textContent, /交给 Agent/);assert.equal(status.hidden, false);
});
test('queue failure is visible and permits a fresh retry with another committed state', async () => {
  let attempt = 0;const {context, status} = await fixture(async () => {}, async () => {if (++attempt === 1) throw Error('队列未提交');});
  await context.local.send('confirmed');assert.match(status.textContent, /队列未提交/);
  await context.local.send('confirmed');assert.equal(attempt, 2);assert.match(status.textContent, /交给 Agent/);
});
test('slow successful save with expired activation waits for a fresh click and reuses only the committed fingerprint', async () => {
  const save = deferred();let saves = 0, sends = 0;
  const {context, status} = await fixture(async () => {saves++;if(saves === 1) await save.promise;}, async () => {sends++;});
  const first = context.local.send('confirmed');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  context.navigator.userActivation.isActive = false;save.resolve();await first;
  assert.equal(saves, 1);assert.equal(sends, 0);assert.match(status.textContent, /已保存.*再次点击/);assert.equal(context.j_.inert, false);
  context.navigator.userActivation.isActive = true;await context.local.send('confirmed');
  assert.equal(saves, 1);assert.equal(sends, 1);
  context.w.cols[0].keys.push('S2');await context.local.send('new confirmation');
  assert.equal(saves, 2);assert.equal(sends, 2);
});
test('failed save never caches a fingerprint or pretends an expired-activation retry is already committed', async () => {
  let saves = 0, sends = 0, fail = true;
  const {context, status} = await fixture(async () => {saves++;if(fail) throw Error('事务失败');}, async () => {sends++;});
  context.navigator.userActivation.isActive = false;await context.local.send('confirmed');
  assert.equal(saves, 1);assert.equal(sends, 0);assert.match(status.textContent, /事务失败/);assert.doesNotMatch(status.textContent, /已保存/);
  fail = false;context.navigator.userActivation.isActive = true;await context.local.send('confirmed');
  assert.equal(saves, 2);assert.equal(sends, 1);
});
test('restoration preserves an official truncated trailing space so a refresh does not invalidate NS1', async () => {
  const {html} = await fixture(async () => {}), context = {};
  vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function km(e)'), html.indexOf('function $_(e,n,r)')) + html.slice(html.indexOf('function U_(e,n)'), html.indexOf('let localStorySaveWork=')) + ';globalThis.restore=U_;', context);
  const name = '甲'.repeat(23) + ' ', state = {cols: [{act: 'A1', keys: ['N1']}], news: {N1: {name, act: 'A1'}}, nseq: 1, dels: [], filter: null, collapsed: {}, stripOpen: true};
  assert.equal(context.restore(state, {acts: [{id: 'A1'}], scenes: [], plotlines: []}).news.N1.name, name);
});
