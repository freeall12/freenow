const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/features/agent-delegation/runner.mjs');
const tasks = ids => ids.map(id => ({id, title: `Task ${id}`, instructions: `Read ${id}`}));
const call = (id, name = 'canvas_read', args = {}) => ({callId: id, name, args, mutates: false});
const waiting = (taskId, round, calls) => ({taskId, title: taskId, status: 'waiting', response: {sessionId: `child-${taskId}`, done: false, text: `${taskId} round ${round}`, round, calls}});
const completed = taskId => ({taskId, status: 'completed', response: {text: `${taskId} complete`}});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const until = async predicate => {for (let i = 0; i < 100; i++) {if (predicate()) return; await Promise.resolve();} assert.fail('microtask condition did not settle');};
const identity = {sessionId: 'parent-session', callId: 'parent-call'};

test('delegation runs at most two tasks and keeps visual payloads only in transient continuation results', async () => {
  const {runDelegation} = await load(), a = deferred(), b = deferred(), starts = [], requests = [], snapshots = [], budgets = new Map();
  let active = 0, peak = 0;
  const canonical = {status: 'completed', tasks: ['a', 'b', 'c'].map(taskId => ({taskId, title: `Task ${taskId}`, status: 'completed', response: {text: `${taskId} complete`}}))};
  const run = runDelegation({...identity, tasks: tasks(['a', 'b', 'c']), allowedTools: ['canvas_inspect_media'],
    onChange: snapshot => snapshots.push(snapshot),
    request: async (action, body) => {
      assert.equal(body.sessionId, identity.sessionId); assert.equal(body.callId, identity.callId); requests.push({action, body});
      if (action === 'delegated-start') {
        active++; peak = Math.max(peak, active); starts.push(body.taskId);
        if (body.taskId === 'a') await a.promise; if (body.taskId === 'b') await b.promise;
        return waiting(body.taskId, 1, [call(`${body.taskId}-1`, 'canvas_inspect_media', {id: body.taskId}), call(`${body.taskId}-2`, 'canvas_inspect_media', {id: body.taskId})]);
      }
      if (action === 'delegated-continue') {active--; assert(body.results.every(result => result.mediaInputs[0].imageUrl.includes('PIXELS'))); return completed(body.taskId);}
      return canonical;
    },
    execute: async (_name, args, {signal, visualBudget}) => {
      assert.equal(signal.aborted, false);
      if (budgets.has(args.id)) assert.equal(budgets.get(args.id), visualBudget);
      else {assert.equal(visualBudget.remaining, 700000); budgets.set(args.id, visualBudget);}
      visualBudget.remaining -= 100; return {privateBody: 'DO_NOT_PERSIST_RESULT', nodeId: args.id};
    },
    prepareResults: results => results.map(result => ({...result, mediaInputs: [{imageUrl: 'data:image/jpeg;base64,PIXELS'}]})),
  });
  await until(() => starts.length === 2); assert.deepEqual(starts, ['a', 'b']);
  a.resolve(); await until(() => starts.length === 3); assert.equal(peak, 2); b.resolve();
  assert.equal(await run, canonical); assert.equal(requests.filter(item => item.action === 'delegated-result').length, 1);
  assert.equal(new Set(budgets.values()).size, 3);
  const last = snapshots.at(-1); assert(last.every(row => row.status === 'completed' && row.calls.every(item => item.status === 'completed')));
  const serialized = JSON.stringify(snapshots); assert(!serialized.includes('PIXELS')); assert(!serialized.includes('DO_NOT_PERSIST_RESULT'));
  assert(snapshots[0].every(row => row.status === 'queued')); assert(!Object.hasOwn(last[0].calls[0], 'args')); assert(!Object.hasOwn(last[0].calls[0], 'result'));
});

