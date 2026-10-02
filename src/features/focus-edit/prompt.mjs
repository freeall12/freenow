import {splitPrompt} from './model.mjs';
export function paintPrompt(element, value) {
  element.replaceChildren();
  for (const part of splitPrompt(value)) {
    if (typeof part === 'string') {element.append(document.createTextNode(part)); continue;}
    const chip = document.createElement('span'); chip.className = 'focus-prompt-chip'; chip.contentEditable = 'false'; chip.dataset.focusToken = part.token;
    chip.textContent = part.mark.isLoading ? '识别中…' : part.mark.label_name; chip.title = part.mark.label_desc || part.mark.label_name || '识别中…';
    element.append(chip);
  }
}
export function readPrompt(element) {
  const block = node => ['DIV', 'P'].includes(node.nodeName);
  function read(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.dataset?.focusToken) return node.dataset.focusToken;
    if (node.nodeName === 'BR') return '\n';
    const children = [...node.childNodes];
    // Native Enter creates sibling DIVs; an empty line contains a padding BR.
    if (children.length === 1 && children[0].nodeName === 'BR') return '';
    let text = '', previous = null;
    for (const child of children) {
      if (previous && (block(child) || block(previous))) text += '\n';
      text += read(child); previous = child;
    }
    return text;
  }
  return read(element);
}
export function bindPrompt(element) {
  function selection() {const selected = getSelection(); if (!selected?.rangeCount) return null; const range = selected.getRangeAt(0); return element.contains(range.commonAncestorContainer) ? range : null;}
  element.addEventListener('copy', event => {const range = selection(); if (!range || range.collapsed) return; event.clipboardData.setData('text/plain', readPrompt(range.cloneContents())); event.preventDefault();});
  element.addEventListener('cut', event => {const range = selection(); if (!range || range.collapsed) return; event.clipboardData.setData('text/plain', readPrompt(range.cloneContents())); event.preventDefault(); range.deleteContents(); element.dispatchEvent(new Event('input', {bubbles: true}));});
  element.addEventListener('paste', event => {
    const value = event.clipboardData.getData('text/plain'); if (!value.includes('{{magic_item:')) return;
    const range = selection(); if (!range) return; event.preventDefault();
    const container = document.createElement('div'); paintPrompt(container, value);
    const fragment = document.createDocumentFragment(); while (container.firstChild) fragment.append(container.firstChild);
    const last = fragment.lastChild; range.deleteContents(); range.insertNode(fragment);
    if (last) {range.setStartAfter(last); range.collapse(true); const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range);}
    element.dispatchEvent(new Event('input', {bubbles: true}));
  });
}
