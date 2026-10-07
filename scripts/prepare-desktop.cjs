'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build/desktop/runtime');
const {buildLocalResourceIndex} = require('../src/features/local-resource-migration/build-index.cjs');

function isRuntimeFile(file) {
  if (file.split('/').some(part => !part || part === '..' || part.startsWith('.'))) return false;
  if (/(?:^|\/)(?:qa|tests|research|fixtures)(?:\/|$)/.test(file)) return false;
  if (/\.(?:har|pem|key|p12|pfx|bak|tmp|log)$/i.test(file)) return false;
  if (file.startsWith('server/')) return file.endsWith('.cjs');
  if (/^(?:assets|src|defaults|component-library|runtime-reference|help)\//.test(file)) return true;
  return !file.includes('/') && /\.(?:js|mjs|html|css)$/.test(file) && !/^(?:canvas|editor|sidebar|versions)-data\.js$/.test(file);
}
async function copyPublicFile(relative, destination = relative) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Build source must be a regular tracked file: ' + relative);
  const target = path.join(output, destination);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.copyFile(source, target);
}
async function dependencyRoot(name) {
  let directory = path.dirname(require.resolve(name));
  while (directory !== path.dirname(directory)) {
    try {if (JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).name === name) return await fs.realpath(directory);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    directory = path.dirname(directory);
  }
  throw Error('Runtime dependency unavailable: ' + name);
}
async function inventory(directory, relative = '') {
  const rows = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name), ref = relative ? relative + '/' + name : name;
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw Error('Symlink not permitted in runtime: ' + ref);
    if (stat.isDirectory()) rows.push(...await inventory(file, ref));
    else if (stat.isFile()) {const bytes = await fs.readFile(file); rows.push({path: ref, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});}
  }
  return rows;
}
async function prepare() {
  // Archive only our generated staging. Never merge it with the next build or
  // remove an arbitrary directory which happens to be named runtime.
  try {await fs.mkdir(output, {recursive: false});}
  catch (error) {
    if (error.code === 'ENOENT') {await fs.mkdir(path.dirname(output), {recursive: true}); await fs.mkdir(output);}
    else if (error.code === 'EEXIST') {
      const marker = JSON.parse(await fs.readFile(path.join(output, 'runtime-manifest.json'), 'utf8'));
      if (marker.version !== 1 || marker.dataIncluded !== false) throw Error('Unrecognized staging directory. Move build/desktop aside before preparing.');
      await fs.rename(output, output + '.previous-' + Date.now());
      await fs.mkdir(output);
    }
    else throw error;
  }
  const files = execFileSync('git', ['ls-files', '--cached', '-z'], {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).split('\0').filter(isRuntimeFile);
  for (const file of files) await copyPublicFile(file);
  for (const name of ['canvas-data', 'editor-data', 'sidebar-data', 'versions-data']) await copyPublicFile(`defaults/${name}.js`, `${name}.js`);
  await copyPublicFile('.env.example', 'provider.env.example');
  await copyPublicFile('docs/THIRD-PARTY-RESOURCES.md', 'THIRD-PARTY-RESOURCES.md');
  const mapping = await buildLocalResourceIndex({root});
  if (mapping.diagnostics.length) throw Error('Public resource index failed validation; nothing is releasable.');
  const entries = Object.fromEntries(Object.entries(mapping.index.entries).filter(([, value]) => files.includes(decodeURIComponent(value.ref).replace(/^\//, ''))));
  await fs.writeFile(path.join(output, 'assets/local-resource-index.json'), JSON.stringify({...mapping.index, entries}) + '\n');
  for (const name of ['openai', 'three']) {
    const directory = await dependencyRoot(name);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (Object.keys(metadata.dependencies || {}).length) throw Error('Explicit dependency allowlist must be extended before packaging ' + name);
    await fs.cp(directory, path.join(output, 'node_modules', name), {recursive: true, dereference: false, filter: source => !/(?:^|\/)(?:\.git|test|tests|\.env)(?:\/|$)/.test(source)});
  }
  const gitOutput = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  const manifest = {version: 1, commit: gitOutput(['rev-parse', 'HEAD']), stagedChanges: Boolean(gitOutput(['diff', '--cached', '--name-only'])), workingTreeChanges: Boolean(gitOutput(['diff', '--name-only'])), dataIncluded: false, ffmpegBundled: false, entries: await inventory(output)};
  await fs.writeFile(path.join(output, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({runtimeFiles: manifest.entries.length, bytes: manifest.entries.reduce((sum, row) => sum + row.bytes, 0), privateDataIncluded: false}));
  return manifest;
}
module.exports = {isRuntimeFile, prepare, inventory};
if (require.main === module) prepare().catch(error => {console.error(error.message); process.exitCode = 1;});
