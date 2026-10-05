const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const modulePromise = import('../src/features/agent-apps/picker-local-presentation.mjs');
const fixtures = [
  ['creative-picker', '2a07bc2e', 'CreativeLocales'],
  ['website-design-picker', '2a07bc2e', 'CreativeLocales'],
  ['motion-picker', '11addd0c', 'MotionLocales'],
];
const read = (name, hash) => fs.readFileSync(require.resolve(`../src/features/agent-apps/resources/apps/${name}@v1.${hash}.html`), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function localeData(html, variable) {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match => match[1].includes('window.' + variable + '='));
  assert.ok(script, 'actual locale script must be present');
  const sandbox = {window: {}};
  vm.runInNewContext(script[1], sandbox);
  return JSON.parse(JSON.stringify(sandbox.window[variable]));
}
function assignment(html, variable) {
  const start = html.indexOf('window.' + variable + '=');
  assert.ok(start >= 0);
  let depth = 0, quoted = false, escaped = false;
  for (let index = html.indexOf('{', start); index < html.length; index++) {
    const character = html[index];
    if (quoted) {if (escaped) escaped = false;else if (character === '\\') escaped = true;else if (character === '"') quoted = false;}
    else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  assert.fail('unterminated template reference assignment');
}
test('only supported picker source bytes may be derived; captured files are unchanged', async () => {
  const m = await modulePromise;
  for (const [name, hash] of fixtures) {
    const source = read(name, hash);
    assert.equal(digest(source), m.pickerPresentationReferences[name]);
    await assert.rejects(m.localizePickerPresentation(source, name, 'v2'), /unsupported/);
    await assert.rejects(m.localizePickerPresentation(source + '\n', name, 'v1'), /integrity/);
    await assert.rejects(m.localizePickerPresentation(null, name, 'v1'), /captured HTML/);
    await m.localizePickerPresentation(source, name, 'v1');
    assert.equal(read(name, hash), source);
  }
  assert.equal(await m.localizePickerPresentation('unrelated app bytes', 'story-room', 'v1'), 'unrelated app bytes');
  assert.equal(await m.localizePickerPresentation('prototype name bytes', 'toString', 'v1'), 'prototype name bytes');
});
test('five actual locale dictionaries explain previews and screen recording without promising generation or video export', async () => {
  const m = await modulePromise;
  const semantics = {
    en_US: [/interactive previews/, /screen recording/, /video export is not available/],
    zh_CN: [/交互预览/, /录屏保存/, /暂不提供视频导出/],
    ja_JP: [/プレビュー/, /画面録画/, /対応していません/],
    ko_KR: [/미리보기/, /화면 녹화/, /제공되지 않습니다/],
    fr_FR: [/aperçus interactifs/, /enregistrement d’écran/, /n’est pas disponible/],
  };
  for (const [name, hash, variable] of fixtures) {
    const source = read(name, hash), local = await m.localizePickerPresentation(source, name, 'v1');
    const before = localeData(source, variable), after = localeData(local, variable);
    for (const [locale, requirements] of Object.entries(semantics)) {
      for (const expression of requirements) assert.match(after[locale].exportNote, expression);
      assert.doesNotMatch(after[locale].exportNote, /coming soon|即将|近日|곧|bientôt|生成|generate|HTML/i);
      delete before[locale].exportNote;delete after[locale].exportNote;
    }
    assert.deepEqual(after, before, 'other locale labels, template descriptions and handoff statuses remain unchanged');
    if (name !== 'motion-picker') {
      assert.equal(assignment(local, 'TemplateReferences'), assignment(source, 'TemplateReferences'));
      assert.match(local, /data-i18n="exportNote">This panel provides interactive previews/);
    }
    for (const match of local.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) require('esbuild').transformSync(match[1], {loader:'js'});
    // Existing sendPrompt and confirmation handlers are serialized in the first module script.
    const protocolScript = html => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match => match[1].includes('tapnow/sendPrompt'))?.[1];
    assert.equal(digest(protocolScript(local)), digest(protocolScript(source)));
  }
});
