const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/features/workflow-templates/qa/fixture.js'), 'utf8');
function fixture(session, records = new Map()) {
  const touches = [], fetches = [], locks = [];
  const nativeStorage = {getItem: key => { touches.push(key); return records.get(key) ?? null; }, setItem: (key, value) => { touches.push(key); records.set(key, value); }, removeItem: key => { touches.push(key); records.delete(key); }};
  const location = {origin: 'http://local.test', href: 'http://local.test/src/features/workflow-templates/qa/main.html?session=' + session, search: '?session=' + session};
  const window = {localStorage: nativeStorage, fetch: async (input, options) => { fetches.push({input, options}); return {ok: true}; }};
  const navigator = {locks: {request: (name, options, callback) => { locks.push(name); return typeof options === 'function' ? options() : callback(); }}};
  vm.runInNewContext(source, {window, navigator, location, URL, URLSearchParams, history: {replaceState() {}}, crypto: {randomUUID: () => 'new-session'}});
  return {window, records, touches, fetches, locks, location};
}
test('formal template QA isolates all persistence and locks by session across refresh', async () => {
  const records = new Map([['tapnow-library', 'synthetic-main-record']]), one = fixture('one', records), two = fixture('two', records);
  one.window.localStorage.setItem('tapnow-library', 'isolated-one'); two.window.localStorage.setItem('tapnow-library', 'isolated-two');
  assert.equal(one.window.localStorage.getItem('tapnow-library'), 'isolated-one'); assert.equal(two.window.localStorage.getItem('tapnow-library'), 'isolated-two');
  const refreshed = fixture('one', records); assert.equal(refreshed.window.localStorage.getItem('tapnow-library'), 'isolated-one');
  assert.equal(records.get('tapnow-library'), 'synthetic-main-record');
  for (const name of ['CANVAS_DB_NAME', 'LOCAL_ASSETS_DB_NAME', 'TEMPLATE_DB_NAME']) { assert.match(one.window[name], /^qa-workflow-templates:one:/); assert.notEqual(one.window[name], two.window[name]); }
  assert.ok([...one.touches, ...two.touches, ...refreshed.touches].every(key => key.startsWith('qa-workflow-templates:')));
  assert.equal(one.window.CanvasApp, undefined); assert.equal(one.window.TemplateAPI, undefined);
});
test('formal QA permits real local catalog reads while preventing service writes and external requests', async () => {
  const f = fixture('request');
  await f.window.fetch('/src/features/workflow-templates/resources/templates.json'); assert.equal(f.fetches.length, 1);
  await assert.rejects(f.window.fetch('/api/generation/tasks', {method: 'POST'}), /不提交模型/);
  await assert.rejects(f.window.fetch('https://example.com/public'), /禁止外部/);
  assert.equal(f.fetches.length, 1); assert.equal(f.window.WorkflowTemplateMainFixture.blockedNetworkWrites.length, 1); assert.equal(f.window.WorkflowTemplateMainFixture.externalAttempts.length, 1);
});
test('generated QA uses defaults plus the original production apply and persistence scripts', () => {
  const html = fs.readFileSync(require.resolve('../src/features/workflow-templates/qa/main.html'), 'utf8');
  for (const entry of ['canvas-data', 'editor-data', 'sidebar-data', 'versions-data']) assert.match(html, new RegExp('src="defaults/' + entry + '\\.js"'));
  for (const entry of ['canvas-store', 'local-assets', 'app', 'sidebars', 'templates-core', 'templates-ui']) assert.match(html, new RegExp('src="' + entry + '\\.js(?:\\?[^\"]*)?"'));
  assert.match(html, /workflow-templates\/qa\/fixture\.js/); assert.match(html, /workflow-templates\/qa\/observe\.mjs/);
  assert.doesNotMatch(html, /TemplateAPI\s*=|CanvasApp\s*=|\.insertGraph\s*=|\.undo\s*=/);
});
test('storage quota preflight visibly stops QA before installing any production persistence wrappers', async () => {
  const writes = [], nodes = [], nativeStorage = {getItem: () => null, setItem: () => { const error = Error('Storage quota full'); error.name = 'QuotaExceededError'; throw error; }};
  const window = {localStorage: nativeStorage, fetch: async () => ({ok: true})}, navigator = {locks: {request() {}}}, locks = navigator.locks;
  const document = {write: value => writes.push(value), createElement: tag => ({tag, style: {}, setAttribute() {}, append(...children) { this.children = children; }}), documentElement: {append: node => nodes.push(node)}};
  vm.runInNewContext(source, {window, navigator, document, location: {origin: 'http://local.test', href: 'http://local.test/?session=quota', search: '?session=quota'}, URL, URLSearchParams});
  assert.equal(window.WorkflowTemplateMainFixture.ready, false); assert.equal(window.WorkflowTemplateMainFixture.initializationError.name, 'QuotaExceededError');
  assert.equal(window.localStorage, nativeStorage); assert.equal(navigator.locks, locks); assert.equal(window.CANVAS_DB_NAME, 'qa-workflow-templates:quota:canvas');
  assert.match(writes[0], /script-src 'none'/); assert.equal(nodes[0].id, 'workflow-template-qa-initialization-error'); assert.equal(nodes[0].children[1].id, 'workflow-template-qa-receipt');
  await assert.rejects(window.fetch('/anything'), /初始化失败/);
});

test('all QA isolation initialization exceptions fail closed before production scripts', () => {
  for (const kind of ['storage-getter', 'storage-wrapper', 'locks-wrapper']) {
    const writes = [], nativeStorage = {getItem: () => null, setItem() {}, removeItem() {}}, window = {fetch: async () => ({ok: true})}, navigator = {};
    if (kind === 'storage-getter') Object.defineProperty(window, 'localStorage', {get() { const error = Error('access denied'); error.name = 'SecurityError'; throw error; }});
    else Object.defineProperty(window, 'localStorage', {configurable: kind !== 'storage-wrapper', value: nativeStorage});
    Object.defineProperty(navigator, 'locks', {configurable: kind !== 'locks-wrapper', value: {request() {}}});
    const document = {write: value => writes.push(value), createElement: () => ({style: {}, setAttribute() {}, append() {}}), documentElement: {append() {}}};
    vm.runInNewContext(source, {window, navigator, document, location: {origin: 'http://local.test', href: 'http://local.test/?session=blocked', search: '?session=blocked'}, URL, URLSearchParams});
    assert.equal(window.WorkflowTemplateMainFixture.ready, false, kind); assert.ok(window.WorkflowTemplateMainFixture.initializationError, kind); assert.match(writes[0], /script-src 'none'/, kind);
    for (const key of ['CANVAS_DB_NAME', 'LOCAL_ASSETS_DB_NAME', 'TEMPLATE_DB_NAME']) assert.match(window[key], /^qa-workflow-templates:blocked:/, kind);
  }
});
