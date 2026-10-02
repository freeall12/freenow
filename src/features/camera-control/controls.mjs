import { options } from './catalog.mjs';
import { cameraSettings, isEnabled } from './settings.mjs';
export * from './settings.mjs';
import { triangle, cross } from './assets.mjs';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./controls.css', import.meta.url).href;
stylesheet.onload = () => document.dispatchEvent(new Event('image-menus:layout'));
document.head.append(stylesheet);

const labels = { camera: '相机', lens: '镜头', focal: '焦距', aperture: '光圈' };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(cls, label, action) {
  const node = el('button', cls);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.onclick = action;
  return node;
}

export function renderPanel(pop, config, onChange, onClose) {
  pop.replaceChildren();
  pop.classList.add('camera-control-popover');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '相机控制');
  pop.tabIndex = -1;
  const head = el('div', 'camera-control-heading');
  const save = button('camera-control-save', '保存', onClose);
  save.textContent = '保存';
  head.append(el('span', '', '相机控制'), save);
  const body = el('div', 'camera-control-columns');
  pop.append(head, body);
  const values = cameraSettings(config);
  const timers = new Set();
  let alive = true;
  for (const [key, items] of Object.entries(options)) {
    if (body.children.length) body.append(el('div', 'camera-control-divider'));
    const column = el('div', 'camera-control-column');
    column.dataset.field = key;
    column.tabIndex = 0;
    column.setAttribute('role', 'listbox');
    column.setAttribute('aria-label', labels[key]);
    const row = el('div', 'camera-control-reel-row');
    // These are focus indicators in the official component, not arrow buttons.
    for (const side of ['left', 'right']) {
      const arrow = el('span', 'camera-control-arrow ' + side);
      arrow.innerHTML = triangle;
      arrow.setAttribute('aria-hidden', 'true');
      row.append(arrow);
    }
    const reel = el('div', 'camera-control-reel');
    const highlight = el('div', 'camera-control-highlight');
    const clip = el('div', 'camera-control-clip');
    const track = el('div', 'camera-control-track');
    clip.append(track);
    reel.append(highlight, clip);
    row.insertBefore(reel, row.lastChild);
    const caption = el('span', 'camera-control-caption');
    column.append(row, caption);
    body.append(column);
    let selected = items.indexOf(values[key]), moving = false, delta = 0, lastSwitch = 0;
    function focus() {
      body.querySelectorAll('.camera-control-column').forEach(item => item.classList.toggle('active', item === column));
    }
    function render() {
      track.style.transitionDuration = '0ms';
      track.style.transform = `translateY(${42 - selected * 80}px)`;
      [...track.children].forEach((item, index) => {
        item.setAttribute('aria-selected', index === selected);
        const badge = item.querySelector('.camera-control-badge');
        if (badge) badge.hidden = index !== selected;
      });
      caption.textContent = items[selected].label;
      caption.classList.remove('changing');
      column.setAttribute('aria-activedescendant', `camera-option-${key}-${selected}`);
    }
    function step(direction) {
      const next = selected + direction;
      if (moving || next < 0 || next >= items.length) return;
      moving = true;
      track.style.transitionDuration = '200ms';
      track.style.transform = `translateY(${42 - next * 80}px)`;
      caption.classList.add('changing');
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!alive) return;
        selected = next;
        moving = false;
        render();
        onChange({ [key]: items[selected].label });
      }, 200);
      timers.add(timer);
    }
    items.forEach((item, index) => {
      const option = el('div', 'camera-control-option');
      option.id = `camera-option-${key}-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-label', item.label);
      if (item.image) {
        const image = el('img');
        image.src = item.image;
        image.alt = item.label;
        image.draggable = false;
        option.append(image);
        if (item.badge) option.append(el('span', 'camera-control-badge', item.badge));
      } else option.append(el('span', 'camera-control-value', item.label));
      option.onclick = event => {
        event.stopPropagation();
        focus();
        if (Math.abs(index - selected) === 1) step(index - selected);
      };
      track.append(option);
    });
    column.onclick = focus;
    column.onfocus = focus;
    column.onkeydown = event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      step(event.key === 'ArrowDown' ? 1 : -1);
    };
    column.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      if (moving || Date.now() - lastSwitch < 150) return;
      delta += event.deltaY;
      if (Math.abs(delta) < 100) return;
      step(delta > 0 ? 1 : -1);
      delta = 0;
      lastSwitch = Date.now();
    }, { passive: false });
    render();
  }
  return () => { alive = false; timers.forEach(clearTimeout); };
}

export function renderTrigger(config, onChange, onOpen) {
  const enabled = isEnabled(config), values = cameraSettings(config);
  const group = el('div', 'camera-control-trigger');
  const toggle = button('camera-control-toggle', enabled ? 'Lens On' : 'Lens Off', () => onChange({ cameraEnabled: !enabled }));
  toggle.setAttribute('aria-pressed', enabled);
  const lens = el('img');
  lens.src = enabled ? 'assets/camera-control/lens-on.png' : 'assets/camera-control/lens-off-C_Zx15Vp.png';
  lens.alt = enabled ? 'Lens On' : 'Lens Off';
  toggle.append(lens);
  const trigger = button('camera-trigger', '相机控制', event => onOpen(event.currentTarget));
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.append(el('span', enabled ? 'camera-control-name enabled' : 'camera-control-name', enabled ? values.camera.label : '相机控制'));
  group.append(toggle, trigger);
  if (enabled) {
    const remove = button('camera-control-disable', '关闭相机控制', () => onChange({ cameraEnabled: false }));
    remove.innerHTML = cross;
    group.append(remove);
  }
  const tooltip = el('div', 'camera-control-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  const image = el('img');
  image.src = values.camera.image;
  image.alt = '';
  const detail = el('div');
  const heading = el('div', 'camera-control-tooltip-heading');
  heading.append(el('strong', '', values.camera.label), el('span', enabled ? 'enabled' : '', enabled ? 'ON' : 'OFF'));
  detail.append(heading, el('p', '', `${values.lens.label} / ${values.focal.label} / ${values.aperture.label}`));
  tooltip.append(image, detail);
  group.append(tooltip);
  const position = () => {
    const rect = group.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    tooltip.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
    tooltip.style.top = Math.max(8, rect.top - tooltip.offsetHeight - 8) + 'px';
  };
  group.onmouseenter = position;
  group.onfocusin = position;
  return group;
}
