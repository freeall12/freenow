import {clone, requireDomain} from './invariants.mjs';
import {assertState, createIndependentSetup} from './schema.mjs';
import {removeEntity} from './world-space.mjs';

export function cloneIndependentSetup(state, setupId, {createId, label, activate = true, now = Date.now()} = {}) {
  assertState(state);
  const space = state.scenePlay.worldSpace, source = space.setups.find(item => item.id === setupId);
  requireDomain(source?.kind === 'independent', 'setup.clone', 'only an independent state can be cloned');
  requireDomain(typeof createId === 'function', 'setup.clone.createId', 'host ID factory is required');
  requireDomain(Number.isFinite(now) && now >= 0, 'setup.clone.now', 'invalid timestamp');
  const used = new Set([...space.entities, ...space.characterRoles, ...space.setups, ...space.views].map(item => item.id));
  const fresh = (kind, oldId) => {
    const id = createId(kind, oldId);
    requireDomain(typeof id === 'string' && id.trim() && !used.has(id), 'setup.clone.id', 'ID factory must return unique nonempty IDs');
    used.add(id); return id;
  };
  const id = fresh('setup', source.id), baseline = space.setups.find(item => item.stageId === source.stageId && item.kind === 'scene-baseline');
  const shared = new Set(baseline.entityStates.map(item => item.entityId));
  const candidates = new Set([...source.entityStates.map(item => item.entityId), ...(source.temporal?.tracks || []).map(item => item.owner.entityId)]);
  const entities = space.entities.filter(item => candidates.has(item.id) && !shared.has(item.id));
  const entityIds = new Map(entities.map(item => [item.id, fresh('entity', item.id)]));
  const roles = space.characterRoles.filter(item => entities.some(entity => entity.roleId === item.id));
  const roleIds = new Map(roles.map(item => [item.id, fresh('role', item.id)]));
  const target = value => value && typeof value === 'object' ? {...clone(value), ...(entityIds.has(value.entityId) ? {entityId: entityIds.get(value.entityId)} : {})} : value;
  const camera = value => value ? {...clone(value), ...(value.focus ? {focus: target(value.focus)} : {}), ...(value.lookAt ? {lookAt: target(value.lookAt)} : {})} : value;
  const instance = value => ({...clone(value), entityId: entityIds.get(value.entityId), updatedAt: now,
    ...(value.lookTarget ? {lookTarget: target(value.lookTarget)} : {}),
    ...(value.heldEntityId ? {heldEntityId: entityIds.get(value.heldEntityId) || value.heldEntityId} : {}),
    ...(value.camera ? {camera: camera(value.camera)} : {})});
  const setup = {...clone(source), id, label: label ?? `${source.label} 副本`, createdAt: now, updatedAt: now,
    entityStates: source.entityStates.filter(item => entityIds.has(item.entityId)).map(instance)};
  if (source.temporal) setup.temporal.tracks = source.temporal.tracks.filter(track => entityIds.has(track.owner.entityId)).map(track => ({...clone(track),
    owner: {...track.owner, entityId: entityIds.get(track.owner.entityId)}, channels: track.channels.map(channel => ({...clone(channel), values: channel.values.map(sample => ({...clone(sample), value: {
      ...clone(sample.value), value: ['look-target', 'camera-focus', 'camera-look-at'].includes(sample.value.kind) ? target(sample.value.value) :
        channel.property === 'entity.heldEntityId' ? entityIds.get(sample.value.value) || sample.value.value : clone(sample.value.value)
    }}))}))}));
  const views = space.views.filter(view => view.setupId === setupId).map(view => ({...clone(view), id: fresh('view', view.id), setupId: id,
    ...(view.sourceCameraEntityId ? {sourceCameraEntityId: entityIds.get(view.sourceCameraEntityId) || view.sourceCameraEntityId} : {}), camera: camera(view.camera), createdAt: now, updatedAt: now}));
  const next = clone(state), world = next.scenePlay.worldSpace;
  world.setups.push(setup);
  world.entities.push(...entities.map(entity => ({...clone(entity), id: entityIds.get(entity.id), ...(entity.roleId ? {roleId: roleIds.get(entity.roleId)} : {}), createdAt: now, updatedAt: now})));
  world.characterRoles.push(...roles.map(role => ({...clone(role), id: roleIds.get(role.id), createdAt: now, updatedAt: now})));
  world.views.push(...views);
  if (activate) {world.activeStageId = setup.stageId; world.activeSetupId = id; world.activeViewId = null;}
  assertState(next); return next;
}

/** Official bj removes a state and its private content, keeping shared entities.
 * The host supplies a fresh replacement ID; this reducer never creates random IDs.
 */
export function removeIndependentSetup(state, setupId, {replacementId, now = Date.now()} = {}) {
  assertState(state);
  const space = state.scenePlay.worldSpace, setup = space.setups.find(item => item.id === setupId);
  if (!setup || setup.kind !== 'independent') return state;
  requireDomain(Number.isFinite(now) && now >= 0, 'setup.remove.now', 'invalid timestamp');
  let setups = space.setups.filter(item => item.id !== setupId);
  let fallback = setups.find(item => item.stageId === setup.stageId && item.kind === 'independent');
  if (!fallback) {
    requireDomain(typeof replacementId === 'string' && replacementId.trim() && !space.setups.some(item => item.id === replacementId), 'setup.remove.replacementId', 'last state requires a fresh replacement ID');
    fallback = createIndependentSetup({id: replacementId, stageId: setup.stageId, label: '状态 1', now}); setups = [...setups, fallback];
  }
  const deletedViews = new Set(space.views.filter(view => view.setupId === setupId).map(view => view.id));
  const candidates = new Set([...setup.entityStates.map(item => item.entityId), ...(setup.temporal?.tracks || []).map(item => item.owner.entityId)]);
  const candidateRoles = new Set(space.entities.filter(entity => candidates.has(entity.id)).map(entity => entity.roleId).filter(Boolean));
  const next = clone(state), world = next.scenePlay.worldSpace;
  world.setups = clone(setups); world.views = world.views.filter(view => !deletedViews.has(view.id));
  world.outputs = world.outputs.filter(output => !deletedViews.has(output.source.id));
  world.references = world.references.map(reference => ({...reference, targets: reference.targets.filter(target =>
    !(target.kind === 'setup' && target.id === setupId) && !(target.kind === 'view' && deletedViews.has(target.id)))}));
  if (space.activeSetupId === setupId) {
    world.activeStageId = fallback.stageId; world.activeSetupId = fallback.id; world.activeViewId = null;
  } else if (deletedViews.has(world.activeViewId)) world.activeViewId = null;
  assertState(next);
  let result = next;
  for (const entityId of candidates) {
    const remaining = result.scenePlay.worldSpace;
    if (!remaining.setups.some(item => item.entityStates.some(value => value.entityId === entityId) || item.temporal?.tracks.some(track => track.owner.entityId === entityId)) &&
        !remaining.views.some(view => view.sourceCameraEntityId === entityId)) result = removeEntity(result, entityId, now);
  }
  const remaining = result.scenePlay.worldSpace;
  remaining.characterRoles = remaining.characterRoles.filter(role => !candidateRoles.has(role.id) || remaining.entities.some(entity => entity.roleId === role.id));
  assertState(result); return result;
}
