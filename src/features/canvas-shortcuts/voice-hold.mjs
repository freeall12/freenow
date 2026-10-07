import {canvasOwned, eventTarget} from './scope.mjs';

// The installed official page's age hook uses oge=500 and opens Agent.
// Releasing V cancels a short hold; it never submits a running recording.
export function installVoiceHold({start, finish, isRecording, onError = () => {}}, doc = document, host = window) {
  let timer = null, held = false, request = null, disposed = false;
  const owns = event => canvasOwned(event, doc, {allowAgent: isRecording()});
  function cancel() {
    if (timer !== null) host.clearTimeout(timer);
    timer = null; held = false; request?.abort(); request = null;
  }
  const keydown = event => {
    if (event.key?.toLowerCase() !== 'v') {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) cancel();
      return;
    }
    if (event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !owns(event)) {cancel(); return;}
    event.preventDefault(); event.stopPropagation();
    if (held) return;
    held = true;
    if (isRecording()) {void Promise.resolve().then(finish).catch(onError); return;}
    const target = eventTarget(event, doc), controller = new AbortController();
    request = controller;
    timer = host.setTimeout(() => {
      timer = null;
      const isCurrent = () => !disposed && !controller.signal.aborted &&
        eventTarget({target: doc.activeElement}, doc) === target && owns({target});
      if (!isCurrent()) {cancel(); return;}
      void Promise.resolve().then(() => isCurrent() && start({signal: controller.signal, isCurrent})).catch(error => {
        if (!controller.signal.aborted) onError(error);
      }).finally(() => {
        if (request === controller) request = null;
      });
    }, 500);
  };
  const keyup = event => {
    if (event.key?.toLowerCase() !== 'v') return;
    if (timer !== null) {cancel(); return;}
    held = false;
  };
  const visibility = () => {if (doc.visibilityState === 'hidden') cancel();};
  const events = [['keydown', keydown], ['keyup', keyup], ['focusin', cancel], ['pointerdown', cancel], ['compositionstart', cancel], ['visibilitychange', visibility]];
  for (const [name, fn] of events) doc.addEventListener(name, fn);
  host.addEventListener('blur', cancel); host.addEventListener('pagehide', cancel);
  return () => {
    disposed = true; cancel();
    for (const [name, fn] of events) doc.removeEventListener(name, fn);
    host.removeEventListener('blur', cancel); host.removeEventListener('pagehide', cancel);
  };
}
