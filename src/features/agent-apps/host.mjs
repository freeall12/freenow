const resourcePattern = /^ui:\/\/tapnow\/([a-z0-9-]+)@(v\d+)$/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fault = (code, message) => Object.assign(new Error(message), {code});
const protocolVersion = '2026-01-26';

function dataCopy(value, limit = 1000000, stripMedia = false) {
  let text;
  try {text = JSON.stringify(value, (key, item) => stripMedia && ['media_ref', 'poster_ref'].includes(key) ? undefined : item);}
  catch {throw fault(-32602, 'data must be JSON serializable');}
  if (text === undefined || new TextEncoder().encode(text).length > limit) throw fault(-32602, 'data exceeds the supported size');
  return JSON.parse(text);
}
function sameJsonValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}
function sendMetadata(params) {
  if (params._meta === undefined) return undefined;
  if (!object(params._meta)) throw fault(-32602, 'invalid message metadata');
  const input = params._meta['tapnow/sendPrompt'], handoff = params._meta['tapnow/handoffId'], meta = {};
  if (input !== undefined && !object(input)) throw fault(-32602, 'invalid sendPrompt metadata');
  if (input?.hidden === true) meta.hidden = true;
  if (input?.contextNodeIds !== undefined) {
    if (!Array.isArray(input.contextNodeIds) || input.contextNodeIds.length > 50 || input.contextNodeIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 180)) throw fault(-32602, 'invalid context node IDs');
    meta.contextNodeIds = [...new Set(input.contextNodeIds)];
  }
  if (handoff !== undefined) {
    if (typeof handoff !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(handoff)) throw fault(-32602, 'invalid handoff ID');
    meta.handoffId = handoff;
  }
  return Object.keys(meta).length ? meta : undefined;
}
function cspPolicy(value = {}) {
  const result = {};
  for (const field of ['imgDomains', 'mediaDomains']) if (value[field] !== undefined) {
    if (!Array.isArray(value[field]) || value[field].some(origin => typeof origin !== 'string' || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin))) throw fault(-32602, 'invalid resource CSP');
    result[field] = [...value[field]];
  }
  return result;
}

/** Local MCP Apps subset matching the packaged TapNow proxy. The registry owns
 * iframe.src and the resource allowlist; this host never fetches app code or
 * maps arbitrary tools/call to canvas or provider APIs. */
