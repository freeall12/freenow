import { thinkingCatalog } from './thinking-catalog.mjs';

export const OFF = '__thinking_off__';
export const thinkingStorageKey = 'tapnow-agent-thinking';
export const levelLabels = { low:'低', medium:'中', high:'高', xhigh:'极高', extra_high:'极高', max:'最高', [OFF]:'关' };
export function getThinkingSpec(id) { return thinkingCatalog[id]?.switchable ? thinkingCatalog[id] : null; }
export function normalizeThinking(id, value) {
  const spec = getThinkingSpec(id);
  if (!spec) return null;
  const enabled = spec.can_disable === false ? true : typeof value?.enabled === 'boolean' ? value.enabled : spec.default.enabled;
  const level = spec.levels.includes(value?.level) ? value.level : spec.default.level || spec.levels[0];
  return { enabled, ...(level ? { level } : {}) };
}
export function validateThinking(id, value) {
  const spec = getThinkingSpec(id);
  if (!spec || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['enabled','level'].includes(k)) || typeof value.enabled !== 'boolean') throw Error('思考参数无效');
  if (!spec.can_disable && !value.enabled) throw Error('所选模型不能关闭思考');
  if (spec.levels.length ? !spec.levels.includes(value.level) : value.level != null) throw Error('所选模型不支持此思考档位');
  return normalizeThinking(id, value);
}
export function readThinking(id, storage) {
  let saved;
  try { saved = JSON.parse(storage.getItem(thinkingStorageKey) || '{}')?.[id]; } catch {}
  return normalizeThinking(id, saved);
}
export function saveThinking(id, value, storage) {
  const setting = validateThinking(id, value);
  let saved = {};
  try { const value = JSON.parse(storage.getItem(thinkingStorageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch {}
  storage.setItem(thinkingStorageKey, JSON.stringify({ ...saved, [id]:setting }));
  return setting;
}
export function thinkingSummary(id, setting) {
  if (!getThinkingSpec(id)?.levels.length) return '';
  return setting?.enabled ? levelLabels[setting.level] || setting.level : '思考关闭';
}
