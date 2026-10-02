import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {captureResultSnapshot, assertResultSnapshot} from '../generation-results/plan.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareMediaInputs} from '../agent-attachments/media-inputs.mjs';
import {actorEmotionUri, actorExpressionGuideTool, prepareActorExpressionGuide} from './actor-emotion.mjs';

const kind = 'actor-expression-guide';
const failure = (code, message) => Object.assign(Error(message), {code});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => structuredClone(value);
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const nodeId = ref => {if (typeof ref !== 'string' || !/^node\/[a-zA-Z0-9_-]{1,180}$/.test(ref)) throw failure('invalid_source', '人物情绪来源标识无效');return ref.slice(5);};
const checkAbort = signal => {if (signal?.aborted) throw signal.reason || new DOMException('表情参考保存已取消', 'AbortError');};
const receipt = record => ({node_ref: record.node_ref, guide_sha256: record.guide_sha256, binding: record.binding, face: clone(record.face)});

// Only the host supplies graph identity and persistence. The official iframe can
// submit guide pixels, but cannot choose placement, node IDs, or generation tools.
export function createActorGuideRuntime({app, localAssets, store, getProjectId, persistConversation,
  fetchImpl = (...args) => fetch(...args), decodeImage, preparePreviews = prepareMediaInputs, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url)} = {}) {
  for (const [name, fn] of Object.entries({'app.getState': app?.getState, 'app.createConnected': app?.createConnected, 'LocalAssets.put': localAssets?.put, 'LocalAssets.url': localAssets?.url, 'store.save': store?.save, getProjectId, persistConversation})) if (typeof fn !== 'function') throw TypeError(name + ' adapter is required');
  const resolver = createWorkflowMediaResolver({localAssets});
  decodeImage ??= (url, options) => resolver({id: 'actor-expression-guide', type: 'image', image: url}, options);
  const operations = new Map(), preparations = new WeakMap();
  const state = () => app.getState();
  function capture(data, {trace, chat, isCurrent}) {
    if (!data || typeof isCurrent !== 'function' || !chat?.id || !trace?.id) throw failure('invalid_source', '缺少人物情绪宿主来源');
    const scope = {projectId: getProjectId(), chatId: chat.id, traceId: trace.id};
    const sourceNodeId = nodeId(data.source.node_ref), refs = data.actor.reference_nodes.map(item => nodeId(item.node_ref));
    const source = state().nodes.find(node => node.id === sourceNodeId);
    if (source?.type !== data.mode || !(source.type === 'image' ? source.fullImage || source.image : source.video) || refs.some(id => state().nodes.find(node => node.id === id)?.type !== 'image')) throw failure('invalid_source', '情绪来源须为当前图片/视频，人物参考须为真实图片节点');
    const ids = [...new Set([sourceNodeId, ...refs])], binding = trace.result.actorSourceContext;
    if (binding && (binding.projectId !== scope.projectId || !Array.isArray(binding.sourceSnapshots) || !same(binding.sourceSnapshots.map(item => item.sourceNodeId), ids))) throw failure('invalid_source', '人物情绪原始来源绑定与当前画布不符');
    const sourceSnapshots = binding ? clone(binding.sourceSnapshots) : ids.map(id => captureResultSnapshot(state().nodes, state().edges, id));
    function guard(signal) {
      checkAbort(signal);
      if (!isCurrent() || getProjectId() !== scope.projectId) throw failure('stale_actor_app', '人物情绪应用所属画布或会话已切换');
      for (const snapshot of sourceSnapshots) assertResultSnapshot(snapshot, state().nodes, state().edges);return true;
    }
    function validateNode(record) {
      const node = state().nodes.find(item => item.id === nodeId(record?.node_ref));
      const p = node?.provenance;
      if (!node || node.type !== 'image' || !p || p.kind !== kind || !same(p.scope, scope) || !same(p.sourceSnapshots, sourceSnapshots) || !same(p.guide, record) || node.fullImage !== p.outputMedia || node.image !== p.outputMedia || !p.outputMedia?.startsWith('asset:')) throw failure('guide_changed', '已保存表情参考或其来源已变化，请重新采用');
      return node;
    }
    async function validateGuideCurrent(record, {signal} = {}) {
      guard(signal);const node = validateNode(record), asset = node.fullImage;
      const url = await localAssets.url(asset);guard(signal);validateNode(record);
      const response = await fetchImpl(url, {signal});guard(signal);
      if (!response?.ok) throw failure('asset_unavailable', '表情参考本地素材无法读取');
      const blob = await response.blob();guard(signal);
      if (!blob.size || blob.size > 120 * 1024 || blob.type.split(';')[0] !== record.mime) throw failure('guide_changed', '表情参考本地素材类型或容量不符');
      if (await hash(await blob.arrayBuffer()) !== record.guide_sha256) throw failure('guide_changed', '表情参考实际字节与保存回执不符');
      await decode(blob, signal);guard(signal);validateNode(record);return receipt(record);
    }
    guard();return {guard, sourceNodeId, sourceSnapshots, scope, readGuide: () => trace.actorExpressionGuide || null, validateGuideCurrent};
  }
  async function decode(blob, signal) {
    const url = createObjectURL(blob);
    try {const actual = await decodeImage(url, {signal});checkAbort(signal);if (actual?.width !== 512 || actual?.height !== 512) throw failure('invalid_dimensions', '表情参考实际解码须为512×512');}
    finally {revokeObjectURL(url);}
  }
  async function save(args, trace, chat, {callId, signal, isCurrent, sourceContext} = {}) {
    const context = sourceContext;
    if (!context || typeof isCurrent !== 'function') throw failure('invalid_source', '缺少人物情绪来源保护');
    const savedState = trace.appState, data = trace.result.response;
    const current = () => {context.guard(signal);if (!isCurrent()) throw failure('stale_actor_app', '人物情绪应用已失效');if (trace.appState !== savedState || trace.result.response !== data) throw failure('state_changed', '人物情绪已保存状态发生变化');};
    current();
    const prepared = await prepareActorExpressionGuide({name: actorExpressionGuideTool, arguments: args, _meta: {'tapnow/callId': callId}}, data, savedState);current();
    if (trace.appState !== savedState || trace.result.response !== data) throw failure('state_changed', '人物情绪已保存状态发生变化');
    const scopeKey = JSON.stringify(context.scope), key = JSON.stringify([context.scope, callId]), fingerprint = JSON.stringify(prepared.record);
    const previousOperation = operations.get(key);
    if (previousOperation && previousOperation.fingerprint !== fingerprint) throw failure('operation_conflict', '相同表情参考调用不能更换内容');
    if (previousOperation?.pending) return previousOperation.pending;
    if (previousOperation?.node && !state().nodes.includes(previousOperation.node)) throw failure('guide_changed', '表情参考已删除或撤销，不会自动重建');
    const equivalent = [...operations.values()].find(operation => operation.scopeKey === scopeKey && operation.fingerprint === fingerprint && operation.pending);
    if (equivalent) {operations.set(key, equivalent);return equivalent.pending;}
    const op = previousOperation || {fingerprint, scopeKey};operations.set(key, op);
    op.pending = apply().finally(() => {delete op.pending;});return op.pending;
    async function apply() {
      const matches = state().nodes.filter(node => node.provenance?.kind === kind && same(node.provenance.scope, context.scope) && (node.provenance.callId === callId || node.provenance.requestFingerprint === fingerprint));
      if (matches.length > 1) throw failure('ambiguous_operation', '同一表情参考调用有多个结果');
      let node = matches[0] || op.node, record;
      if (node) {
        if (node.provenance?.requestFingerprint !== fingerprint) throw failure('operation_conflict', '已有表情参考调用内容不同');
        record = node.provenance.guide;await context.validateGuideCurrent(record, {signal});current();
      } else {
        const blob = new Blob([prepared.bytes], {type: prepared.mime});await decode(blob, signal);current();
        const asset = await localAssets.put(blob);current();
        if (typeof asset !== 'string' || !asset.startsWith('asset:')) throw failure('asset_save_failed', '表情参考未写入本地素材存储');
        // createConnected is the existing graph/undo commit. Once visible, always
        // persist it even if its iframe closes; cancellation cannot erase it.
        const patch = {type: 'image', title: '人物表情参考', image: asset, fullImage: asset, width: 320, height: 320, pixelWidth: 512, pixelHeight: 512,
          provenance: {kind, callId, scope: clone(context.scope), sourceSnapshots: clone(context.sourceSnapshots), requestFingerprint: fingerprint, outputMedia: asset}};
        const added = app.createConnected(context.sourceNodeId, [patch]);
        node = added?.[0];if (!node?.id || added.length !== 1 || !state().nodes.includes(node)) throw failure('apply_failed', '表情参考节点创建失败');
        record = {...prepared.record, node_ref: 'node/' + node.id};node.provenance.guide = clone(record);op.node = node;
      }
      op.node = node;
      if (await store.save() === false) throw failure('save_failed', '表情参考已添加，但画布保存失败');
      await store.flush?.();current();
      const previous = trace.actorExpressionGuide;trace.actorExpressionGuide = clone(record);
      try {await persistConversation();current();await context.validateGuideCurrent(record, {signal});current();}
      catch (error) {
        if (trace.actorExpressionGuide?.node_ref === record.node_ref) {if (previous === undefined) delete trace.actorExpressionGuide;else trace.actorExpressionGuide = previous;}
        try {await persistConversation();} catch (rollbackError) {throw failure('conversation_rollback_failed', '表情参考会话记录保存失败，撤销记录也未能保存：' + rollbackError.message);}
        throw error;
      }
      return receipt(record);
    }
  }
  async function prepareAppArgs(args, {signal, isCurrent = () => true} = {}) {
    if (args.resource_uri !== actorEmotionUri) return args;
    const data = args.data, refs = data?.actor?.reference_nodes;
    if (!['image', 'video'].includes(data?.mode) || data?.source?.media_kind !== data.mode || !Array.isArray(refs) || refs.length < 1 || refs.length > 4) throw failure('invalid_source', '人物情绪须提供来源及1至4张人物参考');
    const ids = refs.map(item => nodeId(item.node_ref));
    if (new Set(ids).size !== ids.length) throw failure('invalid_source', '人物参考节点不能重复');
    const sourceId = nodeId(data.source.node_ref), source = state().nodes.find(node => node.id === sourceId);
    if (source?.type !== data.mode || !(source.type === 'image' ? source.fullImage || source.image : source.video)) throw failure('invalid_source', '人物情绪来源媒体类型不符');
    const nodes = ids.map(id => state().nodes.find(node => node.id === id));
    if (nodes.some(node => node?.type !== 'image' || !(node.fullImage || node.image))) throw failure('invalid_source', '人物参考须为当前有真实图片的节点');
    const snapshots = [...new Set([sourceId, ...ids])].map(id => captureResultSnapshot(state().nodes, state().edges, id)), projectId = getProjectId();
    const guard = () => {checkAbort(signal);if (!isCurrent() || getProjectId() !== projectId) throw failure('stale_actor_app', '人物情绪预览所属画布或会话已切换');for (const snapshot of snapshots) assertResultSnapshot(snapshot, state().nodes, state().edges);};
    guard();
    const images = await preparePreviews(nodes.map(node => ({name: node.id, type: 'image', asset: node.fullImage || node.image})), {signal, resolveUrl: async asset => {
      guard();const url = isGenerationMediaRef(asset) ? asset : await localAssets.url(asset);guard();
      if (typeof url !== 'string' || !(/^(?:https?:|blob:|data:image\/(?:png|jpeg|webp);base64,)/.test(url) || isGenerationMediaRef(url))) throw failure('preview_unavailable', '人物参考素材没有可读取的真实图片地址');
      return url;
    }});
    guard();
    if (images.length !== refs.length) throw failure('preview_unavailable', '人物参考没有返回对应真实预览');
    const actualRefs = refs.map((item, index) => {
      const image = images[index];
      if (image.name !== ids[index] || typeof image.imageUrl !== 'string' || image.imageUrl.length > 500000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.imageUrl)) throw failure('preview_unavailable', '人物参考实际预览无效或过大');
      // preview_url is derived from node pixels; caller-supplied URLs are discarded.
      return {node_ref: item.node_ref, preview_url: image.imageUrl};
    });
    const prepared = {...clone(args), data: {...clone(data), actor: {...clone(data.actor), reference_nodes: actualRefs}}};
    preparations.set(prepared, {projectId, sourceSnapshots: clone(snapshots)});return prepared;
  }
  function bindPreparedResult(result, args) {
    if (args.resource_uri !== actorEmotionUri) return result;
    const binding = preparations.get(args);
    if (!binding || binding.projectId !== getProjectId()) throw failure('invalid_source', '人物情绪展示缺少原始真实来源绑定');
    for (const snapshot of binding.sourceSnapshots) assertResultSnapshot(snapshot, state().nodes, state().edges);
    // Top-level host metadata is persisted in the trace; only response enters the iframe.
    return {...result, actorSourceContext: clone(binding)};
  }
  return {capture, save, prepareAppArgs, bindPreparedResult};
}
