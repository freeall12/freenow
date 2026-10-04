'use strict';
const test = require('node:test'), assert = require('node:assert/strict');

function fixture() {
  const handlers = new Map(), frames = new Map(); let sequence = 0;
  function listen(owner, type, fn, options) {const key = owner + ':' + type, list = handlers.get(key) || []; list.push({fn, capture: options === true || !!options?.capture}); handlers.set(key, list);}
  const document = {activeElement: null, addEventListener: (type, fn, options) => listen('document', type, fn, options)};
  class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.style = {setProperty(key, value) {this[key] = value;}}; this.dataset = {}; this.attrs = new Map(); this.handlers = new Map(); this.classes = new Set(); this.hidden = false; this.offsetHeight = 330; this.clientWidth = 1000; this.clientHeight = 700; this.clientLeft = this.clientTop = 0; this.captured = new Set(); this.classList = {add: name => this.classes.add(name), toggle: (name, yes) => yes ? this.classes.add(name) : this.classes.delete(name)};}
    set className(value) {this.classes = new Set(value.split(' '));} get className() {return [...this.classes].join(' ');}
    get isConnected() {return this === document.body || this === document.head || !!this.parent?.isConnected;}
    get parentNode() {return this.parent;} get firstElementChild() {return this.children[0];} get lastChild() {return this.children.at(-1);} get childElementCount() {return this.children.length;}
    get nextElementSibling() {return this.parent?.children[this.parent.children.indexOf(this) + 1];}
    append(...children) {for (const child of children) {child.remove(); child.parent = this; this.children.push(child);}}
    replaceChildren(...children) {for (const child of [...this.children]) child.remove(); this.append(...children);}
    insertBefore(child, before) {child.remove(); child.parent = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);}
    remove() {if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null;}
    contains(target) {return target === this || this.children.some(child => child.contains(target));}
    setAttribute(key, value) {this.attrs.set(key, String(value)); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);}
    getAttribute(key) {return this.attrs.get(key) ?? null;}
    matches(selector) {
      if (selector === 'button:not(:disabled)') return this.tagName === 'button' && !this.disabled;
      const tag = selector.match(/^[a-z]+/)?.[0]; if (tag && this.tagName !== tag) return false;
      for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(name)) return false;
      const id = selector.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
      for (const [, name, value] of selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {const actual = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(name); if (actual == null || value !== undefined && actual !== value) return false;}
      return true;
    }
    closest(selector) {return selector.split(',').some(part => this.matches(part)) ? this : this.parent?.closest(selector) || null;}
    querySelectorAll(selector) {const split = selector.indexOf(' '); if (split !== -1) return this.querySelectorAll(selector.slice(0, split)).flatMap(node => node.querySelectorAll(selector.slice(split + 1))); return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    addEventListener(type, fn, options) {const list = this.handlers.get(type) || []; list.push({fn, capture: options === true || !!options?.capture}); this.handlers.set(type, list);}
    focus() {document.activeElement = this; dispatch(this, 'focusin');} scrollIntoView() {}
    getBoundingClientRect() {return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight};}
    setPointerCapture(id) {this.captured.add(id);} hasPointerCapture(id) {return this.captured.has(id);} releasePointerCapture(id) {this.captured.delete(id);}
  }
  document.body = new Element('body'); document.head = new Element('head'); document.createElement = tag => new Element(tag); document.createElementNS = (ns, tag) => Object.assign(new Element(tag), {namespaceURI: ns});
  document.querySelector = selector => document.body.querySelector(selector); document.elementFromPoint = () => canvas;
  const canvas = new Element('div'); canvas.id = 'canvas'; canvas.tabIndex = 0; const edges = new Element('svg'); edges.id = 'edges'; canvas.append(edges); document.body.append(canvas);
  const state = {nodes: [{id: 'a', type: 'image', x: 0, y: 0, width: 200, height: 250}, {id: 'b', type: 'image', x: 350, y: 50, width: 200, height: 250}], edges: [], selected: [], view: {x: 0, y: 0, scale: 1}};
  const node = new Element('div'); node.className = 'node'; node.dataset.id = 'a'; const port = new Element('button'); port.className = 'port'; port.dataset.port = 'right'; node.append(port); canvas.append(node);
  let renderCount = 0; const notices = [], connections = [];
  const app = {getState: () => state, select(id) {state.selected = id == null ? [] : [id];}, render() {renderCount++;}, notify(message) {notices.push(message);}, connect(source, target) {connections.push({source, target});}, setView(view) {state.view = {...view};}};
  const window = {addEventListener: (type, fn, options) => listen('window', type, fn, options), CanvasGeometry: {toWorld: point => point}, CanvasPiles: {index: () => ({owner: new Map()})}, WorldNode: {}, CanvasImageEditor: {}};
  Object.assign(global, {document, window, innerWidth: 1000, innerHeight: 700, CSS: {escape: value => value}, requestAnimationFrame: fn => {frames.set(++sequence, fn); return sequence;}, cancelAnimationFrame: id => frames.delete(id), ResizeObserver: class {observe() {} disconnect() {}}, matchMedia: () => ({matches: false})});
  function dispatch(target, type, extra = {}) {
    const e = {target, key: 'Escape', button: 0, pointerId: 1, clientX: 100, clientY: 100, detail: 0, ...extra, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, stopImmediatePropagation() {this.stopped = this.immediate = true;}};
    const path = []; for (let parent = target; parent; parent = parent.parent) path.push(parent);
    function run(list, capture) {for (const handler of list || []) {if (handler.capture === capture) handler.fn(e); if (e.immediate) return;}}
    run(handlers.get('document:' + type), true); if (e.stopped) return e;
    for (const parent of [...path].reverse()) {run(parent.handlers.get(type), true); if (e.stopped) return e;}
    for (const parent of path) {run(parent.handlers.get(type), false); if (!e.stopped && parent === target) parent['on' + type]?.(e); if (e.stopped) return e;}
    run(handlers.get('document:' + type), false); return e;
  }
  return {document, window, Element, canvas, edges, node, port, state, app, frames, notices, connections, dispatch, renderCount: () => renderCount, menu: () => document.querySelector('.connection-menu')};
}

