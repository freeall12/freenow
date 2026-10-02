const test = require('node:test');
const assert = require('node:assert/strict');

// Decoder adapters below are resource-lifecycle probes, not media/visual proof.
async function resizeFixture({fetchImpl, decodeImage, useNativeDecoder = false, isCurrent = () => true} = {}) {
  const helper = await import('../src/features/agent-apps/platform-resize.mjs');
  const {createPlatformResizeRuntime} = await import('../src/features/agent-apps/platform-resize-runtime.mjs');
  const node = {id: 'source', type: 'image', image: 'asset:source', fullImage: 'asset:source'};
  const runtime = createPlatformResizeRuntime({
    app: {getState: () => ({nodes: [node], edges: []}), createConnected() {throw Error('unexpected mutation');}},
    localAssets: {url: async () => 'blob:https://review.test/source', put: async () => {throw Error('unexpected save');}},
    store: {save: async () => {throw Error('unexpected graph save');}},
    getProjectId: () => 'review-project', persistConversation: async () => {throw Error('unexpected receipt');},
    fetchImpl: fetchImpl || (async () => new Response(new Blob(['decode-probe'], {type: 'image/png'}))),
    decodeImage: useNativeDecoder ? undefined : decodeImage || (async () => ({width: 20, height: 10, close() {}})),
    renderCrop: async () => ({blob: new Blob(['preview'], {type: 'image/png'}), width: 20, height: 10}),
  });
  const args = {resource_uri: helper.platformResizeUri, data: {image_id: 'node/source', platforms: [{platform: 'square', label_zh: '方图', label_en: 'Square', ratio_id: 'r_1_1'}]}};
  return {prepare: (options = {}) => runtime.prepareAppArgs(args, {isCurrent, ...options})};
}

test('independent review: resize cancels unread failed HTTP and stale fetch streams', async () => {
  for (const mode of ['http-error', 'source-stale']) {
    let cancelled = 0, current = true;
    const response = {ok: mode !== 'http-error', body: {cancel: async () => {cancelled++;}}, headers: new Headers({'content-type': 'image/png'})};
    const fixture = await resizeFixture({isCurrent: () => current, fetchImpl: async () => {if (mode === 'source-stale') current = false;return response;}});
    await assert.rejects(fixture.prepare());
    assert.equal(cancelled, 1, mode);
  }
});

test('independent review: resize closes a decoded resource when its source guard fails', async () => {
  let closed = 0, current = true;
  const fixture = await resizeFixture({isCurrent: () => current, decodeImage: async () => {current = false;return {width: 20, height: 10, close() {closed++;}};}});
  await assert.rejects(fixture.prepare());
  assert.equal(closed, 1);
});

