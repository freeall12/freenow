import entries from './catalog.mjs';

const $ = selector => document.querySelector(selector);
const categories = ['全部', ...new Set(entries.map(entry => entry.group))];
const kinds = ['全部', '可直接复用', '逻辑模块', '需画布宿主'];
let category = '全部', kind = '全部';

function button(label, active, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = label;
  element.setAttribute('aria-pressed', String(active));
  element.addEventListener('click', action);
  return element;
}

function renderControls() {
  $('#categories').replaceChildren(...categories.map(value => button(value, category === value, () => { category = value; render(); })));
  $('#kind-filters').replaceChildren(...kinds.map(value => button(value, kind === value, () => { kind = value; render(); })));
}

function card(entry, index) {
  const article = document.createElement('article'); article.className = 'component-card';
  const top = document.createElement('div'); top.className = 'card-top';
  const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
  const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = entry.kind;
  top.append(number, badge);
  const title = document.createElement('h3'); title.textContent = entry.name;
  const summary = document.createElement('p'); summary.textContent = entry.detail;
  const meta = document.createElement('div'); meta.className = 'card-meta';
  const group = document.createElement('span'); group.textContent = entry.group;
  const api = document.createElement('code'); api.textContent = entry.api;
  meta.append(group, api);
  const details = document.createElement('details');
  const toggle = document.createElement('summary'); toggle.textContent = '来源与接入';
  const body = document.createElement('div'); body.className = 'card-detail';
  const path = document.createElement('code'); path.textContent = entry.entry;
  const files = document.createElement('div'); files.className = 'files';
  for (const file of [entry.entry, ...entry.files]) {
    const link = document.createElement(file.startsWith('server/') ? 'span' : 'a');
    if (link.tagName === 'A') link.href = '../' + file;
    link.textContent = file; files.append(link);
  }
  body.append(path, files); details.append(toggle, body);
  article.append(top, title, summary, meta, details);
  return article;
}

function render() {
  renderControls();
  const query = $('#catalog-search').value.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => (category === '全部' || entry.group === category) &&
    (kind === '全部' || entry.kind === kind) &&
    (!query || [entry.name, entry.detail, entry.api, entry.entry, ...entry.files].join(' ').toLocaleLowerCase().includes(query)));
  $('#cards').replaceChildren(...filtered.map(card));
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '没有匹配的组件'; $('#cards').append(empty);
  }
  $('#visible-count').textContent = `${filtered.length} / ${entries.length}`;
}

$('#total-count').textContent = entries.length;
$('#direct-count').textContent = entries.filter(entry => entry.kind === '可直接复用').length;
$('#logic-count').textContent = entries.filter(entry => entry.kind === '逻辑模块').length;
$('#catalog-search').addEventListener('input', render);

const status = $('#demo-status');
const menu = window.ReplicaUI.createMenu({ element: $('#preview-menu'), label: '演示操作', onError: error => { status.textContent = error.message; } });
window.ReplicaUI.createTooltip({ root: $('.demo-surface'), selector: 'button[data-tip]' });
$('#menu-trigger').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  menu.show(rect.left, rect.bottom + 8, [
    { label: '新建节点', key: 'N', run: () => { status.textContent = '已触发：新建节点'; } },
    { label: '复制', key: '⌘ C', run: () => { status.textContent = '已触发：复制'; } },
    null,
    { label: '待配置的操作' }
  ]);
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#preview-menu,#menu-trigger')) menu.close(); });
render();
