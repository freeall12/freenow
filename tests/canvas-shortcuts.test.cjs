const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const navigation = require('../canvas-navigation.js');
const modules = Promise.all([
  import('../src/features/canvas-shortcuts/scope.mjs'),
  import('../src/features/canvas-shortcuts/voice-hold.mjs'),
  import('../src/features/agent-composer/shortcuts.mjs'),
]);
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
function fixture() {
  const handlers = new Map(), timers = new Map(); let now = 0, sequence = 0;
  class Element {
    constructor(tag = 'div', cls = '') {this.tagName = tag; this.className = cls; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.clientWidth = 1000; this.clientHeight = 800;
      this.classList = {add: value => {this.className += ' ' + value;}, remove: value => {this.className = this.className.split(' ').filter(v => v !== value).join(' ');}, contains: value => this.className.split(' ').includes(value)};}
    matches(selector) {
      return selector.split(',').some(part => {
        const s = part.trim(), visible = s.endsWith(':not([hidden])'), value = s.replace(/:not\(\[hidden\]\)$/, '');
        if (visible && this.hidden) return false;
        if (value.startsWith('#')) return this.id === value.slice(1);
        if (value.startsWith('.')) return this.className.split(' ').includes(value.slice(1));
        if (value === 'dialog[open]') return this.tagName === 'dialog' && this.open;
        const attr = value.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        if (attr) return attr[2] === undefined ? this.attrs[attr[1]] !== undefined : this.attrs[attr[1]] === attr[2];
        return this.tagName === value;
      });
    }
    closest(selector) {for (let n = this; n; n = n.parentNode) if (n.matches(selector)) return n; return null;}
    contains(target) {return this === target || this.children.some(child => child.contains(target));}
    append(...items) {for (const item of items) {item.parentNode = this; this.children.push(item);}}
    before(item) {item.parentNode = this.parentNode; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, item);}
    remove() {if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;}
    querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    setAttribute(key, value) {this.attrs[key] = String(value);} getAttribute(key) {return this.attrs[key];}
    get isConnected() {return this === doc.body || !!this.parentNode?.isConnected;}
    focus() {doc.activeElement = this;} setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}
    getContext() {return {scale() {}, fillRect() {}};}
    getBoundingClientRect() {return {left: 20, top: 30};} setPointerCapture() {}
    addEventListener(name, handler) {handlers.set(this.tagName + ':' + name, handler);}
  }
  const doc = {visibilityState: 'visible', createElement: tag => new Element(tag),
    addEventListener(name, handler) {const values = handlers.get(name) || []; values.push(handler); handlers.set(name, values);},
    removeEventListener(name, handler) {handlers.set(name, (handlers.get(name) || []).filter(value => value !== handler));},
    dispatchEvent() {}, querySelector: selector => doc.body.querySelector(selector), querySelectorAll: selector => doc.body.querySelectorAll(selector)};
  doc.body = new Element('body'); doc.documentElement = new Element('html');
  const canvas = new Element('main'); canvas.id = 'canvas'; const child = new Element('span'); canvas.append(child); doc.body.append(canvas); canvas.focus();
  const host = {setTimeout(fn, delay) {const id = ++sequence; timers.set(id, {at: now + delay, fn}); return id;}, clearTimeout(id) {timers.delete(id);},
    addEventListener: (name, handler) => doc.addEventListener('window:' + name, handler), removeEventListener: (name, handler) => doc.removeEventListener('window:' + name, handler)};
  const event = (key, patch = {}) => ({key, code: key === ' ' ? 'Space' : '', target: doc.activeElement, defaultPrevented: false,
    preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, stopImmediatePropagation() {this.immediate = true;}, ...patch});
  const dispatch = (name, e = {}) => {for (const handler of handlers.get(name) || []) {handler(e); if (e.immediate) break;} return e;};
  const advance = async ms => {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();} await settle();};
  return {doc, host, canvas, child, Element, handlers, timers, event, dispatch, advance};
}