export function createMcpAppHost(options) {
  const {iframe, callbacks = {}, isCurrent = () => true, allowResource = () => true} = options;
  const window = iframe.ownerDocument?.defaultView || globalThis.window;
  const resource = resourcePattern.exec(options.resourceUri || '');
  const widgetStateLimit = options.widgetStateLimit ?? 65536;
  if (![65536, 128 * 1024].includes(widgetStateLimit)) throw fault(-32602, 'invalid widget state limit');
  let nonce = window.crypto.randomUUID(), started = false, disposed = false, ready = false, initialized = false, failed = false, loadSeen = false;
  let generation = 0, initTimer = null, retryTimer = null, lastMessageAt = -Infinity, sending = false;
  let toolInput = dataCopy(options.toolInput ?? {}, 1000000, true), toolResult = options.toolResult == null ? null : dataCopy(options.toolResult, 1000000, true);
  let widgetState = options.initialWidgetState == null ? null : dataCopy(options.initialWidgetState, widgetStateLimit), projectionRevision = null;
  let hostContext = {theme: options.theme || 'dark', locale: options.locale || 'zh-CN', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web', ...dataCopy(options.hostContext || {})};
  let expanded = false, presentationTracked = false, conversationActive;
  const requests = new Map(), csp = cspPolicy(options.csp);
  if (widgetState !== null && !object(widgetState)) throw fault(-32602, 'widget state must be an object');
  function live() {try {return !disposed && !failed && iframe.isConnected !== false && isCurrent() !== false;} catch {return false;}}
  function post(message) {if (!disposed && !failed) iframe.contentWindow?.postMessage({...message, nonce}, '*');}
  function notify(method, params) {post({jsonrpc: '2.0', method, params});}
  function stopTimers() {if (initTimer !== null) window.clearTimeout(initTimer);if (retryTimer !== null) window.clearInterval(retryTimer);initTimer = retryTimer = null;}
  function fail(message) {if (disposed || failed) return;failed = true;ready = false;generation++;stopTimers();callbacks.onError?.(message);}
  function sendResource() {
    if (!disposed && !failed && !ready && resource) notify('ui/notifications/sandbox-resource-ready', {nonce, resource: {name: resource[1], version: resource[2]}, csp});
  }
  function timers() {
    stopTimers();initTimer = window.setTimeout(() => fail('timeout'), options.initTimeoutMs ?? 15000);
    retryTimer = window.setInterval(sendResource, 800);
  }
  function toolResultParams() {
    return {content: [{type: 'text', text: typeof toolResult?.summary === 'string' ? toolResult.summary : ''}], structuredContent: dataCopy(toolResult), ...(widgetState ? {_meta: {'tapnow/widgetState': dataCopy(widgetState, widgetStateLimit)}} : {})};
  }
  function sendPresentation() {if (ready && presentationTracked) notify('tapnow/presentationState', {expanded});}
  function validGeneration(version, token) {return generation === version && nonce === token && live();}
  function finishRequest(id, payload, version, token, needsCurrent) {
    if (disposed || failed || generation !== version || nonce !== token || needsCurrent && !live()) return;
    const response = {jsonrpc: '2.0', id, ...payload};requests.set(id, {response, needsCurrent});post(response);
  }
  async function request(id, method, params) {
    const version = generation, token = nonce, needsCurrent = !['ui/initialize', 'ping'].includes(method);
    const complete = result => finishRequest(id, {result}, version, token, needsCurrent);
    const reject = error => finishRequest(id, {error: {code: Number.isInteger(error.code) ? error.code : -32000, message: error.code ? error.message : 'host action failed'}}, version, token, needsCurrent);
    try {
      if (!object(params)) throw fault(-32602, 'params must be an object');
      if (method === 'ui/initialize') {
        initialized = true;
        complete({protocolVersion, hostInfo: {name: 'canvas-replica', version: '1.0.0'}, hostCapabilities: {...callbacks.onSendPrompt ? {message: {text: {}}} : {}}, hostContext: dataCopy(hostContext)});return;
      }
      if (method === 'ping') {complete({});return;}
      if (!ready || !live()) throw fault(-32000, 'app is not ready or current');
      if (method === 'tapnow/setWidgetState') {
        if (!callbacks.onSetWidgetState) throw fault(-32601, 'widget state persistence is not configured');
        if (!object(params.state)) throw fault(-32602, 'state must be an object');
        const state = dataCopy(params.state, widgetStateLimit);
        const saved = await callbacks.onSetWidgetState(state);
        if (!validGeneration(version, token)) return;
        if (saved === false) throw fault(-32000, 'widget state was not saved');
        widgetState = state;complete({});return;
      }
      if (method === 'ui/message') {
        if (!callbacks.onSendPrompt) throw fault(-32601, 'message queue is not configured');
        if (params.details !== undefined) throw fault(-32601, 'structured app replies are not supported');
        if (!Array.isArray(params.content) || !params.content.length || params.content.some(part => !object(part) || part.type !== 'text' || typeof part.text !== 'string')) throw fault(-32602, 'only text content is supported');
        const text = params.content.map(part => part.text).join('').trim(), meta = sendMetadata(params);
        if (!text || text.length > 16384) throw fault(-32602, 'text is empty or too long');
        if (iframe.ownerDocument?.activeElement !== iframe || window.navigator.userActivation?.isActive !== true) throw fault(-32000, 'a current user action is required');
        const now = Date.now();if (sending || now - lastMessageAt < 1000) throw fault(-32000, 'busy or rate limited');
        sending = true;lastMessageAt = now;
        try {
          const accepted = await callbacks.onSendPrompt(text, meta, () => validGeneration(version, token));
          if (!validGeneration(version, token)) return;
          if (accepted === false) throw fault(-32000, 'message was not queued');
          complete({});
        } finally {if (generation === version) sending = false;}
        return;
      }
      throw fault(-32601, 'method not supported or not configured');
    } catch (error) {reject(error);}
  }
  function receive(event) {
    if (disposed || failed || event.source !== iframe.contentWindow) return;
    const data = event.data;if (!object(data) || data.jsonrpc !== '2.0') return;
    if (data.method === 'ui/notifications/sandbox-proxy-ready') {sendResource();return;}
    const receivedNonce = data.nonce ?? (data.method === 'ui/notifications/sandbox-resource-error' ? data.params?.nonce : undefined);
    if (receivedNonce !== nonce) return;
    if (data.method === 'ui/notifications/sandbox-resource-error') {fail(typeof data.params?.message === 'string' ? data.params.message.slice(0,1000) : 'resource_error');return;}
    if (typeof data.method !== 'string') return;
    if (Object.hasOwn(data, 'id')) {
      const id = data.id;if (!(typeof id === 'string' && id.length > 0 && id.length <= 200 || typeof id === 'number' && Number.isFinite(id))) return;
      if (requests.has(id)) {const previous = requests.get(id);if (previous && (!previous.needsCurrent || live())) post(previous.response);return;}
      if (requests.size >= 512) {post({jsonrpc: '2.0', id, error: {code: -32000, message: 'request limit reached'}});return;}
      requests.set(id, null);void request(id, data.method, data.params ?? {});return;
    }
    if (data.method === 'ui/notifications/initialized' && initialized && !ready) {
      ready = true;stopTimers();notify('ui/notifications/tool-input', {arguments: dataCopy(toolInput)});
      if (toolResult !== null) notify('ui/notifications/tool-result', toolResultParams());
      sendPresentation();if (conversationActive !== undefined) notify('tapnow/updateData', {conversation_run_active: conversationActive});callbacks.onReady?.();return;
    }
    if (data.method === 'ui/notifications/size-changed' && ready && Number.isFinite(data.params?.height) && data.params.height > 0) callbacks.onSizeChanged?.(data.params.height);
  }
  function loaded() {
    if (disposed || failed) return;
    if (loadSeen) {generation++;nonce = window.crypto.randomUUID();ready = initialized = false;sending = false;lastMessageAt = -Infinity;requests.clear();timers();}
    loadSeen = true;sendResource();
  }
  function start() {
    if (disposed || started) return;started = true;
    let allowed = false;try {allowed = !!resource && allowResource(options.resourceUri) === true;} catch {}
    if (!allowed) {fail('invalid_resource_uri');return;}
    window.addEventListener('message', receive);iframe.addEventListener('load', loaded);timers();sendResource();
  }
  function updateData(input, result, revision) {
    if (disposed || failed) return false;
    if (revision !== undefined) {
      if (!object(revision) || !Number.isSafeInteger(revision.message_sequence) || revision.message_sequence < 0 || !Number.isSafeInteger(revision.part_index) || revision.part_index < 0) throw fault(-32602, 'invalid projection revision');
      if (projectionRevision && (revision.message_sequence < projectionRevision.message_sequence || revision.message_sequence === projectionRevision.message_sequence && revision.part_index <= projectionRevision.part_index)) return false;
    }
    const nextInput = dataCopy(input ?? {}, 1000000, true), nextResult = result == null ? null : dataCopy(result, 1000000, true);
    toolInput = nextInput;toolResult = nextResult;if (revision) projectionRevision = {...revision};
    if (ready) notify('tapnow/updateData', {toolInput, toolResult, ...(revision ? {revision: {...revision}} : {})});return true;
  }
  function updateHostContext(patch) {
    if (disposed || failed) return;if (!object(patch)) throw fault(-32602, 'host context must be an object');
    const next = dataCopy(patch, 65536), changed = Object.keys(next).some(key => !Object.hasOwn(hostContext, key) || !sameJsonValue(hostContext[key], next[key]));
    hostContext = {...hostContext, ...next};if (ready && changed) notify('ui/notifications/host-context-changed', next);
  }
  function updatePresentationState(value) {if (disposed || failed) return;const changed = !presentationTracked || expanded !== !!value;presentationTracked = true;expanded = !!value;if (changed) sendPresentation();}
  function updateConversationRunActive(value) {if (disposed || failed) return;const next = !!value;if (conversationActive === next) return;conversationActive = next;if (ready) notify('tapnow/updateData', {conversation_run_active: conversationActive});}
  function sendPresentationShortcut(key) {if (!disposed && !failed && ready && expanded && typeof key === 'string' && key.length < 40) notify('tapnow/presentationShortcut', {key});}
  function dispose() {if (disposed) return;disposed = true;generation++;stopTimers();requests.clear();window.removeEventListener('message', receive);iframe.removeEventListener('load', loaded);}
  return {start, updateData, updateHostContext, updatePresentationState, updateConversationRunActive, sendPresentationShortcut, dispose};
}
