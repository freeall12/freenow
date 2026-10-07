'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {inventory} = require('./prepare-desktop.cjs');
const root = path.resolve(__dirname, '..');

// Audit bytes from the actual bundle, not only the intended staging list.
async function audit(appPath) {
  const resources = path.join(appPath, 'Contents/Resources');
  const runtime = path.join(resources, 'runtime');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'runtime-manifest.json'), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  if (manifest.version !== 1 || manifest.dataIncluded !== false || manifest.ffmpegBundled !== false || manifest.commit !== commit || manifest.stagedChanges || manifest.workingTreeChanges) {
    throw Error('Runtime must be built from this committed source with no private data or dirty tracked files.');
  }
  const actual = await inventory(runtime);
  const expected = new Map(manifest.entries.map(row => [row.path, row]));
  const privatePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|providers\.env|\.agent-sessions|\.generation-(?:tasks|media)(?:-[^/]*)?|\.segmentation-tasks|\.writer-lock|qa|research|fixtures)(?:\/|$)|\.(?:har|pem|key|p12|pfx|bak|tmp|log)$/i;
  for (const row of actual) {
    if (privatePath.test(row.path)) throw Error('Private or QA artifact path: ' + row.path);
    if (row.path === 'runtime-manifest.json') continue;
    const planned = expected.get(row.path);
    if (!planned || planned.bytes !== row.bytes || planned.sha256 !== row.sha256) throw Error('Artifact differs from runtime manifest: ' + row.path);
    expected.delete(row.path);
  }
  if (expected.size) throw Error('Missing runtime files: ' + expected.size);
  for (const name of ['canvas-data', 'editor-data', 'sidebar-data', 'versions-data']) {
    const shipped = await fs.readFile(path.join(runtime, name + '.js'));
    const empty = await fs.readFile(path.join(root, 'defaults', name + '.js'));
    if (!shipped.equals(empty)) throw Error('Personal startup data included: ' + name);
  }
  const builder = require.resolve('app-builder-lib', {paths: [require.resolve('electron-builder')]});
  const asar = require(require.resolve('@electron/asar', {paths: [builder]}));
  const archive = path.join(resources, 'app.asar');
  const archiveEntries = asar.listPackage(archive);
  for (const file of archiveEntries) if (privatePath.test(file.replace(/^\//, ''))) throw Error('Private ASAR path: ' + file);
  for (const name of ['main.cjs', 'runtime-config.cjs']) {
    if (!asar.extractFile(archive, name).equals(await fs.readFile(path.join(root, 'desktop', name)))) throw Error('Stale desktop entry: ' + name);
  }
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json'));
  const icon = await fs.readFile(path.join(resources, 'icon.icns'));
  if (metadata.name !== 'freenow-desktop' || metadata.version !== '0.1.0-alpha.1' || icon.subarray(0, 4).toString() !== 'icns') throw Error('Unexpected app version or icon.');
  return {version: metadata.version, commit, runtimeFiles: actual.length, runtimeBytes: actual.reduce((sum, row) => sum + row.bytes, 0), asarEntries: archiveEntries.length, privatePathsFound: 0, emptyDefaultsMatch: true, manifestHashesMatch: true, desktopEntriesMatch: true, iconSha256: createHash('sha256').update(icon).digest('hex'), ffmpegBundled: false, signed: false};
}
module.exports = {audit};
if (require.main === module) audit(path.resolve(process.argv[2] || path.join(root, 'build/release/mac-arm64/freenow.app'))).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {console.error(error.message); process.exitCode = 1;});
