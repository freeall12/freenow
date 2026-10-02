import { icons } from './icons.mjs';
import { normalizeTitle, relativeTime, titleLimit } from './conversations.mjs';
import { bindTooltip } from '../agent-composer/tooltip.mjs';
export { historyEntries } from './conversations.mjs';

const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = new URL('./styles.css', import.meta.url).href;
document.head.append(style);

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconButton(name, label) {
  const button = element('button', 'agent-history-action');
  button.type = 'button'; button.ariaLabel = label;
  button.innerHTML = icons[name];
  return button;
}

export function createControl({ title, align = 'end', disabled = false, getConversations, onSelect, onNew, onRename, onDelete, beforeOpen, onError }) {
  const trigger = element('button', title !== undefined ? 'agent-history-title' : 'agent-history-trigger');
  trigger.type = 'button'; trigger.disabled = disabled;
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  if (title !== undefined) {
    trigger.append(element('span', '', title)); trigger.insertAdjacentHTML('beforeend', icons.chevron);
    trigger.ariaLabel = title;
  } else { trigger.innerHTML = icons.history; trigger.ariaLabel = '聊天记录'; }

  let menu = null, list = null, leaving = null, exitTimer = 0, requestVersion = 0;
  let entries = [], editing = null, deleting = null, observer = null, tooltipSuppressed = false;
  let visibleCount = 20, pageObserver = null;
  const tooltip = bindTooltip(trigger, { text: () => title === undefined ? '聊天记录' : '', enabled: () => !menu && !disabled && !tooltipSuppressed });
  trigger.addEventListener('pointerleave', () => { tooltipSuppressed = false; });

  function position() {
    if (!menu) return;
    const rect = trigger.getBoundingClientRect();
    const maxHeight = Math.max(60, innerHeight - rect.bottom - 16);
    menu.style.maxHeight = `${maxHeight}px`;
    const left = align === 'start' ? rect.left : rect.right - menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, left))}px`;
    menu.style.top = `${rect.bottom + 8}px`;
  }
  function items() { return [...menu.querySelectorAll('[role=menuitem]')]; }
  function focusRow(row, keyboard = false) {
    if (editing) return;
    for (const item of items()) { item.dataset.highlighted = String(item === row); item.dataset.keyboard = String(item === row && keyboard); }
    if (document.activeElement !== row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  }
  function select(id) { close(true); onSelect(id); }
  function renderList() {
    if (!list) return;
    const scrollTop = list.scrollTop;
    pageObserver?.disconnect(); pageObserver = null;
    list.replaceChildren();
    if (!entries.length) {
      const empty = element('div', 'agent-history-empty');
      empty.innerHTML = icons.empty;
      empty.append(element('p', '', '暂无历史记录')); list.append(empty); return;
    }
    for (const chat of entries.slice(0, visibleCount)) {
      const row = element('div', 'agent-history-row'); row.role = 'menuitem'; row.tabIndex = -1;
      row.dataset.conversation = chat.id;
      const label = chat.title || '未命名对话';
      row.onclick = () => { if (!editing) select(chat.id); };
      row.onpointermove = () => { if (!editing) focusRow(row); };
      row.onpointerleave = () => { if (!editing) { row.dataset.highlighted = 'false'; row.dataset.keyboard = 'false'; } };
      if (editing?.id === chat.id) {
        row.classList.add('editing');
        const input = element('input', 'agent-history-rename'); input.type = 'text';
        input.value = editing.title; input.maxLength = titleLimit; input.ariaLabel = '重命名对话';
        input.oninput = () => { if (editing) editing.title = input.value; };
        input.onclick = event => event.stopPropagation();
        input.onblur = () => { void commitRename(); };
        input.onkeydown = event => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); void commitRename(true); }
          if (event.key === 'Escape') { event.preventDefault(); cancelRename(); }
        };
        row.append(input);
        queueMicrotask(() => { if (input.isConnected) { input.focus(); input.select(); } });
      } else {
        row.append(element('span', 'agent-history-label', label));
        const time = element('span', 'agent-history-time', relativeTime(chat.updatedAt || chat.createdAt));
        const actions = element('div', 'agent-history-actions');
        const rename = iconButton('rename', 'rename conversation');
        rename.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          editing = { id: chat.id, title: label, original: label }; renderList();
        };
        const remove = iconButton(deleting === chat.id ? 'loading' : 'delete', 'delete conversation');
        remove.classList.add('agent-history-delete'); remove.disabled = deleting === chat.id;
        remove.onclick = async event => {
          event.preventDefault(); event.stopPropagation(); if (deleting) return;
          deleting = chat.id; renderList();
          try {
            await onDelete(chat.id);
            if (!menu) return;
            entries = entries.filter(entry => entry.id !== chat.id);
          } catch (error) { onError?.(error.message || '删除失败'); }
          finally { deleting = null; renderList(); position(); }
        };
        if (deleting === chat.id) row.classList.add('deleting');
        actions.append(rename, remove); row.append(time, actions);
      }
      list.append(row);
    }
    list.scrollTop = scrollTop;
    if (visibleCount < entries.length) {
      const sentinel = element('div', 'agent-history-page-end'); list.append(sentinel);
      pageObserver = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting || editing || !list) return;
        visibleCount += 20; renderList();
      }, { root: list, threshold: .1 });
      pageObserver.observe(sentinel);
    }
  }
  function cancelRename() {
    const id = editing?.id; editing = null; renderList();
    const row = list?.querySelector(`[data-conversation="${CSS.escape(id || '')}"]`);
    if (row) focusRow(row, true);
  }
  async function commitRename(restoreFocus = false) {
    if (!editing) return;
    const edit = editing; editing = null;
    const value = normalizeTitle(edit.title), chat = entries.find(entry => entry.id === edit.id);
    const restore = () => { if (restoreFocus) { const row = list?.querySelector(`[data-conversation="${CSS.escape(edit.id)}"]`); if (row) focusRow(row, true); } };
    if (!value || value === edit.original || !chat) { renderList(); restore(); return; }
    chat.title = value; renderList();
    restore();
    try { await onRename(edit.id, value); }
    catch (error) { chat.title = edit.original; renderList(); onError?.(error.message || '重命名失败'); }
  }
  function keydown(event) {
    if (event.target.matches('input')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    const all = items(), active = event.target.closest('[role=menuitem]');
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const index = all.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      if (all[next]) focusRow(all[next], true);
    } else if ((event.key === 'Enter' || event.key === ' ') && active && event.target === active) {
      event.preventDefault(); active.click();
    }
  }
  function outside(event) {
    if (menu?.contains(event.target) || trigger.contains(event.target)) return;
    void commitRename(); close();
  }
  async function open() {
    if (disabled) return;
    beforeOpen?.(); tooltip.hide(); clearTimeout(exitTimer); leaving?.remove(); leaving = null; visibleCount = 20;
    menu = element('div', 'agent-history-menu'); menu.role = 'menu'; menu.tabIndex = -1;
    menu.ariaLabel = trigger.ariaLabel; menu.dataset.state = 'open'; menu.dataset.align = align;
    const create = element('div', 'agent-history-new'); create.role = 'menuitem'; create.tabIndex = -1;
    create.innerHTML = icons.plus; create.append(element('span', '', '新建对话'));
    create.onclick = () => { close(true); onNew(); }; create.onpointermove = () => focusRow(create);
    create.onpointerleave = () => { if (!editing) create.dataset.highlighted = 'false'; };
    list = element('div', 'agent-history-list');
    menu.append(create, list); menu.addEventListener('keydown', keydown);
    document.body.append(menu); trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', position, true); window.addEventListener('resize', position);
    observer = new ResizeObserver(position); observer.observe(menu); observer.observe(trigger);
    const panel = trigger.closest('.agent-panel'); if (panel) observer.observe(panel);
    const version = ++requestVersion;
    let result;
    try { result = getConversations(); }
    catch (error) { entries = []; renderList(); position(); onError?.(error.message || '无法加载历史记录'); return; }
    if (result && typeof result.then === 'function') {
      const skeleton = element('div', 'agent-history-skeleton'); skeleton.ariaLabel = '加载对话中...';
      for (let i = 0; i < 4; i++) { const row = element('div', ''); row.append(element('span', ''), element('span', '')); skeleton.append(row); }
      list.append(skeleton);
    }
    position(); focusRow(create);
    try { entries = await result; if (version !== requestVersion || !menu) return; renderList(); position(); }
    catch (error) { if (version !== requestVersion || !menu) return; entries = []; renderList(); onError?.(error.message || '无法加载历史记录'); }
  }
  function close(focus = false) {
    if (!menu) return;
    editing = null; ++requestVersion; tooltipSuppressed = true; tooltip.hide(); observer?.disconnect(); observer = null;
    pageObserver?.disconnect(); pageObserver = null;
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', position, true); window.removeEventListener('resize', position);
    const old = menu; menu = null; list = null; trigger.setAttribute('aria-expanded', 'false');
    old.dataset.state = 'closed'; old.inert = true; old.setAttribute('aria-hidden','true'); old.style.pointerEvents = 'none'; leaving = old;
    clearTimeout(exitTimer); exitTimer = setTimeout(() => { old.remove(); if (leaving === old) leaving = null; }, 150);
    if (focus) trigger.focus({ preventScroll: true });
  }
  trigger.onclick = () => { if (menu) close(); else void open(); };
  trigger.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (!menu) void open(); } };
  return { element: trigger, close, destroy() { close(); tooltip.destroy(); clearTimeout(exitTimer); leaving?.remove(); } };
}
