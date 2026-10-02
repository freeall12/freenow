import { icons } from './icons.mjs';
import { bindTooltip } from '../agent-composer/tooltip.mjs';
export * from './model.mjs';

export function createQueueView({ renderComposer, getNode = () => null, resolveAsset = value => value, onEdit, onRemove, onReorder, onHeight }) {
  const element = document.createElement('section'); element.className = 'agent-queue'; element.ariaLabel = 'Queue';
  const surface = document.createElement('div'); surface.className = 'agent-queue-surface';
  const list = document.createElement('div'); list.className = 'agent-queue-list';
  const fade = document.createElement('div'); fade.className = 'agent-queue-fade'; fade.ariaHidden = 'true';
  const lip = document.createElement('div'); lip.className = 'agent-queue-lip'; lip.ariaHidden = 'true';
  surface.append(list, fade); element.append(surface, lip); element.hidden = true;
  let items = [], tips = [], signature = '', animation = null, exiting = false, drag = null;
  const updateFade = () => { fade.classList.toggle('visible', list.scrollTop + list.clientHeight < list.scrollHeight - 1); };
  list.addEventListener('scroll', updateFade, { passive: true });
  const observer = new ResizeObserver(() => { onHeight?.(element.hidden ? 0 : element.offsetHeight - 12); updateFade(); }); observer.observe(surface);
  const composerObserver = new ResizeObserver(() => onHeight?.(element.hidden ? 0 : element.offsetHeight - 12));
  const icon = name => { const span = document.createElement('span'); span.innerHTML = icons[name]; span.className = 'agent-queue-icon'; return span; };
  function button(name, label, callback, cls = '') {
    const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.ariaLabel = label; b.innerHTML = icons[name]; b.onclick = callback;
    tips.push(bindTooltip(b, { text: () => label })); return b;
  }
  function endDrag(cancel = false) {
    if (!drag) return;
    const value = drag; drag = null; value.row.style.transform = ''; value.row.classList.remove('dragging');
    if (!cancel && value.moved && value.over !== value.id) onReorder(value.id, value.over);
  }
  function move(event) {
    if (!drag) return;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true; drag.row.classList.add('dragging');
    const bounds = list.getBoundingClientRect(), rect = drag.rect;
    drag.row.style.transform = `translateY(${Math.max(bounds.top - rect.top, Math.min(bounds.bottom - rect.bottom, dy))}px)`;
    if (event.clientY < bounds.top + bounds.height * .25) list.scrollTop -= 8;
    else if (event.clientY > bounds.bottom - bounds.height * .25) list.scrollTop += 8;
    let closest = Infinity;
    for (const row of list.children) {
      const box = row === drag.row ? rect : row.getBoundingClientRect(), distance = Math.abs((box.top + box.bottom) / 2 - event.clientY);
      if (distance < closest) { closest = distance; drag.over = row.dataset.id; }
    }
  }
  list.addEventListener('pointermove', move); list.addEventListener('pointerup', () => endDrag()); list.addEventListener('pointercancel', () => endDrag(true));
  function enter() {
    element.hidden = false; animation?.cancel(); exiting = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Official InputTopSheet spring: stiffness 420, damping 34, mass .82.
    const damping = 34 / (2 * .82), frequency = Math.sqrt(420 / .82 - damping ** 2);
    const frames = Array.from({ length: 34 }, (_, index) => { const t = index / 60, left = Math.exp(-damping * t) * (Math.cos(frequency * t) + damping / frequency * Math.sin(frequency * t)); return { opacity: Math.min(1, 1 - left), transform: `translateY(${10 * left}px) scale(${1 - .02 * left})`, offset: index / 33 }; });
    animation = element.animate(frames, { duration: 550, easing: 'linear' });
  }
  function update(next) {
    items = next || [];
    if (!items.length) {
      if (!element.hidden && !exiting) {
        exiting = true; animation?.cancel();
        animation = element.animate([{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160, easing: 'cubic-bezier(.4,0,.2,1)' });
        animation.onfinish = () => { if (!items.length) { element.hidden = true; onHeight?.(0); } exiting = false; };
      }
      return;
    }
    if (element.hidden || exiting) enter();
    const nextSignature = JSON.stringify(items);
    if (signature === nextSignature) return;
    signature = nextSignature; endDrag(true); tips.forEach(t => t.destroy()); tips = [];
    const scrollTop = list.scrollTop; list.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'agent-queue-row'; row.dataset.id = item.id;
      if (items.length > 1) {
        const grip = button('grip-vertical', '拖动排序', null, 'agent-queue-grip');
        grip.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); tips.forEach(t => t.hide()); grip.setPointerCapture(event.pointerId); drag = { id: item.id, over: item.id, row, rect: row.getBoundingClientRect(), y: event.clientY, moved: false }; };
        grip.onkeydown = event => { if (event.key === 'Escape') endDrag(true); if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const index = items.findIndex(value => value.id === item.id), other = items[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (other) { onReorder(item.id, other.id); list.querySelector(`[data-id="${CSS.escape(item.id)}"] .agent-queue-grip`)?.focus(); } };
        row.append(grip);
      }
      row.append(icon('queued'));
      const reference = item.uploads?.[0] || getNode(item.refs?.[0]);
      if (reference) {
        const thumb = document.createElement('span'); thumb.className = 'agent-queue-thumb'; thumb.role = 'img'; thumb.ariaLabel = '包含引用';
        const source = reference.image || (reference.type === 'image' ? reference.asset : null);
        if (source) { const img = document.createElement('img'); img.alt = reference.name || reference.title || ''; thumb.append(img); Promise.resolve(resolveAsset(source)).then(url => { if (img.isConnected) img.src = url; }).catch(() => {}); }
        else thumb.innerHTML = icons.file;
        tips.push(bindTooltip(thumb, { text: () => '包含引用' })); row.append(thumb);
      }
      const text = document.createElement('div'); text.className = 'agent-queue-text'; text.title = item.text;
      if (item.composerDoc && renderComposer) text.append(renderComposer(item.composerDoc)); else text.textContent = item.text;
      text.querySelectorAll('button').forEach(button => { button.disabled = true; button.tabIndex = -1; });
      for (const file of item.uploads || []) { const attachment = document.createElement('span'); attachment.className = 'agent-queue-reference'; attachment.textContent = file.name; attachment.title = '包含引用'; text.append(attachment); }
      const state = document.createElement('span'); state.className = 'agent-queue-state'; state.textContent = '待处理';
      const actions = document.createElement('div'); actions.className = 'agent-queue-actions'; actions.append(button('trash', '取消排队', () => onRemove(item.id)), button('pen', '编辑', () => onEdit(item.id)));
      row.append(text, state, actions); list.append(row);
    }
    list.scrollTop = scrollTop;
    // The panel may still be detached while its children are rebuilt. Also,
    // adding a sixth row changes overflow without changing the capped height.
    queueMicrotask(() => { if (element.isConnected) { updateFade(); onHeight?.(element.offsetHeight - 12); } });
  }
  return { element, update, observeComposer(node) { composerObserver.disconnect(); composerObserver.observe(node); }, destroy() { animation?.cancel(); observer.disconnect(); composerObserver.disconnect(); tips.forEach(t => t.destroy()); endDrag(true); element.remove(); } };
}
