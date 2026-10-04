// Browser facade for the UI modules that run inside the existing canvas host.
const imageTools = Object.freeze({
  crop: '../image-crop-ui.mjs',
  resize: '../image-resize-ui.mjs',
  angle: '../image-angle-ui.mjs',
  relight: '../image-relight-ui.mjs',
  enhance: '../image-enhance-ui.mjs',
  outpaint: '../image-outpaint-ui.mjs',
  erase: '../image-erase-ui.mjs',
  redraw: '../image-redraw-ui.mjs',
  annotate: '../image-annotation-ui.mjs'
});
const videoTools = Object.freeze({
  trim: ['../src/features/video-trim/ui.mjs', 'open'],
  extend: ['../src/features/video-creation/ui.mjs', 'openExtend'],
  reshoot: ['../src/features/video-reshoot/ui.mjs', 'open'],
  mask: ['../src/features/video-mask/ui.mjs', 'open']
});

function canvasHost() {
  if (typeof window === 'undefined' || !window.CanvasApp?.getState) {
    throw new Error('此组件需要先挂载 CanvasApp 画布宿主');
  }
  return window.CanvasApp;
}

function nodeInCanvas(value, type) {
  const node = canvasHost().getState().nodes.find(item => item.id === (typeof value === 'string' ? value : value?.id));
  if (!node || (type && node.type !== type)) throw new Error(`请选择画布中的${type === 'image' ? '图片' : type === 'video' ? '视频' : ''}节点`);
  return node;
}

export async function openImageTool(tool, value) {
  const modulePath = imageTools[tool];
  if (!modulePath) throw new RangeError(`未知图片工具：${tool}`);
  const node = nodeInCanvas(value, 'image');
  return (await import(modulePath)).open(node);
}

export async function openVideoTool(tool, value, options = {}) {
  const target = videoTools[tool];
  if (!target) throw new RangeError(`未知视频工具：${tool}`);
  const node = nodeInCanvas(value, 'video');
  const module = await import(target[0]);
  return tool === 'mask' ? module.open(node, options.mode || 'replace') : module[target[1]](node);
}

export async function openMediaPreview(value) {
  const node = nodeInCanvas(value);
  if (!['image', 'video'].includes(node.type)) throw new Error('媒体预览仅支持图片和视频节点');
  await import('../media-preview-ui.mjs');
  return window.MediaPreview.open(node);
}

export function openNodeSearch() {
  canvasHost();
  if (!window.CanvasSearchUI?.open) throw new Error('请先加载 src/features/canvas-search/ui.js');
  return window.CanvasSearchUI.open();
}

export async function openStudio(value) {
  const node = nodeInCanvas(value, 'studio');
  if (!window.StudioAPI?.open) throw new Error('请先加载 studio.mjs');
  return window.StudioAPI.open(node.id);
}

export function openAgent() {
  canvasHost();
  if (!window.AgentUI?.open) throw new Error('请先加载 agent-client.js');
  return window.AgentUI.open();
}