function appFixture() {
  const f = fixture(), actions = [], chosen = new Set(['a', 'b']), source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const start = source.indexOf("  document.addEventListener('keydown',e=>{", source.indexOf("let canvasKeyboardScope"));
  const end = source.indexOf("  $('#zoom').addEventListener", start);
  const wheelStart = source.indexOf("  canvas.addEventListener('wheel',e=>{");
  const wheelEnd = source.indexOf("  function applyGesture(", wheelStart);
  const context = {document: f.doc, window: {...f.host, CanvasClipboard: require('../canvas-clipboard.js'), CanvasNavigation: navigation,
    CanvasApp: {stack: ids => actions.push(['stack', ...ids])}, CanvasMenus: {}, CanvasConnections: {}},
    canvas: f.canvas, canvasKeyboardScope: 'canvas', selected: chosen, nodes: [], view: {x: 20, y: -10, scale: .5}, navigator: {userAgent: 'Mac'},
    $: () => ({hidden: true}), $$: selector => f.doc.querySelectorAll(selector), space: false,
    notify: text => actions.push(['notice', text]), undo: redo => actions.push(['undo', !!redo]), search: () => actions.push(['search']),
    render() {}, resetView() {}, removeSelected: () => actions.push(['delete']), animateView: view => actions.push(['zoom', view]),
    closeMenu() {}, cancelViewportAnimation() {}, scheduleRender() {}, flushRender() {}, flushGesture() {},
    gestureQueue: {clear() {}}, finish() {}, gesture: null, rightContext: null, snap: false, suppressContext: false};
  vm.createContext(context); vm.runInContext(source.slice(start, end), context); vm.runInContext(source.slice(wheelStart, wheelEnd), context);
  return {...f, actions, context};
}

test('actual canvas handler stacks once and yields to inputs, IME, modifiers, tools and overlays', () => {
  const f = appFixture(); f.dispatch('keydown', f.event('g', {metaKey: true}));
  assert.deepEqual(f.actions, [['stack', 'a', 'b']]);
  for (const patch of [{repeat: true}, {shiftKey: true}, {altKey: true}, {isComposing: true}, {keyCode: 229}, {defaultPrevented: true}]) f.dispatch('keydown', f.event('g', {metaKey: true, ...patch}));
  assert.equal(f.actions.length, 1);
  const input = new f.Element('input'); f.canvas.append(input); input.focus(); f.dispatch('keydown', f.event('g', {ctrlKey: true})); assert.equal(f.actions.length, 1);
  f.canvas.focus(); const panel = new f.Element('section'); panel.setAttribute('role', 'dialog'); f.doc.body.append(panel);
  f.dispatch('keydown', f.event('g', {metaKey: true})); assert.equal(f.actions.length, 1);
  panel.remove(); f.dispatch('keydown', f.event('g', {ctrlKey: true})); assert.equal(f.actions.length, 2);
});

test('actual canvas search/history/delete/zoom remain connected and Space pan clears on release, blur and hiding', () => {
  const f = appFixture();
  for (const [key, patch] of [['f', {metaKey: true}], ['z', {ctrlKey: true}], ['z', {metaKey: true, shiftKey: true}], ['Delete', {}], ['+', {metaKey: true}], ['-', {ctrlKey: true}]]) f.dispatch('keydown', f.event(key, patch));
  assert.deepEqual(f.actions.slice(0, 4), [['search'], ['undo', false], ['undo', true], ['delete']]); assert.equal(f.actions.filter(v => v[0] === 'zoom').length, 2);
  for (const end of ['keyup', 'window:blur', 'visibilitychange']) {
    f.dispatch('keydown', f.event(' ', {metaKey: true})); assert.equal(f.context.space, true);
    f.handlers.get('main:pointerdown')(f.event('', {button: 0, clientX: 50, clientY: 60, pointerId: 1})); assert.equal(f.context.gesture.mode, 'pan');
    f.doc.visibilityState = end === 'visibilitychange' ? 'hidden' : 'visible'; f.dispatch(end, f.event(' '));
    assert.equal(f.context.space, false); assert.equal(f.canvas.classList.contains('space'), false);
  }
});

test('actual wheel handler anchors Command zoom, preserves trackpad pan/pinch and yields to a modal', () => {
  const f = appFixture(), wheel = f.handlers.get('main:wheel'), initial = {...f.context.view};
  wheel(f.event('', {metaKey: true, deltaY: -10, deltaX: 0, deltaMode: 0, clientX: 320, clientY: 230}));
  const zoom = f.context.view; assert.ok(zoom.scale > initial.scale);
  assert.ok(Math.abs((300 - zoom.x) / zoom.scale - (300 - initial.x) / initial.scale) < 1e-8);
  f.context.view = {...initial}; wheel(f.event('', {deltaX: 10, deltaY: 20, deltaMode: 0}));
  assert.equal(f.context.view.x, 8); assert.equal(f.context.view.y, -34); assert.equal(f.context.view.scale, .5);
  const pinch = navigation.wheel(initial, {ctrlKey: true, deltaY: -10, deltaMode: 0}, {x: 300, y: 200}); assert.equal(pinch.scale, zoom.scale);
  const panel = new f.Element('section'); panel.setAttribute('role', 'dialog'); f.doc.body.append(panel);
  const before = {...f.context.view}, e = f.event('', {metaKey: true, deltaY: -10}); wheel(e);
  assert.deepEqual({...f.context.view}, before); assert.equal(e.defaultPrevented, false);
});

