import {projectPlanPoint, unprojectPlanPoint, sectionSliderValue, sectionHeightFromSlider} from './plan-projection.mjs';
import {PLAN_SCALE, CAMERA_LENS, CAMERA_BODY, PLAN_ICONS, HEADING_CURSOR, FOV_CURSOR, outlineColor, screenHeading, fovGeometry, editFovEdge, markerLabel, fovReadout} from './plan-geometry.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg', XHTML_NS = 'http://www.w3.org/1999/xhtml';
const colors = {person: '#66B8A6', object: '#D8B45F', camera: '#B7A66A'}, gold = '#EFD77A';
const set = (node, attrs) => {for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, String(value)); return node;};
function svgNode(doc, tag, attrs = {}, parent) {const node = set(doc.createElementNS(SVG_NS, tag), attrs); parent?.append(node); return node;}
function htmlNode(doc, tag, className, parent, text) {const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; parent?.append(node); return node;}
function rejected(result) {return result === false || result?.ok === false;}
function identity(snapshot) {return JSON.stringify([snapshot.sourceKey ?? null, snapshot.sceneRevision ?? null, snapshot.setupId ?? null]);}
function sectionText(value) {if (value === 'all' || value === Infinity) return '显示全部'; const digits = value < 1 ? 2 : value < 10 ? 1 : 0; return `剖切高度 ${Number(value.toFixed(digits))} m`;}

