'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
const canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, approve) {
  const {createExternalAgentUI} = await import('../src/features/external-agent/ui.mjs');
  const dom = new JSDOM('<html><head></head><body></body></html>', {url: 'http://127.0.0.1:4183/'}), {window} = dom; t.after(() => window.close());
  window.HTMLDialogElement.prototype.showModal = function() {this.open = true;}; window.HTMLDialogElement.prototype.close = function() {this.open = false;};
  const status = {available: true, project: {id: 'public-qa', title: 'Public QA'}, config: {mcpServers: {freenow: {command: 'local', args: []}}}, clients: [{id: 'client-qa', client: {name: 'Unverified QA'}, state: 'pending'}]};
  let interval; window.setInterval = fn => {interval = fn; return 1;}; window.clearInterval = () => {interval = null;};
  window.FreenowExternalAgent = {async invoke(method) {if (method === 'status') return structuredClone(status); if (method === 'approve') return approve ? approve() : {cancelled: true}; return {revoked: true};}, onOpen() {return () => {};}};
  const ui = createExternalAgentUI({window}); t.after(() => ui.close()); await ui.open();
  return {window, status, ui, async refresh() {interval(); await tick();}};
}
test('polling preserves the exact client button and keyboard focus, including permission state changes', async t => {
  const f = await fixture(t), button = f.window.document.querySelector('.external-agent-client button'); button.focus();
  for (let i = 0; i < 3; i++) await f.refresh();
  assert.equal(f.window.document.querySelector('.external-agent-client button'), button); assert.equal(f.window.document.activeElement, button);
  f.status.clients[0].state = 'authorized'; await f.refresh(); assert.equal(button.textContent, '撤销'); assert.equal(f.window.document.activeElement, button);
  f.status.clients.push({id: 'second-client', client: {name: 'Second'}, state: 'pending'}); await f.refresh(); assert.equal(f.window.document.querySelector('.external-agent-client button'), button); assert.equal(f.window.document.activeElement, button);
  f.status.clients.pop(); await f.refresh(); assert.equal(f.window.document.activeElement, button);
});
test('pending native approval never replaces its button or polls stale dialog state', async t => {
  let finish; const f = await fixture(t, () => new Promise(resolve => {finish = resolve;}));
  const button = f.window.document.querySelector('.external-agent-client button'); button.focus(); button.click(); await tick(); assert.equal(button.disabled, true);
  await f.refresh(); assert.equal(f.window.document.querySelector('.external-agent-client button'), button);
  finish({cancelled: true}); await tick(); assert.equal(button.disabled, false); assert.equal(f.window.document.querySelector('.external-agent-client button'), button);
  f.ui.close(); assert.equal(f.window.document.querySelector('dialog'), null); await f.ui.open(); assert.notEqual(f.window.document.querySelector('.external-agent-client button'), button);
});
test('live dialog Tab and Shift+Tab include clients appended after the modal opened', async t => {
  const f = await fixture(t), document = f.window.document, modal = document.querySelector('dialog');
  f.status.clients = []; await f.refresh();
  const close = modal.querySelector('header button'), config = modal.querySelector('textarea'), copy = [...modal.querySelectorAll('button')].find(button => button.textContent === '复制配置');
  f.status.clients.push({id: 'late-client', client: {name: 'Late client'}, state: 'pending'}); await f.refresh();
  const authorize = modal.querySelector('.external-agent-client button'), tab = shiftKey => document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', {key: 'Tab', shiftKey, bubbles: true, cancelable: true}));
  close.focus(); tab(); assert.equal(document.activeElement, config); tab(); assert.equal(document.activeElement, copy); tab(); assert.equal(document.activeElement, authorize); tab(); assert.equal(document.activeElement, close);
  tab(true); assert.equal(document.activeElement, authorize); authorize.disabled = true; close.focus(); tab(true); assert.equal(document.activeElement, copy);
});
