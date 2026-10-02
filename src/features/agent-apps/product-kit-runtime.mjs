import {captureResultSnapshot, assertResultSnapshot} from '../generation-results/plan.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareMediaInputs} from '../agent-attachments/media-inputs.mjs';
import {productKitUri, productKitLimits as limits, prepareProductKit, validateProductKitState, resolveProductKitReply} from './product-kit.mjs';
const clone = value => structuredClone(value);
const failure = (code, message) => Object.assign(Error(message), {code});
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const abort = signal => {if (signal?.aborted) throw signal.reason || failure('cancelled', 'Product Kit 读取已取消');};
const nodeId = ref => {if (typeof ref !== 'string' || !/^node\/[A-Za-z0-9_-]{1,180}$/.test(ref)) throw failure('invalid_source', '产品素材须提供真实 node_ref');return ref.slice(5);};
function wait(promise, signal, disposeLate) {
  abort(signal);return new Promise((resolve, reject) => {const cancel = () => reject(signal.reason);signal.addEventListener('abort', cancel, {once: true});Promise.resolve(promise).then(value => {signal.removeEventListener('abort', cancel);if (signal.aborted) {try {disposeLate?.(value);} catch {}reject(signal.reason);return;}resolve(value);}, error => {signal.removeEventListener('abort', cancel);reject(error);});});
}
export async function renderProductKitThumbnail(blob, {signal} = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const resolve = createWorkflowMediaResolver(), actual = await resolve({id: 'product-kit-source', type: 'image', image: url}, {signal});
    if (actual.width > 8192 || actual.height > 8192 || actual.width * actual.height > 16 * 1024 * 1024) throw failure('image_dimensions', '真实产品图片尺寸超过本地解码限制');
    const frames = await prepareMediaInputs([{name: 'product', type: 'image', asset: url}], {signal, resolveUrl: async () => url});
    abort(signal);if (frames.length !== 1) throw failure('invalid_preview', '产品图片未返回实际缩略图');
    return {width: actual.width, height: actual.height, data_uri: frames[0].imageUrl};
  } finally {URL.revokeObjectURL(url);}
}
// Read-only: no canvas mutation, fake product records, job submission or output creation.
export function createProductKitRuntime({app, localAssets, getProjectId, fetchImpl = (...args) => fetch(...args), renderImage = renderProductKitThumbnail, timeoutMs = limits.timeoutMs} = {}) {
  for (const [name, fn] of Object.entries({'app.getState': app?.getState, 'localAssets.url': localAssets?.url, getProjectId, renderImage})) if (typeof fn !== 'function') throw TypeError(name + ' adapter is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > limits.timeoutMs) throw TypeError('Product Kit timeout must be 1..30000ms');
  const preparations = new WeakMap(), graph = () => app.getState();
  function source(ref) {const node = graph().nodes.find(item => item.id === nodeId(ref));if (node?.type !== 'image' || !(node.fullImage || node.image)) throw failure('invalid_source', 'Product Kit 来源须为当前真实本地图片节点');return node;}
  async function bounded(signal, operation) {
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason), timer = setTimeout(() => controller.abort(failure('media_timeout', '产品素材读取或解码超时')), timeoutMs);
    if (signal?.aborted) cancel();else signal?.addEventListener('abort', cancel, {once: true});
    try {return await wait(operation(controller.signal), controller.signal);} finally {clearTimeout(timer);signal?.removeEventListener('abort', cancel);}
  }
  async function read(ref, signal, guard) {
    guard();abort(signal);const node = source(ref), media = node.fullImage || node.image;
    if (typeof media !== 'string' || !/^(?:asset:|blob:|data:image\/(?:png|jpeg|webp);base64,)/.test(media)) throw failure('nonlocal_source', '产品素材仅接受真实本地 asset/data/blob 图片，不能访问原站或远程示例');
    const url = media.startsWith('asset:') ? await wait(localAssets.url(media), signal) : media;guard();abort(signal);
    if (typeof url !== 'string' || !/^(?:blob:|data:image\/(?:png|jpeg|webp);base64,)/.test(url)) throw failure('nonlocal_source', '本地产品素材解析结果必须是 data/blob');
    if (url.startsWith('data:') && url.length > Math.ceil(limits.sourceBytes * 4 / 3) + 64) throw failure('media_limit', '产品源图超过8MiB');
    let reader, body;
    try {
      const response = await wait(fetchImpl(url, {signal}), signal, late => {Promise.resolve(late?.body?.cancel?.()).catch(() => {});});body = response?.body;if (body?.getReader) reader = body.getReader();guard();abort(signal);
      if (!response?.ok) throw failure('media_unavailable', '真实产品素材读取失败');
      const length = Number(response.headers?.get('content-length'));if (Number.isFinite(length) && length > limits.sourceBytes) throw failure('media_limit', '产品源图声明超过8MiB');
      const mime = response.headers?.get('content-type')?.split(';')[0];if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw failure('media_type', '真实产品素材须为 PNG/JPEG/WebP');
      let bytes;
      if (reader) {
        const chunks = [];let total = 0;
        for (;;) {const item = await wait(reader.read(), signal);guard();abort(signal);if (item.done) break;total += item.value.byteLength;if (total > limits.sourceBytes) throw failure('media_limit', '产品源图实际字节超过8MiB');chunks.push(item.value);}
        bytes = new Uint8Array(total);let offset = 0;for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.length;}
      } else {throw failure('unbounded_media', '产品源图读取须提供可限额的字节流');}
      guard();abort(signal);if (!bytes.length) throw failure('media_unavailable', '真实产品素材为空');
      const sha256 = await hash(bytes);guard();abort(signal);return {blob: new Blob([bytes], {type: mime}), sha256};
    } catch (error) {try {if (reader) Promise.resolve(reader.cancel()).catch(() => {});else Promise.resolve(body?.cancel?.()).catch(() => {});} catch {}throw error;}
    finally {try {reader?.releaseLock();} catch {}}
  }
  async function prepareAppArgs(args, {signal, isCurrent = () => true} = {}) {
    if (args.resource_uri !== productKitUri) return args;
    const {node_ref, ...data} = args.data || {};nodeId(node_ref);
    if (!data.product || Object.hasOwn(data.product, 'thumbnail_url')) throw failure('invalid_input', '产品缩略图由宿主读取，Agent 不得提供 thumbnail_url');
    const node = source(node_ref), sourceSnapshot = captureResultSnapshot(graph().nodes, graph().edges, node.id), projectId = getProjectId();
    const guard = () => {abort(signal);if (!isCurrent() || getProjectId() !== projectId) throw failure('stale_product_app', '产品素材所属画布或会话已切换');assertResultSnapshot(sourceSnapshot, graph().nodes, graph().edges);};
    guard();return bounded(signal, async activeSignal => {
      const actual = await read(node_ref, activeSignal, guard), image = await wait(renderImage(actual.blob, {signal: activeSignal}), activeSignal);guard();
      if (!Number.isSafeInteger(image?.width) || !Number.isSafeInteger(image?.height) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 16 * 1024 * 1024) throw failure('image_dimensions', '产品源图实际解码尺寸无效');
      const prepared = {...clone(args), data: {...clone(data), product: {...clone(data.product), thumbnail_url: image.data_uri}}}, canonical = prepareProductKit(prepared.data, args.title);
      // Bind the response and its real pixel source outside the iframe payload.
      const binding = {projectId, node_ref, sourceSnapshot: clone(sourceSnapshot), source_sha256: actual.sha256, width: image.width, height: image.height, responseFingerprint: JSON.stringify(canonical)};
      preparations.set(prepared, binding);return prepared;
    });
  }
  function bindPreparedResult(result, args) {
    if (args.resource_uri !== productKitUri) return result;const binding = preparations.get(args);
    if (!binding || binding.projectId !== getProjectId() || JSON.stringify(result.response) !== binding.responseFingerprint) throw failure('invalid_source', 'Product Kit 缺少原始真实来源绑定或缩略图已变化');
    assertResultSnapshot(binding.sourceSnapshot, graph().nodes, graph().edges);return {...result, productKitSourceContext: clone(binding)};
  }
  function capture(data, {trace, chat, isCurrent} = {}) {
    const binding = trace?.result?.productKitSourceContext;
    if (typeof isCurrent !== 'function' || !chat?.id || !trace?.id || !binding || binding.projectId !== getProjectId() || JSON.stringify(data) !== binding.responseFingerprint || binding.sourceSnapshot?.sourceNodeId !== nodeId(binding.node_ref) || !/^[a-f0-9]{64}$/.test(binding.source_sha256)) throw failure('invalid_source', 'Product Kit 缺少当前真实来源或会话绑定');
    const scope = {projectId: getProjectId(), chatId: chat.id, traceId: trace.id}, lifetime = new AbortController();
    const guard = signal => {abort(lifetime.signal);abort(signal);if (!isCurrent() || getProjectId() !== scope.projectId || trace.result.response !== data || JSON.stringify(data) !== binding.responseFingerprint) throw failure('stale_product_app', 'Product Kit 卡片、素材或所属会话已变化');assertResultSnapshot(binding.sourceSnapshot, graph().nodes, graph().edges);return true;};
    async function validateSourceCurrent({signal} = {}) {
      signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;guard(signal);
      return bounded(signal, async activeSignal => {const actual = await read(binding.node_ref, activeSignal, () => guard(activeSignal));if (actual.sha256 !== binding.source_sha256) throw failure('source_changed', '产品素材同一地址的实际字节已变化，请重新打开');guard(activeSignal);return {node_ref: binding.node_ref, source_sha256: actual.sha256, width: binding.width, height: binding.height};});
    }
    async function reply(message, savedState = trace.appState) {
      guard();const stateIdentity = trace.appState, stateFingerprint = JSON.stringify(savedState);if (savedState !== stateIdentity) throw failure('state_changed', 'Product Kit 确认状态须为当前实际已保存状态');
      const checkState = () => {guard();if (trace.appState !== stateIdentity || JSON.stringify(trace.appState) !== stateFingerprint) throw failure('state_changed', 'Product Kit 核验期间保存状态已变化');};
      const source = await validateSourceCurrent();checkState();
      const result = await resolveProductKitReply(message, data, savedState);checkState();
      // Same Kit from a different actual product source must not deduplicate.
      const sourceDigest = await hash(new TextEncoder().encode(JSON.stringify({handoffId: result.metadata.handoffId, projectId: scope.projectId, ...source})));checkState();
      const text = result.text + '\n真实本地产品来源：' + JSON.stringify(source);if (text.length > limits.messageChars) throw failure('handoff_limit', 'Product Kit 真实来源交接超过允许长度');
      return {...result, text, metadata: {...result.metadata, handoffId: 'product_kit_' + sourceDigest}, result: {...result.result, source}};
    }
    guard();return {scope, binding: clone(binding), guard, validateSourceCurrent, reply, validateState: value => {guard();return validateProductKitState(value, data);}, dispose: () => lifetime.abort(failure('cancelled', 'Product Kit 页面已关闭')), isCurrent: () => {try {return guard();} catch {return false;}}};
  }
  return {prepareAppArgs, bindPreparedResult, capture};
}
