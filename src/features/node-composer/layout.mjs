import {icons} from './icons.mjs';
import {previewTooltips} from '../world-node/preview-tooltips.mjs';
export {renderReferences} from './references.mjs';
export {referencesFor, referenceInputs, removeReference, reorderReferences, withoutSources} from './reference-model.mjs';
export {referenceIcons as mediaIcons} from '../agent-composer/reference-icons.mjs';
export {musicIcon} from './icons.mjs';
const controls = new WeakMap();
function contentControl(panel, nodeId) {
  let state = controls.get(panel);
  if (!state) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'composer-prompt-toggle';
    state = {id: nodeId, collapsed: false, button, prompt: null, frame: 0};
    const schedule = () => {if (!state.frame) state.frame = requestAnimationFrame(() => {state.frame = 0; if (panel.isConnected && !panel.hidden) document.dispatchEvent(new Event('node-composer:layout'));});};
    state.resize = new ResizeObserver(schedule);
    state.mutations = new MutationObserver(schedule);
    button.onclick = () => {state.collapsed = !state.collapsed; document.dispatchEvent(new Event('node-composer:layout'));};
    previewTooltips(panel, {selector: '.composer-prompt-toggle,.subject-quick-trigger,.reference-add[data-tooltip]', portal: document.body, className: 'image-panorama-tooltip'});
    controls.set(panel, state);
  }
  if (state.id !== nodeId) {state.id = nodeId; state.collapsed = false;}
  const prompt = panel.querySelector('.prompt-editor');
  if (prompt !== state.prompt) {
    state.resize.disconnect(); state.mutations.disconnect(); state.prompt = prompt;
    if (prompt) {state.resize.observe(prompt); state.mutations.observe(prompt, {childList: true, characterData: true, subtree: true});}
  }
  if (!prompt) return;
  const style = getComputedStyle(prompt), textHeight = prompt.scrollHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const overflowing = textHeight > 5 * 24;
  if (!overflowing) state.collapsed = false;
  panel.dataset.composerCollapsed = String(state.collapsed);
  state.button.hidden = !overflowing;
  const label = state.collapsed ? '展开提示词' : '收起提示词';
  if (state.button.ariaLabel !== label) {state.button.ariaLabel = label; state.button.dataset.tooltip = state.collapsed ? '最大化' : '最小化'; state.button.innerHTML = icons[state.collapsed ? 'expand' : 'collapse'];}
  state.button.setAttribute('aria-expanded', String(!state.collapsed));
  const header = panel.querySelector('.reference-strip'); if (header && state.button.parentElement !== header) header.append(state.button);
}
export function reset(panel) {const state = controls.get(panel); if (state) state.collapsed = false;}
// Official Hv: inverse-scaled floating UI, centered at the node's world-space bottom.
export function placeComposer(panel, node, view, canvas, config = {}) {
  panel.classList.add('source-anchored'); panel.classList.remove('compact-editor');
  const wideVideo = ['Kling 3.0 Omni', 'Kling 3.0'].includes(config.model);
  Object.assign(panel.style, {width: 'max-content', minWidth: (node.type === 'image' ? 680 : wideVideo ? 740 : 640) + 'px', maxWidth: 'min(960px, calc(100vw - 32px))', height: 'auto'});
  contentControl(panel, node.id);
  panel.style.left = canvas.left + (node.x + node.width / 2) * view.scale + view.x - panel.offsetWidth / 2 + 'px';
  panel.style.top = canvas.top + (node.y + node.height + 8) * view.scale + view.y + 8 + 'px';
}
const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./styles.css', import.meta.url); css.onload = () => document.dispatchEvent(new Event('node-composer:layout')); document.head.append(css);

export {reconcilePrompt,projectPrompt,projectGenerationPrompt} from './prompt-state.mjs';

export {libraryPolicy,assetReferences} from './library-mentions.mjs';
