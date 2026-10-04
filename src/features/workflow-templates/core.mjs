const supportedTypes = new Set(['image', 'video', 'text', 'audio', 'group']);
const clone = value => structuredClone(value);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = value => typeof value === 'string' ? value : '';
const parameterKeys = new Set(['prompt', 'model', 'provider', 'modelType', 'variant', 'aspectRatio', 'aspect_ratio', 'ratio', 'imageSize', 'resolution', 'quality', 'duration', 'generateAudio', 'audio', 'enableGoogleSearch', 'times', 'count', 'mode', 'seed', 'strength', 'thinking', 'images', 'image_normal', 'image_srefs', 'image_oref', 'refs']);
// Public executable-category snapshot, 2026-10-05. Historical IDs stay in
// template metadata but never acquire an invented display name.
export const officialCategories = Object.freeze([
  ['68556690-89e1-4c68-9510-4d50820329a2', 'Seedance 2.0'],
  ['921eb428-6172-4a9c-9485-59e1b2e6b53a', '广告'],
  ['606fbfcf-80d9-4d05-9c29-e342547e9080', '电商'],
  ['0f13316d-956a-4157-8723-8cd14722f42c', '影视'],
  ['3e630f14-bc32-4e3e-87de-e942b81e1c75', '生活'],
  ['872225af-6fb3-4d5c-ae5e-de9e14ef3336', '工具'],
  ['7550b4fd-c65b-40fb-93d0-ae08259c8752', '有趣'],
  ['b9fe138c-2f7d-4d35-90ea-45b3bf22d5d1', 'ACG']
].map(([id, name]) => Object.freeze({id, name})));
const validCategoryId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function publicTemplateRows(response) {
  const value = response?.data ?? response;
  const rows = Array.isArray(value) ? value : value?.templates ?? value?.data?.templates ?? value?.data;
  if (!Array.isArray(rows)) throw Error('公共模板响应格式无效');
  return rows;
}

export function localMedia(value, resources = {}) {
  if (!value) return '';
  const mapped = resources[value] ?? value;
  if (typeof mapped !== 'string' || !/^(?:\/?assets\/|data:(?:image|video|audio)\/|asset:)/.test(mapped) || /(?:^|\/)\.\.(?:\/|$)/.test(mapped)) throw Error('模板媒体尚未导入本地素材');
  return mapped;
}

function localized(row, field, fallback) {
  const content = row.i18n_content;
  if (typeof content?.[field] === 'string') return content[field];
  for (const language of ['zh_CN', 'zh-CN', 'zh', 'en_US', 'en']) {
    if (typeof content?.[language]?.[field] === 'string') return content[language][field];
    if (typeof content?.[field]?.[language] === 'string') return content[field][language];
  }
  return text(fallback);
}

export function publicMediaSlots(response) {
  const slots = [];
  const add = (value, path, type) => { if (typeof value === 'string' && value) slots.push({source: value, path, type}); };
  for (const [index, row] of publicTemplateRows(response).entries()) {
    const path = `templates[${index}]`;
    add(row.preview_image || row.cover, path + '.preview_image', row.cover_media_type === 'video' ? 'video' : 'image');
    for (const [nodeIndex, node] of (row.template_data?.nodes || []).entries()) {
      const data = node.data || {}, at = `${path}.template_data.nodes[${nodeIndex}].data`;
      if (['image', 'video', 'audio'].includes(node.type)) add(data.src, at + '.src', node.type);
      add(data.poster, at + '.poster', 'image');
      for (const [optionIndex, option] of (data.options || []).entries()) add(typeof option === 'string' ? option : option?.url, `${at}.options[${optionIndex}]`, node.type);
      for (const key of ['images', 'image_normal', 'image_srefs', 'image_oref', 'refs']) for (const [refIndex, value] of (data.params?.[key] || []).entries()) add(typeof value === 'string' ? value : value?.url, `${at}.params.${key}[${refIndex}]`, 'image');
    }
  }
  return slots;
}

