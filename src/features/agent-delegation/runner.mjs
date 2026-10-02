const READ_ONLY = new Set(['web_search', 'world_read', 'canvas_read', 'canvas_read_node', 'subjects_list', 'subjects_read', 'canvas_inspect_media', 'scene_read', 'scene_library',
  'scene_motion_read', 'skills_list', 'skills_read', 'artifacts_list', 'artifacts_read', 'conversation_read', 'generation_status']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped']);
const SERVER_TERMINAL = new Set([...TERMINAL, 'limited']);
const abortError = () => new DOMException('委派已取消', 'AbortError');
const safeText = value => String(value ?? '').replace(/\b(?:data:[^\s"'<>)]*|blob:[^\s"'<>)]*)/gi, '[media body omitted]');
const errorText = error => safeText(error?.message || error || '子任务失败').slice(0, 4000);
const checkAbort = signal => {if (signal.aborted) throw abortError();};

function validateGraph(tasks) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 6 || tasks.some(task => !task ||
    typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(task.id) ||
    typeof task.title !== 'string' || !task.title.trim() || task.title.length > 120 ||
    typeof task.instructions !== 'string' || !task.instructions.trim() || task.instructions.length > 8000 ||
    task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.length > 5 ||
      task.dependsOn.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) ||
      new Set(task.dependsOn).size !== task.dependsOn.length))) throw Error('子任务委派参数无效');
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length || tasks.some(task => task.dependsOn?.some(id => id === task.id || !byId.has(id)))) {
    throw Error('子任务依赖标识缺失、自引用或重复');
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error('子任务依赖不能形成循环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn || []) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}
const sameIds = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  new Set(actual).size === actual.length && actual.every(id => expected.includes(id));

function abortable(run, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => {signal.removeEventListener('abort', aborted); reject(abortError());};
    signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve().then(() => {checkAbort(signal); return run();}).then(
      result => {signal.removeEventListener('abort', aborted); signal.aborted ? reject(abortError()) : resolve(result);},
      error => {signal.removeEventListener('abort', aborted); reject(error);},
    );
  });
}

