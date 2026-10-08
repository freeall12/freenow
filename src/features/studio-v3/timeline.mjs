import {el, button} from './dom.mjs';
import {icon} from './icons.mjs';
import {createMenus} from './menus.mjs';

const ime = event => event.isComposing || event.keyCode === 229 || event.key === 'Process';
const rejected = value => value === false || value?.ok === false;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const seconds = value => `${(Math.round(value / 100) / 10).toFixed(1)}s`;
const shortTime = value => `${Math.round(value / 100) % 10 ? (Math.round(value / 100) / 10).toFixed(1) : Math.round(value / 1000)}s`;
const trackIdentity = state => JSON.stringify([state.setupId, state.track?.id, state.track?.entityId]);
const editable = target => !!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');

export function timelineTicks(durationMs, width = 420) {
  const duration = Math.max(0, Math.round(durationMs)); if (!duration) return [{kind: 'label', label: '0s', timeMs: 0}];
  const pixelsPerMs = Math.max(1, Math.round(width)) / duration, intervals = [50, 100, 250, 500, 1000, 2000, 5000];
  const interval = (gap, min = 0) => intervals.find(value => value >= min && value * pixelsPerMs >= gap) ?? 5000;
  const micro = interval(2.5), minor = interval(8, micro * 2), major = interval(18, minor * 2), label = interval(56, major);
  const labels = new Set([0, duration]);
  for (let time = label; time < duration; time += label) if ((duration - time) * pixelsPerMs >= 56) labels.add(time);
  const tick = timeMs => ({timeMs, kind: labels.has(timeMs) ? 'label' : timeMs % major === 0 ? 'major' : timeMs % minor === 0 ? 'minor' : 'micro',
    ...(labels.has(timeMs) ? {label: timeMs % 1000 === 0 ? `${timeMs / 1000}s` : seconds(timeMs)} : {})});
  const result = []; for (let time = 0; time < duration; time += micro) result.push(tick(time)); result.push(tick(duration)); return result;
}
export const nextTimelineDuration = durationMs => {const rounded = Math.max(0, Math.round(durationMs)), next = Math.ceil(rounded / 1000) * 1000; return next > rounded ? next : rounded + 1000;};

/** Official zV/x7/k7 selected-track presentation. All playback, authoring and
 * history stay in host callbacks; this component owns only UI and drag leases. */
