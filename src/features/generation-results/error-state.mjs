const kinds = new Set(['image.generate', 'video.generate', 'video.depth', 'text.generate']);
const ignoredFields = new Set(['x', 'y', 'selected', 'pendingOperation', 'generationRun', 'generationRecovery']);

// Terminal cleanup deletes the durable run baseline alongside its transient
// markers. Content, size, title and model/reference changes invalidate the
// receipt even after task cleanup.
export function failureSignature(node) {
  const value = Object.fromEntries(Object.entries(node).filter(([key]) => !ignoredFields.has(key)));
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/** Caller must first validate the run's ownership/content guard, before clear. */
export function captureFailureTargets(nodes) {
  return nodes.filter(node => node && kinds.has(`${node.type}.generate`))
    .map(node => ({node, signature: failureSignature(node)}));
}

export function isGenerationFailure(job) {
  return kinds.has(job.request?.kind) && job.status === 'failed' && job.providerDispatched === true &&
    typeof job.error === 'string' && !!job.error.trim() && !job.applicationError;
}

const receiptKey = (job, receipt) => JSON.stringify([job.id, receipt.node.id, receipt.signature, job.error]);
const targetIds = job => [job.request.nodeId, ...(job.request.parameters?.canvasResults?.targetNodeIds || [])];

/** Session-only display state. Never changes jobs, canvas, history, or taskInfo. */
export function createFailureState() {
  const dismissed = new Set(), invalidated = new Set();
  let keys = new WeakMap();
  function keyFor(job, receipt) {
    const cached = keys.get(receipt);
    if (cached && cached.jobId === job.id && cached.nodeId === receipt.node.id &&
        cached.signature === receipt.signature && cached.error === job.error) return cached.key;
    const key = receiptKey(job, receipt);
    keys.set(receipt, {jobId: job.id, nodeId: receipt.node.id, signature: receipt.signature, error: job.error, key});
    return key;
  }
  return {
    dismiss(key) {dismissed.add(key);},
    clear() {dismissed.clear(); invalidated.clear(); keys = new WeakMap();},
    collect(state, jobs) {
      const result = new Map();
      let nodes, latest;
      for (let index = 0; index < jobs.length; index++) {
        const job = jobs[index];
        if (!isGenerationFailure(job) || !Array.isArray(job.nodeFailures) || !job.nodeFailures.length) continue;
        for (const receipt of job.nodeFailures) {
          if (!receipt?.node || typeof receipt.signature !== 'string' || receipt.node.type !== job.request.kind.split('.')[0]) continue;
          const key = keyFor(job, receipt);
          if (dismissed.has(key) || invalidated.has(key)) continue;
          // Dismissed and permanently superseded receipts need no canvas scan.
          nodes ||= new Map(state.nodes.map(node => [node.id, node]));
          if (!latest) {
            latest = new Map();
            jobs.forEach((item, order) => {
              if (kinds.has(item.request?.kind)) for (const id of targetIds(item)) latest.set(id, order);
            });
          }
          const node = nodes.get(receipt.node.id);
          const newer = latest.get(receipt.node.id) > index;
          if (newer || node !== receipt.node || failureSignature(node) !== receipt.signature ||
              node.generationRun?.runId && node.generationRun.runId !== job.id ||
              node.pendingOperation && node.pendingOperation !== job.request.kind) {
            invalidated.add(key); continue;
          }
          result.set(node.id, {key, node, jobId: job.id, message: job.error});
        }
      }
      return result;
    },
  };
}