export async function runDelegation({sessionId, callId, tasks, signal, request, execute, prepareResults = results => results,
  onChange = () => {}, allowedTools = globalThis.AgentTools?.delegationTools || []}) {
  if (typeof sessionId !== 'string' || !sessionId || typeof callId !== 'string' || !callId ||
    typeof request !== 'function' || typeof execute !== 'function' || !Array.isArray(allowedTools)) {
    throw Error('子任务委派参数无效');
  }
  // Validate every node and edge before creating a trace or sending any request.
  validateGraph(tasks);
  // The caller's shared registry can narrow this set, never grant a mutation or
  // another delegation. execute still validates each allowed tool's schema.
  const allowed = new Set(allowedTools.filter(name => READ_ONLY.has(name)));
  const controller = new AbortController(), localSignal = controller.signal;
  const rows = tasks.map(task => ({taskId: task.id, title: safeText(task.title), dependsOn: [...task.dependsOn || []],
    status: task.dependsOn?.length ? 'blocked' : 'queued', round: 0, text: '', calls: []}));
  const byId = new Map(rows.map(row => [row.taskId, row]));
  const confirmed = new Map();
  let publishError;
  const snapshot = () => rows.map(row => ({...row, dependsOn: [...row.dependsOn], ...(row.blockedBy ? {blockedBy: [...row.blockedBy]} : {}),
    calls: row.calls.map(call => ({...call, callId: safeText(call.callId)}))}));
  function publish() {
    if (publishError) return;
    try {onChange(snapshot());} catch (error) {publishError = error; controller.abort();}
  }
  function cancelPending() {
    for (const row of rows) if (!TERMINAL.has(row.status)) {
      row.status = 'cancelled'; row.error = '委派已取消';
      for (const call of row.calls) if (!TERMINAL.has(call.status)) call.status = 'cancelled';
    }
    publish();
  }
  const abort = () => controller.abort();
  localSignal.addEventListener('abort', cancelPending, {once: true});
  signal?.addEventListener('abort', abort, {once: true});
  if (signal?.aborted) abort();
  const send = (action, taskId, extra = {}) => abortable(() => request(action,
    {sessionId, callId, ...(taskId === undefined ? {} : {taskId}), ...extra}, localSignal), localSignal);

  async function runTask(row) {
    const seen = new Set(); let responseCount = 0, childSessionId, stateRead = false;
    async function requestReceipt(action, extra) {
      try {return await send(action, row.taskId, extra);}
      catch (error) {
        if (localSignal.aborted || error?.name === 'AbortError' || stateRead) throw error;
        stateRead = true;
        // Read an existing receipt once; never repeat a model request or tools
        // from a round whose continuation may already have been consumed.
        try {
          const current = await send('delegated-state', row.taskId);
          if (current?.taskId === row.taskId && (SERVER_TERMINAL.has(current.status) ||
            current.status === 'waiting' && current.started === true && current.response?.round > row.round)) return current;
        } catch (readError) {
          if (localSignal.aborted || readError?.name === 'AbortError') throw readError;
        }
        throw error;
      }
    }
    try {
      checkAbort(localSignal); row.status = 'running'; publish();
      let envelope = await requestReceipt('delegated-start');
      for (;;) {
        checkAbort(localSignal);
        if (!envelope || envelope.taskId !== row.taskId) throw Error('子任务响应标识不匹配');
        const response = envelope.response;
        if (typeof response?.text === 'string' && response.text) row.text = safeText(response.text);
        if (SERVER_TERMINAL.has(envelope.status)) {
          if (!sameIds(envelope.dependsOn ?? [], row.dependsOn)) throw Error('子任务响应依赖不匹配');
          if (envelope.status === 'skipped') {
            if (!Array.isArray(envelope.blockedBy) || !envelope.blockedBy.length ||
              new Set(envelope.blockedBy).size !== envelope.blockedBy.length ||
              envelope.blockedBy.some(id => !row.dependsOn.includes(id) || !confirmed.has(id) || confirmed.get(id) === 'completed') ||
              envelope.response !== undefined) {
              throw Error('子任务跳过回执无效');
            }
            row.blockedBy = [...envelope.blockedBy];
          }
          confirmed.set(row.taskId, envelope.status);
          row.status = envelope.status === 'limited' ? 'failed' : envelope.status;
          if (envelope.status !== 'completed') row.error = errorText(envelope.error || envelope.reason ||
            (envelope.status === 'limited' ? '子任务达到轮次上限，未完成' : envelope.status === 'cancelled' ? '子任务已取消' : '子任务失败'));
          if (envelope.status === 'limited') row.reason = 'limited';
          publish(); return;
        }
        if (!['running', 'waiting'].includes(envelope.status) || !response || typeof response.done !== 'boolean' ||
          !Array.isArray(response.calls) || !Number.isInteger(response.round) || response.round < 1 || response.round > 6 ||
          response.round <= row.round || ++responseCount > 6 || response.done || response.calls.length > 24 || !response.calls.length ||
          typeof response.sessionId !== 'string' || !response.sessionId || childSessionId && childSessionId !== response.sessionId) {
          throw Error('子任务响应或轮次无效');
        }
        childSessionId = response.sessionId; row.round = response.round;
        const roundIds = new Set();
        for (const call of response.calls) {
          if (typeof call?.callId !== 'string' || !call.callId.trim() || seen.has(call.callId) || roundIds.has(call.callId)) throw Error('子任务工具调用标识为空或重复');
          if (!allowed.has(call.name) || call.mutates === true) throw Error(`子任务不允许调用工具：${safeText(call.name)}`);
          roundIds.add(call.callId);
        }
        for (const id of roundIds) seen.add(id);
        row.status = 'running';
        const calls = response.calls.map(call => ({callId: call.callId, name: call.name, status: 'waiting'}));
        row.calls.push(...calls); publish();
        const results = [], visualBudget = {remaining: 700000};
        for (const [index, call] of response.calls.entries()) {
          checkAbort(localSignal); const trace = calls[index]; trace.status = 'running'; publish();
          try {
            const result = await abortable(() => execute(call.name, call.args, {signal: localSignal, visualBudget}), localSignal);
            results.push({callId: call.callId, result}); trace.status = 'completed';
          } catch (error) {
            if (localSignal.aborted || error?.name === 'AbortError') throw error;
            trace.status = 'failed'; trace.error = errorText(error); results.push({callId: call.callId, result: {error: trace.error}});
          }
          publish();
        }
        row.status = 'waiting'; publish();
        // Pixels exist only in this transient continuation envelope. Snapshots
        // contain no result bodies, arguments or media inputs.
        const prepared = await abortable(() => prepareResults(results), localSignal);
        envelope = await requestReceipt('delegated-continue', {results: prepared});
      }
    } catch (error) {
      if (error?.name === 'AbortError' && !localSignal.aborted) controller.abort();
      row.status = localSignal.aborted || error?.name === 'AbortError' ? 'cancelled' : 'unknown';
      row.error = errorText(error);
      for (const call of row.calls) if (!TERMINAL.has(call.status)) {call.status = row.status; call.error = row.error;}
      publish();
    }
  }
  async function schedule() {
    const queued = new Set(rows), active = new Map();
    while ((queued.size || active.size) && !localSignal.aborted) {
      for (const row of queued) {
        if (active.size >= 2) break;
        if (!row.dependsOn.every(id => confirmed.has(id))) continue;
        queued.delete(row);
        // Failed prerequisites still go through start: only the server can
        // confirm a skipped terminal row; the browser never invents that result.
        const work = runTask(row).finally(() => active.delete(row));
        active.set(row, work);
      }
      if (active.size) await Promise.race(active.values());
      // A lost receipt is a local error, not proof of prerequisite failure.
      // Leave descendants blocked and ask for the canonical aggregate once.
      else if (queued.size) break;
    }
    await Promise.all(active.values());
  }
  function reconcileAggregate(aggregate) {
    if (!aggregate || !Array.isArray(aggregate.tasks) || aggregate.tasks.length !== rows.length) throw Error('委派聚合任务列表不匹配');
    const received = new Set();
    for (const task of aggregate.tasks) {
      if (!task || !byId.has(task.taskId) || received.has(task.taskId) ||
        !SERVER_TERMINAL.has(task.status) ||
        !sameIds(task.dependsOn ?? [], byId.get(task.taskId).dependsOn) ||
        task.error !== undefined && typeof task.error !== 'string' ||
        task.response !== undefined && (!task.response || typeof task.response !== 'object' || Array.isArray(task.response) ||
          typeof task.response.text !== 'string' || Object.keys(task.response).some(key => key !== 'text'))) {
        throw Error('委派聚合含无效任务或非终态结果');
      }
      received.add(task.taskId);
    }
    const canonical = new Map(aggregate.tasks.map(task => [task.taskId, task]));
    for (const task of aggregate.tasks) {
      const dependencies = byId.get(task.taskId).dependsOn;
      if (task.status === 'skipped') {
        if (!Array.isArray(task.blockedBy) || !task.blockedBy.length || new Set(task.blockedBy).size !== task.blockedBy.length ||
          task.blockedBy.some(id => !dependencies.includes(id) || canonical.get(id).status === 'completed') || task.response !== undefined) {
          throw Error('委派聚合跳过状态与依赖终态不一致');
        }
      } else if (task.blockedBy !== undefined || task.status !== 'cancelled' && dependencies.some(id => canonical.get(id).status !== 'completed')) {
        throw Error('委派聚合任务与依赖终态不一致');
      }
      const observed = byId.get(task.taskId);
      if (observed.status === 'skipped' && (task.status !== 'skipped' || !sameIds(task.blockedBy, observed.blockedBy))) {
        throw Error('委派聚合与服务器跳过回执不一致');
      }
    }
    const completed = aggregate.tasks.filter(task => task.status === 'completed').length;
    const status = completed === rows.length ? 'completed' : completed ? 'partial_failure' :
      aggregate.tasks.every(task => ['cancelled', 'skipped'].includes(task.status)) ? 'cancelled' : 'failed';
    if (aggregate.status !== status) throw Error('委派聚合状态与任务终态不一致');
    // A continuation can finish server-side even when its response is lost.
    // Reconcile only after validating the entire canonical batch; local call
    // traces remain evidence of what this browser actually executed.
    for (const task of aggregate.tasks) {
      const row = byId.get(task.taskId);
      row.status = task.status === 'limited' ? 'failed' : task.status;
      row.text = safeText(task.response?.text || '');
      delete row.error; delete row.reason; delete row.blockedBy;
      if (task.status === 'skipped') row.blockedBy = [...task.blockedBy];
      if (task.status !== 'completed') row.error = errorText(task.error ||
        (task.status === 'limited' ? '子任务达到轮次上限，未完成' : task.status === 'cancelled' ? '子任务已取消' : '子任务失败'));
      if (task.status === 'limited') row.reason = 'limited';
    }
    publish();
    if (publishError) throw publishError;
    checkAbort(localSignal);
    return aggregate;
  }
  try {
    publish(); if (publishError) throw publishError; checkAbort(localSignal);
    await schedule();
    if (publishError) throw publishError;
    checkAbort(localSignal);
    // Only the server can declare the batch settled. A lost start/continue reply
    // may leave it pending: never retry provider work or fabricate an aggregate.
    try {return reconcileAggregate(await send('delegated-result'));}
    catch (error) {
      if (localSignal.aborted || error?.name === 'AbortError') throw error;
      throw Object.assign(Error(`委派聚合未确认，不能报告完成：${errorText(error)}`), {code: 'delegation_incomplete', cause: error});
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    localSignal.removeEventListener('abort', cancelPending);
  }
}
