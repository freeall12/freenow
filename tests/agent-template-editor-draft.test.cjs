const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const path = '../src/features/agent-apps/';
const fixture = () => ({artifact_path: 'artifacts/templates/A01/selection/editable.html', draft_scope: 'project-qa',
  template_source_identity: {template_id: 'A01', selection_trace_id: 'trace_qa', handoff_id: 'handoff_qa'},
  source_artifact_path: 'artifacts/templates/A01/selection/source.html', source_revision: 1,
  title: '合成草稿测试', revision: 2, content: '<html>saved synthetic fixture 中文</html>'});
function memoryStorage() {
  const data = new Map(); return {data, getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)};
}
function makeDom() {
  const projectRequire = createRequire(process.cwd() + '/package.json'), fabricRequire = createRequire(projectRequire.resolve('fabric'));
  const jsdomRequire = createRequire(fabricRequire.resolve('jsdom'));
  const canvas = jsdomRequire.resolve('canvas'), prior = require.cache[canvas];
  require.cache[canvas] = {exports: {createCanvas: undefined}};
  let JSDOM; try { ({JSDOM} = fabricRequire('jsdom')); } finally { if (prior) require.cache[canvas] = prior; else delete require.cache[canvas]; }
  const dom = new JSDOM('<button>入口</button>', {url: 'http://localhost:4173/src/features/agent-apps/qa/template-editor.html'});
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  return dom;
}

test('tab recovery binds project, original template identity and source revision; changed saved text is a conflict', async () => {
  const {createTemplateEditorDraft} = await import(path + 'template-editor-draft.mjs');
  const storage = memoryStorage(), file = fixture(), draft = createTemplateEditorDraft({file, storage});
  assert.equal(draft.load(), null); draft.save('<html>unsaved 中文😀</html>');
  const reopened = createTemplateEditorDraft({file, storage});
  assert.equal(reopened.load().content, '<html>unsaved 中文😀</html>'); assert.equal(reopened.load().conflict, false);
  assert.equal(reopened.load({...file, revision: 3}).conflict, true);
  assert.equal(reopened.load({...file, content: 'replacement'}).conflict, true);
  for (const different of [{draft_scope: 'other-project'}, {source_revision: 9},
    {template_source_identity: {...file.template_source_identity, handoff_id: 'different'}}]) {
    assert.equal(createTemplateEditorDraft({file: {...file, ...different}, storage}).load(), null);
  }
  assert.equal(storage.data.size, 1, 'other projects do not remove a previous draft');
});

test('quota, corrupted records and concurrent replacement do not silently overwrite a retained draft', async () => {
  const {createTemplateEditorDraft} = await import(path + 'template-editor-draft.mjs');
  const storage = memoryStorage(), file = fixture(), draft = createTemplateEditorDraft({file, storage});
  draft.load(); draft.save('first draft'); const key = [...storage.data.keys()][0], retained = storage.data.get(key);
  storage.setItem = () => { throw Error('QuotaExceededError'); };
  assert.throws(() => draft.save('second draft'), /Quota/); assert.equal(storage.data.get(key), retained);
  assert.throws(() => draft.save('x'.repeat(60001)), /容量/); assert.equal(storage.data.get(key), retained);
  storage.data.set(key, JSON.stringify({...JSON.parse(retained), content: 'another editor'}));
  assert.throws(() => draft.clear(), /已变化/); assert.throws(() => draft.save('must not overwrite'), /已变化/);
  assert.equal(JSON.parse(storage.data.get(key)).content, 'another editor');
  storage.data.set(key, 'invalid json');
  const broken = createTemplateEditorDraft({file, storage});
  assert.throws(() => broken.load(), /格式损坏/); assert.throws(() => broken.save('cannot replace corrupted record'), /读取校验/);
  assert.throws(() => createTemplateEditorDraft({file, storage}).save('cannot skip loading'), /格式损坏/);
  assert.equal(storage.data.get(key), 'invalid json');
});

