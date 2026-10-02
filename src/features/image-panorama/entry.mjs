import {previewTooltips} from '../world-node/preview-tooltips.mjs';
import {panoramaIcon} from './icons.mjs';
const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('styles.css', import.meta.url); document.head.append(style);

const attached = new Map();
let busy = new Set();
function refreshItem(button, item) {
  if (!button.isConnected) {attached.delete(button); return;}
  const hidden = !item.panorama || !!item.node.pendingOperation || busy.has(item.node.id);
  if (button.hidden !== hidden) button.hidden = hidden;
}
function refreshAll(event) {
  if (event?.detail?.viewportOnly) return;
  // Retry-application state may change before a provider notification. Read it
  // on graph renders as well so controls stay hidden during result decoding.
  busy = new Set((window.GenerationAPI?.getJobs() || []).filter(job => ['queued', 'running'].includes(job.status) || job.applying).map(job => job.request.nodeId));
  for (const [button, item] of attached) refreshItem(button, item);
}
document.addEventListener('canvas:render', refreshAll);
window.GenerationAPI?.subscribe(refreshAll);
refreshAll();

// Official BZ/sL uses decoded image dimensions, not node dimensions or prompt flags.
export function isPanorama(width, height) {return width > 0 && height > 0 && Math.abs(width / height - 2) <= .03;}
export function attach(node, root) {
  if (node.type !== 'image') return;
  const body = root.querySelector('.node-body'), image = body?.querySelector(':scope > img');
  if (!image || image.dataset.panoramaAttached) return;
  image.dataset.panoramaAttached = 'true';
  const button = document.createElement('button'); button.className = 'image-panorama-view'; button.type = 'button';
  button.ariaLabel = '以 360° 全景查看'; button.dataset.tooltip = button.ariaLabel; button.innerHTML = panoramaIcon; button.hidden = true;
  // Decoded dimensions change on load, not when the canvas moves. Refresh only
  // this image so mounting/loading N nodes does not rescan N existing buttons.
  const item = {node, panorama: isPanorama(image.naturalWidth, image.naturalHeight)};
  attached.set(button, item);
  image.addEventListener('load', () => {
    item.panorama = isPanorama(image.naturalWidth, image.naturalHeight);
    refreshItem(button, item);
  });
  image.addEventListener('error', () => {item.panorama = false; refreshItem(button, item);});
  button.onpointerdown = event => event.stopPropagation(); button.ondblclick = event => event.stopPropagation();
  button.onclick = async event => {
    event.preventDefault(); event.stopPropagation(); button.disabled = true;
    try {
      const current = window.CanvasApp.getState().nodes.find(item => item.id === node.id);
      if (!current || current.type !== 'image') return;
      const src = current.fullImage || current.image;
      if (src) await (await import('../world-node/resource.mjs')).preview(current, {panoramaUrl: src});
    } catch (error) {window.CanvasApp.notify(error.message);}
    finally {button.disabled = false;}
  };
  body.append(button); refreshItem(button, item);
}
previewTooltips(document.getElementById('nodes'), {selector: '.image-panorama-view', portal: document.body, className: 'image-panorama-tooltip'});
window.ImagePanorama = {attach};
for (const node of window.CanvasApp.getState().nodes) {
  if (node.type === 'image') {const root = window.CanvasApp.getNodeElement?.(node.id) || document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`); if (root) attach(node, root);}
}
