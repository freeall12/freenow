const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function dom() {
  const handlers = new Map();
  const document = {activeElement: null, addEventListener(name, fn) {const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list);},removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(handler=>handler!==fn));}};
  class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.className = ''; this.isConnected = true; this.offsetWidth = 220; this.offsetHeight = 180;
      this.listeners = new Map(); this.dataset = {}; this.classList = {toggle() {}, add() {}, remove() {}, contains: name => this.className.split(' ').includes(name)};}
    setAttribute(key, value) {this.attributes[key] = String(value);} getAttribute(key) {return this.attributes[key];} removeAttribute(key) {delete this.attributes[key];}
    append(...children) {for (const child of children) {child.parent = this; child.isConnected = this.isConnected; this.children.push(child);}}
    prepend(...children) {for (const child of children.reverse()) {child.parent = this; this.children.unshift(child);}}
    replaceChildren(...children) {for (const child of this.children) child.disconnect(); this.children = []; this.append(...children);}
    disconnect() {this.isConnected = false; this.children.forEach(child => child.disconnect());}
    contains(target) {return target === this || this.children.some(child => child.contains(target));}
    matches(selector) {if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1)); if (selector.startsWith('#')) return this.id === selector.slice(1); if (selector.startsWith('[')){const match=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);return !!match&&(match[2]===undefined?this.attributes[match[1]]!==undefined:this.attributes[match[1]]===match[2]);} return this.tagName === selector;}
    closest(selector) {for (let current = this; current; current = current.parent) if (selector.split(',').some(value => current.matches(value))) return current; return null;}
    querySelectorAll(selector) {const result = []; const visit = item => {for (const child of item.children) {if (child.matches(selector)) result.push(child); visit(child);}}; visit(this); return result;}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    scrollIntoView() {} select() {} blur() {this.onblur?.();}
    remove(){this.disconnect();if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(handler=>handler!==fn));}
    getBoundingClientRect() {return {left: 100, top: 450, bottom: 480, width: 100};}
    setCustomValidity() {} focus() {document.activeElement = this; document.fire('focusin', {target: this});}
    addEventListener(name, fn) {const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list);}
    fire(name, event) {for (const fn of this.listeners.get(name) || []) {fn(event); if (event.immediate) return;} this['on' + name]?.(event);}
  }
  document.body = new Element('body'); document.createElement = tag => new Element(tag);
  document.querySelector = selector => selector === '#canvas' ? {getBoundingClientRect: () => ({left: 0, top: 0, right: 1000, width: 1000})} : document.body.querySelector(selector);
  document.fire = (name, event) => {for (const fn of handlers.get(name) || []) {fn(event); if (event.immediate) break;}};
  const key = (target, key = 'Escape', extra = {}) => {const event = {key, target, ...extra, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, stopImmediatePropagation() {this.stopped = this.immediate = true;}}; for (let current = target; current; current = current.parent) {current.fire('keydown', event); if (event.stopped) break;} if (!event.stopped) document.fire('keydown', event); return event;};
  return {document, Element, key};
}

function nodeFixture(project = 'canvas', imageMenusReady) {
  const f = dom(), stored = new Map([['tapnow-node-settings', JSON.stringify({shared: {prompt: 'default-only', model: 'Legacy default model'}})], ['tapnow-node-settings:project:A', JSON.stringify({shared: {prompt: 'project A only', model: 'Legacy A model'}})]]), writes = [];
  const n = {id: 'shared', type: 'video', x: 100, y: 100, width: 435, height: 250};
  const state = {nodes: [n], selected: [], edges: [], view: {x: 0, y: 0, scale: 1}};
  const window = {CanvasApp: {getState: () => state, updateNode(id, patch) {Object.assign(n, patch);}}, UI_ICONS: {}, EDITOR_DATA: {nodes: {}}, GenerationAPI: {getJobs: () => [], subscribe() {}}, addEventListener() {}};
  if(imageMenusReady)window.imageMenusReady=imageMenusReady;
  if (project !== null) window.CanvasProjects = {storageKey: key => project === 'canvas' ? key : key + ':project:' + project};
  const localStorage = {getItem: key => stored.get(key) || null, setItem(key, value) {stored.set(key, value); writes.push(key);}};
  let source = fs.readFileSync(require.resolve('../node-editor.js'), 'utf8');
  source = source.replace(/import\([^)]*\)/g, '(new Promise(()=>{}))').replace('window.NodeEditor={', 'window.__menus={panel,pop,modelMenu,countMenu,qualityMenu,imageMenu,showPopover,closePopover,setNode(n){node=n;activeId=n.id;config=structuredClone(getConfig(n));panel.hidden=false;},save};window.NodeEditor={');
  if(imageMenusReady)source=source.replace(/const imageMenusReady=[^\n]+/, 'const imageMenusReady=window.imageMenusReady;');
  vm.runInNewContext(source, {window, document: f.document, localStorage, structuredClone, requestAnimationFrame() {}, innerWidth: 1000, innerHeight: 800});
  window.__menus.setNode(n);
  return {...f, window, stored, writes, n, menus: window.__menus};
}

