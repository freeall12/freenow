const validId = value => typeof value === 'string' && value.trim().length > 0;
export function sameBinding(a, b) {
  return !!a && !!b && ['projectId', 'conversationId', 'submissionId'].every(key => validId(a[key]) && a[key] === b[key]);
}

export function beginRun(chat, {projectId, submissionId, now = Date.now()}) {
  if (![projectId, chat.id, submissionId].every(validId)) throw Error('任务身份无效，未发送请求');
  return chat.activeRun = {submissionId, startedAt: now, binding: {projectId, conversationId: chat.id, submissionId}};
}

// An interrupted request may already have changed the canvas or reached the provider.
// Moving its identity out of activeRun unlocks the composer without declaring non-execution.
export function interruptRun(chat, run = chat.activeRun, {reason = '执行中断，等待手动核对', now = Date.now()} = {}) {
  if (!run) return null;
  const key = run.submissionId || run.sessionId || 'legacy-interruption';
  chat.interruptedRuns = Array.isArray(chat.interruptedRuns) ? chat.interruptedRuns : [];
  let record = chat.interruptedRuns.find(item => (item.submissionId || item.sessionId || 'legacy-interruption') === key);
  if (!record) {record = {...run}; chat.interruptedRuns.push(record);}
  // Preserve an already checked summary and first interruption timestamp on repeated hydration.
  Object.assign(record, {...run, interruptedAt: record.interruptedAt || now, interruptionReason: reason});
  if (chat.activeRun === run) delete chat.activeRun;
  return record;
}

export function hydrateChat(chat) {
  let changed = !Array.isArray(chat.queuedMessages);
  chat.queuedMessages = Array.isArray(chat.queuedMessages) ? chat.queuedMessages : [];
  if (chat.queuedMessages.length && chat.queuePauseReason !== '页面已刷新；编辑排队任务后重新发送以继续。') {chat.queuePauseReason = '页面已刷新；编辑排队任务后重新发送以继续。'; changed = true;}
  if (chat.activeRun) {interruptRun(chat, chat.activeRun, {reason: '页面已重新加载，执行状态待核对'}); changed = true;}
  return changed;
}

export function canCheck(record, {projectId, conversationId}) {
  return validId(record?.sessionId) && sameBinding(record.binding, {projectId, conversationId, submissionId: record.submissionId});
}

