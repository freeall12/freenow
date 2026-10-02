const failure = (code, message) => Object.assign(Error(message), {code});
const interrupted = signal => signal?.reason || new DOMException('分镜结果等待已取消', 'AbortError');
const settled = job => !job.applying && (['failed', 'cancelled', 'configuration_required', 'unknown'].includes(job.status) ||
  job.status === 'succeeded' && (job.applied || job.applicationError || job.recovered));

// video_analyze acknowledges durable dispatch before local application. Only its
// original tasks join this barrier; ordinary generation keeps its async contract.
export async function awaitVideoAnalysisSettlement({pending, results, generationAPI, signal, assertCurrent = () => {}, timeoutMs = 660000}) {
  const calls = new Set(pending.filter(call => call.name === 'video_analyze').map(call => call.callId));
  const receipts = results.filter(entry => calls.has(entry.callId) && typeof entry.result?.taskId === 'string');
  const check = () => {if (signal?.aborted) throw interrupted(signal); assertCurrent();};
  check();
  if (!receipts.length) return;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 660000) throw TypeError('分镜结果等待时限无效');
  if (typeof generationAPI?.getJobs !== 'function' || typeof generationAPI?.subscribe !== 'function') throw TypeError('分镜结果等待缺少任务适配器');
  await new Promise((resolve, reject) => {
    let unsubscribe, timer, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); unsubscribe?.(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(interrupted(signal));
    const inspect = () => {
      if (finished) return;
      try {
        check();
        const jobs = generationAPI.getJobs();
        const owned = receipts.map(({result}) => {
          const job = jobs.find(job => job.id === result.taskId);
          if (!job || job.request?.kind !== 'video.analyze' || result.operationId && job.request?.agentVideoAnalysis?.operationId !== result.operationId) {
            throw failure('analysis_task_unavailable', '原分镜任务身份不可验证，已暂停续轮；请核对原 taskId，不会重新生成');
          }
          return job;
        });
        if (owned.every(settled)) finish();
      } catch (error) {finish(error);}
    };
    signal?.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => finish(failure('analysis_settlement_timeout', '分镜仍在生成或应用，等待已超时；请核对原 taskId，未重新生成')), timeoutMs);
    try {unsubscribe = generationAPI.subscribe(inspect);} catch (error) {finish(error);}
    if (finished) unsubscribe?.(); else inspect();
  });
  check();
}
