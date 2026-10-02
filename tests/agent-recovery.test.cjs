const test = require('node:test'), assert = require('node:assert/strict');
const model = () => import('../src/features/agent-recovery/model.mjs');
const scope = {projectId: 'project-a', conversationId: 'chat-a'};
const record = () => ({sessionId: 'session-a', submissionId: 'submission-a', startedAt: 10, binding: {...scope, submissionId: 'submission-a'}});
const response = (extra = {}) => ({sessionId: 'session-a', binding: record().binding, status: 'waiting_tools', round: 2, done: false, restored: true, canResumeWithReceipts: true, pending: [{callId: 'original-call', name: 'canvas_add'}], text: '', ...extra});

test('refresh retains durable task identity in the original project record and repeated hydration does not append warnings', async () => {
  const {beginRun, interruptRun, hydrateChat} = await model();
  const {createConversations, resolve} = require('../project-context.js');
  const records = new Map(), storage = new Map(), project = resolve({projects: {id: () => scope.projectId}});
  const store = {writeRecord: async (key, value) => records.set(key, structuredClone(value)), readRecord: async key => structuredClone(records.get(key))};
  const conversations = createConversations({project, store, storage: {setItem: (key, value) => storage.set(key, value)}});
  const chat = {id: scope.conversationId, messages: [{role: 'assistant', text: '部分已收到内容'}]};
  const run = beginRun(chat, {projectId: scope.projectId, submissionId: 'submission-a', now: 10}); run.sessionId = 'session-a';
  conversations.save([chat], chat.id); await conversations.flush();
  const saved = await conversations.load(), reopened = saved.chats[0]; hydrateChat(reopened); hydrateChat(reopened);
  assert.equal(reopened.activeRun, undefined); assert.equal(reopened.interruptedRuns.length, 1);
  assert.deepEqual(reopened.interruptedRuns[0].binding, run.binding); assert.equal(reopened.interruptedRuns[0].sessionId, 'session-a');
  assert.equal(reopened.messages.length, 1); assert.equal(reopened.messages[0].text, '部分已收到内容');
  interruptRun(reopened, run, {now: 20}); assert.equal(reopened.interruptedRuns.length, 1);
  conversations.save(saved.chats, saved.activeId); await conversations.flush();
  assert.equal((await conversations.load()).chats[0].interruptedRuns.length, 1);
  assert.equal(await store.readRecord('agent-conversations:project-b'), undefined);
});

test('checking is manual, reads only the state route once, and waiting tool receipts never grant execution', async () => {
  const {createRecoveryController, describeRecovery} = await model();
  const {requestAgent} = await import('../src/features/agent-stream/transport.mjs');
  const task = record(), requests = []; let finish, saves = 0;
  const controller = createRecoveryController({isCurrent: () => true, persist: async () => saves++, request: data => requestAgent('state', data, {fetchImpl: async (url, options) => {requests.push({url, body: JSON.parse(options.body)}); return new Promise(done => finish = done);}})});
  assert.equal(requests.length, 0);
  const checking = controller.check(task, scope); assert.equal(controller.isChecking(task), true);
  assert.equal(await controller.check(task, scope), false); assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {url: '/api/agent/state', body: {sessionId: task.sessionId, binding: task.binding}});
  finish(Response.json(response())); assert.equal(await checking, true); assert.equal(saves, 1);
  assert.equal(task.state.pending[0].callId, 'original-call'); assert.equal(task.state.canResumeWithReceipts, true);
  assert.match(describeRecovery(task).detail, /不会执行这些工具或授予执行权限/);
  assert.equal(controller.isChecking(task), false); assert.equal(requests.length, 1);
});