function prepareDrop(f, target = f.state.nodes[1]) {
  const element = new f.Element('div'); element.className = 'node'; element.dataset.id = target.id; f.canvas.append(element);
  f.document.elementFromPoint = () => element;
  return () => {
    f.dispatch(f.port, 'pointerdown', {clientX: 100, clientY: 100});
    f.dispatch(f.canvas, 'pointermove', {clientX: 450, clientY: 150});
    f.dispatch(f.canvas, 'pointerup', {clientX: 450, clientY: 150});
  };
}

test('incompatible final-video drop ends without a command menu, notice, or graph change in either direction', async () => {
  for (const side of ['right', 'left']) {
    const f = fixture(), final = side === 'right' ? f.state.nodes[1] : f.state.nodes[0];
    Object.assign(final, {type: 'video', generation: {model: 'Seedance 2.5', draftVideoId: 'draft-file'}});
    f.port.dataset.port = side;
    (await import('../src/features/canvas-connections/entry.mjs')).install(f.app);
    const before = structuredClone(f.state), drop = prepareDrop(f); drop();
    assert(!f.menu()); assert.deepEqual(f.notices, []); assert.deepEqual(f.connections, []); assert.deepEqual(f.state, before);
    assert.equal(f.frames.size, 0); assert(!f.canvas.hasPointerCapture(1)); assert.equal(f.canvas.dataset.connectionActive, undefined);
    assert(!f.edges.querySelector('.connection-preview')); assert.equal(f.document.activeElement, f.canvas);
  }
});

test('ordinary incompatible targets retain the command menu and compatible draft-to-final drops connect', async () => {
  const ordinary = fixture(); Object.assign(ordinary.state.nodes[1], {type: 'text', textMode: 'pure'});
  (await import('../src/features/canvas-connections/entry.mjs')).install(ordinary.app); prepareDrop(ordinary)();
  assert(ordinary.menu()); assert.deepEqual(ordinary.notices, ['纯文本节点不接受输入连接']); assert.deepEqual(ordinary.connections, []);
  const compatible = fixture();
  Object.assign(compatible.state.nodes[0], {type: 'video', video: '/qa/playlist-red.mp4', currentSourceFileId: 'draft-file', generation: {model: 'Seedance 2.5 Draft'}});
  Object.assign(compatible.state.nodes[1], {type: 'video', generation: {model: 'Seedance 2.5', draftVideoId: 'draft-file'}});
  (await import('../src/features/canvas-connections/entry.mjs')).install(compatible.app); prepareDrop(compatible)();
  assert(!compatible.menu()); assert.deepEqual(compatible.notices, []); assert.deepEqual(compatible.connections, [{source: 'a', target: 'b'}]);
});

