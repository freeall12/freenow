const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync('src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html', 'utf8'), at = html.indexOf('U_={version:1,locale:'), end = html.indexOf(',wm=document', at);
const officialData = () => structuredClone(vm.runInNewContext('(' + html.slice(at + 3, end) + ')'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=';
async function fixture(overrides = {}) {
  const m = await import('../src/features/agent-apps/product-kit.mjs'), {createProductKitRuntime} = await import('../src/features/agent-apps/product-kit-runtime.mjs');let bytes = Buffer.from(png.split(',')[1], 'base64'), projectId = 'real-project', calls = 0, renders = 0;
  const graph = {nodes: [{id: 'source', type: 'image', fullImage: 'asset:source'}], edges: []}, data = officialData();delete data.product.thumbnail_url;
  const runtime = createProductKitRuntime({app: {getState: () => graph}, localAssets: {url: async () => 'blob:real-local-source'}, getProjectId: () => projectId, fetchImpl: async url => {calls++;assert.match(url, /^blob:/);return new Response(bytes, {headers: {'content-type': 'image/png'}});}, renderImage: async blob => {renders++;assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);return {width: 1, height: 1, data_uri: png};}, ...overrides});
  const args = {resource_uri: m.productKitUri, data: {node_ref: 'node/source', ...data}};
  async function prepare() {const prepared = await runtime.prepareAppArgs(args), trace = {id: 'real-trace', result: runtime.bindPreparedResult({response: m.prepareProductKit(prepared.data)}, prepared)};trace.appState = m.initialProductKitState(trace.result.response);const context = runtime.capture(trace.result.response, {trace, chat: {id: 'real-chat'}, isCurrent: () => true});return {prepared, trace, context};}
  return {m, runtime, args, graph, prepare, setBytes: value => {bytes = value;}, setProject: value => {projectId = value;}, counts: () => ({calls, renders})};
}
test('real bounded node bytes become local thumbnail with persisted source identity; confirmation rechecks SHA', async () => {
  const f = await fixture(), {prepared, trace, context} = await f.prepare();assert.equal(prepared.data.node_ref, undefined);assert.equal(prepared.data.product.thumbnail_url, png);assert.match(trace.result.productKitSourceContext.source_sha256, /^[a-f0-9]{64}$/);assert.deepEqual(f.counts(), {calls: 1, renders: 1});
  const message = f.m.productKitMessage(trace.result.response, trace.appState), reply = await context.reply(message, trace.appState);assert.equal(reply.result.source.node_ref, 'node/source');assert.deepEqual(f.counts(), {calls: 2, renders: 1});
  const restored = structuredClone(trace), current = f.runtime.capture(restored.result.response, {trace: restored, chat: {id: 'real-chat'}, isCurrent: () => true});assert.equal((await current.reply(message, restored.appState)).metadata.handoffId, reply.metadata.handoffId);assert.equal(f.counts().renders, 1);
});
test('caller preview, remote input and resolved remote fallbacks are refused', async () => {
  const f = await fixture();await assert.rejects(f.runtime.prepareAppArgs({...f.args, data: {...f.args.data, product: {...f.args.data.product, thumbnail_url: png}}}), /不得提供/);
  f.graph.nodes[0].fullImage = 'https://files.tapnow.ai/demo/product-kit.webp';await assert.rejects(f.runtime.prepareAppArgs(f.args), /不能访问/);assert.equal(f.counts().calls, 0);
  const g = await fixture({localAssets: {url: async () => 'https://fake.example/image.png'}});await assert.rejects(g.runtime.prepareAppArgs(g.args), /可读取的本地图片/);assert.equal(g.counts().renders, 0);
});
test('same address byte replacement, node deletion, project change and response mutation invalidate bindings', async () => {
  const f = await fixture(), {trace, context} = await f.prepare();f.setBytes(Buffer.from('replaced bytes'));await assert.rejects(context.reply(f.m.productKitMessage(trace.result.response, trace.appState), trace.appState), /实际字节已变化/);
  f.setProject('other');assert.equal(context.isCurrent(), false);f.setProject('real-project');trace.result.response.product.name = 'changed';assert.equal(context.isCurrent(), false);
  const g = await fixture(), saved = await g.prepare();g.graph.nodes.length = 0;assert.equal(saved.context.isCurrent(), false);
});
test('missing saved identity and state changes during asynchronous source checks block handoff', async () => {
  const f = await fixture(), {trace, context} = await f.prepare(), message = f.m.productKitMessage(trace.result.response, trace.appState);
  await assert.rejects(context.reply(message, structuredClone(trace.appState)), /实际已保存/);
  const pending = context.reply(message, trace.appState);trace.appState = structuredClone(trace.appState);await assert.rejects(pending, /保存状态已变化/);
  const g = await fixture(), other = await g.prepare(), submitting = other.context.reply(g.m.productKitMessage(other.trace.result.response, other.trace.appState), other.trace.appState);other.trace.appState.voice = '自然描述';await assert.rejects(submitting, /保存状态已变化/);
});
test('late fetch responses cancel their body after abort; non-stream responses cannot allocate unbounded bytes', async () => {
  let resolveFetch, cancelled = 0, fallbackRead = false;
  const f = await fixture({fetchImpl: () => new Promise(resolve => {resolveFetch = resolve;})}), controller = new AbortController(), pending = f.runtime.prepareAppArgs(f.args, {signal: controller.signal});
  while (!resolveFetch) await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort(Error('late-response-abort'));await assert.rejects(pending, /late-response-abort/);
  resolveFetch({body: {cancel: async () => {cancelled++;}}});await new Promise(resolve => setTimeout(resolve, 0));assert.equal(cancelled, 1);
  const g = await fixture({fetchImpl: async () => ({ok: true, headers: {get: name => name === 'content-type' ? 'image/png' : null}, arrayBuffer: async () => {fallbackRead = true;return new ArrayBuffer(9 * 1024 * 1024);}})});
  await assert.rejects(g.runtime.prepareAppArgs(g.args), /可限额的字节流/);assert.equal(fallbackRead, false);
});
test('declared/actual byte budgets, HTTP failure, abort and timeout cancel reads', async () => {
  let cancellations = 0;
  for (const response of [{ok: false, body: {cancel: async () => {cancellations++;}}}, {ok: true, headers: {get: name => name === 'content-length' ? String(9 * 1024 * 1024) : 'image/png'}, body: {cancel: async () => {cancellations++;}}}]) {const f = await fixture({fetchImpl: async () => response});await assert.rejects(f.runtime.prepareAppArgs(f.args));}
  const large = await fixture({fetchImpl: async () => new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(9 * 1024 * 1024));}, cancel() {cancellations++;}}), {headers: {'content-type': 'image/png'}})});await assert.rejects(large.runtime.prepareAppArgs(large.args), /实际字节超过/);assert.equal(cancellations, 3);
  const hanging = () => new Response(new ReadableStream({cancel() {cancellations++;}}), {headers: {'content-type': 'image/png'}});
  const timed = await fixture({fetchImpl: async () => hanging(), timeoutMs: 10});await assert.rejects(timed.runtime.prepareAppArgs(timed.args), /超时/);
  const f = await fixture({fetchImpl: async () => hanging()}), controller = new AbortController(), pending = f.runtime.prepareAppArgs(f.args, {signal: controller.signal});setTimeout(() => controller.abort(Error('explicit abort')), 5);await assert.rejects(pending, /explicit abort/);assert.equal(cancellations, 5);
});
test('closing runtime capture aborts pending validation; oversized decoder/thumbnail output fails before binding', async () => {
  let hang = false, cancelled = 0;const f = await fixture({fetchImpl: async () => hang ? new Response(new ReadableStream({cancel() {cancelled++;}}), {headers: {'content-type': 'image/png'}}) : new Response(Buffer.from(png.split(',')[1], 'base64'), {headers: {'content-type': 'image/png'}})}), {context} = await f.prepare();hang = true;const pending = context.validateSourceCurrent();setTimeout(() => context.dispose(), 5);await assert.rejects(pending, /已关闭/);assert.equal(cancelled, 1);assert.equal(context.isCurrent(), false);
  for (const output of [{width: 9999, height: 9999, data_uri: png}, {width: 1, height: 1, data_uri: 'https://files.tapnow.ai/demo/product-kit.webp'}, {width: 1, height: 1, data_uri: 'data:image/png;base64,' + 'A'.repeat(500000)}]) {const g = await fixture({renderImage: async () => output});await assert.rejects(g.runtime.prepareAppArgs(g.args));}
});
