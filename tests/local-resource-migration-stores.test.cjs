'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const known = 'https://old.example.test/original.png?size=full', unknown = 'https://old.example.test/missing?private=value';
const ref = '/assets/local-original.png';
const index = {version: 1, algorithm: 'sha256-exact-utf8', entries: {[hash(known)]: {ref, sha256: hash('pixels'), bytes: 6}}};
const load = () => import('../src/features/local-resource-migration/snapshot.mjs');
function privateFree(result) {
  const diagnostics = JSON.stringify({changes: result.changes, unresolved: result.unresolved});
  for (const privateValue of [known, unknown, 'sensitive prompt', 'sensitive-id', 'sensitive-resolution']) assert.equal(diagnostics.includes(privateValue), false);
}

test('library arrays and envelopes migrate only explicit media while retaining identity and folders', async () => {
  const {migrateLibrarySnapshot} = await load();
  const item = {id: 'sensitive-id', type: 'video', image: known, fullImage: known, video: known, audio: unknown,
    name: 'sensitive prompt', content: known, url: known, mediaKey: 'video:' + known, provenance: {sourceUrl: known}, folder: '收藏'};
  for (const before of [[item], {items: [item], folders: ['收藏'], revision: 3, custom: {url: known}}]) {
    const original = structuredClone(before), result = await migrateLibrarySnapshot(before, {index});
    assert.deepEqual(before, original); assert.equal(result.summary.changed, 3); assert.equal(result.summary.unresolved, 1);
    const after = Array.isArray(result.snapshot) ? result.snapshot[0] : result.snapshot.items[0];
    assert.equal(after.image, ref); assert.equal(after.video, ref); assert.equal(after.audio, unknown);
    assert.equal(after.content, known); assert.equal(after.url, known); assert.equal(after.mediaKey, item.mediaKey);
    assert.deepEqual(after.provenance, item.provenance); assert.equal(after.id, item.id); assert.equal(after.folder, '收藏');
    if (!Array.isArray(before)) {assert.deepEqual(result.snapshot.folders, before.folders); assert.deepEqual(result.snapshot.custom, before.custom); assert.equal(result.snapshot.revision, 3);}
    privateFree(result); const second = await migrateLibrarySnapshot(result.snapshot, {index}); assert.equal(second.summary.changed, 0); assert.equal(second.summary.unresolved, 1);
  }
});

test('subject authority envelope preserves deleted records, operation receipts and text assets', async () => {
  const {migrateSubjectSnapshot} = await load();
  const before = {version: 1, libraryKey: 'shared', storageRevision: 9, subjects: [{id: 'sensitive-id', name: 'sensitive prompt', deletedAt: 123,
    assets: [{id: 'image', type: 'image', url: known, image: known, provenance: {sourceUrl: known}}, {id: 'video', type: 'video', url: unknown, image: 'asset:poster'}, {id: 'text', type: 'text', text: known, url: known}],
    agentOperations: [{id: 'receipt', args: {url: known}}]}], receipts: [{id: 'global-receipt', url: known}]};
  const original = structuredClone(before), result = await migrateSubjectSnapshot(before, {index});
  assert.deepEqual(before, original); assert.equal(result.summary.changed, 2); assert.equal(result.summary.unresolved, 1);
  assert.equal(result.snapshot.subjects[0].assets[0].url, ref); assert.equal(result.snapshot.subjects[0].assets[0].image, ref);
  assert.deepEqual(result.snapshot.subjects[0].assets[2], before.subjects[0].assets[2]);
  assert.deepEqual(result.snapshot.subjects[0].agentOperations, before.subjects[0].agentOperations); assert.deepEqual(result.snapshot.receipts, before.receipts);
  assert.equal(result.snapshot.subjects[0].deletedAt, 123); assert.equal(result.snapshot.storageRevision, 9);
  assert.deepEqual(result.unresolved.map(row => row.path), ['$.subjects[0].assets[1].url']); privateFree(result);
});

test('template rows and collections reuse canvas slots inside complete graph snapshots', async () => {
  const {migrateTemplateSnapshot} = await load();
  const row = {id: 'sensitive-id', name: 'sensitive prompt', image: known, video: unknown, createdAt: 1, updatedAt: 2,
    tags: ['标签'], description: known, graph: {version: 1, width: 100, height: 100, nodes: [{id: 'graph-node', image: known,
      versions: [{fullImage: known}], editorDoc: {canvas: {backgroundImage: {type: 'Image', src: known}}},
      generation: {prompt: known, refs: [known]}, provenance: {sourceUrl: known}}], edges: []}};
  for (const before of [row, [row]]) {
    const original = structuredClone(before), result = await migrateTemplateSnapshot(before, {index});
    assert.deepEqual(before, original); assert.equal(result.summary.changed, 5); assert.equal(result.summary.unresolved, 1);
    const after = Array.isArray(result.snapshot) ? result.snapshot[0] : result.snapshot;
    assert.equal(after.image, ref); assert.equal(after.graph.nodes[0].image, ref); assert.equal(after.graph.nodes[0].generation.refs[0], ref);
    assert.equal(after.graph.nodes[0].generation.prompt, known); assert.deepEqual(after.graph.edges, row.graph.edges);
    assert.deepEqual(after.graph.nodes[0].provenance, row.graph.nodes[0].provenance); assert.equal(after.description, known);
    assert.equal(after.createdAt, 1); assert.equal(after.updatedAt, 2); assert.equal(after.id, row.id); privateFree(result);
  }
});

