import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';
import {fovToFocalLength} from './camera-optics.mjs';

const composing = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const accepted = result => result === true || result?.ok === true;
const shotName = shot => shot.label ?? shot.name ?? shot.title ?? '';
const cameraOf = shot => shot.camera || shot;
const aspectOf = shot => {const value = cameraOf(shot).frameAspectRatio; return Number.isFinite(value) && value > 0 ? value : 16 / 9;};
const identity = shot => JSON.stringify([shot.setupId, shot.id]);
const thumbnailKey = shot => JSON.stringify([identity(shot), cameraOf(shot), shot.thumbnailRevision ?? shot.updatedAt]);
export function cameraManagerSetupLabel(label) {
  if (!label?.trim()) return '未命名状态';
  if (label === 'Example State') return '示例状态';
  if (label === 'Default Setup') return '状态1';
  return label.replace(/^(?:Setup|State)\s+(\d+)$/, '状态$1');
}
export function cameraManagerMetadata(shot) {
  const camera = cameraOf(shot), focal = camera.focalLength ?? (camera.fov ? fovToFocalLength(camera.fov, aspectOf(shot)) : 24);
  const duration = shot.durationSeconds ?? (shot.durationMs === undefined ? undefined : shot.durationMs / 1000);
  return duration > 0 ? `动态 · ${duration} 秒 · ${Math.round(focal)} mm` : `${Math.round(focal)} mm`;
}
function loadStyle(document) {
  const href = new URL('camera-manager.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = href; style.dataset.studioV3CameraManager = ''; document.head.append(style);
}

/** Domain edits, real offscreen previews, persistence receipts and panel dismissal
 * belong to the host. This component owns only the manager's local UI state. */
export function createCameraManager({read, openShot, renameShot, removeShot, loadThumbnail, exportShots, close = () => {}, onError = () => {}} = {}) {
  for (const [name, action] of Object.entries({read, openShot, renameShot, removeShot, loadThumbnail, exportShots})) if (typeof action !== 'function') throw TypeError(`镜头管理需要 ${name}`);
  const root = el('section', 'sv3-camera-manager'), document = root.ownerDocument, view = document.defaultView;
  root.tabIndex = -1;
  root.dataset.worldWorkspaceBlockMovementHotkeys = 'true'; root.dataset.keyboardScope = 'local-tool'; root.setAttribute('aria-label', '镜头管理'); loadStyle(document);
  const header = el('header', 'sv3-camera-manager-header'), heading = el('strong', '', '镜头管理'), body = el('div', 'sv3-camera-manager-body'), footer = el('footer', 'sv3-camera-manager-footer'), feedback = el('div', 'sv3-camera-manager-feedback');
  feedback.setAttribute('role', 'alert'); feedback.hidden = true;
  let disposed = false, inFlight = false, batch = false, batchEpoch = 0, editing = null, deleting = null, snapshot = {}, layoutKey = null, exportBatch = null, pumping = false;
  let initialHydration = true, receiptIds = null, missingReceiptIds = [];
  const records = new Map(), selected = new Set(), queue = [], listeners = [];
  const listen = (node, type, handler) => {node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));};
  const state = () => read() || {};
  const busy = () => disposed || inFlight || !!state().busy;
  const locked = () => busy() || !!state().readOnly;
  function restoreFocus(target) {
    if (disposed || !root.isConnected) return;
    const usable = target?.isConnected && root.contains(target) && !target.disabled && !target.closest('[hidden],[inert],[aria-hidden="true"]');
    (usable ? target : root).focus({preventScroll: true});
  }
  const report = error => {if (disposed) return; feedback.textContent = error?.message || String(error); feedback.hidden = false; onError(error);};
  const liveShot = rec => !disposed && records.get(rec.key) === rec ? (state().shots || []).find(shot => identity(shot) === rec.key) : null;
  const releaseThumbnail = rec => {rec.controller?.abort(); rec.controller = null; rec.token++; const dispose = rec.thumbnailDispose; rec.thumbnailDispose = null; try {dispose?.();} catch (error) {report(error);}};
  const releaseResult = result => {try {result?.dispose?.();} catch (error) {report(error);}};
  function previewUnavailable(rec) {rec.preview.replaceChildren(); const graphic = el('span'); graphic.innerHTML = icon('cameraManager', {size: 24, strokeWidth: 1.75}); rec.preview.append(graphic, el('span', '', '预览不可用')); rec.preview.dataset.status = 'error';}
  async function pump() {
    if (pumping || disposed) return; pumping = true;
    try {
      while (queue.length && !disposed) {
        const task = queue.shift(), {rec, token, key, shot, controller} = task;
        if (records.get(rec.key) !== rec || rec.token !== token || controller.signal.aborted) continue;
        let result;
        try {
          result = await loadThumbnail(shot, {signal: controller.signal, width: 320, height: 180});
          if (disposed || records.get(rec.key) !== rec || rec.token !== token || controller.signal.aborted || thumbnailKey(liveShot(rec) || {}) !== key) {releaseResult(result); continue;}
          const url = typeof result === 'string' ? result : result?.url;
          if (typeof url !== 'string' || !url) throw Error('预览不可用');
          rec.thumbnailDispose = typeof result?.dispose === 'function' ? () => result.dispose() : null;
          const image = document.createElement('img'); image.alt = shotName(rec.shot); image.src = url;
          image.onerror = () => {if (!disposed && rec.token === token && records.get(rec.key) === rec) {rec.thumbnailDispose?.(); rec.thumbnailDispose = null; previewUnavailable(rec);}};
          rec.preview.replaceChildren(image); rec.preview.dataset.status = 'ready';
        } catch (error) {
          if (!disposed && rec.token === token && records.get(rec.key) === rec && !controller.signal.aborted) {releaseResult(result); previewUnavailable(rec);}
        }
      }
    } finally {pumping = false;}
  }
  function requestThumbnail(rec) {
    const key = thumbnailKey(rec.shot); if (rec.thumbnailKey === key) return;
    releaseThumbnail(rec); rec.thumbnailKey = key; rec.preview.replaceChildren(); rec.preview.dataset.status = 'loading';
    const controller = new AbortController(); rec.controller = controller;
    queue.push({rec, token: rec.token, key, shot: structuredClone(rec.shot), controller}); void pump();
  }
  async function operation(action, message, success) {
    if (locked()) return false; inFlight = true; refresh(); let focusAfter = null;
    try {const result = await action(); if (!accepted(result)) throw Error(result?.message || message); if (disposed) return false; feedback.hidden = true; focusAfter = success?.(result); return true;}
    catch (error) {report(error); return false;} finally {inFlight = false; refresh(); if (focusAfter) restoreFocus(focusAfter);}
  }
  function cancelRename({focus = true} = {}) {if (!editing) return; const rec = editing; editing = null; rec.input.remove(); rec.title.hidden = false; refresh(); if (focus) restoreFocus(rec.rename);}
  function beginRename(rec) {
    if (locked() || batch || !liveShot(rec)) return; cancelRename({focus: false}); dismissDelete({focus: false}); editing = rec;
    const input = document.createElement('input'); input.className = 'sv3-camera-manager-name'; input.value = shotName(rec.shot); input.setAttribute('aria-label', '保存名称'); rec.input = input; rec.title.hidden = true; rec.caption.prepend(input);
    const commit = async () => {
      if (editing !== rec || locked()) return;
      const shot = liveShot(rec), name = input.value.trim(); if (!shot) {cancelRename(); return;}
      if (!name || name === shotName(shot)) {cancelRename(); return;}
      const ok = await operation(() => renameShot(shot, name), '名称修改未被接受', () => {cancelRename({focus: false}); return rec.rename;});
      if (!ok && !disposed && editing === rec) {input.disabled = false; input.focus();}
    };
    input.onkeydown = event => {event.stopPropagation(); if (composing(event)) return; if (event.key === 'Enter') {event.preventDefault(); void commit();} if (event.key === 'Escape') {event.preventDefault(); cancelRename();}};
    input.onblur = () => void commit(); input.onclick = event => event.stopPropagation(); input.focus(); input.select();
  }
  const confirmation = el('div', 'sv3-camera-manager-confirm'); confirmation.hidden = true; confirmation.setAttribute('role', 'alertdialog');
  const deleteTitle = el('strong'), deleteDescription = el('p', '', '关联的机位和动画也会一并删除'), deleteActions = el('div', 'sv3-camera-manager-confirm-actions');
  const deleteCancel = button(null, '取消', dismissDelete, {text: '取消'}), deleteConfirm = button(null, '删除', () => {
    const rec = deleting, shot = rec && liveShot(rec); if (!shot || locked() || state().playing) return;
    void operation(() => removeShot(shot), '镜头删除未被接受', () => {dismissDelete({focus: false}); return rec.remove;});
  }, {text: '删除'});
  deleteCancel.setAttribute('aria-label', '取消'); deleteConfirm.setAttribute('aria-label', '删除');
  deleteActions.append(deleteCancel, deleteConfirm); confirmation.append(deleteTitle, deleteDescription, deleteActions);
  function dismissDelete({focus = true} = {}) {const rec = deleting; deleting = null; confirmation.hidden = true; if (rec && focus) restoreFocus(rec.remove);}
  function beginDelete(rec) {
    if (locked() || state().playing || batch || !liveShot(rec)) return; cancelRename({focus: false}); deleting = rec;
    deleteTitle.textContent = `删除“${shotName(rec.shot)}”？`; confirmation.setAttribute('aria-label', deleteTitle.textContent); confirmation.hidden = false;
    const anchor = rec.remove.getBoundingClientRect(), bounds = root.getBoundingClientRect();
    confirmation.style.left = `${Math.max(0, Math.min(Math.max(0, (bounds.width || 560) - 280), anchor.right - bounds.left - 280))}px`;
    confirmation.style.top = `${Math.max(0, anchor.top - bounds.top - (confirmation.offsetHeight || 144) - 8)}px`; deleteCancel.focus();
  }
  function makeRecord(shot) {
    const key = identity(shot), article = el('article', 'sv3-camera-manager-shot'), open = el('div', 'sv3-camera-manager-open'), choice = el('label', 'sv3-camera-manager-choice'), checkbox = document.createElement('input'), mark = el('span', 'sv3-camera-manager-checkbox'), visual = el('div', 'sv3-camera-manager-visual'), preview = el('div', 'sv3-camera-manager-preview'), caption = el('div', 'sv3-camera-manager-caption'), title = el('span', 'sv3-camera-manager-title'), metadata = el('span', 'sv3-camera-manager-metadata'), actions = el('div', 'sv3-camera-manager-actions');
    checkbox.type = 'checkbox'; checkbox.className = 'sv3-camera-manager-native-checkbox'; mark.innerHTML = icon('check', {size: 12, strokeWidth: 2.5}); mark.setAttribute('aria-hidden', 'true');
    open.setAttribute('role', 'button'); open.tabIndex = 0; caption.append(title, metadata); visual.append(preview, caption); open.append(visual); choice.append(checkbox, mark); article.append(open, choice, actions); article.dataset.shotId = shot.id;
    const rec = {key, shot, article, open, choice, checkbox, mark, visual, preview, caption, title, metadata, actions, token: 0, thumbnailKey: null};
    rec.rename = button(null, '', () => beginRename(rec)); rec.rename.innerHTML = icon('rename', {size: 14, strokeWidth: 1.75}); rec.remove = button(null, '', () => beginDelete(rec)); rec.remove.innerHTML = icon('delete', {size: 14, strokeWidth: 1.75}); actions.append(rec.rename, rec.remove);
    const jump = () => {const current = liveShot(rec); if (!current || locked() || batch || editing === rec) return; void operation(() => openShot(current), '镜头跳转未被接受');};
    open.onclick = jump; open.onkeydown = event => {if (composing(event) || event.target !== open || !['Enter', ' '].includes(event.key)) return; event.preventDefault(); jump();};
    checkbox.onchange = () => {if (locked() || !batch || exportBatch) {checkbox.checked = selected.has(rec.key); return;} checkbox.checked ? selected.add(rec.key) : selected.delete(rec.key); refresh();};
    return rec;
  }
  function exitBatch() {batchEpoch++; batch = false; exportBatch = null; receiptIds = null; missingReceiptIds = []; selected.clear(); refresh(); restoreFocus(headerAction);}
  const headerAction = button(null, '导出到画布', () => {
    if (locked() || exportBatch) return;
    if (batch) {for (const shot of snapshot.shots || []) selected.add(identity(shot));}
    else {cancelRename({focus: false}); dismissDelete({focus: false}); selected.clear(); batchEpoch++; batch = true;} refresh();
  }, {text: '导出到画布'});
  const cancelBatch = button(null, '取消', () => {if (!locked() && !exportBatch) exitBatch();}, {text: '取消'}), exportButton = button(null, '导出', () => void exportSelected(), {text: '导出'});
  cancelBatch.setAttribute('aria-label', '取消'); exportButton.setAttribute('aria-label', '导出');
  async function exportSelected() {
    if (locked() || !batch || missingReceiptIds.length) return; const shots = exportBatch || (state().shots || []).filter(shot => selected.has(identity(shot))); if (!shots.length) return;
    const epoch = batchEpoch; inFlight = true; refresh();
    try {
      const result = await exportShots(shots); if (!accepted(result)) throw Object.assign(Error(result?.message || '镜头导出未完成'), result);
      if (!disposed && batchEpoch === epoch) {feedback.hidden = true; exitBatch();}
    } catch (error) {
      // The host can retain a partially applied export receipt. Keep its exact
      // batch stable for retry, rather than requesting duplicate image nodes.
      if (!disposed && batch && batchEpoch === epoch && (error?.applied || error?.retryable || error?.pending)) {exportBatch = shots; receiptIds = shots.map(shot => shot.id);} report(error);
    } finally {inFlight = false; refresh();}
  }
  header.append(heading, headerAction); footer.append(cancelBatch, exportButton); root.append(header, body, footer, feedback, confirmation);
  function refresh() {
    if (disposed) return;
    try {
      snapshot = state(); root.hidden = !!snapshot.readOnly; const shots = snapshot.shots || [], valid = new Set(shots.map(identity));
      // Restore the host's persistence receipt exactly once per panel lifetime.
      // A later refresh must not undo the user's Escape back to normal mode.
      if (initialHydration) {
        initialHydration = false;
        if (snapshot.pendingExportShotIds?.length) {
          receiptIds = [...snapshot.pendingExportShotIds]; batch = true; batchEpoch++;
          exportBatch = receiptIds.map(id => shots.find(shot => shot.id === id)).filter(Boolean);
          missingReceiptIds = receiptIds.filter(id => !shots.some(shot => shot.id === id));
          for (const shot of exportBatch) selected.add(identity(shot));
          feedback.textContent = missingReceiptIds.length ? `上次导出的镜头不存在，无法重试保存：${missingReceiptIds.join('、')}` : '上次导出尚未保存，请重试保存'; feedback.hidden = false;
        }
      }
      for (const [key, rec] of records) if (!valid.has(key)) {releaseThumbnail(rec); rec.article.remove(); records.delete(key); selected.delete(key); if (editing === rec) {editing = null;} if (deleting === rec) dismissDelete();}
      for (const shot of shots) {const key = identity(shot); if (!records.has(key)) records.set(key, makeRecord(shot)); records.get(key).shot = shot;}
      const layout = JSON.stringify(shots.map(shot => [identity(shot), shot.setupId, cameraManagerSetupLabel(snapshot.setupLabels?.[shot.setupId] ?? shot.setupLabel)]));
      if (layout !== layoutKey) {
        layoutKey = layout; body.replaceChildren(); const groups = new Map();
        for (const shot of shots) {const id = shot.setupId ?? ''; if (!groups.has(id)) {const section = el('section', 'sv3-camera-manager-group'), label = el('h3', '', cameraManagerSetupLabel(snapshot.setupLabels?.[id] ?? shot.setupLabel)), grid = el('div', 'sv3-camera-manager-grid'); section.append(label, grid); body.append(section); groups.set(id, grid);} groups.get(id).append(records.get(identity(shot)).article);}
        if (!shots.length) body.append(el('p', 'sv3-camera-manager-empty', '暂无镜头'));
      }
      const disabled = locked(); root.setAttribute('aria-busy', String(busy())); heading.textContent = batch ? '批量导出' : '镜头管理'; headerAction.hidden = !shots.length; headerAction.disabled = disabled || !!exportBatch; headerAction.setAttribute('aria-label', batch ? '全选' : '导出到画布'); headerAction.title = batch ? '全选' : '导出到画布';
      headerAction.innerHTML = batch ? '<span>全选</span>' : `${icon('export', {size: 16, strokeWidth: 1.9})}<span>导出到画布</span>`; headerAction.dataset.iconOnly = 'false';
      footer.hidden = !batch; cancelBatch.disabled = !batch || disabled || !!exportBatch; exportButton.disabled = !batch || disabled || !!missingReceiptIds.length || (!exportBatch && !selected.size); const exportLabel = receiptIds ? '重试保存' : '导出'; exportButton.textContent = busy() ? '导出中…' : exportLabel; exportButton.setAttribute('aria-label', exportLabel); exportButton.title = exportLabel;
      for (const rec of records.values()) {
        const name = shotName(rec.shot); rec.title.textContent = name; rec.title.title = name; rec.metadata.textContent = cameraManagerMetadata(rec.shot); rec.preview.style.aspectRatio = String(aspectOf(rec.shot)); const image = rec.preview.querySelector('img'); if (image) image.alt = name; rec.article.dataset.active = String(rec.shot.cameraId === snapshot.activeCameraId || rec.shot.id === snapshot.activeCameraId);
        rec.open.setAttribute('aria-label', `跳转到${name}`); rec.open.setAttribute('aria-disabled', String(disabled)); rec.open.tabIndex = disabled || batch ? -1 : 0; rec.open.hidden = batch; rec.choice.hidden = !batch; rec.actions.hidden = batch;
        if (rec.visual.parentNode !== (batch ? rec.choice : rec.open)) (batch ? rec.choice : rec.open).append(rec.visual);
        rec.checkbox.disabled = disabled || !!exportBatch; rec.checkbox.checked = selected.has(rec.key); rec.checkbox.setAttribute('aria-label', name); rec.mark.dataset.checked = String(rec.checkbox.checked);
        rec.rename.title = `重命名“${name}”`; rec.rename.setAttribute('aria-label', rec.rename.title); rec.rename.disabled = disabled; rec.remove.title = `删除“${name}”`; rec.remove.setAttribute('aria-label', rec.remove.title); rec.remove.disabled = disabled || !!snapshot.playing; if (editing === rec) rec.input.disabled = disabled;
        if (!snapshot.readOnly) requestThumbnail(rec);
      }
      deleteCancel.disabled = busy(); deleteConfirm.disabled = disabled || !!snapshot.playing;
    } catch (error) {report(error);}
  }
  function handleEscape() {
    if (disposed) return false;
    if (deleting) dismissDelete(); else if (editing) cancelRename(); else if (batch) exitBatch(); else close(); return true;
  }
  listen(root, 'keydown', event => {
    event.stopPropagation(); if (event.defaultPrevented || composing(event) || event.key !== 'Escape') return;
    event.preventDefault(); handleEscape();
  });
  listen(root, 'pointerdown', event => {if (deleting && !confirmation.contains(event.target) && !deleting.remove.contains(event.target)) dismissDelete();});
  for (const type of ['keyup', 'pointerdown', 'pointermove', 'pointerup', 'click', 'wheel', 'contextmenu']) listen(root, type, event => event.stopPropagation());
  root.refresh = refresh; root.handleEscape = handleEscape;
  root.dispose = () => {
    if (disposed) return; disposed = true; for (const rec of records.values()) {releaseThumbnail(rec); rec.input && (rec.input.onblur = rec.input.onkeydown = null); rec.open.onclick = rec.open.onkeydown = rec.checkbox.onchange = rec.rename.onclick = rec.remove.onclick = null;}
    queue.length = 0; for (const remove of listeners) remove(); for (const item of [headerAction, cancelBatch, exportButton, deleteCancel, deleteConfirm]) {item.onclick = null; item.disabled = true;} records.clear();
  };
  refresh(); return root;
}
