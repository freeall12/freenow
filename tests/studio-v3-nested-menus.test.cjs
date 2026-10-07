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

async function fixture() {
  const { createMenus } = await import('../src/features/studio-v3/menus.mjs');
  const dom = new JSDOM('<body><div id="root"><button id="anchor">State</button><button id="other">Other</button></div><input id="outside"></body>', { pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  window.matchMedia = () => ({ matches: false });
  window.innerWidth = 800; window.innerHeight = 600;
  const root = document.querySelector('#root'), anchor = document.querySelector('#anchor');
  const other = document.querySelector('#other'), outside = document.querySelector('#outside');
  anchor.getBoundingClientRect = other.getBoundingClientRect = () => ({ left: 250, right: 350, top: 550, bottom: 586, width: 100, height: 36 });
  const errors = [], disposals = [], contexts = new Map();
  const menus = createMenus({ root, onError: error => errors.push(error) });
  const factory = (name, action) => context => {
    contexts.set(name, context);
    const node = document.createElement('div');
    for (const label of name === 'parent' ? ['Choose', 'Delete state', 'Rename state'] : ['Confirm', 'Cancel']) {
      const button = document.createElement('button'); button.textContent = label;
      if (action) button.onclick = event => action(event, context);
      node.append(button);
    }
    node.dispose = () => disposals.push(name);
    return node;
  };
  const start = () => {
    const parent = menus.toggle(anchor, factory('parent'));
    const trigger = parent.querySelectorAll('button')[1];
    trigger.getBoundingClientRect = () => ({ left: 330, right: 350, top: 350, bottom: 370, width: 20, height: 20 });
    return { parent, trigger };
  };
  const nested = trigger => menus.openNested(trigger, factory('child'), { placement: 'top', align: 'end', offset: 6 });
  const event = (target, type) => target.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const key = (target, value) => {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    target.dispatchEvent(event); return event;
  };
  return { menus, root, anchor, other, outside, window, document, errors, disposals, contexts, factory, start, nested, event, key,
    finish() { menus.dispose(); window.close(); } };
}

test('nested delete confirmation retains parent layout and uses delete top/end offset 6', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start();
    const transform = parent.parentElement.style.transform;
    const child = f.nested(trigger);
    assert.equal(child.parentElement.style.transform, 'translate3d(126px, 164px, 0)');
    assert.equal(child.parentElement.style.zIndex, '96');
    assert.equal(parent.parentElement.style.transform, transform);
    assert.equal(parent.dataset.exiting, undefined);
    assert.equal(parent.getAttribute('aria-hidden'), null);
    assert.equal(f.anchor.getAttribute('aria-expanded'), 'true');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert(f.menus.contains(parent)); assert(f.menus.contains(child));
    assert(f.contexts.get('parent').contains(child));
    assert.equal(f.contexts.get('child').contains(parent), false);
    assert.equal(f.document.activeElement, child.querySelector('button'));
    assert.deepEqual(f.disposals, []);
  } finally { f.finish(); }
});

test('Escape closes only the innermost menu, returns delete focus and leaves parent actionable', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(), child = f.nested(trigger);
    assert(f.key(child.querySelector('button'), 'Escape').defaultPrevented);
    assert.equal(f.document.activeElement, trigger);
    assert(f.menus.contains(parent)); assert.equal(f.menus.contains(child), false);
    assert.equal(child.inert, true); assert.equal(parent.inert, undefined);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(f.anchor.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(f.disposals, ['child']);
    f.key(trigger, 'Escape');
    assert.equal(f.menus.isOpen(), false); assert.equal(f.document.activeElement, f.anchor);
    assert.deepEqual(f.disposals, ['child', 'parent']);
  } finally { f.finish(); }
});

test('default close pops one layer; all closes to root origin and is idempotent', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(), child = f.nested(trigger);
    assert(f.menus.close()); assert(f.menus.contains(parent));
    assert.equal(f.document.activeElement, trigger);
    assert.equal(child.dataset.exiting, 'true');
    f.nested(trigger);
    assert(f.menus.close({ all: true }));
    assert.equal(f.document.activeElement, f.anchor); assert.equal(f.menus.isOpen(), false);
    assert.equal(f.menus.close({ all: true }), false);
    assert.deepEqual(f.disposals, ['child', 'child', 'parent']);
  } finally { f.finish(); }
});

test('parent pointer and direct click close child without cancelling the actual parent action', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(); let calls = 0;
    const choose = parent.querySelector('button');
    choose.onclick = () => calls++;
    f.nested(trigger);
    assert.equal(f.event(choose, 'pointerdown'), true);
    assert(f.menus.contains(parent)); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    choose.click(); assert.equal(calls, 1);
    f.nested(trigger); choose.click(); assert.equal(calls, 2);
    assert(f.menus.contains(parent)); assert.deepEqual(f.disposals, ['child', 'child']);
    choose.onclick = () => { calls++; f.contexts.get('parent').close(); };
    f.nested(trigger); choose.click(); assert.equal(calls, 3);
    assert.equal(f.menus.isOpen(), false); assert.equal(f.document.activeElement, f.anchor);
  } finally { f.finish(); }
});

