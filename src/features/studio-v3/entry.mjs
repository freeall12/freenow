import {createStudioSession} from './session.mjs';
import {createStudioV3Runtime} from './runtime.mjs';
import {sourceSnapshot, readSourceResource} from './source.mjs';
import {createIndependentSetup, baselineId, assertState} from './schema.mjs';
import {addSetup, setActiveSetup, renderSetup} from './world-space.mjs';
import {reduceEntityAction, resolveEntityControl} from './entity-actions.mjs';
import {createMenus} from './menus.mjs';
import {el, button, renameInput} from './dom.mjs';
import {studioLibrary} from '../../../studio-library-data.mjs';
import {createEntityInspector} from './entity-inspector.mjs';
import {cloneIndependentSetup, removeIndependentSetup} from './setup-actions.mjs';
import {resolveDropPlacement} from './drop-placement.mjs';
import {cameraAtSurface, cameraFromCurrentView} from './camera-create.mjs';
import {createControlHUD} from './control-hud.mjs';
import {createViewfinderOptics} from './viewfinder-optics.mjs';
import {createCameraControlHUD, createCameraShutter} from './camera-control-hud.mjs';
import {createCameraCapture} from './camera-capture.mjs';
import {createCameraHistoryAdapter} from './camera-history-adapter.mjs';
import {listCameraShots, reduceCameraShotAction} from './camera-shots.mjs';
import {createCameraManager} from './camera-manager.mjs';
import {createCameraShotPreview} from './camera-shot-preview.mjs';
import {createCameraShotExporter} from './camera-shot-export.mjs';
import {createCameraBatchPublish} from './camera-batch-publish.mjs';

for (const name of ['official-layout.css', 'styles.css']) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL(name, import.meta.url); document.head.append(link);
}
let active = null;
export const current = () => active;

