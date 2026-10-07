'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, randomBytes} = require('node:crypto');
const {readLines, writeLine} = require('./frames.cjs');
const {keys, clientInfo, binding, argumentsFor, resultFor, fault} = require('./contracts.cjs');
const {safeCode} = require('./protocol.cjs');
function createBroker({directory, getWorkspace, dispatch, changed = () => {}, now = Date.now, ttl = 60 * 60 * 1000, handshakeTimeout = 10000, pendingTimeout = 5 * 60 * 1000}) {
  let server, socketPath, closed = false;
  const clients = new Map();
  const same = (a, b) => a && b && a.pageId === b.pageId && a.projectId === b.projectId;
  const scope = () => binding(getWorkspace());
  function publish() {try {changed();} catch {}}
  function consentDeadline(entry) {clearTimeout(entry.timer); entry.timer = setTimeout(() => entry.socket.destroy(), pendingTimeout); entry.timer.unref();}
  function expire(entry) {entry.generation++; entry.state = 'expired'; entry.scope = null; for (const controller of entry.pending.values()) controller.abort(); consentDeadline(entry); publish();}
  function active(entry) {
    if (closed || !clients.has(entry.id) || entry.socket.destroyed) throw fault('transport_closed');
    if (entry.state === 'revoked') throw fault('connection_revoked');
    if (entry.state === 'expired') throw fault('authorization_expired');
    if (entry.state !== 'authorized') throw fault('authorization_required');
    if (now() >= entry.expiresAt) {expire(entry); throw fault('authorization_expired');}
    if (!same(entry.scope, scope())) {revoke(entry.id); throw fault('workspace_changed');}
    return entry.generation;
  }
  function revoke(id) {
    const entry = clients.get(id); if (!entry) return false;
    entry.generation++; entry.scope = null; entry.state = 'revoked'; entry.expiresAt = null;
    for (const controller of entry.pending.values()) controller.abort(); consentDeadline(entry); publish(); return true;
  }
  const api = {
    async start() {
      if (server || closed) throw Error('broker_unavailable');
      directory = path.resolve(directory); await fs.mkdir(directory, {recursive: true, mode: 0o700});
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory || (stat.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw Error('broker_directory_unavailable');
      // Unique per app lifetime: never unlink or replace an existing socket.
      socketPath = path.join(directory, randomBytes(6).toString('hex') + '.sock');
      if (Buffer.byteLength(socketPath) > 103) throw Error('broker_path_too_long');
      server = net.createServer(socket => {
        if (closed || clients.size >= 8) {socket.destroy(); return;}
        const entry = {id: randomUUID(), socket, info: null, state: 'pending', scope: null, generation: 0, expiresAt: null, pending: new Map(), used: new Set(), windowStart: now(), requests: 0};
        // A partial frame or an unapproved same-user process cannot retain all
        // broker slots indefinitely. Request activity never extends consent time.
        entry.timer = setTimeout(() => socket.destroy(), handshakeTimeout); entry.timer.unref();
        clients.set(entry.id, entry);
        const send = value => {try {writeLine(socket, value);} catch {socket.destroy();}};
        const stop = readLines(socket, line => {
          let value; try {value = JSON.parse(line);} catch {socket.destroy(); return;}
          if (keys(value, ['method', 'requestId']) && value.method === 'cancel' && typeof value.requestId === 'string') {entry.pending.get(value.requestId)?.abort(); return;}
          if (!keys(value, ['id', 'method', 'params']) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || !['connect', 'call'].includes(value.method) || entry.used.has(value.id) || entry.used.size >= 4096 || entry.pending.size >= 4) {socket.destroy(); return;}
          if (now() - entry.windowStart >= 60000) {entry.windowStart = now(); entry.requests = 0;}
          if (++entry.requests > 60) {send({id: value.id, error: {code: 'rate_limited'}}); return;}
          entry.used.add(value.id); const controller = new AbortController(); entry.pending.set(value.id, controller);
          Promise.resolve().then(async () => {
            if (value.method === 'connect') {
              if (entry.info || !keys(value.params, ['clientInfo'])) throw fault('invalid_arguments');
              entry.info = clientInfo(value.params.clientInfo); consentDeadline(entry); publish(); return {connectionId: entry.id, authorization: 'required'};
            }
            if (!entry.info || !keys(value.params, ['name', 'arguments'])) throw fault('invalid_arguments');
            const args = argumentsFor(value.params.name, value.params.arguments), generation = active(entry), captured = {...entry.scope};
            const result = await dispatch({name: value.params.name, args, binding: captured, signal: controller.signal});
            if (controller.signal.aborted) throw fault('cancelled');
            if (active(entry) !== generation || !same(entry.scope, captured)) throw fault('connection_revoked');
            return resultFor(value.params.name, result, captured, args);
          }).then(result => send({id: value.id, result}), error => send({id: value.id, error: {code: safeCode(error)}})).finally(() => entry.pending.delete(value.id));
        }, () => socket.destroy());
        socket.on('error', () => {});
        socket.once('close', () => {clearTimeout(entry.timer); stop(); for (const controller of entry.pending.values()) controller.abort(); clients.delete(entry.id); publish();});
      });
      await new Promise((resolve, reject) => {server.once('error', reject); server.listen(socketPath, resolve);});
      await fs.chmod(socketPath, 0o600); publish(); return socketPath;
    },
    list() {
      return [...clients.values()].filter(entry => entry.info).map(entry => ({id: entry.id, client: {...entry.info}, state: entry.state === 'authorized' && now() >= entry.expiresAt ? 'expired' : entry.state, expiresAt: entry.expiresAt}));
    },
    approve(id, expected) {
      const current = scope(), entry = clients.get(id);
      if (!entry?.info || entry.socket.destroyed || closed || !same(current, expected)) throw fault('workspace_changed');
      clearTimeout(entry.timer);
      entry.generation++; entry.scope = current; entry.state = 'authorized'; entry.expiresAt = now() + ttl;
      entry.timer = setTimeout(() => expire(entry), ttl); entry.timer.unref(); publish();
      return {authorized: true, projectId: current.projectId, expiresAt: entry.expiresAt};
    },
    revoke,
    invalidate() {for (const id of clients.keys()) revoke(id);},
    get socketPath() {return socketPath;},
    async close() {
      if (closed) return; closed = true;
      for (const entry of clients.values()) {for (const controller of entry.pending.values()) controller.abort(); entry.socket.destroy();}
      if (server) await new Promise(resolve => server.close(resolve));
      // Node unlinks its own Unix socket when the server closes.
    },
  };
  return api;
}
module.exports = {createBroker};
