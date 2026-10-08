import {clone, same} from './invariants.mjs';
import {renderSetup} from './world-space.mjs';
import {resolveEntityControl} from './entity-actions.mjs';
import {applyEntityTransform, entityStateHeadingRadians, setEntityHeading, setRotationHeading, cameraRotationToPlan} from './transform-coordinates.mjs';
import {cameraOpticsPatch, fovToFocalLength, CAMERA_OPTICS_DEFAULTS} from './camera-optics.mjs';

const palette = Object.freeze(['#C97984', '#6F93C8', '#D0A552', '#82AD6B', '#A681C8', '#63B5A2']);
function colorOf(entity) {
  if (entity.color?.trim()) return entity.color.trim();
  // Official A vL/yx: unsigned FNV-1a over UTF-16 code units, six-color dm.
  let hash = 2166136261;
  for (let index = 0; index < entity.id.length; index++) hash = Math.imul(hash ^ entity.id.charCodeAt(index), 16777619);
  return palette[(hash >>> 0) % palette.length];
}
const finite = (value, field) => {if (!Number.isFinite(value)) throw new TypeError(`俯视图${field}必须是有限数值`); return value;};
const selectId = value => typeof value === 'string' ? value : value?.entityId ?? value?.id ?? null;

/** Plan author bridge. Projection, pointer ownership and local FOV edge
 * preview belong to the surface; this module owns fixed author gestures. */
