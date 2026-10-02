import {controls} from './icons.mjs';
import {ratioIcons} from './ratio-icons.mjs';
import {previewTooltips} from './preview-tooltips.mjs';
import {DEFAULT_FOCAL, FOCAL_PRESETS, RATIOS, aspectOf, clampFocal, frameRect, focalFov} from './preview-optics.mjs';
export const el = (tag, cls = '', text) => {const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node;};
export function previewChrome(root, canvas, {onClose, onChange, onCapture, onReset, onEnter, environmentControls, scenePreview = false, panoramaPreview = false}) {
  let active = false, focal = DEFAULT_FOCAL, ratio = '16:9', menu, drag, guideTimer, toastTimer;
  const cleanups = [], header = el('header'), footer = el('footer'), photography = el('div', 'world-photography world-capsule');
  const button = (label, icon, action, text = '') => {
    const b = el('button', 'world-button'); b.type = 'button'; b.ariaLabel = label; b.dataset.tooltip = label;
    if (icon) b.innerHTML = controls[icon]; if (text) b.append(el('span', '', text)); b.onclick = action; return b;
  };
  const capsule = child => {const c = el('div', 'world-capsule'); c.append(child); return c;};
  const separator = () => el('span', 'world-preview-divider');
  const back = button('关闭', 'arrow-left', exit), reset = button('恢复初始视角', 'focus-2', onReset);
  const resetBar = capsule(reset); resetBar.classList.add('world-preview-reset');
  const toggle = button('打开取景器', 'viewfinder', () => setActive(!active), '取景器'); toggle.classList.add('world-viewfinder-toggle');
  const enter = button('在 3D 片场中使用', 'cube', () => onEnter(enter), '在 3D 片场中使用'); enter.classList.add('world-preview-enter');
  const capture = button('拍摄', 'camera', () => onCapture(capture)); capture.dataset.tooltip = '拍摄当前画面';
  const ratioButton = button('画幅', null, openRatios); ratioButton.classList.add('world-ratio-trigger'); ratioButton.setAttribute('aria-haspopup', 'dialog');
  const scale = el('div', 'world-focal-scale'); scale.tabIndex = 0; scale.setAttribute('role', 'slider'); scale.ariaLabel = '焦距'; scale.setAttribute('aria-valuemin', '8'); scale.setAttribute('aria-valuemax', '400');
  const windowEl = el('div', 'world-focal-window'), ruler = el('div', 'world-focal-ruler'), readout = el('output', 'world-focal-readout');
  const trackWidth = Math.round(384 * Math.log(50) / Math.log(200 / 12));
  const position = value => Math.log(value / 8) / Math.log(50) * trackWidth;
  for (let p = 0; p <= 7; p++) {
    const tick = button(FOCAL_PRESETS[p] + 'mm', null, () => setFocal(FOCAL_PRESETS[p])); tick.className = 'world-focal-preset'; tick.style.left = p * trackWidth / 7 + 'px';
    tick.onpointerdown = event => event.stopPropagation(); ruler.append(tick);
    if (p < 7) for (let k = 1; k < 13; k++) {const minor = el('i'); minor.style.left = (p + k / 13) * trackWidth / 7 + 'px'; ruler.append(minor);}
  }
  windowEl.append(ruler, el('i', 'world-focal-indicator')); scale.append(windowEl, readout);
  scale.onpointerdown = event => {if (event.button !== 0) return; event.preventDefault(); drag = {x: event.clientX, focal, position: position(focal), pointerId: event.pointerId}; scale.setPointerCapture(event.pointerId);};
  scale.onpointermove = event => {if (drag) setFocal(8 * Math.exp((drag.position + drag.x - event.clientX) / trackWidth * Math.log(50)));};
  scale.onpointerup = () => {drag = null;}; scale.onpointercancel = () => {if (drag) setFocal(drag.focal); drag = null;}; scale.onlostpointercapture = () => {drag = null;};
  scale.onkeydown = event => {
    if (event.key === 'Escape' && drag) {event.stopPropagation(); setFocal(drag.focal); const id = drag.pointerId; drag = null; scale.releasePointerCapture(id); return;}
    const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
    if (direction || ['Home', 'End'].includes(event.key)) {event.preventDefault(); event.stopPropagation(); setFocal(event.key === 'Home' ? 8 : event.key === 'End' ? 400 : focal * Math.exp(direction * Math.log(50) / 100));}
  };
  const wheel = event => {event.preventDefault(); event.stopPropagation(); setFocal(focal * Math.exp(event.deltaY * Math.log(50) / 534));};
  scale.addEventListener('wheel', wheel, {passive: false});
  photography.append(ratioButton, separator(), scale, separator(), capture); photography.hidden = true;
  const frame = el('div', 'world-viewfinder'); frame.hidden = true; frame.ariaHidden = 'true';
  for (const cls of ['horizontal first', 'horizontal second', 'vertical first', 'vertical second']) frame.append(el('i', cls));
  const vignette = el('div', 'world-preview-vignette'); vignette.ariaHidden = 'true';
  const flash = el('div', 'world-preview-flash'); flash.ariaHidden = 'true';
  const guide = el('div', 'world-preview-guide world-capsule'), logo = el('img'); logo.src = '/assets/tap-logo-official.svg'; logo.alt = '';
  const guideText = el('span', '', panoramaPreview ? '拖动鼠标可以环视全景' : scenePreview ? '拖动鼠标环视，或使用 WASD 移动' : '拖动鼠标可以旋转物品'), guideKey = `three-d-preview-${panoramaPreview ? 'panorama' : scenePreview ? 'scene' : 'object'}-navigation-v1`;
  const toast = el('div', 'world-preview-toast'); toast.hidden = true; toast.setAttribute('role', 'status');
  const hide = button('不再提示', null, () => {try {localStorage.setItem(guideKey, 'hidden');} catch {} guide.hidden = true; toast.replaceChildren(el('span', '', '此预览提示将不再显示。'), button('撤销', null, () => {try {localStorage.removeItem(guideKey);} catch {} guide.hidden = false; toast.hidden = true;}, '撤销')); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {toast.hidden = true;}, 5000);}, '不再提示');
  guide.append(logo, guideText, hide); guide.hidden = true;
  guideTimer = setTimeout(() => {try {guide.hidden = localStorage.getItem(guideKey) === 'hidden';} catch {guide.hidden = false;}}, 1000);
  let origin;
  const down = e => {if (e.button === 0 || e.button === 1) origin = {x: e.clientX, y: e.clientY};};
  const move = e => {if (origin && e.buttons && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= 4) {clearTimeout(guideTimer); guide.hidden = true; origin = null;}};
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); cleanups.push(() => {canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);});
  header.append(capsule(back), guide); footer.append(capsule(toggle)); if (environmentControls) footer.append(environmentControls); footer.append(capsule(enter)); root.append(vignette, frame, header, photography, footer, resetBar, toast, flash);
  const otherMenu = e => {if (e.detail !== 'ratio') closeMenu();}; root.addEventListener('world-preview-menu-open', otherMenu); cleanups.push(() => root.removeEventListener('world-preview-menu-open', otherMenu));
  function closeMenu(focus = false) {menu?.remove(); menu = null; ratioButton.setAttribute('aria-expanded', 'false'); if (focus) ratioButton.focus();}
  function openRatios() {
    if (menu) {closeMenu(); return;}
    root.dispatchEvent(new CustomEvent('world-preview-menu-open', {detail: 'ratio'}));
    menu = el('div', 'world-ratio-menu world-capsule'); menu.setAttribute('role', 'dialog'); menu.ariaLabel = '画幅';
    for (const choices of [RATIOS.slice(0, 10), RATIOS.slice(10)]) {const group = el('div'); for (const label of choices) {
      const option = button(label, null, () => {ratio = label; closeMenu(true); refresh(); onChange();}); option.innerHTML = ratioIcons[label]; option.append(el('span', '', label)); option.setAttribute('aria-pressed', String(ratio === label)); group.append(option);
    } menu.append(group);}
    root.append(menu); ratioButton.setAttribute('aria-expanded', 'true'); positionMenu(); menu.querySelector('[aria-pressed=true]').focus();
    menu.onkeydown = e => {if (e.key === 'Escape') {e.stopPropagation(); closeMenu(true); return;} const options = [...menu.querySelectorAll('button')], index = options.indexOf(document.activeElement), delta = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5}[e.key]; if (delta) {e.preventDefault(); options[Math.max(0, Math.min(options.length - 1, index + delta))].focus();}};
  }
  function positionMenu() {if (!menu) return; const r = ratioButton.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2)) + 'px'; menu.style.bottom = innerHeight - r.top + 8 + 'px';}
  const outside = e => {if (menu && !menu.contains(e.target) && !ratioButton.contains(e.target)) closeMenu();}; root.addEventListener('pointerdown', outside);
  function refresh() {
    const rect = frameRect(canvas.clientWidth, canvas.clientHeight, aspectOf(ratio)); for (const [key, value] of Object.entries(rect)) frame.style[key] = value + 'px';
    const alpha = active ? Math.max(0, Math.min(1, (focalFov(focal, aspectOf(ratio)) - 100) / 45)) : 0; vignette.style.opacity = alpha;
    ratioButton.innerHTML = ratioIcons[ratio] + '<span>' + ratio + '</span>' + controls['chevron-down'];
    scale.setAttribute('aria-valuenow', String(focal)); scale.setAttribute('aria-valuetext', Math.round(focal) + 'mm'); readout.textContent = Math.round(focal) + 'mm'; ruler.style.transform = `translateX(${37 - position(focal)}px)`;
    positionMenu();
  }
  function setFocal(value) {focal = clampFocal(value); refresh(); onChange();}
  function setActive(value) {active = value; closeMenu(); frame.hidden = photography.hidden = !active; resetBar.hidden = active; toggle.setAttribute('aria-pressed', String(active)); const label = active ? '关闭取景器' : '打开取景器'; toggle.ariaLabel = label; toggle.dataset.tooltip = active ? '返回片场视图' : '调整画面并拍摄'; back.ariaLabel = active ? '关闭取景器' : '关闭'; back.dataset.tooltip = back.ariaLabel; if (!active && photography.contains(document.activeElement)) back.focus(); refresh(); onChange();}
  function exit() {if (menu) closeMenu(true); else if (active) setActive(false); else onClose();}
  root.onkeydown = event => {
    event.stopPropagation();
    if (event.key === 'Escape') {event.preventDefault(); exit();}
    if (event.key === 'Tab') {
      const items = [...(menu || root).querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {event.preventDefault(); items.at(-1).focus();}
      else if (!event.shiftKey && (index === items.length - 1 || index < 0)) {event.preventDefault(); items[0].focus();}
    }
  };
  cleanups.push(previewTooltips(root)); refresh();
  return {get focal() {return focal;}, get aspect() {return active ? aspectOf(ratio) : null;}, setFocal, dismissGuide() {clearTimeout(guideTimer); guide.hidden = true;}, refresh, flash() {flash.animate([{opacity: .65}, {opacity: 0}], {duration: 320});}, dispose() {clearTimeout(guideTimer); clearTimeout(toastTimer); cleanups.forEach(fn => fn()); closeMenu();}};
}
