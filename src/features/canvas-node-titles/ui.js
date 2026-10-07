(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.CanvasNodeTitleCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CanvasNodeTitles = api;
})(typeof window === 'object' ? window : globalThis, function (core) {
  'use strict';
  function createController({document, resolveNode, resolveElement, projectIdentity, canCommit, commit, onError, setTimer, clearTimer}) {
    const entries = new Map();
    let flushing = false;
    function bind(node, element) {
      if (!core.editable(node)) return;
      dispose(element);
      const title = element.querySelector('.node-title'), text = title.querySelector('.title-text');
      if (!text) return;
      title.classList.add('canvas-node-title');
      const project = projectIdentity(), entry = {node, element, title, text, selected: false};
      const paint = value => {
        if (!entry.input) return;
        if (entry.input.value !== value) entry.input.value = value;
        entry.measure.textContent = value || entry.input.placeholder;
      };
      const ownsNode = () => entries.get(element) === entry && element.isConnected && resolveNode(node.id) === node && resolveElement(node.id) === element && projectIdentity() === project;
      const session = core.createSession({
        read: () => core.titleOf(node),
        isCurrent: ownsNode,
        canCommit, commit: value => commit(node, value), changed: paint, onError, setTimer, clearTimer,
      });
      entry.session = session; entries.set(element, entry);
      // Unselected nodes retain only their original title span. Create the
      // native editor on first selection and reuse it across later selections.
      entry.ensureEditor = () => {
        if (entry.input) return;
        const editor = document.createElement('span'), measure = document.createElement('span'), input = document.createElement('input');
        editor.className = 'node-title-editor'; editor.hidden = true;
        measure.className = 'node-title-measure'; measure.setAttribute('aria-hidden', 'true');
        input.className = 'node-title-input nowheel nodrag'; input.type = 'text'; input.placeholder = '请输入标题'; input.autocomplete = 'off';
        input.setAttribute('aria-label', '节点标题'); input.setAttribute('data-testid', 'canvas-node-title');
        input.setAttribute('data-keyboard-scope', 'text-editor');
        editor.append(measure, input); title.insertBefore(editor, text.nextSibling);
        Object.assign(entry, {editor, measure, input}); paint(session.draft);
        // Preserve text selection, native clipboard and IME without triggering
        // canvas drag, preview, zoom, context menus or global keyboard shortcuts.
        for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'wheel']) input.addEventListener(type, event => event.stopPropagation());
        function finishEditing(action) {
          const ownedFocus = document.activeElement === input;
          action();
          // Enter/Escape return keyboard ownership to this selected node. A save
          // callback or external control may have moved focus; never take it back.
          if (!ownedFocus || document.activeElement !== input) return;
          input.blur();
          if (entry.selected && ownsNode() && (!document.activeElement || document.activeElement === document.body || document.activeElement === document.documentElement)) element.focus({preventScroll: true});
        }
        input.addEventListener('keydown', event => {
          event.stopPropagation();
          if (core.isComposing(event) || session.composing) return;
          if (event.key === 'Enter') {event.preventDefault(); finishEditing(() => session.flush());}
          else if (event.key === 'Escape') {event.preventDefault(); finishEditing(() => session.cancel());}
        });
        input.addEventListener('input', () => session.input(input.value));
        input.addEventListener('compositionstart', () => session.compositionStart());
        input.addEventListener('compositionend', () => session.compositionEnd(input.value));
        input.addEventListener('blur', () => {
          // Losing focus during IME must not save a partial composition.
          if (session.composing) session.cancel(); else session.flush();
        });
      };
    }
    function sync(element, selected) {
      const entry = entries.get(element); if (!entry) return;
      const {session, text} = entry;
      session.sync();
      if (entry.selected && !selected) {if (session.composing) session.cancel(); else session.flush();}
      entry.selected = !!selected;
      if (selected) entry.ensureEditor();
      const {input, editor} = entry;
      if (text.textContent !== core.titleOf(entry.node)) text.textContent = core.titleOf(entry.node);
      if (editor && editor.hidden === !!selected) editor.hidden = !selected;
      if (text.hidden !== !!selected) text.hidden = !!selected;
      if (input) {const disabled = !canCommit(); if (input.disabled !== disabled) input.disabled = disabled;}
    }
    function dispose(element) {
      const entry = entries.get(element); if (!entry) return;
      entry.session.dispose(); entries.delete(element);
    }
    function flushAll(options) {
      if (flushing) return;
      flushing = true;
      try {for (const entry of entries.values()) entry.session.flush(options);}
      finally {flushing = false;}
    }
    function cancelAll() {for (const entry of entries.values()) entry.session.cancel();}
    const hasPending = () => [...entries.values()].some(entry => entry.session.pending || entry.session.composing);
    return {bind, sync, dispose, flushAll, cancelAll, hasPending};
  }
  let controller;
  return {
    createController,
    install(options) {controller = createController(options); return controller;},
    bind(...args) {controller?.bind(...args);}, sync(...args) {controller?.sync(...args);}, dispose(...args) {controller?.dispose(...args);},
    flushAll(...args) {controller?.flushAll(...args);}, cancelAll() {controller?.cancelAll();},
    hasPending() {return controller?.hasPending() || false;},
  };
});
