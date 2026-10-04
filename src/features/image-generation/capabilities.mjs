// Creative input limits from the official published image-model catalogue.
// Subscription/account restrictions are deliberately outside the replica scope.
const referenceLimits = {
  'nano-banana-flash-lite': 20,
  'doubao-seedream-5.0-lite': 14,
  'doubao-seedream-5.0-pro': 10,
  'doubao-seedream-4.0': 10,
  'doubao-seedream-4.5': 10,
  'gpt-image-2.5-flare': 16,
  'gpt-image-2.5-sunburst': 4,
  'gpt-image-2': 16,
  'nano-banana-flash': 20,
  'tamar-google-gemini-pro': 20,
  'nano-banana': 20,
  'midjourney-v7': 4,
  'midjourney-v8.2': 4,
  'midjourney-v8.1': 4,
  'midjourney-niji7': 4,
  'flux-kontext-max': 4,
  'flux-kontext-pro': 4,
  'fal-recraft-v4': 0,
  'fal-recraft-v4-vector': 0,
  'reve-2.1': 0,
};

export function inputCounts(value = 0) {
  const count = n => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
  return typeof value === 'number' ? { normal: count(value), style: 0, omni: 0 } : {
    normal: count(value.normal), style: count(value.style), omni: count(value.omni),
  };
}

export function inputCompatibility(model, references = 0) {
  const id = typeof model === 'string' ? model : model?.id;
  if (id === 'hunyuan-world-panorama') {
    const counts = inputCounts(references);
    const supported = counts.normal === 1 && counts.style === 0 && counts.omni === 0;
    return {supported, mode: supported ? 'image_to_image' : null, maxImages: 1,
      ...(supported ? {} : {error: 'panorama_source_required'}),
      reason: supported ? '' : '图生360全景需要且只支持一张普通参考图'};
  }
  const max = referenceLimits[id];
  // A custom provider model may define its own limits outside this catalogue.
  if (max === undefined) return { supported: true, mode: null, maxImages: null, reason: '' };
  const counts = inputCounts(references), midjourney = id.startsWith('midjourney-');
  const total = counts.normal + counts.style + counts.omni;
  if (!total) return { supported: true, mode: 'text_to_image', maxImages: max, reason: '' };
  if (!max) return { supported: false, mode: null, maxImages: 0, error: 'image_to_image_not_supported', reason: '不支持图生图' };
  const checks = midjourney ? [['normal', counts.normal, max], ['style', counts.style, 4], ['omni', counts.omni, 1]] : [['normal', total, max]];
  for (const [referenceType, actual, limit] of checks) {
    if (actual > limit) return { supported: false, mode: null, maxImages: limit, referenceType, error: 'max_images_exceeded', reason: `该模型最多支持${limit}张图片` };
  }
  return { supported: true, mode: 'image_to_image', maxImages: max, reason: '' };
}
