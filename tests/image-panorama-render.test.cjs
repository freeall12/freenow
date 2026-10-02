const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(count = 1) {
  const counts = {dimensions: 0, jobs: 0, hidden: 0}, listeners = new Map();
  const items = [], state = {nodes: []}; let jobs = [], change;
  for (let i = 0; i < count; i++) {
    const node = {id: String(i), type: 'image', image: 'test.png'};
    const image = {dataset: {}, events: {}, width: 2000, height: 1000,
      get naturalWidth() {counts.dimensions++; return this.width;},
      get naturalHeight() {counts.dimensions++; return this.height;},
      addEventListener(name, fn) {this.events[name] = fn;}};
    const body = {querySelector: () => image, append(button) {button.isConnected = true; this.button = button;}};
    const root = {querySelector: () => body};
    state.nodes.push(node); items.push({node, image, body, root});
  }
  const document = {head: {append() {}}, getElementById() {return {};}, body: {},
    createElement() {return {isConnected: false, dataset: {}, value: false,
      set hidden(value) {counts.hidden++; this.value = value;}, get hidden() {return this.value;}};},
    addEventListener(name, fn) {listeners.set(name, fn);}};
  const window = {CanvasApp: {getState: () => state, getNodeElement: id => items.find(item => item.node.id === id)?.root},
    GenerationAPI: {getJobs() {counts.jobs++; return jobs;}, subscribe(fn) {change = fn;}}};
  const source = fs.readFileSync(require.resolve('../src/features/image-panorama/entry.mjs'), 'utf8')
    .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ')
    .replace('import.meta.url', JSON.stringify('http://localhost/entry.mjs'));
  vm.runInNewContext(source, {window, document, URL, previewTooltips() {}, panoramaIcon: '<svg/>', console});
  return {counts, items, window, render(viewportOnly = false) {listeners.get('canvas:render')({detail: {viewportOnly}});},
    jobs(value, notify = true) {jobs = value; if (notify) change();}, reset() {Object.keys(counts).forEach(key => counts[key] = 0);}};
}

test('500 panorama mounts and image loads perform linear dimension reads; movement does none', () => {
  const f = harness(500);
  assert.equal(f.counts.dimensions, 1000); assert.equal(f.counts.jobs, 1);
  assert.ok(f.items.every(item => !item.body.button.hidden));
  f.reset(); for (const item of f.items) item.image.events.load();
  assert.equal(f.counts.dimensions, 1000); assert.equal(f.counts.jobs, 0);
  f.reset(); for (let i = 0; i < 180; i++) {f.items[0].node.x = i * .125; f.render(i % 2 === 0);}
  assert.deepEqual(f.counts, {dimensions: 0, jobs: 90, hidden: 0});
});

test('decoded image changes, load errors, pending operations and provider transitions stay live', () => {
  const f = harness(), {image, node, body} = f.items[0];
  image.width = 1000; image.events.load(); assert.equal(body.button.hidden, true);
  image.width = 2000; image.events.load(); assert.equal(body.button.hidden, false);
  image.events.error(); f.render(); assert.equal(body.button.hidden, true);
  image.events.load(); assert.equal(body.button.hidden, false);
  node.pendingOperation = 'image.generate'; f.render(); assert.equal(body.button.hidden, true);
  delete node.pendingOperation; f.render(); assert.equal(body.button.hidden, false);
  for (const status of ['queued', 'running']) {f.jobs([{request: {nodeId: node.id}, status}]); assert.equal(body.button.hidden, true);}
  f.jobs([{request: {nodeId: node.id}, status: 'succeeded', applying: true}]); assert.equal(body.button.hidden, true);
  f.jobs([{request: {nodeId: node.id}, status: 'succeeded', applying: false}]); assert.equal(body.button.hidden, false);
  f.jobs([{request: {nodeId: node.id}, status: 'failed'}]); assert.equal(body.button.hidden, false);
  f.jobs([{request: {nodeId: node.id}, status: 'succeeded', applying: true}], false); f.render(); assert.equal(body.button.hidden, true);
});

test('removed buttons are released; reattached nodes use current decoded dimensions and pending jobs', () => {
  const f = harness(), item = f.items[0], old = item.body.button;
  old.isConnected = false; f.render(); f.reset();
  f.jobs([{request: {nodeId: item.node.id}, status: 'running'}]);
  assert.equal(f.counts.hidden, 0);
  delete item.image.dataset.panoramaAttached;
  f.window.ImagePanorama.attach(item.node, item.root);
  assert.notEqual(item.body.button, old); assert.equal(item.body.button.hidden, true);
  f.jobs([]); assert.equal(item.body.button.hidden, false);
  const button = item.body.button; f.window.ImagePanorama.attach(item.node, item.root); assert.equal(item.body.button, button);
});
