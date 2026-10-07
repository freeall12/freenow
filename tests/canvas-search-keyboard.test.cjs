const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/features/canvas-search/core.js');
const source = fs.readFileSync(require.resolve('../src/features/canvas-search/ui.js'), 'utf8');

// Dispatch the real UI handler before a button's native Enter activation.
// This catches a target-only guard that otherwise passes input-only tests.
function fixture(nodes = [
  {id: 'image-a', type: 'image', title: '图片 A'},
  {id: 'image-b', type: 'image', title: '图片 B'},
  {id: 'text-a', type: 'text', title: '文本 A', content: '测试内容'},
]) {
  const elements = [], focused = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.className = ''; this.dataset = {};
      this.attributes = {}; this.listeners = new Map(); this.scrollTop = 0;
      this.clientHeight = 112; this.offsetHeight = 28; elements.push(this);
      const classes = () => new Set(this.className.split(' ').filter(Boolean));
      this.classList = {
        contains: name => classes().has(name),
        add: name => {const value = classes(); value.add(name); this.className = [...value].join(' ');},
        remove: name => {const value = classes(); value.delete(name); this.className = [...value].join(' ');},
      };
    }
    get offsetTop() {return this.parentNode?.children.indexOf(this) * 28 || 0;}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    append(...items) {for (const item of items) {item.parentNode = this; this.children.push(item);}}
    replaceChildren(...items) {for (const child of this.children) child.parentNode = null; this.children = []; this.append(...items);}
    addEventListener(name, fn) {this.listeners.set(name, fn);}
    contains(target) {for (let node = target; node; node = node.parentNode) if (node === this) return true; return false;}
    closest(selector) {if (selector === 'dialog') {for (let node = this; node; node = node.parentNode) if (node.tagName === 'dialog') return node;} return null;}
    focus() {document.activeElement = this;}
    showModal() {this.open = true;}
    close() {this.open = false; this.listeners.get('close')?.({});}
  }
  const dialog = new Element('dialog'), opener = new Element('button');
  const document = {activeElement: null, createElement: tag => new Element(tag), querySelector: selector => selector === '#search-dialog' ? dialog : opener};
  const window = {CanvasSearch: core, CanvasApp: {getState: () => ({nodes}), focusNode: id => focused.push(id)}, CANVAS_SEARCH_ICONS: {}, UI_ICONS: {}, EDITOR_DATA: {nodes: {}}};
  vm.runInNewContext(source, {window, document, localStorage: {getItem: () => null}});
  const list = elements.find(element => element.id === 'search-results');
  const input = elements.find(element => element.id === 'search-input');
  const clear = elements.find(element => element.className === 'node-search-clear');
  const results = () => list.children.filter(element => element.classList.contains('search-item'));
  const filter = type => elements.find(element => element.dataset.filter === type);
  const event = (key, target, extra = {}) => ({key, target, defaultPrevented: false, stopped: false,
    preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, ...extra});
  const key = (name, extra = {}, nativeActivation = false) => {
    const e = event(name, document.activeElement, extra); dialog.listeners.get('keydown')(e);
    if (nativeActivation && name === 'Enter' && !e.defaultPrevented && e.target.tagName === 'button') e.target.onclick?.();
    return e;
  };
  return {dialog, input, clear, focused, results, filter, key, document,
    active: () => results().find(element => element.classList.contains('chosen'))?.dataset.nodeId,
    open: () => window.CanvasSearchUI.open(),
    type(value) {input.value = value; input.oninput();},
    compose(name) {dialog.listeners.get(name)({});},
    cancel() {const e = event('Escape', dialog); dialog.listeners.get('cancel')(e); return e;},
    nested() {const child = new Element('dialog'), button = new Element('button'); child.append(button); dialog.append(child); return button;},
    outside: () => opener,
  };
}

