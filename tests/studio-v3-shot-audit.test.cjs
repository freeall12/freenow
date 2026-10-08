const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const {createShotAuditServer, file} = require('../scripts/serve-studio-shot-audit.cjs');
const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
async function fixture(t, adapters) {
  const server = createShotAuditServer(adapters);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  return (body = bytes, headers = {}, endpoint = '/audit', method = 'POST') => new Promise((resolve, reject) => {
    const request = http.request({host: '127.0.0.1', port, path: endpoint, method,
      headers: {Origin: 'http://localhost:4196', 'Content-Type': 'video/webm;codecs=vp9', ...headers}}, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', value => {text += value;});
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null}));
    });
    request.on('error', reject); request.end(body);
  });
}

test('public QA audit requires exact approved origin, WebM MIME and fixed route', async t => {
  let writes = 0; const post = await fixture(t, {persist: async () => {writes++;}, inspect: async () => ({decodedFrames: 30})});
  assert.equal((await post(bytes, {Origin: 'http://evil.example'})).status, 403);
  assert.equal((await post(bytes, {Origin: ''})).status, 403);
  assert.equal((await post(bytes, {Host: 'evil.example'})).status, 403);
  assert.equal((await post(bytes, {'Content-Type': 'application/octet-stream'})).status, 415);
  assert.equal((await post(bytes, {}, '/audit?file=elsewhere.webm')).status, 404);
  const preflight = await post(Buffer.alloc(0), {'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}, '/audit', 'OPTIONS');
  assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-methods'], 'POST'); assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
  assert.equal(writes, 0);
});

test('public raw EBML bytes persist once and only fixed file is inspected', async t => {
  let writes = 0; const post = await fixture(t, {persist: async data => {writes++; assert.deepEqual(data, bytes);}, inspect: async target => {assert.equal(target, file); return {codec: 'vp9', decodedFrames: 30};}});
  const result = await post(); assert.equal(result.status, 200); assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:4196'); assert.equal(result.body.productionApi, false);
  assert.equal(result.body.file, 'build/qa/studio-shot-audit/public-shot.webm'); assert.equal(writes, 1);
});

test('oversized or non-EBML upload is rejected without writing', async t => {
  let writes = 0; const post = await fixture(t, {persist: async () => {writes++;}, inspect: async () => ({})});
  assert.equal((await post(Buffer.from('fake video bytes'))).status, 400);
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1); bytes.copy(oversized);
  assert.equal((await post(oversized)).status, 413); assert.equal(writes, 0);
});

test('write/inspection gate rejects overlap and hides arbitrary decoder stderr', async t => {
  let release, entered; const blocked = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;}); let calls = 0;
  const post = await fixture(t, {persist: async () => {}, inspect: async () => {calls++; entered(); await blocked; throw Error('private arbitrary stderr must not be returned');}});
  const pending = post(); await started; assert.equal((await post()).status, 409); release();
  const result = await pending; assert.equal(result.status, 422); assert.equal(result.body.error, 'Public QA WebM decode failed'); assert.equal(calls, 1);
  assert.equal((await post()).status, 422, 'gate is released after decoder failure');
});