test('node popovers toggle on the same legacy video trigger; Escape belongs to popup and restores focus', () => {
  const f = nodeFixture(), trigger = new f.Element('button'); f.menus.panel.append(trigger);
  for (const open of [f.menus.modelMenu, f.menus.countMenu, f.menus.qualityMenu]) {
    open(trigger); assert.equal(f.menus.pop.hidden, false); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    open(trigger); assert.equal(f.menus.pop.hidden, true); assert.equal(f.document.activeElement, trigger);
  }
  f.menus.modelMenu(trigger); f.menus.pop.focus();
  const event = f.key(f.menus.pop); assert.equal(event.defaultPrevented, true); assert.equal(event.immediate, true);
  assert.equal(f.menus.pop.hidden, true); assert.equal(f.document.activeElement, trigger); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('inner Escape wins first, unrelated/IME keys do not close node menu, and focus/outside dismiss without stealing focus', () => {
  const f = nodeFixture(), trigger = new f.Element('button'); f.menus.panel.append(trigger); f.menus.showPopover(trigger);
  const duration = new f.Element('input'); f.menus.pop.append(duration);
  duration.onkeydown = event => {event.preventDefault(); event.stopPropagation();};
  f.key(duration); assert.equal(f.menus.pop.hidden, false);
  f.key(f.menus.pop, 'Escape', {isComposing: true}); f.key(f.menus.pop, 'Escape', {keyCode: 229}); assert.equal(f.menus.pop.hidden, false);
  const dialogField = new f.Element('input'); f.document.body.append(dialogField);
  assert.equal(f.key(dialogField).defaultPrevented, undefined); assert.equal(f.menus.pop.hidden, false);
  dialogField.focus(); assert.equal(f.menus.pop.hidden, true); assert.equal(f.document.activeElement, dialogField);
  f.menus.showPopover(trigger); const prompt = new f.Element('textarea'); f.menus.panel.append(prompt);
  const focusedBeforeOutside=f.document.activeElement;f.document.fire('pointerdown', {target: prompt}); assert.equal(f.menus.pop.hidden, true); assert.equal(f.document.activeElement, focusedBeforeOutside);
});

test('node draft reads and writes use project identity while default and API-less hosts preserve legacy storage', () => {
  for (const project of ['canvas', 'A', 'B', null]) {
    const f = nodeFixture(project), config = f.window.NodeEditor.getConfig(f.n);
    assert.equal(config.prompt, project === 'A' ? 'project A only' : project === 'B' ? '' : 'default-only');
    const before = f.stored.get('tapnow-node-settings'); f.menus.save();
    assert.equal(f.writes.at(-1), project === 'A' || project === 'B' ? 'tapnow-node-settings:project:' + project : 'tapnow-node-settings');
    if (project === 'A' || project === 'B') assert.equal(f.stored.get('tapnow-node-settings'), before);
  }
});

test('leaving an asynchronously loading generation menu invalidates its late open without taking new focus', async () => {
  let resolve; const ready = new Promise(done => {resolve = done;});
  const f = nodeFixture('canvas', ready), trigger = new f.Element('button'), external = new f.Element('input');
  f.menus.panel.append(trigger); f.document.body.append(external); trigger.focus();
  const pending = f.menus.imageMenu('model', trigger); external.focus();
  resolve({renderModels() {throw Error('Late menu must not render');}}); await pending;
  assert.equal(f.menus.pop.hidden, true); assert.equal(f.document.activeElement, external);
});

function textFixture() {
  const f = dom(), core = require('../canvas-text.js');
  const n = {id: 'text', type: 'text', title: 'Text', textMode: 'generate', x: 10, y: 10, width: 300, height: 250, generation: {prompt: '写脚本', model: 'gemini-3.1-flash-lite', count: 1}};
  const state = {nodes: [n], selected: ['text'], edges: [], view: {x: 0, y: 0, scale: 1}};
  const window = {CanvasText: core, CanvasApp: {getState: () => state, updateNode(id, patch) {Object.assign(n, patch); f.document.fire('canvas:render', {});}}, UI_ICONS: {}, TEXT_MODEL_ICONS: {}, VoiceInput: {bind() {}}, CanvasTextUI: {}, GenerationAPI: {getJobs: () => [], subscribe() {}}, addEventListener() {}};
  const source = fs.readFileSync(require.resolve('../text-generation-ui.js'), 'utf8').replace(/import\([^)]*\)/g, '(new Promise(()=>{}))');
  vm.runInNewContext(source, {window, document: f.document, innerWidth: 1000, innerHeight: 800});
  return {...f, window, state, panel: f.document.body.children[0], pop: f.document.body.children[1]};
}

test('text menu toggles and selection returns focus to the rebuilt trigger; outside and Escape do not leak', () => {
  const f = textFixture();
  const trigger = () => f.panel.querySelectorAll('button').find(button => button.getAttribute('aria-label') === '生成数量');
  trigger().onclick({currentTarget: trigger()}); assert.equal(f.pop.hidden, false);
  trigger().onclick({currentTarget: trigger()}); assert.equal(f.pop.hidden, true); assert.equal(f.document.activeElement, trigger());
  trigger().onclick({currentTarget: trigger()}); f.pop.children[1].onclick();
  assert.equal(f.pop.hidden, true); assert.equal(f.document.activeElement, trigger()); assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  trigger().onclick({currentTarget: trigger()}); const ime = f.key(f.pop.children[0], 'Escape', {isComposing: true}); assert.equal(ime.defaultPrevented, undefined); assert.equal(f.pop.hidden, false);
  f.key(f.pop.children[0]); assert.equal(f.pop.hidden, true); assert.equal(f.document.activeElement, trigger());
  trigger().onclick({currentTarget: trigger()}); const prompt = f.panel.querySelector('textarea'); prompt.focus(); assert.equal(f.pop.hidden, true); assert.equal(f.document.activeElement, prompt);
  trigger().onclick({currentTarget: trigger()}); f.state.selected = []; f.document.fire('canvas:render', {}); assert.equal(f.pop.hidden, true); assert.equal(f.panel.hidden, true);
});

test('slash menu preserves clicks inside rich prompt descendants and relinquishes unrelated focus and IME Escape', () => {
  const f = dom(), panel = new f.Element('section'), prompt = new f.Element('div'), span = new f.Element('span');
  prompt.append(span); panel.append(prompt); f.document.body.append(panel); panel.hidden = false;
  const commands = [{id: 'one', title: 'Command', description: 'Test command', icon: ''}], context = {document: f.document, commands};
  const source = fs.readFileSync(require.resolve('../src/features/prompt-shortcuts/menu.mjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function el(')).replace('export function bindMenu', 'function bindMenu'), context);
  const controller = context.bindMenu({panel, prompt, getState: () => ({busy: false, referenceCount: 1}), onSelect() {}}), menu = panel.children[1];
  prompt.innerText = '/'; prompt.fire('input', {}); assert.equal(menu.hidden, false);
  f.document.fire('pointerdown', {target: span}); assert.equal(menu.hidden, false);
  f.key(prompt, 'Escape', {keyCode: 229}); assert.equal(menu.hidden, false);
  const event = f.key(prompt); assert.equal(menu.hidden, true); assert.equal(event.defaultPrevented, true);
  prompt.fire('input', {}); const field = new f.Element('input'); f.document.body.append(field); field.focus();
  assert.equal(menu.hidden, true); assert.equal(f.document.activeElement, field);
  controller.destroy(); assert.equal(menu.isConnected, false); assert.equal((prompt.listeners.get('keydown') || []).length, 0);
});

