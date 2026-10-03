const {test} = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/features/workflow-recovery/journal.mjs');
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
function lockManager() {
  const held = new Set();
  return {async request(key, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(key)) return callback(null);
    held.add(key); try { return await callback({name: key}); } finally { held.delete(key); }
  }};
}
function storeAdapter() {
  const records = new Map();
  return {records, writes: 0, pause: null, failure: null,
    async readRecord(key) { return clone(records.get(key)); },
    async writeRecord(key, value, options) {
      this.writes++;
      if (this.pause) await this.pause(options);
      if (this.failure) throw this.failure;
      if (options.canCommit() !== true) throw Error('commit blocked');
      const revision = records.get(key)?.storageRevision || 0;
      if (revision !== options.expectedRevision) throw Object.assign(Error('version conflict'), {code: 'cas_conflict'});
      records.set(key, {...clone(value), storageRevision: revision + 1}); return {storageRevision: revision + 1};
    },
  };
}
async function fixture(options = {}) {
  const module = await load(), store = options.store || storeAdapter(), locks = options.locks || lockManager();
  const journal = module.createWorkflowJournal({store, locks, projectId: 'project', ownerId: options.ownerId || 'page-one', ...options});
  await journal.open();
  const input = {runId: 'run', groupId: 'group', members: ['s', 'a', 'b', 'c'], plan: {layers: [['s'], ['a', 'b'], ['c']], executable: ['a', 'b', 'c']}, versions: {s: 's0', a: 'a0', b: 'b0', c: 'c0', external: 'e0'}};
  if (!options.existing) await journal.create(input);
  const context = {...clone(input), projectId: 'project'};
  return {...module, store, locks, journal, input, context};
}
function job(nodeId) {
  return {id: 'task-' + nodeId, createdAt: 1000, request: {nodeId, workflowId: 'group', kind: 'text.generate', prompt: 'prompt', inputs: [{id: 'external', text: 'initial'}], parameters: {count: 1, model: 'test', workflowRecovery: {version: 1, projectId: 'project', runId: 'run', groupId: 'group', nodeId}}}, status: 'succeeded', outputs: [{type: 'text', text: 'result-' + nodeId}]};
}
async function registered(journal, nodeId) {
  const task = job(nodeId); await journal.submitted('run', nodeId, task);
  task.request.inputs = [{id: 'external', text: 'materialized'}];
  await journal.prepared('run', nodeId, task); return task;
}
async function intent(f, task) {
  const nodeId = task.request.nodeId;
  const receipt = {taskId: task.id, beforeVersion: f.context.versions[nodeId], afterVersion: nodeId + '1', resultVersion: await f.fingerprint(task.outputs), proposedNode: {id: nodeId, type: 'text', content: task.outputs[0].text}, createdAt: task.createdAt};
  await f.journal.preparingApplication('run', nodeId, receipt); return receipt;
}
async function applied(f, task) {
  const receipt = await intent(f, task); f.context.versions[task.request.nodeId] = receipt.afterVersion;
  await f.journal.applied('run', task.request.nodeId, receipt); return receipt;
}

test('original task receipt waits for transaction; prepared request has a distinct durable fingerprint', async () => {
  const f = await fixture(); let release, entered, dispatched = 0;
  const writing = new Promise(resolve => { entered = resolve; });
  f.store.pause = () => new Promise(resolve => { release = resolve; entered(); });
  const task = job('a'), pending = f.journal.submitted('run', 'a', task).then(() => { dispatched++; });
  await writing; assert.equal(dispatched, 0); assert.equal(f.journal.get('run').tasks.a.state, 'pending');
  release(); await pending; f.store.pause = null;
  assert.equal(dispatched, 1);
  task.request.inputs[0].text = 'materialized'; await f.journal.prepared('run', 'a', task);
  const stored = f.journal.get('run').tasks.a;
  assert.notEqual(stored.requestVersion, stored.transportRequestVersion);
  assert.equal(stored.transportRequestVersion, await f.fingerprint(task.request)); f.journal.close();
});

test('failed initial or prepared receipt prevents dispatch and blocks subsequent mutations', async () => {
  for (const stage of ['initial', 'prepared']) {
    const f = await fixture(), task = job('a'); let dispatches = 0;
    if (stage === 'prepared') await f.journal.submitted('run', 'a', task);
    f.store.failure = Error('disk full');
    await assert.rejects((stage === 'initial' ? f.journal.submitted('run', 'a', task) : f.journal.prepared('run', 'a', task)).then(() => { dispatches++; }), /disk full/);
    assert.equal(dispatches, 0); assert.equal(f.journal.writable, false);
    await assert.rejects(f.journal.flush(), /disk full/);
    await assert.rejects(f.journal.submitted('run', 'b', job('b')), /disk full/); f.journal.close();
  }
});

