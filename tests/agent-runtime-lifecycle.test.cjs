const test = require('node:test');
const assert = require('node:assert/strict');
const {AgentRuntime} = require('../server/agent.cjs');

const call = (name, args, id) => ({type: 'function_call', name, arguments: JSON.stringify(args), call_id: id});
const message = text => ({type: 'message', role: 'assistant', content: [{type: 'output_text', text}]});
const reply = output => ({status: 'completed', output});
const age = session => { session.updated = Date.now() - 31 * 60 * 1000; };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

test('long browser generation retains the original continuation without resubmitting external work', async () => {
  const requests = [];
  const runtime = new AgentRuntime({model: 'fixture', client: {responses: {create: async request => {
    requests.push(structuredClone(request));
    return reply(requests.length === 1 ? [call('generation_submit', {kind: 'video.generate', nodeId: 'target', prompt: 'night'}, 'generate-once')] : [message('任务回执已接收')]);
  }}}});
  const first = await runtime.start({message: '生成这个视频'});
  const session = runtime.sessions.get(first.sessionId);
  age(session);
  runtime.prune();
  assert.equal(runtime.sessions.get(first.sessionId), session);
  assert.equal(session.controller.signal.aborted, false);
  assert.deepEqual(session.pending.map(item => item.callId), ['generate-once']);
  const finished = await runtime.resume(first.sessionId, [{callId: 'generate-once', result: {taskId: 'provider-existing-job', status: 'succeeded'}}]);
  assert.equal(finished.done, true);
  assert.equal(requests.length, 2);
  const outputs = requests[1].input.filter(item => item.type === 'function_call_output');
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].call_id, 'generate-once');
  assert.equal(JSON.parse(outputs[0].output).taskId, 'provider-existing-job');
  await assert.rejects(runtime.resume(first.sessionId, [{callId: 'generate-once', result: {taskId: 'provider-existing-job'}}]), /结束/);
  assert.equal(requests.length, 2);
});

test('another request cannot prune a slow in-flight model and turn its late response into cancellation', async () => {
  const held = gate();
  const runtime = new AgentRuntime({model: 'fixture', client: {responses: {create: async () => held.promise}}});
  const running = runtime.start({message: '慢速规划'});
  const session = [...runtime.sessions.values()][0];
  assert.equal(session.busy, true);
  age(session);
  runtime.prune();
  assert.equal(runtime.sessions.get(session.id), session);
  assert.equal(session.controller.signal.aborted, false);
  held.resolve(reply([message('迟到但有效的结论')]));
  assert.equal((await running).done, true);
  age(session);
  runtime.prune();
  assert.equal(runtime.sessions.has(session.id), false);
});

test('slow delegated work survives parent pruning and still feeds server canonical aggregation', async () => {
  const held = gate(), entered = gate();
  let parentRequests = 0, workerRequests = 0;
  const runtime = new AgentRuntime({model: 'fixture', client: {responses: {create: async request => {
    if (request.instructions.includes('isolated read-only specialist')) {
      workerRequests++;
      entered.resolve();
      return held.promise;
    }
    parentRequests++;
    return reply(parentRequests === 1 ? [call('agent_delegate', {tasks: [{id: 'review', title: '审查', instructions: '只读检查'}]}, 'batch')] : [message('已读取真实子结论')]);
  }}}});
  const parent = await runtime.start({message: '审查当前镜头'});
  const input = {sessionId: parent.sessionId, callId: 'batch', taskId: 'review'};
  const child = runtime.delegateStart(input);
  await entered.promise;
  const session = runtime.sessions.get(parent.sessionId);
  age(session);
  runtime.prune();
  assert.equal(session.controller.signal.aborted, false);
  held.resolve(reply([message('实际子结论')]));
  assert.equal((await child).status, 'completed');
  assert.equal((await runtime.delegateStart(input)).status, 'completed');
  assert.equal(workerRequests, 1);
  const aggregate = runtime.delegateResult({sessionId: parent.sessionId, callId: 'batch'});
  assert.equal(aggregate.status, 'completed');
  assert.equal(aggregate.tasks[0].response.text, '实际子结论');
  assert.equal((await runtime.resume(parent.sessionId, [{callId: 'batch', result: {status: 'completed', tasks: []}}])).done, true);
  assert.equal(parentRequests, 2);
});

test('explicit cancellation stays terminal and aged cancelled or idle sessions are cleaned', async () => {
  let requests = 0;
  const runtime = new AgentRuntime({model: 'fixture', client: {responses: {create: async () => { requests++; return reply([call('canvas_read', {}, 'read')]); }}}});
  const first = await runtime.start({message: '检查'});
  const session = runtime.sessions.get(first.sessionId);
  runtime.cancel(first.sessionId);
  age(session);
  runtime.prune();
  assert.equal(runtime.sessions.has(first.sessionId), false);
  await assert.rejects(runtime.resume(first.sessionId, [{callId: 'read', result: {nodes: []}}]), /结束/);
  assert.equal(requests, 1);
  const idle = {id: 'idle', updated: Date.now() - 31 * 60 * 1000, pending: [], busy: false, controller: new AbortController()};
  runtime.sessions.set(idle.id, idle);
  runtime.prune();
  assert.equal(runtime.sessions.has(idle.id), false);
  assert.equal(idle.controller.signal.aborted, true);
});

