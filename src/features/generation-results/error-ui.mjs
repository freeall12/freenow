import {createFailureState} from './error-state.mjs';
export {captureFailureTargets, failureSignature} from './error-state.mjs';

const installations = new WeakMap();
function element(document, tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Requires job.nodeFailures receipts captured by the task owner before clear. */
export function install({app = window.CanvasApp, generation = window.GenerationAPI,
  document = window.document, readonly = () => false, loadStyles = true} = {}) {
  if (!app?.getState || !app?.getNodeElement || !generation?.getJobs || !generation?.subscribe) {
    throw new TypeError('Generation error UI requires CanvasApp and GenerationAPI');
  }
  if (installations.has(app)) return installations.get(app);
  if (loadStyles && !document.getElementById('generation-error-styles')) {
    const link = document.createElement('link'); link.id = 'generation-error-styles'; link.rel = 'stylesheet';
    link.href = new URL('./error-ui.css', import.meta.url).href; document.head.append(link);
  }
  const failures = createFailureState(), records = new Map();
  let destroyed = false;
  function dispose(record) {
    record.overlay.remove(); record.body.removeAttribute('data-generation-error');
  }
  function mount(failure, body, isReadonly) {
    const overlay = element(document, 'div', 'generation-error-overlay');
    const content = element(document, 'div', 'generation-error-content');
    content.append(element(document, 'div', 'generation-error-badge', '提示'));
    const message = element(document, 'p', 'generation-error-message', failure.message);
    message.setAttribute('role', 'status'); content.append(message);
    if (!isReadonly) {
      const confirm = element(document, 'button', 'generation-error-confirm', '确认'); confirm.type = 'button';
      confirm.addEventListener('pointerdown', event => event.stopPropagation());
      confirm.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        failures.dismiss(failure.key); refresh();
      });
      content.append(confirm);
    }
    overlay.append(content); body.append(overlay); body.setAttribute('data-generation-error', 'true');
    return {body, overlay, key: failure.key, isReadonly};
  }
  function refresh(event) {
    if (destroyed || event?.detail?.viewportOnly) return;
    const active = failures.collect(app.getState(), generation.getJobs());
    for (const [id, record] of records) {
      if (!active.has(id)) {dispose(record); records.delete(id);}
    }
    for (const [id, failure] of active) {
      const shell = app.getNodeElement(id), isReadonly = !!readonly(failure.node);
      let record = records.get(id);
      const body = record && record.body.parentNode === shell ? record.body : shell?.querySelector('.node-body');
      if (record && (record.body !== body || record.overlay.parentNode !== body || record.key !== failure.key || record.isReadonly !== isReadonly)) {
        dispose(record); records.delete(id); record = null;
      }
      if (body && !record) records.set(id, mount(failure, body, isReadonly));
    }
  }
  document.addEventListener('canvas:render', refresh);
  const unsubscribe = generation.subscribe(() => refresh());
  const api = {refresh, destroy() {
    if (destroyed) return;
    destroyed = true; unsubscribe?.(); document.removeEventListener('canvas:render', refresh);
    for (const record of records.values()) dispose(record);
    records.clear(); failures.clear(); installations.delete(app);
  }};
  installations.set(app, api); refresh(); return api;
}
