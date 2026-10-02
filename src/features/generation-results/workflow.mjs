import {assertResultSnapshot, captureResultSnapshot, planGenerationResults} from './plan.mjs';
import {imageResultCounts} from './counts.mjs';
import {modelFor} from '../image-generation/catalog.mjs';
import {resultProvenance} from '../media-preview/provenance.mjs';

const kinds = new Set(['image.generate', 'video.generate', 'text.generate']);
const aborted = () => Object.assign(new Error('生成任务已取消'), {name: 'AbortError'});

// Capture only the source and its incoming references, before any asynchronous
// asset/request preparation. Canvas movement may continue during preparation.
export function captureSubmission(request, state, mode) {
  if (!kinds.has(request.kind)) return null;
  const node = state.nodes.find(n => n.id === request.nodeId);
  if (!node || node.type !== request.kind.split('.')[0]) throw Error('生成来源不存在或类型不匹配');
  const edges = state.edges.filter(e => e.target === node.id);
  const ids = new Set([node.id, ...edges.map(e => e.source)]);
  const nodes = state.nodes.filter(n => ids.has(n.id) || n.type === 'pile' && n.memberIds?.includes(node.id));
  return {mode, source: structuredClone(node), prompt: request.parameters?.prompt ?? request.prompt ?? node.generation?.prompt ?? '', snapshot: captureResultSnapshot(nodes, edges, node.id)};
}

export function createResultWorkflow(app) {
  const runs = new Map();
  function clear(id) {
    const run = runs.get(id); if (!run) return;
    run.cancelled = true;
    if (run.committed && !run.cleared) {app.clearGenerationResults(id); run.cleared = true;}
  }
  return {
    has: id => runs.has(id),
    clear,
    restore(job) {
      const metadata=job?.request?.parameters?.canvasResults;
      if(!job||typeof job.id!=='string'||!kinds.has(job.request?.kind)||!metadata||metadata.runId!==job.id||job.applied||
        !['queued','running','unknown','succeeded','cancelled','failed','configuration_required'].includes(job.status)||typeof app.restoreGenerationResults!=='function')throw Error('任务不支持恢复到原占位；未应用结果');
      const current=runs.get(job.id);
      if(current&&(current.cancelled||current.cleared))throw Error('结果占位已取消，不能恢复');
      const plan={runId:metadata.runId,kind:job.request.kind,targetNodeIds:structuredClone(metadata.targetNodeIds),requestPlans:structuredClone(metadata.requestPlans)};
      const restored=app.restoreGenerationResults(plan);
      const cleanupOnly=['cancelled','failed','configuration_required'].includes(job.status);
      if(!current)runs.set(job.id,{plan,committed:true,cancelled:cleanupOnly,cleared:false});
      else if(cleanupOnly)current.cancelled=true;
      return restored;
    },
    async prepare(request, {jobId, signal,validateSources=()=>{},acceptSourceReplacements=()=>{}}, submission) {
      validateSources();
      if (!submission || submission.mode === 'variants' && request.kind !== 'text.generate') return request;
      if (signal.aborted) throw aborted();
      const state = app.getState();
      assertResultSnapshot(submission.snapshot, state.nodes, state.edges);
      if (submission.source.pendingOperation) throw Error('节点正在执行其他任务，请等待完成或取消');
      if (request.kind === 'image.generate' && !request.prompt?.trim()) throw Error('请输入图片提示词');
      if (request.kind === 'text.generate' && !request.prompt?.trim() && !request.inputs?.some(input => input.url)) throw Error('请输入提示词或添加参考素材');
      const parameters = request.parameters || {}, model = modelFor(parameters.model || parameters.modelId);
      const imageCounts = request.kind === 'image.generate' ? imageResultCounts({mode: submission.mode, isMidjourney: !!model?.midjourney, currentTimes: parameters.count ?? parameters.times ?? 1}) : null;
      const count = imageCounts?.displayCount ?? Number(parameters.count ?? parameters.times ?? 1);
      if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw Error('生成结果数量无效');
      const sourceNodeSnapshot = {...submission.source, generation: {...submission.source.generation, ...parameters}};
      // The editor's raw prompt retains its references; the prepared request may
      // already contain expanded upstream text or model-specific substitutions.
      sourceNodeSnapshot.generation.prompt = submission.prompt;
      const plan = planGenerationResults({
        nodes: state.nodes, edges: state.edges, sourceNodeId: request.nodeId,
        resultCount: count, resultsPerRequest: imageCounts?.batchSize ?? 1,
        runId: jobId, resultLayout: submission.mode, sourceNodeSnapshot,
        idFactory: () => crypto.randomUUID(),
      });
      const run = {plan, committed: false, cancelled: false, cleared: false};
      runs.set(jobId, run);
      try {
        validateSources();
        const receipt=await app.commitGenerationPlan(plan, {isActive: () => {if(signal.aborted||run.cancelled)return false;validateSources();return true;}});
        run.committed = true;
        if (signal.aborted || run.cancelled) {clear(jobId); throw aborted();}
        acceptSourceReplacements(receipt?.replacements||[]);validateSources();
      } catch (error) {if (!run.committed) runs.delete(jobId);else clear(jobId); throw error;}
      // One provider-neutral task owns an ordered output array. Adapters may
      // fan out requestPlans internally; they must return that same target order.
      return {...request, parameters: {...parameters, ...plan.additionalParameters,
        canvasResults: {runId: jobId, targetNodeIds: plan.targetNodeIds, requestPlans: plan.requestPlans},
      }};
    },
    async apply(job, validateOutputMedia) {
      const run = runs.get(job.id);
      if (!run) return null;
      if (run.cancelled || run.cleared) throw Error('结果占位已取消，请重新生成');
      const type = job.request.kind.split('.')[0], outputs = job.outputs;
      if (outputs.length !== run.plan.targetNodeIds.length || outputs.some(output => output.type !== type)) throw Error('结果数量或类型与生成计划不一致');
      await Promise.all(outputs.map(validateOutputMedia));
      if (run.cancelled || run.cleared) throw Error('结果占位已取消，请重新生成');
      const patches = outputs.map((output, index) => {
        let patch;
        if (type === 'text') patch = {content: output.text, textMode: 'generate'};
        else if (type === 'video') patch = {video: output.video || output.url, ...(output.poster ? {image: output.poster} : {}), videoMetadata: {width: output.width ?? null, height: output.height ?? null, duration: output.duration ?? null}};
        else patch = {image: output.image || output.url, fullImage: output.image || output.url};
        if (type !== 'text') Object.assign(patch, {pixelWidth: output.width, pixelHeight: output.height, currentSourceFileId: output.sourceFileId ?? null}, resultProvenance(job,output));
        return {id: run.plan.targetNodeIds[index], patch};
      });
      return app.applyGenerationResults(job.id, patches);
    },
  };
}
