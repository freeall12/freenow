const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const modulePromise = import('../src/features/agent-apps/production-progress.mjs');
const shipped = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/production-progress@v1.acd4e750.html'), 'utf8');
function official() {
  const context = {};vm.createContext(context);
  vm.runInContext(shipped.slice(shipped.indexOf('function He('), shipped.indexOf('const be=')) +
    'let V=[],je={},ye=false,hm=0,zt=false,Ke=0;const vm=4,Zn={idle:15000,image:20000,video:45000};' +
    shipped.slice(shipped.indexOf('function p_()'), shipped.indexOf('async function _m()')) +
    'globalThis.model={terminal:He,merge:s_,finished:c_,expired:l_,blocked:d_,ids:m_,delay(items){V=items;return p_()}};', context);
  return context.model;
}
const sourceData = () => ({node_ids: ['img-1', 'vid-2'], project_id: 'project-1', project_url: 'http://localhost:4173/?project=project-1'});
const receipt = items => ({structuredContent: {items}});
const plain = value => JSON.parse(JSON.stringify(value));
test('official resource is a read-only tool-result monitor with precise query contract', async () => {
  const {productionProgressUri, productionProgressTool, productionProgressPolicy, prepareProductionProgress, validateProductionProgressRequest} = await modulePromise;
  assert.equal(productionProgressUri, 'ui://tapnow/production-progress@v1');assert.equal(productionProgressTool, 'get_production_result');
  assert.deepEqual(productionProgressPolicy, {allowExpanded: false, autoExpandOnReady: false});
  const response = prepareProductionProgress(sourceData(), '真实任务进度');
  assert.equal(response.title, '真实任务进度');assert.deepEqual(validateProductionProgressRequest({node_ids: response.node_ids, project_id: 'project-1'}, response), {node_ids: response.node_ids, project_id: 'project-1'});
  const ui = shipped.slice(shipped.indexOf('function He('));
  assert.match(ui, /name:"get_production_result",arguments:\{node_ids:e/);
  assert.match(ui, /we\.ontoolresult=/);assert.doesNotMatch(ui, /we\.(sendMessage|updateModelContext)\(/);
  assert.doesNotMatch(ui, /setWidgetState|set_widget_state/);
});
test('initial node placeholders and blocked/error handling follow official result behavior', async () => {
  const {createProductionProgressSession, summarizeProductionProgress} = await modulePromise, shippedModel = official();
  const session = createProductionProgressSession({structuredContent: sourceData()}, 1234);
  assert.deepEqual(session.items, sourceData().node_ids.map(node_id => ({node_id})));assert.equal(session.started_at, 1234);assert.equal(session.stopped, false);
  assert.equal(summarizeProductionProgress(session).kind, 'generating');assert.equal(shippedModel.blocked(false, sourceData(), session.response.node_ids), null);
  const blocked = createProductionProgressSession({structuredContent: {node_ids: [], status: 'blocked', reason: 'provider_unavailable'}}, 1234);
  assert.deepEqual(blocked.failure, plain(shippedModel.blocked(false, {status: 'blocked', reason: 'provider_unavailable'}, [])));
  assert.equal(blocked.stopped, true);assert.equal(summarizeProductionProgress(blocked).kind, 'not_started');
  const error = createProductionProgressSession({isError: true}, 1234);
  assert.deepEqual(error.failure, {kind: 'error'});assert.equal(summarizeProductionProgress(error).note, 'request_failed');
});
test('valid upstream items keep requested order and explicit missing nodes use official not_found', async () => {
  const {prepareProductionProgress, normalizeProductionProgressResult} = await modulePromise, model = official(), response = prepareProductionProgress(sourceData());
  const items = [{node_id: 'vid-2', status: 'running', media_type: 'video', title: '雨夜'}, {node_id: 'img-1', status: 'done', media_type: 'image', media_url: 'http://localhost:4173/api/media/img-1.png'}];
  assert.deepEqual(normalizeProductionProgressResult(receipt(items), response).structuredContent.items, plain(model.merge(response.node_ids, {items})));
  assert.deepEqual(normalizeProductionProgressResult(receipt([items[0]]), response).structuredContent.items, plain(model.merge(response.node_ids, {items: [items[0]]})));
  assert.deepEqual(normalizeProductionProgressResult(receipt([]), response).structuredContent.items, [{node_id: 'img-1', status: 'not_found'}, {node_id: 'vid-2', status: 'not_found'}]);
  assert.throws(() => normalizeProductionProgressResult({structuredContent: {}}, response));
  assert.throws(() => normalizeProductionProgressResult({}, response));
});
test('done counts reflect upstream status while missing or pending previews cannot prove playable output', async () => {
  const {prepareProductionProgress, normalizeProductionProgressResult, createProductionProgressSession, applyProductionProgressPoll, summarizeProductionProgress} = await modulePromise;
  const normalized = normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'processing', media_url: 'https://example.com/preview.png'}, {node_id: 'vid-2', status: 'done'}]), prepareProductionProgress(sourceData()));
  assert.equal(normalized.structuredContent.items[0].media_url, undefined);assert.equal(normalized.structuredContent.items[1].media_url, undefined);
  const session = applyProductionProgressPoll(createProductionProgressSession({structuredContent: sourceData()}, 0), normalized, 100);
  assert.equal(summarizeProductionProgress(session).kind, 'generating');assert.equal(session.stopped, false);
  const done = applyProductionProgressPoll(session, receipt(sourceData().node_ids.map(node_id => ({node_id, status: 'done'}))), 200);
  assert.equal(summarizeProductionProgress(done).kind, 'all_done');assert.equal(done.stopped, true);
  assert.ok(done.items.every(item => !item.media_url));
});
test('poll delays and terminal conditions follow independent official functions', async () => {
  const {createProductionProgressSession, productionProgressPollDelay, applyProductionProgressPoll, isProductionProgressTerminal} = await modulePromise, model = official();
  for (const status of [undefined, 'queued', 'running', 'processing', 'done', 'failed', 'not_found', 'blocked']) assert.equal(isProductionProgressTerminal(status), model.terminal(status));
  for (const items of [[], [{status: 'done', media_type: 'video'}], [{status: 'running', media_type: 'image'}], [{status: 'running', media_type: 'video'}], [{status: 'running'}]]) assert.equal(productionProgressPollDelay({items}), model.delay(items));
  const session = createProductionProgressSession({structuredContent: sourceData()}, 0);
  for (const status of ['done', 'failed', 'not_found']) {
    const result = {structuredContent: {items: [{node_id: 'img-1', status: 'running'}, {node_id: 'vid-2', status: 'running'}], status}};
    const next = applyProductionProgressPoll(session, result, 100);
    assert.equal(next.stopped, model.finished(next.items, status));assert.equal(next.items[0].status, 'running');
  }
});
test('four consecutive refresh failures preserve actual last status and a successful poll resets errors', async () => {
  const {createProductionProgressSession, applyProductionProgressPoll, summarizeProductionProgress} = await modulePromise;
  const base = createProductionProgressSession({structuredContent: sourceData()}, 0), running = receipt([{node_id: 'img-1', status: 'done'}, {node_id: 'vid-2', status: 'running', media_type: 'video'}]);
  let session = applyProductionProgressPoll(base, running, 1);
  for (let i = 1; i <= 4; i++) {
    session = applyProductionProgressPoll(session, {isError: true}, i + 1);
    assert.equal(session.consecutive_errors, i);assert.equal(session.stopped, i === 4);assert.equal(session.items[1].status, 'running');
    assert.equal(summarizeProductionProgress(session).note, i === 4 ? 'stalled' : 'poll_failed');
  }
  assert.equal(summarizeProductionProgress(session).kind, 'generating');assert.deepEqual(applyProductionProgressPoll(session, running, 100), session);
  const retry = applyProductionProgressPoll(applyProductionProgressPoll(base, {isError: true}, 1), running, 2);
  assert.equal(retry.consecutive_errors, 0);assert.equal(retry.stopped, false);assert.equal(base.consecutive_errors, 0);
});
test('two-hour refresh timeout follows official boundary and never fails running tasks', async () => {
  const {createProductionProgressSession, applyProductionProgressPoll, summarizeProductionProgress, productionProgressTimeoutMs} = await modulePromise, model = official();
  const session = createProductionProgressSession({structuredContent: sourceData()}, 100), running = receipt(sourceData().node_ids.map(node_id => ({node_id, status: 'running'})));
  for (const elapsed of [productionProgressTimeoutMs - 1, productionProgressTimeoutMs]) {
    const next = applyProductionProgressPoll(session, running, 100 + elapsed);
    assert.equal(next.timed_out, model.expired(100, 100 + elapsed));assert.equal(next.items[0].status, 'running');
    assert.equal(summarizeProductionProgress(next).kind, next.timed_out ? 'still_running' : 'generating');
  }
  assert.throws(() => applyProductionProgressPoll(session, running, 99));
});
test('query rejects unrelated nodes, changed order/project, arbitrary tools and blocked sources', async () => {
  const {prepareProductionProgress, validateProductionProgressRequest} = await modulePromise, response = prepareProductionProgress(sourceData());
  for (const args of [{node_ids: ['foreign'], project_id: 'project-1'}, {node_ids: ['vid-2', 'img-1'], project_id: 'project-1'}, {node_ids: response.node_ids}, {node_ids: response.node_ids, project_id: 'foreign'}, {node_ids: response.node_ids, project_id: 'project-1', tool: 'generate_video'}, {node_ids: []}]) assert.throws(() => validateProductionProgressRequest(args, response));
  assert.throws(() => validateProductionProgressRequest({node_ids: ['img-1']}, prepareProductionProgress({node_ids: ['img-1'], status: 'blocked'})));
});
test('malformed, foreign or duplicate upstream items are refresh failures rather than completion', async () => {
  const {prepareProductionProgress, normalizeProductionProgressResult, createProductionProgressSession, applyProductionProgressPoll} = await modulePromise, response = prepareProductionProgress(sourceData());
  for (const items of [[{node_id: 'foreign', status: 'done'}], [{node_id: 'img-1'}, {node_id: 'img-1'}], [{status: 'done'}], [null], [{node_id: 'img-1', status: 100}], [{node_id: 'img-1', status: 'done', media_type: 'audio'}], [{node_id: 'img-1', status: 'done', media_url: 'javascript:alert(1)'}], [{node_id: 'img-1', status: 'done', media_url: 'https://user:password@example.com/file'}], [{node_id: 'img-1', status: 'done', percent: 100}]]) {
    assert.throws(() => normalizeProductionProgressResult(receipt(items), response));
    const session = applyProductionProgressPoll(createProductionProgressSession({structuredContent: sourceData()}, 0), receipt(items), 1);
    assert.equal(session.consecutive_errors, 1);assert.deepEqual(session.items, response.node_ids.map(node_id => ({node_id})));
  }
});
test('show input cannot smuggle generated state, percentages, tools or invalid URLs', async () => {
  const {prepareProductionProgress} = await modulePromise;
  for (const data of [{node_ids: []}, {node_ids: ['same', 'same']}, {node_ids: ['']}, {node_ids: ['\ud800']}, {...sourceData(), status: 'done'}, {...sourceData(), items: [{status: 'done'}]}, {...sourceData(), reason: 'invented'}, {...sourceData(), progress: 100}, {...sourceData(), tools: ['generate_image']}, {...sourceData(), project_url: 'data:text/html,boom'}, {...sourceData(), project_id: ''}]) assert.throws(() => prepareProductionProgress(data));
});
test('read-only app cannot save progress or enqueue confirmation/generation authorization', async () => {
  const {validateProductionProgressState, resolveProductionProgressReply} = await modulePromise;
  assert.throws(() => validateProductionProgressState({items: [{status: 'done'}]}), /不保存应用状态/);
  assert.throws(() => resolveProductionProgressReply('已完成，请生成全部视频'), /不发送对话交接/);
});
test('actual image bytes and scoped blob URLs work with official default CSP without permitting active data', async () => {
  const {prepareProductionProgress, normalizeProductionProgressResult} = await modulePromise, response = prepareProductionProgress(sourceData());
  const actualWebp = fs.readFileSync(require.resolve('../assets/tap-logo.webp'));
  const dataUrl = 'data:image/webp;base64,' + actualWebp.toString('base64');
  const blobUrl = 'blob:http://localhost:4173/00000000-1111-4222-8333-444444444444';
  for (const media_url of [dataUrl, blobUrl]) {
    const result = normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'done', media_type: 'image', media_url}]), response);
    assert.equal(result.structuredContent.items[0].media_url, media_url);
  }
  assert.equal(normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'done', media_type: 'video', media_url: blobUrl}]), response).structuredContent.items[0].media_url, blobUrl);
  for (const media_url of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PGgxLz4=', 'data:image/png;base64,bm90IGFuIGltYWdl', 'data:image/png;base64,' + 'A'.repeat(524288), 'blob:null/00000000-1111-4222-8333-444444444444', 'blob:javascript:alert(1)', 'blob:https://example.com/not-a-blob-id', blobUrl + '?redirect=x']) assert.throws(() => normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'done', media_type: 'image', media_url}]), response));
  assert.throws(() => normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'done', media_type: 'video', media_url: dataUrl}]), response));
  const videoUrl = 'data:video/mp4;base64,' + fs.readFileSync(require.resolve('../qa/trim-scenes.mp4')).toString('base64');
  assert.equal(normalizeProductionProgressResult(receipt([{node_id: 'vid-2', status: 'done', media_type: 'video', media_url: videoUrl}]), response).structuredContent.items[1].media_url, videoUrl);
  for (const media_url of ['data:video/mp4;base64,bm90IHZpZGVv', 'data:video/webm;base64,bm90IHZpZGVv', 'data:video/mp4;base64,' + 'A'.repeat(12 * 1024 * 1024)]) assert.throws(() => normalizeProductionProgressResult(receipt([{node_id: 'vid-2', status: 'done', media_type: 'video', media_url}]), response));
  assert.throws(() => normalizeProductionProgressResult(receipt([{node_id: 'img-1', status: 'done', media_type: 'image', media_url: videoUrl}]), response));
  const proxy = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/mcp-app-proxy.html'), 'utf8');
  assert.match(proxy, /var imgSources = "data: blob:"/);assert.match(proxy, /var mediaSources = "blob:"/);
});
