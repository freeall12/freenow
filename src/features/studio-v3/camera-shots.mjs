import {assertJson, clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertCamera, assertState, createView} from './schema.mjs';
import {renderSetup, removeView} from './world-space.mjs';
import {reduceEntityAction, resolveEntityControl} from './entity-actions.mjs';
import {setupLane} from './history.mjs';

const ordered = (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
function context(state, options = {}) {
  assertState(state); requireDomain(isRecord(options), 'cameraShots.options', 'must be a plain object');
  for (const key of Object.keys(options)) requireDomain(['stageId', 'setupId'].includes(key), `cameraShots.${key}`, 'unsupported option');
  const space = state.scenePlay.worldSpace, stageId = options.stageId ?? space.activeStageId, setupId = options.setupId ?? space.activeSetupId;
  requireDomain(space.stages.some(stage => stage.id === stageId), 'cameraShots.stageId', 'stage does not exist', 'missing-relation');
  const setup = space.setups.find(item => item.id === setupId);
  requireDomain(!!setup, 'cameraShots.setupId', 'setup does not exist', 'missing-relation');
  requireDomain(setup.stageId === stageId, 'cameraShots.setupId', 'setup belongs to another stage', 'cross-stage');
  return {space, setup, stageId};
}
function playbackKind(setup, cameraEntityId) {
  if (!cameraEntityId || !setup.entityStates.some(item => item.entityId === cameraEntityId && item.camera) || !setup.temporal) return {kind: 'static', durationMs: null};
  // Official XT resolves used channel keys, not the setup duration field or
  // only this camera's track. Unreferenced keys and a lone 0ms key are static.
  let duration = 0;
  for (const track of setup.temporal.tracks) {
    const used = new Set(track.channels.flatMap(channel => channel.values.map(sample => sample.keyId)));
    for (const key of track.keys) if (used.has(key.id)) duration = Math.max(duration, key.timeMs);
  }
  return duration > 0 ? {kind: 'dynamic', durationMs: Math.round(duration)} : {kind: 'static', durationMs: null};
}
function shot(view, source, index, setup, entities, camera) {
  assertJson(camera, 'cameraShots.camera'); assertCamera(camera, 'cameraShots.camera');
  const playback = playbackKind(setup, view.sourceCameraEntityId), duration = playback.kind === 'dynamic' ? playback.durationMs : view.durationMs;
  return clone({id: view.id, index, source, stageId: view.stageId, setupId: setup.id, setupLabel: setup.label,
    title: view.label, kind: playback.kind, view: {...view, camera}, camera, cameraEntityId: view.sourceCameraEntityId ?? null,
    durationMs: typeof duration === 'number' && Number.isFinite(duration) ? duration : null, entities, setup});
}

/** Official SK/EK/RK ordering and baseline resolution. Listing never samples
 * temporal channels, creates domain views or reads a renderer camera. */
export function listCameraShots(state, options = {}) {
  const {space, setup, stageId} = context(state, options); if (setup.kind === 'scene-baseline') return [];
  const resolved = renderSetup(state, setup.id), states = new Map(resolved.entityStates.map(item => [item.entityId, item]));
  const explicit = space.views.filter(view => view.stageId === stageId && view.setupId === setup.id && view.tags.includes('shot')).slice().sort(ordered)
    .map((view, index) => shot(view, 'view', index, resolved, space.entities, states.get(view.sourceCameraEntityId)?.camera ?? view.camera));
  const occupied = new Set(explicit.map(item => item.cameraEntityId).filter(Boolean)), result = [...explicit], ids = new Set(explicit.map(item => item.id));
  for (const entity of space.entities.filter(item => item.stageId === stageId && item.kind === 'camera').slice().sort(ordered)) {
    if (occupied.has(entity.id)) continue;
    const local = states.get(entity.id); if (!local?.camera || local.visible === false) continue;
    const id = `implicit-camera-shot:${setup.id}:${entity.id}`;
    requireDomain(!ids.has(id), 'cameraShots.id', 'explicit and implicit shot IDs collide', 'duplicate-id'); ids.add(id);
    // Stable timestamp from EK. At all-zero authored timestamps, keep zero
    // instead of RK's Date.now fallback so this pure list stays deterministic.
    const now = Math.max(entity.updatedAt, local.updatedAt, resolved.updatedAt);
    const view = createView({id, stageId, setupId: setup.id, sourceCameraEntityId: entity.id, label: entity.label, camera: local.camera, tags: ['shot'], now});
    result.push(shot(view, 'camera', result.length, resolved, space.entities, local.camera));
  }
  return result;
}

function result(previous, state, selected, lane, extra = {}) {
  return {ok: true, changed: !same(previous, state), state, lane, scope: {kind: 'world-space'}, entityId: selected.cameraEntityId,
    shotId: selected.id, shot: selected, ...extra};
}
function denied(state, lane, reason, message, selected) {
  return {ok: false, changed: false, state, lane, reason, message, entityId: selected?.cameraEntityId ?? null, ...(selected ? {shot: selected, shotId: selected.id} : {})};
}

/** Pure manager action. The host chooses history, input leases, readonly /
 * playback gates and confirmation UI; no implicit author transaction. */
export function reduceCameraShotAction(state, action, {now = Date.now()} = {}) {
  const {space, setup} = context(state); assertJson(action, 'cameraShotAction');
  requireDomain(isRecord(action) && ['rename', 'remove'].includes(action.type), 'cameraShotAction.type', 'unknown action');
  for (const key of Object.keys(action)) requireDomain((action.type === 'rename' ? ['type', 'shotId', 'title'] : ['type', 'shotId']).includes(key), `cameraShotAction.${key}`, 'unsupported field');
  requireDomain(typeof action.shotId === 'string' && action.shotId.length > 0, 'cameraShotAction.shotId', 'requires a shot ID');
  requireDomain(Number.isFinite(now) && now >= 0, 'cameraShotAction.now', 'must be a finite nonnegative timestamp');
  const selected = listCameraShots(state).find(item => item.id === action.shotId), viewLane = setupLane(setup.id);
  if (!selected) return denied(state, viewLane, 'camera-shot-missing', '镜头不在当前状态中');
  if (action.type === 'rename') {
    requireDomain(typeof action.title === 'string', 'cameraShotAction.title', 'must be text'); const title = action.title.trim();
    if (!title) return denied(state, viewLane, 'empty-title', '镜头名称不能为空', selected);
    if (title === selected.title) return denied(state, selected.source === 'camera' ? 'world' : viewLane, 'unchanged', '镜头名称未改变', selected);
    let next, lane;
    if (selected.source === 'view') {
      const view = space.views.find(item => item.id === selected.id);
      requireDomain(now >= view.createdAt, 'cameraShotAction.now', 'cannot predate view creation');
      next = {...state, scenePlay: {...state.scenePlay, worldSpace: {...space,
        views: space.views.map(item => item.id === selected.id ? {...item, label: title, updatedAt: now} : item)}}};
      assertState(next); lane = viewLane;
    } else {
      const renamed = reduceEntityAction(state, {type: 'update', setupId: setup.id, entityId: selected.cameraEntityId, patch: {label: title}}, {now});
      if (!renamed.ok) return denied(state, renamed.lane, renamed.reason, renamed.message, selected);
      next = renamed.state; lane = renamed.lane;
    }
    return result(state, next, listCameraShots(next).find(item => item.id === selected.id), lane);
  }
  const removedViewIds = new Set(selected.source === 'view' ? [selected.view.id] : []);
  if (selected.cameraEntityId) {
    for (const view of space.views) if (view.setupId === setup.id && view.sourceCameraEntityId === selected.cameraEntityId) removedViewIds.add(view.id);
  }
  let next = state; for (const id of removedViewIds) next = removeView(next, id);
  let lane = viewLane, removal = 'views-only';
  if (selected.cameraEntityId) {
    const control = resolveEntityControl(next, {entityId: selected.cameraEntityId, setupId: setup.id});
    // Official wy uses local state, then the same-stage baseline. A source
    // view with neither instance still deletes its views without another setup.
    if (control.ownerSetupId) {
      const removed = reduceEntityAction(next, {type: 'remove', entityId: selected.cameraEntityId, setupId: setup.id, mode: 'local'}, {now});
      if (!removed.ok) return denied(state, removed.lane, removed.reason, removed.message, selected);
      next = removed.state; lane = removed.lane; removal = removed.removal;
    }
  }
  const remainingViews = new Set(next.scenePlay.worldSpace.views.map(view => view.id));
  for (const view of space.views) if (!remainingViews.has(view.id)) removedViewIds.add(view.id);
  return result(state, next, selected, lane, {removedViewIds: [...removedViewIds], removal});
}
