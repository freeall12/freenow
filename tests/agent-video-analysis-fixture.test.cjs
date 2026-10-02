const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const values = new Map(), forwarded = [];
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const window = {localStorage: storage, dispatchEvent() {}, fetch: async (input, options) => {
    forwarded.push({input, options}); return Response.json({outputs: [{type: 'video', url: '/qa/trim-scenes.mp4'}]});
  }};
  // Window property replacement must be reflected by unqualified localStorage
  // reads, just as it is in the actual browser.
  const context = {window, location: {href: 'http://127.0.0.1:4173/qa/agent-video-analysis-app.html?session=network-test&repeat',
    origin: 'http://127.0.0.1:4173', search: '?session=network-test&repeat'}, URL, URLSearchParams, Request, Response, Headers, Event,
    crypto: require('node:crypto').webcrypto, console};
  Object.defineProperty(context, 'localStorage', {get: () => window.localStorage});
  vm.runInNewContext(fs.readFileSync(require.resolve('../qa/agent-video-analysis-fixture.js'), 'utf8'), context);
  return {window, forwarded, values};
}

test('isolated analysis fixture rejects cross-origin string, URL and Request inputs before native fetch', async () => {
  const f = fixture();
  for (const input of ['https://example.invalid/remote', new URL('https://example.invalid/remote'),
    new Request('https://example.invalid/api/generation/tasks', {method: 'POST', body: '{}'})]) {
    await assert.rejects(f.window.fetch(input), /禁止外部请求/);
  }
  await assert.rejects(f.window.fetch({}), /不支持此请求地址/);
  assert.equal(f.forwarded.length, 0);
});

test('unrecognized same-origin APIs cannot escape to a configured server provider', async () => {
  const f = fixture();
  for (const path of ['/api', '/api/voice/config', '/api/voice/transcribe', '/api/media/upload',
    '/api/agent/unsupported', '/api/generation/unsupported', '/api/generation/tasks-unrecognized',
    '/%61pi/voice/transcribe', '/api%2fvoice%2ftranscribe']) {
    for (const input of [path, new URL(path, 'http://127.0.0.1:4173'), new Request('http://127.0.0.1:4173' + path)]) {
      await assert.rejects(f.window.fetch(input, {method: 'POST', body: '{}'}), /不支持此 API 路由/);
    }
  }
  assert.equal(f.forwarded.length, 0);
});

test('fixed Agent/config/task routes and same-origin fixture media remain available without a real model request', async () => {
  const f = fixture();
  assert.equal((await (await f.window.fetch(new URL('http://127.0.0.1:4173/api/agent/config'))).json()).configured, true);
  assert.equal((await (await f.window.fetch(new Request('http://127.0.0.1:4173/api/generation/config'))).json()).configured, true);
  await f.window.fetch(new URL('http://127.0.0.1:4173/qa/trim-scenes.mp4'));
  await f.window.fetch(new Request('http://127.0.0.1:4173/style.css'));
  const binding = {projectId: 'canvas', conversationId: 'qa-chat', submissionId: 'qa-submission'};
  const turn = await (await f.window.fetch('/api/agent/turn', {method: 'POST', body: JSON.stringify({binding})})).json();
  f.window.localStorage.setItem('tapnow-agent-chats', JSON.stringify([{messages: [{name: 'video_analyze', submittedTaskId: 'task'}]}]));
  const generated = await (await f.window.fetch('/api/generation/tasks', {method: 'POST', headers: {'Idempotency-Key': 'task'},
    body: JSON.stringify({kind: 'video.analyze', nodeId: 'analysis-source', inputs: [{url: 'data:video/mp4;base64,AA=='}]})})).json();
  assert.equal(generated.id, 'task'); assert.equal(generated.status, 'succeeded');
  const second = await (await f.window.fetch('/api/agent/continue', {method: 'POST', body: JSON.stringify({sessionId: turn.sessionId, binding, results: []})})).json();
  assert.equal(second.round, 2); assert.equal(second.calls[0].args.operationId, turn.calls[0].args.operationId);
  const final = await (await f.window.fetch('/api/agent/continue', {method: 'POST', body: JSON.stringify({sessionId: turn.sessionId, binding, results: []})})).json();
  assert.equal(final.done, true);
  assert.equal((await (await f.window.fetch('/api/agent/cancel')).json()).cancelled, true);
  assert.equal((await (await f.window.fetch('/api/generation/tasks/task')).json()).status, 'cancelled');
  assert.equal(f.window.AgentVideoAnalysisFixture.state.posts.length, 1);
  assert.equal(f.window.AgentVideoAnalysisFixture.state.mediaReads, 1);
  assert.deepEqual(f.forwarded.map(({input}) => String(input instanceof Request ? input.url : input)),
    ['http://127.0.0.1:4173/qa/trim-scenes.mp4', 'http://127.0.0.1:4173/style.css', '/qa/video-analysis-native-result.json']);
  assert.ok(f.values.has('qa-agent-video-analysis:network-test:tapnow-agent-chats'));
});