test('generation history migrates readable receipt outputs and archived world resources without inventing successful states', async () => {
  const {migrateGenerationHistorySnapshot} = await load();
  const world = {worldId: 'sensitive-id', marbleUrl: known, assets: {splats: {spzUrls: {'sensitive-resolution': known}}, mesh: {hqMeshUrl: unknown}, imagery: {panoUrl: known}}, coordinateSystem: 'marble_raw_opencv'};
  const before = {version: 1, projectId: 'project-identity', storageRevision: 4, receipts: [{taskId: 'sensitive-id', prompt: 'sensitive prompt', recoverable: true,
    status: 'succeeded', parameters: {negativePrompt: known}, application: {applied: true, resultIds: ['same-id']},
    outputs: [null, {type: 'image', url: known, image: known, fullImage: known, sourceUrl: unknown, provenance: {sourceUrl: known}},
      {type: 'model', url: known, poster: known, model: known, world}, {type: 'text', text: known, url: known}]}],
    rows: [{id: 'sensitive-id', taskId: 'same-task', type: 'image', source: known, mediaRef: known, thumbnailRef: unknown, archiveStatus: 'failed', archiveError: 'retained error', prompt: known},
      {id: 'world-row', type: 'model', source: known, mediaRef: known, archiveStatus: 'ready', worldPatch: {image: known, worldResource: {url: known, thumbnail: known, sourceUrl: known, world}}}], custom: {url: known}};
  const original = structuredClone(before), result = await migrateGenerationHistorySnapshot(before, {index});
  assert.deepEqual(before, original); assert.equal(result.summary.unresolved, 4); assert.ok(result.summary.changed > 10);
  assert.equal(result.snapshot.receipts[0].outputs[1].url, ref); assert.equal(result.snapshot.receipts[0].outputs[1].sourceUrl, unknown);
  assert.equal(result.snapshot.receipts[0].outputs[2].world.assets.imagery.panoUrl, ref); assert.equal(result.snapshot.receipts[0].outputs[2].world.marbleUrl, known);
  assert.deepEqual(result.snapshot.receipts[0].outputs[3], before.receipts[0].outputs[3]); assert.equal(result.snapshot.receipts[0].outputs[2].model, known);
  assert.deepEqual(result.snapshot.receipts[0].application, before.receipts[0].application); assert.equal(result.snapshot.rows[0].archiveStatus, 'failed');
  assert.equal(result.snapshot.rows[0].archiveError, 'retained error'); assert.equal(result.snapshot.rows[1].archiveStatus, 'ready');
  assert.equal(result.snapshot.rows[1].worldPatch.worldResource.url, ref); assert.equal(result.snapshot.rows[1].worldPatch.worldResource.sourceUrl, known);
  assert.equal(result.snapshot.storageRevision, 4); assert.deepEqual(result.snapshot.custom, before.custom); privateFree(result);
  const second = await migrateGenerationHistorySnapshot(result.snapshot, {index}); assert.equal(second.summary.changed, 0); assert.equal(second.summary.unresolved, 4);
});

test('all typed stores reject malformed input or missing index instead of reporting empty success', async () => {
  const api = await load();
  const cases = [['migrateLibrarySnapshot', {items: null}, []], ['migrateSubjectSnapshot', {version: 1, libraryKey: 'shared', subjects: [{assets: null}]}, {version: 1, libraryKey: 'shared', subjects: []}],
    ['migrateTemplateSnapshot', {graph: {version: 1, nodes: [], edges: null}}, []], ['migrateGenerationHistorySnapshot', {version: 1, projectId: 'project', rows: [], receipts: [{outputs: 'invalid'}]}, {version: 1, projectId: 'project', rows: [], receipts: []}]];
  for (const [name, invalid, valid] of cases) {
    await assert.rejects(api[name](invalid, {index})); await assert.rejects(api[name](valid));
    const result = await api[name](valid, {index: {...index, entries: {}}}); assert.equal(result.summary.references, 0); assert.deepEqual(result.snapshot, valid);
  }
});
