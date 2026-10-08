import {projectPlanPoint, unprojectPlanPoint, sectionSliderValue, sectionHeightFromSlider} from './plan-projection.mjs';
import {PLAN_SCALE, CAMERA_LENS, CAMERA_BODY, PLAN_ICONS, HEADING_CURSOR, FOV_CURSOR, outlineColor, screenHeading, fovGeometry, editFovEdge, markerLabel, fovReadout, pathControlProxy, nearestPathSample} from './plan-geometry.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg', XHTML_NS = 'http://www.w3.org/1999/xhtml';
const colors = {person: '#66B8A6', object: '#D8B45F', camera: '#B7A66A'}, gold = '#EFD77A';
const set = (node, attrs) => {for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, String(value)); return node;};
function svgNode(doc, tag, attrs = {}, parent) {const node = set(doc.createElementNS(SVG_NS, tag), attrs); parent?.append(node); return node;}
function htmlNode(doc, tag, className, parent, text) {const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; parent?.append(node); return node;}
function rejected(result) {return result === false || result?.ok === false;}
function identity(snapshot) {return JSON.stringify([snapshot.sourceKey ?? null, snapshot.sceneRevision ?? null, snapshot.setupId ?? null]);}
function sectionText(value) {if (value === 'all' || value === Infinity) return '显示全部'; const digits = value < 1 ? 2 : value < 10 ? 1 : 0; return `剖切高度 ${Number(value.toFixed(digits))} m`;}
function placementIdentity(value) {return value && JSON.stringify([value.kind, value.id, value.roleId, value.label]);}

