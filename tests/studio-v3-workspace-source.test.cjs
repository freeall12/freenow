const test = require('node:test');
const assert = require('node:assert/strict');
const domain = import('../src/features/studio-v3/workspace-source.mjs');
const state = source => ({scenePlay: {worldSpace: {source}}});
const app = nodes => ({getState: () => ({nodes})});

test('selected local scene overrides rendering without changing the original binding', async () => {
  const {workspaceSourceResource} = await domain;
  const nodes = [{id: 'owner', studioV3: {sourceBinding: {sourceKind: 'world-resource', sourceNodeId: 'original'}}},
    {id: 'original', worldResource: {format: 'glb', url: 'asset:original'}}];
  const original = JSON.stringify(nodes);
  assert.deepEqual(workspaceSourceResource(app(nodes), 'owner', state({kind: 'world-asset'})), nodes[1].worldResource);
  assert.equal(workspaceSourceResource(app(nodes), 'owner', state({kind: 'mesh-preset', preset: 'room'})), null);
  const selected = state({kind: 'history-world', threedMeta: {source_format: 'spz', source_url: 'asset:scene', splat: {count: 5}}});
  const result = workspaceSourceResource(app(nodes), 'owner', selected);
  assert.equal(result.url, 'asset:scene'); assert.equal(result.format, 'spz');
  result.splat.count = 6; assert.equal(selected.scenePlay.worldSpace.source.threedMeta.splat.count, 5);
  assert.equal(JSON.stringify(nodes), original);
});

test('remote or incomplete scene metadata is rejected before model transport', async () => {
  const {workspaceSourceResource} = await domain;
  for (const metadata of [{format: 'glb', url: 'https://supplier.invalid/world.glb'}, {format: 'glb'}, {format: 'obj', url: 'asset:model'}]) {
    assert.throws(() => workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: metadata})));
  }
});

test('scene picker only includes localized world nodes and does not expose mesh objects or images', async () => {
  const {localWorkspaceScenes} = await domain;
  const nodes = [{id: 'world', type: 'world', outputType: 'world', title: '公开场景', worldResource: {format: 'glb', url: 'asset:world'}},
    {id: 'object', type: 'world', outputType: 'asset', worldResource: {format: 'glb', url: 'asset:object'}},
    {id: 'remote', type: 'world', outputType: 'world', worldResource: {format: 'spz', url: 'https://supplier.invalid/world.spz'}},
    {id: 'image', type: 'image', outputType: 'world', worldResource: {format: 'glb', url: 'asset:image'}}];
  const scenes = localWorkspaceScenes(app(nodes)); assert.equal(scenes.length, 1); assert.equal(scenes[0].id, 'world');
  scenes[0].threedMeta.url = 'asset:changed'; assert.equal(nodes[0].worldResource.url, 'asset:world');
});

test('official local LOD sources choose 100k before full_res regardless of order and preserve metadata', async () => {
  const {workspaceSourceResource} = await domain;
  const metadata = {lod_assets: [{format: 'spz', level: 'full_res', url: 'asset:full'}, {format: 'spz', level: '100k', url: 'asset:preview'}],
    metric_scale_factor: 1.2, extensions: {worldlabs: {ground_plane_offset: -0.75}}, splat: {coordinateSystem: 'spz_rub'}};
  const before = structuredClone(metadata), result = workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: metadata}));
  assert.equal(result.url, 'asset:preview');assert.equal(result.format, 'spz');assert.deepEqual(result.lod_assets, metadata.lod_assets);
  assert.equal(result.metric_scale_factor, 1.2);assert.equal(result.extensions.worldlabs.ground_plane_offset, -0.75);assert.deepEqual(metadata, before);
  result.lod_assets[0].url = 'asset:changed';result.extensions.worldlabs.ground_plane_offset = 5;assert.deepEqual(metadata, before);
});

test('local direct sources win over LOD, extension inference works and unavailable preview falls back to local full_res', async () => {
  const {workspaceSourceResource} = await domain;
  for (const metadata of [{format: 'glb', url: 'asset:direct'}, {source_format: 'glb', source_url: 'asset:direct'}, {source_url: '/assets/direct.glb'}]) {
    const result = workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: {...metadata, lod_assets: [{format: 'spz', level: '100k', url: 'asset:preview'}]}}));
    assert.equal(result.url, metadata.url ?? metadata.source_url);assert.equal(result.format, 'glb');
  }
  for (const lod_assets of [[{format: 'spz', level: 'full_res', url: 'asset:full'}], [{format: 'spz', level: '100k', url: 'https://provider.invalid/preview.spz'}, {format: 'spz', level: 'full_res', url: 'asset:full'}]]) {
    const result = workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: {source_format: 'spz', source_url: 'https://provider.invalid/original.spz', lod_assets}}));
    assert.equal(result.url, 'asset:full');assert.equal(result.format, 'spz');
  }
});

