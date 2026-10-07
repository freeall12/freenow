import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';
import {createMenus} from './menus.mjs';
import {normalizeCameraOptics, FOCAL_LENGTH_PRESETS, APERTURE_PRESETS, FRAME_ASPECT_RATIO_OPTIONS} from './camera-optics.mjs';

export const CAMERA_HUD_RATIO_GROUPS = Object.freeze([
  ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '4:5', '9:19.5', '9:21'],
  ['1.33:1', '1.37:1', '1.43:1', '1.66:1', '1.85:1', '2.00:1', '2.20:1', '2.35:1', '2.39:1']
].map(group => Object.freeze(group.map(label => FRAME_ASPECT_RATIO_OPTIONS.find(item => item.label === label)))));
export const CAMERA_RULER_LAYOUT = Object.freeze({focalTrack: 534, apertureTrack: 216, focalWindow: 132, apertureWindow: 124, height: 40, terminalGap: 18, terminalThreshold: 2, dragThreshold: 3, tickSpacing: 6, highlightDuration: 340, springRate: 28});
const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const apertureText = value => `ƒ/${Number((Math.round(value * 10) / 10).toFixed(1))}`;
export const cameraRulerPosition = (value, min, max, width) => width * (Math.log(clamp(value, min, max)) - Math.log(min)) / (Math.log(max) - Math.log(min));
export const cameraRulerValue = (position, min, max, width) => position <= 0 ? min : position >= width ? max : clamp(Math.exp(Math.log(min) + position / width * (Math.log(max) - Math.log(min))), min, max);
function readoutWidth(text) {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 255 ? 2 : /[ilI1.,]/.test(char) ? .55 : /[mwMW]/.test(char) ? 1.25 : .9;
  return clamp(Math.ceil(width * 8 + 16), 38, 104);
}
function loadStyle(document) {
  const href = new URL('camera-control-hud.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioV3CameraHud = ''; document.head.append(link);
}
/** Original vc shutter geometry: a 20 px ring and a 12 px center, not camera SVG. */
export function createCameraShutter(action) {
  const shutter = button(null, '拍摄到画布', action, {className: 'sv3-button sv3-camera-shutter'}); shutter.dataset.size = 'control'; shutter.setAttribute('aria-label', '拍摄到画布'); shutter.title = '将当前画面拍成照片';
  loadStyle(shutter.ownerDocument);
  const graphic = el('span', 'sv3-camera-shutter-graphic'); graphic.setAttribute('aria-hidden', 'true'); graphic.append(el('span', 'sv3-camera-shutter-ring'), el('span', 'sv3-camera-shutter-center')); shutter.append(graphic); return shutter;
}
/** Exact installed Ln geometry; this is the original dynamic ratio rectangle. */
function ratioGraphic(ratio, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const span = Math.round(size * .8125), width = ratio >= 1 ? span : Math.round(span * ratio), height = ratio >= 1 ? Math.round(span / ratio) : span;
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('sv3-camera-ratio-icon');
  for (const [key, value] of Object.entries({x: (size - width) / 2, y: (size - height) / 2, width, height, rx: 1.5, stroke: 'currentColor', 'stroke-width': 1.5})) rect.setAttribute(key, value);
  svg.append(rect); return svg;
}

/** Installed zt fixed/log slider, with pointer capture and its local interaction
 * boundary. Applying previews never completes the host camera transaction. */
function fixedRuler({document, field, label, min, max, presets, trackWidth, windowWidth, format, read, apply, report, busy, getFocusPicking, toggleFocusPicking}) {
  const view = document.defaultView, root = el('fieldset', 'sv3-camera-ruler'); root.dataset.field = field; root.append(el('legend', 'sv3-camera-visually-hidden', label));
  const viewport = el('div', 'sv3-camera-ruler-window'), track = el('div', 'sv3-camera-ruler-track'), indicator = el('span', 'sv3-camera-ruler-indicator'), readout = el('span', 'sv3-camera-ruler-readout');
  const accessibility = el('span', 'sv3-camera-ruler-accessible'); accessibility.setAttribute('role', 'slider'); accessibility.setAttribute('aria-label', label); accessibility.setAttribute('aria-valuemin', min); accessibility.setAttribute('aria-valuemax', max); accessibility.tabIndex = 0;
  viewport.append(track, indicator, accessibility); root.append(viewport, readout);
  const terminal = field === 'apertureFNumber', fullWidth = trackWidth + (terminal ? 18 : 0), visibleWidth = windowWidth - 58, center = visibleWidth / 2;
  viewport.style.width = `${visibleWidth}px`; track.style.width = `${fullWidth}px`; indicator.style.left = `${center - 1}px`;
  let disposed = false, frame = null, offset = null, target = null, previousOffset = null, lastFrame = null, drag = null, suppressClick = false, interaction = false, refreshKey = null;
  const nodes = [], ticks = [], highlighted = new Map(), listeners = [];
  const listen = (node, name, fn) => {node.addEventListener(name, fn); listeners.push(() => node.removeEventListener(name, fn));};
  const now = () => view.performance.now();
  const value = () => read()[field];
  const isTerminal = () => terminal && read().depthOfFieldMode === 'deepFocus';
  const patchAt = position => terminal && position >= trackWidth + 2 ? {depthOfFieldMode: 'deepFocus'} : {[field]: cameraRulerValue(Math.min(position, trackWidth), min, max, trackWidth), ...(terminal ? {depthOfFieldMode: 'aperture'} : {})};
  const change = patch => {
    if (disposed || busy()) return false;
    try {if (apply(patch) !== true) throw Error('镜头修改未被接受，请重试'); return true;}
    catch (error) {report(error); return false;}
  };
  const stopFrame = () => {if (frame !== null) view.cancelAnimationFrame(frame); frame = null; lastFrame = null;};
  function paint(timestamp) {
    track.style.transform = `translateX(${offset}px)`;
    for (const tick of ticks) {
      const oldDelta = previousOffset === null ? Infinity : tick.x + previousOffset - center, delta = tick.x + offset - center;
      if (previousOffset !== null && (oldDelta < -.5 && delta > .5 || oldDelta > .5 && delta < -.5 || Math.abs(delta) <= 1 && Math.abs(oldDelta) > 1)) highlighted.set(tick.node, timestamp);
      const age = timestamp - (highlighted.get(tick.node) ?? -Infinity), emphasis = age < 340 ? Math.max(0, (1 - age / 340) ** 3) : 0;
      const base = tick.major ? .35 : .22; tick.node.style.backgroundColor = emphasis > .08 ? `rgba(255,255,255,${(tick.major ? .82 : .76) + emphasis * (tick.major ? .18 : .2)})` : `rgba(255,255,255,${base})`;
      if (!tick.major) tick.node.style.height = `${5 + emphasis * 5}px`;
      if (age >= 340) highlighted.delete(tick.node);
    }
    for (const node of nodes) {if (node.dataset.tickX === undefined) continue; const x = Number(node.dataset.tickX) + offset; node.tabIndex = x >= 0 && x <= visibleWidth ? 0 : -1; node.style.pointerEvents = x >= 0 && x <= visibleWidth ? 'auto' : 'none';}
    previousOffset = offset;
  }
  const animate = timestamp => {
    frame = null; if (disposed) return;
    const dt = lastFrame === null ? 1 / 60 : Math.max(1 / 240, (timestamp - lastFrame) / 1000); lastFrame = timestamp;
    if (!drag && Math.abs(target - offset) > .25) offset += (target - offset) * (1 - Math.exp(-28 * dt)); else offset = target;
    paint(timestamp);
    if (!drag && (Math.abs(target - offset) > .25 || highlighted.size)) frame = view.requestAnimationFrame(animate); else lastFrame = null;
  };
  const schedule = () => {if (frame === null && !disposed) frame = view.requestAnimationFrame(animate);};
  const majorXs = presets.map((_, index) => trackWidth * index / (presets.length - 1));
  for (let index = 0; index < majorXs.length - 1; index++) {
    const count = Math.max(1, Math.round((majorXs[index + 1] - majorXs[index]) / 6) - 1);
    for (let j = 1; j <= count; j++) {const x = majorXs[index] + j / (count + 1) * (majorXs[index + 1] - majorXs[index]), node = el('span', 'sv3-camera-ruler-minor'); node.style.left = `${x - 1}px`; node.setAttribute('aria-hidden', 'true'); ticks.push({node, x, major: false}); track.append(node);}
  }
  for (let index = 0; index < presets.length; index++) {
    const item = button(null, format(presets[index]), () => {if (!suppressClick && change({[field]: presets[index], ...(terminal ? {depthOfFieldMode: 'aperture'} : {})})) refresh();}, {className: 'sv3-camera-ruler-preset'}), tick = el('span');
    item.setAttribute('aria-label', format(presets[index])); item.dataset.preset = String(presets[index]); item.dataset.tickX = String(majorXs[index]); item.style.left = `${majorXs[index] - 1}px`; item.append(tick); nodes.push(item); ticks.push({node: tick, x: majorXs[index], major: true}); track.append(item);
    listen(item, 'pointerdown', event => event.stopPropagation());
  }
  if (terminal) {
    const item = button(null, '泛焦', () => {if (!suppressClick && change({depthOfFieldMode: 'deepFocus'})) refresh();}, {className: 'sv3-camera-ruler-terminal'}); item.setAttribute('aria-label', '泛焦'); item.dataset.tickX = String(fullWidth); item.style.left = `${fullWidth - 2.5}px`; item.append(el('span')); track.append(item); nodes.push(item);
    const toggle = button(null, '泛焦', () => {if (change({depthOfFieldMode: isTerminal() ? 'aperture' : 'deepFocus'})) refresh();}, {className: 'sv3-camera-ruler-terminal-readout'}); toggle.setAttribute('aria-label', '泛焦'); toggle.append(readout); root.append(toggle); nodes.push(toggle); listen(toggle, 'pointerdown', event => event.stopPropagation());
  }
  function end(event) {
    if (!drag || event && event.pointerId !== drag.pointerId) return false;
    const id = drag.pointerId, active = drag.active; drag = null; interaction = false; root.dataset.dragging = 'false';
    if (viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture?.(id);
    if (active) {suppressClick = true; view.setTimeout(() => {suppressClick = false;}, 0);}
    refreshKey = null; refresh(); return active;
  }
  listen(viewport, 'pointerdown', event => {
    if (busy() || disposed || event.button !== 0 || event.isPrimary === false || event.target.closest?.('button')) return;
    event.preventDefault(); event.stopPropagation(); stopFrame();
    drag = {pointerId: event.pointerId, clientX: event.clientX, offset, active: false}; viewport.setPointerCapture?.(event.pointerId);
  });
  listen(viewport, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId || disposed || busy()) return;
    const delta = event.clientX - drag.clientX; if (!drag.active && Math.abs(delta) <= 3) return;
    drag.active = true; interaction = true; root.dataset.dragging = 'true';
    event.preventDefault(); event.stopPropagation();
    const next = clamp(drag.offset + delta, center - fullWidth, center);
    if (change(patchAt(center - next))) {offset = next; target = next; paint(now());}
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(viewport, name, end);
  // Source Xl supplies commit, not interactionCancel. Cancelled native drags
  // therefore stop locally and retain accepted optics, without finishing camera.
  listen(root, 'keydown', event => {
    if (ime(event)) {event.stopPropagation(); return;}
    if (event.key === 'Escape' && busy()) {event.preventDefault(); event.stopPropagation(); return;}
    if (event.key === 'Escape' && getFocusPicking?.()) {event.preventDefault(); event.stopPropagation(); try {if (toggleFocusPicking?.() !== true) throw Error('暂时无法取消选点');} catch (error) {report(error);} return;}
    if (event.key === 'Escape' && (drag || interaction)) {event.preventDefault(); event.stopPropagation(); end(); interaction = false; return;}
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.target !== accessibility || busy() || event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 0;
    const position = cameraRulerPosition(value(), min, max, trackWidth), step = trackWidth * (event.key.startsWith('Page') ? .1 : .01);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? fullWidth : direction ? position + direction * step : null;
    if (next !== null) {event.preventDefault(); interaction = true; if (change(patchAt(next))) refresh();}
  });
  listen(accessibility, 'keyup', event => {event.stopPropagation(); interaction = false;}); listen(accessibility, 'blur', () => {interaction = false;});
  function refresh() {
    if (disposed) return;
    const state = read(), disabled = busy(), key = JSON.stringify([state[field], terminal && state.depthOfFieldMode, disabled]);
    if (key === refreshKey) return; refreshKey = key;
    const text = isTerminal() ? '泛焦' : format(state[field]), width = readoutWidth(text); readout.textContent = text; readout.style.width = `${width}px`;
    root.style.width = `${visibleWidth + width + 2}px`; root.disabled = disabled; accessibility.setAttribute('aria-disabled', String(disabled)); accessibility.tabIndex = disabled ? -1 : 0; accessibility.setAttribute('aria-valuenow', state[field]); accessibility.setAttribute('aria-valuetext', text);
    const position = isTerminal() ? fullWidth : cameraRulerPosition(state[field], min, max, trackWidth); target = clamp(center - position, center - fullWidth, center);
    if (terminal) root.querySelector('.sv3-camera-ruler-terminal-readout').setAttribute('aria-pressed', String(isTerminal()));
    if (offset === null || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {offset = target; paint(now());}
    else if (!drag) schedule();
    if (busy() && drag) end();
  }
  root.refresh = refresh; root.endInteraction = () => {const ended = end(); interaction = false; return ended;}; root.hasInteraction = () => !!drag || interaction;
  root.dispose = () => {if (disposed) return; disposed = true; stopFrame(); if (drag && viewport.hasPointerCapture?.(drag.pointerId)) viewport.releasePointerCapture?.(drag.pointerId); drag = null; for (const remove of listeners) remove(); for (const item of nodes) {item.onclick = null; item.disabled = true;}};
  refresh(); return root;
}

/** Original wY/Xl/IE order. The host exclusively owns camera edits and capture. */
export function createCameraControlHUD({read, getBusy = () => false, getPendingCapture = () => false, apply, capture, cancel, finish, onError = () => {}, toggleFocusPicking, getFocusPicking = () => false, getDepthOfFieldSupported = () => true} = {}) {
  for (const [name, action] of Object.entries({read, getBusy, apply, capture, cancel, finish})) if (typeof action !== 'function') throw new TypeError(`摄像机操控栏需要 ${name}`);
  const root = el('section', 'sv3-capsule sv3-camera-control-hud'); root.dataset.keyboardScope = 'local-tool'; root.setAttribute('role', 'toolbar'); root.setAttribute('aria-label', '摄像机工具栏'); loadStyle(root.ownerDocument);
  // Navigation listens on window capture, before this toolbar can stop bubbling.
  root.dataset.worldWorkspaceBlockMovementHotkeys = 'true';
  let disposed = false, pending = false, menus, refreshKey = null;
  const controls = [], rulers = [], listeners = [], document = root.ownerDocument;
  const busy = () => disposed || pending || getBusy();
  // A failed save retains its capture receipt and host lease. Only retry may
  // run until the host confirms the saved photo; camera edits would stale it.
  const editingLocked = () => busy() || getPendingCapture();
  const state = () => normalizeCameraOptics(read());
  const feedback = el('div', 'sv3-camera-hud-feedback'); feedback.hidden = true; feedback.setAttribute('role', 'alert');
  const report = error => {if (disposed) return; feedback.textContent = error.message || String(error); feedback.hidden = false; onError(error);};
  const listen = (node, type, fn) => {node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));};
  const refresh = () => {
    if (disposed) return;
    try {
      root.hidden = !read(); if (root.hidden) {refreshKey = null; return;}
      const optics = state(), active = getFocusPicking(), retry = !!getPendingCapture(), disabled = editingLocked(), depthOfField = getDepthOfFieldSupported(), key = JSON.stringify([optics.frameAspectRatio, optics.focalLength, optics.apertureFNumber, optics.depthOfFieldMode, optics.focusDistance, active, disabled, depthOfField, retry, busy()]);
      if (key === refreshKey) return; refreshKey = key;
      for (const item of controls) item.disabled = disabled;
      shutter.disabled = busy(); shutter.title = retry ? '重试保存照片' : '将当前画面拍成照片'; shutter.setAttribute('aria-label', retry ? '重试保存照片' : '拍摄到画布'); shutter.dataset.retrying = String(retry);
      focus.disabled = disabled || !depthOfField || typeof toggleFocusPicking !== 'function'; focus.hidden = !depthOfField;
      focus.setAttribute('aria-pressed', String(active)); focus.dataset.active = String(active);
      focus.title = active ? '点击场景可以设置对焦位置' : optics.focusDistance === null ? '重选对焦点' : '选择对焦点';
      focus.setAttribute('aria-label', focus.title); focusReadout.textContent = optics.focusDistance === null ? '远焦' : `${optics.focusDistance.toFixed(1)}m`;
      const ratio = optics.frameAspectRatio || 3 / 2; ratioText.textContent = FRAME_ASPECT_RATIO_OPTIONS.find(item => Math.abs(item.value - ratio) < 1e-6)?.label || `${Number(ratio.toFixed(2))}:1`; ratioImage.replaceChildren(ratioGraphic(ratio));
      for (const ruler of rulers) {ruler.hidden = ruler.dataset.field === 'apertureFNumber' && !depthOfField; ruler.refresh();} root.setAttribute('aria-busy', String(busy())); shutter.dataset.capturing = String(pending || getBusy());
      if (editingLocked() && menus?.isOpen()) menus.close({all: true});
    } catch (error) {report(error); for (const item of controls) item.disabled = true;}
  };
  const patch = value => {
    if (editingLocked() || !read()) return false;
    const result = apply(value); if (result !== true) return false;
    feedback.hidden = true; refresh(); return true;
  };
  const run = async (action, retry = false) => {
    if (busy() || !read() || !retry && getPendingCapture()) return;
    pending = true; refresh();
    try {const result = await action(); if (!(result === true || result?.ok === true)) throw Error(result?.message || '操作未被接受，请重试'); if (!disposed) feedback.hidden = true;}
    catch (error) {report(error);} finally {pending = false; refresh();}
  };
  const ratioButton = button(null, '画幅比例', () => {
    if (editingLocked() || !read()) return;
    menus ||= createMenus({root: root.closest('.studio-v3') || root, onError: report});
    menus.toggle(ratioButton, ({close}) => {
      const content = el('div', 'sv3-camera-ratio-menu'), buttons = [];
      for (const group of CAMERA_HUD_RATIO_GROUPS) {
        const grid = el('div', 'sv3-camera-ratio-grid');
        for (const option of group) {
          const item = button(null, option.label, () => {try {if (!patch({frameAspectRatio: option.value})) throw Error('画幅修改未被接受，请重试'); close();} catch (error) {report(error);}}, {className: 'sv3-camera-ratio-option'});
          item.setAttribute('aria-label', option.label); item.dataset.ratio = option.label; item.setAttribute('aria-pressed', String(Math.abs(state().frameAspectRatio - option.value) < 1e-6)); item.append(ratioGraphic(option.value, 20), el('span', '', option.label)); grid.append(item); buttons.push(item);
        }
        content.append(grid);
      }
      content.dispose = () => {for (const item of buttons) {item.onclick = null; item.disabled = true;}}; return content;
    }, {label: '画幅比例', width: 288, placement: 'top', align: 'center'});
  }, {className: 'sv3-button sv3-camera-ratio-button'}); ratioButton.dataset.size = 'control'; ratioButton.setAttribute('aria-label', '画幅比例');
  const ratioImage = el('span'), ratioText = el('span'), chevron = el('span', 'sv3-camera-ratio-chevron'); chevron.innerHTML = icon('chevronRight', {size: 20}); ratioButton.append(ratioImage, ratioText, chevron); controls.push(ratioButton); root.append(ratioButton, el('span', 'sv3-separator'));
  for (const options of [
    {field: 'focalLength', label: '焦距', min: 8, max: 400, presets: FOCAL_LENGTH_PRESETS, trackWidth: 534, windowWidth: 132, format: value => `${Math.round(value)}mm`},
    {field: 'apertureFNumber', label: '光圈', min: 1.4, max: 22, presets: APERTURE_PRESETS, trackWidth: 216, windowWidth: 124, format: apertureText}
  ]) {const ruler = fixedRuler({...options, document, read: state, apply: patch, report, busy: options.field === 'apertureFNumber' ? () => editingLocked() || !getDepthOfFieldSupported() : editingLocked, getFocusPicking, toggleFocusPicking: () => {if (editingLocked() || !read()) return false; const accepted = toggleFocusPicking?.(); if (accepted === true) refresh(); return accepted;}}); rulers.push(ruler); root.append(ruler);}
  const focus = button('focus', '选择对焦点', () => {if (editingLocked() || !read() || !getDepthOfFieldSupported() || !toggleFocusPicking) return; try {if (toggleFocusPicking() !== true) throw Error('暂时无法拾取对焦点'); feedback.hidden = true; refresh();} catch (error) {report(error);}}, {className: 'sv3-button sv3-camera-focus'}); focus.innerHTML = icon('focus', {size: 20, strokeWidth: 1.75}); focus.dataset.size = 'control'; const focusReadout = el('span'); focus.append(focusReadout); controls.push(focus); root.append(focus, el('span', 'sv3-separator'));
  const shutter = createCameraShutter(() => void run(capture, true)); controls.push(shutter); root.append(shutter, el('span', 'sv3-separator'));
  const restore = button('undo', '还原并退出', () => void run(cancel), {text: '还原并退出'}), done = button('check', '完成', () => void run(finish), {text: '完成'});
  for (const item of [restore, done]) {item.dataset.size = 'control'; item.setAttribute('aria-label', item.title); controls.push(item);}
  restore.querySelector('svg').outerHTML = icon('undo', {size: 18, strokeWidth: 1.8}); done.querySelector('svg').outerHTML = icon('check', {size: 18, strokeWidth: 1.9}); done.dataset.cameraFinish = 'true'; done.setAttribute('aria-keyshortcuts', 'Escape'); done.title = '完成 (Esc)'; root.append(restore, done, feedback);
  listen(root, 'keydown', event => {
    event.stopPropagation(); if (event.defaultPrevented || ime(event) || event.key !== 'Escape') return;
    event.preventDefault(); if (editingLocked() || !read()) return;
    if (getFocusPicking()) {try {if (toggleFocusPicking?.() !== true) throw Error('暂时无法取消选点'); refresh();} catch (error) {report(error);} return;}
    if (rulers.some(ruler => ruler.hasInteraction())) {for (const ruler of rulers) ruler.endInteraction(); return;}
    if (menus?.isOpen()) {menus.close(); return;} void run(finish);
  });
  for (const type of ['keyup', 'pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'wheel']) listen(root, type, event => event.stopPropagation());
  root.refresh = refresh;
  root.dispose = () => {if (disposed) return; disposed = true; menus?.dispose(); for (const ruler of rulers) ruler.dispose(); for (const remove of listeners) remove(); for (const item of controls) {item.disabled = true; item.onclick = null;}};
  refresh(); return root;
}
