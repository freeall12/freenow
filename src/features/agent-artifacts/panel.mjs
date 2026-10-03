import { icons } from './icons.mjs';
import { basename, label, primary } from './model.mjs';
import { createLayout } from './layout.mjs';
import { bindTooltip } from '../agent-composer/tooltip.mjs';
import { openHtmlPreview } from './html-preview.mjs';
import { createBrainstorm } from './brainstorm.mjs';
import { brainstormPath } from './brainstorm-model.mjs';

const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./styles.css', import.meta.url); document.head.append(style);
const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
function button(text, action, icon, className = '') {
  const node = el('button', className); node.type = 'button'; node.ariaLabel = text;
  if (icon) node.innerHTML = icons[icon]; else node.textContent = text;
  node.onclick = action; return node;
}

export function createPanel({ store, anchor, onAdd, onDiscuss, onError, onShare, onQuote, onStart, generation,getHtmlResourceOptions }) {
  let element = null, content = null, layout = null, selectedPath = null, epoch = 0, selectionEpoch = 0, closing = null, trigger = null, triggerTooltip = null, preview = null,previewPath=null, brainstorm = null, collapse = null;
  function closePreview(){preview?.close();preview=null;previewPath=null;}
  function syncCollapse() { if (collapse) collapse.hidden = !!anchor || !!selectedPath; }
  function syncTrigger() { trigger?.setAttribute('aria-pressed', String(!!element && !closing)); }
  function errorMessage(error) { onError?.(error.message || String(error)); }
  function showError(error, retry) {
    content.replaceChildren(el('p', 'agent-artifact-status', error.message));
    if (retry) content.append(button('重试', retry, null, 'agent-artifact-retry'));
    layout.update();
  }
  async function render() {
    if (!element || closing) return;
    const token = ++epoch;
    if (!(selectedPath === brainstormPath && brainstorm)) content.replaceChildren(el('p', 'agent-artifact-status', '加载中…'));
    try {
      if (!selectedPath) {
        const files = await store.list();
        if (token !== epoch || !element) return;
        const list = el('div', 'agent-artifact-list' + (files.length ? '' : ' empty'));
        list.append(el('h3', '', '文件'));
        if (!files.length) list.append(el('div', 'agent-artifact-empty', '暂无输出'));
        let previousPrimary = true;
        for (const file of files) {
          if (previousPrimary && !primary(file) && list.children.length > 1) list.append(el('hr', 'agent-artifact-divider'));
          previousPrimary = primary(file);
          const icon = file.artifact_path === 'artifacts/brainstorm.md' ? 'brainstorm' : ['markdown','html','image','csv'].includes(file.content_type) ? file.content_type : 'text';
          const row = button(label(file), () => select(file.artifact_path), icon, 'agent-artifact-row');
          row.dataset.primary = String(primary(file)); row.append(el('span', '', label(file))); list.append(row);
        }
        content.replaceChildren(list);
      } else {
        const file = await store.get(selectedPath);
        if (token !== epoch || !element) return;
        if (selectedPath === brainstormPath) {
          if (brainstorm) brainstorm.update(file);
          else brainstorm = createBrainstorm({ file, store, generation, onBack: back, onAdd, onQuote, onStart, onOpenHtml: select, onError });
          content.replaceChildren(brainstorm.element); layout.update(); return;
        }
        const header = el('header', 'agent-artifact-header');
        header.append(button('返回文件', back, 'back'), el('span', '', basename(file.artifact_path)));
        const body = el('div', 'agent-artifact-body');
        if (file.content_type === 'image') body.append(el('p', 'agent-artifact-status', '暂不支持预览此文件类型'));
        else if (file.content_type === 'markdown' && window.TextEditor?.html) {
          const article = el('article', 'canvas-text-markdown agent-artifact-markdown'); article.innerHTML = window.TextEditor.html(file.content); body.append(article);
        } else body.append(el('pre', '', file.content));
        content.replaceChildren(header, body);
        if (file.content_type !== 'image') {
          const footer = el('footer', 'agent-artifact-footer');
          footer.append(button('添加到画布', () => act(() => onAdd(file)), null), button('在对话中讨论', () => act(() => onDiscuss(file)), null)); content.append(footer);
        }
      }
      layout.update();
    } catch (error) { if (token === epoch && element) showError(error, render); }
  }
  async function act(action) { try { await action(); } catch (error) { errorMessage(error); } }
  async function select(path) {
    const version = ++selectionEpoch;closePreview();
    try {
      const file = await store.get(path);
      if (!element || closing || version !== selectionEpoch) return;
      if (file.content_type === 'html') {
        previewPath=path;
        preview=openHtmlPreview({file,onShare,onError,getCurrentFile:()=>store.get(path),isCurrent:()=>!!element&&!closing&&version===selectionEpoch,getResourceOptions:getHtmlResourceOptions});return true;
      }
      selectedPath = path; layout.mode(true); await render();
      syncCollapse();
    } catch (error) { if(version === selectionEpoch)errorMessage(error);return false; }
  }
  function back() { selectionEpoch++;closePreview();brainstorm?.suspend(); selectedPath = null; layout.mode(false); render(); syncCollapse(); }
  function remove() { epoch++;selectionEpoch++;closePreview(); brainstorm?.destroy(); brainstorm = null; layout?.destroy(); layout = null; element?.remove(); element = null; closing = null; syncTrigger(); }
  function close({ immediate = false } = {}) {
    triggerTooltip?.hide();
    if (!element || closing) return;
    const restoreFocus = element.contains(document.activeElement);
    epoch++;selectionEpoch++;closePreview();brainstorm?.suspend();element.inert = true;element.setAttribute('aria-hidden','true');
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (immediate) remove();
    else { element.dataset.state = 'closed'; closing = setTimeout(remove, 280); syncTrigger(); }
  }
  function open() {
    if (closing) { clearTimeout(closing); closing = null; remove(); }
    if (element) return;
    selectedPath = null;
    element = el('section', 'agent-artifact-panel'); element.ariaLabel = '文件'; element.dataset.state = 'open';
    element.onkeydown = event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault();event.stopPropagation();close(); } };
    content = el('div', 'agent-artifact-content'); element.append(content); document.body.append(element);
    collapse = button('收起', () => close(), 'collapse', 'agent-artifact-collapse'); element.append(collapse); syncCollapse();
    layout = createLayout({ element, content, anchor, isDetail: () => !!selectedPath, onError });
    layout.reset(); render(); syncTrigger();
  }
  const unsubscribe = store.subscribe(file => {if(previewPath&&(!file||file.artifact_path===previewPath)){selectionEpoch++;closePreview();}render();});
  return {
    open, close, select,
    setAnchor(next) { anchor = next; triggerTooltip?.hide(); layout?.setAnchor(next); syncCollapse(); },
    createTrigger() {
      triggerTooltip?.destroy();
      trigger = button('侧边栏', () => { triggerTooltip?.hide(); element && !closing ? close() : open(); }, 'sidebar', 'agent-artifact-trigger');
      triggerTooltip = bindTooltip(trigger, { text: () => '侧边栏' }); syncTrigger(); return trigger;
    },
    destroy() { if (closing) clearTimeout(closing); closePreview(); triggerTooltip?.destroy(); unsubscribe(); remove(); },
  };
}
