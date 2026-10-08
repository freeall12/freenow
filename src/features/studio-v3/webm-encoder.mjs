/** Native VP9/VP8 frame encoding with a finite, timestamped WebM container. */
export class ShotVideoUnsupportedError extends Error {
  constructor(message) {super(message); this.name = 'ShotVideoUnsupportedError'; this.code = 'studio_v3_shot_video_unsupported';}
}
const fail = (code, message) => Object.assign(new Error(message), {code});
const abort = signal => {if (signal?.aborted) throw signal.reason || new DOMException('镜头视频导出已取消', 'AbortError');};
const bytes = value => new TextEncoder().encode(value);
const join = parts => {const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0; for (const part of parts) {result.set(part, offset); offset += part.byteLength;} return result;};
const id = hex => Uint8Array.from(hex.match(/../g).map(value => parseInt(value, 16)));
function size(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('EBML element size must be a nonnegative safe integer');
  for (let length = 1; length <= 8; length++) if (value < 2 ** (7 * length) - 1) {
    let remaining = BigInt(value); const result = new Uint8Array(length);
    for (let index = length - 1; index >= 0; index--) {result[index] = Number(remaining & 255n); remaining >>= 8n;}
    result[0] |= 1 << (8 - length); return result;
  }
  throw new RangeError('WebM element is too large');
}
function uint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('WebM unsigned integer is invalid');
  let remaining = BigInt(value), result = []; do {result.unshift(Number(remaining & 255n)); remaining >>= 8n;} while (remaining); return Uint8Array.from(result);
}
const element = (hex, payload) => join([id(hex), size(payload.byteLength), payload]);
const integer = (hex, value) => element(hex, uint(value));
const text = (hex, value) => element(hex, bytes(value));
const master = (hex, children) => element(hex, join(children));
function float64(hex, value) {const data = new Uint8Array(8); new DataView(data.buffer).setFloat64(0, value); return element(hex, data);}

/** SimpleBlock timestamps are milliseconds; native packets keep their bytes. */
export function muxWebM(chunks, {width, height, fps = 30, durationMs, codec} = {}) {
  if (![width, height, fps].every(value => Number.isInteger(value) && value > 0) || !Number.isFinite(durationMs) || durationMs <= 0 || !['vp9', 'vp8'].includes(codec)) throw new TypeError('WebM requires positive dimensions, timing and a VP9/VP8 codec');
  if (!chunks?.length || chunks[0].type !== 'key') throw fail('studio_v3_shot_video_packets', 'WebM 视频缺少首个关键帧');
  const header = master('1A45DFA3', [integer('4286', 1), integer('42F7', 1), integer('42F2', 4), integer('42F3', 8), text('4282', 'webm'), integer('4287', 4), integer('4285', 2)]);
  const info = master('1549A966', [integer('2AD7B1', 1000000), text('4D80', 'Freenow native shot export'), text('5741', 'Freenow'), float64('4489', durationMs)]);
  const tracks = master('1654AE6B', [master('AE', [integer('D7', 1), integer('73C5', 1), integer('83', 1), integer('9C', 0), text('86', codec === 'vp9' ? 'V_VP9' : 'V_VP8'), integer('23E383', Math.round(1e9 / fps)), master('E0', [integer('B0', width), integer('BA', height)])])]);
  const clusters = []; let clusterTime = null, blocks = [], previous = -1;
  const flush = () => {if (blocks.length) clusters.push(master('1F43B675', [integer('E7', clusterTime), ...blocks])); blocks = [];};
  for (const chunk of chunks) {
    if (!(chunk.data instanceof Uint8Array) || !chunk.data.byteLength || !Number.isInteger(chunk.timestamp) || chunk.timestamp < previous) throw fail('studio_v3_shot_video_packets', 'WebM 编码包顺序或字节无效');
    previous = chunk.timestamp; const time = Math.round(chunk.timestamp / 1000);
    if (clusterTime === null || time - clusterTime > 2000 && chunk.type === 'key' || time - clusterTime > 30000) {flush(); clusterTime = time;}
    const prefix = new Uint8Array(4); prefix[0] = 0x81; new DataView(prefix.buffer).setInt16(1, time - clusterTime); prefix[3] = chunk.type === 'key' ? 0x80 : 0;
    blocks.push(element('A3', join([prefix, chunk.data])));
  }
  flush(); const payload = [info, tracks, ...clusters], segmentSize = payload.reduce((sum, part) => sum + part.byteLength, 0);
  return new Blob([header, id('18538067'), size(segmentSize), ...payload], {type: `video/webm;codecs=${codec}`});
}

