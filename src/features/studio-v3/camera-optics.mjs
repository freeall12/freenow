import {clone, isRecord, requireDomain} from './invariants.mjs';

export const FOCAL_LENGTH_PRESETS = Object.freeze([8, 16, 24, 35, 50, 85, 135, 400]);
export const APERTURE_PRESETS = Object.freeze([1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22]);
export const CAMERA_OPTICS_LIMITS = Object.freeze({minFocalLength: 8, maxFocalLength: 400, minAperture: 1.4, maxAperture: 22, minFocusDistance: .1});
export const FRAME_ASPECT_RATIO_OPTIONS = Object.freeze([
  ['16:9', 16 / 9, 'cinema', 'common'], ['1.85:1', 1.85, 'cinema', 'common'], ['2.39:1', 2.39, 'cinema', 'common'], ['2.00:1', 2, 'cinema', 'common'], ['1.37:1', 1.37, 'cinema', 'common'],
  ['1.66:1', 1.66, 'cinema', 'extended'], ['1.43:1', 1.43, 'cinema', 'extended'], ['2.20:1', 2.2, 'cinema', 'extended'], ['1.33:1', 1.33, 'cinema', 'extended'], ['2.35:1', 2.35, 'cinema', 'extended'],
  ['4:3', 4 / 3, 'photo', 'common'], ['3:2', 3 / 2, 'photo', 'common'], ['1:1', 1, 'photo', 'common'], ['3:4', 3 / 4, 'photo', 'extended'], ['2:3', 2 / 3, 'photo', 'extended'],
  ['4:5', 4 / 5, 'social', 'common'], ['9:16', 9 / 16, 'social', 'common'], ['9:19.5', 9 / 19.5, 'social', 'extended'], ['9:21', 9 / 21, 'social', 'extended']
].map(([label, value, group, tier]) => Object.freeze({label, value, group, tier})));
const clamp = (value, min, max = Infinity) => Math.min(max, Math.max(min, value));
function positive(value, path) {requireDomain(typeof value === 'number' && Number.isFinite(value) && value > 0, path, 'must be a finite positive number'); return value;}
function aspect(value) {return value === null || value === undefined ? 3 / 2 : positive(value, 'camera.frameAspectRatio');}

// Full-frame orientation is selected before cropping. Three's default 35 mm
// film gauge is a different convention and cannot be used for this conversion.
export function sensorDimensions(frameAspectRatio) {
  const ratio = aspect(frameAspectRatio), sensor = ratio >= 1 ? {width: 36, height: 24} : {width: 24, height: 36};
  return ratio >= sensor.width / sensor.height ? {width: sensor.width, height: sensor.width / ratio} : {width: sensor.height * ratio, height: sensor.height};
}
export function automaticFrameAspectRatio(viewportAspectRatio = 3 / 2) {return aspect(viewportAspectRatio) >= 1 ? 3 / 2 : 2 / 3;}
export function focalLengthToFov(focalLength, frameAspectRatio) {return 2 * Math.atan(sensorDimensions(frameAspectRatio).height / (2 * positive(focalLength, 'camera.focalLength'))) * (180 / Math.PI);}
export function fovToFocalLength(fov, frameAspectRatio) {
  positive(fov, 'camera.fov'); requireDomain(fov < 180, 'camera.fov', 'must be less than 180 degrees');
  return sensorDimensions(frameAspectRatio).height / (2 * Math.tan(fov * Math.PI / 360));
}
export const CAMERA_OPTICS_DEFAULTS = Object.freeze({focalLength: 24, frameAspectRatio: 16 / 9, fov: focalLengthToFov(24, 16 / 9), apertureFNumber: 11, depthOfFieldMode: 'deepFocus', focusDistance: 10});
export function stepFocalLength(value, direction) {
  positive(value, 'camera.focalLength'); requireDomain(['increase', 'decrease'].includes(direction), 'camera.focalLength.direction', 'unknown direction');
  return direction === 'increase' ? FOCAL_LENGTH_PRESETS.find(preset => preset > value + .5) ?? value : [...FOCAL_LENGTH_PRESETS].reverse().find(preset => preset < value - .5) ?? value;
}

/** Return a detached camera snapshot. Explicit focal length wins; a fov-only
 * patch is converted once. Ratio-only edits retain focal length. */
