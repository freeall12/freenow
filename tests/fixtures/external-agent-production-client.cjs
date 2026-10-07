'use strict';
// Manual production acceptance client. It never approves itself, supplies a
// renderer fixture, or prints canvas IDs/titles/content. A human/operator must
// create a public QA canvas and approve/revoke through the real desktop UI.
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const {readLines} = require('../../server/external-agent/frames.cjs');
const socketPath = process.argv[2];
if (!socketPath || !path.isAbsolute(socketPath)) throw Error('Provide the socket path shown by the isolated production desktop.');
const holdUnapproved = process.argv[3] === '--hold-unapproved';
const child = spawn(require('electron'), [path.resolve(__dirname, '../../server/external-agent/stdio.cjs'), '--socket', socketPath], {env: {PATH: process.env.PATH || '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1'}, stdio: ['pipe', 'pipe', 'pipe']});
let sequence = 0, stderrBytes = 0, holdTimer;
child.stderr.on('data', bytes => {stderrBytes += bytes.length;});
const pending = new Map();
const stop = readLines(child.stdout, line => {
  let reply; try {reply = JSON.parse(line);} catch {fail('invalid_protocol_frame'); return;}
  const item = pending.get(reply.id); if (item) {clearTimeout(item.timer); pending.delete(reply.id); item.resolve(reply);}
}, () => fail('invalid_protocol_frame'), 128 * 1024);
child.on('error', () => fail('client_start_failed'));
child.on('exit', () => {for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Error('transport_closed'));} pending.clear();});
function fail(code) {process.stderr.write(code + '\n'); process.exitCode = 1; child.kill();}
function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(Error('request_timeout'));}, 15000);
    pending.set(id, {resolve, reject, timer}); child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
}
const delay = () => new Promise(resolve => setTimeout(resolve, 3000));
(async () => {
  const initialized = await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: holdUnapproved ? 'freenow focus QA' : 'freenow production QA', version: '20261008'}});
  assert.equal(initialized.result?.serverInfo.name, 'freenow-local');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const catalog = await request('tools/list'); assert.deepEqual(catalog.result?.tools.map(tool => tool.name), ['workspace_status', 'canvas_read']);
  const denied = await request('tools/call', {name: 'workspace_status', arguments: {}}); assert.equal(denied.result?.content[0].text, 'authorization_required');
  process.stdout.write('handshake=passed tools=workspace_status,canvas_read unapproved=denied\n');
  if (holdUnapproved) {process.stdout.write('HOLDING_UNAPPROVED_FOR_FOCUS_QA client=freenow focus QA\n'); holdTimer = setTimeout(() => {stop(); child.stdin.end();}, 180000); return;}
  process.stdout.write('WAITING_FOR_REAL_DESKTOP_APPROVAL client=freenow production QA\n');
  let status;
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(); const reply = await request('tools/call', {name: 'workspace_status', arguments: {}});
    if (reply.result?.isError === false) {status = reply.result.structuredContent; break;}
    assert.equal(reply.result?.content[0].text, 'authorization_required');
  }
  assert.ok(status, 'authorization_timeout');
  const read = await request('tools/call', {name: 'canvas_read', arguments: {limit: 2, expected_revision: status.revision}});
  assert.equal(read.result?.isError, false); assert.equal(read.result.structuredContent.revision, status.revision);
  assert.equal(read.result.structuredContent.nodes.length, Math.min(2, status.node_count));
  assert.ok(status.node_count >= 1, 'Create at least one public QA node through the production canvas before approving.');
  assert.equal(stderrBytes, 0);
  process.stdout.write(JSON.stringify({productionHost: 'passed', nodeCount: status.node_count, edgeCount: status.edge_count, returnedNodes: read.result.structuredContent.nodes.length, revisionBound: true, stderrBytes}) + '\n');
  process.stdout.write('WAITING_FOR_REAL_DESKTOP_REVOCATION_OR_RELOAD\n');
  let revoked = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(); const reply = await request('tools/call', {name: 'workspace_status', arguments: {}});
    if (reply.result?.isError && ['connection_revoked', 'workspace_changed', 'workspace_unavailable'].includes(reply.result.content[0].text)) {revoked = true; break;}
  }
  assert.equal(revoked, true); process.stdout.write('productionRevocation=passed\n'); stop(); child.stdin.end();
})().catch(error => {fail(['authorization_timeout', 'request_timeout', 'transport_closed'].includes(error.message) ? error.message : 'production_assertion_failed');});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {clearTimeout(holdTimer); stop(); child.stdin.end();});
