import {Euler, Quaternion} from 'three';
import {clone, isRecord, requireDomain} from './invariants.mjs';
import {assertState, assertCamera} from './schema.mjs';
import {renderSetup} from './world-space.mjs';
import {cameraRotationToPlan, planRotationToCamera} from './transform-coordinates.mjs';
import {focalLengthToFov, fovToFocalLength} from './camera-optics.mjs';

const clamp = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;
const vector = (a, b, t) => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t)});
const add = (a, b) => ({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z});
const subtract = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const scale = (a, t) => ({x: a.x * t, y: a.y * t, z: a.z * t});
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const equalPoint = (a, b) => ['x', 'y', 'z'].every(axis => Math.abs(a[axis] - b[axis]) <= 1e-10);
const quaternion = value => new Quaternion().setFromEuler(new Euler(value.x, value.y, value.z, value.order ?? 'XYZ'));

// E UOe/WOe uses shortest quaternion interpolation with a .9995 nlerp
// threshold, which differs from Three's built-in slerp threshold.
function rotation(a, b, t) {
  const from = quaternion(a), to = quaternion(b); let cosine = from.dot(to);
  if (cosine < 0) {to.set(-to.x, -to.y, -to.z, -to.w); cosine = -cosine;}
  let result;
  if (cosine > .9995) result = new Quaternion(...from.toArray().map((value, index) => lerp(value, to.toArray()[index], t))).normalize();
  else {
    const angle = Math.acos(Math.max(-1, Math.min(1, cosine))), sine = Math.sin(angle), weightB = Math.sin(angle * t) / sine;
    const weightA = Math.cos(angle * t) - cosine * weightB;
    result = new Quaternion(...from.toArray().map((value, index) => weightA * value + weightB * to.toArray()[index]));
  }
  const euler = new Euler().setFromQuaternion(result.normalize(), a.order ?? b.order ?? 'XYZ');
  return {x: euler.x, y: euler.y, z: euler.z, order: euler.order};
}
function interpolate(a, b, t) {
  if (a.kind !== b.kind) return clone(a);
  if (a.kind === 'number') return {kind: a.kind, value: lerp(a.value, b.value, t)};
  if (a.kind === 'vec3') return {kind: a.kind, value: vector(a.value, b.value, t)};
  if (a.kind === 'euler3') return {kind: a.kind, value: rotation(a.value, b.value, t)};
  // SF/nY holds discrete values until the next exact key, even when labeled linear.
  return clone(a);
}
function samples(track, channel) {
  const keys = new Map(track.keys.map(key => [key.id, key]));
  return (channel?.values ?? []).map(value => ({key: keys.get(value.keyId), value})).sort((a, b) => a.key.timeMs - b.key.timeMs || a.key.id.localeCompare(b.key.id));
}
function sample(values, timeMs, resolve = interpolate) {
  if (!values.length || timeMs < values[0].key.timeMs) return null;
  const last = values.at(-1); if (timeMs >= last.key.timeMs) return clone(last.value.value);
  for (let index = 0; index < values.length - 1; index++) {
    const a = values[index], b = values[index + 1];
    if (timeMs < a.key.timeMs || timeMs > b.key.timeMs) continue;
    if (timeMs === a.key.timeMs) return clone(a.value.value);
    if (timeMs === b.key.timeMs) return clone(b.value.value);
    if (a.value.interpolation === 'hold') return clone(a.value.value);
    return resolve(a.value.value, b.value.value, (timeMs - a.key.timeMs) / Math.max(1, b.key.timeMs - a.key.timeMs));
  }
  return clone(last.value.value);
}
function bezier(segment, t) {
  const s = 1 - t;
  return add(add(scale(segment.p0, s ** 3), scale(segment.p1, 3 * s * s * t)), add(scale(segment.p2, 3 * s * t * t), scale(segment.p3, t ** 3)));
}
function curvePoint(segment, t) {
  const original = bezier(segment, t); if (!segment.bend) return original;
  const bendT = Math.max(.05, Math.min(.95, segment.bend.t));
  const relative = clamp(t <= bendT ? t / bendT : (1 - t) / (1 - bendT));
  const weight = relative * relative * (3 - 2 * relative);
  return add(original, scale(subtract(segment.bend.point, bezier(segment, bendT)), weight));
}
function curveSegment(frames, index, track) {
  const tangent = i => {
    const current = frames[i].value.value.value, previous = frames[i - 1]?.value.value.value, next = frames[i + 1]?.value.value.value;
    return !previous && next ? subtract(next, current) : previous && !next ? subtract(current, previous) : previous && next ? scale(subtract(next, previous), .5) : {x: 0, y: 0, z: 0};
  };
  const a = frames[index], b = frames[index + 1], p0 = a.value.value.value, p3 = b.value.value.value;
  const override = track.segments?.filter(item => item.fromKeyId === a.key.id && item.toKeyId === b.key.id).at(-1);
  const segment = {p0, p3, p1: index === 0 && track.pathEndpointControls?.start ? track.pathEndpointControls.start.point : add(p0, scale(tangent(index), 1 / 3)),
    p2: index === frames.length - 2 && track.pathEndpointControls?.end ? track.pathEndpointControls.end.point : subtract(p3, scale(tangent(index + 1), 1 / 3)),
    bend: override?.transition?.spatialBend};
  segment.straight = !segment.bend && equalPoint(segment.p1, vector(p0, p3, 1 / 3)) && equalPoint(segment.p2, vector(p0, p3, 2 / 3));
  // E Xq/cLe: exactly 64 chords, including spatial bend, then inverse
  // cumulative-distance lookup. Time follows distance, not Bezier parameter.
  if (!segment.straight) {
    segment.lengths = [0]; let previous = curvePoint(segment, 0);
    for (let step = 1; step <= 64; step++) {const point = curvePoint(segment, step / 64); segment.lengths.push(segment.lengths.at(-1) + distance(previous, point)); previous = point;}
  }
  return segment;
}
function position(track, channel, timeMs) {
  const frames = samples(track, channel); if (!frames.length || timeMs < frames[0].key.timeMs) return null;
  if (timeMs >= frames.at(-1).key.timeMs) return clone(frames.at(-1).value.value);
  for (let index = 0; index < frames.length - 1; index++) {
    const a = frames[index], b = frames[index + 1]; if (timeMs < a.key.timeMs || timeMs > b.key.timeMs) continue;
    if (timeMs === a.key.timeMs) return clone(a.value.value);
    if (timeMs === b.key.timeMs) return clone(b.value.value);
    if (a.value.interpolation === 'hold') return clone(a.value.value);
    const segment = curveSegment(frames, index, track), timeT = (timeMs - a.key.timeMs) / Math.max(1, b.key.timeMs - a.key.timeMs);
    if (segment.straight) return {kind: 'vec3', value: vector(segment.p0, segment.p3, timeT)};
    const total = segment.lengths.at(-1); let pathT = timeT;
    if (total > 1e-8) {
      const target = total * timeT; let low = 0, high = 64;
      while (low < high) {const middle = Math.floor((low + high) / 2); if (segment.lengths[middle] < target) low = middle + 1; else high = middle;}
      if (low === 0) pathT = 0;
      else {const start = segment.lengths[low - 1], length = segment.lengths[low] - start; pathT = (low - 1 + (length <= 1e-8 ? 0 : (target - start) / length)) / 64;}
    }
    return {kind: 'vec3', value: curvePoint(segment, pathT)};
  }
  return clone(frames.at(-1).value.value);
}
function focalSamples(track, camera) {
  const focal = new Map((track.channels.find(channel => channel.property === 'camera.focalLength')?.values ?? []).map(value => [value.keyId, value]));
  const fov = new Map((track.channels.find(channel => channel.property === 'camera.fov')?.values ?? []).map(value => [value.keyId, value]));
  const ratio = track.channels.find(channel => channel.property === 'camera.frameAspectRatio');
  return track.keys.flatMap(key => {
    const a = focal.get(key.id), b = fov.get(key.id); if (!a && !b) return [];
    const sampledRatio = sample(samples(track, ratio), key.timeMs)?.value ?? camera.frameAspectRatio;
    return [{key, value: {interpolation: a?.interpolation ?? b?.interpolation,
      value: {kind: 'number', value: a ? a.value.value : fovToFocalLength(b.value.value, sampledRatio)}}}];
  });
}
function apply(entity, property, value) {
  const item = clone(value.value);
  if (property.startsWith('camera.') && !entity.camera) return;
  switch (property) {
    case 'entity.transform.position': entity.transform.position = item; if (entity.camera) entity.camera.position = clone(item); return;
    case 'entity.transform.rotation': entity.transform.rotation = item; if (entity.camera) entity.camera.rotation = planRotationToCamera(item); return;
    case 'entity.transform.scale': entity.transform.scale = item; return;
    case 'entity.visibility': entity.visible = item; return;
    case 'entity.pose': entity.pose = item; return;
    case 'entity.lookTarget': entity.lookTarget = item; return;
    case 'entity.heldEntityId': if (item === null) delete entity.heldEntityId; else entity.heldEntityId = item; return;
    case 'camera.rotation': entity.camera.rotation = item; entity.transform.rotation = cameraRotationToPlan(item); return;
    case 'camera.focalLength': entity.camera.focalLength = item; entity.camera.fov = focalLengthToFov(item, entity.camera.frameAspectRatio); return;
    case 'camera.frameAspectRatio': entity.camera.frameAspectRatio = item; return;
    case 'camera.focus': entity.camera.focus = item; return;
    case 'camera.lookAt': entity.camera.lookAt = item; return;
    case 'camera.focusDistance': entity.camera.focusDistance = item; return;
    case 'camera.apertureFNumber': entity.camera.apertureFNumber = item; return;
    case 'camera.depthOfFieldMode': entity.camera.depthOfFieldMode = item; return;
    default: requireDomain(false, 'cameraShotSampling.property', `unsupported temporal field ${property}`, 'unsupported-temporal');
  }
}
function sampleEntity(entity, track, timeMs) {
  if (!track) return clone(entity);
  const next = clone(entity), channels = track.channels.filter(channel => channel.values.length);
  const cameraRotation = channels.some(channel => channel.property === 'camera.rotation');
  for (const channel of channels) {
    if (['camera.fov', 'camera.focalLength'].includes(channel.property) || cameraRotation && channel.property === 'entity.transform.rotation') continue;
    const value = channel.property === 'entity.transform.position' ? position(track, channel, timeMs) : sample(samples(track, channel), timeMs);
    if (value) apply(next, channel.property, value);
  }
  if (next.camera) {
    const focal = sample(focalSamples(track, entity.camera), timeMs, (a, b, t) => {
      requireDomain(a.value > 0 && b.value > 0, 'cameraShotSampling.focalLength', 'focal key values must be positive');
      return {kind: 'number', value: a.value * (b.value / a.value) ** t};
    });
    if (focal) apply(next, 'camera.focalLength', focal);
  }
  return next;
}

