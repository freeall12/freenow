import { icons } from './icons.mjs';
export function createMenu({ trigger, items, className = '', align = 'start', onError }) {
  let menu = null, index = 0;
  const closingMenus = new Map();
  function position() {
    if (!menu) return;
    const rect = trigger.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(innerWidth - width - 8, align === 'end' ? rect.right - width : rect.left)) + 'px';
    menu.style.top = Math.max(8, rect.bottom + height + 4 < innerHeight ? rect.bottom + 4 : rect.top - height - 4) + 'px';
  }
  function close(focus = false) {
    if (!menu) return;
    const old = menu; menu = null; old.dataset.state = 'closed'; old.inert = true; old.setAttribute('aria-hidden','true'); old.style.pointerEvents = 'none';
    closingMenus.set(old, setTimeout(() => { old.remove(); closingMenus.delete(old); }, 150));
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
    if (focus && trigger.isConnected) trigger.focus();
  }
  function outside(event) { if (!menu?.contains(event.target) && !trigger.contains(event.target)) close(); }
  function focusAt(next) {
    const buttons = [...menu.querySelectorAll('button')]; if (!buttons.length) return;
    index = (next + buttons.length) % buttons.length;
    buttons[index].focus(); buttons[index].scrollIntoView({ block: 'nearest' });
  }
  function open() {
    if (menu) { close(); return; }
    const entries = items();
    menu = document.createElement('div'); menu.className = 'brainstorm-menu ' + className; menu.role = 'menu';
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || trigger.textContent); menu.dataset.state = 'open';
    for (const entry of entries) {
      const item = document.createElement('button'); item.type = 'button'; item.role = 'menuitem'; item.className = entry.destructive ? 'destructive' : '';
      if (entry.icon) item.innerHTML = icons[entry.icon];
      const text = document.createElement('span'); text.textContent = entry.label; item.append(text);
      if (entry.unread) { const dot = document.createElement('i'); dot.className = 'brainstorm-unread'; item.append(dot); }
      if (entry.selected) item.dataset.selected = 'true';
      item.onclick = async () => { close(true); try { await entry.run(); } catch (error) { onError?.(error.message); } };
      menu.append(item);
    }
    menu.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) {
        if (event.key !== 'Tab') event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') close(true);
        else focusAt(event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
      }
    };
    document.body.append(menu); position(); trigger.setAttribute('aria-expanded', 'true');
    index = Math.max(0, entries.findIndex(entry => entry.selected)); focusAt(index);
    document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
  }
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); trigger.onclick = open;
  trigger.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (!menu) open(); } };
  return { close, destroy() { close(); for (const [node, timer] of closingMenus) { clearTimeout(timer); node.remove(); } closingMenus.clear(); trigger.onclick = null; trigger.onkeydown = null; } };
}
