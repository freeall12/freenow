import {readSourceResource} from './source.mjs';
import {localAssetSource} from './asset-loader.mjs';
import {clone, requireDomain} from './invariants.mjs';
import {assertSpaceSource} from './space-actions.mjs';

function localSceneResource(metadata) {
  assertSpaceSource({kind: 'history-world', threedMeta: metadata}, 'workspaceSource');
  const direct = [[metadata.url, metadata.format], [metadata.sourceUrl, metadata.sourceFormat], [metadata.source_url, metadata.source_format]]
    .filter(([url]) => typeof url === 'string').map(([url, format]) => ({
      url, format: format ?? /\.(glb|spz)(?:[?#]|$)/i.exec(url)?.[1].toLowerCase()
    }));
  // The existing renderer consumes one bounded local SPZ. Official preview
  // level takes precedence; a remote entry never authorizes remote transport.
  const entries = Array.isArray(metadata.lod_assets) ? metadata.lod_assets : [];
  const lods = ['100k', 'full_res'].flatMap(level => entries.filter(item =>
    item?.format === 'spz' && item.level === level).map(item => ({format: 'spz', url: item.url})));
  let localFailure;
  for (const candidate of [...direct, ...lods]) {
    if (!['glb', 'spz'].includes(candidate.format)) continue;
    try {localAssetSource(candidate.url);} catch (failure) {localFailure ??= failure;continue;}
    return {...clone(metadata), format: candidate.format, url: candidate.url};
  }
  if (localFailure) throw localFailure;
  requireDomain(false, 'workspaceSource', 'scene requires a local GLB or SPZ resource', 'source-unavailable');
}

/** Source selection stays in the scene document; the original node binding is
 * retained as provenance. Provider addresses must be materialized first. */
export function workspaceSourceResource(app, nodeId, state) {
  const source = state?.scenePlay?.worldSpace?.source;
  if (!source || source.kind === 'world-asset') return readSourceResource(app, nodeId);
  if (source.kind === 'empty' || source.kind === 'mesh-preset') return null;
  requireDomain(source.kind === 'history-world', 'workspaceSource', 'unsupported scene source');
  const metadata = source.threedMeta;
  requireDomain(metadata && typeof metadata === 'object', 'workspaceSource', 'scene resource is missing');
  return localSceneResource(metadata);
}

/** Local scene results only. Mesh objects and ordinary images are not worlds. */
export function localWorkspaceScenes(app) {
  return (app.getState().nodes ?? []).flatMap(node => {
    const resource = node.worldResource;
    if (node.type !== 'world' || node.outputType !== 'world') return [];
    try {localSceneResource(resource);} catch {return [];}
    const timestamp = node.createdAt ?? node.generation?.completedAt;
    const date = timestamp === undefined ? null : new Date(timestamp);
    return [{id: node.id, label: node.title || resource.name || '3D 场景',
      thumbnailSrc: resource.thumbnail || node.image || null,
      createdAtLabel: date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '',
      threedMeta: clone(resource)}];
  });
}