/** Pure, detached render snapshot. Never writes the live world, history,
 * timestamps, views or playhead. Requires a real linked camera like official
 * mK/rh strictTemporalCamera; unlinked View stills use their separate path. */
export function sampleCameraShotState(state, shot, timeMs) {
  assertState(state); requireDomain(isRecord(shot), 'cameraShotSampling.shot', 'must be a shot descriptor');
  requireDomain(Number.isFinite(timeMs), 'cameraShotSampling.timeMs', 'must be finite');
  const time = Math.max(0, Math.round(timeMs)), space = state.scenePlay.worldSpace;
  const setup = space.setups.find(item => item.id === shot.setupId);
  requireDomain(!!setup && setup.kind === 'independent', 'cameraShotSampling.setupId', 'requires an independent setup', 'missing-relation');
  requireDomain(setup.stageId === shot.stageId, 'cameraShotSampling.stageId', 'shot/setup stage mismatch', 'cross-stage');
  const definition = space.entities.find(item => item.id === shot.cameraEntityId && item.kind === 'camera' && item.stageId === shot.stageId);
  requireDomain(!!definition, 'cameraShotSampling.cameraEntityId', 'requires a real linked camera', 'missing-relation');
  const effective = renderSetup(state, setup.id), tracks = new Map((effective.temporal?.tracks ?? []).map(track => [track.owner.entityId, track]));
  const sampled = effective.entityStates.map(entity => sampleEntity(entity, tracks.get(entity.entityId), time));
  const camera = sampled.find(entity => entity.entityId === definition.id)?.camera;
  requireDomain(!!camera, 'cameraShotSampling.camera', 'linked camera has no effective setup state', 'missing-relation');
  assertCamera(camera);
  const next = clone(state), nextSpace = next.scenePlay.worldSpace, byId = new Map(sampled.map(entity => [entity.entityId, entity]));
  nextSpace.activeStageId = setup.stageId; nextSpace.activeSetupId = setup.id; nextSpace.activeViewId = null;
  nextSpace.setups.find(item => item.id === setup.id).entityStates = setup.entityStates.map(entity => byId.get(entity.entityId));
  assertState(next);
  return {state: next, camera: clone(camera)};
}
