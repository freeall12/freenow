const fields = ['text', 'composerDoc', 'refs', 'referencePins', 'skills', 'uploads', 'artifactRefs', 'quotedText'];

export function captureSubmission(chat, { doc = chat.composerDoc, selection, id = crypto.randomUUID(), now = Date.now() } = {}) {
  if (!chat.text?.trim()) throw Error('请输入任务内容');
  if (chat.text.length > 20000) throw Error('消息长度超过 20000 字符');
  const snapshot = Object.fromEntries(fields.map(key => [key, structuredClone(chat[key] ?? (key === 'text' || key === 'quotedText' ? '' : key === 'composerDoc' ? null : []))]));
  return { ...snapshot, composerDoc: structuredClone(doc), selection: structuredClone(selection), id, createdAt: now, studioNodeId: chat.studioNodeId || null };
}

export function restoreSubmission(chat, submission) {
  for (const key of fields) chat[key] = structuredClone(submission[key]);
}

export function reorderQueue(items, activeId, overId) {
  const from = items.findIndex(item => item.id === activeId), to = items.findIndex(item => item.id === overId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items], [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}

// One runner per Agent runtime: enqueueing never interrupts the active request.
// The caller persists the dequeue before executing to avoid replay after reload.
export function createQueueRunner({ getChat, validate, persist, run, changed, failed }) {
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      let chat = getChat();
      while (chat?.queuedMessages?.length && !chat.queuePauseReason) {
        const item = chat.queuedMessages[0];
        try { validate(chat, item); } catch (error) { chat.queuePauseReason = error.message; persist(); failed(error); break; }
        chat.queuedMessages.shift();
        try { persist(); } catch (error) { chat.queuedMessages.unshift(item); chat.queuePauseReason = error.message; failed(error); break; }
        const outcome = await run(chat, item);
        if (outcome?.error) { chat.queuePauseReason = outcome.error; persist(); failed(new Error(outcome.error)); }
        changed();
        const active = getChat();
        if (active?.id !== chat.id) break;
        chat = active;
      }
    } catch (error) { failed(error); }
    finally { running = false; changed(); }
  }
  return { drain, get running() { return running; } };
}