const childStatuses = new Set(['not_started', 'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'limited', 'skipped', 'unknown', 'blocked']);
function delegationSummary(value, pending) {
  if (value === undefined) return undefined;
  const fail = () => {throw Error('子任务核对响应无效，已保留原中断记录');};
  if (!value || typeof value.callId !== 'string' || !pending.some(call => call.callId === value.callId && call.name === 'agent_delegate') ||
    !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > 6) fail();
  const ids = new Set();
  for (const task of value.tasks) {
    if (!task || typeof task.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(task.taskId) || ids.has(task.taskId) ||
      typeof task.title !== 'string' || !task.title.trim() || task.title.length > 120 || !childStatuses.has(task.status) ||
      typeof task.started !== 'boolean' || !Array.isArray(task.dependsOn) || task.dependsOn.length > 5 ||
      new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.some(id => typeof id !== 'string') ||
      task.error !== undefined && typeof task.error !== 'string') fail();
    ids.add(task.taskId);
  }
  const byId = new Map(value.tasks.map(task => [task.taskId, task]));
  const visiting = new Set(), visited = new Set();
  function visit(task) {
    if (visiting.has(task.taskId)) fail();
    if (visited.has(task.taskId)) return;
    visiting.add(task.taskId);
    for (const id of task.dependsOn) {if (!ids.has(id) || id === task.taskId) fail(); visit(byId.get(id));}
    if (task.blockedBy !== undefined && (!Array.isArray(task.blockedBy) || new Set(task.blockedBy).size !== task.blockedBy.length ||
      task.blockedBy.some(id => !task.dependsOn.includes(id)))) fail();
    if (task.status === 'skipped' && (!task.blockedBy?.length || task.blockedBy.some(id => !['failed', 'cancelled', 'limited', 'skipped'].includes(byId.get(id)?.status)))) fail();
    visiting.delete(task.taskId); visited.add(task.taskId);
  }
  for (const task of value.tasks) visit(task);
  // Store only the public summary. Child inputs, tool arguments and pixel bodies
  // must not leak into conversation storage through an expanded server response.
  return {callId: value.callId, tasks: value.tasks.map(task => ({
    taskId: task.taskId, title: task.title, dependsOn: [...task.dependsOn], status: task.status, started: task.started,
    ...(task.blockedBy ? {blockedBy: [...task.blockedBy]} : {}),
    ...(task.error ? {error: task.error.replace(/\b(?:data:[^\s"'<>)]*|blob:[^\s"'<>)]*)/gi, '[媒体数据已省略]').slice(0, 4000)} : {}),
  }))};
}

export function checkedSummary(record, response) {
  if (!response || response.sessionId !== record.sessionId || !sameBinding(response.binding, record.binding)) throw Error('核对响应与原任务身份不一致，已保留中断记录');
  if (typeof response.status !== 'string' || typeof response.text !== 'string' || !Array.isArray(response.pending)) throw Error('核对响应格式无效，已保留中断记录');
  const delegation = delegationSummary(response.delegation, response.pending);
  return {
    status: response.status, round: Number.isInteger(response.round) ? response.round : null,
    done: response.done === true, restored: response.restored === true,
    canResumeWithReceipts: response.canResumeWithReceipts === true,
    pending: response.pending.map(call => ({callId: String(call.callId || ''), name: String(call.name || '')})),
    text: response.text, ...(typeof response.reason === 'string' ? {reason: response.reason} : {}),
    ...(delegation ? {delegation} : {}),
  };
}

export function describeRecovery(record) {
  const state = record.state, status = state?.status || 'interrupted';
  const labels = {interrupted: '执行状态待核对', planned: '服务端已记录任务', request_in_flight: '模型请求状态待确认', compacting: '上下文整理状态待确认', receipts_saved: '服务端已保存工具回执', waiting_tools: '等待工具回执', completed: '服务端报告完成', cancelled: '服务端报告已取消', failed: '服务端报告执行失败', unknown: '服务端无法确定执行状态', blocked: '服务端恢复受阻'};
  let detail = '核对只读取服务端记录，不会请求模型或重放工具。';
  if (!record.sessionId || !record.binding) detail = '缺少服务端会话或绑定身份，无法核对执行状态。请检查已有结果；不要把这次中断视为未执行。';
  else if (status === 'unknown') detail = '无法确认模型或工具是否已经执行。已保留任务身份，不会自动重发。';
  else if (status === 'waiting_tools') detail = '等待工具回执；核对不会执行这些工具或授予执行权限。';
  else if (status === 'completed') detail = '以下为服务端保存的返回文本；任务完成状态不代表画布产物已保存。';
  else if (status === 'cancelled' || status === 'failed') detail = '已完成的画布修改仍需检查。核对不会撤销或重放工具。';
  else if (status === 'blocked') detail = '服务端暂时无法恢复这次任务。已保留身份，可稍后再次核对。';
  return {status, label: labels[status] || '服务端状态待确认', detail, pendingCount: state?.pending.length || 0};
}

export function describeRecoveryReason(reason) {
  const labels = {
    configuration_changed: '执行配置已变化，服务端无法按原配置继续。',
    delegation_state_not_persisted: '子任务执行记录未完整恢复，服务端暂时无法继续。',
    request_outcome_unknown: '模型请求结果尚未确认；请检查已有结果，不要自动重发。',
    request_not_dispatched: '服务端记录当前模型请求尚未发出；此前已完成的操作仍需检查。',
    configuration_required: '需要补齐执行配置；此前已完成的操作仍需检查。',
    receipt_persistence_failed: '工具回执未能保存，执行结果需要进一步核对。',
    checkpoint_commit_failed: '执行结果未能完整保存，不能据此继续任务。',
  };
  return {text: labels[reason] || '服务端提供了诊断信息，任务身份仍保留，可稍后再次核对。', diagnostic: labels[reason] ? null : reason};
}

export function createRecoveryController({request, isCurrent, persist, changed = () => {}, now = Date.now}) {
  const checking = new WeakSet();
  return {
    isChecking: record => checking.has(record),
    async check(record, scope) {
      if (checking.has(record) || !isCurrent(record, scope) || !canCheck(record, scope)) return false;
      checking.add(record); changed();
      try {
        const response = await request({sessionId: record.sessionId, binding: {...record.binding}});
        if (!isCurrent(record, scope)) return false;
        const summary = checkedSummary(record, response);
        record.state = summary; record.checkedAt = now(); delete record.readError; delete record.saveError;
        try {await persist(); return true;}
        catch (error) {record.saveError = error.message; return false;}
      } catch (error) {
        if (isCurrent(record, scope)) {
          record.readError = error.message;
          try {await persist(); delete record.saveError;}
          catch (failure) {record.saveError = failure.message;}
        }
        return false;
      } finally {
        checking.delete(record); if (isCurrent(record, scope)) changed();
      }
    },
  };
}
