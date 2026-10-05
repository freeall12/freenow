const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import('../src/features/generation-results/pending-ui.mjs');
const marker = (id, type = 'image', runId = 'run') => ({id, type,
  pendingOperation: `${type}.generate`, generationRun: {runId, requestId: 'request', resultIndex: 0}});
const job = (status = 'running', kind = 'image.generate', id = 'run') => ({id, status, request: {kind, nodeId: 'source'}});

test('depth variants show source pending while planned depth owns only exact video targets', async () => {
  const {pendingNodes} = await modulePromise, source = {id: 'source', type: 'video', video: 'original.mp4'},
    target = {...marker('target', 'video'), pendingOperation: 'video.depth'}, depth = job('running', 'video.depth');
  assert.deepEqual([...pendingNodes({nodes: [source]}, [depth]).keys()], ['source']);
  depth.request.parameters = {canvasResults: {targetNodeIds: ['target']}};
  assert.deepEqual([...pendingNodes({nodes: [source, target]}, [depth]).keys()], ['target']);
  target.pendingOperation = 'video.generate'; assert.equal(pendingNodes({nodes: [source, target]}, [depth]).size, 0);
  target.pendingOperation = 'video.depth'; target.type = 'image'; assert.equal(pendingNodes({nodes: [source, target]}, [depth]).size, 0);
  source.type = 'image'; delete depth.request.parameters; assert.equal(pendingNodes({nodes: [source]}, [depth]).size, 0);
  assert.equal(pendingNodes({nodes: [{...source, type: 'video'}]}, [job('running', 'video.upscale')]).size, 0);
});

test('depth source and planned overlay clear on terminal notifications and preserve video identity', async () => {
  const {install} = await modulePromise;
  for (const planned of [false, true]) for (const status of ['failed', 'cancelled', 'configuration_required', 'succeeded']) {
    const f = fixture('video'); f.node.video = 'original.mp4';
    if (planned) f.node.pendingOperation = 'video.depth';
    else {delete f.node.pendingOperation; delete f.node.generationRun;}
    const running = job('running', 'video.depth'); running.request.nodeId = 'target';
    if (planned) running.request.parameters = {canvasResults: {targetNodeIds: ['target']}};
    f.setJobs([running]); const controller = install(f.setup);
    assert.equal(f.body.getAttribute('data-generation-pending'), 'video'); assert.equal(f.body.children.length, 1);
    f.setJobs([{...running, status}]); assert.equal(f.body.children.length, 0); assert.equal(f.body.getAttribute('aria-busy'), null);
    assert.equal(f.node.type, 'video'); assert.equal(f.node.video, 'original.mp4'); controller.destroy();
  }
});

test('only genuine matching generation markers or active generation jobs activate nodes', async () => {
  const {pendingNodes} = await modulePromise;
  const state = {nodes: [marker('target'), {id: 'source', type: 'image'},
    {id: 'missing-run', type: 'image', pendingOperation: 'image.generate'},
    {...marker('panorama'), pendingOperation: 'image.panorama'}, marker('text', 'text')], edges: []};
  assert.deepEqual([...pendingNodes(state).keys()], ['target', 'text']);
  for (const status of ['failed', 'cancelled', 'configuration_required', 'succeeded']) {
    assert.equal(pendingNodes(state, [job(status)]).size, 0);
  }
  assert.deepEqual([...pendingNodes(state, [job()]).keys()], ['target']);
  assert.deepEqual([...pendingNodes({nodes: [state.nodes[1]]}, [job()]).keys()], ['source']);
  assert.equal(pendingNodes({nodes: [state.nodes[1]]}, [job('running', 'image.upscale')]).size, 0);
  assert.equal(pendingNodes(state, [{...job('succeeded'), applying: true, applicationError: 'decode failed'}]).size, 0);
  assert.deepEqual([...pendingNodes(state, [{...job('succeeded'), applying: true}]).keys()], ['target']);
});

test('planned targets do not revive after undo or steal another run and preserve-source stays clear', async () => {
  const {pendingNodes} = await modulePromise;
  const state = {nodes: [{id: 'source', type: 'image', image: 'old.jpg'}, marker('a'), {id: 'b', type: 'image'}, marker('c', 'image', 'new-run')]};
  const planned = job(); planned.request.parameters = {canvasResults: {targetNodeIds: ['a', 'b', 'c']}};
  assert.deepEqual([...pendingNodes(state, [planned]).keys()], ['a', 'c']);
  state.nodes = state.nodes.filter(node => !node.generationRun);
  assert.equal(pendingNodes(state, [planned]).size, 0);
});

