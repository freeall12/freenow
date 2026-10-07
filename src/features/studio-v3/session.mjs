import {requireDomain} from './invariants.mjs';
import {createHistory} from './history.mjs';
import {createOwnership} from './ownership.mjs';
import {createPersistence} from './persistence.mjs';

export function createStudioSession({nodeId, app, store, publishNode, getSourceSnapshot, sessionToken,
  isCurrentSession, readonly = false, historyOptions, onStatus, onChange = () => {},
  autosaveMs = 500, schedule = setTimeout, unschedule = clearTimeout}) {
  requireDomain(typeof app?.registerNodeWriteGuard === 'function', 'session.app', 'requires persistent node write guard');
  requireDomain(typeof publishNode === 'function' && typeof store?.flush === 'function', 'session.adapter', 'requires guarded publish and CanvasStore flush');
  requireDomain(autosaveMs === null || Number.isFinite(autosaveMs) && autosaveMs >= 0, 'session.autosaveMs', 'invalid autosave delay');
  const ownership = createOwnership({nodeId, app, getSourceSnapshot, sessionToken, isCurrentSession, readonly});
  const engine = createHistory(ownership.getInitialStored().state, historyOptions);
  let closed = false, timer = null, transactionContent = true, editEpoch = 0;
  let persistence, unregister;
  const assertEditable = () => {
    requireDomain(!closed, 'session', 'session closed', 'closed-session');
    requireDomain(!readonly, 'session', 'readonly session', 'readonly'); ownership.assertCurrent();
  };
  const notify = () => { editEpoch++; try { onChange(engine.getState()); } catch { /* Render observers are not domain mutations. */ } };
  const cancelTimer = () => { if (timer !== null) { unschedule(timer); timer = null; } };
  const scheduleSave = () => {
    cancelTimer();
    if (autosaveMs === null || readonly || closed || engine.getActiveTransaction() || !persistence.getStatus().dirty) return;
    timer = schedule(() => { timer = null; persistence.flush().catch(() => {}); }, autosaveMs);
    timer?.unref?.();
  };
  const changed = content => { persistence.markDirty({content}); notify(); scheduleSave(); };
  const history = Object.freeze({
    getState: engine.getState, getHistory: engine.getHistory, getActiveTransaction: engine.getActiveTransaction,
    getUndoAvailability: engine.getUndoAvailability, getRedoAvailability: engine.getRedoAvailability,
    begin(lane, label, scope, {content = true} = {}) {
      assertEditable(); const result = engine.begin(lane, label, scope);
      if (result) { transactionContent = content; cancelTimer(); } return result;
    },
    preview(reducer) { assertEditable(); const result = engine.preview(reducer); if (result) notify(); return result; },
    commit() { assertEditable(); persistence.assertCanChange(); const result = engine.commit(); if (result) changed(transactionContent); else scheduleSave(); return result; },
    cancel() { assertEditable(); const result = engine.cancel(); if (result) { notify(); scheduleSave(); } return result; },
    transact(lane, label, reducer, scope) {
      assertEditable(); persistence.assertCanChange(); const result = engine.transact(lane, label, reducer, scope); if (result) changed(true); return result;
    },
    undo(lane) { assertEditable(); persistence.assertCanChange(); const result = engine.undo(lane); if (result.ok) changed(true); return result; },
    redo(lane) { assertEditable(); persistence.assertCanChange(); const result = engine.redo(lane); if (result.ok) changed(true); return result; },
    clear() { assertEditable(); engine.clear(); }
  });
  try {
    persistence = createPersistence({ownership, getState: engine.getState, transactionActive: () => !!engine.getActiveTransaction(), publishNode, store, readonly, onStatus});
    unregister = app.registerNodeWriteGuard(nodeId, ownership.guardNodeSnapshot);
    requireDomain(typeof unregister === 'function', 'session.app', 'guard registration must return unregister');
  } catch (error) { ownership.release(); throw error; }
  return Object.freeze({
    getState: engine.getState, history, getStatus: persistence.getStatus,
    getFence: () => ({...ownership.getFence(), revision: persistence.getStatus().revision, editEpoch}),
    isCurrent: () => !closed && ownership.isCurrent(),
    change(reducer, {lane = 'world', label = 'edit', scope, content = true} = {}) {
      assertEditable(); persistence.assertCanChange(); const result = engine.transact(lane, label, reducer, scope); if (result) changed(content); return result;
    },
    flush() {
      requireDomain(!closed, 'session', 'session closed', 'closed-session'); cancelTimer(); return persistence.flush();
    },
    async closeGuard() {
      if (closed) return {ok: true};
      requireDomain(!engine.getActiveTransaction(), 'session.close', 'finish transaction before closing', 'transaction-active');
      cancelTimer(); const result = await persistence.flush();
      requireDomain(result.ok && !persistence.getStatus().dirty && !engine.getActiveTransaction(), 'session.close', 'session changed while closing', 'transaction-active');
      ownership.assertCurrent(); unregister(); closed = true; ownership.release();
      return {ok: true};
    }
  });
}
