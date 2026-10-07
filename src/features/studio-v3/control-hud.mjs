import {el, button} from './dom.mjs';
import {bindEntityInspectorNumberField} from './entity-inspector.mjs';

// Official bY/iY/sY/cY and the fixed-indicator Xp ruler in the installed bundle.
export const CONTROL_HEADING_PRESETS = Object.freeze([0, 90, 180, 270, 359]);
export const CONTROL_HEADING_LAYOUT = Object.freeze({min: 0, max: 359, trackWidth: 360, readoutWidth: 40, windowWidth: 132, visibleTrackWidth: 74, indicatorX: 37});
const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const clamp = value => Math.max(0, Math.min(359, value));
const accepted = result => result === true || result?.ok === true;
function failure(result) {return Error(result?.message || '操控修改未被接受，请重试');}

/** Replaces the normal dock actions while a real runtime control session owns
 * the entity. The host retains the single transaction; this HUD only previews. */
export function createControlHUD({getControl, drop, moveDown, moveUp, setHeading, cancel, finish, onError = () => {}} = {}) {
  for (const [name, action] of Object.entries({getControl, drop, moveDown, moveUp, setHeading, cancel, finish})) if (typeof action !== 'function') throw new TypeError(`操控栏需要 ${name}`);
  const root = el('section', 'sv3-capsule sv3-control-hud'); root.dataset.keyboardScope = 'local-tool'; root.setAttribute('role', 'toolbar'); root.setAttribute('aria-label', '主操作');
  const document = root.ownerDocument;
  const styleUrl = new URL('control-hud.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === styleUrl)) {const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = styleUrl; link.dataset.studioV3ControlHud = ''; document.head.append(link);}
  let disposed = false, pending = false, current = null, entityId = null, composing = false, drag = null, headingQueue = null, previewing = false;
  const listeners = [], controls = [], presetButtons = [];
  const listen = (node, type, handler, options) => {node.addEventListener(type, handler, options); listeners.push(() => node.removeEventListener(type, handler, options));};
  const status = el('div', 'sv3-control-feedback'); status.hidden = true; status.setAttribute('role', 'alert'); status.setAttribute('aria-live', 'polite');
  const report = error => {if (disposed) return; status.textContent = error.message || String(error); status.hidden = false; onError(error);};
  const read = () => {
    const value = getControl();
    if (value !== null && value !== undefined && (typeof value !== 'object' || typeof value.entityId !== 'string')) throw Error('当前操控会话无效');
    return value || null;
  };
  const heading = () => typeof current?.headingDeg === 'number' && Number.isFinite(current.headingDeg) ? clamp(current.headingDeg) : 0;
  const changedSession = owner => disposed || read()?.entityId !== owner;
  const actionResult = (result, owner) => {
    if (!accepted(result)) throw failure(result);
    if (changedSession(owner)) throw Error('操控对象已变化，请重新调整');
    return {ok: true};
  };
  const safeRefresh = () => {try {root.refresh();} catch (error) {report(error);}};
  const invoke = async (action, {closing = false} = {}) => {
    if (disposed) return {ok: false, message: '操控栏已关闭'};
    if (pending || previewing) {const error = Error('请等待当前调整完成'); report(error); return {ok: false, message: error.message};}
    const owner = read()?.entityId;
    if (!owner) return {ok: false, message: '当前没有正在操控的对象'};
    pending = true; safeRefresh();
    try {
      const result = await action();
      if (!accepted(result)) throw failure(result);
      if (!closing && changedSession(owner)) throw Error('操控对象已变化，请重新调整');
      if (!disposed) {status.hidden = true; safeRefresh();}
      return {ok: true};
    } catch (error) {report(error); return {ok: false, message: error.message};}
    finally {pending = false; safeRefresh();}
  };
  const nodeButton = (name, label, key, action, closing = false) => {
    const item = button(name, label, () => {numeric.cancel(); void invoke(action, {closing});}, {text: label}); item.dataset.size = 'control'; item.setAttribute('aria-label', label);
    // Pointer focus causes native blur before click. Clear an unaccepted number
    // draft first, so Restore/Done cannot accidentally submit it on the way out.
    listen(item, 'pointerdown', () => numeric.cancel());
    if (key) {item.setAttribute('aria-keyshortcuts', key); item.title = `${label} (${key})`;}
    controls.push(item); return item;
  };
  const dropButton = nodeButton('dropGround', '落到地面', 'G', drop), downButton = nodeButton('moveDown', '下移', 'Q', moveDown), upButton = nodeButton('moveUp', '上移', 'E', moveUp);
  root.append(dropButton, downButton, upButton);
  const rotationGroup = el('div', 'sv3-control-rotation-group'), rotationSeparator = el('span', 'sv3-separator'), rotationLabel = el('span', 'sv3-control-rotation-label', '旋转'); rotationLabel.setAttribute('aria-hidden', 'true');
  const rotation = el('div', 'sv3-control-rotation'), viewport = el('div', 'sv3-control-ruler-window'), track = el('div', 'sv3-control-ruler-track'); track.style.width = `${CONTROL_HEADING_LAYOUT.trackWidth}px`;
  const range = el('input', 'sv3-control-heading-range'); range.type = 'range'; range.min = '0'; range.max = '359'; range.step = '1'; range.setAttribute('aria-label', '旋转'); range.dataset.field = 'heading-slider';
  const number = el('input', 'sv3-control-heading-number'); number.type = 'number'; number.min = '0'; number.max = '359'; number.step = '1'; number.inputMode = 'decimal'; number.setAttribute('aria-label', '旋转角度'); number.dataset.field = 'heading-number';
  const readout = el('div', 'sv3-control-readout'); readout.append(number, el('span', '', '°'));
  const indicator = el('span', 'sv3-control-ruler-indicator'); indicator.setAttribute('aria-hidden', 'true');
  for (let x = 6; x < CONTROL_HEADING_LAYOUT.trackWidth; x += 6) {const tick = el('span', 'sv3-control-ruler-tick'); tick.style.left = `${x}px`; tick.setAttribute('aria-hidden', 'true'); track.append(tick);}
  for (const value of CONTROL_HEADING_PRESETS) {
    const preset = button(null, `${value}°`, () => {numeric.cancel(); void preview(value);}, {className: 'sv3-control-ruler-preset'}); preset.setAttribute('aria-label', `${value}°`); preset.style.left = `${value / 359 * CONTROL_HEADING_LAYOUT.trackWidth}px`; preset.dataset.heading = String(value); preset.append(el('span')); presetButtons.push(preset); track.append(preset);
    listen(preset, 'pointerdown', () => numeric.cancel());
  }
  viewport.append(track, indicator, range); rotation.append(viewport, readout); rotationGroup.append(rotationSeparator, rotationLabel, rotation); root.append(rotationGroup);

  const preview = async (value, {reportFailure = true} = {}) => {
    if (disposed || pending) return {ok: false, message: '请等待当前调整完成'};
    if (!Number.isFinite(value) || value < 0 || value > 359) return {ok: false, message: '请输入 0–359° 的旋转角度'};
    const owner = read()?.entityId;
    if (!owner) return {ok: false, message: '当前没有正在操控的对象'};
    // Native range events may outrun an async host. Keep only the last unseen
    // preview; never end the transaction or replay an old entity's queued draft.
    if (previewing) {headingQueue = {value, owner}; return {ok: false, message: '正在更新旋转角度'};}
    previewing = true; let next = {value, owner}, result = {ok: true};
    try {
      while (next && !disposed) {
        if (changedSession(next.owner)) throw Error('操控对象已变化，请重新调整');
        const response = await setHeading(next.value); result = actionResult(response, next.owner);
        if (!disposed) {status.hidden = true; safeRefresh();}
        next = headingQueue; headingQueue = null;
      }
      return result;
    } catch (error) {headingQueue = null; if (reportFailure) report(error); return {ok: false, message: error.message};}
    finally {previewing = false; safeRefresh();}
  };
  const numeric = bindEntityInspectorNumberField(number, {
    read: heading, format: () => String(Math.round(heading())),
    commit: value => preview(value, {reportFailure: false}), validate: value => {if (value < 0 || value > 359) throw Error('请输入 0–359° 的旋转角度'); return value;},
    close: () => {numeric.cancel(); void invoke(finish, {closing: true});}, onError: report
  });
  listen(number, 'compositionstart', () => {composing = true;}); listen(number, 'compositionend', () => {composing = false;});
  listen(range, 'input', () => {numeric.cancel(); void preview(Number(range.value));});
  // The official control drags the ruler underneath a fixed gold indicator.
  // The native range remains available for keyboard and accessibility input.
  listen(viewport, 'pointerdown', event => {
    if (disposed || pending || event.button !== 0 || event.isPrimary === false || event.target.closest?.('button')) return;
    event.preventDefault(); event.stopPropagation(); numeric.cancel(); range.focus({preventScroll: true});
    drag = {pointerId: event.pointerId, x: event.clientX, heading: heading()}; viewport.setPointerCapture?.(event.pointerId);
  });
  listen(viewport, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const value = Math.round(clamp(drag.heading - (event.clientX - drag.x) * 359 / CONTROL_HEADING_LAYOUT.trackWidth));
    void preview(value);
  });
  const endDrag = event => {if (!drag || event.pointerId !== drag.pointerId) return; const id = drag.pointerId; drag = null; if (viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture?.(id);};
  listen(viewport, 'pointerup', endDrag); listen(viewport, 'pointercancel', endDrag); listen(viewport, 'lostpointercapture', endDrag);
  root.append(el('span', 'sv3-separator'));
  const cancelButton = nodeButton('undo', '还原并退出', null, cancel, true), finishButton = nodeButton('check', '完成', 'Escape', finish, true); finishButton.dataset.controlFinish = 'true'; root.append(cancelButton, finishButton, status);
  const hotkeys = {g: drop, q: moveDown, e: moveUp};
  listen(root, 'keydown', event => {
    event.stopPropagation(); if (ime(event) || composing || event.altKey || event.ctrlKey || event.metaKey) return;
    const editable = event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (event.key === 'Escape') {event.preventDefault(); numeric.cancel(); void invoke(finish, {closing: true});}
    else if (!editable && hotkeys[event.key.toLowerCase()]) {event.preventDefault(); if (!event.repeat) {numeric.cancel(); void invoke(hotkeys[event.key.toLowerCase()]);}}
  });
  listen(root, 'keyup', event => event.stopPropagation());
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'contextmenu', 'wheel']) listen(root, type, event => event.stopPropagation());
  root.refresh = () => {
    if (disposed) return;
    const next = read(), nextId = next?.entityId || null;
    if (entityId !== nextId) {numeric.cancel(); headingQueue = null; drag = null; entityId = nextId; status.hidden = true;}
    current = next; root.hidden = !current; root.dataset.entityId = nextId || ''; root.dataset.dirty = String(!!current?.dirty); root.dataset.inputActive = String(!!current?.inputActive);
    root.title = typeof current?.help === 'string' ? current.help : '';
    root.setAttribute('aria-label', current?.label ? `${current.label} · 主操作` : '主操作');
    for (const item of controls) item.disabled = !current || pending || previewing;
    const hasHeading = typeof current?.headingDeg === 'number' && Number.isFinite(current.headingDeg); rotationGroup.hidden = !hasHeading;
    range.disabled = !hasHeading || pending; number.disabled = !hasHeading || pending || previewing && !numeric.pending;
    if (!current) return;
    range.value = String(heading()); range.setAttribute('aria-valuetext', `${Math.round(heading())}°`);
    track.style.transform = `translateX(${CONTROL_HEADING_LAYOUT.indicatorX - heading() / 359 * CONTROL_HEADING_LAYOUT.trackWidth}px)`;
    for (const preset of presetButtons) {preset.disabled = !hasHeading || pending || previewing; preset.setAttribute('aria-pressed', String(Number(preset.dataset.heading) === Math.round(heading())));}
    numeric.refresh();
  };
  root.dispose = () => {if (disposed) return; disposed = true; headingQueue = null; if (drag && viewport.hasPointerCapture?.(drag.pointerId)) viewport.releasePointerCapture?.(drag.pointerId); drag = null; numeric.dispose(); for (const remove of listeners) remove();};
  root.refresh(); return root;
}
