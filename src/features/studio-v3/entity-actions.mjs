import {studioLibrary} from '../../../studio-library-data.mjs';
import {assertJson, clone, defined, isRecord, requireDomain, same} from './invariants.mjs';
import {assertState, baselineId, createActorFromRole, createEntity, createRole, createSetupState} from './schema.mjs';
import {addEntity, addRole, patchEntity, patchEntityState, removeEntity, removeEntityFromSetup} from './world-space.mjs';
import {setupLane} from './history.mjs';

const definitionFields = ['label', 'color', 'locked', 'materialMode'];
const stateFields = ['transform', 'visible', 'pose', 'camera', 'lookTarget', 'heldEntityId', 'path'];
const builtin = {actor: '/assets/studio/character.glb', camera: '/assets/studio/camera.glb'};
function fields(value, allowed, path) {
  requireDomain(isRecord(value), path, 'must be a plain object');
  for (const key of Object.keys(value)) requireDomain(allowed.includes(key), `${path}.${key}`, 'unsupported field');
}
function text(value, path) {requireDomain(typeof value === 'string' && value.trim().length > 0, path, 'must be nonempty text');}
function setupOf(state, setupId) {
  assertState(state);const space = state.scenePlay.worldSpace, setup = space.setups.find(item => item.id === (setupId ?? space.activeSetupId));
  requireDomain(!!setup, 'entityAction.setupId', 'setup does not exist', 'missing-relation');return {space, setup};
}
function uniqueId(space, id, collection = 'entities') {
  text(id, 'entityAction.id');requireDomain(!space[collection].some(item => item.id === id), 'entityAction.id', 'ID already exists', 'duplicate-id');
}

/** Baseline state wins over an independent setup. Definition edits are world
 * edits even while that shared state is read-only in the independent setup. */
