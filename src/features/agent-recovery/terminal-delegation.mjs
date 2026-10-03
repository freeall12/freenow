import {canCheck, sameBinding} from './model.mjs';

const terminal = new Set(['completed', 'failed', 'cancelled', 'limited', 'skipped']);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code, message) => {throw Object.assign(Error(message), {code});};

function terminalTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 6) return false;
  const ids = new Set(tasks.map(task => task?.taskId));
  if (ids.size !== tasks.length) return false;
  if (!tasks.every(task => task && typeof task.taskId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(task.taskId) &&
    typeof task.title === 'string' && task.title.trim() && task.title.length <= 120 && terminal.has(task.status) &&
    Array.isArray(task.dependsOn) && new Set(task.dependsOn).size === task.dependsOn.length &&
    task.dependsOn.every(id => id !== task.taskId && ids.has(id)))) return false;
  const byId = new Map(tasks.map(task => [task.taskId, task])), visiting = new Set(), visited = new Set();
  function visit(task) {
    if (visiting.has(task.taskId)) return false;
    if (visited.has(task.taskId)) return true;
    visiting.add(task.taskId);
    if (!task.dependsOn.every(id => visit(byId.get(id)))) return false;
    if (task.blockedBy !== undefined && (!Array.isArray(task.blockedBy) || new Set(task.blockedBy).size !== task.blockedBy.length || task.blockedBy.some(id => !task.dependsOn.includes(id) || byId.get(id).status === 'completed'))) return false;
    if (task.status === 'skipped' && !task.blockedBy?.length) return false;
    visiting.delete(task.taskId); visited.add(task.taskId); return true;
  }
  return tasks.every(visit);
}

// This permits reading a complete server receipt, never executing a child or
// constructing a result from the status summary's missing response bodies.
export function terminalDelegationEligibility(record, scope) {
  const state = record?.state, journal = record?.journal;
  if (!canCheck(record, scope) || state?.status !== 'waiting_tools' || state.done || !state.canResumeWithReceipts ||
    !journal || journal.version !== 1 || !sameBinding(journal.binding, record.binding) || journal.submission?.id !== record.submissionId ||
    !digest(journal.sourceVersion) || !digest(journal.submissionHash) || journal.receipts ||
    !['tools_pending', 'tools_partial'].includes(journal.phase) || journal.round !== state.round ||
    !Array.isArray(state.pending) || state.pending.length !== 1 || !Array.isArray(journal.pending) || journal.pending.length !== 1 ||
    !Array.isArray(journal.seenCallIds)) return {allowed: false, reason: '缺少匹配的原父调用记录，不能补造委派回执。'};
  const call = journal.pending[0], pending = state.pending[0], delegation = state.delegation;
  if (call?.name !== 'agent_delegate' || pending?.name !== call.name || !call.callId || pending.callId !== call.callId ||
    !journal.seenCallIds.includes(call.callId) || delegation?.callId !== call.callId) return {allowed: false, reason: '委派父调用身份或轮次不匹配，不能恢复回执。'};
  if (!terminalTasks(delegation.tasks)) return {allowed: false, reason: '子任务尚未全部结束或存在未知结果；只核对状态，不重发子任务。'};
  return {allowed: true, reason: '子任务已全部结束；继续前只读取服务端完整结果并保存原父回执，不重新执行子任务。', callId: call.callId};
}

function validateAggregate(value, tasks) {
  if (!value || !Array.isArray(value.tasks) || value.tasks.length !== tasks.length ||
    Object.keys(value).some(key => !['status', 'tasks'].includes(key))) fail('resume_delegation_receipt_invalid', '服务端委派完整回执无效，未保存父回执');
  const completed = tasks.filter(task => task.status === 'completed').length;
  const status = completed === tasks.length ? 'completed' : completed ? 'partial_failure' : tasks.every(task => ['cancelled', 'skipped'].includes(task.status)) ? 'cancelled' : 'failed';
  if (value.status !== status) fail('resume_delegation_receipt_invalid', '委派聚合状态与终态记录不一致，未保存父回执');
  for (const [index, task] of value.tasks.entries()) {
    const expected = tasks[index];
    if (!task || Object.keys(task).some(key => !['taskId', 'title', 'dependsOn', 'status', 'response', 'error', 'blockedBy'].includes(key)) ||
      task.taskId !== expected.taskId || task.title !== expected.title || task.status !== expected.status ||
      !same(task.dependsOn, expected.dependsOn) || !same(task.blockedBy, expected.blockedBy) ||
      task.error !== undefined && typeof task.error !== 'string' ||
      task.response !== undefined && (!task.response || Object.keys(task.response).length !== 1 || typeof task.response.text !== 'string' || task.response.text.length > 20000) ||
      task.status === 'completed' && !task.response) fail('resume_delegation_receipt_invalid', '完整子任务结果与核对的原委派不一致，未保存父回执');
  }
  if (JSON.stringify(value).length > 200000) fail('resume_delegation_receipt_too_large', '完整委派结果超过工具回执容量，已保留原任务');
}

/** Read and stage one authoritative terminal receipt. The caller must flush the
 * returned journal, recheck sources, then explicitly use the normal continue. */
export async function prepareTerminalDelegationReceipt(record, {scope, sourceVersion, request, isCurrent, signal} = {}) {
  if (typeof request !== 'function' || typeof isCurrent !== 'function') fail('resume_delegation_context_invalid', '委派回执恢复缺少当前任务守卫');
  const current = () => {if (signal?.aborted || !isCurrent()) throw new DOMException('委派回执恢复已失效', 'AbortError');};
  current();
  const eligibility = terminalDelegationEligibility(record, scope);
  if (!eligibility.allowed) fail('resume_delegation_blocked', eligibility.reason);
  const {fingerprint, prepareReceiptJournal} = await import('./journal.mjs');
  current();
  const journal = record.journal;
  if (journal.sourceVersion !== sourceVersion) fail('resume_source_changed', '来源版本已变化，不能恢复原委派回执');
  if (await fingerprint(journal.submission) !== journal.submissionHash) fail('resume_submission_changed', '原始提交已变化，不能恢复原委派回执');
  current();
  const expected = structuredClone(record.state.delegation.tasks);
  const result = await request('delegated-result', {sessionId: record.sessionId, binding: {...record.binding}, callId: eligibility.callId});
  current();
  validateAggregate(result, expected);
  const staged = structuredClone(record);
  await prepareReceiptJournal(staged, {results: [{callId: eligibility.callId, result}], sourceVersion});
  current();
  if (record.journal !== journal || journal.sourceVersion !== sourceVersion || !terminalDelegationEligibility(record, scope).allowed ||
    !same(record.state.delegation.tasks, expected)) fail('resume_delegation_context_changed', '委派核对记录已变化，未保存父回执');
  record.journal = staged.journal;
  record.journal.receipts.origin = {kind: 'server_terminal_delegation', sessionId: record.sessionId, callId: eligibility.callId, round: record.state.round};
  return record.journal.receipts;
}
