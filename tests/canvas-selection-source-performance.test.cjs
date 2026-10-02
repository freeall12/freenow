const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../src/features/canvas-connections/selection-model.mjs');
const previous = (nodes, selected) => selected.map(id => nodes.find(node => node.id === id)).filter(node => node && node.type !== 'pile');

test('selection submission resolves 4000 selected nodes with one fresh graph pass', async () => {
  const {selectionSources} = await model(); let reads = 0;
  const nodes = Array.from({length: 4000}, (_, i) => ({get id() {reads++; return `n${i}`;}, type: 'image', x: i + .125}));
  const selected = Array.from({length: 4000}, (_, i) => `n${3999 - i}`);
  const before = previous(nodes, selected); assert.equal(reads, 8002000);
  reads = 0; const after = selectionSources(nodes, selected); assert.equal(reads, 4000);
  assert.equal(after.length, before.length); after.forEach((node, i) => assert.equal(node, before[i]));
});

test('selection lookup retains order, repeated IDs, first matches, pile filtering and strict NaN behavior', async () => {
  const {selectionSources} = await model();
  const nodes = [{id: 'b', type: 'image'}, {id: 'a', type: 'text'}, {id: 'b', type: 'video'},
    {id: 'p', type: 'pile'}, {id: 'p', type: 'image'}, {id: NaN, type: 'image'}, {id: 0, type: 'video'}];
  for (const selected of [[], ['a'], ['NaN'], [NaN], ['a', 'b', 'a', 'missing', 'p', NaN, -0]]) {
    const expected = previous(nodes, selected), actual = selectionSources(nodes, selected);
    assert.equal(actual.length, expected.length); actual.forEach((node, i) => assert.equal(node, expected[i]));
  }
});

test('selection submission observes replaced, deleted and changed nodes without cached layout objects', async () => {
  const {selectionSources} = await model();
  const a = {id: 'a', type: 'image'}, b = {id: 'b', type: 'video'}, nodes = [a, b], selected = ['b', 'a'];
  assert.deepEqual(selectionSources(nodes, selected), [b, a]);
  const replacement = {id: 'b', type: 'text'}; nodes[1] = replacement;
  assert.equal(selectionSources(nodes, selected)[0], replacement);
  nodes.shift(); assert.deepEqual(selectionSources(nodes, selected), [replacement]);
  replacement.type = 'pile'; assert.deepEqual(selectionSources(nodes, selected), []);
});

test('indexed selection resolution matches find across shuffled malformed and mixed graphs', async () => {
  const {selectionSources} = await model(); let seed = 219041;
  const random = n => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n;};
  for (let run = 0; run < 400; run++) {
    const nodes = Array.from({length: random(80)}, () => ({id: `n${random(50)}`, type: ['text', 'image', 'video', 'pile'][random(4)]}));
    const selected = Array.from({length: random(60)}, () => `n${random(65)}`);
    const expected = previous(nodes, selected), actual = selectionSources(nodes, selected);
    assert.equal(actual.length, expected.length); actual.forEach((node, i) => assert.equal(node, expected[i]));
  }
});
