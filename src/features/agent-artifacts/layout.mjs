export function geometry({ anchor, viewportHeight, width, height, detail, expanded, contentHeight = 200 }) {
  const minimum = detail ? Math.min(380, Math.max(280, anchor.height - 24)) : 200;
  const maximum = Math.max(280, anchor.height || viewportHeight - anchor.top - 16);
  const actualWidth = expanded ? 520 : Math.max(320, Math.min(520, width));
  const actualHeight = expanded ? maximum : height == null ? detail ? minimum : Math.max(200, Math.min(480, contentHeight)) : Math.max(minimum, Math.min(maximum, height));
  return { left: Math.max(8, anchor.left - actualWidth - 12), top: anchor.top, width: actualWidth, height: actualHeight, minimum, maximum };
}

export function createLayout({ element, content, anchor, isDetail, onError }) {
  let width = 320, height = null, expanded = false, frame = 0, drag = null, transitionTimer = 0;
  let lastAnchor = anchor?.getBoundingClientRect() || { top: 0, height: innerHeight };
  const handles = [];
  function measure() {
    if (anchor?.isConnected) lastAnchor = anchor.getBoundingClientRect();
    const bounds = anchor?.isConnected ? lastAnchor : { left: innerWidth + 12, top: lastAnchor.top, height: Math.max(280, innerHeight - lastAnchor.top) };
    return geometry({ anchor: bounds, viewportHeight: innerHeight, width, height, detail: isDetail(), expanded, contentHeight: content.firstElementChild?.scrollHeight || 200 });
  }
  function apply() {
    frame = 0;
    if (!element.isConnected) return;
    const next = measure();
    for (const key of ['left', 'top', 'width', 'height']) element.style[key] = next[key] + 'px';
    for (const handle of handles) {
      const vertical = handle.dataset.axis === 'width';
      handle.setAttribute('aria-valuenow', next[vertical ? 'width' : 'height']);
      handle.setAttribute('aria-valuemin', vertical ? 320 : next.minimum);
      handle.setAttribute('aria-valuemax', vertical ? 520 : next.maximum);
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(apply); }
  function persist() {
    try {
      localStorage.setItem('artifact-panel-width', String(width));
      if (height != null) localStorage.setItem('artifact-panel-height', String(height));
    } catch { onError?.('产物面板尺寸未能保存'); }
  }
  function collapseExpanded() {
    const current = measure();
    width = current.width; height = current.height; expanded = false;
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const bounds = measure();
    if (drag.axis === 'width') width = Math.max(320, Math.min(520, drag.width + drag.x - event.clientX));
    else height = Math.max(bounds.minimum, Math.min(bounds.maximum, drag.height + event.clientY - drag.y));
    schedule();
  }
  function end() {
    if (!drag) return;
    const previous = drag; drag = null;
    if (previous.handle.hasPointerCapture(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    element.removeAttribute('data-resizing');
    document.body.classList.remove('agent-artifact-resizing');
    apply(); persist();
  }
  for (const axis of ['width', 'height']) {
    const handle = document.createElement('div');
    handle.className = 'agent-artifact-resize'; handle.dataset.axis = axis;
    handle.role = 'separator'; handle.tabIndex = 0;
    handle.setAttribute('aria-label', axis === 'width' ? '调整文件面板宽度' : '调整文件面板高度');
    handle.setAttribute('aria-orientation', axis === 'width' ? 'vertical' : 'horizontal');
    const dots = document.createElement('span');
    for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
    handle.append(dots); element.append(handle); handles.push(handle);
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      collapseExpanded();
      const bounds = measure();
      drag = { axis, handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
      element.dataset.resizing = axis; document.body.classList.add('agent-artifact-resizing');
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = move;
    handle.onpointerup = event => { move(event); end(); };
    handle.onpointercancel = handle.onlostpointercapture = end;
    handle.onkeydown = event => {
      const keys = axis === 'width' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp'];
      if (![...keys, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); collapseExpanded();
      const bounds = measure(), min = axis === 'width' ? 320 : bounds.minimum, max = axis === 'width' ? 520 : bounds.maximum;
      const next = event.key === 'Home' ? min : event.key === 'End' ? max : bounds[axis] + (event.key === keys[0] ? 10 : -10);
      if (axis === 'width') width = Math.max(min, Math.min(max, next)); else height = Math.max(min, Math.min(max, next));
      apply(); persist();
    };
  }
  const observer = new ResizeObserver(schedule); if (anchor) observer.observe(anchor);
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); window.addEventListener('blur', end);
  return {
    reset() { end(); width = 320; height = null; expanded = false; apply(); },
    mode(detail) { clearTimeout(transitionTimer); element.dataset.transitioning = 'true'; expanded = detail; height = null; apply(); transitionTimer = setTimeout(() => { delete element.dataset.transitioning; }, 340); },
    setAnchor(next) {
      end();
      if (anchor?.isConnected) lastAnchor = anchor.getBoundingClientRect();
      observer.disconnect(); anchor = next;
      if (anchor) observer.observe(anchor); else expanded = false;
      clearTimeout(transitionTimer); element.dataset.transitioning = 'true'; apply();
      transitionTimer = setTimeout(() => { delete element.dataset.transitioning; }, 340);
    },
    update: schedule,
    destroy() { end(); clearTimeout(transitionTimer); cancelAnimationFrame(frame); observer.disconnect(); handles.forEach(handle => handle.remove()); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.removeEventListener('blur', end); },
  };
}
