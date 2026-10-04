(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Presence belongs to the screen overlay, never to the canvas/world transform.
  // Capture the current visual pose before cancelling so rapid reversal is continuous.
  function createPresenceMotion(element, { hidden = { opacity: 0, transform: 'scale(0)' },
    enter = { duration: 150, easing: 'ease' }, exit = enter, onHidden = () => {} } = {}) {
    const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    const pointerEvents = element.style.pointerEvents || '', pointerPriority = element.style.getPropertyPriority?.('pointer-events') || '';
    let animations = [], revision = 0, phase = 'closed', destroyed = false;
    const visible = { opacity: 1, transform: 'none' };
    const cancel = () => { for (const animation of animations) animation.cancel(); animations = []; };
    function finish(token, opening) {
      if (token !== revision || destroyed || phase !== (opening ? 'opening' : 'closing')) return;
      cancel(); phase = opening ? 'open' : 'closed';
      element.setAttribute('data-replica-phase', phase);
      if (!opening) { element.hidden = true; onHidden(); }
    }
    function run(opening) {
      if (destroyed || (!opening && (phase === 'closed' || phase === 'closing'))) return;
      const reversing = animations.length > 0 && !element.hidden;
      const style = reversing && root.getComputedStyle?.(element);
      const from = style ? { opacity: style.opacity, transform: style.transform } : opening ? hidden : visible;
      const token = ++revision; cancel();
      phase = opening ? 'opening' : 'closing';
      element.setAttribute('data-replica-phase', phase);
      element.inert = !opening;
      // Inert disables the exiting surface's controls, while hit-test removal
      // lets the user's next click reach an overlapping replacement trigger.
      if(element.style.setProperty)element.style.setProperty('pointer-events',opening ? pointerEvents : 'none',opening ? pointerPriority : 'important');
      else element.style.pointerEvents = opening ? pointerEvents : 'none';
      element.setAttribute('aria-hidden', String(!opening));
      if (opening) element.hidden = false;
      if (typeof element.animate !== 'function' || reduced?.matches) { finish(token, opening); return; }
      const settings = opening ? enter : exit, target = opening ? visible : hidden;
      for (const property of ['transform', 'opacity']) {
        const timing = settings[property] || settings;
        animations.push(element.animate([{ [property]: from[property] }, { [property]: target[property] }],
          { duration: timing.duration, delay: reversing ? 0 : timing.delay || 0, easing: timing.easing, fill: 'both' }));
      }
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => finish(token, opening));
    }
    const preferenceChanged = () => { if (reduced.matches && animations.length) finish(revision, phase === 'opening'); };
    reduced?.addEventListener?.('change', preferenceChanged);
    return { enter: () => run(true), exit: () => run(false), get isOpen() { return phase === 'open' || phase === 'opening'; },
      destroy() { if (destroyed) return; destroyed = true; revision++; cancel(); if(element.style.setProperty)element.style.setProperty('pointer-events',pointerEvents,pointerPriority);else element.style.pointerEvents=pointerEvents;reduced?.removeEventListener?.('change', preferenceChanged); } };
  }

  function createMenu({ element, label = '操作', onError = console.error } = {}) {
    if (!element) throw new TypeError('createMenu requires an element');
    let returnFocus = null, destroyed = false, focusRevision = 0, focusCheck = 0;
    const motion = createPresenceMotion(element);
    function cancelFocusCheck() { focusRevision++; root.clearTimeout?.(focusCheck); focusCheck = 0; }
    function expanded(value) {
      if (!returnFocus?.matches?.('button,[aria-haspopup="menu"]')) return;
      returnFocus.setAttribute('aria-haspopup', 'menu');
      returnFocus.setAttribute('aria-expanded', String(value));
      if (element.id) returnFocus.setAttribute('aria-controls', element.id);
    }
    function close(restoreFocus = false) {
      cancelFocusCheck();
      if (!motion.isOpen) return;
      motion.exit();
      expanded(false);
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    function reveal(button) {
      const bounds = element.getBoundingClientRect?.(), item = button?.getBoundingClientRect?.();
      if (!bounds?.height || !item || !element.clientHeight) return;
      // Presence scales screen rectangles. Scroll in menu CSS pixels only;
      // scrolling other ancestors could move the canvas under the menu.
      const scale = bounds.height / element.offsetHeight || 1;
      const top = (item.top - bounds.top) / scale - (element.clientTop || 0);
      const bottom = (item.bottom - bounds.top) / scale - (element.clientTop || 0);
      if (top < 0) element.scrollTop += top;
      else if (bottom > element.clientHeight) element.scrollTop += bottom - element.clientHeight;
    }
    function show(x, y, items) {
      if (destroyed) return;
      cancelFocusCheck();
      if (!element.contains(document.activeElement)) { expanded(false); returnFocus = document.activeElement; }
      element.replaceChildren();
      element.setAttribute('role', 'menu');
      element.setAttribute('aria-label', label);
      for (const item of items) {
        if (!item) {
          const separator = document.createElement('hr');
          separator.setAttribute('role', 'separator');
          element.append(separator);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.setAttribute('role', 'menuitem');
        button.disabled = typeof item.run !== 'function';
        button.setAttribute('aria-disabled', String(button.disabled));
        if (item.key) {
          const shortcut = document.createElement('small');
          shortcut.textContent = item.key;
          button.append(shortcut);
        }
        button.addEventListener('click', async () => {
          if (!motion.isOpen) return;
          close(true);
          try { await item.run(); } catch (error) { onError(error); }
        });
        element.append(button);
      }
      element.hidden = false;
      element.style.left = clamp(x, 8, Math.max(8, innerWidth - element.offsetWidth - 8)) + 'px';
      element.style.top = clamp(y, 8, Math.max(8, innerHeight - element.offsetHeight - 8)) + 'px';
      element.scrollTop = 0;
      motion.enter();
      expanded(true);
      const first = element.querySelector('button:not(:disabled)');
      if (!first) element.tabIndex = -1;
      (first || element).focus({ preventScroll: true });
      reveal(first);
    }
    function onKeydown(event) {
      if (!motion.isOpen || element.hidden || event.defaultPrevented || event.isComposing) return;
      // A newly opened dialog owns its keys even before outside-pointer dismissal.
      const target = event.composedPath?.()[0] || event.target || document.activeElement;
      if (!element.contains(target)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(true); return;
      }
      // Keep the current item in the focus order until native Tab has run.
      // Focus events own dismissal once native Tab actually moves focus.
      if (event.key === 'Tab') return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const buttons = [...element.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
      reveal(buttons[next]);
    }
    const onFocusIn = event => { cancelFocusCheck(); if (motion.isOpen && !element.contains(event.target)) close(); };
    const onFocusOut = event => {
      if (!motion.isOpen || !element.contains(event.target)) return;
      cancelFocusCheck(); const revision = focusRevision;
      // Tab into browser chrome can produce focusout without any document focusin.
      // Defer until native focus has settled; reopening invalidates this task.
      focusCheck = root.setTimeout(() => {
        if (destroyed || revision !== focusRevision) return;
        focusCheck = 0;
        if (motion.isOpen &&
          (document.hasFocus?.() === false || !element.contains(document.activeElement))) close();
      }, 0);
    };
    const onWindowBlur = () => close();
    const onPointerDown = event => { if (motion.isOpen && !element.contains(event.target) && !returnFocus?.contains?.(event.target)) close(); };
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown);
    root.addEventListener?.('blur', onWindowBlur);
    return { show, close, get isOpen() { return motion.isOpen && !element.hidden; }, destroy() { destroyed = true; cancelFocusCheck(); expanded(false); document.removeEventListener('keydown', onKeydown, true); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut); document.removeEventListener('pointerdown', onPointerDown); root.removeEventListener?.('blur', onWindowBlur); motion.destroy(); element.inert = true; element.hidden = true; } };
  }

  function createTooltip({ root: eventRoot = document, id, selector = 'button[data-tip],button[data-tooltip]', delay = 180, canShow = () => true, place } = {}) {
    const tooltip = document.createElement('div');
    tooltip.className = 'replica-tooltip';
    tooltip.id = id || 'replica-tooltip-' + Math.random().toString(36).slice(2);
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);
    const motion = createPresenceMotion(tooltip, { hidden: { opacity: 0, transform: 'scale(.95)' },
      enter: { duration: 150, easing: 'cubic-bezier(.4,0,.2,1)' } });
    let target = null, timer = 0;
    function hide() {
      clearTimeout(timer);
      motion.exit();
      target?.removeAttribute('aria-describedby');
      target = null;
    }
    function showFor(node) {
      const button = node?.closest?.(selector);
      if (!button || button.disabled || !canShow(button)) return;
      hide(); target = button;
      timer = setTimeout(() => {
        if (!button.isConnected || !canShow(button)) return hide();
        const label = button.dataset.tip || button.dataset.tooltip || button.getAttribute('aria-label');
        if (!label) return hide();
        tooltip.textContent = label;
        tooltip.hidden = false;
        button.setAttribute('aria-describedby', tooltip.id);
        const rect = button.getBoundingClientRect(), width = tooltip.offsetWidth, height = tooltip.offsetHeight;
        const point = place?.(button, rect, { width, height }) || { x: rect.left + (rect.width - width) / 2, y: rect.top - height - 8 };
        tooltip.style.left = clamp(point.x, 8, Math.max(8, innerWidth - width - 8)) + 'px';
        tooltip.style.top = clamp(point.y < 8 ? rect.bottom + 8 : point.y, 8, Math.max(8, innerHeight - height - 8)) + 'px';
        motion.enter();
      }, delay);
    }
    const over = event => { const button = event.target.closest?.(selector); if (button && !button.contains(event.relatedTarget)) showFor(button); };
    const out = event => { const button = event.target.closest?.(selector); if (button && !button.contains(event.relatedTarget)) hide(); };
    const focus = event => showFor(event.target);
    eventRoot.addEventListener('pointerover', over);
    eventRoot.addEventListener('pointerout', out);
    eventRoot.addEventListener('focusin', focus);
    eventRoot.addEventListener('focusout', hide);
    eventRoot.addEventListener('pointerdown', hide);
    return { hide, destroy() { hide(); motion.destroy(); tooltip.remove(); eventRoot.removeEventListener('pointerover', over); eventRoot.removeEventListener('pointerout', out); eventRoot.removeEventListener('focusin', focus); eventRoot.removeEventListener('focusout', hide); eventRoot.removeEventListener('pointerdown', hide); } };
  }

  const api = { clamp, createPresenceMotion, createMenu, createTooltip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReplicaUI = api;
})(typeof window === 'undefined' ? globalThis : window);
