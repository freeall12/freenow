import {canvasOwned} from '../canvas-shortcuts/scope.mjs';
// Official canvas shortcut: Cmd+J on macOS, Ctrl+J on Windows.
export function installAgentShortcut(toggle, target = document) {
  const handler = event => {
    if (!canvasOwned(event, target, {allowAgent: true}) || event.repeat || event.altKey || event.shiftKey ||
      !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return;
    // A modal owns keyboard focus until it closes; do not open a sidebar behind it.
    if (target.querySelector('dialog[open], [aria-modal="true"]')) return;
    event.preventDefault();
    toggle();
  };
  target.addEventListener('keydown', handler, {capture: true});
  target.querySelector('.agent')?.setAttribute('aria-keyshortcuts', 'Meta+J Control+J');
  return () => target.removeEventListener('keydown', handler, {capture: true});
}
