import {assertJson, clone, defined, isRecord, requireDomain, same} from './invariants.mjs';
import {assertState, assertSetupState, baselineId} from './schema.mjs';
import {setTemporal} from './world-space.mjs';
import {setupLane} from './history.mjs';
import {reduceEntityAction} from './entity-actions.mjs';
import {fovToFocalLength} from './camera-optics.mjs';
import {sampleTemporalSetupState, temporalPositionPathSegments, resolveTemporalPathSplit} from './camera-shot-sampling.mjs';

export const TEMPORAL_MIN_DURATION_MS = 1000, TEMPORAL_DEFAULT_DURATION_MS = 3000;
export const TEMPORAL_CHANNEL_KINDS = Object.freeze({
  'entity.transform.position': 'vec3', 'entity.transform.rotation': 'euler3', 'entity.transform.scale': 'vec3',
  'entity.visibility': 'boolean', 'entity.pose': 'pose', 'entity.lookTarget': 'look-target', 'entity.heldEntityId': 'text',
  'camera.rotation': 'euler3', 'camera.fov': 'number', 'camera.focalLength': 'number', 'camera.frameAspectRatio': 'number',
  'camera.focusDistance': 'number', 'camera.apertureFNumber': 'number', 'camera.focus': 'camera-focus',
  'camera.depthOfFieldMode': 'camera-depth-of-field-mode', 'camera.lookAt': 'camera-look-at'
});
const text = (value, path) => requireDomain(typeof value === 'string' && value.trim().length > 0, path, 'must be nonempty text');
function fields(value, allowed, path) {
  requireDomain(isRecord(value), path, 'must be a plain object'); assertJson(value, path);
  for (const key of Object.keys(value)) requireDomain(allowed.includes(key), `${path}.${key}`, 'unsupported field');
}
function finite(value, path) {requireDomain(typeof value === 'number' && Number.isFinite(value), path, 'must be a finite number');}
function time(value, path = 'temporal.timeMs') {finite(value, path); const result = Math.max(0, Math.round(value)); requireDomain(Number.isSafeInteger(result), path, 'must fit safe integer milliseconds'); return result;}
const trackOf = (setup, entityId) => setup.temporal?.tracks.find(track => track.owner.entityId === entityId);
const keyAt = (track, timeMs) => track?.keys.find(key => key.timeMs === timeMs);
const keyById = (track, keyId) => track?.keys.find(key => key.id === keyId);
const byTime = (a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id);

function context(state, setupId, entityId) {
  assertState(state); const space = state.scenePlay.worldSpace, setup = space.setups.find(item => item.id === (setupId ?? space.activeSetupId));
  requireDomain(!!setup, 'temporal.setupId', 'setup does not exist', 'missing-relation');
  const definition = entityId === undefined ? null : space.entities.find(item => item.id === entityId);
  if (entityId !== undefined) {
    text(entityId, 'temporal.entityId'); requireDomain(!!definition, 'temporal.entityId', 'entity does not exist', 'missing-relation');
    requireDomain(definition.stageId === setup.stageId, 'temporal.entityId', 'entity belongs to another stage', 'cross-stage');
  }
  const local = setup.entityStates.find(item => item.entityId === entityId), baseline = space.setups.find(item => item.id === baselineId(setup.stageId));
  return {space, setup, definition, local, shared: baseline.entityStates.some(item => item.entityId === entityId), lane: setupLane(setup.id)};
}
function refusal(state, ctx, reason) {return {ok: false, state, changed: false, reason, lane: ctx.lane, scope: {kind: 'world-space'}};}
function guard(state, ctx, options) {
  if (options.readonly) return refusal(state, ctx, 'readonly');
  if (options.playing) return refusal(state, ctx, 'playback');
  if (options.scrubbing) return refusal(state, ctx, 'scrubbing');
  if (ctx.setup.kind !== 'independent') return refusal(state, ctx, 'baseline-no-temporal');
  if (ctx.definition && ctx.shared) return refusal(state, ctx, 'baseline-readonly');
  if (ctx.definition && !ctx.local) return refusal(state, ctx, 'missing-state');
  if (ctx.definition && ['actor', 'prop'].includes(ctx.definition.kind) && ctx.definition.locked) return refusal(state, ctx, 'locked');
  return null;
}
function result(previous, next, ctx, action, extra = {}) {
  return {ok: true, state: next, changed: next !== previous, lane: ctx.lane, scope: {kind: 'world-space'},
    historyLabel: `director.temporal.${action.source ?? 'timeline'}.${action.type}`, ...extra};
}
function timestamp(options, ctx) {const now = options.now ?? Date.now(); finite(now, 'temporal.updatedAt'); requireDomain(now >= ctx.setup.createdAt, 'temporal.updatedAt', 'timestamp precedes setup creation'); return now;}
function fingerprint(ctx) {return JSON.stringify({setup: ctx.setup, definition: ctx.definition, entities: ctx.space.entities.filter(entity => entity.stageId === ctx.setup.stageId)});}

