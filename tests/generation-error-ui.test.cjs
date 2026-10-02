const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/features/generation-results/error-state.mjs');
const ui = import('../src/features/generation-results/error-ui.mjs');
const node = (id = 'target', type = 'image') => ({id, type, x: 1, y: 2, width: 300, height: 200, title: '结果', image: ''});
function failure(target, signature, overrides = {}) {
  return {id: 'job-1', request: {kind: `${target.type}.generate`, nodeId: target.id}, status: 'failed',
    providerDispatched: true, error: '模型服务暂时不可用', nodeFailures: [{node: target, signature}], ...overrides};
}

test('signature is stable and ignores exactly movement and transient generation markers', async () => {
  const {failureSignature} = await model;
  const source = {...node(), generation: {model: 'model', ratio: '1:1'}}, signature = failureSignature(source);
  assert.equal(failureSignature({...source, generation: {ratio: '1:1', model: 'model'}, x: 500, y: 800, selected: true,
    pendingOperation: 'image.generate', generationRun: {runId: 'job'}}), signature);
  for (const patch of [{width: 301}, {title: '改名'}, {image: 'new.jpg'}, {generation: {model: 'other'}}, {hidden: true}]) {
    assert.notEqual(failureSignature({...source, ...patch}), signature);
  }
});

test('only provider-dispatched failures with trusted receipts become node failures', async () => {
  const {failureSignature, createFailureState} = await model;
  const target = node(), state = {nodes: [target]}, signed = failure(target, failureSignature(target));
  assert.equal(createFailureState().collect(state, [signed]).size, 1);
  for (const patch of [{status: 'queued'}, {status: 'running'}, {status: 'succeeded'}, {status: 'cancelled'},
    {status: 'configuration_required'}, {providerDispatched: false}, {error: ''}, {nodeFailures: undefined},
    {request: {kind: 'image.upscale', nodeId: target.id}}, {applicationError: 'failed to decode'}]) {
    assert.equal(createFailureState().collect(state, [{...signed, ...patch}]).size, 0, JSON.stringify(patch));
  }
});

test('planned batch receipt targets show independently and preserved source stays unaffected', async () => {
  const {captureFailureTargets, createFailureState} = await model;
  const source = node('source'), a = node('a'), b = node('b');
  const job = failure(a, '', {request: {kind: 'image.generate', nodeId: 'source', parameters: {canvasResults: {targetNodeIds: ['a', 'b']}}},
    nodeFailures: captureFailureTargets([a, b])});
  const state = createFailureState();
  const errors = state.collect({nodes: [source, a, b]}, [job]); assert.deepEqual([...errors.keys()], ['a', 'b']);
  state.dismiss(errors.get('a').key);
  assert.deepEqual([...state.collect({nodes: [source, a, b]}, [job]).keys()], ['b']);
  assert.equal(job.status, 'failed'); assert.equal(job.nodeFailures.length, 2);
});

test('edited or deleted/recreated nodes reject late failure and undo cannot revive stale receipt', async () => {
  const {failureSignature, createFailureState} = await model;
  for (const kind of ['edited', 'recreated', 'deleted']) {
    const target = node(), state = {nodes: [target]}, original = {...target}, job = failure(target, failureSignature(target)), store = createFailureState();
    if (kind === 'edited') target.image = 'new.jpg';
    if (kind === 'recreated') state.nodes = [{...target}];
    if (kind === 'deleted') state.nodes = [];
    assert.equal(store.collect(state, [job]).size, 0, kind);
    Object.assign(target, original); state.nodes = [target];
    assert.equal(store.collect(state, [job]).size, 0, `${kind} restored`);
  }
});

test('new queued task supersedes error permanently even when its planned targets preserve source', async () => {
  const {failureSignature, createFailureState} = await model;
  const target = node(), state = {nodes: [target]}, first = failure(target, failureSignature(target)), store = createFailureState();
  assert.equal(store.collect(state, [first]).size, 1);
  const next = {id: 'job-2', request: {kind: 'image.generate', nodeId: target.id,
    parameters: {canvasResults: {targetNodeIds: ['new-output']}}}, status: 'queued'};
  assert.equal(store.collect(state, [first, next]).size, 0);
  next.status = 'cancelled'; assert.equal(store.collect(state, [first, next]).size, 0);
  assert.equal(store.collect(state, [first]).size, 0);
});

