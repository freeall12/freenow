import {clone, defined, requireDomain, same} from './invariants.mjs';
import {assertState, baselineId, createBaseline, createIndependentSetup, createSetupState, initialSetupId} from './schema.mjs';

function spaceOf(state) { assertState(state); return state.scenePlay.worldSpace; }
function finish(state, space) {
  if (same(state.scenePlay.worldSpace, space)) return state;
  const next = {...state, scenePlay: {...state.scenePlay, worldSpace: space}};
  assertState(next); return next;
}
function find(items, id, path) {
  const value = items.find(item => item.id === id);
  requireDomain(!!value, path, `missing target: ${id}`, 'missing-relation');
  return value;
}
function unique(items, id, path) {
  requireDomain(!items.some(item => item.id === id), path, `duplicate ID: ${id}`, 'duplicate-id');
}

export function addStage(state, stage, {activate = false, now = stage.createdAt} = {}) {
  const space = spaceOf(state); unique(space.stages, stage.id, 'stage');
  return finish(state, {...space, stages: [...space.stages, clone(stage)], setups: [...space.setups,
    createBaseline({stageId: stage.id, now}), createIndependentSetup({id: initialSetupId(stage.id), stageId: stage.id, label: 'State 1', now})],
    ...(activate ? {activeStageId: stage.id, activeSetupId: initialSetupId(stage.id), activeViewId: null} : {})});
}
export function addSetup(state, setup, {activate = false} = {}) {
  const space = spaceOf(state); unique(space.setups, setup.id, 'setup');
  requireDomain(setup.kind === 'independent', 'setup.kind', 'baseline is created with its stage');
  return finish(state, {...space, setups: [...space.setups, clone(setup)],
    ...(activate ? {activeStageId: setup.stageId, activeSetupId: setup.id, activeViewId: null} : {})});
}
export function setActiveSetup(state, setupId) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  if (space.activeSetupId === setupId) return state;
  return finish(state, {...space, activeStageId: setup.stageId, activeSetupId: setup.id, activeViewId: null});
}
export function setActiveStage(state, stageId) {
  const space = spaceOf(state); find(space.stages, stageId, 'stage');
  if (space.activeStageId === stageId) return state;
  return setActiveSetup(state, space.setups.find(setup => setup.stageId === stageId && setup.kind === 'independent').id);
}
export function renderSetup(state, setupId = state.scenePlay.worldSpace.activeSetupId) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  const baseline = find(space.setups, baselineId(setup.stageId), 'baseline');
  // course:dOe gives shared baseline states precedence; schema v4 forbids overrides.
  const shared = new Set(baseline.entityStates.map(item => item.entityId));
  return clone(setup.id === baseline.id ? setup : {...setup, entityStates: [...baseline.entityStates, ...setup.entityStates.filter(item => !shared.has(item.entityId))]});
}
export function addRole(state, role) {
  const space = spaceOf(state); unique(space.characterRoles, role.id, 'role');
  return finish(state, {...space, characterRoles: [...space.characterRoles, clone(role)]});
}
export function addEntity(state, entity, {setupId = state.scenePlay.worldSpace.activeSetupId, setupState = createSetupState(entity.id, entity.createdAt)} = {}) {
  const space = spaceOf(state); unique(space.entities, entity.id, 'entity');
  const setup = find(space.setups, setupId, 'setup');
  requireDomain(setup.stageId === entity.stageId, 'entity.stageId', 'entity/setup stage mismatch', 'cross-stage');
  requireDomain(setupState.entityId === entity.id, 'entityState.entityId', 'entity/state identity mismatch');
  return finish(state, {...space, entities: [...space.entities, clone(entity)], setups: space.setups.map(item => item.id === setupId ?
    {...item, entityStates: [...item.entityStates, clone(setupState)], updatedAt: Math.max(item.updatedAt, setupState.updatedAt)} : item)});
}
export function addEntityState(state, setupId, setupState) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  requireDomain(!setup.entityStates.some(item => item.entityId === setupState.entityId), 'entityState.entityId', 'duplicate setup entity state', 'duplicate-id');
  return finish(state, {...space, setups: space.setups.map(item => item.id === setupId ?
    {...item, entityStates: [...item.entityStates, clone(setupState)], updatedAt: Math.max(item.updatedAt, setupState.updatedAt)} : item)});
}
export function patchEntity(state, entityId, patch, now = Date.now()) {
  const space = spaceOf(state), entity = find(space.entities, entityId, 'entity');
  requireDomain(!['id', 'stageId', 'kind', 'createdAt', 'updatedAt'].some(field => Object.hasOwn(patch, field)), 'entity.patch', 'identity and timestamps are immutable');
  const next = {...entity, ...clone(patch)};
  if (same(entity, next)) return state;
  return finish(state, {...space, entities: space.entities.map(item => item.id === entityId ? {...next, updatedAt: now} : item)});
}
export function patchEntityState(state, setupId, entityId, patch, now = Date.now()) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  const previous = setup.entityStates.find(item => item.entityId === entityId);
  requireDomain(!!previous, 'entityState', 'entity has no local setup state', 'missing-relation');
  requireDomain(!['entityId', 'updatedAt'].some(field => Object.hasOwn(patch, field)), 'entityState.patch', 'identity and timestamp are immutable');
  const next = {...previous, ...clone(patch)};
  if (same(previous, next)) return state;
  return finish(state, {...space, setups: space.setups.map(item => item.id === setupId ? {...item,
    entityStates: item.entityStates.map(value => value.entityId === entityId ? {...next, updatedAt: now} : value), updatedAt: now} : item)});
}
export function setTemporal(state, setupId, temporal, now = Date.now()) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  requireDomain(setup.kind === 'independent', 'setup.temporal', 'baseline cannot author temporal tracks');
  if (same(setup.temporal, temporal)) return state;
  const {temporal: previous, ...rest} = setup;
  const next = {...rest, ...temporal === undefined ? {} : {temporal: clone(temporal)}, updatedAt: now};
  return finish(state, {...space, setups: space.setups.map(item => item.id === setupId ? next : item)});
}
export function addView(state, view, {activate = true} = {}) {
  const space = spaceOf(state); unique(space.views, view.id, 'view');
  return finish(state, {...space, views: [...space.views, clone(view)],
    ...(activate ? {activeStageId: view.stageId, activeSetupId: view.setupId, activeViewId: view.id} : {})});
}
export function addReference(state, reference) {
  const space = spaceOf(state); unique(space.references, reference.id, 'reference');
  return finish(state, {...space, references: [...space.references, clone(reference)]});
}
export function addOutput(state, output) {
  const space = spaceOf(state); unique(space.outputs, output.id, 'output');
  return finish(state, {...space, outputs: [...space.outputs, clone(output)]});
}

