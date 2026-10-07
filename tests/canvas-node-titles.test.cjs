const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/features/canvas-node-titles/core.js');
const {createController} = require('../src/features/canvas-node-titles/ui.js');
function clock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return {setTimer(fn, delay) {const id = ++serial; timers.set(id, {fn, at: now + delay}); return id;}, clearTimer(id) {timers.delete(id);},
    tick(ms) {now += ms; for (const [id, task] of [...timers]) if (task.at <= now) {timers.delete(id); task.fn();}}, get pending() {return timers.size;}};
}
function sessionFixture() {
  const time = clock(), writes = [], errors = [], paint = [];
  let title = 'Original', current = true, ready = true, failure;
  const session = core.createSession({read: () => title, isCurrent: () => current, canCommit: () => ready,
    commit: value => {if (failure) throw failure; writes.push(value); title = value;}, changed: value => paint.push(value), onError: error => errors.push(error), ...time});
  return {session, time, writes, errors, paint, get title() {return title;}, set title(value) {title = value;},
    stale() {current = false;}, ready(value) {ready = value;}, fail(value) {failure = value;}};
}
test('ordinary title types are scoped and reference font clamp covers low and high zoom', () => {
  for (const type of ['image', 'video', 'audio', 'text', 'world']) {assert(core.editable({type})); assert(!core.editable({type, titleEditable: false}));}
  for (const type of ['studio', 'group', 'pile', 'playlist']) assert(!core.editable({type}));
  assert.equal(core.fontSize(.15), 60); assert.equal(core.fontSize(.2), 60); assert.equal(core.fontSize(.5), 24); assert.equal(core.fontSize(1), 12); assert.equal(core.fontSize(2), 12);
});
test('nonempty input commits once after the latest 1000 ms, retaining whitespace in the title', () => {
  const f = sessionFixture(); f.session.input('初'); f.time.tick(700); f.session.input('  中文标题  ');
  f.time.tick(999); assert.deepEqual(f.writes, []); f.time.tick(1); assert.deepEqual(f.writes, ['  中文标题  ']); assert(!f.session.pending);
  f.time.tick(5000); assert.equal(f.writes.length, 1);
});
test('Chinese IME stops debounce and Enter processing until composition ends', () => {
  const f = sessionFixture(); f.session.input('pending'); f.session.compositionStart(); f.session.input('zhong'); f.time.tick(5000);
  assert.deepEqual(f.writes, []); assert.equal(f.session.flush(), false); assert.throws(() => f.session.flush({requireSettled: true}), /仍在输入/);
  assert(core.isComposing({keyCode: 229})); assert(core.isComposing({key: 'Process'}));
  f.session.compositionEnd('中文'); f.time.tick(999); assert.equal(f.writes.length, 0); f.time.tick(1); assert.equal(f.title, '中文');
});
test('flush commits immediately; blank titles and Escape restore the last committed title', () => {
  const f = sessionFixture(); f.session.input('Saved'); assert(f.session.flush());
  f.session.input('Draft'); f.session.cancel(); f.time.tick(2000); assert.equal(f.title, 'Saved'); assert.equal(f.session.draft, 'Saved');
  for (const blank of ['', '   ', '\t\n']) {f.session.input(blank); assert(!f.session.flush()); assert.equal(f.session.draft, 'Saved');}
  assert.deepEqual(f.writes, ['Saved']);
});
test('project, element or graph identity invalidation and external rename reject an old timer', () => {
  const f = sessionFixture(); f.session.input('Old draft'); f.stale(); f.time.tick(1000); assert.deepEqual(f.writes, []);
  const g = sessionFixture(); g.session.input('Old draft'); g.title = 'Menu rename'; g.time.tick(1000); assert.equal(g.session.draft, 'Menu rename'); assert.deepEqual(g.writes, []);
});
test('unreadable graphs cannot commit and failed commits retain retryable draft', () => {
  const f = sessionFixture(); f.ready(false); f.session.input('Draft'); f.time.tick(1000); assert.deepEqual(f.writes, []);
  assert.throws(() => f.session.flush({requireSettled: true}), /尚未成功读取/); f.ready(true); f.session.flush(); assert.equal(f.title, 'Draft');
  const g = sessionFixture(); g.fail(Error('storage boundary')); g.session.input('Retained'); assert.throws(() => g.session.flush({requireSettled: true}), /storage boundary/);
  assert(g.session.pending); assert.equal(g.errors.length, 1); g.fail(null); assert(g.session.flush()); assert.equal(g.title, 'Retained');
});
test('idle sync and flush never ask the host to look up node identity', () => {
  let lookups = 0; const session = core.createSession({read: () => 'Original', isCurrent: () => {lookups++; return true;}, canCommit: () => true, commit() {}});
  for (let i = 0; i < 1000; i++) {session.sync(); session.flush();} assert.equal(lookups, 0);
});

