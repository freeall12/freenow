const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const load = () => import('../src/features/agent-welcome/suggestions.mjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('thirty exact static records preserve prompt, identity, categories and no invented descriptions', async () => {
  const { homeFallbackZh, getWelcomeSuggestionCard } = await load();
  assert.equal(homeFallbackZh.length, 30);
  assert.equal(sha256(JSON.stringify(homeFallbackZh)), '28dd87b1b798811961980bb8d878aaf78681c3c57c3bdd6e39419fb15210f994');
  const counts = {};
  homeFallbackZh.forEach((item, index) => {
    assert.equal(item.id, `home-fallback-zh-${String(index + 1).padStart(2, '0')}`);
    assert.deepEqual(Object.keys(item), ['id', 'title', 'prompt', 'icon_category']);
    assert.notEqual(item.prompt, item.title);
    assert.ok(Object.isFrozen(item));
    assert.equal(getWelcomeSuggestionCard(item.id).description, null);
    counts[item.icon_category] = (counts[item.icon_category] ?? 0) + 1;
  });
  assert.deepEqual(counts, { next_step: 9, inspiration: 4, analyze: 5, reference: 4, organize: 6, character: 2 });
  assert.ok(Object.isFrozen(homeFallbackZh));
  assert.ok(!homeFallbackZh.some(item => item.title.includes('搭建可视化创作工作台')));
});

test('static data matches the captured literal without importing or executing that bundle', async t => {
  const { homeFallbackZh, welcomeSuggestionSource } = await load();
  let capture;
  try { capture = await fs.readFile(path.join(root, welcomeSuggestionSource.file)); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('Ignored research capture is absent; exact record digest is checked separately'); throw error; }
  assert.equal(sha256(capture), welcomeSuggestionSource.sha256);
  const source = capture.toString('utf8');
  const start = source.indexOf('const Oz=[') + 'const Oz='.length;
  const end = source.indexOf('],Uz=', start) + 1;
  assert.ok(start > 0 && end > start);
  const literal = source.slice(start, end).replace(/(?<=[{,])(id|title|prompt|icon_category):/g, '"$1":');
  assert.deepEqual(homeFallbackZh, JSON.parse(literal));
  assert.ok(source.includes('o(fo(C.prompt))'));
  assert.ok(source.includes('const Y=i.trim()||C?.prompt||""'));
});

test('fresh-session pairs rotate through all thirty suggestions and wrap without losing identities', async () => {
  const { getWelcomeSuggestionPage } = await load();
  const ids = [];
  let offset = 0;
  for (let index = 0; index < 15; index++) {
    const page = getWelcomeSuggestionPage({ offset });
    assert.equal(page.size, 2);
    assert.equal(page.total, 30);
    ids.push(...page.items.map(item => item.id));
    offset = page.nextOffset;
    assert.ok(Object.isFrozen(page) && Object.isFrozen(page.items));
  }
  assert.equal(new Set(ids).size, 30);
  assert.equal(offset, 0);
  assert.deepEqual(getWelcomeSuggestionPage({ offset: 29 }).items.map(item => item.id), ['home-fallback-zh-30', 'home-fallback-zh-01']);
  assert.equal(getWelcomeSuggestionPage({ offset: -1 }).offset, 29);
  assert.equal(getWelcomeSuggestionPage({ offset: 60, size: 3 }).nextOffset, 3);
  for (const size of [0, -1, 31, NaN, 1.5]) assert.throws(() => getWelcomeSuggestionPage({ size }), RangeError);
  for (const offset of [Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => getWelcomeSuggestionPage({ offset }), TypeError);
});

test('selection returns the complete prompt and adapts Brainstorm to a semantic app reference', async () => {
  const { homeFallbackZh, getWelcomeSuggestionPrompt, getWelcomeSuggestionInput } = await load();
  const { textDocument, mentionNames, documentText } = await import('../src/features/agent-composer/editor-state.mjs');
  const { referenceNodes } = await import('../src/features/agent-composer/reference-data.mjs');
  for (const [index, item] of homeFallbackZh.entries()) {
    const input = getWelcomeSuggestionInput(item.id);
    assert.equal(getWelcomeSuggestionPrompt(item.id), item.prompt);
    assert.equal(input.prompt, item.prompt);
    if (index >= 12 && index <= 17) {
      assert.equal(input.text, item.prompt.slice('{{brainstorm:brainstorm}} '.length));
      assert.deepEqual(input.references, [{ kind: 'app', id: 'brainstorm', label: '头脑风暴' }]);
      const doc = textDocument(`@头脑风暴 ${input.text}`, [], input.references);
      assert.deepEqual(referenceNodes(doc), input.references);
      assert.deepEqual(mentionNames(doc), []);
      assert.equal(documentText(doc), `@头脑风暴 ${input.text}`);
    } else {
      assert.equal(input.text, item.prompt);
      assert.deepEqual(input.references, []);
    }
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.references));
  }
  assert.equal(getWelcomeSuggestionPrompt('unknown'), null);
  assert.equal(getWelcomeSuggestionInput('unknown'), null);
  assert.equal(getWelcomeSuggestionPrompt({ id: homeFallbackZh[0].id }), null);
});

