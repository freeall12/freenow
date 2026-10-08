const test = require('node:test'), assert = require('node:assert/strict'), {readFileSync} = require('node:fs'), {createRequire} = require('node:module');
const fabricRequire = createRequire(require.resolve('fabric')), canvasPath = fabricRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom'); if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
const modules = Promise.all([import('../src/features/studio-v3/plan-view.mjs'), import('../src/features/studio-v3/plan-projection.mjs'), import('../src/features/studio-v3/plan-geometry.mjs')]);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {resolve, promise};}
async function fixture(overrides = {}) {
  let placement = overrides.placement || null, trajectories = overrides.paths || [];
  const [view, projection, geometry] = await modules, dom = new JSDOM('<head></head><body><main></main></body>', {pretendToBeVisual: true}), calls = [], errors = [];
  let state = {active: true, ready: true, error: null, projection: projection.createPlanProjection({bounds: {min: {x: -5, y: 0, z: -4}, max: {x: 5, y: 4, z: 4}}, width: 560, height: 420}), zoom: 1, rotation: 0, sectionHeight: 1.6, sourceKey: 'room', sceneRevision: 1};
  let markers = [{id: 'person', kind: 'person', position: {x: 0, y: 2, z: 0}, heading: 0, label: '演员甲', selected: true}, {id: 'object', kind: 'object', position: {x: 2, y: .6, z: 0}, heading: .3, label: '餐椅'}, {id: 'camera', kind: 'camera', position: {x: -2, y: 1.6, z: 0}, heading: 0, label: '摄像机 1', selected: false, camera: {fov: 45, frameAspectRatio: 16 / 9, focalLength: 24}}];
  const navigation = Object.fromEntries(['panPixels', 'zoomBy', 'rotateBy', 'setSection', 'reset', 'retry'].map(name => [name, value => {calls.push([name, value]);}]));
  const lease = {onMove(value) {calls.push(['move', value]); return overrides.move?.(value);}, onEnd() {calls.push(['end']); return overrides.end?.();}, onCancel() {calls.push(['cancel']); return overrides.cancel?.();}};
  const panel = view.createPlanView({container: dom.window.document.querySelector('main'), getSnapshot: () => state, getMarkers: () => markers.map(marker => ({...marker})), getNavigation: () => navigation, getPlacement: () => placement, getPaths: () => trajectories, beginPlacement(args) {calls.push(['placeBegin', args]); return overrides.placeBegin ? overrides.placeBegin(args, lease) : lease;}, onCancelPlacement() {placement = null; calls.push(['placementCancel']);}, beginPathEdit(args) {calls.push(['pathBegin', args]); return overrides.pathBegin ? overrides.pathBegin(args, lease) : lease;}, onPathSelect(args) {calls.push(['pathSelect', args]);}, onPathContextMenu(args) {calls.push(['pathContext', args]);},
    onSelect(id) {calls.push(['select', id]);}, onContextMenu(context) {calls.push(['context', context]);}, beginEdit(args) {calls.push(['begin', args]); return overrides.begin ? overrides.begin(args, lease) : lease;}, onReturn() {calls.push(['return']);}, onError(error) {errors.push(error);}});
  const svg = panel.element.querySelector('svg.sv3-plan-svg'); svg.getBoundingClientRect = () => ({left: 10, top: 20, width: 560, height: 420});
  function pointer(target, type, x = 290, y = 230, extra = {}) {const event = new dom.window.MouseEvent(type, {clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...extra}); Object.defineProperty(event, 'pointerId', {value: extra.pointerId ?? 7}); Object.defineProperty(event, 'isPrimary', {value: extra.isPrimary ?? true}); target.dispatchEvent(event); return event;}
  function key(target, key) {const event = new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}); target.dispatchEvent(event); return event;}
  function wheel(extra) {const event = new dom.window.WheelEvent('wheel', {bubbles: true, cancelable: true, ...extra}); panel.element.dispatchEvent(event); return event;}
  return {click: target => target.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true})), panel, dom, svg, calls, errors, lease, geometry, projection, pointer, key, wheel, marker: id => panel.element.querySelector(`[data-marker-id="${id}"]`), button: label => panel.element.querySelector(`button[aria-label="${label}"]`), get markers() {return markers;}, get state() {return state;}, update(patch) {state = {...state, ...patch}; panel.refresh();}, updateMarker(id, patch) {markers = markers.map(marker => marker.id === id ? {...marker, ...patch} : marker); panel.refresh();}, remove(id) {markers = markers.filter(marker => marker.id !== id); panel.refresh();}, setPlacement(value) {placement = value; panel.refresh();}, setPaths(value) {trajectories = value; panel.refresh();}, finish() {panel.dispose(); dom.window.close();}};
}