test('late state reads cannot write after a conversation/project switch, page departure or switching away and back', async () => {
  const {createRecoveryController} = await model();
  for (const change of ['chat', 'project', 'leaving', 'epoch']) {
    const task = record(); let finish, saves = 0;
    const current = {...scope, chat: 'original', leaving: false, epoch: 1}, captured = {...current};
    const controller = createRecoveryController({isCurrent: () => !current.leaving && current.chat === captured.chat && current.projectId === captured.projectId && current.epoch === captured.epoch, persist: async () => saves++, request: () => new Promise(done => finish = done)});
    const checking = controller.check(task, captured);
    if (change === 'chat') current.chat = 'new';
    if (change === 'project') current.projectId = 'project-b';
    if (change === 'leaving') current.leaving = true;
    if (change === 'epoch') current.epoch++;
    finish(response({status: 'completed', done: true, text: '服务端真实返回文本'}));
    assert.equal(await checking, false, change); assert.equal(task.state, undefined, change); assert.equal(saves, 0, change);
    assert.equal(controller.isChecking(task), false);
  }
});

test('unknown results and read failures preserve identity; failed checks can be queried again without model replay', async () => {
  const {createRecoveryController, describeRecovery} = await model();
  const task = record(), original = structuredClone(task); let calls = 0;
  const controller = createRecoveryController({isCurrent: () => true, persist: async () => {}, request: async () => {calls++; if (calls === 1) throw Error('network unavailable'); return response({status: 'unknown', pending: [], canResumeWithReceipts: false});}});
  assert.equal(await controller.check(task, scope), false); assert.match(task.readError, /network unavailable/);
  assert.equal(task.sessionId, original.sessionId); assert.deepEqual(task.binding, original.binding);
  assert.equal(await controller.check(task, scope), true); assert.equal(task.readError, undefined);
  assert.match(describeRecovery(task).detail, /不会自动重发/); assert.equal(calls, 2);
});

test('legacy missing identity and mismatched state responses cannot replace the trusted task summary', async () => {
  const {canCheck, createRecoveryController, hydrateChat} = await model();
  const legacy = {id: scope.conversationId, messages: [], activeRun: {submissionId: 'legacy', sessionId: 'old-session'}}; hydrateChat(legacy);
  assert.equal(canCheck(legacy.interruptedRuns[0], scope), false);
  const task = record(); task.state = {status: 'unknown', pending: [], text: ''}; const trusted = task.state;
  const controller = createRecoveryController({isCurrent: () => true, persist: async () => {}, request: async () => response({binding: {...task.binding, conversationId: 'other-chat'}})});
  assert.equal(await controller.check(task, scope), false); assert.equal(task.state, trusted); assert.match(task.readError, /身份不一致/);
  assert.equal(canCheck(task, {...scope, projectId: 'other-project'}), false);
});

test('unchanged hydration does not queue a write and a successful read with a failed save is reported separately', async () => {
  const {hydrateChat, createRecoveryController} = await model();
  const chat = {id: scope.conversationId, queuedMessages: [], messages: []};
  assert.equal(hydrateChat(chat), false);
  const task = record(); let writes = 0;
  const controller = createRecoveryController({isCurrent: () => true, request: async () => response({status: 'completed', done: true, pending: [], text: '已读到真实结论'}), persist: async () => {writes++; throw Error('storage full');}});
  assert.equal(await controller.check(task, scope), false); assert.equal(writes, 1);
  assert.equal(task.state.status, 'completed'); assert.equal(task.state.text, '已读到真实结论');
  assert.equal(task.readError, undefined); assert.match(task.saveError, /storage full/);
  assert.equal(controller.isChecking(task), false);
});

