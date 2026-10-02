const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { TaskService } = require('../generation-api.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const output = { outputs: [{ type: 'text', text: 'Provider output' }] };
const deferred = () => { let resolve, reject; const promise = new Promise((ready, failed) => { resolve = ready; reject = failed; }); return { promise, resolve, reject }; };

function inPlaceFixture() {
  const calls = [], receipt = deferred();
  const service = new TaskService({ prepareRequest: async request => { calls.push('prepare'); return request; }, prepareInputs: async request => { calls.push('inputs'); return request; } });
  service.setProvider({ isConfigured: async () => { calls.push('configure'); return true; }, generate: async () => { calls.push('generate'); return output; } });
  const context = { service, inPlace: new Map(), submitJob: (...args) => service.submit(...args), DOMException, Promise };
  const source = fs.readFileSync(require.resolve('../generation-ui.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('  function runInPlace('), source.indexOf('  function videoSignature(')), context);
  service.subscribe(job => {
    const target = context.inPlace.get(job.id); if (!target) return;
    if (job.status === 'succeeded') target.resolve(job);
    else if (['failed', 'cancelled', 'configuration_required'].includes(job.status)) target.reject(Error(job.error || job.status));
  });
  return { service, run: context.runInPlace, calls, receipt };
}

test('in-place submission records task identity synchronously but waits for durable receipt before preparation or provider calls', async () => {
  const f = inPlaceFixture(); let taskId;
  const pending = f.run({ kind: 'text.generate' }, { guard() {} }, { onSubmitted(job) { taskId = job.id; return f.receipt.promise; } });
  assert.equal(taskId, [...f.service.jobs.keys()][0]); await tick(); assert.deepEqual(f.calls, []);
  f.receipt.resolve(); const result = await pending;
  assert.equal(result.id, taskId); assert.deepEqual(f.calls, ['prepare', 'configure', 'inputs', 'generate']);
  const job = f.service.jobs.get(taskId); assert.equal(Object.keys(job).includes('beforeDispatchReady'), false); assert.equal(JSON.stringify(job).includes('beforeDispatchReady'), false);
});

test('failed async or sync host receipt rejects the workflow with zero provider or input preparation calls', async () => {
  for (const asyncFailure of [true, false]) {
    const f = inPlaceFixture();
    const pending = f.run({ kind: 'text.generate' }, { guard() {} }, { onSubmitted() { if (!asyncFailure) throw Error('Receipt failed'); return f.receipt.promise; } });
    const rejected = assert.rejects(pending, /Receipt failed/);
    if (asyncFailure) { await tick(); f.receipt.reject(Error('Receipt failed')); }
    await rejected; await tick(); assert.deepEqual(f.calls, []); assert.equal([...f.service.jobs.values()][0].providerDispatched, undefined);
  }
});

test('cancellation while host receipt is pending cannot dispatch after the receipt later commits', async () => {
  const f = inPlaceFixture(), controller = new AbortController();
  const pending = f.run({ kind: 'text.generate' }, { guard() {} }, { signal: controller.signal, onSubmitted: () => f.receipt.promise });
  const rejected = assert.rejects(pending, /cancelled/); controller.abort(); await rejected;
  f.receipt.resolve(); await tick(); assert.deepEqual(f.calls, []); assert.equal([...f.service.jobs.values()][0].status, 'cancelled');
});

test('source changes during durable acknowledgement are still rejected by the synchronous source guard', async () => {
  const f = inPlaceFixture(); let valid = true;
  const pending = f.run({ kind: 'text.generate' }, { guard() { if (!valid) throw Error('Source changed'); } }, { onSubmitted: () => f.receipt.promise });
  const rejected = assert.rejects(pending, /Source changed/); valid = false; f.receipt.resolve(); await rejected;
  assert.deepEqual(f.calls, []);
});

test('TaskService validates host gate type and retries retain failed host authority', async () => {
  const service = new TaskService(); let dispatched = 0;
  service.setProvider({ generate: async () => { dispatched++; return output; } });
  assert.throws(() => service.submit({ kind: 'text.generate' }, { beforeDispatchReady: 'model input' }), /host function/);
  const job = service.submit({ kind: 'text.generate' }, { beforeDispatchReady: async () => { throw Error('Not durable'); } });
  await tick(); assert.equal(job.status, 'failed'); assert.match(job.error, /Not durable/);
  const retry = service.retry(job.id); await tick(); assert.equal(retry.status, 'failed'); assert.equal(dispatched, 0);
});
