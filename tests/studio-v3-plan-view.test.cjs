const test = require('node:test'), assert = require('node:assert/strict'), {readFileSync} = require('node:fs'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom'); if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modules = Promise.all([import('../src/features/studio-v3/plan-view.mjs'), import('../src/features/studio-v3/plan-projection.mjs'), import('../src/features/studio-v3/plan-geometry.mjs')]);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {resolve, promise};}
async function fixture(overrides = {}) {
  const [view, projection, geometry] = await modules, dom = new JSDOM('<head></head><body><main></main></body>', {pretendToBeVisual: true}), calls = [], errors = [];
  let state = {active: true, ready: true, error: null, projection: projection.createPlanProjection({bounds: {min: {x: -5, y: 0, z: -4}, max: {x: 5, y: 4, z: 4}}, width: 560, height: 420}), zoom: 1, rotation: 0, sectionHeight: 1.6, sourceKey: 'room', sceneRevision: 1};
  let markers = [{id: 'person', kind: 'person', position: {x: 0, y: 2, z: 0}, heading: 0, label: '演员甲', selected: true}, {id: 'object', kind: 'object', position: {x: 2, y: .6, z: 0}, heading: .3, label: '餐椅'}, {id: 'camera', kind: 'camera', position: {x: -2, y: 1.6, z: 0}, heading: 0, label: '摄像机 1', selected: false, camera: {fov: 45, frameAspectRatio: 16 / 9, focalLength: 24}}];
  const navigation = Object.fromEntries(['panPixels', 'zoomBy', 'rotateBy', 'setSection', 'reset', 'retry'].map(name => [name, value => {calls.push([name, value]);}]));
  const lease = {onMove(value) {calls.push(['move', value]); return overrides.move?.(value);}, onEnd() {calls.push(['end']); return overrides.end?.();}, onCancel() {calls.push(['cancel']); return overrides.cancel?.();}};
  const panel = view.createPlanView({container: dom.window.document.querySelector('main'), getSnapshot: () => state, getMarkers: () => markers.map(marker => ({...marker})), getNavigation: () => navigation,
    onSelect(id) {calls.push(['select', id]);}, onContextMenu(context) {calls.push(['context', context]);}, beginEdit(args) {calls.push(['begin', args]); return overrides.begin ? overrides.begin(args, lease) : lease;}, onReturn() {calls.push(['return']);}, onError(error) {errors.push(error);}});
  const svg = panel.element.querySelector('svg.sv3-plan-svg'); svg.getBoundingClientRect = () => ({left: 10, top: 20, width: 560, height: 420});
  function pointer(target, type, x = 290, y = 230, extra = {}) {const event = new dom.window.MouseEvent(type, {clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...extra}); Object.defineProperty(event, 'pointerId', {value: extra.pointerId ?? 7}); Object.defineProperty(event, 'isPrimary', {value: extra.isPrimary ?? true}); target.dispatchEvent(event); return event;}
  function key(target, key) {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}); target.dispatchEvent(event); return event;}
  function wheel(extra) {const event = new dom.window.WheelEvent('wheel', {bubbles: true, cancelable: true, ...extra}); panel.element.dispatchEvent(event); return event;}
  return {click: target => target.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true})), panel, dom, svg, calls, errors, lease, geometry, projection, pointer, key, wheel, marker: id => panel.element.querySelector(`[data-marker-id="${id}"]`), button: label => panel.element.querySelector(`button[aria-label="${label}"]`), get markers() {return markers;}, get state() {return state;}, update(patch) {state = {...state, ...patch}; panel.refresh();}, updateMarker(id, patch) {markers = markers.map(marker => marker.id === id ? {...marker, ...patch} : marker); panel.refresh();}, remove(id) {markers = markers.filter(marker => marker.id !== id); panel.refresh();}, finish() {panel.dispose(); dom.window.close();}};
}

