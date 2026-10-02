import { icons } from './icons.mjs';
import { patchMarkdown, createStreamStatus, createInterruptedStatus } from './streaming.mjs';
import { bindTooltip } from '../agent-composer/tooltip.mjs';
export { forkConversation, captureReaderPosition, restoreReaderPosition } from './model.mjs';

export function createMessageRenderer({ renderMarkdown, renderComposer, onError, onFeedback, onFork }) {
  const cleanups = [], codeStates = new Map(), toolStates = new Map(), records = new WeakMap(), waiting = new Set();
  let timer = null, epoch = 0;
  function syncClock() {
    if (waiting.size && timer === null) timer = setInterval(() => {
      for (const record of waiting) {
        if (!record.row.isConnected) {waiting.delete(record); continue;}
        record.status.update(record.message, record.startedAt, Date.now());
      }
      syncClock();
    }, 1000);
    if (!waiting.size && timer !== null) {clearInterval(timer);timer = null;}
  }
  function action(icon, label, fn, tooltip = label) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'agent-message-action';
    button.innerHTML = icons[icon]; button.setAttribute('aria-label', label);
    button.onclick = fn;
    const tip = bindTooltip(button, { text: () => button.dataset.tooltip || button.ariaLabel });
    button.dataset.tooltip = tooltip; cleanups.push(() => tip.destroy());
    return button;
  }
  function copyAction(text) {
    let timer;
    const button = action('copy', '复制', async () => {
      try {
        await navigator.clipboard.writeText(text);
        if (!button.isConnected) return;
        button.innerHTML = icons.check; button.ariaLabel = button.dataset.tooltip = '已复制'; button.dataset.copied = 'true';
        clearTimeout(timer); timer = setTimeout(() => { button.innerHTML = icons.copy; button.ariaLabel = button.dataset.tooltip = '复制'; delete button.dataset.copied; }, 2000);
      } catch { onError('复制失败，请检查浏览器剪贴板权限'); }
    });
    cleanups.push(() => clearTimeout(timer)); return button;
  }
  function decorateCode(body, key) {
      body.querySelectorAll('.chat-code-block').forEach((block, codeIndex) => {
        const stateKey = `${key}:${codeIndex}`, toolbar = document.createElement('div'); toolbar.className = 'agent-code-actions';
        const wrap = action('text-wrap', '取消自动换行', () => { codeStates.set(stateKey, block.dataset.wrap !== 'on'); sync(); });
        function sync() { const value = codeStates.get(stateKey) !== false; block.dataset.wrap = value ? 'on' : 'off'; wrap.setAttribute('aria-pressed', String(value)); wrap.ariaLabel = wrap.dataset.tooltip = value ? '取消自动换行' : '自动换行'; }
        sync(); toolbar.append(wrap, copyAction(block.querySelector('code').textContent)); block.append(toolbar);
      });
  }
  function toolbarFor(message, {busy = false, lastAssistant = false, pendingQuestion = false, suppressActions = false, index}, currentMessage = () => message) {
    const toolbar = document.createElement('div'); toolbar.className = 'agent-message-actions';
    if (suppressActions || message.role === 'assistant' && (busy || pendingQuestion)) return toolbar;
    if (message.role === 'user' || !busy) toolbar.append(copyAction(message.text || ''));
    if (message.role === 'assistant' && !busy) {
      if (lastAssistant) {
        for (const [value, icon, label] of [['up', 'thumb-up', '赞'], ['down', 'thumb-down', '踩']]) {
          const button = action(icon, label, () => {
            const message = currentMessage();
            const previous = message.feedback;
            message.feedback = message.feedback === value ? null : value;
            try { onFeedback(message); } catch (error) { message.feedback = previous; onError(error.message); }
            toolbar.querySelectorAll('[data-feedback]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.feedback === message.feedback)));
          });
          button.dataset.feedback = value; button.setAttribute('aria-pressed', String(message.feedback === value)); toolbar.append(button);
        }
      }
      toolbar.append(action('git-fork', '分叉对话', () => onFork(index), '在新对话中继续'));
    }
    if (Number.isFinite(message.sentAt)) {
      const time = document.createElement('time'); time.className = 'agent-message-time'; time.dateTime = new Date(message.sentAt).toISOString();
      time.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(message.sentAt); time.title = new Date(message.sentAt).toLocaleString('zh-CN'); toolbar.append(time);
    }
    return toolbar;
  }
  function updateStreaming(row, message, options = {}) {
    const record = records.get(row);if (!record || record.epoch !== epoch || message.role !== 'assistant') return row;
    record.message = message;record.options = {...record.options, ...options};
    const streaming = message.stream?.status === 'streaming', busy = streaming || !!record.options.busy;
    const text = String(message.text || ''), phase = busy ? 'streaming' : 'complete';
    if (record.text !== text || record.phase !== phase) {
      if (busy) patchMarkdown(record.body, renderMarkdown(text));
      else {record.body.innerHTML = renderMarkdown(text);decorateCode(record.body, record.options.key);}
      record.text = text;record.phase = phase;
    }
    const empty = !text.trim();if (record.body.hidden !== empty) record.body.hidden = empty;
    const compaction = message.stream?.compaction;
    const compactionLabel = ({completed:'上下文已整理，继续执行',unchanged:'上下文无需缩减，继续执行',unavailable:'当前服务无法整理上下文，已保留完整记录',interrupted:'上下文整理状态未确认'})[compaction?.status];
    if (compactionLabel) {
      if (!record.compactionNote) {record.compactionNote=document.createElement('div');record.compactionNote.className='agent-stream-elapsed';record.compactionNote.setAttribute('role','status');record.compactionNote.setAttribute('data-no-quote','true');row.insertBefore(record.compactionNote,record.body);}
      if (record.compactionNote.textContent!==compactionLabel) record.compactionNote.textContent=compactionLabel;
    } else if (record.compactionNote) {record.compactionNote.remove();record.compactionNote=null;}
    const waitingForContent = streaming && (!text.trim() || compaction?.status === 'running');
    if (waitingForContent) {
      if (!record.status) {record.status = createStreamStatus(document);row.insertBefore(record.status.element, record.body.nextSibling);}
      record.status.update(message, record.startedAt, Date.now());waiting.add(record);
    } else if (record.status) {record.status.element.remove();record.status = null;waiting.delete(record);}
    // Official ue reserves actions for the last assistant while streaming or
    // globally loading, including the initial empty waiting state.
    const placeholder = busy && record.options.lastAssistant && !record.options.pendingQuestion && !record.options.suppressActions;
    if (placeholder && !record.placeholder) {
      record.placeholder = document.createElement('div');record.placeholder.className = 'agent-message-actions-placeholder';
      record.placeholder.setAttribute('aria-hidden', 'true');record.placeholder.setAttribute('data-message-actions-placeholder', 'true');
      row.insertBefore(record.placeholder, record.interrupted || null);
    } else if (!placeholder && record.placeholder) {record.placeholder.remove();record.placeholder = null;}
    const toolbarKey = JSON.stringify([busy, record.options.lastAssistant, !!record.options.pendingQuestion, !!record.options.suppressActions, record.options.index, message.sentAt, message.feedback, streaming ? '' : text]);
    if (record.toolbarKey !== toolbarKey) {
      record.toolbar?.remove();record.toolbar = toolbarFor(message, {...record.options, busy}, () => record.message);record.toolbarKey = toolbarKey;
      if (record.toolbar.children.length) row.insertBefore(record.toolbar, record.interrupted || null);
    }
    if (message.stream?.status === 'interrupted') {
      const reason = message.stream.error || '';
      if (!record.interrupted || record.interruptedReason !== reason) {
        record.interrupted?.remove();record.interrupted = createInterruptedStatus(document, reason);record.interruptedReason = reason;row.append(record.interrupted);
      }
    } else {record.interrupted?.remove();record.interrupted = null;}
    if (row.dataset.streaming !== String(streaming)) row.dataset.streaming = String(streaming);
    if (row.getAttribute('aria-busy') !== String(streaming)) row.setAttribute('aria-busy', String(streaming));
    syncClock();return row;
  }
  function render(message, options = {}) {
    const row = document.createElement('div');row.className = `agent-message ${message.role}`;
    const body = document.createElement('div');body.className = 'agent-message-body';row.append(body);
    if (message.role === 'user') {
      if (message.composerDoc && renderComposer) body.append(renderComposer(message.composerDoc));else body.textContent = message.text || '';
      const toolbar = toolbarFor(message, options);if (toolbar.children.length) row.append(toolbar);
    } else {
      body.classList.add('chat-markdown');
      const start = message.stream?.startedAt ?? message.sentAt;
      records.set(row, {row, body, message, options, epoch, startedAt: Number.isFinite(start) ? start : Date.now()});
      updateStreaming(row, message);
    }
    return row;
  }
  return {
    render, updateStreaming,
    rememberTool(details, key, pending) {
      details.open = pending || toolStates.get(key) === true;
      details.addEventListener('toggle', () => { if (details.isConnected) toolStates.set(key, details.open); });
    },
    reset() { cleanups.splice(0).forEach(fn => fn());waiting.clear();epoch++;syncClock(); },
    destroy() { this.reset(); codeStates.clear(); toolStates.clear(); },
  };
}
