import {resultModeIcons, preferencesCloseIcon, preferencesCanvasIcon} from './icons.mjs';

export const RESULT_MODE_KEY = 'tapnow.canvas.generation-result-mode';
export const RESULT_MODE_EVENT = 'canvas:generation-result-mode';
export const RESULT_MODES = Object.freeze(['pile', 'variants', 'spread']);
const officialEvent = 'tapnow:generation-result-mode-change';
const isMode = value => RESULT_MODES.includes(value);
let mountedId = 0, dialogSession;

export function getResultMode() {
  try {
    const mode = globalThis.localStorage?.getItem(RESULT_MODE_KEY);
    return isMode(mode) ? mode : 'variants';
  } catch { return 'variants'; }
}

export function setResultMode(mode) {
  if (!isMode(mode)) throw new TypeError('生成结果模式无效');
  if (!globalThis.localStorage) throw Error('当前环境无法保存画布偏好');
  globalThis.localStorage.setItem(RESULT_MODE_KEY, mode);
  globalThis.window?.dispatchEvent(new CustomEvent(RESULT_MODE_EVENT, {detail: {mode}}));
  globalThis.window?.dispatchEvent(new Event(officialEvent));
  return mode;
}

export function subscribeResultMode(callback) {
  const target = globalThis.window;
  if (!target) return () => {};
  let previous = getResultMode();
  const notify = () => {
    const mode = getResultMode();
    if (mode !== previous) { previous = mode; callback(mode); }
  };
  const storage = event => { if (event.key === RESULT_MODE_KEY || event.key === null) notify(); };
  target.addEventListener(RESULT_MODE_EVENT, notify);
  target.addEventListener(officialEvent, notify);
  target.addEventListener('storage', storage);
  return () => {
    target.removeEventListener(RESULT_MODE_EVENT, notify);
    target.removeEventListener(officialEvent, notify);
    target.removeEventListener('storage', storage);
  };
}

const labels = {pile: '堆叠', variants: '多变体', spread: '铺开'};
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function ensureStyles() {
  if (document.querySelector('link[data-generation-result-preferences]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./preferences.css', import.meta.url).href;
  link.dataset.generationResultPreferences = '';
  document.head.append(link);
}

export function mountPreferences(container) {
  ensureStyles();
  const root = element('section', 'generation-result-preferences');
  const header = element('header', 'generation-preferences-header');
  const title = element('h2', '', '画布设置');
  header.append(title, element('p', '', '管理画布中的默认行为和显示偏好。'));
  const row = element('section', 'generation-preferences-row');
  const description = element('div', 'generation-preferences-description');
  const heading = element('h3', '', '批量生成结果');
  heading.id = `generation-preferences-title-${++mountedId}`;
  description.append(heading, element('p', '', '选择一次生成多个结果时的默认保存方式。'));
  const group = element('div', 'generation-result-mode-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', heading.id);
  const buttons = RESULT_MODES.map(mode => {
    const button = element('button', 'generation-result-mode');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.resultMode = mode;
    const icon = element('span', 'generation-result-mode-icon');
    icon.innerHTML = resultModeIcons[mode];
    button.append(icon, element('span', '', labels[mode]));
    button.addEventListener('click', () => choose(mode));
    button.addEventListener('focus', () => tabStop(button));
    group.append(button);
    return button;
  });
  const error = element('p', 'generation-preferences-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  function tabStop(active) { for (const button of buttons) button.tabIndex = button === active ? 0 : -1; }
  function sync() {
    const mode = getResultMode();
    for (const button of buttons) {
      const checked = button.dataset.resultMode === mode;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    }
  }
  function choose(mode) {
    try { setResultMode(mode); error.hidden = true; }
    catch { error.textContent = '画布偏好保存失败，请检查浏览器存储后重试。'; error.hidden = false; }
    sync();
  }
  group.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const arrows = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (![...arrows, 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    let key = event.key;
    if (globalThis.getComputedStyle?.(group).direction === 'rtl') {
      if (key === 'ArrowLeft') key = 'ArrowRight'; else if (key === 'ArrowRight') key = 'ArrowLeft';
    }
    const next = ['Home', 'PageUp'].includes(key) ? 0 : ['End', 'PageDown'].includes(key) ? buttons.length - 1 :
      (index + (['ArrowRight', 'ArrowDown'].includes(key) ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    tabStop(buttons[next]);
    if (arrows.includes(key) && buttons[next].dataset.resultMode !== getResultMode()) choose(buttons[next].dataset.resultMode);
  });
  group.addEventListener('focusout', () => queueMicrotask(() => { if (!group.contains(document.activeElement)) sync(); }));
  row.append(description, group);
  root.append(header, row, error);
  container.append(root);
  sync();
  const unsubscribe = subscribeResultMode(sync);
  return {element: root, focus: () => buttons.find(button => button.tabIndex === 0)?.focus(), destroy() { unsubscribe(); root.remove(); }};
}

export function openPreferences() {
  if (dialogSession?.dialog.isConnected) { dialogSession.mount.focus(); return dialogSession.dialog; }
  const previousFocus = document.activeElement;
  const dialog = element('dialog', 'generation-preferences-dialog');
  dialog.setAttribute('aria-label', 'Settings');
  const close = element('button', 'generation-preferences-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = preferencesCloseIcon;
  close.addEventListener('click', () => dialog.close());
  dialog.append(close);
  const shell = element('div', 'generation-preferences-shell');
  const sidebar = element('aside', 'generation-preferences-sidebar');
  const nav = element('nav', 'generation-preferences-nav');
  nav.setAttribute('aria-label', '通用设置');
  const sectionLabel = element('div', 'generation-preferences-nav-label', '通用设置');
  const selected = element('button', 'generation-preferences-nav-item');
  selected.type = 'button';
  selected.setAttribute('aria-current', 'page');
  const navIcon = element('span', 'generation-preferences-nav-icon');
  navIcon.innerHTML = preferencesCanvasIcon;
  selected.append(navIcon, element('span', '', '画布设置'));
  nav.append(sectionLabel, selected);
  sidebar.append(nav);
  const content = element('div', 'generation-preferences-content');
  const mount = mountPreferences(content);
  selected.addEventListener('click', () => mount.focus());
  shell.append(sidebar, content);
  dialog.append(shell);
  dialog.addEventListener('close', () => {
    mount.destroy(); dialog.remove();
    if (dialogSession?.dialog === dialog) dialogSession = null;
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
  }, {once: true});
  // Official settings prevent outside clicks from closing the modal.
  document.body.append(dialog);
  dialogSession = {dialog, mount};
  dialog.showModal();
  mount.focus();
  return dialog;
}
