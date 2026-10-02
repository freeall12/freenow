const el = (tag, cls, text) => {const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e;};
const css = el('link', ''); css.rel = 'stylesheet'; css.href = new URL('./styles.css', import.meta.url); document.head.append(css);
// Official rP = Tabler focus-2, read from the live selection toolbar.
const focusIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r=".5" fill="currentColor"/><path d="M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M12 3l0 2M3 12l2 0M12 19l0 2M19 12l2 0"/></svg>';
let current = null;
function animateBanner(banner, exiting = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {if (exiting) banner.remove(); return;}
  banner.getAnimations().forEach(animation => animation.cancel());
  const frames = Array.from({length: 46}, (_, index) => {
    const t = index / 60, w = Math.sqrt(200), residual = Math.exp(-10 * t) * (Math.cos(w * t) + 10 / w * Math.sin(w * t));
    const progress = exiting ? 1 - residual : residual;
    return {offset: index / 45, opacity: Math.max(0, Math.min(1, 1 - progress)), transform: `translate(-50%,${-20 * progress}px) scale(${1 - .1 * progress})`};
  });
  const animation = banner.animate(frames, {duration: 750, fill: 'forwards'});
  if (exiting) {banner.style.pointerEvents = 'none'; animation.finished.then(() => banner.remove()).catch(() => banner.remove());}
}
export function pickFrame(options) {
  return pickReference({...options, title: options.slot === 'first' ? '选择首帧' : '选择尾帧', allowedTypes: ['image']});
}