test('Agent J actual installer and Focus I actual handler respect ownership and 229/repeat guards', async () => {
  const [scope, , agent] = await modules, f = fixture(), calls = [];
  agent.installAgentShortcut(() => calls.push('agent'), f.doc);
  f.dispatch('keydown', f.event('j', {metaKey: true})); assert.deepEqual(calls, ['agent']);
  const source = fs.readFileSync(require.resolve('../src/features/focus-edit/entry.mjs'), 'utf8');
  const start = source.indexOf("document.addEventListener('keydown', event => {");
  const end = source.indexOf("document.addEventListener('keyup'", start);
  const context = {document: f.doc, canvasOwned: scope.canvasOwned, session: null, space: false,
    app: {getState: () => ({selected: ['image']}), notify: text => calls.push(text)}, toggle: id => calls.push(id), finish: () => calls.push('finish')};
  vm.runInNewContext(source.slice(start, end), context);
  f.dispatch('keydown', f.event('i', {ctrlKey: true})); assert.deepEqual(calls, ['agent', 'image']);
  for (const key of ['i', 'j']) for (const patch of [{keyCode: 229}, {isComposing: true}, {repeat: true}, {altKey: true}, {shiftKey: true}, {defaultPrevented: true}]) f.dispatch('keydown', f.event(key, {metaKey: true, ...patch}));
  const input = new f.Element('input'); f.canvas.append(input); input.focus();
  for (const key of ['i', 'j']) f.dispatch('keydown', f.event(key, {metaKey: true}));
  f.canvas.focus(); const dialog = new f.Element('section'); dialog.setAttribute('role', 'dialog'); f.doc.body.append(dialog);
  for (const key of ['i', 'j']) f.dispatch('keydown', f.event(key, {ctrlKey: true}));
  assert.deepEqual(calls, ['agent', 'image']);
});

test('500ms V hold starts once, release keeps recording, second V finishes once, short V and repeat do not start', async () => {
  const [, voice] = await modules, f = fixture(), calls = []; let recording = false;
  voice.installVoiceHold({start: () => {calls.push('start'); recording = true;}, finish: () => {calls.push('finish'); recording = false;}, isRecording: () => recording}, f.doc, f.host);
  f.dispatch('keydown', f.event('v')); await f.advance(499); assert.deepEqual(calls, []);
  f.dispatch('keyup', f.event('v')); await f.advance(10); assert.deepEqual(calls, []);
  f.dispatch('keydown', f.event('v')); f.dispatch('keydown', f.event('v', {repeat: true})); await f.advance(500);
  assert.deepEqual(calls, ['start']); f.dispatch('keyup', f.event('v')); assert.equal(recording, true);
  f.dispatch('keydown', f.event('v')); f.dispatch('keydown', f.event('v', {repeat: true})); await settle();
  assert.deepEqual(calls, ['start', 'finish']);
});

test('V pending holds clear on scope change, composition, modifiers, hiding, blur, pagehide and disposal', async () => {
  const [, voice] = await modules;
  for (const reason of ['focusin', 'pointerdown', 'compositionstart', 'visibilitychange', 'window:blur', 'window:pagehide', 'modifier', 'dispose']) {
    const f = fixture(), calls = [], dispose = voice.installVoiceHold({start: () => calls.push('start'), finish() {}, isRecording: () => false}, f.doc, f.host);
    f.dispatch('keydown', f.event('v'));
    if (reason === 'modifier') f.dispatch('keydown', f.event('Control', {ctrlKey: true}));
    else if (reason === 'dispose') dispose(); else {f.doc.visibilityState = 'hidden'; f.dispatch(reason);}
    await f.advance(600); assert.deepEqual(calls, [], reason); assert.equal(f.timers.size, 0);
  }
  for (const patch of [{keyCode: 229}, {isComposing: true}, {repeat: true}, {metaKey: true}, {ctrlKey: true}, {altKey: true}, {shiftKey: true}, {defaultPrevented: true}]) {
    const f = fixture(), calls = []; voice.installVoiceHold({start: () => calls.push('start'), finish() {}, isRecording: () => false}, f.doc, f.host);
    f.dispatch('keydown', f.event('v', patch)); await f.advance(500); assert.deepEqual(calls, []);
  }
});