test('refresh reconciliation queries only original tasks and leaves every unsubmitted layer pending', async () => {
  const f = await fixture(), original = await registered(f.journal, 'a'); f.journal.close(); await tick();
  const restored = await fixture({store: f.store, locks: f.locks, ownerId: 'page-two', existing: true});
  await restored.journal.claim('run'); let queries = [], applications = 0;
  const result = await restored.journal.reconcile('run', {context: () => restored.context, query: async taskId => { queries.push(taskId); return original; }, apply: async task => { applications++; const receipt = await intent(restored, task); restored.context.versions.a = receipt.afterVersion; return receipt; }});
  assert.deepEqual(queries, ['task-a']); assert.equal(applications, 1);
  assert.equal(result.run.tasks.b.state, 'pending'); assert.equal(result.run.tasks.c.state, 'pending');
  assert.deepEqual(result.continuation, {ok: true, reason: '', nextLayer: 1}); restored.journal.close();
});

test('unknown lookup, 404, and missing final request receipt retain IDs and never apply', async () => {
  for (const mode of ['unknown', '404', 'missing-prepared']) {
    const f = await fixture(), task = mode === 'missing-prepared' ? job('a') : await registered(f.journal, 'a');
    if (mode === 'missing-prepared') await f.journal.submitted('run', 'a', task);
    let queries = 0, applications = 0;
    const result = await f.journal.reconcile('run', {context: () => f.context, query: async id => { assert.equal(id, 'task-a'); queries++; if (mode === '404') throw Error('HTTP 404'); return {...task, status: mode === 'unknown' ? 'unknown' : 'succeeded'}; }, apply: async () => { applications++; }});
    assert.equal(queries, 1); assert.equal(applications, 0); assert.equal(result.run.tasks.a.taskId, 'task-a'); assert.equal(result.run.tasks.a.state, 'unknown'); assert.equal(result.continuation.ok, false);
    await assert.rejects(f.journal.submitted('run', 'a', {...task, id: 'replacement-task'}), /不能再次提交/); f.journal.close();
  }
});

test('recovery rejects wrong project, group, run, node, task and prepared request fingerprint', async () => {
  const alterations = [task => task.request.parameters.workflowRecovery.projectId = 'other', task => task.request.parameters.workflowRecovery.groupId = 'other', task => task.request.parameters.workflowRecovery.runId = 'other', task => task.request.nodeId = 'b', task => task.id = 'wrong-id', task => task.request.inputs[0].text = 'wrong-ref'];
  for (const alter of alterations) {
    const f = await fixture(), task = await registered(f.journal, 'a'), bad = clone(task); alter(bad); let applications = 0;
    const result = await f.journal.reconcile('run', {context: () => f.context, query: async () => bad, apply: async () => { applications++; }});
    assert.equal(applications, 0); assert.equal(result.run.tasks.a.state, 'unknown'); f.journal.close();
  }
});

test('whole layer application receipts gate descendants; siblings may acknowledge concurrently', async () => {
  const f = await fixture(), a = job('a'), b = job('b');
  await Promise.all([f.journal.submitted('run', 'a', a), f.journal.submitted('run', 'b', b)]);
  await Promise.all([f.journal.prepared('run', 'a', a), f.journal.prepared('run', 'b', b)]);
  await applied(f, b);
  await assert.rejects(f.journal.submitted('run', 'c', job('c')), /前一层/);
  assert.equal(f.journal.canContinue('run', f.context).ok, false);
  await applied(f, a); assert.equal(f.journal.canContinue('run', f.context).nextLayer, 2);
  await f.journal.submitted('run', 'c', job('c')); f.journal.close();
});

test('real failed task blocks descendant submissions while submitted sibling still recovers', async () => {
  const f = await fixture(), a = await registered(f.journal, 'a'), b = await registered(f.journal, 'b'), queries = [];
  const result = await f.journal.reconcile('run', {context: () => f.context, query: async id => { queries.push(id); return id === a.id ? {...a, status: 'failed', error: 'quota'} : b; }, apply: async task => { const receipt = await intent(f, task); f.context.versions[task.request.nodeId] = receipt.afterVersion; return receipt; }});
  assert.deepEqual(queries.sort(), ['task-a', 'task-b']); assert.equal(result.run.tasks.a.state, 'failed'); assert.equal(result.run.tasks.b.state, 'applied'); assert.equal(result.run.tasks.c.state, 'pending'); assert.equal(result.continuation.ok, false); f.journal.close();
});

