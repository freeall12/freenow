export function recoverStreams(messages) {
  let changed = false;
  for (const message of messages) if (message.stream?.status === 'streaming') {
    Object.assign(message.stream, {status: 'interrupted', thinking: false, error: '页面已重新加载，流式回复未完成。请检查任务结果后继续。'});
    if (message.stream.compaction?.status === 'running') message.stream.compaction.status = 'interrupted';
    changed = true;
  }
  return changed;
}

// One state object per HTTP turn/continue request; automatic model repair rounds
// remain separate messages and only the terminal result can expose tool calls.
export function createStreamState({messages, requestId, onChange = () => {}, onSession = () => {}, now = Date.now}) {
  const rounds = new Map(); let current, sessionId, ended = false;
  function create(round = null) {
    const sentAt = now();
    const message = {role: 'assistant', sentAt, text: '', stream: {requestId, startedAt: sentAt, sessionId: sessionId || null, round, status: 'streaming', thinking: false}};
    messages.push(message); onChange(message); return message;
  }
  function removeEmpty(message) {
    if (!message?.text && !message?.stream?.compaction) { const index = messages.indexOf(message); if (index >= 0) messages.splice(index, 1); onChange(message); }
  }
  function select(round) {
    if (rounds.has(round)) return rounds.get(round);
    if (current?.stream.round === null) { current.stream.round = round; rounds.set(round, current); return current; }
    if (current) { Object.assign(current.stream, {status: 'done', thinking: false}); onChange(current); removeEmpty(current); }
    current = create(round); rounds.set(round, current); return current;
  }
  current = create();
  return {
    event(event) {
      if (ended) return;
      if (sessionId && event.sessionId !== sessionId) throw Error('Agent 流式会话身份发生变化，已停止接收');
      sessionId = event.sessionId; onSession(sessionId);
      const message = select(event.round); message.stream.sessionId = sessionId;
      if (event.type === 'text_delta') { message.text += event.delta; message.stream.thinking = false; }
      if (event.type === 'thinking') message.stream.thinking = event.active;
      if (event.type === 'context_compaction') message.stream.compaction = {status:event.status, ...(event.status === 'completed' ? {beforeChars:event.beforeChars,afterChars:event.afterChars} : {})};
      onChange(message);
    },
    finish(result) {
      if (ended) return;
      if (sessionId && result.sessionId && result.sessionId !== sessionId) throw Error('Agent 最终响应会话身份不一致');
      sessionId = result.sessionId || sessionId; if (sessionId) onSession(sessionId);
      if (Array.isArray(result.segments)) for (const segment of result.segments) {
        if (!Number.isInteger(segment.round) || typeof segment.text !== 'string') continue;
        const message = select(segment.round); message.text = segment.text;
        Object.assign(message.stream, {sessionId, status: 'done', thinking: false});
        if (!messages.includes(message) && message.text) {
          const next = messages.findIndex(item => item.stream?.requestId === requestId && item.stream.round > message.stream.round);
          messages.splice(next < 0 ? messages.length : next, 0, message);
        }
        onChange(message);
      }
      if (Number.isInteger(result.round)) current = select(result.round);
      const canonicalCurrent = Array.isArray(result.segments) && result.segments.some(segment => segment.round === current.stream.round && typeof segment.text === 'string');
      if (!canonicalCurrent && typeof result.text === 'string') current.text = result.text;
      for (const message of new Set([current, ...rounds.values()])) {
        Object.assign(message.stream, {sessionId: sessionId || null, status: 'done', thinking: false}); onChange(message); removeEmpty(message);
      }
      ended = true;
    },
    interrupt(reason = '回复已中断') {
      if (ended) return false;
      ended = true;
      Object.assign(current.stream, {status: 'interrupted', thinking: false, error: reason});
      if (current.stream.compaction?.status === 'running') current.stream.compaction.status = 'interrupted';
      onChange(current); return true;
    },
  };
}

// Coalesce all chunks received before the next paint without rebuilding the panel.
export function createFrameBatch(flush, {schedule = requestAnimationFrame, cancel = cancelAnimationFrame} = {}) {
  const pending = new Set(); let frame = null;
  function drain() { frame = null; if (pending.size) { const items = [...pending]; pending.clear(); flush(items); } }
  return {
    add(item) { pending.add(item); if (frame === null) frame = schedule(drain); },
    flush() { if (frame !== null) cancel(frame); drain(); },
    destroy() { if (frame !== null) cancel(frame); frame = null; pending.clear(); },
  };
}
