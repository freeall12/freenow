// Removing/re-appending a connected iframe resets its browsing context. Reconcile
// siblings in place so an unchanged interactive result keeps its document/state.
export function reconcileConnectedChildren(parent, children) {
  const retained = new Set(children);
  for (const child of [...parent.children]) if (!retained.has(child)) child.remove();
  let next = parent.firstElementChild;
  for (const child of children) {
    if (child !== next) {
      if (child.parentNode === parent && typeof parent.moveBefore === 'function') parent.moveBefore(child, next);
      else parent.insertBefore(child, next);
    }
    next = child.nextElementSibling;
  }
}
