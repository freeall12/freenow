import {createFinalPlan, isFinalNode, requireDraftSource, resolveDraftReference} from './draft-final.mjs';

const busy = (api, id) => api.getJobs().some(job => job.request.nodeId === id &&
  (['queued', 'running'].includes(job.status) || job.applying));
const submitting = new Set();

function referenceSnapshot(target, state) {
  const resolved = resolveDraftReference(target, state.nodes, state.edges);
  const config = target.generation || target.params || {};
  return {resolved, signature: JSON.stringify({sourceId: resolved.source.id,
    targetConfig: {model: config.model, modelId: config.modelId, draftVideoId: config.draftVideoId, draft: config.draft},
    video: resolved.source.video, sourceFileId: resolved.source.currentSourceFileId,
    parameters: resolved.parameters, media: resolved.draftEstimateMedia,
    edges: state.edges.filter(edge => edge.target === target.id).map(edge => [edge.id, edge.source, edge.target, edge.purpose ?? edge.data?.purpose])})};
}

// Reused by every video submission, including task-tray retries and Agent calls.
// The file identity always comes from the live graph, never from a model's args.
export function prepareDraftFinalRequest(request, app) {
  if (request.kind !== 'video.generate') return {request};
  const state = app.getState(), target = state.nodes.find(node => node.id === request.nodeId);
  const claimsFinal = Object.hasOwn(request.parameters || {}, 'draftVideoId') || Object.hasOwn(request.parameters?.providerParameters || {}, 'draft_video_id');
  if (!isFinalNode(target) && !claimsFinal) return {request};
  if (!isFinalNode(target)) throw Error('正式片必须使用画布中的有效样片引用');
  const {resolved, signature} = referenceSnapshot(target, state);
  const prepared = {...request, prompt: '', inputs: [], parameters: {...request.parameters, ...resolved.parameters}};
  const guard = () => {
    const current = app.getState(), live = current.nodes.find(node => node.id === target.id);
    if (live !== target || !isFinalNode(live) || referenceSnapshot(live, current).signature !== signature)
      throw Error('样片或引用已变化，请重新生成正式片');
  };
  return {request: prepared, guard};
}

export async function submitDraftFinal({sourceId, targetId} = {}, {app = window.CanvasApp, api = window.GenerationAPI} = {}) {
  if (!app || !api) throw Error('画布或生成服务仍在加载');
  if (!sourceId && !targetId) throw Error('请选择样片或正式片节点');
  const key = targetId ? `target:${targetId}` : `source:${sourceId}`;
  if (submitting.has(key)) throw Error('正在提交正式片，请稍候');
  submitting.add(key);
  try {
  let state = app.getState(), target = targetId && state.nodes.find(node => node.id === targetId);
  if (targetId) {
    if (!isFinalNode(target)) throw Error('正式片节点不存在或类型已变化');
    const resolved = resolveDraftReference(target, state.nodes, state.edges);
    if (sourceId && resolved.source.id !== sourceId) throw Error('正式片的样片引用与指定来源不一致');
    sourceId = resolved.source.id;
    if (target.pendingOperation || busy(api, targetId)) throw Error('正式片正在生成，请等待完成或取消任务');
  }
  const source = requireDraftSource(state.nodes.find(node => node.id === sourceId), state.nodes);
  if (source.pendingOperation || busy(api, sourceId)) throw Error('样片正在生成，请等待完成或取消任务');
  if (!target) {
    // The app commits node + edge in one undo boundary, after re-reading the graph.
    target = await app.createDraftFinalNode(source.id);
    state = app.getState();
  }
  const {parameters} = resolveDraftReference(target, state.nodes, state.edges);
  const job = api.submit({kind: 'video.generate', label: '生成正式片', nodeId: target.id, prompt: '', inputs: [], parameters});
  return {nodeId: target.id, sourceId, job};
  } finally {submitting.delete(key);}
}

export {createFinalPlan};
