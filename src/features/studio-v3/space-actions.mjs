import {assertJson, clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertState} from './schema.mjs';
import {setupLane} from './history.mjs';

const roomFields = ['width', 'depth', 'height', 'trackingGuides'];
const guideFields = ['enabled', 'lineMarkers', 'mode', 'spacingMeters'];
const fields = (value, allowed, path) => {
  requireDomain(isRecord(value), path, 'must be a plain object');
  for (const key of Object.keys(value)) requireDomain(allowed.includes(key), `${path}.${key}`, 'unsupported field');
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const formats = ['glb', 'spz'];
function resourceFormat(url, format) {
  if (format !== undefined) return formats.includes(format);
  return typeof url === 'string' && /\.(glb|spz)(?:[?#]|$)/i.test(url);
}

/** Validate the complete bounded room contract, shared by rendering and actions. */
export function assertRoomConfig(config, path = 'roomConfig') {
  assertJson(config, path);fields(config, roomFields, path);
  for (const [field, min, max] of [['width', 1, 100], ['depth', 1, 100], ['height', 2, 20]]) {
    requireDomain(Number.isFinite(config[field]) && config[field] >= min && config[field] <= max,
      `${path}.${field}`, `must be within ${min}..${max} meters`);
  }
  const guides = config.trackingGuides;fields(guides, guideFields, `${path}.trackingGuides`);
  for (const key of ['enabled', 'lineMarkers']) requireDomain(typeof guides[key] === 'boolean', `${path}.trackingGuides.${key}`, 'must be boolean');
  requireDomain(['white', 'standard', 'calibration'].includes(guides.mode), `${path}.trackingGuides.mode`, 'unknown tracking guide mode');
  requireDomain([0.25, 0.5, 1, 2].includes(guides.spacingMeters), `${path}.trackingGuides.spacingMeters`, 'unsupported spacing');
  return config;
}

/** A history source must contain usable resource fields, not a provider job or image. */
export function assertSpaceSource(source, path = 'spaceSource') {
  assertJson(source, path);requireDomain(isRecord(source), path, 'must be a plain object');
  requireDomain(['empty', 'world-asset', 'mesh-preset', 'history-world'].includes(source.kind), `${path}.kind`, 'unknown space source');
  fields(source, source.kind === 'mesh-preset' ? ['kind', 'preset'] : source.kind === 'history-world' ?
    ['kind', 'historyAssetId', 'label', 'thumbnailSrc', 'threedMeta'] : ['kind'], path);
  if (source.kind === 'mesh-preset') requireDomain(source.preset === 'room', `${path}.preset`, 'unknown mesh preset');
  if (source.kind === 'history-world') {
    const meta = source.threedMeta;requireDomain(isRecord(meta), `${path}.threedMeta`, 'scene metadata required');
    if (Object.hasOwn(source, 'historyAssetId')) requireDomain(nonempty(source.historyAssetId), `${path}.historyAssetId`, 'must be nonempty text');
    if (Object.hasOwn(source, 'label')) requireDomain(typeof source.label === 'string', `${path}.label`, 'must be text');
    if (Object.hasOwn(source, 'thumbnailSrc')) requireDomain(source.thumbnailSrc === null || nonempty(source.thumbnailSrc), `${path}.thumbnailSrc`, 'must be text or null');
    requireDomain(meta.imported_asset_kind !== 'object' && !['object', 'world-object'].includes(meta.kind) && meta.outputType !== 'asset', `${path}.threedMeta`, 'object metadata cannot be a scene');
    const direct = [[meta.source_url, meta.source_format], [meta.sourceUrl, meta.sourceFormat], [meta.url, meta.format]];
    const available = direct.some(([url, format]) => nonempty(url) && resourceFormat(url, format)) ||
      Array.isArray(meta.lod_assets) && meta.lod_assets.some(item => item?.format === 'spz' && ['100k', 'full_res'].includes(item.level) && nonempty(item.url));
    requireDomain(available, `${path}.threedMeta`, 'usable GLB or SPZ scene resource required', 'source-unavailable');
  }
  return source;
}

/** Pure world-space edit. The host owns identity fences, history sessions and saving. */
export function reduceSpaceAction(state, action, {now = Date.now(), readonly = false, busy = false} = {}) {
  assertState(state);
  const space = state.scenePlay.worldSpace, lane = setupLane(space.activeSetupId), scope = {kind: 'world-space'};
  const deny = (reason, message) => ({ok: false, changed: false, state, lane, scope, reason, message});
  if (readonly) return deny('readonly', '当前场地为只读。');
  if (busy) return deny('busy', '请先完成当前操作，再修改场地。');
  assertJson(action, 'spaceAction');requireDomain(isRecord(action), 'spaceAction', 'must be a plain object');
  requireDomain(Number.isFinite(now) && now >= 0, 'spaceAction.now', 'must be a nonnegative timestamp');
  requireDomain(['set-space-source', 'update-room'].includes(action.type), 'spaceAction.type', 'unknown space action');
  fields(action, action.type === 'set-space-source' ? ['type', 'source'] : ['type', 'patch'], 'spaceAction');
  let nextSpace, historyLabel;
  if (action.type === 'set-space-source') {
    assertSpaceSource(action.source);historyLabel = '切换场地';
    nextSpace = {...space, source: clone(action.source)};
  } else {
    assertJson(action.patch, 'spaceAction.patch');fields(action.patch, roomFields, 'spaceAction.patch');
    const patch = action.patch;
    if (Object.hasOwn(patch, 'trackingGuides')) fields(patch.trackingGuides, guideFields, 'spaceAction.patch.trackingGuides');
    const roomConfig = {...space.roomConfig, ...clone(patch), trackingGuides: {...space.roomConfig.trackingGuides, ...clone(patch.trackingGuides || {})}};
    assertRoomConfig(roomConfig);historyLabel = '修改房间';nextSpace = {...space, roomConfig};
  }
  if (same(space, nextSpace)) return {ok: true, changed: false, state, lane, scope, historyLabel};
  // Space is shared across setups; placing its history on the current setup
  // lane must never rewrite that setup's content or the original source binding.
  const next = {...state, scenePlay: {...state.scenePlay, worldSpace: nextSpace}};
  assertState(next);return {ok: true, changed: true, state: next, lane, scope, historyLabel};
}
