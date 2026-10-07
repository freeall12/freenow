import {createTemplateEditorDraft} from './template-editor-draft.mjs';

/** Local source editing adjunct. It never renders or rewrites the original official template. */
export function openTemplateSourceEditor({session, onSaved = () => {}, onError = () => {}, document = globalThis.document}) {
  const previousFocus = document.activeElement;
  for (const [key, path] of [['artifact', '../agent-artifacts/styles.css'], ['editor', './template-source-editor.css']]) {
    if (!document.querySelector(`link[data-template-editor-style="${key}"]`)) {
      const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL(path, import.meta.url);
      style.dataset.templateEditorStyle = key; document.head.append(style);
    }
  }
  let saved = session.read(), closed = false, saving = false, invalid = false, ignoreCancel = false;
  const dialog = document.createElement('dialog'); dialog.className = 'agent-html-preview agent-template-source-editor'; dialog.setAttribute('aria-label', '编辑模板 HTML');
  const side = document.createElement('aside'), main = document.createElement('div'); main.className = 'agent-html-main';
  const title = document.createElement('h3'); title.textContent = saved.title;
  const info = document.createElement('p'); info.className = 'agent-html-disclaimer';
  const version = () => { info.textContent = `编辑版本 ${saved.revision}。原模板保持只读。${saved.receipt_status === 'unconfirmed' ? '会话导入回执未确认。' : ''}`; };
  version();
  const textarea = document.createElement('textarea'); textarea.value = saved.content; textarea.spellcheck = false; textarea.setAttribute('aria-label', 'HTML 正文');
  const status = document.createElement('p'); status.role = 'status'; status.className = 'agent-artifact-status';
  const actions = document.createElement('div'); actions.className = 'agent-html-actions';
  const dirty = () => textarea.value !== saved.content;
  // A dialog-close check cannot protect a draft when the user reloads or leaves the page.
  const beforeUnload = event => {
    if (!closed && (dirty() || saving)) { event.preventDefault(); event.returnValue = ''; }
  };
  const root = document.defaultView;
  root?.addEventListener('beforeunload', beforeUnload);
  const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = action; return node; };
  const recovery = document.createElement('div'); recovery.className = 'agent-template-draft-recovery'; recovery.hidden = true;
  const draftNote = document.createElement('p'); draftNote.role = 'status';
  const recoveredText = document.createElement('pre'); recoveredText.setAttribute('aria-label', '待恢复的本地草稿');
  let drafts, pendingDraft = null, draftBlocked = false;
  function draftError(error) { recovery.hidden = false; draftNote.textContent = '本地草稿未保存：' + error.message + '。当前编辑内容仍保留，请保存正文或复制后再离开。'; }
  function saveDraft() {
    if (pendingDraft || draftBlocked) return false;
    try { if (dirty()) drafts.save(textarea.value, saved); else drafts.clear(); return true; }
    catch (error) { draftError(error); return false; }
  }
  const restoreDraft = button('恢复本地草稿', () => {
    if (!pendingDraft || saving) return;
    const conflict = pendingDraft.conflict;
    textarea.value = pendingDraft.content; pendingDraft = null; recoveredText.hidden = true;
    restoreDraft.hidden = discardDraft.hidden = true; const retained = saveDraft(); sync(); textarea.focus();
    if (retained) draftNote.textContent = conflict ? '已载入旧版本草稿供核对；当前已保存正文保持原版本，点击保存修改才会写入。' : '草稿已恢复到编辑区；点击保存修改才会写入正文。';
  });
  const discardDraft = button('放弃恢复的草稿', () => {
    if (saving) return;
    try { drafts.clear(); pendingDraft = null; draftBlocked = false; recovery.hidden = true; saveDraft(); sync(); textarea.focus(); }
    catch (error) { draftError(error); }
  });
  recovery.append(draftNote, recoveredText, restoreDraft, discardDraft);
  try {
    drafts = createTemplateEditorDraft({file: saved, storage: root?.sessionStorage, pageScope: root?.location?.pathname || ''});
    pendingDraft = drafts.load(saved);
    if (pendingDraft && pendingDraft.content !== saved.content) {
      recovery.hidden = false; recoveredText.textContent = pendingDraft.content;
      draftNote.textContent = pendingDraft.conflict ? '发现旧版本草稿；已保存正文发生变化。请先核对下方草稿，恢复后仍须明确保存。' : '发现上次未保存的本地草稿。可核对后恢复；当前已保存正文保持原样。';
    } else { pendingDraft = null; recoveredText.hidden = restoreDraft.hidden = discardDraft.hidden = true; if (drafts.load(saved)) drafts.clear(); }
  } catch (error) { draftBlocked = true; recoveredText.hidden = restoreDraft.hidden = discardDraft.hidden = true; draftError(error); }
  const discard = document.createElement('div'); discard.className = 'agent-template-discard'; discard.hidden = true;
  const warning = document.createElement('p'); warning.textContent = '还有未保存的修改。';
  const closeNow = () => { if (!closed && !saving) dialog.close(); };
  const keep = button('继续编辑', () => { discard.hidden = true; textarea.focus(); });
  const abandon = button('放弃修改并关闭', () => { if (!pendingDraft && !draftBlocked) { try { drafts.clear(); } catch (error) { draftError(error); return; } } closeNow(); }); discard.append(warning, keep, abandon);
  const requestClose = () => {
    if (saving) { status.textContent = '正文正在保存，请稍后关闭。'; return; }
    if (dirty()) { discard.hidden = false; keep.focus(); } else closeNow();
  };
  const save = button('保存修改', async () => {
    if (closed || saving || invalid || save.disabled) return;
    const ownedFocus = document.activeElement === save;
    let movedFocus = false;
    const followFocus = event => { if (event.target !== save && event.target !== document.body) movedFocus = true; };
    const followPointer = event => { if (event.target !== save) movedFocus = true; };
    const followKeyboard = event => { if (event.key === 'Tab') movedFocus = true; };
    document.addEventListener('focusin', followFocus, true);
    document.addEventListener('pointerdown', followPointer, true);
    document.addEventListener('keydown', followKeyboard, true);
    saving = true; save.disabled = true; textarea.readOnly = true; discard.hidden = true; status.textContent = '正在保存 HTML…';
    let committed = false;
    try {
      const result = await session.save({content: textarea.value});
      if (closed) return;
      saved = result; committed = true; version(); status.textContent = `已保存版本 ${saved.revision}。`;
      if (!pendingDraft && !draftBlocked) { try { drafts.clear(); recovery.hidden = true; } catch (error) { draftError(error); } }
      await onSaved(saved);
    } catch (error) {
      if (!closed) { const message = committed ? 'HTML 已保存，但界面状态刷新失败：' + error.message : error.message; status.textContent = message; onError(message); }
    } finally {
      document.removeEventListener('focusin', followFocus, true);
      document.removeEventListener('pointerdown', followPointer, true);
      document.removeEventListener('keydown', followKeyboard, true);
      saving = false;
      if (!closed) {
        textarea.readOnly = false; sync();
        if (ownedFocus && !movedFocus && (document.activeElement === save || document.activeElement === document.body)) textarea.focus();
      }
    }
  });
  function sync() { textarea.readOnly = saving || !!pendingDraft; save.disabled = saving || invalid || !!pendingDraft || !dirty(); dialog.dataset.dirty = String(dirty()); }
  textarea.oninput = () => { discard.hidden = true; saveDraft(); sync(); };
  const close = button('关闭编辑器', requestClose); actions.append(save, close, status, recovery, discard); side.append(title, info, actions); main.append(textarea); dialog.append(side, main); document.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!ignoreCancel) requestClose(); ignoreCancel = false; });
  dialog.onkeydown = event => {
    if (event.key !== 'Escape') return;
    ignoreCancel = event.isComposing || event.keyCode === 229 || event.repeat;
    if (!ignoreCancel) { event.preventDefault(); event.stopPropagation(); requestClose(); }
  };
  dialog.onclick = event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
  };
  dialog.addEventListener('close', () => {
    if (closed) return; closed = true; root?.removeEventListener('beforeunload', beforeUnload); session.close(); dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }, {once: true});
  sync(); dialog.showModal(); textarea.focus();
  return {element: dialog, close: requestClose, invalidate(reason = '模板面板已关闭；请保留当前修改，重新打开所选模板后继续。') {
    invalid = true; if (!closed) { status.textContent = reason; sync(); }
  }};
}
