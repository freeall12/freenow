import {models, config, draft, references, prepare, signature} from './model.mjs';
import {icons} from '../canvas-connections/icons.mjs';
import {controls} from './icons.mjs';
import '../image-panorama/entry.mjs';

const app = window.CanvasApp;
const el = (tag, cls, text) => {const node = document.createElement(tag); node.className = cls || ''; if (text !== undefined) node.textContent = text; return node;};
const button = (label, action, icon) => {
  const node = el('button', 'world-button'); node.type = 'button'; node.ariaLabel = label; node.title = label;
  if (icon) node.innerHTML = icon; else node.textContent = label;
  node.onclick = action; return node;
};
const link = el('link'); link.rel = 'stylesheet'; link.href = new URL('styles.css', import.meta.url); document.head.append(link);
const panel = el('section', 'world-generation'); panel.ariaLabel = '3D 生成参数'; panel.hidden = true; document.body.append(panel);
let activeId, panelKey, popover, popoverAnchor, selecting = false, composing = false;
let promptTimer;
const pending = new Set();
const get = id => app.getState().nodes.find(node => node.id === id);
function update(settings) {clearTimeout(promptTimer); const node = get(activeId), input = panel.querySelector('textarea'); if (node) {const next = {...config(node), ...(input ? {prompt: input.value} : {}), ...settings}; if (JSON.stringify(next) !== JSON.stringify(config(node))) app.updateNode(node.id, {worldConfig: next});}}
function closePopover(restore = false) {popover?.remove(); popover = null; popoverAnchor?.setAttribute('aria-expanded', 'false'); if (restore && popoverAnchor?.isConnected) popoverAnchor.focus(); popoverAnchor = null;}
function openPopover(anchor, title, items, width = 280) {
  if (popoverAnchor === anchor) {closePopover(true); return;}
  closePopover(); popoverAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
  popover = el('section', 'world-popover'); popover.ariaLabel = title; popover.setAttribute('role', 'menu');
  popover.style.width = width + 'px';
  if (width !== 280) popover.append(el('h3', '', title));
  for (const item of items) {
    const row = button(item.label, () => {closePopover(); item.run();}); row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', String(item.selected));
    row.replaceChildren();
    if (item.icon) {const image = el('img'); image.src = item.icon; image.alt = ''; row.append(image);}
    const copy = el('span', 'world-option-copy'); copy.append(el('span', '', item.label));
    if (item.detail) copy.append(el('small', '', item.detail)); row.append(copy);
    if (item.selected) {const check = el('span', 'world-check'); check.innerHTML = controls.check; row.append(check);}
    if (item.tip) row.title = item.tip; popover.append(row);
  }
  document.body.append(popover);
  const r = anchor.getBoundingClientRect(), p = popover.getBoundingClientRect();
  popover.style.left = Math.max(12, Math.min(innerWidth - p.width - 12, width === 280 ? r.left : r.left + r.width / 2 - p.width / 2)) + 'px';
  popover.style.top = Math.max(12, r.top - p.height - 8) + 'px';
  popover.querySelector('[aria-checked=true]')?.focus({preventScroll: true});
  popover.onkeydown = event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closePopover(true); return;}
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const rows = [...popover.querySelectorAll('button')], index = rows.indexOf(document.activeElement);
    rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
  };
}

async function generate() {
  if (activeId && panel.querySelector('textarea')) update({});
  const {worldGenerationBusy} = await import('../agent-generation/world.mjs');
  const node = get(activeId); if (!node || pending.has(node.id)) return;
  if (worldGenerationBusy(app, node.id, window.GenerationAPI)) {app.notify('此世界节点已有生成任务，请查询已有任务'); return;}
  const refs = references(node.id, app.getState()), plan = prepare(node, refs);
  if (plan.error) {app.notify(plan.error); return;}
  const expected = signature(node, refs), id = node.id;
  const guard = () => {const current = get(id); if (!current || signature(current, references(id, app.getState())) !== expected) throw Error('3D 节点或参考素材已变化，请重新生成');};
  pending.add(id); panelKey = null; refresh();
  try {
    await window.GenerationAPI.runInPlace(plan.request, {type: 'model', guard, apply: async output => {
      const resource = await import('./resource.mjs');
      const patch = await resource.materialize(output, plan.model.outputType); guard();
      app.updateNode(id, patch);
    }});
  } catch (error) {app.notify(error.message);}
  finally {pending.delete(id); panelKey = null; refresh();}
}