const vec = (x, z = 0, y = 2) => ({x, y, z});
function trajectory() {return {id: 'track', entityId: 'person', kind: 'person', color: '#66B8A6', selected: true,
  keys: [{id: 'a', keyId: 'a', position: vec(-2), timeMs: 0}, {id: 'b', keyId: 'b', position: vec(2), timeMs: 1000}],
  segments: [{id: 'segment', fromKeyId: 'a', toKeyId: 'b', fromTimeMs: 0, toTimeMs: 1000, interpolation: 'cubic', p0: vec(-2), p1: vec(-1, -1), p2: vec(1, -1), p3: vec(2), points: [vec(-2), vec(0, -1), vec(2)], parameters: [0, .3, 1]}],
  controls: [{id: 'bend', kind: 'bend', fromKeyId: 'a', toKeyId: 'b', position: vec(0), anchor: vec(0), screenProxy: {anchors: [vec(0)], fallbackPoint: vec(2)}}], playhead: {position: vec(0, -1), timeMs: 500}};}

test('placement takes pointerdown before marker/pan; tap commits and short heading never changes it', async () => {
  const f = await fixture({placement: {kind: 'actor', label: '角色'}}); try {
    const down = f.pointer(f.marker('person'), 'pointerdown'); f.pointer(f.dom.window, 'pointerup'); await tick();
    assert.equal(down.defaultPrevented, true); assert.equal(f.calls[0][0], 'placeBegin'); assert.equal(f.calls[0][1].projection, f.state.projection); assert.equal(f.calls[0][1].point.x, 0);
    assert.equal(f.calls.filter(call => call[0] === 'end').length, 1); assert.equal(f.calls.filter(call => ['begin', 'move', 'select', 'panPixels'].includes(call[0])).length, 0);
    assert.match(f.panel.element.querySelector('.sv3-plan-placement-instruction').textContent, /点击可以放置，拖动可以设置朝向/);
    f.pointer(f.panel.element, 'pointerdown'); f.pointer(f.dom.window, 'pointermove', 330); f.pointer(f.dom.window, 'pointerup', 350); await tick();
    assert.equal(f.calls.filter(call => call[0] === 'move').at(-1)[1].heading, Math.PI / 2);
  } finally {f.finish();}
});

test('pending placement cancellation and identity loss fence late leases; Escape pending stays in plan', async () => {
  for (const mode of ['cancel', 'source', 'placement', 'escape', 'dispose']) {
    const wait = deferred(), f = await fixture({placement: {kind: 'camera'}, placeBegin: () => wait.promise}); try {
      f.pointer(f.panel.element, 'pointerdown'); await tick(); if (mode !== 'cancel') f.pointer(f.dom.window, 'pointerup', 330);
      if (mode === 'cancel') f.pointer(f.dom.window, 'pointercancel'); else if (mode === 'source') f.update({sourceKey: 'new'}); else if (mode === 'placement') f.setPlacement({kind: 'actor'}); else if (mode === 'escape') f.panel.handleEscape(); else f.panel.dispose();
      wait.resolve(f.lease); await tick(); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1, mode); assert.equal(f.calls.filter(call => call[0] === 'end' || call[0] === 'move').length, 0, mode);
    } finally {wait.resolve(f.lease); await tick(); f.finish();}
  }
  const f = await fixture({placement: {kind: 'actor'}}); try {f.panel.handleEscape(); assert.equal(f.calls.at(-1)[0], 'placementCancel'); assert.equal(f.calls.filter(call => call[0] === 'return').length, 0);} finally {f.finish();}
});