test('delegation rejects a whole unsafe/duplicate/oversized round and settles sixth-round receipts as limited', async () => {
  const {runDelegation} = await load();
  for (const scenario of ['mutation', 'repeated-id', 'too-many', 'seventh-round']) {
    let executions = 0, continuation = 0, aggregates = 0;
    await assert.rejects(runDelegation({...identity, tasks: tasks(['a']), allowedTools: ['canvas_read', 'canvas_update'], execute: async () => {executions++; return {};},
      request: async action => {
        if (action === 'delegated-result') {aggregates++; throw Error('server still waiting');}
        if (action === 'delegated-continue') {continuation++; return waiting('a', 2, [call('same')]);}
        if (scenario === 'mutation') return waiting('a', 1, [call('safe'), call('unsafe', 'canvas_update')]);
        if (scenario === 'too-many') return waiting('a', 1, Array.from({length: 25}, (_, i) => call(`c${i}`)));
        if (scenario === 'seventh-round') return waiting('a', 7, [call('same')]);
        return waiting('a', 1, [call('same')]);
      },
    }), error => error.code === 'delegation_incomplete');
    assert.equal(executions, scenario === 'repeated-id' ? 1 : 0); assert.equal(continuation, scenario === 'repeated-id' ? 1 : 0); assert.equal(aggregates, 1);
  }
  let executions = 0, continuations = 0, last;
  const canonical = {status: 'failed', tasks: [{taskId: 'a', title: 'Task a', status: 'limited', response: {text: 'Needs more work'}, error: 'round_limit'}]};
  const result = await runDelegation({...identity, tasks: tasks(['a']), allowedTools: ['canvas_read'], onChange: value => {last = value;},
    execute: async () => {executions++; return {};}, request: async action => {
      if (action === 'delegated-start') return waiting('a', 1, [call('c1')]);
      if (action === 'delegated-result') return canonical;
      continuations++; return continuations === 6 ? {taskId: 'a', status: 'limited', reason: 'round_limit', response: {text: 'Needs more work'}} : waiting('a', continuations + 1, [call(`c${continuations + 1}`)]);
    },
  });
  assert.equal(result, canonical); assert.equal(executions, 6); assert.equal(continuations, 6);
  assert.equal(last[0].status, 'failed'); assert.equal(last[0].reason, 'limited');
});

test('a lost continuation is never retried, other tasks finish, and unsettled server aggregation stays an error', async () => {
  const {runDelegation} = await load(), requested = [], snapshots = [];
  await assert.rejects(runDelegation({...identity, tasks: tasks(['a', 'b']), allowedTools: ['canvas_read'], execute: async () => ({read: true}), onChange: value => snapshots.push(value),
    request: async (action, body) => {
      requested.push(`${action}:${body.taskId || ''}`);
      if (action === 'delegated-start') return body.taskId === 'a' ? waiting('a', 1, [call('read')]) : completed('b');
      if (action === 'delegated-continue') throw Error('network lost after provider consumption');
      throw Error('batch not terminal');
    },
  }), error => error.code === 'delegation_incomplete');
  assert.equal(requested.filter(name => name === 'delegated-continue:a').length, 1);
  assert.equal(requested.filter(name => name === 'delegated-start:a').length, 1);
  assert.equal(snapshots.at(-1)[0].status, 'unknown'); assert.equal(snapshots.at(-1)[1].status, 'completed');
});

test('cancellation stops both workers and the queued task and ignores late read completions', async () => {
  const {runDelegation} = await load(), controller = new AbortController(), late = deferred(), requested = [], snapshots = [];
  let executions = 0;
  const run = runDelegation({...identity, tasks: tasks(['a', 'b', 'c']), signal: controller.signal, allowedTools: ['canvas_read'],
    onChange: value => snapshots.push(value), execute: async () => {executions++; return late.promise;},
    request: async (action, body) => {requested.push(`${action}:${body.taskId || ''}`); return waiting(body.taskId, 1, [call(body.taskId)]);},
  });
  await until(() => executions === 2); controller.abort(); await assert.rejects(run, {name: 'AbortError'});
  assert(snapshots.at(-1).every(row => row.status === 'cancelled' && row.calls.every(item => item.status === 'cancelled')));
  late.resolve({secret: 'late media'}); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(requested, ['delegated-start:a', 'delegated-start:b']);
  assert(!JSON.stringify(snapshots).includes('late media'));
});

