const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const modules = Promise.all([import('../src/features/studio-v3/entity-actions.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/history.mjs')]);
async function fixture() {
  const [actions, schema, world, history] = await modules;
  return {actions, schema, world, history, state: schema.createState({worldNodeId: 'entity-action-owner', now: 100})};
}
const reduce = (f, state, action, now = 101) => f.actions.reduceEntityAction(state, action, {now});
const createActor = (f, state = f.state, extra = {}) => reduce(f, state, {type: 'create', kind: 'actor', id: 'actor-a', roleId: 'role-a', ...extra});
const space = state => state.scenePlay.worldSpace;
const control = (f, state, entityId, setupId) => f.actions.resolveEntityControl(state, {entityId, setupId});
const domain = (fn, code) => assert.throws(fn, error => error.name === 'StudioDomainError' && (!code || error.code === code));

test('actor creation produces distinct role/instance, actual builtin asset and independent pose state without mutating input', async () => {
  const f = await fixture(), before = structuredClone(f.state), result = createActor(f, f.state, {label: '林岚', actorGender: 'female', color: '#aa9988', transform: {position: {x: 2}}});
  assert.equal(result.ok, true);assert.equal(result.lane, 'world');assert.equal(result.roleId, 'role-a');assert.deepEqual(result.scope, {kind: 'world-space'});
  const w = space(result.state), actor = w.entities[0], role = w.characterRoles[0], instance = w.setups[1].entityStates[0];
  assert.notEqual(actor.id, role.id);assert.equal(actor.roleId, role.id);assert.equal(actor.asset.sourceUrl, '/assets/studio/character.glb');assert.equal(role.actorGender, 'female');assert.equal(actor.label, '林岚');assert.equal(instance.pose, 'Standing');assert.deepEqual(instance.transform.position, {x: 2, y: 0, z: 0});assert.equal(w.setups[0].entityStates.length, 0);
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', actor.asset.sourceUrl.slice(1))));assert.equal(Object.hasOwn(result.state, 'objects'), false);assert.deepEqual(f.state, before);assert.equal(f.schema.assertState(result.state), result.state);
});
test('additional actor instance reuses same-stage role and rejects duplicate/new-role collisions atomically', async () => {
  const f = await fixture(), first = createActor(f).state, second = reduce(f, first, {type: 'create', kind: 'actor', id: 'actor-b', existingRoleId: 'role-a'}).state;
  assert.equal(space(second).characterRoles.length, 1);assert.deepEqual(space(second).entities.map(item => item.roleId), ['role-a', 'role-a']);
  const snapshot = structuredClone(first);
  for (const change of [{id: 'actor-a', roleId: 'role-b'}, {id: 'actor-b', roleId: 'role-a'}, {id: 'actor-b', roleId: 'actor-b'}, {id: 'actor-b', existingRoleId: 'role-a', color: '#ffffff'}, {id: 'actor-b', existingRoleId: 'unknown'}]) domain(() => reduce(f, first, {type: 'create', kind: 'actor', ...change}));
  assert.deepEqual(first, snapshot);
});
test('camera creation writes real camera GLB and schema optics with transform and camera pose synchronized', async () => {
  const f = await fixture(), result = reduce(f, f.state, {type: 'create', kind: 'camera', id: 'camera-a', transform: {position: {x: 3, z: 5}}, camera: {fov: 42, focalLength: 50}}), camera = control(f, result.state, 'camera-a');
  const {focalLengthToFov} = await import('../src/features/studio-v3/camera-optics.mjs');
  assert.equal(camera.definition.asset.sourceUrl, '/assets/studio/camera.glb');assert.equal(camera.definition.asset.presentationAnchor, 'center');assert.deepEqual(camera.setupState.camera.position, camera.setupState.transform.position);assert.equal(camera.setupState.camera.fov, focalLengthToFov(50, 16 / 9));assert.equal(camera.setupState.camera.focalLength, 50);assert.equal(camera.setupState.camera.frameAspectRatio, 16 / 9);assert.equal(camera.setupState.camera.apertureFNumber, 11);
});
test('local sample prop uses exact studioLibrary model URL, bottom anchor and original scale, rejecting arbitrary asset substitutes', async () => {
  const f = await fixture(), result = reduce(f, f.state, {type: 'create', kind: 'prop', id: 'chair-a', assetId: 'chair-office'}), prop = control(f, result.state, 'chair-a');
  assert.deepEqual(prop.definition.asset, {sourceUrl: '/assets/studio/library/chair-office.glb', sourceFormat: 'glb', presentationAnchor: 'bottom'});assert.deepEqual(prop.setupState.transform.scale, {x: 1.05, y: 1.05, z: 1.05});assert.match(prop.definition.label, /室内.*chair-office/);
  for (const change of [{assetId: '../character'}, {assetId: 'https://evil.test/a.glb'}, {sourceUrl: '/assets/studio/character.glb'}, {assetId: 'chair-office', objects: []}]) domain(() => reduce(f, f.state, {type: 'create', kind: 'prop', id: 'bad-prop', ...change}));
});
test('local update preserves untouched xyz, state fields use setup lane and definition rename/color/lock use world lane', async () => {
  const f = await fixture(), state = createActor(f).state, updated = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {transform: {position: {x: 4}, rotation: {y: .5}, scale: {y: 1.2}}, pose: 'Sitting', visible: false}}, 102);
  assert.equal(updated.lane, 'setup:setup:state-1');assert.equal(control(f, updated.state, 'actor-a').setupState.pose, 'Sitting');assert.deepEqual(control(f, updated.state, 'actor-a').setupState.transform.position, {x: 4, y: 0, z: 0});assert.equal(control(f, updated.state, 'actor-a').setupState.visible, false);
  const renamed = reduce(f, updated.state, {type: 'update', entityId: 'actor-a', patch: {label: '新名字', color: '#abcdef', locked: true}}, 103);
  assert.equal(renamed.lane, 'world');assert.equal(control(f, renamed.state, 'actor-a').definition.label, '新名字');assert.equal(control(f, renamed.state, 'actor-a').definition.color, '#abcdef');assert.equal(control(f, renamed.state, 'actor-a').locked, true);assert.equal(space(renamed.state).characterRoles[0].label, space(state).characterRoles[0].label, 'instance rename must not rewrite shared role');
});
test('baseline priority returns read-only local control and denies edits atomically while definition world edits remain available', async () => {
  const f = await fixture(), state = createActor(f, f.state, {setupId: 'setup-default'}).state, shared = control(f, state, 'actor-a');
  assert.equal(shared.baselineReadOnly, true);assert.equal(shared.ownerSetupId, 'setup-default');assert.equal(shared.stateLane, 'world');assert.equal(shared.definitionLane, 'world');
  for (const patch of [{transform: {position: {x: 9}}}, {pose: 'Walking'}, {visible: false}, {label: '不能部分重命名', transform: {position: {x: 4}}}]) {
    const result = reduce(f, state, {type: 'update', entityId: 'actor-a', patch});assert.equal(result.ok, false);assert.equal(result.reason, 'baseline-readonly');assert.equal(result.state, state);assert.equal(result.suggestedSetupId, 'setup-default');assert.match(result.message, /切换.*基准/);
  }
  const rename = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {label: '基准人物', color: '#aabbcc'}});assert.equal(rename.ok, true);assert.equal(rename.lane, 'world');assert.equal(space(rename.state).setups[1].entityStates.length, 0);
  const edit = reduce(f, rename.state, {type: 'update', setupId: 'setup-default', entityId: 'actor-a', patch: {visible: false}}, 102);assert.equal(edit.ok, true);assert.equal(edit.lane, 'world');assert.equal(control(f, edit.state, 'actor-a').setupState.visible, false);
});
test('returned controls are detached and definitions in a different setup cannot invent a local override', async () => {
  const f = await fixture(), state = createActor(f).state, read = control(f, state, 'actor-a');read.definition.label = 'mutation';read.setupState.transform.position.x = 20;assert.notEqual(control(f, state, 'actor-a').definition.label, 'mutation');assert.equal(control(f, state, 'actor-a').setupState.transform.position.x, 0);
  const withSetup = f.world.addSetup(state, f.schema.createIndependentSetup({id: 'setup-b', now: 101})), denied = reduce(f, withSetup, {type: 'update', setupId: 'setup-b', entityId: 'actor-a', patch: {visible: false}});
  assert.equal(denied.reason, 'entity-not-in-setup');assert.equal(denied.state, withSetup);assert.equal(space(withSetup).setups.at(-1).entityStates.length, 0);
});
test('locked entity motion remains unchanged until explicit world unlock; visibility remains a setup action', async () => {
  const f = await fixture(), state = createActor(f, f.state, {locked: true}).state;
  const denied = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {transform: {position: {x: 8}}, locked: false}});assert.equal(denied.reason, 'entity-locked');assert.equal(denied.state, state);
  const hidden = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {visible: false}});assert.equal(hidden.ok, true);assert.equal(hidden.lane, 'setup:setup:state-1');
  const unlocked = reduce(f, hidden.state, {type: 'update', entityId: 'actor-a', patch: {locked: false}}, 102);const moved = reduce(f, unlocked.state, {type: 'update', entityId: 'actor-a', patch: {transform: {position: {x: 8}}}}, 103);assert.equal(moved.ok, true);assert.equal(control(f, moved.state, 'actor-a').setupState.transform.position.x, 8);
});
test('camera pose updates work in both directions and conflicting camera/transform requests are rejected', async () => {
  const f = await fixture(), state = reduce(f, f.state, {type: 'create', kind: 'camera', id: 'camera-a'}).state;
  const icon = reduce(f, state, {type: 'update', entityId: 'camera-a', patch: {transform: {position: {x: 3}, rotation: {y: .8}}}}, 102), a = control(f, icon.state, 'camera-a').setupState;
  assert.deepEqual(a.camera.position, a.transform.position);assert.deepEqual(a.camera.rotation, a.transform.rotation);
  const optic = reduce(f, icon.state, {type: 'update', entityId: 'camera-a', patch: {camera: {position: {z: 4}, rotation: {x: .2}, fov: 35}}}, 103), b = control(f, optic.state, 'camera-a').setupState;assert.deepEqual(b.camera.position, {x: 3, y: 0, z: 4});assert.deepEqual(b.camera.position, b.transform.position);assert.deepEqual(b.camera.rotation, b.transform.rotation);assert.equal(b.camera.fov, 35);
  domain(() => reduce(f, state, {type: 'update', entityId: 'camera-a', patch: {transform: {position: {x: 3}}, camera: {position: {x: 8}}}}));
});
test('local remove preserves entity in another setup; final local removal reports actual world cascade', async () => {
  const f = await fixture(), first = createActor(f).state, second = f.world.addSetup(first, f.schema.createIndependentSetup({id: 'setup-b', now: 101})), state = f.world.addEntityState(second, 'setup-b', f.schema.createSetupState('actor-a', 101));
  const local = reduce(f, state, {type: 'remove', entityId: 'actor-a', mode: 'local'}, 102);assert.equal(local.removal, 'local');assert.equal(local.lane, 'setup:setup:state-1');assert.equal(space(local.state).entities.length, 1);assert.equal(space(local.state).setups[1].entityStates.length, 0);assert.equal(space(local.state).setups[2].entityStates.length, 1);
  const final = reduce(f, local.state, {type: 'remove', entityId: 'actor-a', setupId: 'setup-b', mode: 'local'}, 103);assert.equal(final.removal, 'global');assert.equal(final.lane, 'world');assert.equal(space(final.state).entities.length, 0);assert.equal(space(final.state).characterRoles.length, 1, 'role persists independently after last instance removal');
});
test('global camera removal clears source view/output/reference targets, held/look relationships and owner tracks', async () => {
  const f = await fixture();let state = createActor(f).state;state = reduce(f, state, {type: 'create', kind: 'camera', id: 'camera-a'}, 102).state;
  state = f.world.patchEntityState(state, 'setup:state-1', 'actor-a', {lookTarget: {kind: 'entity', entityId: 'camera-a'}, heldEntityId: 'camera-a'}, 103);
  const camera = control(f, state, 'camera-a').setupState.camera;state = f.world.addView(state, f.schema.createView({id: 'view-a', label: '镜头', sourceCameraEntityId: 'camera-a', camera, now: 103}));state = f.world.addOutput(state, {id: 'output-a', source: {kind: 'view', id: 'view-a'}});state = f.world.addReference(state, {id: 'ref-a', targets: [{kind: 'entity', id: 'camera-a'}, {kind: 'view', id: 'view-a'}]});state = f.world.setTemporal(state, 'setup:state-1', {durationMs: 10, tracks: [{id: 'camera-track', owner: {kind: 'entity', entityId: 'camera-a'}, keys: [], channels: []}]}, 103);
  const removed = reduce(f, state, {type: 'remove', entityId: 'camera-a', mode: 'global'}, 104), w = space(removed.state), actor = control(f, removed.state, 'actor-a').setupState;
  assert.equal(removed.lane, 'world');assert.deepEqual(w.views, []);assert.deepEqual(w.outputs, []);assert.deepEqual(w.references[0].targets, []);assert.deepEqual(w.setups[1].temporal.tracks, []);assert.deepEqual(actor.lookTarget, {kind: 'none'});assert.equal(Object.hasOwn(actor, 'heldEntityId'), false);assert.equal(w.activeViewId, null);assert.equal(space(state).entities.length, 2);
});
test('inherited baseline local removal routes owning baseline to global cascade without writing independent override', async () => {
  const f = await fixture(), state = createActor(f, f.state, {setupId: 'setup-default'}).state, inherited = reduce(f, state, {type: 'remove', entityId: 'actor-a', mode: 'local'});assert.equal(inherited.ok, true);assert.equal(inherited.removal, 'global');assert.equal(inherited.lane, 'world');assert.equal(space(inherited.state).entities.length, 0);
  const removed = reduce(f, state, {type: 'remove', entityId: 'actor-a', mode: 'global'});assert.equal(removed.lane, 'world');assert.equal(space(removed.state).entities.length, 0);assert.equal(space(removed.state).setups[1].entityStates.length, 0);
});
test('clone has unique instance ID and copied pose/asset, retains role, and never duplicates old tracks', async () => {
  const f = await fixture();let state = createActor(f).state;state = f.world.setTemporal(state, 'setup:state-1', {durationMs: 10, tracks: [{id: 'actor-track', owner: {kind: 'entity', entityId: 'actor-a'}, keys: [], channels: []}]}, 102);
  const cloned = reduce(f, state, {type: 'clone', entityId: 'actor-a', newId: 'actor-copy', transform: {position: {x: 1.5}}}, 103), copy = control(f, cloned.state, 'actor-copy');assert.equal(cloned.lane, 'world');assert.equal(copy.definition.roleId, 'role-a');assert.equal(space(cloned.state).characterRoles.length, 1);assert.equal(copy.setupState.pose, 'Standing');assert.equal(copy.setupState.transform.position.x, 1.5);assert.equal(copy.definition.createdAt, 103);assert.deepEqual(space(cloned.state).setups[1].temporal.tracks.map(item => item.owner.entityId), ['actor-a']);
  domain(() => reduce(f, cloned.state, {type: 'clone', entityId: 'actor-a', newId: 'actor-copy'}), 'duplicate-id');assert.equal(space(state).entities.length, 1);
});
test('clone of baseline creates distinct independent instance while leaving shared state unchanged', async () => {
  const f = await fixture(), state = createActor(f, f.state, {setupId: 'setup-default'}).state, result = reduce(f, state, {type: 'clone', entityId: 'actor-a', newId: 'local-copy'}), w = space(result.state);
  assert.equal(w.setups[0].entityStates[0].entityId, 'actor-a');assert.equal(w.setups[1].entityStates[0].entityId, 'local-copy');assert.equal(control(f, result.state, 'local-copy').baselineReadOnly, false);assert.deepEqual(w.setups[0], space(state).setups[0]);
});
test('invalid actions, unsupported legacy fields, zero scales, nonfinite poses and cross-stage operations leave input intact', async () => {
  const f = await fixture(), initial = createActor(f).state, state = f.world.addStage(initial, f.schema.createStage({id: 'stage-b', worldNodeId: 'entity-action-owner', now: 101})), before = structuredClone(state);
  for (const action of [{type: 'edit', entityId: 'actor-a'}, {type: 'update', entityId: 'actor-a', patch: {name: 'v2'}}, {type: 'update', entityId: 'actor-a', patch: {transform: {scale: {x: 0}}}}, {type: 'update', entityId: 'actor-a', patch: {transform: {position: {x: Infinity}}}}, {type: 'update', entityId: 'actor-a', setupId: 'setup:stage-b:state-1', patch: {visible: false}}, {type: 'remove', entityId: 'actor-a'}, {type: 'clone', entityId: 'actor-a'}, {type: 'create', kind: 'camera', id: 'bad-camera', pose: 'Standing'}, {type: 'create', kind: 'actor', id: 'wrong-stage', existingRoleId: 'role-a', setupId: 'setup:stage-b:state-1'}]) domain(() => reduce(f, state, action));
  assert.deepEqual(state, before);
});
test('no-op update preserves state identity and returned lanes work with independent history and world cascade undo', async () => {
  const f = await fixture(), state = createActor(f).state, noop = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {pose: 'Standing', visible: true}});assert.equal(noop.state, state);assert.equal(noop.changed, false);
  let sequence = 0;const history = f.history.createHistory(state, {now: () => 105, createId: () => 'entity-history-' + ++sequence});
  const moved = reduce(f, state, {type: 'update', entityId: 'actor-a', patch: {transform: {position: {x: 3}}}}, 102);history.transact(moved.lane, 'move entity', () => moved.state, moved.scope);
  assert.equal(history.undo(moved.lane).ok, true);assert.equal(control(f, history.getState(), 'actor-a').setupState.transform.position.x, 0);assert.equal(history.redo(moved.lane).ok, true);
  const removed = reduce(f, history.getState(), {type: 'remove', entityId: 'actor-a', mode: 'global'}, 103);history.transact(removed.lane, 'delete entity', () => removed.state, removed.scope);assert.equal(space(history.getState()).entities.length, 0);assert.equal(history.undo('world').ok, true);assert.equal(control(f, history.getState(), 'actor-a').setupState.transform.position.x, 3);
});
test('camera optics-only edit preserves existing authoritative optical pose and partial optical pose merges that same camera', async () => {
  const f = await fixture();let state = reduce(f, f.state, {type: 'create', kind: 'camera', id: 'camera-a'}).state;
  const original = control(f, state, 'camera-a').setupState.camera;state = f.world.patchEntityState(state, 'setup:state-1', 'camera-a', {camera: {...original, position: {x: 9, y: 2, z: 4}}}, 102);
  const updated = reduce(f, state, {type: 'update', entityId: 'camera-a', patch: {camera: {fov: 65}}}, 103), local = control(f, updated.state, 'camera-a').setupState;assert.deepEqual(local.camera.position, {x: 9, y: 2, z: 4});assert.deepEqual(local.transform.position, local.camera.position);
  const opticalMoved = reduce(f, updated.state, {type: 'update', entityId: 'camera-a', patch: {camera: {position: {z: 6}}}}, 104), moved = control(f, opticalMoved.state, 'camera-a').setupState;assert.deepEqual(moved.camera.position, {x: 9, y: 2, z: 6});assert.deepEqual(moved.camera.position, moved.transform.position);
});
test('existing-role creation and clone refuse a role ID as the instance ID', async () => {
  const f = await fixture(), state = createActor(f).state;
  domain(() => reduce(f, state, {type: 'create', kind: 'actor', id: 'role-a', existingRoleId: 'role-a'}));domain(() => reduce(f, state, {type: 'clone', entityId: 'actor-a', newId: 'role-a'}));assert.equal(space(state).entities.length, 1);
});
