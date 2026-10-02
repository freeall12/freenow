import {icons} from './icons.mjs';
export const el = (tag, cls = '', text) => {const e = document.createElement(tag);e.className = cls;if(text !== undefined)e.textContent = text;return e;};
export const button = (label, action, cls = '', icon) => {const b = el('button',cls);b.type = 'button';b.ariaLabel = label;b.onclick = action;if(icon)b.innerHTML = icons[icon];else b.textContent = label;return b;};
export function preview(asset) {
  if (asset?.image || asset?.type === 'image' || asset?.type === 'video') {
    const media = el(asset.type === 'video' && !asset.image ? 'video' : 'img');media.alt = '';media.draggable = false;
    if (media.tagName === 'VIDEO') {media.muted = true;media.preload = 'metadata';}
    const source = asset.image || asset.url;
    if(source)Promise.resolve(window.LocalAssets?.url(source) || source).then(url => {media.src = url;}).catch(() => media.setAttribute('aria-label','素材已丢失'));
    return media;
  }
  const thumb = el('span','subject-fallback');
  if(asset?.type === 'text')thumb.textContent = asset.text?.slice(0,100) || '';
  else thumb.innerHTML = asset?.type === 'audio' ? window.UI_ICONS?.audio || icons.subject : icons.subject;
  return thumb;
}
export function loadStyles() {
  if(document.querySelector('[data-subject-styles]'))return;
  const css = el('link');css.rel='stylesheet';css.href=new URL('./styles.css',import.meta.url);css.dataset.subjectStyles='';document.head.append(css);
}
