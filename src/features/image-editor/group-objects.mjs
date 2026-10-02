const fail = (code, message) => Object.assign(new Error(message), {code});
const isGroup = object => String(object.type).toLowerCase() === 'group';

// Only artwork objects are addressable; clip paths and ActiveSelection wrappers
// are implementation details, not independently editable document layers.
export function artworkEntries(objects) {
  const entries = [];
  const visit = (siblings, ancestors) => siblings.forEach((object, index) => {
    if (object.excludeFromExport) return;
    entries.push({object, index, ancestors, parent: ancestors.at(-1), depth: ancestors.length});
    if (isGroup(object)) visit(object.getObjects(), [...ancestors, object]);
  });
  visit(objects, []);
  return entries;
}

export function ensureArtworkIds(objects) {
  const seen = new Set();
  for (const {object} of artworkEntries(objects)) {
    if (!object.id || seen.has(object.id)) object.id = crypto.randomUUID();
    seen.add(object.id);
  }
}

export function serializedArtworkFonts(objects = []) {
  const fonts = new Set();
  const visit = items => { for (const object of items) {
    if (/text/i.test(object.type) && object.fontFamily) fonts.add(object.fontFamily);
    if (String(object.type).toLowerCase() === 'group') visit(object.objects || []);
  }};
  visit(objects);
  return [...fonts];
}

export function findArtwork(entries, id) {
  const matches = entries.filter(entry => entry.object.id === id);
  if (matches.length > 1) throw fail('ambiguous_object', '图层 ID 重复，请重新打开编辑器');
  if (!matches.length) throw fail('missing_object', '图层不存在');
  return matches[0];
}

export function assertArtworkUnlocked(entry, unlock = false) {
  if (entry.ancestors.some(object => object.selectable === false)) throw fail('locked_ancestor', '父分组已锁定，请先显式解锁父分组');
  if (entry.object.selectable === false && !unlock) throw fail('locked_object', '图层已锁定，先显式解锁');
}

export function detachedArtboardObject(object, util) {
  const projected = Object.assign(Object.create(Object.getPrototypeOf(object)), object, {group: undefined, parent: undefined, canvas: undefined});
  util.applyTransformToObject(projected, object.calcTransformMatrix());
  return projected;
}

export function artworkTransform(object, util) {
  return util.saveObjectTransform(object.group ? detachedArtboardObject(object, util) : object);
}

const geometryKeys = new Set(['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY']);
export function prepareArtworkUpdate(entry, patch, util) {
  if (!entry.parent || !Object.keys(patch).some(key => geometryKeys.has(key))) return {entry, patch};
  const parentMatrix = entry.parent.calcTransformMatrix();
  if (!parentMatrix.every(Number.isFinite) || Math.abs(parentMatrix[0] * parentMatrix[3] - parentMatrix[1] * parentMatrix[2]) < 1e-12) throw fail('invalid_transform', '父分组变换不可逆，无法修改子图层位置');
  // The public API always uses artboard pixels. Convert the intended global
  // object transform back into its parent plane without detaching live artwork.
  const projected = detachedArtboardObject(entry.object, util);
  projected.set(patch);
  if (String(projected.type).toLowerCase() === 'ellipse') {
    if (patch.width !== undefined) projected.set('rx', patch.width / 2);
    if (patch.height !== undefined) projected.set('ry', patch.height / 2);
  }
  const localMatrix = util.multiplyTransformMatrices(util.invertTransform(parentMatrix), projected.calcTransformMatrix());
  if (!localMatrix.every(Number.isFinite)) throw fail('invalid_transform', '图层变换无效');
  return {entry, patch, localMatrix};
}

export function commitArtworkUpdate({entry, patch, localMatrix}, util) {
  const object = entry.object;
  object.set(patch);
  if (String(object.type).toLowerCase() === 'ellipse') {
    if (patch.width !== undefined) object.set('rx', patch.width / 2);
    if (patch.height !== undefined) object.set('ry', patch.height / 2);
  }
  if (localMatrix) util.applyTransformToObject(object, localMatrix);
  object.setCoords();
  // Fabric layout preserves siblings in artboard space while resizing the
  // parent bounds; its standard bubbling updates all enclosing groups.
  if (entry.parent) entry.parent.triggerLayout();
  for (const ancestor of entry.ancestors) ancestor.set({dirty: true});
}

export function removeArtwork(entry, canvas) {
  if (entry.parent && entry.parent.getObjects().filter(object => !object.excludeFromExport).length === 1) throw fail('last_group_child', '不能移除分组最后一个子图层，请显式移除该分组');
  (entry.parent || canvas).remove(entry.object);
}

export function reorderArtwork(entry, canvas, index) {
  const owner = entry.parent || canvas;
  owner.moveObjectTo(entry.object, index);
  for (const ancestor of entry.ancestors) ancestor.set({dirty: true});
}

function assertHierarchyUnlocked(entry) {
  assertArtworkUnlocked(entry);
  for (const descendant of artworkEntries([entry.object])) {
    if (descendant.object.selectable === false) throw fail('locked_object', '移动的分组包含锁定子图层，请先显式解锁');
  }
}

