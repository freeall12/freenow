import {assertCamera, assertVector} from './schema.mjs';
import {clone, requireDomain} from './invariants.mjs';
import {cameraOpticsPatch} from './camera-optics.mjs';
import {cameraRotationToPlan, planRotationToCamera} from './transform-coordinates.mjs';

/** Creation reads the visible optical camera once, after the host confirms its
 * viewport lease. No model call, history change or random ID is hidden here. */
export function cameraFromCurrentView(visibleCamera) {
  assertCamera(visibleCamera, 'cameraCreation.visibleCamera');
  const camera = cameraOpticsPatch(visibleCamera);
  delete camera.lookAt;
  return {camera, transform: {position: clone(camera.position), rotation: cameraRotationToPlan(camera.rotation), scale: {x: 1, y: 1, z: 1}}};
}

export function cameraAtSurface({point, yaw = 0, visibleCamera}) {
  assertVector(point, 'cameraCreation.point');
  requireDomain(Number.isFinite(yaw), 'cameraCreation.yaw', 'must be finite radians');
  assertCamera(visibleCamera, 'cameraCreation.visibleCamera');
  const transform = {position: {x: point.x, y: point.y + 1.6, z: point.z}, rotation: {x: 0, y: yaw, z: 0, order: 'XYZ'}, scale: {x: 1, y: 1, z: 1}};
  const camera = cameraOpticsPatch({...clone(visibleCamera), position: clone(transform.position), rotation: planRotationToCamera(transform.rotation)});
  // A surface placement inherits optics, not another camera's tracking target.
  delete camera.lookAt;
  return {camera, transform};
}
