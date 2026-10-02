import {hashSource as defaultHash, validateResourceIndex, isStaticAssetRef} from './index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';

const mediaFields = ['image', 'fullImage', 'video', 'audio', 'poster', 'thumbnail'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const durable = value => isStaticAssetRef(value) || isGenerationMediaRef(value) ||
  /^asset:[^\s]+$/.test(value) || /^data:(?:image\/|video\/|audio\/|model\/|application\/octet-stream;)/.test(value);

// Only resource positions are visited. Prompts, IDs, task bindings and provenance stay intact.
function resourceSlots(snapshot) {
  const slots = [];
  const field = (target, key, path) => {if (object(target) && typeof target[key] === 'string' && target[key]) slots.push({target, key, path: path + '.' + key});};
  const fields = (target, keys, path) => keys.forEach(key => field(target, key, path));
  const list = (items, path, visitor) => {if (Array.isArray(items)) items.forEach((item, index) => visitor(item, path + '[' + index + ']'));};
  const resource = (value, path) => fields(value, ['url', ...mediaFields], path);
  function options(items, path) {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      if (typeof item === 'string' && item) slots.push({target: items, key: index, path: path + '[' + index + ']'});
      else resource(item, path + '[' + index + ']');
    });
  }
  function fabric(value, path) {
    if (!object(value)) return;
    if (['image', 'Image'].includes(value.type)) field(value, 'src', path);
    list(value.objects, path + '.objects', fabric);
    for (const key of ['backgroundImage', 'overlayImage', 'clipPath']) fabric(value[key], path + '.' + key);
  }
  function world(value, path) {
    if (!object(value?.assets)) return;
    const urls = value.assets.splats?.spzUrls;
    // Dynamic provider resolution names never become diagnostic path text.
    if (object(urls)) Object.keys(urls).forEach((key, index) => {
      if (typeof urls[key] === 'string' && urls[key]) slots.push({target: urls, key, path: path + '.assets.splats.spzUrls[' + index + ']'});
    });
    fields(value.assets.mesh, ['colliderMeshUrl', 'fullResMeshUrl'], path + '.assets.mesh');
    field(value.assets.imagery, 'panoUrl', path + '.assets.imagery');
  }
  function studio(value, path) {
    if (!object(value)) return;
    const models = (items, at) => list(items, at, (item, p) => {if (item?.kind === 'model') field(item, 'sourceUrl', p);});
    const setup = (item, at) => {models(item?.objects, at + '.objects'); list(item?.keyframes, at + '.keyframes', (frame, p) => field(frame?.state, 'sourceUrl', p + '.state'));};
    setup(value, path); setup(value.baseline, path + '.baseline'); list(value.setups, path + '.setups', setup);
    resource(value.ground?.sceneAsset, path + '.ground.sceneAsset');
    const env = value.environment;
    if (object(env)) {
      resource(env.hdri, path + '.environment.hdri'); resource(env.panorama, path + '.environment.panorama');
      list(env.hdriResources, path + '.environment.hdriResources', resource);
      list(env.panoramaResources, path + '.environment.panoramaResources', resource);
    }
    list(value.panoramaSessions, path + '.panoramaSessions', (anchor, p) => {
      fields(anchor, ['base', 'thumbnail'], p);
      list(anchor?.patches, p + '.patches', (patch, at) => fields(patch, ['image', 'thumbnail'], at));
    });
    list(value.panoramaEdits, path + '.panoramaEdits', (edit, p) => field(edit, 'image', p));
  }
  function node(value, path) {
    if (!object(value)) return;
    fields(value, mediaFields, path); options(value.versions, path + '.versions'); options(value.options, path + '.options');
    for (const key of ['imageHistory', 'videoHistory']) list(value[key], path + '.' + key, (batch, p) => options(batch?.options, p + '.options'));
    list(value.clips, path + '.clips', (clip, p) => fields(clip, ['url', 'poster'], p));
    fabric(value.editorDoc?.canvas, path + '.editorDoc.canvas');
    studio(value.studio, path + '.studio'); field(value.studioV2, 'asset', path + '.studioV2');
    resource(value.worldResource, path + '.worldResource'); world(value.worldResource?.world, path + '.worldResource.world');
    options(value.generation?.refs, path + '.generation.refs');
    list(value.generation?.inputs, path + '.generation.inputs', resource);
    list(value.generation?.references, path + '.generation.references', resource);
  }
  function graph(value, path) {list(value?.nodes, path + '.nodes', node);}
  graph(snapshot, '$');
  list(snapshot.history, '$.history', graph); list(snapshot.future, '$.future', graph);
  return slots;
}

export async function migrateCanvasSnapshot(value, {index, hashSource = defaultHash} = {}) {
  if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw Error('画布迁移需要完整快照');
  if (typeof hashSource !== 'function') throw Error('资源哈希适配器无效');
  const validated = validateResourceIndex(index), snapshot = structuredClone(value);
  const changes = [], unresolved = [], cache = new Map();
  const slots = resourceSlots(snapshot);
  for (const slot of slots) {
    const source = slot.target[slot.key];
    if (durable(source)) continue;
    if (!cache.has(source)) cache.set(source, Promise.resolve().then(() => hashSource(source)));
    const sourceHash = await cache.get(source);
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw Error('资源来源哈希无效');
    const row = validated.entries[sourceHash];
    if (row && /^https?:\/\//i.test(source)) {
      slot.target[slot.key] = row.ref;
      changes.push({path: slot.path, sourceHash, ref: row.ref});
    } else unresolved.push({path: slot.path, sourceHash, code: source.startsWith('blob:') ? 'transient_blob' : 'local_import_required'});
  }
  return {snapshot, changes, unresolved, summary: {references: slots.length, changed: changes.length, unresolved: unresolved.length, alreadyLocal: slots.length - changes.length - unresolved.length}};
}
