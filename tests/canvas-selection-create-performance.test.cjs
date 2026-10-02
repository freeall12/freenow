const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const method = source.slice(source.indexOf('    addSelectionConnectionNode(ids,draft){'), source.indexOf('    setView(next){'));
const draft = {type: 'text', x: 52000.125, y: -300.375, width: 435.25, height: 250.125};

function fixture(nodes, selectionInputs, implementation = method) {
  const edges = [], calls = [], selected = new Set(['original']); let sequence = 0;
  const context = {nodes, edges, selected, Set, Map, Number, crypto: {randomUUID: () => `created-${++sequence}`},
    clone: structuredClone, window: {CanvasConnections: {selectionInputs}},
    remember: () => calls.push('remember'), makeNode: node => calls.push(['makeNode', node]),
    render: () => calls.push('render'), persist: () => calls.push('persist')};
  const api = vm.runInNewContext(`({${implementation}})`, context, {filename: 'canvas-selection-create-production-extract.js'});
  return {api, nodes, edges, calls, selected};
}

test('production multi-selection create resolves 4000 sources once before the real input-order validator', async () => {
  const {selectionInputs} = await import('../src/features/canvas-connections/selection-model.mjs');
  let reads = 0, lookupReads;
  const nodes = Array.from({length: 4000}, (_, i) => ({get id() {reads++; return `n${i}`;}, type: 'image'}));
  const ids = Array.from({length: 4000}, (_, i) => `n${3999 - i}`);
  const baseline = method.replace(/const wanted=new Set\(ids\),byId=new Map\(\);[\s\S]*?const sources=\[\.\.\.wanted\]\.map\(id=>byId.get\(id\)\);/,
    'const sources=[...new Set(ids)].map(id=>nodes.find(n=>n.id===id));');
  assert.notEqual(baseline, method);
  const previous = fixture(nodes.slice(), (type, sources) => {lookupReads = reads; return selectionInputs(type, sources);}, baseline);
  previous.api.addSelectionConnectionNode([...ids, ids[0]], draft);
  assert.equal(lookupReads, 8002000); assert.equal(reads, 8006000);
  reads = 0;
  const f = fixture(nodes, (type, sources) => {lookupReads = reads; return selectionInputs(type, sources);});
  const result = f.api.addSelectionConnectionNode([...ids, ids[0]], draft);
  assert.equal(lookupReads, 4000); assert.equal(reads, 8000, 'one source lookup pass plus input ID serialization');
  assert.equal(f.nodes.length, 4001); assert.equal(f.edges.length, 4000);
  assert.deepEqual(f.edges.map(edge => edge.source), ids);
  assert(f.edges.every(edge => edge.target === result.id && edge.sourceHandle === 'right' && edge.targetHandle === 'left'));
  assert.equal(result.x, draft.x); assert.equal(result.y, draft.y);
  assert.deepEqual(f.calls.map(call => Array.isArray(call) ? call[0] : call), ['remember', 'makeNode', 'render', 'persist']);
  assert.deepEqual([...f.selected], ['original']);
});

test('production create keeps deduplication order and first source identity before type ordering', async () => {
  const {selectionInputs} = await import('../src/features/canvas-connections/selection-model.mjs');
  const first = {id: 'a', type: 'image'}, b = {id: 'b', type: 'text'};
  const f = fixture([first, {id: 'a', type: 'audio'}, b], (type, sources) => {
    assert.equal(sources.length, 2); assert.equal(sources[0], first); assert.equal(sources[1], b);
    return selectionInputs(type, sources);
  });
  f.api.addSelectionConnectionNode(['a', 'b', 'a'], {...draft, type: 'image'});
  assert.deepEqual(f.edges.map(edge => edge.source), ['b', 'a']);
});

test('production create rejects missing, NaN, unsupported and insufficient inputs without mutations', async () => {
  const {selectionInputs} = await import('../src/features/canvas-connections/selection-model.mjs');
  for (const ids of [[], ['a'], ['a', 'a'], ['a', 'missing'], ['a', NaN], ['a', 'p']]) {
    const nodes = [{id: 'a', type: 'image'}, {id: NaN, type: 'image'}, {id: 'p', type: 'pile'}, {id: 'p', type: 'image'}];
    const original = nodes.slice(), f = fixture(nodes, selectionInputs);
    assert.throws(() => f.api.addSelectionConnectionNode(ids, draft), /选区或节点参数无效|当前所选节点不支持此操作/);
    assert.deepEqual(f.nodes, original); assert.deepEqual(f.edges, []); assert.deepEqual(f.calls, []);
  }
  const f = fixture([{id: 'a', type: 'text'}, {id: 'b', type: 'text'}], selectionInputs);
  for (const invalid of [{...draft, x: NaN}, {...draft, width: 0}, {...draft, type: 'audio'}]) {
    assert.throws(() => f.api.addSelectionConnectionNode(['b', 'a'], invalid), /选区或节点参数无效/);
  }
  assert.equal(f.nodes.length, 2); assert.deepEqual(f.calls, []);
});

test('production create reads current replaced and deleted sources on each submission', async () => {
  const {selectionInputs} = await import('../src/features/canvas-connections/selection-model.mjs');
  const f = fixture([{id: 'a', type: 'audio'}, {id: 'b', type: 'image'}], selectionInputs);
  f.nodes[0] = {id: 'a', type: 'text'};
  f.api.addSelectionConnectionNode(['a', 'b'], draft);
  f.nodes.splice(1, 1); const length = f.nodes.length, edges = f.edges.length, calls = f.calls.length;
  assert.throws(() => f.api.addSelectionConnectionNode(['a', 'b'], draft), /选区或节点参数无效/);
  assert.equal(f.nodes.length, length); assert.equal(f.edges.length, edges); assert.equal(f.calls.length, calls);
});