// Xn/BMe/VMe/oMe/Kj: one shared canvas selection mode, with world-positioned
// overlays and a screen-positioned hover label. No source media is remounted.
export function pickReference({app, targetId, slot = 'reference', title = '从画布选择参考', allowedTypes, onSelect, onClose}) {
  current?.close({restoreFocus:false});
  const trigger=document.activeElement, triggerHost=trigger?.closest?.('.node-editor');
  const triggerSelector=slot==='reference'?'.reference-add':`.video-frame-slot[data-frame="${slot}"]`;
  const canvas = document.querySelector('#canvas'), roots = new Map(), eligible = new Set();
  let closed = false, space = false, gesture = null, signature = '', panFrame = 0, pendingPan = null;
  const banner = el('section', 'canvas-reference-banner'); banner.ariaLabel = title;
  const heading = el('strong', '', title), exit = el('button', '', '退出'); exit.type = 'button'; exit.onclick = () => close({restoreFocus:true});
  const back = el('button', 'canvas-reference-return'), divider = el('span', 'canvas-reference-divider');
  back.type = 'button'; back.ariaLabel = '返回来源节点'; back.innerHTML = focusIcon; back.hidden = divider.hidden = true;
  back.onclick = () => {
    finishGesture();
    const {nodes, view} = app.getState(), node = nodes.find(n => n.id === targetId); if (!node) return close({discardPending: true});
    const rect = canvas.getBoundingClientRect();
    // Official oMe centers 40% of the node height below its center, at the same zoom.
    app.transitionView({scale: view.scale, x: rect.width / 2 - (node.x + node.width / 2) * view.scale, y: rect.height / 2 - (node.y + node.height * .9) * view.scale}, 500);
  };
  const hover = el('div', 'canvas-reference-hover'), verb = el('span', '', '选择 '), name = el('span', ''); hover.append(verb, name);
  banner.append(heading, back, divider, exit); document.body.append(banner, hover); document.body.classList.add('canvas-reference-picking'); animateBanner(banner);
  const controller = {close, slot}; current = controller;
  function clearPan() {cancelAnimationFrame(panFrame); panFrame = 0; pendingPan = null;}
  function flushPan() {
    const next = pendingPan; clearPan();
    if (next && gesture && !closed) app.setView(next);
  }
  function finishGesture() {
    const pointer = gesture?.pointer;
    flushPan(); gesture = null;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  }
  function clearRoot(root) {root.classList.remove('canvas-reference-candidate', 'canvas-reference-ineligible'); root.querySelectorAll(':scope > .canvas-reference-hit,:scope > .canvas-reference-source').forEach(e => e.remove());}
  function close(options) {
    if (closed) return;
    if (options?.discardPending) clearPan(); else flushPan();
    if (closed) return; closed = true; if (current === controller) current = null;
    const pointer = gesture?.pointer;
    clearPan();gesture = null;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    banner.inert=true;banner.setAttribute('aria-hidden', 'true'); animateBanner(banner, true); hover.remove(); document.body.classList.remove('canvas-reference-picking');
    for (const root of roots.values()) clearRoot(root);
    document.removeEventListener('canvas:render', render); canvas.removeEventListener('keydown', key); banner.removeEventListener('keydown', key); document.removeEventListener('keydown', bodyKey, true); document.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); window.removeEventListener('pagehide', pagehide); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside);
    for (const [type, listener] of pointerListeners) canvas.removeEventListener(type, listener, true);
    onClose?.();
    if(options?.restoreFocus){const anchor=trigger?.isConnected?trigger:triggerHost?.querySelector(triggerSelector);anchor?.focus({preventScroll:true});}
  }
  function select(id) {
    if (!eligible.has(id)) return;
    try {onSelect(id); close();} catch (error) {app.notify(error.message);}
  }
  function render(event) {
    if (closed) return;
    const state = app.getState(), target = state.nodes.find(n => n.id === targetId);
    if (!target || state.selected.length !== 1 || state.selected[0] !== targetId) return close({discardPending: true});
    const rect = canvas.getBoundingClientRect(), center = {x: (rect.width / 2 - state.view.x) / state.view.scale, y: (rect.height / 2 - state.view.y) / state.view.scale};
    back.hidden = divider.hidden = Math.hypot(center.x - target.x - target.width / 2, center.y - target.y - target.height / 2) <= 200;
    // Viewport-only renders retain the same node elements and graph. The world
    // transform already moves hit targets; only the screen toolbar needs work.
    if (event?.detail?.viewportOnly) return;
    // Pan/zoom changes only the toolbar. Graph changes invalidate compatibility;
    // rebuilding node DOM is detected separately without replacing media.
    const next = state.nodes.map(n => `${n.id}:${n.type}:${!!n.pendingOperation}`).join('|') + state.edges.map(e => `${e.source}>${e.target}`).join('|');
    const changed = signature !== next; signature = next;
    if (changed) {
      eligible.clear();
      for (const node of state.nodes) if (node.id !== targetId && allowedTypes.includes(node.type) && !node.pendingOperation && !window.CanvasConnections?.validate(node.id, targetId)) eligible.add(node.id);
    }
    for (const node of state.nodes) {
      let root = roots.get(node.id);
      const remounted = !root?.isConnected;
      if (remounted) {root = document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`); if (!root) continue; roots.set(node.id, root);}
      if (!changed && !remounted) continue;
      clearRoot(root);
      if (node.id === targetId) {
        const overlay = el('div', 'canvas-reference-source'), hint = el('span', ''); hint.append(el('kbd', '', 'ESC'), document.createTextNode(' 退出')); overlay.append(hint); root.append(overlay);
      } else if (eligible.has(node.id)) {
        root.classList.add('canvas-reference-candidate');
        const hit = el('button', 'canvas-reference-hit'); hit.type = 'button'; hit.dataset.sourceId = node.id; hit.ariaLabel = title + '：' + node.title;
        hit.onclick = event => {event.stopPropagation(); if (!event.detail && !space) select(node.id);};
        hit.onpointermove = event => {if (gesture?.moved) return; name.textContent = node.title; hover.style.transform = `translate(${event.clientX}px,${event.clientY - 8}px) translate(-50%,-100%)`; hover.style.opacity = '1';};
        hit.onpointerleave = () => {hover.style.opacity = '0';}; root.append(hit);
      } else root.classList.add('canvas-reference-ineligible');
    }
    for (const [id, root] of roots) if (!root.isConnected) roots.delete(id);
  }
  function down(event) {
    if (event.button !== 0 || space) return;
    event.preventDefault(); event.stopImmediatePropagation();
    flushPan();
    const view = app.getState().view;
    gesture = {pointer: event.pointerId, x: event.clientX, y: event.clientY, view, id: event.target.closest('.canvas-reference-hit')?.dataset.sourceId, moved: false};
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (gesture.moved) {
      event.stopImmediatePropagation(); hover.style.opacity = '0';
      // This capture-phase selection mode bypasses the main canvas gesture
      // scheduler. Commit only its latest pan sample before each paint.
      pendingPan = {...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy};
      if (!panFrame) panFrame = requestAnimationFrame(flushPan);
    }
  }
  function up(event) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    event.stopImmediatePropagation(); const completed = gesture; flushPan(); gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!completed.moved) select(completed.id);
  }
  function cancel(event) {if (event && gesture?.pointer !== event.pointerId) return;finishGesture();}
  function click(event) {if (event.detail) {event.preventDefault(); event.stopImmediatePropagation();}}
  function owns(target){return target===document.body||canvas.contains(target)||banner.contains(target);}
  function isTrigger(target){return trigger?.contains?.(target)||!!triggerHost?.querySelector(triggerSelector)?.contains(target);}
  function key(event) {if(document.querySelector('dialog[open]')||event.defaultPrevented||event.isComposing||event.keyCode===229||!owns(event.target)||event.target.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]'))return;finishGesture();if(event.code==='Space')space=true;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close({restoreFocus:true});}}
  // Canvas/banner bubbling wins before the host's document Escape clears selection.
  function bodyKey(event){if(event.target===document.body)key(event);}
  function outside(event){if(!owns(event.target)&&!isTrigger(event.target))close({restoreFocus:false});}
  function pagehide(){close({discardPending:true,restoreFocus:false});}
  function keyUp(event) {if (event.code === 'Space') space = false;}
  function blur() {space = false;cancel();hover.style.opacity = '0';}
  const pointerListeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['wheel', finishGesture], ['click', click], ['dblclick', click]];
  for (const [type, listener] of pointerListeners) canvas.addEventListener(type, listener, true);
  document.addEventListener('canvas:render', render); canvas.addEventListener('keydown', key); banner.addEventListener('keydown', key); document.addEventListener('keydown', bodyKey, true); document.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur); window.addEventListener('pagehide', pagehide); document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside); render();if(!closed)exit.focus({preventScroll:true});
  return controller;
}