test('pointer and wheel inside either surface retain group; outside closes every layer', async () => {
  const f = await fixture(); try {
    for (const type of ['pointerdown', 'wheel', 'resize', 'blur']) {
      const { parent, trigger } = f.start(), child = f.nested(trigger);
      f.event(child.querySelector('button'), 'pointerdown');
      assert(f.menus.contains(child));
      f.event(parent, 'wheel'); f.event(child, 'wheel');
      assert(f.menus.contains(child));
      f.event(['resize', 'blur'].includes(type) ? f.window : f.outside, type);
      assert.equal(f.menus.isOpen(), false, type);
      assert.equal(f.document.activeElement, f.anchor, type);
    }
    assert.equal(f.disposals.filter(name => name === 'child').length, 4);
    assert.equal(f.disposals.filter(name => name === 'parent').length, 4);
  } finally { f.finish(); }
});

test('focus entering parent collapses child and external focus keeps its destination', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(); f.nested(trigger);
    const choose = parent.querySelector('button'); choose.focus();
    assert(f.menus.contains(parent)); assert.equal(f.document.activeElement, choose);
    assert.deepEqual(f.disposals, ['child']);
    f.nested(trigger); f.outside.focus();
    assert.equal(f.menus.isOpen(), false); assert.equal(f.document.activeElement, f.outside);
    assert.deepEqual(f.disposals, ['child', 'child', 'parent']);
  } finally { f.finish(); }
});

test('new root toggle/openAt closes full old group and stale child actions or callbacks are rejected', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(); let calls = 0;
    const child = f.menus.openNested(trigger, f.factory('child', () => calls++));
    const staleClose = f.contexts.get('child').close, staleParentClose = f.contexts.get('parent').close;
    const replacement = f.menus.toggle(f.other, f.factory('replacement'));
    assert.equal(parent.dataset.exiting, 'true'); assert.equal(child.dataset.exiting, 'true');
    child.querySelector('button').click(); assert.equal(calls, 0);
    assert.equal(staleClose(), false); assert.equal(staleParentClose(), false);
    assert(f.menus.contains(replacement)); assert.deepEqual(f.disposals, ['child', 'parent']);
    f.menus.openAt({ x: 50, y: 50 }, f.factory('pointer'));
    assert.equal(replacement.dataset.exiting, 'true');
    f.menus.close({ all: true });
    assert.deepEqual(f.disposals, ['child', 'parent', 'replacement', 'pointer']);
  } finally { f.finish(); }
});

test('root trigger toggle closes all and replacement child keeps live parent callbacks', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(), old = f.nested(trigger);
    const staleClose = f.contexts.get('child').close;
    const next = f.nested(trigger);
    assert.equal(old.dataset.exiting, 'true'); assert(f.menus.contains(parent)); assert(f.menus.contains(next));
    assert.equal(staleClose(), false); assert(f.menus.contains(next));
    assert(f.contexts.get('parent').close()); assert.equal(f.menus.isOpen(), false);
    f.start(); const stateTrigger = f.root.querySelector('.sv3-menu:not([aria-hidden]) button:nth-child(2)');
    stateTrigger.getBoundingClientRect = trigger.getBoundingClientRect; f.nested(stateTrigger);
    assert.equal(f.menus.toggle(f.anchor, f.factory('unused')), null);
    assert.equal(f.menus.isOpen(), false); assert.equal(f.document.activeElement, f.anchor);
  } finally { f.finish(); }
});

test('three layers close in descendant order and ancestor context closes its owned subtree', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(), child = f.nested(trigger);
    const grandTrigger = child.querySelector('button'); grandTrigger.getBoundingClientRect = trigger.getBoundingClientRect;
    const grandchild = f.menus.openNested(grandTrigger, f.factory('grandchild'));
    assert(f.contexts.get('parent').contains(grandchild)); assert(f.contexts.get('child').contains(grandchild));
    assert(f.contexts.get('child').close());
    assert.deepEqual(f.disposals, ['grandchild', 'child']); assert(f.menus.contains(parent));
    assert.equal(f.document.activeElement, trigger);
    assert.equal(grandchild.dataset.exiting, 'true'); assert.equal(child.dataset.exiting, 'true');
  } finally { f.finish(); }
});

