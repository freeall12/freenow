import { icons } from './icons.mjs';
import { parseBrainstorm, sectionMarkdown, changesBetween, cardKey } from './brainstorm-model.mjs';
import { createMenu } from './brainstorm-menu.mjs';
import { createSelectionQuote } from './selection-quote.mjs';
import { bindTooltip } from '../agent-composer/tooltip.mjs';
import { relativeTime } from '../agent-history/conversations.mjs';

const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
function button(label, action, icon, className = '') {
  const node = el('button', className); node.type = 'button'; node.ariaLabel = label;
  if (icon) node.innerHTML = icons[icon]; else node.textContent = label;
  node.onclick = action; return node;
}
const dot = () => el('i', 'brainstorm-unread');

export function createBrainstorm({ file: initialFile, store, generation, onBack, onAdd, onQuote, onStart, onOpenHtml, onError }) {
  const element = el('div', 'brainstorm-detail');
  let file = initialFile, parsed = parseBrainstorm(file.content), sectionIndex = 0, candidateIndexes = {}, clearPending = false, disposed = false, renderEpoch = 0;
  const unreadSections = new Set(), unreadCards = new Set();
  let controls = [], quoteControl = null, generationTooltip = null, outputs = [];
  const readKey = store.namespace + '-artifact-read';
  let readRevisions = {};
  try { readRevisions = JSON.parse(localStorage.getItem(readKey) || '{}'); } catch {}
  if (!readRevisions || typeof readRevisions !== 'object' || Array.isArray(readRevisions)) readRevisions = {};
  function disposeControls() { controls.forEach(control => control.destroy()); controls = []; quoteControl?.destroy(); quoteControl = null; generationTooltip?.destroy(); generationTooltip = null; }
  async function act(action) { try { await action(); } catch (error) { onError?.(error.message); } }
  async function clear() {
    if (clearPending) return;
    clearPending = true;
    try {
      await store.write({ artifact_path: file.artifact_path, title: file.title, content_type: 'markdown', content: '', expected_revision: file.revision });
      sectionIndex = 0; candidateIndexes = {}; unreadCards.clear(); unreadSections.clear();
    } catch (error) { onError?.(error.message); } finally { clearPending = false; }
  }
  function render() {
    if (disposed) return;
    const token = ++renderEpoch;
    disposeControls(); element.replaceChildren();
    const sections = parsed.sections.filter(section => !section.isEmpty);
    sectionIndex = Math.min(sectionIndex, Math.max(0, sections.length - 1));
    const section = sections[sectionIndex], candidateIndex = candidateIndexes[sectionIndex] || 0, candidate = section?.cards[candidateIndex];
    if (section) unreadSections.delete(section.title);
    if (section && candidate) unreadCards.delete(cardKey(section.title, candidate.shortLabel));
    const header = el('header', 'brainstorm-header'); header.dataset.populated = String(!!sections.length);
    const title = el('div', 'brainstorm-title'); title.append(el('h3', '', parsed.title || 'Untitled'));
    if (file.updated_at) title.append(el('span', 'brainstorm-time', relativeTime(file.updated_at)));
    const more = button('更多操作', null, 'more', 'brainstorm-more');
    const moreMenu = createMenu({ trigger: more, align: 'end', className: 'brainstorm-more-menu', items: () => [{ label: '清空内容', icon: 'trash', destructive: true, run: clear }], onError });
    const tip = bindTooltip(more, { text: () => '更多操作', enabled: () => more.getAttribute('aria-expanded') !== 'true' });
    controls.push(moreMenu, tip); header.append(button('返回文件', onBack, 'back'), title, more); element.append(header);
    if (section) {
      const toolbar = el('div', 'brainstorm-toolbar'), pickerWrap = el('div', 'brainstorm-picker-wrap');
      const picker = button('选择章节', null, null, 'brainstorm-section'); picker.textContent = ''; picker.append(el('span', '', section.title));
      if ([...unreadSections].some(title => title !== section.title)) picker.append(dot());
      picker.insertAdjacentHTML('beforeend', icons.chevron); pickerWrap.append(picker);
      const sectionMenu = createMenu({ trigger: picker, className: 'brainstorm-section-menu', items: () => sections.map((item, index) => ({ label: item.title, selected: index === sectionIndex, unread: unreadSections.has(item.title), run: () => { sectionIndex = index; render(); } })), onError });
      controls.push(sectionMenu);
      const add = button('添加到画布', () => act(() => onAdd({ ...file, title: section.title, content: sectionMarkdown(file.content, section.title) })), null);
      const discuss = button('讨论', () => act(() => onQuote(sectionMarkdown(file.content, section.title))), null);
      toolbar.append(pickerWrap, add, discuss); element.append(toolbar);
      if (section.cards.length) {
        const tabs = el('div', 'brainstorm-tabs'); tabs.role = 'tablist'; tabs.ariaLabel = section.title + '候选';
        section.cards.forEach((card, index) => {
          if (!card.shortLabel.trim()) return;
          const tab = button(card.shortLabel, () => { candidateIndexes[sectionIndex] = index; render(); element.querySelector('[role=tab][aria-selected=true]')?.focus(); }, null);
          tab.role = 'tab'; tab.setAttribute('aria-selected', String(index === candidateIndex)); tab.tabIndex = index === candidateIndex ? 0 : -1;
          if (index !== candidateIndex && unreadCards.has(cardKey(section.title, card.shortLabel))) tab.append(dot());
          tab.onkeydown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const valid = section.cards.map((item, position) => item.shortLabel.trim() ? position : -1).filter(position => position >= 0), offset = valid.indexOf(index);
            candidateIndexes[sectionIndex] = event.key === 'Home' ? valid[0] : event.key === 'End' ? valid.at(-1) : valid[(offset + (event.key === 'ArrowRight' ? 1 : -1) + valid.length) % valid.length];
            render(); element.querySelector('[role=tab][aria-selected=true]')?.focus();
          };
          tabs.append(tab);
        });
        element.append(tabs);
      }
      const body = el('div', 'brainstorm-body'), card = el('div', 'brainstorm-card');
      if (candidate?.longLabel) card.append(el('p', 'brainstorm-long-label', candidate.longLabel));
      const fields = el('ul', 'brainstorm-fields');
      for (const field of (section.cards.length ? candidate?.fields || [] : section.fields)) {
        const row = el('li'); row.append(el('span', '', field.name + '：'), document.createTextNode(field.value)); fields.append(row);
      }
      card.append(fields); body.append(card); element.append(body);
      quoteControl = createSelectionQuote({ container: card, onQuote, onError });
    } else {
      const empty = el('div', 'brainstorm-empty'); empty.append(el('strong', '', '暂无内容'), el('p', '', '开始头脑风暴，内容会自动同步到这里'), button('头脑风暴', () => act(onStart), null)); element.append(empty);
    }
    const footer = el('footer', 'brainstorm-footer'); footer.dataset.populated = String(!!sections.length); element.append(footer);
    renderGeneration(footer, !!sections.length);
    store.list().then(files => {
      if (disposed || token !== renderEpoch) return;
      outputs = files.filter(item => item.content_type === 'html' && item.source_artifact_path === file.artifact_path);
      renderGeneration(footer, !!sections.length);
    }).catch(error => onError?.(error.message));
  }
  function renderGeneration(footer, hasContent) {
    generationTooltip?.destroy(); generationTooltip = null;
    footer.replaceChildren();
    const job = generation.get(file.artifact_path), output = job?.status === 'ready' ? job.output : outputs[0];
    if (job?.status === 'generating') {
      const busy = el('div', 'brainstorm-generating'); busy.setAttribute('role', 'status'); busy.innerHTML = icons.page;
      const text = el('div'); text.append(el('span', '', '正在生成互动作品…'), el('small', '', '你可以继续处理画布')); busy.append(text, el('i', 'brainstorm-generation-progress')); footer.append(busy); return;
    }
    if (output && (job?.status !== 'failed' || Date.parse(output.updated_at) > job.startedAt)) {
      const card = el('div', 'brainstorm-ready');
      const open = button('打开互动作品', () => act(async () => {
        if (await onOpenHtml(output.artifact_path) === false) return;
        readRevisions[output.artifact_path] = output.revision;
        try { localStorage.setItem(readKey, JSON.stringify(readRevisions)); } catch { onError?.('互动作品阅读状态未能保存'); }
        if (footer.isConnected) renderGeneration(footer, hasContent);
      }), 'page');
      if ((readRevisions[output.artifact_path] || 0) < output.revision) open.append(dot());
      const labels = el('span'); labels.append(el('span', '', output.title || '互动作品'), el('small', '', '打开互动作品')); open.append(labels);
      const regenerate = button('重新生成', () => generation.generate(file), 'refresh', 'brainstorm-regenerate'); regenerate.disabled = !hasContent;
      generationTooltip = bindTooltip(regenerate, { text: () => '重新生成' });
      card.append(open, regenerate); footer.append(card); return;
    }
    const generate = button(job?.status === 'failed' ? '重试生成' : '生成互动作品', () => generation.generate(file), null, 'brainstorm-generate'); generate.textContent = '';
    const symbol = el('span', 'brainstorm-generate-symbol'); symbol.innerHTML = icons.sparkles;
    const text = el('span'); text.append(el('span', '', job?.status === 'failed' ? '重试生成' : '生成互动作品'), el('small', '', '将头脑风暴转化为互动作品'));
    generate.append(symbol, text); generate.disabled = !hasContent; footer.append(generate);
    if (job?.error) { const error = el('p', 'brainstorm-generation-error', job.error); error.role = 'status'; footer.append(error); }
  }
  const unsubscribe = generation.subscribe(path => { if (path === file.artifact_path && !disposed) { const footer = element.querySelector('.brainstorm-footer'); if (footer) renderGeneration(footer, parsed.sections.some(section => !section.isEmpty)); } });
  render();
  return {
    element,
    update(nextFile) {
      if (nextFile.revision === file.revision) { render(); return; }
      const next = parseBrainstorm(nextFile.content), change = changesBetween(parsed, next);
      for (const title of change.sections) unreadSections.add(title);
      for (const key of change.cards) unreadCards.add(key);
      file = nextFile; parsed = next; render();
    },
    suspend() { disposeControls(); },
    destroy() { disposed = true; renderEpoch++; unsubscribe(); disposeControls(); element.remove(); },
  };
}
