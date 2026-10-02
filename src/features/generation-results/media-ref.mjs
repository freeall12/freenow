// Only the immutable resource route is trusted as a relative generated source.
export const isGenerationMediaRef = value => typeof value === 'string' && /^\/api\/generation\/media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isLocalMediaSource = value => isGenerationMediaRef(value) || typeof value === 'string' && /^(?:asset:[^\s]+$|data:(?:image|video|audio)\/|data:(?:model\/gltf-binary|application\/octet-stream);base64,)/.test(value);
export function assertLocalMediaSource(value) {
  if (!isLocalMediaSource(value)) throw Object.assign(Error('此媒体尚未保存到本机，请从原任务取回或迁移旧素材后重试'), {code: 'media_localization_required'});
  return value;
}
const blockedDomains = ['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
export function assertReadableMediaSource(value) {
  if (isLocalMediaSource(value)) return value;
  let url;try {url = new URL(value);} catch {return assertLocalMediaSource(value);}
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (blockedDomains.some(domain => host === domain || host.endsWith('.' + domain))) throw Object.assign(Error('此旧媒体来自 TapNow，需迁移到本机后读取；原记录已保留'), {code:'media_localization_required'});
  if (!['http:','https:','blob:'].includes(url.protocol) || url.username || url.password) return assertLocalMediaSource(value);
  return value;
}
export function assertReadableResultMedia(output) {
  if (output?.type === 'text') return;
  assertReadableMediaSource(output?.url || output?.[output?.type] || (output?.type === 'image' ? output?.fullImage : null));
  for (const key of ['url','image','fullImage','video','audio','poster','sourceUrl']) if (output[key] != null) assertReadableMediaSource(output[key]);
  const assets = output.world?.assets;
  if (assets) {
    for (const value of Object.values(assets.splats?.spzUrls || {})) assertReadableMediaSource(value);
    for (const value of Object.values(assets.mesh || {})) assertReadableMediaSource(value);
    if (assets.imagery?.panoUrl != null) assertReadableMediaSource(assets.imagery.panoUrl);
  }
}
