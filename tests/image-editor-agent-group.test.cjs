const {test} = require('node:test');
const assert = require('node:assert/strict');
const stateArgs = editor => ({nodeId: 'editor', sessionId: 'group-session', expectedRevision: editor.revision});
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8, `matrix ${i}: ${value} != ${expected[i]}`));

async function setup(loadFont = async () => {}) {
  const fabric = await import('fabric');
  fabric.config.NUM_FRACTION_DIGITS = 16;
  const {createImageEditorAgent, imageEditorSourceStamp} = await import('../src/features/image-editor/agent-bridge.mjs');
  const {DocumentHistory} = await import('../image-editor-core.mjs');
  const {ensureArtworkIds} = await import('../src/features/image-editor/group-objects.mjs');
  fabric.FabricObject.customProperties = ['id', 'name', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation'];
  const a = new fabric.Rect({id: 'a', left: 10.125, top: 20.75, width: 50.5, height: 30.25, angle: 15, flipX: true});
  const b = new fabric.Rect({id: 'b', left: 150.25, top: 70.125, width: 30, height: 80});
  const inner = new fabric.Group([a, b], {id: 'inner', angle: -10, scaleX: .8, scaleY: 1.2, skewX: 8});
  const c = new fabric.Rect({id: 'c', left: 400.75, top: 100.5, width: 40, height: 20});
  const outer = new fabric.Group([inner, c], {id: 'outer', left: 90.125, top: -15.25, angle: 23, scaleX: 1.35, scaleY: .7, flipX: true, skewY: 5});
  const outside = new fabric.Rect({id: 'outside', left: 600.5, top: 300.25, width: 60, height: 40});
  const objects = [outer, outside];
  const source = {id: 'editor', tool: 'image-editor', editorDoc: {width: 800, height: 600, canvas: {objects: []}}};
  const state = {nodes: [source], view: {x: 0, y: 0, scale: 1}};
  const canvas = {getObjects: () => objects, getActiveObject: () => null, discardActiveObject() {},
    add(...items) {objects.push(...items);}, remove(...items) {for (const item of items) objects.splice(objects.indexOf(item), 1);},
    moveObjectTo(object, index) {objects.splice(objects.indexOf(object), 1); objects.splice(index, 0, object);},
    requestRenderAll() {}, setDimensions() {}, backgroundColor: '#fff'};
  const editor = {alive: true, nodeId: 'editor', sessionId: 'group-session', sourceNode: source,
    sourceStamp: imageEditorSourceStamp(source), revision: 0, width: 800, height: 600, canvas,
    history: new DocumentHistory(), setMode() {}, fit() {}, refresh() {},
    document() {return {width: this.width, height: this.height, canvas: {objects: objects.map(object => object.toObject()), background: canvas.backgroundColor}};},
    record() {ensureArtworkIds(objects); if (this.history.push(this.document())) this.revision++;}};
  editor.saved = JSON.stringify(editor.document()); editor.history.reset(editor.document());
  // Geometry and JSON restoration use real Fabric objects. This adapter avoids
  // pretending that Node has a browser Canvas2D renderer or IndexedDB store.
  class Stage {
    constructor() {this.objects = [];}
    async loadFromJSON(doc) {this.objects = await fabric.util.enlivenObjects(doc.objects); this.backgroundColor = doc.background;}
    getObjects() {return this.objects.slice();}
    remove(...items) {this.objects = this.objects.filter(object => !items.includes(object));}
    async dispose() {}
  }
  const bridge = createImageEditorAgent({getCurrent: () => editor, app: {getState: () => state},
    fabric: {...fabric, StaticCanvas: Stage}, loadFont, fontCatalog: () => ({'open sans': 'open.ttf'})});
  return {fabric, bridge, editor, objects, a, b, inner, c, outer, outside};
}

test('real Fabric group and ungroup preserve nested artwork matrices and IDs through undo/redo and JSON', async () => {
  const {fabric, bridge, editor, objects} = await setup();
  const {artworkEntries} = await import('../src/features/image-editor/group-objects.mjs');
  // Bounds/centres of enclosing Group containers may be recomputed by Fabric
  // layout; actual leaf artwork must keep the identical artboard transform.
  const initial = new Map(artworkEntries(objects).filter(({object}) => object.type !== 'group').map(({object}) => [object.id, object.calcTransformMatrix().slice()]));
  const check = () => {for (const {object} of artworkEntries(objects)) if (initial.has(object.id)) near(object.calcTransformMatrix(), initial.get(object.id));};
  const {parse} = require('../agent-tools.js');
  const nested = await bridge.execute('group', parse('image_editor_edit', {...stateArgs(editor), action: 'group', objectIds: ['b', 'a'], name: 'Nested pair'}).args);
  assert.deepEqual(nested.groupedObjectIds, ['a', 'b']); assert.equal(nested.revision, 1); check();
  let read = await bridge.execute('read', {nodeId: 'editor', objectId: nested.objectId});
  assert.equal(read.layers[0].parentObjectId, 'inner'); assert.equal(read.layers[0].name, 'Nested pair');
  const released = await bridge.execute('ungroup', parse('image_editor_edit', {...stateArgs(editor), action: 'ungroup', objectId: nested.objectId}).args);
  assert.deepEqual(released.releasedObjectIds, ['a', 'b']); assert.equal(released.revision, 2); check();
  const {imageEditorPresentation} = await import('../src/features/agent-execution/image-editor-presentation.mjs');
  const receipt = imageEditorPresentation({name: 'image_editor_edit', status: 'done', args: {action: 'ungroup'}, result: released});
  assert.match(receipt.label, /解组图层.*已执行编辑/); assert.match(receipt.detail, /释放图层（底→顶）：a、b/); assert.match(receipt.detail, /尚未保存/);
  const top = await bridge.execute('group', {...stateArgs(editor), objectIds: ['outside', 'outer']});
  assert.deepEqual(top.groupedObjectIds, ['outer', 'outside']); assert.equal(objects.length, 1); check();
  await bridge.execute('undo', stateArgs(editor)); assert.equal(objects.length, 2); check();
  await bridge.execute('redo', stateArgs(editor)); assert.equal(objects.length, 1); check();
  const stored = structuredClone(editor.document());
  const restored = await fabric.util.enlivenObjects(stored.canvas.objects); objects.splice(0, objects.length, ...restored); check();
  const ungrouped = await bridge.execute('ungroup', {...stateArgs(editor), objectId: top.objectId});
  assert.deepEqual(ungrouped.releasedObjectIds, ['outer', 'outside']); check();
  assert.deepEqual(artworkEntries(objects).map(({object}) => object.id), ['outer', 'inner', 'a', 'b', 'c', 'outside']);
});

test('hierarchy rejects locks, mixed parents and compositing effects atomically before changing history', async () => {
  const {bridge, editor, a, outer} = await setup();
  const unchanged = async (action, args, code) => {
    const baseline = JSON.stringify(editor.document()), revision = editor.revision, history = [...editor.history.past];
    await assert.rejects(bridge.execute(action, {...stateArgs(editor), ...args}), {code});
    assert.equal(JSON.stringify(editor.document()), baseline); assert.equal(editor.revision, revision); assert.deepEqual(editor.history.past, history);
  };
  await unchanged('group', {objectIds: ['a', 'outside']}, 'different_parents');
  await unchanged('group', {objectIds: ['a', 'a']}, 'invalid_argument');
  a.set({selectable: false});
  await unchanged('group', {objectIds: ['outer', 'outside']}, 'locked_object');
  await unchanged('ungroup', {objectId: 'outer'}, 'locked_object');
  a.set({selectable: true}); outer.set({selectable: false});
  await unchanged('group', {objectIds: ['a', 'b']}, 'locked_ancestor');
  outer.set({selectable: true, opacity: .6});
  await unchanged('ungroup', {objectId: 'outer'}, 'unsupported_group_effect');
  outer.set({opacity: 1, clipPath: new (await import('fabric')).Rect({width: 10, height: 10})});
  await unchanged('ungroup', {objectId: 'outer'}, 'unsupported_group_effect');
});

test('hierarchy staging and adoption failures leave the live Fabric document and revision intact', async () => {
  const {fabric, bridge, editor, objects} = await setup();
  const baseline = JSON.stringify(editor.document()), history = [...editor.history.past];
  const oldEnliven = fabric.util.enlivenObjects;
  // The shared namespace is immutable; inject a Group constructor that fails
  // only in staging rather than pretending to implement Fabric layout.
  const {prepareArtworkHierarchy, commitArtworkHierarchy} = await import('../src/features/image-editor/group-objects.mjs');
  await assert.rejects(prepareArtworkHierarchy('group', {objectIds: ['outer', 'outside']}, editor.canvas, {...fabric, Group: class {constructor() {throw Error('layout failed');}}}, {guard() {}}), /layout failed/);
  assert.equal(JSON.stringify(editor.document()), baseline);
  const plan = await prepareArtworkHierarchy('group', {objectIds: ['outer', 'outside']}, editor.canvas, fabric, {guard() {}});
  const originalAdd = editor.canvas.add; let failed = false;
  editor.canvas.add = (...items) => {if (!failed) {failed = true; originalAdd(items[0]); throw Error('adoption failed');} originalAdd(...items);};
  assert.throws(() => commitArtworkHierarchy(plan, editor.canvas), /adoption failed/);
  assert.equal(JSON.stringify(editor.document()), baseline); assert.equal(editor.revision, 0); assert.deepEqual(editor.history.past, history);
  assert.equal(objects.length, 2); assert.equal(fabric.util.enlivenObjects, oldEnliven);
  // A cancellation delivered during asynchronous decoding is checked again
  // before the staged tree can replace live artwork.
  const controller = new AbortController(); const pending = bridge.execute('group', {...stateArgs(editor), objectIds: ['outer', 'outside']}, {signal: controller.signal}); controller.abort();
  await assert.rejects(pending, error => error.code === 'cancelled' || /abort/i.test(error.name + error.message));
  assert.equal(JSON.stringify(editor.document()), baseline); assert.equal(editor.revision, 0);
});

test('grouping an ActiveSelection and noncontiguous siblings preserves actual artwork space and explicit stacking order', async () => {
  const {fabric, bridge, editor, objects, outer, outside} = await setup();
  const {artworkEntries} = await import('../src/features/image-editor/group-objects.mjs');
  const middle = new fabric.Rect({id: 'middle', left: 710.25, top: 25.75, width: 10, height: 10}); objects.splice(1, 0, middle);
  const selection = new fabric.ActiveSelection([outer, outside]); selection.set({angle: 18, scaleX: .9, scaleY: 1.1, left: 55.125});
  editor.canvas.getActiveObject = () => selection;
  editor.canvas.discardActiveObject = () => {selection.removeAll(); editor.canvas.getActiveObject = () => null;};
  const initial = new Map(artworkEntries(objects).filter(({object}) => object.type !== 'group').map(({object}) => [object.id, object.calcTransformMatrix().slice()]));
  const grouped = await bridge.execute('group', {...stateArgs(editor), objectIds: ['outside', 'outer']});
  assert.deepEqual(objects.map(object => object.id), [grouped.objectId, 'middle']);
  assert.deepEqual(objects[0].getObjects().map(object => object.id), ['outer', 'outside']);
  for (const {object} of artworkEntries(objects)) if (initial.has(object.id)) near(object.calcTransformMatrix(), initial.get(object.id));
  await bridge.execute('ungroup', {...stateArgs(editor), objectId: grouped.objectId});
  assert.deepEqual(objects.map(object => object.id), ['outer', 'outside', 'middle']);
  for (const {object} of artworkEntries(objects)) if (initial.has(object.id)) near(object.calcTransformMatrix(), initial.get(object.id));
});

test('nested read pages expose stable hierarchy and artboard transforms without mutating real groups or selection', async () => {
  const {fabric, bridge, editor, objects, a, outer, outside} = await setup();
  const selection = new fabric.ActiveSelection([outer, outside]);
  selection.set({angle: 18, scaleX: .9, scaleY: 1.1, left: 55.125});
  editor.canvas.getActiveObject = () => selection;
  const baseline = JSON.stringify(editor.document()), matrix = a.calcTransformMatrix();
  const first = await bridge.execute('read', {nodeId: 'editor', limit: 3});
  assert.equal(first.totalLayers, 6); assert.equal(first.topLevelLayers, 2); assert.equal(first.nextOffset, 3);
  assert.deepEqual(first.layers.map(layer => layer.objectId), ['outer', 'inner', 'a']);
  const layer = first.layers[2]; assert.equal(layer.parentObjectId, 'inner'); assert.equal(layer.depth, 2);
  assert.deepEqual(layer.ancestorObjectIds, ['outer', 'inner']); assert.equal(layer.index, 0);
  const projected = new fabric.Rect({...layer, originX: a.originX, originY: a.originY});
  near(projected.calcTransformMatrix(), matrix);
  const second = await bridge.execute('read', {nodeId: 'editor', offset: first.nextOffset});
  assert.deepEqual(second.layers.map(layer => layer.objectId), ['b', 'c', 'outside']);
  assert.equal(JSON.stringify(editor.document()), baseline); assert.equal(editor.revision, 0); assert.equal(objects[0].group, selection);
});

test('nested fractional artboard edits preserve unaffected siblings across skewed, rotated, flipped parents and ActiveSelection', async () => {
  const {fabric, bridge, editor, a, b, c, outer, outside} = await setup();
  const selection = new fabric.ActiveSelection([outer, outside]); selection.set({angle: 12, scaleX: .75, scaleY: 1.2});
  editor.canvas.getActiveObject = () => selection;
  editor.canvas.discardActiveObject = () => {selection.removeAll(); editor.canvas.getActiveObject = () => null;};
  const before = a.calcTransformMatrix(), siblings = [b, c, outside].map(object => object.calcTransformMatrix());
  const read = await bridge.execute('read', {nodeId: 'editor', objectId: 'a'}), layer = read.layers[0];
  const edited = await bridge.execute('update', {...stateArgs(editor), objectId: 'a', properties: {left: layer.left + 33.125, top: layer.top - 5.75}});
  near(a.calcTransformMatrix(), [...before.slice(0, 4), before[4] + 33.125, before[5] - 5.75]);
  [b, c, outside].forEach((object, i) => near(object.calcTransformMatrix(), siblings[i]));
  assert.equal(a.group.id, 'inner'); assert.equal(edited.revision, 1); assert.equal(edited.objectId, 'a');
});

test('ancestor locks, stale versions, invalid reorder and final-child removal reject without partial document changes', async () => {
  const {bridge, editor, inner, outer} = await setup();
  outer.set({selectable: false}); editor.record();
  const baseline = JSON.stringify(editor.document());
  for (const action of ['update', 'remove', 'reorder']) {
    await assert.rejects(bridge.execute(action, {...stateArgs(editor), objectId: 'a', ...(action === 'update' ? {properties: {locked: false, left: 12.5}} : action === 'reorder' ? {index: 1} : {})}), {code: 'locked_ancestor'});
  }
  assert.equal(JSON.stringify(editor.document()), baseline);
  await bridge.execute('update', {...stateArgs(editor), objectId: 'outer', properties: {locked: false}});
  await assert.rejects(bridge.execute('update', {...stateArgs(editor), expectedRevision: 0, objectId: 'a', properties: {left: 2}}), {code: 'revision_conflict'});
  await assert.rejects(bridge.execute('reorder', {...stateArgs(editor), objectId: 'a', index: 2}), {code: 'invalid_argument'});
  await bridge.execute('remove', {...stateArgs(editor), objectId: 'b'});
  const last = JSON.stringify(editor.document());
  await assert.rejects(bridge.execute('remove', {...stateArgs(editor), objectId: 'a'}), {code: 'last_group_child'});
  assert.equal(JSON.stringify(editor.document()), last); assert.equal(inner.getObjects().length, 1);
});

test('group-local reorder and remove preserve sibling world geometry and use one history entry each', async () => {
  const {bridge, editor, a, b, c, inner, outside} = await setup();
  const matrices = [a, b, c, outside].map(object => object.calcTransformMatrix());
  await bridge.execute('reorder', {...stateArgs(editor), objectId: 'a', index: 1});
  assert.deepEqual(inner.getObjects().map(object => object.id), ['b', 'a']); assert.equal(editor.revision, 1);
  [a, b, c, outside].forEach((object, i) => near(object.calcTransformMatrix(), matrices[i]));
  await bridge.execute('remove', {...stateArgs(editor), objectId: 'b'});
  assert.equal(editor.revision, 2); assert.equal(editor.history.past.length, 3);
  [a, c, outside].forEach((object, i) => near(object.calcTransformMatrix(), matrices[[0, 2, 3][i]]));
  assert.equal(inner.getObjects().length, 1);
});

test('real Fabric JSON restore, undo/redo and save receipt preserve recursive IDs, transforms and ancestor locks', async () => {
  const {fabric, bridge, editor, objects} = await setup();
  const before = await bridge.execute('read', {nodeId: 'editor'});
  await bridge.execute('update', {...stateArgs(editor), objectId: 'a', properties: {left: 250.125, top: -40.875, locked: true}});
  const edited = await bridge.execute('read', {nodeId: 'editor'});
  await bridge.execute('undo', stateArgs(editor));
  const undone = await bridge.execute('read', {nodeId: 'editor'});
  assert.deepEqual(undone.layers.map(layer => [layer.objectId, layer.parentObjectId]), before.layers.map(layer => [layer.objectId, layer.parentObjectId]));
  undone.layers.forEach((layer, i) => near([layer.left, layer.top, layer.scaleX, layer.scaleY, layer.angle], [before.layers[i].left, before.layers[i].top, before.layers[i].scaleX, before.layers[i].scaleY, before.layers[i].angle]));
  await bridge.execute('redo', stateArgs(editor));
  const redone = await bridge.execute('read', {nodeId: 'editor'});
  assert.deepEqual(redone.layers, edited.layers);
  let stored;
  editor.save = async () => {stored = structuredClone(editor.document()); editor.saved = JSON.stringify(stored); return {applied: true, saved: true, currentMatches: true, savedRevision: editor.revision};};
  const saved = await bridge.execute('save', stateArgs(editor)); assert.equal(saved.saved, true); assert.equal(saved.dirty, false);
  const restored = await fabric.util.enlivenObjects(stored.canvas.objects); objects.splice(0, objects.length, ...restored);
  const reopened = await bridge.execute('read', {nodeId: 'editor'});
  assert.deepEqual(reopened.layers, redone.layers); assert.equal(reopened.layers.find(layer => layer.objectId === 'a').locked, true);
});

test('group IDs are assigned recursively before persistence; masks stay private and unsupported raster edits fail explicitly', async () => {
  const {bridge, editor, outer, a, fabric} = await setup();
  const {ensureArtworkIds, artworkEntries, serializedArtworkFonts} = await import('../src/features/image-editor/group-objects.mjs');
  a.id = undefined; outer.id = 'b'; a.clipPath = new fabric.Rect({id: 'private-mask', width: 3, height: 3});
  ensureArtworkIds(editor.canvas.getObjects()); editor.record();
  const ids = artworkEntries(editor.canvas.getObjects()).map(entry => entry.object.id);
  assert.equal(ids.length, new Set(ids).size); assert.ok(ids.every(Boolean)); assert.ok(!ids.includes('private-mask'));
  assert.deepEqual(serializedArtworkFonts([{type: 'Group', objects: [{type: 'Group', objects: [{type: 'Textbox', fontFamily: 'OpenSans'}]}]}]), ['OpenSans']);
  for (const action of ['crop', 'erase', 'pose']) await assert.rejects(bridge.execute(action, {...stateArgs(editor), ...(action === 'erase' ? {objectIds: [a.id]} : {objectId: a.id})}), {code: 'unsupported_group_operation'});
  const read = await bridge.execute('read', {nodeId: 'editor', objectId: a.id}); assert.equal(read.layers[0].canCrop, false); assert.equal(read.layers[0].canErase, false);
});

test('Group container fill/stroke updates reject atomically while explicit unlocked child styles really change', async () => {
  const {bridge, editor, a, b} = await setup();
  const read = await bridge.execute('read', {nodeId: 'editor'});
  assert.equal(read.capabilities.groupContainerStyleUpdate, false);
  assert.deepEqual(read.capabilities.groupUnsupportedUpdateProperties, ['fill', 'stroke', 'strokeWidth']);
  for (const objectId of ['outer', 'inner']) {
    assert.deepEqual(read.layers.find(layer => layer.objectId === objectId).unsupportedUpdateProperties, ['fill', 'stroke', 'strokeWidth']);
    for (const [key, value] of [['fill', '#f5b84b'], ['stroke', '#1f4a61'], ['strokeWidth', 5]]) {
      const before = JSON.stringify(editor.document());
      await assert.rejects(bridge.execute('update', {...stateArgs(editor), objectId, properties: {left: 123.125, [key]: value}}), {code: 'unsupported_group_style'});
      assert.equal(JSON.stringify(editor.document()), before); assert.equal(editor.revision, 0); assert.equal(editor.history.past.length, 1);
    }
  }
  const oldCSS = globalThis.CSS; globalThis.CSS = {supports: () => true};
  try {
    const siblingFill = b.fill;
    await bridge.execute('update', {...stateArgs(editor), objectId: 'a', properties: {fill: '#f5b84b', stroke: '#1f4a61', strokeWidth: 5}});
    assert.equal(a.fill, '#f5b84b'); assert.equal(a.stroke, '#1f4a61'); assert.equal(a.strokeWidth, 5);
    assert.equal(b.fill, siblingFill); assert.equal(editor.revision, 1);
  } finally {globalThis.CSS = oldCSS;}
});

test('reparent preserves real nested artwork matrices, IDs, one undo per move and save/reopen state', async () => {
  const {fabric, bridge, editor, objects} = await setup();
  const {artworkEntries} = await import('../src/features/image-editor/group-objects.mjs');
  const initial = new Map(artworkEntries(objects).filter(({object}) => object.type !== 'group').map(({object}) => [object.id, object.calcTransformMatrix().slice()]));
  const check = () => {for (const {object} of artworkEntries(objects)) if (initial.has(object.id)) near(object.calcTransformMatrix(), initial.get(object.id));};
  const moves = [['a', 'outer', 1], ['outside', 'inner', 1], ['inner', null, 1], ['a', 'inner', 0]];
  for (const [objectId, parentObjectId, index] of moves) {
    const before = editor.revision, history = editor.history.past.length;
    const receipt = await bridge.execute('reparent', {...stateArgs(editor), objectId, parentObjectId, index});
    assert.equal(receipt.movedObjectId, objectId); assert.equal(receipt.parentObjectId, parentObjectId); assert.equal(receipt.index, index);
    assert.equal(editor.revision, before + 1); assert.equal(editor.history.past.length, history + 1); check();
    const read = await bridge.execute('read', {nodeId: 'editor', objectId});
    assert.equal(read.layers[0].parentObjectId, parentObjectId); assert.equal(read.layers[0].index, index);
    assert.equal(read.capabilities.groupReparent, true);
  }
  const comparable = layers => JSON.parse(JSON.stringify(layers, (_, value) => typeof value === 'number' ? Number(value.toFixed(8)) : value));
  const edited = comparable((await bridge.execute('read', {nodeId: 'editor'})).layers);
  await bridge.execute('undo', stateArgs(editor)); check(); assert.equal((await bridge.execute('read', {nodeId: 'editor', objectId: 'a'})).layers[0].parentObjectId, 'outer');
  await bridge.execute('redo', stateArgs(editor)); check(); assert.deepEqual(comparable((await bridge.execute('read', {nodeId: 'editor'})).layers), edited);
  let stored; editor.save = async () => {stored = structuredClone(editor.document()); editor.saved = JSON.stringify(stored); return {saved: true, applied: true, savedRevision: editor.revision};};
  const saved = await bridge.execute('save', stateArgs(editor)); assert.equal(saved.saved, true); assert.equal(saved.dirty, false);
  const restored = await fabric.util.enlivenObjects(stored.canvas.objects); objects.splice(0, objects.length, ...restored); check();
  assert.deepEqual(comparable((await bridge.execute('read', {nodeId: 'editor'})).layers), edited);
});

test('reparent rejects cycles, invalid slots, source/destination locks, final-child removal and non-equivalent effects atomically', async () => {
  const cases = [
    [{objectId: 'outer', parentObjectId: 'inner', index: 0}, null, 'hierarchy_cycle'],
    [{objectId: 'inner', parentObjectId: 'inner', index: 0}, null, 'hierarchy_cycle'],
    [{objectId: 'a', parentObjectId: 'inner', index: 0}, null, 'same_parent'],
    [{objectId: 'a', parentObjectId: 'outside', index: 0}, null, 'not_group'],
    [{objectId: 'a', index: 0}, null, 'invalid_argument'],
    [{objectId: 'a', parentObjectId: null, index: 3}, null, 'invalid_argument'],
    [{objectId: 'a', parentObjectId: null, index: .5}, null, 'invalid_argument'],
    [{objectId: 'a', parentObjectId: null, index: 0}, f => f.inner.set({selectable: false}), 'locked_ancestor'],
    [{objectId: 'outside', parentObjectId: 'inner', index: 0}, f => f.inner.set({selectable: false}), 'locked_object'],
    [{objectId: 'outer', parentObjectId: null, index: 0}, null, 'same_parent'],
    [{objectId: 'inner', parentObjectId: null, index: 0}, f => f.a.set({selectable: false}), 'locked_object'],
    [{objectId: 'a', parentObjectId: null, index: 0}, f => f.inner.remove(f.b), 'last_group_child'],
    ...['opacity', 'visible', 'clipPath', 'shadow', 'backgroundColor', 'globalCompositeOperation'].map(property => [
      {objectId: 'outside', parentObjectId: 'inner', index: 0}, f => f.outer.set({[property]: {opacity: .5, visible: false, clipPath: new f.fabric.Rect({width: 5, height: 5}), shadow: new f.fabric.Shadow({blur: 3}), backgroundColor: '#f00', globalCompositeOperation: 'multiply'}[property]}), 'unsupported_group_effect']),
    [{objectId: 'a', parentObjectId: null, index: 0}, f => f.b.set({globalCompositeOperation: 'destination-out'}), 'unsupported_group_effect'],
    [{objectId: 'a', parentObjectId: null, index: 0}, f => f.a.set({globalCompositeOperation: 'multiply'}), 'unsupported_group_effect'],
  ];
  for (const [args, mutate, code] of cases) {
    const f = await setup(); mutate?.(f);
    const before = JSON.stringify(f.editor.document()), history = f.editor.history.past.length;
    await assert.rejects(f.bridge.execute('reparent', {...stateArgs(f.editor), ...args}), {code});
    assert.equal(JSON.stringify(f.editor.document()), before); assert.equal(f.editor.revision, 0); assert.equal(f.editor.history.past.length, history);
  }
});

test('reparent rejects late version changes, cancellation and staged layout failure without adopting partial edits', async () => {
  for (const reason of ['revision', 'source', 'cancel']) {
    const f = await setup(), before = JSON.stringify(f.editor.document()), controller = new AbortController();
    const task = f.bridge.execute('reparent', {...stateArgs(f.editor), objectId: 'a', parentObjectId: null, index: 1}, {signal: controller.signal});
    if (reason === 'revision') f.editor.revision++;
    if (reason === 'source') f.editor.sourceNode.image = 'changed-source';
    if (reason === 'cancel') controller.abort();
    await assert.rejects(task, error => ['revision_conflict', 'source_changed', 'cancelled'].includes(error.code) || /abort/i.test(error.name + error.message));
    assert.equal(JSON.stringify(f.editor.document()), before); assert.equal(f.editor.history.past.length, 1);
  }
  const f = await setup(), before = JSON.stringify(f.editor.document());
  const {prepareArtworkHierarchy} = await import('../src/features/image-editor/group-objects.mjs');
  const insert = f.fabric.Group.prototype.insertAt;
  try {
    f.fabric.Group.prototype.insertAt = () => {throw Error('staged insertion failed');};
    await assert.rejects(prepareArtworkHierarchy('reparent', {objectId: 'outside', parentObjectId: 'inner', index: 1}, f.editor.canvas, f.fabric, {guard() {}}), /staged insertion failed/);
  } finally {f.fabric.Group.prototype.insertAt = insert;}
  assert.equal(JSON.stringify(f.editor.document()), before); assert.equal(f.editor.history.past.length, 1);
});


test('reparent refuses real ActiveSelection effects including an opacity edit during asynchronous staging', async () => {
  for (const late of [false, true]) {
    const f = await setup(), selection = new f.fabric.ActiveSelection([f.outer, f.outside]);
    f.editor.canvas.getActiveObject = () => selection;
    if (!late) selection.set({opacity: .4});
    const before = JSON.stringify(f.editor.document());
    const task = f.bridge.execute('reparent', {...stateArgs(f.editor), objectId: 'outside', parentObjectId: 'inner', index: 1});
    if (late) selection.set({opacity: .4});
    await assert.rejects(task, {code: 'unsupported_group_effect'});
    assert.equal(JSON.stringify(f.editor.document()), before); assert.equal(f.editor.revision, 0);
    assert.equal(f.outside.group, selection); assert.equal(f.a.getObjectOpacity(), .4);
  }
});
