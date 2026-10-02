import {bezier, strokeWidth} from './geometry.mjs';

const attributes = new WeakMap();
const attr = (el, key, value) => {
  const text = String(value); let previous = attributes.get(el);
  if (!previous) {previous = new Map(); attributes.set(el, previous);}
  if (previous.get(key) !== text) {el.setAttribute(key, text); previous.set(key, text);}
};
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) attr(el, key, value);
  return el;
};

export function createLayer(root, selected) {
  const entries = new Map();
  const preview = svg('path', {class: 'connection-preview'});
  let latest, graph, width;
  function updateViewport(state) {
    const next = strokeWidth(state.view.scale);
    if (next !== width) {root.style.setProperty('--canvas-edge-stroke-width', `${next}px`); width = next;}
  }
  function render(state, byId, piles, pathFor) {
    latest = {state, byId, piles};
    // The caller renews both layout maps for graph edits. Array identity alone
    // cannot detect in-place node edits; only explicit viewport renders opt in.
    if (state.viewportOnly && graph?.byId === byId && graph.piles === piles && graph.pathFor === pathFor &&
      graph.edges === state.edges && graph.edgeCount === state.edges.length &&
      graph.nodeIds.length === state.selected.length && graph.nodeIds.every((id, index) => id === state.selected[index]) &&
      graph.edgeIds.size === selected.size && [...selected].every(id => graph.edgeIds.has(id))) {
      updateViewport(state); return;
    }
    graph = {byId, piles, pathFor, edges: state.edges, edgeCount: state.edges.length, nodeIds: [...state.selected], edgeIds: new Set(selected)};
    const nodeSelection = new Set(state.selected);
    const ids = new Set(state.edges.map(e => e.id));
    for (const [id, entry] of entries) if (!ids.has(id) || entry.group.parentNode !== root) {
      entry.group.remove(); entries.delete(id); selected.delete(id);
    }
    for (const edge of state.edges) {
      let entry = entries.get(edge.id);
      if (!entry) {
        const group = svg('g', {'data-edge-id': edge.id, class: 'canvas-edge', tabindex: 0, role: 'group', 'aria-roledescription': '连线'});
        const line = svg('path', {class: 'connection-line'}), hit = svg('path', {class: 'connection-hit'});
        group.append(line, hit); root.append(group); entry = {group, line, hit}; entries.set(edge.id, entry);
      }
      const sourceId = edge.source, targetId = edge.target;
      const source = piles.owner.get(sourceId) || sourceId, target = piles.owner.get(targetId) || targetId;
      const a = byId.get(source), b = byId.get(target);
      // Viewport movement leaves world-space paths intact; only changed endpoints
      // (including pile ownership and expanded editor layout) invalidate geometry.
      const geometryChanged = entry.edge !== edge || entry.pathFor !== pathFor || entry.source !== source || entry.target !== target ||
        entry.ax !== a?.x || entry.ay !== a?.y || entry.aw !== a?.width || entry.ah !== a?.height ||
        entry.bx !== b?.x || entry.by !== b?.y || entry.bw !== b?.width || entry.bh !== b?.height;
      const endpoint = nodeSelection.has(sourceId) || nodeSelection.has(targetId) || nodeSelection.has(source) || nodeSelection.has(target);
      const sourceTitle = (source === sourceId ? a : byId.get(sourceId))?.title || sourceId;
      const targetTitle = (target === targetId ? b : byId.get(targetId))?.title || targetId;
      const edgeSelected = selected.has(edge.id), animated = !!edge.animated && endpoint;
      // A content render may change only one node. Static edges need neither
      // geometry arrays nor repeated SVG attribute-cache/string construction.
      if (!geometryChanged && entry.sourceTitle === sourceTitle && entry.targetTitle === targetTitle &&
        entry.endpoint === endpoint && entry.selected === edgeSelected && entry.animated === animated) continue;
      if (geometryChanged) {
        entry.path = pathFor(edge, byId, piles);
        entry.edge = edge; entry.pathFor = pathFor; entry.source = source; entry.target = target;
        entry.ax = a?.x; entry.ay = a?.y; entry.aw = a?.width; entry.ah = a?.height;
        entry.bx = b?.x; entry.by = b?.y; entry.bw = b?.width; entry.bh = b?.height;
      }
      entry.sourceTitle = sourceTitle; entry.targetTitle = targetTitle;
      entry.endpoint = endpoint; entry.selected = edgeSelected; entry.animated = animated;
      const path = entry.path;
      attr(entry.line, 'd', path); attr(entry.hit, 'd', path);
      attr(entry.group, 'aria-label', `连线：${sourceTitle} → ${targetTitle}`);
      attr(entry.group, 'aria-selected', edgeSelected);
      attr(entry.group, 'data-endpoint-selected', endpoint);
      const display = path ? '' : 'none';
      if (entry.display !== display) {entry.group.style.display = display; entry.display = display;}
      // Edge animations are optional task state, never simulated generation progress.
      if (animated && !entry.flow) {
        const gradientId = `connection-flow-${crypto.randomUUID()}`, defs = svg('defs'), gradient = svg('linearGradient', {id: gradientId, gradientUnits: 'userSpaceOnUse'});
        for (const [color, opacity, values] of [['#52525b', 0, '-0.5;1'], ['#ffffff', 1, '-0.3;1.2'], ['#52525b', 0, '-0.1;1.4']]) {
          const stop = svg('stop', {'stop-color': color, 'stop-opacity': opacity});
          stop.append(svg('animate', {attributeName: 'offset', values, dur: '2s', repeatCount: 'indefinite'})); gradient.append(stop);
        }
        defs.append(gradient); const flow = svg('path', {class: 'connection-flow', stroke: `url(#${gradientId})`});
        entry.group.append(defs, flow); Object.assign(entry, {flow, defs, gradient});
      } else if (!animated && entry.flow) {entry.flow.remove(); entry.defs.remove(); entry.flow = null;}
      if (entry.flow) {
        attr(entry.flow, 'd', path);
        if (a && b) for (const [key, value] of Object.entries({x1: a.x + a.width, y1: a.y + a.height / 2, x2: b.x, y2: b.y + b.height / 2})) attr(entry.gradient, key, value);
      }
    }
    updateViewport(state);
    if (preview.isConnected && root.lastChild !== preview) root.append(preview);
  }
  function drawPreview(originId, side, point) {
    if (!latest) return;
    const n = latest.byId.get(originId); if (!n) return;
    const anchor = {x: n.x + (side === 'left' ? 0 : n.width), y: n.y + n.height / 2};
    attr(preview, 'd', side === 'left' ? bezier(point, anchor) : bezier(anchor, point));
    if (!preview.isConnected) root.append(preview);
  }
  return {render, drawPreview, clearPreview: () => preview.remove()};
}
