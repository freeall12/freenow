'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const remote = 'https://old.example.test/media.png?size=full';
const local = '/assets/migrated.png';
const index = {version: 1, algorithm: 'sha256-exact-utf8', entries: {[hash(remote)]: {ref: local, sha256: hash('pixels'), bytes: 6}}};
const snapshot = nodes => ({version: 1, storageRevision: 7, nodes, edges: [], project: {title: '保留项目'}, view: {x: 2}});
const migration = async (value, mapping = index) => (await import('../src/features/local-resource-migration/snapshot.mjs')).migrateCanvasSnapshot(value, {index: mapping});

test('migrates typed resource fields across canvas, undo, redo, Fabric and studio without touching text or provenance', async () => {
  const node = {id: 'node-identity', image: remote, prompt: remote, provenance: {sourceUrl: remote},
    versions: [remote, {video: remote, poster: remote}], imageHistory: [{prompt: remote, options: [{fullImage: remote}]}],
    videoHistory: [{options: [{url: remote, image: remote}]}], clips: [{url: remote, poster: remote}],
    editorDoc: {canvas: {objects: [{type: 'group', objects: [{type: 'Image', src: remote}, {type: 'textbox', text: remote, src: remote}]}], backgroundImage: {type: 'image', src: remote}}},
    studio: {objects: [{kind: 'model', sourceUrl: remote}], baseline: {objects: [{kind: 'model', sourceUrl: remote}]},
      setups: [{objects: [{kind: 'model', sourceUrl: remote}], keyframes: [{state: {sourceUrl: remote}}]}],
      environment: {hdri: {url: remote}, panoramaResources: [{url: remote}]}, ground: {sceneAsset: {url: remote}},
      panoramaSessions: [{base: remote, thumbnail: remote, patches: [{image: remote, thumbnail: remote}]}], panoramaEdits: [{image: remote}]},
    studioV2: {asset: remote}, worldResource: {url: remote, thumbnail: remote, world: {marbleUrl: remote, assets: {splats: {spzUrls: {'private-key': remote}}, mesh: {colliderMeshUrl: remote}, imagery: {panoUrl: remote}}}},
    generation: {prompt: remote, refs: [remote, {url: remote}], inputs: [{url: remote}]} };
  const before = snapshot([node]); before.history = [{nodes: [{image: remote}], edges: []}]; before.future = [{nodes: [{video: remote}], edges: []}];
  const original = structuredClone(before), result = await migration(before), migrated = result.snapshot.nodes[0];
  assert.deepEqual(before, original); assert.equal(result.summary.unresolved, 0); assert.ok(result.summary.changed > 25);
  assert.equal(migrated.image, local); assert.equal(migrated.id, 'node-identity'); assert.equal(migrated.prompt, remote);
  assert.equal(migrated.provenance.sourceUrl, remote); assert.equal(migrated.generation.prompt, remote);
  assert.equal(migrated.editorDoc.canvas.objects[0].objects[0].src, local);
  assert.equal(migrated.editorDoc.canvas.objects[0].objects[1].src, remote);
  assert.equal(migrated.studio.panoramaSessions[0].patches[0].image, local);
  assert.equal(migrated.worldResource.world.marbleUrl, remote);
  assert.equal(result.snapshot.history[0].nodes[0].image, local); assert.equal(result.snapshot.future[0].nodes[0].video, local);
  assert.equal(result.snapshot.storageRevision, 7); assert.deepEqual(result.snapshot.project, before.project); assert.deepEqual(result.snapshot.view, before.view);
  assert.ok(!JSON.stringify(result.changes).includes(remote)); assert.ok(!JSON.stringify(result.changes).includes('private-key'));
  const second = await migration(result.snapshot); assert.equal(second.summary.changed, 0); assert.equal(second.summary.unresolved, 0);
});

test('unmapped exact URLs and transient blobs remain intact with private-free field diagnostics', async () => {
  const different = remote.replace('full', 'thumb'), value = snapshot([{image: different, fullImage: 'blob:lost', content: 'private prompt'}]);
  const result = await migration(value);
  assert.equal(result.summary.changed, 0); assert.equal(result.summary.unresolved, 2);
  assert.equal(result.snapshot.nodes[0].image, different); assert.equal(result.unresolved[1].code, 'transient_blob');
  assert.deepEqual(result.unresolved.map(row => row.path), ['$.nodes[0].image', '$.nodes[0].fullImage']);
  assert.ok(!JSON.stringify(result.unresolved).includes('example')); assert.ok(!JSON.stringify(result.unresolved).includes('private prompt'));
  assert.equal((await migration(value, {...index, entries: {}})).summary.unresolved, 2);
});

test('retains recognized durable local references and rejects absent or untrusted index schemas', async () => {
  const ref = '/api/generation/media/12345678-1234-4234-8234-000000000001';
  const value = snapshot([{image: 'assets/seed.png', fullImage: ref, audio: 'asset:local-key', video: 'data:video/mp4;base64,YQ=='}]);
  const result = await migration(value); assert.equal(result.summary.alreadyLocal, 4); assert.deepEqual(result.snapshot, value);
  await assert.rejects((await import('../src/features/local-resource-migration/snapshot.mjs')).migrateCanvasSnapshot(value));
  for (const invalid of [{entries: {}}, {...index, sourceUrl: remote}, {...index, entries: {[hash(remote)]: {...index.entries[hash(remote)], ref: '/assets/%2e%2e/secret'}}}, {...index, entries: {[hash(remote)]: {...index.entries[hash(remote)], source: remote}}}]) await assert.rejects(migration(value, invalid));
});
