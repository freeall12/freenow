const test = require('node:test');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const piles = require('../canvas-piles.js');

// Previous production algorithm, including first-owner and strict indexOf semantics.
function previousIndex(nodes) {
  const types = ['image', 'video', 'audio', 'text'];
  const owner = new Map(), members = new Map(), byId = new Map(nodes.map(n => [n.id, n]));
  for (const pile of nodes.filter(n => n.type === 'pile').sort((a, b) => a.id.localeCompare(b.id)))
    for (const id of new Set(pile.memberIds || [])) {
      const n = byId.get(id);
      if (n && types.includes(n.type) && !owner.has(id)) owner.set(id, pile.id);
    }
  for (const pile of nodes.filter(n => n.type === 'pile'))
    members.set(pile.id, (pile.memberIds || []).filter((id, i, a) => a.indexOf(id) === i && owner.get(id) === pile.id).map(id => byId.get(id)));
  return {owner, members};
}

function graph(count, memberCount = 50, metrics) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    let memberIds = [];
    for (let j = 0; j < memberCount; j++) {
      const id = `member-${i}-${j}`;
      memberIds.push(id);
      const node = {id, type: ['image', 'video', 'audio', 'text'][j % 4], title: id, x: 52000.125 + i * 480.375, y: -300.375 + j * 50.125, width: 435.25, height: 250.125};
      if (metrics) {const type = node.type; Object.defineProperty(node, 'type', {enumerable: true, get() {metrics.typeReads++; return type;}});}
      nodes.push(node);
    }
    if (metrics) memberIds = new Proxy(memberIds, {get(array, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) metrics.memberReads++;
      return Reflect.get(array, key, receiver);
    }});
    const pile = {id: `pile-${i}`, type: 'pile', memberIds, x: 52000.125 + i * 480.375, y: -300.375, width: 435.25, height: 250.125};
    if (metrics) Object.defineProperty(pile, 'type', {enumerable: true, get() {metrics.typeReads++; return 'pile';}});
    nodes.push(pile);
  }
  if (metrics) nodes.map = function(callback, receiver) {return Array.prototype.map.call(this, (node, i, array) => {
    const value = callback.call(receiver, node, i, array);
    if (Array.isArray(value) && value.length === 2) metrics.pairArrays++;
    return value;
  });};
  return nodes;
}

function sameIndex(actual, expected) {
  assert.deepEqual(actual.owner, expected.owner);
  assert.deepEqual([...actual.members.keys()], [...expected.members.keys()]);
  for (const [id, expectedMembers] of expected.members) {
    const actualMembers = actual.members.get(id);
    assert.equal(actualMembers.length, expectedMembers.length);
    actualMembers.forEach((node, i) => assert.equal(node, expectedMembers[i]));
  }
}

test('1000 full piles remove 51,000 graph pair arrays and reduce type reads from 152,000 to 101,000', () => {
  const metrics = {memberReads: 0, typeReads: 0, pairArrays: 0}, nodes = graph(1000, 50, metrics);
  const expected = previousIndex(nodes), before = {...metrics};
  metrics.memberReads = metrics.typeReads = metrics.pairArrays = 0;
  sameIndex(piles.index(nodes), expected);
  assert.equal(before.memberReads, 1375000);
  assert.equal(metrics.memberReads, before.memberReads);
  assert.equal(before.typeReads, 152000);
  assert.equal(metrics.typeReads, 101000);
  assert.equal(before.pairArrays, 51000);
  assert.equal(metrics.pairArrays, 0);
});

test('index retains strict IDs, input member order, lexical ownership, sparse holes and live identities', () => {
  const objectId = {}, sparse = [];
  sparse[2] = undefined; sparse[4] = 'a'; sparse[7] = NaN; sparse[9] = 'a';
  const nodes = ['a', 'b', 0, 1, '1', undefined, NaN, objectId].map(id => ({id, type: 'image', x: 53284.3, y: -2180.48}));
  const replacement = {id: 'b', type: 'video', x: 53800.25, y: -1800.8}; nodes.push(replacement);
  nodes.push({id: 'z', type: 'pile', memberIds: ['b', 'b', 'a', -0, 0, '1', 1, NaN, objectId, objectId, 'missing']}, {id: 'a-pile', type: 'pile', memberIds: sparse});
  sameIndex(piles.index(nodes), previousIndex(nodes));
  assert.equal(piles.index(nodes).members.get('z')[0], replacement);
  assert.deepEqual(piles.index(nodes).members.get('a-pile').map(n => n.id), [undefined, 'a']);
  assert(piles.index(nodes).owner.has(NaN));
  assert(![...piles.index(nodes).members.values()].flat().some(n => Number.isNaN(n.id)));
});

test('in-place edits, undo snapshots and hover target use fresh memberships without rounding coordinates', () => {
  const nodes = graph(2, 3), original = structuredClone(nodes), first = nodes.find(n => n.id === 'pile-0');
  sameIndex(piles.index(nodes), previousIndex(nodes));
  first.memberIds.reverse(); first.memberIds.push(first.memberIds[0], 'member-1-0');
  sameIndex(piles.index(nodes), previousIndex(nodes));
  const point = {x: first.x + first.width / 2, y: first.y + first.height / 2};
  assert.equal(piles.dropTarget(nodes, point, ['pile-1'], ['pile-1']), first);
  const restored = structuredClone(original);
  sameIndex(piles.index(restored), previousIndex(restored));
  assert.equal(piles.index(restored).owner.get('member-1-0'), 'pile-1');
  assert.deepEqual(nodes.map(n => [n.id, n.x, n.y, n.width, n.height]), original.map(n => [n.id, n.x, n.y, n.width, n.height]));
  assert.equal(piles.index(restored).members.get('pile-0')[0], restored[0]);
});

test('warm repeated indexes compare the same ordinary 50-member graphs; timing is diagnostic only', t => {
  const summary = samples => {
    samples.sort((a, b) => a - b);
    return {median: +samples[Math.floor(samples.length / 2)].toFixed(3), p95: +samples[Math.ceil(samples.length * .95) - 1].toFixed(3)};
  };
  for (const count of [80, 1000]) {
    const nodes = graph(count), original = structuredClone(nodes), samples = {before: [], after: []};
    sameIndex(piles.index(nodes), previousIndex(nodes));
    for (let i = 0; i < 8; i++) {previousIndex(nodes); piles.index(nodes);}
    for (let i = 0; i < 30; i++) {
      for (const [name, run] of i % 2 ? [['after', piles.index], ['before', previousIndex]] : [['before', previousIndex], ['after', piles.index]]) {
        const start = performance.now(); run(nodes); samples[name].push(performance.now() - start);
      }
    }
    assert.deepEqual(nodes, original);
    t.diagnostic(JSON.stringify({piles: count, membersPerPile: 50, nodes: nodes.length, warmup: 8, samples: 30, beforeMs: summary(samples.before), afterMs: summary(samples.after)}));
  }
});
