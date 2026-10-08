import {el} from './dom.mjs';
import {icon} from './icons.mjs';
import {bindEntityInspectorNumberField} from './entity-inspector.mjs';

const dimensions = [['width', '宽度', 1, 100], ['depth', '深度', 1, 100], ['height', '高度', 2, 20]];
const format = value => String(Math.round(value * 10) / 10);
const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const failed = result => result === false || result?.ok === false;
const rejection = result => Error(result?.message || '修改未被接受，请重试');
const isRoom = source => source?.kind === 'mesh-preset' && source.preset === 'room';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Official am: one octave per 160 pointer pixels / 1200 wheel pixels. */
export function roomScrubValue(start, delta, min, max, kind = 'pointer') {
  if (![start, delta, min, max].every(Number.isFinite) || start <= 0 || min > max) throw new TypeError('房间尺寸必须是有效数值');
  return clamp(start * 2 ** clamp(delta / (kind === 'wheel' ? 1200 : 160), -16, 16), min, max);
}

/** Pure local search; callers supply validated 3D scene metadata. */
export function filterSpaceScenes(scenes, query = '') {
  const text = query.trim().toLowerCase();
  return (Array.isArray(scenes) ? scenes : []).filter(scene => scene && typeof scene.id === 'string' && scene.id && scene.threedMeta &&
    (!text || `${scene.label || '3D 场景'} ${scene.createdAtLabel || ''}`.toLowerCase().includes(text)));
}

