import {canCheck, sameBinding} from './model.mjs';
import {terminalDelegationEligibility} from './terminal-delegation.mjs';

const fail = (code, message) => {throw Object.assign(Error(message), {code});};
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export async function fingerprint(value, cryptoImpl = globalThis.crypto) {
  const bytes = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const callSet = calls => [...calls].map(call => [call.callId, call.name]).sort((a, b) => a[0].localeCompare(b[0]));
const sameCalls = (a, b) => canonical(callSet(a)) === canonical(callSet(b));
function validateCalls(calls) {
  return Array.isArray(calls) && new Set(calls.map(call => call?.callId)).size === calls.length && calls.every(call => typeof call?.callId === 'string' && call.callId && typeof call.name === 'string' && call.name);
}
function exactReceipts(results, pending) {
  return validateCalls(pending) && Array.isArray(results) && results.length === pending.length && new Set(results.map(entry => entry?.callId)).size === results.length && results.every(entry => typeof entry?.callId === 'string' && pending.some(call => call.callId === entry.callId) && Object.hasOwn(entry, 'result'));
}

export async function initializeJournal(run, {submission, sourceVersion}) {
  if (!validDigest(sourceVersion) || submission?.id !== run.submissionId) fail('resume_context_invalid', '原提交或来源版本无效，任务未发送');
  run.journal = {version: 1, binding: {...run.binding}, submission: structuredClone(submission), submissionHash: await fingerprint(submission),
    sourceVersion, phase: 'initial_planned', round: 0, pending: [], executedCallIds: [], seenCallIds: [], receipts: null};
  return run.journal;
}

// Pending identity must be durable before any tool starts. Arguments are never
// reconstructed from the state summary or an interrupted trace.
export function recordPendingRound(run, response, seenCallIds) {
  const journal = run.journal;
  if (!journal || !Number.isInteger(response.round) || !validateCalls(response.calls) || response.sessionId !== run.sessionId) fail('resume_round_invalid', '工具轮次或任务身份无效，本轮未执行');
  Object.assign(journal, {round: response.round, pending: response.calls.map(({callId, name}) => ({callId, name})), executedCallIds: [],
    seenCallIds: [...seenCallIds], phase: 'tools_pending', receipts: null});
}

export function recordExecutedCalls(run, results) {
  const journal = run.journal;
  for (const entry of results) {
    if (!journal.pending.some(call => call.callId === entry.callId) || journal.executedCallIds.includes(entry.callId)) fail('resume_receipt_duplicate', '工具回执身份重复或不匹配，任务已暂停');
    journal.executedCallIds.push(entry.callId);
  }
  journal.phase = 'tools_partial';
}

export async function prepareReceiptJournal(run, {results, sourceVersion}) {
  const journal = run.journal;
  if (!journal || !validDigest(sourceVersion) || !exactReceipts(results, journal.pending)) fail('resume_receipts_incomplete', '缺少完整原始工具回执，不能继续任务');
  // Clone prepared transport entries, including actual pixels and submitted form
  // evidence, while their original WeakMap associations are still available.
  const prepared = structuredClone(results), payload = {sessionId: run.sessionId, binding: run.binding, results: prepared};
  if (new Blob([JSON.stringify(payload)]).size > 1000000) fail('resume_receipts_too_large', '真实回执超过请求容量，已暂停任务；不会丢弃画面后继续');
  journal.receipts = {round: journal.round, pending: structuredClone(journal.pending), results: prepared, hash: await fingerprint(prepared), sourceVersion};
  journal.sourceVersion = sourceVersion; journal.phase = 'receipts_ready';
  return journal.receipts;
}

export function resumeEligibility(record, scope) {
  if (!canCheck(record, scope)) return {allowed: false, reason: '缺少原会话绑定身份，无法继续。'};
  const state = record.state, journal = record.journal;
  if (!state) return {allowed: false, reason: '先核对中断任务，再决定是否继续。'};
  if (!['planned', 'waiting_tools', 'receipts_saved'].includes(state.status)) return {allowed: false, reason: state.status === 'unknown' ? '执行结果未知，不能自动重发或继续。' : '当前服务端状态不允许继续。'};
  if (!state.canResumeWithReceipts) return {allowed: false, reason: '服务端暂不允许继续，请核对配置和任务状态。'};
  if (!journal || journal.version !== 1 || !sameBinding(journal.binding, record.binding) || journal.submission?.id !== record.submissionId || !validDigest(journal.sourceVersion) || !validateCalls(journal.pending) || !Array.isArray(journal.seenCallIds)) return {allowed: false, reason: '缺少完整的本地执行上下文；旧执行记录不能代替原始回执。'};
  if (state.status === 'planned') {
    if (state.round !== 0 || state.pending.length || journal.round !== 0 || journal.pending.length || journal.seenCallIds.length || !['initial_planned', 'continue_requested'].includes(journal.phase)) return {allowed: false, reason: '计划状态与原提交记录不匹配，无法安全继续。'};
  } else {
    const receipts = journal.receipts;
    if (!receipts) {
      const delegation = terminalDelegationEligibility(record, scope);
      if (delegation.allowed) return delegation;
    }
    if (!receipts || !['receipts_ready', 'continue_requested'].includes(journal.phase) || !exactReceipts(receipts.results, receipts.pending) || !sameCalls(receipts.pending, journal.pending) || receipts.round !== journal.round || state.round !== journal.round) return {allowed: false, reason: journal.executedCallIds?.length ? '工具可能已部分执行，但未保存完整原始回执；请检查现有结果，不能重放工具。' : '未保存当前轮次的完整原始工具回执，不能继续或重放工具。'};
    if (state.status === 'waiting_tools' && !sameCalls(state.pending, receipts.pending)) return {allowed: false, reason: '服务端待办调用与已保存回执不匹配，不能继续。'};
    if (state.status === 'receipts_saved' && state.pending.length) return {allowed: false, reason: '服务端回执状态与待办列表不一致，不能继续。'};
  }
  return {allowed: true, reason: '继续前会再次核对状态和来源版本；只补交已保存回执，并按现有确认规则执行后续新调用。'};
}

export async function buildResumePlan(record, scope, sourceVersion) {
  const eligibility = resumeEligibility(record, scope);
  if (!eligibility.allowed) fail('resume_blocked', eligibility.reason);
  const journal = record.journal;
  if (record.state.status !== 'planned' && !journal.receipts) fail('resume_delegation_receipt_required', '请先读取并保存服务端完整委派结果，不能从子任务状态摘要继续');
  if (journal.sourceVersion !== sourceVersion || journal.receipts && journal.receipts.sourceVersion !== sourceVersion) fail('resume_source_changed', '画布、素材、片场或编辑器来源版本已变化，已拒绝继续原任务。请检查现有结果后发起新需求。');
  if (await fingerprint(journal.submission) !== journal.submissionHash) fail('resume_submission_changed', '原始提交记录已变化，不能继续此任务');
  const results = record.state.status === 'planned' ? [] : journal.receipts.results;
  if (journal.receipts && await fingerprint(results) !== journal.receipts.hash) fail('resume_receipts_changed', '原始回执内容已变化，不能补交或从摘要重建回执');
  return {sessionId: record.sessionId, binding: {...record.binding}, results: structuredClone(results), round: record.state.round,
    status: record.state.status, pending: structuredClone(journal.pending), seenCallIds: [...journal.seenCallIds], sourceVersion};
}

export function assertResumeResponse(response, plan) {
  const formCompletion = response?.done === true && response.calls?.length === 0 && plan.pending.some(call => call.name === 'show_form');
  if (response?.sessionId !== plan.sessionId || !Number.isInteger(response.round) || response.round <= plan.round && !(formCompletion && response.round === plan.round)) fail('resume_response_stale', '续轮返回了旧轮次或不同任务；未执行其中的工具，请重新核对任务状态');
  if ((response.calls || []).some(call => plan.seenCallIds.includes(call.callId))) fail('resume_call_replayed', '续轮返回了已见过的工具调用，已阻止重复执行');
}
