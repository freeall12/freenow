const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const sourcePath = require.resolve('../src/features/agent-apps/resources/apps/platform-resize@v1.897f4688.html');
const proxy = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/mcp-app-proxy.html'), 'utf8');
const source = fs.readFileSync(sourcePath, 'utf8');
const begin = proxy.indexOf('// PLATFORM_RESIZE_LOCAL_BRAND:BEGIN'), end = proxy.indexOf('// PLATFORM_RESIZE_LOCAL_BRAND:END');
const localize = vm.runInNewContext(proxy.slice(begin, end) + '\nlocalizePlatformResizeBrand', {crypto:crypto.webcrypto, TextEncoder, Uint8Array});
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function dictionary(html) {
  const start = html.indexOf('const dm='), end = html.indexOf(';function a_(', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(html.slice(start, end) + ';dm');
}
test('platform resize display derivative is hash/version bound and leaves captured bytes unchanged', async () => {
  assert.equal(digest(source), '897f46887563e4ed59db6b0f33cb0896631715c0c39a7e8793470978c7383365');
  assert.equal(await localize(source, 'story-room', 'v1'), source);
  await assert.rejects(localize(source, 'platform-resize', 'v2'), /unsupported/);
  await assert.rejects(localize(source + '\n', 'platform-resize', 'v1'), /integrity/);
  const local = await localize(source, 'platform-resize', 'v1');
  // A round-trip of only the four fixed labels proves all handlers and inputs stay unchanged.
  const restored = local.replace('free:"Local image cropping"', 'free:"No Tapies used"').replace('free:"本机图片裁切"', 'free:"不消耗 Tapies"').replace('open the freenow canvas', 'open the TapNow canvas').replace('请在 freenow 画布中查看', '请在 TapNow 画布中查看');
  assert.equal(restored, source);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), source);
  assert.match(proxy, /return localizePlatformResizeBrand\(templateHtml, name, version\);/);
  assert.ok(proxy.indexOf('return localizePlatformResizeBrand(') < proxy.indexOf('inner.srcdoc = buildSrcdocWithCsp('));
  assert.match(proxy, /connect-src 'none'/);
});
test('actual localized dictionaries keep crop counts, user content and working scripts intact', async () => {
  const local = await localize(source, 'platform-resize', 'v1'), labels = dictionary(local);
  assert.equal(labels.en.done(1), 'Added 1 image to the project, open the freenow canvas to view them.');
  assert.equal(labels.en.done(2), 'Added 2 images to the project, open the freenow canvas to view them.');
  assert.equal(labels.zh.done(3), '已添加 3 张到项目，请在 freenow 画布中查看。');
  assert.equal(labels.en.free, 'Local image cropping');assert.equal(labels.zh.free, '本机图片裁切');
  const preserveStart = local.indexOf('function c_('), preserveEnd = local.indexOf('function u_(', preserveStart);
  const userTitle = vm.runInNewContext(local.slice(preserveStart, preserveEnd) + ';c_("TapNow 用户作品", "fallback")');
  assert.equal(userTitle, 'TapNow 用户作品');
  for (const match of local.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) require('esbuild').transformSync(match[1], {loader:'js'});
  for (const match of proxy.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});
