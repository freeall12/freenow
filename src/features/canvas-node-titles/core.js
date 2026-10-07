(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CanvasNodeTitleCore = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const editableTypes = new Set(['image', 'video', 'audio', 'text', 'world']);
  const editable = node => editableTypes.has(node?.type) && node.titleEditable !== false;
  const titleOf = node => typeof node?.title === 'string' ? node.title : '';
  const fontSize = scale => Math.max(12, Math.min(12 / (scale > 0 ? scale : 1), 60));
  const isComposing = event => event?.isComposing || event?.keyCode === 229 || event?.key === 'Process';

  // The guard belongs to the host: an ID alone cannot distinguish a replaced
  // graph, a history snapshot, or the same ID in another project.
  function createSession({read, isCurrent, canCommit, commit, changed = () => {}, onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, delay = 1000}) {
    let baseline = read(), draft = baseline, timer = null, composing = false, disposed = false, writing = false;
    const clear = () => {if (timer !== null) clearTimer(timer); timer = null;};
    const paint = () => changed(draft);
    function reset(value = read()) {clear(); baseline = draft = value; composing = false; paint();}
    function current() {return !disposed && isCurrent() && read() === baseline;}
    function flush({requireSettled = false} = {}) {
      clear();
      if (writing || disposed) return false;
      if (composing) {
        if (requireSettled) throw Error('节点标题仍在输入，请完成输入后保存');
        return false;
      }
      if (draft === baseline) return false;
      if (!current()) {reset(); return false;}
      if (!draft.trim()) {reset(); return false;}
      if (!canCommit()) {
        if (requireSettled) throw Error('画布尚未成功读取，节点标题尚未保存');
        return false;
      }
      writing = true;
      try {
        commit(draft);
        baseline = read(); draft = baseline; paint();
        return true;
      } catch (error) {
        onError(error);
        if (requireSettled) throw error;
        return false;
      } finally {writing = false;}
    }
    const schedule = () => {clear(); if (!composing && draft !== baseline) timer = setTimer(() => flush(), delay);};
    return {
      input(value) {if (disposed || !current()) {reset(); return;} draft = String(value); paint(); schedule();},
      compositionStart() {clear(); composing = true;},
      compositionEnd(value) {composing = false; this.input(value);},
      flush,
      cancel() {if (!disposed) reset();},
      sync() {if (!disposed && (read() !== baseline || draft !== baseline && !isCurrent())) reset();},
      dispose() {clear(); disposed = true;},
      get draft() {return draft;},
      get pending() {return draft !== baseline;},
      get composing() {return composing;},
    };
  }
  return {editable, titleOf, fontSize, isComposing, createSession};
});
