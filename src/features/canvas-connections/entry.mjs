import {installSelection} from './selection.mjs';
import {selectionInputs} from './selection-model.mjs';
import {icons} from './icons.mjs';
import {bezier, direction, validateConnection} from './geometry.mjs';
import {createLayer} from './layer.mjs';
import {openMenu, nodeDraft, choices, keyboardBlocked} from './menu.mjs';
import {isFinalNode} from '../video-generation/draft-final.mjs';

export function install(app) {
  const canvas = document.querySelector('#canvas'), root = document.querySelector('#edges');
  const selected = new Set(), layer = createLayer(root, selected);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./styles.css', import.meta.url).href; document.head.append(css);
  let selection = null, drag = null, palette = null, pending = null, frame = 0, magnetic = null, releasingPort = null, releaseTimer = 0, motionTimer = 0;
  const worldPoint = point => {const rect = canvas.getBoundingClientRect(); return window.CanvasGeometry.toWorld(point, app.getState().view, {x: rect.left, y: rect.top});};
  const validate = (source, target, nodes = app.getState().nodes, edges = app.getState().edges) => validateConnection(nodes, edges, source, target, window.AudioCore?.specs, window.CanvasText?.models);
  function close(focus = false) {
    const origin = pending;
    palette?.remove(); palette = null; pending = null; layer.clearPreview();
    const trigger = origin && canvas.querySelector(`.node[data-id="${CSS.escape(origin.id)}"] .connection-port[data-port="${origin.side}"]`);
    trigger?.setAttribute('aria-expanded', 'false');
    if (focus) (trigger && !trigger.hidden ? trigger : canvas).focus({preventScroll: true});
  }
  function cancel() {
    selection?.cancel(); resetMagnet();
    const pointer = drag?.pointer; drag = null; cancelAnimationFrame(frame); frame = 0;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    delete canvas.dataset.connectionActive; close();
  }
  function open(id, side, anchor) {
    if (pending?.id === id && pending.side === side) {close(true); return;}
    close(); const node = app.getState().nodes.find(n => n.id === id); if (!node || !choices(node, side).length) return;
    app.select(null); window.CanvasCommands?.close(); window.CanvasMenus?.close();
    pending = {id, side, anchor}; layer.drawPreview(id, side, worldPoint(anchor));
    canvas.querySelector(`.node[data-id="${CSS.escape(id)}"] .connection-port[data-port="${side}"]`)?.setAttribute('aria-expanded', 'true');
    palette = openMenu({node, side, anchor, close, create(type) {
      try {
        const draft = nodeDraft(type, node, side, worldPoint(anchor));
        app.addConnectionNode(id, side, draft); close(true);
      } catch (error) {app.notify(error.message);}
    }});
  }
  function attachNode(node, element) {
    for (const port of element.querySelectorAll('.port')) {
      port.classList.add('connection-port'); port.innerHTML = `<span class="connection-plus">${icons.plus}</span>`;
      port.setAttribute('aria-haspopup', 'listbox'); port.setAttribute('aria-expanded', 'false');
      port.hidden = !['image', 'video', 'audio', 'text', 'world'].includes(node.type) || node.type === 'world' && port.dataset.port === 'right' || port.dataset.port === 'left' && node.type === 'text' && window.CanvasText.mode(node) === 'pure';
      port.addEventListener('pointerenter', () => {
        if (drag || app.getState().selected.length > 1) return;
        resetMagnet(); port.style.transition = 'none'; port.style.transform = 'translateY(-50%)'; port.style.willChange = 'transform';
        const r = port.getBoundingClientRect(); magnetic = {port, x: r.left + r.width / 2, y: r.top + r.height / 2, first: true};
      });
      port.addEventListener('pointerleave', resetMagnet);
      port.addEventListener('click', event => {
        if (event.detail !== 0) return;
        event.stopPropagation(); const r = port.getBoundingClientRect();
        open(node.id, port.dataset.port, {x: r.left + r.width / 2, y: r.top + r.height / 2});
      });
    }
  }
  function resetMagnet() {
    clearTimeout(motionTimer); clearTimeout(releaseTimer);
    if (releasingPort) releasingPort.style.willChange = '';
    if (magnetic) {const port = magnetic.port; releasingPort = port; port.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1)'; port.style.transform = 'translateY(-50%)'; releaseTimer = setTimeout(() => {port.style.willChange = ''; releasingPort = null;}, 400);}
    magnetic = null;
  }
  window.addEventListener('pointermove', event => {
    if (!magnetic || drag) return;
    const {port, x, y} = magnetic, scale = app.getState().view.scale, dx = (event.clientX - x) / scale, dy = (event.clientY - y) / scale;
    const left = port.dataset.port === 'left';
    if (dx < -(left ? 40 : 24) || dx > (left ? 24 : 40) || Math.abs(dy) > 40) {port.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1)'; port.style.transform = 'translateY(-50%)'; return;}
    if (magnetic.first) {magnetic.first = false; port.style.transition = 'transform .25s cubic-bezier(.34,1.8,.64,1)'; motionTimer = setTimeout(() => {if (magnetic?.port === port) port.style.transition = 'none';}, 250);}
    port.style.transform = `translate(${dx}px,calc(-50% + ${dy}px))`;
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.selection-connection-handle')) return;
    const port = event.target.closest('.connection-port'), edge = event.target.closest('[data-edge-id]');
    if (port) {
      if (pending?.id === port.closest('.node').dataset.id && pending.side === port.dataset.port) {
        event.preventDefault(); event.stopImmediatePropagation(); close(true); return;
      }
      event.preventDefault(); event.stopImmediatePropagation(); resetMagnet(); close(); selected.clear();
      drag = {id: port.closest('.node').dataset.id, side: port.dataset.port, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false};
      canvas.setPointerCapture(event.pointerId); canvas.focus({preventScroll: true}); return;
    }
    if (edge) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
      app.select(null); if (!event.shiftKey) selected.clear();
      const id = edge.dataset.edgeId; if (selected.has(id)) selected.delete(id); else selected.add(id);
      canvas.focus({preventScroll: true}); app.render(); return;
    }
    selected.clear(); close();
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopImmediatePropagation();
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true; drag.point = {x: event.clientX, y: event.clientY}; canvas.dataset.connectionActive = 'true';
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0; if (!drag) return;
      let point = worldPoint(drag.point);
      const port = document.elementFromPoint(drag.point.x, drag.point.y)?.closest('.connection-port'), id = port?.closest('.node').dataset.id;
      if (id && id !== drag.id && port.dataset.port !== drag.side) {
        const pair = direction(drag.id, id, drag.side);
        if (!validate(pair.source, pair.target)) {
          const n = app.getState().nodes.find(node => node.id === id), rect = {...n, ...window.NodeEditor?.layoutFor(n), ...window.ImageHistory?.layoutFor(n)};
          point = {x: rect.x + (drag.side === 'left' ? rect.width : 0), y: rect.y + rect.height / 2};
        }
      }
      layer.drawPreview(drag.id, drag.side, point);
    });
  }, true);
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopImmediatePropagation(); const state = drag, anchor = {x: event.clientX, y: event.clientY};
    drag = null; cancelAnimationFrame(frame); frame = 0; delete canvas.dataset.connectionActive;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    layer.clearPreview();
    if (!state.moved) {open(state.id, state.side, anchor); return;}
    const target = document.elementFromPoint(anchor.x, anchor.y)?.closest('.node');
    if (target && target.dataset.id !== state.id) {
      const pair = direction(state.id, target.dataset.id, state.side), error = validate(pair.source, pair.target);
      if (!error) {app.connect(pair.source, pair.target); return;}
      // Official onConnectEnd ends invalid final-video drops without creating a command node.
      if (isFinalNode(app.getState().nodes.find(node => node.id === pair.target))) return;
      app.notify(error); open(state.id, state.side, anchor); return;
    }
    if (document.elementFromPoint(anchor.x, anchor.y)?.closest('#canvas')) open(state.id, state.side, anchor);
  }, true);
  canvas.addEventListener('pointercancel', cancel, true);
  canvas.addEventListener('lostpointercapture', () => {if (drag) cancel();});
  window.addEventListener('blur', cancel);
  document.addEventListener('pointerdown', event => {if (palette && !palette.contains(event.target) && !event.target.closest('.connection-port')) close();}, true);
  document.addEventListener('focusin', event => {
    if (palette && !palette.contains(event.target) && !event.target.closest('.connection-port')) close();
  });
  canvas.addEventListener('wheel', () => close(), {capture: true, passive: true});
  window.addEventListener('resize', cancel);
  // Owned gestures must cancel before the app clears selection, while menu
  // keys stay local and upper dialogs/editors retain their native Escape.
  document.addEventListener('keydown', event => {
    if (keyboardBlocked(event)) return;
    const edge = event.target.closest('[data-edge-id]');
    if (edge && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation(); app.select(null); selected.clear(); selected.add(edge.dataset.edgeId); app.render(); return;
    }
    if (event.key === 'Escape' && (drag || selected.size) && canvas.contains(event.target)) {event.preventDefault(); event.stopImmediatePropagation(); cancel(); selected.clear(); app.render(); canvas.focus({preventScroll: true});}
    if (event.target.closest('input,textarea,[contenteditable],dialog,#agent-panel') || !canvas.contains(document.activeElement) || !selected.size) return;
    if (['Delete', 'Backspace'].includes(event.key)) {event.preventDefault(); event.stopImmediatePropagation(); app.removeEdges([...selected]); selected.clear();}
  }, true);
  selection = installSelection(app, canvas, cancel);
  const api = {bezier, validate, selectionInputs, attachNode, cancel, clearSelection: () => selected.clear(),
    purposeFor: target => isFinalNode(app.getState().nodes.find(node => node.id === target)) ? 'draft-reference' : undefined,
    render(state, byId, piles, pathFor) {
      if (state.selected.length) selected.clear();
      const multiple = String(state.selected.length > 1);
      if (canvas.dataset.connectionsMultiple !== multiple) canvas.dataset.connectionsMultiple = multiple;
      layer.render(state, byId, piles, pathFor);
      selection.render(state, byId);
      if (pending) layer.drawPreview(pending.id, pending.side, worldPoint(pending.anchor));
    }};
  root.replaceChildren();
  for (const node of app.getState().nodes) {const element = document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`); if (element) attachNode(node, element);}
  return api;
}
