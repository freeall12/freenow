'use strict';
// MCP stdio uses one UTF-8 JSON-RPC object per line. Buffer bytes until the
// delimiter so split multi-byte characters cannot change a parsed request.
function readLines(stream, onLine, onFailure, limit = 65536) {
  let buffer = Buffer.alloc(0), failed = false;
  const fail = () => {if (!failed) {failed = true; onFailure();}};
  const data = chunk => {
    if (failed) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    let end;
    while ((end = buffer.indexOf(10)) !== -1) {
      if (end > limit) return fail();
      const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      if (line.length) onLine(line.toString('utf8'));
      if (failed) return;
    }
    if (buffer.length > limit) fail();
  };
  const end = () => {if (buffer.length) fail();};
  stream.on('data', data); stream.on('end', end);
  return () => {failed = true; stream.off('data', data); stream.off('end', end); buffer = Buffer.alloc(0);};
}
function writeLine(stream, value) {
  if (stream.destroyed || stream.writableEnded || stream.writableLength > 256 * 1024) throw Error('transport_closed');
  const frame = JSON.stringify(value); if (Buffer.byteLength(frame) > 128 * 1024) throw Error('response_limit');
  stream.write(frame + '\n');
}
module.exports = {readLines, writeLine};
