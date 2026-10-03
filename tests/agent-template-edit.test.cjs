const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const base = '../src/features/agent-apps/';

function transactionalDb() {
  let document = {files: [], revision: 0}, writes = 0;
  const api = {beforeWrite: null, afterCommit: null, failNextWrite: false,
    get document() { return structuredClone(document); }, get writes() { return writes; },
    open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess(); }); return request; },
  };
  const database = {transaction(_, mode) {
    let next = document, aborted = false;
    const tx = {objectStore: () => ({
      get() { const request = {}; queueMicrotask(() => {
        if (mode === 'readwrite') {
          api.beforeWrite?.();
          if (api.failNextWrite) { api.failNextWrite = false; tx.error = Error('IndexedDB 保存中断'); tx.abort(); return; }
        }
        request.result = structuredClone(document); request.onsuccess();
        queueMicrotask(() => { if (aborted) return; document = next; if (mode === 'readwrite') api.afterCommit?.(); tx.oncomplete(); });
      }); return request; },
      put(value) { writes++; next = value; },
    }), abort() { aborted = true; queueMicrotask(() => tx.onabort()); }};
    return tx;
  }};
  return api;
}

// Positive saves here use synthetic bytes with an explicitly mocked digest.
// They prove editing/persistence mechanics, never the existence of an official template body.
async function withFixture(run) {
  const {creativeTemplateReferences} = await import(base + 'creative-template-references.mjs');
  const {creativePickerUri, creativeCatalogSha256, creativeSelectionPrompt} = await import(base + 'creative-picker.mjs');
  const {createTemplateSourceRuntime} = await import(base + 'template-source-runtime.mjs');
  const {createStore} = await import('../src/features/agent-artifacts/store.mjs');
  const content = '<!doctype html><html><body>synthetic contract fixture 中文</body></html>';
  const selection = {schema_version: 1, library_version: '1.1.0', catalog_sha256: creativeCatalogSha256, locale: 'zh_CN', skill: 'creative-generative-art', family: 'art', template_id: 'A01', template_name: '模板', parameters: {title: '正文编辑', subtitle: '', accent: '#abcdef', intensity: .4, seed: 21}, output: {kind: 'animation-html', width: 1200, height: 675, fps: 60, duration: 12}, user_request: '本地编辑', initial_state: {dragX: .3, dragY: -.2, progress: .42}};
  const state = {version: 1, mode: 'art', selectedId: 'A01', drafts: {A01: {parameters: selection.parameters, request: selection.user_request}}, inputs: {A01: selection.initial_state}, pending: {id: 'template_edit_handoff_001', accepted: true, signature: JSON.stringify(selection)}};
  const trace = {id: 'template_edit_trace', callId: 'template_edit_call', name: 'show_app', status: 'done', args: {resource_uri: creativePickerUri}, result: {kind: 'mcp_app', resource_uri: creativePickerUri, response: {original_request: ''}}, appState: state, appHandoffs: [state.pending.id]};
  const message = {role: 'user', hidden: true, text: creativeSelectionPrompt({...selection, template_ref: creativeTemplateReferences.A01}, state.pending.id), widgetOrigin: {traceId: trace.id, resourceUri: creativePickerUri, callId: trace.callId, handoffId: state.pending.id}};
  const chat = {messages: [trace, message]}, context = {chat, panelActive: true, pageLeaving: false, streaming: false, running: false}, db = transactionalDb();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'), original = globalThis.crypto, oldChannel = globalThis.BroadcastChannel;
  Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {subtle: {digest: async (algorithm, input) => Buffer.from(input).equals(Buffer.from(content)) ? Buffer.from(creativeTemplateReferences.A01.sha256, 'hex') : original.subtle.digest(algorithm, input)}}});
  globalThis.BroadcastChannel = undefined;
  const store = createStore({namespace: 'synthetic-template-edit-test', indexedDB: db});
  globalThis.BroadcastChannel = oldChannel;
  const runtime = createTemplateSourceRuntime({getContext: () => context, store, persistConversation: async () => true});
  try {
    const bytes = new TextEncoder().encode(content);
    const imported = await runtime.importFile(trace, {size: bytes.length, arrayBuffer: async () => bytes.slice().buffer});
    await run({runtime, store, db, context, trace, imported, content});
  } finally { runtime.dispose(); Object.defineProperty(globalThis, 'crypto', descriptor); }
}

function makeDom() {
  const projectRequire = createRequire(process.cwd() + '/package.json');
  const fabricRequire = createRequire(projectRequire.resolve('fabric'));
  const jsdomRequire = createRequire(fabricRequire.resolve('jsdom'));
  const canvas = jsdomRequire.resolve('canvas'), previous = require.cache[canvas];
  require.cache[canvas] = {exports: {createCanvas: undefined}};
  let JSDOM;
  try { ({JSDOM} = fabricRequire('jsdom')); } finally { if (previous) require.cache[canvas] = previous; else delete require.cache[canvas]; }
  const dom = new JSDOM('<button id="origin">入口</button>', {url: 'http://localhost:4173'});
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  return dom;
}

