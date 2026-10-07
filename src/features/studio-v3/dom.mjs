import {icon} from './icons.mjs';

export function el(tag, className = '', text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(name, label, action, {text = '', className = 'sv3-button'} = {}) {
  const node = el('button', className); node.type = 'button'; node.title = label; node.ariaLabel = label;
  if (name) node.innerHTML = icon(name);
  if (text) node.append(el('span', 'sv3-truncate', text)); else node.dataset.iconOnly = 'true';
  node.onclick = action; return node;
}
export function renameInput(value, commit, cancel = () => {}, onError = () => {}) {
  const input = el('input', 'sv3-rename-input'); input.value = value; input.maxLength = 120;
  input.ariaLabel = '名称'; let done = false, pending = false;
  const finish = async accepted => {
    if (done || pending) return;
    const name = input.value.trim();
    if (!accepted || !name) {done = true; cancel(); return;}
    pending = true; input.readOnly = true; input.setAttribute('aria-busy', 'true');
    try {done = await commit(name) !== false;}
    catch (error) {onError(error);}
    finally {
      pending = false; input.readOnly = false; input.removeAttribute('aria-busy');
      if (!done && input.isConnected) {input.focus(); input.select();}
    }
  };
  input.addEventListener('keydown', event => {
    event.stopPropagation(); if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {event.preventDefault(); finish(true);}
    if (event.key === 'Escape') {event.preventDefault(); finish(false);}
  });
  input.addEventListener('blur', () => finish(true)); return input;
}
