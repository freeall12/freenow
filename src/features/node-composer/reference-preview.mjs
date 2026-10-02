import {audioPreview} from './audio-preview.mjs';
// Official nwe/Fq: immediate enter, 150ms leave, 100px media above a 6px gap.
export function referencePreviews(track, items, {selector='.reference-chip',resolve,enterDelay=0} = {}) {
  const previews = new Map();
  let active = null, timer, enterTimer, pending = null, disposed = false, enterRevision = 0;
  function hide() {
    clearTimeout(timer); clearTimeout(enterTimer); enterRevision++; pending=null;
    if (active) {
      const entry = previews.get(active); entry.preview.hidden = true; entry.pause?.();
      if(entry.ephemeral){entry.destroy?.();entry.preview.remove();previews.delete(active);}
      active.removeAttribute('aria-describedby'); active = null;
    }
  }
  function position() {
    if (!active) return;
    const rect = active.getBoundingClientRect(), preview = previews.get(active).preview;
    const width = preview.offsetWidth, height = preview.offsetHeight;
    preview.style.left = Math.max(0, Math.min(innerWidth - width, rect.left + rect.width / 2 - width / 2)) + 'px';
    preview.style.top = (rect.top >= height + 6 ? rect.top - height - 6 : rect.bottom + 6) + 'px';
  }
  function enter(chip) {
    if (disposed || !track.isConnected || !track.contains(chip) || track.dataset.sorting === 'true') return;
    const item = resolve ? resolve(chip) : items[Number(chip.dataset.referenceIndex)];
    if (!item || item.empty) return;
    clearTimeout(timer); if (active !== chip) hide();
    let entry = previews.get(chip);
    if (!entry) {
      const preview = document.createElement('div'); preview.className = 'composer-reference-preview';
      preview.id = 'reference-preview-' + crypto.randomUUID(); preview.setAttribute('role', 'tooltip');
      entry = {preview, ephemeral: item.type === 'audio' || item.type === 'text'};
      if (item.type === 'text') {
        const content = document.createElement('div'); content.className = 'composer-reference-text';
        const text = document.createElement('div'); text.textContent = item.text; content.append(text); preview.append(content);
      } else if (item.type === 'audio') {
        const player = audioPreview(item.url); preview.append(player.element);
        entry.play = player.show; entry.pause = player.hide; entry.destroy = player.destroy;
      } else {
        const media = document.createElement(item.type === 'video' ? 'video' : 'img');
        media.alt = item.title;
        if (item.type === 'video') {
          media.muted = true; media.loop = true; media.playsInline = true; media.className = 'composer-reference-video';
          entry.play = () => media.play().catch(()=>{}); entry.pause = () => media.pause();
          entry.destroy = () => {media.pause(); media.removeAttribute('src'); media.load();};
        } else media.onload = position;
        window.LocalAssets.url(item.type === 'image' ? item.thumbnail || item.url : item.url).then(url=>{if(disposed||!preview.isConnected)return;media.src=url;if(active===chip)entry.play?.();}).catch(()=>{if(!disposed)preview.dataset.error='media_unavailable';});
        preview.append(media);
      }
      const caption = document.createElement('div'); caption.className = 'composer-reference-caption';
      const name = document.createElement('span'); name.textContent = '@' + item.title; caption.append(name);
      preview.append(caption); preview.onpointerenter = () => clearTimeout(timer); preview.onpointerleave = leave; preview.onkeydown = key;
      previews.set(chip, entry); document.body.append(preview);
    }
    active = chip; entry.preview.hidden = false; chip.setAttribute('aria-describedby', entry.preview.id); position(); entry.play?.();
  }
  function leave() {clearTimeout(enterTimer);enterRevision++;pending=null;clearTimeout(timer); timer = setTimeout(hide, 150);}
  function over(event) {if(disposed)return;const chip = event.target.closest(selector); if (!chip || !track.contains(chip))return;clearTimeout(timer);if(chip===active||chip===pending)return;clearTimeout(enterTimer);if(enterDelay){pending=chip;const revision=++enterRevision;enterTimer=setTimeout(()=>{if(disposed||revision!==enterRevision)return;pending=null;enter(chip);},enterDelay);}else enter(chip);}
  function out(event) {if ((pending&&!pending.contains(event.relatedTarget))||(active&&!active.contains(event.relatedTarget))) leave();}
  function key(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || !active && !pending) return;
    const chip = active, restore = active && previews.get(active)?.preview.contains(document.activeElement);
    event.preventDefault(); event.stopImmediatePropagation(); hide();
    if (restore) (chip.closest('[contenteditable="true"],[contenteditable="plaintext-only"]') || chip).focus({preventScroll:true});
    return true;
  }
  const contains = target => track.contains(target) || [...previews.values()].some(entry => !entry.preview.hidden && entry.preview.contains(target));
  const outside = event => {if (!contains(event.target)) hide();};
  track.addEventListener('pointerover', over); track.addEventListener('pointerout', out);
  track.addEventListener('scroll', hide); track.addEventListener('pointerdown', hide); track.addEventListener('keydown', key, true);
  document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside);
  document.addEventListener('canvas:render', hide); window.addEventListener('pagehide', hide); window.addEventListener('resize', hide);
  return {hide, contains, dismissEscape:key, destroy() {
    disposed = true; hide(); for (const entry of previews.values()) {entry.destroy?.(); entry.preview.remove();} previews.clear();
    track.removeEventListener('pointerover', over); track.removeEventListener('pointerout', out);
    track.removeEventListener('scroll', hide); track.removeEventListener('pointerdown', hide); track.removeEventListener('keydown', key, true);
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside);
    document.removeEventListener('canvas:render', hide); window.removeEventListener('pagehide', hide); window.removeEventListener('resize', hide);
  }};
}
