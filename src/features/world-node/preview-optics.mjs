// Official eb1c357: world CE/nB/T3/_y and preview mt/Ee. See reference/world-preview.md.
export const DEFAULT_FOCAL = 24;
export const FOCAL_PRESETS = [8, 16, 24, 35, 50, 85, 135, 400];
export const RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '4:5', '9:19.5', '9:21', '1.33:1', '1.37:1', '1.43:1', '1.66:1', '1.85:1', '2.00:1', '2.20:1', '2.35:1', '2.39:1'];
export const aspectOf = label => {const [w, h] = label.split(':').map(Number); return w / h;};
export const clampFocal = value => Math.min(400, Math.max(8, Number.isFinite(value) ? value : DEFAULT_FOCAL));
export function frameRect(width, height, aspect) {
  width = Math.max(1, width); height = Math.max(1, height);
  const top = Math.min(60, height - 1), bottom = Math.min(60, Math.max(0, height - top - 1));
  const available = Math.max(1, height - top - bottom);
  let w = Math.sqrt(.5 * width * height * aspect), h = Math.sqrt(.5 * width * height / aspect);
  if (h > available * .95) {h = available * .95; w = h * aspect;}
  if (w > width * .95) {w = width * .95; h = w / aspect;}
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  return {left: Math.round((width - w) / 2), top: Math.round(top + (available - h) / 2), width: w, height: h};
}
export function focalFov(focal, aspect) {
  const sensorWidth = aspect >= 1 ? 36 : 24, sensorHeight = aspect >= 1 ? 24 : 36;
  return 2 * Math.atan(Math.min(sensorHeight, sensorWidth / aspect) / (2 * clampFocal(focal))) * 180 / Math.PI;
}
export function viewportFov(focal, width, height, frameAspect = null) {
  const aspect = frameAspect ?? (width / height >= 1 ? 1.5 : 2 / 3);
  const fraction = frameAspect ? frameRect(width, height, aspect).height / Math.max(1, height) : 1;
  return 2 * Math.atan(Math.tan(focalFov(focal, aspect) * Math.PI / 360) / fraction) * 180 / Math.PI;
}
export function captureSize(aspect) {
  return aspect >= 1 ? {width: 4096, height: Math.max(1, Math.round(4096 / aspect))} : {width: Math.max(1, Math.round(4096 * aspect)), height: 4096};
}