test('source-grounded glyph, fixed scale, labels, priority, controls and nonlinear section', async () => {
  const f = await fixture(); try {
    assert.equal(f.marker('person').querySelector('.sv3-plan-marker-visual').getAttribute('transform'), 'scale(1.55)');
    assert.equal(f.marker('person').querySelector('.sv3-plan-marker-core').getAttribute('r'), '7.1'); assert.equal(f.marker('object').querySelector('.sv3-plan-marker-core').getAttribute('width'), '9.6');
    assert.equal(f.marker('camera').querySelector('.sv3-plan-camera-glyph').getAttribute('transform'), 'rotate(-90) scale(.68)'); assert(f.marker('camera').querySelector(`path[d="${f.geometry.CAMERA_BODY}"]`));
    assert.equal(f.marker('person').querySelector('foreignObject').getAttribute('y'), '18'); assert.equal(f.marker('person').querySelector('foreignObject div').textContent, '演员甲');
    f.updateMarker('camera', {selected: true}); assert.equal(f.panel.element.querySelector('.sv3-plan-markers').lastElementChild.dataset.markerId, 'camera'); assert.equal(f.marker('camera').querySelector('[data-fov-edge]').dataset.planViewHitPriority, '40');
    assert.equal(f.button('左旋').querySelector('svg').getAttribute('stroke-width'), '1.75'); assert.equal(f.button('放大').querySelector('svg').getAttribute('width'), '16');
    assert.equal(f.panel.element.querySelector('img').getAttribute('src'), '/assets/branding/freenow-mark.svg');
    const slider = f.panel.element.querySelector('input'); assert.equal(slider.value, '0.5'); assert.equal(slider.step, '.001'); slider.value = '1'; slider.dispatchEvent(new f.dom.window.Event('input')); assert.deepEqual(f.calls.at(-1), ['setSection', 'all']);
    slider.value = '.75'; slider.dispatchEvent(new f.dom.window.Event('input')); assert.deepEqual(f.calls.at(-1), ['setSection', 4.800000000000001]);
    const css = readFileSync(require.resolve('../src/features/studio-v3/plan-view.css'), 'utf8'); for (const rule of ['z-index:68', 'height:128px', 'backdrop-filter:blur(28px)', 'height:112px', 'font-size:15px']) assert(css.includes(rule));
  } finally {f.finish();}
});

test('move starts at >=4 px, keeps original Y, latest pointer and one commit; dragging consumes click', async () => {
  const f = await fixture(); try {
    const marker = f.marker('person'); f.pointer(marker, 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 293); await tick(); assert.equal(f.calls.length, 0);
    f.pointer(f.dom.window, 'pointermove', 294); await tick(); assert.equal(f.calls[0][0], 'begin'); assert.equal(f.calls[0][1].kind, 'move'); assert.equal(f.calls.find(call => call[0] === 'move')[1].position.y, 2);
    f.pointer(f.dom.window, 'pointermove', 310); f.pointer(f.dom.window, 'pointerup', 340); f.click(marker); assert.equal(f.calls.filter(call => call[0] === 'select').length, 0); await tick();
    const lastMove = f.calls.filter(call => call[0] === 'move').at(-1); assert.equal(lastMove[1].position.y, 2); assert(Math.abs(lastMove[1].position.x - 1.0476190476190477) < 1e-8); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
    f.click(f.marker('object')); assert.deepEqual(f.calls.at(-1), ['select', 'object']);
  } finally {f.finish();}
});

test('async begin preserves latest move and pointerup before lease resolves', async () => {
  const wait = deferred(), f = await fixture({begin: () => wait.promise}); try {
    const marker = f.marker('person'); f.pointer(marker, 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 295); await tick(); f.pointer(f.dom.window, 'pointermove', 315); f.pointer(f.dom.window, 'pointerup', 350);
    f.click(marker); assert.equal(f.calls.filter(call => call[0] === 'select').length, 0); wait.resolve(f.lease); await tick();
    assert.equal(f.calls.filter(call => call[0] === 'begin').length, 1); assert.equal(f.calls.filter(call => call[0] === 'move').length, 1); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
    assert(Math.abs(f.calls.find(call => call[0] === 'move')[1].position.x - 1.2571428571428571) < 1e-8);
  } finally {wait.resolve(f.lease); await tick(); f.finish();}
});

