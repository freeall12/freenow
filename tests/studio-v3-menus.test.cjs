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
  const dom = new JSDOM('<body><div class="studio-v3" id="root"><button id="anchor">State</button><button id="second">Other</button></div><input id="outside"></body>', { pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  window.matchMedia = () => ({ matches: false });
  window.innerWidth = 800; window.innerHeight = 600;
  const root = document.querySelector('#root');
  const anchor = document.querySelector('#anchor');
  anchor.getBoundingClientRect = () => ({ left: 750, right: 790, top: 560, bottom: 596, width: 40, height: 36 });
  const errors = [];
  const menu = createMenus({ root, onError: error => errors.push(error) });
  const content = ({ close } = {}) => {
    const holder = document.createElement('div');
    for (const name of ['First', 'Disabled', 'Last']) {
      const button = document.createElement('button'); button.textContent = name;
      button.className = 'sv3-menu-row'; button.disabled = name === 'Disabled';
      holder.append(button);
    }
    return holder;
  };
  const key = (target, key, patch = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...patch });
    target.dispatchEvent(event); return event;
  };
  return { menu, root, anchor, window, document, content, errors, key, finish() { menu.dispose(); window.close(); } };
}
test('one active anchored menu clamps edges, has an independent motion layer and returns focus', async () => {
  const f = await fixture(); try {
    const surface = f.menu.toggle(f.anchor, f.content, { label: 'States' });
    assert.equal(f.anchor.getAttribute('aria-expanded'), 'true');
    assert.equal(surface.getAttribute('aria-label'), 'States');
    assert.equal(surface.parentElement.style.transform, 'translate3d(568px, 376px, 0)');
    assert.equal(surface.dataset.motion, 'fromBelow');
    assert.equal(surface.style.maxHeight, '548px');
    assert.equal(f.document.activeElement.textContent, 'First');
    f.menu.toggle(f.anchor, f.content);
    assert.equal(f.menu.isOpen(), false); assert.equal(f.document.activeElement, f.anchor);
    assert.equal(surface.inert, true); assert.equal(surface.getAttribute('aria-hidden'), 'true');
    assert.equal(f.anchor.getAttribute('aria-expanded'), 'false');
    assert.equal(f.anchor.hasAttribute('aria-controls'), false);
  } finally { f.finish(); }
});
test('switching anchors exits the old menu without restoring old focus; disposal clears all surfaces', async () => {
  const f = await fixture(); try {
    const old = f.menu.toggle(f.anchor, f.content);
    const second = f.document.querySelector('#second'); second.getBoundingClientRect = f.anchor.getBoundingClientRect;
    const next = f.menu.toggle(second, f.content);
    assert.equal(old.dataset.exiting, 'true'); assert.equal(second.getAttribute('aria-expanded'), 'true');
    assert.equal(f.menu.contains(next.querySelector('button')), true);
    assert.equal(f.menu.contains(old.querySelector('button')), false);
    f.menu.dispose(); assert.equal(f.root.querySelector('.sv3-portal'), null);
    assert.throws(() => f.menu.toggle(f.anchor, f.content), /disposed/);
  } finally { f.finish(); }
});
test('Arrow/Home/End use enabled focus order and Enter/Space stay native', async () => {
  const f = await fixture(); try {
    const surface = f.menu.toggle(f.anchor, f.content), rows = surface.querySelectorAll('button');
    assert.equal(f.key(rows[0], 'ArrowDown').defaultPrevented, true); assert.equal(f.document.activeElement, rows[2]);
    f.key(rows[2], 'ArrowDown'); assert.equal(f.document.activeElement, rows[0]);
    f.key(rows[0], 'End'); assert.equal(f.document.activeElement, rows[2]);
    f.key(rows[2], 'Home'); assert.equal(f.document.activeElement, rows[0]);
    assert.equal(f.key(rows[0], 'Enter').defaultPrevented, false);
    assert.equal(f.key(rows[0], ' ').defaultPrevented, false);
    assert.equal(f.key(rows[0], 'Escape').defaultPrevented, true);
    assert.equal(f.document.activeElement, f.anchor);
  } finally { f.finish(); }
});
test('IME and input keys are owned by the editor; Tab from a menu row closes to anchor', async () => {
  const f = await fixture(); try {
    const surface = f.menu.toggle(f.anchor, f.content), row = surface.querySelector('button');
    f.key(row, 'Escape', { isComposing: true }); assert(f.menu.isOpen());
    f.key(row, 'Escape', { keyCode: 229 }); assert(f.menu.isOpen());
    const input = f.document.createElement('input'); surface.append(input); input.focus();
    for (const key of ['Escape', 'Enter', 'ArrowDown', 'Tab']) assert.equal(f.key(input, key).defaultPrevented, false);
    assert(f.menu.isOpen()); row.focus(); f.key(row, 'Tab'); assert.equal(f.menu.isOpen(), false);
    assert.equal(f.document.activeElement, f.anchor);
  } finally { f.finish(); }
});
test('outside pointer/wheel, resize and blur dismiss; inside scrolling and trigger pointer keep menu', async () => {
  const f = await fixture(); try {
    for (const kind of ['pointerdown', 'wheel', 'resize', 'blur']) {
      const surface = f.menu.toggle(f.anchor, f.content);
      surface.dispatchEvent(new f.window.Event('wheel', { bubbles: true })); assert(f.menu.isOpen());
      f.anchor.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true })); assert(f.menu.isOpen());
      const target = ['resize', 'blur'].includes(kind) ? f.window : f.document.querySelector('#outside');
      target.dispatchEvent(new f.window.Event(kind, { bubbles: true }));
      assert.equal(f.menu.isOpen(), false, kind); assert.equal(f.document.activeElement, f.anchor);
    }
  } finally { f.finish(); }
});
test('pointer menu uses client coordinates plus 8px and restores its prior focused origin', async () => {
  const f = await fixture(); try {
    f.anchor.focus();
    const surface = f.menu.openAt({ x: 795, y: 599 }, f.content);
    assert.equal(surface.parentElement.style.transform, 'translate3d(552px, 372px, 0)');
    f.menu.close(); assert.equal(f.document.activeElement, f.anchor);
    assert.throws(() => f.menu.openAt({ x: NaN, y: 0 }, f.content), /finite/);
  } finally { f.finish(); }
});
test('detached old rows and delayed close callbacks cannot mutate or dismiss a newer menu', async () => {
  const f = await fixture(); try {
    let calls = 0, staleClose;
    const old = f.menu.toggle(f.anchor, context => {
      staleClose = context.close;
      const node = f.content(); node.querySelector('button').onclick = () => calls++;
      return node;
    });
    f.menu.close(); const next = f.menu.toggle(f.anchor, f.content);
    old.querySelector('button').click(); assert.equal(calls, 0);
    staleClose(); assert(f.menu.isOpen()); assert(f.menu.contains(next));
  } finally { f.finish(); }
});
test('bad factory reports failure, tears down DOM and restores origin', async () => {
  const f = await fixture(); try {
    assert.equal(f.menu.toggle(f.anchor, () => { throw Error('bad menu'); }), null);
    assert.equal(f.errors[0].message, 'bad menu'); assert.equal(f.menu.isOpen(), false);
    assert.equal(f.document.activeElement, f.anchor); assert.equal(f.root.querySelector('.sv3-portal'), null);
  } finally { f.finish(); }
});

test('native input Tab can leave the menu; external focus dismisses without stealing destination', async () => {
  const f = await fixture(); try {
    f.menu.toggle(f.anchor, context => { const node = f.content(context); const input = f.document.createElement('input'); node.prepend(input); return node; });
    const input = f.document.activeElement; assert.equal(input.tagName, 'INPUT');
    assert.equal(f.key(input, 'Tab').defaultPrevented, false);
    const outside = f.document.querySelector('#outside'); outside.focus();
    assert.equal(f.menu.isOpen(), false); assert.equal(f.document.activeElement, outside);
  } finally { f.finish(); }
});

test('menu Escape capture runs before the host scene keyboard router, while editor keys remain local', async () => {
  const f = await fixture(); try {
    let hostKeys = 0; f.root.addEventListener('keydown', () => hostKeys++);
    const surface = f.menu.toggle(f.anchor, f.content);
    f.key(surface.querySelector('button'), 'Escape'); assert.equal(hostKeys, 0);
    const next = f.menu.toggle(f.anchor, f.content), input = f.document.createElement('input');
    next.append(input); input.focus(); f.key(input, 'Escape'); assert.equal(hostKeys, 1); assert(f.menu.isOpen());
  } finally { f.finish(); }
});