export function shotFrameSchedule(durationMs, fps = 30) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 60) throw new TypeError('Shot video requires positive duration and a 1–60 fps rate');
  const count = Math.max(2, Math.ceil(durationMs / 1000 * fps));
  return Array.from({length: count}, (_, index) => {
    const timestamp = Math.round(index * 1e6 / fps), end = Math.min(Math.round(durationMs * 1000), Math.round((index + 1) * 1e6 / fps));
    return {index, timeMs: timestamp / 1000, timestamp, duration: end - timestamp, keyFrame: index === 0 || index % (fps * 2) === 0};
  }).filter(frame => frame.duration > 0);
}

/** Offline GPU frames may render slowly; encoded timestamps stay at 30 fps. */
export async function encodeShotWebM({width = 1280, height = 720, fps = 30, durationMs, drawFrame, signal, check = () => {}, onProgress = () => {},
  Encoder = globalThis.VideoEncoder, Frame = globalThis.VideoFrame, maxBytes = 256 * 1024 * 1024} = {}) {
  abort(signal); check();
  if (!Encoder?.isConfigSupported || typeof Frame !== 'function') throw new ShotVideoUnsupportedError('此浏览器没有原生逐帧视频编码器');
  if (typeof drawFrame !== 'function') throw new TypeError('Shot encoding requires a real drawFrame canvas adapter');
  const schedule = shotFrameSchedule(durationMs, fps); let configuration, codec;
  // VP9 level 3.1 admits the production 1280×720 at 30fps frame budget.
  for (const candidate of [{codec: 'vp09.00.31.08', name: 'vp9'}, {codec: 'vp8', name: 'vp8'}]) {
    abort(signal); check(); const config = {codec: candidate.codec, width, height, framerate: fps, bitrate: 6000000, latencyMode: 'realtime'};
    let support; try {support = await Encoder.isConfigSupported(config);} catch (error) {if (error?.name !== 'NotSupportedError') throw error;}
    abort(signal); check(); if (support?.supported) {configuration = support.config || config; codec = candidate.name; break;}
  }
  if (!configuration) throw new ShotVideoUnsupportedError('此浏览器没有可用的 VP9／VP8 WebM 编码器');
  const chunks = []; let packetBytes = 0, encoder, encodingFailure;
  let rejectInterrupted; const interrupted = new Promise((_, reject) => {rejectInterrupted = reject;}); interrupted.catch(() => {});
  const cancelled = () => rejectInterrupted(signal.reason || new DOMException('镜头视频导出已取消', 'AbortError'));
  signal?.addEventListener('abort', cancelled, {once: true});
  function ensure() {abort(signal); check(); if (encodingFailure) throw encodingFailure;}
  const wait = async operation => {ensure(); const value = await Promise.race([Promise.resolve().then(operation), interrupted]); ensure(); return value;};
  try {
    encoder = new Encoder({output(chunk) {
      try {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); packetBytes += data.byteLength;
        if (packetBytes > maxBytes) throw fail('studio_v3_shot_video_size', '镜头视频编码数据超过本地内存导出限制');
        chunks.push({data, timestamp: chunk.timestamp, duration: chunk.duration, type: chunk.type});
      } catch (error) {encodingFailure = error; rejectInterrupted(error);}
    }, error(error) {encodingFailure = fail('studio_v3_shot_video_encode', `镜头视频编码失败：${error.message}`); rejectInterrupted(encodingFailure);}});
    // A supported configuration that fails at runtime is an error, not permission
    // to silently substitute a contact sheet for the requested video.
    encoder.configure(configuration);
    for (const frame of schedule) {
      const canvas = await wait(() => drawFrame(frame.timeMs, frame));
      if (!canvas || canvas.width !== width || canvas.height !== height) throw fail('studio_v3_shot_video_frame', '视频帧必须为实际 1280×720 画面');
      const videoFrame = new Frame(canvas, {timestamp: frame.timestamp, duration: frame.duration});
      try {ensure(); encoder.encode(videoFrame, {keyFrame: frame.keyFrame});} finally {videoFrame.close();}
      // Bound native codec queues without retaining full-size GPU frame canvases.
      if (encoder.encodeQueueSize >= 4) await wait(() => encoder.flush());
      onProgress({frame: frame.index + 1, total: schedule.length, progress: (frame.index + 1) / schedule.length});
    }
    await wait(() => encoder.flush()); ensure();
    if (!chunks.length) throw fail('studio_v3_shot_video_empty', '原生编码器没有输出视频帧');
    const blob = muxWebM(chunks, {width, height, fps, durationMs, codec}); ensure();
    return {blob, width, height, mimeType: blob.type, durationMs, fps, frameCount: schedule.length, codec};
  } finally {signal?.removeEventListener('abort', cancelled); if (encoder && encoder.state !== 'closed') encoder.close();}
}
