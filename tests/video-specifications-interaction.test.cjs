const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ reducedMotion = false, normalizeMode = false } = {}) {
  const frames = [], observers = [], changes = [];
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.listeners = new Map();
      this.classList = { add() {}, toggle() {} }; this.scrollLeft = 0; this.clientWidth = 120; this.scrollWidth = 480;
      this.offsetLeft = 0; this.offsetWidth = 40; this.offsetHeight = 28; this.scrolls = [];
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    replaceChildren() { if (this.contains(document.activeElement)) document.activeElement = document.body; this.children = []; }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    addEventListener(key, listener) { this.listeners.set(key, listener); }
    removeEventListener(key, listener) { if (this.listeners.get(key) === listener) this.listeners.delete(key); }
    scrollTo(options) { this.scrollLeft = options.left; this.scrolls.push(options); this.listeners.get('scroll')?.(); }
    scrollIntoView() { this.revealed = true; }
    select() {}
    remove() {}
  }
  document.createElement = tag => new Element(tag); document.body = new Element('body'); document.activeElement = document.body;
  const pop = new Element('section'); document.body.append(pop);
  const configuration = settings => ({ settings: { mode: '首尾帧', duration: 15, ...settings }, model: { id: 'seedance-2.5' },
    modeOptions: [{ label: '首尾帧' }, { label: '全能参考' }, { label: '视频编辑', disabled: true }],
    options: { durations: Array.from({ length: 12 }, (_, i) => i + 4), aspectRatios: [], resolutions: [] } });
  const context = { document, configuration, ratioIcon() {}, requestAnimationFrame: fn => frames.push(fn),
    matchMedia: () => ({ matches: reducedMotion }), ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    } };
  const source = fs.readFileSync(require.resolve('../src/features/video-generation/menus.mjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const el=')).replaceAll('export ', ''), context);
  const cleanup = context.renderSpecifications(pop, {}, () => [], settings => {
    changes.push(settings); return normalizeMode ? { ...settings, mode: '首尾帧' } : settings;
  });
  const all = (tag, root = pop) => root.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...all(tag, child)]);
  const mode = () => pop.children[0].children[1];
  const duration = () => all('div').find(group => group.children.filter(child => child.tagName === 'button').length === 12);
  const layout = group => group.children.filter(child => child.tagName === 'button').forEach((button, index) => { button.offsetLeft = index * 40; });
  layout(duration());
  const flush = () => { while (frames.length) frames.shift()(); };
  const wheel = (group, deltaY, extra = {}) => {
    const event = { deltaX: 0, deltaY, deltaMode: 0, preventDefault() { this.prevented = true; }, ...extra };
    group.listeners.get('wheel')?.(event); return event;
  };
  return { document, pop, cleanup, changes, mode, duration, flush, wheel, observers, layout };
}

test('changing video method retains the normalized focused option and keyboard traversal', () => {
  for (const normalizeMode of [false, true]) {
    const f = fixture({ normalizeMode }), group = f.mode(), button = group.children[2];
    button.focus(); button.onclick();
    const nextGroup = f.mode(), expected = nextGroup.children[normalizeMode ? 1 : 2];
    assert.notEqual(nextGroup, group); assert.equal(f.document.activeElement, expected);
    assert.equal(expected.attributes['aria-pressed'], 'true'); assert.equal(expected.focusOptions.preventScroll, true);
    const event = { key: 'ArrowRight', preventDefault() { this.prevented = true; } };
    nextGroup.onkeydown(event); assert.equal(event.prevented, true);
    assert.equal(f.document.activeElement, nextGroup.children[normalizeMode ? 2 : 1]);
    assert.equal(group.onkeydown, null); assert.equal(group.listeners.size, 0); f.cleanup();
  }
});

test('a mode update without focus in its button does not steal focus', () => {
  const f = fixture(); f.mode().children[2].onclick();
  assert.equal(f.document.activeElement, f.document.body); f.cleanup();
});

test('duration selection is revealed on opening, selection and resize; manual scrolling remains free', () => {
  const f = fixture(), group = f.duration(); f.flush();
  assert.equal(group.scrollLeft, 360); assert.equal(group.scrolls.at(-1).behavior, 'smooth');
  group.scrollLeft = 100; group.listeners.get('scroll')(); assert.equal(group.scrollLeft, 100);
  const buttons = group.children.filter(child => child.tagName === 'button'); buttons[4].onclick();
  assert.equal(group.scrollLeft, 120); assert.equal(buttons[4].attributes['aria-pressed'], 'true');
  group.clientWidth = 200; f.observers.at(-1).callback(); assert.equal(group.scrollLeft, 80); f.cleanup();
});

test('vertical wheel scrolls horizontally with bounds and reduced motion, while guarded events pass through', () => {
  const f = fixture({ reducedMotion: true }), group = f.duration(); f.flush();
  assert.equal(group.scrolls.at(-1).behavior, 'auto');
  assert.equal(f.wheel(group, -100).prevented, true); assert.equal(group.scrollLeft, 260);
  f.wheel(group, -1000); assert.equal(group.scrollLeft, 0); f.wheel(group, 1000); assert.equal(group.scrollLeft, 360);
  for (const extra of [{ deltaX: 1 }, { deltaY: 49 }, { deltaY: -49 }]) {
    const count = group.scrolls.length; assert.equal(f.wheel(group, 100, extra).prevented, undefined); assert.equal(group.scrolls.length, count);
  }
  assert.equal(f.wheel(group, -1, { deltaMode: 1 }).prevented, true);
  group.scrollWidth = group.clientWidth; assert.equal(f.wheel(group, 100).prevented, undefined); f.cleanup();
});

test('rebuild and disposal release scroll listeners and prevent queued frames from acting', () => {
  const f = fixture(), old = f.duration(); f.mode().children[2].onclick();
  assert.equal(old.listeners.size, 0); assert.equal(old.onkeydown, null);
  const current = f.duration(); f.cleanup(); f.flush();
  assert.equal(current.listeners.size, 0); assert.equal(current.scrolls.length, 0); assert.equal(old.scrolls.length, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
});
