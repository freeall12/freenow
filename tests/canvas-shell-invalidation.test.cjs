const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `production fragment: ${start}`);
  return source.slice(from, to);
}
const implementation = [
  between('  function styleValue(', '  const attributeValue='),
  source.match(/^  const attributeValue=.*$/m)[0],
  between('  const shellDirty=', '  const svg ='),
  between('  function renderNodeShell(', '  function render(options)'),
  between('  function render(options)', '  function saveView('),
].join('\n');

function fixture({observer = true, count = 3} = {}) {
  const observers = [], elements = new Map(), owner = new Map();
  let historyWrite;
  function mutation(target, attributeName) {
    for (const watcher of observers) {
      if (!watcher.options?.attributes || !watcher.options.attributeFilter.includes(attributeName)) continue;
      let ancestor = target;
      while (ancestor && ancestor !== watcher.root) ancestor = ancestor.parentNode;
      if (ancestor) watcher.records.push({target, type: 'attributes', attributeName});
    }
  }
  class Element {
    constructor(label) {
      this.label = label; this.parentNode = null; this.children = []; this.attributes = new Map();
      this.metrics = {cssText: 0, className: 0, queries: 0, writes: 0};
      let classes = '', hidden = false;
      const properties = new Map();
      this.style = {
        getPropertyValue: key => properties.get(key) || '',
        setProperty: (key, value) => {properties.set(key, String(value)); this.metrics.writes++; mutation(this, 'style');},
      };
      Object.defineProperty(this.style, 'cssText', {
        get: () => {this.metrics.cssText++; return [...properties].map(([key, value]) => `${key}: ${value};`).join(' ');},
        set: value => {properties.clear(); for (const declaration of value.split(';')) {
          const colon = declaration.indexOf(':'); if (colon >= 0) properties.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        } this.metrics.writes++; mutation(this, 'style');},
      });
      Object.defineProperty(this, 'className', {
        get: () => {this.metrics.className++; return classes;},
        set: value => {classes = String(value); mutation(this, 'class');},
      });
      Object.defineProperty(this, 'hidden', {get: () => hidden, set: value => {hidden = !!value; mutation(this, 'hidden');}});
      this.classList = {
        contains: token => classes.split(' ').includes(token),
        toggle: (token, force) => {
          const values = new Set(classes.split(' ').filter(Boolean)), enabled = force ?? !values.has(token);
          if (enabled) values.add(token); else values.delete(token);
          classes = [...values].join(' '); mutation(this, 'class'); return enabled;
        },
      };
    }
    append(child) {child.remove(); child.parentNode = this; this.children.push(child);}
    remove() {if (this.parentNode) {this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null;}}
    querySelector(selector) {this.metrics.queries++; return this.children.find(child => child.classList.contains(selector.slice(1))) || null;}
    getAttribute(key) {return this.attributes.get(key) ?? null;}
    hasAttribute(key) {return this.attributes.has(key);}
    setAttribute(key, value) {this.attributes.set(key, String(value)); mutation(this, key);}
    removeAttribute(key) {this.attributes.delete(key); mutation(this, key);}
  }
  class MutationObserver {
    constructor(callback) {this.callback = callback; this.records = []; observers.push(this);}
    observe(root, options) {this.root = root; this.options = options;}
    takeRecords() {const records = this.records; this.records = []; return records;}
  }
  for (const id of ['nodes', 'world', 'canvas', 'zoom', 'zoom-label', 'grid']) elements.set(`#${id}`, new Element(id));
  const root = elements.get('#nodes'), shells = [], titles = [], bodies = [], media = [], nodes = [];
  for (let i = 0; i < count; i++) {
    const node = {id: `node-${i}`, type: 'image', x: 12.125 + i * 400, y: -20.375, width: 300.25, height: 201.125}; nodes.push(node);
    const shell = new Element(node.id), title = new Element(`${node.id}-title`), body = new Element(`${node.id}-body`), image = new Element(`${node.id}-media`);
    shell.className = 'node'; title.className = 'node-title'; body.className = 'node-body';
    body.append(image); shell.append(title); shell.append(body); root.append(shell);
    shells.push(shell); titles.push(title); bodies.push(body); media.push(image);
  }
  const view = {x: 1.25, y: -2.75, scale: .7}, selected = new Set();
  const context = {
    nodes, view, selected, nodeElements: new Map(nodes.map((node, i) => [node.id, shells[i]])),
    styleValues: new WeakMap(), shellStates: new WeakMap(), refreshKeys: new WeakMap(),
    world: elements.get('#world'), $: selector => elements.get(selector), edges: [],
    flushGesture() {}, cancelAnimationFrame() {}, scheduleEmptyHint() {}, scheduleViewSave() {}, toolbar() {}, edgePath() {},
    document: {dispatchEvent() {historyWrite?.();}}, CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}},
    window: {CanvasPiles: {index: () => ({owner})}, CanvasConnections: {render() {}}},
  };
  if (observer) context.MutationObserver = MutationObserver;
  vm.createContext(context);
  // Run production render as well as renderNodeShell: synchronous observer
  // draining and viewport-only dispatch must not be reimplemented in this test.
  vm.runInContext(`let renderFrame=0,pendingRender=null,renderLayout=null,renderScale=null;\n${implementation}\nthis.productionRender=render;this.dirtyProbe=()=>shellDirty.has(nodes.length?nodeElements.get(nodes[0].id):null);`, context);
  const render = options => context.productionRender(options);
  const reset = () => {for (const element of [...shells, ...titles, ...bodies, ...media]) for (const key in element.metrics) element.metrics[key] = 0;};
  render(); render(); reset();
  return {nodes, view, selected, shells, titles, bodies, media, owner, root, Element, render, reset, context,
    deliver() {for (const watcher of observers) watcher.callback(watcher.takeRecords());},
    get queued() {return observers.reduce((sum, watcher) => sum + watcher.records.length, 0);},
    onHistoryWrite(callback) {historyWrite = callback;},
    replaceTitle(index) {titles[index].remove(); const title = new Element('replacement-title'); title.className = 'node-title'; shells[index].append(title); titles[index] = title; return title;},
  };
}

