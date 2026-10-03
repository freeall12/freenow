import {hashSource as defaultHash, validateResourceIndex, isStaticAssetRef} from './index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {isOriginalMediaRef} from './display-media.mjs';

const mediaFields = ['image', 'fullImage', 'video', 'audio', 'poster', 'thumbnail'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const durable = value => isStaticAssetRef(value) || isGenerationMediaRef(value) ||
  /^asset:[^\s]+$/.test(value) || /^data:(?:image\/|video\/|audio\/|model\/|application\/octet-stream;)/.test(value);

// Only resource positions are visited. Prompts, IDs, task bindings and provenance stay intact.
function resourceSlots(snapshot, kind = 'canvas') {
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
    fields(value.assets.mesh, ['colliderMeshUrl', 'fullResMeshUrl', 'hqMeshUrl'], path + '.assets.mesh');
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
  if (kind === 'canvas') {
    graph(snapshot, '$');
    list(snapshot.history, '$.history', graph); list(snapshot.future, '$.future', graph);
  } else if (kind === 'library') {
    list(Array.isArray(snapshot) ? snapshot : snapshot.items, Array.isArray(snapshot) ? '$' : '$.items', (item, path) => fields(item, mediaFields, path));
  } else if (kind === 'subject') {
    list(snapshot.subjects, '$.subjects', (subject, path) => list(subject.assets, path + '.assets', (asset, at) => {
      if (['image', 'video', 'audio'].includes(asset.type)) resource(asset, at);
    }));
  } else if (kind === 'template') {
    const template = (item, path) => {fields(item, ['image', 'video'], path); graph(item.graph, path + '.graph');};
    if (Array.isArray(snapshot)) list(snapshot, '$', template); else template(snapshot, '$');
  } else if (kind === 'generation-history') {
    list(snapshot.receipts, '$.receipts', (receipt, path) => list(receipt.outputs, path + '.outputs', (output, at) => {
      if (!['image', 'video', 'audio', 'model'].includes(output?.type)) return;
      // output.sourceUrl is a readable media descriptor, unlike provenance.sourceUrl.
      fields(output, ['url', 'sourceUrl', ...mediaFields], at); world(output.world, at + '.world');
    }));
    list(snapshot.rows, '$.rows', (row, path) => {
      if (!['image', 'video', 'audio', 'model'].includes(row.type)) return;
      fields(row, ['source', 'mediaRef', 'thumbnailRef'], path);
      if (row.type === 'model') node(row.worldPatch, path + '.worldPatch');
    });
  }
  return slots;
}

async function migrateSnapshot(value, {index, hashSource = defaultHash} = {}, kind) {
  if (typeof hashSource !== 'function') throw Error('资源哈希适配器无效');
  const validated = validateResourceIndex(index), snapshot = structuredClone(value);
  const changes = [], unresolved = [], cache = new Map();
  const slots = resourceSlots(snapshot, kind);
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

export function originalCanvasResourceDiagnostics(value){return resourceSlots(value).filter(slot=>isOriginalMediaRef(slot.target[slot.key])).map(({path})=>({path,code:'original_service_import_required'}));}

export async function migrateCanvasSnapshot(value, options) {
  if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw Error('画布迁移需要完整快照');
  return migrateSnapshot(value, options, 'canvas');
}

export async function migrateLibrarySnapshot(value, options) {
  const items = Array.isArray(value) ? value : object(value) ? value.items : null;
  if (!Array.isArray(items) || items.some(item => !object(item))) throw Error('素材库迁移需要完整素材数组');
  return migrateSnapshot(value, options, 'library');
}

export async function migrateSubjectSnapshot(value, options) {
  if (!object(value) || value.version !== 1 || typeof value.libraryKey !== 'string' || !Array.isArray(value.subjects) ||
      value.subjects.some(subject => !object(subject) || !Array.isArray(subject.assets) || subject.assets.some(asset => !object(asset)))) throw Error('主体库迁移需要完整权威记录');
  return migrateSnapshot(value, options, 'subject');
}

export async function migrateTemplateSnapshot(value, options) {
  const rows = Array.isArray(value) ? value : [value];
  if (rows.some(row => !object(row) || !object(row.graph) || row.graph.version !== 1 || !Array.isArray(row.graph.nodes) ||
      !Array.isArray(row.graph.edges))) throw Error('模板迁移需要完整模板记录');
  return migrateSnapshot(value, options, 'template');
}

export async function migrateGenerationHistorySnapshot(value, options) {
  if (!object(value) || value.version !== 1 || typeof value.projectId !== 'string' || !Array.isArray(value.rows) ||
      !Array.isArray(value.receipts) || value.rows.some(row => !object(row)) || value.receipts.some(row => !object(row) ||
        row.outputs !== undefined && !Array.isArray(row.outputs))) throw Error('生成历史迁移需要完整权威记录');
  return migrateSnapshot(value, options, 'generation-history');
}
