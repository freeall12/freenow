const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/features/canvas-search/core.js');
const source = fs.readFileSync(require.resolve('../src/features/canvas-search/ui.js'), 'utf8');
function previous() {
  const start = source.indexOf(' function highlight('), end = source.indexOf('\n function choose(', start);
  assert(start >= 0 && end > start);
  return (source.slice(0, start) + " function highlight(scroll=false){Array.from(list.querySelectorAll('.search-item')).forEach((b,i)=>{b.classList.toggle('chosen',i===active);if(i===active&&scroll){const top=b.offsetTop-list.offsetTop,bottom=top+b.offsetHeight;if(top<list.scrollTop+8)list.scrollTop=Math.max(0,top-8);else if(bottom>list.scrollTop+list.clientHeight-8)list.scrollTop=bottom-list.clientHeight+8;}});}" + source.slice(end))
    .replace('if(active===i)return;active=i;highlight();', 'active=i;highlight();');
}
function fixture(before = false) {
  const metrics = {classCalls: 0, queries: 0, scrollReads: 0}, focused = [], elements = [];
  class Element {
    constructor(tag = 'div') {this.tagName = tag; this.children = []; this.className = ''; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.scrollTop = 0; this.clientHeight = 112; this.offsetHeight = 28; elements.push(this);
      const classes = () => new Set(this.className.split(' ').filter(Boolean));
      this.classList = {contains: name => classes().has(name), toggle: (name, on) => {metrics.classCalls++; const value = classes(); if (on) value.add(name); else value.delete(name); this.className = [...value].join(' ');},
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)};
    }
    get offsetTop() {metrics.scrollReads++; return this.parentNode === list ? list.children.indexOf(this) * 28 : 0;}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    append(...items) {for (const item of items) {item.parentNode = this; this.children.push(item);}}
    replaceChildren(...items) {for (const child of this.children) child.parentNode = null; this.children = []; this.append(...items);}
    querySelectorAll(selector) {if (this === list) metrics.queries++; return this.children.flatMap(child => [...(child.classList.contains(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]);}
    addEventListener(name, fn) {this.listeners.set(name, fn);}
    contains(target) {for (let node = target; node; node = node.parentNode) if (node === this) return true; return false;}
    closest(selector) {if (selector === 'dialog') {for (let node = this; node; node = node.parentNode) if (node.tagName === 'dialog') return node;} return null;}
    focus() {document.activeElement = this;}
    showModal() {this.open = true;}
    close() {this.open = false; this.listeners.get('close')?.({});}
  }
  let list;
  const dialog = new Element('dialog'), opener = new Element('button');
  const document = {activeElement: null, createElement: tag => new Element(tag), querySelector: selector => selector === '#search-dialog' ? dialog : opener};
  const nodes = Array.from({length: 1000}, (_, i) => ({id: `node-${i}`, type: i % 2 ? 'text' : 'image', title: `镜头 ${i}`, content: '摄影机沿河移动', x: 52000.125 + i * 30.375, y: -2180.48, width: 435.25, height: 250.125}));
  const window = {CanvasSearch: core, CanvasApp: {getState: () => ({nodes}), focusNode: id => focused.push(id)}, CANVAS_SEARCH_ICONS: {}, UI_ICONS: {}, EDITOR_DATA: {nodes: {}}};
  vm.runInNewContext(before ? previous() : source, {window, document, localStorage: {getItem: () => null}});
  list = elements.find(element => element.id === 'search-results');
  const input = elements.find(element => element.id === 'search-input'), clear = elements.find(element => element.className === 'node-search-clear');
  const resultButtons = () => list.children.filter(element => element.classList.contains('search-item'));
  const state = () => ({open: !!dialog.open, chosen: resultButtons().filter(b => b.classList.contains('chosen')).map(b => b.dataset.nodeId), scrollTop: list.scrollTop, ids: resultButtons().map(b => b.dataset.nodeId), focus: document.activeElement?.id, focused: [...focused]});
  return {window, nodes, dialog, list, input, clear, metrics, resultButtons, state, open() {window.CanvasSearchUI.open();}, reset() {for (const key of Object.keys(metrics)) metrics[key] = 0;},
    type(value) {input.value = value; input.oninput();}, filter(value) {elements.find(element => element.dataset.filter === value).onclick();},
    key(key, extra = {}) {const event = {key, target: input, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {}, ...extra}; dialog.listeners.get('keydown')(event); return event;},
    compose(name) {dialog.listeners.get(name)({});}};
}

test('actual capped 30-result UI ignores same-row hover and touches only two classes when moving to another row', t => {
  const before = fixture(true), after = fixture();
  before.open(); after.open(); assert.equal(after.resultButtons().length, 30);
  before.reset(); after.reset();
  for (let event = 0; event < 240; event++) {before.resultButtons()[0].onpointermove(); after.resultButtons()[0].onpointermove();}
  assert.equal(before.metrics.classCalls, 7200); assert.equal(before.metrics.queries, 240);
  assert.deepEqual(after.metrics, {classCalls: 0, queries: 0, scrollReads: 0});
  for (const index of [1, 12, 29, 0]) {
    for (const f of [before, after]) f.resultButtons()[index].onpointermove();
    assert.deepEqual(after.state(), before.state());
  }
  assert.equal(after.metrics.classCalls, 8); assert.equal(after.metrics.queries, 0);
  assert.deepEqual(after.nodes, before.nodes);
  t.diagnostic('1000 graph documents → 30 actual results; 240 same-row pointermoves: chosen class operations 7200→0, result DOM scans 240→0. No FPS claim.');
});

test('rebuilds, empty results, reopen, keyboard scroll, Enter, Escape and IME retain original behavior', () => {
  const before = fixture(true), after = fixture();
  const both = run => {for (const f of [before, after]) run(f); assert.deepEqual(after.state(), before.state());};
  both(f => f.open());
  for (let i = 0; i < 35; i++) both(f => f.key('ArrowDown'));
  both(f => f.key('ArrowUp'));
  both(f => f.resultButtons()[3].onpointermove());
  both(f => f.type('镜头 1'));
  both(f => f.filter('text'));
  both(f => f.type('不存在的xyz'));
  assert.equal(after.resultButtons().length, 0);
  both(f => f.key('ArrowDown'));
  both(f => f.type('镜头'));
  both(f => f.key('ArrowDown', {isComposing: true}));
  both(f => f.key('ArrowDown', {keyCode: 229}));
  both(f => f.compose('compositionstart'));
  both(f => f.key('Escape')); assert(after.dialog.open);
  both(f => f.compose('compositionend'));
  both(f => f.key('Escape')); assert(after.dialog.open); assert.equal(after.input.value, '');
  both(f => f.key('Escape')); assert(!after.dialog.open);
  both(f => {f.nodes.unshift({id: 'fresh', type: 'image', title: '新增镜头'}); f.open();});
  assert.equal(after.resultButtons()[0].dataset.nodeId, 'fresh');
  both(f => f.resultButtons()[5].onpointermove());
  both(f => f.key('Enter'));
  assert.equal(after.state().focused.length, 1); assert(!after.dialog.open);
});
