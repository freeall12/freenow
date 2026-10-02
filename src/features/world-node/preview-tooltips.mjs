// Tooltips live outside the scrollable toolbar, as the official portal does.
export function previewTooltips(root, {selector = '[data-tooltip]', portal = root, className = 'world-preview-tooltip'} = {}) {
  const tip = document.createElement('div'); tip.className = className; tip.setAttribute('role', 'tooltip'); tip.id = 'preview-tooltip-' + crypto.randomUUID(); tip.hidden = true; portal.append(tip);
  let timer, anchor;
  function hide() {
    clearTimeout(timer);
    if (anchor) {const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id); if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' ')); else anchor.removeAttribute('aria-describedby');}
    anchor = null; tip.hidden = true;
  }
  function show(event) {
    const button = event.target.closest?.(selector);
    if (!button || !root.contains(button) || button === anchor) return;
    hide(); anchor = button;
    timer = setTimeout(() => {
      if (!button.isConnected || !button.getClientRects().length) return;
      const rect = button.getBoundingClientRect(); tip.textContent = button.dataset.tooltip; tip.hidden = false; button.setAttribute('aria-describedby', [button.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '));
      tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, rect.left + rect.width / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(8, rect.top < 70 ? rect.bottom + 12 : rect.top - tip.offsetHeight - 12) + 'px';
    }, 300);
  }
  function leave(event) {if (anchor && !anchor.contains(event.relatedTarget)) hide();}
  root.addEventListener('pointerover', show); root.addEventListener('focusin', show); root.addEventListener('pointerout', leave); root.addEventListener('focusout', leave); root.addEventListener('pointerdown', hide); root.addEventListener('scroll', hide, true);
  document.addEventListener('canvas:render', hide); window.addEventListener('resize', hide);
  return () => {document.removeEventListener('canvas:render', hide); window.removeEventListener('resize', hide); hide(); tip.remove(); root.removeEventListener('pointerover', show); root.removeEventListener('focusin', show); root.removeEventListener('pointerout', leave); root.removeEventListener('focusout', leave); root.removeEventListener('pointerdown', hide); root.removeEventListener('scroll', hide, true);};
}
