import {clone, same} from './invariants.mjs';
import {listSavedViews, reduceSavedViewAction} from './saved-view-actions.mjs';

const scope = Object.freeze({kind: 'world-space'});
const messages = {
  disposed: '视图工作区已关闭。', stale: '场地、来源或编辑状态已改变，请重新操作。', busy: '请等待当前操作完成。',
  readonly: '当前场地为只读。', playing: '请先停止播放，再操作视图。', scrubbing: '请先结束时间轴拖动，再操作视图。',
  'transaction-active': '请先完成当前编辑。', 'pending-save': '视图已应用但尚未保存，请重试保存。',
  'baseline-readonly': '请切换到独立状态后保存视图。', 'navigation-unavailable': '请切换到可用的 3D 导航视角。',
  'view-missing': '保存的视图不存在。', 'pending-drift': '待保存视图之后已有其他编辑，请使用场地保存完成当前状态。',
  'navigation-failed': '已选择视图，但相机恢复未完成。', 'save-failed': '视图已应用，但保存失败，请重试保存。'
};
const rejected = (reason, extra = {}) => ({ok: false, reason, message: messages[reason] ?? reason, ...extra});

/** Session-owned View CRUD and orbit navigation. Persistence acknowledgements
 * and navigation completion are separate outcomes, never inferred from a row. */
