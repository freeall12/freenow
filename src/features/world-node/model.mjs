// Official eb1c357: Jv, ZZ, GZ/HZ and packages n9/Qde/TZ. These are
// resource nodes; the separate studio node owns an editable scene.
export const models = [
  {id: 'tripo-h3', label: 'Tripo H3', provider: 'tripo', outputType: 'asset', representation: 'mesh', icon: 'assets/world-model-tripo.svg'},
  {id: 'worldlabs-marble-1.1', label: 'Marble 1.1', provider: 'worldlabs', outputType: 'world', representation: 'gaussianSplat', icon: 'assets/world-model-worldlabs.svg'},
  {id: 'worldlabs-marble-1.1-plus', label: 'Marble 1.1 Plus', provider: 'worldlabs', outputType: 'world', representation: 'gaussianSplat', icon: 'assets/world-model-worldlabs.svg'},
];

export function config(node) {
  const raw = node.worldConfig || {};
  const id = /tripo-(?:image|text)-to-model-h3/.test(raw.model) ? 'tripo-h3' : raw.model;
  return {model: models.some(model => model.id === id) ? id : 'tripo-h3', prompt: raw.prompt || '',
    isPano: raw.isPano === true, material: ['geometry', 'texture', 'pbr'].includes(raw.material) ? raw.material : 'texture'};
}

export function draft() {
  return {type: 'world', title: '3D', image: null, width: 375, height: 250,
    outputType: 'asset', worldConfig: config({})};
}

export function inputError({image = 0, video = 0, audio = 0}) {
  if (audio) return '3D 生成不支持参考音频';
  if (image && video) return '3D 世界生成不支持混合图片和视频输入';
  if (image > 8) return '最多支持 8 张参考图片';
  if (video > 1) return '最多支持 1 个参考视频';
  return null;
}

export function sourceReference(node) {
  return {nodeId: node.id, type: node.type, title: node.title,
    ...(node.type === 'text' ? {text: node.content || ''} : {url: node.type === 'video' ? node.video : node.fullImage || node.image}),
    ...(node.type === 'video' ? {...node.clip != null ? {clip: structuredClone(node.clip)} : {}, ...node.trim != null ? {trim: structuredClone(node.trim)} : {}} : {}),
    isPano: node.generation?.isPanoramaPrompt === true || node.generation?.ratio === '2:1'};
}

export function references(id, state) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  return state.edges.filter(edge => edge.target === id && (!edge.data?.purpose || edge.data.purpose === 'generation-input'))
    .map((edge, index) => ({edge, node: byId.get(edge.source), index}))
    .filter(item => item.node && ['text', 'image', 'video'].includes(item.node.type))
    .sort((a, b) => (a.edge.data?.order ?? a.index) - (b.edge.data?.order ?? b.index))
    .map(({edge, node}) => ({edgeId: edge.id, ...sourceReference(node)}));
}

export function prepare(node, refs) {
  const settings = config(node), model = models.find(item => item.id === settings.model);
  const inputs = refs.filter(ref => ref.type === 'text' ? ref.text?.trim() : ref.url);
  const images = inputs.filter(ref => ref.type === 'image'), videos = inputs.filter(ref => ref.type === 'video');
  let error = refs.some(ref => ref.type !== 'text' && !ref.url) ? '参考节点尚无实际媒体，请补充或移除参考' : inputError({image: images.length, video: videos.length});
  const modelType = videos.length ? 'VIDEO_TO_WORLD' : images.length > 1 ? 'MULTI_IMAGE_TO_WORLD'
    : images.length ? settings.isPano ? 'PANORAMA_TO_WORLD' : 'IMAGE_TO_WORLD' : 'TEXT_TO_WORLD';
  if (!error && model.provider === 'tripo' && (images.length > 1 || videos.length)) error = '当前模型仅支持文字或单张图片输入';
  const promptDisabled = model.provider === 'tripo' && images.length === 1;
  const prompt = promptDisabled ? '' : [...inputs.filter(ref => ref.type === 'text').map(ref => ref.text), settings.prompt].filter(Boolean).join('\n\n');
  if (!error && modelType === 'TEXT_TO_WORLD' && !prompt.trim()) error = '请输入提示词';
  const material = settings.material, texture = material !== 'geometry';
  const parameters = {model: model.provider === 'tripo' ? `tripo-${images.length ? 'image' : 'text'}-to-model-h3` : model.id,
    provider: model.provider, modelType, outputType: model.outputType, representation: model.representation,
    isPano: images.length === 1 && settings.isPano, count: 1};
  if (model.provider === 'tripo') parameters.tripoParams = {
    texture, pbr: material === 'pbr', smart_low_poly: false, quad: false, auto_size: true,
    generate_parts: false, export_uv: false, geometry_quality: 'standard', compress: 'geometry', texture_quality: 'standard',
    ...(images.length ? {enable_image_autofix: false, orientation: 'default', ...(texture ? {texture_alignment: 'original_image'} : {})} : {}),
  };
  return {error, promptDisabled, model, imageCount: images.length, videoCount: videos.length,
    request: {kind: 'world.generate', nodeId: node.id, label: model.outputType === 'asset' ? '3D 资产生成' : '3D 世界生成',
      prompt, inputs: inputs.filter(ref => ref.type !== 'text').map(({nodeId, type, url, clip, trim}) => ({nodeId, type, url,
        ...clip != null ? {clip: structuredClone(clip)} : {}, ...trim != null ? {trim: structuredClone(trim)} : {}})), parameters}};
}

export function signature(node, refs) {
  return JSON.stringify([config(node), refs, node.worldResource || null]);
}
