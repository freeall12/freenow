import {clone, defined, isRecord, replaceById, requireDomain, same} from './invariants.mjs';
import {assertState} from './schema.mjs';

const collections = {
  stage: ['stages', 'stage', 'stageId'], characterRole: ['characterRoles', 'role', 'roleId'],
  entity: ['entities', 'entity', 'entityId'], setup: ['setups', 'setup', 'setupId'],
  view: ['views', 'view', 'viewId'], reference: ['references', 'reference', 'referenceId'], output: ['outputs', 'output', 'outputId']
};
const environmentFields = ['ground', 'hdriResources', 'lighting', 'skyboxSource'];
const activeFields = ['activeStageId', 'activeSetupId', 'activeViewId'];
const setupMeta = setup => {
  const {entityStates, ...meta} = setup;
  return meta;
};

function diffItems(before, after, key, upsert, remove, forward, inverse, orders, orderDescriptor) {
  const old = new Map(before.map(item => [item[key], item])), next = new Map(after.map(item => [item[key], item]));
  before.forEach((item, index) => {
    const value = next.get(item[key]);
    if (!value) { forward.push(remove(item)); inverse.push(upsert(item, index, before[index + 1]?.[key], before[index - 1]?.[key])); }
    else if (!same(item, value)) { forward.push(upsert(value)); inverse.push(upsert(item)); }
  });
  after.forEach((item, index) => {
    if (!old.has(item[key])) { forward.push(upsert(item, index, after[index + 1]?.[key], after[index - 1]?.[key])); inverse.push(remove(item)); }
  });
  const oldCommon = before.filter(item => next.has(item[key])).map(item => item[key]);
  const newCommon = after.filter(item => old.has(item[key])).map(item => item[key]);
  if (!same(oldCommon, newCommon)) orders.push({forward: {...orderDescriptor, ids: after.map(item => item[key])}, inverse: {...orderDescriptor, ids: before.map(item => item[key])}});
}

function diffSetups(before, after, forward, inverse, orders) {
  const next = new Map(after.map(setup => [setup.id, setup])), old = new Map(before.map(setup => [setup.id, setup]));
  before.forEach((setup, index) => {
    const value = next.get(setup.id);
    if (!value) {
      forward.push({type: 'setup.remove', setupId: setup.id});
      inverse.push(defined({type: 'setup.upsert', setup, index, beforeId: before[index + 1]?.id, afterId: before[index - 1]?.id})); return;
    }
    if (!same(setupMeta(setup), setupMeta(value))) {
      forward.push({type: 'setup.patchMeta', setup: setupMeta(value)}); inverse.push({type: 'setup.patchMeta', setup: setupMeta(setup)});
    }
    diffItems(setup.entityStates, value.entityStates, 'entityId',
      (state, position, beforeId, afterId) => defined({type: 'setupState.upsert', setupId: setup.id, state, index: position, beforeId, afterId}),
      state => ({type: 'setupState.remove', setupId: setup.id, entityId: state.entityId}), forward, inverse, orders,
      {type: 'setupState.order', setupId: setup.id});
  });
  after.forEach((setup, index) => {
    if (!old.has(setup.id)) {
      forward.push(defined({type: 'setup.upsert', setup, index, beforeId: after[index + 1]?.id, afterId: after[index - 1]?.id}));
      inverse.push({type: 'setup.remove', setupId: setup.id});
    }
  });
  const oldCommon = before.filter(setup => next.has(setup.id)).map(setup => setup.id), newCommon = after.filter(setup => old.has(setup.id)).map(setup => setup.id);
  if (!same(oldCommon, newCommon)) orders.push({forward: {type: 'setup.order', ids: after.map(setup => setup.id)}, inverse: {type: 'setup.order', ids: before.map(setup => setup.id)}});
}

