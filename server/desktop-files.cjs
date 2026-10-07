'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const fail = (code, message) => {throw Object.assign(Error(message), {code, status: 409});};
const identity = s => ({dev: String(s.dev), ino: String(s.ino), kind: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'unsupported'});
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino && a.kind === b.kind;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = p => p.normalize('NFC').toLocaleLowerCase('en-US');
function relative(value, {empty = false} = {}) {
  if (typeof value !== 'string' || value.length > 240 || !empty && !value || /[\\\x00-\x1f\x7f:%?#]/u.test(value) || path.isAbsolute(value) || value.split('/').some(p => p === '.' || p === '..' || !p && value !== '')) fail('desktop_files_invalid_path', '路径必须是授权目录内的相对路径，不支持空段、点段或特殊字符。');
  return value.normalize('NFC');
}
function operations(input) {
  if (!Array.isArray(input) || !input.length || input.length > 50) fail('desktop_files_invalid_batch', '每批需要 1–50 项创建文件夹、移动或重命名操作。');
  return input.map(a => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) fail('desktop_files_invalid_batch', '操作格式无效。');
    if (a.type === 'mkdir' && Object.keys(a).every(k => ['type', 'path'].includes(k))) return {type: a.type, path: relative(a.path)};
    if (['move', 'rename'].includes(a.type) && Object.keys(a).every(k => ['type', 'source', 'destination'].includes(k))) {
      const source = relative(a.source), destination = relative(a.destination);
      if (key(source) === key(destination) || key(destination).startsWith(key(source) + '/')) fail('desktop_files_invalid_batch', '源和目标必须不同，不能把目录移动到自身内部。');
      return {type: a.type, source, destination};
    }
    fail('desktop_files_invalid_batch', '只支持 mkdir、move 和 rename；不支持删除或覆盖。');
  });
}
function createDesktopFilesService({directory, beforeStep, beforeRollback} = {}) {
  const grants = new Map(), plans = new Map(), locks = new Set(), preparing = new Map();
  let closed = false, closing = false;
  const ready = (async () => {
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('desktop_files_store_invalid', '文件操作回执目录无效。');
    for (const name of await fs.readdir(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const file = path.join(directory, name), s = await fs.lstat(file);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 2 * 1024 * 1024) fail('desktop_files_store_invalid', '文件操作回执无效。');
      const p = JSON.parse(await fs.readFile(file, 'utf8'));
      if (p.version !== 1 || p.id + '.json' !== name || !Array.isArray(p.operations)) fail('desktop_files_store_invalid', '文件操作回执格式无效。');
      // A journal records intent before each syscall. A crash does not prove it
      // did or did not execute. Reopening never replays or rolls back automatically.
      if (['prepared', 'applying', 'rolling_back'].includes(p.status)) p.status = 'recovery_required';
      plans.set(p.id, p);
    }
  })();
  async function save(p) {
    const target = path.join(directory, p.id + '.json'), temp = target + '.tmp-' + randomUUID();
    const handle = await fs.open(temp, 'wx', 0o600);
    try {await handle.writeFile(JSON.stringify(p)); await handle.sync();} finally {await handle.close();}
    await fs.rename(temp, target);
    const dir = await fs.open(directory, 'r'); try {await dir.sync();} finally {await dir.close();}
  }
  function receipt(p) {
    const errors = {cancelled: '用户取消了此批次，未执行。', revoked: '目录授权已撤销，此批次未执行。', rolled_back: '此批次执行失败，已撤回本批完成的更改。', rollback_failed: '此批次执行失败，部分更改未能撤回。请检查批次回执和实际目录。', recovery_required: '原批次结果尚未确认。此回执不授权重复执行，请只读核对实际目录。'};
    return {batchId: p.id, grantId: p.grantId, digest: p.digest, status: p.status, operations: p.operations, completed: p.completed?.length || 0, rolledBack: p.completed?.filter(e => e.phase === 'rolled_back').length || 0, rollbackErrors: p.rollbackErrors || [], reason: p.reason || null, requiresConfirmation: p.status === 'prepared', replayed: false, ...(errors[p.status] ? {error: errors[p.status], code: p.reason || 'desktop_files_' + p.status} : {})};
  }
  async function grantFor(owner) {
    await ready;
    if (closed || typeof owner !== 'string' || !grants.has(owner)) fail('desktop_files_not_granted', '请在桌面菜单中选择并授权一个本地文件夹。');
    const g = grants.get(owner), stat = await fs.lstat(g.root).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !same(g.identity, identity(stat)) || await fs.realpath(g.root) !== g.root || !same(g.identity, identity(await g.handle.stat()))) fail('desktop_files_grant_changed', '授权目录已替换或移动，请重新授权。');
    return g;
  }
  async function inspect(g, p, snapshots) {
    if (!p) return {exists: true, ...g.identity};
    let current = g.root;
    for (const [i, part] of p.split('/').entries()) {
      const aliases = (await fs.readdir(current)).filter(name => key(name) === key(part));
      if (aliases.some(name => name.normalize('NFC') !== part)) fail('desktop_files_case_collision', '路径与已有名称仅大小写不同，不能覆盖或创建歧义名称。');
      current = path.join(current, part);
      let s; try {s = await fs.lstat(current);} catch (e) {if (e.code === 'ENOENT') {const r = {exists: false}; snapshots?.set(p, r); return r;} throw e;}
      if (s.isSymbolicLink()) fail('desktop_files_symlink', '授权范围内不跟随符号链接。');
      const id = identity(s), r = {exists: true, ...id};
      if (id.kind === 'unsupported' || id.dev !== g.identity.dev) fail('desktop_files_unsupported_item', '不支持特殊文件或跨卷子目录。');
      if (await fs.realpath(current) !== current) fail('desktop_files_outside_grant', '路径已改变或离开授权范围。');
      const prefix = p.split('/').slice(0, i + 1).join('/'); snapshots?.set(prefix, r);
      if (i === p.split('/').length - 1) return r;
      if (id.kind !== 'directory') fail('desktop_files_missing_parent', '路径父级必须是文件夹。');
    }
  }
  async function grant(owner, selected) {
    await ready;
    if (closed || closing || typeof owner !== 'string' || !owner) fail('desktop_files_invalid_owner', '桌面会话身份无效。');
    if (locks.has(owner)) fail('desktop_files_busy', '正在执行文件批次，请稍后重新授权。');
    const stat = await fs.lstat(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('desktop_files_not_directory', '授权对象必须是实际文件夹。');
    const root = await fs.realpath(selected);
    if (root === path.parse(root).root) fail('desktop_files_invalid_root', '不能授权整个文件系统。');
    const handle = await fs.open(root, 'r'), id = identity(await handle.stat());
    if (!same(id, identity(await fs.lstat(root)))) {await handle.close(); fail('desktop_files_grant_changed', '授权目录已变化。');}
    await revoke(owner);
    grants.set(owner, {id: randomUUID(), owner, root, handle, identity: id});
    return status(owner);
  }
  async function revoke(owner) {
    if (locks.has(owner)) fail('desktop_files_busy', '正在执行文件批次，不能撤销目录授权。');
    const old = grants.get(owner); grants.delete(owner); await old?.handle.close();
    for (const p of plans.values()) if (p.owner === owner && p.status === 'prepared') {p.status = 'revoked'; await save(p);}
    return {authorized: false};
  }
  async function status(owner) {
    await ready;
    const active = grants.get(owner);
    const batches = [...plans.values()].filter(p => p.owner === owner || active && p.root === active.root && same(p.rootIdentity, active.identity)).map(receipt);
    if (!grants.has(owner)) return {authorized: false, batches};
    const g = await grantFor(owner); return {authorized: true, grantId: g.id, name: path.basename(g.root), displayPath: g.root, batches};
  }
  async function list(owner, args = {}) {
    const g = await grantFor(owner), p = relative(args.path ?? '', {empty: true}), offset = args.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) fail('desktop_files_invalid_offset', '列表分页无效。');
    if ((await inspect(g, p)).kind !== 'directory') fail('desktop_files_not_directory', '列表对象必须是文件夹。');
    const rows = (await fs.readdir(path.join(g.root, p), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name));
    await grantFor(owner); await inspect(g, p);
    return {grantId: g.id, path: p, entries: rows.slice(offset, offset + 200).map(d => ({name: d.name, kind: d.isSymbolicLink() ? 'blocked_symlink' : d.isDirectory() ? 'directory' : d.isFile() ? 'file' : 'blocked_special'})), nextOffset: offset + 200 < rows.length ? offset + 200 : null};
  }
  async function preview(owner, args) {
    const g = await grantFor(owner), ops = operations(args.operations);
    if (closing) fail('desktop_files_closing', '文件后台正在关闭，不能准备新批次。');
    if (typeof args.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(args.operationId)) fail('desktop_files_invalid_batch_id', '批次需要稳定 UUID operationId。');
    const batchId = args.operationId.toLowerCase();
    const digest = hash({grantId: g.id, operations: ops}), old = plans.get(batchId);
    if (old) {
      if (old.owner !== owner || old.digest !== digest) fail('desktop_files_batch_conflict', '批次身份已存在或操作内容改变。');
      return {...receipt(old), replayed: true};
    }
    const pending = preparing.get(batchId);
    if (pending) fail(pending.owner === owner && pending.digest === digest ? 'desktop_files_batch_busy' : 'desktop_files_batch_conflict', '该批次正在准备；不能改变原批次或重复提交。');
    preparing.set(batchId, {owner, digest});
    try {
    const snapshots = new Map(), virtual = new Map();
    async function state(p) {
      if (virtual.has(key(p))) return virtual.get(key(p));
      for (let n = p.lastIndexOf('/'); n > 0; n = p.lastIndexOf('/', n - 1)) {
        const ancestor = p.slice(0, n), v = virtual.get(key(ancestor));
        if (v) return v.exists && v.kind === 'directory' && v.origin !== undefined ? inspect(g, v.origin + p.slice(n), snapshots) : {exists: false};
      }
      const s = await inspect(g, p, snapshots); return {...s, ...(s.kind === 'directory' ? {origin: p} : {})};
    }
    for (const a of ops) {
      const destination = a.type === 'mkdir' ? a.path : a.destination;
      if ((await state(destination)).exists) fail('desktop_files_destination_exists', '目标已存在，不会覆盖：' + destination);
      if ((await state(path.posix.dirname(destination) === '.' ? '' : path.posix.dirname(destination))).kind !== 'directory') fail('desktop_files_missing_parent', '请先创建目标父文件夹。');
      if (a.type === 'mkdir') virtual.set(key(a.path), {exists: true, kind: 'directory'});
      else {
        const s = await state(a.source);
        if (!s.exists) fail('desktop_files_source_missing', '源不存在：' + a.source);
        if (s.kind !== 'file') fail('desktop_files_directory_move_unsupported', '当前本地实现只移动或重命名普通文件；目录移动暂不支持。');
        virtual.set(key(a.source), {exists: false}); virtual.set(key(a.destination), s);
      }
    }
    const p = {version: 1, id: batchId, owner, grantId: g.id, root: g.root, rootIdentity: g.identity, digest, operations: ops, snapshots: [...snapshots], status: 'prepared', completed: [], createdAt: new Date().toISOString()};
    await save(p); plans.set(p.id, p); return receipt(p);
    } finally {preparing.delete(batchId);}
  }
  async function plan(owner, args) {
    await ready;
    const p = plans.get(args.batchId?.toLowerCase());
    if (!p || p.owner !== owner || p.digest !== args.digest) fail('desktop_files_batch_identity', '批次身份或确认摘要不匹配。');
    return p;
  }
  async function read(owner, args) {return receipt(await plan(owner, args));}
  async function apply(owner, args) {
    const p = await plan(owner, args);
    if (p.status !== 'prepared') return {...receipt(p), replayed: true};
    const g = await grantFor(owner);
    if (p.grantId !== g.id) fail('desktop_files_not_granted', '该批次的目录授权已失效。');
    if (closing) fail('desktop_files_closing', '文件后台正在关闭，不能执行新批次。');
    if (locks.has(owner)) fail('desktop_files_busy', '另一个批次正在执行。');
    locks.add(owner);
    try {
      const activeSnapshots = new Map(p.snapshots);
      async function verify() {
        for (const [name, expected] of activeSnapshots) {const actual = await inspect(g, name); if (actual.exists !== expected.exists || expected.exists && !same(actual, expected)) fail('desktop_files_preview_stale', '目录内容已变化，请检查后创建新的预览。');}
      }
      await verify();
      p.status = 'applying'; await save(p);
      for (let index = 0; index < p.operations.length; index++) {
        const a = p.operations[index]; await beforeStep?.({index, operation: a}); await grantFor(owner); await verify();
        const dest = a.type === 'mkdir' ? a.path : a.destination;
        if ((await inspect(g, dest)).exists) fail('desktop_files_destination_exists', '目标已存在，不会覆盖：' + dest);
        const parent = path.posix.dirname(dest); if ((await inspect(g, parent === '.' ? '' : parent)).kind !== 'directory') fail('desktop_files_missing_parent', '目标父文件夹不存在。');
        const entry = {operation: a, phase: 'intent'}; p.intent = entry; await save(p);
        if (a.type === 'mkdir') {
          await fs.mkdir(path.join(g.root, a.path)); entry.phase = 'done'; p.completed.push(entry); delete p.intent; entry.identity = await inspect(g, a.path); activeSnapshots.set(a.path, entry.identity); await save(p);
        } else {
          const source = await inspect(g, a.source); if (!source.exists) fail('desktop_files_source_missing', '源不存在：' + a.source);
          if (source.kind !== 'file') fail('desktop_files_directory_move_unsupported', '当前本地实现不支持目录移动或重命名。');
          entry.identity = source;
          {
            // link is atomic and refuses an existing destination, unlike rename.
            // Save the link phase before removing the original directory entry.
            await fs.link(path.join(g.root, a.source), path.join(g.root, dest)); entry.phase = 'linked'; p.completed.push(entry); delete p.intent; await save(p);
            if (!same(await inspect(g, a.source), source) || !same(await inspect(g, dest), source)) fail('desktop_files_source_changed', '文件在执行期间变化。');
            await fs.unlink(path.join(g.root, a.source)); entry.phase = 'done'; await save(p);
          }
          for (const [name, expected] of [...activeSnapshots]) {
            if (name === a.source || name.startsWith(a.source + '/')) {activeSnapshots.delete(name); activeSnapshots.set(dest + name.slice(a.source.length), expected);}
          }
          activeSnapshots.set(a.source, {exists: false}); activeSnapshots.set(dest, source);
        }
      }
      p.status = 'completed'; await save(p); return receipt(p);
    } catch (e) {
      p.reason = e.code || 'desktop_files_apply_failed'; p.status = 'rolling_back'; p.rollbackErrors = [];
      await save(p).catch(() => {p.rollbackErrors.push({code: 'desktop_files_journal_failed'});});
      for (const [index, entry] of [...p.completed].reverse().entries()) {
        try {
          await beforeRollback?.({index, entry}); await grantFor(owner);
          const a = entry.operation, dest = a.type === 'mkdir' ? a.path : a.destination;
          if (!same(await inspect(g, dest), entry.identity)) fail('desktop_files_rollback_changed', '回滚目标已变化，保留文件并检查回执。');
          if (a.type === 'mkdir') await fs.rmdir(path.join(g.root, dest));
          else if (entry.phase === 'linked') {
            if (!same(await inspect(g, a.source), entry.identity)) fail('desktop_files_rollback_changed', '原文件已变化。');
            await fs.unlink(path.join(g.root, dest));
          } else {
            if ((await inspect(g, a.source)).exists) fail('desktop_files_rollback_collision', '原位置被占用，不能覆盖回滚。');
            await fs.link(path.join(g.root, dest), path.join(g.root, a.source)); await fs.unlink(path.join(g.root, dest));
          }
          entry.phase = 'rolled_back'; await save(p);
        } catch (error) {p.rollbackErrors.push({operation: entry.operation, code: error.code || 'desktop_files_rollback_failed'});}
      }
      p.status = p.rollbackErrors.length ? 'rollback_failed' : 'rolled_back'; await save(p).catch(() => {p.status = 'recovery_required';});
      return receipt(p);
    } finally {locks.delete(owner);}
  }
  async function recover(owner, args) {
    const g = await grantFor(owner), p = plans.get(args?.batchId?.toLowerCase());
    if (!p || p.root !== g.root || !same(p.rootIdentity, g.identity)) fail('desktop_files_recovery_grant', '请重新授权原目录才能只读核对原批次。');
    const current = [];
    for (const a of p.operations) {
      const names = a.type === 'mkdir' ? [a.path] : [a.source, a.destination];
      for (const name of names) {try {current.push({path: name, state: await inspect(g, name)});} catch (e) {current.push({path: name, blocked: e.code || 'inspection_failed'});}}
    }
    return {...receipt(p), current, readOnly: true, replayed: true, message: '此回执只读核对，不会重复执行或自动撤回。未知状态需检查实际文件后人工恢复。'};
  }
  async function cancel(owner, args) {const p = await plan(owner, args); if (p.status === 'prepared') {p.status = 'cancelled'; await save(p);} return receipt(p);}
  async function close() {closing = true; while (locks.size || preparing.size) await new Promise(resolve => setTimeout(resolve, 20)); closed = true; for (const g of grants.values()) await g.handle.close(); grants.clear();}
  return {ready, grant, revoke, status, list, preview, read, apply, cancel, recover, close};
}
module.exports = {createDesktopFilesService, relative, operations};