/** Independent plan overlay. Only the host owns renderer, navigation and author transactions. */
export function createPlanView({container, getSnapshot, getMarkers = () => [], getNavigation, onSelect, onContextMenu, beginEdit, onReturn, onError = () => {}}) {
  const doc = container.ownerDocument, win = doc.defaultView;
  if (!doc.querySelector('link[data-studio-v3-plan-view]')) {const link = htmlNode(doc, 'link', '', doc.head); link.rel = 'stylesheet'; link.href = new URL('./plan-view.css', import.meta.url).href; link.dataset.studioV3PlanView = 'true';}
  const element = htmlNode(doc, 'div', 'sv3-plan-view', container); element.dataset.testid = 'workspace-plan-view-surface'; element.dataset.worldWorkspaceBlockMovementHotkeys = 'true';
  const svg = svgNode(doc, 'svg', {class: 'sv3-plan-svg', preserveAspectRatio: 'none'}, element);
  const paths = svgNode(doc, 'g', {class: 'sv3-plan-paths', 'data-plan-view-hit-priority': 10}, svg);
  const markers = svgNode(doc, 'g', {class: 'sv3-plan-markers', 'data-plan-view-hit-priority': 20}, svg);
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
  const nodes = new Map(); let snapshot = {}, disposed = false, gesture = null, clickGuard = null, clickTimer = null, sequence = 0;
  function report(error) {try {onError(error instanceof Error ? error : new Error(String(error)));} catch { /* Feedback cannot strand pointer cleanup. */ }}
  function invoke(fn) {try {Promise.resolve(fn()).catch(report);} catch (error) {report(error);}}
  function read() {return getSnapshot?.() || {};}
  function renderReady() {const state = read(); return !disposed && state.active === true && state.ready === true && !state.error && !!state.projection;}
  function operable() {return renderReady() && read().interactive !== false;}
  function navigate(method, value) {return getNavigation?.()?.[method]?.(value);}
  function liveMarker(id) {return getMarkers().find(marker => marker.id === id);}
  function editable(marker) {return marker && !marker.locked && !marker.readOnly && typeof beginEdit === 'function';}
  function valid(session) {const state = read(), marker = session.marker ? liveMarker(session.marker.id) : null; return renderReady() && (session.marker || state.interactive !== false) && identity(state) === session.identity && (!session.marker || marker && (session.canEdit === false || editable(marker)) && marker.kind === session.marker.kind && (session.kind !== 'fov' || marker.selected && marker.fovPresentation !== 'hidden'));}
  function point(event, anchor) {const state = read(), rect = svg.getBoundingClientRect(); if (!renderReady() || rect.width <= 0 || rect.height <= 0) return null; return unprojectPlanPoint(state.projection, {nx: (event.clientX - rect.left) / rect.width, ny: (event.clientY - rect.top) / rect.height}, anchor);}
  function consume(event) {event.preventDefault(); event.stopPropagation();}
  function clearClickGuard() {clickGuard = null; if (clickTimer !== null) win.clearTimeout(clickTimer); clickTimer = null;}
  function guardClick(session) {
    clearClickGuard();
    // Native drag may omit its trailing click. Associate protection with that
    // source and pointer, rather than suppressing a later selection elsewhere.
    clickGuard = {markerId: session.marker?.id ?? null, pointerId: session.pointerId, kind: session.kind, target: session.target, expires: Date.now() + 350};
    clickTimer = win.setTimeout(clearClickGuard, 350);
  }
  function isGuardedClick(event) {
    if (!clickGuard || event.pointerId === -1) return false;
    if (Date.now() >= clickGuard.expires) {clearClickGuard(); return false;}
    if (Number.isFinite(event.pointerId) && event.pointerId > 0 && event.pointerId !== clickGuard.pointerId) return false;
    const markerId = event.target.closest?.('[data-marker-id]')?.dataset.markerId;
    if (clickGuard.markerId !== null) return markerId === clickGuard.markerId;
    if (clickGuard.kind === 'rotate') return clickGuard.target?.contains(event.target) === true;
    return !markerId && !nav.contains(event.target) && !section.contains(event.target);
  }
  function detach(session) {if (!session.listeners) return; for (const [name, handler] of Object.entries(session.listeners)) win.removeEventListener(name, handler, true); session.listeners = null; element.dataset.dragging = 'false';}
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
        if (session.kind !== 'fov' || final) {const result = await session.lease.onMove?.(change); if (rejected(result)) throw new Error(result?.message || '俯视编辑预览失败');}
        if (session.cancelled || !valid(session)) {session.cancelled = true; await rollback(session); return;}
        if (final) {const result = await session.lease.onEnd?.(); if (rejected(result)) throw new Error(result?.message || '俯视编辑提交失败'); session.lease = null; settle(session);}
      } catch (error) {report(error); session.cancelled = true; await rollback(session);}
    });
  }
  function openEdit(session) {
    session.started = true; session.pending = true; guardClick(session);
    Promise.resolve().then(() => session.cancelled || !valid(session) ? null : beginEdit({entityId: session.marker.id, kind: session.kind, marker: session.marker})).then(lease => {
      session.pending = false; session.lease = lease;
      if (!lease) {settle(session); return;}
      if (typeof lease.onMove !== 'function' || typeof lease.onEnd !== 'function' || typeof lease.onCancel !== 'function') {session.cancelled = true; report(new Error('俯视编辑事务接口无效')); rollback(session); return;}
      if (session.cancelled || !valid(session)) {session.cancelled = true; rollback(session); return;}
      queuePreview(session, session.ended);
    }).catch(error => {session.pending = false; report(error); settle(session);});
  }
  function beginMarker(event, marker, kind = 'move', edge) {
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
  element.addEventListener('pointerdown', () => {clearClickGuard(); if (operable()) element.focus({preventScroll: true});}, true);
  element.addEventListener('pointerdown', event => {if (!operable()) return; beginNavigation(event, 'pan');});
  element.addEventListener('click', event => {if (isGuardedClick(event)) {consume(event); clearClickGuard();}}, true);
  element.addEventListener('contextmenu', event => {
    consume(event); if (!operable()) return; const marker = liveMarker(event.target.closest?.('[data-marker-id]')?.dataset.markerId), world = point(event, marker?.position);
    if (world) invoke(() => onContextMenu?.({entityId: marker?.id ?? null, marker, point: world, projection: read().projection, clientX: event.clientX, clientY: event.clientY, event}));
  });
  element.addEventListener('wheel', event => {
    if (!operable() || nav.contains(event.target) || section.contains(event.target)) return; consume(event);
    const x = Math.abs(event.deltaX), y = Math.abs(event.deltaY), integerY = Number.isInteger(event.deltaY);
    const wheelZoom = event.ctrlKey || event.deltaMode === 1 || event.deltaMode === 2 || x < .75 && y >= 48 && integerY && Number.isInteger(event.deltaX);
    if (wheelZoom) invoke(() => navigate('zoomBy', event.deltaY < 0 ? 1.12 : 1 / 1.12));
    else {const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, svg.getBoundingClientRect().height * .8) : 1; invoke(() => navigate('panPixels', {dx: event.deltaX * multiplier, dy: event.deltaY * multiplier}));}
  }, {passive: false});
  function handleEscape() {if (gesture) {cancelGesture(); return true;} if (!disposed && read().active) {invoke(() => onReturn?.()); return true;} return false;}
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
    node.onclick = event => {event.stopPropagation(); if (operable() && liveMarker(marker.id)) invoke(() => onSelect?.(marker.id, liveMarker(marker.id), event));};
    const position = projectPlanPoint(snapshot.projection, marker.position); if (!position) {set(node, {opacity: 0, 'pointer-events': 'none'}); return;} set(node, {transform: `translate(${position.x},${position.y})`, opacity: position.inView ? marker.opacity ?? 1 : 0, 'pointer-events': position.inView ? 'auto' : 'none'});
    const color = marker.color || colors[marker.kind], outline = outlineColor(color), selected = !!marker.selected, edit = editable(marker);
    const preview = gesture?.marker?.id === marker.id ? gesture.preview : null, heading = marker.heading ?? 0;
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
        const length = Math.hypot(ray.x, ray.y), handle = svgNode(doc, 'g', {class: 'sv3-plan-fov-handle', 'data-fov-edge': edge, 'data-plan-view-hit-priority': 40, transform: `translate(${ray.x * 66 / length},${ray.y * 66 / length}) rotate(${Math.atan2(ray.y, ray.x) * 180 / Math.PI})`, 'pointer-events': edit ? 'auto' : 'none'}, fovDisplay);
        const hit = svgNode(doc, 'rect', {x: -15, y: -12, width: 30, height: 24, rx: 12, fill: 'transparent'}, handle); hit.style.cursor = FOV_CURSOR;
        handle.addEventListener('pointerdown', event => beginMarker(event, node._planMarker, 'fov', edge));
        svgNode(doc, 'rect', {x: -8.5, y: -3.5, width: 17, height: 7, rx: 3.5, fill: color, stroke: outline, 'stroke-width': 1, 'pointer-events': 'none', class: 'sv3-plan-handle-core'}, handle);
        svgNode(doc, 'line', {x1: -4.5, y1: 0, x2: 4.5, y2: 0, stroke: outline, 'stroke-width': 1.2, 'stroke-linecap': 'round', 'pointer-events': 'none'}, handle);
      }
      const glyph = svgNode(doc, 'g', {class: 'sv3-plan-camera-glyph', transform: 'rotate(-90) scale(.68)'}, rotator);
      for (const d of [CAMERA_LENS, CAMERA_BODY]) svgNode(doc, 'path', {d, fill: color, stroke: outline, 'stroke-width': 1.2}, glyph);
      if (selected) for (const d of [CAMERA_LENS, CAMERA_BODY]) svgNode(doc, 'path', {class: 'sv3-plan-selection', d, fill: 'none', stroke: gold, 'stroke-width': 1.55, 'pointer-events': 'none'}, glyph);
      if (preview && gesture?.kind === 'fov') {const rect = svg.getBoundingClientRect(), event = gesture.latest; label(node, fovReadout(fov, ratio), {x: (event.clientX - rect.left) * snapshot.projection.width / rect.width - position.x + 18 * PLAN_SCALE, y: (event.clientY - rect.top) * snapshot.projection.height / rect.height - position.y - 22 * PLAN_SCALE, width: Math.max(104, fovReadout(fov, ratio).length * 8.5 + 28)});}
    } else {
      const core = marker.kind === 'person' ? ['circle', {r: 7.1}] : ['rect', {x: -4.8, y: -4.8, width: 9.6, height: 9.6, rx: 2}];
      svgNode(doc, core[0], {...core[1], class: 'sv3-plan-marker-core', fill: color, stroke: outline, 'stroke-width': 1.05}, visual);
      if (selected) svgNode(doc, core[0], {...core[1], class: 'sv3-plan-selection', fill: 'none', stroke: gold, 'stroke-width': 1.7, 'pointer-events': 'none'}, visual);
    }
    const direction = svgNode(doc, 'g', {class: 'sv3-plan-direction', opacity: selected ? 1 : .3, 'data-plan-kind': 'heading', 'pointer-events': selected && edit ? 'auto' : 'none'}, rotator); direction.style.cursor = HEADING_CURSOR; direction.addEventListener('pointerdown', event => beginMarker(event, node._planMarker, 'heading'));
    for (const [size, fill, opacity] of [[6.85, outline, 1], [7.25, gold, selected ? 1 : 0], [5.8, color, 1]]) svgNode(doc, 'path', {d: `M 0 ${-17 - size} L ${-size} -17 L ${size} -17 Z`, fill, opacity}, direction);
    if (marker.label) label(node, marker.label, {visible: selected});
  }
  function renderPaths(items) {
    paths.replaceChildren();
    // Visual paths are source-grounded; edit handles/key creation are the next parity block.
    for (const marker of items) for (const path of marker.paths || []) {
      const points = (path.points || []).map(value => projectPlanPoint(snapshot.projection, value)).filter(Boolean); if (points.length < 2) continue;
      const d = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(value => `L ${value.x} ${value.y}`).join(' '), color = path.color || marker.color || colors[marker.kind], width = path.strokeWidth ?? 2.8;
      const group = svgNode(doc, 'g', {'data-path-id': path.id, opacity: path.opacity ?? (path.selected ? .96 : .72), 'pointer-events': 'none'}, paths);
      svgNode(doc, 'path', {d, fill: 'none', stroke: 'rgba(0,0,0,.38)', 'stroke-width': width + 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}, group);
      svgNode(doc, 'path', {d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': path.dashed ? '9 7' : undefined}, group);
    }
  }
  function refresh() {
    if (disposed) return; snapshot = read(); const ready = renderReady(), interactive = operable();
    if (gesture && !gesture.cancelled && !valid(gesture)) cancelGesture();
    element.hidden = !snapshot.active; element.tabIndex = interactive ? 0 : -1; element.dataset.ready = String(ready); element.dataset.interactive = String(interactive); element.dataset.failed = String(!!snapshot.error); element.setAttribute('aria-busy', String(!!snapshot.active && !ready && !snapshot.error));
    loading.hidden = !snapshot.active || ready || !!snapshot.error; failure.hidden = !snapshot.active || !snapshot.error; nav.hidden = section.hidden = !ready; svg.style.opacity = ready ? '1' : '0'; svg.style.pointerEvents = ready ? '' : 'none';
    for (const button of buttons) button.disabled = !interactive; slider.disabled = !interactive;
    zoom.textContent = `${Number(snapshot.zoom ?? 1).toFixed(1)}x`; const height = snapshot.sectionHeight ?? 1.6; slider.value = String(sectionSliderValue(height)); slider.setAttribute('aria-valuetext', height === 'all' || height === Infinity ? '显示全部' : sectionText(height).replace('剖切高度 ', '')); sectionLabel.textContent = sectionText(height); sectionLabel.style.bottom = `clamp(8px, ${Number(slider.value) * 100}%, calc(100% - 8px))`;
    if (!ready) return;
    set(svg, {viewBox: `0 0 ${snapshot.projection.width} ${snapshot.projection.height}`});
    const items = getMarkers().filter(marker => marker.visible !== false && colors[marker.kind] && marker.position), ids = new Set(items.map(marker => marker.id));
    for (const [id, node] of nodes) if (!ids.has(id)) {node.remove(); nodes.delete(id);}
    items.sort((a, b) => (a.kind === 'camera' && a.selected ? 30 : a.selected ? 20 : 10) - (b.kind === 'camera' && b.selected ? 30 : b.selected ? 20 : 10));
    for (const marker of items) {let node = nodes.get(marker.id); if (!node) {node = svgNode(doc, 'g', {class: 'sv3-plan-marker'}, markers); nodes.set(marker.id, node);} renderMarker(marker, node);}
    // Do not reinsert stable marker groups every frame: native pointerdown/up
    // must retain a connected target until the browser synthesizes its click.
    for (let index = 0; index < items.length; index++) {const node = nodes.get(items[index].id), at = markers.children[index]; if (at !== node) markers.insertBefore(node, at || null);}
    renderPaths(items);
  }
  function dispose() {if (disposed) return; cancelGesture(); disposed = true; clearClickGuard(); element.remove(); nodes.clear();}
  refresh(); return {element, refresh, handleEscape, dispose, cancelGesture};
}
