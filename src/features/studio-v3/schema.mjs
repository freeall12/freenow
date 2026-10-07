import {assertJson, clone, defined, isRecord, requireDomain} from './invariants.mjs';

export const SCHEMA_VERSION = 4;
export const DEFAULT_STAGE_ID = 'stage-default';
export const baselineId = stageId => stageId === DEFAULT_STAGE_ID ? 'setup-default' : `setup:${stageId}:default`;
export const initialSetupId = stageId => stageId === DEFAULT_STAGE_ID ? 'setup:state-1' : `setup:${stageId}:state-1`;
const entityKinds = ['actor', 'camera', 'prop'];
const rotationOrders = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

function text(value, path) {
  requireDomain(typeof value === 'string' && value.trim().length > 0, path, 'must be nonempty text');
}
function number(value, path, minimum = -Infinity) {
  requireDomain(typeof value === 'number' && Number.isFinite(value) && value >= minimum, path, 'must be a finite number in range');
}
function record(value, path) { requireDomain(isRecord(value), path, 'must be an object'); }
function array(value, path) { requireDomain(Array.isArray(value), path, 'must be an array'); }
function keys(value, allowed, path) {
  record(value, path);
  for (const key of Object.keys(value)) requireDomain(allowed.includes(key), `${path}.${key}`, 'unsupported field');
}
function strings(value, path) {
  array(value, path);
  value.forEach((item, index) => text(item, `${path}[${index}]`));
  requireDomain(new Set(value).size === value.length, path, 'duplicate values');
}
function timestamps(value, path) {
  number(value.createdAt, `${path}.createdAt`, 0);
  number(value.updatedAt, `${path}.updatedAt`, value.createdAt);
}
function indexed(items, field, path) {
  array(items, path);
  const result = new Map();
  items.forEach((item, index) => {
    record(item, `${path}[${index}]`);
    text(item[field], `${path}[${index}].${field}`);
    requireDomain(!result.has(item[field]), path, `duplicate ${field}: ${item[field]}`, 'duplicate-id');
    result.set(item[field], item);
  });
  return result;
}
function belongs(map, id, path, stageId) {
  const value = map.get(id);
  requireDomain(!!value, path, `missing target: ${id}`, 'missing-relation');
  if (stageId !== undefined) requireDomain(value.stageId === stageId, path, 'cross-stage relationship', 'cross-stage');
  return value;
}

export function assertVector(value, path = 'vector') {
  keys(value, ['x', 'y', 'z'], path);
  for (const axis of ['x', 'y', 'z']) number(value[axis], `${path}.${axis}`);
}
function rotation(value, path) {
  keys(value, ['x', 'y', 'z', 'order'], path);
  for (const axis of ['x', 'y', 'z']) number(value[axis], `${path}.${axis}`);
  if (value.order !== undefined) requireDomain(rotationOrders.includes(value.order), `${path}.order`, 'unknown Euler order');
}
function transform(value, path) {
  keys(value, ['position', 'rotation', 'scale'], path);
  assertVector(value.position, `${path}.position`);
  rotation(value.rotation, `${path}.rotation`);
  assertVector(value.scale, `${path}.scale`);
  for (const axis of ['x', 'y', 'z']) requireDomain(value.scale[axis] !== 0, `${path}.scale.${axis}`, 'zero scale is not editable');
}
function entityTarget(value, path, entities, stageId, type = 'look') {
  record(value, path);
  const discriminator = type === 'look' ? value.kind : value.mode;
  const targetMode = type === 'focus' ? 'object' : 'entity';
  if (discriminator === 'none') { keys(value, [type === 'look' ? 'kind' : 'mode'], path); return; }
  if (discriminator === 'point') {
    keys(value, type === 'look' ? ['kind', 'position'] : ['mode', 'target'], path);
    assertVector(type === 'look' ? value.position : value.target, path);
    return;
  }
  if (type === 'focus' && discriminator === 'distance') {
    keys(value, ['mode', 'distance'], path); number(value.distance, `${path}.distance`, 0); return;
  }
  requireDomain(discriminator === targetMode, path, 'unknown target mode');
  keys(value, type === 'look' ? ['kind', 'entityId'] : ['mode', 'entityId', 'offset'], path);
  text(value.entityId, `${path}.entityId`);
  if (entities) belongs(entities, value.entityId, `${path}.entityId`, stageId);
  if (value.offset !== undefined) assertVector(value.offset, `${path}.offset`);
}