const style = (element, property) => element.style.getPropertyValue(property);
function assertGeometry(f, index = 0) {
  const n = f.nodes[index], shell = f.shells[index];
  for (const [key, value] of Object.entries({left: n.x, top: n.y, width: n.width, height: n.height})) assert.equal(style(shell, key), `${value}px`, key);
}

test('clean full renders serialize no idle shell/title strings or query the DOM', () => {
  const f = fixture({count: 100});
  for (let i = 0; i < 30; i++) f.render();
  for (const element of [...f.shells, ...f.titles]) assert.deepEqual(element.metrics, {cssText: 0, className: 0, queries: 0, writes: 0});
});

test('synchronous external styles, selected class and hidden state restore before observer callback', () => {
  const f = fixture(), shell = f.shells[0];
  shell.style.cssText = 'left: 999px; top: 888px; width: 700px; height: 800px; z-index: 1008; opacity: .8;';
  shell.classList.toggle('selected', true); shell.hidden = true;
  f.titles[0].style.setProperty('width', '1px'); assert.ok(f.queued > 0);
  f.render(); assertGeometry(f); assert.equal(style(shell, 'z-index'), ''); assert.equal(style(shell, 'opacity'), '.8');
  assert.equal(shell.classList.contains('selected'), false); assert.equal(shell.hidden, false);
  assert.equal(style(f.titles[0], 'width'), `${f.nodes[0].width * f.view.scale}px`);
  assert.equal(f.shells[1].metrics.cssText, 0); assert.equal(f.titles[1].metrics.cssText, 0);
});

test('already-delivered observer records still invalidate shell and title', () => {
  const f = fixture(); f.shells[0].style.setProperty('height', '77px'); f.titles[0].style.setProperty('width', '88px');
  f.deliver(); assert.equal(f.queued, 0); assert.equal(f.context.dirtyProbe(), true);
  f.render(); assertGeometry(f); assert.equal(style(f.titles[0], 'width'), `${f.nodes[0].width * f.view.scale}px`);
});

test('pan and zoom do not discard dirty shell state before the next full render', () => {
  const f = fixture(); f.shells[0].style.setProperty('left', '12345px'); f.titles[0].style.setProperty('width', '99px');
  f.view.x += 2; f.render({viewportOnly: true});
  assert.equal(style(f.shells[0], 'left'), '12345px'); assert.equal(f.context.dirtyProbe(), true);
  assert.equal(f.shells[0].metrics.cssText, 0); assert.equal(f.titles[0].metrics.cssText, 0);
  f.view.scale = 1.125; f.render({viewportOnly: true});
  assert.equal(style(f.shells[0], 'left'), '12345px'); assert.equal(f.context.dirtyProbe(), true);
  assert.equal(style(f.titles[0], 'width'), `${f.nodes[0].width * 1.125}px`);
  f.render(); assertGeometry(f); assert.equal(f.context.dirtyProbe(), false);
});

