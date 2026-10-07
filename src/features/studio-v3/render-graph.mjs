import * as THREE from 'three';
import {assertState} from './schema.mjs';
import {renderSetup} from './world-space.mjs';
import {createAssetLoader, BUILTIN_ASSETS} from './asset-loader.mjs';
import {disposeModel} from '../studio-v2/model-io.mjs';
import {spatialBounds} from '../world-node/splat-io.mjs';
import {CAMERA_OPTICS_DEFAULTS, applyCameraOptics} from './camera-optics.mjs';

const error = (code, message) => Object.assign(Error(message), {code});
const xyz = value => [value.x, value.y, value.z];
function clipHasMotion(clip) {
  return clip.tracks.some(track => {const stride = track.getValueSize(); for (let index = stride; index < track.values.length; index++) if (Math.abs(track.values[index] - track.values[index % stride]) > 1e-5) return true; return false;});
}
function identityFence(value) {if (!value || typeof value !== 'object') return value; const {revision, editEpoch, ...identity} = value; return identity;}
export function applyTransform(root, transform) {
  root.position.set(...xyz(transform.position)); root.rotation.set(...xyz(transform.rotation), transform.rotation.order || 'XYZ'); root.scale.set(...xyz(transform.scale)); root.updateMatrixWorld(true);
}
export function readTransform(root) {return {position: {x: root.position.x, y: root.position.y, z: root.position.z}, rotation: {x: root.rotation.x, y: root.rotation.y, z: root.rotation.z, order: root.rotation.order}, scale: {x: root.scale.x, y: root.scale.y, z: root.scale.z}};}
export function createRenderGraph({scene, loader = createAssetLoader(), getFence = () => null, isCurrent = () => true, onStatus = () => {}, onInvalidate = () => {}, onAttach = async () => {}, onDetach = () => {}}) {
  const content = new THREE.Group(), worldRoot = new THREE.Group(), entityRoot = new THREE.Group(), helpers = new THREE.Group();
  content.name = 'V3 authoritative render content'; worldRoot.name = 'V3 source world'; entityRoot.name = 'V3 entities'; helpers.name = 'V3 helpers'; helpers.userData.helper = helpers.userData.captureExcluded = true;
  content.add(worldRoot, entityRoot); scene.add(content, helpers);
  const entities = new Map(); let source = null, boundary, disposed = false, epoch = 0;
  const fence = () => JSON.stringify(getFence());
  const current = record => !disposed && record.boundary === boundary && record.epoch === epoch && isCurrent() && record.fence === fence() && (record.kind === 'source' ? source === record : entities.get(record.id) === record);
  const status = (record, value, failure) => {record.status = value; record.error = failure || null; onStatus({kind: record.kind, id: record.id, status: value, ...(failure ? {error: failure.message, code: failure.code || 'studio_v3_render_failed'} : {})});};
  function disposeRecord(record) {
    if (!record || record.disposed) return; record.disposed = true; record.abort.abort(error('studio_v3_render_cancelled', '渲染目标已变化'));
    record.root?.removeFromParent(); record.camera?.removeFromParent(); record.cameraHelper?.removeFromParent();
    record.mixer?.stopAllAction(); if (record.mixer) record.mixer.uncacheRoot(record.asset.root);
    record.cameraHelper?.dispose(); onDetach(record);
    // Clay removes texture references from materials. Restore those owned
    // references before the loader's disposer walks them, including on failure.
    for (const [material, original] of record.materialOriginals || []) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (Object.hasOwn(original, key)) material[key] = original[key];
    record.asset?.dispose();
  }
  function removeEntity(id) {const record = entities.get(id); entities.delete(id); disposeRecord(record);}
  function material(record) {
    const definition = record.definition, color = definition.color || (definition.kind === 'actor' ? '#d0a552' : null);
    const key = JSON.stringify([color, definition.materialMode]); if (key === record.materialKey) return; record.materialKey = key;
    record.asset.root.traverse(object => {for (const mat of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      // Assets are independently decoded per entity. Source material fields are
      // retained so toggling clay never permanently loses textures or colors.
      if (!record.materialOriginals.has(mat)) record.materialOriginals.set(mat, {color: mat.color?.clone(), map: mat.map, normalMap: mat.normalMap, roughnessMap: mat.roughnessMap, metalnessMap: mat.metalnessMap, emissiveMap: mat.emissiveMap, roughness: mat.roughness, metalness: mat.metalness, emissive: mat.emissive?.clone()});
      const original = record.materialOriginals.get(mat);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'roughness', 'metalness']) if (original[key] !== undefined) mat[key] = original[key];
      if (original.color) mat.color.copy(original.color); if (original.emissive) mat.emissive.copy(original.emissive);
      if (definition.materialMode === 'clay') {for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) mat[key] = null; mat.color?.set(color || '#ddd'); mat.emissive?.set(0); mat.roughness = .8; mat.metalness = 0;}
      else if (color) mat.color?.set(color);
      mat.needsUpdate = true;
    }});
  }
  function pose(record) {
    if (record.definition.kind !== 'actor') return;
    const next = record.state.pose || 'Standing'; if (record.pose === next) return;
    const clip = record.asset.animations.find(value => value.name === next);
    if (!clip) throw error('studio_v3_pose_missing', `角色模型没有姿态 ${next}`);
    record.mixer ||= new THREE.AnimationMixer(record.asset.root); record.mixer.stopAllAction(); record.action = record.mixer.clipAction(clip).reset().play(); record.mixer.update(.001); record.pose = next;
    record.dynamic = next !== 'Standing' && clip.duration > 0 && clipHasMotion(clip); record.action.paused = !record.dynamic;
  }
  function camera(record) {
    if (record.definition.kind !== 'camera') return;
    const config = record.state.camera, transform = record.state.transform;
    record.camera ||= new THREE.PerspectiveCamera(CAMERA_OPTICS_DEFAULTS.fov, CAMERA_OPTICS_DEFAULTS.frameAspectRatio, .1, 1000);
    record.camera.userData.captureExcluded = true;
    record.camera.position.set(...xyz(config?.position || transform.position)); record.camera.rotation.set(...xyz(config?.rotation || transform.rotation), config?.rotation?.order || transform.rotation.order || 'XYZ');
    applyCameraOptics(record.camera, config || CAMERA_OPTICS_DEFAULTS);
    // Imported snapshots can predate reducer pose synchronization. The model
    // represents the same optical camera even while that snapshot is unchanged.
    record.root.position.copy(record.camera.position); record.root.rotation.copy(record.camera.rotation); record.root.updateMatrixWorld(true);
    record.camera.updateProjectionMatrix(); record.camera.updateMatrixWorld(true);
    if (!record.cameraHelper) {record.cameraHelper = new THREE.CameraHelper(record.camera); record.cameraHelper.userData.helper = record.cameraHelper.userData.captureExcluded = true; helpers.add(record.cameraHelper);}
    record.cameraHelper.visible = record.state.visible; record.cameraHelper.update();
  }
  function targets() {
    const positionOf = target => target?.kind === 'point' ? new THREE.Vector3(...xyz(target.position)) : target?.mode === 'point' ? new THREE.Vector3(...xyz(target.target)) : target?.entityId && entities.get(target.entityId)?.root?.getWorldPosition(new THREE.Vector3());
    for (const record of entities.values()) if (record.status === 'ready') {
      const target = record.definition.kind === 'camera' ? record.state.camera?.lookAt : record.state.lookTarget;
      const point = positionOf(target); if (!point) continue;
      if (record.camera) {record.camera.lookAt(point); record.camera.updateMatrixWorld(true); record.root.quaternion.copy(record.camera.quaternion); record.root.updateMatrixWorld(true); record.cameraHelper?.update();}
      else record.root.lookAt(point);
    }
  }
  function apply(record) {
    if (!record.root || record.kind === 'source') return;
    applyTransform(record.root, record.state.transform); record.root.visible = record.state.visible;
    Object.assign(record.root.userData, {entityId: record.id, entityKind: record.definition.kind, locked: ['actor', 'prop'].includes(record.definition.kind) && record.definition.locked === true, captureExcluded: record.definition.kind === 'camera', renderPending: record.status !== 'ready'});
    record.root.name = record.definition.label; material(record); pose(record); camera(record);
  }
  function prepare(record, asset) {
    record.asset = asset; record.materialOriginals = new Map(); record.root = new THREE.Group(); record.root.name = record.kind === 'source' ? 'V3 source model' : record.definition.label;
    record.root.add(asset.root);
    if (record.kind === 'entity' && asset.format === 'glb') {
      const box = new THREE.Box3().setFromObject(asset.root), size = box.getSize(new THREE.Vector3());
      if (record.definition.kind === 'actor') asset.root.scale.multiplyScalar(1.7 / Math.max(size.y, .001));
      else if (record.definition.kind === 'camera') asset.root.scale.multiplyScalar(.25 / Math.max(size.x, size.y, size.z, .001));
      asset.root.updateMatrixWorld(true); box.setFromObject(asset.root); const center = box.getCenter(new THREE.Vector3());
      const anchor = record.assetDescriptor.presentationAnchor || (record.definition.kind === 'camera' ? 'center' : 'bottom');
      asset.root.position.x -= center.x; asset.root.position.z -= center.z; asset.root.position.y -= anchor === 'center' ? center.y : box.min.y;
    }
    record.root.userData.renderPending = true; record.root.visible = false;
    (record.kind === 'source' ? worldRoot : entityRoot).add(record.root);
    if (record.kind === 'entity') apply(record);
    record.root.visible = false;
  }
  function begin(record) {
    status(record, 'loading');
    record.pending = loader.load(record.assetDescriptor, {signal: record.abort.signal, isCurrent: () => current(record)}).then(async asset => {
      if (!current(record)) {asset.dispose(); return;}
      try {
        prepare(record, asset); await onAttach(record);
        if (!current(record)) {disposeRecord(record); return;}
        status(record, 'ready'); record.root.userData.renderPending = false;
        if (record.kind === 'entity') apply(record); else record.root.visible = true;
        targets(); onInvalidate();
      } catch (failure) {disposeRecord(record); if (current(record)) status(record, 'failed', failure);}
    }, failure => {if (current(record)) {disposeRecord(record); status(record, 'failed', failure);}});
    return record.pending;
  }
  function makeRecord(kind, id, descriptor) {return {kind, id, assetDescriptor: descriptor, signature: JSON.stringify(descriptor), boundary, fence: fence(), epoch, abort: new AbortController(), status: 'loading'};}
  async function sync(state, sourceResource = null) {
    if (disposed) throw error('studio_v3_runtime_closed', '片场渲染已关闭'); assertState(state);
    const space = state.scenePlay.worldSpace, setup = renderSetup(state), nextBoundary = JSON.stringify([state.scenePlay.worldNodeId, setup.stageId, setup.id, identityFence(getFence())]);
    if (boundary !== nextBoundary) {boundary = nextBoundary; epoch++;
      for (const [id, record] of entities) if (record.status === 'loading') removeEntity(id);
      if (source?.status === 'loading') {disposeRecord(source); source = null;}
    }
    const desired = new Map(setup.entityStates.map(value => [value.entityId, value])), definitions = new Map(space.entities.map(value => [value.id, value])), tasks = [];
    for (const id of entities.keys()) if (!desired.has(id)) removeEntity(id);
    for (const [id, value] of desired) {
      const definition = definitions.get(id), role = space.characterRoles.find(role => role.id === definition.roleId);
      const descriptor = definition.asset || role?.asset || (BUILTIN_ASSETS[definition.kind] ? {sourceFormat: 'glb', sourceUrl: BUILTIN_ASSETS[definition.kind], presentationAnchor: definition.kind === 'camera' ? 'center' : 'bottom'} : null);
      let record = entities.get(id);
      if (record && (record.signature !== JSON.stringify(descriptor) || record.definition.kind !== definition.kind)) {removeEntity(id); record = null;}
      if (!record) {record = makeRecord('entity', id, descriptor); entities.set(id, record); record.definition = structuredClone(definition); record.state = structuredClone(value);
        if (!descriptor) {status(record, 'failed', error('studio_v3_entity_asset_missing', '道具实体缺少本地模型')); continue;}
        tasks.push(begin(record));
      } else {
        // A caller-supplied current domain snapshot can advance transforms or
        // labels while the same asset is decoding. Renew only its render fence;
        // source/owner/setup/asset changes still cancel the old resource token.
        if (record.status === 'loading') record.fence = fence();
        record.definition = structuredClone(definition); record.state = structuredClone(value);
        if (record.status === 'ready') {try {apply(record);} catch (failure) {disposeRecord(record); status(record, 'failed', failure);}}
        if (record.status === 'loading') tasks.push(record.pending);
      }
    }
    const descriptor = sourceResource ? {...sourceResource, sourceUrl: sourceResource.url || sourceResource.sourceUrl, sourceFormat: sourceResource.format || sourceResource.sourceFormat || 'glb'} : null;
    if (source?.signature !== JSON.stringify(descriptor)) {disposeRecord(source); source = null;}
    if (descriptor && !source) {source = makeRecord('source', setup.stageId, descriptor); tasks.push(begin(source));}
    else if (source?.status === 'loading') {source.fence = fence(); tasks.push(source.pending);}
    targets(); onInvalidate(); await Promise.all(tasks);
    return {epoch, stageId: setup.stageId, setupId: setup.id, entities: [...entities.values()].map(record => ({id: record.id, status: record.status, error: record.error?.message || null})), source: source ? {status: source.status, error: source.error?.message || null} : null};
  }
  function retry(id) {const record = id === 'source' ? source : entities.get(id); if (!record || record.status !== 'failed') return false; if (record.kind === 'source') {source = null; disposeRecord(record);} else removeEntity(id); return true;}
  const needsAnimation = () => [...entities.values()].some(record => record.status === 'ready' && record.state.visible && record.dynamic);
  function tick(delta) {let animated = false; for (const record of entities.values()) if (record.status === 'ready' && record.state.visible && record.dynamic) {record.mixer.update(delta); record.root.updateMatrixWorld(true); animated = true;} if (animated) targets(); return animated;}
  function bounds(id) {const root = id ? entities.get(id)?.root : content; return root ? spatialBounds(root, undefined, {framing: true}) : null;}
  function dispose() {if (disposed) return; disposed = true; epoch++; for (const id of [...entities.keys()]) removeEntity(id); disposeRecord(source); source = null; content.removeFromParent(); helpers.removeFromParent(); disposeModel(helpers); helpers.clear();}
  return {content, worldRoot, entityRoot, helpers, entities, sync, retry, tick, needsAnimation, bounds, dispose, entity: id => entities.get(id) || null, get source() {return source;}, get epoch() {return epoch;}};
}
