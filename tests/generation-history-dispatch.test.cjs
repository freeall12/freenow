const test = require('node:test');
const assert = require('node:assert/strict');

test('history gate persists the current task after the host receipt, including retried hooks', async () => {
  const {createHistoryDispatchGate} = await import('../src/features/generation-history/dispatch.mjs');
  const calls = [], history = {captureSubmission: async job => calls.push('history:' + job.id)};
  const gate = createHistoryDispatchGate({ready: async () => history, getJob: id => ({id})});
  const options = gate({beforeDispatch: () => true, beforeDispatchReady: async ({jobId}) => calls.push('host:' + jobId)});
  await options.beforeDispatchReady({jobId: 'first'});
  await gate(options).beforeDispatchReady({jobId: 'retry'});
  assert.deepEqual(calls, ['host:first', 'history:first', 'host:retry', 'history:retry']);
  assert.equal(options.beforeDispatch(), true);
});

test('failed host/history persistence or cancellation prevents the gate from completing', async () => {
  const {createHistoryDispatchGate} = await import('../src/features/generation-history/dispatch.mjs');
  let writes = 0;
  const gate = createHistoryDispatchGate({ready: async () => ({captureSubmission: async () => {writes++; throw Error('disk full');}}), getJob: id => ({id})});
  await assert.rejects(gate({beforeDispatchReady: async () => {throw Error('receipt failed');}}).beforeDispatchReady({jobId: 'a'}), /receipt failed/);
  assert.equal(writes, 0);
  await assert.rejects(gate().beforeDispatchReady({jobId: 'b'}), /disk full/);
  assert.equal(writes, 1);
  const abort = new AbortController();
  await assert.rejects(gate({beforeDispatchReady: async () => abort.abort(Error('cancelled'))}).beforeDispatchReady({jobId: 'c', signal: abort.signal}), /cancelled/);
  assert.equal(writes, 1);
});