test('replacement title receives current scaled width without an attribute mutation record', () => {
  const f = fixture(), title = f.replaceTitle(0); assert.equal(f.queued, 0);
  f.render(); assert.equal(style(title, 'width'), `${f.nodes[0].width * f.view.scale}px`);
  assert.equal(f.shells[0].metrics.queries, 1); assert.equal(f.shells[0].metrics.cssText, 0);
});

test('body and deeper media mutations never invalidate owner shell or title styles', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) {
    f.bodies[0].style.setProperty('background-color', `rgb(${i} 0 0)`);
    f.media[0].style.setProperty('opacity', String(i / 30)); f.media[0].classList.toggle('ready', i % 2 === 0);
    f.render();
  }
  for (const element of [...f.shells, ...f.titles]) assert.deepEqual(element.metrics, {cssText: 0, className: 0, queries: 0, writes: 0});
});

test('model geometry, selection, parent layer and pile membership still update normally', () => {
  const f = fixture(), target = f.nodes[0], shell = f.shells[0];
  Object.assign(target, {x: 33.3333333333333, y: -44.125, width: 455.375, height: 200.5, parentId: 'group'});
  f.selected.add(target.id); f.render(); assertGeometry(f);
  assert.equal(style(shell, 'z-index'), '1001'); assert.equal(shell.classList.contains('selected'), true); assert.equal(shell.getAttribute('aria-selected'), 'true');
  assert.equal(shell.getAttribute('data-parent'), 'group'); assert.equal(style(f.titles[0], 'width'), `${target.width * f.view.scale}px`);
  assert.equal(f.shells[1].metrics.cssText, 0);
  f.selected.clear(); f.render(); assert.equal(style(shell, 'z-index'), '1'); assert.equal(shell.classList.contains('selected'), false);
  f.owner.set(target.id, 'pile'); f.render(); assert.equal(shell.hidden, true);
  f.owner.delete(target.id); f.render(); assert.equal(shell.hidden, false);
});

test('history owner writes inside canvas:render are retained until preview closes', () => {
  const f = fixture(), shell = f.shells[0];
  f.onHistoryWrite(() => {shell.style.setProperty('width', '500px'); shell.style.setProperty('z-index', '1008');});
  f.render(); assert.equal(style(shell, 'width'), '500px'); assert.ok(f.queued > 0);
  f.render(); assert.equal(style(shell, 'width'), '500px'); assert.equal(style(shell, 'z-index'), '1008');
  f.onHistoryWrite(null); f.render(); assertGeometry(f); assert.equal(style(shell, 'z-index'), '');
});

test('without MutationObserver the original synchronous style/class checks remain active', () => {
  const f = fixture({observer: false}), shell = f.shells[0];
  f.render(); assert.ok(shell.metrics.cssText > 0); assert.ok(shell.metrics.className > 0); assert.ok(f.titles[0].metrics.cssText > 0);
  shell.style.setProperty('top', '-999px'); shell.classList.toggle('selected', true); shell.hidden = true; f.titles[0].style.setProperty('width', '3px');
  f.render(); assertGeometry(f); assert.equal(shell.classList.contains('selected'), false); assert.equal(shell.hidden, false);
  assert.equal(style(f.titles[0], 'width'), `${f.nodes[0].width * f.view.scale}px`);
});

test('zoom skips hidden and piled titles, then reveals them at current fractional scale', () => {
  const f = fixture({count: 5});
  f.nodes[0].hidden = true;
  f.owner.set(f.nodes[1].id, 'pile');
  f.nodes[2].type = 'pile';
  f.context.window.CanvasPilesUI = {refresh() {}};
  f.render(); f.reset();
  for (let i = 0; i < 60; i++) {f.view.scale = .217 + i * .0137; f.render({viewportOnly: true});}
  for (const title of f.titles.slice(0, 3)) assert.deepEqual(title.metrics, {cssText: 0, className: 0, queries: 0, writes: 0});
  assert.equal(f.titles[3].metrics.writes, 60);
  f.titles[0].style.setProperty('width', '17px'); f.deliver();
  const replacement = f.replaceTitle(1);
  f.nodes[0].hidden = false; f.owner.delete(f.nodes[1].id); f.nodes[2].type = 'image';
  f.render();
  for (let i = 0; i < 5; i++) assert.equal(style(f.titles[i], 'width'), `${f.nodes[i].width * f.view.scale}px`);
  assert.equal(style(replacement, 'width'), `${f.nodes[1].width * f.view.scale}px`);
  for (let i = 0; i < 5; i++) assertGeometry(f, i);
});