/** Original Kn: a valid selected key wins, then no own keys means base. */
export function resolveTemporalEditTarget(state, request = {}, options = {}) {
  fields(request, ['setupId', 'entityId', 'timeMs', 'selectedKeyId', 'selectedKey', 'target'], 'temporal.targetRequest');
  const ctx = context(state, request.setupId, request.entityId), denied = guard(state, ctx, options);
  if (denied) return {kind: 'blocked', reason: denied.reason};
  requireDomain(!!ctx.definition, 'temporal.entityId', 'entity is required');
  const playhead = time(request.timeMs ?? 0), track = trackOf(ctx.setup, ctx.definition.id);
  if (request.target !== undefined) {
    fields(request.target, ['kind', 'entityId', 'keyId', 'timeMs'], 'temporal.target');
    const target = request.target;
    if (target.kind === 'base') return {kind: 'base'};
    if (target.kind === 'time-key' || target.kind === 'playhead-key') return {kind: 'time-key', timeMs: target.kind === 'playhead-key' ? playhead : time(target.timeMs)};
    requireDomain(target.kind === 'selected-key', 'temporal.target.kind', 'unknown edit target');
    if (target.entityId !== undefined && target.entityId !== ctx.definition.id) return {kind: 'time-key', timeMs: playhead};
    text(target.keyId, 'temporal.target.keyId'); requireDomain(!!keyById(track, target.keyId), 'temporal.target.keyId', 'selected key does not exist', 'missing-relation');
    return {kind: 'selected-key', entityId: ctx.definition.id, keyId: target.keyId};
  }
  const selected = request.selectedKey ?? (request.selectedKeyId === undefined ? null : {entityId: ctx.definition.id, keyId: request.selectedKeyId});
  if (selected !== null) {fields(selected, ['entityId', 'keyId'], 'temporal.selectedKey'); text(selected.entityId, 'temporal.selectedKey.entityId'); text(selected.keyId, 'temporal.selectedKey.keyId');}
  if (selected?.entityId === ctx.definition.id && keyById(track, selected.keyId)) return {kind: 'selected-key', entityId: ctx.definition.id, keyId: selected.keyId};
  if (!track?.keys.length) return {kind: 'base'};
  const at = keyAt(track, playhead);
  return at ? {kind: 'selected-key', entityId: ctx.definition.id, keyId: at.id} : {kind: 'time-key', timeMs: playhead};
}

export function temporalKeyCreationImpact(state, {setupId, entityId, timeMs}) {
  const ctx = context(state, setupId, entityId), atTime = time(timeMs), track = trackOf(ctx.setup, entityId), key = keyAt(track, atTime);
  return {existingKeyId: key?.id ?? null, existingTrackId: track?.id ?? null, requiresConfirmation: !track || !key, timeMs: atTime, willCreateKey: !key, willCreateTrack: !track};
}
export function temporalDurationMinimum(state, setupId) {
  const ctx = context(state, setupId); let maximum = TEMPORAL_MIN_DURATION_MS, blocking = null;
  for (const track of ctx.setup.temporal?.tracks ?? []) for (const key of track.keys) if (key.timeMs > maximum) {maximum = key.timeMs; blocking = {track, key};}
  return blocking ? {kind: 'blocking-key', durationMs: maximum, timeMs: maximum, trackLabel: ctx.space.entities.find(entity => entity.id === blocking.track.owner.entityId).label, trackId: blocking.track.id, keyId: blocking.key.id} : {kind: 'system', durationMs: maximum};
}
/** Unlike duration minimum, shot duration counts only keys referenced by values. */
export function temporalUsedDurationMs(state, setupId) {
  const ctx = context(state, setupId); let duration = null;
  for (const track of ctx.setup.temporal?.tracks ?? []) {
    const used = new Set(track.channels.flatMap(channel => channel.values.map(sample => sample.keyId)));
    const times = track.keys.filter(key => used.has(key.id)).map(key => key.timeMs);
    if (times.length && !(times.length === 1 && times[0] === 0)) duration = Math.max(duration ?? 0, ...times);
  }
  return duration;
}
export function temporalKeyMoveRange(track, keyId, durationMs) {
  finite(durationMs, 'temporal.durationMs'); const ordered = track.keys.slice().sort(byTime), index = ordered.findIndex(key => key.id === keyId);
  if (index < 0) return null;
  return {minTimeMs: index ? ordered[index - 1].timeMs + 1 : 0, maxTimeMs: ordered[index + 1] ? ordered[index + 1].timeMs - 1 : Math.max(Math.round(durationMs), ordered[index].timeMs)};
}
export function temporalTrackDescriptor(state, {setupId, entityId, selectedKeyId} = {}) {
  const ctx = context(state, setupId, entityId), track = trackOf(ctx.setup, entityId); if (!track) return null;
  return {id: track.id, entityId, kind: ctx.definition.kind, label: ctx.definition.label, selectedKeyId: keyById(track, selectedKeyId)?.id ?? null,
    keyItems: track.keys.map(key => ({...clone(key), moveRange: temporalKeyMoveRange(track, key.id, ctx.setup.temporal.durationMs)}))};
}

