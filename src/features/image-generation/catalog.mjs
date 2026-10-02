import { modelAssets } from './assets.mjs';
import { inputCompatibility } from './capabilities.mjs';
import {imageResultCounts,normalizeResultMode} from '../generation-results/counts.mjs';
export { inputCompatibility } from './capabilities.mjs';

const standard = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const seed = [...standard, '3:2', '2:3'];
const nano = ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'];
const mj = ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2', '7:4', '4:7'];
const gpt = ['auto', '1:1', '2:1', '4:3', '3:4', '5:4', '4:5', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21'];
const definitions = {
  'nano-banana-flash-lite': { ratios: nano, sizes: ['1K'], thinking: true, ratio: 'Auto', size: '1K' },
  'doubao-seedream-5.0-lite': { ratios: [...seed, '21:9'], sizes: ['2K', '3K'], ratio: '1:1', size: '2K' },
  'doubao-seedream-5.0-pro': { ratios: [...seed, '21:9'], sizes: ['1K', '2K'], ratio: '1:1', size: '2K' },
  'doubao-seedream-4.0': { ratios: ['Auto(4K)', ...seed, '21:9'], ratio: 'Auto(4K)' },
  'doubao-seedream-4.5': { ratios: seed, sizes: ['2K', '4K'], ratio: '16:9', size: '2K' },
  'gpt-image-2.5-flare': { ratios: gpt, sizes: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high', 'xhigh', 'max'], transparent: true, ratio: '1:1', size: '1K' },
  'gpt-image-2.5-sunburst': { ratios: gpt, sizes: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high', 'xhigh', 'max'], transparent: true, ratio: '1:1', size: '1K' },
  'gpt-image-2': { ratios: gpt, sizes: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], ratio: '1:1', size: '1K' },
  'nano-banana-flash': { ratios: nano, sizes: ['512P', '1K', '2K', '4K'], thinking: true, webSearch: true, imageSearch: true, ratio: 'Auto', size: '1K' },
  'tamar-google-gemini-pro': { ratios: nano, sizes: ['1K', '2K', '4K'], webSearch: true, ratio: 'Auto', size: '2K' },
  'nano-banana': { ratios: nano, ratio: 'Auto' },
  'midjourney-v7': { ratios: mj, ratio: '16:9', midjourney: true },
  'midjourney-v8.2': { ratios: mj, ratio: '16:9', midjourney: true },
  'midjourney-v8.1': { ratios: mj, ratio: '16:9', midjourney: true },
  'midjourney-niji7': { ratios: mj, ratio: '16:9', midjourney: true },
  'flux-kontext-max': { ratios: standard, ratio: '16:9' },
  'flux-kontext-pro': { ratios: standard, ratio: '16:9' },
  'fal-recraft-v4': { ratios: standard, modes: ['std', 'pro'], ratio: '1:1' },
  'fal-recraft-v4-vector': { ratios: standard, modes: ['std', 'pro'], ratio: '1:1' },
  'reve-2.1': { ratios: ['Auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '17:9', '2:1', '1:2', '3:1', '1:3', '4:1', '1:4'], ratio: 'Auto' },
};

export const models = modelAssets.map(asset => ({ sizes: [], qualities: [], modes: [], ...asset, ...definitions[asset.id] }));
export function modelFor(value) {
  const alias = value === 'nano-banana-2' ? 'tamar-google-gemini-pro' : value;
  return models.find(model => model.id === alias || model.name === alias);
}
export function sizesFor(model, ratio) {
  return model.id.startsWith('gpt-image-') && ratio === 'auto' ? [] : model.sizes;
}
export function countsFor(model,resultMode='variants') { return imageResultCounts({mode:resultMode,isMidjourney:!!model?.midjourney}).options.reverse(); }
export function ratioLabel(value) { return value.replace(/^auto/i, '自适应'); }
export function gridColumns(length) {
  if (length <= 6) return 0;
  const rest = length - 1;
  for (let cols = 5; cols >= 2; cols--) if (rest % cols === 0 && rest / cols <= 4) return cols;
  let cols = 5, remainder = 0;
  for (let c = 5; c >= 2; c--) if (rest % c > remainder) { remainder = rest % c; cols = c; }
  return cols;
}

const parameterKeys = ['ratio', 'quality', 'imageSize', 'outputQuality', 'thinking', 'webSearch', 'imageSearch', 'background', 'generateMode'];
function snapshot(config) { return Object.fromEntries(parameterKeys.filter(key => config[key] !== undefined).map(key => [key, config[key]])); }

export function normalize(config, model = modelFor(config.model)) {
  if (!model) return { ...config };
  const next = { ...config, modelId: model.id };
  if (next.ratio === '自适应') next.ratio = model.ratios.find(ratio => /^auto$/i.test(ratio)) || model.ratio;
  if (!model.ratios.includes(next.ratio)) next.ratio = model.ratio;
  next.isPanoramaPrompt = next.isPanoramaPrompt === true && model.ratios.includes('2:1') && next.ratio === '2:1';
  const sizes = sizesFor(model, next.ratio);
  const size = next.imageSize || next.quality;
  // `quality` historically stores resolution in this app. Keep that compatibility
  // at the editor boundary; providerParameters uses the provider's actual fields.
  next.imageSize = sizes.includes(size) ? size : sizes.includes(model.size) ? model.size : sizes[0];
  next.quality = next.imageSize || '';
  next.outputQuality = model.qualities.includes(next.outputQuality) ? next.outputQuality : model.qualities[0];
  next.generateMode = model.modes.includes(next.generateMode) ? next.generateMode : model.modes[0];
  next.thinking = /minimal/i.test(next.thinking || '') ? 'Minimal' : 'high';
  next.webSearch = model.webSearch && !!next.webSearch;
  next.imageSearch = model.imageSearch && !!next.imageSearch;
  next.background = model.transparent && next.background === 'transparent' ? 'transparent' : 'opaque';
  next.resultMode=normalizeResultMode(next.resultMode);
  next.count=imageResultCounts({mode:next.resultMode,isMidjourney:!!model.midjourney,currentTimes:next.count??next.times}).times;
  if(next.times!==undefined)next.times=next.count;
  return next;
}

export function selectModel(config, id) {
  const model = modelFor(id);
  if (!model) throw new Error('未知图片模型');
  const current = modelFor(config.model);
  const modelSettings = { ...config.modelSettings, ...(current ? { [current.id]: snapshot(normalize(config, current)) } : {}) };
  const next = { ...config, isPanoramaPrompt: false };
  for (const key of parameterKeys) delete next[key];
  Object.assign(next, { model: model.name, modelId: model.id, ratio: model.ratio, modelSettings }, modelSettings[model.id] || { imageSize: model.size });
  return normalize(next, model);
}

export function providerParameters(config) {
  const model = modelFor(config.model);
  if (!model) throw new Error('请选择支持的图片模型');
  const next = normalize(config, model);
  const compatibility = inputCompatibility(model, config.inputCounts ?? config.refs?.length ?? 0);
  if (!compatibility.supported) throw new Error(compatibility.reason);
  const params = { model: model.id, mode: compatibility.mode, aspectRatio: next.ratio, times: next.count };
  if (next.isPanoramaPrompt) params.isPanoramaPrompt = true;
  if (next.imageSize) params.imageSize = next.imageSize;
  if (model.qualities.length) params.quality = next.outputQuality;
  if (model.thinking) params.thinking_level = next.thinking === 'Minimal' ? 'MINIMAL' : 'HIGH';
  if (model.webSearch) params.enableGoogleSearch = next.webSearch;
  if (model.imageSearch) params.enable_image_search = next.imageSearch;
  if (model.modes.length) params.generateMode = next.generateMode;
  if (model.transparent) params.background = next.background;
  if (model.id === 'doubao-seedream-4.0' || model.id === 'doubao-seedream-4.5') params.sequential_image_generation = 'auto';
  if (model.id === 'reve-2.1') params.outputFormat = 'png';
  return params;
}

export function emptyNodeGeometry(node, ratio) {
  if (node.image || !/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio)) return null;
  const [w, h] = ratio.split(':').map(Number);
  if (!(w > 0 && h > 0)) return null;
  const width = w >= h ? 250 * w / h : 250;
  const height = h >= w ? 250 * h / w : 250;
  return { x: node.x + (node.width - width) / 2, y: node.y + node.height - height, width, height };
}
