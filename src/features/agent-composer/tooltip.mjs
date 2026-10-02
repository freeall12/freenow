let tooltipSequence = 0;
export function bindTooltip(trigger, { text, enabled = () => true }) {
  const id = `agent-tooltip-${++tooltipSequence}`;
  let tooltip = null, timer = 0;
  const hide = () => { clearTimeout(timer); tooltip?.remove(); tooltip = null; trigger.removeAttribute('aria-describedby'); };
  const show = () => {
    hide();
    if (!enabled() || !text()) return;
    timer = setTimeout(() => {
      if (!trigger.isConnected || !enabled()) return;
      tooltip = document.createElement('div'); tooltip.className = 'agent-confirm-tooltip agent-model-tooltip';
      tooltip.role = 'tooltip'; tooltip.id = id; tooltip.textContent = text();
      (trigger.closest('dialog[open]')||document.body).append(tooltip); trigger.setAttribute('aria-describedby', tooltip.id);
      const rect = trigger.getBoundingClientRect();
      tooltip.style.left = Math.max(8,Math.min(innerWidth-tooltip.offsetWidth-8,rect.left+rect.width/2-tooltip.offsetWidth/2))+'px';
      tooltip.style.top = Math.max(8,rect.top-tooltip.offsetHeight-8)+'px';
    },200);
  };
  trigger.addEventListener('pointerenter',show);trigger.addEventListener('pointerleave',hide);
  trigger.addEventListener('focus',show);trigger.addEventListener('blur',hide);
  return { hide, destroy() {hide();trigger.removeEventListener('pointerenter',show);trigger.removeEventListener('pointerleave',hide);trigger.removeEventListener('focus',show);trigger.removeEventListener('blur',hide);} };
}