export function resolveEntityControl(state, {entityId, setupId} = {}) {
  const {space, setup} = setupOf(state, setupId), definition = space.entities.find(item => item.id === entityId);
  requireDomain(!!definition, 'entityAction.entityId', 'entity does not exist', 'missing-relation');
  requireDomain(definition.stageId === setup.stageId, 'entityAction.entityId', 'entity belongs to another stage', 'cross-stage');
  const baseline = space.setups.find(item => item.id === baselineId(setup.stageId));
  const shared = baseline.entityStates.find(item => item.entityId === entityId), local = setup.entityStates.find(item => item.entityId === entityId), ownerSetupId = shared ? baseline.id : local ? setup.id : null;
  return {definition: clone(definition), setupState: shared || local ? clone(shared || local) : null, setupId: setup.id, ownerSetupId,
    baselineReadOnly: !!shared && setup.id !== baseline.id, locked: definition.locked === true,
    definitionLane: 'world', stateLane: ownerSetupId === baseline.id ? 'world' : setupLane(setup.id)};
}
function result(previous, state, lane, extra = {}) {
  return {ok: true, state, lane, scope: {kind: 'world-space'}, changed: state !== previous, ...extra};
}
function unavailable(state, control, reason = 'baseline-readonly') {
  return {ok: false, state, changed: false, reason, lane: control.stateLane, suggestedLane: control.stateLane,
    suggestedSetupId: reason === 'baseline-readonly' ? control.ownerSetupId : control.setupId,
    message: reason === 'baseline-readonly' ? '此实体属于场景基准，请切换到场景基准后编辑。' : '此实体在当前状态中没有实例，请先切换到包含它的状态。'};
}
function mergeTransform(previous, patch) {
  fields(patch, ['position', 'rotation', 'scale'], 'entityAction.transform');
  const next = clone(previous);
  for (const [field, value] of Object.entries(patch)) {
    fields(value, field === 'rotation' ? ['x', 'y', 'z', 'order'] : ['x', 'y', 'z'], `entityAction.transform.${field}`);
    next[field] = {...next[field], ...clone(value)};
  }
  return next;
}
function statePatch(previous, patch, kind) {
  const next = clone(patch);
  requireDomain(next.pose === undefined || kind === 'actor', 'entityAction.pose', 'only actor instances have pose');
  requireDomain(next.camera === undefined || kind === 'camera', 'entityAction.camera', 'only camera instances have camera state');
  if (next.transform) next.transform = mergeTransform(previous.transform, next.transform);
  if (kind === 'camera' && (next.camera || next.transform)) {
    fields(next.camera || {}, ['position', 'rotation', 'fov', 'frameAspectRatio', 'focalLength', 'apertureFNumber', 'depthOfFieldMode', 'focusDistance', 'focus', 'lookAt'], 'entityAction.camera');
    const camera = {...clone(previous.camera || {position: previous.transform.position, rotation: previous.transform.rotation, fov: 50}), ...next.camera};
    const transform = next.transform || clone(previous.transform);
    // The renderer uses camera pose first. Keep the entity icon and optical
    // camera in agreement; contradictory dual inputs must not silently win.
    for (const field of ['position', 'rotation']) {
      if (patch.camera?.[field]) {
        fields(patch.camera[field], field === 'rotation' ? ['x', 'y', 'z', 'order'] : ['x', 'y', 'z'], `entityAction.camera.${field}`);
        camera[field] = {...clone(previous.camera?.[field] || previous.transform[field]), ...clone(patch.camera[field])};
        if (patch.transform?.[field]) requireDomain(same(transform[field], camera[field]), `entityAction.camera.${field}`, 'camera and transform pose disagree');
        transform[field] = clone(camera[field]);
      } else if (patch.transform?.[field]) camera[field] = clone(transform[field]);
    }
    next.camera = camera;next.transform = transform;
  }
  return next;
}
function libraryAsset(assetId) {
  text(assetId, 'entityAction.assetId');
  const group = studioLibrary.find(item => item.assets.some(asset => asset.id === assetId)), asset = group?.assets.find(item => item.id === assetId);
  requireDomain(!!asset && typeof asset.scale === 'number' && asset.scale > 0 && /^assets\/studio\/library\/[a-z0-9-]+\.glb$/.test(asset.model), 'entityAction.assetId', 'local sample asset does not exist', 'missing-relation');
  return {asset: {sourceUrl: '/' + asset.model, sourceFormat: 'glb', presentationAnchor: 'bottom'}, scale: asset.scale, label: group.label};
}
function create(state, action, now) {
  fields(action, ['type', 'kind', 'id', 'roleId', 'existingRoleId', 'setupId', 'label', 'actorGender', 'color', 'assetId', 'transform', 'visible', 'pose', 'camera', 'locked'], 'entityAction');
  const {space, setup} = setupOf(state, action.setupId);uniqueId(space, action.id);
  requireDomain(['actor', 'camera', 'prop'].includes(action.kind), 'entityAction.kind', 'unknown V3 entity kind');
  requireDomain(action.kind === 'actor' || ['roleId', 'existingRoleId', 'actorGender', 'pose'].every(key => !Object.hasOwn(action, key)), 'entityAction', 'role and pose fields require actor');
  requireDomain(action.kind === 'camera' || !Object.hasOwn(action, 'camera'), 'entityAction.camera', 'camera fields require camera');
  requireDomain(action.kind === 'prop' || !Object.hasOwn(action, 'assetId'), 'entityAction.assetId', 'sample asset ID requires prop');
  let next = state, entity, roleId, scale = 1;
  const label = action.label ?? `${{actor: '角色', camera: '摄像机', prop: '道具'}[action.kind]} ${space.entities.filter(item => item.stageId === setup.stageId && item.kind === action.kind).length + 1}`;
  if (action.kind === 'actor') {
    if (action.existingRoleId !== undefined) {
      requireDomain(action.roleId === undefined && action.actorGender === undefined && action.color === undefined, 'entityAction.role', 'existing role owns actor appearance');
      const role = space.characterRoles.find(item => item.id === action.existingRoleId);requireDomain(!!role, 'entityAction.existingRoleId', 'role does not exist', 'missing-relation');
      requireDomain(role.stageId === setup.stageId, 'entityAction.existingRoleId', 'role belongs to another stage', 'cross-stage');requireDomain(action.id !== role.id, 'entityAction.id', 'role and instance must have different IDs');roleId = role.id;entity = createActorFromRole({id: action.id, role, label: action.label ?? role.label, now});
    } else {
      uniqueId(space, action.roleId, 'characterRoles');requireDomain(action.roleId !== action.id, 'entityAction.roleId', 'role and instance must have different IDs');
      const role = createRole({id: action.roleId, stageId: setup.stageId, label, actorGender: action.actorGender ?? 'neutral', color: action.color ?? '#d0a552', asset: {sourceUrl: builtin.actor, sourceFormat: 'glb', presentationAnchor: 'bottom'}, now});
      next = addRole(next, role);roleId = role.id;entity = createActorFromRole({id: action.id, role, now});
    }
  } else {
    const sample = action.kind === 'prop' ? libraryAsset(action.assetId) : {asset: {sourceUrl: builtin.camera, sourceFormat: 'glb', presentationAnchor: 'center'}, scale: 1};scale = sample.scale;
    entity = createEntity({id: action.id, stageId: setup.stageId, kind: action.kind, label: action.label ?? (sample.label ? `${sample.label} · ${action.assetId}` : label), asset: sample.asset, color: action.color, now});
  }
  if (action.locked !== undefined) {requireDomain(typeof action.locked === 'boolean', 'entityAction.locked', 'must be boolean');entity.locked = action.locked;}
  let local = createSetupState(entity.id, now);local.transform.scale = {x: scale, y: scale, z: scale};
  if (action.kind === 'actor') local.pose = action.pose ?? 'Standing';
  if (action.kind === 'camera') local.camera = {position: clone(local.transform.position), rotation: clone(local.transform.rotation), fov: 50, focalLength: 35, frameAspectRatio: 16 / 9, apertureFNumber: 2.8, depthOfFieldMode: 'aperture', focusDistance: 5};
  local = {...local, ...statePatch(local, defined({transform: action.transform, visible: action.visible, pose: action.pose, camera: action.camera}), entity.kind)};
  next = addEntity(next, entity, {setupId: setup.id, setupState: local});return result(state, next, 'world', defined({entityId: entity.id, roleId}));
}