export function normalizeScope(scope = {kind: 'world-space'}) {
  requireDomain(isRecord(scope), 'history.scope', 'must be a scope object');
  if (scope.kind === 'world-space') {
    requireDomain(Object.keys(scope).every(key => key === 'kind'), 'history.scope', 'unknown scope field');
    return {kind: 'world-space'};
  }
  requireDomain(scope.kind === 'environment' && Array.isArray(scope.fields) && scope.fields.length > 0 && scope.fields.every(field => environmentFields.includes(field)), 'history.scope', 'invalid environment fields');
  requireDomain(Object.keys(scope).every(key => ['kind', 'fields'].includes(key)), 'history.scope', 'unknown scope field');
  return {kind: 'environment', fields: [...new Set(scope.fields)]};
}

export function assertScopeChange(before, after, scope) {
  const strip = state => {
    const {worldSpace, environment, ...scene} = state.scenePlay;
    return {...state, scenePlay: scene};
  };
  requireDomain(same(strip(before), strip(after)), 'history.preview', 'owner, envelope and non-domain data cannot change in a transaction', 'out-of-scope');
  if (scope.kind === 'world-space') requireDomain(same(before.scenePlay.environment, after.scenePlay.environment), 'history.preview', 'environment is outside world-space scope', 'out-of-scope');
  else {
    requireDomain(same(before.scenePlay.worldSpace, after.scenePlay.worldSpace), 'history.preview', 'world space is outside environment scope', 'out-of-scope');
    const fields = new Set([...Object.keys(before.scenePlay.environment), ...Object.keys(after.scenePlay.environment)]);
    for (const field of fields) if (!scope.fields.includes(field)) requireDomain(same(before.scenePlay.environment[field], after.scenePlay.environment[field]), 'history.preview', `environment.${field} is outside scope`, 'out-of-scope');
  }
}

export function diffState(before, after, scope = {kind: 'world-space'}) {
  assertState(before); assertState(after); scope = normalizeScope(scope); assertScopeChange(before, after, scope);
  const forward = [], inverse = [], orders = [];
  if (scope.kind === 'environment') {
    for (const field of scope.fields) if (!same(before.scenePlay.environment[field], after.scenePlay.environment[field])) {
      forward.push(defined({type: 'environment.set', field, value: after.scenePlay.environment[field]}));
      inverse.push(defined({type: 'environment.set', field, value: before.scenePlay.environment[field]}));
    }
  } else {
    const left = before.scenePlay.worldSpace, right = after.scenePlay.worldSpace;
    for (const field of ['source', 'roomConfig']) if (!same(left[field], right[field])) {
      const type = field === 'source' ? 'space.setSource' : 'space.setRoomConfig';
      forward.push({type, value: right[field]}); inverse.push({type, value: left[field]});
    }
    for (const [type, [collection, valueKey, idKey]] of Object.entries(collections)) {
      if (type === 'setup') { diffSetups(left.setups, right.setups, forward, inverse, orders); continue; }
      diffItems(left[collection], right[collection], 'id',
        (value, index, beforeId, afterId) => defined({type: `${type}.upsert`, [valueKey]: value, index, beforeId, afterId}),
        value => ({type: `${type}.remove`, [idKey]: value.id}), forward, inverse, orders, {type: `${type}.order`});
    }
    for (const field of activeFields) if (!same(left[field], right[field])) {
      forward.push({type: 'world.setActive', field, value: right[field]}); inverse.push({type: 'world.setActive', field, value: left[field]});
    }
  }
  // Order restoration runs after item restoration; no patch contains the whole WorldSpace.
  return clone({forward: [...forward, ...orders.map(order => order.forward)], inverse: [...inverse.reverse(), ...orders.map(order => order.inverse)]});
}

function upsert(items, value, key = 'id', index, beforeId, afterId) {
  if (items.some(item => item[key] === value[key])) return replaceById(items, value, key);
  if (index === undefined) return [...items, value];
  requireDomain(Number.isInteger(index) && index >= 0, 'history.patch.index', 'invalid insertion index');
  const beforeIndex = items.findIndex(item => item[key] === beforeId), afterIndex = items.findIndex(item => item[key] === afterId);
  // Inverse patches run in reverse order. Neighbour anchors restore interleaved
  // deletions without recording an unrelated whole collection as touched.
  const position = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : Math.min(index, items.length);
  const next = [...items]; next.splice(position, 0, value); return next;
}
function reorder(items, ids, key = 'id') {
  requireDomain(Array.isArray(ids) && ids.length === items.length && new Set(ids).size === ids.length, 'history.patch.ids', 'invalid order patch');
  const byId = new Map(items.map(item => [item[key], item]));
  requireDomain(ids.every(id => byId.has(id)), 'history.patch.ids', 'unknown ordered ID');
  return ids.map(id => byId.get(id));
}