function chooseReference() {
  selecting = !selecting; panelKey = null; refresh();
  app.notify(selecting ? '请选择画布上的图片或视频，Esc 取消' : '已取消选择参考');
}
document.querySelector('#canvas').addEventListener('pointerdown', event => {
  if (!selecting) return;
  const root = event.target.closest('.node'), node = root && get(root.dataset.id);
  if (!node || !['image', 'video'].includes(node.type)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  try {app.connect(node.id, activeId); selecting = false; panelKey = null; refresh();}
  catch (error) {app.notify(error.message);}
}, true);

function build(node, refs, plan) {
  closePopover(); panel.replaceChildren();
  const settings = config(node), busy = pending.has(node.id), referenceRow = el('div', 'world-references');
  const add = button('参考', chooseReference, icons.plus); add.setAttribute('aria-pressed', String(selecting)); referenceRow.append(add);
  for (const ref of refs) {
    const item = el('div', 'world-reference');
    const view = button(ref.title || ref.type, () => {if (ref.type === 'text') {const input = panel.querySelector('textarea'); if (input) {input.setRangeText(ref.text, input.selectionStart, input.selectionEnd, 'end'); update({prompt: input.value});}} else app.preview(get(ref.nodeId));});
    view.textContent = ref.title || ref.type; if (!ref.url && ref.type !== 'text') view.dataset.empty = 'true';
    item.append(view, button('移除参考 ' + (ref.title || ref.type), () => app.removeEdges([ref.edgeId]), window.UI_ICONS.close)); referenceRow.append(item);
  }
  panel.append(referenceRow);
  if (plan.promptDisabled) panel.append(el('p', 'world-prompt-disabled', '该模型暂不支持同时使用参考图片和文本提示生成。'));
  else {
    const input = el('textarea', 'world-prompt'); input.ariaLabel = '3D 提示词'; input.placeholder = plan.model.outputType === 'asset' ? '描述一个 3D 资产...' : '想象一个 3D 世界...'; input.value = settings.prompt; input.disabled = busy;
    input.oncompositionstart = () => {composing = true;}; input.oncompositionend = () => {composing = false;};
    input.onchange = () => update({prompt: input.value});
    input.oninput = () => {clearTimeout(promptTimer); const value = input.value, id = node.id; promptTimer = setTimeout(() => {const current = get(id); if (current && config(current).prompt !== value) app.updateNode(id, {worldConfig: {...config(current), prompt: value}});}, 300); const submit = panel.querySelector('.world-generate'); if (submit) {const plan = prepare({...node, worldConfig: {...settings, prompt: value}}, refs); submit.disabled = busy || !!plan.error; submit.title = plan.error || '生成';}};
    input.onkeydown = event => {if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !composing) {event.preventDefault(); update({prompt: input.value}); void generate();}};
    panel.append(input);
  }
  const footer = el('footer'), select = button(plan.model.label, () => openPopover(select, '选择模型', models.map(model => ({label: model.label, selected: model.id === settings.model, icon: model.icon,
    detail: model.outputType === 'asset' ? '3D 物品 · 网格' : '3D 场景 · 高斯泼溅', run: () => update({model: model.id})}))));
  const logo = el('img'); logo.src = plan.model.icon; logo.alt = ''; select.prepend(logo); select.disabled = busy; footer.append(select);
  if (plan.model.provider === 'tripo') {
    const names = {geometry: '几何', texture: '纹理', pbr: 'PBR'};
    const material = button('3D 资产设置', () => openPopover(material, '材质', Object.entries(names).map(([key, label]) => ({label, selected: key === settings.material,
      tip: key === 'pbr' ? '基于物理的材质，在合适的光照设置下表现更真实。' : '几何只生成网格；纹理添加表面颜色；PBR 提供基于物理的材质。', run: () => update({material: key})})), 320));
    material.textContent = names[settings.material]; material.disabled = busy; footer.append(material);
  } else if (plan.imageCount === 1 && !plan.videoCount) {
    const pano = button('输入图片类型', () => openPopover(pano, '输入图片类型', [{label: '平面图', selected: !settings.isPano, run: () => update({isPano: false})}, {label: '全景图', selected: settings.isPano, run: () => update({isPano: true})}], 260));
    pano.textContent = settings.isPano ? '全景图' : '平面图'; pano.disabled = busy; footer.append(pano);
  }
  const submit = button(busy ? '生成中' : '生成', generate); submit.classList.add('world-generate'); submit.disabled = busy || !!plan.error; submit.title = plan.error || '生成'; footer.append(submit); panel.append(footer);
}

const covers = new WeakMap();
function renderNode(node, root) {
  const previous = covers.get(root);
  // Resource URLs and embedded thumbnails are not cover dependencies. Retain
  // decoded images across graph updates, but recover if another UI replaces DOM.
  if (previous && previous.source === node.image && previous.body.parentNode === root &&
      previous.title.parentNode === root && previous.media.parentNode === previous.body) {
    if (previous.source && previous.media.alt !== node.title) previous.media.alt = node.title;
    return;
  }
  const title = root.querySelector('.node-title'); title.querySelector('svg')?.remove(); title.insertAdjacentHTML('afterbegin', icons.world);
  const body = root.querySelector('.node-body'); body.replaceChildren(); body.classList.add('world-node-cover');
  const media = node.image ? el('img') : el('span', 'world-node-symbol');
  if (node.image) {media.src = node.image; media.alt = node.title; media.draggable = false;}
  else media.innerHTML = icons.world;
  body.append(media); covers.set(root, {source: node.image, title, body, media});
}

