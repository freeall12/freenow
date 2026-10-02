const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const load = () => import('../src/features/agent-recovery/generation-settlement.mjs');
const pending = [{callId: 'analysis', name: 'video_analyze'}];
const results = [{callId: 'analysis', result: {taskId: 'task', operationId: 'op', status: 'running', applied: false}}];
function tasks(status = 'running') {
  const job = {id: 'task', request: {kind: 'video.analyze', agentVideoAnalysis: {operationId: 'op'}}, status};
  const listeners = new Set();
  return {job, listeners, generationAPI: {getJobs: () => [{...job}], subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}},
    emit() {for (const listener of [...listeners]) listener({...job});}};
}
const boundarySource = fs.readFileSync(require.resolve('../agent-client.js'), 'utf8');
const boundaryStart = boundarySource.indexOf('    await recoveryModule.awaitVideoAnalysisSettlement(');
const boundaryEnd = boundarySource.indexOf('    depthHost.acceptInspections(results,', boundaryStart);
const boundary = boundarySource.slice(boundaryStart, boundarySource.indexOf('\n', boundaryEnd));
async function context(task, persistChange) {
  const journal = await import('../src/features/agent-recovery/journal.mjs'), settlement = await load();
  const run = {submissionId: 'submission', sessionId: 'session', binding: {projectId: 'p', conversationId: 'c', submissionId: 'submission'}};
  await journal.initializeJournal(run, {submission: {id: 'submission'}, sourceVersion: await journal.fingerprint({})});
  journal.recordPendingRound(run, {sessionId: 'session', round: 1, calls: pending}, new Set(['analysis']));
  journal.recordExecutedCalls(run, results);
  const nodes = [{id: 'source', title: 'original video'}], stats = {reads: 0, saves: 0, dispatches: 0, accepted: 0, checkpoints: []};
  const value = {run, results: structuredClone(results), d: {}, nodes, stats, runController: new AbortController(), seenCallIds: new Set(['analysis']),
    window: {GenerationAPI: task.generationAPI}, recoveryModule: {...journal, ...settlement}, owned: true, ownsAgentRun: () => value.owned,
    recoverySourceVersion: async (_chat, options) => {stats.reads++; if (options?.persistCanvas) stats.saves++; return journal.fingerprint(nodes);},
    withInspectionMedia: entry => entry, withDepthFormEvidence: entry => entry, clone: structuredClone, DOMException, Error,
    persistRunCheckpoint: async () => {stats.checkpoints.push(structuredClone(run.journal)); await persistChange?.(value);},
    request: async (path, body) => {assert.equal(path, 'continue'); stats.dispatches++; stats.body = body; return {limitReached: false};},
    depthHost: {acceptInspections: () => stats.accepted++}};
  vm.runInContext(`async function continueBoundary(){let response;${boundary}}`, vm.createContext(value));
  return value;
}

test('actual Agent dispatch boundary waits for final application before snapshot and preserves the original acknowledgement', async () => {
  const task = tasks(), value = await context(task);
  const work = value.continueBoundary();
  await Promise.resolve();
  assert.equal(value.stats.reads, 0); assert.equal(value.stats.dispatches, 0);
  const {createApplicationRunner} = await import('../src/features/generation-results/application.mjs');
  let release; const gate = new Promise(resolve => {release = resolve;}); let applies = 0;
  task.job.status = 'succeeded'; task.job.outputs = [{type: 'video', url: '/real-cut.mp4'}]; task.emit();
  const application = createApplicationRunner({getJob: () => task.job, changed: () => task.emit(), apply: async job => {
    applies++; value.nodes.push({id: 'shot', title: 'actual generated shot'}); job.resultIds = ['shot']; await gate;
  }});
  const applying = application.run('task'); await Promise.resolve(); await Promise.resolve();
  assert.equal(value.nodes.length, 2); assert.equal(value.stats.reads, 0); assert.equal(value.stats.dispatches, 0);
  release(); await applying; await work;
  assert.equal(applies, 1); assert.equal(task.listeners.size, 0); assert.equal(value.stats.saves, 1);
  assert.equal(value.stats.dispatches, 1); assert.equal(value.stats.accepted, 1);
  assert.equal(value.run.journal.sourceVersion, await value.recoveryModule.fingerprint(value.nodes));
  assert.deepEqual(value.stats.body.results, results); assert.equal(value.stats.checkpoints.length, 2);
});

