import {clone, same} from './invariants.mjs';
import {resolveEntityControl} from './entity-actions.mjs';
import {temporalPositionPathSegments, sampleTemporalSetupState} from './camera-shot-sampling.mjs';
import {entityStateHeadingRadians} from './transform-coordinates.mjs';

const palette = ['#C97984', '#6F93C8', '#D0A552', '#82AD6B', '#A681C8', '#63B5A2'];
const selectedId = value => typeof value === 'string' ? value : value?.entityId ?? value?.id ?? null;
const mix = (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t});
function colorOf(entity) {
  if (entity.color?.trim()) return entity.color.trim();
  let hash = 2166136261;
  for (let i = 0; i < entity.id.length; i++) hash = Math.imul(hash ^ entity.id.charCodeAt(i), 16777619);
  return palette[(hash >>> 0) % palette.length];
}
function cubic(segment, t) {
  const s = 1 - t, weights = [s ** 3, 3 * s * s * t, 3 * s * t * t, t ** 3];
  return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, [segment.p0, segment.p1, segment.p2, segment.p3].reduce((sum, point, i) => sum + point[axis] * weights[i], 0)]));
}
function curvePoint(segment, t) {
  const point = cubic(segment, t); if (!segment.bend) return point;
  const bendT = Math.max(.05, Math.min(.95, segment.bend.t)), relative = Math.max(0, Math.min(1, t <= bendT ? t / bendT : (1 - t) / (1 - bendT))), weight = relative * relative * (3 - 2 * relative), original = cubic(segment, bendT);
  return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, point[axis] + (segment.bend.point[axis] - original[axis]) * weight]));
}
function timeParameter(segment, timeT) {
  if (segment.straight || !segment.lengths || segment.lengths.at(-1) <= 1e-8) return timeT;
  const target = segment.lengths.at(-1) * timeT; let index = 1;
  while (index < 64 && segment.lengths[index] < target) index++;
  const start = segment.lengths[index - 1], length = segment.lengths[index] - start;
  return (index - 1 + (length <= 1e-8 ? 0 : (target - start) / length)) / 64;
}
const samplePoint = (segment, t) => segment.interpolation === 'hold' && t < 1 ? clone(segment.p0) : curvePoint(segment, timeParameter(segment, t));
const finiteXZ = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);
const positionAt = (subject, kind) => kind === 'camera' && subject.camera ? subject.camera.position : subject.transform.position;

/** Domain descriptors and author leases only. SVG, projection and pointer
 * capture belong to plan-view; sampled live entity states are never authored. */