function toolbar(picked, bar, state) {
  if (picked.length !== 1 || picked[0].type !== 'world') return false;
  const node = picked[0], key = 'world:' + JSON.stringify([node.id, !!node.worldResource]); bar.hidden = false;
  if (bar.dataset.key !== key) {
    bar.dataset.key = key; bar.replaceChildren();
    if (node.worldResource) bar.append(button('预览', () => preview(node.id)), button('下载', () => download(node.id)));
    else bar.append(button('上传', () => upload(node.id)));
  }
  const center = (node.x + node.width / 2) * state.view.scale + state.view.x;
  bar.style.left = Math.max(12, Math.min(state.canvas.clientWidth - bar.offsetWidth - 12, center - bar.offsetWidth / 2)) + 'px';
  bar.style.top = Math.max(12, node.y * state.view.scale + state.view.y - 61) + 'px'; return true;
}
async function preview(id) {try {const node = get(id); if (!node?.worldResource) return; await (await import('./resource.mjs')).preview(node);} catch (error) {app.notify(error.message);}}
async function download(id) {try {await (await import('./resource.mjs')).download(get(id));} catch (error) {app.notify(error.message);}}
function upload(id) {
  const file = el('input'); file.type = 'file'; file.accept = '.glb';
  file.onchange = async () => {
    if (!file.files[0]) return; const node = get(id), baseline = JSON.stringify(node?.worldResource);
    try {const patch = await (await import('./resource.mjs')).importFile(file.files[0]);
      if (!get(id) || JSON.stringify(get(id).worldResource) !== baseline) throw Error('导入期间节点已删除或资源已变化'); app.updateNode(id, patch);
    } catch (error) {app.notify(error.message);}
  }; file.click();
}

function positionPanel(node, state) {
  if (!node || panel.hidden) return;
  const width = Math.min(620, document.querySelector('#canvas').clientWidth - 24); panel.style.width = width + 'px';
  panel.style.left = Math.max(12, Math.min(document.querySelector('#canvas').clientWidth - width - 12, (node.x + node.width / 2) * state.view.scale + state.view.x - width / 2)) + 'px';
  panel.style.top = Math.max(12, Math.min(innerHeight - panel.offsetHeight - 12, (node.y + node.height) * state.view.scale + state.view.y + 18)) + 'px';
}
function refresh(event) {
  if (event?.detail?.viewportOnly) { if (!panel.hidden) positionPanel(get(activeId), app.getState()); return; }
  const state = app.getState();
  for (const node of state.nodes) if (node.type === 'world') {
    const root = app.getNodeElement(node.id); if (root) renderNode(node, root);
  }
  const node = state.selected.length === 1 ? get(state.selected[0]) : null;
  if (node?.type !== 'world' || document.body.matches('.studio-active,.media-editing')) {panel.hidden = true; activeId = null; selecting = false; panelKey = null; closePopover(); return;}
  activeId = node.id; panel.hidden = selecting;
  const refs = references(node.id, state), plan = prepare(node, refs), {prompt, ...settings} = config(node), key = JSON.stringify([node.id, settings, refs, pending.has(node.id), selecting]);
  if (key !== panelKey) {panelKey = key; build(node, refs, plan);}
  else {const input = panel.querySelector('textarea'); if (input && document.activeElement !== input) input.value = prompt; const submit = panel.querySelector('.world-generate'); if (submit && document.activeElement !== input) {submit.disabled = pending.has(node.id) || !!plan.error; submit.title = plan.error || '生成';}}
  positionPanel(node, state);
}
document.addEventListener('canvas:render', refresh);
document.addEventListener('pointerdown', event => {if (popover && !popover.contains(event.target) && !popoverAnchor?.contains(event.target)) closePopover();});
document.addEventListener('keydown', event => {if (!event.defaultPrevented && !event.isComposing && !document.querySelector('dialog[open]') && event.key === 'Escape' && selecting) {event.stopPropagation(); selecting = false; panelKey = null; refresh();}});
window.addEventListener('resize', () => {closePopover(); refresh();});
window.WorldNode = {draft, render: renderNode, toolbar, preview, upload, async importAt(file, point) {
  const patch = await (await import('./resource.mjs')).importFile(file), node = draft(), scale = app.getState().view.scale;
  return app.addNode('world', {...point, y: point.y - node.height * scale / 2}, null, file.name, {...node, ...patch, title: file.name});
}, create(point) {
  const node = draft(), scale = app.getState().view.scale; return app.addNode('world', {...point, y: point.y - node.height * scale / 2}, null, '3D', node);
}};
app.render();
