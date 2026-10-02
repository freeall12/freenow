// Match vx's 5px activation and pOe's horizontal, parent-bounded movement.
export function referenceSort(track, onReorder, onStart) {
  const chips = [...track.children];
  const status = document.createElement('span'); status.className = 'composer-sort-status'; status.setAttribute('role', 'status');
  track.after(status);
  let drag = null, suppressClick = false;
  function announce(text) {status.textContent = text;}
  function rects() {return chips.map(chip => chip.getBoundingClientRect());}
  function start(index, pointerId, x) {
    drag = {from: index, to: index, pointerId, x, active: pointerId === null, rects: rects()};
    if (drag.active) activate();
  }
  function activate() {
    drag.active = true; track.dataset.sorting = 'true'; onStart();
    chips[drag.from].classList.add('dragging'); chips[drag.from].setAttribute('aria-pressed', 'true');
    announce(`已拾起${chips[drag.from].dataset.referenceLabel}，使用左右方向键移动，空格放下，Esc取消。`);
  }
  function paint(offset) {
    const {from, to, rects} = drag;
    chips.forEach((chip, i) => {
      let x = 0;
      if (i === from) x = offset;
      else if (from < to && i > from && i <= to) x = rects[i - 1].left - rects[i].left;
      else if (from > to && i >= to && i < from) x = rects[i + 1].left - rects[i].left;
      chip.style.transform = `translateX(${x}px)`;
    });
  }
  function finish(commit) {
    if (!drag) return;
    const {from, to, active, pointerId} = drag; drag = null;
    delete track.dataset.sorting;
    chips.forEach(chip => {chip.classList.remove('dragging'); chip.style.transform = ''; chip.setAttribute('aria-pressed', 'false');});
    if (pointerId !== null && chips[from].hasPointerCapture(pointerId)) chips[from].releasePointerCapture(pointerId);
    if (!active) return;
    suppressClick = true;
    announce(commit ? `参考素材已放在第 ${to + 1} 位。` : '已取消排序。');
    if (commit && from !== to) {
      const panel = track.closest('.reference-strip')?.parentElement;
      onReorder(from, to);
      if (pointerId === null) panel?.querySelectorAll('.reference-chip')[to]?.focus({preventScroll: true});
    }
  }
  function down(event) {
    const chip = event.target.closest('.reference-chip');
    if (!chip || chip.dataset.empty === 'true' || event.target.closest('button') || event.button !== 0 || !event.isPrimary) return;
    suppressClick=false; event.preventDefault(); chip.focus({preventScroll: true}); start(chips.indexOf(chip), event.pointerId, event.clientX);
    chip.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (!drag.active) {if (Math.abs(delta) < 5) return; activate();}
    event.preventDefault();
    const bounds = track.getBoundingClientRect(), source = drag.rects[drag.from];
    const offset = Math.max(bounds.left - source.left, Math.min(bounds.right - source.right, delta));
    const center = source.left + source.width / 2 + offset;
    let distance = Infinity, target = drag.from;
    drag.rects.forEach((rect, i) => {if(chips[i].dataset.referenceType!==chips[drag.from].dataset.referenceType||chips[i].dataset.empty==='true')return;const d = Math.abs(rect.left + rect.width / 2 - center); if (d < distance) {distance = d; target = i;}});
    if (target !== drag.to) {drag.to = target; announce(`参考素材移动到第 ${target + 1} 位。`);}
    paint(offset);
  }
  function up(event) {if (drag?.pointerId === event.pointerId) finish(true);}
  function cancel() {finish(false);}
  function key(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const chip = event.target.closest('.reference-chip'); if (!chip || chip.dataset.empty === 'true' || event.target !== chip) return;
    if (![' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Escape', 'Tab'].includes(event.key)) return;
    if (!drag && ![' ', 'Enter'].includes(event.key)) return;
    if (event.key === 'Tab') {finish(false); return;}
    event.preventDefault(); event.stopPropagation();
    if (!drag) {start(chips.indexOf(chip), null); return;}
    if (event.key === 'Escape') {finish(false); return;}
    if (event.key === ' ' || event.key === 'Enter') {finish(true); return;}
    if (drag.pointerId !== null) return;
    const next = Math.max(0, Math.min(chips.length - 1, drag.to + (event.key === 'ArrowLeft' ? -1 : 1)));
    if(chips[next].dataset.referenceType!==chip.dataset.referenceType||chips[next].dataset.empty==='true')return;
    drag.to = next;
    const target = drag.rects[next], bounds = track.getBoundingClientRect();
    if (target.left < bounds.left || target.right > bounds.right) {
      const before = track.scrollLeft;
      track.scrollLeft += target.left < bounds.left ? target.left - bounds.left : target.right - bounds.right;
      const delta = track.scrollLeft - before;
      drag.rects = drag.rects.map(rect => ({left: rect.left - delta, right: rect.right - delta, width: rect.width}));
    }
    paint(drag.rects[next].left - drag.rects[drag.from].left); announce(`参考素材移动到第 ${next + 1} 位。`);
  }
  chips.forEach((chip, index) => {chip.draggable = false; chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.setAttribute('aria-roledescription', '可排序参考素材'); chip.ariaLabel = `${chip.dataset.referenceLabel}：${chip.dataset.referenceTitle}`; chip.setAttribute('aria-pressed', 'false');});
  const click=event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  track.addEventListener('click',click,true);
  const events = {pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, keydown: key};
  for (const [name, handler] of Object.entries(events)) track.addEventListener(name, handler);
  const outside=event=>{if(!track.contains(event.target))cancel();};
  document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside);
  document.addEventListener('canvas:render', cancel); window.addEventListener('pagehide', cancel); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
  return () => {finish(false); track.removeEventListener('click',click,true); for (const [name, handler] of Object.entries(events)) track.removeEventListener(name, handler); status.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); document.removeEventListener('canvas:render', cancel); window.removeEventListener('pagehide', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);};
}
