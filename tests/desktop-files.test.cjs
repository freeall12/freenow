'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {createDesktopFilesService, relative, operations} = require('../server/desktop-files.cjs');
const {createDesktopFilesBridge, channel} = require('../desktop/files-bridge.cjs');
async function fixture(t, hooks = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'freenow-desktop-files-test-'));
  const root = path.join(base, 'authorized'), store = path.join(base, 'receipts'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'one.txt'), 'one'); await fs.writeFile(path.join(root, 'two.txt'), 'two');
  const service = createDesktopFilesService({directory: store, ...hooks}); await service.ready;
  t.after(async () => {await service.close(); await fs.rm(base, {recursive: true, force: true});});
  return {base, root, store, service, owner: randomUUID()};
}
const batch = operations => ({operationId: randomUUID(), operations});
const input = p => ({batchId: p.batchId, digest: p.digest});
test('paths/schema reject traversal, absolute/Windows/control/special paths and delete', () => {
  for (const name of ['../one', 'x/../y', '/tmp/z', 'x//y', 'x/', 'C:\\a', 'a%2f..', 'a\0b', '.']) assert.throws(() => relative(name));
  assert.throws(() => operations([{type: 'delete', path: 'one.txt'}]));
  assert.throws(() => operations([{type: 'mkdir', path: 'new', unexpected: true}]));
  assert.throws(() => operations([{type: 'rename', source: 'one', destination: 'ONE'}]));
  assert.throws(() => operations([{type: 'move', source: 'dir', destination: 'dir/sub'}]));
});
test('authorization identity, native root and no implicit authorization', async t => {
  const f = await fixture(t); await assert.rejects(f.service.list(f.owner), {code: 'desktop_files_not_granted'});
  await f.service.grant(f.owner, f.root); await assert.rejects(f.service.list('another-owner'), {code: 'desktop_files_not_granted'});
  await fs.rename(f.root, f.root + '-old'); await fs.mkdir(f.root);
  await assert.rejects(f.service.list(f.owner), {code: 'desktop_files_grant_changed'});
});
test('real preview, confirmed mkdir/move/rename and repeat confirmation never repeats mutations', async t => {
  const f = await fixture(t); await f.service.grant(f.owner, f.root);
  const request = batch([{type: 'mkdir', path: 'sorted'}, {type: 'move', source: 'one.txt', destination: 'sorted/one.txt'}, {type: 'rename', source: 'sorted/one.txt', destination: 'sorted/renamed.txt'}]);
  const p = await f.service.preview(f.owner, request); assert.equal(p.status, 'prepared'); assert.equal(await fs.readFile(path.join(f.root, 'one.txt'), 'utf8'), 'one');
  assert.equal((await f.service.preview(f.owner, request)).replayed, true);
  await assert.rejects(f.service.preview(f.owner, {...request, operations: [{type: 'mkdir', path: 'different'}]}), {code: 'desktop_files_batch_conflict'});
  await assert.rejects(f.service.apply('another-owner', input(p)), {code: 'desktop_files_batch_identity'});
  await assert.rejects(f.service.apply(f.owner, {...input(p), digest: 'a'.repeat(64)}), {code: 'desktop_files_batch_identity'});
  const done = await f.service.apply(f.owner, input(p)); assert.equal(done.status, 'completed'); assert.equal(await fs.readFile(path.join(f.root, 'sorted/renamed.txt'), 'utf8'), 'one');
  const replay = await f.service.apply(f.owner, input(p)); assert.equal(replay.replayed, true); assert.equal(replay.completed, 3);
});
test('existing destinations, missing parents and case collisions are rejected', async t => {
  const f = await fixture(t); await f.service.grant(f.owner, f.root);
  await assert.rejects(f.service.preview(f.owner, batch([{type: 'move', source: 'one.txt', destination: 'two.txt'}])), {code: 'desktop_files_destination_exists'});
  await assert.rejects(f.service.preview(f.owner, batch([{type: 'move', source: 'one.txt', destination: 'absent/one.txt'}])), {code: 'desktop_files_missing_parent'});
  await assert.rejects(f.service.preview(f.owner, batch([{type: 'mkdir', path: 'TWO.TXT'}])), {code: 'desktop_files_case_collision'});
  assert.equal(await fs.readFile(path.join(f.root, 'two.txt'), 'utf8'), 'two');
});
test('symlink source, destination and nested ancestor cannot escape; list never follows links', async t => {
  const f = await fixture(t); const outside = path.join(f.base, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'do-not-read');
  await fs.symlink(outside, path.join(f.root, 'escape')); await fs.symlink(path.join(outside, 'private.txt'), path.join(f.root, 'link.txt')); await f.service.grant(f.owner, f.root);
  assert.equal((await f.service.list(f.owner)).entries.find(x => x.name === 'escape').kind, 'blocked_symlink');
  for (const operation of [{type: 'mkdir', path: 'escape/new'}, {type: 'move', source: 'link.txt', destination: 'safe.txt'}, {type: 'move', source: 'one.txt', destination: 'escape/moved.txt'}]) await assert.rejects(f.service.preview(f.owner, batch([operation])), {code: 'desktop_files_symlink'});
  assert.deepEqual(await fs.readdir(outside), ['private.txt']);
});
test('every step revalidates source/parent identities and rollback reverses completed changes', async t => {
  let root; const f = await fixture(t, {beforeStep: async ({index}) => {if (index === 2) await fs.writeFile(path.join(root, 'collision.txt'), 'external');}}); root = f.root; await f.service.grant(f.owner, root);
  const p = await f.service.preview(f.owner, batch([{type: 'mkdir', path: 'new'}, {type: 'move', source: 'one.txt', destination: 'new/one.txt'}, {type: 'rename', source: 'two.txt', destination: 'collision.txt'}]));
  const result = await f.service.apply(f.owner, input(p)); assert.equal(result.status, 'rolled_back'); assert.equal(result.reason, 'desktop_files_preview_stale');
  assert.equal(await fs.readFile(path.join(root, 'one.txt'), 'utf8'), 'one'); assert.equal(await fs.readFile(path.join(root, 'collision.txt'), 'utf8'), 'external'); await assert.rejects(fs.stat(path.join(root, 'new')));
});
test('directory moves fail closed; later EXDEV failure reverses completed file operations', async t => {
  const f = await fixture(t, {beforeStep: async ({index}) => {if (index === 2) throw Object.assign(Error('Cross-device move'), {code: 'EXDEV'});}}); await fs.mkdir(path.join(f.root, 'folder')); await f.service.grant(f.owner, f.root);
  await assert.rejects(f.service.preview(f.owner, batch([{type: 'move', source: 'folder', destination: 'moved'}])), {code: 'desktop_files_directory_move_unsupported'});
  const p = await f.service.preview(f.owner, batch([{type: 'mkdir', path: 'sorted'}, {type: 'move', source: 'one.txt', destination: 'sorted/one.txt'}, {type: 'rename', source: 'two.txt', destination: 'renamed.txt'}]));
  const r = await f.service.apply(f.owner, input(p)); assert.equal(r.status, 'rolled_back'); assert.equal(r.reason, 'EXDEV'); assert.equal(await fs.readFile(path.join(f.root, 'one.txt'), 'utf8'), 'one'); await assert.rejects(fs.stat(path.join(f.root, 'sorted')));
});
test('rollback conflict is explicit and persisted, no overwrite and no implicit retry', async t => {
  let root; const f = await fixture(t, {beforeStep: async ({index}) => {if (index === 1) {await fs.writeFile(path.join(root, 'one.txt'), 'external'); throw Object.assign(Error('forced failure'), {code: 'EXDEV'});}}}); root = f.root; await f.service.grant(f.owner, root);
  const p = await f.service.preview(f.owner, batch([{type: 'move', source: 'one.txt', destination: 'moved.txt'}, {type: 'mkdir', path: 'unused'}])); const r = await f.service.apply(f.owner, input(p));
  assert.equal(r.status, 'rollback_failed'); assert.equal(r.rollbackErrors[0].code, 'desktop_files_rollback_collision'); assert.equal(await fs.readFile(path.join(root, 'one.txt'), 'utf8'), 'external'); assert.equal(await fs.readFile(path.join(root, 'moved.txt'), 'utf8'), 'one');
  assert.equal((await f.service.apply(f.owner, input(p))).replayed, true); const disk = JSON.parse(await fs.readFile(path.join(f.store, p.batchId + '.json'), 'utf8')); assert.equal(disk.status, 'rollback_failed');
});
test('cancel/revoke invalidates prepared commits and closed service loses all authority', async t => {
  const f = await fixture(t); await f.service.grant(f.owner, f.root); const p = await f.service.preview(f.owner, batch([{type: 'mkdir', path: 'cancelled'}])); await f.service.cancel(f.owner, input(p)); assert.equal((await f.service.apply(f.owner, input(p))).status, 'cancelled');
  const q = await f.service.preview(f.owner, batch([{type: 'mkdir', path: 'revoked'}])); await f.service.revoke(f.owner); assert.equal((await f.service.apply(f.owner, input(q))).status, 'revoked'); await f.service.close(); await assert.rejects(f.service.grant(f.owner, f.root));
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['one.txt', 'two.txt']);
});
test('restart never executes an unknown journal; exact reauthorization enables read-only recovery', async t => {
  const f = await fixture(t); await f.service.grant(f.owner, f.root); const p = await f.service.preview(f.owner, batch([{type: 'rename', source: 'one.txt', destination: 'renamed.txt'}])); await f.service.close();
  const filename = path.join(f.store, p.batchId + '.json'), journal = JSON.parse(await fs.readFile(filename, 'utf8')); journal.status = 'applying'; journal.intent = {operation: journal.operations[0]}; await fs.writeFile(filename, JSON.stringify(journal));
  const reopened = createDesktopFilesService({directory: f.store}); t.after(() => reopened.close()); await reopened.ready; const owner = randomUUID(); await assert.rejects(reopened.recover(owner, {batchId: p.batchId}), {code: 'desktop_files_not_granted'}); await reopened.grant(owner, f.root);
  const r = await reopened.recover(owner, {batchId: p.batchId}); assert.equal(r.status, 'recovery_required'); assert.equal(r.readOnly, true); assert.equal(r.current.find(x => x.path === 'one.txt').state.exists, true); await assert.rejects(reopened.apply(owner, input(p)), {code: 'desktop_files_batch_identity'}); assert.equal(await fs.readFile(path.join(f.root, 'one.txt'), 'utf8'), 'one');
});
test('native IPC verifies sender, main frame, local origin, defaults cancel, and uses server batch only', async t => {
  let handler, response = 0; const sent = [], dialogs = []; const mainFrame = {url: 'http://127.0.0.1:4183/'}; const window = {id: 123, isDestroyed: () => false, webContents: {mainFrame}};
  const plan = {status: 'prepared', operations: [{type: 'rename', source: 'one.txt', destination: 'new.txt'}]};
  const bridge = createDesktopFilesBridge({ipcMain: {handle(name, fn) {assert.equal(name, channel); handler = fn;}}, dialog: {async showMessageBox(w, opts) {dialogs.push(opts); return {response};}, async showOpenDialog() {return {canceled: false, filePaths: ['/tmp/explicit-test-only']};}}, getWindow: () => window, async request(value) {sent.push(value); if (value.method === 'read') return plan; if (value.method === 'status') return {name: 'authorized', displayPath: '/tmp/explicit-test-only'}; return {status: value.method};}});
  const event = {sender: window.webContents, senderFrame: mainFrame};
  await assert.rejects(handler({...event, sender: {}}, {method: 'list'})); await assert.rejects(handler({...event, senderFrame: {...mainFrame}}, {method: 'list'})); mainFrame.url = 'https://evil.example'; await assert.rejects(handler(event, {method: 'list'})); mainFrame.url = 'http://127.0.0.1:4183/';
  await assert.rejects(handler(event, {method: 'grant', args: {path: '/'}})); await assert.rejects(handler(event, {method: 'apply', owner: 'injected'}));
  await handler(event, {method: 'authorize'}); assert.equal(sent.at(-1).args.path, '/tmp/explicit-test-only');
  const result = await handler(event, {method: 'apply', args: {batchId: randomUUID(), digest: 'a'.repeat(64), operations: [{type: 'delete'}]}}); assert.equal(result.status, 'cancel'); assert.equal(dialogs[0].defaultId, 0); assert.match(dialogs[0].detail, /one.txt → new.txt/); assert.doesNotMatch(dialogs[0].detail, /delete/);
  response = 1; await handler(event, {method: 'apply', args: {batchId: randomUUID(), digest: 'a'.repeat(64)}}); assert.equal(sent.at(-1).method, 'apply'); await bridge.revoke();
});
test('Agent stop cancels pending native batch confirmation, even if its delayed answer is Confirm', async () => {
  let handler, resolveDialog; const calls = []; const mainFrame = {url: 'http://127.0.0.1:4183/'}; const window = {id: 1, isDestroyed: () => false, webContents: {mainFrame}}; const event = {sender: window.webContents, senderFrame: mainFrame};
  createDesktopFilesBridge({ipcMain: {handle(_, fn) {handler = fn;}}, getWindow: () => window, dialog: {showMessageBox: () => new Promise(resolve => {resolveDialog = resolve;})}, request: async request => {calls.push(request.method); return request.method === 'read' ? {status: 'prepared', operations: [{type: 'mkdir', path: 'new'}]} : request.method === 'status' ? {name: 'QA', displayPath: '/tmp/qa'} : {status: request.method};}});
  const requestId = randomUUID(), pending = handler(event, {method: 'apply', requestId, args: {batchId: randomUUID(), digest: 'a'.repeat(64)}});
  while (!resolveDialog) await new Promise(setImmediate);
  await assert.rejects(handler(event, {method: 'apply', requestId, args: {}}));
  assert.equal((await handler(event, {method: 'cancel-request', requestId})).cancelled, true); resolveDialog({response: 1}); assert.equal((await pending).status, 'cancel'); assert.deepEqual(calls, ['read', 'status', 'cancel']);
});
test('Agent stop cancels pending native folder authorization and cannot falsely cancel already started execution', async () => {
  let handler, resolvePicker, resolveApply; const calls = []; const mainFrame = {url: 'http://127.0.0.1:4183/'}; const window = {id: 1, isDestroyed: () => false, webContents: {mainFrame}}; const event = {sender: window.webContents, senderFrame: mainFrame};
  createDesktopFilesBridge({ipcMain: {handle(_, fn) {handler = fn;}}, getWindow: () => window, dialog: {showOpenDialog: () => new Promise(resolve => {resolvePicker = resolve;}), showMessageBox: async () => ({response: 1})}, request: async request => {calls.push(request.method); if (request.method === 'apply') return new Promise(resolve => {resolveApply = resolve;}); return request.method === 'read' ? {status: 'prepared', operations: [{type: 'mkdir', path: 'new'}]} : {name: 'QA', displayPath: '/tmp/qa'};}});
  const requestId = randomUUID(), picker = handler(event, {method: 'authorize', requestId}); while (!resolvePicker) await new Promise(setImmediate); await handler(event, {method: 'cancel-request', requestId}); resolvePicker({canceled: false, filePaths: ['/tmp/qa']}); assert.equal((await picker).cancelled, true); assert.equal(calls.includes('grant'), false);
  const secondId = randomUUID(), applying = handler(event, {method: 'apply', requestId: secondId, args: {batchId: randomUUID(), digest: 'a'.repeat(64)}}); while (!resolveApply) await new Promise(setImmediate); assert.equal((await handler(event, {method: 'cancel-request', requestId: secondId})).executionStarted, true); resolveApply({status: 'completed'}); assert.equal((await applying).status, 'completed');
});
test('tool schemas and outcome presentation preserve actual file batch status and complete operation list', async () => {
  const {parse, definitions} = require('../agent-tools.js'); const {desktopFilesPresentation} = await import('../src/features/desktop-files/presentation.mjs');
  const request = batch([{type: 'mkdir', path: 'new'}]); assert.equal(parse('desktop_files_preview', request).args.operationId, request.operationId);
  assert.throws(() => parse('desktop_files_apply', {batchId: randomUUID(), digest: 'a'.repeat(64), owner: 'injected'})); assert.throws(() => parse('desktop_files_preview', {...request, root: '/'})); assert.equal(definitions.find(t => t.name === 'desktop_files_apply').mutates, true);
  const result = {status: 'rollback_failed', batchId: randomUUID(), operations: request.operations, rollbackErrors: [{code: 'collision'}]}; const presentation = desktopFilesPresentation({name: 'desktop_files_apply', args: {}, result}); assert.match(presentation.label, /未撤回/); assert.match(presentation.detail, /创建文件夹：new/); assert.match(presentation.detail, /collision/);
});
test('concurrent previews cannot replace one UUID with different operations; uppercase UUID persists canonically', async t => {
  const f = await fixture(t); await f.service.grant(f.owner, f.root); const id = randomUUID().toUpperCase();
  const results = await Promise.allSettled([f.service.preview(f.owner, {operationId: id, operations: [{type: 'mkdir', path: 'first'}]}), f.service.preview(f.owner, {operationId: id, operations: [{type: 'mkdir', path: 'second'}]})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'desktop_files_batch_conflict'); const r = results.find(r => r.status === 'fulfilled').value; assert.equal(r.batchId, id.toLowerCase()); assert.equal((await f.service.read(f.owner, {batchId: id, digest: r.digest})).status, 'prepared');
});