test('host edit opens latest real store revision and writes content while preserving immutable source and provenance', async () => {
  await withFixture(async ({runtime, store, db, context, trace, imported, content}) => {
    await store.write({artifact_path: imported.artifact.artifact_path, content_type: 'html', title: '先前编辑', content: '<html>previous latest</html>', expected_revision: imported.artifact.revision});
    const session = await runtime.openEditSession(trace), initial = session.read(), sourceBefore = await store.get(imported.source.artifact_path);
    assert.equal(initial.content, '<html>previous latest</html>');
    const updated = await session.save({content: '<html>用户真正保存的正文 中文</html>'});
    assert.ok(updated.revision > initial.revision);
    assert.equal((await store.get(updated.artifact_path)).content, updated.content);
    assert.deepEqual(await store.get(imported.source.artifact_path), sourceBefore);
    assert.equal(sourceBefore.content, content);
    assert.equal(updated.source_artifact_path, imported.source.artifact_path);
    assert.deepEqual(updated.template_source_identity, initial.template_source_identity);
    assert.equal((await runtime.describe(trace)).artifact.revision, updated.revision);
    assert.equal(db.document.files.length, 2);
    const reopened = await runtime.openEditSession(trace); assert.equal(reopened.read().content, updated.content); reopened.close();
    const {createStore} = await import('../src/features/agent-artifacts/store.mjs');
    const {createTemplateSourceRuntime} = await import(base + 'template-source-runtime.mjs');
    const previousChannel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
    const restoredStore = createStore({namespace: 'synthetic-template-edit-test', indexedDB: db}); globalThis.BroadcastChannel = previousChannel;
    context.chat = structuredClone(context.chat);
    const restoredRuntime = createTemplateSourceRuntime({store: restoredStore, getContext: () => context, persistConversation: async () => true});
    try {
      const restoredTrace = context.chat.messages.find(item => item.id === trace.id);
      const restored = await restoredRuntime.openEditSession(restoredTrace);
      assert.equal(restored.read().content, updated.content); assert.equal(restored.read().revision, updated.revision);
      assert.equal((await restoredRuntime.describe(restoredTrace)).receipt_status, 'confirmed'); restored.close();
    } finally { restoredRuntime.dispose(); }
    session.close(); assert.throws(() => session.read(), /已关闭/);
  });
});

test('stale revisions, busy sessions and transaction-time source switches never overwrite saved content', async () => {
  await withFixture(async ({runtime, store, db, context, trace, imported, content}) => {
    const session = await runtime.openEditSession(trace);
    await store.write({artifact_path: imported.artifact.artifact_path, content_type: 'html', title: '其他写入', content: '<html>other writer</html>', expected_revision: imported.artifact.revision});
    await assert.rejects(() => session.save({content: '<html>stale</html>'}), /已更新/);
    assert.equal((await store.get(imported.artifact.artifact_path)).content, '<html>other writer</html>'); session.close();
    context.running = true; await assert.rejects(() => runtime.openEditSession(trace), /运行中/); context.running = false;
    const latest = await runtime.openEditSession(trace), writes = db.writes;
    db.beforeWrite = () => { context.chat = {messages: []}; };
    await assert.rejects(() => latest.save({content}), /来源已变化/);
    assert.equal(db.writes, writes);
    assert.equal((await store.get(imported.artifact.artifact_path)).content, '<html>other writer</html>');
    latest.close();
  });
});

test('a post-commit source switch reports actual persisted HTML without declaring editing success', async () => {
  await withFixture(async ({runtime, store, db, context, trace, imported}) => {
    const session = await runtime.openEditSession(trace);
    db.afterCommit = () => { context.panelActive = false; };
    await assert.rejects(() => session.save({content: '<html>committed before source switch</html>'}), /HTML 已保存.*未返回编辑成功/);
    assert.equal((await store.get(imported.artifact.artifact_path)).content, '<html>committed before source switch</html>');
    assert.equal(session.isCurrent(), false); session.close();
  });
});