export function createSavedViewWorkspace({getState, session, getRuntime = () => null,
  isCurrent = () => session?.isCurrent?.() !== false, getSourceKey = () => null, getBusy = () => false,
  beforeWrite = () => ({ok: true}), waitForSync = () => Promise.resolve(), onLane = () => {}, onChange = () => {},
  onSelect = () => true, prepareNavigation = () => true, createId = () => `view:${crypto.randomUUID()}`, now = Date.now} = {}) {
  if ([getState, getRuntime, isCurrent, getSourceKey, getBusy, beforeWrite, waitForSync, onLane, onChange, onSelect, prepareNavigation, createId, now].some(fn => typeof fn !== 'function') ||
    !session?.history || typeof session.change !== 'function' || typeof session.flush !== 'function') throw new TypeError('视图管理需要真实作者会话和导航桥');
  let disposed = false, active = null, pending = null, sequence = 0;
  const emit = () => {try {onChange();} catch { /* Observers cannot alter action or save acknowledgements. */ }};
  function identity() {
    const state = getState(), space = state.scenePlay.worldSpace, {revision, ...fence} = session.getFence?.() ?? {};
    return {worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId,
      source: clone(space.source), sourceKey: clone(getSourceKey()), fence: clone(fence)};
  }
  function ownerIdentity(value) {
    const {stageId, setupId, fence, ...owner} = value, {editEpoch, ...ownerFence} = fence;
    return {...owner, fence: ownerFence};
  }
  function stamp() {
    const runtime = getRuntime();
    return {identity: identity(), runtime, graph: runtime?.graph, sourceRecord: runtime?.graph?.source};
  }
  function current(token) {
    try {
      const runtime = getRuntime();
      return !disposed && isCurrent() === true && session.isCurrent?.() !== false && same(token.identity, identity()) &&
        runtime === token.runtime && runtime?.graph === token.graph && runtime?.graph?.source === token.sourceRecord;
    } catch {return false;}
  }
  function flags() {
    const value = getBusy();
    return typeof value === 'object' && value !== null ? value : {busy: !!value};
  }
  function blocked({allowRequest = false, allowPending = false, allowSaving = false} = {}) {
    if (disposed) return 'disposed';
    if (isCurrent() !== true || session.isCurrent?.() === false) return 'stale';
    const status = flags();
    if (status.readonly || status.readOnly) return 'readonly';
    if (status.playing) return 'playing';
    if (status.scrubbing) return 'scrubbing';
    if (session.history.getActiveTransaction()) return 'transaction-active';
    if (status.busy || !allowRequest && active || !allowSaving && session.getStatus?.().status === 'saving') return 'busy';
    if (!allowPending && pending) return 'pending-save';
    return null;
  }
  function valid(request) {
    return active === request && request.id === sequence && current(request.token) &&
      !blocked({allowRequest: true, allowPending: true, allowSaving: true});
  }
  function refreshPending() {
    if (!pending) return;
    try {
      if (disposed || isCurrent() !== true || session.isCurrent?.() === false || !same(ownerIdentity(pending.token.identity), ownerIdentity(identity()))) {
        pending.reason = 'stale'; pending.message = messages.stale; return;
      }
      // A top-level save acknowledges the whole same-owned session. It may
      // include later edits, but must never acknowledge a different source.
      if (session.getStatus?.().dirty === false && !session.history.getActiveTransaction()) {pending = null; return;}
      if (!current(pending.token) || !same(pending.state, getState())) {pending.reason = 'pending-drift'; pending.message = messages['pending-drift'];}
    } catch {pending.reason = 'stale'; pending.message = messages.stale;}
  }
  function receipt() {
    if (!pending) return null;
    return {viewId: pending.viewId, action: clone(pending.action), label: pending.label, message: pending.message,
      reason: pending.reason, applied: pending.applied, identity: clone(pending.token.identity), canRetry: !pending.reason || pending.reason === 'save-failed'};
  }
  function read() {
    refreshPending();
    const state = getState(), space = state.scenePlay.worldSpace;
    let reason = blocked();
    if (!reason && space.setups.find(item => item.id === space.activeSetupId)?.kind !== 'independent') reason = 'baseline-readonly';
    if (!reason && !getRuntime()?.getNavigationCameraState?.()) reason = 'navigation-unavailable';
    return {items: listSavedViews(state), activeViewId: space.activeViewId, canSave: !reason, busy: !!active || !!flags().busy || session.getStatus?.().status === 'saving',
      pendingSave: receipt(), disabledReason: reason ? messages[reason] : null};
  }
  async function persist(request, result, action) {
    if (!session.getStatus?.().dirty) return {...result, applied: result.changed, saved: true};
    const record = {viewId: result.viewId, action: clone(action), label: result.historyLabel ?? '保存视图选择', applied: result.changed,
      state: clone(getState()), token: request.token, reason: null, message: '正在保存视图。'};
    pending = record; emit();
    try {
      if (!valid(request)) return rejected('stale', {applied: result.changed, viewId: result.viewId});
      const saved = await session.flush();
      if (!valid(request)) {refreshPending(); return rejected('stale', {applied: result.changed, viewId: result.viewId});}
      if (saved?.ok !== true || session.getStatus?.().dirty !== false) {
        record.reason = 'save-failed'; record.message = messages['save-failed'];
        return rejected('save-failed', {applied: result.changed, viewId: result.viewId});
      }
      if (pending === record) pending = null;
      return {...result, applied: result.changed, saved: true};
    } catch (error) {
      record.reason = current(request.token) ? 'save-failed' : 'stale';
      record.message = record.reason === 'stale' ? messages.stale : `${messages['save-failed']} ${error?.message ?? ''}`.trim();
      return rejected(record.reason, {applied: result.changed, viewId: result.viewId, message: record.message});
    }
  }
  async function run(buildAction, {navigate = false} = {}) {
    refreshPending();
    const reason = blocked(); if (reason) return rejected(reason);
    const request = {id: ++sequence, token: stamp()}; active = request; emit();
    let applied = false, viewId = null;
    try {
      if (!valid(request)) return rejected('stale');
      const gate = await beforeWrite();
      if (!valid(request)) return rejected('stale');
      if (gate === false || gate?.ok === false) return gate?.ok === false ? gate : rejected('busy');
      const action = buildAction(); if (action?.ok === false) return action;
      viewId = action.viewId ?? action.id ?? null;
      const stored = navigate ? getState().scenePlay.worldSpace.views.find(view => view.id === viewId) : null;
      if (navigate && !stored) return rejected('view-missing', {viewId});
      const camera = stored ? clone(stored.camera) : null, status = flags();
      const result = reduceSavedViewAction(getState(), action, {now: now(), readonly: !!(status.readonly || status.readOnly), playing: !!status.playing, scrubbing: !!status.scrubbing});
      if (!result.ok || !valid(request)) return result.ok ? rejected('stale', {viewId}) : result;
      if (result.changed) {
        applied = session.change(() => result.state, {lane: result.lane, label: result.historyLabel, scope, content: action.type !== 'set-active'}) === true;
        if (!applied) return rejected('transaction-active', {viewId});
        // Our own selection/content mutation changes editEpoch and possibly
        // setup. Every subsequent async phase uses the fresh owned identity.
        request.token = stamp();
        try {onLane(result.lane);} catch { /* History selection observers cannot interrupt persistence. */ }
        emit();
      }
      const durable = await persist(request, result, action);
      if (!durable.ok || !navigate) return durable;
      if (!valid(request)) return rejected('stale', {applied, viewId, saved: true});
      await waitForSync();
      if (!valid(request)) return rejected('stale', {applied, viewId, saved: true});
      const prepared = await prepareNavigation();
      if (!valid(request)) return rejected('stale', {applied, viewId, saved: true});
      if (prepared === false || prepared?.ok === false) return rejected('navigation-failed', {applied, viewId, saved: true, restored: false});
      const selected = await onSelect(null);
      if (!valid(request)) return rejected('stale', {applied, viewId, saved: true});
      if (selected === false) return rejected('navigation-failed', {applied, viewId, saved: true, restored: false});
      const runtime = request.token.runtime;
      if (!valid(request) || typeof runtime?.restoreNavigationCamera !== 'function') return rejected('navigation-failed', {applied, viewId, saved: true, restored: false});
      const restored = await runtime.restoreNavigationCamera(camera, {duration: .8, isCurrent: () => valid(request)});
      if (!valid(request)) return rejected('stale', {applied, viewId, saved: true, restored: false});
      return restored === true ? {...durable, restored: true} : rejected('navigation-failed', {applied, viewId, saved: true, restored: false});
    } catch (error) {
      return rejected(current(request.token) ? 'action-failed' : 'stale', {applied, viewId, message: error?.message ?? messages.stale});
    } finally {if (active === request) {active = null; emit();}}
  }
  function currentCamera() {
    const state = getState(), space = state.scenePlay.worldSpace;
    if (space.setups.find(item => item.id === space.activeSetupId)?.kind !== 'independent') return rejected('baseline-readonly');
    const camera = getRuntime()?.getNavigationCameraState?.();
    return camera ? clone(camera) : rejected('navigation-unavailable');
  }
  async function retrySave() {
    refreshPending();
    const record = pending;
    if (!record) return {ok: true, changed: false, saved: true, reason: 'nothing-pending'};
    const reason = blocked({allowPending: true}); if (reason) return rejected(reason, {applied: record.applied, viewId: record.viewId});
    if (!current(record.token) || !same(record.state, getState()) || record.reason === 'pending-drift' || record.reason === 'stale') return rejected(record.reason === 'stale' ? 'stale' : 'pending-drift', {applied: record.applied, viewId: record.viewId});
    const request = {id: ++sequence, token: stamp()}; active = request; emit();
    try {
      if (!valid(request)) return rejected('stale', {applied: record.applied, viewId: record.viewId});
      const result = await session.flush();
      if (!valid(request)) return rejected('stale', {applied: record.applied, viewId: record.viewId});
      if (result?.ok !== true || session.getStatus?.().dirty !== false) return rejected('save-failed', {applied: record.applied, viewId: record.viewId});
      if (pending === record) pending = null;
      return {ok: true, changed: false, applied: record.applied, viewId: record.viewId, saved: true};
    } catch (error) {
      record.reason = current(request.token) ? 'save-failed' : 'stale'; record.message = `${messages[record.reason]} ${error?.message ?? ''}`.trim();
      return rejected(record.reason, {applied: record.applied, viewId: record.viewId, message: record.message});
    } finally {if (active === request) {active = null; emit();}}
  }
  function cancel() {sequence++; const hadRequest = !!active; active = null; emit(); return hadRequest;}
  function dispose() {if (disposed) return false; cancel(); disposed = true; return true;}
  return {
    read, saveCurrent: (options = {}) => run(() => {
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['label', 'notes', 'tags'].includes(key))) return rejected('invalid-options', {message: '视图保存选项仅支持名称、备注和标签。'});
      const camera = currentCamera(); return camera.ok === false ? camera : {type: 'create', id: createId(), camera, ...options};
    }),
    restore: viewId => run(() => ({type: 'set-active', viewId}), {navigate: true}),
    update: viewId => run(() => {const camera = currentCamera(); return camera.ok === false ? camera : {type: 'update-camera', viewId, camera};}),
    rename: (viewId, label) => run(() => ({type: 'rename', viewId, label})), remove: viewId => run(() => ({type: 'remove', viewId})),
    select: viewId => run(() => ({type: 'set-active', viewId})), retrySave, cancel, dispose,
    get busy() {return !!active;}
  };
}
