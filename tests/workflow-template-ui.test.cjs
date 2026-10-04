const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
const canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const entry = import('../src/features/workflow-templates/entry.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = (id, name) => ({id, name, createdAt: '2026-04-21T12:30:20.819823Z', image: 'assets/ref.png', description: '真实工作流说明', tags: ['workflow'], graph: {version: 1, nodes: [{id: 'source-' + id, type: 'image', title: 'Reference', image: 'assets/ref.png', x: 40, y: 40, width: 250, height: 250}], edges: [], width: 330, height: 330}});
function fixture() {
  const dom = new JSDOM('<body><button id="trigger">浏览全部</button><div id="canvas"></div></body>', {url: 'http://local.test'}), {window} = dom;
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.HTMLMediaElement.prototype.pause = function() {};
  const guards = [], notifications = [], applied = [];
  let project = 'a';
  window.CanvasProjects = {id: () => project, registerNavigationGuard: fn => { guards.push(fn); return () => guards.splice(guards.indexOf(fn), 1); }};
  const app = {getState: () => ({nodes: [], edges: [], selected: [], view: {x: 0, y: 0, scale: 1}}), notify: text => notifications.push(text)};
  const previousWindow = global.window, previousDocument = global.document; global.window = window; global.document = window.document;
  return {window, document: window.document, app, guards, notifications, applied, setProject: value => project = value, close() { global.window = previousWindow; global.document = previousDocument; window.close(); }};
}
test('drawer card cover/title apply and overlay preview never bubbles into application', async () => {
  const {createCard} = await entry, f = fixture();
  try {
    let applications = 0, previews = 0;
    const card = createCard(item('one', 'Tech Product Ad'), {document: f.document, onApply: () => applications++, onPreview: () => previews++}); f.document.body.append(card);
    card.querySelector('.workflow-template-card-title').click(); card.querySelector('.workflow-template-card-cover').click();
    card.querySelector('[aria-label="查看 Tech Product Ad"]').click(); assert.equal(applications, 2); assert.equal(previews, 1);
    card.querySelector('.workflow-template-card-actions [aria-label="应用 Tech Product Ad"]').click(); assert.equal(applications, 3);
    assert.equal(card.querySelector('button button'), null);
  } finally { f.close(); }
});
test('gallery search, selection, detail back, personal scope, close focus and stale project are functional', async () => {
  const {openGallery} = await entry, f = fixture();
  try {
    const trigger = f.document.querySelector('#trigger'); trigger.focus();
    const gallery = openGallery({items: [item('one', 'Tech Product Ad'), item('two', 'Riding Flight POV')], app: f.app, document: f.document, templateAPI: {ready: Promise.resolve(), list: () => [item('mine', '我的保存')], use: async id => f.applied.push(id)}, returnFocus: trigger});
    const search = gallery.element.querySelector('input'); search.value = 'riding'; search.dispatchEvent(new f.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    assert.equal(gallery.element.querySelectorAll('.workflow-template-gallery-grid .template-card').length, 1);
    gallery.element.querySelector('.workflow-template-card-title').click(); assert.equal(gallery.element.querySelector('.workflow-template-detail-copy h3').textContent, 'Riding Flight POV');
    assert.equal(gallery.element.querySelector('time').textContent, new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).format(new Date('2026-04-21T12:30:20.819823Z')));
    assert.equal(gallery.element.querySelector('time').dateTime, '2026-04-21T12:30:20.819Z');
    assert.equal(gallery.element.querySelector('.workflow-template-detail-tags').textContent, '工作流');
    gallery.element.querySelector('[aria-label="返回模板列表"]').click(); assert.equal(gallery.element.querySelector('.workflow-template-detail'), null);
    Array.from(gallery.element.querySelectorAll('nav button')).find(node => node.textContent === '我的模板').click();
    gallery.element.querySelector('.workflow-template-card-title').click(); f.setProject('b'); gallery.element.querySelector('.workflow-template-detail-apply').click(); await tick();
    assert.equal(f.applied.length, 0); assert.match(f.notifications[0], /画布已切换/);
    gallery.element.querySelector('[aria-label="关闭模板预览"]').click(); assert.equal(gallery.element.isConnected, false); assert.equal(f.document.activeElement, trigger); assert.equal(f.guards.length, 0);
  } finally { f.close(); }
});
test('personal gallery application is single-flight and blocks project navigation until completion', async () => {
  const {openGallery} = await entry, f = fixture(); let resolve;
  try {
    let uses = 0; const pending = new Promise(done => resolve = done);
    const local = item('mine', '本地工作流');
    const gallery = openGallery({items: [item('one', 'Official')], selected: local, initialScope: 'mine', app: f.app, document: f.document, templateAPI: {ready: Promise.resolve(), list: () => [local], use: () => { uses++; return pending; }}});
    const use = gallery.element.querySelector('.workflow-template-detail-apply'); use.click(); use.click(); await tick(); assert.equal(uses, 1); assert.match(f.guards[0](), /正在应用/);
    const event = new f.window.Event('cancel', {cancelable: true}); gallery.element.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    resolve(); await tick(); assert.equal(gallery.element.isConnected, false); assert.equal(f.guards.length, 0);
  } finally { f.close(); }
});
test('search blur keeps the clicked preview target alive and explicit search commits the draft', async () => {
  const {openGallery} = await entry, f = fixture();
  try {
    const gallery = openGallery({items: [item('one', 'Tech Product Ad'), item('two', 'Flight')], app: f.app, document: f.document});
    const input = gallery.element.querySelector('input'), preview = gallery.element.querySelector('.workflow-template-card-actions button');
    input.focus(); input.dispatchEvent(new f.window.FocusEvent('blur', {relatedTarget: preview})); assert.equal(preview.isConnected, true);
    input.value = 'draft search'; input.dispatchEvent(new f.window.FocusEvent('blur', {relatedTarget: preview})); assert.equal(preview.isConnected, true);
    preview.click(); assert.equal(gallery.element.querySelector('.workflow-template-detail-copy h3').textContent, 'Tech Product Ad');
    const nextInput = gallery.element.querySelector('input'); nextInput.value = 'flight'; nextInput.dispatchEvent(new f.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    assert.equal(gallery.element.querySelector('.workflow-template-detail'), null); assert.equal(gallery.element.querySelectorAll('.workflow-template-gallery-grid .template-card').length, 1);
    gallery.close();
  } finally { f.close(); }
});
test('closing gallery resolves a rebuilt drawer source card and falls back to its active tab', async () => {
  const {openGallery, createCard} = await entry, f = fixture();
  try {
    const owner = f.document.createElement('aside'); owner.className = 'templates-panel'; const tab = f.document.createElement('button'); tab.className = 'chosen';
    const tabs = f.document.createElement('div'); tabs.className = 'template-tabs'; tabs.append(tab); owner.append(tabs); f.document.body.append(owner);
    const template = item('one', 'Tech Product Ad'); let card = createCard(template, {document: f.document}); owner.append(card);
    let gallery = openGallery({items: [template], app: f.app, document: f.document, returnFocus: card.querySelector('.workflow-template-card-actions button')});
    card.remove(); card = createCard(template, {document: f.document}); owner.append(card); gallery.close();
    assert.equal(f.document.activeElement, card.querySelector('.workflow-template-card-actions button'));
    gallery = openGallery({items: [template], app: f.app, document: f.document, returnFocus: f.document.activeElement}); card.remove(); gallery.close(); assert.equal(f.document.activeElement, tab);
  } finally { f.close(); }
});
test('official category navigation intersects search and retains unclassified history in all', async () => {
  const {openGallery, officialCategories} = await entry, f = fixture();
  try {
    const ads = officialCategories.find(category => category.name === '广告'), film = officialCategories.find(category => category.name === '影视');
    const one = {...item('one', 'Tech Product Ad'), categoryIds: [ads.id]}, two = {...item('two', 'Tech Film'), categoryIds: [film.id]}, old = {...item('old', 'Historical'), categoryIds: ['8296d6d4-a7a0-4bdd-b274-4d050aff4315']};
    const before = structuredClone([one, two, old]);
    const gallery = openGallery({items: [one, two, old], app: f.app, document: f.document});
    assert.equal(gallery.element.querySelectorAll('nav button').length, 11);
    Array.from(gallery.element.querySelectorAll('nav button')).find(node => node.textContent === '广告').click();
    assert.equal(gallery.element.querySelector('h2').textContent, '广告'); assert.equal(gallery.element.querySelectorAll('.template-card').length, 1);
    const search = gallery.element.querySelector('input'); search.value = 'Film'; search.dispatchEvent(new f.window.KeyboardEvent('keydown', {key: 'Enter'}));
    assert.equal(gallery.element.querySelectorAll('.template-card').length, 0);
    Array.from(gallery.element.querySelectorAll('nav button')).find(node => node.textContent === '全部').click();
    assert.equal(gallery.element.querySelectorAll('.template-card').length, 3); assert.deepEqual([one, two, old], before); gallery.close();
  } finally { f.close(); }
});
test('preview retains the clicked source when the browser does not focus buttons', async () => {
  const {openGallery, createCard} = await entry, f = fixture();
  try {
    const template = item('one', 'Tech'); let gallery;
    const card = createCard(template, {document: f.document, onPreview: (selected, source) => { gallery = openGallery({items: [template], selected, app: f.app, document: f.document, returnFocus: source}); }});
    f.document.body.append(card); assert.equal(f.document.activeElement, f.document.body);
    const preview = card.querySelector('.workflow-template-card-actions button'); preview.click(); gallery.close(); assert.equal(f.document.activeElement, preview);
  } finally { f.close(); }
});
test('recent gallery restores persisted public and personal entries on close and reopen', async () => {
  const {openGallery} = await entry, f = fixture();
  try {
    const official = item('shared-id', 'Public Workflow'), personal = item('shared-id', '我的模板');
    let personalUses = 0;
    const api = {ready: Promise.resolve(), recentReady: Promise.resolve(), list: () => [personal], use: async () => { personalUses++; }, listRecent: () => [{id: 'shared-id',kind: 'personal',usedAt: 3},{id: 'shared-id',kind: 'public',usedAt: 2},{id: 'removed',kind: 'personal',usedAt: 1}]};
    for (let attempt = 0; attempt < 2; attempt++) {
      const gallery = openGallery({items: [official],initialScope: 'recent',app: f.app,templateAPI: api,document: f.document}); await tick();
      assert.deepEqual(Array.from(gallery.element.querySelectorAll('.workflow-template-card-title')).map(node => node.textContent), ['我的模板','Public Workflow']);
      gallery.element.querySelector('.workflow-template-card-title').click(); gallery.element.querySelector('.workflow-template-detail-apply').click(); await tick(); assert.equal(personalUses, attempt + 1); gallery.close();
    }
  } finally { f.close(); }
});
test('destroyed or switched personal gallery cannot insert after delayed template readiness', async () => {
  const {openGallery} = await entry;
  for (const mode of ['destroy','project']) {
    const f = fixture(); let release, uses = 0;
    try {
      const ready = new Promise(resolve => release = resolve), local = item('personal','我的模板');
      const gallery = openGallery({items: [],selected: local,initialScope: 'mine',app: f.app,document: f.document,templateAPI: {ready,list:()=>[local],use:async()=>uses++}});
      gallery.element.querySelector('.workflow-template-detail-apply').click();
      if (mode === 'destroy') gallery.destroy(); else f.setProject('another');
      release(); await tick(); assert.equal(uses,0,mode); if (gallery.element.isConnected) gallery.destroy();
    } finally { f.close(); }
  }
});
