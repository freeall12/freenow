/**
 * Scoped Studio menu controller. It owns only DOM, focus and dismissal.
 * contentFactory({ close, contains }) returns a DOM node with optional dispose().
 * Nested menus retain their parent; actions own domain mutations.
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
  const chain = () => {
    const states = [];
    for (let state = active; state; state = state.parent) states.unshift(state);
    return states;
  };
  const live = state => !state.closed && chain().includes(state);
  const owner = target => chain().find(state => state.surface.contains(target));
  const contains = target => { validate(); return !!owner(target); };
  const isOpen = () => { validate(); return active !== null; };
  const report = error => { if (onError) onError(error); else throw error; };

  function disposeContent(state, errors) {
    if (!state.content || state.contentDisposed) return;
    state.contentDisposed = true;
    try { state.content.dispose?.(); } catch (error) { errors.push(error); }
  }

  function closeFrom(state, restoreFocus = true) {
    if (!state || !live(state)) return false;
    const closing = [];
    for (let child = active; child; child = child.parent) {
      closing.push(child);
      if (child === state) break;
    }
    active = state.parent;
    const errors = [];
    for (const child of closing) {
      child.closed = true;
      window.clearTimeout(child.enterTimer);
      window.clearTimeout(child.hoverTimer);
      child.observer?.disconnect();
      if (child.anchor?.getAttribute('aria-controls') === child.id) {
        child.anchor.setAttribute('aria-expanded', 'false');
        child.anchor.removeAttribute('aria-controls');
      }
      child.surface.dataset.exiting = 'true';
      child.surface.dataset.visible = 'false';
      child.surface.inert = true;
      child.surface.setAttribute('aria-hidden', 'true');
      child.surface.style.pointerEvents = 'none';
      child.positionLayer.style.pointerEvents = 'none';
      child.remove = () => {
        window.clearTimeout(child.exitTimer);
        child.layer.remove();
        exits.delete(child);
      };
      exits.add(child);
      if (reduced()) child.remove();
      else child.exitTimer = window.setTimeout(child.remove, 160);
      disposeContent(child, errors);
    }
    if (restoreFocus && active === state.parent && state.origin?.isConnected) state.origin.focus({ preventScroll: true });
    for (const error of errors) report(error);
    return true;
  }

  function close({ restoreFocus = true, all = false } = {}) {
    return closeFrom(all ? chain()[0] : active, restoreFocus);
  }

  function closeDescendants(state) {
    const states = chain();
    const child = states[states.indexOf(state) + 1];
    if (child) closeFrom(child, false);
  }
  function closeUnrelatedDescendants(state, target) {
    const states = chain(), child = states[states.indexOf(state) + 1];
    if (child && !child.anchor?.contains(target)) closeFrom(child, false);
  }

  function validate() {
    for (const state of chain()) {
      if (!state.mounted) continue;
      if (!root.isConnected || !root.contains(state.layer) || !state.layer.contains(state.surface) || !state.surface.isConnected ||
          (state.anchor && (!state.anchor.isConnected || !root.contains(state.anchor))) ||
          (state.parent && !state.parent.surface.contains(state.anchor))) {
        closeFrom(state, false);
        break;
      }
    }
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
      const horizontal = placement === 'right' || placement === 'left';
      const offset = options.offset ?? (horizontal || placement === 'top' ? 4 : 0);
      if (horizontal) {
        const rightSpace = viewportWidth - anchor.right - offset - margin, leftSpace = anchor.left - offset - margin;
        const preferRight = placement === 'right';
        const right = preferRight ? rightSpace >= width || rightSpace >= leftSpace : leftSpace < width && rightSpace > leftSpace;
        left = right ? anchor.right + offset : anchor.left - width - offset;
        top = anchor.top; available = viewportHeight - margin * 2;
        state.surface.dataset.motion = right ? 'fromLeft' : 'fromRight';
      } else {
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
    }
    left = clamp(left, margin, viewportWidth - width - margin);
    top = clamp(top, margin, viewportHeight - Math.min(height, available) - margin);
    state.layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    state.surface.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    state.surface.style.maxHeight = `${Math.max(0, Math.floor(available))}px`;
  }

  function open(position, anchor, contentFactory, options = {}, parent = null) {
    if (disposed) throw new Error('Studio menu controller is disposed');
    if (typeof contentFactory !== 'function') throw new TypeError('Menu contentFactory must be a function');
    const origin = anchor ?? document.activeElement;
    if (!parent) close({ restoreFocus: false, all: true });
    if (!root.isConnected || (anchor && (anchor.ownerDocument !== document || !anchor.isConnected || !root.contains(anchor))) ||
        (parent && (!live(parent) || !parent.surface.contains(anchor)))) return null;
    const portal = document.createElement('div');
    portal.className = 'studio-v3 sv3-portal';
    const layer = document.createElement('div');
    layer.className = 'sv3-pointer-menu';
    if (parent) layer.style.zIndex = '96';
    const surface = document.createElement('div');
    surface.className = 'sv3-menu sv3-motion';
    surface.id = `studio-v3-menu-${++sequence}`;
    surface.setAttribute('role', options.role || 'menu');
    surface.setAttribute('tabindex', '-1');
    if (options.label) surface.setAttribute('aria-label', options.label);
    if (options.width) surface.style.width = typeof options.width === 'number' ? `${options.width}px` : options.width;
    layer.append(surface);
    portal.append(layer);
    const state = { layer: portal, surface, positionLayer: layer, anchor, origin, id: surface.id, parent, closed: false, mounted: false };
    // Position and animation use separate elements; stale detached actions cannot execute.
    surface.addEventListener('click', event => {
      validate();
      if (!live(state)) { event.preventDefault(); event.stopImmediatePropagation(); }
      else closeUnrelatedDescendants(state, event.target);
    }, true);
    surface.addEventListener('pointerdown', event => event.stopPropagation());
    active = state;
    try {
      const node = contentFactory({
        close: ({ restoreFocus = true } = {}) => { validate(); return closeFrom(state, restoreFocus); },
        contains: target => {
          validate();
          const states = chain(), index = states.indexOf(state);
          return index >= 0 && states.slice(index).some(child => child.surface.contains(target));
        }
      });
      state.content = node;
      if (!node?.nodeType || node.ownerDocument !== document) throw new TypeError('Menu factory must return a DOM node from the same document');
      if (!live(state)) {
        const errors = []; disposeContent(state, errors);
        for (const error of errors) report(error);
        return null;
      }
      surface.append(node);
      for (const button of surface.querySelectorAll('button')) {
        if ((options.role || 'menu') === 'menu' && !button.hasAttribute('role')) button.setAttribute('role', 'menuitem');
      }
      // Same scoped root coordinate system as official body Portal, without global CSS.
      root.append(portal);
      state.mounted = true;
      validate();
      if (!live(state)) return null;
      place({ ...state, layer }, position, options);
      if (window.ResizeObserver) {
        state.observer = new window.ResizeObserver(() => {
          validate();
          if (live(state)) place({ ...state, layer }, position, options);
        });
        state.observer.observe(surface);
      }
      anchor?.setAttribute('aria-haspopup', 'menu');
      anchor?.setAttribute('aria-expanded', 'true');
      anchor?.setAttribute('aria-controls', state.id);
      if (parent && options.hoverDismiss) {
        const keep = () => window.clearTimeout(state.hoverTimer);
        const leave = event => {
          keep(); if (anchor.contains(event.relatedTarget) || surface.contains(event.relatedTarget)) return;
          state.hoverTimer = window.setTimeout(() => {
            if (live(state) && !anchor.matches(':hover') && !surface.matches(':hover') && !surface.contains(document.activeElement)) closeFrom(state, false);
          }, 180);
        };
        for (const node of [anchor, surface]) {node.addEventListener('pointerenter', keep); node.addEventListener('pointerleave', leave);}
        const dispose = state.content.dispose;
        state.content.dispose = () => {
          keep(); for (const node of [anchor, surface]) {node.removeEventListener('pointerenter', keep); node.removeEventListener('pointerleave', leave);}
          dispose?.call(state.content);
        };
      }
      state.enterTimer = window.setTimeout(() => {
        validate();
        if (live(state)) surface.dataset.visible = 'true';
      }, 0);
      const focusTarget = surface.querySelector('input:not(:disabled),textarea:not(:disabled),[autofocus],button:not(:disabled)');
      if (options.focus !== false) (focusTarget ?? surface).focus({ preventScroll: true });
      return surface;
    } catch (error) {
      const errors = [];
      try { closeFrom(state); } catch (cleanupError) { errors.push(cleanupError); }
      disposeContent(state, errors);
      portal.remove();
      report(error);
      for (const cleanupError of errors) report(cleanupError);
      return null;
    }
  }

  const toggle = (anchor, factory, options) => {
    if (!anchor?.getBoundingClientRect) throw new TypeError('Menu anchor must be a DOM element');
    validate();
    if (chain()[0]?.anchor === anchor) { close({ all: true }); return null; }
    return open({ kind: 'anchor' }, anchor, factory, options);
  };
  const openAt = ({ x, y }, factory, options) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Pointer menu coordinates must be finite');
    return open({ kind: 'point', x, y }, null, factory, options);
  };
  const openNested = (anchor, factory, options) => {
    if (disposed) throw new Error('Studio menu controller is disposed');
    if (!anchor?.getBoundingClientRect) throw new TypeError('Menu anchor must be a DOM element');
    validate();
    const parent = owner(anchor);
    if (!parent || !anchor.isConnected) return null;
    closeDescendants(parent);
    validate();
    return open({ kind: 'anchor' }, anchor, factory, options, parent);
  };
  listen(document, 'pointerdown', event => {
    validate();
    const parent = owner(event.target);
    if (parent) closeUnrelatedDescendants(parent, event.target);
    else if (active && !chain()[0].anchor?.contains(event.target)) close({ all: true });
  }, true);
  listen(document, 'focusin', event => {
    validate();
    const parent = owner(event.target);
    if (parent) closeUnrelatedDescendants(parent, event.target);
    else if (active && !chain()[0].anchor?.contains(event.target)) close({ restoreFocus: false, all: true });
  });
  listen(document, 'wheel', event => { if (active && !contains(event.target)) close({ all: true }); }, { capture: true, passive: true });
  listen(window, 'resize', () => close({ all: true }));
  listen(window, 'blur', () => close({ all: true }));
  if (window.MutationObserver) {
    const observer = new window.MutationObserver(validate);
    observer.observe(document, { childList: true, subtree: true });
    removers.push(() => observer.disconnect());
  }
  listen(document, 'keydown', event => {
    validate();
    if (!active || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key === 'Process') return;
    if (event.key === 'Escape' && (contains(event.target) || event.target === active.anchor || event.target === document.body) && active.content?.handleEscape?.() === true) {
      event.preventDefault(); event.stopPropagation(); return;
    }
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
    if (disposed) return;
    disposed = true;
    try { close({ restoreFocus: false, all: true }); }
    finally {
      for (const state of exits) state.remove();
      for (const remove of removers) remove();
      removers.length = 0;
    }
  };
  return { toggle, openAt, openNested, close, isOpen, contains, dispose };
}
