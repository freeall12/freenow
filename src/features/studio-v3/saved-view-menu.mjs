import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';
import {fovToFocalLength} from './camera-optics.mjs';

const accepted = result => result === true || result?.ok === true;
const composing = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const identity = item => JSON.stringify([item.id, item.stageId, item.setupId]);
const labelOf = item => String(item.label ?? '未命名视图');
const positive = value => Number.isFinite(value) && value > 0;
let menuSequence = 0;
export function savedViewMetadata(item) {
  const camera = item.camera || {}, ratio = camera.frameAspectRatio;
  const focal = positive(camera.focalLength) ? camera.focalLength : positive(camera.fov) && positive(ratio) ? fovToFocalLength(camera.fov, ratio) : null;
  const ratioLabel = positive(ratio) ? [[16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [3 / 2, '3:2'], [4 / 3, '4:3']].find(([value]) => Math.abs(value - ratio) < 1e-6)?.[1] ?? `${Number(ratio.toFixed(3))}:1` : '画幅未提供';
  return [focal ? `${Number(focal.toFixed(1))} mm` : '焦距未提供', ratioLabel].join(' · ');
}
function loadStyle(document) {
  const href = new URL('saved-view-menu.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioV3SavedViewMenu = ''; document.head.append(link);
}

/** Local UI completion: the host owns camera leases, domain writes and persistence. */
export function createSavedViewMenu({read, onSave, onRestore, onUpdate, onRename, onRemove, onSelect, onRetrySave, onError = () => {}} = {}) {
  for (const [name, action] of Object.entries({read, onSave, onRestore, onUpdate, onRename, onRemove})) if (typeof action !== 'function') throw TypeError(`视图管理需要 ${name}`);
  if (onSelect !== undefined && typeof onSelect !== 'function') throw TypeError('视图管理 onSelect 必须为函数');
  if (onRetrySave !== undefined && typeof onRetrySave !== 'function') throw TypeError('视图管理 onRetrySave 必须为函数');
  const root = el('section', 'sv3-saved-view-menu'), document = root.ownerDocument;
  root.setAttribute('aria-label', '视图管理'); root.tabIndex = -1;
  root.dataset.worldWorkspaceBlockMovementHotkeys = 'true'; root.dataset.keyboardScope = 'local-tool'; loadStyle(document);
  const header = el('header', 'sv3-saved-view-header'), heading = el('strong', '', '视图管理');
  const save = button(null, '保存当前视角', () => {
    if (state().pendingSave) {if (!busy() && onRetrySave) void operation(onRetrySave, '视图重试保存未被接受', null, null, true, save);}
    else if (canCapture()) void operation(onSave, '视图保存未被接受', null, null, false, save);
  }, {text: '保存当前视角', className: 'sv3-menu-row sv3-saved-view-save'});
  save.prepend(el('span', 'sv3-saved-view-icon')); save.firstChild.innerHTML = icon('camera', {size: 16, strokeWidth: 1.75});
  const reason = el('p', 'sv3-saved-view-reason'), body = el('div', 'sv3-saved-view-body'), empty = el('p', 'sv3-saved-view-empty', '暂无保存的视图');
  const feedback = el('p', 'sv3-saved-view-feedback'); feedback.setAttribute('role', 'alert'); feedback.hidden = true;
  const confirmation = el('div', 'sv3-saved-view-confirm'); confirmation.hidden = true; confirmation.setAttribute('role', 'alertdialog'); confirmation.setAttribute('aria-modal', 'false');
  const confirmationTitle = el('strong'), description = el('p', '', '只删除此视图，不删除机位、照片或所属状态。'), confirmationActions = el('div', 'sv3-saved-view-confirm-actions');
  description.id = `sv3-saved-view-delete-description-${++menuSequence}`; confirmation.setAttribute('aria-describedby', description.id);
  const cancelDelete = button(null, '取消删除视图', () => dismissDelete(), {text: '取消'});
  const confirmDelete = button(null, '确认删除视图', () => {
    const rec = deleting; if (!rec || !liveItem(rec) || blocked()) return;
    const id = rec.id; void operation(() => onRemove(id), '视图删除未被接受', () => {dismissDelete(false); return rec.remove;}, rec);
  }, {text: '删除'});
  cancelDelete.setAttribute('aria-label', '取消删除视图'); confirmDelete.setAttribute('aria-label', '确认删除视图');
  confirmationActions.append(cancelDelete, confirmDelete); confirmation.append(confirmationTitle, description, confirmationActions);
  header.append(heading); root.append(header, save, reason, body, feedback, confirmation);
  let disposed = false, pending = null, editing = null, deleting = null, snapshot = {};
  const records = new Map(), listeners = [];
  const listen = (node, type, handler) => {node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));};
  const state = () => read() || {};
  const busy = () => disposed || !!pending || !!state().busy;
  const blocked = () => busy() || !!state().pendingSave;
  const canCapture = () => !blocked() && state().canSave === true;
  const liveItem = rec => !disposed && records.get(rec.key) === rec ? (state().items || []).find(item => identity(item) === rec.key) : null;
  function focus(target) {
    if (disposed || !root.isConnected) return;
    const usable = target?.isConnected && root.contains(target) && !target.disabled && !target.closest('[hidden],[inert],[aria-hidden="true"]');
    (usable ? target : root).focus({preventScroll: true});
  }
  function report(error) {
    if (disposed) return;
    const failure = error instanceof Error ? error : Error(String(error)); feedback.textContent = failure.message; feedback.hidden = false;
    try {onError(failure);} catch { /* An error observer must not turn an accepted UI task into an unhandled rejection. */ }
  }
  async function operation(action, message, success, rec = null, retry = false, origin = null) {
    if ((retry ? busy() : blocked()) || (rec && !liveItem(rec))) return false;
    const ticket = {}; pending = ticket; refresh(); let target = null;
    try {
      const result = await action();
      // A delete can legitimately remove its target before persistence fails.
      // Keep that receipt/error visible; only lifecycle cancellation makes the result inert.
      if (disposed || pending !== ticket) return false;
      if (!accepted(result)) throw Error(result?.message || message);
      feedback.hidden = true; target = success?.(result); return true;
    } catch (error) {
      if (!disposed && pending === ticket) report(error);
      return false;
    } finally {
      if (!disposed && pending === ticket) {pending = null; refresh(); if (target || origin) focus(target || origin);}
    }
  }
  function cancelRename(restore = true) {
    if (!editing) return;
    const draft = editing; editing = null; draft.cancelled = true; draft.input.onblur = draft.input.onkeydown = null; draft.input.remove(); draft.rec.title.hidden = false; draft.rec.renameSave.hidden = true;
    refresh(); if (restore) focus(draft.rec.rename);
  }
  async function commitRename(draft) {
    if (editing !== draft || draft.composing || blocked()) return;
    const item = liveItem(draft.rec), name = draft.input.value.trim();
    if (!item) {cancelRename(); return;}
    if (!name) {report(Error('视图名称不能为空')); focus(draft.input); return;}
    if (name === labelOf(item)) {cancelRename(); return;}
    const id = draft.rec.id;
    const ok = await operation(() => onRename(id, name), '名称修改未被接受', () => {
      if (editing !== draft || draft.cancelled) return null;
      cancelRename(false); return draft.rec.rename;
    }, draft.rec);
    if (!ok && !disposed && editing === draft) focus(draft.input);
  }
  function beginRename(rec) {
    if (blocked() || !liveItem(rec)) return;
    cancelRename(false); dismissDelete(false);
    const input = el('input', 'sv3-saved-view-name'); input.value = labelOf(rec.item); input.maxLength = 120; input.setAttribute('aria-label', `视图名称：${labelOf(rec.item)}`);
    const draft = {rec, input, composing: false, cancelled: false}; editing = draft; rec.title.hidden = true; rec.renameSave.hidden = false; rec.caption.prepend(input);
    input.addEventListener('compositionstart', () => {draft.composing = true;}); input.addEventListener('compositionend', () => {draft.composing = false;});
    input.onkeydown = event => {
      event.stopPropagation(); if (draft.composing || composing(event)) return;
      if (event.key === 'Enter') {event.preventDefault(); void commitRename(draft);}
      if (event.key === 'Escape') {event.preventDefault(); cancelRename();}
    };
    input.onblur = () => {
      if (deleting) return;
      if (!draft.composing) {void commitRename(draft); return;}
      // A real focus departure terminates composition, even if compositionend is lost.
      // Wait for its final input event rather than accepting an Enter during active IME.
      // Synthetic blur while focus remains in the input does not end an active IME session.
      if (document.activeElement !== input) {
        draft.composing = false;
        queueMicrotask(() => {if (document.activeElement !== input && !deleting) void commitRename(draft);});
      }
    }; refresh(); focus(input); input.select();
  }
  function dismissDelete(restore = true) {
    const rec = deleting; deleting = null; confirmation.hidden = true;
    if (restore && rec) focus(editing?.input || rec.remove);
  }
  function beginDelete(rec) {
    if (blocked() || !liveItem(rec)) return;
    deleting = rec; confirmationTitle.textContent = `删除“${labelOf(rec.item)}”？`; confirmation.setAttribute('aria-label', confirmationTitle.textContent); confirmation.hidden = false; refresh(); focus(cancelDelete);
  }
  function makeRecord(item) {
    const row = el('article', 'sv3-saved-view-row'), caption = el('div', 'sv3-saved-view-caption'), title = el('span', 'sv3-saved-view-title'), ownership = el('span', 'sv3-saved-view-ownership'), metadata = el('span', 'sv3-saved-view-metadata'), tags = el('span', 'sv3-saved-view-tags');
    const rec = {id: item.id, key: identity(item), item, row, caption, title, ownership, metadata, tags}; row.dataset.viewId = item.id;
    rec.restore = button(null, '', () => {if (blocked() || !liveItem(rec) || editing?.rec === rec) return; const id = rec.id; void operation(() => onRestore(id), '视图恢复未被接受', null, rec, false, rec.restore);}, {className: 'sv3-menu-row sv3-saved-view-restore'});
    const graphic = el('span', 'sv3-saved-view-icon'); graphic.innerHTML = icon('onSet', {size: 18, strokeWidth: 1.75});
    rec.restore.append(graphic, title); caption.append(ownership, metadata, tags);
    const actions = el('div', 'sv3-saved-view-actions');
    const actionButton = (name, action) => {const node = button(null, '', action); node.innerHTML = icon(name, {size: 14, strokeWidth: name === 'check' ? 2 : 1.75}); return node;};
    rec.rename = actionButton('rename', () => beginRename(rec));
    rec.renameSave = actionButton('check', () => {if (editing?.rec === rec) void commitRename(editing);}); rec.renameSave.hidden = true;
    rec.update = actionButton('camera', () => {if (!canCapture() || !liveItem(rec)) return; const id = rec.id; void operation(() => onUpdate(id), '当前视角更新未被接受', null, rec, false, rec.update);});
    rec.remove = actionButton('delete', () => beginDelete(rec));
    // These controls retain the draft input's focus; blur otherwise commits before the click can establish a nested confirmation.
    for (const node of [rec.renameSave, rec.remove]) node.onpointerdown = event => {if (editing) event.preventDefault();};
    actions.append(rec.rename, rec.renameSave, rec.update, rec.remove);
    if (onSelect) {rec.select = button(null, '', () => {if (blocked() || !liveItem(rec)) return; const id = rec.id; void operation(() => onSelect(id), '视图选中未被接受', null, rec, false, rec.select);}, {text: '选中'}); rec.select.dataset.iconOnly = 'false'; actions.prepend(rec.select);}
    row.append(rec.restore, caption, actions); return rec;
  }
  function refresh() {
    if (disposed) return;
    try {
      snapshot = state(); const items = snapshot.items || [], valid = new Set(items.map(identity)), activeElement = document.activeElement;
      for (const [key, rec] of records) if (!valid.has(key)) {
        if (editing?.rec === rec) cancelRename(false); if (deleting === rec) dismissDelete(false); rec.row.remove(); records.delete(key);
      }
      for (const item of items) {const key = identity(item); if (!records.has(key)) records.set(key, makeRecord(item)); records.get(key).item = item;}
      // Only reorder nodes when necessary; periodic host refreshes must preserve input selection and native focus.
      const wanted = items.length ? items.map(item => records.get(identity(item)).row) : [empty];
      for (let index = 0; index < wanted.length; index++) if (body.children[index] !== wanted[index]) body.insertBefore(wanted[index], body.children[index] || null);
      for (const child of [...body.children]) if (!wanted.includes(child)) child.remove();
      const disabled = blocked(), receipt = snapshot.pendingSave; root.setAttribute('aria-busy', String(busy()));
      const saveLabel = receipt ? '重试保存视图' : '保存当前视角'; save.lastChild.textContent = saveLabel; save.setAttribute('aria-label', saveLabel); save.title = saveLabel;
      save.disabled = busy() || (receipt ? !onRetrySave : snapshot.canSave !== true);
      reason.textContent = receipt?.message || (receipt ? '视图操作已应用，等待重新保存。' : snapshot.disabledReason || ''); reason.hidden = !reason.textContent;
      for (const rec of records.values()) {
        const name = labelOf(rec.item), active = snapshot.activeViewId === rec.id || rec.item.active === true;
        rec.row.dataset.active = String(active); rec.title.textContent = name; rec.title.title = name;
        rec.ownership.textContent = [rec.item.stageLabel || rec.item.stageId, rec.item.setupLabel || rec.item.setupId].filter(Boolean).join(' · '); rec.ownership.title = rec.ownership.textContent;
        rec.metadata.textContent = savedViewMetadata(rec.item); rec.tags.textContent = (rec.item.tags || []).join(' · '); rec.tags.hidden = !rec.tags.textContent;
        rec.restore.setAttribute('aria-label', `恢复视图“${name}”`); rec.restore.title = rec.restore.getAttribute('aria-label'); rec.restore.setAttribute('aria-pressed', String(active)); rec.restore.disabled = disabled || editing?.rec === rec;
        for (const [node, label] of [[rec.rename, `重命名视图“${name}”`], [rec.renameSave, `保存视图名称“${name}”`], [rec.update, `更新视图“${name}”为当前视角`], [rec.remove, `删除视图“${name}”`], [rec.select, `选中视图“${name}”`]]) if (node) {node.title = label; node.setAttribute('aria-label', label); node.disabled = disabled;}
        rec.update.disabled = disabled || snapshot.canSave !== true; rec.rename.hidden = editing?.rec === rec;
      }
      if (editing) {editing.input.readOnly = disabled; if (pending) editing.input.setAttribute('aria-busy', 'true'); else editing.input.removeAttribute('aria-busy');}
      cancelDelete.disabled = false; confirmDelete.disabled = disabled;
      if (activeElement && !activeElement.isConnected && root.isConnected) focus(root);
    } catch (error) {report(error);}
  }
  function handleEscape() {
    if (disposed || editing?.composing) return false;
    if (deleting) {dismissDelete(); return true;}
    if (editing) {cancelRename(); return true;}
    return false;
  }
  listen(root, 'keydown', event => {
    if (event.defaultPrevented || composing(event) || event.key !== 'Escape') return;
    if (handleEscape()) {event.preventDefault(); event.stopPropagation();}
  });
  for (const type of ['keyup', 'pointerdown', 'pointermove', 'pointerup', 'click', 'wheel', 'contextmenu']) listen(root, type, event => event.stopPropagation());
  root.element = root; root.refresh = refresh; root.handleEscape = handleEscape;
  root.dispose = () => {
    if (disposed) return; disposed = true; pending = null; editing = null; deleting = null;
    root.inert = true; root.setAttribute('aria-hidden', 'true');
    for (const remove of listeners) remove();
    for (const node of root.querySelectorAll('button,input')) {node.onclick = node.onblur = node.onkeydown = node.onpointerdown = null; if (node.tagName === 'BUTTON') node.disabled = true; else node.readOnly = true;}
    records.clear();
  };
  refresh(); return root;
}
