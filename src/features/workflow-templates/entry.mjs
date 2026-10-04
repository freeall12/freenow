import {validateCatalog, applyPublicTemplate, officialCategories} from './core.mjs';
export {officialCategories};

let catalogPromise;
const formatCreatedAt = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).format(date);
};
const element = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (document, label, action, className = '') => {
  const node = element(document, 'button', className, label);
  node.type = 'button'; node.onclick = action;
  return node;
};

export function installStyles(document = globalThis.document) {
  if (document.querySelector('#workflow-template-styles')) return;
  const style = document.createElement('link');
  style.id = 'workflow-template-styles'; style.rel = 'stylesheet';
  style.href = new URL('./styles.css', import.meta.url).href;
  document.head.append(style);
}

export async function readCatalog({fetchCatalog = globalThis.fetch, fresh = false} = {}) {
  if (fresh) catalogPromise = null;
  if (!catalogPromise) catalogPromise = (async () => {
    const response = await fetchCatalog(new URL('./resources/templates.json', import.meta.url), {credentials: 'same-origin', mode: 'same-origin', redirect: 'error'});
    if (!response.ok) throw Error('公共模板读取失败，请重试');
    return validateCatalog(await response.json());
  })().catch(error => { catalogPromise = null; throw error; });
  return structuredClone(await catalogPromise);
}

export async function apply(item, {app = window.CanvasApp, templatesCore = window.TemplatesCore, templateAPI = window.TemplateAPI, projectId = window.CanvasProjects?.id?.(), currentProjectId = () => window.CanvasProjects?.id?.(), bounds = () => document.querySelector('#canvas').getBoundingClientRect()} = {}) {
  const group = applyPublicTemplate(item, {app, templatesCore, projectId, currentProjectId, bounds});
  try { await templateAPI?.recordRecent?.(item.id, 'public'); }
  catch (error) { app.notify('模板已应用，但最近使用记录未保存：' + error.message); }
  return group;
}

export function createCard(item, {document = globalThis.document, onApply, onPreview, gallery = false, mediaSource} = {}) {
  const card = element(document, 'div', 'template-card workflow-template-card');
  card.dataset.templateId = item.id;
  const media = element(document, 'div', 'workflow-template-card-media');
  const image = element(document, item.video ? 'video' : 'img');
  if (item.video) { image.muted = true; image.loop = true; image.playsInline = true; image.preload = 'metadata'; }
  else { image.alt = item.name; image.loading = 'lazy'; image.decoding = 'async'; }
  if (item.video && item.thumbnail) image.poster = item.thumbnail;
  const coverSource = item.video || item.thumbnail || item.image;
  if (mediaSource) mediaSource(image, coverSource);
  else image.src = coverSource || '';
  const overlay = element(document, 'div', 'workflow-template-card-actions');
  const preview = button(document, '查看', event => { event.stopPropagation(); onPreview?.(item, event.currentTarget); });
  const use = button(document, '应用', event => { event.stopPropagation(); onApply?.(item); });
  preview.setAttribute('aria-label', '查看 ' + item.name); use.setAttribute('aria-label', '应用 ' + item.name);
  overlay.append(preview, use); media.append(image, overlay);
  const title = button(document, item.name, event => gallery ? onPreview?.(item, event.currentTarget) : onApply?.(item), 'workflow-template-card-title');
  title.title = item.name;
  const cover = button(document, '', event => gallery ? onPreview?.(item, event.currentTarget) : onApply?.(item), 'workflow-template-card-cover');
  cover.setAttribute('aria-label', (gallery ? '查看 ' : '应用 ') + item.name);
  media.prepend(cover); card.append(media, title);
  card.onmouseenter = () => { if (item.video) image.play?.().catch?.(() => {}); };
  card.onmouseleave = () => { if (item.video) image.pause?.(); };
  return card;
}