export function validateArtworkHierarchy(action, args, objects) {
  const entries = artworkEntries(objects);
  if (action === 'group') {
    if (!Array.isArray(args.objectIds) || args.objectIds.length < 2 || args.objectIds.length > 50 || new Set(args.objectIds).size !== args.objectIds.length) throw fail('invalid_argument', '分组需要 2–50 个不重复图层 ID');
    if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 200)) throw fail('invalid_argument', '分组名称无效');
    const targets = args.objectIds.map(id => findArtwork(entries, id));
    targets.forEach(assertHierarchyUnlocked);
    if (targets.some(entry => entry.parent !== targets[0].parent)) throw fail('different_parents', '分组图层必须属于同一直接父级');
    for (const entry of targets) assertHierarchyMatrix(entry.object);
    return targets.sort((a, b) => a.index - b.index);
  }
  const entry = findArtwork(entries, args.objectId);
  if (!isGroup(entry.object)) throw fail('not_group', '解组目标必须为 Group');
  assertHierarchyUnlocked(entry);
  const group = entry.object;
  // A composited group opacity/mask cannot generally be reproduced by copying
  // it to overlapping children. Refuse rather than silently changing pixels.
  if (group.opacity !== 1 || group.clipPath || group.shadow || group.backgroundColor || group.globalCompositeOperation !== 'source-over') throw fail('unsupported_group_effect', '此分组含整体透明度、蒙版、阴影、背景或混合效果，无法无损解组');
  if (!group.getObjects().length || group.getObjects().some(object => object.excludeFromExport)) throw fail('unsupported_group_content', '无法解组空组或含内部辅助对象的组');
  for (const {object} of artworkEntries([group])) assertHierarchyMatrix(object);
  return [entry];
}

function assertHierarchyMatrix(object) {
  const matrix = object.calcTransformMatrix();
  if (!matrix.every(Number.isFinite) || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12) throw fail('invalid_transform', '图层变换不可逆，无法修改层级');
}

// Decode a separate real Fabric tree before any live mutation. Group's public
// remove/insertAt APIs then perform all parent-plane conversions and layouts.
export async function prepareArtworkHierarchy(action, args, canvas, fabric, {signal, guard}) {
  const assertSerializable = objects => {for (const object of objects) {
    if (object.excludeFromExport) throw fail('unsupported_group_content', '文档含内部辅助对象，请先完成当前绘制操作');
    if (isGroup(object)) assertSerializable(object.getObjects());
  }};
  assertSerializable(canvas.getObjects());
  validateArtworkHierarchy(action, args, canvas.getObjects());
  const serialized = canvas.getObjects().map(object => {
    const data = object.toObject();
    return object.group ? {...data, ...artworkTransform(object, fabric.util)} : data;
  });
  let roots;
  try {roots = await fabric.util.enlivenObjects(serialized, {signal});}
  catch (error) {if (signal?.aborted) throw fail('cancelled', '操作已取消'); throw error;}
  const rootOwner = {getObjects: () => roots.slice(), remove(...items) {for (const item of items) roots.splice(roots.indexOf(item), 1);}, insertAt(index, ...items) {roots.splice(index, 0, ...items);}};
  let discardedGroup, detached = [];
  try {
    guard();
    const targets = validateArtworkHierarchy(action, args, roots), owner = targets[0].parent || rootOwner, index = targets[0].index;
    let result;
    if (action === 'group') {
      const children = targets.map(entry => entry.object);
      owner.remove(...children);
      detached = children;
      const group = new fabric.Group(children, {id: crypto.randomUUID(), name: args.name || 'Group'});
      detached = [group];
      owner.insertAt(index, group);
      detached = [];
      result = {objectId: group.id, groupedObjectIds: children.map(object => object.id)};
    } else {
      const group = targets[0].object, children = group.getObjects();
      owner.remove(group);
      discardedGroup = group;
      group.removeAll();
      detached = children;
      // Group visibility is inherited and can be preserved exactly per child.
      if (!group.visible) children.forEach(object => object.set({visible: false}));
      owner.insertAt(index, ...children);
      detached = [];
      result = {ungroupedObjectId: group.id, releasedObjectIds: children.map(object => object.id)};
    }
    for (const {object} of artworkEntries(roots)) {assertHierarchyMatrix(object); object.setCoords();}
    guard();
    return {objects: roots, result, dispose() {for (const object of roots) object.dispose(); discardedGroup?.dispose();}, complete() {discardedGroup?.dispose();}};
  } catch (error) {
    for (const object of roots) object.dispose();
    for (const object of detached) object.dispose();
    discardedGroup?.dispose();
    throw error;
  }
}

export function commitArtworkHierarchy(plan, canvas) {
  canvas.discardActiveObject();
  const previous = canvas.getObjects().slice();
  try {
    canvas.remove(...previous);
    canvas.add(...plan.objects);
    plan.complete();
  } catch (error) {
    canvas.remove(...canvas.getObjects());
    canvas.add(...previous);
    plan.dispose();
    throw error;
  }
}
