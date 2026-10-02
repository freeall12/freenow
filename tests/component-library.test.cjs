'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('component library exposes existing pure canvas and media APIs', async () => {
  const canvas = require('../component-library/core.cjs');
  const media = await import('../component-library/media.mjs');
  assert.equal(typeof canvas.geometry.toWorld, 'function');
  assert.equal(typeof canvas.navigation.fit, 'function');
  assert.equal(typeof canvas.search.query, 'function');
  assert.equal(typeof canvas.playlist.cut, 'function');
  assert.equal(typeof media.preview.layout, 'function');
  assert.equal(typeof media.videoTrim.constrainRange, 'function');
});

test('feature facade reports missing host and rejects unknown tools before loading UI', async () => {
  const features = await import('../component-library/features.mjs');
  assert.throws(() => features.openNodeSearch(), /CanvasApp/);
  await assert.rejects(features.openImageTool('unknown', 'id'), /未知图片工具/);
  await assert.rejects(features.openVideoTool('unknown', 'id'), /未知视频工具/);
});

test('catalog entries resolve to real implementation files', async () => {
  const { default: entries } = await import('../component-library/catalog.mjs');
  assert.ok(entries.length >= 20);
  for (const entry of entries) {
    assert.ok(entry.name && entry.api && entry.kind);
    for (const file of [entry.entry, ...entry.files]) {
      assert.ok(fs.existsSync(path.join(root, file)), `${entry.name}: ${file}`);
    }
  }
});

test('every canvas menu page loads its extracted UI dependency first', () => {
  const pages = [path.join(root, 'index.html'), ...fs.readdirSync(path.join(root, 'qa'))
    .filter(name => name.endsWith('.html')).map(name => path.join(root, 'qa', name))];
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const menu = html.indexOf('<script src="canvas-menus.js"></script>');
    if (menu < 0) continue;
    const ui = html.indexOf('<script src="component-library/ui.js"></script>');
    assert.ok(ui >= 0 && ui < menu, page);
  }
});
