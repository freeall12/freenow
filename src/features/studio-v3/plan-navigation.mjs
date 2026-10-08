export const PLAN_NAVIGATION = Object.freeze({minZoom: .5, maxZoom: 3, zoomStep: 1.12,
  zoomDamping: 12, panDamping: 10, rotationDamping: 14, maxDt: .08, snapEpsilon: .0005,
  rotationStep: Math.PI / 12, rotationDragScale: .008, arrowPixels: 42, defaultSectionHeight: 1.6});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
const snapshot = state => ({pan: {...state.pan}, zoom: state.zoom, rotation: state.rotation,
  sectionHeight: state.sectionHeight});
const initial = () => ({pan: {x: 0, z: 0}, zoom: 1, rotation: 0, sectionHeight: 1.6});
const interpolate = (value, target, speed, dt) => {
  const amount = 1 - Math.exp(-speed * dt), difference = target - value;
  // Extreme finite positions still need a finite result when their difference overflows.
  return Number.isFinite(difference) ? value + difference * amount : value * (1 - amount) + target * amount;
};

/** Local viewport state only. The host owns input events and the displayed projection. */
export function createPlanNavigation() {
  let current = initial(), target = initial();
  function read() {return snapshot(current);}
  function panBy(delta, {syncCurrent = true} = {}) {
    if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.z)) return false;
    const pan = {x: current.pan.x + delta.x, z: current.pan.z + delta.z};
    if (!Number.isFinite(pan.x) || !Number.isFinite(pan.z)) return false;
    const changed = pan.x !== target.pan.x || pan.z !== target.pan.z
      || syncCurrent && (pan.x !== current.pan.x || pan.z !== current.pan.z);
    target.pan = pan; if (syncCurrent) current.pan = {...pan};
    return changed;
  }
  function zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return false;
    const zoom = clamp(target.zoom * factor, PLAN_NAVIGATION.minZoom, PLAN_NAVIGATION.maxZoom);
    const changed = zoom !== target.zoom; target.zoom = zoom; return changed;
  }
  function rotateBy(radians) {
    if (!Number.isFinite(radians) || !Number.isFinite(target.rotation + radians)) return false;
    const rotation = wrapAngle(target.rotation + radians), changed = rotation !== target.rotation;
    target.rotation = rotation; return changed;
  }
  function setSection(height) {
    if (height !== 'all' && !Number.isFinite(height)) return false;
    const sectionHeight = height === 'all' ? 'all' : Math.max(0, height);
    const changed = !Object.is(current.sectionHeight, sectionHeight);
    current.sectionHeight = sectionHeight; target.sectionHeight = sectionHeight; return changed;
  }
  function reset() {
    const changed = current.pan.x !== 0 || current.pan.z !== 0 || current.zoom !== 1 || current.rotation !== 0
      || current.sectionHeight !== 1.6 || target.pan.x !== 0 || target.pan.z !== 0 || target.zoom !== 1 || target.rotation !== 0;
    current = initial(); target = initial(); return changed;
  }
  function tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    dt = Math.min(dt, PLAN_NAVIGATION.maxDt);
    const nextZoom = interpolate(current.zoom, target.zoom, PLAN_NAVIGATION.zoomDamping, dt);
    const zoom = Math.abs(target.zoom - nextZoom) <= PLAN_NAVIGATION.snapEpsilon ? target.zoom : nextZoom;
    const delta = wrapAngle(target.rotation - current.rotation);
    const rotation = Math.abs(delta) <= PLAN_NAVIGATION.snapEpsilon ? target.rotation
      : wrapAngle(current.rotation + delta * (1 - Math.exp(-PLAN_NAVIGATION.rotationDamping * dt)));
    let x = interpolate(current.pan.x, target.pan.x, PLAN_NAVIGATION.panDamping, dt);
    let z = interpolate(current.pan.z, target.pan.z, PLAN_NAVIGATION.panDamping, dt);
    if (Math.abs(target.pan.x - x) <= PLAN_NAVIGATION.snapEpsilon
      && Math.abs(target.pan.z - z) <= PLAN_NAVIGATION.snapEpsilon) ({x, z} = target.pan);
    const changed = zoom !== current.zoom || rotation !== current.rotation || x !== current.pan.x || z !== current.pan.z;
    current.zoom = zoom; current.rotation = rotation; current.pan = {x, z}; return changed;
  }
  return {read, tick, panBy, zoomBy, rotateBy, setSection, reset,
    get current() {return read();}, get target() {return snapshot(target);},
    get active() {return current.zoom !== target.zoom || current.rotation !== target.rotation
      || current.pan.x !== target.pan.x || current.pan.z !== target.pan.z;}};
}
