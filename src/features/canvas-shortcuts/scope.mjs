const text = 'input,textarea,select,[contenteditable],[role="textbox"]';
const tools = '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"],[role="slider"],[data-keyboard-scope="external"],[data-keyboard-scope="local-tool"],[data-keyboard-scope="overlay"],.floating-panel,.node-action-panel,.canvas-command-menu,.connection-menu,.playlist-menu,.world-popover,.world-generation';
const modes = '.studio-active,.media-editing,.text-viewer-active,.pile-gallery-active,.video-masking,.video-reshoot-active,.video-creation-active,.video-trimming';
export const composing = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
export function eventTarget(event, doc) {
  const target = event.composedPath?.()[0] || event.target;
  return !target || target === doc.body || target === doc.documentElement ? doc.activeElement || target : target;
}
export function blocked(event, doc) {
  const target = eventTarget(event, doc);
  return !!(event.defaultPrevented || composing(event) || target?.isContentEditable || target?.closest?.(text + ',' + tools) ||
    doc.querySelector('dialog[open],[aria-modal="true"],[role="dialog"]:not([hidden]),[role="alertdialog"]:not([hidden])') || doc.body?.matches?.(modes));
}
export function canvasOwned(event, doc, {allowAgent = false, allowFocus = false} = {}) {
  if (blocked(event, doc)) return false;
  const target = eventTarget(event, doc), canvas = doc.querySelector('#canvas');
  if (target?.closest?.('#node-editor,#parameter-popover,.playlist-preview,.playlist-node button,.playlist-clip,.canvas-comment,.task-tray')) return false;
  if (target?.closest?.('#agent-panel')) return allowAgent;
  if (allowFocus && target?.closest?.('.focus-mode-banner')) return true;
  if (target?.closest?.('button,a,[role="button"],[role="combobox"]')) return false;
  return !!canvas?.contains(target);
}
