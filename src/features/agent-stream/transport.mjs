const abortError = () => new DOMException('Aborted', 'AbortError');
function failure(message, code, status) {
  const error = new Error(message); if (code) error.code = code; if (status) error.status = status; return error;
}
export function validateResult(result, seenCallIds = new Set()) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.calls ?? (result.done ? [] : null))) throw failure('Agent 最终响应无效', 'stream_protocol_error');
  const next = new Set();
  for (const call of result.calls || []) {
    if (typeof call?.callId !== 'string' || !call.callId.trim() || next.has(call.callId) || seenCallIds.has(call.callId)) throw failure('Agent 工具调用标识为空或重复，本轮工具未执行', 'invalid_tool_calls');
    next.add(call.callId);
  }
  for (const id of next) seenCallIds.add(id);
  return result;
}

// A dropped stream is never retried: the server may already have emitted tools.
export async function requestAgent(path, data, {signal, onEvent = () => {}, fetchImpl = globalThis.fetch, seenCallIds} = {}) {
  const body = JSON.stringify(data);
  if (new Blob([body]).size > 1000000) throw Error('本轮对话与附件总量超过 1 MB，请减少参考素材或新建对话后重试');
  if (signal?.aborted) throw abortError();
  const streaming = path === 'turn' || path === 'continue';
  const response = await fetchImpl('/api/agent/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...(streaming ? {Accept: 'application/x-ndjson'} : {})}, body, signal});
  if (signal?.aborted) throw abortError();
  if (!streaming || !response.headers.get('content-type')?.toLowerCase().includes('application/x-ndjson')) {
    const result = await response.json();
    if (signal?.aborted) throw abortError();
    if (!response.ok) throw failure(result.error || 'Agent 请求失败', result.code, response.status);
    return streaming ? validateResult(result, seenCallIds) : result;
  }
  if (!response.ok) throw failure('Agent 请求失败', 'http_error', response.status);
  if (!response.body?.getReader) throw failure('Agent 流式响应不可读取', 'stream_unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', terminal, aborted;
  const cancelled = new Promise((_, reject) => { aborted = () => { void reader.cancel().catch(() => {}); reject(abortError()); }; });
  signal?.addEventListener('abort', aborted, {once: true});
  function receive(line) {
    if (!line.trim()) return;
    if (line.length > 2000000) throw failure('Agent 流式事件过大，已停止接收', 'stream_protocol_error');
    if (signal?.aborted) throw abortError();
    let event;
    try { event = JSON.parse(line); } catch { throw failure('Agent 流式响应格式无效，已停止接收', 'stream_protocol_error'); }
    if (!event || typeof event !== 'object') throw failure('Agent 流式事件无效', 'stream_protocol_error');
    if (event.type === 'error') throw failure(event.error || 'Agent 执行失败', event.code);
    if (event.type === 'result') {
      if (!event.result || typeof event.result !== 'object' || Array.isArray(event.result)) throw failure('Agent 最终响应无效', 'stream_protocol_error');
      terminal = event.result; return;
    }
    if (!['session', 'text_delta', 'thinking', 'context_compaction'].includes(event.type) || typeof event.sessionId !== 'string' || !Number.isInteger(event.round) || event.round < 0 ||
      event.type === 'text_delta' && typeof event.delta !== 'string' || event.type === 'thinking' && typeof event.active !== 'boolean' ||
      event.type === 'context_compaction' && (!['running','completed','unchanged','unavailable'].includes(event.status) || event.status === 'completed' && (!Number.isSafeInteger(event.beforeChars) || !Number.isSafeInteger(event.afterChars) || event.afterChars < 0 || event.afterChars >= event.beforeChars))) {
      throw failure('Agent 流式事件无效', 'stream_protocol_error');
    }
    onEvent(event);
  }
  try {
    while (!terminal) {
      let chunk;
      try { chunk = await Promise.race([reader.read(), cancelled]); }
      catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw abortError();
        throw failure('连接已中断，已保留收到的内容；请检查任务结果后继续。', 'stream_interrupted');
      }
      const {done, value} = chunk;
      if (signal?.aborted) throw abortError();
      buffer += decoder.decode(value, {stream: !done});
      let newline;
      while (!terminal && (newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); receive(line); }
      if (buffer.length > 2000000) throw failure('Agent 流式事件过大，已停止接收', 'stream_protocol_error');
      if (done) { if (!terminal && buffer.trim()) receive(buffer); break; }
    }
    if (!terminal) throw failure('连接已中断，已保留收到的内容；请检查任务结果后继续。', 'stream_interrupted');
    return validateResult(terminal, seenCallIds);
  } finally {
    signal?.removeEventListener('abort', aborted);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
