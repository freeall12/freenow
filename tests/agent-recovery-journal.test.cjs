const test = require('node:test'), assert = require('node:assert/strict');
const load = () => import('../src/features/agent-recovery/journal.mjs');
const scope = {projectId: 'p', conversationId: 'c'}, source = 'a'.repeat(64);
async function task() {
  const journal = await load(), record = {submissionId: 's', sessionId: 'session', binding: {...scope, submissionId: 's'}};
  await journal.initializeJournal(record, {submission: {id: 's', text: '真实提交', studioNodeId: null, selection: {modelId: 'fixture'}}, sourceVersion: source});
  return record;
}
const calls = [{callId: 'inspect', name: 'canvas_inspect_media'}, {callId: 'depth', name: 'depth_video_prepare'}];
const prepared = () => [{callId: 'inspect', result: {nodes: [{id: 'real-node'}], visualInputCount: 1}, mediaInputs: [{type: 'image', name: 'real-node', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', time: 0.25}]},
  {callId: 'depth', result: {prepared: true}, formSubmission: {form: {title: '实际表单'}, result: {tool_call_id: 'form-original', values: [{field_id: 'actor', value: '用户提交'}]}}}];
async function readyRecord() {
  const journal = await load(), record = await task();
  journal.recordPendingRound(record, {sessionId: 'session', round: 2, calls}, new Set(calls.map(call => call.callId)));
  journal.recordExecutedCalls(record, prepared());
  await journal.prepareReceiptJournal(record, {results: prepared(), sourceVersion: source});
  record.state = {status: 'waiting_tools', round: 2, pending: calls, canResumeWithReceipts: true};
  return record;
}

test('the durable journal sends exact actual pixels and submitted form evidence after JSON persistence', async () => {
  const {buildResumePlan} = await load(), record = await readyRecord();
  const reopened = JSON.parse(JSON.stringify(record));
  const plan = await buildResumePlan(reopened, scope, source);
  assert.deepEqual(plan.results, prepared()); assert.deepEqual(plan.binding, record.binding);
  assert.equal(plan.results[0].mediaInputs[0].imageUrl, prepared()[0].mediaInputs[0].imageUrl);
  assert.deepEqual(plan.seenCallIds, ['inspect', 'depth']);
  plan.results[0].result.nodes[0].id = 'changed-return-copy';
  assert.equal(reopened.journal.receipts.results[0].result.nodes[0].id, 'real-node');
});

test('pending call identity and round must match completely, without using trace summaries as receipts', async () => {
  const {buildResumePlan, resumeEligibility} = await load();
  for (const change of [record => record.state.pending.pop(), record => record.state.pending[0].callId = 'different', record => record.state.pending[0].name = 'canvas_add', record => record.state.round++, record => record.journal.receipts = null]) {
    const record = await readyRecord(); record.state.pending = structuredClone(record.state.pending); change(record);
    record.messages = [{role: 'tool', callId: 'inspect', status: 'done', result: {visualInputCount: 1}}];
    assert.equal(resumeEligibility(record, scope).allowed, false);
    await assert.rejects(buildResumePlan(record, scope, source), {code: 'resume_blocked'});
  }
  const record = await task(), {recordPendingRound, recordExecutedCalls} = await load();
  recordPendingRound(record, {sessionId: 'session', round: 2, calls}, new Set(['inspect', 'depth'])); recordExecutedCalls(record, [prepared()[0]]);
  record.state = {status: 'waiting_tools', round: 2, pending: calls, canResumeWithReceipts: true};
  assert.match(resumeEligibility(record, scope).reason, /部分执行/);
});

test('changed sources, changed submission, altered receipt bytes, and other project bindings are refused', async () => {
  const {buildResumePlan} = await load();
  await assert.rejects(buildResumePlan(await readyRecord(), scope, 'b'.repeat(64)), {code: 'resume_source_changed'});
  const submission = await readyRecord(); submission.journal.submission.text = '新指令';
  await assert.rejects(buildResumePlan(submission, scope, source), {code: 'resume_submission_changed'});
  const media = await readyRecord(); media.journal.receipts.results[0].mediaInputs[0].imageUrl += 'tampered';
  await assert.rejects(buildResumePlan(media, scope, source), {code: 'resume_receipts_changed'});
  await assert.rejects(buildResumePlan(await readyRecord(), {...scope, projectId: 'other'}, source), {code: 'resume_blocked'});
});

test('unknown, blocked, cancelled, in-flight and unavailable configuration never permit a continue request', async () => {
  const {buildResumePlan} = await load();
  for (const status of ['unknown', 'blocked', 'cancelled', 'failed', 'request_in_flight', 'compacting', 'completed']) {
    const record = await readyRecord(); record.state.status = status;
    await assert.rejects(buildResumePlan(record, scope, source), {code: 'resume_blocked'});
  }
  const noKey = await readyRecord(); noKey.state.canResumeWithReceipts = false;
  await assert.rejects(buildResumePlan(noKey, scope, source), /服务端暂不允许继续/);
});

test('receipts_saved resends the original accepted batch, never substitutes [] or drops media evidence', async () => {
  const {buildResumePlan, assertResumeResponse} = await load(), record = await readyRecord();
  record.state = {...record.state, status: 'receipts_saved', pending: []};
  const plan = await buildResumePlan(record, scope, source); assert.deepEqual(plan.results, prepared());
  assert.throws(() => assertResumeResponse({sessionId: 'session', round: 2, done: false, calls: [{callId: 'fresh', name: 'canvas_read'}]}, plan), {code: 'resume_response_stale'});
  assert.throws(() => assertResumeResponse({sessionId: 'session', round: 3, done: false, calls: [{callId: 'inspect', name: 'canvas_inspect_media'}]}, plan), {code: 'resume_call_replayed'});
  assert.doesNotThrow(() => assertResumeResponse({sessionId: 'session', round: 3, done: false, calls: [{callId: 'new', name: 'canvas_read'}]}, plan));
});

test('planned only resumes original round-zero context and form completion can finish at the same round without new tools', async () => {
  const {buildResumePlan, assertResumeResponse} = await load(), record = await task();
  record.state = {status: 'planned', round: 0, pending: [], canResumeWithReceipts: true};
  const plan = await buildResumePlan(record, scope, source); assert.deepEqual(plan.results, []);
  record.state.round = 1; await assert.rejects(buildResumePlan(record, scope, source), {code: 'resume_blocked'});
  const formPlan = {...plan, status: 'waiting_tools', round: 3, pending: [{callId: 'form', name: 'show_form'}], seenCallIds: ['form']};
  assert.doesNotThrow(() => assertResumeResponse({sessionId: 'session', round: 3, done: true, calls: []}, formPlan));
  assert.throws(() => assertResumeResponse({sessionId: 'session', round: 3, done: false, calls: [{callId: 'new', name: 'canvas_read'}]}, formPlan), {code: 'resume_response_stale'});
});

test('oversized prepared receipts stop before save or dispatch rather than stripping actual pixels', async () => {
  const {prepareReceiptJournal} = await load(), record = await readyRecord(), prior = record.journal.receipts, entries = prepared();
  entries[0].mediaInputs[0].imageUrl = 'data:image/png;base64,' + 'x'.repeat(1000000);
  await assert.rejects(prepareReceiptJournal(record, {results: entries, sourceVersion: source}), {code: 'resume_receipts_too_large'});
  assert.equal(record.journal.receipts, prior); assert.equal(entries[0].mediaInputs[0].imageUrl.length, 1000022);
});

test('an actual checkpoint save failure prevents the dispatch boundary, while a collapsed active run remains owned', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), sourceCode = fs.readFileSync(require.resolve('../agent-client.js'), 'utf8');
  const start = sourceCode.indexOf(' function ownsAgentRun('), end = sourceCode.indexOf(' async function recoverySourceVersion', start);
  const chat = {id: 'chat'}, run = {binding: {projectId: 'project'}}, controller = new AbortController(); chat.activeRun = run;
  let flushes = 0, dispatched = 0;
  const context = vm.createContext({chat, run, pageLeaving: false, draft: () => chat, chats: [chat], project: {id: 'project'}, controller,
    panel: null, save: () => true, flushConversation: async () => {flushes++; throw Error('disk unavailable');}, DOMException, Error});
  vm.runInContext(sourceCode.slice(start, end), context);
  await assert.rejects(context.persistRunCheckpoint(chat, run).then(() => dispatched++), /disk unavailable/);
  assert.equal(flushes, 1); assert.equal(dispatched, 0); assert.equal(context.ownsAgentRun(chat, run), true);
  context.pageLeaving = true;
  await assert.rejects(context.persistRunCheckpoint(chat, run), {name: 'AbortError'}); assert.equal(flushes, 1);
});

test('new composer and widget submissions cannot start a queue during recovery preparation', () => {
  const fs = require('node:fs'), vm = require('node:vm'), sourceCode = fs.readFileSync(require.resolve('../agent-client.js'), 'utf8');
  const trace = {role: 'tool', name: 'show_widget', status: 'done', result: {}};
  const chat = {text: '新的排队任务', messages: [trace], interruptedRuns: [{submissionId: 'original'}], queuedMessages: []}, notices = [];
  let drains = 0;
  const context = vm.createContext({recoveryRunning: true, appQueueSaving: false, conversationsLoaded: true, pageLeaving: false, panel: {}, draft: () => chat, pendingQuestion: () => null,
    notice: text => notices.push(text), queueModule: {}, queueRunner: {drain: () => drains++}, clone: () => {throw Error('must not replace existing task identity');}});
  const sendStart = sourceCode.indexOf(' function send(){'), sendEnd = sourceCode.indexOf(' async function runSubmission', sendStart);
  const widgetStart = sourceCode.indexOf(' function queueWidgetPrompt('), widgetEnd = sourceCode.indexOf(' function send(){', widgetStart);
  vm.runInContext(sourceCode.slice(sendStart, sendEnd) + sourceCode.slice(widgetStart, widgetEnd), context);
  const original = chat.interruptedRuns[0]; context.send();
  assert.equal(context.queueWidgetPrompt('new', trace, chat, {}), false);
  assert.equal(drains, 0); assert.equal(chat.interruptedRuns[0], original); assert.equal(chat.queuedMessages.length, 0);
  assert.match(notices[0], /中断任务正在继续/);
});