test('Escape before final-video drop cancels the pending frame and pointerup cannot create an edge or menu', async () => {
  const f = fixture(); Object.assign(f.state.nodes[1], {type: 'video', generation: {model: 'Seedance 2.5', draftVideoId: 'draft-file'}});
  (await import('../src/features/canvas-connections/entry.mjs')).install(f.app); prepareDrop(f);
  const before = structuredClone(f.state);
  f.dispatch(f.port, 'pointerdown'); f.dispatch(f.canvas, 'pointermove', {clientX: 450}); assert(f.frames.size);
  assert(f.dispatch(f.canvas, 'keydown').defaultPrevented); f.dispatch(f.canvas, 'pointerup', {clientX: 450});
  assert(!f.menu()); assert.deepEqual(f.connections, []); assert.deepEqual(f.state, before); assert.equal(f.frames.size, 0); assert(!f.canvas.hasPointerCapture(1));
});

test('dropping a usable draft on an already referenced final ends without replacing its existing edge', async () => {
  const f = fixture();
  Object.assign(f.state.nodes[0], {type: 'video', video: '/qa/playlist-red.mp4', currentSourceFileId: 'draft-file', generation: {model: 'Seedance 2.5 Draft'}});
  Object.assign(f.state.nodes[1], {type: 'video', generation: {model: 'Seedance 2.5', draftVideoId: 'draft-file'}});
  f.state.edges.push({id: 'existing', source: 'a', target: 'b', purpose: 'draft-reference'});
  (await import('../src/features/canvas-connections/entry.mjs')).install(f.app); const before = structuredClone(f.state); prepareDrop(f)();
  assert(!f.menu()); assert.deepEqual(f.notices, []); assert.deepEqual(f.connections, []); assert.deepEqual(f.state, before);
});

test('single-node menu toggles the same pointer/keyboard port and restores the port on Escape', async () => {
  const f = fixture(), api = (await import('../src/features/canvas-connections/entry.mjs')).install(f.app);
  f.dispatch(f.port, 'click'); assert(f.menu()); assert.equal(f.port.getAttribute('aria-expanded'), 'true');
  const esc = f.dispatch(f.document.activeElement, 'keydown'); assert(esc.defaultPrevented); assert(esc.immediate); assert(!f.menu()); assert.equal(f.document.activeElement, f.port);
  f.dispatch(f.port, 'click'); f.dispatch(f.port, 'click'); assert(!f.menu());
  f.dispatch(f.port, 'pointerdown'); f.dispatch(f.canvas, 'pointerup'); assert(f.menu());
  f.dispatch(f.port, 'pointerdown'); f.dispatch(f.canvas, 'pointerup'); assert(!f.menu());
  api.cancel();
});

test('menu leaves modal/IME Escape alone and outside/focus dismissal never steals focus', async () => {
  const f = fixture(); (await import('../src/features/canvas-connections/entry.mjs')).install(f.app); f.dispatch(f.port, 'click');
  for (const extra of [{isComposing: true}, {keyCode: 229}, {defaultPrevented: true}]) {assert(!f.dispatch(f.document.activeElement, 'keydown', extra).immediate); assert(f.menu());}
  const dialog = new f.Element('dialog'); dialog.setAttribute('open', ''); f.document.body.append(dialog);
  assert(!f.dispatch(f.document.activeElement, 'keydown').defaultPrevented); assert(f.menu());
  dialog.remove(); const input = new f.Element('input'); f.document.body.append(input); input.focus(); assert(!f.menu()); assert.equal(f.document.activeElement, input);
  f.dispatch(f.port, 'click'); f.dispatch(input, 'pointerdown'); assert(!f.menu()); assert.notEqual(f.document.activeElement, f.port);
});