test('stop is synchronous for dispatch, preserves submitted tasks, and allows their result recovery', async () => {
  const f = await fixture(), task = await registered(f.journal, 'a'); const stopping = f.journal.stop('run');
  assert.throws(() => f.journal.assertActive('run', {dispatch: true}), /已停止/); assert.equal(f.journal.canContinue('run', f.context).ok, false); await stopping;
  const result = await f.journal.reconcile('run', {context: () => f.context, query: async () => task, apply: async task => { const receipt = await intent(f, task); f.context.versions.a = receipt.afterVersion; return receipt; }});
  assert.equal(result.run.tasks.a.state, 'applied'); assert.equal(result.run.tasks.b.state, 'pending'); assert.equal(result.continuation.ok, false); f.journal.close();
});

test('a registered task may finish preparing and dispatch after stop without a second task identity', async () => {
  const f = await fixture(), task = job('a'); await f.journal.submitted('run', 'a', task); await f.journal.stop('run');
  task.request.inputs[0].text = 'prepared after stop'; await f.journal.prepared('run', 'a', task);
  assert.equal(f.journal.assertActive('run', {dispatch: true, nodeId: 'a', taskId: task.id}), true);
  await assert.rejects(f.journal.submitted('run', 'b', job('b')), /已停止/);
  assert.equal(f.journal.get('run').tasks.a.taskId, task.id); f.journal.close();
});

test('intent saved before graph application reuses exact proposal and original createdAt after refresh', async () => {
  const f = await fixture(), task = await registered(f.journal, 'a'), receipt = await intent(f, task);
  f.journal.close(); await tick();
  const restored = await fixture({store: f.store, locks: f.locks, ownerId: 'restored', existing: true}); await restored.journal.claim('run');
  const result = await restored.journal.reconcile('run', {context: () => restored.context, query: async () => ({...task, createdAt: 2000}), apply: async (_job, {application}) => {
    assert.equal(application.createdAt, 1000); assert.deepEqual(application.proposedNode, receipt.proposedNode);
    assert.equal(application.proposalVersion, await restored.fingerprint(application.proposedNode));
    restored.context.versions.a = application.afterVersion;
    return {taskId: task.id, afterVersion: application.afterVersion, resultVersion: application.resultVersion};
  }});
  assert.equal(result.run.tasks.a.state, 'applied'); restored.journal.close();
});

test('corrupted saved proposal is never passed to graph application', async () => {
  const f = await fixture(), task = await registered(f.journal, 'a'); await intent(f, task); f.journal.close(); await tick();
  f.store.records.get(f.recordKey('project')).runs[0].tasks.a.application.proposedNode.content = 'tampered';
  const restored = await fixture({store: f.store, locks: f.locks, ownerId: 'restored', existing: true}); await restored.journal.claim('run'); let applications = 0;
  const result = await restored.journal.reconcile('run', {context: () => restored.context, query: async () => task, apply: async () => { applications++; }});
  assert.equal(applications, 0); assert.equal(result.run.tasks.a.state, 'unknown'); restored.journal.close();
});

test('saved graph but missing applied journal receipt verifies all applying siblings and never rewrites', async () => {
  const f = await fixture(), tasks = await Promise.all(['a', 'b'].map(id => registered(f.journal, id))), receipts = {};
  for (const task of tasks) { receipts[task.request.nodeId] = await intent(f, task); f.context.versions[task.request.nodeId] = receipts[task.request.nodeId].afterVersion; }
  f.journal.close(); await tick();
  const restored = await fixture({store: f.store, locks: f.locks, ownerId: 'new-page', existing: true}); restored.context.versions = clone(f.context.versions); await restored.journal.claim('run'); let writesToGraph = 0;
  const result = await restored.journal.reconcile('run', {context: () => restored.context, query: async id => tasks.find(task => task.id === id), apply: async (task, {application, resultVersion}) => { assert.equal(application.resultVersion, resultVersion); if (restored.context.versions[task.request.nodeId] !== application.afterVersion) { writesToGraph++; restored.context.versions[task.request.nodeId] = application.afterVersion; } return receipts[task.request.nodeId]; }});
  assert.equal(writesToGraph, 0); assert.equal(result.run.tasks.a.state, 'applied'); assert.equal(result.run.tasks.b.state, 'applied'); assert.equal(result.continuation.nextLayer, 2); restored.journal.close();
});