function addStyle(document) {
  if (document.querySelector('link[data-studio-v3-space-menu]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('space-menu.css', import.meta.url);
  link.dataset.studioV3SpaceMenu = ''; document.head.append(link);
}

/** Scoped DOM only. The host owns source loading, room history and permissions. */
export function createSpaceMenu({read, setSource, updateRoom, beginRoomEdit, resolveThumbnail, close = () => {}, onError = () => {}} = {}) {
  if ([read, setSource, updateRoom, beginRoomEdit].some(callback => typeof callback !== 'function')) throw new TypeError('场地菜单需要 read、setSource、updateRoom 和 beginRoomEdit');
  const menu = el('section', 'sv3-space-menu'); menu.setAttribute('aria-label', '场地');
  const document = menu.ownerDocument, window = document.defaultView, origin = document.activeElement;
  const thumbnailUrl = resolveThumbnail || (source => window.LocalAssets?.url(source) || Promise.resolve(/^(?:\/|blob:|data:image\/)/.test(source) && !source.startsWith('//') ? source : null));
  addStyle(document);
  let disposed = false, mutationBusy = false, pane = null, paneOrigin = null, gesture = null, wheelTimer = null, sceneKey = null, errorText = '', draftRevision = 0;
  const fields = [], controls = [], removers = [];
  const listen = (node, name, fn, options) => {node.addEventListener(name, fn, options); removers.push(() => node.removeEventListener(name, fn, options));};
  const state = () => read() || {};
  const locked = () => disposed || mutationBusy || !!state().busy;
  const report = error => {if (!disposed) {errorText = error?.message || String(error); errorNode.textContent = errorText; errorNode.hidden = false; try {onError(error);} catch {}}};
  const clearError = () => {errorText = ''; errorNode.textContent = ''; errorNode.hidden = true;};
  const textButton = (label, action, className = 'sv3-space-row') => {
    const node = el('button', className); node.type = 'button'; node.setAttribute('aria-label', label); node.append(el('span', 'sv3-space-label', label));
    node.addEventListener('click', action); controls.push(node); return node;
  };
  const active = (node, value) => {if (value) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');};
  const main = el('div', 'sv3-space-main'); main.append(el('h2', 'sv3-space-heading', '场地'));
  const choices = el('div', 'sv3-space-choices'); main.append(choices);
  const empty = textButton('空白场地', () => void choose({kind: 'empty'})); empty.dataset.spaceSource = 'empty'; choices.append(empty);
  const roomRow = el('div', 'sv3-space-room-row');
  const room = textButton('房间', () => void choose({kind: 'mesh-preset', preset: 'room'})); room.dataset.spaceSource = 'room';
  const settings = textButton('房间 设置', () => togglePane('room', settings), 'sv3-space-settings'); settings.firstChild.textContent = '设置'; settings.insertAdjacentHTML('beforeend', icon('chevronRight', {size: 13, strokeWidth: 1.75}));
  roomRow.append(room, settings); choices.append(roomRow);
  const world = textButton('3D 场景', () => togglePane('world', world)); world.dataset.spaceSource = 'world';
  const detail = el('span', 'sv3-space-detail'); world.append(detail); world.insertAdjacentHTML('beforeend', icon('chevronRight', {size: 15, strokeWidth: 1.75})); choices.append(world);
  const secondary = el('aside', 'sv3-space-secondary'); secondary.hidden = true;
  const heading = el('h2', 'sv3-space-pane-heading'), roomPane = el('section', 'sv3-space-room-pane'), worldPane = el('section', 'sv3-space-world-pane');
  secondary.append(heading, roomPane, worldPane);
  const paneId = `sv3-space-pane-${createSpaceMenu.nextId = (createSpaceMenu.nextId || 0) + 1}`; secondary.id = paneId;
  settings.setAttribute('aria-controls', paneId); world.setAttribute('aria-controls', paneId);
  const errorNode = el('div', 'sv3-space-error'); errorNode.setAttribute('role', 'alert'); errorNode.hidden = true;
  menu.append(main, secondary, errorNode);

  const cancelDrafts = () => {
    draftRevision++; let changed = false;
    for (const field of fields) if (field.dirty) {field.dirty = false; field.binding.cancel(); field.binding.refresh(); changed = true;}
    return changed;
  };
  const focus = node => {if (node?.isConnected && !disposed) node.focus({preventScroll: true});};
  const dismiss = () => {menu.dispose(); close(); if (origin?.isConnected) origin.focus({preventScroll: true});};
  function closePane() {
    cancelDrafts(); for (const field of fields) stopEditing(field); pane = null; secondary.hidden = true;
    settings.setAttribute('aria-expanded', 'false'); world.setAttribute('aria-expanded', 'false'); menu.dataset.pane = ''; focus(paneOrigin); refresh();
  }
  function togglePane(next, anchor) {
    if (locked() || gesture) return;
    if (pane === next) {closePane(); return;}
    cancelDrafts(); for (const field of fields) stopEditing(field); pane = next; paneOrigin = anchor; secondary.hidden = false;
    roomPane.hidden = next !== 'room'; worldPane.hidden = next !== 'world'; heading.textContent = next === 'room' ? '房间设置' : '选择画布生成的 3D 场景';
    secondary.setAttribute('aria-label', heading.textContent); menu.dataset.pane = next; refresh();
    focus(secondary.querySelector('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden])'));
  }
  async function perform(callback, reportFailure = true) {
    if (locked() || gesture) return {ok: false, message: '请等待当前修改完成'};
    mutationBusy = true; refresh();
    try {const result = await callback(); if (result?.ok !== true) throw rejection(result); clearError(); return result;}
    catch (error) {if (reportFailure) report(error); return {ok: false, message: error.message};}
    finally {mutationBusy = false; refresh();}
  }
  async function choose(source) {
    if (locked() || gesture) return;
    cancelDrafts();
    if (JSON.stringify(state().source) === JSON.stringify(source)) {dismiss(); return;}
    const result = await perform(() => setSource(source)); if (!disposed && result?.ok === true) dismiss();
  }
  function stopEditing(field) {field.editing = false; field.input.hidden = true; field.trigger.hidden = false;}
  function edit(field) {
    if (locked() || gesture) return;
    field.editing = true; field.input.hidden = false; field.trigger.hidden = true; field.binding.refresh(); focus(field.input); field.input.select();
  }
  function refresh() {
    if (disposed) return;
    const snapshot = state(), source = snapshot.source, selectedRoom = isRoom(source), busy = locked();
    menu.setAttribute('aria-busy', String(busy || !!gesture));
    if (pane === 'room' && !selectedRoom) {void endGesture('cancel'); closePane(); return;}
    active(empty, source?.kind === 'empty'); active(room, selectedRoom); active(world, ['world-asset', 'history-world'].includes(source?.kind));
    roomRow.dataset.active = String(selectedRoom); roomRow.dataset.expanded = String(pane === 'room');
    settings.hidden = !selectedRoom; settings.setAttribute('aria-expanded', String(pane === 'room')); world.setAttribute('aria-expanded', String(pane === 'world'));
    detail.textContent = source?.kind === 'world-asset' ? '原始场景' : source?.kind === 'history-world' ? source.label?.trim() || '3D 场景' : '';
    for (const node of controls) node.disabled = busy || !!gesture;
    for (const field of fields) {
      field.input.disabled = busy || !!gesture; field.trigger.disabled = (busy && !gesture) || !!gesture && gesture.field !== field;
      field.binding.refresh(); field.trigger.firstChild.textContent = format(snapshot.roomConfig?.[field.key]);
      field.trigger.setAttribute('aria-label', `${field.label}: ${format(snapshot.roomConfig?.[field.key])}m`);
    }
    const guides = snapshot.roomConfig?.trackingGuides || {};
    guideToggle.setAttribute('aria-checked', String(!!guides.enabled)); guideOptions.hidden = !guides.enabled;
    markerRow.hidden = guides.mode === 'white'; markerToggle.setAttribute('aria-checked', String(!!guides.lineMarkers));
    for (const option of modeButtons) option.setAttribute('aria-pressed', String(option.dataset.value === guides.mode));
    for (const option of spacingButtons) option.setAttribute('aria-pressed', String(Number(option.dataset.value) === guides.spacingMeters));
    const key = JSON.stringify([snapshot.scenes || [], snapshot.hasOriginal, snapshot.loading, snapshot.error, snapshot.source]);
    if (key !== sceneKey) {sceneKey = key; renderScenes();}
    for (const node of sceneList.querySelectorAll('button')) node.disabled = busy || !!gesture;
    errorNode.hidden = !errorText;
  }

  function createDimension([key, label, min, max]) {
    const row = el('div', 'sv3-space-number-row'), labelNode = el('span', 'sv3-space-number-label', label), value = el('span', 'sv3-space-number-value');
    const input = el('input'); input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.spellcheck = false; input.hidden = true; input.setAttribute('aria-label', label); input.dataset.roomDimension = key;
    const trigger = textButton(label, () => {if (!field.suppressClick) edit(field);}, 'sv3-space-number-trigger'); trigger.firstChild.textContent = '';
    const unit = el('span', 'sv3-space-unit', 'm'); value.append(trigger, input, unit); row.append(labelNode, value); roomPane.append(row);
    const field = {key, label, min, max, input, trigger, value, dirty: false, editing: false, suppressClick: false}; fields.push(field);
    listen(input, 'input', () => {if (!field.binding?.pending) {field.dirty = true; field.text = input.value;}}, true);
    const prepare = () => {
      if (!field.dirty || field.binding?.pending) return;
      const text = input.value.trim().replace(/m$/i, '').trim();
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text) && text !== input.value) {input.value = text; input.dispatchEvent(new window.Event('input', {bubbles: true}));}
    };
    listen(input, 'blur', prepare, true); listen(input, 'change', prepare, true);
    field.binding = bindEntityInspectorNumberField(input, {
      read: () => state().roomConfig[key], format: () => format(state().roomConfig[key]),
      validate: number => {if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test((field.text || '').trim())) throw Error('请输入有效数值'); return clamp(number, min, max);}, commit: number => perform(() => updateRoom({[key]: number}), false),
      close: () => {}, onAccepted: () => {field.dirty = false; stopEditing(field); clearError(); focus(trigger); refresh();},
      onError: error => {
        report(error); const revision = draftRevision, text = field.text;
        queueMicrotask(() => {if (disposed || revision !== draftRevision || !field.editing) return; input.value = text ?? ''; field.dirty = true; input.dispatchEvent(new window.Event('input', {bubbles: true}));});
      }
    });
    listen(input, 'keydown', event => {
      if (ime(event)) return;
      if (event.key === 'Enter') prepare();
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); menu.handleEscape();}
    }, true);
    listen(input, 'blur', () => {if (!field.dirty && !field.binding.pending) stopEditing(field);});
    for (const target of [trigger, labelNode]) listen(target, 'pointerdown', event => startPointer(event, field));
    listen(value, 'wheel', event => startWheel(event, field), {passive: false});
  }

  // Lease ownership survives async begin. Late acquisition after cancel is rolled back.
  function createGesture(field, kind) {
    const token = {field, kind, start: state().roomConfig[field.key], target: state().roomConfig[field.key], changed: false, ended: false, finish: null, queue: Promise.resolve(), lease: null};
    gesture = token;
    token.ready = Promise.resolve().then(() => beginRoomEdit()).then(lease => {
      if (!lease || ['onMove', 'onEnd', 'onCancel'].some(key => typeof lease[key] !== 'function')) throw Error('当前无法编辑房间尺寸');
      token.lease = lease; return lease;
    }).catch(error => {if (!token.ended) report(error); return null;});
    refresh(); return token;
  }
  function moveGesture(token, number) {
    if (token.ended || number === token.target) return;
    token.target = number; token.changed = true;
    token.queue = token.queue.then(async () => {
      const lease = await token.ready; if (!lease || token.finish === 'cancel') return;
      const result = await lease.onMove({[token.field.key]: number}); if (failed(result)) throw rejection(result);
      if (!disposed) {token.field.trigger.firstChild.textContent = format(token.target); refresh();}
    }).catch(error => {token.finish = 'cancel'; report(error); if (!token.ended) void endGesture('cancel', token);});
  }
  function endGesture(kind, token = gesture) {
    if (!token || token.ended) return Promise.resolve();
    token.ended = true; token.finish = kind; window.clearTimeout(wheelTimer); wheelTimer = null;
    removePointer();
    return token.queue.then(async () => {
      const lease = await token.ready; if (!lease) return;
      const commit = kind === 'commit' && token.changed && token.finish !== 'cancel';
      if (!commit) {const result = await lease.onCancel(); if (failed(result)) throw rejection(result); return;}
      try {const result = await lease.onEnd(); if (failed(result)) throw rejection(result);}
      catch (error) {await lease.onCancel(); throw error;}
      if (!disposed) clearError();
    }).catch(report).finally(() => {
      if (gesture === token) gesture = null;
      token.field.suppressClick = true; window.setTimeout(() => {token.field.suppressClick = false;}, 0);
      if (!disposed) {for (const field of fields) field.binding.refresh(); refresh();}
    });
  }
  let pointerRemovers = [];
  function removePointer() {for (const remove of pointerRemovers) remove(); pointerRemovers = [];}
  function startPointer(event, field) {
    event.stopPropagation(); if (event.button !== 0 || event.isPrimary === false || locked() || gesture) return;
    const pointerId = event.pointerId, startX = event.clientX; let token = null;
    const move = next => {
      if (next.pointerId !== pointerId) return; const delta = next.clientX - startX;
      if (!token) {if (Math.abs(delta) <= 3 || locked()) return; token = createGesture(field, 'pointer'); field.suppressClick = true;}
      next.preventDefault(); next.stopPropagation(); moveGesture(token, roomScrubValue(token.start, delta, field.min, field.max));
    };
    const end = (next, kind) => {if (next.pointerId !== pointerId) return; next.stopPropagation(); if (token) void endGesture(kind, token); else removePointer();};
    for (const [name, fn] of [['pointermove', move], ['pointerup', next => end(next, 'commit')], ['pointercancel', next => end(next, 'cancel')]]) {
      window.addEventListener(name, fn, true); pointerRemovers.push(() => window.removeEventListener(name, fn, true));
    }
  }
  function startWheel(event, field) {
    if (event.ctrlKey || locked() && !gesture || gesture && (gesture.kind !== 'wheel' || gesture.field !== field) || field.editing) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX * scale : -event.deltaY * scale;
    if (!delta) return; event.preventDefault(); event.stopPropagation();
    const token = gesture || createGesture(field, 'wheel'); moveGesture(token, roomScrubValue(token.target, delta, field.min, field.max, 'wheel'));
    window.clearTimeout(wheelTimer); wheelTimer = window.setTimeout(() => void endGesture('commit', token), 200);
  }
  for (const dimension of dimensions) createDimension(dimension);
  const guideSection = el('div', 'sv3-space-guides'); roomPane.append(guideSection);
  const toggle = (label, tooltip, field) => {
    const row = el('div', 'sv3-space-toggle-row'), labelNode = el('span', '', label); labelNode.title = tooltip;
    const node = textButton(label, () => void perform(() => updateRoom({trackingGuides: {[field]: node.getAttribute('aria-checked') !== 'true'}})), 'sv3-space-switch');
    node.textContent = ''; node.setAttribute('role', 'switch'); row.append(labelNode, node); return {row, node};
  };
  const {row: guideRow, node: guideToggle} = toggle('参考图案', '显示便于判断房间尺度和边界的参考图案。', 'enabled'); guideSection.append(guideRow);
  const guideOptions = el('div', 'sv3-space-guide-options'); guideSection.append(guideOptions);
  const segments = (label, tooltip, items, field) => {
    const group = el('div', 'sv3-space-segment-group'), labelNode = el('span', 'sv3-space-segment-label', label); labelNode.title = tooltip;
    const bar = el('div', 'sv3-space-segments'); bar.style.gridTemplateColumns = `repeat(${items.length},minmax(0,1fr))`;
    const buttons = items.map(([value, text]) => {
      const node = textButton(text, () => void perform(() => updateRoom({trackingGuides: {[field]: field === 'spacingMeters' ? Number(value) : value}})), 'sv3-space-segment');
      node.dataset.value = value; node.setAttribute('aria-label', `${label} ${text}`); bar.append(node); return node;
    }); group.append(labelNode, bar); guideOptions.append(group); return buttons;
  };
  const modeButtons = segments('样式', '调整房间边界的显示强度。', [['white', '全白'], ['standard', '标准'], ['calibration', '校准']], 'mode');
  const {row: markerRow, node: markerToggle} = toggle('线标注', '显示彩色房间边缘和网格线。', 'lineMarkers'); guideOptions.append(markerRow);
  const spacingButtons = segments('间距', '重复参考线之间的距离。', [['0.25', '0.25m'], ['0.5', '0.5m'], ['1', '1m'], ['2', '2m']], 'spacingMeters');

  const original = textButton('原始场景', () => void choose({kind: 'world-asset'})); original.dataset.spaceSource = 'original'; worldPane.append(original);
  const searchBox = el('div', 'sv3-space-search'); searchBox.insertAdjacentHTML('beforeend', icon('search', {size: 14, strokeWidth: 1.75}));
  const search = el('input'); search.type = 'search'; search.placeholder = '搜索场景'; search.setAttribute('aria-label', '搜索场景'); search.autocomplete = 'off'; search.spellcheck = false; searchBox.append(search); worldPane.append(searchBox);
  const sceneList = el('div', 'sv3-space-scene-list'); worldPane.append(sceneList);
  listen(search, 'input', renderScenes);
  function renderScenes() {
    if (disposed) return;
    const snapshot = state(), all = filterSpaceScenes(snapshot.scenes), matches = filterSpaceScenes(all, search.value);
    original.hidden = !snapshot.hasOriginal; active(original, snapshot.source?.kind === 'world-asset'); searchBox.hidden = !all.length;
    sceneList.replaceChildren();
    for (const scene of matches) {
      const node = el('button', 'sv3-space-scene'); node.type = 'button'; node.setAttribute('aria-label', scene.label?.trim() || '3D 场景'); node.dataset.sceneId = scene.id;
      active(node, snapshot.source?.kind === 'history-world' && snapshot.source.historyAssetId === scene.id); node.disabled = locked() || !!gesture;
      if (scene.thumbnailSrc) {
        const image = el('img', 'sv3-space-thumbnail'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false; node.append(image);
        const identity = sceneKey;
        Promise.resolve().then(() => thumbnailUrl(scene.thumbnailSrc)).then(url => {
          // Only trusted local URLs reach img; no remote fetch or stale attachment.
          if (!disposed && identity === sceneKey && sceneList.contains(node) && typeof url === 'string' && /^(?:\/|blob:|data:image\/)/.test(url) && !url.startsWith('//')) image.src = url;
        }).catch(() => {});
      }
      else {const placeholder = el('span', 'sv3-space-thumbnail'); placeholder.insertAdjacentHTML('beforeend', icon('object', {size: 15, strokeWidth: 1.75})); node.append(placeholder);}
      const labels = el('span', 'sv3-space-scene-labels'); labels.append(el('span', 'sv3-space-scene-title', scene.label?.trim() || '3D 场景'));
      if (scene.createdAtLabel) labels.append(el('span', 'sv3-space-created', scene.createdAtLabel)); node.append(labels);
      node.addEventListener('click', () => void choose({kind: 'history-world', historyAssetId: scene.id, label: scene.label?.trim() || '3D 场景', ...(scene.thumbnailSrc ? {thumbnailSrc: scene.thumbnailSrc} : {}), threedMeta: structuredClone(scene.threedMeta)})); sceneList.append(node);
    }
    if (snapshot.error) {const node = el('div', 'sv3-space-list-message', typeof snapshot.error === 'string' ? snapshot.error : snapshot.error.message || '场景加载失败'); node.setAttribute('role', 'alert'); sceneList.append(node);}
    else if (!snapshot.loading && !matches.length) sceneList.append(el('div', 'sv3-space-list-message', search.value.trim() ? '没有匹配的场景' : '暂无生成场景'));
    if (snapshot.loading) sceneList.append(el('div', 'sv3-space-list-message', '正在加载场景…'));
  }
  menu.handleEscape = () => {
    if (disposed) return false;
    if (gesture) {void endGesture('cancel'); return true;}
    if (cancelDrafts()) return true;
    if (pane) {closePane(); return true;}
    dismiss(); return true;
  };
  listen(menu, 'keydown', event => {
    if (ime(event)) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault(); event.stopPropagation(); menu.handleEscape();}
    else if (event.target.matches?.('input')) event.stopPropagation();
  });
  menu.refresh = refresh;
  menu.dispose = () => {
    if (disposed) return; disposed = true; cancelDrafts(); void endGesture('cancel'); removePointer(); window.clearTimeout(wheelTimer);
    for (const field of fields) field.binding.dispose(); for (const remove of removers) remove();
  };
  refresh(); return menu;
}
