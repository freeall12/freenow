const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const piles = require('../canvas-piles.js');
const navigation = require('../canvas-navigation.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const between = (from, to, script = source) => {
  const start = script.indexOf(from), end = script.indexOf(to, start + from.length);
  assert(start >= 0 && end > start, from); return script.slice(start, end);
};
function graph(count = 100) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const memberIds = [];
    for (let j = 0; j < 3; j++) {
      const id = `n${i}-${j}`; memberIds.push(id);
      nodes.push({id, type: 'image', x: 52000.125 + i * 30.125, y: -300.375 + j * 50, width: 435.25, height: 250.125});
    }
    nodes.push({id: `pile-${i}`, type: 'pile', memberIds, x: 52000.125 + i * 30.125, y: -300.375, width: 435.25, height: 250.125});
  }
  return nodes;
}
function harness({count = 100, baseline = false} = {}) {
  let script = source;
  if (baseline) {
    script = script.replace('const gestureViewportOnly=flushGesture(()=>deriveLayout().piles);', 'const gestureViewportOnly=flushGesture();');
    assert.notEqual(script, source);
  }
  const metrics = {indexCalls: 0, indexMs: 0, layouts: 0}, elements = new Map(), rendered = [];
  const element = selector => {if (!elements.has(selector)) elements.set(selector, {style: {}, hidden: false}); return elements.get(selector);};
  const noop = () => {}, listeners = [];
  const c = vm.createContext({
    nodes: graph(count), edges: [], view: {x: -36400.125, y: 300.5, scale: .7}, selected: new Set(), gesture: null, snap: false,
    gestureQueue: navigation.gestureQueue(), history: [], future: [], localChanges: 0, clone: structuredClone,
    shellObserver: null, pendingRender: null, renderFrame: 0, renderScale: .7, renderLayout: null,
    nodeElements: new Map(), refreshKeys: new Map(), world: {}, Map, Set, Number, Math, JSON,
    cancelAnimationFrame: noop, requestAnimationFrame: () => 1, styleValue: noop, renderNodeShell: noop, attributeValue: noop,
    scheduleEmptyHint: noop, scheduleViewSave: noop, toolbar: noop, clearOrphanGenerationState: noop, persist: noop, edgePath: noop,
    canvas: {dataset: {}, classList: {remove: noop, add: noop}}, closeMenu: noop, rightContext: null, suppressContext: false,
    $: element, CustomEvent: class {constructor(type, data) {this.type = type; this.detail = data?.detail;}},
    document: {dispatchEvent(event) {for (const listener of listeners) listener(event);}},
    window: {
      CanvasPiles: {...piles, index(...args) {metrics.indexCalls++; const start = performance.now(); const result = piles.index(...args); metrics.indexMs += performance.now() - start; return result;}},
      CanvasPilesUI: {refresh: noop, clearDropTarget: noop}, CanvasGroups: require('../canvas-groups.js'),
      NodeEditor: {layoutFor(node) {metrics.layouts++; c.layoutHook?.(node);}},
      CanvasConnections: {render(state, byId, index) {rendered.push({selected: [...state.selected], owner: new Map(index.owner), byId});}, cancel: noop, clearSelection: noop},
    },
  });
  vm.runInContext([
    between('  function remember()', '  function persist()', script),
    between('  function undo(', '  function nodeContentKey(', script),
    between('  function scheduleRender(', '  function renderNodeShell(', script),
    between('  function render(options)', '  function saveView()', script),
    between('  function applyGesture(', "  canvas.addEventListener('pointermove',moveGesture);", script),
    between('  const finish=e=>', "  canvas.addEventListener('pointerup',finish);", script),
    'globalThis.finishGesture=finish;',
  ].join('\n'), c, {filename: 'marquee-production-functions.js'});
  c.rebuildAndPersist = () => c.render();
  return {
    c, metrics, rendered, elements, listeners,
    begin(x = 0.125, y = 0.375) {c.gestureQueue.clear(); c.gesture = {mode: 'select', x, y}; element('#selection-box').hidden = false;},
    move(x, y) {c.moveGesture({clientX: x, clientY: y});},
    flush() {c.flushRender();},
    finish(type, x, y) {c.finishGesture({type, clientX: x, clientY: y});},
  };
}
function expected(nodes, start, end, view) {
  const owner = piles.index(nodes).owner, x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x), height = Math.abs(start.y - end.y);
  return nodes.filter(n => {
    if (owner.has(n.id)) return false;
    const nx = n.x * view.scale + view.x, ny = n.y * view.scale + view.y;
    return nx < x + width && nx + n.width * view.scale > x && ny < y + height && ny + n.height * view.scale > y;
  }).map(n => n.id);
}

