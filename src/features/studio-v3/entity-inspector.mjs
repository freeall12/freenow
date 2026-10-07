import {el, button} from './dom.mjs';
import {resolveEntityControl} from './entity-actions.mjs';
import {normalizeCameraOptics, cameraOpticsPatch, FOCAL_LENGTH_PRESETS, APERTURE_PRESETS, FRAME_ASPECT_RATIO_OPTIONS} from './camera-optics.mjs';

// These are the nine authorable poses in official T6/P6/M6, not all locomotion
// clips contained in character.glb. The local renderer stores actual clip names.
export const CHARACTER_POSE_OPTIONS = Object.freeze([
  {id: 'stand', clipName: 'Standing', label: '站立', group: '站坐与低位'},
  {id: 'sit', clipName: 'Sitting', label: '椅坐', group: '站坐与低位'},
  {id: 'sit-floor', clipName: 'Sitting Floor', label: '地坐', group: '站坐与低位'},
  {id: 'crouch', clipName: 'Crouching', label: '蹲伏', group: '站坐与低位'},
  {id: 'kneel', clipName: 'Kneeling', label: '单膝跪地', group: '站坐与低位'},
  {id: 'sleep-side', clipName: 'Sleeping Side', label: '侧卧', group: '躺卧'},
  {id: 'sleep-supine', clipName: 'Sleeping Supine', label: '自然仰卧', group: '躺卧'},
  {id: 'lie-prone', clipName: 'Lying Prone', label: '趴卧', group: '躺卧'},
  {id: 'sleep-supine-straight', clipName: 'Sleeping Supine Straight', label: '伸展仰卧', group: '躺卧'}
].map(Object.freeze));
export const ENTITY_COLOR_OPTIONS = Object.freeze([
  {id: 'rose', color: '#C97984', label: '玫瑰色'}, {id: 'blue', color: '#6F93C8', label: '蓝色'},
  {id: 'gold', color: '#D0A552', label: '金色'}, {id: 'green', color: '#82AD6B', label: '绿色'},
  {id: 'violet', color: '#A681C8', label: '紫色'}, {id: 'teal', color: '#63B5A2', label: '青绿色'}
].map(Object.freeze));

/** Read the actual GLB JSON chunk, rejecting truncation and missing pose clips. */
export function readCharacterPoseOptions(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw Error('人物模型不是完整的 GLB 2.0 文件');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length === 0 || 20 + length > bytes.length) throw Error('人物模型的姿态数据无效');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)).trim());
  const animations = new Map((json.animations || []).map(animation => [animation.name, animation]));
  for (const option of CHARACTER_POSE_OPTIONS) {
    const animation = animations.get(option.clipName);
    if (!animation?.channels?.length || !animation?.samplers?.length) throw Error(`人物模型没有姿态 ${option.label}（${option.clipName}）`);
  }
  return CHARACTER_POSE_OPTIONS;
}

const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const formatNumber = (value, precision = 3) => String(Number(Number(value).toFixed(precision)));
function rejected(result) {return Error(result?.message || '修改未被接受，请重试');}

