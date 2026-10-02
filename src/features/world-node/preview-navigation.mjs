import {NavigationMotion, wheelSample, wheelFocal} from './navigation-motion.mjs';

export function previewNavigation({camera, canvas, root, target, minDistance, maxDistance, movement, getFocal, setFocal, invalidate, onDrag}) {
  const motion = new NavigationMotion(camera, {target, minDistance, maxDistance, movement});
  const abort = new AbortController(), options = {signal: abort.signal}, capture = {...options, capture: true};
  const initialPosition = camera.position.clone(), initialQuaternion = camera.quaternion.clone();
  const viewKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']), moveKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
  let pointer, wheelIntent = null, lastWheel = -Infinity;
  const editable = target => target.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');
  const keyDown = event => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
    const localDialog = event.target.closest?.('[role="dialog"]');
    if (localDialog && localDialog !== root || event.target.closest?.('button,label,[role="slider"],[role="menu"],[role="menuitem"]')) return;
    if (!viewKeys.has(event.code) && !(movement && moveKeys.has(event.code))) return;
    event.preventDefault(); motion.keys.add(event.code); invalidate();
  };
  root.addEventListener('keydown', keyDown, options);
  // Release even when focus moves into a menu between keydown and keyup.
  document.addEventListener('keyup', e => {motion.keys.delete(e.code);}, capture);
  const clear = () => {motion.reset(); pointer = null; wheelIntent = null; lastWheel = -Infinity; canvas.style.cursor = '';};
  window.addEventListener('blur', clear, options); document.addEventListener('visibilitychange', () => {if (document.hidden) clear();}, options);
  root.addEventListener('focusin', e => {if (e.target !== canvas && e.target !== root) {motion.keys.clear(); motion.viewVelocity.set(0, 0); motion.moveVelocity.set(0, 0, 0);}}, options);
  canvas.addEventListener('pointerdown', event => {
    if (![0, 1].includes(event.button) || pointer) return;
    // Official scene Alt gestures require an authored collider. A GLB resource
    // preview has none; don't fabricate a pivot from its visible mesh.
    if (event.altKey && !target) return;
    canvas.focus({preventScroll: true}); pointer = {id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, lastMove: performance.now()};
    Object.assign(motion.drag, {down: true, active: event.button !== 0, dx: 0, dy: 0, vx: 0, vy: 0});
    if (motion.drag.active) {event.preventDefault(); canvas.style.cursor = 'grab';}
  }, options);
  function release(inertia) {
    if (!pointer) return;
    const drag = motion.drag;
    // Official release switches directly to the latest sample's inertia.
    // Drop queued deltas so the demand-driven renderer can become idle.
    drag.dx = drag.dy = 0;
    drag.down = drag.active = false;
    if (!inertia || performance.now() - pointer.lastMove > 80) drag.vx = drag.vy = 0;
    pointer = null; canvas.style.cursor = ''; invalidate();
  }
  document.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    const mask = pointer.button === 0 ? 1 : 4;
    if (!(event.buttons & mask)) {release(false); return;}
    if (!motion.drag.active && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 4) return;
    if (!motion.drag.active) {motion.drag.active = true; onDrag?.();}
    event.preventDefault(); event.stopPropagation(); canvas.style.cursor = 'grab';
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    motion.drag.dx += dx; motion.drag.dy += dy; motion.drag.vx = dx; motion.drag.vy = dy;
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.lastMove = performance.now(); onDrag?.(); invalidate();
  }, capture);
  document.addEventListener('pointerup', event => {if (pointer?.id === event.pointerId && pointer.button === event.button) {if (motion.drag.active) {event.preventDefault(); event.stopPropagation();} release(true);}}, capture);
  document.addEventListener('pointercancel', event => {if (pointer?.id === event.pointerId) release(false);}, capture);
  canvas.addEventListener('wheel', event => {
    event.preventDefault(); event.stopPropagation(); const sample = wheelSample(event, canvas.clientHeight), now = performance.now();
    if (!wheelIntent || now - lastWheel > 180) wheelIntent = sample.intent;
    lastWheel = now;
    if (wheelIntent === 'zoom') setFocal(wheelFocal(getFocal(), sample.y));
    else {motion.rotate(-sample.x * .003, -sample.y * .003); invalidate();}
  }, {...options, passive: false});
  return {tick: delta => motion.tick(delta), reset() {clear(); camera.position.copy(initialPosition); camera.quaternion.copy(initialQuaternion); camera.updateMatrixWorld(true); invalidate();}, dispose() {clear(); abort.abort();}};
}
