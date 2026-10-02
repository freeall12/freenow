'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), {createHash} = require('node:crypto');
const {buildLocalResourceIndex} = require('../src/features/local-resource-migration/build-index.cjs');
const {writeLocalResourceIndex} = require('../src/features/local-resource-migration/cli.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-migration-')); t.after(() => fs.rm(root, {recursive: true, force: true})); await fs.mkdir(path.join(root, 'reference')); await fs.mkdir(path.join(root, 'assets')); return root;}
const json = (root, name, data) => fs.writeFile(path.join(root, 'reference', name), JSON.stringify(data));

test('fresh distribution produces a valid empty static index without private manifests', async t => {
  const root = await fixture(t), result = await writeLocalResourceIndex({root});
  assert.equal(result.published, true); assert.equal(result.stats.indexed, 0); assert.deepEqual(result.diagnostics, []);
  const index = JSON.parse(await fs.readFile(path.join(root, 'assets/local-resource-index.json'), 'utf8'));
  assert.deepEqual(index, {version: 1, algorithm: 'sha256-exact-utf8', entries: {}});
  await assert.rejects(writeLocalResourceIndex({root, output: path.join(root, 'other.json')}));
});

test('verifies bytes, exact query identity, catalog checksums and identical duplicate destinations', async t => {
  const root = await fixture(t), content = Buffer.from('pixels'), source = 'https://old.example.test/a.png?size=full';
  for (const name of ['a.png', 'b.png', 'model.glb']) await fs.writeFile(path.join(root, 'assets', name), content);
  const metadata = {sha256: hash(content), bytes: content.length};
  await json(root, 'agent-reference-assets.json', [{url: source, file: 'assets/b.png', ...metadata}]);
  await json(root, 'agent-manager-assets.json', [{url: source, file: 'assets/a.png', ...metadata}]);
  await json(root, 'playlist-intro-assets.json', [{source: 'https://old.example.test/intro', name: 'assets/a.png', bytes: content.length}]);
  await json(root, 'stage-library-catalog.json', [{assets: [{sourceModel: 'https://old.example.test/model', model: 'assets/model.glb', sourcePreview: 'https://old.example.test/preview', preview: 'assets/a.png'}]}]);
  await json(root, 'stage-library-assets.json', [{path: 'assets/model.glb', ...metadata}, {path: 'assets/a.png', ...metadata}]);
  const result = await buildLocalResourceIndex({root});
  assert.deepEqual(result.diagnostics, []); assert.equal(result.stats.indexed, 4); assert.equal(result.stats.duplicateSources, 1);
  assert.equal(result.stats.computedChecksums, 1); assert.equal(result.index.entries[hash(source)].ref, '/assets/a.png');
  assert.equal(result.index.entries[hash(source.replace('full', 'thumb'))], undefined);
  assert.ok(!JSON.stringify(result.index).includes('https://')); assert.ok(!JSON.stringify(result.stats).includes(source));
  assert.equal((await import('../src/features/local-resource-migration/index-format.mjs')).validateResourceIndex(result.index).entries[hash(source)].bytes, 6);
});

test('broken checksum, traversal, symlink escapes and source conflicts fail publication without replacing prior index', async t => {
  const root = await fixture(t), source = 'https://old.example.test/a', first = Buffer.from('first'), second = Buffer.from('second');
  await fs.writeFile(path.join(root, 'assets/a.png'), first); await fs.writeFile(path.join(root, 'assets/b.png'), second);
  await fs.writeFile(path.join(root, 'outside.png'), first); await fs.symlink(path.join(root, 'outside.png'), path.join(root, 'assets/escape.png'));
  const target = path.join(root, 'assets/local-resource-index.json'); await fs.writeFile(target, 'prior');
  await json(root, 'agent-reference-assets.json', [{url: source, file: 'assets/a.png', sha256: hash(first)}, {url: source + '/bad', file: 'assets/a.png', sha256: hash(second)}, {url: source + '/escape', file: 'assets/escape.png', sha256: hash(first)}, {url: source + '/traverse', file: 'assets/../outside.png'}]);
  await json(root, 'agent-manager-assets.json', [{url: source, file: 'assets/b.png', sha256: hash(second)}]);
  const result = await writeLocalResourceIndex({root});
  assert.equal(result.published, false); assert.equal(result.stats.indexed, 0); assert.equal(result.diagnostics.length, 4);
  assert.equal(await fs.readFile(target, 'utf8'), 'prior'); assert.ok(!JSON.stringify(result.diagnostics).includes(source));
});

test('a present malformed manifest and a catalog without checksums are repair failures, not fresh empty successes', async t => {
  const root = await fixture(t); await json(root, 'agent-reference-assets.json', {wrong: true});
  await json(root, 'stage-library-catalog.json', [{assets: []}]);
  const result = await writeLocalResourceIndex({root}); assert.equal(result.published, false); assert.equal(result.diagnostics.length, 2);
  await assert.rejects(fs.stat(path.join(root, 'assets/local-resource-index.json')));
});