/** Explicit drafts only: display rounding, focus and blur cannot author a value. */
export function bindEntityInspectorNumberField(input, {read, format = () => String(read()), commit, close = () => {}, onError = () => {}, validate = value => value, onAccepted = () => {}}) {
  let accepted = format(), draft = null, pending = false, composing = false, disposed = false;
  input.value = accepted;
  const cancel = () => {draft = null; input.value = accepted;};
  const refresh = () => {if (draft === null && !pending) {accepted = format(); input.value = accepted;}};
  const submit = async () => {
    if (disposed || composing || pending || input.disabled || draft === null) return;
    const text = draft; draft = null;
    if (!text.trim()) {cancel(); onError(Error('请输入有效数值')); return;}
    const value = Number(text);
    if (!Number.isFinite(value)) {cancel(); onError(Error('请输入有效数值')); return;}
    pending = true; input.readOnly = true; input.setAttribute('aria-busy', 'true');
    try {
      const next = validate(value);
      if (next !== read()) {
        const result = await commit(next);
        if (result?.ok !== true) throw rejected(result);
      }
      accepted = format(); input.value = accepted; onAccepted();
    } catch (error) {input.value = accepted; onError(error);}
    finally {pending = false; input.readOnly = false; input.removeAttribute('aria-busy');}
  };
  const inputDraft = () => {if (!pending && !disposed) draft = input.value;};
  const change = () => {inputDraft(); void submit();};
  const keydown = event => {
    event.stopPropagation(); if (ime(event) || composing) return;
    if (event.key === 'Escape') {event.preventDefault(); cancel(); close();}
    else if (event.key === 'Enter') {event.preventDefault(); void submit();}
  };
  const start = () => {composing = true;};
  const end = () => {composing = false; inputDraft();};
  input.addEventListener('input', inputDraft); input.addEventListener('change', change);
  input.addEventListener('blur', submit); input.addEventListener('keydown', keydown);
  input.addEventListener('compositionstart', start); input.addEventListener('compositionend', end);
  return {cancel, refresh, get pending() {return pending;}, dispose() {
    disposed = true; cancel();
    for (const [name, fn] of [['input', inputDraft], ['change', change], ['blur', submit], ['keydown', keydown], ['compositionstart', start], ['compositionend', end]]) input.removeEventListener(name, fn);
  }};
}

