const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/actor-emotion@v1.63ee986b.html'), 'utf8');
const resources = import('../src/features/agent-apps/actor-emotion-local-resources.mjs');
const plain = value => JSON.parse(JSON.stringify(value));
const extract = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function page(source, {mode = 'image', persist = async () => {}} = {}) {
  const events = [], errors = [], cleared = [], controls = [], state = {activeTab: mode === 'video' ? 'voice' : 'face', face: {valence: 71, stance: 71, intensity: 72}, ...(mode === 'video' ? {voice: {preset: 'tender', intensity: 36}} : {})};
  let saved = {version: 1, active_tab: 'face', face: {valence: -65, stance: -65, intensity: 68}, ...(state.voice ? {voice: {preset: 'calm', intensity: 10}} : {})};
  const context = vm.createContext({hg: false, RD: {mode, actor: {binding_id: 'aem_0123456789abcdef'}}, zA: state, Gg: {}, rB: 99, Ou: 'retry-call', mB: 'face-key',
    SB() {}, _K: () => plain(state), $K: () => 'actor-emotion-guide-confirm', pw() {}, zw: () => controls.push(context.hg), JK: async () => {events.push('render');},
    clearTimeout: id => cleared.push(id), wg: () => ({}), XA: {guideUnavailable: 'not ready', guideSaveFailed: error => 'save failed: ' + error}, Ab: error => error.message, $O: error => errors.push(error),
    Db: () => 'confirmed direction', eT: () => 'AE2 v=2',
    wP: {request: async request => {assert.equal(request.method, 'tapnow/setWidgetState');events.push('state:start');await persist(plain(request.params.state));saved = plain(request.params.state);events.push('state:committed');return {};}, sendMessage: async message => {events.push('message');assert.equal(message.content[0].text, 'confirmed direction — AE2 v=2');}},
    gb: async (data, snapshot) => {events.push('guide');if (JSON.stringify(saved.face) !== JSON.stringify(snapshot.face)) throw Error('uncommitted face');if (snapshot.voice) assert.deepEqual(saved.voice, plain(snapshot.voice));return {nodeRef: 'node/actual-guide'};},
  });
  // Execute the captured SDK queue, serializer and button handler, not a local
  // replacement implementation. Only the durable host adapters are fixtures.
  vm.runInContext(extract(source, 'function IT(', 'function rT(') + extract(source, 'function tT(', 'const iT=') + extract(source, 'const FK=', 'function qw(') + extract(source, 'async function wb(', 'function zw(') + ';globalThis.confirm=wb;globalThis.persistState=FK;', context);
  return {context, events, errors, cleared, controls, state, saved: () => saved};
}
test('captured immediate confirmation reproduces unsaved face failure; derived SDK waits for commit in image and voice modes', async () => {
  const before = page(html);await before.context.confirm();assert.deepEqual(before.events, ['render', 'guide']);assert.deepEqual(before.errors, ['save failed: uncommitted face']);
  const localized = await (await resources).localizeActorEmotionResources(html, 'actor-emotion', 'v1');
  for (const mode of ['image', 'video']) {
    const after = page(localized, {mode});await after.context.confirm();assert.deepEqual(after.events, ['render', 'state:start', 'state:committed', 'guide', 'message']);assert.deepEqual(after.errors, []);assert.deepEqual(after.cleared, [99]);assert.equal(after.context.rB, null);assert.equal(after.context.hg, false);assert.equal(after.context.Ou, null);assert.equal(after.saved().active_tab, after.state.activeTab);
  }
});
test('pending durable state write holds busy controls and prevents guide save or message until committed', async () => {
  let release, entered;const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const localized = await (await resources).localizeActorEmotionResources(html, 'actor-emotion', 'v1'), app = page(localized, {persist: async () => {entered();await gate;}}), pending = app.context.confirm();
  await started;assert.equal(app.context.hg, true);assert.deepEqual(app.events, ['render', 'state:start']);assert.deepEqual(app.controls, [true]);
  await app.context.confirm();assert.deepEqual(app.events, ['render', 'state:start']);release();await pending;assert.deepEqual(app.events.slice(-3), ['state:committed', 'guide', 'message']);assert.deepEqual(app.controls, [true, false]);
});
test('state durability failure restores button and retries through the original serial SDK queue without saving premature guide', async () => {
  let fail = true;const localized = await (await resources).localizeActorEmotionResources(html, 'actor-emotion', 'v1'), app = page(localized, {persist: async () => {if (fail) throw Error('disk full');}});
  await app.context.confirm();assert.deepEqual(app.events, ['render', 'state:start']);assert.deepEqual(app.errors, ['save failed: disk full']);assert.equal(app.context.hg, false);assert.equal(app.context.Ou, 'retry-call');assert.deepEqual(app.cleared, [99]);
  fail = false;await app.context.confirm();assert.deepEqual(app.events.slice(-5), ['render', 'state:start', 'state:committed', 'guide', 'message']);assert.equal(app.context.Ou, null);
});
test('previous debounced SDK save completes before exact confirmation snapshot is committed', async () => {
  let release, entered, calls = 0;const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve), states = [];
  const localized = await (await resources).localizeActorEmotionResources(html, 'actor-emotion', 'v1'), app = page(localized, {persist: async state => {states.push(state);if (++calls === 1) {entered();await gate;}}});
  const oldState = {version: 1, active_tab: 'face', face: {valence: -100, stance: 0, intensity: 40}}, oldSave = app.context.persistState(oldState);await started;
  const pending = app.context.confirm();await Promise.resolve();assert.equal(states.length, 1);assert.equal(app.events.includes('guide'), false);release();await oldSave;await pending;
  assert.deepEqual(states.map(state => state.face), [oldState.face, app.state.face]);assert.deepEqual(app.events.slice(-4), ['state:start', 'state:committed', 'guide', 'message']);assert.deepEqual(app.errors, []);
});
