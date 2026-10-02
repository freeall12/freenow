import { OFF, levelLabels, getThinkingSpec, normalizeThinking } from './thinking-settings.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const make = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
const endpoint = (ratio, width) => width <= 24 ? 0 : Math.round(12 + clamp(ratio) * (width - 24));
const fillRatio = (ratio, width) => width <= 4 ? clamp(ratio) : clamp(((ratio >= 1 ? width - 2 : endpoint(ratio, width)) - 2) / (width - 4));

export function createThinkingControl({ id, settings, onChange, onError }) {
  const spec = getThinkingSpec(id);
  if (!spec || spec.levels.length < 2 && !spec.can_disable) return null;
  let setting = normalizeThinking(id, settings);
  const element = make('div', 'agent-thinking'), heading = make('div', 'agent-thinking-heading');
  element.append(heading);
  element.onclick = event => event.stopPropagation();
  // Let the owning menu handle dismissal; slider navigation remains local.
  element.onkeydown = event => { if (!['Escape', 'Tab'].includes(event.key)) event.stopPropagation(); };
  function commit(next) {
    try { onChange(next); setting = next; return true; }
    catch (error) { onError?.(error.message); return false; }
  }
  if (spec.levels.length < 2) {
    heading.append(make('span', '', '思考'));
    const toggle = make('button', 'agent-thinking-switch'); toggle.type = 'button'; toggle.role = 'switch'; toggle.setAttribute('aria-label', '思考'); toggle.append(make('span', ''));
    const update = () => toggle.setAttribute('aria-checked', String(setting.enabled));
    toggle.onclick = () => { commit({ ...setting, enabled:!setting.enabled }); update(); };
    heading.append(toggle); update();
    return { element, update(value) { setting = normalizeThinking(id, value); update(); }, destroy() {} };
  }

  const levels = spec.can_disable ? [OFF, ...spec.levels] : spec.levels;
  const valueLabel = make('span', 'agent-thinking-value');
  heading.append(make('span', '', '思考强度'), valueLabel);
  const track = make('div', 'agent-thinking-track'), inner = make('div', 'agent-thinking-inner'), fill = make('div', 'agent-thinking-fill'), canvas = make('canvas', 'agent-thinking-particles');
  track.role = 'slider'; track.tabIndex = 0;
  for (const [key,value] of Object.entries({ 'aria-label':'思考强度', 'aria-orientation':'horizontal', 'aria-valuemin':0, 'aria-valuemax':levels.length - 1 })) track.setAttribute(key, value);
  inner.setAttribute('aria-hidden', 'true'); inner.append(fill, canvas); track.append(inner); element.append(track);
  const dots = levels.map(() => { const dot = make('span', 'agent-thinking-dot'); dot.setAttribute('aria-hidden','true'); track.append(dot); return dot; });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), context = canvas.getContext('2d');
  let pressed = false, dragging = false, pointerId = null, startX = 0, preview = null, frame = 0, disposed = false, width = 0, index = 0, ratio = 0, target = 0, from = 0, started = 0;
  const chosenIndex = () => Math.max(0, levels.indexOf(setting.enabled ? setting.level : OFF));
  index = chosenIndex(); ratio = target = index / (levels.length - 1);
  function feather(x,y,filled,w,h) {
    const radius = Math.min(6,h/2), center = Math.min(Math.max(x,radius),Math.max(radius,w-radius));
    const t = clamp(Math.min(radius - Math.hypot(x-center,y-radius), filled-x)/8);
    return t*t*(3-2*t);
  }
  function paint(now, live) {
    if (!context) return;
    const w = inner.clientWidth, h = inner.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w*dpr) || canvas.height !== Math.floor(h*dpr)) {
      canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr);
      canvas.style.width = w+'px'; canvas.style.height = h+'px'; context.setTransform(dpr,0,0,dpr,0,0);
    }
    const filled = setting.enabled ? Math.round(fillRatio(ratio,width)*w) : 0;
    const hoverIndex = preview == null ? null : Math.round(preview*(levels.length-1));
    const previewFill = dragging || hoverIndex == null || levels[hoverIndex] === OFF ? 0 : Math.round(fillRatio(hoverIndex/(levels.length-1),width)*w);
    context.clearRect(0,0,w,h); context.fillStyle = index === levels.length-1 ? '#90c4e5' : '#e6e6e6';
    const columns = Math.max(1,Math.floor(w/5)), rows = Math.max(1,Math.floor(h/5)), xOffset = Math.floor((w-columns*5)/2), yOffset = Math.floor((h-rows*5)/2);
    const draw = (end,opacity) => {
      if (end <= 0) return;
      context.save(); context.beginPath(); context.rect(0,0,end,h); context.clip();
      for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
        const x=xOffset+column*5+2.5, y=yOffset+row*5+2.5;
        if (x-2.5>=end) break;
        const delta=end-x, head=delta>=0&&delta<24?1-delta/24:0;
        const wave = live ? .78 + .32 * (x <= end ? .5 + .5 * Math.sin(x*.38-now*.012) : 0) + .55*head : 1;
        context.globalAlpha=opacity*(.28+.72*feather(x,y,end,w,h))*wave;
        context.beginPath(); context.arc(x,y,.7,0,Math.PI*2); context.fill();
      }
      context.restore();
    };
    if (previewFill>filled) draw(previewFill,.12);
    draw(filled,.7); context.globalAlpha=1;
  }
  function draw(now=performance.now()) {
    const progress = reduced.matches || dragging ? 1 : clamp((now-started)/280);
    if (!dragging) ratio=from+(target-from)*(progress>=1?1:1-2**(-10*progress));
    const live=!reduced.matches&&(dragging||Math.abs(ratio-target)>.004);
    fill.style.width=(setting.enabled?fillRatio(ratio,width)*100:0)+'%';
    paint(now,live);
    if ((progress<1 || live) && !disposed) frame=requestAnimationFrame(draw); else frame=0;
  }
  function schedule() { cancelAnimationFrame(frame); draw(); }
  function update() {
    index=chosenIndex(); const next=index/(levels.length-1);
    if (target!==next) { from=ratio; target=next; started=performance.now(); }
    const text=levelLabels[levels[index]]||levels[index];
    if (valueLabel.textContent!==text) { valueLabel.textContent=text; if (!reduced.matches) valueLabel.animate([{opacity:0},{opacity:1}],{duration:150}); }
    track.setAttribute('aria-valuenow',index); track.setAttribute('aria-valuetext',text);
    track.classList.toggle('maximum',index===levels.length-1);
    const hoverIndex=preview==null?null:Math.round(preview*(levels.length-1));
    dots.forEach((dot,i)=>{dot.style.left=endpoint(i/(levels.length-1),width)+'px';dot.dataset.state=i===index?'selected':i===hoverIndex?'hovered':'idle';});
    schedule();
  }
  function select(i) {
    const level=levels[Math.max(0,Math.min(levels.length-1,i))];
    const next=level===OFF?{...setting,enabled:false}:{enabled:true,level};
    if (next.enabled!==setting.enabled||next.level!==setting.level) commit(next);
    update();
  }
  const pointerRatio = x => { const r=track.getBoundingClientRect(); return clamp(r.width<=24?(x-r.left)/r.width:(x-r.left-12)/(r.width-24)); };
  track.onpointerdown = event => {
    if (event.button!==0) return;
    event.preventDefault(); track.focus({preventScroll:true}); pressed=true; pointerId=event.pointerId; startX=event.clientX;
    track.setPointerCapture(pointerId); preview=pointerRatio(event.clientX); select(Math.round(preview*(levels.length-1)));
  };
  track.onpointermove = event => {
    preview=pointerRatio(event.clientX);
    if (pressed && Math.abs(event.clientX-startX)>=4) dragging=true;
    if (dragging) { ratio=preview; select(Math.round(preview*(levels.length-1))); } else update();
  };
  function end() {
    if (!pressed) return;
    pressed=false; dragging=false; from=ratio; started=performance.now();
    if (pointerId!==null && track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId);
    pointerId=null; update();
  }
  track.onpointerup=end;track.onpointercancel=end;track.onlostpointercapture=end;
  track.onpointerleave=()=>{if (!pressed) {preview=null;update();}};
  track.onkeydown=event=>{
    if (!['ArrowRight','ArrowUp','ArrowLeft','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); preview=null;
    select(event.key==='Home'?0:event.key==='End'?levels.length-1:index+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1));
  };
  const observer=new ResizeObserver(()=>{width=track.clientWidth;update();}); observer.observe(track);
  const motionChange=()=>{from=ratio;started=performance.now();schedule();};reduced.addEventListener('change',motionChange);
  update();
  return { element, update(value) {setting=normalizeThinking(id,value);update();}, destroy() {disposed=true;cancelAnimationFrame(frame);observer.disconnect();reduced.removeEventListener('change',motionChange);} };
}