test('completed readback is rendered as a task record with escaped text and no canvas-save or resume action', async () => {
  const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
  const domRequire = createRequire(fabricRequire.resolve('jsdom')), canvasPath = domRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
  require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
  const {JSDOM} = fabricRequire('jsdom');
  if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
  const dom = new JSDOM('<body></body>');
  try {
    const {checkedSummary} = await model(), {createRecoveryView} = await import('../src/features/agent-recovery/view.mjs');
    const task = record(); task.checkedAt = 20; task.state = checkedSummary(task, response({status: 'completed', done: true, pending: [], text: '<img src=x onerror=executeTool()>服务端真实文本', reason: 'configuration_changed'}));
    let checked = 0; const row = createRecoveryView({record: task, scope, document: dom.window.document, onCheck: () => checked++});
    assert.match(row.textContent, /不代表画布产物已保存/); assert.equal(row.querySelectorAll('button').length, 1);
    assert.equal(row.querySelector('pre').textContent, task.state.text); assert.equal(row.querySelector('img'), null);
    assert.match(row.querySelector('.agent-recovery-reason').textContent, /执行配置已变化/);
    assert.equal(row.textContent.includes('configuration_changed'), false);
    row.querySelector('button').click(); assert.equal(checked, 1);
    task.state.reason = 'future_protocol_reason';
    const diagnostic = createRecoveryView({record: task, scope, document: dom.window.document, onCheck: () => {}});
    assert.equal(diagnostic.querySelector('.agent-recovery-reason').textContent.includes('future_protocol_reason'), false);
    assert.equal(diagnostic.querySelector('details pre').textContent, 'future_protocol_reason');
    task.state = checkedSummary(task, response({pending: [{callId: 'delegate-call', name: 'agent_delegate'}], delegation: {
      callId: 'delegate-call', tasks: [
        {taskId: 'review', title: '<img src=x>审查', dependsOn: [], status: 'unknown', started: true, error: 'request_outcome_unknown'},
        {taskId: 'plan', title: '镜头计划', dependsOn: ['review'], status: 'not_started', started: false},
      ],
    }}));
    const delegated = createRecoveryView({record: task, scope, document: dom.window.document, onCheck: () => {}});
    assert.equal(delegated.querySelectorAll('.agent-recovery-task').length, 2);
    assert.equal(delegated.querySelectorAll('button').length, 1);
    assert.equal(delegated.querySelector('img'), null);
    assert.match(delegated.textContent, /执行结果未知/);
    assert.match(delegated.textContent, /模型请求结果尚未确认/);
    assert.equal(delegated.textContent.includes('request_outcome_unknown'), false);
    assert.match(delegated.textContent, /依赖：<img src=x>审查/);
    assert.match(delegated.textContent, /不会自动继续子任务或执行工具/);
  } finally {dom.window.close();}
});

test('delegation recovery retains only a bound, valid dependency summary and leaves trusted state on rejection', async () => {
  const {checkedSummary, createRecoveryController} = await model();
  const task = record(), pending = [{callId: 'delegate-call', name: 'agent_delegate'}];
  const delegation = {callId: 'delegate-call', tasks: [
    {taskId: 'read', title: '读取素材', dependsOn: [], status: 'failed', started: true, error: '无法读取 data:image/jpeg;base64,secret'},
    {taskId: 'plan', title: '镜头计划', dependsOn: ['read'], status: 'skipped', started: false, blockedBy: ['read'], input: 'private input', response: {text: 'not public'}},
  ]};
  const summary = checkedSummary(task, response({pending, delegation}));
  assert.equal(summary.delegation.tasks[1].input, undefined);
  assert.equal(summary.delegation.tasks[1].response, undefined);
  assert.equal(summary.delegation.tasks[0].error.includes('base64'), false);
  assert.deepEqual(summary.delegation.tasks[1].blockedBy, ['read']);
  for (const corrupt of [
    value => {value.callId = 'different-call';},
    value => {value.tasks[1].taskId = 'read';},
    value => {value.tasks[0].dependsOn = ['plan'];},
    value => {value.tasks[1].dependsOn = ['missing'];},
    value => {value.tasks[0].status = 'completed';},
    value => {value.tasks[1].blockedBy = ['unrelated'];},
  ]) {
    const broken = structuredClone(delegation); corrupt(broken);
    task.state = summary;
    const controller = createRecoveryController({isCurrent: () => true, persist: async () => {}, request: async () => response({pending, delegation: broken})});
    assert.equal(await controller.check(task, scope), false);
    assert.equal(task.state, summary);
    assert.match(task.readError, /子任务核对响应无效/);
  }
});