class Element {
  constructor(tag, document) {this.tagName = tag; this.ownerDocument = document; this.children = []; this.parentNode = null; this.listeners = new Map(); this.attributes = new Map(); this.hidden = false; this.value = ''; this.className = ''; this.isConnected = true;
    this.classList = {add: name => {this.className += ' ' + name;}, contains: name => this.className.split(' ').includes(name)};}
  append(...items) {for (const child of items) {child.parentNode = this; this.children.push(child);}}
  insertBefore(child, before) {child.parentNode = this; const i = this.children.indexOf(before); if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);}
  get nextSibling() {return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null;}
  querySelector(selector) {return this.children.find(child => child.classList.contains(selector.slice(1))) || this.children.map(child => child.querySelector(selector)).find(Boolean) || null;}
  setAttribute(name, value) {this.attributes.set(name, value);}
  getAttribute(name) {return this.attributes.get(name);}
  addEventListener(type, handler) {const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list);}
  emit(type, patch = {}) {const event = {target: this, key: '', stopPropagation() {this.stopped = true;}, preventDefault() {this.defaultPrevented = true;}, ...patch};
    for (let el = this; el; el = el.parentNode) {for (const handler of el.listeners.get(type) || []) handler(event); if (event.stopped) break;} return event;}
  focus() {this.ownerDocument.activeElement = this;}
  blur() {this.ownerDocument.activeElement = null; this.emit('blur');}
}
function controllerFixture({type = 'video', titleEditable} = {}) {
  const time = clock(), writes = [];
  const document = {activeElement: null, createElement: tag => new Element(tag, document)};
  const node = {id: 'a', type, title: 'Original', titleEditable};
  let current = node, project = 'one', ready = true, element, afterCommit;
  const root = new Element('main', document), shell = new Element('div', document), title = new Element('div', document), text = new Element('span', document);
  shell.className = 'node'; title.className = 'node-title'; text.className = 'title-text'; text.textContent = node.title; title.append(text); shell.append(title); root.append(shell); element = shell;
  const controller = createController({document, resolveNode: () => current, resolveElement: () => element, projectIdentity: () => project, canCommit: () => ready,
    commit(n, value) {assert.equal(n, node); n.title = value; writes.push(value); afterCommit?.();}, onError: assert.fail, ...time});
  controller.bind(node, shell);
  return {controller, time, writes, root, shell, title, text, node, document,
    get input() {return title.querySelector('.node-title-input');}, get editor() {return title.querySelector('.node-title-editor');},
    select(value = true) {controller.sync(shell, value);}, inputText(value) {const input = this.input; input.focus(); input.value = value; input.emit('input');},
    replaceNode() {current = {...node};}, replaceElement() {element = new Element('div', document);}, switchProject() {project = 'two';}, ready(value) {ready = value;}, onCommit(fn) {afterCommit = fn;}};
}
test('selection swaps span for native input without autofocus and deselection flushes the latest text', () => {
  const f = controllerFixture(); assert.equal(f.editor, null); f.select(); assert(!f.editor.hidden); assert(f.text.hidden); assert.equal(f.document.activeElement, null);
  f.inputText('中文标题'); f.select(false); assert.deepEqual(f.writes, ['中文标题']); assert(f.editor.hidden); assert(!f.text.hidden); assert.equal(f.text.textContent, '中文标题'); f.time.tick(2000); assert.equal(f.writes.length, 1);
});
test('5000 unselected bindings add no editor DOM; selection creates once and later sync reuses it', () => {
  let created = 0;
  const document = {activeElement: null, createElement(tag) {created++; return new Element(tag, document);}}, nodes = new Map(), elements = new Map();
  const controller = createController({document, resolveNode: id => nodes.get(id), resolveElement: id => elements.get(id), projectIdentity: () => 'large', canCommit: () => true, commit: assert.fail});
  for (let index = 0; index < 5000; index++) {
    const node = {id: String(index), type: 'image', title: 'Image ' + index}, shell = new Element('div', document), title = new Element('div', document), text = new Element('span', document);
    title.className = 'node-title'; text.className = 'title-text'; text.textContent = node.title; title.append(text); shell.append(title);
    nodes.set(node.id, node); elements.set(node.id, shell); controller.bind(node, shell); controller.sync(shell, false);
    assert.equal(title.children.length, 1); assert.equal(shell.querySelector('.node-title-input'), null);
  }
  assert.equal(created, 0);
  const selected = elements.get('12'); controller.sync(selected, true); const input = selected.querySelector('.node-title-input');
  assert.equal(created, 3); assert(input);
  for (let iteration = 0; iteration < 100; iteration++) {controller.sync(selected, false); controller.sync(selected, true);}
  assert.equal(created, 3); assert.equal(selected.querySelector('.node-title-input'), input); assert.equal(input.listeners.get('keydown').length, 1);
  controller.sync(elements.get('88'), true); assert.equal(created, 6); assert.equal(elements.get('89').querySelector('.node-title-input'), null);
});
test('title typing preserves pointer, double click, wheel and native keyboard ownership', () => {
  const f = controllerFixture(); f.select(); let canvasEvents = 0;
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown']) {f.root.addEventListener(type, () => canvasEvents++); const event = f.input.emit(type, {key: 'a'}); assert(event.stopped); assert(!event.defaultPrevented);}
  assert.equal(canvasEvents, 0); assert.equal(f.input.getAttribute('data-keyboard-scope'), 'text-editor');
});
test('Enter flushes and blurs, Escape cancels only unsaved input, blur also saves once', () => {
  const f = controllerFixture(); f.select(); f.inputText('First'); const enter = f.input.emit('keydown', {key: 'Enter'}); assert(enter.defaultPrevented); assert.equal(f.document.activeElement, f.shell); assert.deepEqual(f.writes, ['First']);
  f.inputText('Cancel'); f.input.emit('keydown', {key: 'Escape'}); f.time.tick(2000); assert.equal(f.node.title, 'First'); assert.equal(f.input.value, 'First');
  f.inputText('Blur title'); f.input.blur(); assert.equal(f.node.title, 'Blur title'); assert.equal(f.writes.length, 2);
});
test('Enter/Escape restore current node focus but never steal external focus or focus a stale node', () => {
  for (const key of ['Enter', 'Escape']) {const f = controllerFixture(); f.select(); f.inputText('Draft'); f.input.emit('keydown', {key}); assert.equal(f.document.activeElement, f.shell);}
  const external = new Element('button', {}), f = controllerFixture(); f.select(); f.inputText('Synthetic'); f.document.activeElement = external; f.input.emit('keydown', {key: 'Enter'}); assert.equal(f.document.activeElement, external);
  const g = controllerFixture(); g.select(); g.inputText('Callback'); g.onCommit(() => {g.document.activeElement = external;}); g.input.emit('keydown', {key: 'Enter'}); assert.equal(g.document.activeElement, external);
  const h = controllerFixture(); h.select(); h.inputText('Replaced'); h.replaceNode(); h.input.emit('keydown', {key: 'Enter'}); assert.notEqual(h.document.activeElement, h.shell);
});
test('composition Enter does not blur/save; composition blur or deselection cancels partial text', () => {
  const f = controllerFixture(); f.select(); f.inputText(''); f.input.emit('compositionstart'); f.inputText('zhong');
  const event = f.input.emit('keydown', {key: 'Enter', keyCode: 229}); assert(!event.defaultPrevented); assert.equal(f.document.activeElement, f.input); f.time.tick(2000); assert.equal(f.writes.length, 0);
  f.input.value = '中文'; f.input.emit('compositionend'); f.time.tick(1000); assert.equal(f.node.title, '中文');
  f.input.emit('compositionstart'); f.inputText('cancel'); f.input.blur(); assert.equal(f.input.value, '中文'); f.time.tick(1000); assert.equal(f.writes.length, 1);
});
test('old project, replaced node, replaced element, disposed element cannot write after delay', () => {
  for (const invalidate of [f => f.switchProject(), f => f.replaceNode(), f => f.replaceElement(), f => f.controller.dispose(f.shell), f => {f.shell.isConnected = false;}]) {
    const f = controllerFixture(); f.select(); f.inputText('Stale'); invalidate(f); f.time.tick(1000); assert.deepEqual(f.writes, []);
  }
});
test('controller flush is reentrant-safe and cancelAll invalidates pending undo drafts', () => {
  const f = controllerFixture(); f.select(); f.inputText('Undo draft'); assert(f.controller.hasPending()); f.controller.cancelAll(); assert(!f.controller.hasPending()); f.time.tick(1000); assert.equal(f.writes.length, 0);
  f.inputText('Save immediately'); f.controller.flushAll({requireSettled: true}); assert.equal(f.node.title, 'Save immediately'); assert(!f.controller.hasPending());
});
test('independent group/studio/playlist/pile titles and titleEditable false are not bound', () => {
  for (const type of ['group', 'studio', 'playlist', 'pile']) {const f = controllerFixture({type}); assert.equal(f.input, null); assert.equal(f.title.children.length, 1);}
  assert.equal(controllerFixture({titleEditable: false}).input, null);
});
test('load failure disables input and blocks commits without hiding the selected title', () => {
  const f = controllerFixture(); f.ready(false); f.select(); assert(f.input.disabled); assert(!f.editor.hidden);
  f.inputText('Not ready'); f.time.tick(1000); assert.deepEqual(f.writes, []); assert.throws(() => f.controller.flushAll({requireSettled: true}), /尚未成功读取/);
  f.ready(true); f.select(); assert(!f.input.disabled); f.controller.flushAll(); assert.equal(f.node.title, 'Not ready');
});

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function between(start, end) {const i = source.indexOf(start), j = source.indexOf(end, i + start.length); assert(i >= 0 && j > i); return source.slice(i, j);}
test('production history commits a pending title before another mutation and undo cancels draft first', () => {
  const node = {id: 'a', title: 'Old'}, history = [], future = [], calls = [];
  let pending = 'New', writing = false;
  const context = {structuredClone, nodes: [node], edges: [], history, future, localChanges: 0, graphLoaded: true, selected: new Set(['a']),
    clone: structuredClone, notify: assert.fail, flushGesture() {}, clearOrphanGenerationState() {}, rebuildAndPersist() {},
    window: {CanvasNodeTitles: {flushAll() {if (!pending || writing) return; writing = true; context.remember(); node.title = pending; pending = null; writing = false;}, cancelAll() {calls.push('cancel'); pending = null;}}, CanvasConnections: {cancel() {}, clearSelection() {}}}};
  vm.createContext(context); vm.runInContext(between('  function remember()', '  function persist(') + between('  function undo(', '  function nodeContentKey(') + '\nthis.remember=remember;this.undo=undo;', context);
  context.remember(); assert.equal(history.length, 2); assert.equal(history[0].nodes[0].title, 'Old'); assert.equal(history[1].nodes[0].title, 'New');
  pending = 'Stale before undo'; context.undo(); assert.deepEqual(calls, ['cancel']); assert.equal(context.nodes[0].title, 'New'); context.undo(); assert.equal(context.nodes[0].title, 'Old');
});
test('production saveProject settles title before snapshot; active composition aborts save/navigation', async () => {
  const method = between('    async saveProject(', '\n    async prepareProjectNavigation').trim().replace(/,$/, '');
  const calls = [], context = {graphLoaded: true, graphReadFailed: false, flushGesture() {}, saveView() {calls.push('view');}, persist() {calls.push('save'); return Promise.resolve();},
    window: {CanvasNodeTitles: {flushAll(options) {calls.push('titles'); assert(options.requireSettled);}}, CanvasStore: {flush: async () => calls.push('flush')}}};
  vm.createContext(context); vm.runInContext(`this.api={${method}}`, context); await context.api.saveProject(); assert.deepEqual(calls, ['titles', 'view', 'save', 'flush']);
  calls.length = 0; context.window.CanvasNodeTitles.flushAll = () => {throw Error('仍在输入');}; await assert.rejects(context.api.saveProject(), /仍在输入/); assert.deepEqual(calls, []);
  context.graphReadFailed = true; await assert.rejects(context.api.saveProject(), /尚未成功读取/);
});
test('production entry orders feature scripts before host and binds/syncs/disposes live shells', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert(html.indexOf('canvas-node-titles/core.js') < html.indexOf('canvas-node-titles/ui.js')); assert(html.indexOf('canvas-node-titles/ui.js') < html.indexOf('src="app.js'));
  assert(between('  function makeNode(', '  function rebuild(').includes('CanvasNodeTitles?.bind(n,el)'));
  assert(between('  function renderNodeShell(', '  function render(options)').includes('CanvasNodeTitles?.sync(el,picked)'));
  assert(between('  function removeNodeElement(', '  function makeNode(').includes('CanvasNodeTitles?.dispose(element)'));
});
