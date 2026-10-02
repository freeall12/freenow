const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  class Storage {constructor(){this.values = new Map();} getItem(key){return this.values.get(key) ?? null;} setItem(key, value){this.values.set(key, String(value));} removeItem(key){this.values.delete(key);}}
  const localStorage = new Storage(), sessionStorage = new Storage();localStorage.setItem('tapnow-agent-chats', 'production-conversations');
  const forwarded = [], window = {fetch: async (input, options) => {forwarded.push({input, options});return Response.json({static: true});}, dispatchEvent() {}};
  const context = vm.createContext({window, Storage, localStorage, sessionStorage, location: {href: 'http://localhost:4173/qa/agent-recovery-app.html?session=test', search: '?session=test'}, URL, URLSearchParams, Response, Event, TypeError, JSON, crypto: require('node:crypto').webcrypto});
  vm.runInContext(fs.readFileSync(require.resolve('../qa/agent-recovery-fixture.js'), 'utf8'), context);
  return {window, localStorage, sessionStorage, forwarded};
}
const request = (f, path, data) => f.window.fetch('/api/agent/' + path, {method: 'POST', body: JSON.stringify(data)});
test('the opt-in recovery QA fixture isolates storage and never forwards Agent/task requests to production', async () => {
  const f = fixture(), binding = {projectId: 'qa', conversationId: 'chat', submissionId: 'submission'};
  f.localStorage.setItem('tapnow-agent-chats', 'isolated-conversations');
  assert.equal(f.localStorage.values.get('tapnow-agent-chats'), 'production-conversations');
  assert.equal(f.localStorage.values.get('qa-agent-recovery:test:tapnow-agent-chats'), 'isolated-conversations');
  assert.equal(f.window.CANVAS_DB_NAME, 'tapnow-agent-recovery-qa-test');
  const first = await (await request(f, 'turn', {binding})).json(), results = [{callId: first.calls[0].callId, result: {nodeId: 'real-local-node'}}];
  await assert.rejects(request(f, 'continue', {sessionId: first.sessionId, binding, results}), /固定本地夹具/);
  const state = await (await request(f, 'state', {sessionId: first.sessionId, binding})).json();assert.equal(state.status, 'waiting_tools');
  const next = await (await request(f, 'continue', {sessionId: first.sessionId, binding, results})).json();
  assert.equal(next.round, 2);assert.notEqual(next.calls[0].callId, first.calls[0].callId);
  assert.equal((await f.window.fetch('/api/generation/tasks')).status, 200);assert.equal(f.forwarded.length, 0);
  await f.window.fetch('/style.css');assert.equal(f.forwarded.length, 1);
});
