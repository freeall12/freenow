import {failureSignature} from './error-state.mjs';

// Receipts bind an error to the still-owned node before terminal cleanup removes
// its run markers. They are session-only and never become a canvas history edit.
export function captureFailureReceipts({job, app, original, planned = false}) {
  if (job.status !== 'failed' || !job.providerDispatched || !job.error ||
      !['image.generate', 'video.generate', 'video.depth', 'text.generate'].includes(job.request?.kind)) return [];
  const type = job.request.kind.split('.')[0];
  if (planned) return app.getGenerationFailureTargets(job.id).filter(node => node?.type === type)
    .map(node => ({node, signature: failureSignature(node)}));
  if (!original) return [];
  const node = app.getState().nodes.find(node => node.id === job.request.nodeId);
  if (node?.type !== type || node !== original.node || failureSignature(node) !== failureSignature(original.snapshot)) return [];
  return [{node, signature: failureSignature(node)}];
}