export function applyPatches(state, patches) {
  assertState(state); requireDomain(Array.isArray(patches), 'history.patches', 'must be an array');
  let space = clone(state.scenePlay.worldSpace), environment = clone(state.scenePlay.environment);
  for (const raw of patches) {
    const patch = clone(raw); requireDomain(isRecord(patch) && typeof patch.type === 'string', 'history.patch', 'invalid patch');
    if (patch.type === 'space.setSource') { space.source = patch.value; continue; }
    if (patch.type === 'space.setRoomConfig') { space.roomConfig = patch.value; continue; }
    if (patch.type === 'environment.set') {
      requireDomain(environmentFields.includes(patch.field), 'history.patch', 'unknown environment field');
      if (Object.hasOwn(patch, 'value')) environment[patch.field] = patch.value; else delete environment[patch.field];
      continue;
    }
    if (patch.type === 'world.setActive') {
      requireDomain(activeFields.includes(patch.field), 'history.patch', 'unknown active field'); space[patch.field] = patch.value; continue;
    }
    if (patch.type === 'setup.patchMeta') {
      requireDomain(!!space.setups.find(setup => setup.id === patch.setup.id), 'history.patch', 'setup missing');
      space.setups = space.setups.map(setup => setup.id === patch.setup.id ? {...patch.setup, entityStates: setup.entityStates} : setup); continue;
    }
    if (patch.type.startsWith('setupState.')) {
      requireDomain(space.setups.some(setup => setup.id === patch.setupId), 'history.patch', 'setup missing');
      space.setups = space.setups.map(setup => {
        if (setup.id !== patch.setupId) return setup;
        let entityStates;
        if (patch.type === 'setupState.upsert') entityStates = upsert(setup.entityStates, patch.state, 'entityId', patch.index, patch.beforeId, patch.afterId);
        else if (patch.type === 'setupState.remove') entityStates = setup.entityStates.filter(item => item.entityId !== patch.entityId);
        else if (patch.type === 'setupState.order') entityStates = reorder(setup.entityStates, patch.ids, 'entityId');
        else requireDomain(false, 'history.patch', 'unknown setup-state patch');
        return {...setup, entityStates};
      }); continue;
    }
    const [type, action] = patch.type.split('.'), descriptor = collections[type];
    requireDomain(!!descriptor && ['upsert', 'remove', 'order'].includes(action) && patch.type === `${type}.${action}`, 'history.patch', `unknown patch: ${patch.type}`);
    const [collection, valueKey, idKey] = descriptor;
    if (action === 'upsert') space[collection] = upsert(space[collection], patch[valueKey], 'id', patch.index, patch.beforeId, patch.afterId);
    if (action === 'remove') space[collection] = space[collection].filter(item => item.id !== patch[idKey]);
    if (action === 'order') space[collection] = reorder(space[collection], patch.ids);
  }
  // Cascades can briefly have missing relations between patches; validate only the atomic result.
  const next = {...state, scenePlay: {...state.scenePlay, worldSpace: space, environment}};
  assertState(next); return next;
}