export function assertCamera(value, path = 'camera', entities, stageId) {
  keys(value, ['position', 'rotation', 'fov', 'frameAspectRatio', 'focalLength', 'apertureFNumber', 'depthOfFieldMode', 'focusDistance', 'focus', 'lookAt'], path);
  assertVector(value.position, `${path}.position`);
  rotation(value.rotation, `${path}.rotation`);
  number(value.fov, `${path}.fov`, Number.MIN_VALUE);
  requireDomain(value.fov < 180, `${path}.fov`, 'must be less than 180 degrees');
  for (const field of ['frameAspectRatio', 'focalLength', 'apertureFNumber', 'focusDistance']) {
    if (value[field] === undefined || value[field] === null && ['frameAspectRatio', 'focusDistance'].includes(field)) continue;
    number(value[field], `${path}.${field}`, Number.MIN_VALUE);
  }
  if (value.depthOfFieldMode !== undefined) requireDomain(['aperture', 'deepFocus'].includes(value.depthOfFieldMode), path, 'unknown depth of field mode');
  if (value.focus !== undefined) entityTarget(value.focus, `${path}.focus`, entities, stageId, 'focus');
  if (value.lookAt !== undefined) entityTarget(value.lookAt, `${path}.lookAt`, entities, stageId, 'camera-look');
}

export function assertEntityDefinition(entity, path = 'entity') {
  keys(entity, ['id', 'stageId', 'kind', 'label', 'locked', 'roleId', 'actorGender', 'asset', 'color', 'materialMode', 'generationOperationId', 'referenceIds', 'createdAt', 'updatedAt'], path);
  for (const field of ['id', 'stageId', 'label']) text(entity[field], `${path}.${field}`);
  requireDomain(entityKinds.includes(entity.kind), `${path}.kind`, 'unknown entity kind');
  if (entity.locked !== undefined) requireDomain(typeof entity.locked === 'boolean', path, 'locked must be boolean');
  for (const field of ['roleId', 'actorGender', 'color', 'generationOperationId']) if (entity[field] !== undefined) text(entity[field], `${path}.${field}`);
  requireDomain(entity.roleId === undefined || entity.kind === 'actor', path, 'only an actor can have a role');
  if (entity.materialMode !== undefined) requireDomain(['source', 'clay'].includes(entity.materialMode), path, 'unknown material mode');
  if (entity.asset !== undefined) {
    record(entity.asset, `${path}.asset`);
    text(entity.asset.sourceUrl, `${path}.asset.sourceUrl`);
    requireDomain(['glb', 'spz'].includes(entity.asset.sourceFormat), path, 'unknown asset format');
    if (entity.asset.presentationAnchor !== undefined) requireDomain(['center', 'bottom'].includes(entity.asset.presentationAnchor), path, 'unknown presentation anchor');
  }
  strings(entity.referenceIds, `${path}.referenceIds`);
  timestamps(entity, path);
}