// Only node geometry, media, editable content and execution parameters cross
// this boundary. Account fields and arbitrary API metadata never enter a project.
export function compilePublicTemplate(row, {resources = {}} = {}) {
  const source = row.template_data;
  if (!text(row.id) || !Array.isArray(source?.nodes) || !source.nodes.length || !Array.isArray(source.edges ?? [])) throw Error('公共模板节点数据不完整');
  const ids = new Set(source.nodes.map(node => node.id));
  if (ids.size !== source.nodes.length || source.nodes.some(node => !text(node.id) || !supportedTypes.has(node.type))) throw Error('公共模板包含暂不支持的节点');
  const byId = new Map(source.nodes.map(node => [node.id, node]));
  const externalParents = new Set(source.nodes.map(node => node.parentId).filter(id => id && !ids.has(id)));
  // Official group capture excludes its enclosing group. Its children retain
  // that one root parent ID; it is replaced by the newly instantiated group.
  if (externalParents.size > 1) throw Error('公共模板包含多个外部分组引用');
  function absolute(node, ancestors = new Set()) {
    if (ancestors.has(node.id)) throw Error('模板分组引用存在循环');
    const position = node.position;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw Error('模板节点坐标无效');
    if (!node.parentId || externalParents.has(node.parentId)) return position;
    const parent = byId.get(node.parentId);
    if (!parent || parent.type !== 'group') throw Error('模板节点分组引用无效');
    const origin = absolute(parent, new Set([...ancestors, node.id]));
    return {x: origin.x + position.x, y: origin.y + position.y};
  }
  const nodes = source.nodes.map(node => {
    const data = node.data ?? {}, position = absolute(node);
    const width = finite(node.width ?? node.measured?.width ?? parseFloat(node.style?.width), node.type === 'text' ? 300 : 435);
    const height = finite(node.height ?? node.measured?.height ?? parseFloat(node.style?.height), node.type === 'text' ? 300 : 300);
    if (width <= 0 || height <= 0) throw Error('模板节点尺寸无效');
    const result = {id: node.id, type: node.type, title: text(data.title || data.label || node.type), x: position.x, y: position.y, width, height};
    if (node.parentId && !externalParents.has(node.parentId)) result.parentId = node.parentId;
    if (node.type === 'image' && data.src) result.image = result.fullImage = localMedia(data.src, resources);
    if (node.type === 'video' && data.src) result.video = localMedia(data.src, resources);
    if (node.type === 'audio' && data.src) result.audio = localMedia(data.src, resources);
    if (['image', 'video'].includes(node.type) && data.poster) result.image = localMedia(data.poster, resources);
    if (Array.isArray(data.options)) result.versions = data.options.map(value => ({[node.type === 'video' ? 'video' : 'image']: localMedia(typeof value === 'string' ? value : value?.url, resources)}));
    if (node.type === 'text') {
      result.content = text(data.text ?? data.content);
      result.textMode = data.params || data.prompt ? 'generate' : 'pure';
    }
    if (['image', 'video', 'text'].includes(node.type) && (data.params || data.prompt)) {
      result.generation = {...Object.fromEntries(Object.entries(data.params ?? {}).filter(([key]) => parameterKeys.has(key)).map(([key, value]) => [key, clone(value)])), prompt: text(data.prompt || data.params?.prompt)};
      if (data.cameraControl) result.generation.cameraControl = Object.fromEntries(['enabled', 'apertureKey', 'cameraKey', 'focalKey', 'lensKey'].filter(key => data.cameraControl[key] !== undefined).map(key => [key, data.cameraControl[key]]));
      // Parameters use local refs plus graph edges. Imported URLs in reference
      // arrays must be migrated as well as result media before application.
      for (const key of ['images', 'image_normal', 'image_srefs', 'image_oref', 'refs']) {
        if (Array.isArray(result.generation[key])) result.generation[key] = result.generation[key].map(value => typeof value === 'string' ? localMedia(value, resources) : { ...(text(value?.id) ? {id: value.id} : {}), ...(text(value?.type) ? {type: value.type} : {}), ...(value?.url ? {url: localMedia(value.url, resources)} : {}) });
      }
      if (result.generation.times !== undefined) result.generation.count = result.generation.times;
      if (result.generation.aspect_ratio !== undefined) result.generation.ratio = result.generation.aspect_ratio;
      if (result.generation.aspectRatio !== undefined) result.generation.ratio = result.generation.aspectRatio;
      if (result.generation.imageSize !== undefined) result.generation.quality = result.generation.imageSize;
      if (result.generation.resolution !== undefined) result.generation.quality = result.generation.resolution;
      if (result.generation.generateAudio !== undefined) result.generation.audio = result.generation.generateAudio;
    }
    return result;
  });
  const x = Math.min(...nodes.map(node => node.x)), y = Math.min(...nodes.map(node => node.y));
  for (const node of nodes) { node.x = node.x - x + 40; node.y = node.y - y + 40; }
  const edges = (source.edges ?? []).map((edge, index) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw Error('模板内部连线引用无效');
    return {id: text(edge.id) || 'edge-' + index, source: edge.source, target: edge.target, ...(edge.sourceHandle ? {sourceHandle: edge.sourceHandle} : {}), ...(edge.targetHandle ? {targetHandle: edge.targetHandle} : {}), ...(edge.data ? {data: { ...(Number.isFinite(edge.data.order) ? {order: edge.data.order} : {}), ...(text(edge.data.valueKey) ? {valueKey: edge.data.valueKey} : {})}} : {})};
  });
  for (const node of nodes) if (node.generation) {
    const references = edges.filter(edge => edge.target === node.id).sort((a, b) => (a.data?.order ?? 2 ** 30) - (b.data?.order ?? 2 ** 30));
    node.generation.referenceOrder = [...new Set(references.map(edge => 'node:' + edge.source))];
  }
  const cover = row.preview_image || row.cover || '';
  return {id: row.id, name: localized(row, 'title', row.title || row.name), description: localized(row, 'des', row.description), tags: Array.isArray(row.tags) ? row.tags.filter(tag => typeof tag === 'string') : [], createdAt: text(row.created_at), category: text(row.category) || 'workflow', categoryIds: [...new Set((Array.isArray(row.category_ids) ? row.category_ids : []).filter(validCategoryId))], ...(row.cover_media_type === 'video' ? {video: localMedia(cover, resources)} : {image: localMedia(cover, resources)}), graph: {version: 1, nodes, edges, width: Math.max(...nodes.map(node => node.x + node.width)) + 40, height: Math.max(...nodes.map(node => node.y + node.height)) + 40, groupColor: ''}};
}

