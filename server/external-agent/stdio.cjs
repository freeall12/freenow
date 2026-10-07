#!/usr/bin/env node
'use strict';
const {createProtocol} = require('./protocol.cjs');
const {createSocketClient} = require('./socket-client.cjs');
const {readLines, writeLine} = require('./frames.cjs');
function start({input = process.stdin, output = process.stdout, socketPath, done = () => {}}) {
  const client = createSocketClient(socketPath);
  let closed = false, stop;
  const close = () => {if (closed) return; closed = true; stop?.(); protocol.close(); done();};
  const protocol = createProtocol({connect: (...args) => client.connect(...args), call: (...args) => client.call(...args), disconnect: () => client.close(), send: value => {try {writeLine(output, value);} catch {close();}}});
  stop = readLines(input, line => {
    let request; try {request = JSON.parse(line);} catch {try {writeLine(output, {jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}});} catch {close();} return;}
    void protocol.receive(request).catch(close);
  }, close);
  input.once('end', close); input.once('error', close); output.once('error', close);
  return {close};
}
module.exports = {start};
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--socket' || !require('node:path').isAbsolute(args[1])) {process.stderr.write('freenow MCP: use the exact local command shown in the desktop connection panel.\n'); process.exitCode = 1;}
  else {const runtime = start({socketPath: args[1], done: () => process.stdin.pause()}); for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {runtime.close(); process.exitCode = 0;});}
}
