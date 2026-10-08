export const PLAN_PROJECTION = Object.freeze({padding: 1.1, depthPadding: 2, minHalfSize: .1,
  minNear: .01, minDepthSpan: .5, minCameraDistance: 50, minZoom: .5, maxZoom: 3,
  defaultSectionHeight: 1.6, inViewMargin: .08});

const finitePoint = point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const relative = (point, target) => ({x: point.x - target.x, y: point.y - target.y, z: point.z - target.z});
const validProjection = value => value && finitePoint(value.target) && finitePoint(value.right)
  && finitePoint(value.down) && finitePoint(value.forward) && Number.isFinite(value.width) && value.width > 0
  && Number.isFinite(value.height) && value.height > 0 && Number.isFinite(value.halfWidth) && value.halfWidth > 0
  && Number.isFinite(value.halfHeight) && value.halfHeight > 0;

/** A plain snapshot shared by the renderer, SVG overlays and pointer resolution. */
export function createPlanProjection({bounds, width = 560, height = 420, groundY = 0,
  pan = {x: 0, z: 0}, zoom = 1, rotation = 0, sectionHeight = 1.6} = {}) {
  if (!finitePoint(bounds?.min) || !finitePoint(bounds?.max)
    || ['x', 'y', 'z'].some(axis => bounds.min[axis] > bounds.max[axis])) {
    throw new TypeError('Plan projection requires finite, ordered bounds');
  }
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new TypeError('Plan projection requires a positive viewport');
  }
  if (!Number.isFinite(groundY) || !Number.isFinite(pan?.x) || !Number.isFinite(pan?.z)
    || !Number.isFinite(rotation) || !Number.isFinite(zoom) || zoom <= 0) {
    throw new TypeError('Plan projection requires finite navigation values and positive zoom');
  }
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  zoom = clamp(zoom, PLAN_PROJECTION.minZoom, PLAN_PROJECTION.maxZoom);
  rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
  sectionHeight = sectionHeight === 'all' ? 'all' : Number.isFinite(sectionHeight)
    ? Math.max(0, sectionHeight) : PLAN_PROJECTION.defaultSectionHeight;
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  const target = {x: bounds.min.x / 2 + bounds.max.x / 2 + pan.x, y: groundY,
    z: bounds.min.z / 2 + bounds.max.z / 2 + pan.z};
  const right = {x: cosine, y: 0, z: sine}, down = {x: -sine, y: 0, z: cosine}, forward = {x: 0, y: -1, z: 0};
  const distance = Math.max(PLAN_PROJECTION.minCameraDistance, bounds.max.y - groundY + 10);
  const cameraPosition = {x: target.x, y: target.y + distance, z: target.z};
  let minRight = Infinity, maxRight = -Infinity, minDown = Infinity, maxDown = -Infinity;
  let minDepth = Infinity, maxDepth = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) {
      const point = {x, y, z}, delta = relative(point, target);
      const screenRight = dot(delta, right), screenDown = dot(delta, down);
      const depth = dot(relative(point, cameraPosition), forward);
      minRight = Math.min(minRight, screenRight); maxRight = Math.max(maxRight, screenRight);
      minDown = Math.min(minDown, screenDown); maxDown = Math.max(maxDown, screenDown);
      minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth);
    }
  }
  const horizontal = Math.max((maxRight - minRight) / 2 * PLAN_PROJECTION.padding, PLAN_PROJECTION.minHalfSize);
  const vertical = Math.max((maxDown - minDown) / 2 * PLAN_PROJECTION.padding, PLAN_PROJECTION.minHalfSize);
  const aspect = width / height;
  const halfWidth = (horizontal / vertical > aspect ? horizontal : vertical * aspect) / zoom;
  const halfHeight = (horizontal / vertical > aspect ? horizontal / aspect : vertical) / zoom;
  let near = Math.max(PLAN_PROJECTION.minNear, minDepth - PLAN_PROJECTION.depthPadding);
  const far = Math.max(near + PLAN_PROJECTION.minDepthSpan, maxDepth + PLAN_PROJECTION.depthPadding);
  // Cutting real geometry changes only the near plane; marker positions remain available.
  if (sectionHeight !== 'all') near = clamp(distance - sectionHeight, near, far - PLAN_PROJECTION.minDepthSpan);
  const projection = {width, height, target, right, down, forward, halfWidth, halfHeight, cameraPosition,
    near, far, zoom, rotation, sectionHeight};
  if (!validProjection(projection) || !finitePoint(cameraPosition) || !Number.isFinite(near)
    || !Number.isFinite(far) || far <= near) throw new RangeError('Plan projection exceeds finite geometry limits');
  return projection;
}

export function projectPlanPoint(projection, point) {
  if (!validProjection(projection) || !finitePoint(point)) return null;
  const delta = relative(point, projection.target);
  const nx = .5 + dot(delta, projection.right) / (2 * projection.halfWidth);
  const ny = .5 + dot(delta, projection.down) / (2 * projection.halfHeight);
  const x = nx * projection.width, y = ny * projection.height;
  if (![x, y, nx, ny].every(Number.isFinite)) return null;
  const margin = PLAN_PROJECTION.inViewMargin;
  return {x, y, nx, ny, inView: nx >= -margin && nx <= 1 + margin && ny >= -margin && ny <= 1 + margin};
}

export function unprojectPlanPoint(projection, {nx, ny} = {}, anchor) {
  if (!validProjection(projection) || !Number.isFinite(nx) || !Number.isFinite(ny)
    || anchor != null && !Number.isFinite(anchor.y)) return null;
  const right = (nx - .5) * 2 * projection.halfWidth, down = (ny - .5) * 2 * projection.halfHeight;
  const point = {x: projection.target.x + projection.right.x * right + projection.down.x * down,
    y: anchor?.y ?? projection.target.y,
    z: projection.target.z + projection.right.z * right + projection.down.z * down};
  return finitePoint(point) ? point : null;
}

export function planPanDelta(projection, {dx, dy} = {}) {
  if (!validProjection(projection) || !Number.isFinite(dx) || !Number.isFinite(dy)) return {x: 0, z: 0};
  const right = -dx * 2 * projection.halfWidth / projection.width;
  const down = -dy * 2 * projection.halfHeight / projection.height;
  const delta = {x: projection.right.x * right + projection.down.x * down,
    z: projection.right.z * right + projection.down.z * down};
  return Number.isFinite(delta.x) && Number.isFinite(delta.z) ? delta : {x: 0, z: 0};
}

export function sectionSliderValue(height) {
  if (height === 'all') return 1;
  height = Number.isFinite(height) ? Math.max(0, height) : 0;
  return height / (height + PLAN_PROJECTION.defaultSectionHeight);
}

export function sectionHeightFromSlider(value) {
  value = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  return value === 1 ? 'all' : PLAN_PROJECTION.defaultSectionHeight * value / (1 - value);
}
