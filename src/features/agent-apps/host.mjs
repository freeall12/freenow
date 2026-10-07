const resourcePattern = /^ui:\/\/tapnow\/([a-z0-9-]+)@(v\d+)$/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fault = (code, message) => Object.assign(new Error(message), {code});
const protocolVersion = '2026-01-26';
const actorEmotionUri = 'ui://tapnow/actor-emotion@v1', expressionGuideTool = 'actor_emotion_save_expression_guide', expressionGuideLimit = 128 * 1024;

function dataCopy(value, limit = 1000000, stripMedia = false) {
  let text;
  try {text = JSON.stringify(value, (key, item) => stripMedia && ['media_ref', 'poster_ref'].includes(key) ? undefined : item);}
  catch {throw fault(-32602, 'data must be JSON serializable');}
  if (text === undefined || new TextEncoder().encode(text).length > limit) throw fault(-32602, 'data exceeds the supported size');
  return JSON.parse(text);
}
function strictDataCopy(value, limit) {
  const ancestors = new Set();let count = 0;
  function visit(item, depth = 0) {
    if (++count > limit || depth > 64) throw fault(-32602, 'data exceeds the supported structure');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' && item.length <= limit || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') throw fault(-32602, 'data must contain only JSON values');
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null || ancestors.has(item)) throw fault(-32602, 'data must contain only JSON objects');
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    if (array && (item.length > limit || keys.length !== item.length + 1)) throw fault(-32602, 'data must contain only JSON arrays');
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || array && !/^(0|[1-9]\d*)$/.test(key)) throw fault(-32602, 'data must contain only JSON fields');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value);return dataCopy(value, limit);
}
function expressionGuideParams(value, requestId) {
  const params = strictDataCopy(value, expressionGuideLimit);
  if (Object.keys(params).length !== 3 || Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key)) || !object(params.arguments) || !object(params._meta)) throw fault(-32602, 'invalid expression guide parameters');
  if (params.name !== expressionGuideTool) throw fault(-32601, 'tool is not supported');
  const meta = params._meta, callId = meta['tapnow/callId'];
  if (Object.keys(meta).some(key => !['tapnow/callId', 'progressToken'].includes(key)) || typeof callId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(callId)) throw fault(-32602, 'invalid expression guide metadata');
  // The official SDK adds its numeric request ID when callServerTool enables
  // progress handling. This transport field never reaches the domain callback.
  if (Object.hasOwn(meta, 'progressToken') && (!Number.isSafeInteger(meta.progressToken) || meta.progressToken < 0 || meta.progressToken !== requestId)) throw fault(-32602, 'invalid progress token');
  return {arguments: params.arguments, metadata: {callId}};
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
  const canApplyColor = options.resourceUri === 'ui://tapnow/color-adjust@v2' && typeof callbacks.onApplyColorAdjust === 'function';
  const canApplyLayer = options.resourceUri === 'ui://tapnow/layer-composer@v1' && typeof callbacks.onApplyLayerComposer === 'function';
  const canLayerContext = canApplyLayer && typeof callbacks.onLayerComposerContext === 'function';
  const canColorContext = canApplyColor && typeof callbacks.onColorAdjustContext === 'function';
  const canResizePlatform = options.resourceUri === 'ui://tapnow/platform-resize@v1' && typeof callbacks.onPlatformResizeApply === 'function';
  const canMessage = !['ui://tapnow/production-progress@v1','ui://tapnow/platform-resize@v1'].includes(options.resourceUri) && typeof callbacks.onSendPrompt === 'function';
  const canState = !['ui://tapnow/production-progress@v1','ui://tapnow/platform-resize@v1'].includes(options.resourceUri) && typeof callbacks.onSetWidgetState === 'function';
  const canFlushClose = canState && ['ui://tapnow/performance-rhythm@v3','ui://tapnow/story-room@v1','ui://tapnow/character-blocking@v3','ui://tapnow/cutlist-review@v1','ui://tapnow/product-kit@v1','ui://tapnow/director-markup@v1','ui://tapnow/color-adjust@v2','ui://tapnow/actor-emotion@v1'].includes(options.resourceUri);
  const resourceDataLimit = ['ui://tapnow/layer-composer@v1','ui://tapnow/animatic@v1','ui://tapnow/animatic@v2','ui://tapnow/previs@v3'].includes(options.resourceUri) ? 4 * 1024 * 1024 : ['ui://tapnow/cutlist-review@v1','ui://tapnow/ad-review@v1'].includes(options.resourceUri) ? 16 * 1024 * 1024 : options.resourceUri === 'ui://tapnow/color-adjust@v2' ? 2 * 1024 * 1024 : 1000000;
  const generationTools = {'ui://tapnow/animatic@v2':['animatic_variants_submit','animatic_variants_lookup'],'ui://tapnow/previs@v3':['previs_variants_submit','previs_variants_lookup'],'ui://tapnow/ecommerce-photoset@v2':['ecommerce_photoset_generate']}[options.resourceUri];
  const canGenerationTools = !!generationTools && typeof callbacks.onGenerationAppTool === 'function';
  const canGenerationContext = ['ui://tapnow/animatic@v2','ui://tapnow/ecommerce-photoset@v2'].includes(options.resourceUri) && typeof callbacks.onGenerationAppContext === 'function';
  const canPrevisReply = options.resourceUri === 'ui://tapnow/previs@v3' && typeof callbacks.onAppReply === 'function';
  const canSaveExpressionGuide = options.resourceUri === actorEmotionUri && typeof callbacks.onSaveExpressionGuide === 'function';
  const canQueryProduction = options.resourceUri === 'ui://tapnow/production-progress@v1' && typeof callbacks.onProductionProgressQuery === 'function';
  const canFindLibrary = options.resourceUri === 'ui://tapnow/library-picker@v1' && typeof callbacks.onLibraryFind === 'function';
  const canUpdateLibraryContext = canFindLibrary && typeof callbacks.onLibraryModelContext === 'function';
  const canAddLibraryAsset = canFindLibrary && typeof callbacks.onLibraryAddToCanvas === 'function';
  const widgetStateLimit = options.widgetStateLimit ?? 65536;
  if (![65536, 128 * 1024].includes(widgetStateLimit)) throw fault(-32602, 'invalid widget state limit');
  let nonce = window.crypto.randomUUID(), started = false, disposed = false, ready = false, initialized = false, failed = false, loadSeen = false;
  let generation = 0, initTimer = null, retryTimer = null, lastMessageAt = -Infinity, sending = false;
  let toolInput = dataCopy(options.toolInput ?? {}, 1000000, true), toolResult = options.toolResult == null ? null : dataCopy(options.toolResult, resourceDataLimit, true);
  let widgetState = options.initialWidgetState == null ? null : dataCopy(options.initialWidgetState, widgetStateLimit), projectionRevision = null;
  let hostContext = {theme: options.theme || 'dark', locale: options.locale || 'zh-CN', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web', ...dataCopy(options.hostContext || {})};
  let colorContextPermit = null, layerContextPermit = null, generationContextPermit = null, appReplyPermit = null;
  let colorContextRevision = 0;
  let expanded = false, presentationTracked = false, conversationActive, appReplyStatus=null;
  let closeAttempt = null, closeReady = false;
  const requests = new Map(), csp = cspPolicy(options.csp);
  if (widgetState !== null && !object(widgetState)) throw fault(-32602, 'widget state must be an object');
  function live() {try {return !disposed && !failed && iframe.isConnected !== false && isCurrent() !== false;} catch {return false;}}
  function post(message) {if (!disposed && !failed) iframe.contentWindow?.postMessage({...message, nonce}, '*');}
  function notify(method, params) {post({jsonrpc: '2.0', method, params});}
  function stopTimers() {if (initTimer !== null) window.clearTimeout(initTimer);if (retryTimer !== null) window.clearInterval(retryTimer);initTimer = retryTimer = null;}
  function fail(message) {if (disposed || failed) return;cancelClose('应用加载失败，关闭前保存未完成');failed = true;ready = false;generation++;stopTimers();callbacks.onError?.(message);}
  function sendResource() {
    if (!disposed && !failed && !ready && resource) notify('ui/notifications/sandbox-resource-ready', {nonce, resource: {name: resource[1], version: resource[2]}, csp});
  }
  function timers() {
    stopTimers();initTimer = window.setTimeout(() => fail('timeout'), options.initTimeoutMs ?? 15000);
    retryTimer = window.setInterval(sendResource, 800);
  }
  function toolResultParams() {
    return {content: [{type: 'text', text: typeof toolResult?.summary === 'string' ? toolResult.summary : ''}], structuredContent: dataCopy(toolResult, resourceDataLimit), ...(widgetState ? {_meta: {'tapnow/widgetState': dataCopy(widgetState, widgetStateLimit)}} : {})};
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
    const reject = error => finishRequest(id, {error: {code: Number.isInteger(error.code) ? error.code : -32000, message: error.code ? error.message : 'host action failed',...(error.code==='configuration_required'?{data:{code:'configuration_required',providerDispatched:false}}:{})}}, version, token, needsCurrent);
    try {
      if (!object(params)) throw fault(-32602, 'params must be an object');
      if (method === 'ui/initialize') {
        initialized = true;
        complete({protocolVersion, hostInfo: {name: 'canvas-replica', version: '1.0.0'}, hostCapabilities: {...canMessage ? {message: {text: {}}} : {}, ...canSaveExpressionGuide || canQueryProduction || canFindLibrary || canApplyColor || canApplyLayer || canResizePlatform || canGenerationTools ? {serverTools: {}} : {}, ...canUpdateLibraryContext || canColorContext || canLayerContext || canGenerationContext ? {updateModelContext: {}} : {}}, hostContext: dataCopy(hostContext)});return;
      }
      if (method === 'ping') {complete({});return;}
      if (!ready || !live()) throw fault(-32000, 'app is not ready or current');
      if (method === 'tapnow/estimateGenerationCost' && options.resourceUri === 'ui://tapnow/ecommerce-photoset@v2' && canGenerationTools) {
        const input=strictDataCopy(params,65536);if(!Number.isSafeInteger(input.request_count)||input.request_count<1||input.request_count>32||!Number.isSafeInteger(input.times)||input.times<1||input.times>15)throw fault(-32602,'invalid generation estimate counts');complete({status:'unavailable',reason:'未提供费用估算；提交本地任务后由已配置供应商按实际用量计费',item_count:input.request_count,output_count:input.request_count*input.times});return;
      }
      if (canPrevisReply && method === 'tapnow/getAppReplyRunStatus') {
        const input=strictDataCopy(params,65536);if(Object.keys(input).some(key=>key!=='run_id')||typeof input.run_id!=='string'||!input.run_id||input.run_id.length>180||typeof callbacks.onAppReplyRunStatus!=='function')throw fault(-32602,'invalid app reply run');
        const receipt=await callbacks.onAppReplyRunStatus(input,()=>validGeneration(version,token));if(!validGeneration(version,token))return;
        if(!object(receipt)||!['running','waiting','inactive','unknown'].includes(receipt.status))throw fault(-32000,'invalid actual app reply run status');complete({status:receipt.status});return;
      }
      if (canPrevisReply && method === 'tapnow/validateAppReply') {
        if(typeof callbacks.onValidateAppReply!=='function')throw fault(-32601,'app reply validation is not configured');
        const input=strictDataCopy(params,65536),userAction=iframe.ownerDocument?.activeElement===iframe&&window.navigator.userActivation?.isActive===true;
        const receipt=await callbacks.onValidateAppReply(input,{userAction},()=>validGeneration(version,token));if(!validGeneration(version,token))return;
        if(!object(receipt)||typeof receipt.manifest_revision!=='string')throw fault(-32000,'app reply has no actual manifest revision');
        if(userAction)appReplyPermit={replyId:input.reply_id,payload:JSON.stringify(input.payload),revision:receipt.manifest_revision};complete(strictDataCopy(receipt,65536));return;
      }
      if (method === 'ui/message' && canPrevisReply && params.details !== undefined) {
        const input=strictDataCopy(params,65536);if(input.role!=='user'||!Array.isArray(input.content)||input.content.length||Object.keys(input).some(key=>!['role','content','details'].includes(key)))throw fault(-32602,'invalid structured app reply');
        const details=input.details,gesture=iframe.ownerDocument?.activeElement===iframe&&window.navigator.userActivation?.isActive===true,permit=appReplyPermit;
        if(!object(details)||!gesture&&(!permit||permit.replyId!==details.reply_id||permit.payload!==JSON.stringify(details.payload)||permit.revision!==details.expected_manifest_revision))throw fault(-32000,'a current validated app reply user action is required');
        if(conversationActive===true||sending)throw fault(-32000,'conversation or app action is busy');appReplyPermit=null;sending=true;
        try{const receipt=await callbacks.onAppReply(details,{userAction:true},()=>validGeneration(version,token));if(!validGeneration(version,token))return;if(!object(receipt)||receipt.reply_id!==details.reply_id||typeof receipt.run_id!=='string'||!receipt.run_id||typeof receipt.deduped!=='boolean')throw fault(-32000,'app reply was not durably queued');complete(strictDataCopy(receipt,65536));}
        finally{if(generation===version)sending=false;}return;
      }
      if (method === 'tools/call' && canGenerationTools) {
        const input=strictDataCopy(params,65536);if(Object.keys(input).some(key=>!['name','arguments','_meta'].includes(key))||!generationTools.includes(input.name)||!object(input.arguments))throw fault(-32601,'tool is not supported for this app');
        const lookup=input.name.endsWith('_lookup'),meta=input._meta||{},callId=meta['tapnow/callId'];
        if(!object(meta)||Object.keys(meta).some(key=>!['tapnow/callId','progressToken'].includes(key))||(!lookup||callId!==undefined)&&(typeof callId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(callId))||Object.hasOwn(meta,'progressToken')&&(!Number.isSafeInteger(meta.progressToken)||meta.progressToken<0||meta.progressToken!==id))throw fault(-32602,'invalid scoped generation metadata');
        const userAction=iframe.ownerDocument?.activeElement===iframe&&window.navigator.userActivation?.isActive===true;
        if(!lookup&&(!userAction||conversationActive===true||sending))throw fault(-32000,'a current idle app generation user action is required');
        const isSourceCurrent=()=>validGeneration(version,token)&&(lookup||conversationActive!==true);if(!lookup){sending=true;generationContextPermit=null;}
        try{const receipt=await callbacks.onGenerationAppTool(input.name,input.arguments,{callId,userAction},isSourceCurrent);if(!validGeneration(version,token))return;if(!isSourceCurrent()||!object(receipt)||!Array.isArray(receipt.content)||!object(receipt.structuredContent))throw fault(-32000,'generation action returned no actual receipt');if(canGenerationContext&&userAction)generationContextPermit={callId};complete(strictDataCopy(receipt,resourceDataLimit));}
        finally{if(!lookup&&generation===version)sending=false;}return;
      }
      if (method === 'tools/call' && (canQueryProduction || canFindLibrary)) {
        const input = strictDataCopy(params, 65536), expected = canQueryProduction ? 'get_production_result' : 'find_library_assets';
        if (Object.keys(input).some(key => !['name', 'arguments', '_meta'].includes(key)) || !object(input.arguments)) throw fault(-32602, 'invalid scoped query parameters');
        if (input.name !== expected) throw fault(-32601, 'tool is not supported for this app');
        if (input._meta !== undefined) {
          if (!object(input._meta) || Object.keys(input._meta).some(key => !['tapnow/callId', 'progressToken'].includes(key)) || Object.hasOwn(input._meta, 'tapnow/callId') && (typeof input._meta['tapnow/callId'] !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input._meta['tapnow/callId'])) || Object.hasOwn(input._meta, 'progressToken') && (!Number.isSafeInteger(input._meta.progressToken) || input._meta.progressToken < 0 || input._meta.progressToken !== id)) throw fault(-32602, 'invalid scoped query metadata');
        }
        const userAction = iframe.ownerDocument?.activeElement === iframe && window.navigator.userActivation?.isActive === true;
        const isSourceCurrent = () => validGeneration(version, token);
        // Production polling and saved library browse restoration are reads.
        // The library callback alone can prove that a passive query is a restore.
        const receipt = canQueryProduction ? await callbacks.onProductionProgressQuery(input.arguments, isSourceCurrent) : await callbacks.onLibraryFind(input.arguments, {userAction, restore: !userAction}, isSourceCurrent);
        if (!validGeneration(version, token)) return;
        if (!object(receipt) || !Array.isArray(receipt.content) || !object(receipt.structuredContent)) throw fault(-32000, 'scoped query did not return actual data');
        complete(strictDataCopy(receipt, canQueryProduction ? 16 * 1024 * 1024 : 2 * 1024 * 1024));return;
      }
      if (method === 'ui/update-model-context' || method === 'tapnow/addToCanvas') {
        const callback = method === 'ui/update-model-context' ? canColorContext ? callbacks.onColorAdjustContext : canLayerContext ? callbacks.onLayerComposerContext : canGenerationContext ? callbacks.onGenerationAppContext : canUpdateLibraryContext && callbacks.onLibraryModelContext : canAddLibraryAsset && callbacks.onLibraryAddToCanvas;
        if (!callback) throw fault(-32601, 'library action is not configured for this app');
        if (conversationActive === true || sending) throw fault(-32000, 'conversation or app action is busy');
        const colorContext = method === 'ui/update-model-context' && canColorContext, layerContext = method === 'ui/update-model-context' && canLayerContext, generationContext = method === 'ui/update-model-context' && canGenerationContext;
        if (colorContext ? !colorContextPermit : layerContext ? !layerContextPermit : generationContext ? !generationContextPermit && (iframe.ownerDocument?.activeElement !== iframe || window.navigator.userActivation?.isActive !== true) : iframe.ownerDocument?.activeElement !== iframe || window.navigator.userActivation?.isActive !== true) throw fault(-32000, 'a current user action is required');
        const permit = colorContext ? colorContextPermit : layerContext ? layerContextPermit : generationContext ? generationContextPermit : null;if (colorContext) colorContextPermit = null;if (layerContext) layerContextPermit = null;if (generationContext) generationContextPermit = null;
        const input = strictDataCopy(params, 65536), colorRevision = colorContextRevision, isSourceCurrent = () => validGeneration(version, token) && conversationActive !== true && (!colorContext || colorRevision === colorContextRevision);
        sending = true;
        try {
          const receipt = await callback(input, {userAction: true,...permit ? {callId:permit.callId} : {}}, isSourceCurrent);
          if (!validGeneration(version, token)) return;
          if (!isSourceCurrent() || !object(receipt)) throw fault(-32000, 'library action source is no longer current');
          complete(strictDataCopy(receipt, 65536));
        } catch (error) {
          // A failed context save retries the same successful edit. A later
          // source projection or conversation run must not restore its permit.
          if (colorContext && permit && isSourceCurrent() && colorRevision === colorContextRevision && colorContextPermit === null) colorContextPermit = permit;
          throw error;
        } finally {if (generation === version) sending = false;}
        return;
      }
      if (method === 'tools/call') {
        if (!canSaveExpressionGuide && !canApplyColor && !canApplyLayer && !canResizePlatform) throw fault(-32601, 'tool saving is not configured for this app');
        let input;
        if (canSaveExpressionGuide) input = expressionGuideParams(params, id);
        else {
          const value = strictDataCopy(params, 65536), expected = canApplyColor ? 'color_adjust_apply' : canApplyLayer ? 'layer_composer_apply' : 'resize_for_platform_apply';
          if (Object.keys(value).some(key => !['name','arguments','_meta'].includes(key)) || !object(value.arguments) || !object(value._meta)) throw fault(-32602, 'invalid scoped edit parameters');
          if (value.name !== expected) throw fault(-32601, 'tool is not supported for this app');
          const meta = value._meta, callId = meta['tapnow/callId'];
          if (Object.keys(meta).some(key => !['tapnow/callId','progressToken'].includes(key)) || typeof callId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(callId) || Object.hasOwn(meta,'progressToken') && (!Number.isSafeInteger(meta.progressToken) || meta.progressToken < 0 || meta.progressToken !== id)) throw fault(-32602, 'invalid scoped edit metadata');
          input = {arguments:value.arguments,metadata:{callId,userAction:true}};
        }
        if (conversationActive === true || sending) throw fault(-32000, 'conversation or app action is busy');
        if (iframe.ownerDocument?.activeElement !== iframe || window.navigator.userActivation?.isActive !== true) throw fault(-32000, 'a current user action is required');
        if (canApplyColor) {colorContextPermit = null;colorContextRevision++;}
        const colorApplyRevision = colorContextRevision, isSourceCurrent = () => validGeneration(version, token) && conversationActive !== true && (!canApplyColor || colorApplyRevision === colorContextRevision);
        sending = true;
        try {
          if (canApplyLayer) layerContextPermit = null;
          const receipt = await (canApplyColor ? callbacks.onApplyColorAdjust : canApplyLayer ? callbacks.onApplyLayerComposer : canResizePlatform ? callbacks.onPlatformResizeApply : callbacks.onSaveExpressionGuide)(input.arguments, input.metadata, isSourceCurrent);
          if (!validGeneration(version, token)) return;
          if (!isSourceCurrent()) throw fault(-32000, 'expression guide source is no longer current');
          if (!object(receipt) || !Array.isArray(receipt.content) || !object(receipt.structuredContent)) throw fault(-32000, 'expression guide was not saved');
          const savedReceipt = strictDataCopy(receipt, expressionGuideLimit);
          if (canApplyColor) colorContextPermit = {callId:input.metadata.callId};if (canApplyLayer) layerContextPermit = {callId:input.metadata.callId};
          complete(savedReceipt);
        } finally {if (generation === version) sending = false;}
        return;
      }
      if (method === 'tapnow/setWidgetState') {
        if (!canState) throw fault(-32601, 'widget state persistence is not configured');
        if (!object(params.state)) throw fault(-32602, 'state must be an object');
        const state = dataCopy(params.state, widgetStateLimit);
        const saved = await callbacks.onSetWidgetState(state);
        if (!validGeneration(version, token)) return;
        if (saved === false) throw fault(-32000, 'widget state was not saved');
        widgetState = state;complete({});return;
      }
      if (method === 'ui/message') {
        if (!canMessage) throw fault(-32601, 'message queue is not configured');
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
    if(data.method==='freenow/lifecycleReady'&&canFlushClose&&object(data.params)&&Object.keys(data.params).length===1&&data.params.version===1){closeReady=true;return;}
    if (closeAttempt && !Object.hasOwn(data, 'method') && data.id === closeAttempt.id) {
      const attempt = closeAttempt;
      if (!validGeneration(attempt.version, attempt.token)) {cancelClose('应用所属会话已切换');return;}
      if (attempt.settled) return;
      if (!object(data.result) || Object.keys(data.result).length !== 1 || data.result.flushed !== true || Object.hasOwn(data,'error')) {
        const diagnostic=typeof data.error?.message==='string'?fault(Number.isFinite(data.error.code)?data.error.code:-32000,data.error.message.slice(0,240)):undefined;
        // Local close failures need a retry action; keep SDK details in the cause.
        const message=diagnostic?.message==='应用正在保存或提交，请稍后重试'?diagnostic.message:'最后编辑未能保存，请重试';
        cancelClose(message,diagnostic);return;
      }
      attempt.settled = true;window.clearTimeout(attempt.timer);attempt.resolve(true);return;
    }
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
      sendPresentation();if(appReplyStatus)notify('tapnow/updateData',appReplyStatus);if (conversationActive !== undefined) notify('tapnow/updateData', {conversation_run_active: conversationActive});callbacks.onReady?.();return;
    }
    // Presentation dismissal grants no tool authority and only belongs to the
    // currently focused, expanded frame, including after reload or suspension.
    if (data.method === 'tapnow/presentationDismiss' && ready && expanded && live() && iframe.ownerDocument?.activeElement === iframe && data.params?.reason === 'escape') {callbacks.onDismiss?.();return;}
    if (data.method === 'ui/notifications/size-changed' && ready && Number.isFinite(data.params?.height) && data.params.height > 0) callbacks.onSizeChanged?.(data.params.height);
  }
  function loaded() {
    if (disposed || failed) return;
    if (loadSeen) {cancelClose('应用已重载，关闭前保存未完成');closeReady=false;generation++;nonce = window.crypto.randomUUID();ready = initialized = false;sending = false;lastMessageAt = -Infinity;requests.clear();timers();}
    colorContextRevision++;colorContextPermit = layerContextPermit = generationContextPermit = appReplyPermit = null;loadSeen = true;sendResource();
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
    const nextInput = dataCopy(input ?? {}, 1000000, true), nextResult = result == null ? null : dataCopy(result, resourceDataLimit, true);
    colorContextRevision++;colorContextPermit = layerContextPermit = generationContextPermit = appReplyPermit = null;toolInput = nextInput;toolResult = nextResult;if (revision) projectionRevision = {...revision};
    if (ready) notify('tapnow/updateData', {toolInput, toolResult, ...(revision ? {revision: {...revision}} : {})});return true;
  }
  function updateAppReplyStatus(replyId,status){
    if(options.resourceUri!=='ui://tapnow/previs@v3'||disposed||failed)return false;if(typeof replyId!=='string'||!replyId||!['running','completed','failed','waiting','unknown'].includes(status))throw fault(-32602,'invalid actual app reply status');const next={reply_id:replyId,reply_run_status:status};if(sameJsonValue(next,appReplyStatus))return false;appReplyStatus=next;if(ready)notify('tapnow/updateData',next);return true;
  }
  function updateHostContext(patch) {
    if (disposed || failed) return;if (!object(patch)) throw fault(-32602, 'host context must be an object');
    const next = dataCopy(patch, 65536), changed = Object.keys(next).some(key => !Object.hasOwn(hostContext, key) || !sameJsonValue(hostContext[key], next[key]));
    hostContext = {...hostContext, ...next};if (ready && changed) notify('ui/notifications/host-context-changed', next);
  }
  function updatePresentationState(value) {if (disposed || failed) return;const changed = !presentationTracked || expanded !== !!value;presentationTracked = true;expanded = !!value;if (changed) sendPresentation();}
  function updateConversationRunActive(value) {if (disposed || failed) return;const next = !!value;if (conversationActive === next) return;conversationActive = next;if (next) {colorContextRevision++;colorContextPermit = null;}if (ready) notify('tapnow/updateData', {conversation_run_active: conversationActive});}
  function sendPresentationShortcut(key) {if (!disposed && !failed && ready && expanded && typeof key === 'string' && key.length < 40) notify('tapnow/presentationShortcut', {key});}
  function cancelClose(message = '关闭已取消', cause) {
    const attempt = closeAttempt;if (!attempt) return;closeAttempt = null;window.clearTimeout(attempt.timer);
    notify('freenow/lifecycleResume', {id: attempt.id});if (!attempt.settled) attempt.reject(Object.assign(fault(-32000,message),cause?{cause}:{}));
  }
  function prepareToClose() {
    if (!canFlushClose || !ready && !initialized) return Promise.resolve(true);
    if (!ready || !live()) return Promise.reject(fault(-32000,'应用尚未就绪或所属会话已切换'));
    if (!closeReady) return Promise.reject(fault(-32000,'关闭前保存协议尚未就绪，请重载面板后重试'));
    if (closeAttempt) return closeAttempt.promise;
    const attempt = {id:'local-close-'+window.crypto.randomUUID(),version:generation,token:nonce,settled:false};
    attempt.promise = new Promise((resolve,reject)=>{attempt.resolve=resolve;attempt.reject=reject;});closeAttempt=attempt;
    attempt.timer=window.setTimeout(()=>cancelClose('关闭前保存超时，页面已保留，请重试'),options.closeTimeoutMs??10000);
    post({jsonrpc:'2.0',id:attempt.id,method:'freenow/lifecycleFlush',params:{}});return attempt.promise;
  }
  function dispose() {if (disposed) return;cancelClose('应用已销毁，关闭前保存未完成');disposed = true;colorContextPermit = layerContextPermit = generationContextPermit = appReplyPermit = null;generation++;stopTimers();requests.clear();window.removeEventListener('message', receive);iframe.removeEventListener('load', loaded);}
  return {start, updateData, updateAppReplyStatus, updateHostContext, updatePresentationState, updateConversationRunActive, sendPresentationShortcut, prepareToClose, cancelClose, dispose};
}
