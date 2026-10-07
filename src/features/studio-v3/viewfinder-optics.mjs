import {el, button} from './dom.mjs';
import {createMenus} from './menus.mjs';
import {bindEntityInspectorNumberField} from './entity-inspector.mjs';
import {normalizeCameraOptics, FOCAL_LENGTH_PRESETS, APERTURE_PRESETS, FRAME_ASPECT_RATIO_OPTIONS, CAMERA_OPTICS_LIMITS} from './camera-optics.mjs';

// Static mc/pc/Xl contract in WorkspaceViewfinderButton-BHqIWibq.js.
// Lens values come from the shared optics module; this list only owns display order.
export const VIEWFINDER_RATIO_GROUPS = Object.freeze([
  ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '4:5', '9:19.5', '9:21'],
  ['1.33:1', '1.37:1', '1.43:1', '1.66:1', '1.85:1', '2.00:1', '2.20:1', '2.35:1', '2.39:1']
].map(group => Object.freeze(group.map(label => FRAME_ASPECT_RATIO_OPTIONS.find(option => option.label === label)))));
const decimal = number => String(Number(number.toFixed(1)));
const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
function addStyle(document) {
  if (document.querySelector('link[data-studio-v3-viewfinder-optics]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('viewfinder-optics.css', import.meta.url);
  link.dataset.studioV3ViewfinderOptics = ''; document.head.append(link);
}
function ratioIcon(value) {
  const wrapper = el('span', 'sv3-viewfinder-ratio-icon'), frame = el('span');
  wrapper.setAttribute('aria-hidden', 'true');
  frame.style.width = `${value >= 1 ? 20 : 20 * value}px`; frame.style.height = `${value >= 1 ? 20 / value : 20}px`;
  wrapper.append(frame); return wrapper;
}

/** DOM-only editor. The host owns the temporary camera and its navigation lease. */
export function createViewfinderOptics({read, apply, onError = () => {}, close = () => {}} = {}) {
  if (typeof read !== 'function' || typeof apply !== 'function') throw new TypeError('取景器镜头参数需要 read 和 apply');
  const root = el('section', 'sv3-viewfinder-optics'); root.setAttribute('aria-label', '取景器镜头参数'); root.setAttribute('role', 'group'); root.dataset.keyboardScope = 'local-tool';
  addStyle(root.ownerDocument);
  let disposed = false, busy = false, menus;
  const controls = new Set(), refreshers = new Set(), bindings = new Set();
  const optics = () => normalizeCameraOptics(read());
  const report = error => {if (!disposed) onError(error);};
  const refresh = () => {
    if (disposed) return;
    try {
      const state = optics();
      for (const control of controls) control.disabled = busy;
      for (const update of refreshers) update(state);
      for (const binding of bindings) binding.refresh();
      root.setAttribute('aria-busy', String(busy));
    } catch (error) {report(error); root.dispose();}
  };
  const commit = async patch => {
    if (disposed || busy) return {ok: false, message: '请等待当前镜头修改完成'};
    busy = true; refresh();
    try {
      if (disposed) return {ok: false, message: '取景器镜头参数已关闭'};
      const result = await apply(patch);
      return result === true ? {ok: true} : result?.ok === true ? result : {ok: false, message: result?.message || '镜头修改未被接受，请重试'};
    } finally {busy = false; refresh();}
  };
  const run = async (patch, dismiss) => {
    if (disposed || busy) return;
    try {const result = await commit(patch); if (!result.ok) throw Error(result.message); if (!disposed) dismiss?.();}
    catch (error) {report(error);}
  };
  const registeredButton = (name, label, action, options) => {
    const node = button(name, label, action, options); node.setAttribute('aria-label', label); controls.add(node); return node;
  };
  const separator = () => root.append(el('span', 'sv3-separator'));
  const menuContent = className => {
    const content = el('div', `sv3-viewfinder-menu ${className}`), localControls = [], localRefreshers = [], localBindings = [];
    let contentDisposed = false;
    content.dispose = () => {
      if (contentDisposed) return; contentDisposed = true;
      for (const node of localControls) {controls.delete(node); node.disabled = true; node.onclick = null;}
      for (const update of localRefreshers) refreshers.delete(update);
      for (const binding of localBindings) {binding.dispose(); bindings.delete(binding);}
    };
    content.addButton = (label, patch, dismiss, selected) => {
      const node = registeredButton(null, label, () => {if (!contentDisposed) void run(patch, dismiss);}, {text: label, className: 'sv3-viewfinder-option'});
      localControls.push(node); node.setAttribute('role', 'menuitem');
      const update = state => node.setAttribute('aria-pressed', String(selected(state))); localRefreshers.push(update); refreshers.add(update);
      return node;
    };
    content.addNumber = ({label, field, min, max, step, format, patch, value = state => state[field]}, dismiss) => {
      const row = el('label', 'sv3-viewfinder-number', label), input = el('input'); input.type = 'number'; input.min = String(min); if (max) input.max = String(max); input.step = String(step); input.setAttribute('aria-label', label); input.dataset.field = field;
      controls.add(input); localControls.push(input);
      const binding = bindEntityInspectorNumberField(input, {
        read: () => value(optics()), format: () => format(value(optics())),
        validate: number => {if (number <= 0) throw Error('请输入大于零的数值'); return number;},
        commit: number => contentDisposed ? {ok: false} : commit(patch(number)), close: dismiss,
        onError: error => {if (!contentDisposed) report(error);}, onAccepted: () => {if (!contentDisposed) refresh();}
      });
      localBindings.push(binding); bindings.add(binding); row.append(input); content.append(row); return input;
    };
    return content;
  };
  const toggle = (anchor, factory, width, label) => {
    if (disposed || busy) return;
    // A transformed bottom dock establishes a containing block for fixed
    // popovers. Mount in the Studio root, after the host has attached this node.
    menus ||= createMenus({root: root.closest('.studio-v3') || root, onError: report});
    menus.toggle(anchor, factory, {placement: 'top', align: 'center', width, label}); refresh();
  };
  const ratio = registeredButton(null, '画幅比例', () => toggle(ratio, ({close: dismiss}) => {
    const content = menuContent('sv3-viewfinder-ratio-menu');
    for (const group of VIEWFINDER_RATIO_GROUPS) {
      const grid = el('div', 'sv3-viewfinder-ratio-grid');
      for (const option of group) {
        const node = content.addButton(option.label, {frameAspectRatio: option.value}, dismiss, state => Math.abs(state.frameAspectRatio - option.value) < 1e-6);
        node.dataset.ratio = option.label; node.prepend(ratioIcon(option.value)); grid.append(node);
      }
      content.append(grid);
    }
    return content;
  }, 288, '画幅比例'), {className: 'sv3-button sv3-viewfinder-ratio'});
  const ratioLabel = el('span'), ratioFrame = ratioIcon(16 / 9), chevron = el('span', 'sv3-viewfinder-chevron', '⌄'); ratio.append(ratioFrame, ratioLabel, chevron);
  refreshers.add(state => {
    ratioLabel.textContent = FRAME_ASPECT_RATIO_OPTIONS.find(option => Math.abs(option.value - state.frameAspectRatio) < 1e-6)?.label || `${decimal(state.frameAspectRatio)}:1`;
    const frame = ratioFrame.firstElementChild; frame.style.width = `${state.frameAspectRatio >= 1 ? 20 : 20 * state.frameAspectRatio}px`; frame.style.height = `${state.frameAspectRatio >= 1 ? 20 / state.frameAspectRatio : 20}px`;
  });
  root.append(ratio); separator();
  const focal = registeredButton(null, '焦距', () => toggle(focal, ({close: dismiss}) => {
    const content = menuContent('sv3-viewfinder-lens-menu');
    content.addNumber({label: '焦距 (mm)', field: 'focalLength', min: CAMERA_OPTICS_LIMITS.minFocalLength, max: CAMERA_OPTICS_LIMITS.maxFocalLength, step: 1, format: number => String(Math.round(number)), patch: focalLength => ({focalLength})}, dismiss);
    const presets = el('div', 'sv3-viewfinder-presets');
    for (const value of FOCAL_LENGTH_PRESETS) {const node = content.addButton(`${value}mm`, {focalLength: value}, dismiss, state => state.focalLength === value); node.dataset.focalLength = value; presets.append(node);}
    content.append(presets); return content;
  }, 256, '焦距'), {text: '24mm', className: 'sv3-button sv3-viewfinder-readout'});
  refreshers.add(state => focal.querySelector('span').textContent = `${Math.round(state.focalLength)}mm`); root.append(focal); separator();
  const aperture = registeredButton(null, '光圈与景深', () => toggle(aperture, ({close: dismiss}) => {
    const content = menuContent('sv3-viewfinder-lens-menu');
    content.addNumber({label: '光圈 (ƒ/)', field: 'apertureFNumber', min: CAMERA_OPTICS_LIMITS.minAperture, max: CAMERA_OPTICS_LIMITS.maxAperture, step: .1, format: decimal, patch: apertureFNumber => ({apertureFNumber, depthOfFieldMode: 'aperture'})}, dismiss);
    const presets = el('div', 'sv3-viewfinder-presets');
    for (const value of APERTURE_PRESETS) {const node = content.addButton(`ƒ/${value}`, {apertureFNumber: value, depthOfFieldMode: 'aperture'}, dismiss, state => state.depthOfFieldMode === 'aperture' && state.apertureFNumber === value); node.dataset.aperture = value; presets.append(node);}
    content.append(presets, content.addButton('全景深', {depthOfFieldMode: 'deepFocus'}, dismiss, state => state.depthOfFieldMode === 'deepFocus')); return content;
  }, 256, '光圈与景深'), {text: '全景深', className: 'sv3-button sv3-viewfinder-readout'});
  refreshers.add(state => aperture.querySelector('span').textContent = state.depthOfFieldMode === 'deepFocus' ? '全景深' : `ƒ/${decimal(state.apertureFNumber)}`); root.append(aperture); separator();
  const focus = registeredButton('focus', '对焦距离', () => toggle(focus, ({close: dismiss}) => {
    const content = menuContent('sv3-viewfinder-lens-menu');
    content.addNumber({label: '对焦距离 (m)', field: 'focusDistance', min: CAMERA_OPTICS_LIMITS.minFocusDistance, step: .1, format: number => number === null ? '' : number.toFixed(1), patch: focusDistance => ({focusDistance})}, dismiss);
    content.append(content.addButton('无限远', {focusDistance: null}, dismiss, state => state.focusDistance === null)); return content;
  }, 224, '对焦距离'), {text: '10.0m', className: 'sv3-button sv3-viewfinder-readout'});
  refreshers.add(state => focus.querySelector('span').textContent = state.focusDistance === null ? '∞' : `${state.focusDistance.toFixed(1)}m`); root.append(focus);
  const dismiss = () => {if (disposed) return; root.dispose(); close();};
  const exit = button('close', '关闭镜头参数', dismiss); exit.setAttribute('aria-label', '关闭镜头参数'); root.append(exit);
  const stopPointer = event => event.stopPropagation();
  const keydown = event => {
    event.stopPropagation(); if (event.defaultPrevented || ime(event) || event.target.closest('input')) return;
    if (event.key === 'Escape' && !menus?.isOpen()) {event.preventDefault(); dismiss();}
  };
  root.addEventListener('pointerdown', stopPointer); root.addEventListener('keydown', keydown);
  root.refresh = refresh;
  root.dispose = () => {
    if (disposed) return; disposed = true; menus?.dispose();
    for (const binding of bindings) binding.dispose(); bindings.clear(); refreshers.clear();
    for (const node of controls) {node.disabled = true; node.onclick = null;} controls.clear(); exit.disabled = true; exit.onclick = null;
    root.removeEventListener('pointerdown', stopPointer); root.removeEventListener('keydown', keydown);
  };
  refresh(); return root;
}
