import {entityTransformToWorld, entityTransformFromWorld, entityHeadingRadians, setEntityHeading} from './transform-coordinates.mjs';

export const CONTROL_MOVEMENT = Object.freeze({speed: 6, sprint: 1.6, acceleration: 48, sprintTransition: 8});
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const copy = value => structuredClone(value);
const movementCodes = {KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right', KeyQ: 'down', KeyE: 'up', ShiftLeft: 'sprint', ShiftRight: 'sprint'};
const emptyKeys = () => ({forward: false, backward: false, left: false, right: false, up: false, down: false, sprint: false});
const movingKeys = keys => keys.forward || keys.backward || keys.left || keys.right || keys.up || keys.down;
const editable = target => target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || !!target?.closest?.('[contenteditable="true"], [role="textbox"]');
const changed = (a, b) => ['position', 'rotation', 'scale'].some(key => ['x', 'y', 'z'].some(axis => Math.abs(a[key][axis] - b[key][axis]) > 1e-4));
export function normalizeControlWheel(event, viewportHeight = 600) {
  const mode = event.deltaMode || 0, factor = mode === 1 ? 16 : mode === 2 ? Math.max(1, viewportHeight * .8) : 1;
  const x = (event.deltaX || 0) * factor, y = (event.deltaY || 0) * factor, dx = Math.abs(event.deltaX || 0), dy = Math.abs(event.deltaY || 0);
  const intent = event.ctrlKey || mode !== 0 ? 'zoom' : dx > .75 || !Number.isInteger(event.deltaX || 0) || !Number.isInteger(event.deltaY || 0) || dy <= 16 ? 'rotate' : dx < .75 && dy >= 48 ? 'zoom' : 'rotate';
  return {x, y, intent};
}
const degrees = radians => ((radians * 180 / Math.PI) % 360 + 360) % 360;

/** Official I2/K2 movement: acceleration affects speed, release stops at once. */
export function stepControlMovement({dt, keys, yaw, velocity = {x: 0, z: 0}, speedMultiplier = 1}) {
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
  speedMultiplier = approach(speedMultiplier, keys.sprint ? CONTROL_MOVEMENT.sprint : 1, CONTROL_MOVEMENT.sprintTransition * dt);
  const forward = {x: -Math.sin(yaw), z: -Math.cos(yaw)}, right = {x: Math.cos(yaw), z: -Math.sin(yaw)};
  const f = Number(!!keys.forward) - Number(!!keys.backward), r = Number(!!keys.right) - Number(!!keys.left);
  let x = forward.x * f + right.x * r, z = forward.z * f + right.z * r;
  const length = Math.hypot(x, z), speed = approach(Math.hypot(velocity.x, velocity.z), CONTROL_MOVEMENT.speed * speedMultiplier, CONTROL_MOVEMENT.acceleration * dt);
  if (length) {x = x / length * speed; z = z / length * speed;} else {x = 0; z = 0;}
  return {velocity: {x, z}, speedMultiplier, delta: {x: x * dt, z: z * dt}, heading: x || z ? Math.atan2(x, -z) : null,
    deltaY: (Number(!!keys.up) - Number(!!keys.down)) * CONTROL_MOVEMENT.speed * speedMultiplier * dt};
}

/** Render bounds determine follow distance and the physical support footprint. */
export function controlSpatialProfile(kind, {height = kind === 'actor' ? 1.8 : 1, width = 1, depth = 1, minHeight = 0, centerHeight = minHeight + height / 2} = {}) {
  height = Math.max(.24, height); width = Math.max(.1, width); depth = Math.max(.1, depth);
  const span = Math.max(width, depth, height * .45), footprint = Math.max(width, depth), actor = kind === 'actor';
  return {targetHeight: actor ? Math.max(.18, minHeight + height * .82, height * .72) : Math.max(.18, centerHeight),
    distance: actor ? clamp(height * 1.85, 2.2, 5.8) : clamp(Math.max(height * 1.8, span * 2.4), 1.6, 7),
    minDistance: Math.max(.8, actor ? clamp(height * .62, .9, 2.6) : clamp(Math.max(height * .55, span * .8), .75, 3.2)),
    maxDistance: actor ? clamp(Math.max(height * 4.2, span * 5), 4.5, 18) : clamp(Math.max(height * 4, span * 5), 4, 20),
    body: {bottomOffsetY: minHeight, radius: actor ? clamp(footprint * .48, .18, .48) : clamp(footprint * .55, .16, 1.4),
      sampleHeights: (actor ? [.18, .52, .78].map(fraction => minHeight + height * fraction) : [minHeight + height * .28, centerHeight, minHeight + height * .72]).map(value => Math.max(.18, value))}};
}

/** Owns a single authored transaction and native input lease. No private RAF. */
export function createControlSession({canvas, eventTarget = canvas?.ownerDocument?.defaultView || globalThis.window, getSubject, getFence = () => null,
  getCameraPosition, setFollowCamera, getProfile = subject => controlSpatialProfile(subject.kind), resolveHorizontal = ({to}) => to,
  resolveSupport = ({transform}) => ({transform, supported: true}), onControl = () => {}, onRenderTransform = () => {},
  onStart = () => {}, onEnd = () => {}, onMotion = () => {}, onInvalidate = () => {}, onError = () => {}, canInput = () => true} = {}) {
  let active = null, disposed = false, releasing = false, ending = false;
  const listeners = [], document = canvas?.ownerDocument;
  function reportError(error) {try {onError(error);} catch { /* An observer cannot retain an input lease. */ }}
  function listen(target, type, callback, options = true) {if (!target?.addEventListener) return; target.addEventListener(type, callback, options); listeners.push(() => target.removeEventListener(type, callback, options));}
  function motion(state, transition = 'smooth') {
    if (!active || active.kind !== 'actor' || active.motion === state) return; active.motion = state;
    try {onMotion({entityId: active.entityId, state, transition});} catch (error) {reportError(error);}
  }
  const consume = event => {event.preventDefault?.(); event.stopImmediatePropagation?.();};
  function clearInput() {
    if (!active) return; active.keys = emptyKeys(); active.velocity = {x: 0, z: 0}; motion('idle', 'quick');
    const drag = active.drag; active.drag = null;
    if (drag) {try {canvas.releasePointerCapture?.(drag.pointerId);} catch {}}
  }
  function valid() {
    if (!active || disposed || ending) return false;
    const subject = getSubject(active.entityId);
    if (!subject || getFence() !== active.fence) {cancel('stale'); return false;}
    return true;
  }
  function allowed(event) {
    if (!valid() || event?.defaultPrevented) return false;
    if (event?.target?.closest?.('.sv3-control-hud')) {clearInput(); return false;}
    if (!canInput() || editable(event?.target)) {cancel('input-takeover'); return false;}
    return true;
  }
  function publish(phase, transform, reason) {return onControl({phase, entityId: active.entityId, kind: active.kind, transform: copy(transform), reason}) !== false;}
  function follow() {
    if (!active) return;
    const {rig, world} = active, target = {...world.position, y: world.position.y + rig.targetHeight}, cos = Math.cos(rig.pitch);
    setFollowCamera({target, position: {x: target.x + Math.sin(rig.yaw) * cos * rig.distance,
      y: target.y - Math.sin(rig.pitch) * rig.distance, z: target.z + Math.cos(rig.yaw) * cos * rig.distance}});
  }
  function apply(world, reason = 'input') {
    if (!valid()) return false;
    if (!changed(active.world, world)) return true;
    const transform = entityTransformFromWorld(active.kind, world);
    try {
      if (!publish('preview', transform, reason)) {clearInput(); active.transition = null; onInvalidate(); return false;}
      // A synchronous host callback may cancel the session while fencing a write.
      if (!active) return false;
      active.world = copy(world); active.transform = transform; active.dirty = changed(active.before, transform);
      onRenderTransform(active.entityId, copy(world)); follow(); onInvalidate(); return true;
    } catch (error) {cancel('callback-failed'); reportError(error); return false;}
  }
  function release(reason, cancelled) {
    const session = active; if (!session || releasing) return false;
    releasing = true; clearInput(); for (const remove of listeners.splice(0)) remove(); active = null;
    try {if (session.kind === 'actor') onMotion({entityId: session.entityId, state: null, transition: 'quick'});} catch (error) {reportError(error);}
    try {onEnd({entityId: session.entityId, kind: session.kind, reason, cancelled});} catch (error) {reportError(error);} finally {releasing = false;}
    onInvalidate(); return true;
  }
  function cancel(reason = 'cancel') {
    if (!active || releasing || ending) return false; const session = active;
    clearInput(); session.transition = null; ending = true;
    try {publish('cancel', session.before, reason);} catch (error) {reportError(error);}
    try {onRenderTransform(session.entityId, entityTransformToWorld(session.kind, session.before));} catch (error) {reportError(error);}
    try {return release(reason, true);} finally {ending = false;}
  }
  function finish(reason = 'finish') {
    if (!valid()) return false;
    ending = true;
    try {if (!publish('commit', active.transform, reason)) {clearInput(); active.transition = null; return false;} return release(reason, false);}
    catch (error) {clearInput(); if (active) active.transition = null; reportError(error); return false;} finally {ending = false;}
  }
  function keyDown(event) {
    if (!allowed(event) || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Escape' || event.key === 'Escape') {consume(event); finish('escape'); return;}
    if (event.code === 'KeyG') {consume(event); if (!event.repeat) dropToGround(); return;}
    const key = movementCodes[event.code]; if (!key) return;
    consume(event); active.keys[key] = true; if (key !== 'sprint') active.transition = null; onInvalidate();
  }
  function keyUp(event) {
    const key = movementCodes[event.code]; if (!key || !active) return;
    // Releases always clear their flag, even if another owner consumed keyup.
    active.keys[key] = false;
    if (!movingKeys(active.keys)) {active.velocity = {x: 0, z: 0}; motion('idle', 'quick');}
    if (allowed(event)) consume(event); onInvalidate();
  }
  function pointerDown(event) {
    if (![0, 1].includes(event.button) || !allowed(event)) return;
    consume(event); active.drag = {pointerId: event.pointerId, x: event.clientX, y: event.clientY};
    try {canvas.setPointerCapture?.(event.pointerId);} catch {}
  }
  function pointerMove(event) {
    const drag = active?.drag; if (!drag || event.pointerId !== drag.pointerId || !allowed(event)) return;
    consume(event); active.rig.yaw -= (event.clientX - drag.x) * .002;
    active.rig.pitch = clamp(active.rig.pitch - (event.clientY - drag.y) * .002, -.72, .25);
    drag.x = event.clientX; drag.y = event.clientY; follow(); onInvalidate();
  }
  function pointerUp(event) {
    if (!active?.drag || event.pointerId !== active.drag.pointerId) return;
    consume(event); const drag = active.drag; active.drag = null;
    try {canvas.releasePointerCapture?.(drag.pointerId);} catch {}
  }
  function wheel(event) {
    if (!allowed(event)) return; consume(event);
    const normalized = normalizeControlWheel(event, canvas.clientHeight);
    if (normalized.intent === 'rotate') {
      active.rig.yaw -= normalized.x * .003; active.rig.pitch = clamp(active.rig.pitch - normalized.y * .003, -.72, .25);
    } else active.rig.distance = clamp(active.rig.distance * Math.exp(normalized.y * .001), active.profile.minDistance, active.profile.maxDistance);
    follow(); onInvalidate();
  }
  function start(entityId) {
    if (disposed || active) return false; const subject = getSubject(entityId); if (!subject || !['actor', 'prop'].includes(subject.kind)) return false;
    const profile = getProfile(subject), world = entityTransformToWorld(subject.kind, subject.transform), camera = getCameraPosition(),
      target = {...world.position, y: world.position.y + profile.targetHeight}, dx = camera.x - target.x, dy = camera.y - target.y, dz = camera.z - target.z, length = Math.hypot(dx, dy, dz);
    active = {entityId, kind: subject.kind, label: subject.label, before: copy(subject.transform), transform: copy(subject.transform), world, fence: getFence(),
      profile, rig: {yaw: subject.kind === 'actor' ? -entityHeadingRadians(subject.kind, subject.transform) : length > .001 ? Math.atan2(dx, dz) : -entityHeadingRadians(subject.kind, subject.transform),
        pitch: subject.kind === 'actor' ? -.12 : length > .001 ? clamp(-Math.asin(dy / length), -.72, .25) : -.12,
        distance: subject.kind === 'actor' ? profile.distance : clamp(length || profile.distance, profile.minDistance, profile.maxDistance), targetHeight: profile.targetHeight},
      keys: emptyKeys(), velocity: {x: 0, z: 0}, speedMultiplier: 1, verticalVelocity: 0, grounded: true, manualHeight: false, dirty: false, drag: null, transition: null};
    try {
      if (!publish('begin', active.before, 'start')) {active = null; return false;}
      if (!active) return false; onStart({entityId, kind: subject.kind}); motion('idle'); if (!active) return false; follow();
      listen(eventTarget, 'keydown', keyDown); listen(eventTarget, 'keyup', keyUp); listen(eventTarget, 'blur', event => {
        // Capture sees focused buttons/inputs blur while focus moves to canvas.
        // Only loss of the owning window ends this input lease.
        if (event.target === eventTarget) cancel('window-blur');
      });
      listen(canvas, 'pointerdown', pointerDown); listen(eventTarget, 'pointermove', pointerMove); listen(eventTarget, 'pointerup', pointerUp);
      listen(canvas, 'pointercancel', () => cancel('pointer-cancel')); listen(canvas, 'wheel', wheel, {capture: true, passive: false});
      listen(document, 'focusin', event => {if (event.target.closest?.('.sv3-control-hud')) clearInput(); else if (editable(event.target)) cancel('input-takeover');});
      listen(document, 'visibilitychange', () => {if (document.visibilityState === 'hidden') cancel('hidden');});
      onInvalidate(); return true;
    } catch (error) {cancel('start-failed'); reportError(error); return false;}
  }
  function transitionTo(world, supported, duration) {
    if (!valid()) return false;
    clearInput(); active.verticalVelocity = 0;
    if (eventTarget?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {if (!apply(world, 'height')) return false; active.grounded = supported; active.manualHeight = !supported; return true;}
    active.transition = {from: copy(active.world), to: copy(world), elapsed: 0, duration, supported}; onInvalidate(); return true;
  }
  function nudgeHeight(direction) {
    if (!valid() || !['up', 'down'].includes(direction)) return false;
    const world = copy(active.world); world.position.y += direction === 'up' ? 1 : -1;
    const support = direction === 'down' ? resolveSupport({transform: world, body: active.profile.body, maxSnapDistance: 1.08}) : {transform: world, supported: false};
    return transitionTo(support.transform, support.supported, .2);
  }
  function dropToGround() {
    if (!valid()) return false;
    const support = resolveSupport({transform: copy(active.world), body: active.profile.body, maxSnapDistance: Infinity});
    return transitionTo(support.transform, support.supported, clamp(.18 + Math.abs(support.transform.position.y - active.world.position.y) * .035, .18, .32));
  }
  function setHeading(value) {
    if (!valid() || !Number.isFinite(value)) return false;
    const transform = setEntityHeading(active.kind, active.transform, value * Math.PI / 180), world = entityTransformToWorld(active.kind, transform);
    if (active.transition) {active.transition.from.rotation = copy(world.rotation); active.transition.to.rotation = copy(world.rotation);}
    return apply(world, 'heading');
  }
  function tick(dt) {
    if (!valid()) return false; dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    if (!canInput()) {cancel('input-takeover'); return false;}
    if (active.transition) {
      const transition = active.transition; transition.elapsed += dt; const fraction = clamp(transition.elapsed / transition.duration, 0, 1), world = copy(transition.to);
      world.position.y = transition.from.position.y + (transition.to.position.y - transition.from.position.y) * (1 - (1 - fraction) ** 3);
      if (!apply(world, 'height')) return false;
      if (fraction === 1 && active) {active.transition = null; active.grounded = transition.supported; active.manualHeight = !transition.supported;}
      return !!active?.transition;
    }
    if (!movingKeys(active.keys) && (active.grounded || active.manualHeight)) return false;
    const step = stepControlMovement({dt, keys: active.keys, yaw: active.rig.yaw, velocity: active.velocity, speedMultiplier: active.speedMultiplier});
    active.velocity = step.velocity; active.speedMultiplier = step.speedMultiplier;
    const speed = Math.hypot(step.velocity.x, step.velocity.z); motion(speed < .03 ? 'idle' : active.keys.sprint || speed >= 7.8 ? 'run' : 'walk');
    let world = copy(active.world); world.position.x += step.delta.x; world.position.z += step.delta.z; world.position.y += step.deltaY;
    if (active.kind === 'actor' && step.heading !== null) world = entityTransformToWorld('actor', setEntityHeading('actor', entityTransformFromWorld('actor', world), step.heading));
    world = resolveHorizontal({from: active.world, to: world, body: active.profile.body});
    const verticalInput = active.keys.up !== active.keys.down;
    if (verticalInput) {active.manualHeight = true; active.verticalVelocity = 0; active.grounded = false;}
    if (!verticalInput && !active.manualHeight && !active.grounded) {active.verticalVelocity -= 18 * dt; world.position.y += active.verticalVelocity * dt;}
    if ((!active.manualHeight || step.deltaY < 0) && !active.keys.up) {
      const distance = active.grounded ? .35 : Math.abs(world.position.y - active.world.position.y) + .08;
      const support = resolveSupport({transform: world, body: active.profile.body, maxSnapDistance: distance}); world = support.transform;
      active.grounded = support.supported; if (support.supported) {active.manualHeight = false; active.verticalVelocity = 0;}
    }
    apply(world); return !!active && (movingKeys(active.keys) || !active.grounded && !active.manualHeight);
  }
  return {start, finish, cancel, tick, nudgeHeight, dropToGround, setHeading, clearInput,
    get active() {return active ? {entityId: active.entityId, kind: active.kind, label: active.label, headingDeg: degrees(entityHeadingRadians(active.kind, active.transform)),
      dirty: active.dirty, inputActive: movingKeys(active.keys) || !!active.drag || !!active.transition,
      help: 'WASD 移动 · Shift 加速 · Q/E 升降 · G 落地 · 拖动环绕 · 滚轮缩放 · Esc 完成'} : null;},
    get needsFrame() {return !!active && (movingKeys(active.keys) || !!active.transition || !active.grounded && !active.manualHeight);},
    validate: valid,
    refresh() {if (!valid()) return false; onRenderTransform(active.entityId, copy(active.world)); follow(); return true;},
    dispose() {if (disposed) return; cancel('dispose'); disposed = true; for (const remove of listeners.splice(0)) remove();}
  };
}
