const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => { throw Object.assign(Error(message), {code}); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const signature = value => typeof value === 'string' && value.length > 0 && value.length <= 1048576;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const unique = values => Array.isArray(values) && values.every(id) && new Set(values).size === values.length;
const equalSet = (a, b) => unique(a) && unique(b) && a.length === b.length && a.every(value => b.includes(value));
const states = new Set(['pending', 'submitted', 'unknown', 'failed', 'applying', 'applied']);
const terminalFailures = new Set(['failed', 'cancelled', 'configuration_required']);
const canonical = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export async function fingerprint(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function recordKey(projectId) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) fail('project_invalid', '工作流项目标识无效');
  return 'agent-workflow-runs:' + projectId;
}
function validatePlan(plan, members) {
  if (!object(plan) || !Array.isArray(plan.layers) || !plan.layers.length || plan.layers.length > 10000 || !plan.layers.every(layer => unique(layer) && layer.length) || !unique(plan.executable) || !plan.executable.length || !equalSet(plan.layers.flat(), members) || !plan.executable.every(node => members.includes(node))) fail('journal_invalid', '工作流计划或成员记录无效');
}
function validateVersions(versions, members) {
  if (!object(versions) || !Object.keys(versions).every(id) || !Object.values(versions).every(signature) || !members.every(node => signature(versions[node]))) fail('journal_invalid', '工作流来源版本记录无效');
}
function validateRun(run, projectId) {
  if (!object(run) || run.version !== 1 || run.projectId !== projectId || !id(run.runId) || !id(run.groupId) || !id(run.ownerId) || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || typeof run.stopping !== 'boolean' || !Number.isFinite(run.createdAt) || !Number.isFinite(run.updatedAt) || !unique(run.members) || run.members.length > 10000) fail('journal_invalid', '工作流执行记录无效');
  validatePlan(run.plan, run.members); validateVersions(run.versions, run.members);
  if (!object(run.tasks) || !equalSet(Object.keys(run.tasks), run.plan.executable)) fail('journal_invalid', '工作流任务集合无效');
  const taskIds = new Set();
  for (const [nodeId, task] of Object.entries(run.tasks)) {
    if (!object(task) || task.nodeId !== nodeId || !states.has(task.state)) fail('journal_invalid', '工作流任务状态无效');
    if (task.state === 'pending') { if (task.taskId !== undefined || task.application !== undefined) fail('journal_invalid', '未提交节点不能包含任务回执'); continue; }
    if (!id(task.taskId) || taskIds.has(task.taskId) || !digest(task.requestVersion) || !Number.isFinite(task.createdAt) || !['image.generate', 'video.generate', 'audio.generate', 'text.generate'].includes(task.kind)) fail('journal_invalid', '原任务身份或请求版本无效');
    taskIds.add(task.taskId);
    if (task.transportRequestVersion !== undefined && !digest(task.transportRequestVersion)) fail('journal_invalid', '原派发请求版本无效');
    if (task.application !== undefined || ['applying', 'applied'].includes(task.state)) {
      const receipt = task.application;
      if (!digest(task.transportRequestVersion) || !object(receipt) || !signature(receipt.beforeVersion) || !signature(receipt.afterVersion) || !digest(receipt.resultVersion) || !digest(receipt.proposalVersion) || !object(receipt.proposedNode) || receipt.proposedNode.id !== nodeId || receipt.proposedNode.type + '.generate' !== task.kind || receipt.createdAt !== task.createdAt) fail('journal_invalid', '原位应用收据无效');
      if (task.state === 'applied' && run.versions[nodeId] !== receipt.afterVersion) fail('journal_invalid', '完成节点与保存版本不符');
    }
  }
  // Later submitted layers are only legal after every executable predecessor applied.
  let blocked = false;
  for (const layer of run.plan.layers) {
    const tasks = layer.filter(node => run.tasks[node]).map(node => run.tasks[node]);
    if (blocked && tasks.some(task => task.state !== 'pending')) fail('journal_invalid', '工作流跨层任务回执不符合依赖顺序');
    if (tasks.some(task => task.state !== 'applied')) blocked = true;
  }
  return run;
}
function validateEnvelope(value, projectId) {
  if (value === undefined || value === null) return {version: 1, projectId, revision: 0, storageRevision: 0, runs: []};
  if (!object(value) || value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.storageRevision) || value.storageRevision < 0 || !Array.isArray(value.runs) || value.runs.length > 100 || new Set(value.runs.map(run => run?.runId)).size !== value.runs.length) fail('journal_invalid', '工作流恢复记录版本无效，原记录未修改');
  value.runs.forEach(run => validateRun(run, projectId));
  const tasks = value.runs.flatMap(run => Object.values(run.tasks)).map(task => task.taskId).filter(Boolean);
  if (new Set(tasks).size !== tasks.length) fail('journal_invalid', '原任务被多个执行记录重复占用');
  return clone(value);
}
export async function readWorkflowRuns(store, projectId) {
  return validateEnvelope(await store.readRecord(recordKey(projectId)), projectId).runs;
}
export function validateContext(run, context, {allowApplying = false} = {}) {
  if (!object(context) || context.projectId !== run.projectId || context.groupId !== run.groupId || !equalSet(context.members, run.members) || !object(context.versions) || !equalSet(Object.keys(context.versions), Object.keys(run.versions))) fail('source_changed', '工作流项目、分组、成员或来源集合已变化');
  for (const [nodeId, version] of Object.entries(run.versions)) {
    const task = run.tasks[nodeId];
    if (context.versions[nodeId] !== version && !(allowApplying && task?.application && task.state !== 'applied' && context.versions[nodeId] === task.application.afterVersion)) fail('source_changed', '节点或参考内容已更改，旧工作流未继续');
  }
  return true;
}
export function continuation(run, context) {
  try { validateContext(run, context); } catch (error) { return {ok: false, reason: error.message, code: error.code, nextLayer: null}; }
  if (run.stopping) return {ok: false, reason: '工作流已停止；已提交任务可以查询，未提交节点不能继续', nextLayer: null};
  const tasks = Object.values(run.tasks);
  if (tasks.some(task => task.state === 'failed')) return {ok: false, reason: '执行失败，后续层已阻断', nextLayer: null};
  if (tasks.some(task => !['pending', 'applied'].includes(task.state))) return {ok: false, reason: '原任务或结果保存状态尚待确认，请先查询恢复', nextLayer: null};
  const nextLayer = run.plan.layers.findIndex(layer => layer.some(node => run.tasks[node]?.state === 'pending'));
  return nextLayer < 0 ? {ok: false, reason: '工作流已完成', nextLayer: null} : {ok: true, reason: '', nextLayer};
}
function requestBinding(run, nodeId, job) {
  const request = job?.request, binding = request?.parameters?.workflowRecovery;
  if (!id(job?.id) || !object(binding) || canonical(binding) !== canonical({version: 1, projectId: run.projectId, runId: run.runId, groupId: run.groupId, nodeId}) || request.nodeId !== nodeId || request.workflowId !== run.groupId || request.parameters.count !== 1 || !['image.generate', 'video.generate', 'audio.generate', 'text.generate'].includes(request.kind)) fail('task_identity_invalid', '原工作流任务或请求身份不符');
}
export function createWorkflowJournal({store, projectId, isCurrent = () => true, locks = globalThis.navigator?.locks, ownerId = globalThis.crypto.randomUUID(), now = Date.now} = {}) {
  const key = recordKey(projectId);
  if (!store?.readRecord || !store?.writeRecord || !id(ownerId)) fail('storage_unavailable', '工作流恢复需要可事务提交的记录存储');
  let data, opened = false, closed = false, owned = false, release, lockCompletion, queue = Promise.resolve(), persistenceError = null;
  const stopLatches = new Set();
  const active = () => opened && owned && !closed && isCurrent() === true && !persistenceError;
  const check = guard => { if (!active()) fail('ownership_lost', persistenceError?.message || '恢复页面已关闭、项目已切换或其他页面正在执行'); if (guard?.() === false) fail('source_changed', '工作流来源已变化'); if (!active()) fail('ownership_lost', '工作流执行权限已变化'); };
  const find = (snapshot, runId) => { const run = snapshot?.runs.find(item => item.runId === runId); if (!run) fail('run_missing', '原工作流执行记录不存在'); return run; };
  const ownedRun = (snapshot, runId) => { const run = find(snapshot, runId); if (run.ownerId !== ownerId) fail('claim_required', '请先明确接管原工作流记录'); return run; };
  function mutate(transform, guard) {
    const operation = queue.then(async () => {
      check(guard); const snapshot = clone(data), expectedRevision = data.storageRevision;
      const value = transform(snapshot); snapshot.revision++; snapshot.runs.forEach(run => validateRun(run, projectId));
      try {
        const receipt = await store.writeRecord(key, snapshot, {expectedRevision, canCommit: () => { check(guard); return true; }});
        snapshot.storageRevision = Number.isSafeInteger(receipt?.storageRevision) ? receipt.storageRevision : expectedRevision + 1;
        if (snapshot.storageRevision !== expectedRevision + 1) fail('journal_revision_invalid', '恢复事务返回的版本无效');
        data = snapshot;
      } catch (error) { persistenceError = error; throw error; }
      // A commit can succeed just as navigation revokes dispatch permission.
      check(guard); return clone(value);
    });
    queue = operation.catch(() => {}); return operation;
  }
  const taskOf = (run, nodeId) => { if (!Object.hasOwn(run.tasks, nodeId)) fail('node_missing', '节点不属于原工作流计划'); return run.tasks[nodeId]; };
  const touch = run => { run.updatedAt = now(); };
  const api = {
    get writable() { return active(); }, get persistenceError() { return persistenceError; },
    assertActive(runId, {dispatch = false, nodeId, taskId} = {}) { check(); const run = ownedRun(data, runId); const registered = taskId && run.tasks[nodeId]?.taskId === taskId; if (dispatch && !registered && (run.stopping || stopLatches.has(runId))) fail('run_stopped', '工作流已停止，新任务未发送'); return true; },
    async open() {
      if (opened || closed) fail('journal_closed', '恢复控制器不能重复打开');
      if (!locks?.request) fail('lock_unavailable', '当前浏览器缺少工作流跨页面执行锁，请使用支持 Web Locks 的浏览器');
      let ready, reject; const acquired = new Promise((resolve, fail) => { ready = resolve; reject = fail; });
      lockCompletion = locks.request(key, {mode: 'exclusive', ifAvailable: true}, async lock => {
        if (!lock || closed) { reject(Object.assign(Error('另一页面正在执行或恢复此项目'), {code: 'lock_busy'})); return; }
        owned = true; ready(); await new Promise(resolve => { release = resolve; }); owned = false;
      });
      lockCompletion.catch(reject);
      try { await acquired; if (closed || isCurrent() !== true) fail('ownership_lost', '项目已变化'); data = validateEnvelope(await store.readRecord(key), projectId); if (closed || isCurrent() !== true) fail('ownership_lost', '项目已变化'); opened = true; return api.list(); }
      catch (error) { api.close(); throw error; }
    },
    list() { return clone(data?.runs || []); },
    get(runId) { return clone(find(data, runId)); },
    create(input, guard) {
      return mutate(snapshot => {
        if (!id(input?.runId) || !id(input.groupId) || snapshot.runs.some(run => run.runId === input.runId)) fail('run_identity_invalid', '工作流执行标识无效或重复');
        if (snapshot.runs.length >= 100) fail('journal_full', '恢复记录已满，请先处理保留的执行记录');
        if (snapshot.runs.some(run => Object.values(run.tasks).some(task => !['pending', 'applied', 'failed'].includes(task.state)) || !run.stopping && Object.values(run.tasks).some(task => task.state === 'pending') && !Object.values(run.tasks).some(task => task.state === 'failed'))) fail('run_unresolved', '项目仍有原工作流待确认，请先查询或停止');
        const run = {version: 1, runId: input.runId, projectId, groupId: input.groupId, ownerId, epoch: 1, createdAt: now(), updatedAt: now(), stopping: false, plan: clone(input.plan), members: clone(input.members), versions: clone(input.versions), tasks: Object.fromEntries(input.plan.executable.map(nodeId => [nodeId, {nodeId, state: 'pending'}]))};
        validateRun(run, projectId); snapshot.runs.push(run); return run;
      }, guard);
    },
    claim(runId, guard) { return mutate(snapshot => { const run = find(snapshot, runId); run.ownerId = ownerId; run.epoch++; touch(run); if (run.stopping) stopLatches.add(runId); return run; }, guard); },
    async submitted(runId, nodeId, job, guard) {
      const run = api.get(runId); requestBinding(run, nodeId, job); const requestVersion = await fingerprint(job.request); check(guard);
      return mutate(snapshot => {
        const current = ownedRun(snapshot, runId), task = taskOf(current, nodeId);
        const layer = current.plan.layers.findIndex(nodes => nodes.includes(nodeId));
        if (current.plan.layers.slice(0, layer).flat().some(node => current.tasks[node] && current.tasks[node].state !== 'applied')) fail('layer_blocked', '前一层结果尚未全部保存');
        if (task.state !== 'pending') { if (task.taskId === job.id && task.requestVersion === requestVersion) return task; fail('duplicate_dispatch', '原节点已登记任务，不能再次提交'); }
        if (current.stopping || stopLatches.has(runId)) fail('run_stopped', '工作流已停止，新任务未发送');
        if (snapshot.runs.some(item => Object.values(item.tasks).some(other => other.taskId === job.id))) fail('duplicate_task', '任务已属于另一个工作流节点');
        if (!Number.isFinite(job.createdAt)) fail('task_identity_invalid', '原任务创建时间缺失');
        Object.assign(task, {state: 'submitted', taskId: job.id, kind: job.request.kind, createdAt: job.createdAt, requestVersion}); touch(current); return task;
      }, guard);
    },
    async prepared(runId, nodeId, job, guard) {
      requestBinding(api.get(runId), nodeId, job); const transportRequestVersion = await fingerprint(job.request); check(guard);
      return mutate(snapshot => { const run = ownedRun(snapshot, runId), task = taskOf(run, nodeId); if (task.taskId !== job.id || task.state !== 'submitted' || task.kind !== job.request.kind || task.transportRequestVersion && task.transportRequestVersion !== transportRequestVersion) fail('task_identity_invalid', '派发请求与原任务记录不符'); task.transportRequestVersion = transportRequestVersion; touch(run); return task; }, guard);
    },
    async preparingApplication(runId, nodeId, receipt, guard) {
      const proposedNode = clone(receipt?.proposedNode);
      const proposalVersion = await fingerprint(proposedNode); check(guard);
      return mutate(snapshot => {
        const run = ownedRun(snapshot, runId), task = taskOf(run, nodeId);
        if (task.taskId !== receipt?.taskId || !digest(task.transportRequestVersion) || !['submitted', 'unknown', 'applying'].includes(task.state) || receipt.beforeVersion !== run.versions[nodeId] || !signature(receipt.afterVersion) || !digest(receipt.resultVersion) || !object(proposedNode) || proposedNode.id !== nodeId || proposedNode.type + '.generate' !== task.kind || receipt.createdAt !== task.createdAt) fail('application_invalid', '原位结果应用意图与原节点版本不符');
        const application = {beforeVersion: receipt.beforeVersion, afterVersion: receipt.afterVersion, resultVersion: receipt.resultVersion, proposedNode, proposalVersion, createdAt: task.createdAt};
        if (task.application && canonical(task.application) !== canonical(application)) fail('application_changed', '原任务已有不同应用意图，不能重复覆盖');
        task.application = application; task.state = 'applying'; touch(run); return task;
      }, guard);
    },
    applied(runId, nodeId, receipt, guard) {
      return mutate(snapshot => {
        const run = ownedRun(snapshot, runId), task = taskOf(run, nodeId), application = task.application;
        if (task.taskId !== receipt?.taskId || !application || application.afterVersion !== receipt.afterVersion || application.resultVersion !== receipt.resultVersion || !['applying', 'unknown', 'applied'].includes(task.state)) fail('application_invalid', '结果保存收据与原任务不符');
        task.state = 'applied'; delete task.error; run.versions[nodeId] = receipt.afterVersion; touch(run); return task;
      }, guard);
    },
    settled(runId, nodeId, status, error, guard) {
      return mutate(snapshot => { const run = ownedRun(snapshot, runId), task = taskOf(run, nodeId); if (task.state === 'pending' || task.state === 'applied') fail('task_state_invalid', '未提交或已完成节点不能改为待确认'); task.state = terminalFailures.has(status) ? 'failed' : 'unknown'; task.error = String(error || (task.state === 'unknown' ? '原任务状态待确认' : '原任务执行失败')).slice(0, 2000); touch(run); return task; }, guard);
    },
    stop(runId, guard) { stopLatches.add(runId); return mutate(snapshot => { const run = ownedRun(snapshot, runId); run.stopping = true; touch(run); return run; }, guard); },
    canContinue(runId, context) { const run = api.get(runId); if (stopLatches.has(runId)) run.stopping = true; return continuation(run, context); },
    async reconcile(runId, {context, query, apply, guard} = {}) {
      check(guard); const initial = api.get(runId); if (initial.ownerId !== ownerId) fail('claim_required', '请先接管原工作流记录');
      if (typeof context !== 'function' || typeof query !== 'function' || typeof apply !== 'function') fail('adapter_invalid', '恢复查询和原位应用适配器缺失');
      const recoveryGuard = () => { check(guard); validateContext(api.get(runId), context(), {allowApplying: true}); return true; };
      recoveryGuard(); const results = [];
      for (const layer of initial.plan.layers) {
        const settled = await Promise.allSettled(layer.filter(nodeId => initial.tasks[nodeId] && !['pending', 'applied', 'failed'].includes(initial.tasks[nodeId].state)).map(async nodeId => {
          let task = taskOf(api.get(runId), nodeId);
          try {
            recoveryGuard(); const remote = await query(task.taskId); recoveryGuard();
            const job = {...remote, request: clone(remote?.request), outputs: clone(remote?.outputs)};
            const run = api.get(runId); task = taskOf(run, nodeId); requestBinding(run, nodeId, job);
            if (job.id !== task.taskId || !digest(task.transportRequestVersion) || await fingerprint(job.request) !== task.transportRequestVersion) fail('task_identity_invalid', '查询结果缺少可验证的原派发请求');
            recoveryGuard();
            if (job.status !== 'succeeded') { await api.settled(runId, nodeId, job.status, job.error, recoveryGuard); return {nodeId, status: terminalFailures.has(job.status) ? 'failed' : 'unknown'}; }
            if (!Array.isArray(job.outputs) || job.outputs.length !== 1 || job.outputs[0]?.type + '.generate' !== task.kind) fail('result_invalid', '恢复结果必须为一个与原节点类型匹配的输出');
            const resultVersion = await fingerprint(job.outputs); recoveryGuard();
            if (task.application && task.application.resultVersion !== resultVersion) fail('result_changed', '原任务结果版本与已保存应用意图不符');
            if (task.application && await fingerprint(task.application.proposedNode) !== task.application.proposalVersion) fail('proposal_changed', '原位应用提案内容与保存版本不符');
            recoveryGuard();
            const receipt = await apply(job, {run: api.get(runId), node: clone(task), application: clone(task.application), resultVersion});
            recoveryGuard();
            if (receipt?.taskId !== task.taskId || receipt.resultVersion !== resultVersion) fail('application_invalid', '恢复应用未返回原结果保存收据');
            await api.applied(runId, nodeId, receipt, recoveryGuard); return {nodeId, status: 'applied'};
          } catch (error) {
            if (persistenceError || !active()) throw error;
            // Query failures never imply a task was not submitted; retain the original ID.
            await api.settled(runId, nodeId, 'unknown', error.message, recoveryGuard); return {nodeId, status: 'unknown', error: error.message};
          }
        }));
        for (const result of settled) { if (result.status === 'fulfilled') results.push(result.value); else throw result.reason; }
      }
      return {run: api.get(runId), results, continuation: api.canContinue(runId, context())};
    },
    async flush() { let pending; do { pending = queue; await pending; } while (pending !== queue); if (persistenceError) throw persistenceError; },
    close() { closed = true; owned = false; release?.(); },
  };
  return api;
}
