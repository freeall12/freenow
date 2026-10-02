import { commands } from './catalog.mjs';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./menu.css', import.meta.url).href;
document.head.append(stylesheet);

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function bindMenu({ panel, prompt, getState, onSelect, onOpen }) {
  const menu = el('div', 'prompt-shortcuts');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', '图片快捷指令');
  menu.id = 'image-prompt-shortcuts';
  menu.hidden = true;
  const list = el('div', 'prompt-shortcuts-list');
  const hint = el('div', 'prompt-shortcuts-hint', '使用此快捷功能需至少连入一张图片，可连入文本节点加强控制。');
  menu.append(list, hint);
  panel.append(menu);
  let selected = 0;
  const rows = commands.map((command, index) => {
    const row = el('div', 'prompt-shortcut-row');
    row.id = `image-shortcut-${command.id}`;
    row.dataset.command = command.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-label', command.title);
    const icon = el('span', 'prompt-shortcut-icon');
    icon.innerHTML = command.icon;
    icon.setAttribute('aria-hidden', 'true');
    const content = el('span', 'prompt-shortcut-content');
    content.append(el('span', 'prompt-shortcut-title', command.title), el('span', 'prompt-shortcut-description', command.description));
    row.append(icon, content);
    row.onmouseenter = () => { selected = index; sync(); };
    row.onpointerdown = event => event.preventDefault();
    row.onclick = () => choose(index);
    list.append(row);
    return row;
  });

  function sync() {
    const { busy, referenceCount } = getState();
    for (let index = 0; index < rows.length; index++) {
      rows[index].setAttribute('aria-selected', index === selected);
      rows[index].setAttribute('aria-disabled', busy || referenceCount === 0);
    }
    hint.hidden = referenceCount > 0 || busy;
    prompt.setAttribute('aria-activedescendant', rows[selected].id);
  }
  function close() {
    menu.hidden = true;
    prompt.setAttribute('aria-expanded', 'false');
    prompt.removeAttribute('aria-activedescendant');
  }
  function open() {
    if (getState().busy) return;
    onOpen?.();
    if (menu.hidden) selected = 0;
    menu.hidden = false;
    prompt.setAttribute('aria-expanded', 'true');
    sync();
  }
  function choose(index) {
    const state = getState();
    if (state.busy || !state.referenceCount) return;
    const command = commands[index];
    close();
    onSelect(command);
  }
  function input(event) {
    if (event?.isComposing) return;
    const text = prompt.innerText;
    if (text === '/' || text === '、') open();
    else if (!text.startsWith('/') && !text.startsWith('、')) close();
  }
  function keydown(event) {
    if (menu.hidden || event.isComposing || event.keyCode === 229) return;
    if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key) || event.key === 'Enter' && event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') return close();
    if (event.key === 'Enter' || event.key === 'Tab') return choose(selected);
    selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length;
    sync();
    rows[selected].scrollIntoView({ block: 'nearest' });
  }
  function outside(event) {
    if (!menu.contains(event.target) && !prompt.contains(event.target)) close();
  }
  prompt.setAttribute('aria-controls', menu.id);
  prompt.setAttribute('aria-haspopup', 'listbox');
  prompt.setAttribute('aria-expanded', 'false');
  prompt.addEventListener('input', input);
  prompt.addEventListener('compositionend', input);
  prompt.addEventListener('keydown', keydown, true);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  return {
    close,
    update() { if (getState().busy || panel.hidden) close(); else if (!menu.hidden) sync(); },
    destroy() {
      close();
      prompt.removeEventListener('input', input);
      prompt.removeEventListener('compositionend', input);
      prompt.removeEventListener('keydown', keydown, true);
      prompt.removeAttribute('aria-controls');
      prompt.removeAttribute('aria-haspopup');
      prompt.removeAttribute('aria-expanded');
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      menu.remove();
    },
  };
}
