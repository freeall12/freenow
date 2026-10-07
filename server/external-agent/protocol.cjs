'use strict';
const {tools, keys, object, clientInfo, argumentsFor, fault} = require('./contracts.cjs');
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
function createProtocol({connect, call, disconnect, send}) {
  let state = 'new', closed = false;
  const pending = new Map(), used = new Set();
  const reply = (id, result) => {if (!closed) send({jsonrpc: '2.0', id, result});};
  const error = (id, code, message) => {if (!closed) send({jsonrpc: '2.0', id, error: {code, message}});};
  async function receive(value) {
    if (closed) return;
    if (!keys(value, ['jsonrpc', 'id', 'method', 'params']) || value.jsonrpc !== '2.0' || typeof value.method !== 'string' || Object.hasOwn(value, 'params') && !object(value.params) || Object.hasOwn(value, 'id') && !(typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100 || Number.isSafeInteger(value.id))) {error(null, -32600, 'Invalid Request'); return;}
    const params = value.params || {};
    if (!Object.hasOwn(value, 'id')) {
      if (value.method === 'notifications/initialized' && state === 'initialized' && keys(params, [])) state = 'ready';
      if (value.method === 'notifications/cancelled' && keys(params, ['requestId', 'reason'])) pending.get(params.requestId)?.abort();
      return;
    }
    const id = value.id;
    // Reused IDs could resolve a different in-flight call. Keep the connection
    // bounded and reject duplicates instead of replaying read data across grants.
    if (used.has(id)) {error(id, -32600, 'Duplicate request id'); return;}
    if (used.size >= 4096 || pending.size >= 8) {error(id, -32000, 'Request limit reached'); return;}
    used.add(id); const controller = new AbortController(); pending.set(id, controller);
    let initializing = false;
    try {
      if (value.method === 'initialize') {
        if (state !== 'new') throw fault('already_initialized');
        if (!keys(params, ['protocolVersion', 'capabilities', 'clientInfo', '_meta']) || typeof params.protocolVersion !== 'string' || !object(params.capabilities)) throw fault('invalid_arguments');
        const info = clientInfo(params.clientInfo); state = 'connecting'; initializing = true;
        await connect(info, controller.signal); if (controller.signal.aborted || closed) throw fault('cancelled');
        state = 'initialized'; reply(id, {protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: {tools: {}}, serverInfo: {name: 'freenow-local', version: '0.1.0'}, instructions: 'Read-only local desktop connection. After initialization, open freenow → Connect external Agent and explicitly authorize this client for the current canvas. No media, files, prompts, writes or generation are exposed. Client-supplied identity is unverified.'}); return;
      }
      if (value.method === 'ping') {if (!keys(params, [])) throw fault('invalid_arguments'); reply(id, {}); return;}
      if (state !== 'ready') throw fault('not_initialized');
      if (value.method === 'tools/list') {if (!keys(params, [])) throw fault('invalid_arguments'); reply(id, {tools}); return;}
      if (value.method !== 'tools/call') {error(id, -32601, 'Method not found'); return;}
      if (!keys(params, ['name', 'arguments', '_meta']) || typeof params.name !== 'string' || params._meta !== undefined && (!keys(params._meta, ['progressToken']) || !['string', 'number'].includes(typeof params._meta.progressToken))) throw fault('invalid_arguments');
      const args = argumentsFor(params.name, params.arguments);
      try {
        const data = await call(params.name, args, controller.signal);
        if (controller.signal.aborted) throw fault('cancelled');
        reply(id, {content: [{type: 'text', text: JSON.stringify(data)}], structuredContent: data, isError: false});
      } catch (failure) {
        const code = safeCode(failure); reply(id, {content: [{type: 'text', text: code}], isError: true});
      }
    } catch (failure) {
      if (initializing && state === 'connecting') {state = 'new'; disconnect();}
      error(id, ['invalid_arguments', 'invalid_client_info', 'tool_not_supported'].includes(failure.code) ? -32602 : -32000, safeCode(failure));
    } finally {pending.delete(id);}
  }
  return {receive, close() {if (closed) return; closed = true; for (const controller of pending.values()) controller.abort(); pending.clear(); disconnect();}};
}
function safeCode(error) {
  return ['invalid_arguments', 'invalid_client_info', 'tool_not_supported', 'already_initialized', 'not_initialized', 'authorization_required', 'authorization_expired', 'connection_revoked', 'workspace_unavailable', 'workspace_changed', 'revision_changed', 'host_unavailable', 'invalid_host_result', 'rate_limited', 'cancelled', 'transport_closed'].includes(error?.code) ? error.code : 'host_unavailable';
}
module.exports = {createProtocol, safeCode, versions};
