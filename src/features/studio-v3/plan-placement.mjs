import {clone, same} from './invariants.mjs';
import {reduceEntityAction, resolveEntityControl} from './entity-actions.mjs';
import {cameraAtSurface} from './camera-create.mjs';
import {setEntityHeading} from './transform-coordinates.mjs';
import {setupLane} from './history.mjs';

const validXZ = point => point && [point.x, point.z].every(Number.isFinite);

/** Domain placement lease. The host owns pointer capture and the displayed
 * projection; this module owns one fixed author/source/history transaction. */
export function createPlanPlacement({getState, session, getRuntime = () => null,
  isCurrent = () => session?.isCurrent?.() !== false, getBusy = () => false,
  beforeWrite = async () => ({ok: true}), onLane = () => {}, onChange = () => {},
  onSelect = () => true, onError = () => {}, createId = () => crypto.randomUUID(), now = Date.now} = {}) {
  if ([getState, getRuntime, isCurrent, getBusy, beforeWrite, onLane, onChange, onSelect, onError, createId, now].some(value => typeof value !== 'function') || !session?.history) throw new TypeError('俯视摆位需要作者会话');
  let disposed = false, active = null, pending = null, generation = 0;
  const report = error => {try {onError(error);} catch {}};
  const emit = () => {try {onChange();} catch (error) {report(error);}};
  function identity() {
    const state = getState(), space = state.scenePlay.worldSpace, {revision, ...fence} = session.getFence?.() ?? {};
    return {worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId, source: clone(space.source), fence: clone(fence)};
  }
  const current = gesture => !disposed && isCurrent() && same(gesture.token, identity());
  const nativeCurrent = gesture => getRuntime() === gesture.runtime && gesture.runtime?.graph === gesture.graph && gesture.graph?.source === gesture.sourceRecord && !gesture.runtime?.disposed;
  const owns = gesture => active === gesture && gesture.transaction && same(session.history.getActiveTransaction(), gesture.transaction);
  function detach(gesture) {if (active === gesture) active = null; if (pending === gesture) pending = null;}
  function cancelGesture(gesture = active ?? pending) {
    if (!gesture) return false;
    if (gesture.cancelled) return true;
    if (gesture.transaction && !owns(gesture)) {detach(gesture); return false;}
    try {
      if (gesture.transaction && session.history.cancel() !== true) return false;
      gesture.cancelled = true; detach(gesture); emit(); void restoreNative(gesture); return true;
    } catch (error) {report(error); return false;}
  }
  async function restoreNative(gesture) {
    // Abandoned preparation can finish after a new pointer or foreign edit.
    // Never resync an old snapshot, touch a replaced graph or end foreign work.
    if (active || pending || !isCurrent() || !nativeCurrent(gesture) || session.history.getActiveTransaction()) return;
    try {await gesture.runtime.sync(getState()); if (isCurrent() && nativeCurrent(gesture)) gesture.runtime.render?.();}
    catch (error) {report(error);}
  }
  async function begin({kind, label, roleId, point, projection, nx, ny, color, actorGender} = {}) {
    if (disposed || pending || active || !isCurrent() || getBusy() || session.history.getActiveTransaction() || !['actor', 'camera'].includes(kind)) return null;
    let gesture;
    try {
      const state = getState(), space = state.scenePlay.worldSpace, setup = space.setups.find(value => value.id === space.activeSetupId);
      if (!setup || kind === 'camera' && setup.kind !== 'independent' || roleId !== undefined && kind !== 'actor') return null;
      if (kind === 'actor' && !roleId && (typeof label !== 'string' || !label.trim())) return null;
      const runtime = getRuntime(); if (!runtime?.resolvePlanSurface || typeof runtime.sync !== 'function') return null;
      const surface = runtime.resolvePlanSurface({point, projection, nx, ny}); if (!surface || !validXZ(surface.point) || !Number.isFinite(surface.point.y)) return null;
      gesture = {generation: ++generation, token: identity(), runtime, graph: runtime.graph, sourceRecord: runtime.graph?.source,
        point: clone(surface.point), kind, entityId: createId(), cancelled: false, transaction: null}; pending = gesture;
      const gate = await beforeWrite();
      if (gate === false || gate?.ok === false || pending !== gesture || gesture.generation !== generation || !current(gesture) || !nativeCurrent(gesture) || getBusy() || session.history.getActiveTransaction()) {cancelGesture(gesture); return null;}
      // Resolve the role and setup again after awaiting the author-view handoff.
      const latest = getState(), latestSpace = latest.scenePlay.worldSpace, latestSetup = latestSpace.setups.find(value => value.id === latestSpace.activeSetupId);
      if (!latestSetup || kind === 'camera' && latestSetup.kind !== 'independent') {cancelGesture(gesture); return null;}
      let pose = {transform: {position: clone(gesture.point)}};
      if (kind === 'camera') pose = cameraAtSurface({point: gesture.point, visibleCamera: runtime.getVisibleCameraState()});
      const action = {type: 'create', kind, id: gesture.entityId, setupId: latestSetup.id, ...pose,
        ...(label !== undefined ? {label: label.trim()} : {}),
        ...(kind === 'actor' ? roleId ? {existingRoleId: roleId} : {roleId: createId(), ...(color !== undefined ? {color} : {}), ...(actorGender !== undefined ? {actorGender} : {})} : {})};
      const result = reduceEntityAction(latest, action, {now: now()}); if (!result.ok || !result.changed) {cancelGesture(gesture); return null;}
      gesture.lane = latestSetup.kind === 'scene-baseline' ? 'world' : setupLane(latestSetup.id);
      // Distinct lease labels also fence a cancelled gesture from a subsequent
      // transaction because the existing history API exposes no transaction ID.
      if (!session.history.begin(gesture.lane, `director.placeEntity:${gesture.entityId}`, result.scope)) {cancelGesture(gesture); return null;}
      gesture.transaction = session.history.getActiveTransaction(); active = gesture;
      if (!session.history.preview(() => result.state)) {cancelGesture(gesture); return null;}
      gesture.token = identity(); gesture.original = resolveEntityControl(getState(), {entityId: gesture.entityId}).setupState;
      try {onLane(gesture.lane);} catch (error) {report(error);} emit();
      await runtime.sync(getState());
      const record = gesture.graph?.entity?.(gesture.entityId) ?? gesture.graph?.entities?.get(gesture.entityId);
      if (pending !== gesture || gesture.generation !== generation || !owns(gesture) || !current(gesture) || !nativeCurrent(gesture) || getBusy() || record?.status !== 'ready') {
        if (record?.status === 'failed') report(record.error || Error('摆位模型加载失败'));
        cancelGesture(gesture); await restoreNative(gesture); return null;
      }
      // Selection happens only after the real asset exists. The host must not
      // classify its own pending placement as an unrelated busy operation.
      if (await onSelect(gesture.entityId) === false || pending !== gesture || !owns(gesture) || !current(gesture) || !nativeCurrent(gesture) || getBusy()) {
        cancelGesture(gesture); await restoreNative(gesture); return null;
      }
      pending = null; emit();
      const usable = () => {
        if (!owns(gesture)) return false;
        if (!current(gesture) || !nativeCurrent(gesture) || getBusy()) {cancelGesture(gesture); return false;}
        return true;
      };
      function onMove({position, heading} = {}) {
        if (!usable()) return false;
        try {
          if (position !== undefined && !validXZ(position) || heading !== undefined && !Number.isFinite(heading)) return false;
          if (heading === undefined && position) {
            const dx = position.x - gesture.point.x, dz = position.z - gesture.point.z;
            if (Math.hypot(dx, dz) < .05) return true;
            heading = Math.atan2(dx, -dz);
          }
          if (heading === undefined) return true;
          const transform = setEntityHeading(kind, gesture.original.transform, heading);
          const result = reduceEntityAction(getState(), {type: 'update', entityId: gesture.entityId, patch: {transform}}, {now: now()});
          if (!result.ok) return false;
          if (result.changed) session.history.preview(() => result.state);
          gesture.token = identity(); emit(); return true;
        } catch (error) {report(error); return false;}
      }
      return {entityId: gesture.entityId, onMove, onEnd(patch) {
        if (!usable() || patch && !onMove(patch)) return false;
        try {
          const committed = session.history.commit();
          if (committed) {gesture.completed = true; detach(gesture); emit();}
          return committed === true;
        } catch (error) {report(error); cancelGesture(gesture); return false;}
      }, onCancel: () => cancelGesture(gesture)};
    } catch (error) {report(error); if (gesture) {cancelGesture(gesture); await restoreNative(gesture);} return null;}
  }
  function cancel() {generation++; return cancelGesture();}
  function dispose() {if (disposed) return false; cancel(); disposed = true; return true;}
  return {begin, cancel, dispose, get active() {return active ? {entityId: active.entityId, kind: active.kind, point: clone(active.point), pending: !!pending} : null;}};
}
