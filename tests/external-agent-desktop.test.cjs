'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createExternalAgentBridge, channel, requestChannel} = require('../desktop/external-agent.cjs');
const {createSocketClient} = require('../server/external-agent/socket-client.cjs');
const {externalAgentQaOptions} = require('../desktop/external-agent-qa.cjs');
const scope = {pageId: 'page-qa', projectId: 'canvas', title: 'Public QA'};
const result = {project_id: scope.projectId, revision: 'b'.repeat(64), read_only: true, node_count: 0, edge_count: 0};
async function fixture(t, options = {}) {
  const directory = await fs.realpath(await fs.mkdtemp('/tmp/freenow-native-mcp-'));
  let handler, available = true; const dialogs = [], frame = {url: 'http://127.0.0.1:4183/'};
  const window = {id: 7, isDestroyed: () => false, webContents: {mainFrame: frame, send(name, input) {if (name === requestChannel) queueMicrotask(() => handler(event, {method: 'reply', args: {requestId: input.requestId, result: {...result}}}));}}};
  const event = {sender: window.webContents, senderFrame: frame};
  const bridge = createExternalAgentBridge({directory, runtimeRoot: path.resolve(__dirname, '..'), executable: process.execPath, getWindow: () => window, isAvailable: () => available, ipcMain: {handle(name, fn) {assert.equal(name, channel); handler = fn;}, removeHandler() {}}, dialog: {async showMessageBox(owner, input) {assert.equal(owner, window); dialogs.push(input); return {response: options.response ?? 0};}}, ...options});
  await bridge.start(); t.after(async () => {await bridge.close(); await fs.rm(directory, {recursive: true, force: true});});
  const invoke = (method, args = {}, sender = event) => handler(sender, {method, args});
  assert.equal((await invoke('register', scope)).registered, true);
  const client = createSocketClient(bridge.socketPath); t.after(() => client.close()); await client.connect({name: 'Native QA client', version: '1'});
  const id = (await invoke('status')).clients[0].id;
  return {bridge, client, id, invoke, window, event, frame, dialogs, setAvailable(value) {available = value;}};
}
test('native bridge requires current main-frame sender and explicit default-cancel authorization', async t => {
  const f = await fixture(t);
  for (const sender of [{...f.event, sender: {}}, {...f.event, senderFrame: {...f.frame}}]) assert.equal((await f.invoke('status', {}, sender)).error.code, 'workspace_unavailable');
  f.frame.url = 'https://invalid.example'; assert.equal((await f.invoke('status')).error.code, 'workspace_unavailable'); f.frame.url = 'http://127.0.0.1:4183/';
  assert.equal((await f.invoke('register', {...scope, projectId: 'another'})).error.code, 'workspace_changed');
  const config = (await f.invoke('status')).config.mcpServers.freenow; assert.deepEqual(config.args, [path.resolve(__dirname, '../server/external-agent/stdio.cjs'), '--socket', f.bridge.socketPath]);
  assert.equal((await f.invoke('approve', {connectionId: f.id})).cancelled, true); assert.equal(f.dialogs[0].defaultId, 0); assert.equal(f.dialogs[0].cancelId, 0); assert.match(f.dialogs[0].detail, /未经身份验证/);
  await assert.rejects(f.client.call('workspace_status', {}), {code: 'authorization_required'});
  assert.equal((await f.invoke('tools/call', {name: 'arbitrary'})).error.code, 'invalid_arguments');
});
test('authorized native IPC returns bounded metadata and reload/close invalidation removes authority', async t => {
  const f = await fixture(t, {response: 1});
  assert.equal((await f.invoke('approve', {connectionId: f.id})).authorized, true); assert.deepEqual(await f.client.call('workspace_status', {}), result);
  f.bridge.invalidate(); await assert.rejects(f.client.call('workspace_status', {}), {code: 'connection_revoked'}); assert.equal((await f.invoke('status')).available, false);
  await f.invoke('register', {...scope, pageId: 'page-reloaded'}); assert.equal((await f.invoke('approve', {connectionId: f.id})).authorized, true);
  f.setAvailable(false); await assert.rejects(f.client.call('workspace_status', {}), {code: 'workspace_unavailable'}); f.setAvailable(true);
  assert.equal((await f.invoke('revoke', {connectionId: f.id})).revoked, true); await assert.rejects(f.client.call('workspace_status', {}), {code: 'connection_revoked'});
  await f.bridge.close(); await assert.rejects(f.client.call('workspace_status', {}));
});
test('page change while native authorization is pending cannot approve the new workspace', async t => {
  let finish;
  const f = await fixture(t, {dialog: {showMessageBox: () => new Promise(resolve => {finish = resolve;})}});
  const authorization = f.invoke('approve', {connectionId: f.id}); while (!finish) await new Promise(setImmediate);
  f.bridge.invalidate(); await f.invoke('register', {...scope, pageId: 'new-page'}); finish({response: 1}); assert.equal((await authorization).error.code, 'workspace_changed');
  await assert.rejects(f.client.call('workspace_status', {}), {code: 'connection_revoked'});
});
test('development QA restart accepts only an owned canonical private temporary profile', async t => {
  const base = await fs.realpath('/tmp'), profile = await fs.realpath(await fs.mkdtemp(path.join(base, 'freenow-desktop-qa-'))); t.after(() => fs.rm(profile, {recursive: true, force: true}));
  const args = ['--freenow-external-agent-qa-profile=' + profile, '--freenow-external-agent-qa-project=public-qa'];
  assert.deepEqual(externalAgentQaOptions(args, '/tmp'), {directory: profile, project: 'public-qa'});
  await fs.chmod(profile, 0o755); assert.throws(() => externalAgentQaOptions(args, '/tmp')); await fs.chmod(profile, 0o700);
  assert.throws(() => externalAgentQaOptions(['--freenow-external-agent-qa-profile=' + base], '/tmp'));
  assert.throws(() => externalAgentQaOptions([...args, '--freenow-external-agent-qa-project=another'], '/tmp'));
  assert.throws(() => externalAgentQaOptions([args[0], '--freenow-external-agent-qa-project=../private'], '/tmp'));
});
test('shutdown handler accepts no authority, transport calls or confirmation after closing', async t => {
  const f = await fixture(t, {response: 1});
  assert.equal((await f.invoke('approve', {connectionId: f.id})).authorized, true);
  await f.bridge.close({keepHandler: true}); const confirmations = f.dialogs.length;
  const requests = [{method: 'status'}, {method: 'register', args: scope}, {method: 'approve', args: {connectionId: f.id}}, {method: 'revoke', args: {connectionId: f.id}}, {method: 'unregister', args: {pageId: scope.pageId}}, {method: 'reply', args: {requestId: 'late-request', result}}, {method: 'anything'}];
  for (const request of requests) assert.equal((await f.invoke(request.method, request.args)).error.code, 'workspace_unavailable');
  assert.equal(f.dialogs.length, confirmations); await assert.rejects(f.client.call('workspace_status', {}));
});