test('user editing between the source snapshot and either checkpoint still blocks the actual continue request', async () => {
  for (const changeAt of [1, 2]) {
    const task = tasks('succeeded'); task.job.applied = true;
    const value = await context(task, current => {if (current.stats.checkpoints.length === changeAt) current.nodes[0].title = 'user edited source';});
    await assert.rejects(value.continueBoundary(), /来源版本已变化/);
    assert.equal(value.stats.dispatches, 0); assert.equal(task.listeners.size, 0);
  }
});

test('ordinary async generation and denied/unconfigured analysis do not acquire a settlement wait', async () => {
  const {awaitVideoAnalysisSettlement} = await load();
  const mustNotRead = {getJobs() {throw Error('ordinary generation must remain async');}, subscribe() {throw Error('must not subscribe');}};
  await awaitVideoAnalysisSettlement({pending: [{callId: 'analysis', name: 'generation_submit'}], results, generationAPI: mustNotRead});
  await awaitVideoAnalysisSettlement({pending, results: [{callId: 'analysis', result: {error: 'denied'}}], generationAPI: mustNotRead});
});

test('known terminal errors, unknown status and recovered results settle without an application retry or resubmission', async () => {
  const {awaitVideoAnalysisSettlement} = await load();
  for (const state of [{status: 'failed'}, {status: 'cancelled'}, {status: 'configuration_required'}, {status: 'unknown'},
    {status: 'succeeded', applicationError: 'disk failure'}, {status: 'succeeded', recovered: true}]) {
    const task = tasks(); Object.assign(task.job, state);
    await awaitVideoAnalysisSettlement({pending, results, generationAPI: task.generationAPI});
    assert.equal(task.listeners.size, 0);
  }
});

test('abort and project ownership changes release the barrier without changing an already successful task', async () => {
  for (const action of ['abort', 'switch']) {
    const task = tasks('succeeded'); task.job.applying = true;
    const value = await context(task), work = value.continueBoundary();
    await Promise.resolve();
    if (action === 'abort') value.runController.abort(); else {value.owned = false; task.emit();}
    await assert.rejects(work, {name: 'AbortError'});
    assert.equal(task.job.status, 'succeeded'); assert.equal(task.job.applying, true);
    assert.equal(task.listeners.size, 0); assert.equal(value.stats.reads, 0); assert.equal(value.stats.dispatches, 0);
  }
});

test('missing or conflicting task identity refuses continuation, timeout cleans subscriptions, and completion at subscribe is retained', async () => {
  const {awaitVideoAnalysisSettlement} = await load();
  for (const mismatch of ['missing', 'kind', 'operation']) {
    const task = tasks();
    if (mismatch === 'missing') task.generationAPI.getJobs = () => [];
    if (mismatch === 'kind') task.job.request.kind = 'image.generate';
    if (mismatch === 'operation') task.job.request.agentVideoAnalysis.operationId = 'other';
    await assert.rejects(awaitVideoAnalysisSettlement({pending, results, generationAPI: task.generationAPI}), {code: 'analysis_task_unavailable'});
    assert.equal(task.listeners.size, 0);
  }
  const timeout = tasks();
  await assert.rejects(awaitVideoAnalysisSettlement({pending, results, generationAPI: timeout.generationAPI, timeoutMs: 5}), {code: 'analysis_settlement_timeout'});
  assert.equal(timeout.listeners.size, 0); assert.equal(timeout.job.status, 'running');
  const completed = tasks();
  completed.generationAPI.subscribe = listener => {completed.listeners.add(listener); completed.job.status = 'succeeded'; completed.job.applied = true; listener(completed.job); return () => completed.listeners.delete(listener);};
  await awaitVideoAnalysisSettlement({pending, results, generationAPI: completed.generationAPI});
  assert.equal(completed.listeners.size, 0);
});