test('Enter on a focused category confirms the highlighted result instead of clicking the category again', () => {
  const f = fixture(); f.open();
  const category = f.filter('image'); category.focus(); category.onclick();
  f.key('ArrowDown'); assert.equal(f.active(), 'image-b');
  const e = f.key('Enter', {}, true);
  assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true);
  assert.deepEqual(f.focused, ['image-b']); assert.equal(f.dialog.open, false);
});

test('Tab-style result focus stays separate from highlight and Enter confirms the highlight', () => {
  const f = fixture(); f.open(); f.key('ArrowDown');
  const other = f.results()[2]; other.focus();
  assert.equal(f.document.activeElement.dataset.nodeId, 'text-a'); assert.equal(f.active(), 'image-b');
  f.key('Enter', {}, true);
  assert.deepEqual(f.focused, ['image-b']); assert.equal(f.dialog.open, false);
});

test('Enter on the clear button confirms active result while pointer click still clears the query', () => {
  const f = fixture(); f.open(); f.type('图片'); f.key('ArrowDown'); f.clear.focus();
  f.key('Enter', {}, true); assert.deepEqual(f.focused, ['image-b']);
  f.open(); f.type('图片'); f.clear.onclick();
  assert.equal(f.input.value, ''); assert.equal(f.document.activeElement, f.input);
  assert.equal(f.active(), 'image-a'); assert.equal(f.dialog.open, true);
});

test('empty results consume Enter without closing or changing the selected category', () => {
  const f = fixture(); f.open();
  const category = f.filter('audio'); category.focus(); category.onclick();
  assert.equal(f.results().length, 0);
  f.key('ArrowDown'); f.key('ArrowUp');
  const e = f.key('Enter', {}, true);
  assert.equal(e.defaultPrevented, true); assert.equal(f.dialog.open, true);
  assert.equal(category.attributes['aria-pressed'], 'true'); assert.deepEqual(f.focused, []);
});

test('Enter and navigation remain inert during composition, including 229 and native isComposing', () => {
  for (const extra of [{isComposing: true}, {keyCode: 229}, null]) {
    const f = fixture(); f.open(); f.type('图片');
    if (!extra) f.compose('compositionstart');
    for (const name of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      const e = f.key(name, extra || {});
      assert.equal(e.defaultPrevented, false); assert.equal(e.stopped, false);
      assert.equal(f.active(), 'image-a'); assert.equal(f.input.value, '图片');
      assert.equal(f.dialog.open, true); assert.deepEqual(f.focused, []);
    }
    if (!extra) f.compose('compositionend');
    f.key('ArrowDown'); f.key('Enter'); assert.deepEqual(f.focused, ['image-b']);
  }
});

test('Escape clears a query first and closes next; native cancel uses the same order', () => {
  for (const dismiss of [f => f.key('Escape'), f => f.cancel()]) {
    const f = fixture(); f.open(); f.type('图片'); f.filter('image').focus();
    const first = dismiss(f); assert.equal(first.defaultPrevented, true);
    assert.equal(f.dialog.open, true); assert.equal(f.input.value, ''); assert.equal(f.active(), 'image-a');
    dismiss(f); assert.equal(f.dialog.open, false); assert.deepEqual(f.focused, []);
    f.open(); assert.equal(f.document.activeElement, f.input);
  }
});

test('composition blocks native cancel and close resets stale composition before reopening', () => {
  const f = fixture(); f.open(); f.compose('compositionstart');
  const e = f.cancel(); assert.equal(e.defaultPrevented, true); assert.equal(f.dialog.open, true);
  f.dialog.close(); f.open(); f.key('Enter');
  assert.deepEqual(f.focused, ['image-a']); assert.equal(f.dialog.open, false);
});

test('already consumed keys, outside targets and nested dialogs do not choose a search result', () => {
  const f = fixture(); f.open();
  for (const target of [f.outside(), f.nested()]) {
    target.focus(); const e = f.key('Enter'); assert.equal(e.defaultPrevented, false);
  }
  f.input.focus(); const e = f.key('Enter', {defaultPrevented: true});
  assert.equal(e.stopped, false); assert.deepEqual(f.focused, []); assert.equal(f.dialog.open, true);
});