test('pending/active cancel, source change, readiness loss, blur and dispose roll back without old previews', async () => {
  for (const mode of ['pointer', 'escape', 'source', 'revision', 'inactive', 'projection', 'locked', 'removed', 'blur', 'dispose']) {
    const wait = deferred(), f = await fixture({begin: () => wait.promise}); try {
      f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 310); await tick();
      if (mode === 'pointer') f.pointer(f.dom.window, 'pointercancel'); else if (mode === 'escape') f.panel.handleEscape(); else if (mode === 'source') f.update({sourceKey: 'other'}); else if (mode === 'revision') f.update({sceneRevision: 2}); else if (mode === 'inactive') f.update({active: false}); else if (mode === 'projection') f.update({ready: false, projection: null}); else if (mode === 'locked') f.updateMarker('person', {locked: true}); else if (mode === 'removed') f.remove('person'); else if (mode === 'blur') f.dom.window.dispatchEvent(new f.dom.window.Event('blur')); else f.panel.dispose();
      wait.resolve(f.lease); await tick(); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1, mode); assert.equal(f.calls.filter(call => call[0] === 'move' || call[0] === 'end').length, 0, mode);
    } finally {wait.resolve(f.lease); await tick(); f.finish();}
  }
  const f = await fixture(); try {f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 310); await tick(); f.pointer(f.dom.window, 'pointercancel'); await tick(); assert.equal(f.calls.at(-1)[0], 'cancel');} finally {f.finish();}
});

test('pointer id filtering and fresh marker/projection frames preserve legitimate lease', async () => {
  const f = await fixture(); try {
    const marker = f.marker('person'); f.pointer(marker, 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 330, 230, {pointerId: 9}); await tick(); assert.equal(f.calls.length, 0);
    f.pointer(f.dom.window, 'pointermove', 310); await tick(); f.update({projection: {...f.state.projection}, rotation: .2}); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 0);
    f.pointer(f.dom.window, 'pointerup', 320, 230, {pointerId: 9}); assert.equal(f.calls.filter(call => call[0] === 'end').length, 0); f.pointer(f.dom.window, 'pointerup', 320); await tick(); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
  } finally {f.finish();}
});

test('heading handle uses world yaw and ignores points too close to original anchor', async () => {
  const f = await fixture(); try {
    const handle = f.marker('person').querySelector('[data-plan-kind=heading]'); f.pointer(handle, 'pointerdown', 290, 202); f.pointer(f.dom.window, 'pointermove', 330, 230); await tick(); f.pointer(f.dom.window, 'pointerup', 350, 230); await tick();
    assert.equal(f.calls[0][1].kind, 'heading'); assert.equal(f.calls.find(call => call[0] === 'move')[1].heading, Math.PI / 2); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
    f.pointer(f.marker('person').querySelector('[data-plan-kind=heading]'), 'pointerdown', 290, 202); f.pointer(f.dom.window, 'pointermove', 290, 230); await tick(); f.pointer(f.dom.window, 'pointerup', 290, 230); await tick(); assert.equal(f.calls.at(-1)[0], 'cancel');
  } finally {f.finish();}
});

test('FOV left/right preserves opposite ray, converts ratio, previews locally and commits final atomically', async () => {
  for (const edge of ['left', 'right']) {
    const f = await fixture(); try {
      f.updateMarker('camera', {selected: true}); const camera = f.markers.find(marker => marker.id === 'camera'), screen = f.projection.projectPlanPoint(f.state.projection, camera.position);
      const x0 = screen.x + 10, y0 = screen.y + 20, dx = edge === 'left' ? -130 : 130;
      f.pointer(f.marker('camera').querySelector(`[data-fov-edge=${edge}]`), 'pointerdown', x0 + (edge === 'left' ? -40 : 40), y0 - 80);
      f.pointer(f.dom.window, 'pointermove', x0 + dx, y0 - 100); await tick(); assert.equal(f.calls[0][1].kind, 'fov'); assert.equal(f.calls.filter(call => call[0] === 'move').length, 0); assert.match(f.marker('camera').textContent, /° · \d+mm/); assert.equal(f.marker('camera').querySelector('.sv3-plan-marker-rotator').getAttribute('transform'), 'rotate(0)'); assert.notEqual(f.marker('camera').querySelector('.sv3-plan-camera-fov-display').getAttribute('transform'), 'rotate(0)');
      f.pointer(f.dom.window, 'pointerup', x0 + dx, y0 - 90); await tick(); const changes = f.calls.filter(call => call[0] === 'move'); assert.equal(changes.length, 1); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
      const {heading, fov} = changes[0][1], half0 = f.geometry.horizontalHalfFov(45, 16 / 9), half1 = f.geometry.horizontalHalfFov(fov, 16 / 9);
      assert(Math.abs((edge === 'left' ? heading + half1 : heading - half1) - (edge === 'left' ? half0 : -half0)) < 1e-8); assert.equal(f.marker('camera').querySelector('.sv3-plan-marker-label').textContent.includes('°'), false);
    } finally {f.finish();}
  }
});

