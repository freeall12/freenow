const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const {isPublicStaticPath} = require('../server/static-public-path.cjs');
const root = path.resolve(__dirname, '..');
// Execute the actual production request handler, skipping bootstrap entirely:
// no real environment, task stores, models or write locks are opened by this fixture.
async function fixture(t) {
  const source = fs.readFileSync(path.join(root, 'server/server.cjs'), 'utf8');
  const match = source.match(/const server=http\.createServer\(([\s\S]+)\);\nPromise\.all/);
  assert.ok(match, 'production handler extraction must remain explicit');
  const context = {fs, path, root, port: 0, URL, isPublicStaticPath,
    mime: {'.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8'},
    json(res, status, value) {res.writeHead(status, {'Content-Type': 'application/json'});res.end(JSON.stringify(value));},
  };
  const handler = vm.runInNewContext('(' + match[1] + ')', context);
  const server = http.createServer(handler);await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + context.port;
}
test('opaque production proxy can read exactly the local derivation modules and approved SVG bytes via public CORS', async t => {
  const endpoint = await fixture(t);
  const files = [
    ...['production-progress-local-brand', 'performance-rhythm-local-interactions', 'story-room-local-interactions', 'picker-local-presentation'].map(name => ['src/features/agent-apps/' + name + '.mjs', 'text/javascript; charset=utf-8']),
    ['assets/branding/freenow-mark.svg', 'image/svg+xml'],
  ];
  for (const [file, mime] of files) {
    const response = await fetch(endpoint + '/' + file, {headers: {Origin: 'null'}});
    assert.equal(response.status, 200);assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Content-Type'), mime);assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, file)));
    const head = await fetch(endpoint + '/' + file, {method: 'HEAD', headers: {Origin: 'null'}});
    assert.equal(head.status, 200);assert.equal(head.headers.get('Access-Control-Allow-Origin'), '*');assert.equal(await head.text(), '');
  }
});
test('brand CORS change keeps neighboring scripts/assets private to the origin and blocks private routes or API cross-origin', async t => {
  const endpoint = await fixture(t);
  for (const file of ['src/features/agent-apps/host.mjs', 'src/features/agent-apps/production-progress.mjs', 'assets/branding/freenow-agent.svg']) {
    const response = await fetch(endpoint + '/' + file, {method: 'HEAD', headers: {Origin: 'null'}});
    assert.equal(response.status, 200);assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  for (const file of ['server/server.cjs', '.env.local', 'tests/agent-production-progress-brand-static.test.cjs', 'reference/account.json', 'api/agent/config']) {
    const response = await fetch(endpoint + '/' + file, {headers: {Origin: 'null'}});
    assert.equal(response.status, 403);assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);await response.body?.cancel();
  }
  const proxy = await fetch(endpoint + '/src/features/agent-apps/resources/production-progress-proxy.html');
  assert.equal(proxy.status, 200);assert.match(proxy.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.equal(proxy.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(await proxy.text(), /inner\.setAttribute\("sandbox", "allow-scripts"\)/);
});