test('closed or rebuilt video specifications cannot commit stale duration on a late blur', () => {
  const f = dom(), pop = new f.Element('section'), changes = [];
  f.document.body.append(pop);
  const data = settings => ({settings: {duration: 5, mode: '首尾帧', ...settings}, model: {id: 'seedance-2.5'}, hint: '模式说明',
    modeOptions: [{label: '首尾帧'}, {label: '全能参考'}], options: {durations: [5, 10], aspectRatios: [], resolutions: []}});
  const context = {document: f.document, configuration: data, ratioIcon() {}, requestAnimationFrame() {}, innerWidth: 1000, innerHeight: 800, ResizeObserver: class {observe() {} disconnect() {}}};
  const source = fs.readFileSync(require.resolve('../src/features/video-generation/menus.mjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const el=')).replaceAll('export ', ''), context);
  const cleanup = context.renderSpecifications(pop, {duration: 5}, () => [], settings => {changes.push(settings); return settings;});
  const input = pop.querySelector('input'); input.value = '9'; cleanup(); input.onblur(); assert.equal(changes.length, 0);
  const nextCleanup = context.renderSpecifications(pop, {duration: 5}, () => [], settings => {changes.push(settings); return settings;});
  const hint = pop.querySelector('.video-mode-hint');
  f.key(hint, 'Enter'); assert.equal(f.key(hint).defaultPrevented, true); assert.equal(f.key(hint).defaultPrevented, undefined);
  const focusedInput = pop.querySelector('input'); focusedInput.value = '9'; f.key(focusedInput);
  assert.equal(focusedInput.value, '5'); assert.equal(f.document.activeElement, pop); focusedInput.onblur(); assert.equal(changes.length, 0);
  const oldInput = pop.querySelector('input'); oldInput.value = '9';
  const switchMode = pop.querySelectorAll('button').find(button => button.textContent === '全能参考'); switchMode.onclick();
  assert.equal(changes.length, 1); oldInput.onblur(); assert.equal(changes.length, 1); nextCleanup();
});