test('local canvas rotates only the eighteen creative suggestions and preserves the thirty-record source', async () => {
  const { homeFallbackZh, canvasWelcomeSuggestions, getCanvasWelcomeSuggestionPage, getWelcomeSuggestionPage } = await load();
  assert.equal(homeFallbackZh.length, 30);
  assert.deepEqual(canvasWelcomeSuggestions, homeFallbackZh.slice(12));
  assert.ok(Object.isFrozen(canvasWelcomeSuggestions));
  const collected = [];
  let offset = 0;
  for (let index = 0; index < 9; index++) {
    const page = getCanvasWelcomeSuggestionPage({ offset });
    assert.equal(page.total, 18);
    assert.equal(page.size, 2);
    collected.push(...page.items);
    offset = page.nextOffset;
  }
  assert.equal(offset, 0);
  assert.deepEqual(collected, canvasWelcomeSuggestions);
  assert.equal(new Set(collected.map(item => item.id)).size, 18);
  assert.ok(collected.every(item => !/Seedance|GPT Image|Midjourney/.test(item.title)));
  assert.deepEqual(getCanvasWelcomeSuggestionPage({ offset: 17 }).items.map(item => item.id), ['home-fallback-zh-30', 'home-fallback-zh-13']);
  assert.equal(getCanvasWelcomeSuggestionPage({ offset: -1 }).offset, 17);
  assert.throws(() => getCanvasWelcomeSuggestionPage({ size: 19 }), RangeError);
  assert.equal(getWelcomeSuggestionPage().items[0], homeFallbackZh[0]);
});

test('local icons are byte-for-byte copies of the already installed Tabler outline assets', async () => {
  const { welcomeSuggestionIcons, getWelcomeSuggestionCard } = await load();
  assert.deepEqual(Object.keys(welcomeSuggestionIcons), ['inspiration', 'character', 'reference', 'analyze', 'next_step', 'organize']);
  for (const [category, icon] of Object.entries(welcomeSuggestionIcons)) {
    assert.ok(Object.isFrozen(icon));
    assert.equal(icon.localLibrary, '@tabler/icons');
    const local = await fs.readFile(path.join(root, icon.path.slice(1)));
    const original = await fs.readFile(path.join(root, 'node_modules/@tabler/icons/icons/outline', `${icon.localName}.svg`));
    assert.deepEqual(local, original, category);
  }
  assert.equal(welcomeSuggestionIcons.character.originalLibrary, 'tabler');
  assert.equal(welcomeSuggestionIcons.analyze.originalName, 'ScanSearch');
  assert.equal(welcomeSuggestionIcons.analyze.localName, 'zoom-scan');
  assert.equal(getWelcomeSuggestionCard('unknown'), null);
});
