'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {PassThrough} = require('node:stream');
const {createProtocol} = require('../server/external-agent/protocol.cjs');
const {readLines} = require('../server/external-agent/frames.cjs');
const {argumentsFor, resultFor} = require('../server/external-agent/contracts.cjs');
const initialize = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'QA client', version: '1'}}};
const request = (id, method, params = {}) => ({jsonrpc: '2.0', id, method, params});
test('MCP initialization, ready notification, catalog, unknown methods and errors are bounded', async () => {
  const output = [], connected = []; const protocol = createProtocol({connect: async info => connected.push(info), call: async () => ({read_only: true}), disconnect() {}, send: value => output.push(value)});
  await protocol.receive(request(2, 'tools/list')); assert.equal(output.at(-1).error.message, 'not_initialized');
  await protocol.receive(initialize); assert.equal(output.at(-1).result.protocolVersion, '2025-06-18'); assert.equal(connected.length, 1);
  await protocol.receive(request(3, 'tools/list')); assert.equal(output.at(-1).error.message, 'not_initialized');
  await protocol.receive({jsonrpc: '2.0', method: 'notifications/initialized'});
  await protocol.receive(request(4, 'tools/list')); assert.deepEqual(output.at(-1).result.tools.map(tool => tool.name), ['workspace_status', 'canvas_read']); assert.equal(output.at(-1).result.tools.every(tool => tool.annotations.readOnlyHint), true);
  await protocol.receive(request(5, 'resources/list')); assert.equal(output.at(-1).error.code, -32601);
  await protocol.receive(request(6, 'tools/call', {name: 'generation_submit', arguments: {}})); assert.equal(output.at(-1).error.code, -32602);
  await protocol.receive(request(7, 'tools/call', {name: 'canvas_read', arguments: {url: 'https://invalid.example', root: '/'}})); assert.equal(output.at(-1).error.message, 'invalid_arguments');
  await protocol.receive(request(8, 'ping')); assert.deepEqual(output.at(-1).result, {});
  await protocol.receive(request(8, 'ping')); assert.equal(output.at(-1).error.message, 'Duplicate request id');
  await protocol.receive([{jsonrpc: '2.0', method: 'ping'}]); assert.equal(output.at(-1).error.code, -32600); protocol.close();
});
test('cancel and close do not return late tool data; arbitrary failure messages are redacted', async () => {
  const output = []; let finish;
  const protocol = createProtocol({connect: async () => {}, call: async (name, args) => args.offset === 1 ? Promise.reject(Error('PRIVATE_KEY_AND_PATH')) : new Promise(resolve => {finish = resolve;}), disconnect() {}, send: value => output.push(value)});
  await protocol.receive(initialize); await protocol.receive({jsonrpc: '2.0', method: 'notifications/initialized'});
  const read = protocol.receive(request(2, 'tools/call', {name: 'canvas_read', arguments: {}}));
  await protocol.receive({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 2}}); finish({private: 'PRIVATE_DATA'}); await read;
  assert.equal(output.at(-1).result.isError, true); assert.equal(output.at(-1).result.content[0].text, 'cancelled');
  await protocol.receive(request(3, 'tools/call', {name: 'canvas_read', arguments: {offset: 1}})); assert.equal(output.at(-1).result.content[0].text, 'host_unavailable'); assert.doesNotMatch(JSON.stringify(output), /PRIVATE/);
  const closing = protocol.receive(request(4, 'tools/call', {name: 'canvas_read', arguments: {}})); protocol.close(); const before = output.length; finish({private: 'PRIVATE'}); await closing; assert.equal(output.length, before);
});
test('parallel initialize cannot reset the first connecting session; unsupported version negotiates latest', async () => {
  const output = []; let finish, calls = 0;
  const protocol = createProtocol({connect: () => new Promise(resolve => {calls++; finish = resolve;}), call() {}, disconnect() {}, send: value => output.push(value)});
  const first = protocol.receive({...initialize, params: {...initialize.params, protocolVersion: 'future'}});
  await protocol.receive({...initialize, id: 2}); assert.equal(output.at(-1).error.message, 'already_initialized'); finish(); await first; assert.equal(calls, 1); assert.equal(output.at(-1).result.protocolVersion, '2025-11-25'); protocol.close();
});
test('line framing preserves split UTF-8 and rejects oversized/incomplete frames', () => {
  const stream = new PassThrough(), lines = []; let failures = 0; readLines(stream, line => lines.push(line), () => failures++, 32);
  const bytes = Buffer.from('{"text":"节点"}\n'); stream.write(bytes.subarray(0, 11)); stream.write(bytes.subarray(11)); assert.deepEqual(JSON.parse(lines[0]), {text: '节点'}); stream.write('a'.repeat(33)); assert.equal(failures, 1);
  const partial = new PassThrough(); readLines(partial, () => {}, () => failures++); partial.write('{}'); partial.emit('end'); assert.equal(failures, 2);
});
test('schemas reject injected fields, coercion and unbounded/foreign host results', () => {
  for (const args of [{offset: 1.5}, {limit: 51}, {expected_revision: ['a'.repeat(64)]}, {path: '/'}, {shell: 'run'}]) assert.throws(() => argumentsFor('canvas_read', args), {code: 'invalid_arguments'});
  const scope = {projectId: 'qa'}, result = {project_id: 'qa', revision: 'a'.repeat(64), read_only: true, node_count: 0, edge_count: 0};
  assert.deepEqual(resultFor('workspace_status', result, scope), result);
  for (const input of [{...result, apiKey: 'private'}, {...result, project_id: 'other'}, {...result, revision: ['a'.repeat(64)]}]) assert.throws(() => resultFor('workspace_status', input, scope), {code: 'invalid_host_result'});
  assert.throws(() => resultFor('canvas_read', {...result, offset: 0, next_offset: null, nodes: [{id: 'node', type: 'text', title: 'x', x: 0, y: 0, width: 10, height: 10, selected: false, prompt: 'private'}]}, scope), {code: 'invalid_host_result'});
});
