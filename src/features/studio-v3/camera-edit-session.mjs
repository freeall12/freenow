import {assertJson, clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertCamera, assertSetupState} from './schema.mjs';
import {cameraOpticsPatch} from './camera-optics.mjs';
import {cameraRotationToPlan, sameRotation} from './transform-coordinates.mjs';

export const CAMERA_EDIT_EPSILON = 1e-4;
const opticsFields = ['fov', 'frameAspectRatio', 'focalLength', 'apertureFNumber', 'depthOfFieldMode', 'focusDistance', 'focus'];
const vectorEqual = (a, b) => ['x', 'y', 'z'].every(axis => Math.abs(a[axis] - b[axis]) <= CAMERA_EDIT_EPSILON);
const poseEqual = (a, b) => vectorEqual(a.position, b.position) && sameRotation(a.rotation, b.rotation, CAMERA_EDIT_EPSILON);
function opticsEqual(a, b) {
  return opticsFields.every(field => typeof a[field] === 'number' && typeof b[field] === 'number' ?
    Math.abs(a[field] - b[field]) <= CAMERA_EDIT_EPSILON : same(a[field], b[field]));
}
function assertSnapshot(subject, entityId) {
  requireDomain(isRecord(subject) && subject.entityId === entityId, 'cameraEdit.subject', 'subject identity changed');
  requireDomain(subject.label === undefined || typeof subject.label === 'string', 'cameraEdit.label', 'must be text');
  assertJson(subject.camera, 'cameraEdit.camera'); assertCamera(subject.camera, 'cameraEdit.camera');
  assertJson(subject.transform, 'cameraEdit.transform');
  assertSetupState({entityId, transform: subject.transform, camera: subject.camera, visible: true, updatedAt: 0}, 'cameraEdit.subject');
}

/** One synchronous authoring transaction. The host owns navigation, the optical
 * camera, viewport lease, temporal eligibility and rendering; no DOM or RAF. */
