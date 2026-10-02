import { options } from './catalog.mjs';

const defaults = { camera: 'Sony Venice', lens: 'Zeiss Ultra Prime', focal: '24mm', aperture: 'ƒ/4' };
const preferenceKey = 'tapnow-replica-camera-preferences';
const supportedModels = new Set(['nano-banana-flash', 'nano-banana-flash-lite', 'tamar-google-gemini-pro', 'nano-banana', 'gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
export const supportsCamera = model => supportedModels.has(model);


export function cameraSettings(config) {
  const result = {};
  for (const key of Object.keys(options)) {
    result[key] = options[key].find(item => item.label === config[key]) || options[key].find(item => item.key === config.cameraControl?.[key + 'Key']) || options[key].find(item => item.label === defaults[key]);
  }
  return result;
}
export function isEnabled(config) {
  return config.cameraEnabled ?? config.cameraControl?.enabled ?? false;
}
export function apiParameters(config) {
  const values = cameraSettings(config);
  return { enabled: isEnabled(config), ...Object.fromEntries(Object.entries(values).map(([key, item]) => [key + 'Key', item.key])) };
}
export function remember(config) {
  try { localStorage.setItem(preferenceKey, JSON.stringify({ cameraEnabled: isEnabled(config), ...Object.fromEntries(Object.entries(cameraSettings(config)).map(([key, item]) => [key, item.label])) })); } catch {}
}
export function initialSettings(node, saved) {
  if (saved?.cameraEnabled !== undefined || saved?.cameraControl) return {};
  // Earlier captures stored a configured camera by label, before the toggle existed.
  if (saved?.camera) return { cameraEnabled: true };
  if (node.image) return { cameraEnabled: false };
  try { return JSON.parse(localStorage.getItem(preferenceKey) || '{}'); } catch { return {}; }
}

