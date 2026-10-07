const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric')), domRequire = createRequire(fabricRequire.resolve('jsdom')), canvasPath = domRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
let JSDOM;try {({JSDOM} = fabricRequire('jsdom'));} finally {if (previousCanvas) require.cache[canvasPath] = previousCanvas;else delete require.cache[canvasPath];}
const tick = () => new Promise(setImmediate), deferred = () => {let resolve;const promise = new Promise(yes => resolve = yes);return {promise, resolve};};
async function harness({persist = async () => {}} = {}) {
  const {localizeActorEmotionResources} = await import('../src/features/agent-apps/actor-emotion-local-resources.mjs');
  const original = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/actor-emotion@v1.63ee986b.html'), 'utf8'), localized = await localizeActorEmotionResources(original, 'actor-emotion', 'v1');
  const dom = new JSDOM('<body><div id="root"></div></body>', {url: 'http://localhost:4173/', runScripts: 'outside-only', pretendToBeVisual: true}), window = dom.window, messages = [], registrations = [];
  let initialized = false;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.ResizeObserver = class {observe() {}disconnect() {}};window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});window.console = {debug() {}, log() {}, warn() {}, error() {}};
  const nativeAdd = window.addEventListener.bind(window);window.addEventListener = (type, listener, ...args) => type === 'message' ? registrations.push(listener) : nativeAdd(type, listener, ...args);
  const parent = {postMessage(data) {
    messages.push(data);
    if (data.method === 'ui/initialize') setImmediate(() => emit({id: data.id, result: {protocolVersion: '2026-01-26', hostInfo: {name: 'fixture', version: '1'}, hostCapabilities: {message: {text: {}}}, hostContext: {theme: 'dark', locale: 'zh-CN'}}}));
    if (data.method === 'ui/notifications/initialized') initialized = true;
    if (data.method === 'tapnow/setWidgetState') void Promise.resolve().then(() => persist(data.params.state)).then(() => emit({id: data.id, result: {}}), error => emit({id: data.id, error: {code: -32000, message: error.message}}));
  }};
  Object.defineProperty(window, 'parent', {value: parent});
  function emit(data) {let stopped = false;const event = {source: parent, data: {jsonrpc: '2.0', ...data}, stopImmediatePropagation() {stopped = true;}};for (const listener of registrations) if (!stopped) listener(event);}
  // Evaluate the complete captured module with its real SDK. A fixture lacks a
  // WebGL context; this test covers SDK/state/close, not rendering acceptance.
  const script = localized.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.url', '"http://localhost:4173/actor-fixture.html"');
  vm.runInContext(script, dom.getInternalVMContext());
  for (let i = 0;i < 60 && !initialized;i++) await tick();assert.equal(initialized, true);
  emit({method: 'ui/notifications/tool-result', params: {content: [], structuredContent: {version: 1, locale: 'zh-CN', title: '人物', summary: '人物', scene: '告别', mode: 'image', source: {node_ref: 'node/source', media_kind: 'image'}, actor: {binding_id: 'aem_0123456789abcdef', name: '人物', role: '主角', reference_nodes: [{node_ref: 'node/actor', preview_url: 'data:image/png;base64,AAAA'}]}, face: {valence: -65, stance: -65, intensity: 68}}}});await tick();
  return {window, context: dom.getInternalVMContext(), messages, emit, close: () => window.close(), replies: id => messages.filter(row => row.id === id), edit: () => window.document.querySelector('[data-anchor="joyful"]').click()};
}
test('complete actor SDK intercepts close before connect transport and durably flushes the last debounced edit', async () => {
  const gate = deferred(), app = await harness({persist: () => gate.promise});
  try {
    assert.equal(app.messages.find(row => row.method === 'freenow/lifecycleReady').params.version, 1);app.edit();app.emit({id: 'local-close-actor', method: 'freenow/lifecycleFlush', params: {}});await tick();
    assert.equal(app.window.document.getElementById('root').inert, true);assert.equal(app.replies('local-close-actor').length, 0);
    const write = app.messages.find(row => row.method === 'tapnow/setWidgetState');assert.deepEqual(JSON.parse(JSON.stringify(write.params.state.face)), {valence: 100, stance: 0, intensity: 72});
    gate.resolve();await tick();await tick();assert.equal(app.replies('local-close-actor').length, 1);assert.equal(app.replies('local-close-actor')[0].result.flushed, true);
    app.emit({method: 'freenow/lifecycleResume', params: {id: 'local-close-actor'}});assert.equal(app.window.document.getElementById('root').inert, false);
    assert.equal(app.messages.some(row => ['tools/call', 'ui/message'].includes(row.method)), false);
  } finally {gate.resolve();app.close();}
});
test('actor SDK close storage failure keeps controls editable and succeeds on explicit retry', async () => {
  let fail = true;const app = await harness({persist: async () => {if (fail) throw Error('transaction failed');}});
  try {
    app.edit();app.emit({id: 'local-close-failed', method: 'freenow/lifecycleFlush', params: {}});await tick();await tick();assert.match(app.replies('local-close-failed')[0].error.message, /transaction failed/);assert.equal(app.window.document.getElementById('root').inert, false);
    fail = false;app.emit({id: 'local-close-retry', method: 'freenow/lifecycleFlush', params: {}});await tick();await tick();assert.equal(app.replies('local-close-retry')[0].result.flushed, true);assert.equal(app.messages.filter(row => row.method === 'tapnow/setWidgetState').length, 2);
  } finally {app.close();}
});
test('close during actor confirmation rejects rather than treating a pending guide as safely closed', async () => {
  const gate = deferred(), app = await harness({persist: () => gate.promise});
  try {
    // Isolate the close/confirm race from this VM's lack of WebGL: set the
    // original module busy flag directly, just as wb does before its first await.
    vm.runInContext('hg=true', app.context);app.emit({id: 'local-close-busy', method: 'freenow/lifecycleFlush', params: {}});await tick();assert.match(app.replies('local-close-busy')[0].error.message, /正在保存或提交/);assert.equal(app.messages.some(row => row.method === 'tapnow/setWidgetState'), false);assert.notEqual(app.window.document.getElementById('root').inert, true);
  } finally {gate.resolve();app.close();}
});
test('production host requires actor lifecycle readiness and awaits exact close receipt before allowing dismissal', async () => {
  const {createMcpAppHost} = await import('../src/features/agent-apps/host.mjs'), dom = new JSDOM('<body><iframe></iframe></body>', {url: 'http://localhost:4173/'}), frame = dom.window.document.querySelector('iframe'), sent = [];
  dom.window.crypto.randomUUID = require('node:crypto').randomUUID;
  frame.contentWindow.postMessage = data => sent.push(data);
  const host = createMcpAppHost({iframe: frame, resourceUri: 'ui://tapnow/actor-emotion@v1', callbacks: {onSetWidgetState: async () => {}}, isCurrent: () => true, allowResource: () => true});
  const emit = data => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source: frame.contentWindow, data: {jsonrpc: '2.0', nonce: sent.findLast(row => row.method === 'ui/notifications/sandbox-resource-ready')?.nonce, ...data}}));
  try {
    host.start();emit({method: 'ui/notifications/sandbox-proxy-ready'});emit({id: 'init', method: 'ui/initialize', params: {}});emit({method: 'ui/notifications/initialized'});
    await assert.rejects(host.prepareToClose(), /协议尚未就绪/);emit({method: 'freenow/lifecycleReady', params: {version: 1}});
    const closing = host.prepareToClose(), request = sent.findLast(row => row.method === 'freenow/lifecycleFlush');assert.ok(request);let done = false;closing.then(() => done = true);await tick();assert.equal(done, false);
    emit({id: 'local-close-wrong', result: {flushed: true}});await tick();assert.equal(done, false);
    emit({id: request.id, result: {flushed: true}});assert.equal(await closing, true);host.cancelClose();assert.equal(sent.at(-1).method, 'freenow/lifecycleResume');
  } finally {host.dispose();dom.window.close();}
});
test('actor-only controller blocks real project guard and studio transition until its close lifecycle is handled', async () => {
  const {createAppController, prepareApp} = await import('../src/features/agent-apps/integration.mjs'), dom = new JSDOM('<body></body>', {url: 'http://localhost:4173/'}), previousDocument = globalThis.document;
  globalThis.document = dom.window.document;dom.window.crypto.randomUUID = require('node:crypto').randomUUID;
  const args = {resource_uri: 'ui://tapnow/actor-emotion@v1', data: {mode: 'image', scene: '告别', source: {node_ref: 'node/source', media_kind: 'image'}, actor: {binding_id: 'aem_0123456789abcdef', name: '人物', role: '主角', reference_nodes: [{node_ref: 'node/actor', preview_url: 'data:image/png;base64,AAAA'}]}, face: {valence: -65, stance: -65, intensity: 68}}}, trace = {id: 'actor-transition', name: 'show_app', status: 'done', args, result: prepareApp(args)}, chat = {id: 'actor-chat', messages: [trace]}, notices = [];
  const controller = createAppController({getContext: () => ({chat, panelActive: true, pageLeaving: false}), getActorSourceContext: () => ({guard: () => true, readGuide: () => null}), onSaveState: async () => {}, onError: message => notices.push(message)});
  try {
    dom.window.document.body.append(controller.render(trace));assert.equal(controller.hasPendingCloseApps(), true);
    const source = fs.readFileSync(require.resolve('../agent-client.js'), 'utf8'), registration = source.split('\n').find(line => line.includes('window.CanvasProjects?.registerNavigationGuard(async()=>'));
    let guard, studioChanges = 0;const context = vm.createContext({window: {CanvasProjects: {registerNavigationGuard: callback => guard = callback}}, conversationReady: Promise.resolve(), conversationsLoaded: true, appTransition: null, panel: {}, appCards: controller, draft: () => chat, notice: message => notices.push(message), studioChat: () => {studioChanges++;return {index: 1};}, current: 0});
    assert.ok(registration);vm.runInContext(registration, context);assert.match(await guard(), /保存内嵌应用最后编辑/);
    const start = source.indexOf('beginStudio({nodeId,text,submit=false}){'), end = source.indexOf(',async openAttachments', start);assert.ok(start >= 0 && end > start);
    vm.runInContext('globalThis.studio={' + source.slice(start, end) + '}', context);assert.equal(context.studio.beginStudio({nodeId: 'other-studio'}), false);assert.equal(studioChanges, 0);assert.equal(context.current, 0);assert.match(notices.at(-1), /保存内嵌应用最后编辑/);
    controller.reset();assert.equal(controller.hasPendingCloseApps(), false);
  } finally {controller.reset();dom.window.close();if (previousDocument === undefined) delete globalThis.document;else globalThis.document = previousDocument;}
});
