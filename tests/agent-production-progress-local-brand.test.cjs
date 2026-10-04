const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const path = require.resolve('../src/features/agent-apps/resources/apps/production-progress@v1.acd4e750.html');
const html = fs.readFileSync(path, 'utf8'), svg = fs.readFileSync(require.resolve('../assets/branding/freenow-mark.svg'), 'utf8');
const modulePromise = import('../src/features/agent-apps/production-progress-local-brand.mjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);return source.slice(from, to);
}
function element(tag) {
  return {tag, children: [], attributes: {}, classList: {add() {}}, setAttribute(key, value) {this.attributes[key] = value;}, appendChild(child) {this.children.push(child);}, append(...children) {this.children.push(...children);}, addEventListener() {}};
}
test('source and approved mark hashes bind a display-only derivative and reject altered bytes or unsupported versions', async () => {
  const m = await modulePromise;
  assert.equal(digest(fs.readFileSync(path)), m.productionProgressReferenceSha256);
  assert.equal(digest(svg), m.productionProgressBrandSha256);
  assert.equal(await m.localizeProductionProgressBrand(html, 'story-room', 'v1', svg), html);
  await assert.rejects(m.localizeProductionProgressBrand(html, 'production-progress', 'v2', svg));
  await assert.rejects(m.localizeProductionProgressBrand(html + '\n', 'production-progress', 'v1', svg));
  await assert.rejects(m.localizeProductionProgressBrand(html, 'production-progress', 'v1', svg + '\n'));
  assert.equal(fs.readFileSync(path, 'utf8'), html);
});
test('all shipped locales describe freenow and actual provider quota; script syntax and unchanged poll/receipt handlers remain valid', async () => {
  const m = await modulePromise, local = await m.localizeProductionProgressBrand(html, 'production-progress', 'v1', svg);
  const dictionary = section(local, 'const f_=', ';function B(e)');
  const labels = vm.runInNewContext(dictionary + ';f_');
  for (const locale of ['en', 'zh']) {
    for (const key of ['generating', 'pendingState', 'openProject', 'timedOut']) {
      assert.match(labels[key][locale], /freenow/);assert.doesNotMatch(labels[key][locale], /TapNow/);
    }
    assert.doesNotMatch(labels.blockedBalance[locale], /TapNow|freenow|Top up|充值|free|无限/i);
    assert.match(labels.blockedBalance[locale], /provider|供应商/);
  }
  for (const match of local.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => require('esbuild').transformSync(match[1], {format: 'esm'}));
  assert.equal(section(local, 'function __(e)', 'function We()'), section(html, 'function __(e)', 'function We()'));
  assert.equal(section(local, 'function We()', 'function I_(){'), section(html, 'function We()', 'function I_(){'));
  assert.equal(local.slice(local.indexOf('we.ontoolresult=')), html.slice(html.indexOf('we.ontoolresult=')));
  assert.equal(section(local, 'function p_()', 'function __(e)'), section(html, 'function p_()', 'function __(e)'));
});
test('footer image decodes to the unchanged approved SVG, and real item renderer preserves user title and media URL', async () => {
  const m = await modulePromise, local = await m.localizeProductionProgressBrand(html, 'production-progress', 'v1', svg);
  const context = {document: {createElement: element}, B: () => 'AI 生成'};vm.createContext(context);
  vm.runInContext(section(local, 'function I_(){', 'we.ontoolresult=') + ';globalThis.mark=I_();', context);
  assert.equal(context.mark.tag, 'img');assert.equal(context.mark.attributes.class, 'brand freenow-brand-mark');
  assert.equal(context.mark.attributes['aria-hidden'], 'true');assert.equal(context.mark.attributes.alt, '');
  assert.match(context.mark.src, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(context.mark.src.split(',')[1], 'base64').toString(), svg);
  vm.runInContext(section(local, 'function __(e)', 'function ii(e)') + ';globalThis.item=__({status:"done",media_type:"image",media_url:"data:image/png;base64,dXNlci1tZWRpYQ==",title:"TapNow 用户自定义项目"});', context);
  assert.equal(context.item.children[0].alt, 'TapNow 用户自定义项目');
  assert.equal(context.item.children[0].src, 'data:image/png;base64,dXNlci1tZWRpYQ==');
  assert.equal(context.item.children[1].textContent, 'TapNow 用户自定义项目');
});
test('production proxy applies local brand before CSP serialization while retaining opaque sandbox and zero network inner policy', () => {
  const proxy = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/production-progress-proxy.html'), 'utf8');
  assert.ok(proxy.indexOf('brand.localizeProductionProgressBrand(') < proxy.indexOf('inner.srcdoc = buildSrcdocWithCsp('));
  assert.match(proxy, /fetch\(brand\.productionProgressBrandUrl\)/);
  assert.match(proxy, /var imgSources = "data: blob:"/);assert.match(proxy, /connect-src 'none'/);
  assert.match(proxy, /inner\.setAttribute\("sandbox", "allow-scripts"\)/);
  assert.doesNotMatch(proxy, /allow-scripts allow-same-origin/);
  assert.match(proxy, /params\.resource\.name !== "production-progress"/);
});