export function createTimeline({read, onPlayheadChange, onPlayingChange, onLoopingChange, onScrubEnd, onDurationChange,
  close = () => {}, onError = () => {}, getReturnFocus = () => null, requestFrame, cancelFrame} = {}) {
  for (const [name, callback] of Object.entries({read, onPlayheadChange, onPlayingChange, onLoopingChange, onScrubEnd, onDurationChange, close, onError, getReturnFocus})) if (typeof callback !== 'function') throw new TypeError(`时间轴需要 ${name}`);
  const root = el('section', 'sv3-timeline'), document = root.ownerDocument, view = document.defaultView;
  const raf = requestFrame || (callback => view.requestAnimationFrame(callback)), caf = cancelFrame || (frame => view.cancelAnimationFrame(frame));
  root.tabIndex = -1; root.dataset.keyboardScope = 'local-tool'; root.dataset.worldWorkspaceBlockMovementHotkeys = 'true'; root.setAttribute('aria-label', '时间轴');
  const href = new URL('timeline.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) {const link = el('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioV3Timeline = ''; document.head.append(link);}
  const bar = el('div', 'sv3-capsule sv3-timeline-bar'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '时间轴');
  const beta = el('span', 'sv3-timeline-beta', '测试版'), scaleBox = el('div', 'sv3-timeline-scale-box'), slider = el('div', 'sv3-timeline-scale');
  slider.tabIndex = 0; slider.setAttribute('role', 'slider'); slider.setAttribute('aria-label', '定位时间轴'); slider.setAttribute('aria-valuemin', '0');
  const ticks = el('div', 'sv3-timeline-rail sv3-timeline-ticks'), keyRail = el('div', 'sv3-timeline-rail sv3-timeline-key-rail'), segments = el('div', 'sv3-timeline-segments'), playheadRail = el('div', 'sv3-timeline-rail sv3-timeline-playhead-rail'), head = button(null, '播放头', () => {});
  head.className = 'sv3-timeline-playhead'; head.append(el('span', 'sv3-timeline-playhead-line'), el('span', 'sv3-timeline-playhead-dot')); playheadRail.append(head);
  slider.append(ticks, playheadRail); keyRail.append(segments); scaleBox.append(slider, keyRail);
  const feedback = el('div', 'sv3-timeline-feedback'); feedback.hidden = true; feedback.setAttribute('role', 'alert');
  let disposed = false, pending = false, refreshing = false, snapshot = {}, owner = null, tickKey = '', drag = null, starting = null, scrub = null, frame = null, queued = null, suppressKey = null, suppressSeek = false, confirmation = null, confirmBusy = false, menuContent = null;
  const records = new Map(), listeners = [];
  const listen = (node, type, fn, options) => {node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options));};
  const live = () => read() || {};
  const forbidden = state => disposed || !!state.readOnly || !!state.baseline || state.canAuthorTemporal === false || state.available === false;
  const disabled = () => {const state = live(); return forbidden(state) || !!state.busy || pending || !!confirmation || !!starting;};
  const structure = state => !!state.playing || !!state.structureEditingDisabledReason || !!state.track?.authoringDisabledReason;
  const durationBlocked = state => !!state.playing || !!state.structureEditingDisabledReason;
  const report = error => {if (disposed) return; feedback.textContent = error?.message || String(error); feedback.hidden = false; try {onError(error);} catch {}};
  const focus = target => {
    if (disposed || !root.isConnected) return;
    const usable = node => node?.isConnected && !node.disabled && !node.closest('[hidden],[inert]');
    const fallback = getReturnFocus(); const destination = usable(target) ? target : usable(fallback) ? fallback : !root.hidden ? root : null;
    destination?.focus({preventScroll: true});
  };
  const call = (callback, ...args) => {if (!callback) return; const result = callback(...args); if (rejected(result)) throw Error(result?.message || '时间轴操作未被接受'); return result;};
  function syncCall(callback, ...args) {const result = call(callback, ...args); if (result?.then) {result.catch?.(report); throw Error('时间轴拖动回调必须同步完成');} return result;}
  function safe(callback, ...args) {try {const result = call(callback, ...args); if (result?.then) Promise.resolve(result).then(value => {if (rejected(value)) throw Error(value?.message || '时间轴操作未被接受');}).catch(report); return result;} catch (error) {report(error); return false;}}
  async function invoke(callback, args = [], gate = () => true) {
    if (disabled() || !gate(live())) return false;
    pending = true; refresh();
    try {const result = await callback(...args); if (rejected(result)) throw Error(result?.message || '时间轴操作未被接受'); if (!disposed) feedback.hidden = true; return true;}
    catch (error) {report(error); return false;} finally {pending = false; refresh();}
  }
  const currentTrack = token => {const state = live(); return !forbidden(state) && trackIdentity(state) === token ? state.track : null;};
  const trackAction = (token, name, args = [], isStructure = false) => invoke(() => {
    const track = currentTrack(token); if (!track || typeof track[name] !== 'function' || name === 'onDeleteKey' && !track.keyItems?.some(key => key.id === args[0])) return false; return track[name](...args);
  }, [], state => trackIdentity(state) === token && (!isStructure || !structure(state)) && !state.playing && !state.track?.authoringDisabledReason);
  const menus = createMenus({root, onError: report});
  const control = (name, label, action, size = 18, strokeWidth = 2.2) => {const node = button(null, label, action); node.innerHTML = icon(name, {size, strokeWidth}); node.setAttribute('aria-label', label); return node;};
  const play = control('play', '播放时间调度', () => void invoke(onPlayingChange, [!live().playing]), 19, 2.35), loop = control('loopOff', '开启循环播放', () => void invoke(onLoopingChange, [!live().looping]), 18, 2.25);
  const redistribute = control('redistribute', '按匀速重新分配', () => void trackAction(trackIdentity(live()), 'onRedistributeTimingForUniformSpeed', [], true));
  const save = control('add', '保存为关键帧', () => void trackAction(trackIdentity(live()), 'onSaveKeyAt', [Math.round(live().playheadMs || 0)]), 19, 2.35);
  const remove = control('delete', '删除所选关键帧', () => {const state = live(); if (state.track?.keyItems?.some(key => key.id === state.track.selectedKeyId)) void trackAction(trackIdentity(state), 'onDeleteKey', [state.track.selectedKeyId], true);});
  save.dataset.timelineAction = 'save-key'; remove.dataset.timelineAction = 'delete-key';
  const more = control('more', '时间轴操作', () => {
    if (disabled()) return; menus.toggle(more, () => {
      const token = trackIdentity(live()), setupId = live().setupId;
      const content = el('div', 'sv3-timeline-menu'), shorter = button(null, '', () => {if (menuContent === content) void durationChange(false, setupId);}, {text: '缩短时间轴'}), longer = button(null, '', () => {if (menuContent === content) void durationChange(true, setupId);}, {text: '延长时间轴'}), deleteTrack = button('delete', '删除轨道', () => {if (menuContent !== content) return; void trackAction(token, 'onDeleteTrack', [], true); menus.close({all: true});}, {text: '删除轨道'});
      content.append(shorter, longer, deleteTrack); content.refresh = () => updateMenu(shorter, longer, deleteTrack); content.dispose = () => {if (menuContent === content) menuContent = null;}; menuContent = content; content.refresh(); return content;
    }, {placement: 'top', align: 'end', label: '时间轴操作'});
  }, 19, 2.25);
  bar.append(beta, play, loop, scaleBox, redistribute, save, remove, more); root.append(bar, feedback);
  function durationChange(extend, setupId = live().setupId) {const state = live(), duration = state.durationMs ?? 3000, minimum = state.durationMinimum?.durationMs ?? 1000;
    return invoke(onDurationChange, [extend ? nextTimelineDuration(duration) : Math.max(minimum, duration - 1000)], current => current.setupId === setupId && !durationBlocked(current) && (extend || (current.durationMs ?? 3000) > (current.durationMinimum?.durationMs ?? 1000)));
  }
  function updateMenu(shorter, longer, deleteTrack) {
    const state = live(), duration = state.durationMs ?? 3000, minimum = state.durationMinimum?.durationMs ?? 1000, short = Math.max(minimum, duration - 1000), next = nextTimelineDuration(duration), blocked = disabled() || durationBlocked(state);
    shorter.textContent = short > duration - 1000 ? `缩短时间轴到 ${shortTime(short)}` : '缩短时间轴 1 秒'; shorter.setAttribute('aria-label', shorter.textContent); shorter.disabled = blocked || duration <= minimum;
    const reason = state.playing ? '暂停播放后才能编辑时长。' : state.structureEditingDisabledReason || (minimum > 1000 ? state.durationMinimum?.trackLabel ? `${state.durationMinimum.trackLabel} 在 ${shortTime(minimum)} 有关键帧，不能再缩短。` : `${shortTime(minimum)} 有关键帧，不能再缩短。` : '已是最短时长：1 秒。'); shorter.title = shorter.disabled ? reason : shorter.textContent;
    longer.textContent = next - Math.round(duration) === 1000 ? '延长时间轴 1 秒' : `延长时间轴到 ${shortTime(next)}`; longer.setAttribute('aria-label', longer.textContent); longer.disabled = blocked; longer.title = longer.disabled ? reason : longer.textContent;
    deleteTrack.hidden = typeof state.track?.onDeleteTrack !== 'function'; deleteTrack.disabled = blocked || !!state.track?.authoringDisabledReason; deleteTrack.textContent = `删除「${state.track?.label || ''}」轨道`; deleteTrack.setAttribute('aria-label', deleteTrack.textContent);
  }
  const percent = value => `${clamp(value / Math.max(1, snapshot.durationMs) * 100, 0, 100)}%`;
  function positionAt(clientX, inset = 18) {const rect = slider.getBoundingClientRect(), width = rect.width - inset * 2; if (!Number.isFinite(clientX) || width <= 0) return 0; return Math.round(clamp((clientX - rect.left - inset) / width, 0, 1) * (live().durationMs ?? 3000));}
  function seek(timeMs, options, gesture = scrub) {
    const state = live(), ownsBusy = gesture?.setupId === state.setupId && gesture.applying > 0;
    if (forbidden(state) || state.busy && !ownsBusy || pending || confirmation) return false;
    // The renderer emits busy synchronously during our own sampled preview.
    // Keep that pointer lease alive until all requests in this gesture settle.
    if (gesture) gesture.applying++;
    const complete = () => {if (gesture) {gesture.applying--; if (scrub === gesture) refresh();}};
    try {
      const result = call(onPlayheadChange, clamp(Math.round(timeMs), 0, state.durationMs ?? 3000), options);
      if (result?.then) Promise.resolve(result).then(value => {if (rejected(value)) throw Error(value?.message || '时间轴操作未被接受');}).catch(report).finally(complete);
      else complete();
      return result;
    } catch (error) {complete(); report(error); return false;}
  }
  function release(target, pointerId) {try {if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);} catch {}}
  function clearFrame() {if (frame !== null) caf(frame); frame = null; queued = null;}
  function schedule(work) {queued = work; if (frame === null) frame = raf(() => {frame = null; const next = queued; queued = null; next?.();});}
  function cancelScrub() {if (!scrub) return false; const current = scrub; scrub = null; clearFrame(); release(current.target, current.pointerId); safe(onScrubEnd); refresh(); return true;}
  function cancelDrag({restore = true} = {}) {
    if (starting) return cancelStarting();
    if (!drag) return false; const current = drag; clearFrame();
    try {syncCall(current.lease.onCancel); drag = null; release(current.target, current.pointerId); if (restore && currentTrack(current.token)) seek(current.startTime, {animated: false, preserveSelectedKey: true, previewMode: 'viewing'}); refresh(); return true;}
    catch (error) {report(error); return false;}
  }
  function cancelStarting() {
    if (!starting) return false; const current = starting; starting = null; current.abort.abort(); release(current.target, current.pointerId); refresh(); return true;
  }
  function dragAllowed(current, preparing = false) {
    const state = live(), track = currentTrack(current.token);
    return !disposed && (preparing || !state.busy) && !structure(state) && state.visible !== false && !!track?.keyItems?.some(key => key.id === current.keyId);
  }
  function dragTime(current, x) {return Math.round(clamp(positionAt(x), current.moveRange?.minTimeMs ?? 0, current.moveRange?.maxTimeMs ?? (live().durationMs ?? 3000)));}
  function previewDrag(time) {
    if (!drag) return; const current = drag;
    if (!dragAllowed(current)) {cancelDrag({restore: trackIdentity(live()) === current.token}); return;}
    try {syncCall(current.lease.onMove, time); current.timeMs = time; seek(time, {animated: false, preserveSelectedKey: true, previewMode: 'scrubbing'}); refresh();} catch (error) {report(error); cancelDrag();}
  }
  function finishDrag(current, x) {
    if (drag !== current) return;
    if (!dragAllowed(current)) {cancelDrag({restore: trackIdentity(live()) === current.token}); return;}
    const time = dragTime(current, x);
    try {syncCall(current.lease.onEnd, time); drag = null; suppressKey = current.keyId; release(current.target, current.pointerId); seek(time, {animated: false, preserveSelectedKey: true, previewMode: 'viewing'}); refresh();} catch (error) {report(error); cancelDrag();}
  }
  function beginDrag(candidate) {
    if (!dragAllowed(candidate)) return false;
    const track = currentTrack(candidate.token); let lease;
    try {lease = track.onKeyMoveStart(candidate.keyId); if (!lease || lease.then || !['onMove', 'onEnd', 'onCancel'].every(name => typeof lease[name] === 'function')) {if (lease) throw Error('关键帧拖动未取得有效同步事务'); return false;}}
    catch (error) {report(error); return false;}
    drag = {...candidate, lease, timeMs: candidate.startTime}; return true;
  }
  async function prepareDrag(candidate, callback) {
    try {
      const result = await callback(candidate.keyId, {signal: candidate.abort.signal});
      if (starting !== candidate || disposed) return;
      if (rejected(result)) throw Error(result?.message || '关键帧拖动准备未被接受');
      starting = null;
      if (!beginDrag(candidate)) {release(candidate.target, candidate.pointerId); refresh(); return;}
      if (candidate.terminal) finishDrag(drag, candidate.x);
      else {if (candidate.moved) schedule(() => previewDrag(dragTime(candidate, candidate.x))); refresh();}
    } catch (error) {if (starting === candidate && !disposed) {report(error); cancelStarting();}}
  }
  function startScrub(event) {
    if (event.button !== 0 || disabled() || drag) return; event.stopPropagation(); clearFrame();
    scrub = {pointerId: event.pointerId, target: event.currentTarget, startX: event.clientX, moved: false, setupId: live().setupId, applying: 0};
    event.currentTarget.setPointerCapture?.(event.pointerId); seek(positionAt(event.clientX), {animated: true, previewMode: 'scrubbing'}); refresh();
  }
  function moveScrub(event) {if (!scrub || scrub.pointerId !== event.pointerId) return; event.stopPropagation(); if (Math.abs(event.clientX - scrub.startX) > 4) scrub.moved = true; const x = event.clientX; schedule(() => {if (scrub) seek(positionAt(x), {animated: false, previewMode: 'scrubbing'});});}
  function finishScrub(event, cancel = false) {
    if (!scrub || scrub.pointerId !== event.pointerId) return; event.stopPropagation(); const current = scrub; clearFrame(); scrub = null; release(current.target, current.pointerId);
    suppressSeek = current.moved; if (!cancel && current.moved) seek(positionAt(event.clientX), {animated: false, previewMode: 'viewing'}, current); safe(onScrubEnd); refresh();
  }
  for (const node of [slider, head]) {listen(node, 'pointerdown', startScrub); listen(node, 'pointermove', moveScrub); listen(node, 'pointerup', event => finishScrub(event)); listen(node, 'pointercancel', event => finishScrub(event, true)); listen(node, 'lostpointercapture', () => cancelScrub());}
  listen(head, 'click', event => event.stopPropagation());
  listen(slider, 'click', event => {if (event.target !== slider && !ticks.contains(event.target)) return; if (suppressSeek) {suppressSeek = false; return;} seek(positionAt(event.clientX), {animated: true, previewMode: 'viewing'});});
  listen(slider, 'keydown', event => {
    if (ime(event) || event.target !== slider || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const state = live(), value = event.key === 'Home' ? 0 : event.key === 'End' ? state.durationMs : (state.playheadMs || 0) + (event.key === 'ArrowLeft' ? -500 : 500); seek(value, {animated: true, previewMode: 'viewing'});
  });
  function keyRecord(key, token) {
    const node = button(null, '', () => {}); node.className = 'sv3-timeline-key'; node.dataset.keyId = key.id; node.append(el('span')); const record = {node, token, key};
    node.onclick = event => {event.stopPropagation(); if (suppressKey === key.id) {suppressKey = null; return;} const track = currentTrack(record.token), item = track?.keyItems?.find(item => item.id === key.id); if (!item || disabled()) return;
      if (track.onSelectKey) void invoke(() => currentTrack(record.token)?.onSelectKey?.(key.id)); else seek(item.timeMs, {animated: true, previewMode: 'viewing'});
    };
    node.onkeydown = event => {if (ime(event) || !['Delete', 'Backspace'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); void trackAction(record.token, 'onDeleteKey', [key.id], true);};
    node.onpointerdown = event => {
      event.stopPropagation(); const state = live(), track = currentTrack(record.token), item = track?.keyItems?.find(item => item.id === key.id);
      if (event.button !== 0 || disabled() || structure(state) || drag || scrub || !item || !track.onKeyMoveStart) return;
      const candidate = {token: record.token, keyId: key.id, target: node, pointerId: event.pointerId, startX: event.clientX, x: event.clientX, startTime: item.timeMs, moved: false, moveRange: item.moveRange, abort: new AbortController()};
      if (typeof track.onBeforeKeyMoveStart === 'function') {starting = candidate; node.setPointerCapture?.(event.pointerId); refresh(); void prepareDrag(candidate, track.onBeforeKeyMoveStart);}
      else if (beginDrag(candidate)) {node.setPointerCapture?.(event.pointerId); refresh();}
    };
    node.onpointermove = event => {const current = starting || drag; if (!current || current.keyId !== key.id || current.pointerId !== event.pointerId) return; event.stopPropagation(); if (Math.abs(event.clientX - current.startX) <= 4) return; current.moved = true; current.x = event.clientX;
      if (drag) {const time = dragTime(drag, event.clientX); schedule(() => previewDrag(time));}
    };
    node.onpointerup = event => {const current = starting || drag; if (!current || current.keyId !== key.id || current.pointerId !== event.pointerId) return; event.stopPropagation(); clearFrame();
      if (starting) {if (!current.moved) cancelStarting(); else {current.terminal = true; current.x = event.clientX; suppressKey = key.id; release(node, event.pointerId);} return;}
      if (!current.moved) {cancelDrag({restore: false}); return;}
      finishDrag(current, event.clientX);
    };
    node.onpointercancel = event => {const current = starting || drag; if (current?.keyId === key.id && current.pointerId === event.pointerId) {event.stopPropagation(); cancelDrag();}};
    node.onlostpointercapture = () => {if (starting?.keyId === key.id && !starting.terminal || drag?.keyId === key.id) cancelDrag();};
    const removes = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {const handler = node[`on${type}`]; node[`on${type}`] = null; node.addEventListener(type, handler); removes.push(() => node.removeEventListener(type, handler));}
    record.dispose = () => {for (const remove of removes) remove(); node.onclick = node.onkeydown = null; node.remove();};
    return record;
  }
  function refresh() {
    if (disposed || refreshing) return; refreshing = true;
    try {
      const state = live(), identity = trackIdentity(state); snapshot = {...state, durationMs: Math.max(1000, state.durationMs ?? 3000)};
      if (starting && !dragAllowed(starting, true)) cancelStarting();
      if (drag && (identity !== drag.token || forbidden(state) || state.busy || structure(state) || !state.track?.keyItems?.some(key => key.id === drag.keyId))) cancelDrag({restore: identity === drag.token});
      if (scrub && (scrub.setupId !== state.setupId || forbidden(state) || state.busy && scrub.applying === 0)) cancelScrub();
      if (confirmation && (confirmation.setupId !== state.setupId || forbidden(state))) cancelConfirmation({focusBack: false});
      if (owner !== identity) {const hadKeyFocus = keyRail.contains(document.activeElement); owner = identity; for (const record of records.values()) record.dispose(); records.clear(); keyRail.replaceChildren(segments); menus.close({restoreFocus: false, all: true}); if (hadKeyFocus) focus(root);}
      root.hidden = forbidden(state) || (state.visible === false && !confirmation); bar.hidden = state.visible === false; root.setAttribute('aria-busy', String(!!state.busy || pending));
      const blocked = disabled(), structural = structure(state), track = state.track;
      play.disabled = loop.disabled = blocked; play.setAttribute('aria-label', state.playing ? '暂停时间调度' : '播放时间调度'); play.title = state.playbackShortcutAvailable ? `${state.playing ? '暂停时间调度' : '播放时间调度'} (Space)` : state.playing ? '暂停时间调度' : '播放时间调度'; play.innerHTML = icon(state.playing ? 'pause' : 'play', {size: 19, strokeWidth: 2.35});
      state.playbackShortcutAvailable ? play.setAttribute('aria-keyshortcuts', 'Space') : play.removeAttribute('aria-keyshortcuts'); loop.innerHTML = icon(state.looping ? 'loop' : 'loopOff', {size: 18, strokeWidth: 2.25}); loop.setAttribute('aria-label', state.looping ? '关闭循环播放' : '开启循环播放'); loop.setAttribute('aria-pressed', String(!!state.looping));
      save.disabled = blocked || !!state.playing || !!track?.authoringDisabledReason || typeof track?.onSaveKeyAt !== 'function'; save.dataset.firstKey = String(!track?.keyItems?.length); save.title = state.playing ? '暂停播放后保存关键帧。' : track?.authoringDisabledReason || (track ? '保存为关键帧' : '先选择角色、摄像机或对象，再保存关键帧'); save.setAttribute('aria-label', save.title);
      const selectedKey = track?.keyItems?.some(key => key.id === track.selectedKeyId);
      remove.disabled = blocked || structural || !selectedKey || typeof track?.onDeleteKey !== 'function'; remove.title = state.playing ? '暂停播放后删除关键帧。' : selectedKey ? state.structureEditingDisabledReason || track?.authoringDisabledReason || '删除所选关键帧' : '选择要删除的关键帧。'; remove.setAttribute('aria-label', remove.title);
      redistribute.disabled = blocked || structural || typeof track?.onRedistributeTimingForUniformSpeed !== 'function'; redistribute.title = state.playing ? '暂停播放后按匀速重新分配关键帧时间。' : state.structureEditingDisabledReason || track?.authoringDisabledReason || (track?.onRedistributeTimingForUniformSpeed ? '按匀速重新分配' : track ? '至少添加三个形成连续运动的关键帧后再按匀速重新分配时间。' : '请选择至少包含三个关键帧的运动轨道。'); more.disabled = blocked;
      slider.setAttribute('aria-valuemax', String(snapshot.durationMs)); slider.setAttribute('aria-valuenow', String(Math.round(clamp(state.playheadMs || 0, 0, snapshot.durationMs)))); slider.setAttribute('aria-disabled', String(blocked)); slider.dataset.active = String(!!scrub || !!state.playing); head.disabled = blocked && !(scrub?.target === head && scrub.applying > 0 && !forbidden(state)); head.setAttribute('aria-label', `播放头位于 ${seconds(state.playheadMs || 0)}`); head.style.left = percent(state.playheadMs || 0);
      const width = Math.max(1, Math.round((slider.getBoundingClientRect().width || 456) - 36)), nextTicks = `${snapshot.durationMs}:${width}`;
      if (tickKey !== nextTicks) {tickKey = nextTicks; ticks.replaceChildren(el('span', 'sv3-timeline-line')); for (const tick of timelineTicks(snapshot.durationMs, width)) {const node = el('span', 'sv3-timeline-tick'); node.dataset.kind = tick.kind; node.style.left = percent(tick.timeMs); node.setAttribute('aria-hidden', 'true'); if (tick.label) {const label = el('span', 'sv3-timeline-tick-label', tick.label); label.dataset.endpoint = tick.timeMs === 0 ? 'start' : tick.timeMs === snapshot.durationMs ? 'end' : 'middle'; node.append(label);} ticks.append(node);}}
      const keys = track?.keyItems || [], valid = new Set(keys.map(key => key.id)); for (const [id, record] of records) if (!valid.has(id)) {const focused = document.activeElement === record.node; record.dispose(); records.delete(id); if (focused) focus(root);}
      const displayed = keys.map(key => drag?.keyId === key.id ? {...key, timeMs: drag.timeMs} : key).sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id)); segments.replaceChildren();
      for (let index = 1; index < displayed.length; index++) {const first = displayed[index - 1], last = displayed[index]; if (last.timeMs <= first.timeMs) continue; const node = el('span'); node.style.left = percent(first.timeMs); node.style.width = `${(last.timeMs - first.timeMs) / snapshot.durationMs * 100}%`; segments.append(node);}
      for (const key of displayed) {let record = records.get(key.id); if (!record) {record = keyRecord(key, identity); records.set(key.id, record); keyRail.append(record.node);} record.key = key; record.node.style.left = percent(key.timeMs); record.node.setAttribute('aria-label', `${track.label} ${seconds(key.timeMs)}`); record.node.setAttribute('aria-pressed', String(key.id === track.selectedKeyId)); record.node.dataset.dragging = String((drag || starting)?.keyId === key.id); record.node.dataset.movable = String(!structural && !!track.onKeyMoveStart); record.node.disabled = forbidden(state) || state.busy && !(starting?.keyId === key.id && starting.target === record.node) || pending || !!confirmation;}
      menuContent?.refresh();
    } catch (error) {report(error);} finally {refreshing = false;}
  }
  const confirmLayer = el('div', 'sv3-timeline-confirm-layer'), dialog = el('div', 'sv3-timeline-confirm'), title = el('strong'), description = el('p'), actions = el('div', 'sv3-timeline-confirm-actions');
  confirmLayer.hidden = true; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
  const cancelButton = button(null, '取消', () => cancelConfirmation(), {text: '取消'}), confirmButton = button(null, '创建', () => void confirmCreation(), {text: '创建'}); cancelButton.setAttribute('aria-label', '取消'); confirmButton.setAttribute('aria-label', '创建'); actions.append(cancelButton, confirmButton); dialog.append(title, description, actions); confirmLayer.append(dialog); root.append(confirmLayer);
  function cancelConfirmation({focusBack = true} = {}) {
    if (!confirmation || confirmBusy) return false; const current = confirmation;
    try {syncCall(current.onCancel); confirmation = null; confirmLayer.hidden = true; refresh(); if (focusBack) focus(current.origin); return true;} catch (error) {report(error); return false;}
  }
  async function confirmCreation() {
    const current = confirmation, state = live(); if (!current || confirmBusy || forbidden(state) || state.busy || state.playing || current.setupId !== state.setupId) return false;
    confirmBusy = true; confirmButton.disabled = cancelButton.disabled = true;
    try {const result = await current.onConfirm(); if (rejected(result)) throw Error(result?.message || '关键帧创建未被接受'); if (!disposed && confirmation === current) {confirmation = null; confirmLayer.hidden = true; refresh(); focus(current.origin);} return true;}
    catch (error) {report(error); return false;} finally {confirmBusy = false; confirmButton.disabled = cancelButton.disabled = false; refresh();}
  }
  function requestKeyCreationConfirmation({intent, onCancel, onConfirm, returnFocus} = {}) {
    if (typeof onCancel !== 'function' || typeof onConfirm !== 'function') throw new TypeError('关键帧确认需要确认与取消回调');
    if (!intent) {safe(onConfirm); return true;}
    const current = live();
    if (forbidden(current) || current.busy || current.playing || confirmation || drag || starting || scrub) {safe(onCancel); return false;}
    if (!Number.isFinite(intent.impact?.timeMs) || typeof intent.entity?.id !== 'string') throw new TypeError('关键帧确认需要真实实体与时刻');
    menus.close({restoreFocus: false, all: true});
    const state = live(); confirmation = {intent, onCancel, onConfirm, setupId: state.setupId, origin: returnFocus || document.activeElement};
    title.textContent = intent.impact.willCreateTrack ? '开始时间轴？' : '创建关键帧？'; description.textContent = `将 ${intent.entity.label} 在 ${seconds(intent.impact.timeMs)} 的状态保存为关键帧。`; dialog.setAttribute('aria-label', title.textContent); confirmLayer.hidden = false; refresh(); cancelButton.focus(); return false;
  }
  function handleEscape() {
    if (disposed) return false;
    if (confirmation) {cancelConfirmation(); return true;}
    if (drag || starting) {cancelDrag(); return true;}
    if (scrub) {cancelScrub(); return true;}
    if (menus.isOpen()) {menus.close({all: true}); return true;}
    safe(close); return true;
  }
  listen(root, 'keydown', event => {
    if (ime(event) || event.defaultPrevented) return;
    if (confirmation && event.key === 'Tab') {event.preventDefault(); event.stopPropagation(); (document.activeElement === cancelButton ? confirmButton : cancelButton).focus(); return;}
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); handleEscape();}
  });
  listen(document, 'keydown', event => {
    const state = live(); if (ime(event) || event.defaultPrevented || event.repeat || event.key !== ' ' || !state.playbackShortcutAvailable || state.visible === false || disabled() || editable(event.target) || menus.isOpen() || drag || scrub) return;
    if (event.target?.closest?.('[data-keyboard-scope="local-tool"]') && !root.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation(); void invoke(onPlayingChange, [!state.playing]);
  });
  listen(view, 'blur', () => {cancelDrag(); cancelScrub();}); listen(document, 'visibilitychange', () => {if (document.hidden) {cancelDrag(); cancelScrub();}});
  let observer; if (view.ResizeObserver) {observer = new view.ResizeObserver(refresh); observer.observe(slider);}
  root.refresh = refresh; root.handleEscape = handleEscape; root.requestKeyCreationConfirmation = requestKeyCreationConfirmation;
  Object.defineProperties(root, {confirming: {get: () => !!confirmation}, dragging: {get: () => !!drag || !!starting}, scrubbing: {get: () => !!scrub}});
  root.dispose = () => {if (disposed) return; cancelDrag({restore: false}); cancelScrub(); cancelConfirmation({focusBack: false}); disposed = true; clearFrame(); observer?.disconnect(); menus.dispose(); for (const remove of listeners) remove(); listeners.length = 0; for (const record of records.values()) record.dispose(); records.clear();};
  refresh(); return root;
}