export function touchedBy(patches) {
  let environment = false, space = false, selection = false;
  const fields = ['stageIds', 'roleIds', 'entityIds', 'setupIds', 'viewIds', 'referenceIds', 'outputIds'];
  const makeSets = () => Object.fromEntries(fields.map(field => [field, new Set()]));
  const sets = makeSets(), lifecycle = makeSets(), dependencies = makeSets();
  const depend = (field, id) => { if (typeof id === 'string') dependencies[field].add(id); };
  const stateDependencies = state => {
    depend('entityIds', state.entityId); depend('entityIds', state.lookTarget?.entityId); depend('entityIds', state.heldEntityId);
    depend('entityIds', state.camera?.focus?.entityId); depend('entityIds', state.camera?.lookAt?.entityId);
  };
  const setupDependencies = setup => {
    depend('stageIds', setup.stageId); setup.entityStates?.forEach(stateDependencies);
    for (const track of setup.temporal?.tracks ?? []) {
      depend('entityIds', track.owner.entityId);
      for (const channel of track.channels) for (const sample of channel.values) {
        const value = sample.value;
        if (['look-target', 'camera-focus', 'camera-look-at'].includes(value.kind)) depend('entityIds', value.value.entityId);
        if (channel.property === 'entity.heldEntityId') depend('entityIds', value.value);
      }
    }
  };
  const addTarget = target => {
    const fields = {stage: 'stageIds', setup: 'setupIds', entity: 'entityIds', view: 'viewIds'};
    if (fields[target.kind]) sets[fields[target.kind]].add(target.id);
  };
  for (const patch of patches) {
    const [type] = patch.type.split('.');
    if (type === 'environment') environment = true;
    if (type === 'space') space = true;
    if (type === 'world') {
      selection = true;
      const activeTargets = {activeStageId: 'stageIds', activeSetupId: 'setupIds', activeViewId: 'viewIds'};
      depend(activeTargets[patch.field], patch.value);
    }
    if (type === 'setupState') {
      sets.setupIds.add(patch.setupId); depend('setupIds', patch.setupId);
      if (patch.state) stateDependencies(patch.state);
      continue;
    }
    const idFields = {stage: 'stageIds', characterRole: 'roleIds', entity: 'entityIds', setup: 'setupIds', view: 'viewIds', reference: 'referenceIds', output: 'outputIds'};
    const descriptor = collections[type];
    if (!descriptor) continue;
    const [, valueKey, idKey] = descriptor, value = patch[valueKey];
    const id = value?.id ?? patch[idKey];
    for (const itemId of patch.ids ?? [id]) sets[idFields[type]].add(itemId);
    depend(idFields[type], patch.beforeId); depend(idFields[type], patch.afterId);
    // Dependencies only conflict with structural add/remove. Read/read and independent
    // setup transforms remain disjoint, while undo cannot orphan a later role/stage user.
    if (patch.type.endsWith('.remove') || patch.type.endsWith('.upsert') && patch.index !== undefined) lifecycle[idFields[type]].add(id);
    // A later reordering invalidates earlier insertion anchors even if all IDs
    // survive. Treat position changes as structural dependency conflicts.
    if (patch.type.endsWith('.order')) for (const itemId of patch.ids) lifecycle[idFields[type]].add(itemId);
    if (value) {
      depend('stageIds', value.stageId); depend('roleIds', value.roleId);
      value.referenceIds?.forEach(referenceId => depend('referenceIds', referenceId));
      if (type === 'stage') depend('stageIds', value.lineage.sourceStageId);
      if (type === 'setup') setupDependencies(value);
      if (type === 'view') {
        depend('setupIds', value.setupId); depend('entityIds', value.sourceCameraEntityId);
        depend('entityIds', value.camera.focus?.entityId); depend('entityIds', value.camera.lookAt?.entityId);
      }
    }
    if (type === 'view' && value?.sourceCameraEntityId) sets.entityIds.add(value.sourceCameraEntityId);
    if (type === 'reference' && value) value.targets.forEach(addTarget);
    if (type === 'output' && value) sets.viewIds.add(value.source.id);
  }
  const lists = source => Object.fromEntries(Object.entries(source).map(([field, ids]) => [field, [...ids]]));
  return {environment, space, selection, ...lists(sets), lifecycle: lists(lifecycle), dependencies: lists(dependencies)};
}
export function touchesOverlap(left, right) {
  if (left.environment && right.environment || left.space && right.space || left.selection && right.selection) return true;
  return ['stageIds', 'roleIds', 'entityIds', 'setupIds', 'viewIds', 'referenceIds', 'outputIds'].some(field =>
    left[field].some(id => right[field].includes(id)) ||
    left.lifecycle[field].some(id => right.dependencies[field].includes(id)) || right.lifecycle[field].some(id => left.dependencies[field].includes(id)));
}
