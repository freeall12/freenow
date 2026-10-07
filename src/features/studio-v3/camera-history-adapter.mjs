import {assertJson, clone, requireDomain, same} from './invariants.mjs';
import {assertCamera} from './schema.mjs';
import {reduceEntityAction, resolveEntityControl} from './entity-actions.mjs';
import {patchEntityState} from './world-space.mjs';

const label = '摄像机操控', scope = Object.freeze({kind: 'world-space'});
const reject = (code, message) => Object.assign(new Error(message), {code});

/** Synchronous bridge to the existing domain history. It owns a descriptor,
 * not the history engine, and must never cancel an unrelated transaction. */
export function createCameraHistoryAdapter({getState, history, onLane = () => {}, onStatus = () => {}} = {}) {
  requireDomain(typeof getState === 'function', 'cameraHistory.getState', 'requires a state reader');
  for (const name of ['begin', 'preview', 'commit', 'cancel', 'getActiveTransaction']) {
    requireDomain(typeof history?.[name] === 'function', `cameraHistory.history.${name}`, 'requires a history method');
  }
  requireDomain(typeof onLane === 'function' && typeof onStatus === 'function', 'cameraHistory.observers', 'must be callbacks');
  let owner = null, busy = false, disposed = false;
  function report(event, error) {
    try {onStatus({status: 'failed', phase: event?.phase, entityId: event?.entityId, message: error.message, error});} catch {}
  }
  function accepted(event) {
    try {onStatus({status: 'ready', phase: event.phase, entityId: event.entityId});} catch {}
    return true;
  }
  function eligible(state, entityId) {
    const space = state?.scenePlay?.worldSpace;
    if (space?.temporalPlaybackPlaying || space?.temporalPlayheadScrubbing) throw reject('camera-history-playing', '播放或拖动时间轴时不能编辑摄像机');
    const control = resolveEntityControl(state, {entityId});
    const setup = space.setups.find(item => item.id === control.setupId);
    if (control.definition.kind !== 'camera' || setup.kind !== 'independent' || control.baselineReadOnly ||
        control.ownerSetupId !== setup.id || !control.setupState?.camera || !control.setupState.visible) {
      throw reject('camera-history-subject', '只能操控当前独立状态中可写的摄像机');
    }
    if (setup.temporal?.tracks.some(track => track.owner.entityId === entityId && track.keys.length > 0)) {
      throw reject('camera-history-temporal', '摄像机已有关键帧，请先使用时间轴作者路径');
    }
    return control;
  }
  function owned(event) {
    if (!owner || owner.entityId !== event.entityId || !same(history.getActiveTransaction(), owner.transaction)) {
      throw reject('camera-history-foreign-transaction', '当前编辑事务不属于此摄像机操控');
    }
    return owner;
  }
  return {
    handle(event) {
      if (disposed || busy) return false;
      busy = true;
      try {
        requireDomain(event && ['begin', 'preview', 'commit', 'cancel'].includes(event.phase), 'cameraHistory.phase', 'unknown phase');
        requireDomain(typeof event.entityId === 'string' && event.entityId.length > 0, 'cameraHistory.entityId', 'requires entity identity');
        if (event.phase === 'begin') {
          if (owner || history.getActiveTransaction()) throw reject('camera-history-transaction-active', '请先完成当前编辑');
          const state = getState(), control = eligible(state, event.entityId);
          if (history.begin(control.stateLane, label, scope) !== true) throw reject('camera-history-begin-rejected', '摄像机编辑事务未开始');
          owner = {entityId: event.entityId, setupId: control.setupId, worldNodeId: state.scenePlay.worldNodeId,
            stageId: control.definition.stageId, transaction: {lane: control.stateLane, label, scope: clone(scope)}};
          try {onLane(control.stateLane);} catch (error) {report(event, error);}
          return !disposed && accepted(event);
        }
        const descriptor = owned(event);
        if (event.phase === 'preview') {
          const state = getState(), control = eligible(state, descriptor.entityId);
          if (state.scenePlay.worldNodeId !== descriptor.worldNodeId || control.setupId !== descriptor.setupId || control.definition.stageId !== descriptor.stageId) {
            throw reject('camera-history-target-changed', '摄像机操控的状态或场景已变化');
          }
          assertJson(event.camera, 'cameraHistory.camera'); assertCamera(event.camera, 'cameraHistory.camera');
          assertJson(event.transform, 'cameraHistory.transform');
          requireDomain(event.clearLookAt === undefined || typeof event.clearLookAt === 'boolean', 'cameraHistory.clearLookAt', 'must be boolean');
          requireDomain(!event.clearLookAt || !Object.hasOwn(event.camera, 'lookAt'), 'cameraHistory.camera.lookAt', 'clearLookAt requires the field to be absent');
          history.preview(previous => {
            // Keep deletion and camera/plan validation in the same atomic
            // reducer: merging an absent lookAt alone would resurrect it.
            if (event.clearLookAt) {
              const current = previous.scenePlay.worldSpace.setups.find(setup => setup.id === descriptor.setupId)?.entityStates.find(item => item.entityId === descriptor.entityId);
              requireDomain(!!current?.camera, 'cameraHistory.camera', 'original camera target missing');
              const camera = clone(current.camera); delete camera.lookAt;
              previous = patchEntityState(previous, descriptor.setupId, descriptor.entityId, {camera});
            }
            const result = reduceEntityAction(previous, {type: 'update', entityId: descriptor.entityId, setupId: descriptor.setupId,
              patch: {camera: clone(event.camera), transform: clone(event.transform)}});
            if (result.ok !== true) throw reject(result.reason || 'camera-history-reducer', result.message || '摄像机预览被拒绝');
            return result.state;
          });
          // History.preview false means an accepted no-op, not a rejected write.
          return accepted(event);
        }
        if (history[event.phase]() !== true) throw reject(`camera-history-${event.phase}-rejected`, '摄像机编辑事务尚未完成');
        owner = null; return accepted(event);
      } catch (error) {report(event, error); return false;}
      finally {busy = false;}
    },
    dispose() {if (disposed) return false; disposed = true; owner = null; return true;}
  };
}