test('canonical terminal aggregation repairs a lost continuation response without repeating model requests', async () => {
  const {runDelegation} = await load(), requested = [], snapshots = [];
  const canonical = {status: 'completed', tasks: [{taskId: 'a', title: 'Task a', status: 'completed', response: {text: 'Server confirmed complete data:image/png;base64,PRIVATE_PIXELS'}}]};
  const result = await runDelegation({...identity, tasks: tasks(['a']), allowedTools: ['canvas_read'],
    onChange: snapshot => snapshots.push(snapshot), execute: async () => ({nodeId: 'real-node'}),
    request: async action => {
      requested.push(action);
      if (action === 'delegated-start') return waiting('a', 1, [call('read-a')]);
      if (action === 'delegated-continue') throw Error('reply lost after server completion');
      return canonical;
    },
  });
  assert.equal(result, canonical);
  assert(snapshots.some(snapshot => snapshot[0].status === 'unknown'));
  const last = snapshots.at(-1)[0];
  assert.equal(last.status, 'completed'); assert.equal(Object.hasOwn(last, 'error'), false);
  assert.equal(last.text, 'Server confirmed complete [media body omitted]');
  assert.deepEqual(last.calls, [{callId: 'read-a', name: 'canvas_read', status: 'completed'}]);
  assert(!JSON.stringify(snapshots).includes('PRIVATE_PIXELS'));
  assert.deepEqual(requested, ['delegated-start', 'delegated-continue', 'delegated-state', 'delegated-result']);
});

