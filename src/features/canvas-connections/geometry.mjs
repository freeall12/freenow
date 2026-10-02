import {inputError as worldInputError} from '../world-node/model.mjs';
import {videoModels} from '../agent-generation/video-catalog.mjs';
import {isFinalNode, hasDraftResult} from '../video-generation/draft-final.mjs';

// React Flow getBezierPath geometry used by the official Qsa export.
export function bezier(source, target) {
  const dx = target.x - source.x;
  const control = dx >= 0 ? dx / 2 : 6.25 * Math.sqrt(-dx);
  return `M${source.x},${source.y} C${source.x + control},${source.y} ${target.x - control},${target.y} ${target.x},${target.y}`;
}

export const strokeWidth = zoom => zoom < .5 ? 2 : zoom < 1 ? 2.5 : 3;
export const direction = (origin, other, side) => side === 'left'
  ? {source: other, target: origin} : {source: origin, target: other};

export function menuPosition(anchor, size, viewport) {
  const gutter = 12, width = Math.min(size.width, Math.max(0, viewport.width - 24));
  const height = Math.min(size.height, Math.max(0, viewport.height - 24));
  const place = (p, length, limit) => Math.min(Math.max(gutter,
    p + length <= limit - gutter ? p : p - length >= gutter ? p - length : p), Math.max(gutter, limit - length - gutter));
  const left = place(anchor.x, width, viewport.width), top = place(anchor.y, height, viewport.height);
  return {left, top, maxHeight: Math.max(0, viewport.height - 24),
    transformOrigin: `${Math.max(0, Math.min(width, anchor.x - left))}px ${Math.max(0, Math.min(height, anchor.y - top))}px`};
}

// Official J7 admits incomplete inputs while linking; generation validates minimums.
export function supportsVideoInputs({image = 0, video = 0, audio = 0}) {
  return videoModels.some(model => model.variants.some(variant => supportsVideoVariant(variant, {image, video, audio})));
}

export function supportsVideoVariant(variant, {image = 0, video = 0, audio = 0}) {
    if (audio > (variant.referenceAudioRange?.max || 0)) return false;
    switch (variant.modelType) {
      case 'TEXT_TO_VIDEO': return image === 0 && video === 0;
      case 'IMAGE_TO_VIDEO': return image <= 1 && video === 0;
      case 'START_END_TO_VIDEO': return image <= 2 && video === 0;
      case 'REFERENCE_TO_VIDEO': return !!variant.referenceImageRange && image <= variant.referenceImageRange.max && video <= (variant.referenceVideoRange?.max || 0);
      case 'VIDEO_EDIT': case 'VIDEO_EXTEND': case 'REFERENCE_VIDEO_TO_VIDEO': return !!variant.referenceVideoRange && video <= variant.referenceVideoRange.max && (!variant.referenceImageRange || image <= variant.referenceImageRange.max);
      case 'DIGITAL_HUMAN': return !!variant.referenceImageRange && image <= variant.referenceImageRange.max && !!variant.referenceAudioRange && video === 0;
      default: return false;
    }
}

export function validateConnection(nodes, edges, source, target, audioSpecs = {}, textModels = []) {
  const a = nodes.find(n => n.id === source), b = nodes.find(n => n.id === target);
  if (!a || !b || source === target) return '连接节点无效';
  if (isFinalNode(b)) {
    if (!hasDraftResult(a)) return '正式片仅接受已生成且带文件身份的样片';
    return edges.some(edge => edge.target === target) ? '正式片只能连接一条样片引用' : null;
  }
  if (edges.some(e => e.source === source && e.target === target && (!e.data?.purpose || e.data.purpose === 'generation-input'))) return '这两个节点已经连接';
  if (['studio', 'pile', 'playlist', 'world'].includes(a.type) || ['studio', 'pile', 'playlist', 'group'].includes(b.type)) return '这些节点不支持此类连接';
  if (b.type === 'text' && (b.textMode === 'pure' || !b.textMode && !b.generation)) return '纯文本节点不接受输入连接';
  if (a.type === 'text') return null;
  const incoming = edges.filter(edge => edge.target === target);
  // Drag-to-connect validates on each preview frame. Resolve multiple incoming
  // references in one node pass instead of scanning all nodes for every edge.
  let inputs;
  if (incoming.length < 2) inputs = incoming.map(edge => nodes.find(node => node.id === edge.source)).filter(Boolean);
  else {
    const wanted = new Set(incoming.map(edge => edge.source)), byId = new Map();
    for (const node of nodes) {
      const id = node.id;
      if (wanted.has(id) && !byId.has(id)) {
        byId.set(id, node);
        if (byId.size === wanted.size) break;
      }
    }
    // Edge order and repeated references remain unchanged, including the first
    // matching node when malformed/imported graphs contain duplicate node IDs.
    // Map matches NaN using SameValueZero; the original strict-equality find did not.
    inputs = incoming.map(edge => Number.isNaN(edge.source) ? undefined : byId.get(edge.source)).filter(Boolean);
  }
  if (b.type === 'world') {
    if (!['image', 'video'].includes(a.type)) return '3D 节点仅接受文本、图片或视频参考';
    const all = [...inputs, a];
    return worldInputError({image: all.filter(n => n.type === 'image').length, video: all.filter(n => n.type === 'video').length});
  }
  if (a.type === 'group') return b.type === 'text' ? '分组不能连接到文本节点' : null;
  if (b.type === 'video' && ['image', 'video', 'audio'].includes(a.type)) {
    const counts = {image: 0, video: 0, audio: 0};
    for (const node of [...inputs, a]) if (node.type in counts) counts[node.type]++;
    return supportsVideoInputs(counts) ? null : '参考素材数量超过视频模型支持范围';
  }
  if (b.type === 'audio') {
    const spec = audioSpecs[b.audioConfig?.model] || {};
    const count = type => inputs.filter(n => n.type === type).length;
    const max = a.type === 'image' ? spec.images || 0 : a.type === 'audio' ? spec.audios || 0 : a.type === 'video' && spec.video ? 1 : 0;
    if (count(a.type) >= max) return '当前音频模型不支持该参考素材，或已达到数量上限';
    if (spec.mixed === false && (a.type === 'image' && count('audio') || a.type === 'audio' && count('image'))) return '参考图片和参考音频不能混用';
    return null;
  }
  if (a.type === 'image' && ['image', 'text', 'video'].includes(b.type)) {
    if (b.tool === 'image-editor' && inputs.some(n => n.type === 'image')) return '图片编辑器仅接受一张输入图片';
    if (b.type === 'image' && inputs.filter(n => n.type === 'image').length >= 20) return '参考图片数量超过支持范围';
    return null;
  }
  if (a.type === 'video' && b.type === 'text' && textModels.find(m => m.id === b.generation?.model)?.video === false) return '当前文本模型不支持参考视频';
  if (a.type === 'video' && ['video', 'text'].includes(b.type) || a.type === 'audio' && b.type === 'video') return null;
  return '这些节点类型不能互相连接';
}
