import {openPreferences} from './preferences.mjs';
import {preferencesAccountIcon} from './icons.mjs';

const installations = new WeakMap();
let sequence = 0;

// The official avatar-only popover uses side=right, align=end and a 14px offset.
// Marketing, collaboration and external account services are outside this replica.
export function install(avatar) {
  if (!avatar?.addEventListener) throw new TypeError('账户菜单需要头像入口元素');
  if (installations.has(avatar)) return installations.get(avatar);
  let popup, row, disposed = false, opening = 0;
  const previousAttributes = new Map(['aria-haspopup', 'aria-expanded', 'aria-controls'].map(key => [key, avatar.getAttribute(key)]));
  const id = `generation-preferences-entry-${++sequence}`;
  let link = document.querySelector('link[data-generation-result-preferences]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./preferences.css', import.meta.url).href;
    link.dataset.generationResultPreferences = '';
    document.head.append(link);
  }
  avatar.setAttribute('aria-haspopup', 'dialog');
  avatar.setAttribute('aria-expanded', 'false');
  avatar.setAttribute('aria-controls', id);

  function position() {
    if (!popup) return;
    const bounds = avatar.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const margin = 16, gap = 14;
    popup.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
    popup.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
    const rect = popup.getBoundingClientRect();
    const rightSpace = left + width - margin - bounds.right - gap;
    const leftSpace = bounds.left - gap - left - margin;
    const flip = rightSpace < rect.width && leftSpace > rightSpace;
    const x = flip ? bounds.left - gap - rect.width : bounds.right + gap;
    const y = bounds.bottom - rect.height;
    popup.style.left = `${Math.max(left + margin, Math.min(x, left + width - rect.width - margin))}px`;
    popup.style.top = `${Math.max(top + margin, Math.min(y, top + height - rect.height - margin))}px`;
    popup.dataset.side = flip ? 'left' : 'right';
  }
  function close({restoreFocus = true} = {}) {
    opening++;
    if (!popup) return;
    popup.remove(); popup = null; row = null;
    avatar.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.visualViewport?.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('scroll', position);
    if (restoreFocus && avatar.isConnected) avatar.focus({preventScroll: true});
  }
  function outside(event) {
    if (!popup?.contains(event.target) && !avatar.contains(event.target)) close();
  }
  function open() {
    if (disposed || popup) return;
    popup = document.createElement('div');
    popup.id = id;
    popup.className = 'generation-preferences-entry';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '账户菜单');
    popup.dataset.align = 'end';
    row = document.createElement('button');
    row.type = 'button';
    row.className = 'generation-preferences-entry-row';
    row.dataset.testid = 'common-nav-user-menu-account-settings-btn';
    const icon = document.createElement('span');
    icon.className = 'generation-preferences-entry-icon';
    icon.innerHTML = preferencesAccountIcon;
    const label = document.createElement('span');
    label.textContent = '账户管理';
    row.append(icon, label);
    row.addEventListener('click', event => { event.stopPropagation(); close(); openPreferences(); });
    popup.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); row.focus(); }
      else if (event.key === 'Tab') close();
    });
    popup.addEventListener('pointerdown', event => event.stopPropagation());
    popup.addEventListener('click', event => event.stopPropagation());
    popup.append(row);
    document.body.append(popup);
    avatar.setAttribute('aria-expanded', 'true');
    position(); row.focus({preventScroll: true});
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
  }
  function toggle(event) {
    event.preventDefault(); event.stopPropagation();
    if (popup) { close(); return; }
    const attempt = ++opening;
    // Wait for the shared stylesheet so the first measured anchor is accurate.
    if (link.sheet) open();
    else {
      const ready = () => { link.removeEventListener('load', ready); link.removeEventListener('error', ready); if (!disposed && attempt === opening) open(); };
      link.addEventListener('load', ready, {once: true});
      link.addEventListener('error', ready, {once: true});
    }
  }
  function keydown(event) {
    if (!['BUTTON', 'INPUT'].includes(avatar.tagName) && ['Enter', ' '].includes(event.key)) toggle(event);
  }
  avatar.addEventListener('click', toggle);
  avatar.addEventListener('keydown', keydown);
  const controller = {close, destroy() {
    close(); disposed = true;
    avatar.removeEventListener('click', toggle);
    avatar.removeEventListener('keydown', keydown);
    for (const [key, value] of previousAttributes) value == null ? avatar.removeAttribute(key) : avatar.setAttribute(key, value);
    installations.delete(avatar);
  }};
  installations.set(avatar, controller);
  return controller;
}