test('detached child anchor is reclaimed; unrelated or detached nested anchors never run their factory', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(), child = f.nested(trigger); let calls = 0;
    assert.equal(f.menus.openNested(f.other, () => { calls++; return f.document.createElement('div'); }), null);
    assert(f.menus.contains(child));
    trigger.remove();
    await Promise.resolve();
    assert(f.menus.contains(parent)); assert.equal(f.menus.contains(child), false);
    assert.deepEqual(f.disposals, ['child']);
    assert.equal(f.menus.openNested(trigger, () => { calls++; return f.document.createElement('div'); }), null);
    assert.equal(calls, 0);
  } finally { f.finish(); }
});

test('detached parent surface rejects stale clicks and tears down every owned menu', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start(); let calls = 0;
    const child = f.menus.openNested(trigger, f.factory('child', () => calls++));
    parent.remove(); child.querySelector('button').click();
    assert.equal(calls, 0); assert.equal(f.menus.isOpen(), false);
    assert.deepEqual(f.disposals, ['child', 'parent']);
    assert.equal(f.menus.openNested(trigger, f.factory('unused')), null);
    f.anchor.remove();
    assert.equal(f.menus.toggle(f.anchor, () => { calls++; return f.document.createElement('div'); }), null);
    assert.equal(calls, 0);
  } finally { f.finish(); }
});

test('root detach reclaims group asynchronously and keeps every disposer single-use', async () => {
  const f = await fixture(); try {
    const { trigger } = f.start(); f.nested(trigger);
    f.root.remove(); await Promise.resolve();
    assert.equal(f.menus.isOpen(), false); assert.deepEqual(f.disposals, ['child', 'parent']);
    f.menus.dispose(); f.menus.dispose();
    assert.equal(f.root.querySelector('.sv3-portal'), null);
    assert.deepEqual(f.disposals, ['child', 'parent']);
    assert.throws(() => f.menus.openNested(trigger, f.factory('unused')), /disposed/);
  } finally { f.finish(); }
});

test('nested factory failure leaves parent open, focuses trigger and reports invalid content disposal', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start();
    assert.equal(f.menus.openNested(trigger, () => { throw Error('bad child'); }), null);
    assert(f.menus.contains(parent)); assert.equal(f.document.activeElement, trigger);
    assert.equal(f.errors[0].message, 'bad child'); assert.deepEqual(f.disposals, []);
    assert.equal(f.menus.openNested(trigger, () => ({ dispose: () => f.disposals.push('invalid') })), null);
    assert.match(f.errors[1].message, /same document/);
    assert.deepEqual(f.disposals, ['invalid']); assert(f.menus.contains(parent));
  } finally { f.finish(); }
});

test('dispose failures report through onError after tearing down all layers and cleanup still runs once', async () => {
  const f = await fixture(); try {
    const broken = name => context => {
      const node = f.factory(name)(context);
      const dispose = node.dispose;
      node.dispose = () => { dispose(); throw Error(`${name} cleanup`); };
      return node;
    };
    const parent = f.menus.toggle(f.anchor, broken('parent'));
    const trigger = parent.querySelector('button'); trigger.getBoundingClientRect = f.anchor.getBoundingClientRect;
    f.menus.openNested(trigger, broken('child'));
    f.menus.dispose();
    assert.equal(f.menus.isOpen(), false); assert.equal(f.root.querySelector('.sv3-portal'), null);
    assert.deepEqual(f.errors.map(error => error.message), ['child cleanup', 'parent cleanup']);
    assert.deepEqual(f.disposals, ['child', 'parent']); f.menus.dispose();
    assert.deepEqual(f.disposals, ['child', 'parent']);
  } finally { f.finish(); }
});

test('a factory that closes itself still disposes its returned node exactly once', async () => {
  const f = await fixture(); try {
    const { parent, trigger } = f.start();
    assert.equal(f.menus.openNested(trigger, context => {
      context.close(); return f.factory('child')(context);
    }), null);
    assert(f.menus.contains(parent)); assert.equal(f.document.activeElement, trigger);
    assert.deepEqual(f.disposals, ['child']);
    f.menus.dispose(); assert.deepEqual(f.disposals, ['child', 'parent']);
  } finally { f.finish(); }
});

test('parent and child ResizeObservers remain live until their respective close', async () => {
  const f = await fixture(); try {
    const observers = [];
    f.window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(node) { this.node = node; }
      disconnect() { this.disconnected = true; }
    };
    const { parent, trigger } = f.start(), child = f.nested(trigger);
    f.anchor.getBoundingClientRect = () => ({ left: 400, right: 500, top: 550, bottom: 586, width: 100, height: 36 });
    observers[0].callback();
    assert.equal(parent.parentElement.style.transform, 'translate3d(400px, 366px, 0)');
    assert.equal(child.dataset.exiting, undefined);
    f.menus.close(); assert.equal(observers[1].disconnected, true); assert.equal(observers[0].disconnected, undefined);
    f.menus.close(); assert.equal(observers[0].disconnected, true);
  } finally { f.finish(); }
});