test('a newer marker belonging to another run rejects stale failure before new job notification', async () => {
  const {failureSignature, createFailureState} = await model;
  const target = node(), job = failure(target, failureSignature(target));
  target.pendingOperation = 'image.generate'; target.generationRun = {runId: 'new'};
  assert.equal(createFailureState().collect({nodes: [target]}, [job]).size, 0);
});

function fixture({type = 'image', readonly = false} = {}) {
  const metrics = {queries: 0, creates: 0, reads: 0}, listeners = new Map();
  class Element {
    constructor(tag) {this.tagName = tag.toUpperCase(); this.parentNode = null; this.className = ''; this.children = []; this.attrs = new Map(); this.events = new Map();}
    append(child) {child.remove(); child.parentNode = this; this.children.push(child);}
    remove() {if (this.parentNode) {this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null;}}
    setAttribute(key, value) {this.attrs.set(key, String(value));} getAttribute(key) {return this.attrs.get(key) ?? null;}
    removeAttribute(key) {this.attrs.delete(key);}
    addEventListener(name, fn) {this.events.set(name, fn);}
    querySelector(selector) {metrics.queries++; return this.children.find(item => item.className === selector.slice(1));}
  }
  const target = node('target', type), state = {nodes: [target]}, shell = new Element('div'), body = new Element('div');
  body.className = 'node-body'; shell.append(body);
  const shells = new Map([[target.id, shell]]);
  let jobs = [], subscription;
  const app = {getState() {metrics.reads++; return state;}, getNodeElement: id => shells.get(id)};
  const document = {createElement(tag) {metrics.creates++; return new Element(tag);}, addEventListener(name, fn) {listeners.set(name, fn);}, removeEventListener(name) {listeners.delete(name);}};
  const generation = {getJobs: () => jobs, subscribe(fn) {subscription = fn; return () => {subscription = null;};}};
  return {target, state, shell, body, shells, metrics, Element, app, document, generation,
    options: {app, document, generation, readonly: () => readonly, loadStyles: false},
    render: detail => listeners.get('canvas:render')?.({detail}), setJobs(value) {jobs = value; subscription?.();}};
}

test('error confirmation stops propagation, dismisses only display and survives future renders', async () => {
  const {failureSignature} = await model, {install} = await ui, f = fixture();
  const job = failure(f.target, failureSignature(f.target), {error: '<img src=x onerror=alert(1)>真实错误'});
  f.setJobs([job]); const before = JSON.stringify(f.state), jobsBefore = JSON.stringify(job), controller = install(f.options);
  const content = f.body.children[0].children[0], badge = content.children[0], message = content.children[1], button = content.children[2];
  assert.equal(badge.textContent, '提示'); assert.equal(message.textContent, job.error); assert.equal(message.children.length, 0);
  assert.equal(button.textContent, '确认'); assert.equal(button.type, 'button');
  let stopped = 0, prevented = 0;
  button.events.get('pointerdown')({stopPropagation() {stopped++;}});
  button.events.get('click')({stopPropagation() {stopped++;}, preventDefault() {prevented++;}});
  assert.equal(stopped, 2); assert.equal(prevented, 1); assert.equal(f.body.children.length, 0);
  f.render(); f.setJobs([job]); assert.equal(f.body.children.length, 0);
  assert.equal(JSON.stringify(f.state), before); assert.equal(JSON.stringify(job), jobsBefore);
  controller.destroy();
});

test('image video and text use the same overlay; readonly does not provide confirmation', async () => {
  const {failureSignature} = await model, {install} = await ui;
  for (const type of ['image', 'video', 'text']) {
    const f = fixture({type, readonly: true}); f.setJobs([failure(f.target, failureSignature(f.target))]);
    const controller = install(f.options);
    assert.equal(f.body.children[0].className, 'generation-error-overlay');
    assert.equal(f.body.children[0].children[0].children.length, 2); controller.destroy();
  }
});