/** Original gW. Additional relation channels are only saved when explicitly edited. */
export function snapshotEntityChannels(definition, setupState) {
  requireDomain(isRecord(definition) && ['actor', 'camera', 'prop'].includes(definition.kind), 'temporal.entity', 'requires an entity definition');
  requireDomain(definition.id === setupState?.entityId, 'temporal.snapshot.entityId', 'snapshot/entity identity mismatch'); assertSetupState(setupState);
  // Legal older/imported states may have an unsynchronized plan position.
  // Preserve the optical pose used by the renderer when capturing a key.
  const position = definition.kind === 'camera' && setupState.camera ? setupState.camera.position : setupState.transform.position;
  const entries = [
    ['entity.transform.position', 'vec3', position], ['entity.transform.scale', 'vec3', setupState.transform.scale], ['entity.visibility', 'boolean', setupState.visible, 'hold']
  ];
  if (definition.kind !== 'camera') entries.push(['entity.transform.rotation', 'euler3', setupState.transform.rotation]);
  if (definition.kind === 'actor' && setupState.pose) entries.push(['entity.pose', 'pose', setupState.pose, 'hold']);
  if (definition.kind === 'camera' && setupState.camera) {
    const camera = setupState.camera;
    entries.push(['camera.rotation', 'euler3', camera.rotation], ['camera.focalLength', 'number', camera.focalLength ?? fovToFocalLength(camera.fov, camera.frameAspectRatio)]);
    if (typeof camera.frameAspectRatio === 'number') entries.push(['camera.frameAspectRatio', 'number', camera.frameAspectRatio, 'hold']);
    for (const [field, kind, interpolation] of [['focus', 'camera-focus', 'hold'], ['lookAt', 'camera-look-at', 'hold'], ['focusDistance', 'number'], ['apertureFNumber', 'number'], ['depthOfFieldMode', 'camera-depth-of-field-mode', 'hold']]) {
      if (camera[field] !== undefined && camera[field] !== null) entries.push([`camera.${field}`, kind, camera[field], interpolation]);
    }
  }
  return entries.map(([property, kind, value, interpolation]) => defined({property, value: {kind, value: clone(value)}, interpolation}));
}
function endpointChanges(previous, next) {
  if (!next.pathEndpointControls) return next;
  const controls = clone(next.pathEndpointControls);
  if (previous.keys[0]?.id !== next.keys[0]?.id) delete controls.start;
  if (previous.keys.at(-1)?.id !== next.keys.at(-1)?.id) delete controls.end;
  if (Object.keys(controls).length) return {...next, pathEndpointControls: controls};
  const {pathEndpointControls, ...rest} = next; return rest;
}
function tidyTrack(track) {
  const channels = track.channels.filter(channel => channel.values.length), used = new Set(channels.flatMap(channel => channel.values.map(sample => sample.keyId)));
  const keys = track.keys.filter(key => used.has(key.id)).sort(byTime), ids = new Set(keys.map(key => key.id));
  if (!keys.length || !channels.length) return null;
  const next = {...track, keys, channels};
  if (track.segments) next.segments = track.segments.filter(segment => ids.has(segment.fromKeyId) && ids.has(segment.toKeyId));
  return endpointChanges(track, next);
}
function tidyTemporal(temporal) {return {...temporal, tracks: temporal.tracks.map(tidyTrack).filter(Boolean)};}
function validateChannelValue(ctx, property, value, interpolation) {
  requireDomain(Object.hasOwn(TEMPORAL_CHANNEL_KINDS, property), 'temporal.property', 'unknown temporal property');
  fields(value, ['kind', 'value'], 'temporal.value'); requireDomain(Object.hasOwn(value, 'value'), 'temporal.value.value', 'value is required');
  requireDomain(value.kind === TEMPORAL_CHANNEL_KINDS[property], 'temporal.value.kind', 'channel value kind mismatch');
  requireDomain(!property.startsWith('camera.') || ctx.definition.kind === 'camera' && !!ctx.local.camera, 'temporal.property', 'camera channel requires camera state');
  requireDomain(property !== 'entity.pose' || ctx.definition.kind === 'actor', 'temporal.property', 'pose requires actor');
  if (interpolation !== undefined) requireDomain(['linear', 'hold'].includes(interpolation), 'temporal.interpolation', 'unknown interpolation');
  if (property.startsWith('camera.') && value.kind === 'number') {finite(value.value, 'temporal.value.value'); requireDomain(value.value > 0 && (property !== 'camera.fov' || value.value < 180), 'temporal.value.value', 'camera scalar must be positive and fov less than 180');}
  if (property === 'entity.transform.scale') requireDomain(['x', 'y', 'z'].every(axis => value.value?.[axis] !== 0), 'temporal.value.value', 'zero scale is not editable');
  // The final assertState performs field shape, reference/stage, rotation order
  // and discriminated target validation, without another schema implementation.
}
function upsertValue(ctx, track, keyId, property, value, interpolation, channelId) {
  validateChannelValue(ctx, property, value, interpolation);
  const previous = track.channels.find(channel => channel.property === property), id = previous?.id ?? channelId ?? `${track.id}:${property}`;
  text(id, 'temporal.channel.id'); requireDomain(!track.channels.some(channel => channel.id === id && channel.property !== property), 'temporal.channel.id', 'duplicate channel ID', 'duplicate-id');
  const sample = defined({keyId, value: clone(value), interpolation}), next = {id, property, values: [...(previous?.values ?? []).filter(item => item.keyId !== keyId), sample]};
  const keyTimes = new Map(track.keys.map(key => [key.id, key.timeMs])); next.values.sort((a, b) => keyTimes.get(a.keyId) - keyTimes.get(b.keyId));
  return {...track, channels: previous ? track.channels.map(channel => channel.property === property ? next : channel) : [...track.channels, next]};
}
function sampledEntity(state, ctx, timeMs) {
  return sampleTemporalSetupState(state, {setupId: ctx.setup.id, stageId: ctx.setup.stageId}, timeMs).entityStates.find(item => item.entityId === ctx.definition.id);
}
function validateSnapshot(ctx, snapshot) {
  requireDomain(snapshot?.entityId === ctx.definition.id, 'temporal.snapshot.entityId', 'snapshot/entity identity mismatch');
  assertSetupState(snapshot, 'temporal.snapshot', new Map(ctx.space.entities.map(entity => [entity.id, entity])), ctx.setup.stageId);
  requireDomain(snapshot.pose === undefined || ctx.definition.kind === 'actor', 'temporal.snapshot.pose', 'pose requires actor');
  requireDomain(ctx.definition.kind !== 'camera' || !!snapshot.camera, 'temporal.snapshot.camera', 'camera state is required');
}
function saveKey(state, ctx, action, options, extraChannels = []) {
  const atTime = time(action.timeMs), original = trackOf(ctx.setup, ctx.definition.id), existing = keyAt(original, atTime);
  const snapshot = action.snapshot ?? sampledEntity(state, ctx, atTime); validateSnapshot(ctx, snapshot);
  let track = original ? clone(original) : {id: `entity-track:${ctx.definition.id}`, owner: {kind: 'entity', entityId: ctx.definition.id}, keys: [], channels: []};
  const id = existing?.id ?? action.keyId ?? (options.createId ?? (() => `temporal-key:${crypto.randomUUID()}`))();
  text(id, 'temporal.key.id'); requireDomain(!track.keys.some(key => key.id === id && key.timeMs !== atTime), 'temporal.key.id', 'duplicate key ID', 'duplicate-id');
  const key = {...(existing ?? {id, timeMs: atTime}), ...(action.label === undefined ? {} : {label: action.label})};
  if (key.label !== undefined) text(key.label, 'temporal.key.label');
  const split = !existing && original ? resolveTemporalPathSplit(original, atTime) : null;
  track.keys = [...track.keys.filter(item => item.id !== id && item.timeMs !== atTime), key].sort(byTime);
  if (ctx.definition.kind === 'camera') track.channels = track.channels.filter(channel => channel.property !== 'entity.transform.rotation');
  for (const sample of [...snapshotEntityChannels(ctx.definition, snapshot), ...extraChannels]) track = upsertValue(ctx, track, id, sample.property, sample.value, sample.interpolation);
  track = endpointChanges(original ?? {keys: []}, track);
  const insertedIndex = track.keys.findIndex(item => item.id === id);
  if (split && track.keys[insertedIndex - 1]?.id === split.fromKeyId && track.keys[insertedIndex + 1]?.id === split.toKeyId) {
    const adjacency = new Set(track.keys.slice(0, -1).map((item, index) => `${item.id}\0${track.keys[index + 1].id}`));
    track.segments = (track.segments ?? []).filter(segment => adjacency.has(`${segment.fromKeyId}\0${segment.toKeyId}`) && ![[split.fromKeyId, id], [id, split.toKeyId]].some(([from, to]) => segment.fromKeyId === from && segment.toKeyId === to));
    track.segments.push({fromKeyId: split.fromKeyId, toKeyId: id, transition: {spatialBend: split.leftBend}}, {fromKeyId: id, toKeyId: split.toKeyId, transition: {spatialBend: split.rightBend}});
  }
  const temporal = ctx.setup.temporal ? clone(ctx.setup.temporal) : {durationMs: TEMPORAL_DEFAULT_DURATION_MS, tracks: []};
  temporal.durationMs = Math.max(temporal.durationMs, atTime, TEMPORAL_DEFAULT_DURATION_MS);
  temporal.tracks = original ? temporal.tracks.map(item => item.id === original.id ? track : item) : [...temporal.tracks, track];
  const next = setTemporal(state, ctx.setup.id, tidyTemporal(temporal), timestamp(options, ctx));
  return result(state, next, ctx, action, {selection: {entityId: ctx.definition.id, keyId: id}});
}

