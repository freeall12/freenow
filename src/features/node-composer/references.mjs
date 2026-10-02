import {icons, musicIcon} from './icons.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {referenceNames} from './reference-model.mjs';
import {referencePreviews} from './reference-preview.mjs';
import {referenceSort} from './reference-sort.mjs';
const el = (tag, cls) => {const e = document.createElement(tag); e.className = cls; return e;};
export function renderReferences({focus, items, onAdd, onRemove, onReorder, onPick, disabled, picking, imageNode}) {
  focus.disabled = disabled || picking;
  const row = el('div', 'reference-strip'), divider = el('span', 'focus-reference-divider');
  const wrap = el('div', 'composer-reference-window'), track = el('div', 'composer-reference-track');
  wrap.append(track); row.append(focus, divider);
  const counts = {};
  items.forEach((item, index) => {
    const chip = el('div', 'reference-chip');
    const label = referenceNames[item.type] + ' ' + (counts[item.type] = (counts[item.type] || 0) + 1);
    chip.dataset.referenceTitle = item.title; chip.dataset.referenceType = item.type; chip.dataset.referenceLabel = label; chip.dataset.empty = String(item.empty);
    chip.dataset.referenceIndex = String(index);
    let media;
    if (item.empty || ['text','audio'].includes(item.type)) {media = el('span', 'reference-type-icon'); media.innerHTML = item.type === 'audio' ? musicIcon : referenceIcons[item.type+'Type']; media.setAttribute('aria-label',label); if(item.empty)chip.classList.add('empty-reference');}
    else {media = el(item.type === 'video' && !item.thumbnail ? 'video' : 'img', ''); media.draggable = false; media.alt = label; if(media.tagName === 'VIDEO'){media.muted=true;media.preload='metadata';} const src=item.thumbnail || item.url; (window.LocalAssets?.url(src) || Promise.resolve(src)).then(url=>{media.src=url;}).catch(()=>chip.classList.add('empty-reference'));}
    const remove = el('button', 'remove-reference'); remove.type = 'button'; remove.ariaLabel = `移除${label}`; remove.innerHTML = icons.close; remove.disabled = disabled;
    remove.onclick = event => {event.stopPropagation(); onRemove(index);};
    chip.onclick=event=>{if(!event.defaultPrevented&&!item.empty)onPick?.(item);};
    chip.append(media, remove); track.append(chip);
  });
  function scrollButton(direction) {
    const button = el('button', 'composer-reference-scroll ' + direction); button.type = 'button'; button.ariaLabel = direction === 'left' ? '向左滚动参考素材' : '向右滚动参考素材';
    button.onclick = () => track.scrollBy({left: direction === 'left' ? -130 : 130, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    button.hidden = true; wrap.append(button); return button;
  }
  const left = scrollButton('left'), right = scrollButton('right');
  if (items.length) row.append(wrap);
  const add = el('button', 'reference-add'); add.type = 'button'; add.ariaLabel = '添加参考素材'; add.innerHTML = icons.plus; add.disabled = disabled; add.setAttribute('aria-pressed', String(!!picking)); add.dataset.tooltip = '从画布选择参考'; add.onclick = onAdd; row.append(add);
  const overflowDivider = el('span', 'focus-reference-divider'); overflowDivider.hidden = true; row.append(overflowDivider);
  if (imageNode && counts.image) {const count = el('span', 'reference-count'); count.textContent = `参考图 ${counts.image} 张`; row.append(count);}
  const update = () => {left.hidden = track.scrollLeft <= 1; right.hidden = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1; overflowDivider.hidden = left.hidden && right.hidden;};
  const observer = new ResizeObserver(update); if (items.length) observer.observe(track);
  track.addEventListener('scroll', update, {passive: true});
  const previews = referencePreviews(track, items);
  const stopSort = referenceSort(track, onReorder, previews.hide);
  return {element: row, destroy() {stopSort(); previews.destroy(); observer.disconnect(); track.removeEventListener('scroll', update);}};
}