test('independent review: resize rejects actual over-budget bytes and cancels the reader', async () => {
  let cancelled = 0, released = 0, read = 0;
  const fixture = await resizeFixture({fetchImpl: async () => ({ok: true, headers: new Headers({'content-type': 'image/png'}), body: {getReader() {return {
    read: async () => ({done: false, value: new Uint8Array((++read === 1 ? 12 : 1) * 1024 * 1024)}),
    cancel: async () => {cancelled++;}, releaseLock() {released++;},
  };}}})});
  await assert.rejects(fixture.prepare(), /12MiB|超过|超限/);
  assert.equal(read, 2);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('independent review: color cancels a failed HTTP body before any decoder runs', async () => {
  const {createColorAdjustRuntime} = await import('../src/features/agent-apps/color-adjust-runtime.mjs');
  let cancelled = 0;
  const runtime = createColorAdjustRuntime({
    app: {getState: () => ({nodes: [{id: 'source', type: 'image', image: 'asset:source'}], edges: []}), createConnected() {throw Error('unexpected mutation');}},
    localAssets: {url: async () => 'blob:https://review.test/source', put: async () => {throw Error('unexpected save');}},
    store: {save: async () => {throw Error('unexpected graph save');}}, getProjectId: () => 'review-project', persistConversation: async () => {throw Error('unexpected receipt');},
    fetchImpl: async () => ({ok: false, body: {cancel: async () => {cancelled++;}}}),
    renderImage: async () => {throw Error('unexpected decoder');},
  });
  await assert.rejects(runtime.prepareAppArgs({resource_uri: 'ui://tapnow/color-adjust@v2', data: {node_ref: 'node/source'}}));
  assert.equal(cancelled, 1);
});

test('independent review: fallback Image cancellation clears its handlers and object URL', async () => {
  const oldImage = globalThis.Image, oldBitmap = globalThis.createImageBitmap;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let image, started, revoked = 0;
  const ready = new Promise(resolve => {started = resolve;});
  class WaitingImage {
    constructor() {image = this;}
    set src(value) {this.source = value;if (value) started();}
    removeAttribute(name) {if (name === 'src') this.source = '';}
  }
  globalThis.Image = WaitingImage;globalThis.createImageBitmap = undefined;
  URL.createObjectURL = () => 'blob:review-decoder';URL.revokeObjectURL = () => {revoked++;};
  const controller = new AbortController();
  try {
    const fixture = await resizeFixture({useNativeDecoder: true});
    const pending = fixture.prepare({signal: controller.signal});
    await ready;controller.abort(Error('review close'));
    await assert.rejects(pending, /review close/);
    await new Promise(setImmediate);
    assert.equal(image.source, '');assert.equal(image.onload, null);assert.equal(image.onerror, null);assert.equal(revoked, 1);
  } finally {
    URL.createObjectURL = oldCreate;URL.revokeObjectURL = oldRevoke;
    if (oldImage === undefined) delete globalThis.Image;else globalThis.Image = oldImage;
    if (oldBitmap === undefined) delete globalThis.createImageBitmap;else globalThis.createImageBitmap = oldBitmap;
  }
});

test('independent geometry review: exact platform ratios use maximal integer pixels and preserve drag bounds', async () => {
  const {buildPlatformResizeFormats, platformResizePixels} = await import('../src/features/agent-apps/platform-resize.mjs');
  const sources = [[1200, 800], [1201, 799], [4033, 3025], [1001, 1000], [17, 9], [9, 17], [16384, 8191]];
  const ratios = [[1, 1], [16, 9], [9, 16], [4, 3], [2, 2]];
  let cases = 0;
  for (const [width, height] of sources) for (const [ratioWidth, ratioHeight] of ratios) {
    const ratioId = `r_${ratioWidth}_${ratioHeight}`;
    const [format] = buildPlatformResizeFormats([{platform: 'review', label_zh: '验证', label_en: 'Review', ratio_id: ratioId}], width, height);
    // Exhaustive feasible integer-pixel oracle, independent of the runtime's
    // ratio reduction: find the largest width whose matching height is integral.
    let bestWidth = 0, bestHeight = 0;
    for (let candidate = 1; candidate <= width; candidate++) {
      const numerator = candidate * ratioHeight;
      if (numerator % ratioWidth === 0 && numerator / ratioWidth <= height) {bestWidth = candidate;bestHeight = numerator / ratioWidth;}
    }
    for (const [x, y] of [[0, 0], [format.x, format.y], [1000 - format.w, 1000 - format.h]]) {
      const crop = {platform: format.platform, x, y, w: format.w, h: format.h};
      const saved = structuredClone(crop);
      if (!bestWidth) {assert.throws(() => platformResizePixels(crop, width, height, ratioId));continue;}
      const rect = platformResizePixels(crop, width, height, ratioId);
      assert.equal(rect.width * ratioHeight, rect.height * ratioWidth);
      assert.equal(rect.width, bestWidth);assert.equal(rect.height, bestHeight);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
      assert.equal(rect.x, Math.min(width - rect.width, Math.round(x * width / 1000)));
      assert.equal(rect.y, Math.min(height - rect.height, Math.round(y * height / 1000)));
      assert.deepEqual(crop, saved);cases++;
    }
  }
  assert.ok(cases >= 90);
});

test('independent production assembly review: real beginRun identity enables authorization and server exposes the same narrow contract', async () => {
  const fs = require('node:fs');
  const {beginRun} = await import('../src/features/agent-recovery/model.mjs');
  const clientSource = fs.readFileSync(require.resolve('../agent-client.js'), 'utf8');
  const match = /cutlistAuthorized:([^}\n]+)\}\);/.exec(clientSource);
  assert.ok(match, 'production execute must forward the current assembly authority');
  const authorize = Function('name', 'draft', 'd', 'run', 'runController', `return (${match[1]});`);
  const chat = {id: 'review-chat'}, run = beginRun(chat, {projectId: 'review-project', submissionId: 'review-submission'});
  const controller = new AbortController();
  assert.equal(authorize('cutlist_assemble', () => chat, chat, run, controller), true);
  assert.equal(authorize('other_tool', () => chat, chat, run, controller), false);
  assert.equal(authorize('cutlist_assemble', () => ({id: chat.id}), chat, run, controller), false);
  assert.equal(authorize('cutlist_assemble', () => chat, chat, {...run}, controller), false);
  controller.abort();assert.equal(authorize('cutlist_assemble', () => chat, chat, run, controller), false);
  const tools = require('../agent-tools.js'), {AgentRuntime} = require('../server/agent.cjs');
  const runtime = new AgentRuntime({client: {}, model: 'review-model', toolNames: ['cutlist_assemble']});
  const definition = tools.definitions.find(tool => tool.name === 'cutlist_assemble');
  assert.deepEqual(runtime.tools, [definition]);assert.equal(definition.mutates, true);
  assert.deepEqual(Object.keys(definition.parameters.properties).sort(), ['handoff_id', 'operation_id', 'trace_id']);
  const {validate} = require('../server/playlist.cjs');
  assert.equal(validate({clips: [{start: .1, duration: 1.5, data: Buffer.from('bounded uploaded bytes').toString('base64')}]}).length, 1);
  assert.throws(() => validate({clips: [{start: .1, duration: 1.5, data: 'https://untrusted.example/video.mp4'}]}));
});