/** Prepare a concrete edit without writing state; confirmation is separate. */
export function prepareTemporalEdit(state, request, options = {}) {
  fields(request, ['setupId', 'entityId', 'timeMs', 'selectedKeyId', 'selectedKey', 'target', 'patch', 'source'], 'temporal.edit');
  if (request.source !== undefined) text(request.source, 'temporal.source');
  const ctx = context(state, request.setupId, request.entityId), denied = guard(state, ctx, options); if (denied) return denied;
  requireDomain(!!ctx.definition, 'temporal.entityId', 'entity is required');
  fields(request.patch, ['transform', 'visible', 'pose', 'camera', 'lookTarget', 'heldEntityId'], 'temporal.patch');
  const target = resolveTemporalEditTarget(state, defined({setupId: ctx.setup.id, entityId: ctx.definition.id, timeMs: request.timeMs, selectedKeyId: request.selectedKeyId, selectedKey: request.selectedKey, target: request.target}), options);
  if (target.kind === 'blocked') return refusal(state, ctx, target.reason);
  const atTime = target.kind === 'selected-key' ? keyById(trackOf(ctx.setup, ctx.definition.id), target.keyId).timeMs : target.kind === 'time-key' ? target.timeMs : time(request.timeMs ?? 0);
  const initial = target.kind === 'base' ? ctx.local : sampledEntity(state, ctx, atTime);
  // Validate through the existing instance editor, but discard its temporary
  // sampled state. Key authoring must never persist an interpolated base.
  const temporary = clone(state), targetSetup = temporary.scenePlay.worldSpace.setups.find(item => item.id === ctx.setup.id);
  targetSetup.entityStates = targetSetup.entityStates.map(item => item.entityId === ctx.definition.id ? clone(initial) : item);
  const validation = reduceEntityAction(temporary, {type: 'update', setupId: ctx.setup.id, entityId: ctx.definition.id, patch: request.patch}, {now: timestamp(options, ctx)});
  requireDomain(validation.ok, 'temporal.patch', validation.reason ?? 'entity patch rejected');
  const impact = target.kind === 'time-key' ? temporalKeyCreationImpact(state, {setupId: ctx.setup.id, entityId: ctx.definition.id, timeMs: atTime}) : null;
  const requiresConfirmation = target.kind === 'time-key' && impact.requiresConfirmation;
  const action = defined({type: 'edit-entity', setupId: ctx.setup.id, entityId: ctx.definition.id, timeMs: atTime, target, patch: clone(request.patch), source: request.source});
  return {ok: true, kind: 'temporal-edit', state, changed: false, lane: ctx.lane, scope: {kind: 'world-space'}, target, impact, requiresConfirmation, needsConfirmation: requiresConfirmation,
    intent: {entity: {id: ctx.definition.id, label: ctx.definition.label}, impact}, action, fingerprint: fingerprint(ctx), accepted: false};
}