test('background uses own media, otherwise the first incoming image/video only', async () => {
  const {pendingBackdrop} = await modulePromise;
  const target = marker('target'), text = {id: 'text', type: 'text'}, empty = {id: 'empty', type: 'image'},
    image = {id: 'image', type: 'image', image: 'asset:photo'}, video = {id: 'video', type: 'video', video: 'clip.mp4'};
  const state = {nodes: [target, text, empty, image, video], edges: ['text', 'empty', 'image'].map(source => ({source, target: 'target'}))};
  assert.deepEqual(pendingBackdrop(target, state), {hasMedia: false, fallback: null});
  state.edges = [{source: 'video', target: 'target'}, {source: 'image', target: 'target'}];
  assert.deepEqual(pendingBackdrop(target, state), {hasMedia: true, fallback: {src: 'clip.mp4', type: 'video'}});
  target.image = 'own.jpg';
  assert.deepEqual(pendingBackdrop(target, state), {hasMedia: true, fallback: null});
});

function fixture(type = 'image', options = {}) {
  const metrics = {queries: 0, states: 0, creates: 0, pauses: 0, plays: 0}, listeners = new Map();
  class Element {
    constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.handlers = new Map(); this.parentNode = null; this.className = '';}
    append(child) {child.remove(); this.children.push(child); child.parentNode = this;}
    remove() {if (this.parentNode) {this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null;}}
    setAttribute(key, value) {this.attributes.set(key, String(value));}
    getAttribute(key) {return this.attributes.get(key) ?? null;}
    removeAttribute(key) {this.attributes.delete(key); if (key === 'src') delete this.src;}
    addEventListener(name, callback) {this.handlers.set(name, callback);}
    removeEventListener(name) {this.handlers.delete(name);}
    querySelector(selector) {metrics.queries++; return this.children.find(child => child.className === selector.slice(1)) || null;}
    play() {metrics.plays++; return Promise.resolve();} pause() {metrics.pauses++;} load() {}
  }
  const node = marker('target', type), state = {nodes: [node], edges: []}, shells = new Map();
  const shell = new Element('div'), body = new Element('div'); body.className = 'node-body'; shell.append(body); shells.set(node.id, shell);
  const document = {body: new Element('body'), createElement(tag) {metrics.creates++; return new Element(tag);}, addEventListener(name, cb) {listeners.set(name, cb);}, removeEventListener(name) {listeners.delete(name);}};
  const app = {getState() {metrics.states++; return state;}, getNodeElement: id => shells.get(id)};
  let onJob, jobs = [];
  const generation = {getJobs: () => jobs, subscribe(callback) {onJob = callback; return () => {onJob = null;};}};
  return {metrics, state, node, body, shell, shells, document, Element, app, generation,
    setup: {app, generation, document, resolveMedia: src => src, reducedMotion: () => false, loadStyles: false, ...options},
    render: detail => listeners.get('canvas:render')?.({detail}), setJobs(value) {jobs = value; onJob?.();}};
}

test('dragging preserves overlay and animation DOM; pan/zoom do not query state or DOM', async () => {
  const {install} = await modulePromise, f = fixture(), controller = install(f.setup);
  const overlay = f.body.children[0], creates = f.metrics.creates, queries = f.metrics.queries;
  assert.equal(overlay.children.at(-1).children.length, 5);
  for (let i = 0; i < 25; i++) {f.node.x = i + .125; f.render();}
  assert.equal(f.body.children[0], overlay); assert.equal(f.metrics.creates, creates); assert.equal(f.metrics.queries, queries);
  const states = f.metrics.states;
  for (let i = 0; i < 25; i++) f.render({viewportOnly: true, scaleChanged: i % 2});
  assert.equal(f.metrics.states, states); assert.equal(f.metrics.queries, queries);
  assert.equal(install(f.setup), controller);
  controller.destroy(); assert.equal(f.body.children.length, 0); assert.equal(f.body.getAttribute('aria-busy'), null);
});