test('FOV cancellation discards preview and never calls domain move or commit', async () => {
  const f = await fixture(); try {
    f.updateMarker('camera', {selected: true}); f.pointer(f.marker('camera').querySelector('[data-fov-edge=left]'), 'pointerdown', 155, 140); f.pointer(f.dom.window, 'pointermove', 100, 150); await tick(); assert.match(f.marker('camera').textContent, /°/);
    f.panel.handleEscape(); await tick(); assert.equal(f.calls.at(-1)[0], 'cancel'); assert.equal(f.calls.filter(call => call[0] === 'move' || call[0] === 'end').length, 0); assert.equal(f.marker('camera').textContent.includes('°'), false);
  } finally {f.finish();}
});

test('navigation uses official wheel classes, arrows42, blank click, middle pan, rotation tap/drag, zoom and reset', async () => {
  const f = await fixture(); try {
    f.wheel({deltaY: 100}); assert.deepEqual(f.calls.at(-1), ['zoomBy', 1 / 1.12]); f.wheel({deltaX: 1.3, deltaY: 13.5}); assert.deepEqual(f.calls.at(-1), ['panPixels', {dx: 1.3, dy: 13.5}]); f.wheel({deltaY: -1, deltaMode: 1}); assert.deepEqual(f.calls.at(-1), ['zoomBy', 1.12]); f.wheel({deltaY: -3, ctrlKey: true}); assert.equal(f.calls.at(-1)[0], 'zoomBy');
    f.key(f.panel.element, 'ArrowLeft'); assert.deepEqual(f.calls.at(-1), ['panPixels', {dx: 42, dy: 0}]); f.key(f.panel.element, 'ArrowDown'); assert.deepEqual(f.calls.at(-1), ['panPixels', {dx: 0, dy: -42}]);
    f.pointer(f.panel.element, 'pointerdown'); f.pointer(f.dom.window, 'pointerup', 292); assert.deepEqual(f.calls.at(-1), ['select', null]); const selections = f.calls.filter(call => call[0] === 'select').length;
    f.pointer(f.panel.element, 'pointerdown', 290, 230, {button: 1}); f.pointer(f.dom.window, 'pointermove', 310, 240); f.pointer(f.dom.window, 'pointerup', 310, 240); assert.deepEqual(f.calls.at(-1), ['panPixels', {dx: 20, dy: 10}]); assert.equal(f.calls.filter(call => call[0] === 'select').length, selections);
    await tick(); f.pointer(f.button('左旋'), 'pointerdown'); f.pointer(f.dom.window, 'pointerup'); f.button('左旋').click(); assert.deepEqual(f.calls.at(-1), ['rotateBy', Math.PI / 12]); assert.equal(f.calls.filter(call => call[0] === 'rotateBy').length, 1);
    await tick(); f.pointer(f.button('右旋'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 310); f.pointer(f.dom.window, 'pointerup', 310); assert.deepEqual(f.calls.at(-1), ['rotateBy', -.16]);
    f.button('放大').click(); assert.deepEqual(f.calls.at(-1), ['zoomBy', 1.12]); f.button('重置视图').click(); assert.equal(f.calls.at(-1)[0], 'reset');
  } finally {f.finish();}
});

test('loading/error/readiness gate all hits/navigation; retry and Escape return remain explicit', async () => {
  const f = await fixture(); try {
    f.update({ready: false, projection: null}); assert.equal(f.panel.element.tabIndex, -1); assert.equal(f.panel.element.querySelector('.sv3-plan-loading').hidden, false); f.click(f.marker('person')); f.wheel({deltaY: 100}); f.key(f.panel.element, 'ArrowLeft'); assert.equal(f.calls.length, 0);
    f.update({error: 'GPU failed'}); assert.equal(f.panel.element.querySelector('.sv3-plan-error').hidden, false); f.panel.element.querySelector('.sv3-plan-retry').click(); assert.equal(f.calls.at(-1)[0], 'retry'); assert.equal(f.panel.handleEscape(), true); assert.equal(f.calls.at(-1)[0], 'return');
    f.update({active: false}); assert.equal(f.panel.element.hidden, true); assert.equal(f.panel.handleEscape(), false);
  } finally {f.finish();}
});

test('failed preview rolls back and failed cancellation keeps lease for explicit Escape retry', async () => {
  let failCancel = true; const f = await fixture({move: () => false, cancel: () => !failCancel}); try {
    f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 310); await tick(); assert(f.errors.length >= 2); assert.equal(f.calls.filter(call => call[0] === 'end').length, 0);
    failCancel = false; assert.equal(f.panel.handleEscape(), true); await tick(); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 2); assert.equal(f.panel.element.dataset.dragging, 'false');
  } finally {f.finish();}
});

