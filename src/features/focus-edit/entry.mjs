import {icons} from './icons.mjs';
import {canvasOwned} from '../canvas-shortcuts/scope.mjs';
import {token, splitPrompt, replaceMark, detections, point} from './model.mjs';
import {paintPrompt, readPrompt, bindPrompt} from './prompt.mjs';
import {previewTooltips} from '../world-node/preview-tooltips.mjs';
import {createReturnControl} from './return-control.mjs';
export {paintPrompt, readPrompt, bindPrompt};
const app = window.CanvasApp;
const el = (tag, cls, text) => {const result = document.createElement(tag); result.className = cls || ''; if (text !== undefined) result.textContent = text; return result;};
const css = el('link'); css.rel = 'stylesheet'; css.href = new URL('./styles.css', import.meta.url); document.head.append(css);
let session = null, menu = null, drawing = false, space = false;
const get = id => app.getState().nodes.find(node => node.id === id);
const config = id => {const node = get(id); return node && window.NodeEditor.getConfig(node);};
const currentPrompt = id => config(id)?.prompt || '';
const image = node => node?.fullImage || node?.image;
const busy = id => !!get(id)?.pendingOperation || window.GenerationAPI.getJobs().some(job => job.request.nodeId === id && job.request.kind !== 'image.recognize' && (['queued', 'running'].includes(job.status) || job.applying));
function closeMenu() {menu?.remove(); menu = null;}
function write(id, prompt) {if (get(id)) window.NodeEditor.setConfig(id, {prompt});}
function remove(mark) {
  const active = session; if (!active) return;
  active.revision++; active.marks.delete(mark.id); if (mark.jobId) window.GenerationAPI.cancel(mark.jobId);
  write(active.source, replaceMark(currentPrompt(active.source), mark.id, null)); draw();
}
function selection(mark, index) {
  const item = mark.items[index]; if (!item || !session) return;
  mark.index = index; session.revision++; closeMenu();
  write(session.source, replaceMark(currentPrompt(session.source), mark.id, {...item, _markId: mark.id, nodeId: mark.target})); draw();
}
function choices(mark, button) {
  closeMenu(); menu = el('div', 'focus-candidates'); menu.setAttribute('role', 'menu'); menu.ariaLabel = '识别候选元素';
  mark.items.forEach((item, index) => {
    const option = el('button', '', item.label_name); option.type = 'button'; option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(index === mark.index));
    option.onclick = () => selection(mark, index); menu.append(option);
  });
  const rect = button.getBoundingClientRect(); document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, rect.left)) + 'px';
  menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.bottom + 5)) + 'px';
  menu.onkeydown = event => {if (event.key === 'Escape') {event.stopPropagation(); closeMenu(); button.focus();} else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {event.preventDefault(); const rows = [...menu.children], at = rows.indexOf(document.activeElement); rows[(at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();}};
  menu.children[mark.index]?.focus();
}
function drawMark(mark, root) {
  const wrap = el('div', 'focus-mark'); wrap.dataset.markId = mark.id;
  if (mark.loading) {wrap.classList.add('is-loading'); wrap.style.left = mark.point.x * 100 + '%'; wrap.style.top = mark.point.y * 100 + '%'; wrap.textContent = '识别中…'; root.append(wrap); return;}
  const item = mark.items[mark.index], [top, left, bottom, right] = item.box_2d;
  Object.assign(wrap.style, {top: top * 100 + '%', left: left * 100 + '%', width: (right - left) * 100 + '%', height: (bottom - top) * 100 + '%'});
  const actions = el('div', 'focus-mark-actions'), label = el(mark.items.length > 1 ? 'button' : 'span', 'focus-mark-label');
  label.innerHTML = icons.tag; label.append(el('span', '', item.label_name));
  if (mark.items.length > 1) {label.type = 'button'; label.ariaLabel = '识别元素：' + item.label_name; label.setAttribute('aria-haspopup', 'menu'); label.insertAdjacentHTML('beforeend', icons['chevron-down']); label.onclick = () => choices(mark, label);}
  const removeButton = el('button', 'focus-mark-remove'); removeButton.type = 'button'; removeButton.ariaLabel = '移除元素：' + item.label_name; removeButton.innerHTML = icons.x; removeButton.onclick = () => remove(mark);
  actions.append(label, removeButton); wrap.append(actions); root.append(wrap);
  actions.onpointerdown = event => event.stopPropagation(); actions.ondblclick = event => event.stopPropagation();
}
function draw(event) {
  session?.navigation.update();
  if (event?.detail?.viewportOnly) return;
  if (drawing) return; drawing = true;
  try {
    const active = session;
    if (!active) return;
    if (!get(active.source)) {finish(); return;}
    const prompt = currentPrompt(active.source);
    const promptMarks = new Set(splitPrompt(prompt).filter(part => typeof part !== 'string').map(part => part.mark._markId));
    const busyIds = new Set(window.GenerationAPI.getJobs().filter(job => job.request.kind !== 'image.recognize' && (['queued', 'running'].includes(job.status) || job.applying)).map(job => job.request.nodeId));
    for (const mark of active.marks.values()) if (!promptMarks.has(mark.id)) {active.revision++; active.marks.delete(mark.id); if (mark.jobId) window.GenerationAPI.cancel(mark.jobId);}
    for (const node of app.getState().nodes) {
      const root = app.getNodeElement ? app.getNodeElement(node.id) : document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`); if (!root) continue;
      const existing = root.querySelector(':scope > .focus-overlay');
      const eligible = node.type === 'image' && image(node) && !node.pendingOperation && !busyIds.has(node.id);
      if (node.id !== active.source && !eligible) {existing?.remove();root.classList.add('focus-ineligible'); continue;}
      root.classList.remove('focus-ineligible');
      if (existing?.dataset.revision === String(active.revision)) continue;
      existing?.remove();
      const overlay = el('div', 'focus-overlay'); overlay.dataset.revision = String(active.revision); root.append(overlay);
      if (node.id === active.source) {
        const exit = el('button', 'focus-source-exit'); exit.type = 'button'; exit.ariaLabel = '退出焦点编辑'; exit.append(el('kbd', '', 'ESC'), document.createTextNode(' 退出模式')); let start;
        exit.onpointerdown = event => {start = event.button === 0 && !space ? {x: event.clientX, y: event.clientY} : null; if (start) event.stopPropagation();};
        exit.onclick = event => {if (space || event.detail && (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)) return; event.stopPropagation(); finish();}; overlay.append(exit);
      } else {
        const hit = el('button', 'focus-hit'); hit.type = 'button'; hit.ariaLabel = '提取元素：' + node.title; overlay.append(hit);
        let start;
        hit.onpointerdown = event => {if (event.button !== 0 || space) {start = null; return;} event.stopPropagation(); start = {x: event.clientX, y: event.clientY};};
        hit.onclick = event => {if (space) return; event.stopPropagation(); if (event.detail && (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)) return; const rect = hit.getBoundingClientRect(); void identify(node.id, event.detail ? point(rect, event.clientX, event.clientY) : {x: .5, y: .5});};
        hit.ondblclick = event => event.stopPropagation();
      }
      for (const mark of active.marks.values()) if (mark.target === node.id) drawMark(mark, overlay);
    }
  } finally {drawing = false;}
}
async function identify(targetId, position) {
  const active = session, target = get(targetId); if (!active || !target || targetId === active.source) return;
  if (Date.now() - (active.lastClick || 0) < 1000) {app.notify('点击过于频繁，请稍后再试'); return;}
  active.lastClick = Date.now();
  const mark = {id: crypto.randomUUID(), target: targetId, src: image(target), point: position, loading: true, index: 0}; active.marks.set(mark.id, mark); active.revision++;
  write(active.source, currentPrompt(active.source) + ' ' + token({_markId: mark.id, isLoading: true, label_name: '识别中…', nodeId: targetId}) + ' ');
  const valid = () => session === active && active.marks.has(mark.id) && get(active.source) && image(get(targetId)) === mark.src && splitPrompt(currentPrompt(active.source)).some(part => typeof part !== 'string' && part.mark._markId === mark.id);
  const guard = () => {if (!valid()) throw Error('识别目标或编辑会话已变化');};
  const request = {kind: 'image.recognize', label: '焦点编辑识别', nodeId: active.source, inputs: [{type: 'image', url: mark.src}], parameters: {point: position, binding: {sourceNodeId: active.source, targetNodeId: targetId, markId: mark.id}, output: {format: 'json', boxOrder: ['top', 'left', 'bottom', 'right'], coordinates: 'normalized-0-1'}}};
  try {
    const pending = window.GenerationAPI.runInPlace(request, {guard, type: 'text', apply(output) {guard(); mark.items = detections(JSON.parse(output.text)); mark.loading = false; selection(mark, 0); return get(active.source);}});
    mark.jobId = window.GenerationAPI.getJobs().find(job => job.request.parameters?.binding?.markId === mark.id)?.id;
    await pending;
  } catch (error) {
    if (session === active && active.marks.has(mark.id)) {remove(mark); app.notify(error.message);}
  }
  draw();
}
function finish() {
  const active = session; if (!active) return; session = null; closeMenu(); active.banner.remove(); document.body.classList.remove('focus-edit-active');
  // This module owns these decorations; clear them once on exit, including
  // when finish is called from inside draw after the source was removed.
  document.querySelectorAll('.focus-overlay').forEach(node => node.remove());
  document.querySelectorAll('.focus-ineligible').forEach(node => node.classList.remove('focus-ineligible'));
  let prompt = currentPrompt(active.source), settings = config(active.source);
  for (const mark of active.marks.values()) if (mark.loading) {if (mark.jobId) window.GenerationAPI.cancel(mark.jobId); prompt = replaceMark(prompt, mark.id, null);}
  if (settings) {
    const refs = [...settings.refs], bindings = [...(settings.referenceBindings || settings.refs.map(() => null))];
    for (const mark of active.marks.values()) {
      if (mark.loading || !get(mark.target) || image(get(mark.target)) !== mark.src) continue;
      const edges = app.getState().edges;
      if (!edges.some(edge => edge.source === mark.target && edge.target === active.source || edge.source === active.source && edge.target === mark.target)) {
        try {app.connect(mark.target, active.source);} catch (error) {app.notify(error.message); continue;}
      }
      if (!bindings.includes(mark.target)) {refs.push(mark.src); bindings.push(mark.target);}
    }
    window.NodeEditor.setConfig(active.source, {prompt, refs, referenceBindings: bindings});
  }
  draw(); document.dispatchEvent(new Event('focus-edit:change'));
}
export function toggle(id) {
  if (session) {finish(); return;}
  const node = get(id); if (!node || !['image', 'video'].includes(node.type)) {app.notify('请选择一个图片或视频节点'); return;}
  if (busy(id)) {app.notify('请等待当前任务完成'); return;}
  window.ImageHistory?.close(); window.ImageVersions?.close(); window.NodeEditor.closePopover();
  const banner = el('section', 'focus-mode-banner'); banner.ariaLabel = '焦点编辑模式';
  const copy = el('div', 'focus-mode-copy'); copy.append(el('strong', '', '焦点编辑'), el('span', '', '点击其他节点以提取元素'));
  const actions = el('div', 'focus-mode-actions'), navigation = createReturnControl({app, sourceId: id, container: actions, canvas: document.querySelector('#canvas'), layout: node => ({...node, ...window.NodeEditor?.layoutFor?.(node), ...window.ImageHistory?.layoutFor?.(node)})});
  const exit = el('button', '', '退出'); exit.type = 'button'; exit.onclick = finish; actions.append(exit); banner.append(copy, actions); document.body.append(banner);
  const marks = new Map();
  for (const part of splitPrompt(currentPrompt(id))) {
    if (typeof part === 'string' || part.mark.isLoading || !get(part.mark.nodeId)) continue;
    try {const items = detections({items: [part.mark]}); marks.set(part.mark._markId, {id: part.mark._markId, target: part.mark.nodeId, src: image(get(part.mark.nodeId)), items, index: 0, loading: false});} catch {}
  }
  session = {source: id, marks, banner, navigation, revision: 0}; document.body.classList.add('focus-edit-active');
  app.select(id); draw(); document.dispatchEvent(new Event('focus-edit:change'));
}
export function trigger(id) {
  const button = el('button', 'reference-add focus-edit-trigger'); button.type = 'button'; button.ariaLabel = '焦点编辑'; button.dataset.focusTooltip = '焦点编辑'; button.dataset.tooltip = '焦点编辑'; button.innerHTML = icons.cursor; button.setAttribute('aria-pressed', String(session?.source === id)); button.onclick = () => toggle(id); return button;
}
export function active() {return !!session;}
document.addEventListener('canvas:render', draw);
document.addEventListener('pointerdown', event => {if (!event.target.closest('.focus-candidates,.focus-mark-actions')) closeMenu();});
document.addEventListener('keydown', event => {
  if (!canvasOwned(event, document, {allowFocus: true})) return;
  if (event.code === 'Space' && !event.altKey && !event.shiftKey) space = true;
  if (session && event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); finish();}
  else if (!session && !event.repeat && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {event.preventDefault(); event.stopImmediatePropagation(); const selected = app.getState().selected; if (selected.length !== 1) app.notify('请选择一个图片或视频节点'); else toggle(selected[0]);}
}, true);
document.addEventListener('keyup', event => {if(event.code==='Space')space=false;});
window.addEventListener('blur',()=>{space=false;});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')space=false;});
window.addEventListener('resize',()=>session?.navigation.update());
previewTooltips(document.body, {selector: '[data-focus-tooltip]', className: 'image-panorama-tooltip'});

window.FocusEdit = {active, toggle};
// Generation jobs are session-only. A reload cannot resume a recognition spinner.
for (const node of app.getState().nodes) {
  const prompt = node.generation?.prompt; if (!prompt?.includes('{{magic_item:')) continue;
  const clean = splitPrompt(prompt).map(part => typeof part === 'string' ? part : part.mark.isLoading ? '' : part.token).join('');
  if (clean !== prompt) window.NodeEditor.setConfig(node.id, {prompt: clean});
}
