import { icons } from './confirmation-icons.mjs';
import { chevron } from './model-icons.mjs';

const key = 'tapnow-agent-confirm-mode';
const options = [
  { mode: 'ask', title: '手动确认', description: 'Agent在执行生成前都会寻求您的确认' },
  { mode: 'auto', title: '自动生成', description: 'Agent会自主规划生成任务并自动执行' },
];
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./confirmation.css', import.meta.url).href;
document.head.append(css);

export function getMode() {
  try { return localStorage.getItem(key) === 'auto' ? 'auto' : 'ask'; } catch { return 'ask'; }
}
export function initialize(wasAutomatic = false) {
  try { if (localStorage.getItem(key) === null) localStorage.setItem(key, wasAutomatic ? 'auto' : 'ask'); } catch {}
}
export function setMode(mode) {
  if (!options.some(option => option.mode === mode)) throw new Error('未知确认模式');
  // Persist before advertising a changed execution policy to the conversation.
  localStorage.setItem(key, mode);
  window.dispatchEvent(new CustomEvent('agent:confirmation-mode', { detail: mode }));
}
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export function createControl({ alignTo, disabled = false, onError, beforeOpen, compact = true }) {
  const trigger = el('button', 'agent-confirm-mode');
  trigger.type = 'button';
  trigger.disabled = disabled;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  let menu = null, tooltip = null, tooltipTimer = 0, selected = 0;
  let exitTimer = 0, closingMenu = null;
  function update() {
    const option = options.find(option => option.mode === getMode());
    trigger.innerHTML = icons[option.mode];
    const content=el('span','agent-confirm-adaptive'),inner=el('span','agent-confirm-adaptive-inner'),label=el('span','',option.title);
    inner.append(label);inner.insertAdjacentHTML('beforeend',chevron);content.append(inner);trigger.append(content);setCompact(compact);
    trigger.setAttribute('aria-label', option.title);
    trigger.dataset.description = option.description;
    if (menu) [...menu.children].forEach((row, index) => { row.querySelector('.agent-confirm-check').innerHTML = options[index].mode === option.mode ? icons.check : ''; });
  }
  function setCompact(value) { compact=!!value;trigger.dataset.iconOnly=String(compact);trigger.querySelector('.agent-confirm-adaptive')?.setAttribute('aria-hidden',String(compact)); }
  function hideTooltip() { clearTimeout(tooltipTimer); tooltip?.remove(); tooltip = null;trigger.removeAttribute('aria-describedby'); }
  function showTooltip() {
    if (menu || disabled) return;
    hideTooltip();
    tooltipTimer = setTimeout(() => {
      if (!trigger.isConnected || menu) return;
      tooltip = el('div', 'agent-confirm-tooltip', trigger.dataset.description);
      tooltip.role = 'tooltip';tooltip.id = 'agent-confirm-tooltip';trigger.setAttribute('aria-describedby', tooltip.id);document.body.append(tooltip);
      const rect = trigger.getBoundingClientRect();
      tooltip.style.left = Math.max(8, Math.min(innerWidth - tooltip.offsetWidth - 8, rect.left + rect.width / 2 - tooltip.offsetWidth / 2)) + 'px';
      tooltip.style.top = Math.max(8, rect.top - tooltip.offsetHeight - 8) + 'px';
    }, 200);
  }
  function position() {
    if (!menu) return;
    if (!trigger.isConnected) return close();
    const rect = trigger.getBoundingClientRect();
    const anchorElement = typeof alignTo === 'function' ? alignTo() : alignTo;
    const anchor = anchorElement?.getBoundingClientRect() || rect;
    const above = rect.top >= menu.offsetHeight + 16;
    menu.dataset.side = above ? 'top' : 'bottom';
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, anchor.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, above ? rect.top - menu.offsetHeight - 8 : rect.bottom + 8)) + 'px';
  }
  function highlight(index, focus = true) {
    selected = index;
    [...menu.children].forEach((row, i) => { row.tabIndex = i === index ? 0 : -1; row.dataset.highlighted = String(i === index); });
    if (focus) menu.children[index].focus({ preventScroll: true });
  }
  function close({ restoreFocus = false, immediate = false } = {}) {
    hideTooltip();
    if (!menu) return;
    const old = menu;menu = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', position);
    document.removeEventListener('scroll', position, true);
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
    clearTimeout(exitTimer);closingMenu?.remove();closingMenu = old;
    if (immediate) { old.remove();closingMenu = null; }
    else { old.dataset.state = 'closed';old.inert = true;old.setAttribute('aria-hidden','true');old.style.pointerEvents = 'none';exitTimer = setTimeout(() => { old.remove();if (closingMenu === old) closingMenu = null; }, 150); }
  }
  function choose(mode) {
    try { setMode(mode);update();close({ restoreFocus: true }); } catch (error) { onError?.(error.message); }
  }
  function outside(event) { if (!menu?.contains(event.target) && !trigger.contains(event.target)) close(); }
  function open(last = false) {
    if (disabled) return;
    beforeOpen?.();
    hideTooltip();clearTimeout(exitTimer);closingMenu?.remove();closingMenu = null;
    menu = el('div', 'agent-confirm-menu');menu.role = 'menu';menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    menu.dataset.state = 'open';
    for (const option of options) {
      const row = el('button', 'agent-confirm-option');row.type = 'button';row.role = 'menuitem';
      const icon = el('span', 'agent-confirm-icon');icon.innerHTML = icons[option.mode];
      const content = el('span', 'agent-confirm-copy');content.append(el('span', 'agent-confirm-title', option.title), el('span', 'agent-confirm-description', option.description));
      const check = el('span', 'agent-confirm-check');if (option.mode === getMode()) check.innerHTML = icons.check;
      row.append(icon, content, check);row.onclick = () => choose(option.mode);
      row.onpointermove = () => highlight(options.indexOf(option));menu.append(row);
    }
    menu.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) {
        if (event.key === 'Tab') { event.stopPropagation();close({ restoreFocus: true });return; }
        event.preventDefault();event.stopPropagation();
        if (event.key === 'Escape') return close({ restoreFocus: true });
        highlight(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))));
      }
    };
    document.body.append(menu);position();trigger.setAttribute('aria-expanded', 'true');highlight(last ? options.length - 1 : 0);
    document.addEventListener('pointerdown', outside, true);window.addEventListener('resize', position);document.addEventListener('scroll', position, true);
  }
  trigger.onclick = () => menu ? close() : open();
  trigger.onkeydown = event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault();menu ? highlight(event.key === 'ArrowUp' ? 1 : 0) : open(event.key === 'ArrowUp'); } };
  trigger.onpointerenter = showTooltip;trigger.onpointerleave = hideTooltip;
  trigger.onfocus = showTooltip;trigger.onblur = hideTooltip;
  window.addEventListener('agent:confirmation-mode', update);
  const storage = event => { if (event.key === key) update(); };
  window.addEventListener('storage', storage);
  update();
  return { element: trigger, close, setCompact, destroy() { close({ immediate: true });clearTimeout(exitTimer);closingMenu?.remove();hideTooltip();window.removeEventListener('agent:confirmation-mode', update);window.removeEventListener('storage', storage); } };
}