function clearEntityTarget(target, entityId, type = 'look') {
  return target?.entityId === entityId ? type === 'look' ? {kind: 'none'} : {mode: 'none'} : target;
}
function clearCamera(camera, entityId) {
  if (!camera) return camera;
  return {...camera, ...camera.focus ? {focus: clearEntityTarget(camera.focus, entityId, 'focus')} : {},
    ...camera.lookAt ? {lookAt: clearEntityTarget(camera.lookAt, entityId, 'camera-look')} : {}};
}
function clearTemporalReferences(temporal, entityId) {
  if (!temporal) return temporal;
  return {...temporal, tracks: temporal.tracks.filter(track => track.owner.entityId !== entityId).map(track => ({...track,
    channels: track.channels.map(channel => ({...channel, values: channel.values.map(sample => {
      const value = sample.value;
      let next = value.value;
      if (value.kind === 'look-target') next = clearEntityTarget(next, entityId);
      if (value.kind === 'camera-focus' || value.kind === 'camera-look-at') next = clearEntityTarget(next, entityId, 'camera-look');
      if (channel.property === 'entity.heldEntityId' && next === entityId) next = null;
      return same(next, value.value) ? sample : {...sample, value: {...value, value: next}};
    })}))
  }))};
}
function clearSetupReferences(setup, entityId, now) {
  const entityStates = setup.entityStates.filter(state => state.entityId !== entityId).map(state => {
    const next = defined({...state, ...state.lookTarget ? {lookTarget: clearEntityTarget(state.lookTarget, entityId)} : {},
      heldEntityId: state.heldEntityId === entityId ? undefined : state.heldEntityId,
      ...state.camera ? {camera: clearCamera(state.camera, entityId)} : {}});
    return same(state, next) ? state : {...next, updatedAt: now};
  });
  const next = {...setup, entityStates, ...setup.temporal ? {temporal: clearTemporalReferences(setup.temporal, entityId)} : {}};
  return same(setup, next) ? setup : {...next, updatedAt: now};
}