export function assertSetupState(state, path = 'entityState', entities, stageId) {
  keys(state, ['entityId', 'transform', 'visible', 'lookTarget', 'pose', 'heldEntityId', 'camera', 'path', 'updatedAt'], path);
  text(state.entityId, `${path}.entityId`);
  const entity = entities ? belongs(entities, state.entityId, path, stageId) : null;
  transform(state.transform, `${path}.transform`);
  requireDomain(typeof state.visible === 'boolean', `${path}.visible`, 'must be boolean');
  number(state.updatedAt, `${path}.updatedAt`, 0);
  if (state.lookTarget !== undefined) entityTarget(state.lookTarget, `${path}.lookTarget`, entities, stageId);
  if (state.heldEntityId !== undefined) {
    text(state.heldEntityId, `${path}.heldEntityId`);
    if (entities) belongs(entities, state.heldEntityId, path, stageId);
  }
  if (state.pose !== undefined) text(state.pose, `${path}.pose`);
  if (state.camera !== undefined) {
    requireDomain(!entity || entity.kind === 'camera', path, 'only camera entities have camera state');
    assertCamera(state.camera, `${path}.camera`, entities, stageId);
  }
  if (state.path !== undefined) {
    array(state.path, `${path}.path`);
    state.path.forEach((point, index) => {
      record(point, `${path}.path[${index}]`);
      assertVector(point.position, `${path}.path[${index}].position`);
    });
  }
}

const channelKinds = {
  'entity.transform.position': 'vec3', 'entity.transform.rotation': 'euler3', 'entity.transform.scale': 'vec3',
  'entity.visibility': 'boolean', 'entity.pose': 'pose', 'entity.lookTarget': 'look-target', 'entity.heldEntityId': 'text',
  'camera.rotation': 'euler3', 'camera.fov': 'number', 'camera.focalLength': 'number', 'camera.frameAspectRatio': 'number',
  'camera.focusDistance': 'number', 'camera.apertureFNumber': 'number', 'camera.focus': 'camera-focus',
  'camera.depthOfFieldMode': 'camera-depth-of-field-mode', 'camera.lookAt': 'camera-look-at'
};
function temporal(value, setup, entities, path) {
  keys(value, ['durationMs', 'tracks'], path);
  number(value.durationMs, `${path}.durationMs`, 0);
  const tracks = indexed(value.tracks, 'id', `${path}.tracks`), owners = new Set();
  for (const track of tracks.values()) {
    keys(track, ['id', 'owner', 'keys', 'channels', 'pathEndpointControls', 'segments'], `${path}.${track.id}`);
    keys(track.owner, ['kind', 'entityId'], path);
    requireDomain(track.owner.kind === 'entity', path, 'track owner must be an entity');
    const owner = belongs(entities, track.owner.entityId, path, setup.stageId);
    requireDomain(setup.entityStates.some(state => state.entityId === owner.id), path, 'track owner must have a local setup state');
    requireDomain(!owners.has(owner.id), path, 'duplicate track owner'); owners.add(owner.id);
    const trackKeys = indexed(track.keys, 'id', `${path}.keys`), times = new Set();
    let previous = -1;
    for (const key of trackKeys.values()) {
      keys(key, ['id', 'timeMs', 'label'], path);
      number(key.timeMs, path, 0);
      requireDomain(Number.isInteger(key.timeMs) && key.timeMs <= value.durationMs && key.timeMs > previous, path, 'keys must be ordered unique integer milliseconds within duration');
      requireDomain(!times.has(key.timeMs), path, 'duplicate key time'); times.add(key.timeMs); previous = key.timeMs;
      if (key.label !== undefined) text(key.label, path);
    }
    indexed(track.channels, 'id', `${path}.channels`);
    const properties = new Set();
    for (const channel of track.channels) {
      keys(channel, ['id', 'property', 'values'], path);
      requireDomain(Object.hasOwn(channelKinds, channel.property), path, 'unknown temporal property');
      requireDomain(!properties.has(channel.property), path, 'duplicate temporal property'); properties.add(channel.property);
      requireDomain(!channel.property.startsWith('camera.') || owner.kind === 'camera', path, 'camera channel requires camera entity');
      indexed(channel.values, 'keyId', `${path}.values`);
      for (const sample of channel.values) {
        keys(sample, ['keyId', 'value', 'interpolation'], path);
        requireDomain(trackKeys.has(sample.keyId), path, 'channel value references missing key');
        if (sample.interpolation !== undefined) requireDomain(['linear', 'hold'].includes(sample.interpolation), path, 'unknown interpolation');
        keys(sample.value, ['kind', 'value'], path);
        requireDomain(sample.value.kind === channelKinds[channel.property], path, 'channel value kind mismatch');
        const item = sample.value.value;
        switch (sample.value.kind) {
          case 'number': number(item, path); break;
          case 'vec3': assertVector(item, path); break;
          case 'euler3': rotation(item, path); break;
          case 'boolean': requireDomain(typeof item === 'boolean', path, 'expected boolean'); break;
          case 'pose': text(item, path); break;
          case 'text': if (item !== null) belongs(entities, item, path, setup.stageId); break;
          case 'look-target': entityTarget(item, path, entities, setup.stageId); break;
          case 'camera-focus': entityTarget(item, path, entities, setup.stageId, 'focus'); break;
          case 'camera-look-at': entityTarget(item, path, entities, setup.stageId, 'camera-look'); break;
          case 'camera-depth-of-field-mode': requireDomain(['aperture', 'deepFocus'].includes(item), path, 'unknown depth of field mode'); break;
        }
      }
    }
    if (track.pathEndpointControls !== undefined) {
      keys(track.pathEndpointControls, ['start', 'end'], path);
      for (const endpoint of Object.values(track.pathEndpointControls)) {
        keys(endpoint, ['point'], path); assertVector(endpoint.point, path);
      }
    }
    if (track.segments !== undefined) {
      array(track.segments, path);
      for (const segment of track.segments) {
        keys(segment, ['fromKeyId', 'toKeyId', 'transition'], path);
        const from = trackKeys.get(segment.fromKeyId), to = trackKeys.get(segment.toKeyId);
        requireDomain(!!from && !!to && from.timeMs < to.timeMs, path, 'segment references invalid keys');
        if (segment.transition !== undefined) {
          keys(segment.transition, ['spatialBend'], path);
          if (segment.transition.spatialBend !== undefined) {
            keys(segment.transition.spatialBend, ['point', 't'], path);
            assertVector(segment.transition.spatialBend.point, path);
            number(segment.transition.spatialBend.t, path, 0.05);
            requireDomain(segment.transition.spatialBend.t <= 0.95, path, 'bend must be within segment');
          }
        }
      }
    }
  }
}

