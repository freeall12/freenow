const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const navigation = require('../canvas-navigation.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const actionSource = fs.readFileSync(require.resolve('../node-actions.js'), 'utf8');
function between(script, from, to) {
  const start = script.indexOf(from), end = script.indexOf(to, start + from.length);
  assert(start >= 0 && end > start, from);
  return script.slice(start, end);
}
function fixture(baseline = false) {
  const metrics = {layouts: 0, indexes: 0, shells: 0, toolbar: 0, history: 0};
  const events = [], renders = [], minimap = [], elements = new Map();
  const noop = () => {};
  const canvas = {style: {}, dataset: {}, get clientWidth() {return 1280 - parseFloat(this.style.right || 0);}};
  const panel = {style: {}, offsetWidth: 300, offsetHeight: 160};
  const nodes = Array.from({length: 60}, (_, i) => ({id: `n${i}`, type: 'image', x: 600.125 + i, y: 300.375, width: 435.25, height: 250.125}));
  const context = vm.createContext({
    nodes, edges: [], view: {x: 150.125, y: 100.375, scale: .7}, selected: new Set(['n59']),
    gesture: null, gestureQueue: navigation.gestureQueue(), snap: false,
    focusRevision: 0, viewportFrame: 0, pendingRender: null, renderFrame: 0, renderScale: .7, renderLayout: null,
    shellObserver: null, nodeElements: new Map(), refreshKeys: new Map(), world: {style: {}}, canvas, innerHeight: 720,
    cancelAnimationFrame: noop, requestAnimationFrame: () => 1,
    styleValue(element, key, value) {element.style[key] = String(value);}, attributeValue: noop,
    renderNodeShell() {metrics.shells++;}, toolbar() {metrics.toolbar++;},
    scheduleEmptyHint: noop, scheduleViewSave: noop, edgePath: noop,
    remember() {metrics.history++;}, closeMenu: noop,
    $: selector => {if (selector === '#canvas') return canvas; if (!elements.has(selector)) elements.set(selector, {style: {}}); return elements.get(selector);},
    CustomEvent: class {constructor(type, data) {this.type = type; this.detail = data?.detail;}},
    document: {documentElement: {style: {setProperty(key, value) {this[key] = value;}}}, dispatchEvent(event) {events.push(event.detail); context.placeAction({viewportOnly: event.detail.viewportOnly});}},
    window: {
      CanvasPiles: {...require('../canvas-piles.js'), index(...args) {metrics.indexes++; return require('../canvas-piles.js').index(...args);}},
      CanvasPilesUI: {refresh: noop, dropTarget: noop}, CanvasGroups: require('../canvas-groups.js'),
      NodeEditor: {layoutFor() {metrics.layouts++;}},
      CanvasConnections: {render(state, byId) {renders.push({state, byId});}},
      CanvasMinimap: {update(state, byId) {minimap.push({state, byId});}},
    },
    panel, active: {node: nodes[59]}, app: {getState: () => ({nodes: context.nodes, view: context.view})},
  });
  const setter = source.match(/    setRightPanel\(width\)\{[^\n]+/)[0];
  assert.match(setter, /render\(\{viewportOnly:true\}\)/);
  vm.runInContext([
    between(source, '  function scheduleRender(', '  function renderNodeShell('),
    between(source, '  function render(options)', '  function saveView()'),
    between(source, '  function cancelViewportAnimation()', '  function animateView('),
    between(source, '  function applyGesture(', "  canvas.addEventListener('pointermove',moveGesture);"),
    between(actionSource, '  function place(', '  function start(').replace('function place(', 'function placeAction('),
    `globalThis.panelAPI={${baseline ? setter.replace('render({viewportOnly:true})', 'render()') : setter}};`,
  ].join('\n'), context, {filename: 'production-panel-render-functions.js'});
  return {context, metrics, events, renders, minimap, canvas, panel, elements};
}

test('panel bounds reuse the graph while retaining floating positions and pending graph invalidation', () => {
  const before = fixture(true), after = fixture();
  const initial = structuredClone(after.context.nodes), view = {...after.context.view};
  for (const f of [before, after]) f.context.render();
  const cachedLayout = after.renders.at(-1).byId;
  for (const width of [480, 560.125, 0]) {
    for (const f of [before, after]) f.context.panelAPI.setRightPanel(width);
    assert.equal(after.canvas.style.right, `${width}px`);
    assert.equal(after.context.document.documentElement.style['--agent-width'], `${width}px`);
    assert.deepEqual(after.panel.style, before.panel.style);
    const node = after.context.active.node;
    const expectedLeft = Math.max(12, Math.min(1280 - width - 312, (node.x + node.width / 2) * view.scale + view.x - 150));
    assert.equal(after.panel.style.left, `${expectedLeft}px`);
    assert.equal(after.renders.at(-1).byId, cachedLayout);
    assert.equal(after.minimap.at(-1).byId, cachedLayout);
    assert.equal(after.events.at(-1).viewportOnly, true);
    assert.deepEqual(after.context.view, view);
    assert.equal(after.context.world.style.transform, before.context.world.style.transform);
  }
  assert.equal(before.metrics.layouts, 240);
  assert.equal(after.metrics.layouts, 60);
  assert.equal(before.metrics.indexes, 4);
  assert.equal(after.metrics.indexes, 1);
  assert.equal(after.metrics.shells, 60);
  assert.equal(after.metrics.toolbar, 4);
  assert.equal(after.events.length, 4);
  assert.deepEqual(after.context.nodes, initial);
  assert.deepEqual([...after.context.selected], ['n59']);

  // Resizing before a pointer RAF must apply the last fractional coordinates
  // and publish fresh layout/content, rather than accepting the cached graph.
  const c = after.context, n = c.nodes[59];
  c.gesture = {mode: 'node', x: 10.125, y: 20.375, positions: [{id: n.id, x: n.x, y: n.y}], saved: false};
  c.moveGesture({clientX: 63.125, clientY: 49.375});
  assert.equal(c.pendingRender, false);
  c.panelAPI.setRightPanel(480);
  assert.equal(n.x, initial[59].x + 53 / view.scale);
  assert.equal(n.y, initial[59].y + 29 / view.scale);
  assert.equal(c.gestureQueue.pending, false);
  assert.equal(after.metrics.history, 1);
  assert.equal(after.events.at(-1).viewportOnly, false);
  assert.notEqual(after.renders.at(-1).byId, cachedLayout);
  assert.equal(after.renders.at(-1).byId.get(n.id).x, n.x);
  assert.equal(after.metrics.indexes, 2);
  assert.equal(after.metrics.layouts, 120);

  const first = fixture();
  first.context.panelAPI.setRightPanel(480);
  assert.equal(first.events.at(-1).viewportOnly, false);
  assert.equal(first.metrics.indexes, 1);
});