test('cubic/sampled/hold/playhead geometry, hover rhythm, hit priority and stable frame DOM', async () => {
  const path = trajectory(), f = await fixture({paths: [path]}); try {
    const node = f.panel.element.querySelector('.sv3-plan-path'), hit = node.querySelector('.sv3-plan-path-hit'); assert.match(hit.getAttribute('d'), /L/); assert.equal(hit.dataset.planViewHitPriority, '10'); assert.equal(hit.getAttribute('stroke-width'), '26');
    assert.equal(f.panel.element.querySelector('.sv3-plan-path-bend').dataset.planViewHitPriority, '35'); assert.equal(f.panel.element.querySelector('.sv3-plan-path-key').dataset.planViewHitPriority, '45');
    path.segments[0].points = undefined; f.setPaths([path]); assert.match(hit.getAttribute('d'), /C/);
    path.segments[0].interpolation = 'hold'; path.selected = false; f.setPaths([path]); assert.equal(hit.getAttribute('d'), ''); assert.equal(node.querySelector('.sv3-plan-path-hold').getAttribute('opacity'), '0');
    node.dispatchEvent(new f.dom.window.MouseEvent('pointerenter')); assert.equal(node.querySelector('.sv3-plan-path-hold').getAttribute('opacity'), '0.58'); assert.equal(node.querySelector('.sv3-plan-path-playhead').getAttribute('opacity'), '0.74');
    const observer = new f.dom.window.MutationObserver(() => {}); observer.observe(f.svg, {childList: true, subtree: true}); for (let i = 0; i < 5; i++) f.update({projection: {...f.state.projection}}); assert.equal(observer.takeRecords().length, 0); observer.disconnect();
  } finally {f.finish();}
});

test('proxy is pushed 30px with connector, keeps initial offset and original Y when dragged', async () => {
  const f = await fixture({paths: [trajectory()]}); try {
    const node = f.panel.element.querySelector('.sv3-plan-path-bend'); assert.equal(node.getAttribute('transform'), 'translate(310,210)'); assert.equal(node.querySelector('line').getAttribute('x2'), '-30'); assert.equal(node.querySelector('line').getAttribute('visibility'), 'visible');
    f.pointer(node, 'pointerdown', 320, 230); f.pointer(f.dom.window, 'pointermove', 324, 230); await tick(); f.pointer(f.dom.window, 'pointerup', 330, 230); await tick();
    assert.equal(f.calls[0][1].kind, 'bend'); const move = f.calls.filter(call => call[0] === 'move').at(-1)[1].position; assert.equal(move.y, 2); assert(Math.abs(move.x - .2095238095238095) < 1e-8); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
  } finally {f.finish();}
});

test('path click selects without editing; drag freezes cubic t from parameter samples and cancels late lease', async () => {
  const wait = deferred(), path = trajectory(), f = await fixture({paths: [path], pathBegin: () => wait.promise}); try {
    const hit = f.panel.element.querySelector('.sv3-plan-path-hit'); f.pointer(hit, 'pointerdown', 290, 182); f.pointer(f.dom.window, 'pointerup', 290, 182); await tick(); assert.equal(f.calls.at(-1)[0], 'pathSelect'); assert.equal(f.calls.filter(call => call[0] === 'pathBegin').length, 0);
    f.pointer(hit, 'pointerdown', 290, 182); f.pointer(f.dom.window, 'pointermove', 295, 190); await tick(); const request = f.calls.find(call => call[0] === 'pathBegin')[1]; assert.equal(request.kind, 'path'); assert(Math.abs(request.t - .3) < .02); assert.equal(request.fromKeyId, 'a');
    f.pointer(f.dom.window, 'pointermove', 350, 230); f.update({sceneRevision: 2}); wait.resolve(f.lease); await tick(); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1); assert.equal(f.calls.filter(call => call[0] === 'move' || call[0] === 'end').length, 0);
  } finally {wait.resolve(f.lease); await tick(); f.finish();}
});

test('key first tap selects, selected tap/context opens domain menu, bend context and endpoint isolation', async () => {
  const path = trajectory(); path.controls.push({id: 'endpoint', kind: 'endpoint', position: vec(1), anchor: vec(2), fromKeyId: 'a', toKeyId: 'b', endpoint: 'end'}); const f = await fixture({paths: [path]}); try {
    let key = f.panel.element.querySelector('[data-key-id=a]'); f.pointer(key, 'pointerdown', 195, 230); f.pointer(f.dom.window, 'pointerup', 195, 230); f.click(key); assert.equal(f.calls.filter(call => call[0] === 'pathSelect').length, 1); assert.equal(f.calls.filter(call => call[0] === 'pathContext').length, 0);
    path.keys[0].selected = true; f.setPaths([path]); f.pointer(key, 'pointerdown', 195, 230); f.pointer(f.dom.window, 'pointerup', 195, 230); f.click(key); assert.equal(f.calls.at(-1)[0], 'pathContext'); assert.equal(f.calls.at(-1)[1].entityId, 'person');
    f.pointer(f.panel.element.querySelector('.sv3-plan-path-bend'), 'contextmenu'); assert.equal(f.calls.at(-1)[1].fromKeyId, 'a'); const count = f.calls.length; f.pointer(f.panel.element.querySelector('.sv3-plan-path-endpoint'), 'contextmenu'); assert.equal(f.calls.length, count);
  } finally {f.finish();}
});