export function createCameraEditSession({getSubject, getFence = () => null, onEdit = () => false,
  onPreview = () => {}, onStart = () => {}, onEnd = () => {}, onInvalidate = () => {}, onError = () => {}} = {}) {
  requireDomain(typeof getSubject === 'function', 'cameraEdit.getSubject', 'requires a subject reader');
  for (const [name, callback] of Object.entries({getFence, onEdit, onPreview, onStart, onEnd, onInvalidate, onError})) {
    requireDomain(typeof callback === 'function', `cameraEdit.${name}`, 'must be a callback');
  }
  let active = null, busy = false, disposed = false, disposePending = false;
  const report = (error, session = active) => {
    if (session) session.failed = true;
    try {onError(error);} catch {}
  };
  const invalidate = () => {try {onInvalidate();} catch (error) {report(error);}};
  const payload = (session, camera = session.camera, transform = session.transform, kind = 'pose', reason = 'input') =>
    ({entityId: session.entityId, camera: clone(camera), transform: clone(transform), kind, reason});
  const publish = (session, phase, camera, transform, kind, reason, clearLookAt = false) =>
    onEdit({...payload(session, camera, transform, kind, reason), phase, ...(clearLookAt ? {clearLookAt: true} : {})}) === true;
  function release(session, reason, cancelled) {
    if (active === session) active = null;
    // Detach before calling host cleanup, so a callback cannot end this owner twice.
    if (session.started) {
      try {onEnd({entityId: session.entityId, reason, cancelled});} catch (error) {report(error, null);}
    }
    invalidate(); return true;
  }
  function rejection(phase, session) {
    report(new Error(`cameraEdit.${phase}: callback must return true`), session); invalidate(); return false;
  }
  function cancelInternal(reason, force = false, cancelled = true) {
    const session = active; if (!session) return false;
    if (!session.transactionOpen) return release(session, reason, cancelled);
    let accepted = false;
    try {accepted = publish(session, 'cancel', session.before.camera, session.before.transform, 'pose', reason);}
    catch (error) {report(error, session);}
    if (!accepted && !force) return rejection('cancel', session);
    if (!accepted) report(new Error('cameraEdit.cancel: host cleanup rejected cancellation'), session);
    session.transactionOpen = false;
    return release(session, reason, cancelled);
  }
  function current() {
    if (!active || disposed) return false;
    try {
      const subject = getSubject(active.entityId), fence = getFence();
      if (subject && subject.entityId === active.entityId && same(fence, active.fence)) return true;
    } catch (error) {report(error);}
    cancelInternal('stale'); return false;
  }
  function finishInternal(reason) {
    if (!current()) return false;
    const session = active;
    if (!session.transactionOpen) return release(session, reason, false);
    // A normalized optical preview is not an authored edit by itself. Cancel
    // the empty history transaction instead of writing defaults or timestamps.
    if (!session.dirty) return cancelInternal(reason, false, false);
    try {
      if (!publish(session, 'commit', session.camera, session.transform, session.kind, reason, session.clearLookAt)) return rejection('commit', session);
      session.transactionOpen = false;
      return release(session, reason, false);
    } catch (error) {report(error, session); invalidate(); return false;}
  }
  function checkpointInternal(reason) {
    if (!current()) return false;
    const session = active;
    if (session.transactionOpen) {
      const phase = session.dirty ? 'commit' : 'cancel';
      try {
        if (!publish(session, phase, session.dirty ? session.camera : session.before.camera,
          session.dirty ? session.transform : session.before.transform, session.kind, reason, session.dirty && session.clearLookAt)) return rejection(phase, session);
      } catch (error) {report(error, session); invalidate(); return false;}
      session.transactionOpen = false;
    }
    session.before = {camera: clone(session.camera), transform: clone(session.transform)};
    session.baseline = clone(session.camera); session.dirty = false; session.failed = false; session.clearLookAt = false;
    invalidate(); return !disposed;
  }
  function run(operation, {allowDisposed = false} = {}) {
    if (busy || disposed && !allowDisposed) return false;
    busy = true;
    try {return operation();}
    catch (error) {report(error); invalidate(); return false;}
    finally {
      // dispose may be requested from any host callback. Defer cancellation
      // until that callback returns, keeping begin/preview/commit non-reentrant.
      if (disposePending) {disposePending = false; if (active) cancelInternal('dispose', true);}
      busy = false;
    }
  }
  function applyInternal(next, {kind = 'pose', reason = 'input'} = {}) {
    if (!current()) return false;
    const session = active;
    assertJson(next, 'cameraEdit.next'); assertCamera(next, 'cameraEdit.next');
    const camera = cameraOpticsPatch(session.camera, next);
    assertJson(camera, 'cameraEdit.camera'); assertCamera(camera, 'cameraEdit.camera');
    const poseChanged = !poseEqual(session.camera, camera), opticsChanged = !opticsEqual(session.camera, camera);
    // Viewport snapshots may omit lookAt. Only a real pose change detaches the
    // author's tracking target; optics edits keep its exact current value.
    if (poseChanged) delete camera.lookAt;
    else if (Object.hasOwn(session.camera, 'lookAt')) camera.lookAt = clone(session.camera.lookAt);
    else delete camera.lookAt;
    if (!poseChanged && !opticsChanged) return true;
    const transform = poseChanged ? {position: clone(camera.position), rotation: cameraRotationToPlan(camera.rotation), scale: clone(session.before.transform.scale)} : clone(session.transform);
    const clearLookAt = session.clearLookAt || poseChanged && Object.hasOwn(session.before.camera, 'lookAt');
    try {
      // Applying the temporary camera first ensures a renderer exception does
      // not publish a domain pose. Rejected writes restore the accepted preview.
      if (onPreview(payload(session, camera, transform, kind, reason)) === false) {
        try {onPreview(payload(session, session.camera, session.transform, session.kind, 'preview-rejected'));} catch (error) {report(error, session);}
        return rejection('preview', session);
      }
      if (disposed) return false;
      if (!current()) return false;
      // Capture checkpoints leave possession alive but history idle. Reopen
      // lazily only for real input, so a later exit cannot cancel another owner.
      if (!session.transactionOpen) {
        if (!publish(session, 'begin', session.before.camera, session.before.transform, kind, reason)) {
          try {onPreview(payload(session, session.camera, session.transform, session.kind, 'preview-rejected'));} catch (error) {report(error, session);}
          return rejection('begin', session);
        }
        session.transactionOpen = true;
        if (disposed) return false;
        if (!current()) return false;
      }
      if (!publish(session, 'preview', camera, transform, kind, reason, clearLookAt)) {
        try {onPreview(payload(session, session.camera, session.transform, session.kind, 'preview-rejected'));} catch (error) {report(error, session);}
        return rejection('preview', session);
      }
      if (disposed) return false;
      session.camera = clone(camera); session.transform = clone(transform); session.kind = kind;
      session.clearLookAt = clearLookAt; session.failed = false;
      session.dirty = !poseEqual(session.baseline, camera) || !opticsEqual(session.baseline, camera) || !same(session.baseline.lookAt, camera.lookAt);
      invalidate(); return true;
    } catch (error) {
      try {onPreview(payload(session, session.camera, session.transform, session.kind, 'preview-failed'));} catch (restoreError) {report(restoreError, session);}
      report(error, session); invalidate(); return false;
    }
  }
  const api = {
    start(entityId) {
      return run(() => {
        if (active?.entityId === entityId) return current();
        if (active && !finishInternal('switch-camera')) return false;
        if (disposed) return false;
        const subject = getSubject(entityId); if (!subject) return false;
        assertSnapshot(subject, entityId);
        const fence = getFence(); assertJson(fence, 'cameraEdit.fence');
        // Canonicalize legacy focusDistance-only/absent focus as well: a full
        // viewport snapshot must not synthesize an authored focus on first input.
        const normalized = cameraOpticsPatch(subject.camera), baseline = cameraOpticsPatch(normalized, normalized);
        assertCamera(baseline, 'cameraEdit.baseline');
        const session = {entityId, label: subject.label ?? entityId, fence: clone(fence),
          before: {camera: clone(subject.camera), transform: clone(subject.transform)}, baseline: clone(baseline),
          camera: clone(baseline), transform: clone(subject.transform), kind: 'pose', clearLookAt: false, dirty: false, failed: false, started: false, transactionOpen: true};
        if (!publish(session, 'begin', session.before.camera, session.before.transform, 'pose', 'start')) return false;
        active = session;
        if (disposed || !current()) return false;
        session.started = true;
        try {onStart({entityId, label: session.label, camera: clone(session.camera), transform: clone(session.transform)});}
        catch (error) {report(error, session); cancelInternal('start-failed', true); return false;}
        if (disposed || !current()) return false;
        invalidate(); return true;
      });
    },
    applyCamera(next, options) {return run(() => applyInternal(next, options));},
    patchOptics(patch) {
      return run(() => {
        if (!current()) return false;
        requireDomain(isRecord(patch), 'cameraEdit.optics', 'must be a plain patch'); assertJson(patch, 'cameraEdit.optics');
        for (const field of Object.keys(patch)) requireDomain(opticsFields.includes(field), `cameraEdit.optics.${field}`, 'only optics fields are editable');
        return applyInternal(cameraOpticsPatch(active.camera, patch), {kind: 'optics', reason: 'optics'});
      });
    },
    finish(reason = 'finish') {return run(() => finishInternal(reason));},
    checkpoint(reason = 'capture') {return run(() => checkpointInternal(reason));},
    cancel(reason = 'cancel') {return run(() => cancelInternal(reason));},
    refresh() {return run(current);},
    dispose() {
      if (disposed) return false;
      disposed = true;
      if (busy) {disposePending = true; return true;}
      return run(() => active ? cancelInternal('dispose', true) : true, {allowDisposed: true});
    },
    get active() {
      return active ? {entityId: active.entityId, label: active.label, camera: clone(active.camera), transform: clone(active.transform),
        fence: clone(active.fence), dirty: active.dirty, failed: active.failed, transactionOpen: active.transactionOpen} : null;
    }
  };
  return api;
}