test('dragging preserves DOM and viewport events do not read state; rebuilt shell reattaches', async () => {
  const {failureSignature} = await model, {install} = await ui, f = fixture();
  f.setJobs([failure(f.target, failureSignature(f.target))]); const controller = install(f.options), overlay = f.body.children[0];
  const creates = f.metrics.creates, queries = f.metrics.queries;
  for (let i = 0; i < 20; i++) {f.target.x += .125; f.render();}
  assert.equal(f.body.children[0], overlay); assert.equal(f.metrics.creates, creates); assert.equal(f.metrics.queries, queries);
  const reads = f.metrics.reads; for (let i = 0; i < 20; i++) f.render({viewportOnly: true}); assert.equal(f.metrics.reads, reads);
  const shell = new f.Element('div'), body = new f.Element('div'); body.className = 'node-body'; shell.append(body); f.shells.set('target', shell);
  f.render(); assert.equal(f.body.children.length, 0); assert.equal(body.children.length, 1);
  assert.equal(install(f.options), controller); controller.destroy(); assert.equal(body.children.length, 0); assert.equal(body.getAttribute('data-generation-error'), null);
});

test('idle model does not build node indexes without actionable failure receipts', async () => {
  const {createFailureState} = await model;
  const nodes = Array.from({length: 2000}, () => node()); nodes.map = () => {throw Error('idle node scan');};
  assert.equal(createFailureState().collect({nodes}, []).size, 0);
  assert.equal(createFailureState().collect({nodes}, [{status: 'failed', providerDispatched: true, error: 'error', request: {kind: 'image.generate'}}]).size, 0);
});

test('dismissed and invalidated historical receipts do no indexing or serialization over drag frames', async () => {
  const {captureFailureTargets, createFailureState} = await model;
  const nodes = Array.from({length: 2000}, (_, id) => node(String(id)));
  const jobs = nodes.slice(0, 500).map(target => failure(target, captureFailureTargets([target])[0].signature, {id: 'job-' + target.id}));
  const store = createFailureState(), state = {nodes};
  for (const item of store.collect(state, jobs).values()) store.dismiss(item.key);
  // A second set is permanently invalidated by actual nested content edits.
  for (let i = 500; i < 1000; i++) {
    nodes[i].generation = {references: [{id: 'original'}]};
    jobs.push(failure(nodes[i], captureFailureTargets([nodes[i]])[0].signature, {id: 'job-' + i}));
    nodes[i].generation.references[0].id = 'edited';
  }
  assert.equal(store.collect(state, jobs).size, 0);
  let indexes = 0, serializations = 0;const originalMap = nodes.map, stringify = JSON.stringify;
  nodes.map = function (...args) {indexes++; return originalMap.apply(this, args);};
  JSON.stringify = function (...args) {serializations++; return stringify.apply(this, args);};
  try {for (let frame = 0; frame < 180; frame++) {nodes[0].x += .125; assert.equal(store.collect(state, jobs).size, 0);}}
  finally {JSON.stringify = stringify; nodes.map = originalMap;}
  assert.equal(indexes, 0);assert.equal(serializations, 0);
  nodes[500].generation.references[0].id = 'original';assert.equal(store.collect(state, jobs).size, 0);
});

test('receipt key cache observes changed error, signature, job ID and node ID in place', async () => {
  const {failureSignature, createFailureState} = await model;
  for (const field of ['error', 'signature', 'jobId', 'nodeId']) {
    const target = node(), job = failure(target, failureSignature(target)), store = createFailureState(), state = {nodes: [target]};
    const initial = store.collect(state, [job]).get(target.id);store.dismiss(initial.key);
    if (field === 'error') job.error = 'another failure';
    if (field === 'signature') {target.title = 'new title';job.nodeFailures[0].signature = failureSignature(target);}
    if (field === 'jobId') job.id = 'new-job';
    if (field === 'nodeId') {target.id = 'new-node';job.request.nodeId = target.id;job.nodeFailures[0].signature = failureSignature(target);}
    const current = store.collect(state, [job]).get(target.id);
    assert.ok(current, field);assert.notEqual(current.key, initial.key, field);
  }
});
