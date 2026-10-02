let transition = null;
let frame = 0;
const keys = ['x', 'y', 'width', 'height'];

export function layoutFor(node) {
  if (!transition || node.id !== transition.id) return null;
  if (node.image || keys.some(key => node[key] !== transition.to[key])) {
    cancelAnimationFrame(frame);
    transition = null;
    return null;
  }
  return transition.current;
}

export function resizeNode(node, geometry, commit, render) {
  const from = { ...node, ...layoutFor(node) };
  cancelAnimationFrame(frame);
  transition = null;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { commit(geometry); return; }
  const pending = { id: node.id, from, to: geometry, current: Object.fromEntries(keys.map(key => [key, from[key]])), started: performance.now() };
  transition = pending;
  // Commit once. Intermediate geometry is shared by cards and edges only while rendering.
  commit(geometry);
  const tick = now => {
    if (transition !== pending) return;
    const progress = Math.min(1, (now - pending.started) / 280);
    const eased = 1 - (1 - progress) ** 3;
    pending.current = Object.fromEntries(keys.map(key => [key, from[key] + (geometry[key] - from[key]) * eased]));
    if (progress === 1) transition = null;
    render();
    if (progress < 1 && transition === pending) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}
