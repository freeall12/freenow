const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const operations = () => import('../src/features/agent-canvas/operations.mjs');
const text = require('../canvas-text.js'), groups = require('../canvas-groups.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function slice(from, to) {const start = source.indexOf(from), end = source.indexOf(to, start + from.length); assert(start >= 0 && end > start); return source.slice(start, end);}
async function appFixture(nodes, edges = [], onFlush) {
  const {withoutSources} = await import('../src/features/node-composer/reference-model.mjs');
  const context = vm.createContext({nodes: structuredClone(nodes), edges: structuredClone(edges), selected: new Set(), history: [], future: [], localChanges: 0,
    clone: structuredClone, flushGesture() {onFlush?.(context);}, clearOrphanGenerationState() {}, render() {}, persist() {}, rebuild() {}, rebuildAndPersist() {},
    window: {CanvasGroups: groups, CanvasConnections: {cancel() {}, clearSelection() {}}, NodeEditor: {withoutSources: (node, sources) => withoutSources(node.generation, sources)}}});
  vm.runInContext(slice('  function remember()', '  function persist()') + slice('  function undo(', '  function nodeContentKey(') + `
    window.CanvasApp={getState:()=>({nodes,edges,selected:[...selected]}),undo,
    ${slice('    historyState:', '    // Feature renderers')}
    ${slice('    disconnect(', '    addConnectionNode(')}
    ${slice('    updateNode(', '    insertGraph(')}};
  `, context);
  return context.window.CanvasApp;
}

test('read-node pages complete text and preserves stored parameters/history without media payloads or invented lineage', async () => {
  const {readCanvasNode} = await operations();
  const secretBody = 'AAAA_SECRET_MEDIA_'.repeat(200), data = `data:image/png;base64,${secretBody}`;
  const content = '长文本😀\n'.repeat(12000), node = {id: 'text', type: 'text', content,
    generation: {prompt: '原始长提示词'.repeat(3000), arbitraryProviderOption: {seed: 42, enabled: false, refs: [data]}, apiKey: 'not-for-model'},
    params: {camera: {yaw: 1.25}}, versions: [{id: `legacy:${data}`, image: data, title: '已有版本'}],
    imageHistory: [{id: 'job', options: [{image: data}], parameters: {steps: 30}}]};
  const app = {getState: () => ({nodes: [node], edges: [{id: 'e', source: 'other', target: 'text'}]})};
  let offset = 0, result = '', page;
  do {page = readCanvasNode({id: 'text', offset, limit: 13001}, {app}); result += page.content.value; offset = page.content.nextOffset;} while (offset !== null);
  assert.equal(result, content); assert.equal(page.content.totalLength, content.length);
  assert.equal(page.node.generation.prompt, node.generation.prompt);
  assert.deepEqual(page.node.generation.arbitraryProviderOption.seed, 42);
  assert.deepEqual(page.history.recordedFields, ['imageHistory', 'versions']);
  assert.equal(Object.hasOwn(page.node.imageHistory[0], 'createdAt'), false);
  assert.equal(Object.hasOwn(page.node.imageHistory[0], 'prompt'), false);
  assert.equal(page.connections.incoming[0].id, 'e');
  const serialized = JSON.stringify(page); assert(!serialized.includes(secretBody)); assert(!serialized.includes('not-for-model'));
  assert(serialized.includes('omitted data media')); assert(node.versions[0].image === data);
  assert.throws(() => readCanvasNode({id: 'text', offset: .5}, {app}), /分页/);
  assert.throws(() => readCanvasNode({id: 'text', limit: 20001}, {app}), /分页/);
  assert.throws(() => readCanvasNode({id: 'missing'}, {app}), /不存在/);
});

test('read-node sanitizes inline media before paging while ordinary text and absent history remain truthful', async () => {
  const {readCanvasNode} = await operations();
  const node = {id: 'n', type: 'text', content: 'metadata: keep\n![image](data:image/png;base64,SECRETBODY)\nend', thumbnail: 'blob:local-uuid'};
  const app = {getState: () => ({nodes: [node], edges: []})};
  const result = readCanvasNode({id: 'n'}, {app});
  assert(result.content.value.startsWith('metadata: keep')); assert(result.content.value.endsWith('\nend'));
  assert(!JSON.stringify(result).includes('SECRETBODY')); assert(!JSON.stringify(result).includes('blob:local-uuid'));
  assert.deepEqual(result.history.recordedFields, []); assert.equal(Object.hasOwn(result.node, 'generation'), false);
});

test('disconnect uses production cleanup/history and redo truthfully restores the actual edit', async () => {
  const {executeCanvasOperation: execute} = await operations();
  const app = await appFixture([{id: 'a', type: 'image', image: 'asset:source'}, {id: 'b', type: 'image', generation: {prompt: '', refs: ['asset:source'], referenceBindings: ['a']}}],
    [{id: 'e1', source: 'a', target: 'b'}, {id: 'e2', source: 'a', target: 'b', purpose: 'extra'}, {id: 'other', source: 'b', target: 'a'}]);
  const original = structuredClone(app.getState());
  assert.equal(execute('canvas_redo', {}, {app}).redone, false);
  const disconnected = execute('canvas_disconnect', {source: 'a', target: 'b'}, {app});
  assert.deepEqual(Array.from(disconnected.removedEdgeIds), ['e1', 'e2']);
  assert.equal(app.getState().edges.length, 1); assert.deepEqual(Array.from(app.getState().nodes[1].generation.refs), []);
  assert.equal(app.historyState().undoCount, 1);
  assert.equal(execute('canvas_disconnect', {source: 'a', target: 'b'}, {app}).disconnected, false);
  assert.equal(app.historyState().undoCount, 1);
  app.undo(); assert.deepEqual(structuredClone(app.getState()), original);
  const redo = execute('canvas_redo', {}, {app}); assert.equal(redo.redone, true); assert.equal(redo.redoCount, 0);
  assert.equal(app.getState().edges.length, 1); assert.equal(execute('canvas_redo', {}, {app}).redone, false);
});

test('resize uses real text/group limits, keeps children fixed, and remains one undoable edit', async () => {
  const {resizeCanvasNode, redoCanvas} = await operations();
  const app = await appFixture([{id: 'g', type: 'group', x: 52000.125, y: -300.375, width: 500, height: 600},
    {id: 't', type: 'text', parentId: 'g', x: 52020.25, y: -280.875, width: 300, height: 300}, {id: 'image', type: 'image'}]);
  const context = {app, text, groups}, child = structuredClone(app.getState().nodes[1]);
  const result = resizeCanvasNode({id: 'g', width: 5, height: 18.125}, context);
  assert.equal(result.width, 10); assert.equal(result.height, 18.125);
  assert.equal(result.x, 52000.125); assert.equal(result.y, -300.375);
  assert.deepEqual(app.getState().nodes[1], child); assert.equal(app.historyState().undoCount, 1);
  app.undo(); assert.equal(app.getState().nodes[0].width, 500); assert.equal(redoCanvas({}, context).redone, true);
  const resizedText = resizeCanvasNode({id: 't', width: 100, height: 251.125}, context);
  assert.equal(resizedText.width, 250); assert.equal(resizedText.height, 251.125);
  const count = app.historyState().undoCount;
  assert.equal(resizeCanvasNode({id: 't', width: 250, height: 251.125}, context).changed, false);
  assert.equal(app.historyState().undoCount, count);
  assert.throws(() => resizeCanvasNode({id: 'image', width: 300, height: 300}, context), /仅文本和分组/);
  assert.throws(() => resizeCanvasNode({id: 't', width: Infinity, height: 300}, context), /有限正数/);
  assert.equal(app.historyState().undoCount, count);
});

test('redo never reports success if flushing a pending gesture invalidates the redo branch', async () => {
  const {redoCanvas} = await operations(); let invalidate = false;
  const app = await appFixture([{id: 't', type: 'text', title: 'before'}], [], context => {if (invalidate) context.future = [];});
  app.updateNode('t', {title: 'after'}); app.undo(); assert.equal(app.historyState().redoCount, 1);
  invalidate = true;
  const result = redoCanvas({}, {app}); assert.equal(result.redone, false); assert.equal(result.redoCount, 0);
  assert.equal(app.getState().nodes[0].title, 'before');
});
