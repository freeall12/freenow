const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs')
]);
const position = {x: 0, y: 0, z: 0};
const camera = () => ({position: {...position}, rotation: {...position, order: 'XYZ'}, fov: 45});
async function fixture() {
  const [schema, world] = await modules;
  let state = schema.createState({worldNodeId: 'studio-owner', now: 100});
  const role = schema.createRole({id: 'role-a', label: '演员', actorGender: 'neutral', now: 100});
  state = world.addRole(state, role);
  state = world.addEntity(state, schema.createActorFromRole({id: 'actor-a', role, now: 100}));
  state = world.addEntity(state, schema.createEntity({id: 'prop-a', kind: 'prop', label: '道具', now: 100}));
  state = world.addEntity(state, schema.createEntity({id: 'camera-a', kind: 'camera', label: '摄像机', now: 100}), {
    setupState: {...schema.createSetupState('camera-a', 100), camera: camera()}
  });
  return {schema, world, state};
}
const expectDomain = (fn, code) => assert.throws(fn, error => error.name === 'StudioDomainError' && (!code || error.code === code));

test('schemaVersion 4 creates official default stage and separate baseline/independent state', async () => {
  const [schema] = await modules, state = schema.createState({worldNodeId: 'owner', now: 20}), space = state.scenePlay.worldSpace;
  assert.equal(state.schemaVersion, 4);
  assert.equal(space.stages[0].worldNodeId, 'owner');
  assert.equal(space.activeStageId, 'stage-default');
  assert.equal(space.activeSetupId, 'setup:state-1');
  assert.deepEqual(space.setups.map(setup => [setup.id, setup.kind]), [['setup-default', 'scene-baseline'], ['setup:state-1', 'independent']]);
  assert.equal(schema.assertState(state), state);
  assert.equal(schema.baselineId('stage-2'), 'setup:stage-2:default');
});
test('unsupported, malformed and absent schema versions are rejected without migration', async () => {
  const [schema] = await modules;
  for (const version of [undefined, null, 0, 3, 5, 4.1, '4', NaN]) {
    const state = schema.createState({worldNodeId: 'owner', now: 20}); state.schemaVersion = version;
    expectDomain(() => schema.assertState(state), 'unsupported-schema');
  }
});
test('plain JSON, finite transforms and supported fields are enforced', async () => {
  const {schema, state} = await fixture();
  for (const mutate of [
    value => {value.scenePlay.worldSpace.entities[0].extra = true;},
    value => {value.scenePlay.worldSpace.setups[1].entityStates[0].transform.position.x = Infinity;},
    value => {value.scenePlay.worldSpace.setups[1].entityStates[0].transform.scale.x = 0;},
    value => {value.scenePlay.worldSpace.source.date = new Date();},
    value => {value.scenePlay.worldSpace.source.loop = value;},
    value => {delete value.scenePlay.worldSpace.setups[0].entityStates;},
    value => {value.capturedPhotos.extra = 'would be lost on serialization';}
  ]) { const invalid = structuredClone(state); mutate(invalid); expectDomain(() => schema.assertState(invalid)); }
});
test('constructors clone role assets, reference IDs and view camera inputs', async () => {
  const [schema] = await modules, asset = {sourceUrl: 'local:actor', sourceFormat: 'glb'}, references = ['reference-a'];
  const role = schema.createRole({id: 'role', label: 'Role', asset, referenceIds: references, now: 20});
  const actor = schema.createActorFromRole({id: 'actor', role, now: 20});
  asset.sourceUrl = 'changed'; references.push('reference-b'); role.asset.sourceUrl = 'changed-again';
  assert.equal(actor.asset.sourceUrl, 'local:actor'); assert.deepEqual(actor.referenceIds, ['reference-a']);
  const source = camera(), view = schema.createView({id: 'view', label: 'Shot', camera: source, now: 20}); source.position.x = 99;
  assert.equal(view.camera.position.x, 0);
});
test('duplicate entity IDs are rejected on ingestion and insertion without mutating input', async () => {
  const {schema, world, state} = await fixture(), original = structuredClone(state);
  expectDomain(() => world.addEntity(state, state.scenePlay.worldSpace.entities[0]), 'duplicate-id');
  const invalid = structuredClone(state); invalid.scenePlay.worldSpace.entities.push(invalid.scenePlay.worldSpace.entities[0]);
  expectDomain(() => schema.assertState(invalid), 'duplicate-id'); assert.deepEqual(state, original);
});
test('stage creation provides a unique baseline and independent setup with exact owner', async () => {
  const {schema, world, state} = await fixture();
  const next = world.addStage(state, schema.createStage({id: 'stage-2', worldNodeId: 'studio-owner', now: 100}), {activate: true});
  assert.equal(next.scenePlay.worldSpace.activeSetupId, 'setup:stage-2:state-1');
  assert.equal(next.scenePlay.worldSpace.setups.filter(setup => setup.stageId === 'stage-2').length, 2);
  expectDomain(() => world.addStage(state, schema.createStage({id: 'bad-stage', worldNodeId: 'another-owner', now: 100})), 'owner-mismatch');
  expectDomain(() => world.addStage(next, next.scenePlay.worldSpace.stages[1]), 'duplicate-id');
});
test('role/entity/setup/view relations cannot cross stages', async () => {
  const {schema, world, state} = await fixture();
  const next = world.addStage(state, schema.createStage({id: 'stage-2', worldNodeId: 'studio-owner', now: 100}));
  expectDomain(() => world.addEntity(next, schema.createEntity({id: 'actor-b', stageId: 'stage-2', kind: 'actor', label: 'B', roleId: 'role-a', now: 100}), {setupId: 'setup:stage-2:state-1'}), 'cross-stage');
  expectDomain(() => world.addEntityState(next, 'setup:stage-2:state-1', schema.createSetupState('actor-a', 100)), 'cross-stage');
  expectDomain(() => world.addView(next, schema.createView({id: 'view-b', stageId: 'stage-2', setupId: 'setup:stage-2:state-1', sourceCameraEntityId: 'camera-a', label: 'B', camera: camera(), now: 100})), 'cross-stage');
});
test('baseline cannot be missing, renamed into independent, or hold temporal data', async () => {
  const {schema, world, state} = await fixture();
  expectDomain(() => schema.createIndependentSetup({id: 'setup-default'}));
  expectDomain(() => world.setTemporal(state, 'setup-default', {durationMs: 10, tracks: []}, 100));
  for (const mutate of [space => {space.setups.shift();}, space => {space.setups[0].kind = 'independent';}, space => {space.setups[0].temporal = {durationMs: 10, tracks: []};}]) {
    const invalid = structuredClone(state); mutate(invalid.scenePlay.worldSpace); expectDomain(() => schema.assertState(invalid));
  }
});
test('baseline entities render before independent entities and cannot be overridden', async () => {
  const {schema, world, state} = await fixture();
  const next = world.addEntity(state, schema.createEntity({id: 'shared-prop', kind: 'prop', label: '基准道具', now: 100}), {setupId: 'setup-default'});
  assert.deepEqual(world.renderSetup(next).entityStates.map(item => item.entityId), ['shared-prop', 'actor-a', 'prop-a', 'camera-a']);
  expectDomain(() => world.addEntityState(next, 'setup:state-1', schema.createSetupState('shared-prop', 100)));
  expectDomain(() => world.patchEntityState(next, 'setup:state-1', 'shared-prop', {visible: false}, 101), 'missing-relation');
  assert.equal(world.renderSetup(next, 'setup-default').entityStates.length, 1);
});
test('missing look, held, reference, view and output targets are rejected', async () => {
  const {schema, world, state} = await fixture();
  expectDomain(() => world.patchEntityState(state, 'setup:state-1', 'actor-a', {lookTarget: {kind: 'entity', entityId: 'missing'}}, 101), 'missing-relation');
  expectDomain(() => world.patchEntityState(state, 'setup:state-1', 'actor-a', {heldEntityId: 'missing'}, 101), 'missing-relation');
  expectDomain(() => world.patchEntity(state, 'actor-a', {referenceIds: ['missing']}, 101), 'missing-relation');
  expectDomain(() => world.addReference(state, {id: 'reference', targets: [{kind: 'entity', id: 'missing'}]}), 'missing-relation');
  expectDomain(() => world.addView(state, schema.createView({id: 'view', setupId: 'setup-default', label: 'Shot', camera: camera(), now: 100})));
  expectDomain(() => world.addView(state, schema.createView({id: 'view', sourceCameraEntityId: 'prop-a', label: 'Shot', camera: camera(), now: 100})));
  expectDomain(() => world.addOutput(state, {id: 'output', source: {kind: 'view', id: 'missing'}}), 'missing-relation');
});
test('temporal ownership, key identity, local state and channel references are strict', async () => {
  const {world, state} = await fixture();
  const valid = {durationMs: 1000, tracks: [{id: 'track-a', owner: {kind: 'entity', entityId: 'actor-a'}, keys: [{id: 'key-0', timeMs: 0}, {id: 'key-1', timeMs: 1000}], channels: [{id: 'channel', property: 'entity.visibility', values: [{keyId: 'key-0', value: {kind: 'boolean', value: true}}]}]}]};
  assert.equal(world.setTemporal(state, 'setup:state-1', valid, 101).scenePlay.worldSpace.setups[1].temporal.tracks.length, 1);
  for (const mutate of [
    value => {value.tracks[0].owner.entityId = 'missing';},
    value => {value.tracks[0].keys[1].timeMs = 0;},
    value => {value.tracks[0].keys[1].id = 'key-0';},
    value => {value.tracks[0].channels[0].values[0].keyId = 'missing';},
    value => {value.tracks[0].channels[0].values[0].value.kind = 'number';},
    value => {value.tracks[0].channels[0].property = 'camera.fov';}
  ]) { const invalid = structuredClone(valid); mutate(invalid); expectDomain(() => world.setTemporal(state, 'setup:state-1', invalid, 101)); }
});
test('global entity removal cascades states, track owners, views, outputs, references and active view', async () => {
  const {schema, world, state} = await fixture();
  let next = world.patchEntityState(state, 'setup:state-1', 'actor-a', {lookTarget: {kind: 'entity', entityId: 'camera-a'}, heldEntityId: 'camera-a'}, 101);
  next = world.addView(next, schema.createView({id: 'view-a', label: 'Shot', sourceCameraEntityId: 'camera-a', camera: camera(), now: 101}), {activate: true});
  next = world.addOutput(next, {id: 'output-a', source: {kind: 'view', id: 'view-a'}});
  next = world.addReference(next, {id: 'reference-a', targets: [{kind: 'entity', id: 'camera-a'}, {kind: 'view', id: 'view-a'}, {kind: 'entity', id: 'actor-a'}]});
  next = world.setTemporal(next, 'setup:state-1', {durationMs: 1000, tracks: [{id: 'camera-track', owner: {kind: 'entity', entityId: 'camera-a'}, keys: [], channels: []}]}, 101);
  const removed = world.removeEntity(next, 'camera-a', 102), space = removed.scenePlay.worldSpace, actor = space.setups[1].entityStates.find(item => item.entityId === 'actor-a');
  assert.equal(space.entities.some(item => item.id === 'camera-a'), false);
  assert.equal(space.setups[1].entityStates.some(item => item.entityId === 'camera-a'), false);
  assert.deepEqual(space.setups[1].temporal.tracks, []); assert.deepEqual(space.views, []); assert.deepEqual(space.outputs, []);
  assert.deepEqual(space.references[0].targets, [{kind: 'entity', id: 'actor-a'}]);
  assert.equal(space.activeViewId, null); assert.deepEqual(actor.lookTarget, {kind: 'none'}); assert.equal(Object.hasOwn(actor, 'heldEntityId'), false);
  assert.equal(next.scenePlay.worldSpace.views.length, 1, 'reducer must not mutate its input');
});
test('global deletion also clears dependent camera and temporal value targets', async () => {
  const {world, state} = await fixture();
  let next = world.patchEntityState(state, 'setup:state-1', 'camera-a', {camera: {...camera(), focus: {mode: 'object', entityId: 'prop-a'}, lookAt: {mode: 'entity', entityId: 'prop-a'}}}, 101);
  next = world.setTemporal(next, 'setup:state-1', {durationMs: 1, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'actor-a'}, keys: [{id: 'key', timeMs: 0}], channels: [
    {id: 'look', property: 'entity.lookTarget', values: [{keyId: 'key', value: {kind: 'look-target', value: {kind: 'entity', entityId: 'prop-a'}}}]},
    {id: 'held', property: 'entity.heldEntityId', values: [{keyId: 'key', value: {kind: 'text', value: 'prop-a'}}]}
  ]}]}, 101);
  const removed = world.removeEntity(next, 'prop-a', 102), setup = removed.scenePlay.worldSpace.setups[1];
  assert.deepEqual(setup.entityStates.find(item => item.entityId === 'camera-a').camera.focus, {mode: 'none'});
  assert.deepEqual(setup.entityStates.find(item => item.entityId === 'camera-a').camera.lookAt, {mode: 'none'});
  assert.deepEqual(setup.temporal.tracks[0].channels.map(channel => channel.values[0].value.value), [{kind: 'none'}, null]);
});
test('independent removal retains definition in other setups or views; final removal deletes it', async () => {
  const {schema, world, state} = await fixture();
  let next = world.addSetup(state, schema.createIndependentSetup({id: 'setup-b', now: 100}));
  next = world.addEntityState(next, 'setup-b', schema.createSetupState('actor-a', 100));
  next = world.removeEntityFromSetup(next, 'actor-a', 'setup:state-1', 101);
  assert.equal(next.scenePlay.worldSpace.entities.some(item => item.id === 'actor-a'), true);
  next = world.removeEntityFromSetup(next, 'actor-a', 'setup-b', 102);
  assert.equal(next.scenePlay.worldSpace.entities.some(item => item.id === 'actor-a'), false);
  let withView = world.addView(state, schema.createView({id: 'view', label: 'Shot', sourceCameraEntityId: 'camera-a', camera: camera(), now: 100}));
  withView = world.removeEntityFromSetup(withView, 'camera-a', 'setup:state-1', 101);
  assert.equal(withView.scenePlay.worldSpace.entities.some(item => item.id === 'camera-a'), true);
});
test('remove from baseline is global and remove view cleans its dependent output and targets', async () => {
  const {schema, world, state} = await fixture();
  let next = world.addEntity(state, schema.createEntity({id: 'shared', label: 'Shared', kind: 'prop', now: 100}), {setupId: 'setup-default'});
  next = world.removeEntityFromSetup(next, 'shared', 'setup-default', 101);
  assert.equal(next.scenePlay.worldSpace.entities.some(item => item.id === 'shared'), false);
  next = world.addView(next, schema.createView({id: 'view', label: 'Shot', camera: camera(), now: 101}), {activate: true});
  next = world.addReference(next, {id: 'ref', targets: [{kind: 'view', id: 'view'}]});
  next = world.addOutput(next, {id: 'output', source: {kind: 'view', id: 'view'}});
  const removed = world.removeView(next, 'view'); assert.equal(removed.scenePlay.worldSpace.activeViewId, null);
  assert.deepEqual(removed.scenePlay.worldSpace.outputs, []); assert.deepEqual(removed.scenePlay.worldSpace.references[0].targets, []);
});
