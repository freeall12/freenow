// Static geometry from WorkspacePlanView-HeQ7o6cq.js (gt/vt/Bn/Gn/pt/Et).
// Installed original source SHA-256: b71be13b4f56e74d4e5fa7a41a43402070ec2366bf8156d65940c952ddbc735e.
import {focalLengthToFov, fovToFocalLength} from './camera-optics.mjs';
export const PLAN_SCALE = 1.55;
export const CAMERA_LENS = "M 5 -4.9 L 13.2 -9 A 1.8 1.8 0 0 1 15.8 -7.4 V 7.4 A 1.8 1.8 0 0 1 13.2 9 L 5 4.9 Z";
export const CAMERA_BODY = "M -10 -8 H 3 A 3 3 0 0 1 6 -5 V 5 A 3 3 0 0 1 3 8 H -10 A 3 3 0 0 1 -13 5 V -5 A 3 3 0 0 1 -10 -8 Z";
export const HEADING_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M20 11a8 8 0 1 0-2.34 5.66%27/%3E%3Cpath d=%27M20 4v7h-7%27/%3E%3C/svg%3E\") 12 12, grab";
export const FOV_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M4 12h16%27/%3E%3Cpath d=%27M8 8l-4 4l4 4%27/%3E%3Cpath d=%27M16 8l4 4l-4 4%27/%3E%3C/svg%3E\") 12 12, grab";
// Same Tabler symbols named in the official plan import, copied from the existing dependency.
export const PLAN_ICONS = Object.freeze({
  "rotate-2": "<svg\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"16\"\n  height=\"16\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"1.75\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n  class=\"icon icon-tabler icons-tabler-outline icon-tabler-rotate-2\"\n>\n  <path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" />\n  <path d=\"M15 4.55a8 8 0 0 0 -6 14.9m0 -4.45v5h-5\" />\n  <path d=\"M18.37 7.16l0 .01\" />\n  <path d=\"M13 19.94l0 .01\" />\n  <path d=\"M16.84 18.37l0 .01\" />\n  <path d=\"M19.37 15.1l0 .01\" />\n  <path d=\"M19.94 11l0 .01\" />\n</svg>",
  "rotate-clockwise-2": "<svg\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"16\"\n  height=\"16\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"1.75\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n  class=\"icon icon-tabler icons-tabler-outline icon-tabler-rotate-clockwise-2\"\n>\n  <path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" />\n  <path d=\"M9 4.55a8 8 0 0 1 6 14.9m0 -4.45v5h5\" />\n  <path d=\"M5.63 7.16l0 .01\" />\n  <path d=\"M4.06 11l0 .01\" />\n  <path d=\"M4.63 15.1l0 .01\" />\n  <path d=\"M7.16 18.37l0 .01\" />\n  <path d=\"M11 19.94l0 .01\" />\n</svg>",
  "minus": "<svg\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"16\"\n  height=\"16\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"1.75\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n  class=\"icon icon-tabler icons-tabler-outline icon-tabler-minus\"\n>\n  <path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" />\n  <path d=\"M5 12l14 0\" />\n</svg>",
  "plus": "<svg\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"16\"\n  height=\"16\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"1.75\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n  class=\"icon icon-tabler icons-tabler-outline icon-tabler-plus\"\n>\n  <path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" />\n  <path d=\"M12 5l0 14\" />\n  <path d=\"M5 12l14 0\" />\n</svg>",
  "refresh": "<svg\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"16\"\n  height=\"16\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"1.75\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n  class=\"icon icon-tabler icons-tabler-outline icon-tabler-refresh\"\n>\n  <path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" />\n  <path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" />\n  <path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />\n</svg>"
});
export function outlineColor(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  return match ? '#' + [0, 2, 4].map(index => Math.round(parseInt(match[1].slice(index, index + 2), 16) * .42).toString(16).padStart(2, '0')).join('') : color;
}
export const wrapHeading = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
export function screenHeading(projection, heading) {
  const right = projection.right, down = projection.down;
  const x = Math.sin(heading), z = -Math.cos(heading);
  return Math.atan2(x * right.x + z * right.z, -(x * down.x + z * down.z));
}
export function horizontalHalfFov(fov, ratio = 1.5) {return Math.atan(Math.tan(fov * Math.PI / 360) * ratio);}
export function fovGeometry(fov, ratio, radius) {
  const angle = horizontalHalfFov(fov, ratio), x = Math.sin(angle) * radius, y = -Math.cos(angle) * radius;
  return {left: {x: -x, y}, right: {x, y}, path: `M 0 0 L ${-x} ${y} A ${radius} ${radius} 0 0 1 ${x} ${y} Z`};
}
/** Official Ln: retain the opposite ray, convert horizontal span back to vertical
 * fov, clamp through the existing full-frame optics contract, then recover center. */
