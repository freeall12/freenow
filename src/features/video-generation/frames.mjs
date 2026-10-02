import {icons} from '../node-composer/icons.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {previewTooltips} from '../world-node/preview-tooltips.mjs';

// Official zd = Lucide Plus (vendor-libs Dne); ime = vendor-packages JR.
const plus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const swap = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10.5 2.84998L13 5.34998H3M5.5 13.1L3 10.6L13 10.6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const el = (tag, cls, text) => {const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e;};
const css = el('link', ''); css.rel = 'stylesheet'; css.href = new URL('./frames.css', import.meta.url); document.head.append(css);

export function frameSlots(items, tailKey) {
  const images = items.filter(item => item.type === 'image');
  if (images.length === 1 && images[0].key === tailKey) return {first: null, last: images[0]};
  if (images.length >= 2 && images[0].key === tailKey) return {first: images[1], last: images[0]};
  return {first: images[0] || null, last: images[1] || null};
}

export function renderFrames({focus, items, tailKey, picking, disabled, onPick, onRemove, onSwap}) {
  const row = el('div', 'reference-strip video-frame-strip'), group = el('div', 'video-frame-group');
  focus.disabled = disabled || !!picking;
  row.append(focus, el('span', 'focus-reference-divider'), group);
  const slots = frameSlots(items, tailKey);
  for (const slot of ['first', 'last']) {
    if (slot === 'last') {
      const button = el('button', 'video-frame-swap'); button.type = 'button'; button.ariaLabel = '交换首尾帧'; button.dataset.tooltip = button.ariaLabel;
      button.innerHTML = swap; button.disabled = disabled || !slots.first || !slots.last || slots.first.empty || slots.last.empty;
      button.onclick = onSwap; group.append(button);
    }
    const label = slot === 'first' ? '首帧' : '尾帧', item = slots[slot];
    const chip = el(item ? 'div' : 'button', 'video-frame-slot'); chip.dataset.frame = slot; chip.dataset.tooltip = label;
    if (item) {
      chip.dataset.referenceKey = item.key;
      if (item.empty) {const placeholder = el('span', 'video-frame-empty'); placeholder.innerHTML = referenceIcons.imageType; placeholder.ariaLabel = label + '：参考节点没有内容'; chip.append(placeholder);}
      else {const img = el('img', ''); img.alt = label; img.draggable = false; (window.LocalAssets?.url(item.thumbnail || item.url) || Promise.resolve(item.thumbnail || item.url)).then(url => {img.src = url;}).catch(() => {chip.dataset.unavailable = 'true';}); chip.append(img);}
      const remove = el('button', 'video-frame-remove'); remove.type = 'button'; remove.ariaLabel = '移除' + label; remove.innerHTML = icons.close; remove.disabled = disabled;
      remove.onclick = event => {event.stopPropagation(); onRemove(item);}; chip.append(remove);
    } else {
      chip.type = 'button'; chip.ariaLabel = '选择' + label; chip.innerHTML = plus;
      chip.disabled = disabled || !!picking && picking !== slot; chip.setAttribute('aria-pressed', String(picking === slot)); chip.onclick = () => onPick(slot);
    }
    group.append(chip);
  }
  const cleanup = previewTooltips(row, {portal: document.body, className: 'image-panorama-tooltip'});
  return {element: row, destroy: cleanup};
}

export {pickFrame} from '../canvas-reference-picker/entry.mjs';