/** Independent plan overlay. Only the host owns renderer, navigation and author transactions. */
export function createPlanView({container, getSnapshot, getMarkers = () => [], getPaths = () => [], getPlacement = () => null, beginPlacement, onCancelPlacement, beginPathEdit, onPathSelect, onPathContextMenu, getNavigation, onSelect, onContextMenu, beginEdit, onReturn, onError = () => {}}) {
  const doc = container.ownerDocument, win = doc.defaultView;
  if (!doc.querySelector('link[data-studio-v3-plan-view]')) {const link = htmlNode(doc, 'link', '', doc.head); link.rel = 'stylesheet'; link.href = new URL('./plan-view.css', import.meta.url).href; link.dataset.studioV3PlanView = 'true';}
  const element = htmlNode(doc, 'div', 'sv3-plan-view', container); element.dataset.testid = 'workspace-plan-view-surface'; element.dataset.worldWorkspaceBlockMovementHotkeys = 'true';
  const svg = svgNode(doc, 'svg', {class: 'sv3-plan-svg', preserveAspectRatio: 'none'}, element);
  const paths = svgNode(doc, 'g', {class: 'sv3-plan-paths', 'data-plan-view-hit-priority': 10}, svg);
  const markers = svgNode(doc, 'g', {class: 'sv3-plan-markers', 'data-plan-view-hit-priority': 20}, svg);
  const controls = svgNode(doc, 'g', {class: 'sv3-plan-path-controls', 'data-plan-view-hit-priority': 35}, svg);
  const fovs = svgNode(doc, 'g', {class: 'sv3-plan-fov-controls', 'data-plan-view-hit-priority': 40}, svg);
  const keys = svgNode(doc, 'g', {class: 'sv3-plan-trajectory-keys', 'data-plan-view-hit-priority': 45}, svg);
  const placementInstruction = htmlNode(doc, 'div', 'sv3-plan-placement-instruction', element); placementInstruction.setAttribute('role', 'status');
  htmlNode(doc, 'div', 'sv3-plan-top-fade', element).setAttribute('aria-hidden', 'true');
  const loading = htmlNode(doc, 'div', 'sv3-plan-loading', element, '加载中...'); loading.setAttribute('role', 'status');
  const failure = htmlNode(doc, 'div', 'sv3-plan-error', element); htmlNode(doc, 'div', '', failure, '俯视图加载失败');
  const retry = htmlNode(doc, 'button', 'sv3-plan-retry', failure, '重试'); retry.type = 'button';
  const nav = htmlNode(doc, 'div', 'sv3-plan-nav', element); nav.dataset.testid = 'workspace-plan-view-navigation-controls';
  const brand = htmlNode(doc, 'span', 'sv3-plan-brand', nav), logo = htmlNode(doc, 'img', '', brand); logo.src = '/assets/branding/freenow-mark.svg'; logo.alt = 'FreeNow';
  const buttons = [];
  function navButton(name, label, title, action) {const node = htmlNode(doc, 'button', 'sv3-plan-button', nav); node.type = 'button'; node.setAttribute('aria-label', label); node.title = title; node.innerHTML = PLAN_ICONS[name]; node.onclick = event => {event.stopPropagation(); if (operable()) invoke(action);}; buttons.push(node); return node;}
  const left = navButton('rotate-2', '左旋', '按住向左旋转俯视图', () => navigate('rotateBy', Math.PI / 12));
  const right = navButton('rotate-clockwise-2', '右旋', '按住向右旋转俯视图', () => navigate('rotateBy', -Math.PI / 12));
  htmlNode(doc, 'span', 'sv3-plan-divider', nav);
  navButton('minus', '缩小', '缩小俯视图', () => navigate('zoomBy', 1 / 1.12));
  const zoom = htmlNode(doc, 'span', 'sv3-plan-zoom', nav, '1.0x');
  navButton('plus', '放大', '放大俯视图', () => navigate('zoomBy', 1.12)); htmlNode(doc, 'span', 'sv3-plan-divider', nav);
  navButton('refresh', '重置视图', '重置俯视图', () => navigate('reset'));
  const section = htmlNode(doc, 'div', 'sv3-plan-section', element); section.dataset.testid = 'workspace-plan-view-section-height-control';
  const slider = htmlNode(doc, 'input', 'sv3-plan-section-input', section); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '.001'; slider.setAttribute('aria-label', '剖切高度'); slider.setAttribute('aria-orientation', 'vertical');
  const sectionLabel = htmlNode(doc, 'output', 'sv3-plan-section-readout', section); sectionLabel.setAttribute('aria-hidden', 'true');
  const nodes = new Map(), pathNodes = new Map(), controlNodes = new Map(), keyNodes = new Map(), fovNodes = new Map(); let snapshot = {}, displayedProjection = null, disposed = false, gesture = null, clickGuard = null, clickTimer = null, sequence = 0, hoveredPath = null;
  function report(error) {try {onError(error instanceof Error ? error : new Error(String(error)));} catch { /* Feedback cannot strand pointer cleanup. */ }}
  function invoke(fn) {try {Promise.resolve(fn()).catch(report);} catch (error) {report(error);}}
  function read() {return getSnapshot?.() || {};}
  function renderReady() {const state = read(); return !disposed && state.active === true && state.ready === true && !state.error && !!state.projection;}
  function operable() {return renderReady() && read().interactive !== false;}
  function navigate(method, value) {return getNavigation?.()?.[method]?.(value);}
  function liveMarker(id) {return getMarkers().find(marker => marker.id === id);}
  function editable(marker) {return marker && !marker.locked && !marker.readOnly && typeof (marker.pathSelection ? beginPathEdit : beginEdit) === 'function';}
  function valid(session) {const state = read(), marker = session.marker ? liveMarker(session.marker.id) : null, path = session.path ? getPaths().find(value => value.id === session.path.id) : null; return renderReady() && (session.marker || session.path || session.placement || state.interactive !== false) && identity(state) === session.identity && (!session.placement || placementIdentity(getPlacement()) === placementIdentity(session.placement)) && (!session.path || path && !path.readOnly && !path.locked && (!session.keyId || path.keys?.some(key => (key.keyId ?? key.id) === session.keyId && (!['key-heading', 'key-fov'].includes(session.kind) || key.selected && (session.kind !== 'key-fov' || path.kind === 'camera' && key.camera))))) && (!session.marker || marker && (session.canEdit === false || editable(marker)) && marker.kind === session.marker.kind && (session.kind !== 'fov' || marker.selected && marker.fovPresentation !== 'hidden'));}
  function point(event, anchor) {const rect = svg.getBoundingClientRect(); if (!renderReady() || !displayedProjection || rect.width <= 0 || rect.height <= 0) return null; return unprojectPlanPoint(displayedProjection, {nx: (event.clientX - rect.left) / rect.width, ny: (event.clientY - rect.top) / rect.height}, anchor);}
  function consume(event) {event.preventDefault(); event.stopPropagation();}
  function clearClickGuard() {clickGuard = null; if (clickTimer !== null) win.clearTimeout(clickTimer); clickTimer = null;}
  function guardClick(session) {
    clearClickGuard();
    // Native drag may omit its trailing click. Associate protection with that
    // source and pointer, rather than suppressing a later selection elsewhere.
    clickGuard = {markerId: session.marker?.id ?? null, pathId: session.path?.id ?? null, pointerId: session.pointerId, kind: session.kind, target: session.target, expires: Date.now() + 350};
    clickTimer = win.setTimeout(clearClickGuard, 350);
  }
  function isGuardedClick(event) {
    if (!clickGuard || event.pointerId === -1) return false;
    if (Date.now() >= clickGuard.expires) {clearClickGuard(); return false;}
    if (Number.isFinite(event.pointerId) && event.pointerId > 0 && event.pointerId !== clickGuard.pointerId) return false;
    const markerId = event.target.closest?.('[data-marker-id]')?.dataset.markerId;
    if (clickGuard.pathId !== null) return event.target.closest?.('[data-path-id]')?.dataset.pathId === clickGuard.pathId;
    if (clickGuard.markerId !== null) return markerId === clickGuard.markerId;
    if (clickGuard.kind === 'rotate') return clickGuard.target?.contains(event.target) === true;
    return !markerId && !nav.contains(event.target) && !section.contains(event.target);
  }
  function detach(session) {if (session.previewFrame != null) {win.cancelAnimationFrame(session.previewFrame); session.previewFrame = null;} if (!session.listeners) return; for (const [name, handler] of Object.entries(session.listeners)) win.removeEventListener(name, handler, true); session.listeners = null; element.dataset.dragging = 'false';}
  function settle(session) {detach(session); if (gesture === session) gesture = null; session.preview = null; if (!disposed) refresh();}
  async function rollback(session) {
    if (!session.lease) {if (!session.pending) settle(session); return true;}
    if (session.cancelling) return session.cancelling;
    session.cancelling = (async () => {try {const result = await session.lease.onCancel?.(); if (rejected(result)) throw new Error(result?.message || '俯视编辑取消失败'); session.lease = null; settle(session); return true;} catch (error) {report(error); session.cancelFailed = true; return false;} finally {session.cancelling = null;}})();
    return session.cancelling;
  }
  function cancelGesture() {const session = gesture; if (!session) return false; session.cancelled = true; session.preview = null; detach(session); session.chain = (session.chain || Promise.resolve()).then(() => rollback(session)); if (!session.pending && !session.lease) settle(session); else if (!disposed) refresh(); return true;}
  function listen(session, move, end, cancel = cancelGesture) {
    session.listeners = {pointermove: event => {if (event.pointerId === session.pointerId) move(event);}, pointerup: event => {if (event.pointerId === session.pointerId) end(event);}, pointercancel: event => {if (event.pointerId === session.pointerId) cancel(event);}, blur: () => cancel()};
    for (const [name, handler] of Object.entries(session.listeners)) win.addEventListener(name, handler, true);
    element.dataset.dragging = 'true';
  }
  function payload(session, event) {
    if (session.placement) {const world = point(event, session.anchor); if (!world) return null; const dx = world.x - session.anchor.x, dz = world.z - session.anchor.z; return Math.hypot(dx, dz) < .05 ? {} : {heading: Math.atan2(dx, -dz)};}
    if (session.path) {const world = point(event, session.anchor); if (!world) return null; if (session.kind === 'key-heading' || session.kind === 'key-fov') {const dx = world.x - session.anchor.x, dz = world.z - session.anchor.z; if (Math.hypot(dx, dz) < .05) return null; const heading = Math.atan2(dx, -dz); return session.kind === 'key-heading' ? {heading} : editFovEdge({heading: session.key.heading ?? 0, fov: session.key.camera.fov, ratio: session.key.camera.frameAspectRatio ?? 1.5, edge: session.edge, draggedHeading: heading});} return {position: {x: world.x + session.offset.x, y: session.anchor.y ?? 0, z: world.z + session.offset.z}};}
    const anchor = session.marker.position, world = point(event, anchor); if (!world) return null;
    if (session.kind === 'move') return {position: {...world, y: anchor.y}};
    const dx = world.x - anchor.x, dz = world.z - anchor.z; if (Math.hypot(dx, dz) < .05) return null;
    const heading = Math.atan2(dx, -dz);
    return session.kind === 'heading' ? {heading} : editFovEdge({heading: session.marker.heading || 0, fov: session.marker.camera.fov, ratio: session.marker.camera.frameAspectRatio ?? 1.5, edge: session.edge, draggedHeading: heading});
  }
  function queuePreview(session, final = false) {
    // Read the latest pointer after async preflight, never the pointer which opened it.
    session.chain = (session.chain || Promise.resolve()).then(async () => {
      if (session.cancelled || !session.lease) return;
      if (!valid(session)) {session.cancelled = true; await rollback(session); return;}
      const change = payload(session, session.latest); if (!change) {if (final) {session.cancelled = true; await rollback(session);} return;}
      try {
        const keyPoseFinal = final && ['key-heading', 'key-fov'].includes(session.kind);
        if (!keyPoseFinal && session.kind !== 'key-fov' && (session.kind !== 'fov' || final) && (!session.placement || Object.keys(change).length)) {const result = await session.lease.onMove?.(change); if (rejected(result)) throw new Error(result?.message || '俯视编辑预览失败');}
        if (session.cancelled || !valid(session)) {session.cancelled = true; await rollback(session); return;}
        if (final) {const result = await session.lease.onEnd?.(session.kind === 'key-fov' || session.kind === 'key-heading' ? change : undefined); if (rejected(result)) throw new Error(result?.message || '俯视编辑提交失败'); session.lease = null; settle(session);}
      } catch (error) {report(error); session.cancelled = true; await rollback(session);}
    });
  }
  function openEdit(session) {
    session.started = true; session.pending = true; guardClick(session);
    Promise.resolve().then(() => session.cancelled || !valid(session) ? null : session.placement ? beginPlacement(session.request) : session.path ? beginPathEdit(session.request) : beginEdit({entityId: session.marker.id, kind: session.kind, marker: session.marker})).then(lease => {
      session.pending = false; session.lease = lease;
      if (!lease) {settle(session); return;}
      if (typeof lease.onMove !== 'function' || typeof lease.onEnd !== 'function' || typeof lease.onCancel !== 'function') {session.cancelled = true; report(new Error('俯视编辑事务接口无效')); rollback(session); return;}
      if (session.cancelled || !valid(session)) {session.cancelled = true; rollback(session); return;}
      queuePreview(session, session.ended);
    }).catch(error => {session.pending = false; report(error); settle(session);});
  }
  function beginPlacementGesture(event) {
    const placement = getPlacement(); if (!placement || event.button !== 0 || event.isPrimary === false || !operable() || gesture || typeof beginPlacement !== 'function') return false;
    const anchor = point(event); if (!anchor) return false; consume(event);
    const session = {placement, kind: 'placement', pointerId: event.pointerId, identity: identity(read()), anchor, latest: event, request: {point: anchor, projection: displayedProjection, clientX: event.clientX, clientY: event.clientY, event}}; gesture = session;
    listen(session, next => {consume(next); session.latest = next; if (!valid(session)) {cancelGesture(); return;} if (session.lease) queuePreview(session);}, next => {consume(next); session.latest = next; session.ended = true; detach(session); guardClick(session); if (session.lease) queuePreview(session, true);});
    openEdit(session); return true;
  }
  function beginPathGesture(event, path, kind, item, anchor, edge) {
    if (event.button !== 0 || event.isPrimary === false) return; consume(event);
    if (!operable() || gesture || path.readOnly || path.locked || typeof beginPathEdit !== 'function' || !anchor) return;
    const initial = point(event, anchor); if (!initial) return;
    const keyId = kind.startsWith('key') ? item.keyId ?? item.id : undefined;
    const request = {kind, pathId: path.id, entityId: path.entityId, keyId, position: anchor, fromKeyId: item.fromKeyId, toKeyId: item.toKeyId, endpoint: item.endpoint, t: item.t, timeMs: item.timeMs};
    const session = {path: structuredClone(path), key: keyId ? structuredClone(item) : null, keyId, edge, renderedMarkerId: keyId ? `trajectory:${path.id}:${keyId}` : null, kind, pointerId: event.pointerId, identity: identity(read()), anchor: {...anchor}, offset: {x: anchor.x - initial.x, z: anchor.z - initial.z}, request, latest: event, x0: event.clientX, y0: event.clientY}; gesture = session;
    listen(session, next => {consume(next); session.latest = next; if (!valid(session)) {cancelGesture(); return;} if (!session.started && Math.hypot(next.clientX - session.x0, next.clientY - session.y0) >= 4) openEdit(session); if (session.started && kind === 'key-fov') {session.preview = payload(session, next); if (session.previewFrame == null) session.previewFrame = win.requestAnimationFrame(() => {session.previewFrame = null; if (!session.cancelled && gesture === session) refresh();});} else if (session.lease) queuePreview(session);}, next => {
      consume(next); session.latest = next; session.ended = true; detach(session); guardClick(session);
      if (!session.started) {if (valid(session)) {const selectedKey = kind === 'path' ? item.t <= .001 ? item.fromKeyId : item.t >= .999 ? item.toKeyId : undefined : keyId; if (kind === 'key' && item.selected) invoke(() => onPathContextMenu?.({pathId: path.id, entityId: path.entityId, kind: 'key', keyId, clientX: next.clientX, clientY: next.clientY, event: next})); else invoke(() => onPathSelect?.({pathId: path.id, keyId: selectedKey, clientX: next.clientX, clientY: next.clientY, event: next}));} settle(session);} else if (session.lease) queuePreview(session, true);
    });
  }
  function beginMarker(event, marker, kind = 'move', edge) {
    if (marker.pathSelection) return beginPathGesture(event, marker.pathSelection.path, kind === 'move' ? 'key' : kind === 'heading' ? 'key-heading' : 'key-fov', marker.pathSelection.key, marker.position, edge);
    if (event.button !== 0 || event.isPrimary === false || !element.contains(event.currentTarget)) return; consume(event);
    const currentMarker = liveMarker(marker.id);
    if (!operable() || gesture || !currentMarker || kind !== 'move' && !editable(currentMarker) || !point(event, currentMarker.position)) return;
    const session = {canEdit: editable(currentMarker), id: ++sequence, pointerId: event.pointerId, marker: structuredClone(currentMarker), kind, edge, identity: identity(read()), x0: event.clientX, y0: event.clientY, latest: event}; gesture = session;
    listen(session, next => {
      consume(next); if (!valid(session)) {cancelGesture(); return;} session.latest = next;
      if (session.canEdit && !session.started && Math.hypot(next.clientX - session.x0, next.clientY - session.y0) >= 4) openEdit(session);
      if (session.started) {if (session.kind === 'fov') {session.preview = payload(session, next); refresh();} else if (session.lease) queuePreview(session);}
    }, next => {
      consume(next); session.latest = next; session.ended = true; detach(session);
      if (!session.started) {
        if (valid(session) && Math.hypot(next.clientX - session.x0, next.clientY - session.y0) < 4) invoke(() => onSelect?.(session.marker.id, liveMarker(session.marker.id), next));
        // A frame/selection refresh may replace a descendant before native click
        // dispatch. Finish the tap from the owned pointer, then suppress its duplicate.
        guardClick(session); settle(session); return;
      }
      guardClick(session); if (session.lease) queuePreview(session, true);
    });
  }
  function beginNavigation(event, kind, direction) {
    if (event.isPrimary === false || !operable() || gesture || ![0, 1].includes(event.button)) return; consume(event);
    const state = read(), session = {pointerId: event.pointerId, kind, direction, identity: identity(state), x0: event.clientX, y0: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, target: event.currentTarget}; gesture = session;
    listen(session, next => {
      consume(next); if (!valid(session)) {cancelGesture(); return;}
      const dx = next.clientX - session.x0, dy = next.clientY - session.y0;
      if (!session.moved && (kind === 'rotate' ? Math.abs(dx) > 4 : Math.abs(dx) + Math.abs(dy) > 4)) {session.moved = true; guardClick(session);}
      if (session.moved) {const x = next.clientX - session.lastX, y = next.clientY - session.lastY; invoke(() => kind === 'rotate' ? navigate('rotateBy', -x * .008) : navigate('panPixels', {dx: x, dy: y})); session.lastX = next.clientX; session.lastY = next.clientY;}
    }, next => {
      consume(next); if (session.moved) guardClick(session); if (valid(session)) {if (kind === 'rotate' && !session.moved) {guardClick(session); invoke(() => navigate('rotateBy', direction * Math.PI / 12));} else if (kind === 'pan' && !session.moved && event.button === 0 && Math.abs(next.clientX - session.x0) + Math.abs(next.clientY - session.y0) <= 4) invoke(() => onSelect?.(null, null, next));}
      settle(session);
    }, next => {if (kind === 'rotate' && next && valid(session) && !session.moved) invoke(() => navigate('rotateBy', direction * Math.PI / 12)); cancelGesture();});
  }
  for (const [node, direction] of [[left, 1], [right, -1]]) {
    node.onclick = event => {event.stopPropagation(); if (operable()) invoke(() => navigate('rotateBy', direction * Math.PI / 12));};
    node.addEventListener('pointerdown', event => beginNavigation(event, 'rotate', direction));
  }
  for (const control of [nav, section, failure]) for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu']) control.addEventListener(type, event => event.stopPropagation());
  retry.onclick = event => {consume(event); if (!disposed && read().active) invoke(() => navigate('retry'));};
  slider.oninput = event => {event.stopPropagation(); if (operable()) invoke(() => navigate('setSection', sectionHeightFromSlider(Number(slider.value))));};
  const showSection = value => {section.dataset.interacting = String(value); sectionLabel.setAttribute('aria-hidden', String(!value));};
  slider.addEventListener('pointerdown', () => showSection(true)); for (const type of ['pointerup', 'pointercancel', 'blur']) slider.addEventListener(type, () => showSection(false));
  slider.onkeydown = event => {if (event.key !== 'Escape') {event.stopPropagation(); showSection(true);}}; slider.onkeyup = () => showSection(false);
  element.addEventListener('pointerdown', event => {clearClickGuard(); if (operable()) element.focus({preventScroll: true}); beginPlacementGesture(event);}, true);
  element.addEventListener('pointerdown', event => {if (!operable()) return; beginNavigation(event, 'pan');});
  element.addEventListener('click', event => {if (isGuardedClick(event)) {consume(event); clearClickGuard();}}, true);
  element.addEventListener('contextmenu', event => {
    consume(event); if (!operable()) return; const marker = liveMarker(event.target.closest?.('[data-marker-id]')?.dataset.markerId), world = point(event, marker?.position);
    if (world) invoke(() => onContextMenu?.({entityId: marker?.id ?? null, marker, point: world, projection: displayedProjection, clientX: event.clientX, clientY: event.clientY, event}));
  });
  element.addEventListener('wheel', event => {
    if (!operable() || nav.contains(event.target) || section.contains(event.target)) return; consume(event);
    const x = Math.abs(event.deltaX), y = Math.abs(event.deltaY), integerY = Number.isInteger(event.deltaY);
    const wheelZoom = event.ctrlKey || event.deltaMode === 1 || event.deltaMode === 2 || x < .75 && y >= 48 && integerY && Number.isInteger(event.deltaX);
    if (wheelZoom) invoke(() => navigate('zoomBy', event.deltaY < 0 ? 1.12 : 1 / 1.12));
    else {const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, svg.getBoundingClientRect().height * .8) : 1; invoke(() => navigate('panPixels', {dx: event.deltaX * multiplier, dy: event.deltaY * multiplier}));}
  }, {passive: false});
  function handleEscape() {if (gesture) {const placement = gesture.placement; cancelGesture(); if (placement) invoke(() => onCancelPlacement?.()); return true;} if (!disposed && read().active && getPlacement()) {invoke(() => onCancelPlacement?.()); return true;} if (!disposed && read().active) {invoke(() => onReturn?.()); return true;} return false;}
  element.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') clearClickGuard();}, true);
  element.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {if (handleEscape()) consume(event); return;}
    if (event.target.matches?.('input,textarea,select,[contenteditable=true]') || !operable()) return; const delta = {ArrowLeft: {dx: 42, dy: 0}, ArrowRight: {dx: -42, dy: 0}, ArrowUp: {dx: 0, dy: 42}, ArrowDown: {dx: 0, dy: -42}}[event.key];
    if (delta) {consume(event); invoke(() => navigate('panPixels', delta));}
  });
  function label(parent, text, {x = 0, y = 32, width, visible = true} = {}) {
    const info = markerLabel(text), group = svgNode(doc, 'g', {class: 'sv3-plan-marker-label', opacity: visible ? 1 : 0, 'pointer-events': 'none'}, parent);
    const foreign = svgNode(doc, 'foreignObject', {x: x - (width ?? info.width) / 2, y: y - 14, width: width ?? info.width, height: 28}, group), div = doc.createElementNS(XHTML_NS, 'div'); div.setAttribute('class', 'sv3-plan-status-chip'); div.textContent = info.label; foreign.append(div); return group;
  }
  function renderMarker(marker, node) {
    node.dataset.markerId = marker.id; node.dataset.selected = String(!!marker.selected); node.dataset.planViewHitPriority = marker.kind === 'camera' && marker.selected ? '30' : marker.selected ? '20' : '10';
    node._planMarker = marker; if (!node._planListening) {node.addEventListener('pointerdown', event => beginMarker(event, node._planMarker)); node._planListening = true;}
    node.onclick = event => {event.stopPropagation(); if (marker.pathSelection) {if (operable()) {const {path, key} = marker.pathSelection, context = {pathId: path.id, entityId: path.entityId, kind: 'key', keyId: key.keyId ?? key.id, clientX: event.clientX, clientY: event.clientY, event}; invoke(() => key.selected ? onPathContextMenu?.(context) : onPathSelect?.(context));}} else if (operable() && liveMarker(marker.id)) invoke(() => onSelect?.(marker.id, liveMarker(marker.id), event));};
    const position = projectPlanPoint(snapshot.projection, marker.position); if (!position) {set(node, {opacity: 0, 'pointer-events': 'none'}); return;} set(node, {transform: `translate(${position.x},${position.y})`, opacity: position.inView ? marker.opacity ?? 1 : 0, 'pointer-events': position.inView ? 'auto' : 'none'});
    const color = marker.color || colors[marker.kind], outline = outlineColor(color), selected = !!marker.selected, edit = editable(marker);
    const preview = gesture?.marker?.id === marker.id || gesture?.renderedMarkerId === marker.id ? gesture.preview : null, heading = marker.heading ?? 0;
    // Rendered projection changes every frame. Preserve glyph/hit DOM while updating
    // its transform, so a live pointer target survives navigation and domain previews.
    const visualKey = JSON.stringify([marker.kind, color, selected, edit, marker.label, marker.camera, marker.fovPresentation, preview, preview ? [gesture.latest.clientX, gesture.latest.clientY, position.x, position.y] : null]);
    if (node._visualKey === visualKey) {set(node.querySelector('.sv3-plan-marker-rotator'), {transform: `rotate(${screenHeading(snapshot.projection, heading) * 180 / Math.PI})`}); return;}
    node._visualKey = visualKey; node.replaceChildren();
    svgNode(doc, 'circle', {class: 'sv3-plan-marker-hit', r: marker.kind === 'camera' ? 24 : 22, fill: 'transparent'}, node);
    const visual = svgNode(doc, 'g', {class: 'sv3-plan-marker-visual', transform: `scale(${PLAN_SCALE})`}, node);
    const rotator = svgNode(doc, 'g', {class: 'sv3-plan-marker-rotator', transform: `rotate(${screenHeading(snapshot.projection, heading) * 180 / Math.PI})`}, visual);
    if (marker.kind === 'camera') {
      const ratio = marker.camera?.frameAspectRatio ?? 1.5, fov = preview?.fov ?? marker.camera?.fov ?? 45, geometry = fovGeometry(fov, ratio, selected ? 1040 : 48);
      const defs = svgNode(doc, 'defs', {}, visual), gradientId = `sv3-plan-fov-${++sequence}`, gradient = svgNode(doc, 'radialGradient', {id: gradientId, cx: 0, cy: 0, r: selected ? 390 : 48, gradientUnits: 'userSpaceOnUse'}, defs);
      for (const [offset, opacity] of [[0, selected ? .24 : .34], [46, selected ? .12 : .17], [100, 0]]) svgNode(doc, 'stop', {offset: `${offset}%`, 'stop-color': color, 'stop-opacity': opacity}, gradient);
      const fovDisplay = svgNode(doc, 'g', {class: 'sv3-plan-camera-fov-display', transform: preview ? `rotate(${(preview.heading - heading) * 180 / Math.PI})` : 'rotate(0)'}, rotator);
      if (marker.fovPresentation !== 'hidden') svgNode(doc, 'path', {class: 'sv3-plan-camera-fov-fill', d: geometry.path, fill: `url(#${gradientId})`, 'pointer-events': 'none'}, fovDisplay);
      if (selected && marker.fovPresentation !== 'hidden') for (const edge of ['left', 'right']) {
        const ray = geometry[edge]; svgNode(doc, 'line', {x1: 0, y1: 0, x2: ray.x, y2: ray.y, stroke: color, 'stroke-width': .8, 'pointer-events': 'none'}, fovDisplay);
        const length = Math.hypot(ray.x, ray.y), handle = svgNode(doc, 'g', {class: 'sv3-plan-fov-handle', 'data-fov-edge': edge, 'data-plan-view-hit-priority': marker.pathSelection ? 45 : 40, transform: `translate(${ray.x * 66 / length},${ray.y * 66 / length}) rotate(${Math.atan2(ray.y, ray.x) * 180 / Math.PI})`, 'pointer-events': edit ? 'auto' : 'none'}, fovDisplay);
        const hit = svgNode(doc, 'rect', {x: -15, y: -12, width: 30, height: 24, rx: 12, fill: 'transparent'}, handle); hit.style.cursor = FOV_CURSOR;
        handle.addEventListener('pointerdown', event => beginMarker(event, node._planMarker, 'fov', edge));
        svgNode(doc, 'rect', {x: -8.5, y: -3.5, width: 17, height: 7, rx: 3.5, fill: color, stroke: outline, 'stroke-width': 1, 'pointer-events': 'none', class: 'sv3-plan-handle-core'}, handle);
        svgNode(doc, 'line', {x1: -4.5, y1: 0, x2: 4.5, y2: 0, stroke: outline, 'stroke-width': 1.2, 'stroke-linecap': 'round', 'pointer-events': 'none'}, handle);
      }
      const glyph = svgNode(doc, 'g', {class: 'sv3-plan-camera-glyph', transform: 'rotate(-90) scale(.68)'}, rotator);
      for (const d of [CAMERA_LENS, CAMERA_BODY]) svgNode(doc, 'path', {d, fill: color, stroke: outline, 'stroke-width': 1.2}, glyph);
      if (selected) for (const d of [CAMERA_LENS, CAMERA_BODY]) svgNode(doc, 'path', {class: 'sv3-plan-selection', d, fill: 'none', stroke: gold, 'stroke-width': 1.55, 'pointer-events': 'none'}, glyph);
      if (preview && ['fov', 'key-fov'].includes(gesture?.kind)) {const rect = svg.getBoundingClientRect(), event = gesture.latest; label(node, fovReadout(fov, ratio), {x: (event.clientX - rect.left) * snapshot.projection.width / rect.width - position.x + 18 * PLAN_SCALE, y: (event.clientY - rect.top) * snapshot.projection.height / rect.height - position.y - 22 * PLAN_SCALE, width: Math.max(104, fovReadout(fov, ratio).length * 8.5 + 28)});}
    } else {
      const core = marker.kind === 'person' ? ['circle', {r: 7.1}] : ['rect', {x: -4.8, y: -4.8, width: 9.6, height: 9.6, rx: 2}];
      svgNode(doc, core[0], {...core[1], class: 'sv3-plan-marker-core', fill: color, stroke: outline, 'stroke-width': 1.05}, visual);
      if (selected) svgNode(doc, core[0], {...core[1], class: 'sv3-plan-selection', fill: 'none', stroke: gold, 'stroke-width': 1.7, 'pointer-events': 'none'}, visual);
    }
    const direction = svgNode(doc, 'g', {class: 'sv3-plan-direction', opacity: selected ? 1 : .3, 'data-plan-kind': 'heading', 'pointer-events': selected && edit ? 'auto' : 'none'}, rotator); direction.style.cursor = HEADING_CURSOR; direction.addEventListener('pointerdown', event => beginMarker(event, node._planMarker, 'heading'));
    for (const [size, fill, opacity] of [[6.85, outline, 1], [7.25, gold, selected ? 1 : 0], [5.8, color, 1]]) svgNode(doc, 'path', {d: `M 0 ${-17 - size} L ${-size} -17 L ${size} -17 Z`, fill, opacity}, direction);
    if (marker.label) label(node, marker.label, {visible: selected});
  }
  function prune(map, ids) {for (const [id, node] of map) if (!ids.has(id)) {node.remove(); map.delete(id);}}
  function screenPoint(event) {const rect = svg.getBoundingClientRect(); return {x: (event.clientX - rect.left) * displayedProjection.width / rect.width, y: (event.clientY - rect.top) * displayedProjection.height / rect.height};}
  function pathData(path) {
    const project = value => projectPlanPoint(displayedProjection, value), commands = [], samples = [];
    if (path.segments?.length) for (const segment of path.segments) {
      if (segment.interpolation === 'hold') continue;
      const points = (segment.points || []).map(project).filter(Boolean);
      if (points.length >= 2) {commands.push(`M ${points[0].x} ${points[0].y}`, ...points.slice(1).map(value => `L ${value.x} ${value.y}`)); samples.push(...points); continue;}
      const [a, b, c, d] = [segment.p0, segment.p1, segment.p2, segment.p3].map(value => value && project(value));
      if (!a || !d) continue; commands.push(`M ${a.x} ${a.y}`, b && c ? `C ${b.x} ${b.y} ${c.x} ${c.y} ${d.x} ${d.y}` : `L ${d.x} ${d.y}`); samples.push(a, d);
    } else {const points = (path.points || []).map(project).filter(Boolean); if (points.length >= 2) {commands.push(`M ${points[0].x} ${points[0].y}`, ...points.slice(1).map(value => `L ${value.x} ${value.y}`)); samples.push(...points);}}
    return {d: commands.join(' '), samples};
  }
  function renderPaths(items) {
    const legacy = items.flatMap(marker => (marker.paths || []).map(path => ({...path, entityId: marker.id, kind: marker.kind, color: path.color || marker.color || colors[marker.kind]})));
    const values = [...legacy, ...getPaths()].filter(path => path.visible !== false), ids = new Set(), controlIds = new Set(), keyIds = new Set();
    for (const path of values) {
      const id = `${path.entityId || ''}:${path.id}`; ids.add(id); let node = pathNodes.get(id);
      if (!node) {
        node = svgNode(doc, 'g', {class: 'sv3-plan-path', 'data-path-id': path.id}, paths); pathNodes.set(id, node);
        const defs = svgNode(doc, 'defs', {}, node), gradient = svgNode(doc, 'linearGradient', {id: `sv3-plan-path-direction-${++sequence}`, gradientUnits: 'userSpaceOnUse', class: 'sv3-plan-path-gradient'}, defs);
        svgNode(doc, 'stop', {offset: '0%'}, gradient); svgNode(doc, 'stop', {offset: '100%', 'stop-color': '#fff'}, gradient);
        for (const role of ['underlay', 'core', 'hit']) svgNode(doc, 'path', {class: `sv3-plan-path-${role}`, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': role === 'hit' ? 'stroke' : 'none', 'data-plan-view-hit-priority': role === 'hit' ? 10 : undefined}, node);
        svgNode(doc, 'g', {class: 'sv3-plan-path-holds', 'pointer-events': 'none'}, node);
        const playhead = svgNode(doc, 'g', {class: 'sv3-plan-path-playhead', 'pointer-events': 'none'}, node);
        svgNode(doc, 'circle', {class: 'sv3-plan-playhead-ring', fill: '#18191c', 'stroke-width': 1.7}, playhead); svgNode(doc, 'circle', {r: 1.7, class: 'sv3-plan-playhead-center', opacity: .92}, playhead);
        node.addEventListener('pointerenter', () => {hoveredPath = node._path.id; refresh();}); node.addEventListener('pointerleave', () => {if (hoveredPath === node._path.id) hoveredPath = null; refresh();});
        node.querySelector('.sv3-plan-path-hit').addEventListener('pointerdown', event => {const path = node._path, hit = nearestPathSample(path.segments, value => projectPlanPoint(displayedProjection, value), screenPoint(event)); if (hit) beginPathGesture(event, path, 'path', {...hit.segment, t: hit.t, timeMs: hit.timeMs}, hit.position);});
      }
      node._path = path; const color = path.color || colors[path.kind] || gold, selected = !!path.selected, hovered = hoveredPath === path.id || path.hovered, rhythm = selected || hovered || path.rhythmVisible;
      const {d, samples} = pathData(path), width = path.strokeWidth ?? 2.8, gradient = node.querySelector('.sv3-plan-path-gradient');
      set(node, {'data-selected': selected, 'data-hovered': !!hovered, opacity: path.opacity ?? 1});
      const start = samples[0], end = samples.at(-1); if (start && end) set(gradient, {x1: start.x, y1: start.y, x2: end.x, y2: end.y}); set(gradient.firstElementChild, {'stop-color': color, 'stop-opacity': selected ? 1 : hovered ? .92 : .67});
      set(node.querySelector('.sv3-plan-path-underlay'), {d, stroke: 'rgba(0,0,0,.38)', 'stroke-width': width + 3.2, opacity: selected ? .34 : hovered ? .24 : path.dashed ? .42 : 0, 'stroke-dasharray': path.dashed ? '9 7' : ''});
      set(node.querySelector('.sv3-plan-path-core'), {d, stroke: path.dashed || !start || !end ? color : `url(#${gradient.id})`, 'stroke-width': width, opacity: selected ? .9 : hovered ? .78 : .72, 'stroke-dasharray': path.dashed ? '9 7' : ''});
      set(node.querySelector('.sv3-plan-path-hit'), {d, stroke: 'transparent', 'stroke-width': Math.max(26, width + 18), 'pointer-events': path.readOnly || path.locked || typeof beginPathEdit !== 'function' ? 'none' : 'stroke'});
      const holds = path.holds || (path.segments || []).filter(segment => segment.interpolation === 'hold').map(segment => ({point: segment.p0})); const holdLayer = node.querySelector('.sv3-plan-path-holds');
      while (holdLayer.children.length > holds.length) holdLayer.lastElementChild.remove();
      holds.forEach((hold, index) => {let group = holdLayer.children[index]; if (!group) {group = svgNode(doc, 'g', {class: 'sv3-plan-path-hold'}, holdLayer); svgNode(doc, 'circle', {fill: '#18191c', 'stroke-width': 1.45}, group); svgNode(doc, 'path', {d: 'M -2.4 -2.8 V 2.8 M 2.4 -2.8 V 2.8', stroke: '#fff', 'stroke-width': 1.45, 'stroke-linecap': 'round', opacity: .9}, group);} const pos = projectPlanPoint(displayedProjection, hold.point || hold.position); set(group, {opacity: rhythm && pos?.inView ? selected ? .88 : .58 : 0, transform: pos ? `translate(${pos.x},${pos.y})` : ''}); set(group.firstElementChild, {r: selected ? 6.6 : 5.4, stroke: color});});
      const play = path.playhead && projectPlanPoint(displayedProjection, path.playhead.position || path.playhead.point), playNode = node.querySelector('.sv3-plan-path-playhead'); set(playNode, {opacity: rhythm && play?.inView ? selected ? .96 : .74 : 0, transform: play ? `translate(${play.x},${play.y})` : ''}); set(playNode.firstElementChild, {r: selected ? 5.1 : 4.2, stroke: color}); set(playNode.lastElementChild, {fill: color});
      for (const control of path.controls || []) renderPathHandle(path, control, control.kind, control.position, controls, controlNodes, controlIds, color);
      for (const key of path.keys || []) renderPathHandle(path, key, 'key', key.position, keys, keyNodes, keyIds, color);
    }
    prune(pathNodes, ids); prune(controlNodes, controlIds); prune(keyNodes, keyIds);
  }
  function renderPathHandle(path, item, kind, position, layer, map, ids, color) {
    const id = `${path.id}:${item.id || item.keyId}:${kind}`; ids.add(id); let node = map.get(id);
    if (kind === 'key') {
      if (!node) {
        node = svgNode(doc, 'g', {class: 'sv3-plan-path-handle sv3-plan-path-key', 'data-path-id': path.id}, layer); map.set(id, node);
        svgNode(doc, 'g', {class: 'sv3-plan-key-marker sv3-plan-marker'}, node);
        node.addEventListener('pointerdown', event => beginPathGesture(event, node._path, 'key', node._item, node._item.position));
        node.addEventListener('click', event => {consume(event); if (operable()) {const context = {pathId: node._path.id, entityId: node._path.entityId, kind: 'key', keyId: node._item.keyId ?? node._item.id, clientX: event.clientX, clientY: event.clientY, event}; invoke(() => node._item.selected ? onPathContextMenu?.(context) : onPathSelect?.(context));}});
        node.addEventListener('contextmenu', event => {consume(event); if (operable()) invoke(() => onPathContextMenu?.({pathId: node._path.id, entityId: node._path.entityId, kind: 'key', keyId: node._item.keyId ?? node._item.id, clientX: event.clientX, clientY: event.clientY, event}));});
      }
      node._path = path; node._item = item;
      renderMarker({id: `trajectory:${path.id}:${item.keyId ?? item.id}`, kind: path.kind, color, selected: item.selected, label: item.label || path.label, position, heading: item.heading, camera: item.camera, locked: path.locked, readOnly: path.readOnly, pathSelection: {path, key: item}}, node.firstElementChild);
      set(node.firstElementChild, {'data-plan-view-hit-priority': 45});
      set(node, {'data-key-id': item.keyId ?? item.id, 'data-plan-view-hit-priority': 45, 'data-selected': !!item.selected});
      return;
    }
    if (!node) {
      node = svgNode(doc, 'g', {class: `sv3-plan-path-handle sv3-plan-path-${kind}`, 'data-path-id': path.id, 'data-plan-view-hit-priority': kind === 'key' ? 45 : 35}, layer); map.set(id, node);
      svgNode(doc, 'line', {class: 'sv3-plan-proxy-connector', x1: 0, y1: 0, 'stroke-width': 1, 'stroke-dasharray': '3 3', 'pointer-events': 'none'}, node);
      svgNode(doc, 'circle', {class: 'sv3-plan-path-handle-hit', r: kind === 'key' ? 22 : 18, fill: 'transparent'}, node);
      if (kind === 'bend') svgNode(doc, 'rect', {class: 'sv3-plan-path-handle-core', x: -4.5, y: -4.5, width: 9, height: 9, rx: 1.25, transform: 'rotate(45)', 'stroke-width': 1.5, 'pointer-events': 'none'}, node);
      else svgNode(doc, 'circle', {class: 'sv3-plan-path-handle-core', r: 6, 'stroke-width': 2, 'pointer-events': 'none'}, node);
      node.addEventListener('pointerdown', event => beginPathGesture(event, node._path, kind, node._item, node._item.position));
      node.addEventListener('click', event => {consume(event); if (operable()) {const context = {pathId: node._path.id, entityId: node._path.entityId, kind, keyId: kind === 'key' ? node._item.keyId ?? node._item.id : undefined, clientX: event.clientX, clientY: event.clientY, event}; invoke(() => kind === 'key' && node._item.selected ? onPathContextMenu?.(context) : onPathSelect?.(context));}});
      node.addEventListener('contextmenu', event => {consume(event); if (operable() && kind !== 'endpoint') invoke(() => onPathContextMenu?.({pathId: node._path.id, entityId: node._path.entityId, kind, keyId: kind === 'key' ? node._item.keyId ?? node._item.id : undefined, fromKeyId: node._item.fromKeyId, toKeyId: node._item.toKeyId, clientX: event.clientX, clientY: event.clientY, event}));});
    }
    node._path = path; node._item = item; const projected = projectPlanPoint(displayedProjection, position);
    if (!projected) {set(node, {opacity: 0}); return;}
    const proxy = kind === 'key' ? projected : pathControlProxy(projected, (item.screenProxy?.anchors || [item.anchor].filter(Boolean)).map(value => projectPlanPoint(displayedProjection, value)).filter(Boolean), item.screenProxy?.fallbackPoint && projectPlanPoint(displayedProjection, item.screenProxy.fallbackPoint));
    set(node, {transform: `translate(${proxy.x},${proxy.y})`, opacity: projected.inView ? 1 : 0, 'data-key-id': kind === 'key' ? item.keyId ?? item.id : '', 'data-control-id': kind !== 'key' ? item.id : '', 'data-selected': !!item.selected, 'pointer-events': path.readOnly || path.locked ? 'none' : 'auto'});
    set(node.querySelector('.sv3-plan-proxy-connector'), {x2: projected.x - proxy.x, y2: projected.y - proxy.y, stroke: color, 'stroke-opacity': .72, visibility: proxy.proxied ? 'visible' : 'hidden'});
    for (const core of node.querySelectorAll('.sv3-plan-path-handle-core')) set(core, {stroke: item.selected ? gold : kind === 'bend' ? '#18191c' : kind === 'key' ? outlineColor(color) : color, fill: kind === 'bend' || kind === 'key' ? color : '#18191c'});
  }
  function renderFovHits(items) {
    const ids = new Set();
    for (const marker of items) {
      if (marker.kind !== 'camera' || !marker.selected || marker.fovPresentation === 'hidden') continue;
      ids.add(marker.id); let node = fovNodes.get(marker.id); if (!node) {node = svgNode(doc, 'g', {'data-marker-id': marker.id}, fovs); fovNodes.set(marker.id, node); for (const edge of ['left', 'right']) {const hit = svgNode(doc, 'rect', {x: -15, y: -12, width: 30, height: 24, rx: 12, fill: 'transparent', 'data-fov-edge': edge, 'data-plan-view-hit-priority': 40}, node); hit.style.cursor = FOV_CURSOR; hit.addEventListener('pointerdown', event => beginMarker(event, node._marker, 'fov', edge));}}
      node._marker = marker; const position = projectPlanPoint(displayedProjection, marker.position), preview = gesture?.marker?.id === marker.id ? gesture.preview : null, heading = preview?.heading ?? marker.heading ?? 0, geometry = fovGeometry(preview?.fov ?? marker.camera?.fov ?? 45, marker.camera?.frameAspectRatio ?? 1.5, 1040);
      set(node, {transform: `translate(${position.x},${position.y}) rotate(${screenHeading(displayedProjection, heading) * 180 / Math.PI}) scale(${PLAN_SCALE})`, 'pointer-events': editable(marker) ? 'auto' : 'none', opacity: position.inView ? 1 : 0});
      for (const hit of node.children) {const ray = geometry[hit.dataset.fovEdge], length = Math.hypot(ray.x, ray.y); set(hit, {transform: `translate(${ray.x * 66 / length},${ray.y * 66 / length}) rotate(${Math.atan2(ray.y, ray.x) * 180 / Math.PI})`});}
    }
    prune(fovNodes, ids);
  }
  function refresh() {
    if (disposed) return; snapshot = read(); const ready = renderReady(), interactive = operable();
    if (gesture && !gesture.cancelled && !valid(gesture)) cancelGesture();
    element.hidden = !snapshot.active; element.tabIndex = interactive ? 0 : -1; element.dataset.ready = String(ready); element.dataset.interactive = String(interactive); element.dataset.failed = String(!!snapshot.error); element.setAttribute('aria-busy', String(!!snapshot.active && !ready && !snapshot.error));
    loading.hidden = !snapshot.active || ready || !!snapshot.error; failure.hidden = !snapshot.active || !snapshot.error; nav.hidden = section.hidden = !ready; svg.style.opacity = ready ? '1' : '0'; svg.style.pointerEvents = ready ? '' : 'none';
    for (const button of buttons) button.disabled = !interactive; slider.disabled = !interactive;
    zoom.textContent = `${Number(snapshot.zoom ?? 1).toFixed(1)}x`; const height = snapshot.sectionHeight ?? 1.6; slider.value = String(sectionSliderValue(height)); slider.setAttribute('aria-valuetext', height === 'all' || height === Infinity ? '显示全部' : sectionText(height).replace('剖切高度 ', '')); sectionLabel.textContent = sectionText(height); sectionLabel.style.bottom = `clamp(8px, ${Number(slider.value) * 100}%, calc(100% - 8px))`;
    const placement = getPlacement(); placementInstruction.hidden = !ready || !placement; placementInstruction.textContent = placement?.kind === 'camera' ? '点击可以放置机位，拖动可以设置朝向' : '点击可以放置，拖动可以设置朝向';
    if (!ready) {displayedProjection = null; return;}
    displayedProjection = snapshot.projection;
    set(svg, {viewBox: `0 0 ${snapshot.projection.width} ${snapshot.projection.height}`});
    const items = getMarkers().filter(marker => marker.visible !== false && colors[marker.kind] && marker.position), ids = new Set(items.map(marker => marker.id));
    for (const [id, node] of nodes) if (!ids.has(id)) {node.remove(); nodes.delete(id);}
    items.sort((a, b) => (a.kind === 'camera' && a.selected ? 30 : a.selected ? 20 : 10) - (b.kind === 'camera' && b.selected ? 30 : b.selected ? 20 : 10));
    for (const marker of items) {let node = nodes.get(marker.id); if (!node) {node = svgNode(doc, 'g', {class: 'sv3-plan-marker'}, markers); nodes.set(marker.id, node);} renderMarker(marker, node);}
    // Do not reinsert stable marker groups every frame: native pointerdown/up
    // must retain a connected target until the browser synthesizes its click.
    for (let index = 0; index < items.length; index++) {const node = nodes.get(items[index].id), at = markers.children[index]; if (!gesture && at !== node) markers.insertBefore(node, at || null);}
    renderPaths(items); renderFovHits(items);
  }
  function dispose() {if (disposed) return; cancelGesture(); disposed = true; clearClickGuard(); element.remove(); nodes.clear();}
  refresh(); return {element, refresh, handleEscape, dispose, cancelGesture};
}