export function cameraOpticsPatch(previous = {}, patch = {}) {
  requireDomain(isRecord(previous) && isRecord(patch), 'camera', 'must be plain objects');
  const next = {...clone(previous), ...clone(patch)};
  const ratio = next.frameAspectRatio === undefined ? CAMERA_OPTICS_DEFAULTS.frameAspectRatio : next.frameAspectRatio;
  aspect(ratio); next.frameAspectRatio = ratio;
  let focalLength;
  if (Object.hasOwn(patch, 'focalLength')) focalLength = positive(patch.focalLength, 'camera.focalLength');
  else if (Object.hasOwn(patch, 'fov')) focalLength = fovToFocalLength(patch.fov, ratio);
  else if (previous.focalLength !== undefined) focalLength = positive(previous.focalLength, 'camera.focalLength');
  else if (previous.fov !== undefined) focalLength = fovToFocalLength(previous.fov, previous.frameAspectRatio === undefined ? CAMERA_OPTICS_DEFAULTS.frameAspectRatio : previous.frameAspectRatio);
  else focalLength = CAMERA_OPTICS_DEFAULTS.focalLength;
  // Validate supplied fov even when a supplied focal length owns projection.
  if (Object.hasOwn(patch, 'fov')) fovToFocalLength(patch.fov, ratio);
  next.focalLength = clamp(focalLength, 8, 400); next.fov = focalLengthToFov(next.focalLength, ratio);
  next.apertureFNumber = clamp(positive(next.apertureFNumber === undefined ? 11 : next.apertureFNumber, 'camera.apertureFNumber'), 1.4, 22);
  if (next.depthOfFieldMode === undefined) next.depthOfFieldMode = 'deepFocus'; requireDomain(['aperture', 'deepFocus'].includes(next.depthOfFieldMode), 'camera.depthOfFieldMode', 'unknown depth of field mode');
  if (Object.hasOwn(patch, 'focus')) {
    requireDomain(isRecord(patch.focus), 'camera.focus', 'must be a target object');
    if (patch.focus.mode === 'distance') {
      next.focus.distance = clamp(positive(patch.focus.distance, 'camera.focus.distance'), .1); next.focusDistance = next.focus.distance;
    } else if (['point', 'object', 'none'].includes(patch.focus.mode)) next.focusDistance = null;
    else requireDomain(false, 'camera.focus.mode', 'unknown focus mode');
  } else if (Object.hasOwn(patch, 'focusDistance')) {
    next.focusDistance = patch.focusDistance === null ? null : clamp(positive(patch.focusDistance, 'camera.focusDistance'), .1);
    next.focus = next.focusDistance === null ? {mode: 'none'} : {mode: 'distance', distance: next.focusDistance};
  } else if (next.focus?.mode === 'distance') {
    next.focus.distance = clamp(positive(next.focus.distance, 'camera.focus.distance'), .1); next.focusDistance = next.focus.distance;
  } else if (next.focus?.mode === 'none') next.focusDistance = null;
  else if (next.focusDistance !== null) next.focusDistance = clamp(positive(next.focusDistance ?? 10, 'camera.focusDistance'), .1);
  return next;
}
export const normalizeCameraOptics = config => cameraOpticsPatch(config || {});

/** Apply to an existing Three PerspectiveCamera; no GPU or provider access. */
export function applyCameraOptics(camera, config = {}) {
  const optics = normalizeCameraOptics(config), ratio = optics.frameAspectRatio ?? automaticFrameAspectRatio(camera.aspect);
  camera.aspect = ratio;
  camera.filmGauge = sensorDimensions(ratio).height * Math.max(ratio, 1);
  camera.setFocalLength(optics.focalLength);
  camera.focus = optics.focusDistance ?? CAMERA_OPTICS_DEFAULTS.focusDistance;
  camera.userData.studioV3Optics = {...optics, fov: camera.fov};
  camera.updateProjectionMatrix(); return camera.userData.studioV3Optics;
}
export function apertureAngle({apertureFNumber = 11, focalLength = 24, frameAspectRatio, focusDistance = 10, fov} = {}) {
  const focal = clamp(positive(focalLength, 'camera.focalLength'), 8, 400), fNumber = clamp(positive(apertureFNumber, 'camera.apertureFNumber'), 1.4, 22);
  const distance = focusDistance === null ? 1 : clamp(positive(focusDistance, 'camera.focusDistance'), .1);
  const verticalFov = fov ?? focalLengthToFov(focal, frameAspectRatio), height = sensorDimensions(frameAspectRatio).height;
  const scale = 2 * distance * Math.tan(verticalFov * Math.PI / 360) / height;
  return Math.min(.03, 2 * Math.atan(focal / fNumber * scale / (2 * distance)) * .03);
}
/** Spark's aperture/focus contract, including axial point depth. Consumers must
 * explicitly assign this result to Spark; a Three camera has no DOF renderer. */
export function sparkDepthOfField(config, {camera, resolveEntityPosition, boundsCenter} = {}) {
  const optics = normalizeCameraOptics(config); if (optics.depthOfFieldMode === 'deepFocus') return {focalDistance: 0, apertureAngle: 0};
  let distance = optics.focusDistance;
  const focus = optics.focus, point = focus?.mode === 'point' ? focus.target : focus?.mode === 'object' ? resolveEntityPosition?.(focus.entityId, focus.offset) : null;
  const target = point || (distance === null && focus?.mode !== 'none' ? boundsCenter : null);
  if (target && camera) {
    camera.updateMatrixWorld(true); const matrix = camera.matrixWorld.elements;
    distance = -(target.x - matrix[12]) * matrix[8] - (target.y - matrix[13]) * matrix[9] - (target.z - matrix[14]) * matrix[10];
    distance = Number.isFinite(distance) && distance > 0 ? Math.max(.1, distance) : 10;
  }
  if (distance === null) return {focalDistance: 0, apertureAngle: 0};
  return {focalDistance: distance, apertureAngle: apertureAngle({...optics, focusDistance: distance})};
}