test('reference preview consumes only its active Escape layer and returns portal focus to the source chip', () => {
  const f = dom(), track = new f.Element('div'), chip = new f.Element('button');
  chip.className = 'reference-chip'; chip.dataset.referenceIndex = '0'; track.append(chip); f.document.body.append(track);
  const context = {document: f.document, window: {addEventListener() {}, removeEventListener() {}}, crypto: {randomUUID: () => 'test-preview'},
    innerWidth: 1000, clearTimeout() {}, setTimeout() {}, audioPreview() {throw Error('No audio expected');}};
  const source = fs.readFileSync(require.resolve('../src/features/node-composer/reference-preview.mjs'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('export function')).replace('export ', ''), context);
  const controller = context.referencePreviews(track, [{type: 'text', text: 'Actual reference', title: 'reference'}]);
  const plain = f.key(chip); assert.equal(plain.defaultPrevented, undefined);
  track.fire('pointerover', {target: chip}); const preview = f.document.body.children.at(-1); assert.equal(preview.hidden, false);
  f.key(chip, 'Escape', {isComposing: true}); assert.equal(preview.hidden, false);
  preview.focus(); const escape = f.key(preview); assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
  assert.equal(f.document.activeElement, chip); assert.equal(preview.isConnected, false);
  assert.equal(f.key(chip).defaultPrevented, undefined); controller.destroy();
  const editor = new f.Element('div'), mention = new f.Element('span');editor.setAttribute('contenteditable','true');mention.setAttribute('contenteditable','false');mention.className='composer-mention';mention.dataset.referenceIndex='0';editor.append(mention);f.document.body.append(editor);
  const second = context.referencePreviews(editor,[{type:'text',text:'Reference',title:'reference'}],{selector:'.composer-mention'});editor.fire('pointerover',{target:mention});const mentionPreview=f.document.body.children.at(-1);mentionPreview.focus();f.key(mentionPreview);assert.equal(f.document.activeElement,editor);second.destroy();
});

test('canvas search indexes only the active project generation drafts', () => {
  const source = fs.readFileSync(require.resolve('../src/features/canvas-search/ui.js'), 'utf8');
  const functionText = source.slice(source.indexOf(' function configs('), source.indexOf('\n', source.indexOf(' function configs(')));
  for (const project of ['canvas', 'A', 'B']) {
    const seen = [], key = project === 'canvas' ? 'tapnow-node-settings' : 'tapnow-node-settings:project:' + project;
    const context = {window: {CanvasProjects: {storageKey: base => project === 'canvas' ? base : base + ':project:' + project}, EDITOR_DATA: {nodes: {base: {prompt: 'reference'}}}},
      localStorage: {getItem(readKey) {seen.push(readKey); return JSON.stringify({shared: {prompt: project + ' draft'}});}}};
    vm.runInNewContext(functionText, context); const configs = context.configs();
    assert.equal(seen[0], key); assert.equal(configs.shared.prompt, project + ' draft'); assert.equal(configs.base.prompt, 'reference');
  }
});
