import {inputError as worldInputError} from '../world-node/model.mjs';
import {videoModels} from '../agent-generation/video-catalog.mjs';
import {supportsVideoInputs, supportsVideoVariant} from './geometry.mjs';

export function selectionSources(nodes, selected) {
  if (selected.length < 2) return selected.map(id => nodes.find(node => node.id === id)).filter(node => node && node.type !== 'pile');
  const wanted = new Set(selected), byId = new Map();
  // Resolve fresh objects when the menu is submitted, retaining selection order
  // and the first strict-equality match from the former per-ID find calls.
  for (const node of nodes) {
    const id = node.id;
    if (wanted.has(id) && !Number.isNaN(id) && !byId.has(id)) {
      byId.set(id, node);
      if (byId.size === wanted.size) break;
    }
  }
  return selected.map(id => byId.get(id)).filter(node => node && node.type !== 'pile');
}

export function classify(nodes) {
  const result = {text: [], image: [], video: [], audio: [], unsupported: false};
  for (const node of nodes) {
    if (Array.isArray(result[node.type])) result[node.type].push(node);
    else result.unsupported = true;
  }
  result.kind = nodes.length && result.text.length === nodes.length ? 'text'
    : nodes.length && result.image.length === nodes.length ? 'image' : 'mixed';
  result.counts = Object.fromEntries(['image', 'video', 'audio'].map(type => [type, result[type].length]));
  return result;
}

export function selectionInputs(type, nodes) {
  const summary = classify(nodes), {image, video, audio} = summary.counts;
  if (!nodes.length || summary.unsupported) throw Error('当前所选节点不支持此操作');
  const compatible = type === 'text' ? !audio : type === 'image' ? !video && !audio
    : type === 'video' ? supportsVideoInputs(summary.counts)
      : type === 'imageEditor' ? summary.kind === 'image' : type === 'world' ? !worldInputError(summary.counts) : false;
  if (!compatible) throw Error('当前所选节点不支持此操作');
  const order = type === 'imageEditor' ? ['image'] : type === 'image' ? ['text', 'image']
    : type === 'video' ? ['text', 'image', 'video', 'audio'] : ['text', 'image', 'video'];
  return order.flatMap(key => summary[key].map(node => node.id));
}

// Official Ept uses partial matching in the current model (uZ/J7), then full
// matching only when falling back to another model (Hde/$7/e9).
function completeVideoInputs(variant, counts) {
  const {image, video, audio} = counts;
  const fits = (count, range) => range ? count >= range.min && count <= range.max : count === 0;
  if (!fits(audio, variant.referenceAudioRange)) return false;
  if (variant.referenceAudioRequiresCompanion && audio && !image && !video) return false;
  switch (variant.modelType) {
    case 'TEXT_TO_VIDEO': return !image && !video;
    case 'IMAGE_TO_VIDEO': return image === 1 && !video;
    case 'START_END_TO_VIDEO': return image === 2 && !video;
    case 'REFERENCE_TO_VIDEO': return !!variant.referenceImageRange && fits(image, variant.referenceImageRange) && fits(video, variant.referenceVideoRange);
    case 'VIDEO_EDIT': case 'VIDEO_EXTEND': case 'REFERENCE_VIDEO_TO_VIDEO':
      return !!variant.referenceVideoRange && fits(video, variant.referenceVideoRange) && (!variant.referenceImageRange || fits(image, variant.referenceImageRange));
    case 'DIGITAL_HUMAN': return !!variant.referenceImageRange && fits(image, variant.referenceImageRange) && !video;
    default: return false;
  }
}

export function videoSelectionConfig(config, nodes) {
  const {counts} = classify(nodes);
  const current = videoModels.find(model => model.id === config.model || model.name === config.model || model.aliases?.includes(config.model));
  let model = current, variant = current?.variants.find(candidate => supportsVideoVariant(candidate, counts));
  if (!variant) {
    for (const candidate of videoModels) {
      variant = candidate.variants.find(item => completeVideoInputs(item, counts));
      if (variant) {model = candidate; break;}
    }
  }
  if (!variant) return config;
  const defaults = variant.defaults || {};
  return {...config, model: current === model ? config.model : model.name, variant: variant.key,
    modelType: variant.modelType, ...defaults,
    mode: ['REFERENCE_TO_VIDEO', 'REFERENCE_VIDEO_TO_VIDEO', 'VIDEO_EDIT', 'VIDEO_EXTEND', 'DIGITAL_HUMAN'].includes(variant.modelType) ? '全能参考' : '首尾帧',
    ...(defaults.aspectRatio ? {ratio: defaults.aspectRatio} : {}),
    ...(defaults.resolution ? {quality: defaults.resolution} : {}),
    ...(defaults.generateAudio !== undefined ? {audio: defaults.generateAudio, audioLabel: defaults.generateAudio ? '开启' : '关闭'} : {})};
}

// Local nodes already store absolute coordinates, including group members.
export function selectionBounds(nodes) {
  if (!nodes.length) return null;
  const minY = Math.min(...nodes.map(node => node.y));
  const maxY = Math.max(...nodes.map(node => node.y + node.height));
  return {right: Math.max(...nodes.map(node => node.x + node.width)), centerY: (minY + maxY) / 2};
}

// Official sle (imported as dfe) uses a 258x297 placement estimate for this menu.
export function selectionMenuAnchor(point, container) {
  const width = Math.max(0, container.width), height = Math.max(0, container.height);
  const x = 258 >= width - 24 ? width / 2 : Math.max(141, Math.min(width - 141, point.x));
  const y = 297 >= height - 24 ? 12 : Math.max(12, Math.min(height - 325, point.y));
  return {x, y};
}