export function openGallery({items, selected = null, initialScope = 'all', app = window.CanvasApp, templateAPI = window.TemplateAPI, document = globalThis.document, mediaSource, onApplied, onClose, returnFocus = document.activeElement} = {}) {
  installStyles(document);
  const projectId = window.CanvasProjects?.id?.();
  const returnTemplateId = returnFocus?.closest?.('.template-card')?.dataset.templateId;
  const dialog = element(document, 'dialog', 'workflow-template-gallery');
  dialog.setAttribute('aria-label', '工作流模板库');
  const layout = element(document, 'div', 'workflow-template-gallery-layout');
  const navigation = element(document, 'nav', 'workflow-template-gallery-navigation'); navigation.setAttribute('aria-label', '模板分类');
  const workspace = element(document, 'section', 'workflow-template-gallery-workspace');
  const heading = element(document, 'header', 'workflow-template-gallery-heading');
  const headingText = element(document, 'h2', '', '全部');
  const closeButton = button(document, '×', () => { if (!busy) dialog.close(); }, 'workflow-template-gallery-close'); closeButton.setAttribute('aria-label', '关闭模板预览');
  heading.append(headingText, closeButton);
  const content = element(document, 'div', 'workflow-template-gallery-content');
  workspace.append(heading, content); layout.append(navigation, workspace); dialog.append(layout);
  let scope = initialScope, search = '', searchDraft = '', current = selected, busy = false, destroyed = false;
  const controls = new Map();
  const currentProject = () => window.CanvasProjects?.id?.();
  const guard = window.CanvasProjects?.registerNavigationGuard?.(() => busy ? '模板正在应用，请稍后切换项目' : null);
  const available = () => scope === 'mine' ? templateAPI?.list?.() || [] : scope === 'recent' ? (templateAPI?.listRecent?.() || []).map(row => (row.kind === 'public' ? items : templateAPI?.list?.() || []).find(item => item.id === row.id)).filter(Boolean) : scope === 'all' ? items : items.filter(item => item.categoryIds?.includes(scope));
  const cleanMedia = () => content.querySelectorAll('video').forEach(video => video.pause?.());
  const applyItem = async item => {
    if (busy || destroyed) return;
    if (projectId !== currentProject()) { app.notify('画布已切换，请在当前项目重新应用模板'); return; }
    busy = true; dialog.setAttribute('aria-busy', 'true');
    content.querySelectorAll('button').forEach(node => node.disabled = true);
    try {
      if (items.includes(item)) await apply(item, {app, templateAPI, projectId, currentProjectId: currentProject});
      else {
        await templateAPI.ready;
        if (destroyed || projectId !== currentProject()) throw Error('模板应用已取消：画布或来源已切换');
        await templateAPI.use(item.id, {canApply: () => !destroyed && projectId === currentProject()});
      }
      onApplied?.(item); dialog.close();
    } catch (error) { app.notify(error.message); }
    finally { busy = false; dialog.setAttribute('aria-busy', 'false'); if (!destroyed) render(); }
  };
  for (const [key, label] of [['recent', '最近使用'], ['mine', '我的模板'], ['all', '全部'], ...officialCategories.map(category => [category.id, category.name])]) {
    const control = button(document, label, () => { if (busy) return; scope = key; search = searchDraft = ''; current = null; render(); });
    controls.set(key, control); navigation.append(control);
    if (key === 'mine') navigation.append(element(document, 'hr'));
  }
  function media(item, className) {
    const node = element(document, item.video ? 'video' : 'img', className);
    const source = item.video || (className === 'workflow-template-detail-media' ? item.image : item.thumbnail || item.image);
    if (mediaSource) mediaSource(node, source); else node.src = source || '';
    if (item.video) { node.muted = true; node.loop = true; node.controls = className === 'workflow-template-detail-media'; node.playsInline = true; node.autoplay = node.controls; node.preload = 'metadata'; }
    else { node.alt = item.name; node.loading = className === 'workflow-template-detail-media' ? 'eager' : 'lazy'; node.decoding = 'async'; }
    return node;
  }
  function render() {
    if (destroyed) return;
    cleanMedia(); content.replaceChildren();
    controls.forEach((node, key) => { node.classList.toggle('chosen', key === scope); node.setAttribute('aria-pressed', String(key === scope)); });
    headingText.textContent = scope === 'mine' ? '我的模板' : scope === 'recent' ? '最近使用' : officialCategories.find(category => category.id === scope)?.name || '全部';
    const tools = element(document, 'div', 'workflow-template-gallery-tools');
    const input = element(document, 'input'); input.type = 'search'; input.value = searchDraft; input.placeholder = '搜索模板'; input.setAttribute('aria-label', '搜索全部模板');
    const searchAction = () => { search = input.value.trim().toLowerCase(); searchDraft = input.value; current = null; render(); };
    input.oninput = () => searchDraft = input.value;
    input.onblur = event => {
      if (input.value.trim().toLowerCase() === search) return;
      // DOM replacement on blur would remove the button before its click.
      // Button actions retain their target; Search/Enter commit explicitly.
      if (event.relatedTarget?.closest?.('button') && content.contains(event.relatedTarget)) return;
      searchAction();
    };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); searchAction(); } };
    tools.append(input, button(document, '搜索', searchAction), button(document, '创建', () => {
      const state = app.getState(), group = state.nodes.find(node => node.type === 'group' && state.selected.includes(node.id));
      if (!group) { app.notify('请先在画布选中一个分组，再创建模板'); return; }
      dialog.close(); templateAPI.open(group.id, returnFocus);
    }));
    content.append(tools);
    if (current) {
      const detail = element(document, 'section', 'workflow-template-detail'); detail.setAttribute('aria-label', current.name);
      const back = button(document, '‹', () => { current = null; render(); }, 'workflow-template-detail-back'); back.setAttribute('aria-label', '返回模板列表');
      const row = element(document, 'div', 'workflow-template-detail-row');
      const copy = element(document, 'div', 'workflow-template-detail-copy'); copy.append(element(document, 'h3', '', current.name));
      if (current.createdAt) {
        const time = element(document, 'time', '', formatCreatedAt(current.createdAt));
        const date = new Date(current.createdAt); if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
        copy.append(time);
      }
      const tags = element(document, 'div', 'workflow-template-detail-tags'); for (const tag of current.tags || []) tags.append(element(document, 'span', '', tag === 'workflow' ? '工作流' : tag)); copy.append(tags);
      copy.append(element(document, 'p', 'workflow-template-detail-description', current.description || ''), button(document, busy ? '正在应用…' : '应用', () => applyItem(current), 'workflow-template-detail-apply'));
      row.append(media(current, 'workflow-template-detail-media'), copy);
      const filmstrip = element(document, 'div', 'workflow-template-filmstrip');
      for (const item of available()) { const thumb = button(document, '', () => { current = item; render(); }); thumb.setAttribute('aria-label', '查看 ' + item.name); thumb.classList.toggle('chosen', item.id === current.id); thumb.append(media(item, '')); filmstrip.append(thumb); }
      detail.append(back, row, filmstrip); content.append(detail);
    } else {
      const filtered = available().filter(item => item.name.toLowerCase().includes(search));
      const grid = element(document, 'div', 'workflow-template-gallery-grid');
      for (const item of filtered) grid.append(createCard(item, {document, gallery: true, mediaSource, onApply: applyItem, onPreview: item => { current = item; render(); }}));
      content.append(grid); if (!filtered.length) content.append(element(document, 'p', 'panel-empty', search ? '没有匹配的模板' : '暂无模板'));
    }
  }
  const changed = () => { if (!busy && !destroyed) render(); };
  document.addEventListener('templates:changed', changed);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  const destroy = () => {
    if (destroyed) return; destroyed = true; cleanMedia(); guard?.(); document.removeEventListener('templates:changed', changed); dialog.remove(); onClose?.();
    const currentCard = returnTemplateId && Array.from(document.querySelectorAll('.templates-panel .template-card')).find(card => card.dataset.templateId === returnTemplateId);
    const focus = returnFocus?.isConnected ? returnFocus : currentCard?.querySelector('.workflow-template-card-actions button') || currentCard || document.querySelector('.template-tabs .chosen') || document.querySelector('.side-tools button[aria-label="模板"]');
    focus?.focus({preventScroll: true});
  };
  dialog.addEventListener('close', destroy);
  dialog.addEventListener('pointerdown', event => { if (event.target === dialog && !busy) dialog.close(); });
  render(); document.body.append(dialog); dialog.showModal();
  templateAPI?.ready?.then(() => { if (!destroyed && scope !== 'all') render(); }).catch(error => app.notify(error.message));
  templateAPI?.recentReady?.then(() => { if (!destroyed && scope === 'recent') render(); }).catch(error => { if (!destroyed) app.notify('最近使用读取失败：' + error.message); });
  return {element: dialog, close: () => { if (!busy) dialog.close(); }, destroy};
}
