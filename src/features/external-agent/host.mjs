const fail = code => {throw Object.assign(Error(code), {code});};
const clean = (value, length) => String(value ?? '').replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, length);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
export function createReadonlyHost({app, getReady, getIdentity, pageId, crypto = globalThis.crypto}) {
  let disposed = false;
  const identity = () => {
    if (disposed || !getReady()) fail('workspace_unavailable');
    const value = getIdentity(); if (!identifier(value?.id)) fail('workspace_unavailable');
    return {pageId, projectId: value.id, title: clean(value.title, 120)};
  };
  async function read(name, args = {}, binding) {
    const scope = identity();
    if (!binding || scope.pageId !== binding.pageId || scope.projectId !== binding.projectId) fail('workspace_changed');
    if (!['workspace_status', 'canvas_read'].includes(name)) fail('tool_not_supported');
    const fields = name === 'workspace_status' ? [] : ['offset', 'limit', 'expected_revision'];
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !fields.includes(key)) || args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 100000) || args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 50) || args.expected_revision !== undefined && (typeof args.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(args.expected_revision))) fail('invalid_arguments');
    const state = app.getState();
    if (!Array.isArray(state.nodes) || !Array.isArray(state.edges) || state.nodes.length > 100000 || state.edges.length > 200000) fail('workspace_unavailable');
    const selected = new Set(state.selected || []);
    const nodes = state.nodes.map(node => {
      if (!identifier(node.id) || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(node[key])) || node.width <= 0 || node.height <= 0) fail('workspace_unavailable');
      // Read an explicit title only. Text bodies, prompts, URLs and previews
      // cannot become a fallback label and escape the metadata capability.
      return {id: node.id, type: clean(node.type, 40), title: clean(typeof node.title === 'string' ? node.title : '', 120), x: node.x, y: node.y, width: node.width, height: node.height, selected: selected.has(node.id)};
    });
    if (new Set(nodes.map(node => node.id)).size !== nodes.length) fail('workspace_unavailable');
    const edges = state.edges.map(edge => {
      if (!identifier(edge.id) || !identifier(edge.source) || !identifier(edge.target)) fail('workspace_unavailable');
      return {id: edge.id, source: edge.source, target: edge.target};
    });
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({project: scope.projectId, nodes, edges})));
    const revision = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const current = identity(); if (current.pageId !== scope.pageId || current.projectId !== scope.projectId) fail('workspace_changed');
    if (args.expected_revision && args.expected_revision !== revision) fail('revision_changed');
    const result = {project_id: scope.projectId, revision, read_only: true, node_count: nodes.length, edge_count: edges.length};
    if (name === 'canvas_read') {
      const offset = args.offset || 0, end = Math.min(nodes.length, offset + (args.limit || 20));
      return {...result, offset, next_offset: end < nodes.length ? end : null, nodes: nodes.slice(offset, end)};
    }
    return result;
  }
  return {identity, read, dispose() {disposed = true;}};
}
export function install({window, app, getReady}) {
  const bridge = window.FreenowExternalAgent, pageId = window.crypto.randomUUID();
  const host = createReadonlyHost({app, getReady, getIdentity: () => app.projectIdentity(), pageId, crypto: window.crypto});
  let disposed = false, registered = false;
  async function register() {
    if (disposed || registered || !bridge || !getReady()) return;
    const result = await bridge.invoke('register', host.identity());
    if (result?.registered) registered = true;
  }
  const removeRequest = bridge?.onRequest(async input => {
    if (disposed) return;
    let reply;
    try {reply = {requestId: input.requestId, result: await host.read(input.name, input.args, input.binding)};}
    catch (error) {reply = {requestId: input.requestId, error: {code: error.code || 'host_unavailable'}};}
    if (!disposed) await bridge.invoke('reply', reply).catch(() => {});
  });
  const timer = bridge ? window.setInterval(() => {void register().catch(() => {});}, 1000) : null;
  void register().catch(() => {});
  function dispose() {if (disposed) return; disposed = true; host.dispose(); if (timer) window.clearInterval(timer); removeRequest?.(); if (registered) void bridge.invoke('unregister', {pageId}).catch(() => {});}
  window.addEventListener('pagehide', dispose, {once: true});
  return {register, dispose};
}
