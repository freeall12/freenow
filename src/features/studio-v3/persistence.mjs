import {clone, requireDomain} from './invariants.mjs';

export function createPersistence({ownership, getState, transactionActive, publishNode, store, readonly = false, onStatus = () => {}}) {
  requireDomain(typeof publishNode === 'function' && typeof store?.flush === 'function', 'persistence.adapter', 'requires guarded publish and CanvasStore flush');
  const initial = ownership.getInitialStored();
  let dirtySeq = ownership.hasInheritedDirty() ? 1 : 0, contentDirtySeq = dirtySeq;
  let savedSeq = 0, savedContentSeq = 0, revision = initial.revision;
  let inFlight = null, error = null;
  const getStatus = () => ({
    status: error ? 'failed' : inFlight ? 'saving' : dirtySeq === savedSeq ? 'ready' : contentDirtySeq === savedContentSeq ? 'background-dirty' : 'dirty',
    dirtySeq, contentDirtySeq, savedSeq, savedContentSeq, revision,
    dirty: dirtySeq !== savedSeq, contentDirty: contentDirtySeq !== savedContentSeq,
    error: error ? {name: error.name, message: error.message, code: error.code ?? null} : null
  });
  const emit = () => { try { onStatus(getStatus()); } catch { /* UI observers cannot alter save outcome. */ } };
  const assertCanChange = () => {
    requireDomain(!readonly, 'persistence', 'readonly session', 'readonly');
    requireDomain(Number.isSafeInteger(revision + 1), 'persistence.revision', 'revision exhausted');
  };
  const run = async () => {
    if (readonly) return {ok: true, readonly: true};
    ownership.assertCurrent();
    while (dirtySeq !== savedSeq) {
      if (transactionActive()) return {ok: false, reason: 'transaction-active'};
      const savingSeq = dirtySeq, savingContentSeq = contentDirtySeq;
      const payload = {version: 3, state: clone(getState()), revision, sourceBinding: clone(initial.sourceBinding)};
      ownership.stage(payload);
      // publishNode owns the complete-project save. Never duplicate that save here.
      await publishNode(initial.state.scenePlay.worldNodeId, {studioV3: clone(payload)}, {beforeCommit: ownership.isCurrent});
      ownership.assertCurrent();
      await store.flush();
      ownership.acknowledge(payload);
      savedSeq = savingSeq; savedContentSeq = savingContentSeq;
      emit();
    }
    return {ok: true};
  };
  return Object.freeze({
    getStatus, assertCanChange,
    markDirty({content = true} = {}) {
      assertCanChange();
      dirtySeq++; if (content) contentDirtySeq++;
      revision++; error = null; emit();
      ownership.assertCurrent();
    },
    flush() {
      if (inFlight) return inFlight;
      error = null;
      // Assign before executing run so observers and concurrent callers see one save.
      inFlight = Promise.resolve().then(run).catch(cause => { error = cause; throw cause; }).finally(() => { inFlight = null; emit(); });
      emit(); return inFlight;
    }
  });
}
