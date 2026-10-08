import {assertJson, clone, same} from './invariants.mjs';
import {assertState} from './schema.mjs';
import {sampleTemporalSetupState} from './camera-shot-sampling.mjs';

const failure = (code, message) => Object.assign(new Error(message), {code});
const clock = () => globalThis.performance?.now() ?? Date.now();

/** Render-only temporal session. The host owns graph application, edit gates,
 * photographic leases and restoration of the same captured native instances. */
export function createTemporalPlayback({getState, getFence = () => null, getSourceKey = () => null,
  isCurrent = () => true, isHidden = () => false, capturePreview = () => null,
  applyPreview, restorePreview, onChange = () => {}, onError = () => {},
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis), now = clock, autoSchedule = true} = {}) {
  if ([getState, getFence, getSourceKey, isCurrent, isHidden, capturePreview, applyPreview, restorePreview, onChange, onError, now].some(fn => typeof fn !== 'function')) throw new TypeError('Temporal playback requires state and render/restore adapters');
  let session = null, previewState = null, disposed = false, frame = null, serial = Promise.resolve(), restoring = 0, applying = 0, looping = false, speed = 1, lastError = null;
  const status = () => ({active: !!session, playing: !!session?.playing, scrubbing: !!session?.scrubbing,
    ended: !!session && !session.playing && session.durationMs > 0 && session.timeMs >= session.durationMs,
    timeMs: session?.timeMs ?? 0, durationMs: session?.durationMs ?? 0, loop: looping, speed,
    busy: !!applying || !!restoring, blocksWrites: !!session || !!restoring, disposed, error: lastError});
  const emit = () => onChange(status());
  const unschedule = () => {if (frame !== null) cancelFrame?.(frame); frame = null;};
  function identity() {
    const state = getState(); assertState(state); const space = state.scenePlay.worldSpace;
    const value = {fence: getFence(), sourceKey: getSourceKey(), worldNodeId: state.scenePlay.worldNodeId,
      stageId: space.activeStageId, setupId: space.activeSetupId};
    assertJson(value, 'temporalPlayback.identity'); return clone(value);
  }
  function owns(saved) {return !disposed && isCurrent() && !isHidden() && same(saved.identity, identity());}
  function assertCurrent(saved, version) {
    if (session !== saved || version !== undefined && saved.version !== version) throw failure('studio_v3_temporal_superseded', '时间轴预览请求已被替换');
    if (!owns(saved)) throw failure('studio_v3_temporal_stale', '时间轴片场、来源或编辑身份已变化');
  }
  function queue(operation) {const result = serial.then(operation); serial = result.catch(() => {}); return result;}
  async function restore(saved, reason) {
    if (saved.restored) return; saved.restored = true; restoring++;
    try {
      await restorePreview({state: clone(saved.authorState), lease: saved.lease, reason,
        fence: clone(saved.identity.fence), sourceKey: clone(saved.identity.sourceKey),
        isCurrent: () => {try {return owns(saved);} catch {return false;}}});
    } finally {if (previewState === saved.previewState) previewState = null; restoring--; emit();}
  }
  function detach(saved) {if (session === saved) session = null; saved.playing = false; saved.scrubbing = false; unschedule();}
  function schedule() {
    if (!autoSchedule || frame !== null || !requestFrame || !session?.playing || applying || restoring) return;
    frame = requestFrame(timestamp => {frame = null; tick(timestamp).catch(() => {});});
  }
  function begin() {
    if (disposed) throw failure('studio_v3_temporal_disposed', '时间轴播放已关闭');
    if (!isCurrent() || isHidden()) throw failure('studio_v3_temporal_stale', '当前片场不能预览时间轴');
    if (session) {assertCurrent(session); return session;}
    if (restoring) throw failure('studio_v3_temporal_busy', '时间轴仍在恢复作者状态');
    const boundary = identity(), state = clone(getState()), space = state.scenePlay.worldSpace;
    const setup = space.setups.find(item => item.id === space.activeSetupId);
    if (setup?.kind !== 'independent') throw failure('studio_v3_temporal_setup', '时间轴预览需要独立状态');
    const saved = {identity: boundary, authorState: state, descriptor: {stageId: setup.stageId, setupId: setup.id},
      durationMs: Math.max(0, Math.round(setup.temporal?.durationMs ?? 0)), timeMs: 0, playing: false, scrubbing: false, version: 0, previewState: null,
      anchorTime: 0, anchorClock: null, restored: false};
    saved.lease = capturePreview({state: clone(state), fence: clone(boundary.fence), sourceKey: clone(boundary.sourceKey)});
    if (saved.lease?.then) throw new TypeError('Temporal capturePreview must synchronously capture native instances');
    session = saved; lastError = null; emit(); return saved;
  }
  async function apply(saved, version, timeMs) {
    if (session !== saved || saved.version !== version) return false;
    applying++; emit();
    try {
      assertCurrent(saved, version);
      const sampled = sampleTemporalSetupState(saved.authorState, saved.descriptor, timeMs);
      const guard = () => assertCurrent(saved, version);
      await applyPreview({...sampled, lease: saved.lease, fence: clone(saved.identity.fence), sourceKey: clone(saved.identity.sourceKey), assertCurrent: guard});
      guard(); saved.timeMs = sampled.timeMs; saved.previewState = sampled.state; previewState = sampled.state;
      if (!saved.playing) saved.anchorClock = null;
      emit(); return true;
    } catch (error) {
      if (error.code === 'studio_v3_temporal_superseded') return false;
      if (session === saved) {detach(saved); if (error.code === 'studio_v3_temporal_stale') {looping = false; speed = 1;} lastError = error.message; await restore(saved, error.code === 'studio_v3_temporal_stale' ? 'stale' : 'error');}
      if (error.code === 'studio_v3_temporal_stale') return false;
      onError(error); throw error;
    } finally {applying--; emit(); schedule();}
  }
  function seek(timeMs, {scrubbing = false} = {}) {
    if (!Number.isFinite(timeMs)) return Promise.reject(new TypeError('Temporal playhead must be finite'));
    let saved;
    try {saved = begin();} catch (error) {if (session) return cancel('stale').then(() => {throw error;}); return Promise.reject(error);}
    const time = Math.max(0, Math.min(saved.durationMs, Math.round(timeMs))), version = ++saved.version;
    saved.scrubbing = !!scrubbing; saved.anchorTime = time; saved.anchorClock = saved.playing ? now() : null;
    unschedule(); emit(); return queue(() => apply(saved, version, time));
  }
  async function play() {
    let saved; try {saved = begin();} catch (error) {if (session) await cancel('stale'); throw error;}
    if (saved.durationMs <= 0) return false;
    saved.playing = true; saved.scrubbing = false;
    const start = saved.timeMs >= saved.durationMs ? 0 : saved.timeMs;
    const accepted = await seek(start); if (accepted && session === saved) {saved.anchorTime = saved.timeMs; saved.anchorClock = now(); schedule();}
    return accepted;
  }
  function playhead(saved, timestamp) {const raw = saved.anchorTime + (timestamp - (saved.anchorClock ?? timestamp)) * speed; return {raw, time: looping && saved.durationMs > 0 ? (raw % saved.durationMs + saved.durationMs) % saved.durationMs : Math.max(0, Math.min(saved.durationMs, raw))};}
  function pause() {if (!session) return Promise.resolve(false); const saved = session, time = saved.playing ? playhead(saved, now()).time : saved.timeMs; saved.playing = false; saved.scrubbing = false; saved.anchorClock = null; unschedule(); return seek(time);}
  function stop(reason = 'stop') {
    const saved = session; if (!saved) return serial.then(() => false);
    detach(saved); if (reason === 'stale' || reason === 'source-change') {looping = false; speed = 1;} restoring++; emit();
    return queue(async () => {try {await restore(saved, reason); return true;} finally {restoring--; emit();}});
  }
  const cancel = reason => stop(reason || 'cancel');
  function tick(timestamp = now()) {
    if (!session?.playing) return Promise.resolve(false);
    if (!Number.isFinite(timestamp)) return Promise.reject(new TypeError('Temporal frame time must be finite'));
    const saved = session;
    try {assertCurrent(saved);} catch {return cancel(isHidden() ? 'hidden' : 'stale').then(() => false);}
    if (applying) return serial.then(() => false);
    const {raw, time} = playhead(saved, timestamp), version = ++saved.version;
    if (!looping && raw >= saved.durationMs) {saved.playing = false; unschedule();}
    return queue(() => apply(saved, version, Math.round(time)));
  }
  function refresh() {
    if (!session) return Promise.resolve(false);
    try {assertCurrent(session); return Promise.resolve(true);} catch {return cancel(isHidden() ? 'hidden' : 'stale').then(() => false);}
  }
  function dispose() {if (disposed) return serial.then(() => {}); const cleanup = stop('dispose'); disposed = true; unschedule(); return cleanup.then(() => {}, () => {});}
  return {seek, play, pause, stop, exit: () => stop('exit'), cancel, tick, refresh, dispose,
    setLoop(value) {if (session?.playing) {const timestamp = now(); session.anchorTime = playhead(session, timestamp).time; session.anchorClock = timestamp;} looping = !!value; emit(); return looping;},
    setSpeed(value) {const next = Number.isFinite(value) && value > 0 ? value : 1; if (session?.playing) {const timestamp = now(); session.anchorTime = playhead(session, timestamp).time; session.anchorClock = timestamp;} speed = next; emit(); return speed;}, whenIdle: () => serial.then(() => {}),
    get status() {return status();}, get active() {return !!session;}, get playing() {return !!session?.playing;},
    get blocksWrites() {return !!session || !!restoring;}, get previewState() {return previewState;}, get disposed() {return disposed;}};
}
