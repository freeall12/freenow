(() => {
  'use strict';
  const core = window.CanvasText, app = () => window.CanvasApp;
  const el = (tag, cls = '', text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (label, icon, action) => { const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = window.UI_ICONS[icon] || ''; b.onclick = action; return b; };
  let session = null, colorPopup = null;
  const scrollPositions = new Map();
  function content(n, target) {
    target.classList.add('canvas-text-markdown');
    target.innerHTML = window.TextEditor.html(n.content || '');
    if (!n.content?.trim()) { const hint = el('p', 'text-empty', '双击编辑文本'); target.append(hint); }
  }
  function renderNode(n, element) {
    const body = element.querySelector('.node-body'); body.classList.add('text-node-body'); body.style.backgroundColor = n.color || '';
    const text = el('div', 'text-node-content'); content(n, text); body.replaceChildren(text);
    if (core.mode(n) === 'pure') element.querySelector('.port.left')?.remove();
    text.onwheel = e => { if (element.classList.contains('selected') && !e.ctrlKey && !e.metaKey) e.stopPropagation(); };
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) { const b = el('span', 'text-resize text-resize-' + handle); b.dataset.textResize = handle; element.append(b); }
  }
  async function copy(n) {
    try { await navigator.clipboard.writeText(n.content || ''); app().notify('已复制全部文本'); }
    catch { app().notify('无法访问剪贴板，请在全屏编辑中选择文本复制'); }
  }
  function palette(n, anchor) {
    colorPopup?.remove(); const pop = el('div', 'text-color-popover'); colorPopup = pop; pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', '文本背景色');
    const reset = button('重置颜色', 'colorReset', () => choose('')); reset.className = 'text-color-reset'; pop.append(reset);
    for (const [name, swatch, value] of core.colors) { const b = button(name, '', () => choose(value)); b.style.backgroundColor = swatch; b.setAttribute('aria-pressed', String(n.color?.toLowerCase() === value.toLowerCase())); pop.append(b); }
    function choose(color) { app().updateNode(n.id, { color }); pop.remove(); colorPopup = null; }
    document.body.append(pop); const r = anchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px'; pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 22) + 'px';
  }
  function toolbar(picked, bar, { view, canvas }) {
    if (picked.length !== 1 || picked[0].type !== 'text') { if (bar.classList.contains('text-node-toolbar')) bar.classList.remove('text-node-toolbar'); return false; }
    const n = picked[0], key = 'text:' + n.id + ':' + (n.color || ''); if (bar.hidden) bar.hidden = false;
    // Reapplying an identical class still invalidates style before the bounds read.
    for (const name of ['group-toolbar', 'multiselect-toolbar']) if (bar.classList.contains(name)) bar.classList.remove(name);
    if (!bar.classList.contains('text-node-toolbar')) bar.classList.add('text-node-toolbar');
    if (bar.dataset.key !== key) {
      bar.dataset.key = key; bar.replaceChildren();
      const color = button('背景色', '', e => palette(n, e.currentTarget)), swatch = el('span', 'text-color-trigger'); swatch.style.backgroundColor = n.color || '#e6e6e6'; color.append(swatch);
      const save = button('保存到素材库', 'folder', () => document.dispatchEvent(new CustomEvent('canvas:save-assets', { detail: [structuredClone(n)] })));
      bar.append(color, el('span', 'text-toolbar-divider'), button('复制全文', 'copy', () => copy(n)), save, button('全屏编辑', 'expand', () => open(n)));
    }
    const bounds = canvas.getBoundingClientRect(), center = bounds.left + (n.x + n.width / 2) * view.scale + view.x;
    const width = window.CanvasMenus?.measureToolbar?.().width ?? bar.offsetWidth;
    bar.style.left = Math.max(bounds.left + 8, Math.min(bounds.right - width - 8, center - width / 2)) + 'px';
    bar.style.top = Math.max(65, bounds.top + n.y * view.scale + view.y - 61) + 'px';
    return true;
  }
  function anchor(n) {
    const node = [...document.querySelectorAll('[data-pile-gallery-item]')].find(e => e.dataset.pileGalleryItem === n.id) || [...document.querySelectorAll('.node')].find(e => e.dataset.id === n.id && !e.hidden);
    const body = node?.querySelector('.node-body') || node, rect = body?.getBoundingClientRect();
    return rect?.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderRadius: 16 * (node?.classList.contains('node') ? app().getState().view.scale : 1) } : null;
  }
  function animate(s, opening) {
    s.animations?.forEach(a => a.cancel()); s.animations = []; const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rect = opening ? s.anchor : anchor(s.node), full = { left: '0px', top: '0px', width: innerWidth + 'px', height: innerHeight + 'px', borderRadius: '0px' };
    const small = rect ? Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, v + 'px'])) : full;
    const motion = (target, frames, options) => { const a = target.animate(frames, { fill: 'both', ...options, ...(reduced ? { duration: 0, delay: 0 } : {}) }); s.animations.push(a); return a; };
    s.dialog.dataset.phase = opening ? 'opening' : 'closing';
    const spatial = motion(s.surface, opening ? [small, full] : [full, small], { duration: rect ? 440 : 140, easing: 'cubic-bezier(.45,0,.55,1)' });
    motion(s.black, [{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: 440, easing: opening ? 'cubic-bezier(.25,.2,.75,.8)' : 'cubic-bezier(.25,0,.75,.2)' });
    motion(s.scroller, [{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: 120, delay: opening ? 320 : 0, easing: 'ease-out' });
    motion(s.actions, [{ opacity: opening ? 0 : 1, translate: '0px ' + (opening ? 18 : 0) + 'px' }, { opacity: opening ? 1 : 0, translate: '0px ' + (opening ? 0 : 18) + 'px' }], { duration: opening ? 280 : 160, delay: opening ? 440 : 0, easing: 'cubic-bezier(.22,1,.36,1)' });
    return spatial.finished.catch(() => {}).then(() => { if (session === s) s.dialog.dataset.phase = opening ? 'open' : 'closed'; });
  }
  function hasPendingEdits(id) {
    return !!session && session.node.id === id && !session.readonly && (session.dirty || session.conflict);
  }
  function flush(s = session) {
    if (!s || !s.dirty || s.readonly || s.conflict) return;
    clearTimeout(s.timer); const n = app().getState().nodes.find(n => n.id === s.node.id);
    if (!n || (n.content || '') !== s.saved) { s.conflict = true; s.notice.hidden = false; return; }
    s.saved = s.draft; s.dirty = false; app().updateNode(n.id, { content: s.saved });
  }
  function destroy(s) {
    clearTimeout(s.timer); s.animations?.forEach(a => a.cancel()); s.editor?.destroy(); s.dialog.remove();
    if (session === s) session = null; document.body.classList.remove('text-viewer-active');
    if (s.focus?.isConnected) s.focus.focus({ preventScroll: true }); else document.querySelector('#canvas').focus({ preventScroll: true });
  }
  async function close({ immediate = false } = {}) {
    const s = session; if (!s || s.closing) return; s.closing = true; flush(s);
    scrollPositions.set(s.node.id, { content: s.saved, top: s.scroller.scrollTop });
    if (!immediate) await animate(s, false); destroy(s);
  }
  function open(n, { readonly = false } = {}) {
    if (session) { flush(session); destroy(session); }
    colorPopup?.remove(); const dialog = el('dialog', 'text-viewer'), surface = el('div', 'text-viewer-surface'), black = el('div', 'text-viewer-black'), scroller = el('main', 'text-viewer-scroll'), host = el('div', 'text-editor-host'), actions = el('div', 'text-viewer-actions');
    dialog.setAttribute('aria-label', '文本全屏编辑'); surface.style.backgroundColor = n.color || '#202020'; dialog.append(surface); surface.append(black, scroller); scroller.append(host); dialog.append(actions);
    const s = session = { node: n, readonly, dialog, surface, black, scroller, actions, anchor: anchor(n), saved: n.content || '', draft: n.content || '', dirty: false, focus: document.activeElement };
    const notice = el('div', 'text-edit-conflict', '正文已被其他操作更新，未覆盖新内容。可复制当前编辑内容。'); notice.hidden = true; s.notice = notice; dialog.append(notice);
    const exit = button('关闭文本编辑', 'close', () => close()); exit.className = 'text-viewer-close'; dialog.append(exit);
    actions.append(button('复制全文', 'copy', () => copy({ content: s.draft })));
    const commands = [['h1', '一级标题', 'h1'], ['h2', '二级标题', 'h2'], ['h3', '三级标题', 'h3'], ['paragraph', '段落', 'paragraph'], ['bold', '粗体', 'bold'], ['italic', '斜体', 'italic'], ['list', '无序列表', 'bulletList'], ['ordered-list', '有序列表', 'orderedList'], ['divider', '分隔线', 'divider']];
    const controls = new Map();
    if (!readonly) for (const [command, label, icon] of commands) {
      if (['h1', 'bold', 'list', 'divider'].includes(command)) actions.append(el('span', 'text-toolbar-divider'));
      const b = button(label, icon, () => act(command)); b.onmousedown = e => e.preventDefault(); b.dataset.textCommand = command; actions.append(b); controls.set(command, b);
    }
    function updateSelection(editor) {
      for (const [name, b] of controls) b.setAttribute('aria-pressed', String(name[0] === 'h' ? editor.isActive('heading', { level: +name[1] }) : editor.isActive({ list: 'bulletList', 'ordered-list': 'orderedList' }[name] || name)));
    }
    function act(name) {
      const chain = s.editor.chain().focus();
      if (/^h[123]$/.test(name)) chain.toggleHeading({ level: +name[1] }).run();
      else { const command = { paragraph: 'setParagraph', bold: 'toggleBold', italic: 'toggleItalic', list: 'toggleBulletList', 'ordered-list': 'toggleOrderedList', divider: 'setHorizontalRule' }[name]; chain[command]().run(); }
    }
    document.body.append(dialog); document.body.classList.add('text-viewer-active'); dialog.showModal();
    if (readonly) content(n, host);
    else s.editor = window.TextEditor.create({ element: host, content: s.saved, onSelectionUpdate: updateSelection, onUpdate: value => { s.draft = value; s.dirty = value !== s.saved; clearTimeout(s.timer); s.timer = setTimeout(() => flush(s), 300); } });
    dialog.oncancel = e => { e.preventDefault(); close(); }; dialog.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); });
    const scroll = scrollPositions.get(n.id); if (scroll?.content === s.saved) scroller.scrollTop = scroll.top;
    animate(s, true).then(() => { if (session === s && !s.closing) s.editor?.commands.focus(); });
  }
  document.addEventListener('canvas:render', event => {
    if (event?.detail?.viewportOnly) return;
    const s = session; if (!s || s.closing || s.readonly) return; const n = app().getState().nodes.find(n => n.id === s.node.id);
    if (!n) { if (s.dirty) { s.conflict = true; s.notice.hidden = false; } else close({ immediate: true }); return; }
    if ((n.content || '') !== s.saved) {
      if (s.dirty) { s.conflict = true; s.notice.hidden = false; }
      else { s.saved = s.draft = n.content || ''; window.TextEditor.setContent(s.editor, s.saved); }
    }
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.text-color-popover,.text-node-toolbar')) { colorPopup?.remove(); colorPopup = null; } });
  window.addEventListener('pagehide', () => flush());
  window.CanvasTextUI = { renderNode, content, toolbar, open, close, flush, hasPendingEdits, copy, get editor() { return session?.editor; } };
})();
