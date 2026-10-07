import {Euler, Quaternion, Vector3} from 'three';
import {assertJson, clone, isRecord, requireDomain} from './invariants.mjs';
import {assertVector} from './schema.mjs';

export const EULER_ORDERS = Object.freeze(['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']);
const TWO_PI = 2 * Math.PI, HEADING_EPSILON = 1e-10, FORWARD_EPSILON = 1e-8;

function finite(value, path) {requireDomain(typeof value === 'number' && Number.isFinite(value), path, 'must be a finite number');}
function assertRotation(rotation, path = 'rotation') {
  requireDomain(isRecord(rotation), path, 'must be a plain Euler rotation');
  for (const axis of ['x', 'y', 'z']) finite(rotation[axis], `${path}.${axis}`);
  requireDomain(rotation.order === undefined || EULER_ORDERS.includes(rotation.order), `${path}.order`, 'unknown Euler order');
  assertJson(rotation, path);
}
function assertTransform(transform) {
  requireDomain(isRecord(transform), 'transform', 'must be a plain transform');
  assertVector(transform.position, 'transform.position'); assertRotation(transform.rotation, 'transform.rotation'); assertVector(transform.scale, 'transform.scale');
  assertJson(transform, 'transform');
}
function assertKind(kind) {requireDomain(['actor', 'prop', 'camera'].includes(kind), 'entity.kind', 'unknown entity kind');}
function quaternion(rotation) {return new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z, rotation.order ?? 'XYZ'));}
function plainEuler(rotation) {return {x: rotation.x, y: rotation.y, z: rotation.z, order: rotation.order};}

/** Compare orientations across Euler orders and q/-q without acos precision loss. */
export function sameRotation(left, right, epsilon = 1e-7) {
  assertRotation(left); assertRotation(right); finite(epsilon, 'rotation.epsilon');
  requireDomain(epsilon >= 0, 'rotation.epsilon', 'must be nonnegative');
  const a = quaternion(left).normalize().toArray(), b = quaternion(right).normalize().toArray();
  const chord = Math.min(Math.hypot(...a.map((value, index) => value - b[index])), Math.hypot(...a.map((value, index) => value + b[index])));
  return 4 * Math.asin(Math.min(1, chord / 2)) <= epsilon;
}

/** World heading of rotated local -Z. A positive Euler Y has negative heading. */
export function rotationHeading(rotation) {
  assertRotation(rotation);
  const forward = new Vector3(0, 0, -1).applyQuaternion(quaternion(rotation)), horizontal = Math.hypot(forward.x, forward.z);
  return horizontal <= FORWARD_EPSILON || !Number.isFinite(horizontal) ? 0 : Math.atan2(forward.x / horizontal, -forward.z / horizontal);
}
export function wrapHeading(radians) {
  finite(radians, 'heading'); return ((radians + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}
export function headingDelta(from, to) {finite(from, 'heading.from'); finite(to, 'heading.to'); return wrapHeading(to - from);}

/** Original vF: apply global-Y yaw before the existing tilted orientation. */
export function setRotationHeading(rotation, worldHeadingRadians) {
  assertRotation(rotation); finite(worldHeadingRadians, 'heading');
  const delta = headingDelta(rotationHeading(rotation), worldHeadingRadians);
  if (Math.abs(delta) <= HEADING_EPSILON) return clone(rotation);
  const yaw = new Quaternion(0, Math.sin(-delta / 2), 0, Math.cos(-delta / 2));
  const result = yaw.multiply(quaternion(rotation)).normalize();
  return plainEuler(new Euler().setFromQuaternion(result, rotation.order ?? 'XYZ'));
}

/** Original xF targets -heading, retaining tilt; it does not remove heading. */
export function reflectRotationHeading(rotation) {return setRotationHeading(rotation, -rotationHeading(rotation));}
export const planRotationToCamera = reflectRotationHeading;
export const cameraRotationToPlan = reflectRotationHeading;

/** Actor Hq/ZOe plus the explicit camera Wq/QOe plan-to-optical contract. */
export function entityTransformToWorld(kind, domainTransform) {
  assertKind(kind); assertTransform(domainTransform);
  const result = clone(domainTransform);
  if (kind === 'actor' || kind === 'camera') result.rotation = reflectRotationHeading(domainTransform.rotation);
  return result;
}
export function entityTransformFromWorld(kind, worldTransform) {return entityTransformToWorld(kind, worldTransform);}
export function entityHeadingRadians(kind, domainTransform) {return rotationHeading(entityTransformToWorld(kind, domainTransform).rotation);}
export function setEntityHeading(kind, domainTransform, worldHeadingRadians) {
  const world = entityTransformToWorld(kind, domainTransform);
  world.rotation = setRotationHeading(world.rotation, worldHeadingRadians);
  return entityTransformFromWorld(kind, world);
}

/** Pure apply descriptor; the renderer applies this returned world transform once.
 * Camera state is already optical/world; only missing pose fields use plan data. */
export function applyEntityTransform(kind, setupState) {
  assertKind(kind); requireDomain(isRecord(setupState), 'entityState', 'must be a plain object');
  const world = entityTransformToWorld(kind, setupState.transform);
  if (kind === 'camera' && setupState.camera != null) {
    requireDomain(isRecord(setupState.camera), 'camera', 'must be a plain camera state');
    if (setupState.camera.position != null) {assertVector(setupState.camera.position, 'camera.position'); world.position = clone(setupState.camera.position);}
    if (setupState.camera.rotation != null) {assertRotation(setupState.camera.rotation, 'camera.rotation'); world.rotation = clone(setupState.camera.rotation);}
  }
  return world;
}

/** Pure read descriptor for persistence. A camera's optional previous plan
 * transform retains authored scale, matching official dV's camera branch. */
export function readEntityTransform(kind, worldTransform, previousDomainTransform) {
  const result = entityTransformFromWorld(kind, worldTransform);
  if (kind === 'camera' && previousDomainTransform !== undefined) {
    assertTransform(previousDomainTransform); result.scale = clone(previousDomainTransform.scale);
  }
  return result;
}

/** Heading read for a complete state (official Cdt/Or camera-state precedence). */
export function entityStateHeadingRadians(kind, setupState) {return rotationHeading(applyEntityTransform(kind, setupState).rotation);}
