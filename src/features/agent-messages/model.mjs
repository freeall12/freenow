export function forkConversation(chat, index, { id = crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  if (!Number.isInteger(index) || chat.messages?.[index]?.role !== 'assistant') throw Error('分叉消息不存在');
  const copy = structuredClone(chat);
  return {
    ...copy, id, queuedMessages: [], queuePauseReason: null, activeRun: null, title: `${chat.title || '新建对话'}（分叉）`.slice(0, 100),
    createdAt: now, updatedAt: now,
    messages: copy.messages.slice(0, index + 1),
    text: '', composerDoc: { type: 'doc', content: [{ type: 'paragraph' }] },
    uploads: [], artifactRefs: [], quotedText: '', referencePins: [],
    refs: chat.studioNodeId ? [chat.studioNodeId] : [],
    skills: chat.studioNodeId ? ['3d-scene-director'] : [],
    forkedFrom: { chatId: chat.id, messageIndex: index },
  };
}

export function captureReaderPosition(list) {
  if (!list) return null;
  return { sessionId: list.dataset.sessionId, top: list.scrollTop, follow: list.scrollHeight - list.clientHeight - list.scrollTop < 48 };
}

export function restoreReaderPosition(list, previous) {
  list.scrollTop = !previous || previous.sessionId !== list.dataset.sessionId || previous.follow ? list.scrollHeight : previous.top;
}