test('delegation validates the complete DAG before publishing or requesting any child', async () => {
  const {runDelegation} = await load();
  const graph = tasks(['a', 'b']);
  const invalid = [
    [...graph, {...graph[0]}], tasks(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
    [{...graph[0], dependsOn: ['missing']}, graph[1]], [{...graph[0], dependsOn: ['a']}, graph[1]],
    [{...graph[0], dependsOn: ['b']}, {...graph[1], dependsOn: ['a']}],
    [{...graph[0], dependsOn: ['b', 'b']}, graph[1]], [{...graph[0], dependsOn: 'b'}, graph[1]],
    [{...graph[0], dependsOn: ['b', 'c', 'd', 'e', 'f', 'g']}, graph[1]], [{...graph[0], instructions: ' '}, graph[1]],
  ];
  let requests = 0, changes = 0;
  for (const value of invalid) await assert.rejects(runDelegation({...identity, tasks: value,
    onChange: () => changes++, request: async () => requests++, execute: async () => ({})}));
  assert.equal(requests, 0); assert.equal(changes, 0);
});

test('shuffled six-node DAG runs prerequisites first and keeps independent siblings within two workers', async () => {
  const {runDelegation} = await load(), root = deferred(), sibling = deferred(), leaf = deferred(), starts = [], snapshots = [];
  const graph = tasks(['finish', 'leaf', 'branch', 'root', 'sibling', 'independent']);
  graph[0].dependsOn = ['leaf', 'branch']; graph[1].dependsOn = ['root']; graph[2].dependsOn = ['root'];
  const done = new Set(); let active = 0, peak = 0;
  const canonical = {status: 'completed', tasks: graph.map(task => ({taskId: task.id, title: task.title, dependsOn: task.dependsOn || [], status: 'completed', response: {text: `${task.id} complete`}}))};
  const run = runDelegation({...identity, tasks: graph, execute: async () => ({}), onChange: snapshot => snapshots.push(snapshot),
    request: async (action, body) => {
      if (action === 'delegated-result') return canonical;
      assert.equal(action, 'delegated-start'); const task = graph.find(item => item.id === body.taskId);
      assert((task.dependsOn || []).every(id => done.has(id))); starts.push(body.taskId); active++; peak = Math.max(peak, active);
      if (body.taskId === 'root') await root.promise; if (body.taskId === 'sibling') await sibling.promise; if (body.taskId === 'leaf') await leaf.promise;
      active--; done.add(body.taskId); return {...completed(body.taskId), dependsOn: task.dependsOn || []};
    },
  });
  await until(() => starts.length === 2); assert.deepEqual(starts, ['root', 'sibling']);
  assert.equal(snapshots[0][0].status, 'blocked'); assert.deepEqual(snapshots[0][0].dependsOn, ['leaf', 'branch']);
  root.resolve(); await until(() => starts.includes('leaf')); assert(!starts.includes('finish'));
  sibling.resolve(); await until(() => starts.includes('branch')); await until(() => starts.includes('independent'));
  assert(!starts.includes('finish')); leaf.resolve(); assert.equal(await run, canonical);
  assert.equal(peak, 2); assert.equal(starts.at(-1), 'finish'); assert(snapshots.at(-1).every(row => row.status === 'completed'));
});

test('failed prerequisites obtain actual skipped receipts while independent work continues', async () => {
  const {runDelegation} = await load(), delayed = deferred(), starts = [], snapshots = [];
  const graph = tasks(['grandchild', 'child', 'failed', 'sibling']); graph[0].dependsOn = ['child']; graph[1].dependsOn = ['failed'];
  const outcomes = [
    {taskId: 'grandchild', dependsOn: ['child'], status: 'skipped', blockedBy: ['child'], error: 'prerequisite skipped'},
    {taskId: 'child', dependsOn: ['failed'], status: 'skipped', blockedBy: ['failed'], error: 'prerequisite failed'},
    {taskId: 'failed', dependsOn: [], status: 'failed', error: 'provider failure'},
    {...completed('sibling'), dependsOn: []},
  ];
  const canonical = {status: 'partial_failure', tasks: outcomes};
  const run = runDelegation({...identity, tasks: graph, execute: async () => assert.fail('no child tools expected'),
    onChange: snapshot => snapshots.push(snapshot), request: async (action, body) => {
      if (action === 'delegated-result') return canonical;
      assert.equal(action, 'delegated-start'); starts.push(body.taskId); if (body.taskId === 'sibling') await delayed.promise;
      return outcomes.find(task => task.taskId === body.taskId);
    },
  });
  await until(() => starts.includes('grandchild')); assert.deepEqual(starts, ['failed', 'sibling', 'child', 'grandchild']);
  await until(() => snapshots.at(-1)[0].status === 'skipped');
  assert.equal(snapshots.at(-1)[0].status, 'skipped'); assert.deepEqual(snapshots.at(-1)[0].blockedBy, ['child']);
  delayed.resolve(); assert.equal(await run, canonical); assert.equal(snapshots.at(-1)[3].status, 'completed');
});

test('cancellation interrupts waiting dependencies without starting them', async () => {
  const {runDelegation} = await load(), controller = new AbortController(), delayed = deferred(), starts = [], snapshots = [];
  const graph = tasks(['child', 'root', 'sibling']); graph[0].dependsOn = ['root'];
  const run = runDelegation({...identity, tasks: graph, signal: controller.signal, execute: async () => ({}),
    onChange: snapshot => snapshots.push(snapshot), request: async (_action, body) => {starts.push(body.taskId); await delayed.promise; return completed(body.taskId);},
  });
  await until(() => starts.length === 2); controller.abort(); await assert.rejects(run, {name: 'AbortError'});
  assert.deepEqual(starts, ['root', 'sibling']); assert.equal(snapshots[0][0].status, 'blocked');
  assert(snapshots.at(-1).every(row => row.status === 'cancelled')); delayed.resolve();
});

test('canonical aggregation rejects forged dependencies and skips before changing settled traces', async () => {
  const {runDelegation} = await load(), graph = tasks(['a', 'b', 'c']); graph[1].dependsOn = ['a'];
  const outcomes = [
    {taskId: 'a', dependsOn: [], status: 'failed', error: 'failed'},
    {taskId: 'b', dependsOn: ['a'], status: 'skipped', blockedBy: ['a'], error: 'failed dependency'},
    {...completed('c'), dependsOn: []},
  ];
  for (const forge of [
    value => {value[1].dependsOn = [];}, value => {value[1].blockedBy = ['c'];},
    value => {value[1].blockedBy = [];}, value => {value[1].response = {text: 'fabricated conclusion'};},
    value => {value[1] = {...completed('b'), dependsOn: ['a']};},
    value => {value[2] = {taskId: 'c', dependsOn: [], status: 'skipped', blockedBy: ['a']};},
  ]) {
    const forged = structuredClone(outcomes); forge(forged); let last;
    await assert.rejects(runDelegation({...identity, tasks: graph, execute: async () => ({}), onChange: snapshot => last = snapshot,
      request: async (action, body) => action === 'delegated-result' ? {status: 'partial_failure', tasks: forged} : outcomes.find(task => task.taskId === body.taskId),
    }), error => error.code === 'delegation_incomplete');
    assert.deepEqual(last.map(row => row.status), ['failed', 'skipped', 'completed']); assert.deepEqual(last[1].blockedBy, ['a']);
  }
});

test('lost prerequisite receipts keep descendants blocked while unrelated siblings finish', async () => {
  const {runDelegation} = await load(), graph = tasks(['grandchild', 'child', 'root', 'sibling']);
  graph[0].dependsOn = ['child']; graph[1].dependsOn = ['root'];
  for (const lostAt of ['delegated-start', 'delegated-continue']) {
    const requested = [], snapshots = []; let executions = 0;
    await assert.rejects(runDelegation({...identity, tasks: graph, allowedTools: ['canvas_read'], execute: async () => {executions++; return {};},
      onChange: snapshot => snapshots.push(snapshot), request: async (action, body) => {
        requested.push(`${action}:${body.taskId || ''}`);
        if (action === 'delegated-result') throw Error('server prerequisite or descendants remain pending');
        if (body.taskId === 'sibling') return completed('sibling');
        assert.equal(body.taskId, 'root');
        if (action === 'delegated-state') return lostAt === 'delegated-continue' ? {...waiting('root', 1, [call('root-read')]), started: true} : {taskId: 'root', status: 'running', started: true};
        if (action === lostAt) throw Error('reply lost; actual server state unknown');
        return waiting('root', 1, [call('root-read')]);
      },
    }), error => error.code === 'delegation_incomplete');
    assert.deepEqual(snapshots.at(-1).map(row => row.status), ['blocked', 'blocked', 'unknown', 'completed']);
    assert.equal(requested.filter(name => name === 'delegated-start:root').length, 1);
    assert(!requested.some(name => name.includes(':child') || name.includes(':grandchild')));
    assert.equal(requested.filter(name => name === 'delegated-result:').length, 1);
    assert.equal(requested.filter(name => name === 'delegated-state:root').length, 1);
    assert.equal(executions, lostAt === 'delegated-continue' ? 1 : 0);
  }
});

test('one pure state read recovers a lost terminal or a new round and resumes dependent work without repeats', async () => {
  const {runDelegation} = await load(), graph = tasks(['child', 'root']); graph[0].dependsOn = ['root'];
  for (const recovery of ['completed', 'next-round']) {
    const requested = [], executions = [], snapshots = [];
    const canonical = {status: 'completed', tasks: graph.map(task => ({taskId: task.id, dependsOn: task.dependsOn || [], status: 'completed', response: {text: `${task.id} done`}}))};
    const value = await runDelegation({...identity, tasks: graph, allowedTools: ['canvas_read'], onChange: snapshot => snapshots.push(snapshot),
      execute: async (_name, args) => {executions.push(args.round); return {};}, request: async (action, body) => {
        requested.push(`${action}:${body.taskId || ''}`);
        if (action === 'delegated-result') return canonical;
        if (body.taskId === 'child') {assert.equal(action, 'delegated-start'); return {...completed('child'), dependsOn: ['root']};}
        if (action === 'delegated-start') return waiting('root', 1, [call('read-1', 'canvas_read', {round: 1})]);
        if (action === 'delegated-state') return recovery === 'completed' ? {...completed('root'), started: true} :
          {...waiting('root', 2, [call('read-2', 'canvas_read', {round: 2})]), started: true};
        if (body.results[0].callId === 'read-1') throw Error('continuation reply lost');
        assert.equal(body.results[0].callId, 'read-2'); return completed('root');
      },
    });
    assert.equal(value, canonical); assert.deepEqual(executions, recovery === 'completed' ? [1] : [1, 2]);
    assert.equal(requested.filter(name => name === 'delegated-state:root').length, 1);
    assert.equal(requested.filter(name => name === 'delegated-start:root').length, 1);
    assert.equal(requested.filter(name => name === 'delegated-continue:root').length, recovery === 'completed' ? 1 : 2);
    assert(requested.indexOf('delegated-state:root') < requested.indexOf('delegated-start:child'));
    assert(snapshots.at(-1).every(row => row.status === 'completed'));
  }
});
