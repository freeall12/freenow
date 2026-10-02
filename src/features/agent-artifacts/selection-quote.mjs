import { icons } from './icons.mjs';
export function createSelectionQuote({ container, onQuote, onError }) {
  let popup = null, frame = 0, text = '';
  function hide() { popup?.remove(); popup = null; text = ''; }
  function outside(event) { if (!popup?.contains(event.target)) hide(); }
  function selected() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return hide();
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return hide();
      hide(); text = selection.toString().trim();
      const rect = range.getBoundingClientRect();
      popup = document.createElement('button'); popup.type = 'button'; popup.className = 'brainstorm-quote-popup';
      popup.innerHTML = icons.quote; popup.append(document.createTextNode('添加到对话'));
      popup.onpointerdown = event => event.preventDefault();
      popup.onclick = async () => {
        const quote = text;
        try { await onQuote(quote); window.getSelection()?.removeAllRanges(); hide(); } catch (error) { onError?.(error.message); }
      };
      document.body.append(popup);
      popup.style.left = Math.max(8, Math.min(innerWidth - popup.offsetWidth - 8, rect.left + rect.width / 2 - popup.offsetWidth / 2)) + 'px';
      popup.style.top = (rect.top - 36 < container.getBoundingClientRect().top + 4 ? rect.bottom + 8 : rect.top - 36) + 'px';
    });
  }
  container.addEventListener('mouseup', selected); container.addEventListener('keyup', selected);
  document.addEventListener('mousedown', outside); window.addEventListener('scroll', hide, true);
  return { destroy() { cancelAnimationFrame(frame); hide(); container.removeEventListener('mouseup', selected); container.removeEventListener('keyup', selected); document.removeEventListener('mousedown', outside); window.removeEventListener('scroll', hide, true); } };
}
