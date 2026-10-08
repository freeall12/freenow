const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/space-actions.mjs'), import('../src/features/studio-v3/history.mjs')]);
async function fixture() {const [schema, actions, history] = await modules;return {schema, actions, history, state: schema.createState({worldNodeId: 'space', now: 1})};}

test('source edits keep original owner binding and unrelated setup/entity/navigation state intact', async () => {
  const f = await fixture(), original = structuredClone(f.state), sourceBinding = {sourceNodeId: 'original', sourceKind: 'world-resource', sourceSnapshot: {url: '/world.glb', format: 'glb'}}, stored = {state: f.state, sourceBinding};
  const result = f.actions.reduceSpaceAction(stored.state, {type: 'set-space-source', source: {kind: 'mesh-preset', preset: 'room'}}, {now: 3});
  assert.equal(result.ok, true);assert.equal(result.changed, true);assert.equal(result.lane, 'setup:setup:state-1');assert.deepEqual(result.scope, {kind: 'world-space'});
  assert.equal(result.historyLabel, '切换场地');assert.deepEqual(result.state.scenePlay.worldSpace.source, {kind: 'mesh-preset', preset: 'room'});
  const reverted = {...result.state, scenePlay: {...result.state.scenePlay, worldSpace: {...result.state.scenePlay.worldSpace, source: original.scenePlay.worldSpace.source}}};
  assert.deepEqual(reverted, original);assert.deepEqual(f.state, original);assert.equal(stored.sourceBinding, sourceBinding);
  const restored = f.actions.reduceSpaceAction(result.state, {type: 'set-space-source', source: {kind: 'world-asset'}}, {now: 4});assert.deepEqual(restored.state, original);
});
test('room patch merges only requested dimensions and nested guides and does not mutate inputs', async () => {
  const f = await fixture(), before = structuredClone(f.state), patch = {width: 1, depth: 100, height: 20, trackingGuides: {lineMarkers: true, spacingMeters: 2}}, result = f.actions.reduceSpaceAction(f.state, {type: 'update-room', patch}, {now: 5});
  assert.deepEqual(result.state.scenePlay.worldSpace.roomConfig, {width: 1, depth: 100, height: 20, trackingGuides: {enabled: true, lineMarkers: true, mode: 'standard', spacingMeters: 2}});
  assert.equal(result.historyLabel, '修改房间');assert.equal(result.state.scenePlay.worldSpace.setups, f.state.scenePlay.worldSpace.setups);assert.equal(result.state.scenePlay.worldSpace.source, f.state.scenePlay.worldSpace.source);
  assert.deepEqual(f.state, before);assert.deepEqual(patch, {width: 1, depth: 100, height: 20, trackingGuides: {lineMarkers: true, spacingMeters: 2}});
});
test('same source or room patch returns original state and creates no change', async () => {
  const f = await fixture();
  for (const action of [{type: 'set-space-source', source: {kind: 'world-asset'}}, {type: 'update-room', patch: {}}, {type: 'update-room', patch: {trackingGuides: {mode: 'standard'}}}]) {
    const result = f.actions.reduceSpaceAction(f.state, action, {now: 5});assert.equal(result.ok, true);assert.equal(result.changed, false);assert.equal(result.state, f.state);
  }
});
test('readonly and busy deny changes on the current lane including baseline, before source edits', async () => {
  const f = await fixture();f.state.scenePlay.worldSpace.activeSetupId = 'setup-default';
  for (const flag of ['readonly', 'busy']) {
    const result = f.actions.reduceSpaceAction(f.state, {type: 'set-space-source', source: {kind: 'empty'}}, {[flag]: true, now: 5});
    assert.equal(result.ok, false);assert.equal(result.changed, false);assert.equal(result.reason, flag);assert.equal(result.state, f.state);assert.equal(result.lane, 'setup:setup-default');
  }
});
test('strict dimensions, modes, spacing, primitive types and field whitelists reject atomically', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  const patches = [{width: 0.9}, {depth: 100.1}, {height: 1.999}, {height: 20.01}, {width: '5'}, {height: Infinity}, {groundY: 4}, {source: {kind: 'empty'}}, {trackingGuides: null}, {trackingGuides: {enabled: 1}}, {trackingGuides: {lineMarkers: 'yes'}}, {trackingGuides: {mode: 'unknown'}}, {trackingGuides: {spacingMeters: 0.75}}, {trackingGuides: {unknown: true}}];
  for (const patch of patches) assert.throws(() => f.actions.reduceSpaceAction(f.state, {type: 'update-room', patch}, {now: 3}));
  assert.throws(() => f.actions.reduceSpaceAction(f.state, {type: 'update-room', patch: {}, setupId: 'other'}, {now: 3}), /unsupported/);
  assert.throws(() => f.actions.reduceSpaceAction(f.state, {type: 'fake'}, {now: 3}), /unknown/);assert.throws(() => f.actions.reduceSpaceAction(f.state, {type: 'update-room', patch: {}}, {now: -1}));assert.deepEqual(f.state, before);
});
test('history scene source preserves real metadata, supports official LOD assets and rejects placeholders/object/image sources', async () => {
  const f = await fixture(), source = {kind: 'history-world', historyAssetId: 'history-scene', label: '真实场景', thumbnailSrc: '/scene.png', threedMeta: {asset_source: 'imported', source_url: '/scene.glb', source_format: 'glb', imported_asset_kind: 'scene', metric_scale_factor: 1.2}};
  const result = f.actions.reduceSpaceAction(f.state, {type: 'set-space-source', source}, {now: 3});assert.deepEqual(result.state.scenePlay.worldSpace.source, source);
  source.threedMeta.source_url = '/mutated.glb';assert.equal(result.state.scenePlay.worldSpace.source.threedMeta.source_url, '/scene.glb');
  for (const meta of [{lod_assets: [{format: 'spz', level: '100k', url: '/preview.spz'}, {format: 'spz', level: 'full_res', url: '/full.spz'}]}, {url: '/local.glb', format: 'glb'}, {sourceUrl: '/local.spz', sourceFormat: 'spz'}]) assert.equal(f.actions.reduceSpaceAction(f.state, {type: 'set-space-source', source: {kind: 'history-world', threedMeta: meta}}, {now: 3}).ok, true);
  for (const source of [{kind: 'mesh-preset', preset: 'fake'}, {kind: 'empty', url: '/scene.glb'}, {kind: 'world-asset', sourceBinding: {}}, {kind: 'history-world', threedMeta: {}}, {kind: 'history-world', threedMeta: {source_url: '/image.png'}}, {kind: 'history-world', threedMeta: {source_url: '/obj.glb', source_format: 'glb', imported_asset_kind: 'object'}}, {kind: 'history-world', threedMeta: {url: '/file.obj', format: 'obj'}}]) assert.throws(() => f.actions.reduceSpaceAction(f.state, {type: 'set-space-source', source}, {now: 3}));
});
test('source and merged room edits are undoable on the current setup lane with exact recovery', async () => {
  const f = await fixture(), engine = f.history.createHistory(f.state);
  for (const action of [{type: 'set-space-source', source: {kind: 'mesh-preset', preset: 'room'}}, {type: 'update-room', patch: {width: 6, trackingGuides: {mode: 'calibration'}}}]) {
    const result = f.actions.reduceSpaceAction(engine.getState(), action, {now: 3});engine.transact(result.lane, result.historyLabel, () => result.state, result.scope);
  }
  const edited = engine.getState();assert.equal(engine.getHistory().lanes['setup:setup:state-1'].undoStack.length, 2);
  assert.equal(engine.undo('setup:setup:state-1').ok, true);assert.equal(engine.undo('setup:setup:state-1').ok, true);assert.deepEqual(engine.getState(), f.state);
  assert.equal(engine.redo('setup:setup:state-1').ok, true);assert.equal(engine.redo('setup:setup:state-1').ok, true);assert.deepEqual(engine.getState(), edited);
});