function addStyle(document) {
  if (document.querySelector('link[data-studio-v3-inspector]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('inspector.css', import.meta.url);
  link.dataset.studioV3Inspector = ''; document.head.append(link);
}

/** Host owns mutations/history/runtime guards. Returns a menu-compatible node. */
export function createEntityInspector({control, applyAction, onError = () => {}, close = () => {}, onEditBaseline, fetchAsset = (...args) => fetch(...args), onPickFocus, depthOfFieldRendered = false} = {}) {
  if (typeof applyAction !== 'function') throw new TypeError('实体属性需要 applyAction');
  let acceptedControl = typeof control === 'function' ? control() : control;
  if (!acceptedControl?.definition) throw new TypeError('实体属性需要有效的 control');
  const entityId = acceptedControl.definition.id, setupId = acceptedControl.setupId;
  const panel = el('section', 'sv3-inspector sv3-entity-inspector'); panel.ariaLabel = '实体属性'; panel.dataset.entityId = entityId;
  addStyle(panel.ownerDocument);
  let disposed = false, busy = false, poseReady = false;
  const abort = new AbortController(), bindings = [], refreshers = [], permissions = [];
  const report = error => {if (!disposed) onError(error);};
  const read = () => {
    if (typeof control === 'function') {
      const current = control();
      if (!current || current.definition.id !== entityId || current.setupId !== setupId) throw Error('实体或状态已变化，请重新打开属性');
      acceptedControl = current;
    }
    return acceptedControl;
  };
  const editable = field => {
    const c = read();
    if (['color', 'materialMode', 'locked'].includes(field)) return true;
    if (!c.setupState || c.baselineReadOnly) return false;
    return field === 'visible' || !c.locked;
  };
  const refresh = () => {
    if (disposed) return;
    try {
      for (const {node, field, extra} of permissions) node.disabled = busy || !editable(field) || !!extra?.();
      for (const binding of bindings) binding.refresh();
      for (const update of refreshers) update();
    } catch (error) {report(error); panel.dispose?.();}
  };
  const apply = async (patch, field) => {
    if (disposed || busy) return {ok: false, message: '请等待当前修改完成'};
    if (!editable(field)) return {ok: false, message: read().baselineReadOnly ? '此实体属于场景基准，请切换到场景基准后编辑。' : '实体已锁定，请先解锁后编辑。'};
    busy = true; refresh();
    try {
      const result = await applyAction({type: 'update', entityId, setupId, patch});
      if (result?.ok !== true) return result || {ok: false};
      if (result.state) acceptedControl = resolveEntityControl(result.state, {entityId, setupId});
      else if (typeof control !== 'function') {
        const next = structuredClone(acceptedControl);
        for (const [key, value] of Object.entries(patch)) {
          if (['color', 'materialMode', 'locked'].includes(key)) {
            if (value === null) delete next.definition[key]; else next.definition[key] = value;
            if (key === 'locked') next.locked = value;
          } else if (key === 'transform') for (const [field, vector] of Object.entries(value)) next.setupState.transform[field] = {...next.setupState.transform[field], ...vector};
          else if (key === 'camera') next.setupState.camera = cameraOpticsPatch(next.setupState.camera, value);
          else next.setupState[key] = value;
        }
        acceptedControl = next;
      }
      return result;
    } finally {busy = false; refresh();}
  };
  const run = async action => {try {const result = await action(); if (result?.ok !== true) throw rejected(result);} catch (error) {report(error);} finally {refresh();}};
  const allow = (node, field, extra) => {if (node.ariaLabel) node.setAttribute('aria-label', node.ariaLabel); permissions.push({node, field, extra}); return node;};
  const dismiss = () => {panel.dispose(); close();};
  const header = el('div', 'sv3-inspector-heading'); header.append(el('strong', 'sv3-truncate', read().definition.label), button('close', '关闭实体属性', dismiss)); panel.append(header);
  const numbers = (label, fields, value, patch, field, precision = 3) => {
    const group = el('fieldset', 'sv3-inspector-group'); group.append(el('legend', '', label));
    const axes = el('div', 'sv3-fields');
    for (const axis of fields) {
      const row = el('label', 'sv3-field', axis.toUpperCase()), input = el('input'); input.type = 'number'; input.step = 'any'; input.ariaLabel = `${label} ${axis.toUpperCase()}`; input.dataset.field = `${field}.${axis}`;
      allow(input, field);
      bindings.push(bindEntityInspectorNumberField(input, {read: () => value(axis), format: () => formatNumber(value(axis), precision), commit: number => apply(patch(axis, number), field), close: dismiss, onError: report, validate: number => {
        if (field === 'scale' && number === 0) throw Error('缩放不能为零'); return number;
      }}));
      row.append(input); axes.append(row);
    }
    group.append(axes); panel.append(group);
  };
  if (read().setupState) {
    for (const [field, label] of [['position', '位置'], ['rotation', '旋转（°）'], ['scale', '缩放']]) {
      if (field === 'scale' && read().definition.kind === 'camera') continue;
      const rotation = field === 'rotation';
      numbers(label, ['x', 'y', 'z'], axis => read().setupState.transform[field][axis] * (rotation ? 180 / Math.PI : 1), (axis, value) => ({transform: {[field]: {[axis]: value * (rotation ? Math.PI / 180 : 1)}}}), field, rotation ? 1 : 3);
    }
    const visibility = el('label', 'sv3-inspector-row', '可见'), check = el('input'); check.type = 'checkbox'; check.ariaLabel = '可见'; allow(check, 'visible');
    refreshers.push(() => {check.checked = read().setupState.visible;});
    check.addEventListener('change', () => void run(() => apply({visible: check.checked}, 'visible'))); visibility.append(check); panel.append(visibility);
  }
  const colors = el('fieldset', 'sv3-inspector-group'); colors.append(el('legend', '', '颜色')); const palette = el('div', 'sv3-inspector-palette');
  const colorButton = (label, color, id) => {
    const item = button(null, label, () => void run(() => apply({color}, 'color')), {className: 'sv3-inspector-swatch'}); item.dataset.color = id;
    if (color) {const swatch = el('span'); swatch.style.backgroundColor = color; swatch.setAttribute('aria-hidden', 'true'); item.append(swatch);}
    else {item.textContent = '默认'; item.dataset.defaultMaterial = 'true';}
    allow(item, 'color'); refreshers.push(() => item.setAttribute('aria-pressed', String(color ? read().definition.color?.toLowerCase() === color.toLowerCase() : !read().definition.color))); palette.append(item);
  };
  if (read().definition.kind === 'prop') colorButton('默认材质', null, 'default');
  for (const option of ENTITY_COLOR_OPTIONS) colorButton(option.label, option.color, option.id);
  colors.append(palette); panel.append(colors);
  if (read().definition.kind === 'prop') {
    const material = el('label', 'sv3-inspector-row', '材质'), select = el('select'); select.ariaLabel = '材质';
    for (const [value, label] of [['source', '原材质'], ['clay', '白模']]) {const option = el('option', '', label); option.value = value; select.append(option);}
    allow(select, 'materialMode'); refreshers.push(() => {select.value = read().definition.materialMode || 'source';});
    select.addEventListener('change', () => void run(() => apply({materialMode: select.value}, 'materialMode'))); material.append(select); panel.append(material);
  }
  if (read().definition.kind === 'actor' && read().definition.asset?.sourceUrl === '/assets/studio/character.glb' && read().setupState) {
    const poses = el('fieldset', 'sv3-inspector-group'); poses.append(el('legend', '', '人物姿态')); const status = el('div', 'sv3-inspector-note', '正在读取人物姿态…'); poses.append(status);
    for (const group of ['站坐与低位', '躺卧']) {
      poses.append(el('div', 'sv3-inspector-group-label', group)); const grid = el('div', 'sv3-inspector-poses');
      for (const option of CHARACTER_POSE_OPTIONS.filter(item => item.group === group)) {
        const item = button(null, option.label, () => void run(() => apply({pose: option.clipName}, 'pose')), {text: option.label, className: 'sv3-menu-row'}); item.dataset.pose = option.id; item.dataset.clip = option.clipName;
        allow(item, 'pose', () => !poseReady); refreshers.push(() => item.setAttribute('aria-pressed', String([option.id, option.clipName].includes(read().setupState.pose) || option.id === 'stand' && !read().setupState.pose))); grid.append(item);
      }
      poses.append(grid);
    }
    panel.append(poses);
    // The optional injected loader is for local tests. This URL is bundled data.
    panel.ready = Promise.resolve().then(async () => {
      const response = await fetchAsset('/assets/studio/character.glb', {signal: abort.signal});
      if (!response.ok) throw Error('人物姿态模型读取失败');
      readCharacterPoseOptions(await response.arrayBuffer());
      if (disposed) return false;
      poseReady = true; status.remove(); refresh(); return true;
    }).catch(error => {if (!disposed) {status.textContent = '人物姿态读取失败'; report(error);} return false;});
  } else panel.ready = Promise.resolve(true);
  if (read().definition.kind === 'camera' && read().setupState) {
    const optics = () => normalizeCameraOptics(read().setupState.camera);
    const camera = el('fieldset', 'sv3-inspector-group'); camera.append(el('legend', '', '镜头')); panel.append(camera);
    const scalar = (label, field, readValue, patch, presets) => {
      const wrapper = el('label', 'sv3-inspector-row', label), input = el('input'); input.type = 'number'; input.step = 'any'; input.ariaLabel = label; input.dataset.field = `camera.${field}`; allow(input, 'camera');
      bindings.push(bindEntityInspectorNumberField(input, {read: readValue, format: () => readValue() === null ? '' : formatNumber(readValue()), commit: value => apply({camera: patch(value)}, 'camera'), close: dismiss, onError: report,
        validate: value => {if (value <= 0 || field === 'fov' && value >= 180) throw Error(field === 'fov' ? '视场角必须大于 0° 且小于 180°' : `${label}必须大于 0`); return value;}
      })); wrapper.append(input);
      if (presets) {
        const select = el('select'); select.ariaLabel = `${label}预设`; allow(select, 'camera');
        const custom = el('option', '', '自定义'); custom.value = ''; select.append(custom);
        for (const value of presets) {const option = el('option', '', String(value)); option.value = String(value); select.append(option);}
        refreshers.push(() => {select.value = presets.includes(readValue()) ? String(readValue()) : '';});
        select.addEventListener('change', () => {if (select.value) void run(() => apply({camera: patch(Number(select.value))}, 'camera'));}); wrapper.append(select);
      }
      camera.append(wrapper); return input;
    };
    scalar('焦距（mm）', 'focalLength', () => optics().focalLength, value => ({focalLength: value}), FOCAL_LENGTH_PRESETS);
    scalar('视场角（°）', 'fov', () => optics().fov, value => ({fov: value}));
    const ratioRow = el('label', 'sv3-inspector-row', '画幅比例'), ratio = el('select'); ratio.ariaLabel = '画幅比例'; allow(ratio, 'camera');
    const custom = el('option', '', '自定义'); custom.value = ''; ratio.append(custom);
    for (const item of FRAME_ASPECT_RATIO_OPTIONS) {const option = el('option', '', item.label); option.value = item.value === null ? 'null' : String(item.value); ratio.append(option);}
    refreshers.push(() => {ratio.value = optics().frameAspectRatio === null ? 'null' : String(optics().frameAspectRatio);});
    ratio.addEventListener('change', () => {if (ratio.value) void run(() => apply({camera: {frameAspectRatio: ratio.value === 'null' ? null : Number(ratio.value)}}, 'camera'));}); ratioRow.append(ratio); camera.append(ratioRow);
    const aperture = scalar('光圈（f/）', 'apertureFNumber', () => optics().apertureFNumber, value => ({apertureFNumber: value, depthOfFieldMode: 'aperture'}), APERTURE_PRESETS);
    const deep = button(null, '全景深', () => void run(() => apply({camera: {depthOfFieldMode: 'deepFocus'}}, 'camera')), {text: '全景深', className: 'sv3-menu-row'}); allow(deep, 'camera'); refreshers.push(() => {deep.setAttribute('aria-pressed', String(optics().depthOfFieldMode === 'deepFocus')); aperture.dataset.deepFocus = String(optics().depthOfFieldMode === 'deepFocus');}); camera.append(deep);
    const focusDistance = scalar('对焦距离（m）', 'focusDistance', () => optics().focus?.mode === 'distance' ? optics().focus.distance : optics().focusDistance, value => ({focus: {mode: 'distance', distance: value}, focusDistance: value})); focusDistance.placeholder = '点选焦点';
    const focusState = el('div', 'sv3-inspector-note'); refreshers.push(() => {const focus = optics().focus; focusState.hidden = focus?.mode !== 'point'; focusState.textContent = focus?.mode === 'point' ? '当前按场景中的点对焦；编辑距离将切换到距离对焦。' : '';}); camera.append(focusState);
    if (onPickFocus) {const pick = button('focus', '点选对焦', () => void run(async () => {const target = await onPickFocus({entityId, setupId}); return target ? apply({camera: {focus: {mode: 'point', target}}}, 'camera') : {ok: true};}), {text: '点选对焦', className: 'sv3-menu-row'}); allow(pick, 'camera'); camera.append(pick);}
    if (!depthOfFieldRendered) camera.append(el('div', 'sv3-inspector-note', '光圈与对焦参数会保存；当前本地渲染尚未显示景深虚化。'));
  }
  if (read().baselineReadOnly) {
    panel.append(el('div', 'sv3-inspector-note', '此实体属于场景基准，位置、姿态、可见性与镜头参数需在场景基准编辑。'));
    if (onEditBaseline) {const edit = button('settings', '前往场景基准编辑', () => {dismiss(); onEditBaseline(acceptedControl.ownerSetupId);}, {text: '前往场景基准编辑', className: 'sv3-menu-row'}); edit.setAttribute('aria-label', '前往场景基准编辑'); panel.append(edit);}
  } else if (read().locked) panel.append(el('div', 'sv3-inspector-note', '实体已锁定，移动、旋转、缩放、姿态与镜头参数不可编辑。'));
  panel.addEventListener('keydown', event => {if (event.key === 'Escape' && !ime(event)) {event.preventDefault(); event.stopPropagation(); dismiss();}});
  panel.dispose = () => {if (disposed) return; disposed = true; abort.abort(); for (const binding of bindings) binding.dispose();};
  panel.refresh = refresh;
  refresh(); return panel;
}