test('key heading uses the complete official glyph and sampled key anchor with final patch', async () => {
  for (const kind of ['person', 'object', 'camera']) {
    const path = trajectory(); path.kind = kind; path.keys[0] = {...path.keys[0], position: vec(1, 0, 5), selected: true, heading: .4, camera: {fov: 70, frameAspectRatio: 1}};
    const calls = [], f = await fixture({paths: [path], pathBegin: () => ({onMove: value => {calls.push(['move', value]);}, onEnd: value => {calls.push(['end', value]);}, onCancel: () => {calls.push(['cancel']);}})}); try {
      const node = f.panel.element.querySelector('[data-key-id=a]'), handle = node.querySelector('[data-plan-kind=heading]'), screen = f.projection.projectPlanPoint(f.state.projection, path.keys[0].position), x = screen.x + 10, y = screen.y + 20;
      assert(handle); assert.equal(node.dataset.planViewHitPriority, '45'); assert.equal(node.querySelector('.sv3-plan-marker-visual').getAttribute('transform'), 'scale(1.55)');
      if (kind === 'camera') assert(node.querySelector(`path[d="${f.geometry.CAMERA_BODY}"]`));
      f.pointer(handle, 'pointerdown', x, y - 35); f.pointer(f.dom.window, 'pointermove', x + 60, y); await tick(); f.pointer(f.dom.window, 'pointerup', x + 80, y); await tick();
      const request = f.calls.find(call => call[0] === 'pathBegin')[1]; assert.equal(request.kind, 'key-heading'); assert.equal(request.keyId, 'a'); assert.equal(request.position.y, 5); assert(Math.abs(calls.at(-1)[1].heading - Math.PI / 2) < 1e-8, JSON.stringify({kind, calls})); assert.equal(calls.filter(call => call[0] === 'end').length, 1); assert.equal(f.calls.filter(call => call[0] === 'begin').length, 0);
    } finally {f.finish();}
  }
});

test('key FOV uses sampled optics with RAF local preview, final atomic patch and cancel fence', async () => {
  for (const mode of ['end', 'cancel', 'selection']) {
    const path = trajectory(); path.kind = 'camera'; path.keys[0] = {...path.keys[0], position: vec(1, 1, 5), selected: true, heading: .4, camera: {fov: 70, frameAspectRatio: 1}};
    const calls = [], f = await fixture({paths: [path], pathBegin: () => ({onMove: value => {calls.push(['move', value]);}, onEnd: value => {calls.push(['end', value]);}, onCancel: () => {calls.push(['cancel']);}})}); try {
      f.updateMarker('camera', {selected: true, fovPresentation: 'hidden'}); const node = f.panel.element.querySelector('[data-key-id=a]'), handle = node.querySelector('[data-fov-edge=left]'), screen = f.projection.projectPlanPoint(f.state.projection, path.keys[0].position), x = screen.x + 10, y = screen.y + 20;
      assert.equal(f.marker('camera').querySelector('.sv3-plan-camera-fov-fill'), null); assert(node.querySelector('.sv3-plan-camera-fov-fill')); assert.equal(handle.dataset.planViewHitPriority, '45');
      f.pointer(handle, 'pointerdown', x - 40, y - 80); f.pointer(f.dom.window, 'pointermove', x - 90, y - 110); await tick(); await new Promise(resolve => f.dom.window.requestAnimationFrame(resolve));
      assert.match(node.textContent, /° · \d+mm/); assert.equal(calls.filter(call => call[0] === 'move').length, 0); assert.equal(f.calls.find(call => call[0] === 'pathBegin')[1].kind, 'key-fov');
      if (mode === 'end') {
        f.pointer(f.dom.window, 'pointerup', x - 110, y - 90); await tick(); const patch = calls.find(call => call[0] === 'end')[1], before = .4 + f.geometry.horizontalHalfFov(70, 1), after = patch.heading + f.geometry.horizontalHalfFov(patch.fov, 1); assert(Math.abs(before - after) < 1e-8); assert.equal(calls.filter(call => call[0] === 'move').length, 0); assert.equal(calls.filter(call => call[0] === 'end').length, 1);
      } else {if (mode === 'selection') {path.keys[0].selected = false; f.setPaths([path]);} else f.panel.handleEscape(); await tick(); assert.equal(calls.filter(call => call[0] === 'cancel').length, 1); assert.equal(calls.filter(call => call[0] === 'move' || call[0] === 'end').length, 0);}
    } finally {f.finish();}
  }
});