test('V cannot start from text or tool focus and aborts a late async launch when context leaves', async () => {
  const [, voice] = await modules, f = fixture(), calls = []; let launch, resolve;
  const gate = new Promise(done => {resolve = done;});
  voice.installVoiceHold({async start(options) {launch = options; await gate; if (options.isCurrent()) calls.push('record');}, finish() {}, isRecording: () => false}, f.doc, f.host);
  const input = new f.Element('textarea'); f.canvas.append(input); input.focus(); f.dispatch('keydown', f.event('v')); await f.advance(500); assert.equal(launch, undefined);
  f.canvas.focus(); f.dispatch('keydown', f.event('v')); await f.advance(500); assert.equal(launch.signal.aborted, false);
  f.dispatch('window:blur'); assert.equal(launch.signal.aborted, true); resolve(); await settle(); assert.deepEqual(calls, []);
});

function voiceUIFixture({pending = false} = {}) {
  const f = fixture(), reads = [], stops = [], writes = [], pendingStarts = []; let resolveStart;
  class Recorder {
    constructor(options) {this.options = options; this.state = 'preparing'; reads.push(this);}
    async start() {if (pending) await new Promise(done => {resolveStart = done; pendingStarts.push(done);}); if (this.state === 'cancelled') return false; this.state = 'recording'; this.options.onState('recording'); return true;}
    async stop() {stops.push('stop'); this.state = 'stopping'; return {blob: new Blob(['synthetic audio']), durationMs: 1000};}
    cancel() {this.state = 'cancelled';}
  }
  const target = new f.Element('textarea'), trigger = new f.Element('button'), mount = new f.Element('footer');
  target.value = 'hello '; target.selectionStart = target.selectionEnd = 6; mount.append(trigger); f.doc.body.append(target, mount);
  const core = require('../voice-core.js'), host = {...f.host, VoiceCore: {...core, Recorder}, UI_ICONS: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../voice-input.js'), 'utf8'), {window: host, document: f.doc, MutationObserver: class {observe() {} disconnect() {}}, Event, AbortController, Blob, URL,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, devicePixelRatio: 1, getSelection: () => ({rangeCount: 0})});
  const controller = new AbortController(), provider = {transcribe: async () => ({text: 'voice'})};
  host.VoiceInput.bind(trigger, {target, mount, signal: controller.signal, getValue: () => target.value, setValue: value => {target.value = value; writes.push(value);}, transcriptionProvider: provider});
  return {...f, host, target, trigger, reads, stops, writes, controller, resolveStart: index => index === undefined ? resolveStart() : pendingStarts[index]()};
}

test('real VoiceInput finish uses a synthetic Recorder/provider and inserts once without microphone/network', async () => {
  const f = voiceUIFixture(); assert.equal(await f.trigger.onclick(), true); assert.equal(f.host.VoiceInput.recording, true);
  await f.host.VoiceInput.finish(); assert.equal(f.host.VoiceInput.recording, false);
  assert.deepEqual(f.stops, ['stop']); assert.deepEqual(f.writes, ['hello voice']);
  await f.host.VoiceInput.finish(); assert.equal(f.stops.length, 1);
});

test('real VoiceInput abort cleans pending preparation and cannot commit a late Recorder start', async () => {
  const f = voiceUIFixture({pending: true}), start = f.trigger.onclick(); f.controller.abort(); f.resolveStart();
  assert.equal(await start, false); assert.equal(f.host.VoiceInput.recording, false); assert.equal(f.trigger.hidden, false);
  assert.equal(f.doc.body.querySelector('.voice-control'), null); assert.deepEqual(f.writes, []);
});

test('real VoiceInput cancelled shortcut attempt leaves the same mouse trigger usable without rebinding', async () => {
  const f = voiceUIFixture({pending: true}), first = f.trigger.onclick();
  f.controller.abort(); assert.equal(f.trigger.hidden, false);
  const second = f.trigger.onclick({type: 'click'});
  assert.equal(f.reads.length, 2); assert.equal(f.trigger.hidden, true);
  // A late resolution from the cancelled attempt cannot clean up the new one.
  f.resolveStart(0); assert.equal(await first, false);
  assert.equal(f.trigger.hidden, true); assert.notEqual(f.doc.body.querySelector('.voice-control'), null);
  f.resolveStart(1); assert.equal(await second, true); assert.equal(f.host.VoiceInput.recording, true);
  await f.host.VoiceInput.finish(); assert.deepEqual(f.stops, ['stop']); assert.deepEqual(f.writes, ['hello voice']);
  assert.equal(f.host.VoiceInput.recording, false); assert.equal(f.trigger.hidden, false);
});
