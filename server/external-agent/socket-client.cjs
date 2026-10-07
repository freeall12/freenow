'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {readLines, writeLine} = require('./frames.cjs');
const {fault, keys} = require('./contracts.cjs');
function createSocketClient(socketPath) {
  let socket, stop, connection, closed = false;
  const pending = new Map();
  function fail() {for (const item of pending.values()) item.reject(fault('transport_closed')); pending.clear();}
  function request(method, params, signal) {
    if (!socket || socket.destroyed || closed || signal?.aborted) return Promise.reject(fault(signal?.aborted ? 'cancelled' : 'transport_closed'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {try {writeLine(socket, {method: 'cancel', requestId: id});} catch {} finish(fault('cancelled'));};
      const timer = setTimeout(() => finish(fault('host_unavailable')), 12000);
      function finish(error, result) {clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(id); if (error) reject(error); else resolve(result);}
      pending.set(id, {resolve: result => finish(null, result), reject: finish}); signal?.addEventListener('abort', abort, {once: true});
      try {writeLine(socket, {id, method, params});} catch {finish(fault('transport_closed'));}
    });
  }
  return {
    async connect(info, signal) {
      if (socket || closed || !path.isAbsolute(socketPath)) throw fault('transport_closed');
      const directory = path.dirname(socketPath), stat = await fs.lstat(socketPath), parent = await fs.lstat(directory);
      if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || await fs.realpath(directory) !== directory || typeof process.getuid === 'function' && (stat.uid !== process.getuid() || parent.uid !== process.getuid())) throw fault('transport_closed');
      socket = net.createConnection(socketPath);
      socket.on('error', fail); socket.once('close', fail);
      stop = readLines(socket, line => {
        let value; try {value = JSON.parse(line);} catch {socket.destroy(); return;}
        if (!keys(value, ['id', 'result', 'error']) || typeof value.id !== 'string') {socket.destroy(); return;}
        const item = pending.get(value.id); if (!item) return;
        if (value.error) item.reject(fault(value.error.code)); else item.resolve(value.result);
      }, () => socket.destroy(), 128 * 1024);
      await new Promise((resolve, reject) => {socket.once('connect', resolve); socket.once('error', () => reject(fault('transport_closed')));});
      connection = await request('connect', {clientInfo: info}, signal); return connection;
    },
    call(name, args, signal) {return request('call', {name, arguments: args}, signal);},
    close() {closed = true; stop?.(); socket?.destroy(); fail();},
  };
}
module.exports = {createSocketClient};