/** Cache result.prepared after every preview. It binds subsequent latest-patch
 * writes to the same key and fingerprints the state produced by this edit. */
export function applyPreparedTemporalEdit(state, prepared, options = {}) {
  requireDomain(isRecord(prepared) && prepared.ok && prepared.kind === 'temporal-edit', 'temporal.prepared', 'requires a prepared edit');
  const ctx = context(state, prepared.action.setupId, prepared.action.entityId), denied = guard(state, ctx, options); if (denied) return denied;
  if (prepared.fingerprint !== fingerprint(ctx)) return refusal(state, ctx, 'stale-preparation');
  if (prepared.requiresConfirmation && !prepared.accepted && options.confirmed !== true) return {...refusal(state, ctx, options.confirmed === false ? 'cancelled' : 'confirmation-required'), prepared};
  const patch = options.patch ?? prepared.action.patch;
  const refreshed = prepareTemporalEdit(state, defined({setupId: ctx.setup.id, entityId: ctx.definition.id, timeMs: prepared.action.timeMs, target: prepared.target, patch, source: prepared.action.source}), options);
  if (!refreshed.ok) return refreshed;
  let edited;
  if (prepared.target.kind === 'base') edited = reduceEntityAction(state, {type: 'update', setupId: ctx.setup.id, entityId: ctx.definition.id, patch}, {now: timestamp(options, ctx)});
  else {
    const initial = sampledEntity(state, ctx, prepared.action.timeMs), temporary = clone(state), setup = temporary.scenePlay.worldSpace.setups.find(item => item.id === ctx.setup.id);
    setup.entityStates = setup.entityStates.map(item => item.entityId === ctx.definition.id ? initial : item);
    const applied = reduceEntityAction(temporary, {type: 'update', setupId: ctx.setup.id, entityId: ctx.definition.id, patch}, {now: timestamp(options, ctx)});
    const snapshot = applied.state.scenePlay.worldSpace.setups.find(item => item.id === ctx.setup.id).entityStates.find(item => item.entityId === ctx.definition.id), extra = [];
    if (Object.hasOwn(patch, 'lookTarget')) extra.push({property: 'entity.lookTarget', value: {kind: 'look-target', value: snapshot.lookTarget}, interpolation: 'hold'});
    if (Object.hasOwn(patch, 'heldEntityId')) extra.push({property: 'entity.heldEntityId', value: {kind: 'text', value: snapshot.heldEntityId ?? null}, interpolation: 'hold'});
    edited = saveKey(state, ctx, {...prepared.action, type: 'save-key', snapshot}, options, extra);
  }
  const target = edited.selection ? {kind: 'selected-key', ...edited.selection} : {kind: 'base'};
  const nextPrepared = {...prepared, state: edited.state, target, action: {...prepared.action, target, patch: clone(patch)}, fingerprint: fingerprint(context(edited.state, ctx.setup.id, ctx.definition.id)), accepted: true, requiresConfirmation: false, needsConfirmation: false};
  return result(state, edited.state, ctx, prepared.action, {selection: edited.selection ?? null, prepared: nextPrepared});
}

