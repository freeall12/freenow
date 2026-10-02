export const INDEX_ALGORITHM = 'sha256-exact-utf8';
export const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isStaticAssetRef(value) {
  if (typeof value !== 'string' || !/^(?:\.\/|\/)?assets\//.test(value) || /[?#\\\s]/.test(value)) return false;
  try {
    return value.replace(/^(?:\.\/|\/)?assets\//, '').split('/').every(part => {
      const decoded = decodeURIComponent(part);
      return decoded && decoded !== '.' && decoded !== '..' && !/[\/\\%\x00-\x1f\x7f?#]/.test(decoded);
    });
  } catch { return false; }
}

export function validateResourceIndex(value) {
  if (!value || value.version !== 1 || value.algorithm !== INDEX_ALGORITHM || !value.entries ||
      typeof value.entries !== 'object' || Array.isArray(value.entries) ||
      Object.keys(value).some(key => !['version', 'algorithm', 'entries'].includes(key))) throw Error('本地资源映射格式无效');
  const entries = Object.create(null);
  for (const [key, row] of Object.entries(value.entries)) {
    if (!HASH_PATTERN.test(key) || !row || !isStaticAssetRef(row.ref) || !row.ref.startsWith('/assets/') ||
        !HASH_PATTERN.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 ||
        Object.keys(row).some(field => !['ref', 'sha256', 'bytes'].includes(field))) throw Error('本地资源映射条目无效');
    entries[key] = {ref: row.ref, sha256: row.sha256, bytes: row.bytes};
  }
  return {version: 1, algorithm: INDEX_ALGORITHM, entries};
}

export async function hashSource(source) {
  if (!globalThis.crypto?.subtle) throw Error('当前环境无法计算资源来源哈希');
  const bytes = new TextEncoder().encode(source);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
