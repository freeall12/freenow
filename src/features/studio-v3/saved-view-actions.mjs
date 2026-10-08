import {assertJson, clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertCamera, assertState, createView} from './schema.mjs';
import {addView, removeView} from './world-space.mjs';
import {setupLane} from './history.mjs';

const actionFields = {
  create: ['type', 'id', 'camera', 'label', 'notes', 'tags'],
  'update-camera': ['type', 'viewId', 'camera'],
  rename: ['type', 'viewId', 'label'],
  remove: ['type', 'viewId'],
  'set-active': ['type', 'viewId']
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function fields(value, allowed, path) {
  requireDomain(isRecord(value), path, 'must be a plain object');
  for (const key of Object.keys(value)) requireDomain(allowed.includes(key), `${path}.${key}`, 'unsupported field');
}

/** All persisted Views, including capture-only and unlinked Views. No shot
 * synthesis or entity-camera override belongs in this list. */
export function listSavedViews(state, options = {}) {
  assertState(state); assertJson(options, 'savedViews.options');
  fields(options, ['stageId', 'setupId'], 'savedViews.options');
  for (const key of Object.keys(options)) requireDomain(nonempty(options[key]), `savedViews.options.${key}`, 'must be nonempty text');
  const space = state.scenePlay.worldSpace;
  const stages = new Map(space.stages.map(stage => [stage.id, stage]));
  const setups = new Map(space.setups.map(setup => [setup.id, setup]));
  return clone(space.views.filter(view => (options.stageId === undefined || view.stageId === options.stageId) &&
    (options.setupId === undefined || view.setupId === options.setupId)).map(view => ({...view,
    stageLabel: stages.get(view.stageId).label, setupLabel: setups.get(view.setupId).label, isActive: view.id === space.activeViewId})));
}

/** Pure persisted View actions. A host owns camera capture/navigation,
 * transaction fencing, saving and UI; camera input is a complete snapshot. */
export function reduceSavedViewAction(state, action, {now = Date.now(), readonly = false, playing = false, scrubbing = false} = {}) {
  assertState(state); assertJson(action, 'savedViewAction');
  requireDomain(isRecord(action) && Object.hasOwn(actionFields, action.type), 'savedViewAction.type', 'unknown action');
  fields(action, actionFields[action.type], 'savedViewAction');
  requireDomain(Number.isFinite(now) && now >= 0, 'savedViewAction.now', 'must be a finite nonnegative timestamp');
  for (const [key, value] of Object.entries({readonly, playing, scrubbing})) requireDomain(typeof value === 'boolean', `savedViewAction.${key}`, 'must be boolean');
  const space = state.scenePlay.worldSpace, selection = action.type === 'set-active';
  if (action.type === 'create') requireDomain(nonempty(action.id), 'savedViewAction.id', 'requires a nonempty View ID');
  else requireDomain(selection && action.viewId === null || nonempty(action.viewId), 'savedViewAction.viewId', 'requires a nonempty View ID or null for selection');
  const view = action.type === 'create' ? null : space.views.find(item => item.id === action.viewId);
  const setup = space.setups.find(item => item.id === (view?.setupId ?? space.activeSetupId));
  const lane = selection ? 'world' : setupLane(setup.id);
  const viewId = action.type === 'create' ? action.id : action.viewId;
  const deny = (reason, message) => ({ok: false, changed: false, state, lane, viewId, reason, message});
  const unchanged = () => ({ok: true, changed: false, state, lane, viewId, reason: 'unchanged', message: '视图未改变。'});
  const finish = (next, historyLabel) => {
    assertState(next);
    if (same(next, state)) return unchanged();
    return {ok: true, changed: true, state: clone(next), lane, viewId, historyLabel};
  };
  // Persistent selection is a session.change too: current readonly sessions
  // reject every transaction, even content:false. Navigation stays host-owned.
  if (readonly) return deny('readonly', '当前场地为只读。');
  if (!selection && playing) return deny('playing', '请先停止播放，再修改视图。');
  if (!selection && scrubbing) return deny('scrubbing', '请先结束时间轴拖动，再修改视图。');
  if (action.type !== 'create' && action.viewId !== null && !view) return deny('view-missing', '保存的视图不存在。');
  if (selection) {
    const nextSpace = {...space, activeViewId: action.viewId, ...(view ? {activeStageId: view.stageId, activeSetupId: view.setupId} : {})};
    return finish({...state, scenePlay: {...state.scenePlay, worldSpace: nextSpace}}, '选择视图');
  }
  if (action.type === 'create') {
    if (setup.kind !== 'independent') return deny('baseline-readonly', '请切换到独立状态后保存视图。');
    requireDomain(!space.views.some(item => item.id === action.id), 'savedViewAction.id', 'View ID already exists', 'duplicate-id');
    const label = action.label ?? `View ${space.views.length + 1}`;
    requireDomain(typeof label === 'string', 'savedViewAction.label', 'must be text');
    if (!label.trim()) return deny('empty-label', '视图名称不能为空。');
    if (Object.hasOwn(action, 'notes')) requireDomain(typeof action.notes === 'string', 'savedViewAction.notes', 'must be text');
    assertCamera(action.camera, 'savedViewAction.camera', new Map(space.entities.map(item => [item.id, item])), setup.stageId);
    const nextView = createView({id: action.id, stageId: setup.stageId, setupId: setup.id, camera: action.camera,
      label: label.trim(), ...(Object.hasOwn(action, 'notes') ? {notes: action.notes} : {}), tags: action.tags ?? ['capture'], now});
    return finish(addView(state, nextView), '保存视图');
  }
  if (action.type === 'remove') return finish(removeView(state, view.id), '删除视图');
  let patch, historyLabel;
  if (action.type === 'rename') {
    requireDomain(typeof action.label === 'string', 'savedViewAction.label', 'must be text');
    const label = action.label.trim();
    if (!label) return deny('empty-label', '视图名称不能为空。');
    if (label === view.label) return unchanged();
    patch = {label}; historyLabel = '重命名视图';
  } else {
    assertCamera(action.camera, 'savedViewAction.camera', new Map(space.entities.map(item => [item.id, item])), view.stageId);
    if (same(action.camera, view.camera)) return unchanged();
    patch = {camera: clone(action.camera)}; historyLabel = '更新视图相机';
  }
  requireDomain(now >= view.createdAt, 'savedViewAction.now', 'cannot predate View creation');
  const nextSpace = {...space, views: space.views.map(item => item.id === view.id ? {...item, ...patch, updatedAt: now} : item)};
  return finish({...state, scenePlay: {...state.scenePlay, worldSpace: nextSpace}}, historyLabel);
}