test('process replacement rejects orphan continuations without replaying model or browser writes', async () => {
  let requests = 0;
  const client = {responses: {create: async () => { requests++; return reply([call('generation_submit', {kind: 'video.generate', nodeId: 'target', prompt: 'night'}, 'generate')]); }}};
  const previous = new AgentRuntime({model: 'fixture', client});
  const first = await previous.start({message: '生成视频'});
  const restarted = new AgentRuntime({model: 'fixture', client});
  await assert.rejects(restarted.resume(first.sessionId, [{callId: 'generate', result: {taskId: 'existing-provider-task'}}]), /会话已结束或不存在/);
  assert.equal(requests, 1);
  assert.equal(restarted.sessions.size, 0);
  assert.throws(() => restarted.delegateStart({sessionId: first.sessionId, callId: 'unknown', taskId: 'review'}), /不存在/);
  assert.equal(requests, 1);
});

test('session admission rejects excess starts before SDK and keeps all original pending continuations', async () => {
  let requests = 0;
  const runtime = new AgentRuntime({maxSessions: 2, model: 'fixture', client: {responses: {create: async request => {
    requests++;
    return reply(request.input.some(item => item.type === 'function_call_output') ? [message('收到回执')] : [call('canvas_read', {}, 'read-' + requests)]);
  }}}});
  const first = await runtime.start({message: '第一轮'});
  const second = await runtime.start({message: '第二轮'});
  for (const session of runtime.sessions.values()) age(session);
  runtime.prune();
  await assert.rejects(runtime.start({message: '满额新运行'}), error => error.code === 'agent_session_capacity' && error.status === 429);
  assert.equal(requests, 2);
  assert.equal(runtime.sessions.size, 2);
  assert.equal(runtime.sessions.get(second.sessionId).controller.signal.aborted, false);
  assert.equal((await runtime.resume(first.sessionId, [{callId: 'read-1', result: {nodes: []}}])).done, true);
  const third = await runtime.start({message: '终态释放后新运行'});
  assert.equal(runtime.sessions.size, 2);
  assert.equal(runtime.sessions.has(first.sessionId), false);
  assert.equal(runtime.sessions.has(second.sessionId), true);
  assert.equal(runtime.sessions.has(third.sessionId), true);
  assert.equal((await runtime.resume(second.sessionId, [{callId: 'read-2', result: {nodes: []}}])).done, true);
  assert.equal(requests, 5);
});

test('explicit cancellation releases session capacity without waiting for the idle window', async () => {
  let requests = 0;
  const runtime = new AgentRuntime({maxSessions: 1, model: 'fixture', client: {responses: {create: async () => {
    requests++;
    return reply([call('canvas_read', {}, 'read-' + requests)]);
  }}}});
  const first = await runtime.start({message: '待回执运行'});
  runtime.cancel(first.sessionId);
  const next = await runtime.start({message: '取消后新运行'});
  assert.equal(runtime.sessions.size, 1);
  assert.equal(runtime.sessions.has(first.sessionId), false);
  assert.equal(runtime.sessions.has(next.sessionId), true);
  await assert.rejects(runtime.resume(first.sessionId, [{callId: 'read-1', result: {nodes: []}}]), /结束/);
  assert.equal(requests, 2);
});

test('concurrent starts share the admission budget and invalid budgets fail closed', async () => {
  let requests = 0;
  const client = {responses: {create: async () => { requests++; return reply([call('canvas_read', {}, 'read')]); }}};
  for (const maxSessions of [0, -1, 1.5, NaN, '2']) assert.throws(() => new AgentRuntime({model: 'fixture', client, maxSessions}), /budget/);
  const runtime = new AgentRuntime({maxSessions: 2, model: 'fixture', client});
  const results = await Promise.allSettled(Array.from({length: 10}, (_, i) => runtime.start({message: '运行 ' + i})));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.code === 'agent_session_capacity').length, 8);
  assert.equal(runtime.sessions.size, 2);
  assert.equal(requests, 2);
});

test('cancelled but unsettled SDK still owns its slot until late response is discarded', async () => {
  const held = gate(), entered = gate();
  let requests = 0;
  const runtime = new AgentRuntime({maxSessions: 1, model: 'fixture', client: {responses: {create: async () => {
    requests++;
    entered.resolve();
    return requests === 1 ? held.promise : reply([message('新运行完成')]);
  }}}});
  const first = runtime.start({message: '慢模型'});
  await entered.promise;
  const rejected = assert.rejects(first, /已取消/);
  const session = [...runtime.sessions.values()][0];
  runtime.cancel(session.id);
  age(session);
  runtime.prune();
  assert.equal(runtime.sessions.get(session.id), session);
  await assert.rejects(runtime.start({message: '旧模型尚未退出'}), error => error.code === 'agent_session_capacity');
  assert.equal(requests, 1);
  held.resolve(reply([message('禁止接受的迟到结果')]));
  await rejected;
  assert.equal(session.busy, false);
  assert.equal((await runtime.start({message: '旧模型退出后新运行'})).done, true);
  assert.equal(requests, 2);
});