test('LOD resolver rejects remote-only, wrong levels/formats, object metadata and invalid local references without transport', async () => {
  const {workspaceSourceResource} = await domain;
  let fetches = 0;const originalFetch = globalThis.fetch;globalThis.fetch = () => {fetches++;throw Error('unexpected transport');};
  try {
    for (const metadata of [
      {lod_assets: [{format: 'spz', level: '100k', url: 'https://provider.invalid/preview.spz'}]},
      {lod_assets: [{format: 'spz', level: 'full_res', url: 'http://localhost/assets/full.spz?token=x'}]},
      {lod_assets: [{format: 'glb', level: '100k', url: 'asset:glb'}]},
      {lod_assets: [{format: 'spz', level: '500k', url: 'asset:spz'}]},
      {lod_assets: [{format: 'spz', level: '100k', url: '/api/agent/config'}]},
      {imported_asset_kind: 'object', lod_assets: [{format: 'spz', level: '100k', url: 'asset:object'}]}
    ]) assert.throws(() => workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: metadata})));
    assert.equal(fetches, 0);
  } finally {globalThis.fetch = originalFetch;}
});

test('scene picker and resolver agree for official local LOD records while retaining the original source binding', async () => {
  const {workspaceSourceResource, localWorkspaceScenes} = await domain;
  const resource = {lod_assets: [{format: 'spz', level: '100k', url: 'https://provider.invalid/preview.spz'}, {format: 'spz', level: 'full_res', url: 'asset:full'}], splat: {metricScaleFactor: 2, groundPlaneOffset: -1}},
    nodes = [{id: 'lod-scene', type: 'world', outputType: 'world', title: '本地历史场景', createdAt: '2026-10-08T00:00:00Z', worldResource: resource},
      {id: 'remote-lod', type: 'world', outputType: 'world', worldResource: {lod_assets: [{format: 'spz', level: '100k', url: 'https://provider.invalid/only.spz'}]}},
      {id: 'object-lod', type: 'world', outputType: 'world', worldResource: {...resource, imported_asset_kind: 'object'}},
      {id: 'image-lod', type: 'image', outputType: 'world', worldResource: resource},
      {id: 'asset-lod', type: 'world', outputType: 'asset', worldResource: resource}];
  const before = structuredClone(nodes), scenes = localWorkspaceScenes(app(nodes));assert.equal(scenes.length, 1);assert.equal(scenes[0].id, 'lod-scene');
  const result = workspaceSourceResource(app(nodes), 'owner', state({kind: 'history-world', threedMeta: scenes[0].threedMeta}));
  assert.equal(result.url, 'asset:full');assert.equal(result.format, 'spz');assert.deepEqual(result.splat, resource.splat);assert.deepEqual(nodes, before);
  scenes[0].threedMeta.lod_assets[1].url = 'asset:changed';assert.deepEqual(nodes, before);
});

test('mixed direct metadata uses each URL paired format and infers only that candidate extension', async () => {
  const {workspaceSourceResource} = await domain;
  for (const metadata of [
    {url: 'https://provider.invalid/remote.spz', format: 'spz', sourceUrl: 'asset:local-glb', sourceFormat: 'glb'},
    {url: 'https://provider.invalid/remote.spz', format: 'spz', source_url: 'asset:local-glb', source_format: 'glb'},
    {url: 'https://provider.invalid/remote.spz', format: 'spz', sourceUrl: '/assets/local.glb'}
  ]) {
    const result = workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: metadata}));
    assert.equal(result.format, 'glb');assert.equal(result.url, metadata.sourceUrl ?? metadata.source_url);
  }
  const preferred = workspaceSourceResource(app([]), 'owner', state({kind: 'history-world', threedMeta: {
    url: 'asset:primary-spz', format: 'spz', sourceUrl: 'asset:secondary-glb', sourceFormat: 'glb'
  }}));assert.equal(preferred.url, 'asset:primary-spz');assert.equal(preferred.format, 'spz');
});