test('actual marquee flush/render shares exactly one pile index per frame with unchanged fractional selection', () => {
  const before = harness({count: 1000, baseline: true}), after = harness({count: 1000});
  const original = structuredClone(after.c.nodes); before.begin(); after.begin();
  for (let frame = 0; frame < 90; frame++) {
    const x = 1000.125 + frame * .125, y = 500.375 - frame * .375;
    for (const f of [before, after]) {f.move(x, y); f.flush();}
    assert.deepEqual([...after.c.selected], [...before.c.selected]);
    assert.deepEqual([...after.c.selected], expected(after.c.nodes, after.c.gesture, {x, y}, after.c.view));
    assert.equal(after.elements.get('#selection-box').style.cssText, before.elements.get('#selection-box').style.cssText);
  }
  assert.equal(before.metrics.indexCalls, 180); assert.equal(after.metrics.indexCalls, 90);
  assert.equal(before.metrics.layouts, 360000); assert.equal(after.metrics.layouts, 360000);
  assert.deepEqual(after.c.nodes, original);
});

test('pointerup flushes final coordinates once while cancellation keeps the last queued move', () => {
  for (const type of ['pointerup', 'pointercancel']) {
    const f = harness(); f.begin(); const original = structuredClone(f.c.nodes);
    for (let i = 0; i < 120; i++) f.move(200.125 + i * .125, 250.375);
    f.finish(type, 500.875, 450.125);
    const end = type === 'pointerup' ? {x: 500.875, y: 450.125} : {x: 215, y: 250.375};
    assert.equal(f.metrics.indexCalls, 1);
    assert.deepEqual([...f.c.selected], expected(f.c.nodes, {x: .125, y: .375}, end, f.c.view));
    assert.equal(f.c.gesture, null); assert.equal(f.c.gestureQueue.pending, false);
    assert.equal(f.elements.get('#selection-box').hidden, true); assert.equal(f.c.history.length, 0);
    assert.deepEqual(f.c.nodes, original); f.flush(); assert.equal(f.metrics.indexCalls, 1);
  }
});

test('layout hooks run before indexing and synchronous render-event changes cannot leak a stale index', () => {
  const f = harness({count: 2}); let changed = false;
  f.c.layoutHook = () => {if (!changed) {changed = true; f.c.nodes.find(n => n.id === 'pile-0').memberIds = ['n0-1', 'n0-2'];}};
  f.begin(); f.move(500.125, 500.375); f.flush();
  assert.equal(f.metrics.indexCalls, 1); assert(f.c.selected.has('n0-0'));
  let eventChanged = false;
  f.listeners.push(() => {
    if (eventChanged) return; eventChanged = true;
    f.c.nodes.find(n => n.id === 'pile-0').memberIds = ['n0-0', 'n0-2'];
    f.move(501.125, 500.375); f.flush();
  });
  f.move(500.625, 500.375); f.flush();
  assert.equal(f.metrics.indexCalls, 3);
  assert(!f.c.selected.has('n0-0')); assert(f.c.selected.has('n0-1'));
  assert.equal(f.rendered.at(-1).owner.get('n0-0'), 'pile-0');
});

test('standalone flush and undo use fresh indexes after replacing the graph or changing members', () => {
  const f = harness({count: 2}), original = structuredClone(f.c.nodes);
  f.begin(); f.move(500.125, 500.375); f.c.remember();
  assert.equal(f.metrics.indexCalls, 1);
  f.c.nodes.find(n => n.id === 'pile-0').memberIds = ['n0-1', 'n0-2'];
  f.c.render(); assert.equal(f.metrics.indexCalls, 2);
  assert.equal(f.rendered.at(-1).owner.has('n0-0'), false);
  f.c.undo(); assert.equal(f.metrics.indexCalls, 3); assert.deepEqual(f.c.nodes, original);
  assert.equal(f.rendered.at(-1).owner.get('n0-0'), 'pile-0');
  f.begin(); f.move(500.125, 500.375); f.flush(); assert.equal(f.metrics.indexCalls, 4);
  assert(!f.c.selected.has('n0-0'));
});

test('pure viewport frames do not invoke the lazy graph derivation', () => {
  const f = harness({count: 2}); f.c.render();
  for (let i = 0; i < 90; i++) {f.c.view.x += .125; f.c.render({viewportOnly: true});}
  assert.equal(f.metrics.indexCalls, 1); assert.equal(f.metrics.layouts, 8);
});

module.exports = {harness};
