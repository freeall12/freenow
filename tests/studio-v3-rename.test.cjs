'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric'));
const canvasPath = fabricRequire.resolve('canvas');
const previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = { id: canvasPath, loaded: true, exports: { createCanvas: undefined } };
const { JSDOM } = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function fixture(commit, value = '  Camera 2  ') {
  const { renameInput } = await import('../src/features/studio-v3/dom.mjs');
  const dom = new JSDOM('<body><div id="root"></div><button id="outside">Outside</button></body>', { pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
  const errors = [], canceled = [];
  const input = renameInput(value, commit, () => canceled.push(true), error => errors.push(error));
  document.querySelector('#root').append(input);
  input.focus();
  const key = (key, patch = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...patch });
    input.dispatchEvent(event);
    return event;
  };
  return {
    input, errors, canceled, document, key,
    blur() { document.querySelector('#outside').focus(); },
    finish() {
      input.remove();
      window.close();
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete globalThis.document;
    }
  };
}

test('pending Enter plus native blur submits once, stays readonly and cannot cancel the pending save', async () => {
  const pending = deferred(), calls = [];
  const f = await fixture(name => { calls.push(name); return pending.promise; });
  try {
    assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.readOnly, true);
    assert.equal(f.input.getAttribute('aria-busy'), 'true');
    f.blur(); f.key('Enter'); f.key('Escape');
    assert.deepEqual(calls, ['Camera 2']);
    assert.equal(f.canceled.length, 0);
    assert.equal(f.input.readOnly, true);
    pending.resolve(true); await tick();
    assert.equal(f.input.readOnly, false);
    assert.equal(f.input.hasAttribute('aria-busy'), false);
    f.key('Enter'); f.input.dispatchEvent(new f.document.defaultView.Event('blur'));
    assert.equal(calls.length, 1, 'a successful rename is finished and cannot submit twice');
  } finally { f.finish(); }
});

test('rejected save reports the error, preserves and refocuses the draft, and allows a successful retry', async () => {
  const first = deferred(), retry = deferred(), calls = [];
  const failure = Error('rename storage unavailable');
  const f = await fixture(name => { calls.push(name); return calls.length === 1 ? first.promise : retry.promise; });
  try {
    f.key('Enter'); f.blur(); first.reject(failure); await tick();
    assert.deepEqual(f.errors, [failure]);
    assert.equal(f.input.value, '  Camera 2  ');
    assert.equal(f.input.isConnected, true);
    assert.equal(f.input.readOnly, false);
    assert.equal(f.input.hasAttribute('aria-busy'), false);
    assert.equal(f.document.activeElement, f.input);
    assert.equal(f.input.selectionStart, 0);
    assert.equal(f.input.selectionEnd, f.input.value.length);
    f.input.value = 'Camera recovered';
    f.key('Enter'); f.blur();
    assert.deepEqual(calls, ['Camera 2', 'Camera recovered']);
    assert.equal(f.input.readOnly, true);
    retry.resolve(true); await tick();
    f.input.dispatchEvent(new f.document.defaultView.Event('blur'));
    assert.equal(calls.length, 2);
    assert.equal(f.errors.length, 1);
    assert.equal(f.canceled.length, 0);
  } finally { f.finish(); }
});

test('a false commit result releases the pending state and retains the input for retry', async () => {
  const calls = [];
  const f = await fixture(async name => { calls.push(name); return calls.length > 1; });
  try {
    f.key('Enter'); await tick();
    assert.deepEqual(calls, ['Camera 2']);
    assert.equal(f.input.readOnly, false);
    assert.equal(f.input.hasAttribute('aria-busy'), false);
    assert.equal(f.document.activeElement, f.input);
    assert.equal(f.input.value, '  Camera 2  ');
    assert.deepEqual(f.errors, []);
    f.key('Enter'); await tick();
    assert.equal(calls.length, 2);
    f.blur(); f.key('Enter'); await tick();
    assert.equal(calls.length, 2);
    assert.equal(f.canceled.length, 0);
  } finally { f.finish(); }
});

test('IME Enter and Escape do not submit or cancel; regular Escape cancels once and blocks later blur saving', async () => {
  const calls = [];
  const f = await fixture(name => { calls.push(name); return true; });
  try {
    for (const key of ['Enter', 'Escape']) {
      assert.equal(f.key(key, { isComposing: true }).defaultPrevented, false);
      assert.equal(f.key(key, { keyCode: 229 }).defaultPrevented, false);
    }
    assert.equal(calls.length, 0);
    assert.equal(f.canceled.length, 0);
    assert.equal(f.input.readOnly, false);
    assert.equal(f.key('Escape').defaultPrevented, true);
    f.blur(); f.key('Escape'); f.key('Enter'); await tick();
    assert.equal(f.canceled.length, 1);
    assert.equal(calls.length, 0);
    assert.deepEqual(f.errors, []);
  } finally { f.finish(); }
});