export function removeEntity(state, entityId, now = Date.now()) {
  const space = spaceOf(state);
  if (!space.entities.some(entity => entity.id === entityId)) return state;
  const removedViews = new Set(space.views.filter(view => view.sourceCameraEntityId === entityId).map(view => view.id));
  // Qc's cascade plus camera/temporal targets: strict local validation cannot retain dangling targets.
  return finish(state, {...space, entities: space.entities.filter(entity => entity.id !== entityId),
    setups: space.setups.map(setup => clearSetupReferences(setup, entityId, now)),
    views: space.views.filter(view => !removedViews.has(view.id)).map(view => {
      const camera = clearCamera(view.camera, entityId);
      return same(view.camera, camera) ? view : {...view, camera, updatedAt: now};
    }), outputs: space.outputs.filter(output => !removedViews.has(output.source.id)),
    references: space.references.map(reference => ({...reference, targets: reference.targets.filter(target =>
      !(target.kind === 'entity' && target.id === entityId) && !(target.kind === 'view' && removedViews.has(target.id)))})),
    activeViewId: removedViews.has(space.activeViewId) ? null : space.activeViewId});
}
export function removeEntityFromSetup(state, entityId, setupId = state.scenePlay.worldSpace.activeSetupId, now = Date.now()) {
  const space = spaceOf(state), setup = find(space.setups, setupId, 'setup');
  if (!space.entities.some(entity => entity.id === entityId && entity.stageId === setup.stageId)) return state;
  if (setup.kind === 'scene-baseline') return removeEntity(state, entityId, now);
  if (!setup.entityStates.some(item => item.entityId === entityId)) return state;
  const next = finish(state, {...space, setups: space.setups.map(item => item.id === setupId ? {...item,
    entityStates: item.entityStates.filter(value => value.entityId !== entityId),
    ...item.temporal ? {temporal: {...item.temporal, tracks: item.temporal.tracks.filter(track => track.owner.entityId !== entityId)}} : {}, updatedAt: now} : item)});
  const remaining = next.scenePlay.worldSpace;
  return remaining.setups.some(item => item.entityStates.some(value => value.entityId === entityId) || item.temporal?.tracks.some(track => track.owner.entityId === entityId)) ||
    remaining.views.some(view => view.sourceCameraEntityId === entityId) ? next : removeEntity(next, entityId, now);
}
export function removeView(state, viewId) {
  const space = spaceOf(state);
  if (!space.views.some(view => view.id === viewId)) return state;
  return finish(state, {...space, views: space.views.filter(view => view.id !== viewId), outputs: space.outputs.filter(output => output.source.id !== viewId),
    references: space.references.map(reference => ({...reference, targets: reference.targets.filter(target => target.kind !== 'view' || target.id !== viewId)})),
    activeViewId: space.activeViewId === viewId ? null : space.activeViewId});
}
