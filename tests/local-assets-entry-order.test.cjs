const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const assetsSource = fs.readFileSync(require.resolve('../local-assets.js'), 'utf8');

test('production entry initializes LocalAssets synchronously before the canvas can bind restored asset images', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => ({attributes: match[1], src: match[1].match(/\bsrc="([^"]+)"/)?.[1]?.split('?')[0]}));
  const assetScripts = scripts.filter(script => script.src === 'local-assets.js');
  assert.equal(assetScripts.length, 1);
  assert(scripts.findIndex(script => script.src === 'local-assets.js') < scripts.findIndex(script => script.src === 'app.js'));
  assert(!/\b(?:async|defer)\b|\btype="module"/.test(assetScripts[0].attributes));
});

test('fresh page initializes the real LocalAssets API and restores persisted PNG bytes using the default image resolver', async t => {
  const [{bindLocalImage}, policy] = await Promise.all([import('../src/features/local-resource-migration/display-image.mjs'), import('../src/features/local-resource-migration/display-media.mjs')]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'LocalAssets');
  const archive = new Map(), reads = [], objectURLs = [], writes = [];
  t.after(() => {for (const url of objectURLs) URL.revokeObjectURL(url); if (previous) Object.defineProperty(globalThis, 'LocalAssets', previous); else delete globalThis.LocalAssets;});
  function page() {
    const db = {createObjectStore() {}, transaction() {
      const tx = {objectStore: () => ({put(blob, id) {archive.set(id, blob); writes.push(id); queueMicrotask(() => tx.oncomplete());}, get(id) {
        const request = {}; reads.push(id); queueMicrotask(() => {request.result = archive.get(id); request.onsuccess();}); return request;
      }})}; return tx;
    }};
    const window = {LOCAL_ASSETS_DB_NAME: 'isolated-entry-order-assets', CanvasResourceDisplayReady: Promise.resolve(policy)};
    const context = vm.createContext({window, crypto: {randomUUID: () => 'saved-png'}, indexedDB: {open(name) {
      assert.equal(name, window.LOCAL_ASSETS_DB_NAME); const request = {};
      queueMicrotask(() => {request.result = db; request.onsuccess();}); return request;
    }}, URL: {createObjectURL(blob) {const url = URL.createObjectURL(blob); objectURLs.push(url); return url;}}});
    vm.runInContext(assetsSource, context);
    assert.equal(typeof window.LocalAssets.url, 'function');
    // The actual browser exposes window properties through globalThis. Bridge
    // only that global so bindLocalImage uses its unmodified default resolver.
    globalThis.LocalAssets = window.LocalAssets;
    return window.LocalAssets;
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMgAAAAASUVORK5CYII=', 'base64');
  const first = page(), ref = await first.put(new Blob([png], {type: 'image/png'}));
  assert.equal(ref, 'asset:saved-png');
  const firstImage = {}; await bindLocalImage(firstImage, {source: ref, isCurrent: () => true}).ready;
  assert.match(firstImage.src, /^blob:/); assert.equal(firstImage.title, undefined);
  // Reproduce the old cached-module timing: restore runs while the later
  // classic LocalAssets script is still unavailable, and the binding settles.
  delete globalThis.LocalAssets;
  const racedImage = {}; await bindLocalImage(racedImage, {source: ref, isCurrent: () => true}).ready;
  assert.equal(racedImage.src, undefined); assert.match(racedImage.title, /undefined.*url/);
  page(); // Fresh LocalAssets instance and URL cache; durable archive is retained.
  assert.equal(racedImage.src, undefined); // Defining the API later cannot repair that binding.
  const refreshedImage = {}; await bindLocalImage(refreshedImage, {source: ref, isCurrent: () => true}).ready;
  assert.match(refreshedImage.src, /^blob:/); assert.equal(refreshedImage.title, undefined);
  assert.notEqual(refreshedImage.src, firstImage.src);
  const response = await fetch(refreshedImage.src);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.deepEqual(reads, ['saved-png', 'saved-png']); assert.deepEqual(writes, ['saved-png']);
});
