'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {buildLocalResourceIndex} = require('./build-index.cjs');

async function writeLocalResourceIndex({root, output = path.join(root, 'assets/local-resource-index.json')}) {
  if (path.resolve(output) !== path.resolve(root, 'assets/local-resource-index.json')) throw Error('索引输出必须位于项目 assets/local-resource-index.json');
  const result = await buildLocalResourceIndex({root});
  // A broken manifest must not publish an apparently valid replacement index.
  if (result.diagnostics.length) return {...result, published: false};
  const directory = path.dirname(output);
  await fs.mkdir(directory, {recursive: true});
  const realRoot = await fs.realpath(root), realDirectory = await fs.realpath(directory);
  if (realDirectory !== path.join(realRoot, 'assets')) throw Error('索引目录不能指向项目外部');
  const temporary = path.join(directory, '.local-resource-index-' + process.pid + '-' + require('node:crypto').randomUUID());
  try {
    await fs.writeFile(temporary, JSON.stringify(result.index) + '\n', {flag: 'wx', mode: 0o600});
    await fs.rename(temporary, output);
  } finally {await fs.unlink(temporary).catch(() => {});}
  return {...result, published: true};
}
module.exports = {writeLocalResourceIndex};
if (require.main === module) {
  const root = process.argv[2] && path.resolve(process.argv[2]);
  if (!root) {process.stderr.write('用法: node src/features/local-resource-migration/cli.cjs <项目目录> [索引绝对路径]\n'); process.exitCode = 1;}
  else writeLocalResourceIndex({root, ...(process.argv[3] ? {output: process.argv[3]} : {})}).then(result => {
    process.stdout.write(JSON.stringify({published: result.published, stats: result.stats, diagnostics: result.diagnostics}) + '\n');
    if (!result.published) process.exitCode = 1;
  }).catch(() => {process.stderr.write('本地资源索引构建失败；未确认发布成功\n'); process.exitCode = 1;});
}
