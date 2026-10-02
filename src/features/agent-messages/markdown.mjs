import { MarkdownManager } from '@tiptap/markdown';

const parser = new MarkdownManager().instance;
const renderer = new parser.Renderer();
const escape = text => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));

export function safeMessageLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

// Model output is untrusted. Never mount raw HTML or automatically fetch images.
renderer.html = () => '';
renderer.link = function (token) {
  const label = this.parser.parseInline(token.tokens), href = safeMessageLink(token.href);
  return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
};
renderer.image = token => {
  const href = safeMessageLink(token.href), label = escape(token.text || '图片');
  return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
};
renderer.code = token => `<div class="chat-code-block" data-wrap="on" data-language="${escape((token.lang || '').split(/\s/)[0].toLowerCase())}"><pre><code>${escape(token.text)}</code></pre></div>`;
renderer.table = function (token) {
  return `<div class="agent-message-table">${parser.Renderer.prototype.table.call(this, token)}</div>`;
};
export function renderMessageMarkdown(text) {
  return parser.parser(parser.lexer(String(text || ''), { gfm: true }), { renderer, gfm: true });
}
