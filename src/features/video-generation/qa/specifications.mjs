import { configuration, renderSpecifications } from '../menus.mjs';

const trigger = document.querySelector('#open');
const pop = document.querySelector('#parameter-popover');
const state = document.querySelector('#state');
const inputs = [{ id: 'qa-image', type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' }];
let config = configuration({ model: 'seedance-2.5', mode: '首尾帧', duration: 30 }, inputs).settings;
let cleanup;
function report() {
  const duration = pop.querySelector('.scrollable');
  state.textContent = JSON.stringify({ open: !pop.hidden, mode: config.mode, duration: config.duration,
    focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim(),
    scrollLeft: duration ? Math.round(duration.scrollLeft) : null }, null, 2);
}
function close(returnFocus = false) {
  cleanup?.(); cleanup = null; pop.hidden = true; trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger.focus({ preventScroll: true });
  report();
}
trigger.addEventListener('click', () => {
  if (!pop.hidden) return close(true);
  pop.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  cleanup = renderSpecifications(pop, config, () => inputs, next => {
    config = configuration(next, inputs).settings; queueMicrotask(report); return config;
  });
  pop.focus({ preventScroll: true }); report();
});
pop.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
  event.preventDefault(); close(true);
});
pop.addEventListener('scroll', report, true);
document.addEventListener('focusin', report);
window.addEventListener('pagehide', () => close());
report();