export function createPlanTrajectories({getState, getAuthorState = getState, session, temporal,
  getRuntime = () => null, isCurrent = () => session?.isCurrent?.() !== false,
  getSelected = () => null, onSelect = () => true, getBusy = () => false,
  onChange = () => {}, onError = () => {}, beginEntityEdit = null} = {}) {
  if (typeof getAuthorState !== 'function' || !session?.history || !temporal?.beginTrajectoryEdit) throw new TypeError('俯视轨迹需要作者状态和时间轴事务桥');
  let disposed = false, active = null, pending = null, serial = 0, geometryCache = null, playheadCache = null, geometryBuilds = 0;
  const report = error => {try {onError(error);} catch {}};
  const emit = () => {try {onChange();} catch (error) {report(error);}};
  const stateContext = () => {const state = getAuthorState(), space = state.scenePlay.worldSpace, setup = space.setups.find(item => item.id === space.activeSetupId); return {state, space, setup};};
  function identity() {
    const {state, space} = stateContext(), {revision, ...fence} = session.getFence?.() ?? {}, runtime = getRuntime();
    return {worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId, source: clone(space.source), fence: clone(fence), runtime, graph: runtime?.graph, nativeSource: runtime?.graph?.source};
  }
  const current = token => {
    const next = identity();
    return !disposed && isCurrent() && token.runtime === next.runtime && token.graph === next.graph && token.nativeSource === next.nativeSource && same({...token, runtime: null, graph: null, nativeSource: null}, {...next, runtime: null, graph: null, nativeSource: null});
  };
  function subjectAt(state, setup, entityId, timeMs) {
    return sampleTemporalSetupState(state, {setupId: setup.id, stageId: setup.stageId}, timeMs).entityStates.find(item => item.entityId === entityId);
  }
  function readPaths() {
    if (disposed || !isCurrent()) return [];
    const {state, setup, space} = stateContext(); if (setup.kind !== 'independent') return [];
    const view = temporal.read?.() ?? {}, status = temporal.getTemporalStatus?.() ?? {}, selection = selectedId(getSelected()), selectedKey = temporal.selectedKey, playheadMs = view.playheadMs ?? 0;
    const {revision, ...fence} = session.getFence?.() ?? {}, nativeSource = getRuntime()?.graph?.source;
    const cacheKey = JSON.stringify({worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: setup.id, source: space.source, fence,
      // Legacy hosts without an author epoch cannot safely identify geometry by fence alone.
      ...(fence.editEpoch === undefined ? {setup, entities: space.entities} : {})});
    if (!geometryCache || geometryCache.key !== cacheKey || geometryCache.nativeSource !== nativeSource) {
      const sampledTimes = new Map();
      const sampledSubject = (entityId, timeMs) => {
        if (!sampledTimes.has(timeMs)) sampledTimes.set(timeMs, new Map(sampleTemporalSetupState(state, {setupId: setup.id, stageId: setup.stageId}, timeMs).entityStates.map(subject => [subject.entityId, subject])));
        return sampledTimes.get(timeMs).get(entityId);
      };
      const paths = (setup.temporal?.tracks ?? []).flatMap(track => {
        const entity = space.entities.find(item => item.id === track.owner.entityId); if (!entity || entity.stageId !== setup.stageId) return [];
        const c = resolveEntityControl(state, {entityId: entity.id}), channel = track.channels.find(item => item.property === 'entity.transform.position'); if (!channel?.values.length) return [];
        const values = new Map(channel.values.map(item => [item.keyId, item]));
        const keys = track.keys.filter(key => values.has(key.id)).slice().sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id)).map(key => {
          const subject = sampledSubject(entity.id, key.timeMs);
          return {...clone(key), keyId: key.id, position: clone(values.get(key.id).value.value), heading: entityStateHeadingRadians(entity.kind, subject), ...(entity.kind === 'camera' && subject.camera ? {camera: clone(subject.camera)} : {})};
        });
        const rawSegments = temporalPositionPathSegments(track), segments = rawSegments.map(segment => {
          const {lengths, straight, ...descriptor} = clone(segment);
          return {...descriptor, id: `${segment.fromKeyId}:${segment.toKeyId}`, interpolation: segment.interpolation === 'hold' ? 'hold' : 'cubic', points: Array.from({length: 65}, (_, i) => samplePoint(segment, i / 64)), parameters: Array.from({length: 65}, (_, i) => timeParameter(segment, i / 64))};
        });
        const flowing = rawSegments.filter(segment => segment.interpolation !== 'hold'), controls = [];
        if (flowing.length) {
          const first = flowing[0], last = flowing.at(-1);
          // Endpoint handles are Bezier p1/p2, never key positions or midpoints.
          for (const [endpoint, segment, position, anchor, fallbackPoint] of [['start', first, first.p1, first.p0, first.p3], ['end', last, last.p2, last.p3, last.p0]]) controls.push({id: `${track.id}:endpoint:${endpoint}`, kind: 'endpoint', endpoint, position: clone(position), anchor: clone(anchor), screenProxy: {anchors: [clone(anchor)], fallbackPoint: clone(fallbackPoint)}});
          for (const segment of flowing) controls.push({id: `${track.id}:bend:${segment.fromKeyId}:${segment.toKeyId}`, kind: 'bend', fromKeyId: segment.fromKeyId, toKeyId: segment.toKeyId, t: segment.bend?.t ?? .5,
            position: clone(segment.bend?.point ?? curvePoint(segment, .5)), anchor: mix(segment.p0, segment.p3, .5), screenProxy: {anchors: [clone(segment.p0), clone(segment.p3)], fallbackPoint: clone(segment.p3)}});
        }
        return [{id: track.id, entityId: entity.id, kind: entity.kind === 'actor' ? 'person' : entity.kind === 'prop' ? 'object' : 'camera', label: entity.label, color: colorOf(entity), domainReadOnly: c.baselineReadOnly || c.locked || !c.setupState, visible: c.setupState?.visible !== false, keys, segments, controls}];
      });
      geometryCache = {key: cacheKey, nativeSource, paths}; playheadCache = null; geometryBuilds++;
    }
    if (!playheadCache || playheadCache.timeMs !== playheadMs) playheadCache = {timeMs: playheadMs,
      subjects: new Map(sampleTemporalSetupState(state, {setupId: setup.id, stageId: setup.stageId}, playheadMs).entityStates.map(subject => [subject.entityId, subject]))};
    return clone(geometryCache.paths).map(path => {
      const {domainReadOnly, ...descriptor} = path, selected = selection === path.entityId || selectedKey?.entityId === path.entityId;
      const readOnly = !!view.readOnly || domainReadOnly, draggable = !readOnly && !status.playing && !status.scrubbing && !status.confirming && !getBusy();
      const subject = playheadCache.subjects.get(path.entityId), entityKind = path.kind === 'person' ? 'actor' : path.kind === 'object' ? 'prop' : 'camera';
      return {...descriptor, selected, readOnly, draggable, keys: path.keys.map(key => ({...key, selected: selectedKey?.entityId === path.entityId && selectedKey.keyId === key.id, draggable})),
        controls: selected && draggable ? path.controls : [], playhead: {position: clone(positionAt(subject, entityKind)), timeMs: playheadMs, heading: entityStateHeadingRadians(entityKind, subject)}};
    });
  }
  async function beginKeyPose(path, key, kind) {
    if (typeof beginEntityEdit !== 'function' || !key || kind === 'key-fov' && path.kind !== 'camera') return null;
    const preparation = {id: ++serial, token: identity()}; pending = preparation;
    const targetSelected = () => {const value = temporal.selectedKey; return value?.entityId === path.entityId && value.keyId === key.id && value.setupId === stateContext().setup.id;};
    const valid = () => pending === preparation && current(preparation.token) && !getBusy() && targetSelected();
    try {
      if (await temporal.selectKey(path.entityId, key.id) === false || !valid()) {if (pending === preparation) pending = null; return null;}
      const bridge = await beginEntityEdit({entityId: path.entityId, kind: kind === 'key-fov' ? 'fov' : 'heading', marker: {id: path.entityId, entityId: path.entityId, kind: path.kind, position: clone(key.position), heading: key.heading, ...(key.camera ? {camera: clone(key.camera), fov: key.camera.fov, frameAspectRatio: key.camera.frameAspectRatio} : {})}});
      if (!bridge || !valid()) {bridge?.onCancel(); if (pending === preparation) pending = null; return null;}
      const gesture = {preparation, bridge, token: identity(), ended: false, cancelled: false}; active = gesture; pending = null;
      const guard = () => {
        if (gesture.cancelled || gesture.ended || active !== gesture) return false;
        if (!current(gesture.token) || getBusy() || !targetSelected()) {cancel(); return false;}
        return true;
      };
      const move = patch => {
        if (!guard() || !Number.isFinite(patch?.heading) || kind === 'key-fov' && !Number.isFinite(patch?.fov)) return false;
        const accepted = bridge.onMove({heading: patch.heading, ...(kind === 'key-fov' ? {fov: patch.fov} : {})});
        if (accepted) {gesture.token = identity(); emit();} return accepted === true;
      };
      emit();
      return {onMove: move, onEnd(patch) {
        if (patch && !move(patch) || !guard()) return false;
        const accepted = bridge.onEnd(), completed = accepted === true || session.history.getActiveTransaction() === null; if (completed) {gesture.ended = true; active = null; emit();} return completed;
      }, onCancel() {if (gesture.cancelled) return true; if (gesture.ended || active !== gesture) return false; return cancel();}};
    } catch (error) {report(error); if (pending === preparation) pending = null; return null;}
  }
  async function select({pathId, keyId} = {}) {
    if (disposed || pending || active || !isCurrent() || getBusy()) return false;
    const path = readPaths().find(item => item.id === pathId); if (!path) return false;
    if (keyId !== undefined) return temporal.selectKey(path.entityId, keyId);
    return await onSelect(path.entityId) !== false;
  }
  async function beginEdit(request = {}) {
    if (disposed || pending || active || !isCurrent() || getBusy() || session.history.getActiveTransaction() || !['key', 'bend', 'endpoint', 'path', 'key-heading', 'key-fov'].includes(request.kind)) return null;
    let preparation;
    try {
      const path = readPaths().find(item => item.id === request.pathId); if (!path?.draggable || request.entityId !== undefined && request.entityId !== path.entityId) return null;
      const {state, setup} = stateContext(), kind = request.kind, control = path.controls.find(item => kind === 'endpoint' ? item.kind === kind && item.endpoint === request.endpoint : item.kind === kind && item.fromKeyId === request.fromKeyId && item.toKeyId === request.toKeyId);
      const key = path.keys.find(item => item.id === request.keyId);
      if (kind === 'key-heading' || kind === 'key-fov') return beginKeyPose(path, key, kind);
      let original, timeMs, actionFor;
      if (kind === 'key') {
        if (!key) return null; original = key.position; timeMs = key.timeMs;
        const sample = setup.temporal.tracks.find(item => item.id === path.id).channels.find(item => item.property === 'entity.transform.position').values.find(item => item.keyId === key.id);
        actionFor = point => ({type: 'set-key-value', keyId: key.id, property: 'entity.transform.position', value: {kind: 'vec3', value: point}, ...(sample.interpolation === undefined ? {} : {interpolation: sample.interpolation})});
      } else if (kind === 'path') {
        const segment = path.segments.find(item => item.fromKeyId === request.fromKeyId && item.toKeyId === request.toKeyId), t = request.t;
        if (!segment || segment.interpolation === 'hold' || !Number.isFinite(t) || t <= .05 || t >= .95 || !finiteXZ(request.position)) return null;
        const track = setup.temporal.tracks.find(item => item.id === path.id), raw = temporalPositionPathSegments(track).find(item => item.fromKeyId === segment.fromKeyId && item.toKeyId === segment.toKeyId);
        original = curvePoint(raw, t);
        const radius = Math.max(Math.hypot(segment.p0.x - segment.p3.x, segment.p0.y - segment.p3.y, segment.p0.z - segment.p3.z), 1) * .05;
        const pointer = {x: request.position.x, y: original.y, z: request.position.z};
        if ([segment.p0, segment.p3].some(point => Math.hypot(pointer.x - point.x, pointer.y - point.y, pointer.z - point.z) <= radius)) return null;
        timeMs = Number.isFinite(request.timeMs) ? Math.round(request.timeMs) : Math.round((segment.fromTimeMs + segment.toTimeMs) / 2);
        actionFor = point => ({type: 'set-segment-bend', fromKeyId: segment.fromKeyId, toKeyId: segment.toKeyId, point, t});
      } else {
        if (!control) return null; original = control.position;
        const segment = path.segments.find(item => kind === 'endpoint' ? request.endpoint === 'start' ? item.interpolation !== 'hold' : item === path.segments.filter(value => value.interpolation !== 'hold').at(-1) : item.fromKeyId === control.fromKeyId && item.toKeyId === control.toKeyId);
        timeMs = kind === 'endpoint' ? request.endpoint === 'start' ? segment.fromTimeMs : segment.toTimeMs : Math.round((segment.fromTimeMs + segment.toTimeMs) / 2);
        actionFor = point => kind === 'endpoint' ? {type: 'set-endpoint-control', endpoint: control.endpoint, point} : {type: 'set-segment-bend', fromKeyId: control.fromKeyId, toKeyId: control.toKeyId, point, t: control.t};
      }
      const token = identity(); preparation = {id: ++serial, token}; pending = preparation;
      if (await onSelect(path.entityId) === false || pending !== preparation || !current(token)) {if (pending === preparation) pending = null; return null;}
      const bridge = await temporal.beginTrajectoryEdit({entityId: path.entityId, keyId: key?.id, timeMs, label: `director.temporal.plan.${kind}`, isValid: () => pending === preparation || active?.preparation === preparation});
      if (!bridge || pending !== preparation || disposed || !isCurrent()) {bridge?.onCancel(); if (pending === preparation) pending = null; return null;}
      const gesture = {preparation, bridge, token: identity(), original: clone(original), ended: false, cancelled: false}; active = gesture; pending = null;
      const move = patch => {
        if (gesture.cancelled || gesture.ended || active !== gesture) return false;
        if (!current(gesture.token) || getBusy()) {cancel(); return false;}
        if (!finiteXZ(patch?.position)) return false;
        const point = {x: patch.position.x, y: gesture.original.y, z: patch.position.z};
        if (!bridge.onMove(actionFor(point))) return false;
        gesture.token = identity(); emit(); return true;
      };
      emit();
      return {onMove: move, onEnd(patch) {
        if (gesture.cancelled || gesture.ended || active !== gesture) return false;
        if (patch?.position && !move(patch)) return false;
        if (!current(gesture.token) || getBusy()) {cancel(); return false;}
        const accepted = bridge.onEnd(), completed = accepted === true || session.history.getActiveTransaction() === null; if (completed) {gesture.ended = true; active = null; emit();} return completed;
      }, onCancel() {if (gesture.cancelled) return true; if (gesture.ended || active !== gesture) return false; return cancel();}};
    } catch (error) {report(error); if (pending === preparation) pending = null; return null;}
  }
  function readContext({pathId, kind, keyId, fromKeyId, toKeyId} = {}) {
    if (disposed || pending || active || !isCurrent() || getBusy()) return null;
    const path = readPaths().find(item => item.id === pathId); if (!path?.draggable) return null;
    const token = identity(), {setup} = stateContext();
    const invoke = action => current(token) && !pending && !active && !getBusy() ? temporal.temporalAction({...action, entityId: path.entityId, setupId: setup.id, source: 'plan-view'}) : {ok: false, reason: 'stale'};
    if (kind === 'key') {
      const key = path.keys.find(item => item.id === keyId); if (!key) return null;
      return {kind, pathId, entityId: path.entityId, keyId, label: key.label ?? '', timeMs: key.timeMs,
        onDelete: () => invoke({type: 'remove-key', keyId})};
    }
    const segment = path.segments.find(item => item.fromKeyId === fromKeyId && item.toKeyId === toKeyId);
    if (kind !== 'bend' || !segment || segment.interpolation === 'hold') return null;
    return {kind, pathId, entityId: path.entityId, fromKeyId, toKeyId,
      onReset: () => current(token) ? resetBend({pathId, fromKeyId, toKeyId}) : false};
  }
  async function resetBend({pathId, fromKeyId, toKeyId} = {}) {
    const lease = await beginEdit({kind: 'bend', pathId, fromKeyId, toKeyId});
    if (!lease || !active) return false;
    const gesture = active;
    if (!gesture.bridge.onMove({type: 'clear-segment-bend', fromKeyId, toKeyId})) {lease.onCancel(); return false;}
    gesture.token = identity();
    return lease.onEnd();
  }
  function cancel() {
    serial++;
    if (pending) {pending = null; return true;}
    if (!active) return false;
    const gesture = active, accepted = gesture.bridge.onCancel();
    if (accepted) {gesture.cancelled = true; active = null; emit();} return accepted === true;
  }
  function dispose() {if (disposed) return false; cancel(); disposed = true; return true;}
  return {readPaths, beginEdit, select, readContext, resetBend, cancel, dispose, getDiagnostics: () => ({geometryBuilds})};
}
