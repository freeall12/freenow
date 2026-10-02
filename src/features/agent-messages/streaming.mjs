// J5/mS, official canvas release: status only, never reasoning content.
export function elapsedText(startedAt, now) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (!Number.isFinite(seconds) || seconds < 5) return '';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? `${seconds % 60}s` : ''}`;
}

// The supplied Markdown renderer sanitizes HTML/URLs. Patch its inert parsed
// tree so settled paragraphs and the actively growing text node keep identity.
export function patchMarkdown(body, html) {
  const template = body.ownerDocument.createElement('template');
  template.innerHTML = html;
  function patch(parent, incoming) {
    const next = [...incoming.childNodes];
    for (let index = 0; index < next.length; index++) {
      const source = next[index], current = parent.childNodes[index];
      if (!current) {parent.append(source.cloneNode(true)); continue;}
      if (current.isEqualNode(source)) continue;
      if (current.nodeType !== source.nodeType || current.nodeName !== source.nodeName) {
        current.replaceWith(source.cloneNode(true)); continue;
      }
      if (current.nodeType !== 1) {current.nodeValue = source.nodeValue; continue;}
      for (const attribute of [...current.attributes]) if (!source.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
      for (const attribute of source.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
      patch(current, source);
    }
    while (parent.childNodes.length > next.length) parent.lastChild.remove();
  }
  patch(body, template.content);
}

export function createStreamStatus(document) {
  const output = document.createElement('output');output.className = 'agent-stream-status';
  output.setAttribute('data-no-quote', 'true');output.setAttribute('aria-live', 'polite');
  const icon = document.createElement('img');icon.src = new URL('../../../assets/agent-motion-thinking.webp', import.meta.url).href;icon.alt = '';
  const label = document.createElement('span');label.className = 'agent-stream-label';
  const time = document.createElement('span');time.className = 'agent-stream-elapsed';time.setAttribute('aria-hidden', 'true');
  output.append(icon, label, time);
  return {element: output, update(message, startedAt, now) {
    const text = message.stream?.compaction?.status === 'running' ? '正在整理上下文…' : message.stream?.thinking === true ? '思考中...' : '处理中...';
    if (label.textContent !== text) {label.textContent = text;label.style.setProperty('--spread', `${text.length * 1.4}px`);}
    const elapsed = elapsedText(startedAt, now), value = elapsed ? `· ${elapsed}` : '';
    if (time.textContent !== value) time.textContent = value;
    if (time.hidden !== !elapsed) time.hidden = !elapsed;
  }};
}

export function createInterruptedStatus(document, error) {
  const output = document.createElement('div');output.className = 'agent-stream-interrupted';output.setAttribute('role', 'status');output.setAttribute('data-no-quote', 'true');
  const label = document.createElement('span');label.textContent = error || '你已停止本次回复';output.append(label);
  return output;
}