export function assertWorldSpace(space, worldNodeId, path = 'worldSpace') {
  assertJson(space, path);
  keys(space, ['source', 'roomConfig', 'stages', 'characterRoles', 'entities', 'setups', 'views', 'references', 'outputs', 'activeStageId', 'activeSetupId', 'activeViewId'], path);
  record(space.source, `${path}.source`);
  requireDomain(['world-asset', 'empty', 'mesh-preset', 'history-world'].includes(space.source.kind), path, 'unknown space source');
  if (space.source.kind === 'mesh-preset') requireDomain(space.source.preset === 'room', path, 'unknown mesh preset');
  if (space.source.kind === 'history-world') record(space.source.threedMeta, path);
  record(space.roomConfig, `${path}.roomConfig`);
  for (const field of ['width', 'depth', 'height']) number(space.roomConfig[field], `${path}.roomConfig.${field}`, 1);
  const stages = indexed(space.stages, 'id', `${path}.stages`);
  requireDomain(stages.size > 0, path, 'at least one stage required');
  for (const stage of stages.values()) {
    keys(stage, ['id', 'worldNodeId', 'label', 'source', 'lineage', 'thumbnailSrc', 'worldSpacePosition', 'createdAt', 'updatedAt'], path);
    requireDomain(stage.worldNodeId === worldNodeId, path, 'stage owner mismatch', 'owner-mismatch');
    text(stage.label, path); timestamps(stage, path);
    keys(stage.source, ['kind'], path); requireDomain(stage.source.kind === 'world', path, 'stage source must be world');
    keys(stage.lineage, ['kind', 'sourceStageId', 'generationTaskId'], path);
    requireDomain(['initial', 'generated'].includes(stage.lineage.kind), path, 'unknown stage lineage');
    if (stage.lineage.sourceStageId !== undefined) requireDomain(stages.has(stage.lineage.sourceStageId) && stage.lineage.sourceStageId !== stage.id, path, 'invalid source stage');
    if (stage.lineage.generationTaskId !== undefined) text(stage.lineage.generationTaskId, path);
    requireDomain(stage.thumbnailSrc === null || typeof stage.thumbnailSrc === 'string', path, 'thumbnail must be string or null');
    keys(stage.worldSpacePosition, ['x', 'y'], path);
    number(stage.worldSpacePosition.x, path); number(stage.worldSpacePosition.y, path);
  }
  const roles = indexed(space.characterRoles, 'id', `${path}.characterRoles`);
  const entities = indexed(space.entities, 'id', `${path}.entities`);
  const setups = indexed(space.setups, 'id', `${path}.setups`);
  const views = indexed(space.views, 'id', `${path}.views`);
  const references = indexed(space.references, 'id', `${path}.references`);
  indexed(space.outputs, 'id', `${path}.outputs`);
  const checkReferences = value => {
    strings(value.referenceIds, `${path}.${value.id}.referenceIds`);
    for (const id of value.referenceIds) belongs(references, id, path);
  };
  for (const role of roles.values()) {
    keys(role, ['id', 'stageId', 'label', 'color', 'actorGender', 'asset', 'referenceIds', 'createdAt', 'updatedAt'], path);
    requireDomain(stages.has(role.stageId), path, 'role stage missing');
    assertEntityDefinition({...role, kind: 'actor'}, `${path}.role:${role.id}`); checkReferences(role);
  }
  for (const entity of entities.values()) {
    assertEntityDefinition(entity, `${path}.entity:${entity.id}`);
    requireDomain(stages.has(entity.stageId), path, 'entity stage missing');
    if (entity.roleId !== undefined) belongs(roles, entity.roleId, path, entity.stageId);
    checkReferences(entity);
  }
  for (const stage of stages.values()) {
    const baseline = setups.get(baselineId(stage.id));
    requireDomain(baseline?.kind === 'scene-baseline' && baseline.stageId === stage.id, path, 'stage baseline missing');
    indexed(baseline.entityStates, 'entityId', `${path}.${baseline.id}.entityStates`);
    requireDomain(space.setups.some(setup => setup.stageId === stage.id && setup.kind === 'independent'), path, 'stage requires an independent setup');
  }
  for (const setup of setups.values()) {
    keys(setup, ['id', 'kind', 'stageId', 'label', 'entityStates', 'tags', 'createdAt', 'updatedAt', 'temporal', 'planDrawing'], path);
    requireDomain(stages.has(setup.stageId), path, 'setup stage missing');
    text(setup.label, path); strings(setup.tags, path); timestamps(setup, path);
    requireDomain(['scene-baseline', 'independent'].includes(setup.kind), path, 'unknown setup kind');
    requireDomain((setup.id === baselineId(setup.stageId)) === (setup.kind === 'scene-baseline'), path, 'baseline ID/kind mismatch');
    indexed(setup.entityStates, 'entityId', `${path}.${setup.id}.entityStates`);
    const shared = new Set(setups.get(baselineId(setup.stageId)).entityStates.map(state => state.entityId));
    for (const state of setup.entityStates) {
      assertSetupState(state, `${path}.${setup.id}.${state.entityId}`, entities, setup.stageId);
      requireDomain(setup.kind === 'scene-baseline' || !shared.has(state.entityId), path, 'independent setup cannot override baseline entity');
    }
    requireDomain(setup.kind !== 'scene-baseline' || setup.temporal === undefined, path, 'baseline cannot contain temporal tracks');
    if (setup.temporal !== undefined) temporal(setup.temporal, setup, entities, `${path}.${setup.id}.temporal`);
  }
  for (const view of views.values()) {
    keys(view, ['id', 'stageId', 'setupId', 'sourceCameraEntityId', 'label', 'camera', 'notes', 'referenceIds', 'tags', 'durationMs', 'generationContext', 'createdAt', 'updatedAt', 'viewportDrawing'], path);
    const setup = belongs(setups, view.setupId, path, view.stageId);
    requireDomain(setup.kind === 'independent', path, 'view requires independent setup');
    if (view.sourceCameraEntityId !== undefined) requireDomain(belongs(entities, view.sourceCameraEntityId, path, view.stageId).kind === 'camera', path, 'view source must be camera');
    text(view.label, path); timestamps(view, path); strings(view.tags, path); checkReferences(view);
    assertCamera(view.camera, path, entities, view.stageId);
    if (view.durationMs !== undefined) number(view.durationMs, path, 0);
    if (view.notes !== undefined) requireDomain(typeof view.notes === 'string', path, 'notes must be text');
  }
  const targets = {stage: stages, setup: setups, entity: entities, view: views};
  for (const reference of references.values()) {
    array(reference.targets, path);
    const seen = new Set();
    for (const target of reference.targets) {
      keys(target, ['kind', 'id'], path);
      requireDomain(Object.hasOwn(targets, target.kind), path, 'unknown reference target');
      belongs(targets[target.kind], target.id, path);
      const key = `${target.kind}:${target.id}`;
      requireDomain(!seen.has(key), path, 'duplicate reference target'); seen.add(key);
    }
  }
  for (const output of space.outputs) {
    keys(output.source, ['kind', 'id'], path);
    requireDomain(output.source.kind === 'view', path, 'output source must be view');
    belongs(views, output.source.id, path);
  }
  requireDomain(stages.has(space.activeStageId), path, 'active stage missing');
  belongs(setups, space.activeSetupId, path, space.activeStageId);
  if (space.activeViewId !== null) {
    const view = belongs(views, space.activeViewId, path, space.activeStageId);
    requireDomain(view.setupId === space.activeSetupId, path, 'active view/setup mismatch');
  }
  return space;
}