/** Pure action reducer. IDs come from the host, never from hidden randomness.
 * The caller must use returned lane/scope for its history transaction and must
 * enforce runtime ownership, playback and persistence guards separately. */
export function reduceEntityAction(state, action, {now = Date.now()} = {}) {
  assertState(state);assertJson(action, 'entityAction');fields(action, ['type', 'kind', 'id', 'roleId', 'existingRoleId', 'setupId', 'label', 'actorGender', 'color', 'assetId', 'transform', 'visible', 'pose', 'camera', 'locked', 'entityId', 'patch', 'mode', 'newId'], 'entityAction');
  requireDomain(Number.isFinite(now) && now >= 0, 'entityAction.now', 'must be a nonnegative timestamp');
  if (action.type === 'create') return create(state, action, now);
  requireDomain(['update', 'remove', 'clone'].includes(action.type), 'entityAction.type', 'unknown entity action');
  fields(action, action.type === 'update' ? ['type', 'entityId', 'setupId', 'patch'] : action.type === 'remove' ? ['type', 'entityId', 'setupId', 'mode'] : ['type', 'entityId', 'setupId', 'newId', 'label', 'transform'], 'entityAction');
  const control = resolveEntityControl(state, action), {space, setup} = setupOf(state, control.setupId), entity = control.definition;
  if (action.type === 'update') {
    fields(action.patch, [...definitionFields, ...stateFields], 'entityAction.patch');
    const definition = Object.fromEntries(Object.entries(action.patch).filter(([key]) => definitionFields.includes(key))), local = Object.fromEntries(Object.entries(action.patch).filter(([key]) => stateFields.includes(key)));
    if (Object.keys(local).length && (control.baselineReadOnly || !control.setupState)) return unavailable(state, control, control.baselineReadOnly ? 'baseline-readonly' : 'entity-not-in-setup');
    if (control.locked && ['transform', 'pose', 'camera', 'path', 'lookTarget', 'heldEntityId'].some(key => Object.hasOwn(local, key))) return {ok: false, state, changed: false, reason: 'entity-locked', lane: 'world', suggestedLane: 'world', message: '实体已锁定，请先解锁后编辑。'};
    let next = state;
    if (Object.keys(definition).length) next = patchEntity(next, entity.id, definition, now);
    if (Object.keys(local).length) next = patchEntityState(next, control.ownerSetupId, entity.id, statePatch(control.setupState, local, entity.kind), now);
    return result(state, next, Object.keys(definition).length ? 'world' : control.stateLane, {entityId: entity.id});
  }
  if (action.type === 'remove') {
    requireDomain(['local', 'global'].includes(action.mode), 'entityAction.mode', 'explicit local or global removal is required');
    if (action.mode === 'local' && (control.baselineReadOnly || !control.setupState)) return unavailable(state, control, control.baselineReadOnly ? 'baseline-readonly' : 'entity-not-in-setup');
    const next = action.mode === 'global' ? removeEntity(state, entity.id, now) : removeEntityFromSetup(state, entity.id, setup.id, now);
    const global = action.mode === 'global' || !next.scenePlay.worldSpace.entities.some(item => item.id === entity.id);
    return result(state, next, global ? 'world' : control.stateLane, {entityId: entity.id, removal: global ? 'global' : 'local'});
  }
  if (!control.setupState) return unavailable(state, control, 'entity-not-in-setup');
  uniqueId(space, action.newId);requireDomain(action.newId !== entity.roleId, 'entityAction.newId', 'role and instance must have different IDs');const definition = {...clone(entity), id: action.newId, label: action.label ?? `${entity.label} 副本`, createdAt: now, updatedAt: now};
  let local = {...clone(control.setupState), entityId: action.newId, updatedAt: now};
  if (action.transform !== undefined) local = {...local, ...statePatch(local, {transform: action.transform}, entity.kind)};
  // Cloning copies the instance pose only. Role identity and external targets
  // stay shared; old temporal track/key IDs are not silently duplicated.
  const next = addEntity(state, definition, {setupId: setup.id, setupState: local});return result(state, next, 'world', defined({entityId: action.newId, roleId: entity.roleId}));
}
