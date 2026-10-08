import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';

// Official workspace dm / Gk palette, rather than a second actor color system.
const colors = Object.freeze([
  ['玫瑰色', '#C97984'], ['蓝色', '#6F93C8'], ['金色', '#D0A552'],
  ['绿色', '#82AD6B'], ['紫色', '#A681C8'], ['青绿色', '#63B5A2']
]);

/** Presentation only. The host owns placement and the author transaction. */
export function createCharacterDraft({draft, onDraftChange, onSubmit, onCancel = () => {}, onError = () => {}}) {
  const doc = document;
  if (!doc.querySelector('link[data-studio-v3-character-menu]')) {
    const link = el('link'); link.rel = 'stylesheet'; link.href = new URL('./character-menu.css', import.meta.url).href;
    link.dataset.studioV3CharacterMenu = 'true'; doc.head.append(link);
  }
  const panel = el('div', 'sv3-character-draft'), field = el('label', 'sv3-character-name');
  const glyph = el('span', 'sv3-menu-icon'); glyph.innerHTML = icon('character');
  const input = el('input'); input.ariaLabel = '角色名'; input.placeholder = '角色名'; input.value = draft.label;
  input.maxLength = 120; field.append(glyph, input); panel.append(field, el('div', 'sv3-menu-divider'));
  const palette = el('div', 'sv3-character-palette'); palette.setAttribute('role', 'group'); palette.ariaLabel = '角色颜色';
  let value = {...draft}, disposed = false, pending = false;
  const submit = button(null, '添加并放置', send, {text: '添加并放置', className: 'sv3-menu-row sv3-character-submit'});
  const swatches = colors.map(([label, color]) => {
    const item = button(null, label, () => {
      if (disposed || pending) return;
      value = {...value, color, actorGender: 'neutral'}; onDraftChange({...value}); refresh();
    }, {className: 'sv3-character-swatch'});
    const dot = el('span'); dot.style.backgroundColor = color; dot.innerHTML = icon('check'); item.append(dot);
    item.dataset.color = color; palette.append(item); return item;
  });
  panel.append(palette, submit);
  function refresh() {
    submit.disabled = pending || !value.label.trim(); input.readOnly = pending;
    for (const item of swatches) {item.disabled = pending; item.setAttribute('aria-pressed', String(item.dataset.color.toLowerCase() === value.color.toLowerCase()));}
  }
  async function send() {
    if (disposed || pending || !value.label.trim()) return;
    pending = true; refresh();
    try {await onSubmit({...value, label: value.label.trim()});}
    catch (error) {if (!disposed) onError(error);}
    finally {pending = false; if (!disposed) refresh();}
  }
  input.addEventListener('input', () => {value = {...value, label: input.value}; onDraftChange({...value}); refresh();});
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {event.preventDefault(); void send();}
    // Escape belongs to the scoped menu controller, including nested dismissal.
  });
  panel.dispose = () => {disposed = true;};
  panel.handleEscape = () => {onCancel(); return true;};
  refresh(); queueMicrotask(() => {if (!disposed && input.isConnected) input.focus({preventScroll: true});});
  return panel;
}
