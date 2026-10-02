const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let skillIconModule;
test.before(async () => { skillIconModule = await import('../src/features/agent-attachments/skill-icons.mjs'); });

function dom() {
  const document = { activeElement: null, listeners: [], addEventListener(...args) { this.listeners.push(args); }, removeEventListener() {} };
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return (node.className || '').split(' ').includes(selector.slice(1));
    if (selector.startsWith('[')) { const [, key, value] = selector.match(/^\[([^=\]]+)(?:=([^\]]+))?\]$/) || []; return value === undefined ? node.attrs[key] !== undefined || key.startsWith('data-') && node.dataset[key.slice(5)] !== undefined : (key === 'role' ? node.role : key.startsWith('data-') ? node.dataset[key.slice(5)] : node.attrs[key]) === value.replace(/^"|"$/g, ''); }
    return node.tagName === selector.toUpperCase();
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.className = ''; this.children = []; this.dataset = {}; this.attrs = {}; this.style = {}; this.parentNode = null; this.value = ''; this.events = {}; this.classList = { add: value => this.className += ' ' + value, toggle: (value, enabled) => { const classes = new Set((this.className || '').split(' ')); if (enabled) classes.add(value); else classes.delete(value); this.className = [...classes].join(' '); } }; this.offsetHeight = 200; this.offsetWidth = 240; this.scrollTop = 0; this.scrollHeight = 200; this.clientHeight = 200; }
    get isConnected() { return this === document.body || this === document.head || !!this.parentNode?.isConnected; }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of nodes.reverse()) { node.parentNode = this; this.children.unshift(node); } }
    replaceChildren(...nodes) { this.children.forEach(node => node.parentNode = null); this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key]; }
    removeAttribute(key) { delete this.attrs[key]; }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(selector.split(',').some(s => matches(node, s)) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return matches(this, selector) ? this : this.parentNode?.closest(selector) || null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; this.onfocus?.(); }
    scrollIntoView() {}
    getBoundingClientRect() { return { left: 200, right: 440, top: 500, bottom: 530, width: 240, height: 30 }; }
    insertAdjacentHTML() {}
    addEventListener(type, run) { this.events[type] = run; }
    showModal() { this.open = true; }
    close() { this.open = false;this.onclose?.(); }
    animate() { return { finished: Promise.resolve() }; }
    get lastChild() { return this.children.at(-1); }
    get firstElementChild() { return this.children[0]; }
  }
  document.querySelector = selector => document.body.querySelector(selector);
  document.createElement = tag => new Element(tag);
  document.body = new Element('body'); document.head = new Element('head');
  const timers = new Map(); let nextTimer = 0;
  const context = { document, window: { addEventListener() {}, removeEventListener() {} }, innerWidth: 1200, innerHeight: 800, queueMicrotask, matchMedia: () => ({ matches: true }), URL, AbortController, bindTooltip: () => ({ destroy() {}, hide() {} }), icons: {}, ...skillIconModule, availableApps: () => [], setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id), console };
  return { document, Element, context, timers };
}
function load(path, context) {
  const source = fs.readFileSync(require.resolve('../' + path), 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/^export \{[^\n]*\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', '"http://localhost/module.mjs"');
  vm.runInNewContext(source, context);
}
const key = (target, value) => ({ target, key: value, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } });

test('attachment Escape closes only the submenu, restores its row, then closes the parent', async () => {
  const f = dom(); load('src/features/agent-attachments/menu.mjs', f.context);
  const trigger = new f.Element('button'); f.document.body.append(trigger);
  const control = f.context.createAddMenu({ trigger, getSkills: async () => [{ name: 'Skill' }], onError: error => assert.fail(error) });
  control.open(); const menu = f.document.body.querySelector('.agent-add-menu');
  const skillRow = menu.querySelector('[data-submenu=skills]'); await skillRow.onclick();
  const sub = f.document.body.querySelector('.agent-add-submenu'), search = sub.querySelector('input');
  assert.equal(f.document.activeElement, search);
  const first = key(search, 'Escape'); sub.onkeydown(first);
  assert.equal(first.defaultPrevented, true); assert.equal(first.stopped, true);
  assert.equal(sub.isConnected, false); assert.equal(menu.isConnected, true);
  assert.equal(f.document.activeElement, skillRow); assert.equal(trigger.attrs['aria-expanded'], 'true');
  const second = key(skillRow, 'Escape'); menu.onkeydown(second);
  assert.equal(menu.isConnected, false); assert.equal(f.document.activeElement, trigger); assert.equal(trigger.attrs['aria-expanded'], 'false');
});

test('dismissed attachment loads cannot later steal focus and choosing an action restores its trigger', async () => {
  const f = dom(); load('src/features/agent-attachments/menu.mjs', f.context);
  const trigger = new f.Element('button'), other = new f.Element('input'); f.document.body.append(trigger, other);
  let release, invoked = false;
  const control = f.context.createAddMenu({ trigger, getSkills: () => new Promise(resolve => release = resolve), onAction() { invoked = true; assert.equal(f.document.activeElement, trigger); }, onError: error => assert.fail(error) });
  control.open(); const menu = f.document.body.querySelector('.agent-add-menu');
  const pending = menu.querySelector('[data-submenu=skills]').onclick(); control.close(); other.focus();
  release([{ name: 'Late skill' }]); await pending;
  assert.equal(f.document.activeElement, other); assert.equal(f.document.body.querySelector('.agent-add-submenu'), null);
  control.open(); f.document.body.querySelector('.agent-add-menu').querySelector('[role=menuitem]').onclick(); assert.equal(invoked, true);
});

test('thinking controls let Escape and Tab reach their owner while keeping other keyboard input local', () => {
  const f = dom(); f.context.getThinkingSpec = () => ({ levels: ['high'], can_disable: true }); f.context.normalizeThinking = (_, value) => value;
  load('src/features/agent-composer/thinking-control.mjs', f.context);
  const { element } = f.context.createThinkingControl({ id: 'model', settings: { enabled: true }, onChange() {} });
  for (const value of ['Escape', 'Tab']) { const event = key(element, value); element.onkeydown(event); assert.equal(event.stopped, false); }
  const event = key(element, 'Enter'); element.onkeydown(event); assert.equal(event.stopped, true);
});

test('Brainstorm menus become inert immediately and preserve normal Tab navigation', () => {
  const f = dom(); load('src/features/agent-artifacts/brainstorm-menu.mjs', f.context);
  const trigger = new f.Element('button'); f.document.body.append(trigger);
  f.context.createMenu({ trigger, items: () => [{ label: 'Clear', run() {} }] }); trigger.onclick();
  const menu = f.document.body.querySelector('.brainstorm-menu'), event = key(menu.children[0], 'Tab'); menu.onkeydown(event);
  assert.equal(event.defaultPrevented, false); assert.equal(event.stopped, true); assert.equal(menu.inert, true);
  assert.equal(menu.attrs['aria-hidden'], 'true'); assert.equal(menu.style.pointerEvents, 'none'); assert.equal(f.document.activeElement, trigger);
});


test('skill manager same trigger closes its menu even after focus returns to the trigger', async () => {
  const f = dom(); Object.assign(f.context, { managerIcons: {}, referenceIcons: {}, appCatalog: [] });
  load('src/features/agent-manager/manager.mjs', f.context);
  await f.context.openManager({ getSkills: async () => [], getCustom: () => [] });
  const dialog = f.document.body.querySelector('.agent-manager'), trigger = dialog.querySelector('.manager-add');
  trigger.onclick(); const menu = dialog.querySelector('.manager-add-menu');
  trigger.focus(); menu.events.focusout(); await Promise.resolve();
  assert.equal(menu.isConnected, true); trigger.onclick();
  assert.equal(menu.isConnected, false); assert.equal(trigger.attrs['aria-expanded'], 'false');
  assert.equal(dialog.open, true); trigger.onclick();
  const reopened = dialog.querySelector('.manager-add-menu'), event = key(reopened.children[0], 'Escape'); reopened.onkeydown(event);
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.equal(dialog.open, true); assert.equal(f.document.activeElement, trigger);
});

test('skill manager close API retains dirty form until discard is explicitly confirmed', async () => {
  const f = dom(); Object.assign(f.context, { managerIcons: {}, referenceIcons: {}, appCatalog: [] });
  load('src/features/agent-manager/manager.mjs', f.context);
  const owner = new f.Element('button'); f.document.body.append(owner); owner.focus();
  const manager = await f.context.openManager({ initialCreate: true, getSkills: async () => [], getCustom: () => [] });
  const dialog = f.document.body.querySelector('.agent-manager'), input = dialog.querySelector('input');
  input.value = 'draft'; const pending = manager.close();
  const confirmation = f.document.body.querySelector('.manager-confirm');
  assert.equal(dialog.open, true); assert.ok(confirmation);await manager.close();assert.equal(f.document.body.querySelectorAll('.manager-confirm').length, 1);
  const event = key(confirmation, 'Escape'); confirmation.onkeydown(event); await pending;
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.equal(dialog.open, true); assert.equal(input.value, 'draft');
  const second = manager.close(), discard = f.document.body.querySelector('.manager-confirm').querySelector('.manager-danger');
  discard.onclick(); await second; await Promise.resolve(); await Promise.resolve();
  assert.equal(dialog.isConnected, false); assert.equal(f.document.activeElement, owner);
});


test('artifact drawer Escape consumes only its own layer and pending selection cannot reopen a preview after close', async () => {
  const f = dom(); let release, previews = 0;
  Object.assign(f.context, { basename: value => value, label: file => file.title, primary: () => true, createLayout: () => ({ update() {}, reset() {}, destroy() {}, mode() {} }), openHtmlPreview() { previews++; }, brainstormPath: 'brainstorm' });
  load('src/features/agent-artifacts/panel.mjs', f.context);
  const store = { list: async () => [], get: () => new Promise(resolve => release = resolve), subscribe: () => () => {} };
  const control = f.context.createPanel({ store }), trigger = control.createTrigger(); f.document.body.append(trigger); control.open(); await Promise.resolve();
  const panel = f.document.body.querySelector('.agent-artifact-panel'), button = panel.querySelector('button'); button.focus();
  const event = key(button, 'Escape'); panel.onkeydown(event);
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.equal(panel.inert, true); assert.equal(f.document.activeElement, trigger);
  control.open(); const pending = control.select('old.html'); control.close({ immediate: true }); control.open();
  release({ content_type: 'html', content: 'old' }); await pending;
  assert.equal(previews, 0); assert.ok(f.document.body.querySelector('.agent-artifact-panel'));
  control.destroy();
});


test('model info Escape restores its row without reopening info or closing the model menu', () => {
  const f = dom(); const metrics = { speed: 3, intelligence: 3, cost: 3 };
  Object.assign(f.context, { models: [{ id: 'auto', label: 'Auto', description: '', capabilities: metrics }, { id: 'high', label: 'High', description: 'Detail', group: 'recommended', capabilities: metrics }], localStorage: { getItem: () => null }, hasStartedSession: () => false, sessionModelId: (_, id) => id, readThinking: () => null, thinkingSummary: () => '', getThinkingSpec: () => null, chevron: '', lock: '', createHoverIntent: () => ({ destroy() {}, request() {} }), cancelAnimationFrame() {}, ResizeObserver: class { observe() {} disconnect() {} }, createThinkingControl: () => ({ element: new f.Element('div'), destroy() {} }) });
  load('src/features/agent-composer/models.mjs', f.context);
  const { element: trigger } = f.context.createControl({}); f.document.body.append(trigger); trigger.onclick();
  const menu = f.document.body.querySelector('.agent-model-menu'), row = menu.querySelector('[data-model=high]'); row.focus();
  const info = f.document.body.querySelector('.agent-model-info'), event = key(info, 'Escape'); info.onkeydown(event);
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.equal(info.isConnected, false);
  assert.equal(f.document.body.querySelector('.agent-model-info'), null); assert.equal(menu.inert, undefined); assert.equal(trigger.attrs['aria-expanded'], 'true'); assert.equal(f.document.activeElement, row);
  const next = key(row, 'Escape'); menu.onkeydown(next);
  assert.equal(menu.inert, true); assert.equal(trigger.attrs['aria-expanded'], 'false'); assert.equal(f.document.activeElement, trigger);
});