export async function open(node) {
  if (active?.nodeId === node.id) {if(active.initializationError)throw active.initializationError;return active;}
  if (active) await active.close();
  const app = window.CanvasApp, returnFocus = document.activeElement;
  const root = el('section', 'studio-v3 sv3-workspace'); root.ariaLabel = '导演片场'; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.dataset.keyboardScope = 'local-tool';
  const canvas = el('canvas', 'sv3-render'); canvas.tabIndex = 0; canvas.ariaLabel = '3D 场景：拖动旋转，滚轮缩放，点击选择实体';
  const previewFrame = el('div', 'sv3-frame'); previewFrame.hidden = true; previewFrame.setAttribute('aria-hidden', 'true');
  const top = el('header', 'sv3-topbar'), left = el('div', 'sv3-top-left'), center = el('div', 'sv3-top-center'), right = el('div', 'sv3-top-right');
  const dock = el('footer', 'sv3-dock'), leading = el('div', 'sv3-dock-leading'), middle = el('div', 'sv3-dock-center'), trailing = el('div', 'sv3-dock-trailing'), upper = el('div', 'sv3-dock-upper');
  const toastHost = el('div', 'sv3-dock-toast'), toast = el('div', 'sv3-status'); toast.hidden = true; toast.setAttribute('role', 'status'); toastHost.append(toast);
  const mainActions = el('div', 'sv3-action-cluster'), stateCapsule = el('div', 'sv3-surface'), viewCapsule = el('div', 'sv3-surface');
  top.append(left, center, right); middle.append(mainActions); dock.append(leading, middle, trailing, upper, toastHost); root.append(canvas, previewFrame, top, dock);
  document.body.append(root); document.body.classList.add('studio-active');
  const instance = {nodeId: node.id, version: 3}; active = instance;
  let alive = true, closing = null, session, runtime, observer, lastSync = Promise.resolve(), selected = null, lastLane = 'world', previousIndependent = null, toastTimer, cameraCreation = null, controlHUD, viewfinderOptics = null, cameraHUD = null, cameraCapture, cameraHistory, focusPicking = false;
  const notices = new Map();
  let cameraManager = null, shotPreview = null, shotExporter = null, cameraBatch = null;
  const notice = (message, error = false) => {
    if (!alive) return; clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toast.dataset.error = String(error);
    if (!error) toastTimer = setTimeout(() => {toast.hidden = true;}, 3500);
  };
  const safe = action => async event => {
    if (!alive || closing) return;
    try {await action(event);} catch (error) {notice(error.message, true);}
  };
  const menuController = createMenus({root, onError: error => notice(error.message, true)});
  const menus = {...menuController};
  for (const name of ['toggle', 'openAt', 'openNested']) menus[name] = (...args) => {
    if (!finishControlScope()) return false; cancelCameraCreation(); return menuController[name](...args);
  };
  function finishControlScope() {
    if (cameraBatch?.busy || cameraBatch?.pendingReceipt) {notice(cameraBatch.busy ? '镜头正在导出，请等待完成' : '镜头导出尚未保存，请打开镜头管理重试保存', true); return false;}
    if (cameraCapture?.busy) {notice('镜头正在拍摄，请等待照片保存后继续', true); return false;}
    if (cameraCapture?.pendingReceipt) {notice('照片尚未保存，请点击拍摄按钮或顶部保存状态重试，再继续操作', true); return false;}
    if ((!runtime?.controlling || runtime.finishControl()) && (!runtime?.possessing || runtime.finishCameraControl())) return true;
    notice('本次操控尚未提交，请先完成或还原后重试', true); return false;
  }
  const state = () => session.getState(), space = () => state().scenePlay.worldSpace;
  const currentSetup = () => space().setups.find(setup => setup.id === space().activeSetupId);
  const groundHeight = () => Number.isFinite(state().scenePlay.environment.ground.y) ? state().scenePlay.environment.ground.y : 0;
  const control = () => selected ? resolveEntityControl(state(), {entityId: selected}) : null;
  const row = (name, label, action, options = {}) => button(name, label, safe(action), {className: 'sv3-menu-row', text: label, ...options});
  const menu = (label, rows) => {const list = el('div'); list.ariaLabel = label; list.append(...rows); return list;};
  const select = id => {
    if ((cameraCapture?.busy || cameraCapture?.pendingReceipt) && !finishControlScope()) return false;
    selected = runtime.selectEntity(id); refresh();window.AgentUI?.refreshSceneContext?.(); return true;
  };
  const updatePreviewFrame = () => {
    const rect = runtime?.cameraPreviewRect; previewFrame.hidden = !rect;
    if (rect) Object.assign(previewFrame.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
  };
  const updateModeChrome = () => {
    if (!runtime || !controlHUD) return;
    const possessing = runtime.possessing, special = !!runtime.controlling || !!cameraCreation || !!possessing;
    if (possessing && !cameraHUD) {
      cameraHUD = createCameraControlHUD({read: () => {const camera = runtime.possessing?.camera; return camera?.focus?.mode === 'point' || camera?.focus?.mode === 'object' ? {...camera, focusDistance: runtime.sparkDepthOfFieldParameters().focalDistance} : camera;}, getBusy: () => !!cameraCapture?.busy, getPendingCapture: () => !!cameraCapture?.pendingReceipt, apply: patch => runtime.patchCameraControl(patch), capture: captureCamera, cancel: () => runtime.cancelCameraControl(), finish: () => runtime.finishCameraControl(), onError: error => notice(error.message, true), toggleFocusPicking: () => {if (cameraCapture?.busy || cameraCapture?.pendingReceipt) return false; focusPicking = !focusPicking; updateModeChrome(); return true;}, getFocusPicking: () => focusPicking, getDepthOfFieldSupported: () => runtime.depthOfFieldSupported});
      middle.append(cameraHUD);
    } else if (!possessing && cameraHUD) {focusPicking = false; cameraHUD.dispose(); cameraHUD.remove(); cameraHUD = null;}
    cameraHUD?.refresh();
    stateCapsule.hidden = special; viewCapsule.hidden = special; mainActions.hidden = special;
    selectionTools.hidden = special || !selected; controlHUD.hidden = !runtime.controlling; cameraCreateTools.hidden = !cameraCreation;
    controlHUD.refresh(); root.dataset.cameraPlacement = String(cameraCreation?.kind === 'ground' || focusPicking);
    viewfinderOptics?.refresh();
    for (const node of [cancelCreate, confirmCreate]) node.disabled = !!cameraCapture?.busy || !!cameraCapture?.pendingReceipt;
    for (const node of [creationCapture, previewCapture]) {node.disabled = !!cameraCapture?.busy; node.title = cameraCapture?.pendingReceipt ? '重试保存照片' : '将当前画面拍成照片';}
    creationLabel.textContent = cameraCreation?.kind === 'view' ? '调整取景后确认添加摄像机' : '选择地面位置'; confirmCreate.hidden = cameraCreation?.kind !== 'view';
  };
  const sync = (strict = false) => {
    if (!runtime || !session || !alive) return;
    const pending = runtime.sync(state()).then(() => {
      if (!alive || active !== instance || !session.isCurrent()) throw Error('导演片场会话已变化');
      runtime.selectEntity(selected); refresh();
    });
    lastSync = strict === true ? pending : pending.catch(error => notice(error.message, true));
    refresh(); return lastSync;
  };
  const change = (reducer, label, lane = 'world', content = true) => {
    const changed = session.change(reducer, {label, lane, scope: {kind: 'world-space'}, content});
    if (changed) lastLane = lane; return changed;
  };
  const entityAction = async action => {
    if (!finishControlScope()) return {ok: false, changed: false, message: '本次操控尚未提交'};
    runtime?.cancelTransform();
    const result = reduceEntityAction(state(), action);
    if (!result.ok) {notice(result.message, true); return result;}
    if (result.changed) {change(() => result.state, '实体编辑', result.lane); await lastSync;}
    if (action.type === 'remove') select(null); else if (result.entityId) select(result.entityId);
    return result;
  };
  const dropSelected = async id => {
    runtime.cancelTransform();
    await lastSync;
    const c = resolveEntityControl(state(), {entityId: id}), graph = runtime.graph;
    const meshes = [graph.worldRoot, ...[...graph.entities.values()].filter(record => record.id !== id && record.status === 'ready').map(record => record.root)];
    const result = resolveDropPlacement({kind: c.definition.kind, object: runtime.entityObject(id), transform: c.setupState?.transform, meshes, groundY: groundHeight()});
    if (!result) return {ok: false};
    return entityAction({type: 'update', entityId: id, patch: {transform: result.transform}});
  };
  const addEntity = async (kind, assetId) => {
    if (!finishControlScope()) return {ok: false};
    menus.close(); runtime.cancelTransform();
    const id = crypto.randomUUID(), target = runtime.controls.target;
    const action = {type: 'create', kind, id, transform: {position: {x: target.x, y: groundHeight() + (kind === 'camera' ? 1.6 : 0), z: target.z}}};
    if (kind === 'actor') action.roleId = crypto.randomUUID();
    if (assetId) action.assetId = assetId;
    const result = await entityAction(action); if (result.ok) runtime.focusEntity(id); return result;
  };
  function cancelCameraCreation({restoreFocus = false} = {}) {
    if (!cameraCreation || cameraCapture?.busy || cameraCapture?.pendingReceipt) return false;
    const viewfinder = cameraCreation.kind === 'view'; cameraCreation = null;
    viewfinderOptics?.dispose(); viewfinderOptics?.remove(); viewfinderOptics = null;
    if (viewfinder) runtime?.endViewfinder(); updateModeChrome(); updatePreviewFrame();
    if (restoreFocus) cameraButton.focus({preventScroll: true}); return true;
  }
  const cameraCreationAllowed = () => currentSetup().kind === 'independent' && !space().temporalPlaybackPlaying && !space().temporalPlayheadScrubbing;
  const createCamera = async (point) => {
    if (!cameraCreationAllowed()) throw Error('请先选择独立状态，并停止播放后添加摄像机');
    const pose = point ? cameraAtSurface({point, visibleCamera: runtime.getVisibleCameraState()}) : cameraFromCurrentView(runtime.getVisibleCameraState());
    const result = await entityAction({type: 'create', kind: 'camera', id: crypto.randomUUID(), ...pose});
    if (result.ok) {cancelCameraCreation(); select(result.entityId);} return result;
  };
  const beginCameraCreation = async kind => {
    if (!cameraCreationAllowed()) throw Error('请先选择独立状态，并停止播放后添加摄像机');
    if (!finishControlScope()) return; menus.close({all: true}); runtime.cancelTransform(); await lastSync;
    cancelCameraCreation();
    if (kind === 'view') {
      if (!runtime.beginViewfinder()) throw Error('当前取景器不可用，请稍后重试');
      viewfinderOptics = createViewfinderOptics({read: () => runtime.getVisibleCameraState(), apply: patch => runtime.patchViewfinder(patch), onError: error => notice(error.message, true), close: () => cancelCameraCreation({restoreFocus: true})});
      cameraCreateTools.prepend(viewfinderOptics);
    } else if (runtime.view === 'camera') runtime.clearCameraPreview();
    cameraCreation = {kind, setupId: currentSetup().id}; updateModeChrome(); updatePreviewFrame(); canvas.focus({preventScroll: true});
  };
  const cameraMenuContent = point => menu('添加摄像机', [
    row('camera', point ? '放置在此处' : '选择地面位置', async () => {menus.close({all: true}); if (point) await createCamera(point); else await beginCameraCreation('ground');}),
    row('camera', '以当前视角添加', () => beginCameraCreation('view'))
  ]);
  async function captureCamera() {
    if (!cameraCapture || !['camera', 'camera-control', 'viewfinder'].includes(runtime.view)) throw Error('请先预览或操控摄像机，再拍摄到画布');
    focusPicking = false;
    try {const result = await cameraCapture.capture(); notice('照片已保存到画布'); return result;}
    catch (error) {error.message = error.applied ? '照片已加入画布，尚未保存；点击拍摄按钮重试同一照片：' + error.message : '拍摄失败，尚未创建照片：' + error.message; notice(error.message, true); throw error;}
  }
  const startSelectedCameraControl = async () => {
    if ((cameraCapture?.busy || cameraCapture?.pendingReceipt) && !finishControlScope()) return; menus.close({all: true}); cancelCameraCreation(); await lastSync;
    if (!selected || !runtime.startCameraControl(selected)) throw Error('请先选择独立状态中的摄像机，并停止播放；含动画关键帧的摄像机暂不支持接管');
    updateModeChrome(); canvas.focus({preventScroll: true});
  };
  const startSelectedControl = async () => {
    if ((cameraCapture?.busy || cameraCapture?.pendingReceipt) && !finishControlScope()) return;
    menus.close({all: true}); cancelCameraCreation(); await lastSync;
    if (!selected || !runtime.startControl(selected)) throw Error('请先选择可编辑且已解锁的角色或道具'); updateModeChrome(); canvas.focus({preventScroll: true});
  };
  const switchSetup = id => {
    if (!finishControlScope()) return; cancelCameraCreation();
    runtime.cancelTransform(); menus.close({all: true}); selected = null;
    if (currentSetup().kind === 'independent') previousIndependent = currentSetup().id;
    change(value => setActiveSetup(value, id), '切换状态', 'world', false);
  };
  const addState = (duplicate = false, sourceId = currentSetup().id) => {
    if (!finishControlScope()) return; cancelCameraCreation();
    runtime.cancelTransform();
    const now = Date.now(), current = currentSetup();
    selected = null;
    if (duplicate) change(value => cloneIndependentSetup(value, sourceId, {createId: () => crypto.randomUUID(), now}), '复制状态');
    else {
      const setup = createIndependentSetup({id: crypto.randomUUID(), stageId: current.stageId, label: `状态 ${space().setups.filter(item => item.kind === 'independent' && item.stageId === current.stageId).length + 1}`, now});
      change(value => addSetup(value, setup, {activate: true}), '新增状态');
    }
    menus.close({all: true});
  };
  const rename = (anchor, value, apply) => {
    menus.close({restoreFocus: false});
    menus.toggle(anchor, ({close}) => {
      const input = renameInput(value, async name => {
        const result = await apply(name); if (result?.ok === false) return false;
        close(); return true;
      }, close, error => notice(error.message, true));
      queueMicrotask(() => {input.focus(); input.select();}); return input;
    }, {label: '重命名'});
  };
  const confirmStateRemoval = (anchor, setup) => menus.openNested(anchor, ({close}) => {
    const panel = el('div', 'sv3-state-confirm');
    panel.append(el('strong', '', `删除“${setup.label}”？`), el('p', '', '同时删除其中的角色、对象、摄像机和动画'));
    const actions = el('div', 'sv3-confirm-actions');
    actions.append(button(null, '保留状态', () => close(), {text: '保留状态'}), button('delete', '删除状态', safe(() => {
      runtime.cancelTransform();
      change(value => removeIndependentSetup(value, setup.id, {replacementId: crypto.randomUUID()}), '删除状态');
      selected = null; menus.close({all: true}); refresh();
    }), {text: '删除状态'})); panel.append(actions); return panel;
  }, {label: '删除状态确认', placement: 'top', align: 'end', offset: 6, width: 280});
  const showStates = () => menus.toggle(stateButton, () => {
    const list = el('div', 'sv3-state-list');
    for (const setup of space().setups.filter(item => item.stageId === space().activeStageId && item.kind === 'independent')) {
      const group = el('div', 'sv3-state-row');
      const item = row(setup.id === currentSetup().id ? 'check' : null, setup.label, () => switchSetup(setup.id)); item.classList.add('sv3-state-label'); item.dataset.active = String(setup.id === currentSetup().id);
      const actions = el('div', 'sv3-state-actions');
      const copy = button('clone', `复制状态：${setup.label}`, safe(() => addState(true, setup.id)), {className: 'sv3-mini-button'});
      const edit = button('rename', `重命名状态：${setup.label}`, () => rename(stateButton, setup.label, label => change(value => {
        const next = structuredClone(value); next.scenePlay.worldSpace.setups.find(item => item.id === setup.id).label = label; assertState(next); return next;
      }, '状态重命名')), {className: 'sv3-mini-button'});
      const remove = button('delete', `删除状态：${setup.label}`, () => confirmStateRemoval(remove, setup), {className: 'sv3-mini-button'});
      actions.append(copy, edit, remove); group.append(item, actions); list.append(group);
    }
    list.append(row('add', '新增状态', () => addState()), row('settings', '编辑场景基准', () => switchSetup(baselineId(space().activeStageId))));
    return list;
  }, {label: '状态', placement: 'top'});
  const showObjects = anchor => menus.toggle(anchor, () => {
    const list = el('div');
    const ids = new Set(renderSetup(state()).entityStates.map(item => item.entityId));
    for (const entity of space().entities.filter(item => ids.has(item.id))) list.append(row(entity.kind === 'actor' ? 'character' : entity.kind === 'camera' ? 'camera' : 'object', entity.label, () => {select(entity.id); runtime.focusEntity(entity.id); menus.close();}));
    if (!list.children.length) list.append(el('div', 'sv3-empty', '当前状态还没有实体'));
    return list;
  }, {label: '场景实体'});
  const showLibrary = anchor => menus.toggle(anchor, () => {
    const list = el('div', 'sv3-library');
    for (const group of studioLibrary) {
      list.append(el('h3', '', group.label)); const grid = el('div', 'sv3-library-grid');
      for (const asset of group.assets) {
        const item = button(null, `${group.label} · ${asset.id}`, safe(() => addEntity('prop', asset.id)), {className: 'sv3-library-item'});
        const image = el('img'); image.src = '/' + asset.preview; image.alt = ''; image.loading = 'lazy'; item.append(image, el('span', '', asset.id)); grid.append(item);
      }
      list.append(grid);
    }
    return list;
  }, {label: '道具库', width: 490});
  const showInspector = anchor => menus.toggle(anchor, ({close}) => createEntityInspector({
    control, applyAction: entityAction, onError: error => notice(error.message, true), close,
    onEditBaseline: () => switchSetup(control().ownerSetupId), depthOfFieldRendered: runtime.depthOfFieldSupported
  }), {label: '实体属性', width: 440});
  const removeSelected = () => selected && entityAction({type: 'remove', entityId: selected, mode: 'local'});
  const shotAction = async (shot, type, title) => {
    if (!finishControlScope()) return {ok: false}; runtime.cancelTransform();
    const result = reduceCameraShotAction(state(), {type, shotId: shot.id, ...(title === undefined ? {} : {title})});
    if (!result.ok) throw Error(result.message);
    if (result.changed) {change(() => result.state, type === 'rename' ? '镜头重命名' : '删除镜头', result.lane); await lastSync;}
    if (type === 'remove' && selected === result.entityId) {selected = null; runtime.selectEntity(null);}
    refresh(); return {ok: true};
  };
  const openShot = async shot => {
    if (!finishControlScope()) return {ok: false};
    const id = shot.cameraEntityId, definition = space().entities.find(entity => entity.id === id && entity.kind === 'camera');
    if (!definition) throw Error(`镜头“${shot.title}”缺少有效的摄像机链接`);
    cancelCameraCreation(); menus.close({all: true}); runtime.cancelTransform();
    if (shot.setupId !== space().activeSetupId) {change(value => setActiveSetup(value, shot.setupId), '切换镜头状态', 'world', false); await lastSync;}
    selected = id; runtime.selectEntity(id);
    if (!runtime.startCameraControl(id)) throw Error('此摄像机暂不可操控，请检查所属状态或时间轨道');
    refresh(); canvas.focus({preventScroll: true}); return {ok: true};
  };
  const showCameraManager = () => {
    if (!cameraBatch?.pendingReceipt && !cameraBatch?.busy && !finishControlScope()) return;
    if (currentSetup().kind === 'scene-baseline') return;
    cancelCameraCreation();
    menuController.toggle(cameraManagerButton, ({close}) => {
      const panel = createCameraManager({close, onError: error => notice(error.message, true),
        read: () => ({shots: listCameraShots(state()).map(shot => ({...shot, cameraId: shot.cameraEntityId, thumbnailRevision: session.getFence().editEpoch})),
          setupLabels: Object.fromEntries(space().setups.map(setup => [setup.id, setup.label])),
          readOnly: currentSetup().kind === 'scene-baseline', busy: !!cameraBatch?.busy,
          playing: !!space().temporalPlaybackPlaying, activeCameraId: runtime.possessing?.entityId ?? selected,
          pendingExportShotIds: cameraBatch?.pendingReceipt?.shotIds || []}),
        openShot, renameShot: (shot, title) => shotAction(shot, 'rename', title), removeShot: shot => shotAction(shot, 'remove'),
        loadThumbnail: (shot, {signal}) => shotPreview.request(shot, {signal, isCurrent: () => alive && session.isCurrent()}),
        exportShots: async shots => {const result = await cameraBatch.export(shots); notice(result.errorCount ? `已导出 ${result.successCount} 个镜头，${result.errorCount} 个失败` : '镜头已导出到画布'); return result;}});
      cameraManager = panel;
      const dispose = panel.dispose; panel.dispose = () => {dispose(); if (cameraManager === panel) cameraManager = null;}; return panel;
    }, {label: '镜头管理', role: 'presentation', width: 560, placement: 'top', align: 'end', offset: 12});
  };
  const showEntityMenu = (point, anchor) => {
    const c = control(); if (!c) return;
    const list = ({close}) => {
      const content = el('div', 'sv3-entity-menu'), nameRow = el('label', 'sv3-entity-name', '名称'), name = el('input', 'sv3-rename-input');
      name.ariaLabel = '名称'; name.value = c.definition.label; name.maxLength = 120; nameRow.append(name); content.append(nameRow, el('div', 'sv3-menu-divider'));
      let accepted = c.definition.label, skipBlur = false, disposed = false, pending = false;
      content.dispose = () => {disposed = true;};
      name.addEventListener('keydown', event => {
        event.stopPropagation(); if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {event.preventDefault(); name.blur();}
        if (event.key === 'Escape') {event.preventDefault(); skipBlur = true; name.value = accepted; name.blur();}
      });
      name.addEventListener('blur', safe(async () => {
        if (skipBlur) {skipBlur = false; return;}
        if (disposed || pending) return;
        const label = name.value.trim(); if (!label || label === accepted) {name.value = accepted; return;}
        pending = true; name.readOnly = true;
        try {const result = await entityAction({type: 'update', entityId: c.definition.id, patch: {label}}); if (result.ok) accepted = label;}
        finally {pending = false; name.readOnly = false; name.value = accepted;}
      }));
      const actionRow = (icon, label, action, shortcut) => {
        const item = row(icon, label, async () => {close(); await action();});
        if (shortcut) item.append(el('span', 'sv3-menu-shortcut', shortcut)); content.append(item); return item;
      };
      if (c.definition.kind === 'camera') {
        const start = actionRow('camera', '操控摄像机', startSelectedCameraControl); start.disabled = c.baselineReadOnly || c.animated;
      } else {
        actionRow('focus', '聚焦', () => runtime.focusEntity(c.definition.id), 'F');
        const start = actionRow('controls', c.definition.kind === 'actor' ? '操控角色' : '操控', startSelectedControl, 'C');
        start.disabled = c.locked || c.baselineReadOnly;
        actionRow('dropGround', '落到地面', () => dropSelected(c.definition.id), 'G');
      }
      actionRow('reset', '恢复初始摆放', () => entityAction({type: 'restore-placement', entityId: c.definition.id}));
      content.append(el('div', 'sv3-menu-divider'));
      actionRow('clone', '复制', () => entityAction({type: 'clone', entityId: c.definition.id, newId: crypto.randomUUID()}));
      if (c.canToggleLock) {
        const lock = actionRow(c.locked ? 'unlock' : 'lock', c.locked ? '解锁' : '锁定', () => entityAction({type: 'update', entityId: c.definition.id, patch: {locked: !c.locked}}), c.lockDisabled ? null : 'L');
        lock.disabled = c.lockDisabled; if (c.lockDisabled) content.append(el('div', 'sv3-menu-description', '有动画的对象不能锁定'));
      }
      content.append(el('div', 'sv3-menu-divider'));
      actionRow('delete', '从场景移除', () => entityAction({type: 'remove', entityId: c.definition.id, mode: 'local'}), 'Del / ⌫').dataset.destructive = 'true';
      return content;
    };
    if (point) menus.openAt(point, list, {label: '实体操作'}); else menus.toggle(anchor, list, {label: '实体操作', placement: 'top'});
  };
  const back = button('back', '返回画布', safe(() => instance.close())); const home = button('restoreHome', '恢复初始视图', safe(() => {if (!finishControlScope()) return; cancelCameraCreation(); if (runtime.setView('orbit') === false) return; runtime.controls.target.set(0, 1, 0); runtime.orbitCamera.position.set(7, 6, 9); runtime.orbitCamera.lookAt(runtime.controls.target); runtime.controls.update(); runtime.render(); refresh();}));
  const help = button('controls', '控制说明', () => menus.toggle(help, () => el('div', 'sv3-controls-help', '拖动鼠标旋转视角；右键拖动平移；滚轮缩放。点击实体后可移动、旋转、缩放。F 聚焦，Esc 取消当前编辑，⌘/Ctrl Z 撤销。'), {label: '控制说明', placement: 'bottom'}));
  const topSurface = el('div', 'sv3-surface'); topSurface.append(back, home, help); left.append(topSurface);
  const wordmark = el('div', 'sv3-wordmark'), logo = el('img'); logo.src = '/assets/branding/freenow-mark.svg'; logo.alt = 'freenow'; wordmark.append(logo); center.append(wordmark);
  const saveStatus = button(null, '保存状态', safe(async() => {
    if (cameraBatch?.pendingReceipt) {await cameraBatch.export(); notice('镜头已保存到画布'); return;}
    if (cameraCapture?.pendingReceipt) {await captureCamera(); return;}
    if (instance.initializationError) {
      const result = await session.flush();
      if (!result.ok || session.getStatus().dirty) throw Error('当前修改尚未保存，请重试');
      notice('修改已保存，请返回画布后重新打开片场');
    } else {await instance.prepareAgentContext(); notice('片场已保存');}
  }), {text: '已保存'}), saveSurface = el('div', 'sv3-surface'); saveSurface.append(saveStatus); right.append(saveSurface);
  const stateButton = button('onSet', '状态', showStates, {text: '状态 1'}); stateButton.classList.add('sv3-state-trigger'); stateCapsule.append(stateButton); leading.append(stateCapsule);
  const leaveBaseline = button('exitBaseline', '退出场景基准', safe(() => switchSetup(previousIndependent && space().setups.some(item => item.id === previousIndependent) ? previousIndependent : space().setups.find(item => item.stageId === space().activeStageId && item.kind === 'independent').id)), {text: '退出基准'}); stateCapsule.append(leaveBaseline);
  const tools = el('div', 'sv3-capsule sv3-actions');
  const objectList = button('object', '选择实体', () => showObjects(objectList));
  const character = button('character', '添加人物', safe(() => addEntity('actor')));
  const cameraButton = button('camera', '添加摄像机', () => menus.toggle(cameraButton, () => cameraMenuContent(), {label: '添加摄像机', placement: 'top'}));
  const props = button('add', '添加道具', () => showLibrary(props));
  const cameraManagerButton = button('cameraManager', '镜头管理', safe(showCameraManager));
  const undo = button('undo', '撤销', safe(() => replay(false))), redo = button('redo', '重做', safe(() => replay(true)));
  tools.append(objectList, character, cameraButton, props, el('span', 'sv3-separator'), undo, redo); mainActions.append(tools);
  const cameraManagerSurface = el('div', 'sv3-surface'); cameraManagerSurface.append(cameraManagerButton); mainActions.append(cameraManagerSurface);
  const orbit = button('onSet', '3D 视图', safe(() => {if (!finishControlScope()) return; cancelCameraCreation(); runtime.setView('orbit'); refresh();}), {text: '3D'}), plan = button('topView', '俯视图', safe(() => {if (!finishControlScope()) return; cancelCameraCreation(); runtime.setView('plan'); refresh();}), {text: '俯视图'}); viewCapsule.append(orbit, plan); trailing.append(viewCapsule);
  const selectionTools = el('div', 'sv3-capsule'), selectionButton = button('object', '实体操作', () => showEntityMenu(null, selectionButton), {text: ''}); selectionButton.classList.add('sv3-selection-name');
  const transformButtons = ['translate', 'rotate', 'scale'].map((mode, index) => button(['control', 'rotateRight', 'redistribute'][index], ['移动', '旋转', '缩放'][index], safe(() => {if (!finishControlScope()) return; runtime.attachTransform(selected, mode);}), {text: ['移动', '旋转', '缩放'][index]}));
  const inspectorButton = button('settings', '实体属性', () => showInspector(inspectorButton));
  const cameraPreview = button('camera', '预览摄像机', safe(() => {if (!finishControlScope()) return; runtime.previewCamera(selected); refresh();}));
  const controlButton = button('control', '操控', safe(startSelectedControl), {text: '操控'});
  const cameraControlButton = button('camera', '操控摄像机', safe(startSelectedCameraControl), {text: '操控摄像机'}), previewCapture = createCameraShutter(safe(captureCamera));
  selectionTools.append(selectionButton, controlButton, cameraControlButton, previewCapture, ...transformButtons, inspectorButton, cameraPreview); upper.append(selectionTools);
  controlHUD = createControlHUD({getControl: () => runtime?.controlling, drop: () => runtime.dropControlToGround(), moveDown: () => runtime.nudgeControlHeight('down'), moveUp: () => runtime.nudgeControlHeight('up'), setHeading: value => runtime.setControlHeading(value), cancel: () => runtime.cancelControl('restore'), finish: () => runtime.finishControl(), onError: error => notice(error.message, true)});
  controlHUD.hidden = true; middle.append(controlHUD);
  const cameraCreateTools = el('div', 'sv3-surface sv3-camera-create'); cameraCreateTools.hidden = true;
  const creationLabel = el('span', 'sv3-creation-label'), cancelCreate = button('close', '退出摄像机创建', () => cancelCameraCreation({restoreFocus: true}), {text: '退出'}), confirmCreate = button('check', '确认当前视角', safe(() => createCamera()), {text: '完成'});
  const creationCapture = createCameraShutter(safe(captureCamera));
  cameraCreateTools.append(creationLabel, creationCapture, cancelCreate, confirmCreate); middle.append(cameraCreateTools);
  async function replay(redo) {
    if (!finishControlScope()) return {ok: false, reason: 'transaction-active'}; cancelCameraCreation();
    runtime.cancelTransform(); menus.close();
    const result = redo ? session.history.redo(lastLane) : session.history.undo(lastLane);
    if (!result.ok && result.reason !== 'empty') notice('此操作与其他状态的较新修改冲突，无法撤销。', true); await lastSync;return result;
  }
  function refresh() {
    if (!session || !runtime || !alive) return;
    const status = session.getStatus(), setup = currentSetup();
    cameraManagerButton.hidden = setup.kind === 'scene-baseline'; cameraManager?.refresh();
    cameraButton.disabled = setup.kind === 'scene-baseline'; cameraButton.title = cameraButton.disabled ? '请先选择或新建独立状态，再添加摄像机。' : '添加摄像机';
    stateButton.querySelector('span').textContent = setup.label; leaveBaseline.hidden = setup.kind !== 'scene-baseline';
    const editing = !!session.history.getActiveTransaction();
    saveStatus.textContent = cameraBatch?.pendingReceipt ? '镜头导出未保存 · 重试' : cameraCapture?.pendingReceipt ? '照片保存失败 · 重试' : editing ? '编辑中' : status.status === 'failed' ? '保存失败 · 重试' : status.status === 'saving' ? '保存中' : status.dirty ? '待保存' : '已保存'; saveStatus.disabled = editing || status.status === 'saving' || !!cameraCapture?.busy || !!cameraBatch?.busy;
    orbit.dataset.active = String(runtime.view === 'orbit'); plan.dataset.active = String(runtime.view === 'plan');
    updatePreviewFrame();
    if (selected && !renderSetup(state()).entityStates.some(item => item.entityId === selected)) selected = null;
    selectionTools.hidden = !selected;
    const c = control(); cameraControlButton.hidden = !c || c.definition.kind !== 'camera'; cameraControlButton.disabled = !c || c.baselineReadOnly || c.animated; previewCapture.hidden = runtime.view !== 'camera'; creationCapture.hidden = cameraCreation?.kind !== 'view'; cameraPreview.hidden = !c || c.definition.kind !== 'camera';
    controlButton.hidden = !c || c.definition.kind === 'camera'; controlButton.disabled = !c || c.locked || c.baselineReadOnly;
    if (cameraCreation?.setupId !== undefined && cameraCreation.setupId !== setup.id) cancelCameraCreation();
    creationLabel.textContent = cameraCreation?.kind === 'view' ? '调整取景后确认添加摄像机' : '选择地面位置'; confirmCreate.hidden = cameraCreation?.kind !== 'view';
    if (c) {selectionButton.textContent = c.definition.label; for (const [index, item] of transformButtons.entries()) {item.hidden = index === 2 && c.definition.kind === 'camera'; item.disabled = c.locked || c.baselineReadOnly || runtime.view === 'camera';}}
    updateModeChrome();
    undo.disabled = !session.history.getUndoAvailability(lastLane).ok; redo.disabled = !session.history.getRedoAvailability(lastLane).ok;
  }
  instance.read = () => {
    const snapshot=state(),local=new Map(renderSetup(snapshot).entityStates.map(item=>[item.entityId,item]));
    const objects=snapshot.scenePlay.worldSpace.entities.filter(item=>local.has(item.id)).map(item=>{
      const transform=local.get(item.id).transform,vector=value=>[value.x,value.y,value.z];
      return {id:item.id,kind:item.kind,name:item.label,locked:!!item.locked,position:vector(transform.position),rotation:vector(transform.rotation),scale:vector(transform.scale)};
    });
    return {version: 3, nodeId: node.id, capabilities: instance.initializationError?[]:['read', 'select', 'undo'], units: {position: 'meters', rotation: 'radians', time: 'milliseconds'}, state: snapshot, objects, selectedId:selected, selectedEntityId:selected, persistence: session.getStatus(),...(instance.initializationError?{error:instance.initializationError.message}: {})};
  };
  instance.prepareAgentContext=async()=>{
    if(instance.initializationError)throw instance.initializationError;
    if(!alive||closing||!session.isCurrent())throw Error('导演片场会话不可用');
    const result=await session.flush();
    if(!result.ok||session.history.getActiveTransaction())throw Error('请先完成或取消当前片场编辑，再保存或交给 Agent');
    if(!alive||!session.isCurrent())throw Error('导演片场会话已变化');return instance.read();
  };
  instance.execute = async (action, args = {}) => {
    if (action === 'read') return instance.read();
    if(instance.initializationError)throw instance.initializationError;
    if(!alive||closing||!session.isCurrent())throw Error('导演片场会话不可用');
    if (action === 'select') {if (args.id && !renderSetup(state()).entityStates.some(item => item.entityId === args.id)) throw Error('实体不在当前状态'); if (!select(args.id || null)) throw Error(cameraCapture?.busy ? '镜头正在拍摄，请等待照片保存后继续' : '照片尚未保存，请点击拍摄按钮或顶部保存状态重试，再继续操作'); return {selected: selected};}
    if (action === 'undo') {const result=await replay(false);if(!result.ok)throw Error(result.reason==='empty'?'当前通道没有可撤销的操作':'撤销被拒绝：'+result.reason);return instance.prepareAgentContext();}
    throw Error('导演片场尚未接入此 Agent 操作，请读取 scene_read.capabilities：' + action);
  };
  instance.close = async () => {
    if (!alive || active !== instance) return;
    if (closing) return closing;
    closing = (async () => {
      if (!finishControlScope()) throw Error(cameraBatch?.busy ? '镜头正在导出，请等待完成' : cameraBatch?.pendingReceipt ? '镜头导出尚未保存，请打开镜头管理重试保存' : cameraCapture?.busy ? '镜头正在拍摄，请等待照片保存后继续' : cameraCapture?.pendingReceipt ? '照片尚未保存，请点击拍摄按钮或顶部保存状态重试，再继续操作' : '请先完成或还原本次操控'); cancelCameraCreation(); runtime?.cancelTransform(); menus.close({all: true}); await session.closeGuard();
      alive = false; clearTimeout(toastTimer); observer?.disconnect(); controlHUD.dispose(); cameraHUD?.dispose(); cameraCapture?.dispose(); cameraBatch?.dispose(); shotExporter?.dispose(); await shotPreview?.dispose(); cameraHistory?.dispose(); menus.dispose(); await runtime?.dispose();
      root.remove(); document.body.classList.remove('studio-active'); active = null;
      app.select(node.id, false); const target = returnFocus?.isConnected ? returnFocus : document.querySelector('#canvas'); target?.focus({preventScroll: true}); window.AgentUI?.refreshSceneContext?.();
    })();
    try {await closing;} finally {closing = null;}
  };
  try {
    session = createStudioSession({nodeId: node.id, app, store: window.CanvasStore, getSourceSnapshot: sourceSnapshot,
      isCurrentSession: () => alive && active === instance, publishNode: (id, patch, options) => app.publishStudioV3(id, patch, options),
      onChange: sync, onStatus: status => {refresh(); if (status.error) notice('保存失败，修改已保留：' + status.error.message, true);}});
    cameraHistory = createCameraHistoryAdapter({getState: state, history: session.history, onLane: lane => {lastLane = lane;}, onStatus: refresh});
    runtime = createStudioV3Runtime({canvas, getState: state, getSourceResource: () => readSourceResource(app, node.id),
      getFence: () => session.getFence(), isCurrent: () => alive && session.isCurrent(),
      onInvalidate: () => {updatePreviewFrame(); updateModeChrome();},
      onStatus: report => {const key = `${report.kind}:${report.id}`; if (report.status === 'failed') {notices.set(key, report.error); notice(report.error, true);} else if (report.status === 'ready') notices.delete(key);},
      canControlInput: () => !closing && !menus.isOpen() && !cameraCreation && !cameraCapture?.busy && !cameraCapture?.pendingReceipt && !cameraBatch?.busy && !cameraBatch?.pendingReceipt && !focusPicking,
      onCameraEdit: event => cameraHistory.handle(event),
      onControl: event => handleTransform(event, '实体操控'),
      onTransform: event => handleTransform(event, '实体变换')});
    function handleTransform(event, label) {
        if (event.phase === 'begin') {const c = resolveEntityControl(state(), {entityId: event.entityId}); if (!c || c.baselineReadOnly || c.locked) throw Error('请先切换到实体所属状态并解锁'); lastLane = c.stateLane; if (!session.history.begin(lastLane, label, {kind: 'world-space'})) throw Error('请先完成当前编辑');}
        if (event.phase === 'preview') session.history.preview(value => {const result = reduceEntityAction(value, {type: 'update', entityId: event.entityId, patch: {transform: event.transform}}); if (!result.ok) throw Error(result.message); return result.state;});
        if (event.phase === 'commit') session.history.commit();
        if (event.phase === 'cancel' && session.history.getActiveTransaction()) session.history.cancel();
        // Begin and no-op commit need no domain change notification, but the
        // save control must still reflect the active transaction immediately.
        if (event.phase !== 'preview') refresh();
        return true;
    }
    cameraCapture = createCameraCapture({app, session, runtime, nodeId: node.id, onStatus: ({status}) => {refresh(); if (status === 'preparing' || status === 'rendering') notice('正在拍摄当前镜头…');}});
    shotPreview = createCameraShotPreview({getState: state, getSourceResource: () => readSourceResource(app, node.id)});
    shotExporter = createCameraShotExporter({getState: state, getSourceResource: () => readSourceResource(app, node.id), getFence: () => session.getFence(), isCurrent: () => alive && session.isCurrent(),
      onProgress: report => notice(`正在导出镜头… ${Math.round((report.progress || 0) * 100)}%`)});
    cameraBatch = createCameraBatchPublish({app, session, nodeId: node.id, renderer: shotExporter, isCurrent: () => alive && session.isCurrent(), onStatus: refresh});
    instance.session = session; instance.runtime = runtime;
    observer = new ResizeObserver(() => runtime.resize()); observer.observe(root);
    let down;
    canvas.addEventListener('pointerdown', event => {down = {x: event.clientX, y: event.clientY, button: event.button};});
    canvas.addEventListener('pointerup', event => {
      if (!down || down.button !== 0 || runtime.controlling || cameraCapture?.busy || cameraCapture?.pendingReceipt || runtime.capturing || runtime.transformControls.dragging || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      down = null;
      if (runtime.possessing) {
        if (focusPicking) {
          if (runtime.pickCameraFocus(event)) {focusPicking = false; updateModeChrome(); notice('已设置对焦位置');}
          else notice('此处没有可对焦的表面，或修改未被接受；请在画面内重试', true);
        }
        return;
      }
      if (cameraCreation?.kind === 'ground') {const hit = runtime.hitSurface(event); if (hit) safe(() => createCamera(hit.point))(); else notice('此处没有可放置的地面，请选择场景表面', true); return;}
      if (cameraCreation) return;
      const hit = runtime.hitEntity(event); select(hit?.entityId || null);
    });
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault(); if (cameraCreation || runtime.controlling || runtime.possessing || cameraCapture?.busy || cameraCapture?.pendingReceipt) return;
      const hit = runtime.hitEntity(event); if (hit) {select(hit.entityId); showEntityMenu({x: event.clientX, y: event.clientY});}
      else {const surface = runtime.hitSurface(event); if (surface && cameraCreationAllowed()) menus.openAt({x: event.clientX, y: event.clientY}, () => cameraMenuContent(surface.point), {label: '添加摄像机'});}
    });
    root.addEventListener('keydown', event => {
      event.stopPropagation(); if (event.isComposing || event.keyCode === 229 || event.target.closest('input,textarea,select,[contenteditable]')) return;
      if (event.defaultPrevented || menus.isOpen()) return;
      if (runtime.controlling || cameraCapture?.busy || cameraCapture?.pendingReceipt) return;
      if (runtime.possessing) {if (event.key === 'Escape') {event.preventDefault(); if (focusPicking) {focusPicking = false; updateModeChrome();} else if (!runtime.finishCameraControl()) notice('本次镜头编辑尚未提交，请先完成或还原', true);} return;}
      if (cameraCreation) {if (event.key === 'Escape') {event.preventDefault(); if (cameraCreation.kind === 'view') safe(() => createCamera())(); else cancelCameraCreation({restoreFocus: true});} return;}
      if (event.key === 'Escape') {event.preventDefault(); if (menus.isOpen()) menus.close(); else if (runtime.view === 'camera') {runtime.clearCameraPreview(); refresh();} else if (runtime.cancelTransform()) {} else if (selected) select(null); else safe(() => instance.close())();}
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); safe(() => replay(event.shiftKey))();}
      if (event.key.toLowerCase() === 'f' && selected) {event.preventDefault(); runtime.focusEntity(selected);}
      if (event.key.toLowerCase() === 'c' && selected && !event.metaKey && !event.ctrlKey && control()?.definition.kind !== 'camera') {event.preventDefault(); safe(startSelectedControl)();}
      if (event.key.toLowerCase() === 'g' && selected && !event.metaKey && !event.ctrlKey) {event.preventDefault(); safe(() => dropSelected(selected))();}
      if (event.key.toLowerCase() === 'l' && selected && !event.metaKey && !event.ctrlKey) {const c = control(); if (c?.canToggleLock) {event.preventDefault(); safe(() => entityAction({type: 'update', entityId: selected, patch: {locked: !c.locked}}))();}}
      if (['Delete', 'Backspace'].includes(event.key) && selected && !event.metaKey && !event.ctrlKey) {event.preventDefault(); safe(removeSelected)();}
    });
    await sync(true);
    if (!alive || active !== instance || !session.isCurrent()) throw Error('导演片场会话已变化');
    root.focus(); window.AgentUI?.refreshSceneContext?.(); return instance;
  } catch (error) {
    // A newer workspace owns the global shell after an asynchronous handover.
    if (!alive || active !== instance) throw error;
    notice(error.message, true);
    instance.initializationError=error;
    try {if(session)await session.closeGuard();}
    catch(cleanupError){
      for(const item of root.querySelectorAll('button'))item.disabled=true;
      back.disabled=false;saveStatus.disabled=false;
      notice('片场启动失败，保存仍需重试：'+cleanupError.message,true);throw error;
    }
    alive=false;clearTimeout(toastTimer);observer?.disconnect();controlHUD.dispose();cameraHUD?.dispose();cameraCapture?.dispose();cameraHistory?.dispose();menus.dispose();await runtime?.dispose();root.remove();
    if (active === instance) {document.body.classList.remove('studio-active'); active=null;}
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});throw error;
  }
}
