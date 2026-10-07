import {createStudioSession} from './session.mjs';
import {createStudioV3Runtime} from './runtime.mjs';
import {sourceSnapshot, readSourceResource} from './source.mjs';
import {createIndependentSetup, baselineId, assertState} from './schema.mjs';
import {addSetup, setActiveSetup, renderSetup} from './world-space.mjs';
import {reduceEntityAction, resolveEntityControl} from './entity-actions.mjs';
import {createMenus} from './menus.mjs';
import {el, button, renameInput} from './dom.mjs';
import {studioLibrary} from '../../../studio-library-data.mjs';

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
  const top = el('header', 'sv3-topbar'), left = el('div', 'sv3-top-left'), center = el('div', 'sv3-top-center'), right = el('div', 'sv3-top-right');
  const dock = el('footer', 'sv3-dock'), leading = el('div', 'sv3-dock-leading'), middle = el('div', 'sv3-dock-center'), trailing = el('div', 'sv3-dock-trailing'), upper = el('div', 'sv3-dock-upper');
  const toastHost = el('div', 'sv3-dock-toast'), toast = el('div', 'sv3-status'); toast.hidden = true; toast.setAttribute('role', 'status'); toastHost.append(toast);
  const mainActions = el('div', 'sv3-action-cluster'), stateCapsule = el('div', 'sv3-surface'), viewCapsule = el('div', 'sv3-surface');
  top.append(left, center, right); middle.append(mainActions); dock.append(leading, middle, trailing, upper, toastHost); root.append(canvas, top, dock);
  document.body.append(root); document.body.classList.add('studio-active');
  const instance = {nodeId: node.id, version: 3}; active = instance;
  let alive = true, closing = null, session, runtime, observer, lastSync = Promise.resolve(), selected = null, lastLane = 'world', previousIndependent = null, toastTimer;
  const notices = new Map();
  const notice = (message, error = false) => {
    if (!alive) return; clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toast.dataset.error = String(error);
    if (!error) toastTimer = setTimeout(() => {toast.hidden = true;}, 3500);
  };
  const safe = action => async event => {
    if (!alive || closing) return;
    try {await action(event);} catch (error) {notice(error.message, true);}
  };
  const menus = createMenus({root, onError: error => notice(error.message, true)});
  const state = () => session.getState(), space = () => state().scenePlay.worldSpace;
  const currentSetup = () => space().setups.find(setup => setup.id === space().activeSetupId);
  const control = () => selected ? resolveEntityControl(state(), {entityId: selected}) : null;
  const row = (name, label, action, options = {}) => button(name, label, safe(action), {className: 'sv3-menu-row', text: label, ...options});
  const menu = (label, rows) => {const list = el('div'); list.ariaLabel = label; list.append(...rows); return list;};
  const select = id => {selected = id; runtime.selectEntity(id); refresh();window.AgentUI?.refreshSceneContext?.();};
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
    const result = reduceEntityAction(state(), action);
    if (!result.ok) {notice(result.message, true); return result;}
    if (result.changed) {change(() => result.state, '实体编辑', result.lane); await lastSync;}
    if (action.type === 'remove') select(null); else if (result.entityId) select(result.entityId);
    return result;
  };
  const addEntity = async (kind, assetId) => {
    menus.close(); runtime.cancelTransform();
    const id = crypto.randomUUID(), target = runtime.controls.target;
    const action = {type: 'create', kind, id, transform: {position: {x: target.x, y: 0, z: target.z}}};
    if (kind === 'actor') action.roleId = crypto.randomUUID();
    if (assetId) action.assetId = assetId;
    await entityAction(action); runtime.focusEntity(id);
  };
  const switchSetup = id => {
    runtime.cancelTransform(); menus.close(); selected = null;
    if (currentSetup().kind === 'independent') previousIndependent = currentSetup().id;
    change(value => setActiveSetup(value, id), '切换状态', 'world', false);
  };
  const addState = (duplicate = false) => {
    runtime.cancelTransform();
    const now = Date.now(), id = crypto.randomUUID(), current = currentSetup();
    const setup = createIndependentSetup({id, stageId: current.stageId, label: `状态 ${space().setups.filter(item => item.kind === 'independent' && item.stageId === current.stageId).length + 1}`, now});
    if (duplicate && current.kind === 'independent') {setup.entityStates = structuredClone(current.entityStates); if (current.temporal) setup.temporal = structuredClone(current.temporal);}
    selected = null; change(value => addSetup(value, setup, {activate: true}), duplicate ? '复制状态' : '新增状态'); menus.close();
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
  const showStates = () => menus.toggle(stateButton, () => {
    const list = el('div', 'sv3-state-list');
    for (const setup of space().setups.filter(item => item.stageId === space().activeStageId && item.kind === 'independent')) {
      const item = row(setup.id === currentSetup().id ? 'check' : null, setup.label, () => switchSetup(setup.id)); item.dataset.active = String(setup.id === currentSetup().id); list.append(item);
    }
    list.append(row('add', '新增状态', () => addState()), row('clone', '复制当前状态', () => addState(true)), row('settings', '编辑场景基准', () => switchSetup(baselineId(space().activeStageId))));
    if (currentSetup().kind === 'independent') list.append(row('rename', '重命名当前状态', () => {
      const setupId = currentSetup().id;
      rename(stateButton, currentSetup().label, label => change(value => {
        const next = structuredClone(value); next.scenePlay.worldSpace.setups.find(item => item.id === setupId).label = label; assertState(next); return next;
      }, '状态重命名'));
    }));
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
  const showInspector = anchor => menus.toggle(anchor, () => {
    const c = control(), panel = el('div', 'sv3-inspector'); if (!c?.setupState) return panel;
    panel.append(el('div', '', c.definition.label));
    const locked = c.locked || c.baselineReadOnly;
    for (const [field, label] of [['position', '位置'], ['rotation', '旋转'], ['scale', '缩放']]) {
      panel.append(el('h4', '', label)); const fields = el('div', 'sv3-fields');
      for (const axis of ['x', 'y', 'z']) {
        const labelNode = el('label', 'sv3-field', axis.toUpperCase()), input = el('input'); input.type = 'number'; input.step = field === 'rotation' ? '1' : '.1';
        input.value = String(field === 'rotation' ? c.setupState.transform[field][axis] * 180 / Math.PI : c.setupState.transform[field][axis]); input.disabled = locked;
        let accepted=input.value;
        input.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.stopPropagation();input.value=accepted;menus.close();}});
        input.ariaLabel = `${label} ${axis.toUpperCase()}`; input.onchange = safe(async() => {
          const value = Number(input.value); if (!Number.isFinite(value) || field === 'scale' && value === 0) throw Error('请输入有效数值，缩放不能为零');
          const result=await entityAction({type: 'update', entityId: c.definition.id, patch: {transform: {[field]: {[axis]: field === 'rotation' ? value * Math.PI / 180 : value}}}});if(result.ok)accepted=input.value;
        }); labelNode.append(input); fields.append(labelNode);
      }
      panel.append(fields);
    }
    if (c.definition.kind === 'actor') {
      const pose = el('select'); pose.ariaLabel = '人物姿态'; pose.disabled = locked;
      for (const [value, label] of [['Standing', '站立'], ['Idle', '待机'], ['Sitting', '坐姿'], ['Crouching', '蹲姿'], ['Kneeling', '跪姿'], ['Walking', '行走'], ['Running', '奔跑']]) pose.append(new Option(label, value));
      pose.value = c.setupState.pose || 'Standing'; pose.onchange = safe(() => entityAction({type: 'update', entityId: c.definition.id, patch: {pose: pose.value}})); panel.append(pose);
      pose.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();menus.close();}});
    }
    if (c.baselineReadOnly) panel.append(row('settings', '前往场景基准编辑', () => switchSetup(c.ownerSetupId)));
    return panel;
  }, {label: '实体属性', width: 440});
  const showEntityMenu = (point, anchor) => {
    const c = control(); if (!c) return;
    const list = () => menu('实体操作', [
      row('rename', '重命名', () => rename(selectionButton, c.definition.label, label => entityAction({type: 'update', entityId: c.definition.id, patch: {label}}))),
      row('clone', '副本', () => {menus.close(); return entityAction({type: 'clone', entityId: c.definition.id, newId: crypto.randomUUID(), transform: {position: {x: c.setupState.transform.position.x + 1}}});}),
      row(c.locked ? 'unlock' : 'lock', c.locked ? '解锁' : '锁定', () => {menus.close(); return entityAction({type: 'update', entityId: c.definition.id, patch: {locked: !c.locked}});}),
      row('settings', '属性', () => {menus.close(); showInspector(selectionButton);}),
      row('delete', '从当前状态移除', () => {menus.close(); return entityAction({type: 'remove', entityId: c.definition.id, mode: 'local'});})
    ]);
    if (point) menus.openAt(point, list, {label: '实体操作'}); else menus.toggle(anchor, list, {label: '实体操作'});
  };
  const back = button('back', '返回画布', safe(() => instance.close())); const home = button('restoreHome', '恢复初始视图', safe(() => {runtime.controls.target.set(0, 1, 0); runtime.orbitCamera.position.set(7, 6, 9); runtime.orbitCamera.lookAt(runtime.controls.target); runtime.controls.update(); runtime.render();}));
  const help = button('controls', '控制说明', () => menus.toggle(help, () => el('div', 'sv3-controls-help', '拖动鼠标旋转视角；右键拖动平移；滚轮缩放。点击实体后可移动、旋转、缩放。F 聚焦，Esc 取消当前编辑，⌘/Ctrl Z 撤销。'), {label: '控制说明', placement: 'bottom'}));
  const topSurface = el('div', 'sv3-surface'); topSurface.append(back, home, help); left.append(topSurface);
  const wordmark = el('div', 'sv3-wordmark'), logo = el('img'); logo.src = '/assets/branding/freenow-mark.svg'; logo.alt = 'freenow'; wordmark.append(logo); center.append(wordmark);
  const saveStatus = button(null, '保存状态', safe(async() => {
    if (instance.initializationError) {
      const result = await session.flush();
      if (!result.ok || session.getStatus().dirty) throw Error('当前修改尚未保存，请重试');
      notice('修改已保存，请返回画布后重新打开片场');
    } else {await instance.prepareAgentContext(); notice('片场已保存');}
  }), {text: '已保存'}), saveSurface = el('div', 'sv3-surface'); saveSurface.append(saveStatus); right.append(saveSurface);
  const stateButton = button('onSet', '状态', showStates, {text: '状态 1'}); stateButton.classList.add('sv3-state-trigger'); stateCapsule.append(stateButton); leading.append(stateCapsule);
  const leaveBaseline = button('exitBaseline', '退出场景基准', safe(() => switchSetup(previousIndependent && space().setups.some(item => item.id === previousIndependent) ? previousIndependent : space().setups.find(item => item.stageId === space().activeStageId && item.kind === 'independent').id)), {text: '退出基准'}); stateCapsule.append(leaveBaseline);
  const tools = el('div', 'sv3-capsule');
  const objectList = button('object', '选择实体', () => showObjects(objectList));
  const character = button('character', '添加人物', safe(() => addEntity('actor')));
  const cameraButton = button('camera', '添加摄像机', safe(() => addEntity('camera')));
  const props = button('add', '添加道具', () => showLibrary(props));
  const undo = button('undo', '撤销', safe(() => replay(false))), redo = button('redo', '重做', safe(() => replay(true)));
  tools.append(objectList, character, cameraButton, props, el('span', 'sv3-separator'), undo, redo); mainActions.append(tools);
  const orbit = button('onSet', '3D 视图', safe(() => {runtime.setView('orbit'); refresh();}), {text: '3D'}), plan = button('topView', '俯视图', safe(() => {runtime.setView('plan'); refresh();}), {text: '俯视图'}); viewCapsule.append(orbit, plan); trailing.append(viewCapsule);
  const selectionTools = el('div', 'sv3-capsule'), selectionButton = button('object', '实体操作', () => showEntityMenu(null, selectionButton), {text: ''}); selectionButton.classList.add('sv3-selection-name');
  const transformButtons = ['translate', 'rotate', 'scale'].map((mode, index) => button(['control', 'rotateRight', 'redistribute'][index], ['移动', '旋转', '缩放'][index], safe(() => runtime.attachTransform(selected, mode)), {text: ['移动', '旋转', '缩放'][index]}));
  const inspectorButton = button('settings', '实体属性', () => showInspector(inspectorButton)); selectionTools.append(selectionButton, ...transformButtons, inspectorButton); upper.append(selectionTools);
  async function replay(redo) {
    runtime.cancelTransform(); menus.close();
    const result = redo ? session.history.redo(lastLane) : session.history.undo(lastLane);
    if (!result.ok && result.reason !== 'empty') notice('此操作与其他状态的较新修改冲突，无法撤销。', true); await lastSync;return result;
  }
  function refresh() {
    if (!session || !runtime || !alive) return;
    const status = session.getStatus(), setup = currentSetup();
    stateButton.querySelector('span').textContent = setup.label; leaveBaseline.hidden = setup.kind !== 'scene-baseline';
    saveStatus.textContent = status.status === 'failed' ? '保存失败 · 重试' : status.status === 'saving' ? '保存中' : status.dirty ? '待保存' : '已保存'; saveStatus.disabled = status.status === 'saving';
    orbit.dataset.active = String(runtime.view === 'orbit'); plan.dataset.active = String(runtime.view === 'plan');
    if (selected && !renderSetup(state()).entityStates.some(item => item.entityId === selected)) selected = null;
    selectionTools.hidden = !selected;
    const c = control(); if (c) {selectionButton.textContent = c.definition.label; for (const item of transformButtons) item.disabled = c.locked || c.baselineReadOnly;}
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
    if (action === 'select') {if (args.id && !renderSetup(state()).entityStates.some(item => item.entityId === args.id)) throw Error('实体不在当前状态'); select(args.id || null); return {selected: selected};}
    if (action === 'undo') {const result=await replay(false);if(!result.ok)throw Error(result.reason==='empty'?'当前通道没有可撤销的操作':'撤销被拒绝：'+result.reason);return instance.prepareAgentContext();}
    throw Error('导演片场尚未接入此 Agent 操作，请读取 scene_read.capabilities：' + action);
  };
  instance.close = async () => {
    if (!alive || active !== instance) return;
    if (closing) return closing;
    closing = (async () => {
      runtime?.cancelTransform(); menus.close(); await session.closeGuard();
      alive = false; clearTimeout(toastTimer); observer?.disconnect(); menus.dispose(); await runtime?.dispose();
      root.remove(); document.body.classList.remove('studio-active'); active = null;
      app.select(node.id, false); const target = returnFocus?.isConnected ? returnFocus : document.querySelector('#canvas'); target?.focus({preventScroll: true}); window.AgentUI?.refreshSceneContext?.();
    })();
    try {await closing;} finally {closing = null;}
  };
  try {
    session = createStudioSession({nodeId: node.id, app, store: window.CanvasStore, getSourceSnapshot: sourceSnapshot,
      isCurrentSession: () => alive && active === instance, publishNode: (id, patch, options) => app.publishStudioV3(id, patch, options),
      onChange: sync, onStatus: status => {refresh(); if (status.error) notice('保存失败，修改已保留：' + status.error.message, true);}});
    runtime = createStudioV3Runtime({canvas, getState: state, getSourceResource: () => readSourceResource(app, node.id),
      getFence: () => session.getFence(), isCurrent: () => alive && session.isCurrent(),
      onStatus: report => {const key = `${report.kind}:${report.id}`; if (report.status === 'failed') {notices.set(key, report.error); notice(report.error, true);} else if (report.status === 'ready') notices.delete(key);},
      onTransform: event => {
        if (event.phase === 'begin') {const c = control(); if (!c || c.baselineReadOnly || c.locked) throw Error('请先切换到实体所属状态并解锁'); lastLane = c.stateLane; if (!session.history.begin(lastLane, '实体变换', {kind: 'world-space'})) throw Error('请先完成当前编辑');}
        if (event.phase === 'preview') session.history.preview(value => {const result = reduceEntityAction(value, {type: 'update', entityId: event.entityId, patch: {transform: event.transform}}); if (!result.ok) throw Error(result.message); return result.state;});
        if (event.phase === 'commit') session.history.commit();
        if (event.phase === 'cancel' && session.history.getActiveTransaction()) session.history.cancel();
      }});
    instance.session = session; instance.runtime = runtime;
    observer = new ResizeObserver(() => runtime.resize()); observer.observe(root);
    let down;
    canvas.addEventListener('pointerdown', event => {down = {x: event.clientX, y: event.clientY, button: event.button};});
    canvas.addEventListener('pointerup', event => {if (!down || down.button !== 0 || runtime.transformControls.dragging || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return; const hit = runtime.hitEntity(event); select(hit?.entityId || null); down = null;});
    canvas.addEventListener('contextmenu', event => {event.preventDefault(); const hit = runtime.hitEntity(event); if (hit) {select(hit.entityId); showEntityMenu({x: event.clientX, y: event.clientY});}});
    root.addEventListener('keydown', event => {
      event.stopPropagation(); if (event.isComposing || event.keyCode === 229 || event.target.closest('input,textarea,select,[contenteditable]')) return;
      if (event.key === 'Escape') {event.preventDefault(); if (menus.isOpen()) menus.close(); else if (runtime.cancelTransform()) {} else if (selected) select(null); else safe(() => instance.close())();}
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); safe(() => replay(event.shiftKey))();}
      if (event.key.toLowerCase() === 'f' && selected) {event.preventDefault(); runtime.focusEntity(selected);}
      if (['Delete', 'Backspace'].includes(event.key) && selected && !event.metaKey && !event.ctrlKey) {event.preventDefault(); safe(() => entityAction({type: 'remove', entityId: selected, mode: 'local'}))();}
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
    alive=false;clearTimeout(toastTimer);observer?.disconnect();menus.dispose();await runtime?.dispose();root.remove();
    if (active === instance) {document.body.classList.remove('studio-active'); active=null;}
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});throw error;
  }
}
