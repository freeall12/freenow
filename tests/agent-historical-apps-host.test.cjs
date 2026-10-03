const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const tick = () => new Promise(resolve => setImmediate(resolve));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKmsAAAAASUVORK5CYII=';

class Surface {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event) { for (const fn of [...this.listeners.get(type) || []]) fn(event); }
}

async function largeV1Response() {
  const {createAnimaticV1Runtime} = await import('../src/features/agent-apps/animatic-v1-runtime.mjs');
  const nodes = Array.from({length: 6}, (_, i) => ({id: 'source' + i, type: 'image', image: png, x: 0, y: 0, width: 1, height: 1}));
  // Real source bytes are read; preview encoding is a controlled size fixture.
  // This exercises transport budgets, not image rendering or provider quality.
  const runtime = createAnimaticV1Runtime({app: {getState: () => ({nodes, edges: []})}, localAssets: {url: () => assert.fail('not an asset source')}, getProjectId: () => 'fixture', renderPreview: async () => ({width: 768, height: 768, data_uri: 'data:image/jpeg;base64,' + 'AAAA'.repeat(50000)})});
  const args = await runtime.prepareAppArgs({resource_uri: 'ui://tapnow/animatic@v1', data: {sheets: nodes.map((node, i) => ({sheet_id: 'B' + i, node_ref: 'node/' + node.id, shots: [{shot_code: 'S' + i, cell: 0, duration: 1, move: 'static', script_text: 'fixture shot'}]}))}});
  return args.data;
}

async function surface(resourceUri, toolResult, callbacks = {}) {
  const {createMcpAppHost} = await import('../src/features/agent-apps/host.mjs');
  const window = new Surface(), iframe = new Surface(), sent = [], timers = new Map();
  let timer = 0;
  Object.assign(window, {crypto: {randomUUID}, navigator: {userActivation: {isActive: true}}, setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn) { timers.set(++timer, fn); return timer; }, clearInterval(id) { timers.delete(id); }});
  Object.assign(iframe, {ownerDocument: {defaultView: window, activeElement: iframe}, isConnected: true, contentWindow: {postMessage(message) { sent.push(structuredClone(message)); }}});
  const host = createMcpAppHost({iframe, resourceUri, toolResult, allowResource: () => true, callbacks});
  host.start();
  const nonce = () => sent.findLast(item => item.method === 'ui/notifications/sandbox-resource-ready')?.nonce;
  const emit = data => window.emit('message', {source: iframe.contentWindow, origin: 'null', data: {jsonrpc: '2.0', nonce: nonce(), ...data}});
  const rpc = async (id, method, params = {}) => { emit({id, method, params}); await tick(); return sent.findLast(item => item.id === id); };
  const initialize = async () => { await rpc('init', 'ui/initialize', {protocolVersion: '2026-01-26', appCapabilities: {}, appInfo: {name: 'fixture', version: '1'}}); emit({method: 'ui/notifications/initialized'}); await tick(); };
  return {host, sent, rpc, initialize};
}

test('historical animatic host delivers a prepared 1.2 MiB board without truncation', async t => {
  const result = await largeV1Response();
  const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
  assert.ok(bytes > 1000000 && bytes < 4 * 1024 * 1024);
  const f = await surface('ui://tapnow/animatic@v1', result);
  t.after(() => f.host.dispose());
  await f.initialize();
  const delivered = f.sent.find(item => item.method === 'ui/notifications/tool-result');
  assert.deepEqual(delivered.params.structuredContent, result);
  assert.equal(f.host.updateData({}, result), true);
  assert.deepEqual(f.sent.findLast(item => item.method === 'tapnow/updateData').params.toolResult, result);
});

test('historical animatic host rejects initial and updated data above 4 MiB', async t => {
  const oversized = {summary: 'x'.repeat(4 * 1024 * 1024)};
  await assert.rejects(surface('ui://tapnow/animatic@v1', oversized), /data exceeds the supported size/);
  const f = await surface('ui://tapnow/animatic@v1', {summary: 'small'});
  t.after(() => f.host.dispose());
  assert.throws(() => f.host.updateData({}, oversized), /data exceeds the supported size/);
  await f.initialize();
  assert.deepEqual(f.sent.find(item => item.method === 'ui/notifications/tool-result').params.structuredContent, {summary: 'small'});
});

test('historical v1 hosts cannot invoke v2 generation tools even when an adapter is supplied', async t => {
  let calls = 0;
  for (const uri of ['ui://tapnow/animatic@v1', 'ui://tapnow/character-blocking@v1']) {
    const f = await surface(uri, {summary: 'fixture'}, {onGenerationAppTool() { calls++; assert.fail('v1 must not invoke generation'); }});
    t.after(() => f.host.dispose());
    await f.initialize();
    for (const [i, name] of ['animatic_variants_submit', 'animatic_variants_lookup', 'previs_variants_submit'].entries()) {
      const reply = await f.rpc('forbidden-' + i, 'tools/call', {name, arguments: {}, _meta: {'tapnow/callId': 'fixture-call-id'}});
      assert.equal(reply.error.code, -32601);
    }
  }
  assert.equal(calls, 0);
});
