import * as THREE from 'three';
import {cameraOpticsPatch, focalLengthToFov} from './camera-optics.mjs';
import {normalizeControlWheel} from './control-session.mjs';

export const CAMERA_NAVIGATION = Object.freeze({speed: 3, sprint: 5, acceleration: 30, sprintTransition: 8,
  friction: 1e-8, deadzone: .015, pointerSensitivity: .002, wheelSensitivity: .003,
  dragThreshold: 4, inertia: .92, inertiaDeadzone: .1, inertiaWindowMs: 80,
  arrowSpeed: 1.5, arrowAcceleration: 12, arrowDeadzone: .005, wheelIntentWindowMs: 180});
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const copy = value => structuredClone(value);
const moveCodes = {KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right', KeyQ: 'down', KeyE: 'up', ShiftLeft: 'sprint', ShiftRight: 'sprint'};
const arrowCodes = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};
const xyz = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
const quaternion = pose => new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.order || 'XYZ'));
const position = pose => new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
const writePose = (pose, point, orientation) => {
  const euler = new THREE.Euler().setFromQuaternion(orientation, 'YXZ');
  return {...pose, position: {x: point.x, y: point.y, z: point.z}, rotation: {x: euler.x, y: euler.y, z: euler.z, order: 'YXZ'}};
};
export const cameraMoveSpeedMultiplier = value => Number.isFinite(value) ? clamp(value, .25, 100) : 1;

/** Quaternion-based fly movement. Unlike entity control, release decays velocity. */
export function stepCameraMovement({dt, keys = {}, rotation, velocity = {x: 0, y: 0, z: 0}, speedMultiplier = 1, moveSpeedMultiplier = 1}) {
  dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const config = CAMERA_NAVIGATION, preference = cameraMoveSpeedMultiplier(moveSpeedMultiplier);
  speedMultiplier = approach(speedMultiplier, keys.sprint ? config.sprint : 1, config.sprintTransition * dt);
  const orientation = quaternion({rotation}), forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation), right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
  const intent = forward.multiplyScalar(Number(!!keys.forward) - Number(!!keys.backward))
    .add(right.multiplyScalar(Number(!!keys.right) - Number(!!keys.left)));
  intent.y += Number(!!keys.up) - Number(!!keys.down);
  const next = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
  if (intent.lengthSq() > 0) next.copy(intent.normalize().multiplyScalar(approach(next.length(), config.speed * preference * speedMultiplier, config.acceleration * preference * dt)));
  else {next.multiplyScalar(config.friction ** dt); if (next.length() < config.deadzone * preference) next.set(0, 0, 0);}
  return {velocity: {x: next.x, y: next.y, z: next.z}, speedMultiplier, delta: {x: next.x * dt, y: next.y * dt, z: next.z * dt}};
}

