import {controls} from './icons.mjs';
import {presets} from './preview-environment.mjs';

const el = (tag, cls = '', text) => {const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n;};
export function environmentControls(root, environment, notify) {
  let alive = true, menu, loading = null, request = 0, uploading = false, drag;
  const resources = [], urls = [], bar = el('div', 'world-environment world-capsule');
  bar.setAttribute('role', 'toolbar'); bar.ariaLabel = '环境设置';
  const button = (label, icon, action, text = '') => {
    const b = el('button', 'world-button'); b.type = 'button'; b.ariaLabel = label;
    if (icon) b.innerHTML = controls[icon]; if (text) b.append(el('span', '', text)); b.onclick = action; return b;
  };
  const trigger = button('环境', 'sun', toggleMenu); trigger.classList.add('world-environment-trigger'); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  const backdrop = button('背景', 'photo', () => {environment.toggleBackground(); refresh();}, '背景');
  const rotationGroup = el('div', 'world-environment-rotation'), label = el('span', '', '环境旋转'); label.ariaHidden = 'true';
  const scale = el('div', 'world-focal-scale world-rotation-scale'), windowEl = el('div', 'world-focal-window'), ruler = el('div', 'world-focal-ruler'), readout = el('output', 'world-focal-readout');
  scale.tabIndex = 0; scale.setAttribute('role', 'slider'); scale.ariaLabel = '环境旋转'; scale.setAttribute('aria-valuemin', '0'); scale.setAttribute('aria-valuemax', '359');
  const setRotation = value => {environment.setRotation(Math.max(0, Math.min(359, value))); refresh();};
  for (let p = 0; p < 5; p++) {
    const value = [0, 90, 180, 270, 359][p], tick = button(value + '°', null, () => setRotation(value)); tick.className = 'world-focal-preset'; tick.style.left = p * 90 + 'px'; tick.onpointerdown = e => e.stopPropagation(); ruler.append(tick);
    if (p < 4) for (let k = 1; k < 15; k++) {const minor = el('i'); minor.style.left = p * 90 + k * 6 + 'px'; ruler.append(minor);}
  }
  windowEl.append(ruler, el('i', 'world-focal-indicator')); scale.append(windowEl, readout); rotationGroup.append(label, scale);
  scale.onpointerdown = e => {if (e.button !== 0 || !environment.resource) return; e.preventDefault(); scale.focus(); drag = {x: e.clientX, value: environment.rotation, id: e.pointerId}; scale.setPointerCapture(e.pointerId);};
  scale.onpointermove = e => {if (drag) setRotation(drag.value + (drag.x - e.clientX) * 359 / 360);};
  scale.onpointerup = () => {drag = null;}; scale.onlostpointercapture = () => {drag = null;}; scale.onpointercancel = () => {if (drag) setRotation(drag.value); drag = null;};
  scale.onkeydown = e => {
    if (e.key === 'Escape' && drag) {e.preventDefault(); e.stopPropagation(); setRotation(drag.value); const id = drag.id; drag = null; scale.releasePointerCapture(id); return;}
    if (!environment.resource) return;
    const delta = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[e.key];
    if (delta || ['Home', 'End'].includes(e.key)) {e.preventDefault(); e.stopPropagation(); setRotation(e.key === 'Home' ? 0 : e.key === 'End' ? 359 : environment.rotation + delta * (e.shiftKey ? 10 : 1));}
  };
  scale.addEventListener('wheel', e => {e.preventDefault(); e.stopPropagation(); if (environment.resource) setRotation(environment.rotation + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 359 / 360);}, {passive: false});
  bar.append(trigger, el('span', 'world-preview-divider'), backdrop, el('span', 'world-preview-divider'), rotationGroup);
  const input = el('input'); input.type = 'file'; input.accept = '.hdr,.exr'; input.hidden = true; bar.append(input);
  input.onchange = async () => {
    const file = input.files[0]; input.value = ''; if (!file) return;
    if (!/\.(hdr|exr)$/i.test(file.name)) {notify('请选择 .hdr 或 .exr 文件'); return;}
    uploading = true; renderMenu();
    const url = URL.createObjectURL(file); urls.push(url);
    const resource = {id: url, url, format: file.name.split('.').pop().toLowerCase(), label: file.name.replace(/\.[^.]+$/, '').trim() || 'HDRI'};
    const ok = await select(resource);
    if (!alive) return;
    if (ok) {resources.push(resource); notify('HDRI 已就绪');}
    uploading = false; renderMenu();
  };
  async function select(resource) {
    const focusAfter = menu?.contains(document.activeElement);
    const id = ++request; loading = resource.id; refresh(); renderMenu();
    try {
      const applied = await environment.select(resource, progress => {
        if (!alive || request !== id || !menu) return;
        const b = [...menu.querySelectorAll('[data-resource]')].find(n => n.dataset.resource === resource.id);
        if (b) {b.setAttribute('aria-busy', 'true'); b.ariaLabel = resource.label + '，' + (progress == null ? '正在下载…' : `正在下载 ${Math.round(progress * 100)}%`); const fill = b.querySelector('.world-hdri-progress i'); if (fill) fill.style.width = progress == null ? '100%' : Math.max(4, progress * 100) + '%';}
      });
      return applied;
    } catch (error) {if (alive && request === id) notify('HDRI 加载失败：' + error.message); return false;}
    finally {if (alive && request === id) {loading = null; refresh(); renderMenu(); if (focusAfter && menu && !menu.contains(document.activeElement)) [...menu.querySelectorAll('[data-resource]')].find(b => b.dataset.resource === resource.id)?.focus({preventScroll: true});}}
  }
  function refresh() {
    const selected = environment.resource, text = '环境 · ' + (selected?.label || '柔光影棚');
    trigger.ariaLabel = text; trigger.innerHTML = controls.sun; trigger.append(el('span', '', text)); trigger.insertAdjacentHTML('beforeend', controls['chevron-down']);
    backdrop.disabled = !selected; backdrop.setAttribute('aria-pressed', String(!!selected && environment.backgroundVisible));
    backdrop.dataset.tooltip = !selected ? '选择 HDRI 后可显示背景' : environment.backgroundVisible ? '隐藏背景' : '显示背景';
    backdrop.innerHTML = controls[environment.backgroundVisible ? 'photo' : 'photo-off']; backdrop.append(el('span', '', '背景'));
    scale.setAttribute('aria-disabled', String(!selected)); scale.setAttribute('aria-valuenow', String(environment.rotation)); scale.setAttribute('aria-valuetext', Math.round(environment.rotation) + '°');
    readout.textContent = Math.round(environment.rotation) + '°'; ruler.style.transform = `translateX(${37 - environment.rotation / 359 * 360}px)`; rotationGroup.classList.toggle('is-disabled', !selected);
    for (const b of ruler.querySelectorAll('button')) b.disabled = !selected;
  }
  function closeMenu(focus = false) {menu?.remove(); menu = null; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus();}
  function toggleMenu() {
    if (menu) {closeMenu(); return;}
    root.dispatchEvent(new CustomEvent('world-preview-menu-open', {detail: 'environment'}));
    menu = el('section', 'world-environment-menu'); menu.setAttribute('role', 'dialog'); menu.ariaLabel = '环境'; root.append(menu); trigger.setAttribute('aria-expanded', 'true'); renderMenu();
    (menu.querySelector('[aria-current=true]') || menu.querySelector('button:not(:disabled)'))?.focus();
    menu.onkeydown = e => {
      if (e.key === 'Escape') {e.stopPropagation(); e.preventDefault(); closeMenu(true); return;}
      const options = [...menu.querySelectorAll('button:not(:disabled),input:not([hidden])')], index = options.indexOf(document.activeElement);
      const delta = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2}[e.key];
      if (delta && document.activeElement.tagName !== 'INPUT') {e.preventDefault(); options[Math.max(0, Math.min(options.length - 1, index + delta))]?.focus();}
      if (e.key === 'Tab') {e.preventDefault(); e.stopPropagation(); options[(index + (e.shiftKey ? -1 : 1) + options.length) % options.length]?.focus();}
    };
  }
  function rename(resource, row) {
    const field = el('input', 'world-hdri-name'); field.type = 'text'; field.ariaLabel = '资源名称'; field.value = resource.label; let done = false;
    const finish = save => {if (done) return; done = true; if (save) resource.label = field.value.trim() || resource.label; renderMenu(); refresh(); menu?.querySelector(`[data-rename="${resources.indexOf(resource)}"]`)?.focus();};
    field.onkeydown = e => {e.stopPropagation(); if (!e.isComposing && (e.key === 'Enter' || e.key === 'Escape')) {e.preventDefault(); finish(e.key === 'Enter');}}; field.onblur = () => finish(true); row.replaceChildren(field); field.focus(); field.select();
  }
  function renderMenu() {
    if (!menu) return;
    const focusId = menu.contains(document.activeElement) ? document.activeElement.dataset.resource || document.activeElement.dataset.action : null;
    const scroll = menu.scrollTop; menu.replaceChildren();
    const grid = el('fieldset', 'world-hdri-grid'); const legend = el('legend', 'world-sr-only', 'HDRI 预设'); grid.append(legend);
    for (const resource of presets) {
      const b = button(resource.label, null, () => select(resource)); b.className = 'world-hdri-tile'; b.dataset.resource = resource.id; b.disabled = loading === resource.id;
      b.setAttribute('aria-current', String(environment.resource?.url === resource.url)); b.setAttribute('aria-busy', String(loading === resource.id));
      const thumb = el('span', 'world-hdri-thumb'), img = el('img'); img.src = resource.preview; img.alt = ''; img.draggable = false; img.loading = 'lazy'; thumb.append(img);
      if (loading === resource.id) {const progress = el('span', 'world-hdri-progress'); progress.append(el('i')); thumb.append(progress);}
      b.append(thumb, el('span', 'world-hdri-label', resource.label)); grid.append(b);
    }
    menu.append(grid);
    if (resources.length) {
      menu.append(el('hr'), el('h3', '', 'HDRI 文件'));
      for (const [index, resource] of resources.entries()) {
        const row = el('div', 'world-hdri-row'), choose = button(resource.label, null, () => select(resource), resource.label); choose.dataset.resource = resource.id; choose.setAttribute('aria-current', String(environment.resource?.url === resource.url));
        const edit = button('重命名资源', 'pencil', () => rename(resource, row)); edit.dataset.tooltip = '重命名资源'; edit.dataset.rename = index;
        row.append(choose, edit); menu.append(row);
      }
    }
    const upload = button(uploading ? '正在上传 HDRI…' : '上传 HDRI', 'plus', () => input.click(), uploading ? '正在上传 HDRI…' : '上传 HDRI'); upload.dataset.action = 'upload'; upload.classList.add('world-hdri-upload'); upload.disabled = uploading;
    menu.append(el('hr'), upload); menu.scrollTop = scroll; positionMenu();
    if (focusId) [...menu.querySelectorAll('button')].find(b => (b.dataset.resource || b.dataset.action) === focusId)?.focus({preventScroll: true});
  }
  function positionMenu() {
    if (!menu) return;
    const r = trigger.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + 'px'; menu.style.bottom = innerHeight - r.top + 4 + 'px'; menu.style.maxHeight = Math.max(100, r.top - 12) + 'px';
  }
  const outside = e => {if (menu && !menu.contains(e.target) && !trigger.contains(e.target)) closeMenu();};
  const otherMenu = e => {if (e.detail !== 'environment') closeMenu();};
  const escape = e => {if (!e.defaultPrevented && !e.isComposing && e.key === 'Escape' && !drag && menu && !menu.contains(e.target)) {e.preventDefault(); e.stopImmediatePropagation(); closeMenu(true);}};
  root.addEventListener('pointerdown', outside); root.addEventListener('world-preview-menu-open', otherMenu); root.addEventListener('keydown', escape, true); window.addEventListener('resize', positionMenu);
  refresh(); select(presets[0]);
  return {element: bar, refresh: positionMenu, dispose() {alive = false; request++; closeMenu(); root.removeEventListener('pointerdown', outside); root.removeEventListener('world-preview-menu-open', otherMenu); root.removeEventListener('keydown', escape, true); window.removeEventListener('resize', positionMenu); urls.forEach(url => URL.revokeObjectURL(url));}};
}
