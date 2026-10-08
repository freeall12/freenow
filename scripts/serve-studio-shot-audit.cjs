// Public local QA only. Never imported by the production server or desktop.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'build/qa/studio-shot-audit/public-shot.webm');
const origins = new Set(['http://localhost:4196', 'http://127.0.0.1:4196']);
const LIMIT = 2 * 1024 * 1024;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let count = 0, settled = false; const chunks = [];
    request.on('data', chunk => {
      if (settled) return; count += chunk.length;
      if (count > LIMIT) {settled = true; chunks.length = 0; reject(Object.assign(Error('Public QA media exceeds 2 MiB'), {status: 413})); return;}
      chunks.push(chunk);
    });
    request.on('end', () => {if (!settled) {settled = true; resolve(Buffer.concat(chunks));}});
    request.on('error', () => {if (!settled) {settled = true; reject(Object.assign(Error('Public QA upload interrupted'), {status: 400}));}});
    request.on('aborted', () => {if (!settled) {settled = true; reject(Object.assign(Error('Public QA upload aborted'), {status: 400}));}});
  });
}

async function inspectPublicShot(target) {
  // stdout is either explicitly selected ffprobe JSON fields or parsed numeric
  // frame columns plus hex MD5. Tool stderr and arbitrary stdout are not logged.
  const options = {encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024};
  const {stdout} = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=format_name,duration,size', '-of', 'json', target], options);
  const probe = JSON.parse(stdout), stream = probe.streams?.[0];
  if (!stream || !['vp8', 'vp9'].includes(stream.codec_name) || !probe.format?.format_name?.includes('webm')) throw Error('QA file is not decodable VP8/VP9 WebM');
  const decoded = await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-v', 'error', '-i', target, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'framemd5', 'pipe:1'], options);
  const frames = decoded.stdout.split('\n').filter(line => line.trim() && !line.startsWith('#')).map(line => {
    const values = line.split(',').map(value => value.trim());
    if (values.length !== 6 || !values.slice(0, 5).every(value => /^-?\d+$/.test(value)) || !/^[a-f0-9]{32}$/.test(values[5])) throw Error('QA frame digest output is invalid');
    return {stream: Number(values[0]), dts: Number(values[1]), pts: Number(values[2]), duration: Number(values[3]), size: Number(values[4]), md5: values[5]};
  });
  if (!frames.length || frames.length !== Number(stream.nb_read_frames)) throw Error('QA decoded frame counts disagree');
  return {codec: stream.codec_name, width: Number(stream.width), height: Number(stream.height), frameRate: stream.r_frame_rate,
    averageFrameRate: stream.avg_frame_rate, duration: Number(probe.format.duration), bytes: Number(probe.format.size),
    decodedFrames: frames.length, uniqueFrames: new Set(frames.map(frame => frame.md5)).size, frames};
}

function createShotAuditServer({inspect = inspectPublicShot, persist = async data => {await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, data);}} = {}) {
  let activeWrite = false;
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin, host = request.headers.host, port = server.address()?.port;
    const json = (status, value) => {if (response.destroyed) return; response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...(origins.has(origin) ? {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'} : {})}); response.end(JSON.stringify(value));};
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || !origins.has(origin)) {request.resume(); return json(403, {error: 'Only the public QA page on port 4196 may upload'});}
    if (request.url !== '/audit') {request.resume(); return json(404, {error: 'Public QA route unavailable'});}
    if (request.method === 'OPTIONS') {response.writeHead(204, {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '0'}); return response.end();}
    if (request.method !== 'POST') {request.resume(); return json(405, {error: 'POST raw public QA WebM only'});}
    if (String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'video/webm') {request.resume(); return json(415, {error: 'Public QA accepts video/webm only'});}
    if (Number(request.headers['content-length']) > LIMIT) {request.resume(); return json(413, {error: 'Public QA media exceeds 2 MiB'});}
    if (activeWrite) {request.resume(); return json(409, {error: 'Public QA audit is already active'});}
    activeWrite = true;
    try {
      const data = await readBody(request);
      if (!data.length || data.length < 4 || data.readUInt32BE(0) !== 0x1a45dfa3) return json(400, {error: 'Public QA body must contain actual EBML WebM bytes'});
      await persist(data); const result = await inspect(file);
      json(200, {fixture: true, publicLocalModelOnly: true, productionApi: false, file: 'build/qa/studio-shot-audit/public-shot.webm', ...result});
    } catch (error) {json(error.status || 422, {error: error.status ? error.message : 'Public QA WebM decode failed', code: error.status ? 'upload-rejected' : 'decode-failed'});}
    finally {activeWrite = false;}
  });
  server.requestTimeout = 15000; server.headersTimeout = 5000;
  return server;
}

module.exports = {createShotAuditServer, inspectPublicShot, file};
if (require.main === module) {
  const server = createShotAuditServer();
  server.on('error', () => {console.error('Public studio shot QA service could not bind 127.0.0.1:4197'); process.exitCode = 1;});
  server.listen(4197, '127.0.0.1', () => console.log(JSON.stringify({fixture: true, productionApi: false, endpoint: 'http://127.0.0.1:4197/audit', file: 'build/qa/studio-shot-audit/public-shot.webm'})));
}