test('text skeleton preserves content and restores busy state on terminal job notification', async () => {
  const {install} = await modulePromise, f = fixture('text');
  const content = new f.Element('div'); content.className = 'text-node-content'; content.textContent = '原文'; f.body.append(content);
  f.body.setAttribute('aria-busy', 'false'); const controller = install(f.setup);
  assert.equal(f.body.children.length, 2); assert.equal(f.body.children[1].children.length, 3);
  assert.equal(f.body.getAttribute('data-generation-pending'), 'text');
  assert.equal(f.body.handlers.has('dblclick'), true);
  f.setJobs([job('cancelled', 'text.generate')]);
  assert.deepEqual(f.body.children, [content]); assert.equal(content.textContent, '原文');
  assert.equal(f.body.getAttribute('aria-busy'), 'false'); assert.equal(f.body.handlers.has('dblclick'), false);
  controller.destroy();
});

test('replaced shells remount and removed nodes clean up without stale overlays', async () => {
  const {install} = await modulePromise, f = fixture(), controller = install(f.setup);
  const shell = new f.Element('div'), body = new f.Element('div'); body.className = 'node-body'; shell.append(body); f.shells.set('target', shell);
  f.render(); assert.equal(f.body.children.length, 0); assert.equal(body.children.length, 1);
  f.state.nodes = []; f.render(); assert.equal(body.children.length, 0); controller.destroy();
});

test('only a single selected pending node hides toolbar, and state clears on terminal/destroy', async () => {
  const {install} = await modulePromise, f = fixture(); f.state.selected = ['target'];
  const controller = install(f.setup), attr = 'data-generation-pending-selection';
  assert.equal(f.document.body.getAttribute(attr), 'target');
  f.render(); assert.equal(f.document.body.getAttribute(attr), 'target');
  f.state.selected = ['target', 'other']; f.render(); assert.equal(f.document.body.getAttribute(attr), null);
  f.state.selected = ['other']; f.render(); assert.equal(f.document.body.getAttribute(attr), null);
  f.state.selected = ['target']; f.render(); assert.equal(f.document.body.getAttribute(attr), 'target');
  f.setJobs([job('failed')]); assert.equal(f.document.body.getAttribute(attr), null);
  f.setJobs([]); assert.equal(f.document.body.getAttribute(attr), 'target');
  controller.destroy(); assert.equal(f.document.body.getAttribute(attr), null);
});

test('idle pending state does not build a node index', async () => {
  const {pendingNodes} = await modulePromise;
  const nodes = Array.from({length: 2000}, (_, id) => ({id, type: 'image'}));
  nodes.map = () => {throw Error('idle node indexing');};
  assert.equal(pendingNodes({nodes}, []).size, 0);
  assert.equal(pendingNodes({nodes}, [job('failed')]).size, 0);
});

test('matching many active runs uses linear job lookups and preserves every marker owner', async () => {
  const {pendingNodes} = await modulePromise;let reads = 0;
  const nodes = Array.from({length: 2000}, (_, id) => marker('node-' + id, 'image', 'run-' + id));
  const jobs = nodes.map((node, id) => ({...job(), get id() {reads++; return 'run-' + id;}}));
  const result = pendingNodes({nodes}, jobs);
  assert.equal(result.size, nodes.length);assert.ok(reads <= jobs.length * 2, `${reads} job ID reads`);
  for (const node of nodes) assert.equal(result.get(node.id).runId, node.generationRun.runId);
});

test('text and existing-media drag frames skip entire edge graph and preserve overlays', async () => {
  const {install} = await modulePromise;
  for (const type of ['text', 'image', 'video']) {
    const f = fixture(type);if (type !== 'text') f.node[type] = 'own-media';
    f.state.nodes.push(...Array.from({length: 1999}, (_, id) => ({id: 'idle-' + id, type: 'image'})));
    let edgeReads = 0, indexes = 0;const originalMap = f.state.nodes.map;
    Object.defineProperty(f.state, 'edges', {get() {edgeReads++; return [];}});
    f.state.nodes.map = function (...args) {indexes++; return originalMap.apply(this, args);};
    const controller = install(f.setup), overlay = f.body.children[0], creates = f.metrics.creates, queries = f.metrics.queries;
    for (let frame = 0; frame < 180; frame++) {f.node.x = frame / 8;f.render();}
    assert.equal(edgeReads, 0);assert.equal(indexes, 0);assert.equal(f.body.children[0], overlay);
    assert.equal(f.metrics.creates, creates);assert.equal(f.metrics.queries, queries);controller.destroy();
  }
});