export function validateCatalog(value) {
  if (value?.version !== 1 || !Array.isArray(value.templates) || !value.templates.length) throw Error('公共模板清单无效');
  const ids = new Set();
  for (const item of value.templates) {
    if (!text(item.id) || !text(item.name) || ids.has(item.id) || item.graph?.version !== 1 || !Array.isArray(item.graph.nodes) || !item.graph.nodes.length || !Array.isArray(item.graph.edges)) throw Error('公共模板清单节点数据无效');
    ids.add(item.id);
    if (item.categoryIds !== undefined && (!Array.isArray(item.categoryIds) || !item.categoryIds.every(validCategoryId))) throw Error('公共模板分类数据无效');
    if (item.image) localMedia(item.image);
    if (item.video) localMedia(item.video);
    if (item.thumbnail) localMedia(item.thumbnail);
    for (const node of item.graph.nodes) {
      if (!supportedTypes.has(node.type) || ![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) throw Error('公共模板清单坐标无效');
      for (const key of ['image', 'fullImage', 'video', 'audio']) if (node[key]) localMedia(node[key]);
    }
  }
  return clone(value.templates);
}

export function insertionPoint(item, state, bounds) {
  const {view, nodes} = state;
  if (![view?.x, view?.y, view?.scale, bounds?.width, bounds?.height].every(Number.isFinite) || view.scale <= 0) throw Error('当前画布视图无效');
  const point = {x: (bounds.width / 2 - view.x) / view.scale, y: (bounds.height / 2 - view.y) / view.scale};
  const overlaps = node => point.x < node.x + node.width && point.x + item.graph.width > node.x && point.y < node.y + node.height && point.y + item.graph.height > node.y;
  for (let attempt = 0; attempt <= nodes.length && nodes.some(overlaps); attempt++) point.x = Math.max(...nodes.filter(overlaps).map(node => node.x + node.width)) + 160;
  return point;
}

export function applyPublicTemplate(item, {app, templatesCore, projectId, currentProjectId, bounds}) {
  if (projectId !== currentProjectId()) throw Error('画布已切换，请在当前项目重新应用模板');
  validateCatalog({version: 1, templates: [item]});
  const point = insertionPoint(item, app.getState(), bounds());
  const graph = templatesCore.instantiate(item, point);
  if (projectId !== currentProjectId()) throw Error('画布已切换，请重新应用模板');
  app.insertGraph(graph);
  app.focusNode(graph.group.id);
  return graph.group;
}
