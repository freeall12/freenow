'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {closeInOrder} = require('../server/shutdown.cjs');

test('failed persistence still waits for remaining independent stores before reporting failure', async () => {
  const events = [], failure = Error('fixture persistence failure');
  let finishWrite, settled = false;
  const lateWrite = new Promise(resolve => {finishWrite = resolve;});
  const closing = closeInOrder([
    async () => {events.push('agent'); throw failure;},
    async () => {events.push('media-start'); await lateWrite; events.push('media-saved');},
    async () => {events.push('segmentation');},
  ]).then(() => {throw Error('Expected unconfirmed persistence');}, error => {settled = true; return error;});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(events, ['agent', 'media-start']);
  finishWrite();
  const error = await closing;
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [failure]);
  assert.deepEqual(events, ['agent', 'media-start', 'media-saved', 'segmentation']);
});

test('synchronous and asynchronous close failures both retain ordered cleanup', async () => {
  const events = [];
  await assert.rejects(closeInOrder([
    () => {events.push(1); throw Error('fixture sync');},
    async () => {events.push(2); throw Error('fixture async');},
    () => {events.push(3);},
  ]), error => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(events, [1, 2, 3]);
});
