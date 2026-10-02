'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const specs = [
  ['agent-reference-assets.json', 'url', 'file'],
  ['agent-attachment-assets.json', 'source', 'file'],
  ['playlist-intro-assets.json', 'source', 'name'],
  ['stage-environment-assets.json', 'source', 'path'],
  ['agent-manager-assets.json', 'url', 'file'],
];
const inside = (base, target) => target.startsWith(base + path.sep);

// Only these capture manifests are evidence. No network requests or source URL logs.
async function buildLocalResourceIndex({root}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('资源根目录必须是绝对路径');
  const base = await fs.realpath(root), assetsRoot = path.join(base, 'assets');
  const entries = Object.create(null), candidates = new Map(), blocked = new Set(), cache = new Map();
  const diagnostics = [], stats = {manifestsPresent: 0, manifestsMissing: 0, candidates: 0, verified: 0, declaredChecksums: 0, computedChecksums: 0, duplicateSources: 0, rejected: 0};
  const issue = (code, manifest, record) => {stats.rejected++; diagnostics.push({code, manifest, ...(record === undefined ? {} : {record})});};
  async function read(name) {
    const filename = path.join(base, 'reference', name);
    try {await fs.lstat(filename);}
    catch (error) {
      if (error.code === 'ENOENT') {stats.manifestsMissing++; return null;}
      issue('manifest_invalid', name); return null;
    }
    try {
      const resolved = await fs.realpath(filename);
      if (!inside(path.join(base, 'reference'), resolved) || !(await fs.stat(resolved)).isFile()) throw Error('path');
      const value = JSON.parse(await fs.readFile(resolved, 'utf8')); stats.manifestsPresent++; return value;
    } catch (error) {
      issue('manifest_invalid', name); return null;
    }
  }
  async function add(row, sourceKey, destKey, manifest, record, expected) {
    const source = row?.[sourceKey], destination = row?.[destKey];
    if (typeof source !== 'string' || typeof destination !== 'string') {issue('mapping_record_invalid', manifest, record); return;}
    if (!/^https?:\/\//i.test(source)) return;
    stats.candidates++;
    const sourceHash = digest(source);
    try {
      const url = new URL(source);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || source.trim() !== source) throw Error('source');
      if (typeof destination !== 'string' || !/^(?:\.\/|\/)?assets\//.test(destination) || /[\\%?#\x00-\x1f\x7f]/.test(destination)) throw Error('path');
      const relative = destination.replace(/^(?:\.\/|\/)?assets\//, '');
      const segments = relative.split('/');
      if (segments.some(part => !part || part === '.' || part === '..')) throw Error('path');
      const filename = path.join(assetsRoot, ...segments), real = await fs.realpath(filename);
      if (!inside(assetsRoot, real) || !(await fs.stat(real)).isFile()) throw Error('path');
      let actual = cache.get(real);
      if (!actual) {const content = await fs.readFile(real); actual = {bytes: content.byteLength, sha256: digest(content)}; cache.set(real, actual);}
      const declared = expected?.sha256 ?? row.sha256, bytes = expected?.bytes ?? row.bytes;
      if (actual.bytes < 1 || declared !== undefined && (!/^[a-f0-9]{64}$/.test(declared) || declared !== actual.sha256) ||
          bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes !== actual.bytes)) throw Error('checksum');
      const next = {ref: '/assets/' + segments.map(encodeURIComponent).join('/'), ...actual};
      const previous = candidates.get(sourceHash);
      if (previous && previous.sha256 !== next.sha256) {blocked.add(sourceHash); issue('source_conflict', manifest, record); return;}
      if (previous) stats.duplicateSources++;
      if (!previous || next.ref < previous.ref) candidates.set(sourceHash, next);
      stats.verified++; if (declared !== undefined) stats.declaredChecksums++; else stats.computedChecksums++;
    } catch {blocked.add(sourceHash); issue('mapping_invalid_or_missing', manifest, record);}
  }
  for (const [name, sourceKey, destKey] of specs) {
    const rows = await read(name);
    if (rows === null) continue;
    if (!Array.isArray(rows)) {issue('manifest_invalid', name); continue;}
    for (let index = 0; index < rows.length; index++) await add(rows[index], sourceKey, destKey, name, index);
  }
  const catalogName = 'stage-library-catalog.json', hashesName = 'stage-library-assets.json';
  const catalog = await read(catalogName), hashes = await read(hashesName);
  if (catalog !== null || hashes !== null) {
    if (!Array.isArray(catalog) || !Array.isArray(hashes)) issue('catalog_checksum_manifest_required', catalogName);
    else {
      const byPath = new Map();
      for (const row of hashes) {
        if (!row || typeof row.path !== 'string' || byPath.has(row.path)) {issue('checksum_manifest_invalid', hashesName); continue;}
        byPath.set(row.path, row);
      }
      let record = 0;
      for (const group of catalog) {
        if (!Array.isArray(group?.assets)) {issue('catalog_invalid', catalogName); continue;}
        for (const row of group.assets) for (const [sourceKey, destKey] of [['sourceModel', 'model'], ['sourcePreview', 'preview']]) {
          const expected = byPath.get(row?.[destKey]);
          if (!expected?.sha256) {if (typeof row?.[sourceKey] === 'string') blocked.add(digest(row[sourceKey])); issue('checksum_required', catalogName, record++); continue;}
          await add(row, sourceKey, destKey, catalogName, record++, expected);
        }
      }
    }
  }
  for (const [key, row] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) if (!blocked.has(key)) entries[key] = row;
  return {index: {version: 1, algorithm: 'sha256-exact-utf8', entries}, stats: {...stats, indexed: Object.keys(entries).length}, diagnostics};
}
module.exports = {buildLocalResourceIndex};
