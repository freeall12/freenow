const DEFAULT_LIMIT = 8000, MAX_LIMIT = 20000;
const credentialKey = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)$/i;
const embeddedMedia = /\b(?:data:[^\s"'<>)]*|blob:[^\s"'<>)]*)/gi;

function id(value, name = 'id') {
  if (typeof value !== 'string' || !value.length || value.length > 180) throw Error(`${name} 必须是现有节点 ID`);
  return value;
}
function stateOf(app) {
  if (typeof app?.getState !== 'function') throw Error('画布尚未就绪');
  return app.getState();
}
function getNode(app, value) {
  const node = stateOf(app).nodes.find(node => node.id === id(value));
  if (!node) throw Error('节点不存在');
  return node;
}
function readableString(value) {
  return value.replace(embeddedMedia, source => {
    if (/^blob:/i.test(source)) return '[omitted blob media]';
    const comma = source.indexOf(','), header = source.slice(5, comma < 0 ? 120 : Math.min(comma, 120));
    const candidate = header.split(';')[0], mime = !candidate ? 'text/plain' : /^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(candidate) ? candidate : 'unknown';
    return `[omitted data media: ${mime}; ${source.length} characters]`;
  });
}
// Return the stored JSON structure, not normalized history helpers: those may
// synthesize legacy IDs, prompts and batches that were never recorded by a job.
function readable(value, ancestors = new WeakSet()) {
  if (typeof value === 'string') return readableString(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return undefined;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return {omitted: 'binary', byteLength: value.byteLength};
  if (typeof Blob !== 'undefined' && value instanceof Blob) return {omitted: 'binary', mime: value.type, bytes: value.size};
  if (ancestors.has(value)) return {omitted: 'circular reference'};
  ancestors.add(value);
  const result = Array.isArray(value) ? value.map(item => readable(item, ancestors)) : Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, credentialKey.test(key) ? '[omitted credential]' : readable(item, ancestors)]),
  );
  ancestors.delete(value);
  return result;
}

export function readCanvasNode({id: nodeId, offset = 0, limit = DEFAULT_LIMIT}, {app}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw Error('正文分页参数无效');
  const node = getNode(app, nodeId), {content: rawContent, ...details} = node;
  const content = typeof rawContent === 'string' ? readableString(rawContent) : '';
  const value = content.slice(offset, offset + limit), next = offset + value.length;
  const edges = stateOf(app).edges;
  return {
    node: readable(details),
    content: {present: typeof rawContent === 'string', value, offset, limit, totalLength: content.length,
      nextOffset: next < content.length ? next : null, offsetUnit: 'UTF-16 code units after media redaction'},
    connections: {incoming: readable(edges.filter(edge => edge.target === node.id)), outgoing: readable(edges.filter(edge => edge.source === node.id))},
    history: {recordedFields: ['imageHistory', 'videoHistory', 'audioHistory', 'textHistory', 'versions'].filter(key => Object.hasOwn(node, key)),
      note: 'Only fields stored on this node are returned. Missing timestamps, prompts, versions and earlier history are unknown; no lineage is inferred.'},
  };
}

export function disconnectCanvasNodes({source, target}, {app}) {
  id(source, 'source'); id(target, 'target');
  const before = stateOf(app).edges.filter(edge => edge.source === source && edge.target === target).map(edge => edge.id);
  if (before.length) app.disconnect(source, target);
  const remaining = new Set(stateOf(app).edges.map(edge => edge.id));
  const removedEdgeIds = before.filter(edgeId => !remaining.has(edgeId));
  return {source, target, removedEdgeIds, disconnected: removedEdgeIds.length > 0};
}

export function redoCanvas(_args, {app}) {
  if (typeof app?.historyState !== 'function') throw Error('画布历史状态尚未就绪');
  const before = app.historyState();
  if (!before.redoCount) return {redone: false, ...before};
  const redone = app.undo(true) === true;
  const after = app.historyState();
  return {redone, ...after};
}

export function resizeCanvasNode({id: nodeId, width, height}, {app, text = globalThis.CanvasText, groups = globalThis.CanvasGroups}) {
  const node = getNode(app, nodeId);
  if (!['text', 'group'].includes(node.type)) throw Error('仅文本和分组节点支持此尺寸操作');
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw Error('节点宽高必须为有限正数');
  const resize = node.type === 'text' ? text?.resize : groups?.resizeBounds;
  if (typeof resize !== 'function') throw Error('节点尺寸控件尚未就绪');
  const before = {x: node.x, y: node.y, width: node.width, height: node.height};
  const bounds = resize(before, 'se', width - before.width, height - before.height);
  const changed = bounds.width !== before.width || bounds.height !== before.height;
  // Resizing from the south-east handle leaves group children in world space.
  // Do not include x/y: updateNode uses those keys to translate descendants.
  if (changed) app.updateNode(node.id, {width: bounds.width, height: bounds.height});
  const current = getNode(app, nodeId);
  return {id: current.id, type: current.type, changed, x: current.x, y: current.y, width: current.width, height: current.height};
}

export function executeCanvasOperation(name, args, context) {
  switch (name) {
    case 'canvas_read_node': return readCanvasNode(args, context);
    case 'canvas_disconnect': return disconnectCanvasNodes(args, context);
    case 'canvas_redo': return redoCanvas(args, context);
    case 'canvas_resize': return resizeCanvasNode(args, context);
    default: throw Error(`未知画布操作：${name}`);
  }
}