export function assertState(state) {
  record(state, 'state');
  requireDomain(Number.isInteger(state.schemaVersion) && state.schemaVersion === SCHEMA_VERSION, 'state.schemaVersion', 'only schemaVersion 4 is accepted; no migration', 'unsupported-schema');
  assertJson(state);
  keys(state, ['schemaVersion', 'scenePlay', 'capturedPhotos', 'worldGenerationTasks'], 'state');
  keys(state.scenePlay, ['id', 'worldNodeId', 'worldSpace', 'environment', 'editSessions'], 'state.scenePlay');
  text(state.scenePlay.id, 'state.scenePlay.id'); text(state.scenePlay.worldNodeId, 'state.scenePlay.worldNodeId');
  keys(state.scenePlay.environment, ['ground', 'hdriResources', 'lighting', 'skyboxSource'], 'environment');
  for (const field of ['editSessions']) array(state.scenePlay[field], `scenePlay.${field}`);
  array(state.capturedPhotos, 'capturedPhotos'); array(state.worldGenerationTasks, 'worldGenerationTasks');
  assertWorldSpace(state.scenePlay.worldSpace, state.scenePlay.worldNodeId);
  return state;
}

export function createStage({worldNodeId, id = DEFAULT_STAGE_ID, label = 'Stage 1', lineage = {kind: 'initial'}, now = Date.now()}) {
  text(worldNodeId, 'stage.worldNodeId'); text(id, 'stage.id'); text(label, 'stage.label'); number(now, 'stage.createdAt', 0);
  keys(lineage, ['kind', 'sourceStageId', 'generationTaskId'], 'stage.lineage');
  requireDomain(['initial', 'generated'].includes(lineage.kind), 'stage.lineage', 'unknown lineage');
  return clone({id, worldNodeId, label, source: {kind: 'world'}, lineage, thumbnailSrc: null, worldSpacePosition: {x: 0, y: 0}, createdAt: now, updatedAt: now});
}
export function createBaseline({stageId = DEFAULT_STAGE_ID, label = 'Scene baseline', now = Date.now()} = {}) {
  text(stageId, 'setup.stageId'); text(label, 'setup.label'); number(now, 'setup.createdAt', 0);
  return {id: baselineId(stageId), kind: 'scene-baseline', stageId, label, entityStates: [], tags: [], createdAt: now, updatedAt: now};
}
export function createIndependentSetup({id, stageId = DEFAULT_STAGE_ID, label = 'State', now = Date.now()}) {
  text(id, 'setup.id'); text(stageId, 'setup.stageId'); text(label, 'setup.label'); number(now, 'setup.createdAt', 0);
  requireDomain(id !== baselineId(stageId), 'setup.id', 'independent setup cannot use baseline ID');
  return {id, kind: 'independent', stageId, label, entityStates: [], tags: [], createdAt: now, updatedAt: now};
}
export function createEntity({id, stageId = DEFAULT_STAGE_ID, kind, label, locked, roleId, actorGender, asset, color, materialMode, generationOperationId, referenceIds = [], now = Date.now()}) {
  const entity = clone(defined({id, stageId, kind, label, locked: locked || undefined, roleId, actorGender, asset, color, materialMode, generationOperationId, referenceIds, createdAt: now, updatedAt: now}));
  assertEntityDefinition(entity); return entity;
}
export function createRole({id, stageId = DEFAULT_STAGE_ID, label, color, actorGender, asset, referenceIds = [], now = Date.now()}) {
  const {kind, ...role} = createEntity({id, stageId, kind: 'actor', label, color, actorGender, asset, referenceIds, now});
  return role;
}
export function createActorFromRole({id, role, label = role.label, now = Date.now()}) {
  return createEntity({id, stageId: role.stageId, kind: 'actor', label, roleId: role.id, actorGender: role.actorGender, asset: role.asset, color: role.color, referenceIds: role.referenceIds, now});
}
export function createSetupState(entityId, now = Date.now()) {
  text(entityId, 'entityState.entityId'); number(now, 'entityState.updatedAt', 0);
  return {entityId, transform: {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}}, visible: true, lookTarget: {kind: 'none'}, updatedAt: now};
}
export function createView({id, stageId = DEFAULT_STAGE_ID, setupId = initialSetupId(stageId), label, sourceCameraEntityId, camera, notes, referenceIds = [], tags = ['capture'], durationMs, generationContext, now = Date.now()}) {
  text(id, 'view.id'); text(label, 'view.label'); text(stageId, 'view.stageId'); text(setupId, 'view.setupId'); number(now, 'view.createdAt', 0);
  strings(referenceIds, 'view.referenceIds'); strings(tags, 'view.tags'); assertCamera(camera);
  return clone(defined({id, stageId, setupId, sourceCameraEntityId, label, camera, notes, referenceIds, tags, durationMs, generationContext, createdAt: now, updatedAt: now}));
}
export function createState({worldNodeId, id = `scene-play:${worldNodeId}`, now = Date.now()}) {
  const stage = createStage({worldNodeId, now});
  const state = {schemaVersion: SCHEMA_VERSION, scenePlay: {id, worldNodeId, worldSpace: {
    source: {kind: 'world-asset'}, roomConfig: {width: 5, depth: 12, height: 3.2, trackingGuides: {enabled: true, lineMarkers: false, mode: 'standard', spacingMeters: 0.5}},
    stages: [stage], characterRoles: [], entities: [], setups: [createBaseline({now}), createIndependentSetup({id: initialSetupId(stage.id), label: 'State 1', now})],
    views: [], references: [], outputs: [], activeStageId: stage.id, activeSetupId: initialSetupId(stage.id), activeViewId: null
  }, environment: {ground: {}, hdriResources: [], lighting: {}, skyboxSource: {kind: 'none'}}, editSessions: []}, capturedPhotos: [], worldGenerationTasks: []};
  assertState(state); return state;
}