test('different task output cannot settle a saved application intent', async () => {
  const f = await fixture(), task = await registered(f.journal, 'a'), receipt = await intent(f, task); f.context.versions.a = receipt.afterVersion; let applications = 0;
  const result = await f.journal.reconcile('run', {context: () => f.context, query: async () => ({...task, outputs: [{type: 'text', text: 'tampered'}]}), apply: async () => { applications++; }});
  assert.equal(applications, 0); assert.equal(result.run.tasks.a.state, 'unknown'); assert.equal(result.continuation.ok, false); f.journal.close();
});

test('project, membership, source and result version changes prohibit recovery writes', async () => {
  for (const alter of [context => context.projectId = 'other', context => context.members.pop(), context => context.versions.external = 'e1', context => context.versions.a = 'user-edit']) {
    const f = await fixture(); await registered(f.journal, 'a'); const context = clone(f.context); alter(context); let queries = 0;
    await assert.rejects(f.journal.reconcile('run', {context: () => context, query: async () => { queries++; }, apply: async () => {}}), /变化|更改/);
    assert.equal(queries, 0); assert.equal(f.journal.get('run').tasks.a.state, 'submitted'); f.journal.close();
  }
});

test('source changes during original task lookup block application and receipt commit', async () => {
  const f = await fixture(), task = await registered(f.journal, 'a'); let finish, entered, applications = 0;
  const querying = new Promise(resolve => { entered = resolve; });
  const pending = f.journal.reconcile('run', {context: () => f.context, query: () => { entered(); return new Promise(resolve => { finish = resolve; }); }, apply: async () => { applications++; }});
  await querying; f.context.versions.external = 'modified-while-querying'; finish(task);
  await assert.rejects(pending, /更改/); assert.equal(applications, 0); assert.equal(f.journal.get('run').tasks.a.state, 'submitted'); f.journal.close();
});

test('closing page or changing current project during a delayed transaction blocks commit', async () => {
  for (const mode of ['close', 'project-change']) {
    let current = true; const f = await fixture({isCurrent: () => current}); let release, entered;
    const writing = new Promise(resolve => { entered = resolve; });
    f.store.pause = () => new Promise(resolve => { release = resolve; entered(); });
    const pending = f.journal.submitted('run', 'a', job('a')); await writing;
    if (mode === 'close') f.journal.close(); else current = false;
    release(); await assert.rejects(pending, /权限|切换|关闭/);
    assert.equal(f.store.records.get(f.recordKey('project')).runs[0].tasks.a.state, 'pending'); f.journal.close();
  }
});

test('project lock fences competing tabs and unsupported browsers fail closed', async () => {
  const f = await fixture(); const second = f.createWorkflowJournal({store: f.store, locks: f.locks, projectId: 'project', ownerId: 'second'});
  await assert.rejects(second.open(), /另一页面/); assert.equal(second.writable, false);
  const readonly = await f.readWorkflowRuns(f.store, 'project'); assert.equal(readonly.length, 1); readonly[0].tasks.a.state = 'failed'; assert.equal(f.journal.get('run').tasks.a.state, 'pending');
  const unsupported = f.createWorkflowJournal({store: f.store, locks: null, projectId: 'project'}); await assert.rejects(unsupported.open(), /Web Locks/); f.journal.close();
});

test('explicit baseline rejects external writes despite an independent read', async () => {
  const f = await fixture(), key = f.recordKey('project'), snapshot = f.store.records.get(key); snapshot.storageRevision++;
  await f.readWorkflowRuns(f.store, 'project');
  await assert.rejects(f.journal.submitted('run', 'a', job('a')), /version conflict/);
  assert.equal(f.journal.get('run').tasks.a.state, 'pending'); assert.equal(f.journal.writable, false); f.journal.close();
});

test('unknown envelope versions and impossible later-layer receipts are rejected without repair', async () => {
  const f = await fixture(), key = f.recordKey('project'), snapshot = clone(f.store.records.get(key)); f.journal.close(); await tick();
  for (const alter of [data => data.version = 2, data => data.runs[0].members.push('a'), data => { const task = job('c'); data.runs[0].tasks.c = {nodeId: 'c', taskId: task.id, kind: task.request.kind, state: 'submitted', requestVersion: 'a'.repeat(64)}; }]) {
    const corrupted = clone(snapshot); alter(corrupted); f.store.records.set(key, corrupted); const writes = f.store.writes;
    const journal = f.createWorkflowJournal({store: f.store, locks: f.locks, projectId: 'project'});
    await assert.rejects(journal.open(), /无效|顺序/); assert.equal(f.store.writes, writes); await tick();
  }
});