function durationAllocation(total, distances) {
  const sum = distances.reduce((a, b) => a + b, 0), items = distances.map((distance, index) => {
    const exact = sum > 0 ? total * distance / sum : total / distances.length;
    return {duration: Math.max(1, Math.floor(exact)), exact, fraction: exact - Math.floor(exact), index};
  });
  let remaining = total - items.reduce((a, item) => a + item.duration, 0);
  if (remaining > 0) {
    const ranked = items.slice().sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < remaining; index++) ranked[index % ranked.length].duration++;
  } else if (remaining < 0) {
    const ranked = items.slice().sort((a, b) => b.duration - b.exact - (a.duration - a.exact) || b.index - a.index);
    while (remaining < 0) {const item = ranked.find(candidate => candidate.duration > 1); if (!item) break; item.duration--; remaining++;}
  }
  return items.map(item => item.duration);
}

const ACTION_FIELDS = {
  'save-key': ['timeMs', 'keyId', 'label', 'snapshot'], 'remove-key': ['keyId'], 'move-key': ['keyId', 'timeMs'], 'rename-key': ['keyId', 'label'],
  'remove-track': [], 'set-duration': ['durationMs'], 'redistribute-timing': [],
  'set-key-value': ['keyId', 'property', 'value', 'interpolation', 'channelId'], 'remove-key-value': ['keyId', 'property'], 'set-channel': ['property', 'channelId', 'values'], 'remove-channel': ['property'],
  'set-endpoint-control': ['endpoint', 'point'], 'set-segment-bend': ['fromKeyId', 'toKeyId', 'point', 't'], 'clear-segment-bend': ['fromKeyId', 'toKeyId'],
  'edit-entity': ['timeMs', 'selectedKeyId', 'selectedKey', 'target', 'patch', 'confirmed']
};