test('locked/readOnly markers can be selected but never edited; context reports real world point and consumes browser menu', async () => {
  const f = await fixture(); try {
    for (const patch of [{locked: true}, {locked: false, readOnly: true}]) {f.updateMarker('person', patch); f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 320); f.pointer(f.dom.window, 'pointerup', 320); f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointerup'); f.click(f.marker('person'));} await tick(); assert.equal(f.calls.filter(call => call[0] === 'begin').length, 0); assert.equal(f.calls.filter(call => call[0] === 'select').length, 2);
    const event = f.pointer(f.marker('person'), 'contextmenu', 290, 230, {button: 2}); assert.equal(event.defaultPrevented, true); const context = f.calls.at(-1)[1]; assert.equal(context.entityId, 'person'); assert.equal(context.point.y, 2); assert.deepEqual([context.clientX, context.clientY], [290, 230]);
  } finally {f.finish();}
});

test('interactive gate preserves rendered view and own pending edit, hides live-key FOV and cancels navigation', async () => {
  const wait = deferred(), f = await fixture({begin: () => wait.promise}); try {
    const direction = f.marker('person').querySelector('[data-plan-kind=heading]'); f.update({projection: {...f.state.projection}}); assert.equal(f.marker('person').querySelector('[data-plan-kind=heading]'), direction, 'frame refresh preserves glyph hit DOM');
    f.updateMarker('camera', {selected: true, fovPresentation: 'hidden'}); assert.equal(f.marker('camera').querySelector('.sv3-plan-camera-fov-fill'), null); assert.equal(f.marker('camera').querySelector('[data-fov-edge]'), null);
    f.updateMarker('object', {visible: false}); assert.equal(f.marker('object'), null);
    f.update({interactive: false}); assert.equal(f.panel.element.querySelector('.sv3-plan-loading').hidden, true); assert.equal(f.svg.style.opacity, '1'); assert.equal(f.button('放大').disabled, true);
    f.wheel({deltaY: 100}); f.key(f.panel.element, 'ArrowLeft'); f.click(f.marker('person')); f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 330); f.pointer(f.dom.window, 'pointerup', 330); assert.equal(f.calls.length, 0);
    f.update({interactive: true}); f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 310); await tick(); f.update({interactive: false}); f.pointer(f.dom.window, 'pointerup', 340); wait.resolve(f.lease); await tick(); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 0);
    f.update({interactive: true}); f.pointer(f.panel.element, 'pointerdown'); f.update({interactive: false}); f.pointer(f.dom.window, 'pointermove', 330); assert.equal(f.calls.filter(call => call[0] === 'panPixels').length, 0);
    f.key(f.panel.element.querySelector('input'), 'Escape'); assert.equal(f.calls.at(-1)[0], 'return');
  } finally {wait.resolve(f.lease); await tick(); f.finish();}
});