test('Escape cannot cancel a pending drag or edge selection beneath a dialog or external field', async () => {
  const f = fixture(); (await import('../src/features/canvas-connections/entry.mjs')).install(f.app);
  f.dispatch(f.port, 'pointerdown'); const dialog = new f.Element('dialog'); dialog.setAttribute('open', ''); f.document.body.append(dialog);
  assert(!f.dispatch(f.canvas, 'keydown').defaultPrevented); assert(f.canvas.hasPointerCapture(1));
  dialog.remove(); const esc = f.dispatch(f.canvas, 'keydown'); assert(esc.immediate); assert(!f.canvas.hasPointerCapture(1));
  const edge = new f.Element('g'); edge.dataset.edgeId = 'one'; f.edges.append(edge); f.dispatch(edge, 'pointerdown');
  const input = new f.Element('input'); f.document.body.append(input); const before = f.renderCount(); f.dispatch(input, 'keydown'); assert.equal(f.renderCount(), before);
  f.dispatch(f.canvas, 'keydown'); assert.equal(f.renderCount(), before + 1);
});

test('selection menu retains a visible trigger, supports toggle, Escape return, Tab, and upper dialog', async () => {
  const f = fixture(); f.state.selected = ['a', 'b']; const selection = (await import('../src/features/canvas-connections/selection.mjs')).installSelection(f.app, f.canvas, () => {});
  selection.render(f.state, new Map(f.state.nodes.map(n => [n.id, n]))); const handle = f.canvas.querySelector('.selection-connection-handle');
  f.dispatch(handle, 'click'); assert(f.menu()); assert(!handle.hidden); assert.equal(handle.style.opacity, '');
  f.dispatch(handle, 'pointerdown'); assert(!f.menu()); assert.equal(f.document.activeElement, handle);
  f.dispatch(handle, 'click'); f.dispatch(f.document.activeElement, 'keydown'); assert(!f.menu()); assert.equal(f.document.activeElement, handle);
  f.dispatch(handle, 'click'); const tab = f.dispatch(f.document.activeElement, 'keydown', {key: 'Tab'}); assert(f.menu()); assert(!tab.defaultPrevented); assert(!tab.stopped);
  const external = new f.Element('button'); f.document.body.append(external); external.focus(); assert(!f.menu()); assert.equal(f.document.activeElement, external);
  f.dispatch(handle, 'pointerdown'); const dialog = new f.Element('dialog'); dialog.setAttribute('open', ''); f.document.body.append(dialog);
  assert(!f.dispatch(handle, 'keydown').defaultPrevented); assert(handle.hasPointerCapture(1));
  dialog.remove(); assert(f.dispatch(handle, 'keydown').immediate); assert(!handle.hasPointerCapture(1)); assert.equal(f.document.activeElement, handle);
});

test('minimap consumes only active navigation Escape and cancels pending motion on pointercancel/close', async () => {
  const f = fixture(), root = new f.Element('aside'), toggle = new f.Element('button'); root.id = 'minimap'; root.clientWidth = 198; root.clientHeight = 148; toggle.id = 'toggle-map'; f.document.body.append(root, toggle);
  const map = (await import('../src/features/canvas-minimap/entry.mjs')).install(f.app);
  f.dispatch(root, 'pointerdown', {clientX: 1, clientY: 1}); assert.equal(f.document.activeElement, root); assert(f.frames.size);
  const dialog = new f.Element('dialog'); dialog.setAttribute('open', ''); f.document.body.append(dialog);
  assert(!f.dispatch(root, 'keydown').defaultPrevented); assert(f.frames.size);
  dialog.remove(); assert(f.dispatch(root, 'keydown').immediate); assert.equal(f.frames.size, 0); assert(!f.dispatch(root, 'keydown').defaultPrevented);
  f.dispatch(root, 'pointerdown', {clientX: 1, clientY: 1}); assert(f.frames.size); f.dispatch(root, 'pointercancel'); assert.equal(f.frames.size, 0);
  const frame = root.children[1]; const x = parseFloat(frame.style.left) / 100 * 198, y = parseFloat(frame.style.top) / 100 * 148;
  f.dispatch(root, 'pointerdown', {clientX: x + 1, clientY: y + 1}); assert(root.hasPointerCapture(1));
  f.dispatch(root, 'pointermove', {clientX: x + 20, clientY: y + 10}); assert(f.frames.size);
  f.dispatch(root, 'pointercancel'); assert(!root.hasPointerCapture(1)); assert.equal(f.frames.size, 0); assert.equal(root.dataset.dragging, undefined);
  f.dispatch(root, 'pointerdown', {clientX: 1, clientY: 1}); assert(f.frames.size); toggle.onclick(); assert(root.hidden); assert.equal(f.frames.size, 0); map.destroy();
});