test('in-place edge and media edits update backdrop; unrelated motion preserves animation', async () => {
  const {install} = await modulePromise, f = fixture();
  const image = {id: 'image', type: 'image', image: 'a.jpg'}, video = {id: 'video', type: 'video', video: 'a.mp4'};
  f.state.nodes.push(image, video);f.state.edges.push({source: 'image', target: 'target'});
  const controller = install(f.setup);let overlay = f.body.children[0];
  f.render();assert.equal(f.body.children[0], overlay);
  image.image = 'b.jpg';f.render();assert.notEqual(f.body.children[0], overlay);overlay = f.body.children[0];
  f.state.edges[0].source = 'video';f.render();assert.notEqual(f.body.children[0], overlay);overlay = f.body.children[0];
  assert.equal(overlay.children[0].tagName, 'VIDEO');
  f.node.image = 'own.jpg';f.render();assert.notEqual(f.body.children[0], overlay);overlay = f.body.children[0];
  assert.equal(overlay.children[0].className, 'node-loading-shadow-layer');
  f.node.image = 'new-own.jpg';f.render();assert.equal(f.body.children[0], overlay);
  delete f.node.image;f.state.edges.length = 0;f.render();assert.notEqual(f.body.children[0], overlay);
  assert.equal(f.body.children[0].children[0].className, 'generation-pending-empty');controller.destroy();
});

test('late local asset resolution cannot restart removed video; reduced motion suppresses autoplay', async () => {
  const {install} = await modulePromise;
  for (const reduced of [false, true]) {
    let resolve;
    const f = fixture('image', {resolveMedia: () => new Promise(done => {resolve = done;}), reducedMotion: () => reduced});
    f.state.nodes.push({id: 'parent', type: 'video', video: 'asset:clip'}); f.state.edges.push({source: 'parent', target: 'target'});
    const controller = install(f.setup), video = f.body.children[0].children[0];
    await Promise.resolve(); assert.equal(video.autoplay, !reduced);
    controller.destroy(); resolve('blob:resolved'); await new Promise(done => setImmediate(done));
    assert.equal(video.src, undefined); assert.equal(f.metrics.plays, 0); assert.equal(f.metrics.pauses, 1);
  }
});

test('live reduced-motion change pauses background video and destroy removes the listener', async () => {
  const {install} = await modulePromise;
  let reduced = false, onChange;
  const f = fixture('image', {reducedMotion: () => reduced});
  f.document.defaultView = {matchMedia: () => ({addEventListener(_, fn) {onChange = fn;}, removeEventListener() {onChange = null;}})};
  f.state.nodes.push({id: 'parent', type: 'video', video: 'clip.mp4'}); f.state.edges.push({source: 'parent', target: 'target'});
  const controller = install(f.setup);
  await new Promise(done => setImmediate(done)); assert.equal(f.metrics.plays, 1);
  reduced = true; onChange(); assert.equal(f.metrics.pauses, 1);
  reduced = false; onChange(); assert.equal(f.metrics.plays, 2);
  controller.destroy(); assert.equal(onChange, null);
});

test('official Op CSS including all SVG noise resources is preserved exactly', () => {
  const root = path.join(__dirname, '..');
  const official = fs.readFileSync(path.join(root, 'runtime-reference/official-pending.css'), 'utf8').trim();
  const css = fs.readFileSync(path.join(root, 'src/features/generation-results/pending-ui.css'), 'utf8');
  assert.ok(css.includes(official)); assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /generation-pending-text > div \{ animation: none; \}/);
  assert.match(css, /height: 8px/); assert.match(css, /pointer-events: none/);
});

test('persisted recovery markers do not animate as running before a live task is retrieved',async()=>{
  const {pendingNodes}=await modulePromise;
  const state={nodes:[{...marker('target'),generationRecovery:{version:1}}],edges:[]};
  assert.equal(pendingNodes(state,[]).size,0);
  assert.equal(pendingNodes(state,[job('unknown')]).size,0);
  assert.equal(pendingNodes(state,[job('queued')]).size,1);
});
