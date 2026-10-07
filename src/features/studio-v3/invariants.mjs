// Internal domain utilities. No renderer, storage or provider is accessed here.
export class StudioDomainError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'StudioDomainError';
    this.code = code;
    this.path = path;
  }
}

export function requireDomain(condition, path, message, code = 'invalid-domain') {
  if (!condition) throw new StudioDomainError(code, path, message);
}

export const clone = value => structuredClone(value);
export const isRecord = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function assertJson(value, path = 'state', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    requireDomain(Number.isFinite(value), path, 'must be finite');
    return;
  }
  requireDomain(Array.isArray(value) || isRecord(value), path, 'must be plain JSON');
  requireDomain(!ancestors.has(value), path, 'must not contain a cycle');
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    requireDomain(typeof key === 'string', path, 'symbol keys are unsupported');
    if (Array.isArray(value)) requireDomain(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length, path, 'named array properties are unsupported');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireDomain('value' in descriptor && descriptor.enumerable, `${path}.${key}`, 'must be enumerable data');
    assertJson(descriptor.value, `${path}.${key}`, ancestors);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) requireDomain(Object.hasOwn(value, index), path, 'sparse arrays are unsupported');
  }
  ancestors.delete(value);
}

export function same(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => same(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}

export function defined(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function replaceById(items, value, key = 'id') {
  const exists = items.some(item => item[key] === value[key]);
  return exists ? items.map(item => item[key] === value[key] ? value : item) : [...items, value];
}