test('actual editor restores only on an explicit click, retains newer saved revision and clears a successfully saved draft', async () => {
  const {openTemplateSourceEditor} = await import(path + 'template-source-editor.mjs');
  const dom = makeDom(), document = dom.window.document, storage = memoryStorage();
  Object.defineProperty(dom.window, 'sessionStorage', {value: storage});
  let file = fixture(), writes = 0, fail = false;
  const session = () => ({read: () => structuredClone(file), close() {}, save: async ({content}) => {
    if (fail) throw Error('synthetic save failed'); writes++; file = {...file, content, revision: file.revision + 1}; return structuredClone(file);
  }});
  const buttons = editor => Object.fromEntries([...editor.element.querySelectorAll('button')].map(button => [button.textContent, button]));
  function input(editor, content) { const textarea = editor.element.querySelector('textarea'); textarea.value = content; textarea.dispatchEvent(new dom.window.Event('input')); return textarea; }
  try {
    let editor = openTemplateSourceEditor({session: session(), document});
    input(editor, '<html>recover synthetic draft 😀</html>'); editor.element.close();
    assert.equal(writes, 0); assert.equal(storage.data.size, 1);
    file = {...file, revision: file.revision + 1, content: '<html>new saved revision</html>'};
    editor = openTemplateSourceEditor({session: session(), document});
    const textarea = editor.element.querySelector('textarea');
    assert.equal(textarea.value, file.content); assert.match(editor.element.textContent, /旧版本草稿.*已保存正文发生变化/);
    assert.equal(textarea.readOnly, true); assert.equal(buttons(editor)['保存修改'].disabled, true);
    assert.equal(writes, 0); buttons(editor)['恢复本地草稿'].onclick();
    assert.equal(textarea.readOnly, false);
    assert.equal(textarea.value, '<html>recover synthetic draft 😀</html>'); assert.equal(file.content, '<html>new saved revision</html>');
    fail = true; await buttons(editor)['保存修改'].onclick(); assert.equal(writes, 0); assert.equal(storage.data.size, 1);
    assert.equal(textarea.value, '<html>recover synthetic draft 😀</html>');
    fail = false; await buttons(editor)['保存修改'].onclick();
    assert.equal(writes, 1); assert.equal(file.content, textarea.value); assert.equal(storage.data.size, 0);
    editor.close();
    editor = openTemplateSourceEditor({session: session(), document});
    assert.equal(editor.element.querySelector('.agent-template-draft-recovery').hidden, true);
    input(editor, 'explicitly discarded'); editor.close(); buttons(editor)['放弃修改并关闭'].onclick();
    assert.equal(storage.data.size, 0); assert.equal(writes, 1);
  } finally { dom.window.close(); }
});

test('actual editor reports failed draft storage without losing text or deleting a different pending draft', async () => {
  const {openTemplateSourceEditor} = await import(path + 'template-source-editor.mjs');
  const dom = makeDom(), document = dom.window.document, storage = memoryStorage(), file = fixture();
  Object.defineProperty(dom.window, 'sessionStorage', {value: storage});
  const session = {read: () => file, close() {}, save: async () => { throw Error('not used'); }};
  try {
    let editor = openTemplateSourceEditor({session, document});
    storage.setItem = () => { throw Error('synthetic quota exhausted'); };
    const textarea = editor.element.querySelector('textarea'); textarea.value = 'unsaved quota text'; textarea.dispatchEvent(new dom.window.Event('input'));
    assert.match(editor.element.textContent, /本地草稿未保存.*quota exhausted/); assert.equal(textarea.value, 'unsaved quota text');
    editor.element.close(); assert.equal(storage.data.size, 0);
    storage.setItem = (key, value) => storage.data.set(key, value);
    const {createTemplateEditorDraft} = await import(path + 'template-editor-draft.mjs');
    const previous = createTemplateEditorDraft({file, storage}); previous.load(); previous.save('previous unresolved draft');
    editor = openTemplateSourceEditor({session, document});
    const pendingKey = [...storage.data.keys()][0], pendingRaw = storage.data.get(pendingKey);
    const fresh = editor.element.querySelector('textarea');
    assert.equal(fresh.readOnly, true, 'unresolved recovery cannot accept a second draft that would be lost');
    const save = [...editor.element.querySelectorAll('button')].find(button => button.textContent === '保存修改');
    assert.equal(save.disabled, true); assert.equal(storage.data.get(pendingKey), pendingRaw);
    editor.element.close(); assert.equal(storage.data.get(pendingKey), pendingRaw);
  } finally { dom.window.close(); }
});
