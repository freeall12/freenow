'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), {createHash} = require('node:crypto'), {createRequire} = require('node:module');
const fr = createRequire(require.resolve('fabric')), jr = createRequire(fr.resolve('jsdom')), canvas = jr.resolve('canvas'), prior = require.cache[canvas];
require.cache[canvas] = {exports: {createCanvas: undefined}};
const {JSDOM, ResourceLoader} = fr('jsdom'), cssom = jr('cssom');
if (prior) require.cache[canvas] = prior; else delete require.cache[canvas];
const hash = value => createHash('sha256').update(value).digest('hex'), modulePromise = import('../src/features/local-resource-migration/html-document.mjs');
const remote = 'https://files.tapnow.media/old.png?signature=private', bytes = new Uint8Array([1, 2, 3, 4]);
const index = {version: 1, algorithm: 'sha256-exact-utf8', entries: {[hash(remote)]: {ref: '/assets/old.png', sha256: hash(bytes), bytes: bytes.length}}};
function fixture(t) {
  const automatic = [], explicit = [];
  class Loader extends ResourceLoader {fetch(url) {automatic.push(url); return null;}}
  const dom = new JSDOM('<body></body>', {url: 'http://localhost:4173/', resources: new Loader(), runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const options = {document: dom.window.document, index, hashSource: hash, hashBytes: hash, parseCss: cssom.parse, fetchImpl: async (url, opts) => {explicit.push([url, opts]); return new Response(bytes, {headers: {'content-type': 'image/png', 'content-length': String(bytes.length)}});}};
  return {dom, automatic, explicit, options};
}
test('inert preparation makes no request, preserves original hash, rejects changed-source binding and exposes no raw resource URL', async t => {
  const f = fixture(t), m = await modulePromise;
  const html = `<html lang="zh"><head><link rel="stylesheet" href="${remote}"></head><body><img src="${remote}"><script>globalThis.privateExecuted=true</script></body></html>`;
  const prepared = await m.prepareHtmlDocument(html, f.options);
  assert.equal(prepared.sourceHash, hash(html)); assert.deepEqual(f.automatic, []); assert.deepEqual(f.explicit, []);
  assert.ok(!JSON.stringify(prepared).includes('signature')); assert.equal(f.dom.window.privateExecuted, undefined);
  await assert.rejects(m.prepareHtmlDocument(html, {...f.options, expectedSourceHash: hash('changed')}), error => error.code === 'html_source_changed');
  const result = await m.materializeHtmlDocument(prepared, f.options);
  assert.equal(result.status, 'pending_import'); assert.ok(result.diagnostics.some(d => d.code === 'external_stylesheet_or_link_unsupported'));
  assert.equal(result.sourceHash, hash(html)); assert.deepEqual(f.automatic, []);
});
test('all explicit image/srcset/media/poster/SVG slots embed verified exact-index bytes without persistent writes', async t => {
  const f = fixture(t), m = await modulePromise;
  const html = `<img src="${remote}" srcset="${remote} 1x, ${remote} 2x"><picture><source srcset="${remote} 200w"></picture><video poster="${remote}"></video><svg><image href="${remote}"></image><image xlink:href="${remote}"></image></svg><template><img src="${remote}"></template>`;
  const result = await m.localizeHtmlDocument(html, {...f.options, assets: {put() {throw Error('must never write');}}});
  assert.equal(result.status, 'ready'); assert.equal(result.summary.slots, 8); assert.equal(result.summary.embedded, 8); assert.equal(f.explicit.length, 1);
  assert.equal(f.explicit[0][0], '/assets/old.png'); assert.equal(f.explicit[0][1].mode, 'same-origin'); assert.equal(f.explicit[0][1].redirect, 'error');
  assert.ok(!result.html.includes(remote)); assert.ok(result.html.includes('data:image/png;base64,AQIDBA==')); assert.equal(result.sourceHash, hash(html));
  const output = new f.dom.window.DOMParser().parseFromString(result.html, 'text/html');
  assert.equal(output.head.firstElementChild.getAttribute('http-equiv'), 'Content-Security-Policy'); assert.match(output.head.firstElementChild.content, /connect-src 'none'/);
  assert.deepEqual(f.automatic, []);
});
test('video and audio typed slots read trusted assets and blob URL adapters, refusing arbitrary URLs and MIME mismatches', async t => {
  const f = fixture(t), m = await modulePromise, reads = [], puts = [];
  const html = '<video src="asset:video"><source src="asset:video"></video><audio src="asset:audio"></audio>';
  const result = await m.localizeHtmlDocument(html, {...f.options, assets: {read: async key => {reads.push(key); return new Blob([bytes], {type: key === 'asset:video' ? 'video/mp4' : 'audio/wav'});}, put: key => puts.push(key)}});
  assert.equal(result.status, 'ready'); assert.deepEqual(reads, ['asset:video', 'asset:audio']); assert.deepEqual(puts, []); assert.deepEqual(f.explicit, []);
  const urlResult = await m.localizeHtmlDocument('<img src="asset:image">', {...f.options, assets: {url: async () => 'blob:http://localhost/trusted'}, fetchImpl: async url => {assert.equal(url, 'blob:http://localhost/trusted'); return new Response(bytes, {headers: {'content-type': 'image/png'}});}});
  assert.equal(urlResult.status, 'ready');
  for (const adapter of [{url: async () => remote}, {read: async () => new Blob([bytes], {type: 'text/html'})}]) {
    const rejected = await m.localizeHtmlDocument('<img src="asset:image">', {...f.options, assets: adapter}); assert.equal(rejected.status, 'pending_import');
  }
});
test('CSSOM rewrites CSS URL tokens including escaped values and nested rules; unsupported import/font/image-set and parse loss remain unresolved', async t => {
  const f = fixture(t), m = await modulePromise;
  const html = `<style>@media screen {.x {background-image:url("${remote}");content:"url(https://do-not-fetch.example/)"}}</style><div style='background:url("${remote}")'></div>`;
  const result = await m.localizeHtmlDocument(html, f.options);
  assert.equal(result.status, 'ready'); assert.equal(result.summary.embedded, 2); assert.ok(!result.html.includes(remote)); assert.ok(result.html.includes('do-not-fetch.example'));
  const escaped = await m.localizeHtmlDocument('<style>.x{background:u\\72l("https://files.tapnow.media/old.png?signature=private")}</style>', {...f.options, parseCss: text => cssom.parse(text.replace('u\\72l', 'url'))});
  assert.equal(escaped.status, 'ready'); assert.equal(escaped.summary.embedded, 1);
  for (const [css, code] of [[`@import "${remote}"; .x{background:url("${remote}")}`, 'css_import_unsupported'], [`@font-face{src:url("${remote}")}`, 'css_font_unsupported'], [`a{background:image-set("${remote}" 1x)}`, 'css_image_set_unsupported']]) {
    const pending = await m.localizeHtmlDocument('<style>' + css + '</style>', f.options); assert.equal(pending.status, 'pending_import'); assert.ok(pending.diagnostics.some(d => d.code === code));
  }
  const lost = await m.localizeHtmlDocument(`<style>.x{background:url("${remote}")}</style>`, {...f.options, parseCss: () => cssom.parse('.x{color:red}')});
  assert.ok(lost.diagnostics.some(d => d.code === 'css_parse_loss')); assert.equal(lost.status, 'pending_import');
  const unavailable = await m.localizeHtmlDocument(`<style>.x{background:url("${remote}")}</style>`, {...f.options, parseCss: undefined});
  assert.equal(unavailable.status, 'pending_import');
});
test('unknowns and verification failures remain explicit errors; retry uses unmodified source with bounded budgets', async t => {
  const f = fixture(t), m = await modulePromise, unknown = remote + '&unknown=1', html = `<img src="${remote}"><img src="${unknown}">`;
  const prepared = await m.prepareHtmlDocument(html, f.options);
  const bad = await m.materializeHtmlDocument(prepared, {...f.options, fetchImpl: async () => new Response(new Uint8Array([9, 8, 7, 6]), {headers: {'content-type': 'image/png'}})});
  assert.equal(bad.status, 'pending_import'); assert.ok(bad.diagnostics.some(d => d.code === 'resource_read_failed')); assert.equal(bad.summary.embedded, 0);
  const good = await m.materializeHtmlDocument(prepared, f.options); assert.equal(good.summary.embedded, 1); assert.equal(good.summary.unresolved, 1);
  assert.equal(good.diagnostics[0].sourceHash, hash(unknown)); assert.ok(!JSON.stringify(good.diagnostics).includes('private'));
  const budget = await m.materializeHtmlDocument(prepared, {...f.options, maxBytes: 3}); assert.equal(budget.status, 'pending_import');
  const malformed = await m.localizeHtmlDocument('<img srcset="bad 1x 2x">', f.options); assert.ok(malformed.diagnostics.some(d => d.code === 'srcset_invalid'));
});
test('dynamic inline code is only a warning; external code/navigation and embedded documents never become silent ready exports', async t => {
  const f = fixture(t), m = await modulePromise;
  const inline = '<style>.x{color:red}</style><button onclick="this.textContent=1">Go</button><script>location.href="https://example.com/"</script>';
  assert.equal(m.hasHtmlResourceSlots(inline, f.options), false);
  assert.equal(m.hasHtmlResourceSlots('<img src="asset:x">', f.options), true);
  assert.equal(m.hasHtmlResourceSlots('<style>.x{background:u\\72l(x)}</style>', f.options), true);
  const ready = await m.localizeHtmlDocument(inline, f.options); assert.equal(ready.status, 'ready'); assert.ok(ready.diagnostics.every(d => d.severity === 'warning'));
  const html = `<base href="${remote}"><meta http-equiv="refresh" content="0;url=${remote}"><meta http-equiv="Content-Security-Policy" content="img-src https:"><script src="${remote}"></script><iframe src="${remote}"></iframe><a href="${remote}" ping="${remote}">x</a>`;
  const blocked = await m.localizeHtmlDocument(html, f.options); assert.equal(blocked.status, 'pending_import');
  assert.ok(blocked.diagnostics.some(d => d.code === 'external_script_unsupported' && d.severity === 'error')); assert.ok(!blocked.html.includes(remote)); assert.deepEqual(f.explicit, []);
});
test('AbortSignal cancels before parsing and while reading without returning late derived content', async t => {
  const f = fixture(t), m = await modulePromise, controller = new AbortController(); controller.abort();
  await assert.rejects(m.localizeHtmlDocument('<img>', {...f.options, signal: controller.signal}), error => error.name === 'AbortError');
  const reading = new AbortController();
  await assert.rejects(m.localizeHtmlDocument('<img src="asset:x">', {...f.options, signal: reading.signal, assets: {read: async () => {reading.abort(); return new Blob([bytes], {type: 'image/png'});}}}), error => error.name === 'AbortError');
});
test('document wrapper media styles are preserved and resolved; SVG external code/resources stay unresolved; widget Blob capability is fixed and scoped', async t => {
  const f = fixture(t), m = await modulePromise;
  const source = `<!doctype html><!--prefix--><html lang="zh" class="theme" style='background:url("${remote}")'><head><title>原标题</title></head><body class="layout" style='background:url("${remote}")'><p>正文</p></body></html>`;
  const result = await m.localizeHtmlDocument(source, f.options);
  assert.equal(result.status, 'ready'); assert.equal(result.summary.embedded, 2); assert.equal(result.sourceHash, hash(source));
  const output = new f.dom.window.DOMParser().parseFromString(result.html, 'text/html');
  assert.equal(output.documentElement.lang, 'zh'); assert.equal(output.documentElement.className, 'theme'); assert.equal(output.body.className, 'layout'); assert.equal(output.title, '原标题'); assert.match(output.body.style.background, /data:image/);
  const svg = await m.localizeHtmlDocument(`<svg><script xlink:href="${remote}"></script><use href="${remote}"></use></svg>`, f.options);
  assert.equal(svg.status, 'pending_import'); assert.ok(svg.diagnostics.some(d => d.code === 'external_script_unsupported')); assert.ok(svg.diagnostics.some(d => d.code === 'resource_slot_unsupported'));
  const widget = await m.localizeHtmlDocument('<script>const x = URL.createObjectURL(new Blob())</script>', {...f.options, policyTarget: 'widget'});
  assert.equal(widget.status, 'ready'); assert.match(widget.html, /img-src data: blob:/); assert.match(widget.html, /connect-src 'none'/);
  assert.ok(!result.html.includes('img-src data: blob:'));
  await assert.rejects(m.localizeHtmlDocument('<p>x</p>', {...f.options, policyTarget: 'remote'}), error => error.code === 'html_input_invalid');
});
test('asset Blob stream budgets stop oversized bytes without reading the whole object, and typed data references reject mismatches', async t => {
  const f = fixture(t), m = await modulePromise; let cancelled = false, pulls = 0;
  const result = await m.localizeHtmlDocument('<img src="asset:huge">', {...f.options, maxBytes: 3, assets: {url: async () => 'blob:http://localhost/local'}, fetchImpl: async () => new Response(new ReadableStream({pull(controller) {pulls++; controller.enqueue(bytes);}, cancel() {cancelled = true;}}), {headers: {'content-type': 'image/png'}})});
  assert.equal(result.status, 'pending_import'); assert.equal(result.diagnostics[0].code, 'resource_budget_exceeded'); assert.equal(cancelled, true); assert.ok(pulls < 4);
  const data = await m.localizeHtmlDocument('<audio src="data:image/png;base64,AQIDBA==">', f.options);
  assert.equal(data.status, 'pending_import'); assert.equal(data.diagnostics[0].code, 'asset_type_invalid');
});