test('actual editor saves store content, keeps failed drafts, confirms unsaved close and restores focus', async () => {
  const {openTemplateSourceEditor} = await import(base + 'template-source-editor.mjs');
  await withFixture(async ({runtime, store, db, trace, imported}) => {
    const dom = makeDom(), document = dom.window.document, origin = document.querySelector('#origin'); origin.focus();
    const session = await runtime.openEditSession(trace), errors = [], editor = openTemplateSourceEditor({session, document, onError: message => errors.push(message)});
    const textarea = editor.element.querySelector('textarea'), buttons = [...editor.element.querySelectorAll('button')], save = buttons.find(button => button.textContent === '保存修改');
    textarea.value = '<html>first actual dialog edit</html>'; textarea.dispatchEvent(new dom.window.Event('input'));
    await save.onclick(); assert.equal((await store.get(imported.artifact.artifact_path)).content, textarea.value);
    assert.equal(save.disabled, true); assert.match(editor.element.textContent, /已保存版本/);
    textarea.value = '<html>retain unsaved failed edit</html>'; textarea.dispatchEvent(new dom.window.Event('input')); db.failNextWrite = true;
    await save.onclick(); assert.match(errors.at(-1), /保存中断/); assert.equal(textarea.value, '<html>retain unsaved failed edit</html>'); assert.equal(save.disabled, false);
    for (const options of [{isComposing: true}, {keyCode: 229}, {repeat: true}]) {
      textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, ...options}));
      assert.equal(editor.element.querySelector('.agent-template-discard').hidden, true);
      editor.element.dispatchEvent(new dom.window.Event('cancel', {cancelable: true}));
      assert.equal(editor.element.querySelector('.agent-template-discard').hidden, true);
      assert.ok(editor.element.isConnected);
    }
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    assert.equal(editor.element.querySelector('.agent-template-discard').hidden, false); assert.ok(editor.element.isConnected);
    buttons.find(button => button.textContent === '继续编辑').onclick(); assert.equal(document.activeElement, textarea);
    editor.element.onclick({target: editor.element, clientX: -1, clientY: -1}); assert.equal(editor.element.querySelector('.agent-template-discard').hidden, false);
    buttons.find(button => button.textContent === '放弃修改并关闭').onclick(); assert.equal(editor.element.isConnected, false); assert.equal(document.activeElement, origin);
    assert.equal((await store.get(imported.artifact.artifact_path)).content, '<html>first actual dialog edit</html>');
    dom.window.close();
  });
});

test('template discussion callback receives latest revision with an unforgeable live source guard', async () => {
  const {createTemplateSourceControls} = await import(base + 'template-source-controls.mjs');
  await withFixture(async ({runtime, store, context, trace, imported}) => {
    const dom = makeDom(), received = [];
    const controls = createTemplateSourceControls({trace, runtime, document: dom.window.document, onDiscussArtifact: async (file, binding) => { received.push({file, binding}); }});
    dom.window.document.body.append(controls.element); await controls.refresh();
    const updated = await store.write({artifact_path: imported.artifact.artifact_path, content_type: 'html', title: '最新讨论', content: '<html>latest discussion</html>', expected_revision: imported.artifact.revision});
    const discuss = [...controls.element.querySelectorAll('button')].find(button => button.textContent === '在对话中讨论');
    await discuss.onclick(); assert.equal(received.length, 1); assert.equal(received[0].file.revision, updated.revision); assert.equal(received[0].binding.trace, trace); assert.equal(received[0].binding.isCurrent(), true);
    context.chat = {messages: []}; assert.equal(received[0].binding.isCurrent(), false);
    controls.destroy(); dom.window.close();
  });
});

test('save restores lost button focus to the textarea without stealing an intentional asynchronous focus move', async () => {
  const {openTemplateSourceEditor} = await import(base + 'template-source-editor.mjs');
  const dom = makeDom(), document = dom.window.document;
  try {
    for (const scenario of ['disabled-fallback', 'user-focus', 'user-body', 'user-tab', 'user-pointer']) {
      let resolveSave;
      const file = {title: '合成焦点验证', artifact_path: 'artifacts/focus.html', revision: 1, content: '<html>initial</html>'};
      const session = {read: () => file, save: ({content}) => new Promise(resolve => { resolveSave = () => resolve({...file, revision: 2, content}); }), close() {}};
      const editor = openTemplateSourceEditor({session, document});
      const textarea = editor.element.querySelector('textarea'), buttons = [...editor.element.querySelectorAll('button')];
      const save = buttons.find(button => button.textContent === '保存修改'), close = buttons.find(button => button.textContent === '关闭编辑器');
      textarea.value = '<html>saved</html>'; textarea.dispatchEvent(new dom.window.Event('input')); save.focus();
      const saving = save.onclick();
      if (scenario === 'user-focus') close.focus();
      else if (scenario === 'user-body') { close.focus(); close.blur(); }
      else if (scenario === 'user-tab') { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Tab', bubbles: true})); save.blur(); }
      else if (scenario === 'user-pointer') { document.body.dispatchEvent(new dom.window.Event('pointerdown', {bubbles: true})); save.blur(); }
      else save.blur(); // jsdom does not automatically blur a disabled button.
      const intendedFocus = document.activeElement;
      resolveSave(); await saving;
      assert.equal(save.disabled, true);
      assert.equal(document.activeElement, scenario === 'disabled-fallback' ? textarea : intendedFocus, scenario);
      editor.close();
    }
  } finally { dom.window.close(); }
});
