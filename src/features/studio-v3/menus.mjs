/**
 * Scoped Studio menu controller. It owns only DOM, focus and dismissal.
 * contentFactory({ close, contains }) returns a DOM node; actions own domain mutations.
 */
export function createMenus({ root, onError } = {}) {
  if (!root?.ownerDocument) throw new TypeError('Studio menu root must be a DOM element');
  const document = root.ownerDocument;
  const window = document.defaultView;
  let active = null;
  let disposed = false;
  let sequence = 0;
  const removers = [];
  const exits = new Set();
  const editable = target => !!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };
  const contains = target => !!active?.surface.contains(target);
  const isOpen = () => active !== null;

  function close({ restoreFocus = true } = {}) {
    const state = active;
    if (!state) return false;
    active = null;
    window.clearTimeout(state.enterTimer);
    state.observer?.disconnect();
    state.anchor?.setAttribute('aria-expanded', 'false');
    if (state.anchor?.getAttribute('aria-controls') === state.id) state.anchor.removeAttribute('aria-controls');
    state.surface.dataset.exiting = 'true';
    state.surface.dataset.visible = 'false';
    state.surface.inert = true;
    state.surface.setAttribute('aria-hidden', 'true');
    state.surface.style.pointerEvents = 'none';
    const remove = () => {
      window.clearTimeout(state.exitTimer);
      state.layer.remove();
      exits.delete(state);
    };
    state.remove = remove;
    exits.add(state);
    if (reduced()) remove();
    else state.exitTimer = window.setTimeout(remove, 160);
    if (restoreFocus && state.origin?.isConnected) state.origin.focus({ preventScroll: true });
    return true;
  }

  function place(state, position, options) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = state.surface.getBoundingClientRect();
    const width = rect.width || Number(options.width) || (position.kind === 'point' ? 240 : 224);
    const height = rect.height || (position.kind === 'point' ? 220 : 180);
    const margin = 8;
    let left;
    let top;
    let available = viewportHeight - margin * 2;
    if (position.kind === 'point') {
      const offset = options.offset ?? 8;
      left = position.x + (typeof offset === 'number' ? offset : offset.x ?? 8);
      top = position.y + (typeof offset === 'number' ? offset : offset.y ?? 8);
      state.surface.dataset.motion = 'fromAbove';
    } else {
      const anchor = state.anchor.getBoundingClientRect();
      const placement = options.placement ?? 'top';
      const offset = options.offset ?? (placement === 'top' ? 4 : 0);
      left = options.align === 'end' ? anchor.right - width : options.align === 'center' ? anchor.left + anchor.width / 2 - width / 2 : anchor.left;
      const above = Math.max(0, anchor.top - offset - margin);
      const below = Math.max(0, viewportHeight - anchor.bottom - offset - margin);
      let side = placement === 'top' ? 'above' : 'below';
      const preferred = side === 'above' ? above : below;
      const alternate = side === 'above' ? below : above;
      if (height > preferred && (height <= alternate || preferred < Math.min(96, alternate))) side = side === 'above' ? 'below' : 'above';
      available = side === 'above' ? above : below;
      top = side === 'above' ? anchor.top - offset - Math.min(height, available) : anchor.bottom + offset;
      state.surface.dataset.motion = side === 'above' ? 'fromBelow' : 'fromAbove';
    }
    left = clamp(left, margin, viewportWidth - width - margin);
    top = clamp(top, margin, viewportHeight - Math.min(height, available) - margin);
    state.layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    state.surface.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    state.surface.style.maxHeight = `${Math.max(0, Math.floor(available))}px`;
  }

  function open(position, anchor, contentFactory, options = {}) {
    if (disposed) throw new Error('Studio menu controller is disposed');
    if (typeof contentFactory !== 'function') throw new TypeError('Menu contentFactory must be a function');
    const origin = anchor ?? document.activeElement;
    close({ restoreFocus: false });
    const portal = document.createElement('div');
    portal.className = 'studio-v3 sv3-portal';
    const layer = document.createElement('div');
    layer.className = 'sv3-pointer-menu';
    const surface = document.createElement('div');
    surface.className = 'sv3-menu sv3-motion';
    surface.id = `studio-v3-menu-${++sequence}`;
    surface.setAttribute('role', 'menu');
    surface.setAttribute('tabindex', '-1');
    if (options.label) surface.setAttribute('aria-label', options.label);
    if (options.width) surface.style.width = typeof options.width === 'number' ? `${options.width}px` : options.width;
    layer.append(surface);
    portal.append(layer);
    const state = { layer: portal, surface, positionLayer: layer, anchor, origin, id: surface.id };
    // Position and animation use separate elements; stale detached actions cannot execute.
    surface.addEventListener('click', event => {
      if (active !== state) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    surface.addEventListener('pointerdown', event => event.stopPropagation());
    active = state;
    try {
      const node = contentFactory({ close: options => active === state ? close(options) : false, contains: target => active === state && contains(target) });
      if (!node?.nodeType || node.ownerDocument !== document) throw new TypeError('Menu factory must return a DOM node from the same document');
      surface.append(node);
      for (const button of surface.querySelectorAll('button')) {
        if (!button.hasAttribute('role')) button.setAttribute('role', 'menuitem');
      }
      if (active !== state) return null;
      // Same scoped root coordinate system as official body Portal, without global CSS.
      root.append(portal);
      place({ ...state, layer }, position, options);
      if (window.ResizeObserver) {
        state.observer = new window.ResizeObserver(() => {
          if (active === state) place({ ...state, layer }, position, options);
        });
        state.observer.observe(surface);
      }
      anchor?.setAttribute('aria-haspopup', 'menu');
      anchor?.setAttribute('aria-expanded', 'true');
      anchor?.setAttribute('aria-controls', state.id);
      state.enterTimer = window.setTimeout(() => {
        if (active === state) surface.dataset.visible = 'true';
      }, 0);
      const focusTarget = surface.querySelector('input:not(:disabled),textarea:not(:disabled),[autofocus],button:not(:disabled)');
      (focusTarget ?? surface).focus({ preventScroll: true });
      return surface;
    } catch (error) {
      close({ restoreFocus: true });
      portal.remove();
      if (onError) { onError(error); return null; }
      throw error;
    }
  }

  const toggle = (anchor, factory, options) => {
    if (!anchor?.getBoundingClientRect) throw new TypeError('Menu anchor must be a DOM element');
    if (active?.anchor === anchor) { close(); return null; }
    return open({ kind: 'anchor' }, anchor, factory, options);
  };
  const openAt = ({ x, y }, factory, options) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Pointer menu coordinates must be finite');
    return open({ kind: 'point', x, y }, null, factory, options);
  };
  listen(document, 'pointerdown', event => {
    if (active && !contains(event.target) && !active.anchor?.contains(event.target)) close();
  }, true);
  listen(document, 'focusin', event => {
    if (active && !contains(event.target) && !active.anchor?.contains(event.target)) close({ restoreFocus: false });
  });
  listen(document, 'wheel', event => { if (active && !contains(event.target)) close(); }, { capture: true, passive: true });
  listen(window, 'resize', () => close());
  listen(window, 'blur', () => close());
  listen(document, 'keydown', event => {
    if (!active || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key === 'Process') return;
    if (editable(event.target)) return;
    if (!contains(event.target) && event.target !== active.anchor && event.target !== document.body) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...active.surface.querySelectorAll('button:not(:disabled)')].filter(button => !button.closest('[hidden],[aria-hidden="true"],[inert]'));
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
    event.preventDefault(); event.stopPropagation();
    buttons[next].focus({ preventScroll: true });
    buttons[next].scrollIntoView?.({ block: 'nearest' });
  }, true);
  const dispose = () => {
    close({ restoreFocus: false });
    disposed = true;
    for (const state of exits) state.remove();
    for (const remove of removers) remove();
    removers.length = 0;
  };
  return { toggle, openAt, close, isOpen, contains, dispose };
}
