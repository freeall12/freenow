'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const net = require('node:net');
const {createBroker} = require('../server/external-agent/broker.cjs');
const {createSocketClient} = require('../server/external-agent/socket-client.cjs');
const {readLines} = require('../server/external-agent/frames.cjs');
const scope = {pageId: 'page-qa', projectId: 'project-qa', title: 'Public QA'};
const result = {project_id: scope.projectId, revision: 'a'.repeat(64), read_only: true, node_count: 0, edge_count: 0};
async function fixture(t, options = {}) {
  const directory = await fs.realpath(await fs.mkdtemp('/tmp/freenow-mcp-'));
  const broker = createBroker({directory, getWorkspace: () => scope, dispatch: async () => result, ...options}); await broker.start();
  t.after(async () => {await broker.close(); await fs.rm(directory, {recursive: true, force: true});});
  const client = createSocketClient(broker.socketPath); t.after(() => client.close()); await client.connect({name: 'Unverified QA client', version: '1'});
  return {directory, broker, client, id: broker.list()[0].id};
}
test('real private socket requires explicit per-client authorization, expires and revokes', async t => {
  let time = 0, reads = 0; const f = await fixture(t, {now: () => time, ttl: 1000, dispatch: async () => {reads++; return result;}});
  assert.equal((await fs.stat(f.directory)).mode & 0o777, 0o700); assert.equal((await fs.stat(f.broker.socketPath)).mode & 0o777, 0o600);
  await assert.rejects(f.client.call('workspace_status', {}), {code: 'authorization_required'}); assert.equal(reads, 0);
  f.broker.approve(f.id, scope); assert.deepEqual(await f.client.call('workspace_status', {}), result);
  time = 1001; await assert.rejects(f.client.call('workspace_status', {}), {code: 'authorization_expired'}); assert.equal(reads, 1);
  f.broker.approve(f.id, scope); f.broker.revoke(f.id); await assert.rejects(f.client.call('workspace_status', {}), {code: 'connection_revoked'});
  const other = createSocketClient(f.broker.socketPath); t.after(() => other.close()); await other.connect({name: 'Unverified QA client', version: '1'}); await assert.rejects(other.call('workspace_status', {}), {code: 'authorization_required'});
});
test('switch, revoke, cancel and broker shutdown invalidate delayed host results', async t => {
  let current = {...scope}, finish; const f = await fixture(t, {getWorkspace: () => current, dispatch: () => new Promise(resolve => {finish = resolve;})});
  f.broker.approve(f.id, scope); const pending = f.client.call('workspace_status', {}); while (!finish) await new Promise(setImmediate); current = {...scope, projectId: 'different'}; finish(result); await assert.rejects(pending, {code: 'workspace_changed'});
  current = {...scope}; f.broker.approve(f.id, scope); finish = null; const revoked = f.client.call('workspace_status', {}); while (!finish) await new Promise(setImmediate); f.broker.revoke(f.id); finish(result); await assert.rejects(revoked, {code: 'cancelled'});
  f.broker.approve(f.id, scope); finish = null; const abort = new AbortController(), cancelled = f.client.call('workspace_status', {}, abort.signal); while (!finish) await new Promise(setImmediate); abort.abort(); await assert.rejects(cancelled, {code: 'cancelled'}); finish(result);
  await f.broker.close(); await assert.rejects(f.client.call('workspace_status', {}));
});
test('host result extra fields and arbitrary tools never escape the allowlist', async t => {
  let reads = 0; const f = await fixture(t, {dispatch: async () => {reads++; return {...result, private_file: '/private/value'};}}); f.broker.approve(f.id, scope);
  await assert.rejects(f.client.call('workspace_status', {}), {code: 'invalid_host_result'});
  await assert.rejects(f.client.call('desktop_files_read', {path: '/'}), {code: 'tool_not_supported'}); assert.equal(reads, 1);
});
test('symlink and permissive socket directories fail closed without replacing files', async t => {
  const root = await fs.realpath(await fs.mkdtemp('/tmp/freenow-mcp-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, 'unsafe'), {mode: 0o755}); await fs.symlink(root, path.join(root, 'link'));
  for (const directory of [path.join(root, 'unsafe'), path.join(root, 'link')]) {const broker = createBroker({directory, getWorkspace: () => scope, dispatch() {}}); await assert.rejects(broker.start()); await broker.close();}
});
test('absolute handshake and unapproved deadlines release occupied connection slots', async t => {
  const directory = await fs.realpath(await fs.mkdtemp('/tmp/freenow-mcp-deadline-'));
  const broker = createBroker({directory, getWorkspace: () => scope, dispatch: async () => result, handshakeTimeout: 50, pendingTimeout: 50}); await broker.start();
  t.after(async () => {await broker.close(); await fs.rm(directory, {recursive: true, force: true});});
  const sockets = Array.from({length: 8}, () => net.createConnection(broker.socketPath));
  for (const socket of sockets) {socket.on('error', () => {}); t.after(() => socket.destroy());}
  const closed = sockets.map(socket => once(socket, 'close')); await Promise.all(sockets.map(socket => once(socket, 'connect')));
  for (const socket of sockets) socket.write('{'); await Promise.all(closed);
  const client = createSocketClient(broker.socketPath); t.after(() => client.close()); await client.connect({name: 'Deadline QA', version: '1'}); assert.equal(broker.list().length, 1);
  await new Promise(resolve => setTimeout(resolve, 80)); await assert.rejects(client.call('workspace_status', {}), {code: 'transport_closed'}); assert.equal(broker.list().length, 0);
});
test('actual stdio subprocess initializes, lists exact tools and receives socket-backed data only after approval', async t => {
  const f = await fixture(t); f.client.close();
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server/external-agent/stdio.cjs'), '--socket', f.broker.socketPath], {stdio: ['pipe', 'pipe', 'pipe']});
  t.after(() => child.kill()); let stderr = ''; child.stderr.on('data', bytes => {stderr += bytes;});
  const responses = new Map(), waiting = new Map(); readLines(child.stdout, line => {const value = JSON.parse(line); responses.set(value.id, value); waiting.get(value.id)?.(value);}, () => assert.fail('invalid subprocess frame'), 128 * 1024);
  const send = (id, method, params) => {child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n'); return new Promise(resolve => {if (responses.has(id)) resolve(responses.get(id)); else waiting.set(id, resolve);});};
  const initialized = await send(1, 'initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'Real stdio QA', version: '1'}}); assert.equal(initialized.result.serverInfo.name, 'freenow-local');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assert.deepEqual((await send(2, 'tools/list', {})).result.tools.map(tool => tool.name), ['workspace_status', 'canvas_read']);
  assert.equal((await send(3, 'tools/call', {name: 'workspace_status', arguments: {}})).result.content[0].text, 'authorization_required');
  const entry = f.broker.list().find(item => item.client.name === 'Real stdio QA'); f.broker.approve(entry.id, scope);
  assert.deepEqual((await send(4, 'tools/call', {name: 'workspace_status', arguments: {}})).result.structuredContent, result);
  const exited = once(child, 'exit'); child.stdin.end(); await exited; assert.equal(stderr, '');
});