test('cancellation waits for in-flight preview and cannot commit after source invalidation', async () => {
  const wait = deferred(), f = await fixture({move: () => wait.promise}); try {
    f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 320); await tick(); assert.equal(f.calls.filter(call => call[0] === 'move').length, 1);
    f.pointer(f.dom.window, 'pointerup', 340); f.update({sourceKey: 'new-scene'}); wait.resolve(true); await tick(); assert.equal(f.calls.filter(call => call[0] === 'end').length, 0); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
  } finally {wait.resolve(true); await tick(); f.finish();}
});

test('native drag without trailing click never swallows another marker while async commit is pending', async () => {
  const wait = deferred(), f = await fixture({end: () => wait.promise}); try {
    f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 320); await tick(); f.pointer(f.dom.window, 'pointerup', 340); await tick();
    assert.equal(f.calls.filter(call => call[0] === 'end').length, 1); f.click(f.marker('camera')); assert.deepEqual(f.calls.at(-1), ['select', 'camera']);
    // Legacy MouseEvent clicks have no pointerId; only the original marker is guarded.
    f.click(f.marker('person')); assert.equal(f.calls.filter(call => call[0] === 'select').length, 1);
    // An independent pointer on that same marker is still a valid selection.
    f.pointer(f.marker('person'), 'click', 340, 230, {pointerId: 9}); assert.deepEqual(f.calls.at(-1), ['select', 'person']);
  } finally {wait.resolve(true); await tick(); f.finish();}
});

test('native marker taps select on pointerup once, fresh pointerdown clears old guard and keyboard clicks remain available', async () => {
  const f = await fixture(); try {
    f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 320); await tick(); f.pointer(f.dom.window, 'pointerup', 340); await tick();
    f.pointer(f.marker('camera').querySelector('.sv3-plan-camera-glyph path'), 'pointerdown', 195, 230);
    // The descendant can disappear during a selection/optics refresh; the owned
    // pointer session still completes the camera tap without relying on native click.
    f.updateMarker('camera', {label: '改名后的摄像机'}); f.pointer(f.dom.window, 'pointerup', 195, 230);
    assert.deepEqual(f.calls.at(-1), ['select', 'camera']); f.click(f.marker('camera')); assert.equal(f.calls.filter(call => call[0] === 'select').length, 1);
    f.pointer(f.marker('camera'), 'pointerdown', 195, 230); f.pointer(f.dom.window, 'pointerup', 195, 230); f.click(f.marker('camera')); assert.equal(f.calls.filter(call => call[0] === 'select').length, 2);
    f.click(f.marker('camera')); assert.equal(f.calls.filter(call => call[0] === 'select').length, 3, 'keyboard/programmatic click works without pointer session');
  } finally {f.finish();}
});

test('successful projection frame refresh never removes or reinserts unchanged marker groups', async () => {
  const f = await fixture(); try {
    const layer = f.panel.element.querySelector('.sv3-plan-markers'), groups = [...layer.children], observer = new f.dom.window.MutationObserver(() => {}); observer.observe(layer, {childList: true});
    for (let frame = 0; frame < 10; frame++) f.update({projection: {...f.state.projection}});
    assert.equal(observer.takeRecords().length, 0); assert.deepEqual([...layer.children], groups); observer.disconnect();
  } finally {f.finish();}
});

test('omitted drag click guard expires instead of swallowing a later click on the original marker', async () => {
  const f = await fixture(); try {
    f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 320); await tick(); f.pointer(f.dom.window, 'pointerup', 340); await tick();
    await new Promise(resolve => setTimeout(resolve, 370)); f.click(f.marker('person')); assert.deepEqual(f.calls.at(-1), ['select', 'person']);
  } finally {f.finish();}
});


test('fresh keyboard activation is never treated as a rotation drag duplicate click', async () => {
  const f = await fixture(); try {
    const button = f.button('左旋'); f.pointer(button, 'pointerdown'); f.pointer(f.dom.window, 'pointerup'); assert.equal(f.calls.filter(call => call[0] === 'rotateBy').length, 1);
    f.key(button, 'Enter'); button.click(); assert.equal(f.calls.filter(call => call[0] === 'rotateBy').length, 2);
    f.pointer(button, 'pointerdown'); f.pointer(f.dom.window, 'pointerup'); f.pointer(button, 'click', 290, 230, {pointerId: -1}); assert.equal(f.calls.filter(call => call[0] === 'rotateBy').length, 4);
  } finally {f.finish();}
});
