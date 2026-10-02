// A retry gets a new task identity. Resolve the job from the current dispatch
// context rather than capturing the original job in the saved readiness hook.
export function createHistoryDispatchGate({ready, getJob, captureOptions = () => ({})}) {
  const originals = new WeakMap();
  return function withHistory(options = {}) {
    const previous = originals.has(options.beforeDispatchReady) ? originals.get(options.beforeDispatchReady) : options.beforeDispatchReady;
    const beforeDispatchReady = async context => {
      const check = () => {if (context.signal?.aborted) throw context.signal.reason || new DOMException('Aborted', 'AbortError');};
      check();
      await previous?.(context);
      check();
      const history = await ready();
      check();
      const job = getJob(context.jobId);
      if (!job || job.id !== context.jobId) throw Error('生成任务身份已失效，未提交供应商');
      await history.captureSubmission(job, captureOptions(job));
      check();
    };
    originals.set(beforeDispatchReady, previous);
    return {...options, beforeDispatchReady};
  };
}