export function createPlanWorkspace({getState, getAuthorState, session, temporal, getRuntime = () => null,
  isCurrent = () => session?.isCurrent?.() !== false, getSelected = () => null,
  onSelect = () => true, onLane = () => {}, onChange = () => {}, onError = () => {}, getBusy = () => false} = {}) {
  if ([getState, getAuthorState, getRuntime, isCurrent, getSelected, onSelect, onLane, onChange, onError, getBusy].some(callback => typeof callback !== 'function') || !session?.history || !temporal?.primeTransform) throw new TypeError('俯视图需要作者会话和时间轴作者桥');
  let disposed = false, active = null, pending = null, requestId = 0;
  const report = error => {try {onError(error);} catch {}};
  const emit = () => {try {onChange();} catch (error) {report(error);}};
  function identity() {
    const state = getAuthorState(), space = state.scenePlay.worldSpace, {revision, ...fence} = session.getFence?.() ?? {};
    return {worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId, source: clone(space.source), fence: clone(fence)};
  }
  const current = token => !disposed && isCurrent() && same(token, identity());
  function control(entityId) {return resolveEntityControl(getAuthorState(), {entityId});}
  function readMarkers() {
    const state = getState(), space = state.scenePlay.worldSpace, displayed = renderSetup(state), definitions = new Map(space.entities.map(entity => [entity.id, entity])), selected = selectId(getSelected());
    return displayed.entityStates.flatMap(entityState => {
      const entity = definitions.get(entityState.entityId); if (!entity || !['actor', 'camera', 'prop'].includes(entity.kind)) return [];
      const c = resolveEntityControl(getAuthorState(), {entityId: entity.id}), world = applyEntityTransform(entity.kind, entityState), heading = entityStateHeadingRadians(entity.kind, entityState);
      const marker = {id: entity.id, entityId: entity.id, kind: entity.kind === 'actor' ? 'person' : entity.kind === 'prop' ? 'object' : 'camera',
        position: clone(world.position), heading, yaw: heading,
        label: entity.label, color: colorOf(entity), selected: selected === entity.id, visible: entityState.visible,
        locked: c.locked, readOnly: c.baselineReadOnly || !c.setupState, draggable: !c.locked && !c.baselineReadOnly && !!c.setupState};
      if (entity.kind === 'camera' && entityState.camera) {
        const camera = entityState.camera, frameAspectRatio = camera.frameAspectRatio ?? CAMERA_OPTICS_DEFAULTS.frameAspectRatio;
        const optical = {fov: camera.fov, frameAspectRatio, focalLength: camera.focalLength ?? fovToFocalLength(camera.fov, frameAspectRatio)};
        Object.assign(marker, {...optical, camera: clone(optical), showExtendedFov: marker.selected,
          ...(temporal.selectedKey?.entityId === entity.id ? {fovPresentation: 'hidden'} : {})});
      }
      return [marker];
    });
  }
  function owns(gesture) {return active === gesture && same(session.history.getActiveTransaction(), gesture.transaction);}
  function nativeCurrent(gesture) {const runtime = getRuntime(); return runtime === gesture.runtime && runtime?.graph === gesture.graph && runtime?.graph?.source === gesture.sourceRecord;}
  function cancelActive(gesture = active) {
    if (gesture?.cancelled) return true;
    if (!gesture || !owns(gesture)) return false;
    const callback = gesture.entityKind === 'camera' ? temporal.handleCameraEdit : temporal.handleTransform;
    const accepted = callback({phase: 'cancel', entityId: gesture.entityId, reason: 'plan-cancel'});
    if (accepted) {gesture.cancelled = true; active = null; emit();} return accepted;
  }
  async function discardPrime(request) {
    if (pending === request) pending = null;
    // A completed abandoned preparation has no author transaction. Only clear
    // it while this exact editor/source still owns it; never end foreign work.
    if (!pending && !active && isCurrent() && same(request.token, identity()) && !session.history.getActiveTransaction() && temporal.isPrimed?.(request.entityId)) await temporal.beforeWrite();
  }
  async function beginEdit({entityId, kind = 'move', marker} = {}) {
    if (disposed || pending || active || !isCurrent() || getBusy() || session.history.getActiveTransaction() || !['move', 'heading', 'fov'].includes(kind)) return null;
    let request;
    try {
      if (typeof entityId !== 'string' || marker && (marker.entityId ?? marker.id) !== entityId) return null;
      const c = control(entityId); if (c.locked || c.baselineReadOnly || !c.setupState || kind === 'fov' && c.definition.kind !== 'camera') return null;
      const status = temporal.getTemporalStatus?.() ?? {}; if (status.playing || status.scrubbing || status.confirming) return null;
      request = {id: ++requestId, entityId, token: identity(), runtime: getRuntime()}; pending = request;
      if (await onSelect(entityId) === false || pending !== request || !current(request.token) || getBusy()) {if (pending === request) pending = null; return null;}
      const primed = await temporal.primeTransform(entityId);
      if (!primed || pending !== request || request.id !== requestId || !current(request.token) || getBusy() || getRuntime() !== request.runtime) {await discardPrime(request); return null;}
      const displayed = renderSetup(getState()), original = displayed.entityStates.find(value => value.entityId === entityId), latestControl = control(entityId);
      if (!original || latestControl.locked || latestControl.baselineReadOnly || !latestControl.setupState) {await discardPrime(request); return null;}
      const callback = c.definition.kind === 'camera' ? temporal.handleCameraEdit : temporal.handleTransform;
      if (callback({phase: 'begin', entityId, reason: 'plan', kind}) !== true) {await discardPrime(request); return null;}
      const runtime = getRuntime(), gesture = {entityId, entityKind: c.definition.kind, kind, original: clone(original), token: identity(), runtime, graph: runtime?.graph, sourceRecord: runtime?.graph?.source, transaction: session.history.getActiveTransaction()};
      pending = null; active = gesture; try {onLane(gesture.transaction?.lane);} catch (error) {report(error);} emit();
      function onMove(patch = {}) {
        if (!owns(gesture)) return false;
        try {
          if (!current(gesture.token) || !nativeCurrent(gesture) || getBusy()) {cancelActive(gesture); return false;}
          const next = clone(gesture.original), transform = clone(next.transform), world = applyEntityTransform(gesture.entityKind, next);
          if (patch.position !== undefined) {
            const position = {x: finite(patch.position?.x, '位置x'), y: world.position.y, z: finite(patch.position?.z, '位置z')};
            transform.position = clone(position); if (next.camera) next.camera.position = clone(position);
          }
          if (patch.heading !== undefined) {
            const heading = finite(patch.heading, '朝向');
            if (gesture.entityKind === 'camera') next.camera.rotation = setRotationHeading(world.rotation, heading);
            else transform.rotation = setEntityHeading(gesture.entityKind, transform, heading).rotation;
          }
          if (patch.fov !== undefined && gesture.entityKind !== 'camera') return false;
          if (gesture.entityKind === 'camera') {
            if (!next.camera) return false;
            if (patch.fov !== undefined) next.camera = cameraOpticsPatch(next.camera, {fov: finite(patch.fov, '视角')});
            // Optical pose owns the marker. Retain authored scale and use the
            // common conversion rather than an independent plan Euler rule.
            transform.position = clone(next.camera.position ?? world.position);
            transform.rotation = cameraRotationToPlan(next.camera.rotation ?? world.rotation);
          }
          const accepted = callback({phase: 'preview', entityId, transform, ...(next.camera ? {camera: next.camera} : {}), reason: 'plan', kind});
          if (accepted !== true) return false;
          gesture.token = identity(); emit(); return true;
        } catch (error) {report(error); return false;}
      }
      return {onMove, onEnd() {
        if (!owns(gesture)) return false;
        if (!current(gesture.token) || !nativeCurrent(gesture) || getBusy()) {cancelActive(gesture); return false;}
        const accepted = callback({phase: 'commit', entityId, reason: 'plan', kind});
        // A completed no-op has no history record, but its pointer lease still
        // completed successfully. A failed active transaction remains ours.
        const completed = accepted === true || session.history.getActiveTransaction() === null;
        if (completed) {active = null; emit();} return completed;
      }, onCancel: () => cancelActive(gesture)};
    } catch (error) {report(error); if (request) await discardPrime(request); return null;}
  }
  function cancel() {
    requestId++;
    if (pending) {const request = pending; pending = null; if (current(request.token) && temporal.confirming) temporal.timeline?.handleEscape(); return true;}
    return cancelActive();
  }
  function dispose() {if (disposed) return false; cancel(); disposed = true; return true;}
  return {readMarkers, beginEdit, cancel, dispose};
}
