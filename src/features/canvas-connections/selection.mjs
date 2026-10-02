import {icons} from './icons.mjs';
import {openMenu, nodeDraft, keyboardBlocked} from './menu.mjs';
import {classify, selectionSources, selectionInputs, selectionBounds, selectionMenuAnchor, videoSelectionConfig} from './selection-model.mjs';

export function installSelection(app, canvas, onStart) {
  const handle = document.createElement('button');
  handle.className = 'selection-connection-handle'; handle.type = 'button'; handle.hidden = true;
  handle.setAttribute('aria-label', '引用选中节点生成'); handle.innerHTML = icons.plus;
  handle.setAttribute('aria-haspopup', 'listbox'); handle.setAttribute('aria-expanded', 'false');
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  preview.classList.add('selection-connection-preview'); preview.setAttribute('aria-hidden', 'true');
  const junction = document.createElement('span');
  junction.className = 'selection-connection-junction'; junction.innerHTML = icons.plus; junction.hidden = true;
  canvas.append(preview, junction, handle);
  let sources = [], bounds = null, view = null, palette = null, point = null, pointer = null, ids = '', frame = 0;
  let layoutMap = null, layoutSelection = [];
  const style = (element, key, value) => {if (element.style[key] !== value) element.style[key] = value;};
  const localPoint = event => {const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top};};
  const currentSources = () => {
    const state = app.getState();
    return selectionSources(state.nodes, state.selected);
  };
  function draw() {
    // Keep the capturing element mounted and hit-testable until pointerup.
    const hidden = sources.length < 2;
    if (handle.hidden !== hidden) handle.hidden = hidden;
    style(handle, 'opacity', point && !palette ? '0' : '');
    handle.setAttribute('aria-expanded', String(!!palette));
    if (bounds && view && sources.length >= 2) {style(handle, 'left', `${bounds.right * view.scale + view.x + 12}px`); style(handle, 'top', `${bounds.centerY * view.scale + view.y}px`);}
    if (preview.hidden !== !point) preview.hidden = !point;
    if (junction.hidden !== !point) junction.hidden = !point;
    if (!point || !view) {if (preview.childElementCount) preview.replaceChildren(); return;}
    while (preview.children.length > sources.length) preview.lastChild.remove();
    sources.forEach((node, index) => {
      let path = preview.children[index];
      if (!path) {path = document.createElementNS(preview.namespaceURI, 'path'); preview.append(path);}
      const x = (node.x + node.width) * view.scale + view.x, y = (node.y + node.height / 2) * view.scale + view.y, mid = (x + point.x) / 2;
      path.setAttribute('d', `M ${x} ${y} C ${mid} ${y}, ${mid} ${point.y}, ${point.x} ${point.y}`);
    });
    Object.assign(junction.style, {left: `${point.x}px`, top: `${point.y}px`});
  }
  function cancel(focus = false) {
    const captured = pointer; pointer = null;
    if (captured !== null && handle.hasPointerCapture(captured)) handle.releasePointerCapture(captured);
    cancelAnimationFrame(frame); frame = 0; palette?.remove(); palette = null; point = null;
    delete canvas.dataset.selectionConnectionActive; draw();
    if (focus === true) (handle.hidden ? canvas : handle).focus({preventScroll: true});
  }
  function open(anchor) {
    point = selectionMenuAnchor(anchor, canvas.getBoundingClientRect()); draw();
    const rect = canvas.getBoundingClientRect(), kind = classify(sources).kind;
    palette = openMenu({node: {type: 'selection'}, side: 'right', selectionKind: kind,
      anchor: {x: point.x + rect.left, y: point.y + rect.top}, close: cancel,
      create(type) {
        try {
          const nodes = currentSources();
          if (nodes.map(node => node.id).join('|') !== ids) throw Error('选区已改变，请重新连接');
          const ordered = selectionInputs(type, nodes);
          const origin = nodes.find(node => node.type === 'image' && node.generation?.isPanoramaPrompt) || nodes[0];
          const draft = nodeDraft(type, origin, 'right', {x: (point.x - view.x) / view.scale, y: bounds.centerY});
          if (type === 'video') draft.generation = videoSelectionConfig(draft.generation, nodes);
          const node = app.addSelectionConnectionNode(ordered, draft);
          if (type === 'imageEditor') setTimeout(() => {
            const current = app.getState().nodes.find(item => item.id === node.id);
            if (current) window.CanvasImageEditor?.open(current);
          }, 200);
        } catch (error) {app.notify(error.message);}
        finally {cancel(true);}
      }});
    Object.assign(palette.style, {left: `${rect.left + point.x}px`, top: `${rect.top + point.y + 16}px`, maxHeight: `${Math.max(52, innerHeight - rect.top - point.y - 28)}px`, transformOrigin: '50% -16px'});
    draw();
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || sources.length < 2) return;
    if (palette) {event.preventDefault(); event.stopImmediatePropagation(); cancel(true); return;}
    event.preventDefault(); event.stopImmediatePropagation(); onStart();
    handle.focus({preventScroll: true});
    window.CanvasCommands?.close(); window.CanvasMenus?.close();
    pointer = event.pointerId; canvas.dataset.selectionConnectionActive = 'true';
    point = localPoint(event); handle.setPointerCapture(pointer); draw();
  });
  handle.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    event.stopImmediatePropagation(); point = localPoint(event);
    if (!frame) frame = requestAnimationFrame(() => {frame = 0; draw();});
  });
  handle.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    event.preventDefault(); event.stopImmediatePropagation(); pointer = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    cancelAnimationFrame(frame); frame = 0; delete canvas.dataset.selectionConnectionActive;
    open(localPoint(event));
  });
  handle.addEventListener('click', event => {
    event.stopPropagation();
    if (event.detail === 0 && bounds) {if (palette) {cancel(true); return;} onStart(); open({x: bounds.right * view.scale + view.x + 22, y: bounds.centerY * view.scale + view.y});}
  });
  handle.addEventListener('pointercancel', cancel);
  handle.addEventListener('lostpointercapture', () => {if (pointer !== null) cancel();});
  document.addEventListener('pointerdown', event => {if (palette && !palette.contains(event.target) && !handle.contains(event.target)) cancel();}, true);
  document.addEventListener('focusin', event => {if (palette && !palette.contains(event.target) && !handle.contains(event.target)) cancel();});
  document.addEventListener('keydown', event => {
    if (!keyboardBlocked(event) && event.key === 'Escape' && point && !palette && canvas.contains(event.target)) {event.preventDefault(); event.stopImmediatePropagation(); cancel(true);}
  }, true);
  canvas.addEventListener('wheel', cancel, {capture: true, passive: true});
  window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
  return {cancel, render(state, byId) {
    if (state.viewportOnly && layoutMap === byId && layoutSelection.length === state.selected.length && layoutSelection.every((id, index) => id === state.selected[index])) {
      view = state.view;
      if (sources.length >= 2 || point) draw();
      return;
    }
    const next = state.selected.map(id => byId.get(id)).filter(node => node && node.type !== 'pile');
    const nextIds = next.map(node => node.id).join('|');
    if ((nextIds !== ids || next.length < 2) && (point || palette || pointer !== null || frame)) cancel();
    layoutMap = byId; layoutSelection = [...state.selected];
    sources = next; ids = nextIds; view = state.view; bounds = selectionBounds(sources); draw();
  }};
}