/** Native inputs only; runtime owns ticking, permissions, camera leases and history. */
export function createCameraNavigation({canvas, eventTarget = canvas?.ownerDocument?.defaultView || globalThis.window,
  readCamera, applyCamera, onInvalidate = () => {}, onError = () => {}, canInput = () => true,
  getMoveSpeedMultiplier = () => 1, getWheelZoomEnabled = () => true, getWheelLookInverted = () => false,
  resolveNavigationPivot = () => null, onNavigationPivotChange = () => {}, getScope = () => null,
  now = () => globalThis.performance?.now?.() ?? Date.now()} = {}) {
  if (!canvas || typeof readCamera !== 'function' || typeof applyCamera !== 'function') throw new TypeError('Camera navigation requires canvas, readCamera and applyCamera');
  const document = canvas.ownerDocument, pointerTarget = document || eventTarget, listeners = [], pressed = new Set();
  let active = false, disposed = false, scope, pivot = null, drag = null, inertia = {x: 0, y: 0, intent: null};
  let velocity = {x: 0, y: 0, z: 0}, speedMultiplier = 1, arrowVelocity = {yaw: 0, pitch: 0}, wheelIntent = null, wheelTime = 0;
  const report = error => {try {onError(error);} catch { /* Error observers cannot retain navigation input. */ }};
  function listen(target, type, handler, options = true) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function invalidate() {try {onInvalidate();} catch (error) {report(error);}}
  function setPivot(value) {pivot = value; try {onNavigationPivotChange(value ? copy(value) : null);} catch (error) {report(error);}}
  function releaseCapture() {if (drag) {try {canvas.releasePointerCapture?.(drag.pointerId);} catch { /* Pointer may already be released by the browser. */ }}}
  function endPivot() {
    if (pivot) setPivot(null);
    if (drag?.intent?.startsWith('pivot-')) {releaseCapture(); drag = null;}
    if (inertia.intent?.startsWith('pivot-')) inertia = {x: 0, y: 0, intent: null};
    wheelIntent = null;
  }
  function cancelInput() {
    releaseCapture(); drag = null; inertia = {x: 0, y: 0, intent: null}; pressed.clear();
    velocity = {x: 0, y: 0, z: 0}; speedMultiplier = 1; arrowVelocity = {yaw: 0, pitch: 0}; wheelIntent = null; wheelTime = 0;
    endPivot(); if (canvas.style) canvas.style.cursor = ''; invalidate();
  }
  function stop() {if (!active) return false; active = false; for (const remove of listeners.splice(0)) remove(); cancelInput(); return true;}
  function fail(error) {stop(); report(error); return false;}
  function ready(kind, event) {
    if (!active || disposed) return false;
    try {
      if (scope !== getScope()) {stop(); return false;}
      if (document?.visibilityState === 'hidden' || !canInput(kind, event)) {cancelInput(); return false;}
      return true;
    } catch (error) {return fail(error);}
  }
  function read() {
    const pose = readCamera();
    if (!xyz(pose?.position) || !xyz(pose?.rotation)) throw new TypeError('Camera navigation received an invalid camera pose');
    return copy(pose);
  }
  function publish(next, kind, reason, nextPivot) {
    try {
      // A rejected domain preview must release the input instead of continuing locally.
      if (applyCamera(copy(next), {kind, reason}) !== true) return fail(Object.assign(new Error('Camera navigation write was rejected'), {code: 'studio_v3_camera_navigation_rejected'}));
      if (!active) return false;
      if (nextPivot) setPivot(nextPivot); invalidate(); return true;
    } catch (error) {return fail(error);}
  }
  const consume = event => {event.preventDefault?.(); event.stopPropagation?.();};
  function keyboardAllowed(event) {
    if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.key === 'Process') return false;
    let target = event.target;
    if (!target || target === document?.body || target === document?.documentElement) target = document?.activeElement || target;
    return !target?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
      && !target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"],[data-world-workspace-ignore-hotkeys="true"],[data-world-workspace-block-movement-hotkeys="true"],[data-ignore-hotkeys="true"],[data-block-movement-hotkeys="true"]');
  }
  function keyDown(event) {
    if (!moveCodes[event.code] && !arrowCodes[event.code]) return;
    if (!ready(moveCodes[event.code] ? 'movement' : 'view-rotation', event) || !keyboardAllowed(event) || event.ctrlKey || event.metaKey) return;
    pressed.add(event.code); consume(event); invalidate();
  }
  function keyUp(event) {
    // Release always clears flags, even after focus, IME or a permission change.
    pressed.delete(event.code);
    if (['AltLeft', 'AltRight'].includes(event.code) || event.key === 'Alt') {if (!event.altKey) endPivot();}
  }
  function onViewport(event, middle = false) {
    const path = event.composedPath?.() || [event.target];
    return path.includes(canvas) || canvas.contains?.(event.target) || middle && path.some(node => node?.getAttribute?.('data-world-workspace-viewport-input') === 'true');
  }
  function pointerDown(event) {
    if (![0, 1].includes(event.button) || !onViewport(event, event.button === 1) || event.defaultPrevented || !ready('camera-drag', event) || drag) return;
    try {
      const intent = event.altKey ? event.button === 0 ? 'pivot-orbit' : 'pivot-pan' : 'rotate';
      if (!event.altKey) endPivot();
      else if (!pivot) {
        const resolved = resolveNavigationPivot({clientX: event.clientX, clientY: event.clientY, camera: read()});
        if (!xyz(resolved?.position)) return;
        setPivot(copy(resolved));
      }
      drag = {pointerId: event.pointerId, button: event.button, active: event.button === 1 || event.altKey,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, dx: 0, dy: 0, vx: 0, vy: 0, lastMove: now(), intent};
      inertia = {x: 0, y: 0, intent: null}; canvas.setPointerCapture?.(event.pointerId);
      if (drag.active) {consume(event); if (canvas.style) canvas.style.cursor = 'grab';}
    } catch (error) {fail(error);}
  }
  function releaseDrag(event, allowInertia) {
    if (!drag) return;
    const previous = drag; releaseCapture(); drag = null;
    inertia = allowInertia && previous.active && now() - previous.lastMove <= CAMERA_NAVIGATION.inertiaWindowMs
      ? {x: previous.vx, y: previous.vy, intent: previous.intent} : {x: 0, y: 0, intent: null};
    if (pivot && !event.altKey) endPivot(); if (canvas.style) canvas.style.cursor = '';
    if (previous.active) consume(event); invalidate();
  }
  function pointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId || !ready('camera-drag', event)) return;
    const mask = drag.button === 0 ? 1 : 4;
    if (!(event.buttons & mask)) {releaseDrag(event, false); return;}
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CAMERA_NAVIGATION.dragThreshold) return;
    drag.active = true; consume(event); if (canvas.style) canvas.style.cursor = 'grab';
    drag.vx = event.clientX - drag.lastX; drag.vy = event.clientY - drag.lastY;
    drag.dx += drag.vx; drag.dy += drag.vy; drag.lastX = event.clientX; drag.lastY = event.clientY; drag.lastMove = now(); invalidate();
  }
  function pointerUp(event) {if (drag?.pointerId === event.pointerId && drag.button === event.button) releaseDrag(event, true);}
  function pointerCancel(event) {if (drag?.pointerId === event.pointerId) cancelInput();}
  function look(orientation, yaw, pitch) {
    const euler = new THREE.Euler().setFromQuaternion(orientation, 'YXZ');
    euler.y += yaw; euler.x = clamp(euler.x + pitch, -Math.PI * .45, Math.PI * .45); orientation.setFromEuler(euler);
  }
  function turn(pose, dx, dy, intent) {
    const point = position(pose), orientation = quaternion(pose), nextPivot = pivot ? copy(pivot) : null;
    if (intent === 'pivot-orbit' && nextPivot) {
      const center = new THREE.Vector3(...['x', 'y', 'z'].map(axis => nextPivot.position[axis])), offset = point.clone().sub(center);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * CAMERA_NAVIGATION.pointerSensitivity);
      offset.applyQuaternion(yaw); orientation.premultiply(yaw);
      const euler = new THREE.Euler().setFromQuaternion(orientation, 'YXZ'), pitch = clamp(euler.x - dy * CAMERA_NAVIGATION.pointerSensitivity, -Math.PI * .45, Math.PI * .45) - euler.x;
      const pitchQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(orientation).normalize(), pitch);
      offset.applyQuaternion(pitchQuaternion); orientation.premultiply(pitchQuaternion).normalize(); point.copy(offset.add(center));
    } else if (intent === 'pivot-pan' && nextPivot) {
      const distance = point.distanceTo(new THREE.Vector3(nextPivot.position.x, nextPivot.position.y, nextPivot.position.z));
      const fov = pose.fov ?? focalLengthToFov(pose.focalLength ?? 24, pose.frameAspectRatio);
      const scale = 2 * distance * Math.tan(fov * Math.PI / 360) / Math.max(1, canvas.clientHeight || 1);
      const delta = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation).multiplyScalar(-dx * scale)
        .add(new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).multiplyScalar(dy * scale));
      point.add(delta); for (const axis of ['x', 'y', 'z']) nextPivot.position[axis] += delta[axis];
    } else look(orientation, -dx * CAMERA_NAVIGATION.pointerSensitivity, -dy * CAMERA_NAVIGATION.pointerSensitivity);
    return {pose: writePose(pose, point, orientation), pivot: nextPivot};
  }
  function wheel(event) {
    if (!onViewport(event, true) || event.defaultPrevented || !ready('camera-wheel', event)) return;
    consume(event);
    try {
      const sample = normalizeControlWheel(event, canvas.clientHeight), pose = read();
      if (pivot && !event.altKey) endPivot();
      if (pivot) {
        const center = new THREE.Vector3(pivot.position.x, pivot.position.y, pivot.position.z), offset = position(pose).sub(center), distance = offset.length();
        if (distance < Number.EPSILON) return;
        const minimum = Math.max(Number.EPSILON, (pose.near ?? .01) * 2), maximum = Number.isFinite(pose.far) ? Math.max(minimum, pose.far * .95) : Infinity;
        const next = {...pose, position: offset.setLength(clamp(distance * Math.exp(sample.y * .001), minimum, maximum)).add(center).toArray()};
        next.position = {x: next.position[0], y: next.position[1], z: next.position[2]}; wheelIntent = null;
        publish(next, 'pose', 'pivot-dolly'); return;
      }
      const time = now(), zoomEnabled = !!getWheelZoomEnabled();
      const intent = zoomEnabled ? wheelIntent && time - wheelTime <= CAMERA_NAVIGATION.wheelIntentWindowMs ? wheelIntent : sample.intent : 'rotate';
      if (zoomEnabled) {wheelIntent = intent; wheelTime = time;}
      if (intent === 'zoom') {
        const optics = cameraOpticsPatch(pose), next = cameraOpticsPatch(pose, {focalLength: optics.focalLength * Math.exp(-sample.y * .001)});
        publish(next, 'optics', 'wheel-zoom');
      } else {
        const orientation = quaternion(pose), invert = getWheelLookInverted() ? -1 : 1;
        look(orientation, -sample.x * invert * CAMERA_NAVIGATION.wheelSensitivity, -sample.y * invert * CAMERA_NAVIGATION.wheelSensitivity);
        publish(writePose(pose, position(pose), orientation), 'pose', 'wheel-look');
      }
    } catch (error) {fail(error);}
  }
  function tick(dt) {
    if (!ready('tick') || !Number.isFinite(dt) || dt < 0) return false;
    try {
      let next = read(), changed = false, nextPivot, reason = 'fly';
      const intent = drag?.intent || inertia.intent;
      const dx = drag?.active ? drag.dx : !drag ? inertia.x : 0, dy = drag?.active ? drag.dy : !drag ? inertia.y : 0;
      if (drag?.active) {drag.dx = 0; drag.dy = 0;}
      else if (!drag) {inertia.x *= CAMERA_NAVIGATION.inertia; inertia.y *= CAMERA_NAVIGATION.inertia; if (Math.abs(inertia.x) + Math.abs(inertia.y) < CAMERA_NAVIGATION.inertiaDeadzone) inertia = {x: 0, y: 0, intent: null};}
      if (dx || dy) {const turned = turn(next, dx, dy, intent); next = turned.pose; nextPivot = turned.pivot; changed = true; reason = intent?.startsWith('pivot-') ? intent : 'drag-look';}
      const arrows = Object.fromEntries(Object.entries(arrowCodes).map(([code, key]) => [key, pressed.has(code)]));
      if (Object.values(arrows).some(Boolean)) {
        arrowVelocity.yaw = approach(arrowVelocity.yaw, (Number(arrows.left) - Number(arrows.right)) * CAMERA_NAVIGATION.arrowSpeed, CAMERA_NAVIGATION.arrowAcceleration * dt);
        arrowVelocity.pitch = approach(arrowVelocity.pitch, (Number(arrows.up) - Number(arrows.down)) * CAMERA_NAVIGATION.arrowSpeed, CAMERA_NAVIGATION.arrowAcceleration * dt);
      } else {
        for (const axis of ['yaw', 'pitch']) {arrowVelocity[axis] *= CAMERA_NAVIGATION.friction ** dt; if (Math.abs(arrowVelocity[axis]) < CAMERA_NAVIGATION.arrowDeadzone) arrowVelocity[axis] = 0;}
      }
      if (arrowVelocity.yaw || arrowVelocity.pitch) {const orientation = quaternion(next); look(orientation, arrowVelocity.yaw * dt, arrowVelocity.pitch * dt); next = writePose(next, position(next), orientation); changed = true; reason = 'arrow-look';}
      const keys = {}; for (const [code, key] of Object.entries(moveCodes)) if (pressed.has(code)) keys[key] = true;
      const movement = stepCameraMovement({dt, keys, rotation: next.rotation, velocity, speedMultiplier, moveSpeedMultiplier: getMoveSpeedMultiplier()});
      velocity = movement.velocity; speedMultiplier = movement.speedMultiplier;
      if (Object.values(movement.delta).some(value => value !== 0)) {for (const axis of ['x', 'y', 'z']) next.position[axis] += movement.delta[axis]; changed = true;}
      return changed ? publish(next, 'pose', reason, nextPivot) : false;
    } catch (error) {return fail(error);}
  }
  function start() {
    if (disposed || active) return false;
    try {read(); scope = getScope(); if (document?.visibilityState === 'hidden' || !canInput('start')) return false;} catch (error) {report(error); return false;}
    active = true;
    listen(eventTarget, 'keydown', keyDown); listen(eventTarget, 'keyup', keyUp);
    listen(canvas, 'pointerdown', pointerDown); listen(pointerTarget, 'pointermove', pointerMove); listen(pointerTarget, 'pointerup', pointerUp);
    listen(pointerTarget, 'pointercancel', pointerCancel); listen(canvas, 'lostpointercapture', pointerCancel);
    listen(canvas, 'wheel', wheel, {capture: true, passive: false}); listen(eventTarget, 'blur', cancelInput);
    listen(document, 'visibilitychange', () => {if (document.visibilityState === 'hidden') cancelInput();}); return true;
  }
  return {start, stop, tick, cancelInput, dispose() {stop(); disposed = true;},
    needsFrame() {return active && (Object.keys(moveCodes).some(code => pressed.has(code) && !code.startsWith('Shift')) || Object.keys(arrowCodes).some(code => pressed.has(code))
      || !!(drag?.dx || drag?.dy || inertia.x || inertia.y || arrowVelocity.yaw || arrowVelocity.pitch || velocity.x || velocity.y || velocity.z));},
    get active() {return active;}, get pivot() {return pivot ? copy(pivot) : null;}};
}
