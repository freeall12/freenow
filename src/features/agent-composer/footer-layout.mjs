// Official canvas Agent footer: confirmation label collapses at <=450px.
// The model picker stays readable; only an active voice control hides it here.
export function observeFooter(footer, confirmation) {
  const measure = width => {
    const compact = width <= 450;
    footer.dataset.iconOnly = String(compact);
    confirmation?.setCompact(compact);
  };
  const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
  observer.observe(footer);
  const style = getComputedStyle(footer);
  measure(footer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  return { destroy() { observer.disconnect(); } };
}