export function editFovEdge({heading, fov, ratio = 1.5, edge, draggedHeading}) {
  const half = horizontalHalfFov(fov, ratio), opposite = wrapHeading(heading + (edge === 'left' ? half : -half));
  const delta = edge === 'left' ? wrapHeading(draggedHeading - opposite) : wrapHeading(opposite - draggedHeading);
  const horizontal = delta < 0 ? Math.abs(delta) : 0;
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / ratio) * 180 / Math.PI;
  const clamped = Math.min(focalLengthToFov(8, ratio), Math.max(focalLengthToFov(400, ratio), vertical));
  const nextHalf = horizontalHalfFov(clamped, ratio);
  return {heading: wrapHeading(opposite + (edge === 'left' ? -nextHalf : nextHalf)), fov: clamped};
}
export function markerLabel(value) {
  const chars = Array.from(value || ''), label = chars.length > 72 ? chars.slice(0, 71).join('') + '...' : chars.join('');
  const width = Math.min(500, Math.max(64, Array.from(label).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 15 : 8.5), 28)));
  return {label, width};
}
export function fovReadout(fov, ratio) {return `${Math.round(fov)}° · ${Math.round(fovToFocalLength(fov, ratio))}mm`;}

/** Official hr proxy: keep controls at least 30 screen pixels from an anchor. */
export function pathControlProxy(position, anchors = [], fallbackPoint) {
  const nearest = anchors.reduce((best, value) => !best || Math.hypot(value.x - position.x, value.y - position.y) < Math.hypot(best.x - position.x, best.y - position.y) ? value : best, null);
  if (!nearest || Math.hypot(position.x - nearest.x, position.y - nearest.y) >= 30) return {...position, proxied: false};
  let dx = position.x - nearest.x, dy = position.y - nearest.y, length = Math.hypot(dx, dy);
  if (length < .5) {const other = anchors.find(value => Math.hypot(value.x - nearest.x, value.y - nearest.y) >= .5) || fallbackPoint; if (other) {dx = other.x - nearest.x; dy = other.y - nearest.y; length = Math.hypot(dx, dy);}}
  if (length < .5) {dx = 1; dy = 0; length = 1;}
  return {...position, x: nearest.x + dx / length * 30, y: nearest.y + dy / length * 30, proxied: true};
}

/** Samples are equally spaced in time; use the nearest screen segment to recover time. */
export function nearestPathSample(segments, project, point) {
  let nearest = null;
  for (const segment of segments || []) {
    const values = segment.points?.length >= 2 ? segment.points : [segment.p0, segment.p3].filter(Boolean);
    for (let index = 0; index < values.length - 1; index++) {
      const a = project(values[index]), b = project(values[index + 1]); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const ratio = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
      const distance = Math.hypot(point.x - a.x - dx * ratio, point.y - a.y - dy * ratio);
      if (nearest && nearest.distance <= distance) continue;
      const timeRatio = (index + ratio) / (values.length - 1), t = segment.parameters?.length === values.length ? segment.parameters[index] + (segment.parameters[index + 1] - segment.parameters[index]) * ratio : timeRatio, start = values[index], end = values[index + 1];
      nearest = {distance, segment, t, timeMs: segment.fromTimeMs + (segment.toTimeMs - segment.fromTimeMs) * timeRatio, position: {x: start.x + (end.x - start.x) * ratio, y: (start.y ?? 0) + ((end.y ?? 0) - (start.y ?? 0)) * ratio, z: start.z + (end.z - start.z) * ratio}};
    }
  }
  return nearest;
}
