import * as THREE from 'three';

export function visibleSurface(object) {
  if (!object?.isMesh) return false;
  for (let node = object; node; node = node.parent) if (!node.visible || node.userData?.helper || node.userData?.captureExcluded || node.userData?.renderPending || node.userData?.entityKind === 'camera') return false;
  return true;
}
function candidates(roots) {const values = []; for (const root of roots || []) root.traverse(object => {if (visibleSurface(object)) values.push(object);}); return [...new Set(values)];}
function normalOf(hit, directionNormal = false) {
  if (!hit.face?.normal) return null;
  if (directionNormal) return hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  return hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
}
const vector = value => ({x: value.x, y: value.y, z: value.z});
function intersections(ray, meshes, colliders, directionNormal = false) {
  const hits = [];
  for (const [roots, source] of [[meshes, 'mesh'], [colliders, 'collider']]) {
    for (const root of roots || []) root.updateWorldMatrix(true, true);
    for (const hit of ray.intersectObjects(candidates(roots), false)) {const normal = normalOf(hit, directionNormal); if (normal && Number.isFinite(hit.distance) && hit.distance >= 0) hits.push({point: hit.point, normal, source, distance: hit.distance, object: hit.object});}
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
const result = hit => hit ? {point: vector(hit.point), normal: vector(hit.normal), source: hit.source, distance: hit.distance} : null;
export function viewportRay(client, rect, camera) {
  const x = client.clientX ?? client.x, y = client.clientY ?? client.y;
  if (![x, y, rect?.left, rect?.top, rect?.width, rect?.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  camera.updateWorldMatrix(true, false); const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera); return ray;
}
export function directSurface(ray, {meshes = [], colliders = [], groundY = 0, groundFallback = true} = {}) {
  if (!ray) return null;
  const hits = intersections(ray, meshes, colliders);
  if (groundFallback) {const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY), new THREE.Vector3()); if (point) hits.push({point, normal: new THREE.Vector3(0, 1, 0), source: 'ground-plane', distance: point.distanceTo(ray.ray.origin)});}
  hits.sort((a, b) => a.distance - b.distance); return result(hits[0]);
}
export function supportSurface(position, {meshes = [], colliders = [], groundY = 0, groundFallback = true, minNormalY = .5, maxY, minY = -10000} = {}) {
  const bounds = new THREE.Box3(); for (const root of [...meshes, ...colliders]) bounds.expandByObject(root);
  const height = Number.isFinite(maxY) ? maxY : Math.max(groundY + 100, bounds.isEmpty() ? 100 : bounds.max.y + 100);
  const ray = new THREE.Raycaster(new THREE.Vector3(position.x, height, position.z), new THREE.Vector3(0, -1, 0), 0, height - minY);
  const hits = intersections(ray, meshes, colliders).filter(hit => hit.normal.y >= minNormalY);
  if (groundFallback && groundY <= height && groundY >= minY) hits.push({point: new THREE.Vector3(position.x, groundY, position.z), normal: new THREE.Vector3(0, 1, 0), source: 'ground-plane', distance: height - groundY});
  hits.sort((a, b) => b.point.y - a.point.y); return result(hits[0]);
}
/** New plan placement searches all standable surfaces at x/z. Ground is a
 * fallback only; existing-entity moves keep their authored depth instead. */
export function topDownSupportSurface(position, {meshes = [], colliders = [], groundY = 0} = {}) {
  if (![position?.x, position?.z, groundY].every(Number.isFinite)) return null;
  const bounds = new THREE.Box3();
  for (const root of [...meshes, ...colliders]) {root.updateWorldMatrix(true, true); bounds.expandByObject(root);}
  const maxY = bounds.isEmpty() ? groundY + 10 : bounds.max.y + 10, minY = bounds.isEmpty() ? groundY - 10 : bounds.min.y - 10;
  return supportSurface(position, {meshes, colliders, groundY, groundFallback: false, minNormalY: .65, maxY, minY})
    || {point: {x: position.x, y: groundY, z: position.z}, normal: {x: 0, y: 1, z: 0}, source: 'ground-plane', distance: 0};
}
/** Director placement prefers the highest support below the current base;
 * when every support is above it, the lowest one raises the object safely.
 * The 3 cm allowance is a preference, not a clipping plane for the rays. */
export function placementSupport(points, {meshes = [], colliders = [], groundY = 0, referenceY, minNormalY = .65, allowance = .03} = {}) {
  if (!points?.length || !Number.isFinite(referenceY) || !Number.isFinite(groundY)) return null;
  const values = [{point: new THREE.Vector3(points[0].x, groundY, points[0].z), normal: new THREE.Vector3(0, 1, 0), source: 'ground-plane', distance: 0}];
  for (const [roots, source] of [[colliders, 'collider'], [meshes, 'mesh']]) {
    const bounds = new THREE.Box3(); for (const root of roots) bounds.expandByObject(root); if (bounds.isEmpty()) continue;
    const height = bounds.max.y + 10, far = Math.max(1, bounds.max.y - bounds.min.y) + 20;
    for (const point of points) {
      const ray = new THREE.Raycaster(new THREE.Vector3(point.x, height, point.z), new THREE.Vector3(0, -1, 0), 0, far);
      values.push(...intersections(ray, source === 'mesh' ? roots : [], source === 'collider' ? roots : [], true).filter(hit => hit.normal.y >= minNormalY));
    }
  }
  const below = values.filter(hit => hit.point.y <= referenceY + allowance);
  return result(below.length ? below.sort((a, b) => b.point.y - a.point.y)[0] : values.sort((a, b) => a.point.y - b.point.y)[0]);
}
export function surfaceHit(ray, options = {}) {
  if (options.mode !== 'support-surface') return directSurface(ray, options);
  if (!ray) return null;
  const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(options.projectionY ?? options.groundY ?? 0)), new THREE.Vector3());
  return point ? supportSurface(point, options) : null;
}
export function withCaptureVisibility(root, callback) {
  const excluded = []; root.traverse(object => {if (object.userData?.captureExcluded && object.visible) {excluded.push(object); object.visible = false;}});
  const restore = () => {for (const object of excluded) object.visible = true;};
  try {const value = callback(); if (value?.then) return Promise.resolve(value).finally(restore); restore(); return value;} catch (error) {restore(); throw error;}
}