/** Synchronous persistent domain reducer. Caller owns its history transaction. */
export function reduceTemporalAction(state, action, options = {}) {
  requireDomain(isRecord(action) && Object.hasOwn(ACTION_FIELDS, action.type), 'temporal.action.type', 'unknown temporal action');
  fields(action, ['type', 'setupId', 'entityId', 'source', ...ACTION_FIELDS[action.type]], 'temporal.action');
  if (action.source !== undefined) text(action.source, 'temporal.source');
  if (action.keyId !== undefined) text(action.keyId, 'temporal.keyId');
  if (action.channelId !== undefined) text(action.channelId, 'temporal.channelId');
  if (action.confirmed !== undefined) requireDomain(typeof action.confirmed === 'boolean', 'temporal.confirmed', 'must be boolean');
  const ctx = context(state, action.setupId, action.type === 'set-duration' ? undefined : action.entityId), denied = guard(state, ctx, options); if (denied) return denied;
  if (action.type !== 'set-duration') requireDomain(!!ctx.definition, 'temporal.entityId', 'entity is required');
  if (action.type === 'edit-entity') {
    const {type, confirmed, ...request} = action, prepared = prepareTemporalEdit(state, request, options);
    return prepared.ok ? applyPreparedTemporalEdit(state, prepared, {...options, confirmed}) : prepared;
  }
  if (action.type === 'save-key') return saveKey(state, ctx, action, options);
  if (action.type === 'set-duration') {
    const durationMs = Math.max(temporalDurationMinimum(state, ctx.setup.id).durationMs, time(action.durationMs, 'temporal.durationMs'));
    return result(state, setTemporal(state, ctx.setup.id, {...(ctx.setup.temporal ?? {tracks: []}), durationMs}, timestamp(options, ctx)), ctx, action, {durationMs});
  }
  const original = trackOf(ctx.setup, ctx.definition.id);
  if (!original) return refusal(state, ctx, 'missing-track');
  let track = clone(original), temporal = clone(ctx.setup.temporal), selected = null, cleanup = false;
  const keyRequired = ['remove-key', 'move-key', 'rename-key', 'set-key-value', 'remove-key-value'].includes(action.type);
  const key = keyRequired ? keyById(track, action.keyId) : null;
  if (keyRequired) {text(action.keyId, 'temporal.keyId'); if (!key) return refusal(state, ctx, 'missing-key');}
  switch (action.type) {
    case 'remove-track': temporal.tracks = temporal.tracks.filter(item => item.id !== original.id); cleanup = true; break;
    case 'remove-key': {
      track.keys = track.keys.filter(item => item.id !== key.id);
      track.channels = track.channels.map(channel => ({...channel, values: channel.values.filter(sample => sample.keyId !== key.id)}));
      track.segments = (track.segments ?? []).filter(segment => segment.fromKeyId !== key.id && segment.toKeyId !== key.id);
      track = endpointChanges(original, track); cleanup = true; break;
    }
    case 'move-key': {
      const range = temporalKeyMoveRange(track, key.id, temporal.durationMs), at = time(action.timeMs);
      key.timeMs = Math.max(range.minTimeMs, Math.min(range.maxTimeMs, at)); track.keys.sort(byTime); selected = {entityId: ctx.definition.id, keyId: key.id}; cleanup = true; break;
    }
    case 'rename-key': text(action.label, 'temporal.key.label'); key.label = action.label; break;
    case 'set-key-value': track = upsertValue(ctx, track, key.id, action.property, action.value, action.interpolation, action.channelId); cleanup = true; break;
    case 'remove-key-value': requireDomain(Object.hasOwn(TEMPORAL_CHANNEL_KINDS, action.property), 'temporal.property', 'unknown temporal property'); track.channels = track.channels.map(channel => channel.property === action.property ? {...channel, values: channel.values.filter(sample => sample.keyId !== key.id)} : channel); cleanup = true; break;
    case 'set-channel': {
      requireDomain(Array.isArray(action.values), 'temporal.channel.values', 'must be an array');
      const channelId = action.channelId ?? track.channels.find(channel => channel.property === action.property)?.id;
      const ids = new Set(); track.channels = track.channels.filter(channel => channel.property !== action.property);
      for (const sample of action.values) {
        fields(sample, ['keyId', 'value', 'interpolation'], 'temporal.channel.sample'); text(sample.keyId, 'temporal.channel.keyId');
        requireDomain(!ids.has(sample.keyId), 'temporal.channel.keyId', 'duplicate sample key', 'duplicate-id'); ids.add(sample.keyId);
        requireDomain(!!keyById(track, sample.keyId), 'temporal.channel.keyId', 'sample references missing key', 'missing-relation');
        track = upsertValue(ctx, track, sample.keyId, action.property, sample.value, sample.interpolation, channelId);
      }
      requireDomain(Object.hasOwn(TEMPORAL_CHANNEL_KINDS, action.property), 'temporal.property', 'unknown temporal property'); cleanup = true; break;
    }
    case 'remove-channel': requireDomain(Object.hasOwn(TEMPORAL_CHANNEL_KINDS, action.property), 'temporal.property', 'unknown temporal property'); track.channels = track.channels.filter(channel => channel.property !== action.property); cleanup = true; break;
    case 'redistribute-timing': {
      if (track.keys.length < 3) return result(state, state, ctx, action);
      const segments = new Map(temporalPositionPathSegments(track).map(segment => [`${segment.fromKeyId}\0${segment.toKeyId}`, segment]));
      const spans = track.keys.slice(0, -1).map((item, index) => {
        const next = track.keys[index + 1], segment = segments.get(`${item.id}\0${next.id}`);
        return {duration: next.timeMs - item.timeMs, length: segment?.length ?? 0, eligible: !!segment && segment.interpolation !== 'hold' && segment.length > 1e-8};
      });
      const eligible = spans.filter(span => span.eligible); if (eligible.length < 2) return result(state, state, ctx, action);
      const durations = durationAllocation(eligible.reduce((sum, span) => sum + span.duration, 0), eligible.map(span => span.length));
      let index = 0, at = track.keys[0].timeMs;
      spans.forEach((span, i) => {at += span.eligible ? durations[index++] : span.duration; track.keys[i + 1].timeMs = at;}); break;
    }
    case 'set-endpoint-control': {
      requireDomain(['start', 'end'].includes(action.endpoint), 'temporal.endpoint', 'unknown endpoint');
      requireDomain(temporalPositionPathSegments(track).length > 0, 'temporal.path', 'path has no position segment');
      track.pathEndpointControls = {...track.pathEndpointControls, [action.endpoint]: {point: clone(action.point)}}; break;
    }
    case 'set-segment-bend': case 'clear-segment-bend': {
      const segments = temporalPositionPathSegments(track), segment = segments.find(item => item.fromKeyId === action.fromKeyId && item.toKeyId === action.toKeyId);
      requireDomain(!!segment && segment.interpolation !== 'hold', 'temporal.segment', 'requires an adjacent non-hold position segment');
      track.segments = (track.segments ?? []).filter(item => item.fromKeyId !== action.fromKeyId || item.toKeyId !== action.toKeyId);
      if (action.type === 'set-segment-bend') {
        finite(action.t ?? .5, 'temporal.bend.t'); requireDomain((action.t ?? .5) >= .05 && (action.t ?? .5) <= .95, 'temporal.bend.t', 'bend must lie within [.05,.95]');
        track.segments.push({fromKeyId: action.fromKeyId, toKeyId: action.toKeyId, transition: {spatialBend: {point: clone(action.point), t: action.t ?? .5}}});
      } break;
    }
    default: requireDomain(false, 'temporal.action.type', 'unsupported action');
  }
  if (action.type !== 'remove-track') temporal.tracks = temporal.tracks.map(item => item.id === original.id ? track : item);
  if (cleanup) temporal = tidyTemporal(temporal);
  const next = setTemporal(state, ctx.setup.id, temporal, timestamp(options, ctx));
  return result(state, next, ctx, action, {selection: selected});
}
