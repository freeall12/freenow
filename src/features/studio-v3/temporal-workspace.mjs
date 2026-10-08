import {clone, defined, same} from './invariants.mjs';
import {resolveEntityControl, reduceEntityAction} from './entity-actions.mjs';
import {sampleTemporalSetupState, temporalPositionPathSegments} from './camera-shot-sampling.mjs';
import {createTemporalPlayback} from './temporal-playback.mjs';
import {prepareTemporalEdit, applyPreparedTemporalEdit, reduceTemporalAction, temporalDurationMinimum, temporalTrackDescriptor} from './temporal-actions.mjs';
import {createTimeline} from './timeline.mjs';

const stateFields = ['transform', 'visible', 'pose', 'camera', 'lookTarget', 'heldEntityId'];
const scope = Object.freeze({kind: 'world-space'});
const rejected = reason => ({ok: false, changed: false, reason, message: {
  busy: '请先完成拍摄或镜头导出', stale: '片场、来源或编辑目标已变化',
  'transaction-active': '请先完成当前编辑', cancelled: '已取消编辑',
  'confirmation-required': '请先确认创建关键帧', locked: '请先解锁实体',
  playback: '暂停播放后才能编辑', scrubbing: '结束时间轴拖动后才能编辑'
}[reason] || '当前状态不可编辑'});

/** Host bridge only: author state belongs to session, sampled state to playback.
 * Native objects are held by leases and are never restored into a new source. */
export function createTemporalWorkspace({getState, session, getRuntime = () => null,
  readCurrentSelection = () => null, select = () => true, refresh: refreshHost = () => {},
  notice = () => {}, getSourceKey = () => null, getBusy = () => false,
  isCurrent = () => session?.isCurrent?.() !== false, isHidden = () => globalThis.document?.hidden === true,
  onLane = () => {}, readonly = false, previewAdapters = {},
  createTimelineView = createTimeline, playbackOptions = {}, now = Date.now} = {}) {
  if (typeof getState !== 'function' || !session?.history || typeof session.change !== 'function') throw new TypeError('时间轴需要片场状态与作者会话');
  let timeline = null, visible = false, disposed = false, selectedKey = null, playheadMs = 0;
  let primed = null, owner = null, confirmation = null, renderOverride = null, captureLease = null, authorView = null, playbackChrome = null, lastPlaybackUI = -Infinity;
  let previewPreparation = Promise.resolve();
  let seekRequestId = 0, latestSeek = Promise.resolve(true);
  const setup = (state = getState()) => state.scenePlay.worldSpace.setups.find(item => item.id === state.scenePlay.worldSpace.activeSetupId);
  const stamp = () => {const state = getState(), space = state.scenePlay.worldSpace; return clone({worldNodeId: state.scenePlay.worldNodeId, stageId: space.activeStageId, setupId: space.activeSetupId, source: getSourceKey(), fence: session.getFence?.() ?? null});};
  const current = token => !disposed && isCurrent() && !isHidden() && same(token, stamp());
  const withoutSaveRevision = token => {
    if (!token?.fence || typeof token.fence !== 'object') return token;
    const {revision, ...fence} = token.fence; return {...token, fence};
  };
  const currentAuthor = token => !disposed && isCurrent() && !isHidden() && same(withoutSaveRevision(token), withoutSaveRevision(stamp()));
  const busy = () => !!getBusy() || !!captureLease;
  const report = error => {notice(error?.message || String(error), true);};
  const notify = () => {timeline?.refresh(); refreshHost();};
  const options = () => ({now: now(), readonly, playing: playback.playing, scrubbing: playback.status.scrubbing});
  const selectedEntity = () => {const value = readCurrentSelection(); return typeof value === 'string' ? value : value?.entityId ?? value?.id ?? null;};
  function validSelected() {
    if (!selectedKey || selectedKey.setupId !== setup()?.id || !setup()?.temporal?.tracks.some(track => track.owner.entityId === selectedKey.entityId && track.keys.some(key => key.id === selectedKey.keyId))) selectedKey = null;
    return selectedKey;
  }
  function trackOwner() {
    const runtime = getRuntime(), state = getState(), ids = new Set(state.scenePlay.worldSpace.entities.filter(entity => entity.stageId === setup(state)?.stageId).map(entity => entity.id));
    const controlled = runtime?.controlling?.entityId ?? runtime?.possessing?.entityId;
    return [controlled, selectedEntity(), validSelected()?.entityId].find(id => ids.has(id)) ?? null;
  }
  function sampled(state, timeMs) {const active = setup(state); return active?.kind === 'independent' ? sampleTemporalSetupState(state, {setupId: active.id, stageId: active.stageId}, timeMs).state : state;}
  // Saving acknowledges the same author content. Revision changes alone must
  // not revoke a confirmed key while capture keeps camera possession alive.
  const authorViewValid = () => !!authorView && authorView.setupId === setup()?.id && same(authorView.source, getSourceKey()) && (authorView.pendingCommit || currentAuthor(authorView.token));
  function retainView(entityId, setupId, timeMs) {authorView = {entityId, setupId, timeMs, source: clone(getSourceKey()), token: stamp(), pendingCommit: true};}
  function finishView() {if (authorView) {authorView.token = stamp(); authorView.pendingCommit = false;}}
  function displayState() {
    const state = getState(), edit = owner?.prepared ?? primed?.prepared;
    if (edit && edit.target?.kind !== 'base' && edit.action.setupId === setup(state)?.id) return sampled(state, owner?.viewTimeMs ?? edit.action.timeMs);
    if (authorViewValid()) return sampled(state, authorView.timeMs);
    return renderOverride ?? playback.previewState ?? state;
  }
  function nativeLease() {
    const runtime = getRuntime(); return {runtime, graph: runtime?.graph, source: runtime?.graph?.source,
      entities: [...(runtime?.graph?.entities?.values?.() ?? [])].map(record => ({record, root: record.root, camera: record.camera}))};
  }
  function sameNative(lease) {return lease?.runtime === getRuntime() && lease.graph === getRuntime()?.graph && lease.source === lease.graph?.source && lease.entities.every(({record, root, camera}) => lease.graph?.entity?.(record.id) === record && record.root === root && record.camera === camera);}
  const playback = createTemporalPlayback({...playbackOptions, getState, getFence: () => session.getFence?.() ?? null,
    getSourceKey, isCurrent, isHidden,
    capturePreview: previewAdapters.capturePreview ?? nativeLease,
    applyPreview: async payload => {
      payload.assertCurrent(); renderOverride = payload.state;
      if (previewAdapters.applyPreview) await previewAdapters.applyPreview(payload);
      else {if (!sameNative(payload.lease)) throw Error('时间轴原生对象已变化'); await getRuntime()?.sync(payload.state); payload.assertCurrent(); getRuntime()?.render?.();}
      payload.assertCurrent();
    },
    restorePreview: async payload => {
      renderOverride = null;
      if (previewAdapters.restorePreview) await previewAdapters.restorePreview(payload);
      else if (payload.isCurrent() && sameNative(payload.lease)) {await payload.lease.runtime?.sync(payload.state); if (payload.isCurrent()) payload.lease.runtime?.render?.();}
    },
    onChange: status => {
      if (status.active) playheadMs = status.timeMs;
      const chrome = JSON.stringify([status.active, status.playing, status.scrubbing, status.ended, status.loop, status.busy && !status.playing]);
      const timestamp = globalThis.performance?.now() ?? Date.now();
      if (chrome !== playbackChrome) {playbackChrome = chrome; lastPlaybackUI = timestamp; notify();}
      else if (timestamp - lastPlaybackUI >= 32) {lastPlaybackUI = timestamp; timeline?.refresh();}
    }, onError: report});
  function cancelConfirmation() {if (!confirmation) return false; const pending = confirmation; confirmation = null; pending.resolve(rejected('cancelled')); if (timeline?.confirming) timeline.handleEscape(); return true;}
  async function ask(prepared, token) {
    if (!prepared.requiresConfirmation) return prepared;
    if (!timeline) return {...rejected('confirmation-required'), prepared};
    if (confirmation) return rejected('transaction-active');
    return new Promise(resolve => {
      const request = {prepared, token, resolve}; confirmation = request;
      timeline.requestKeyCreationConfirmation({intent: prepared.intent,
        onCancel: () => {if (confirmation === request) {confirmation = null; resolve(rejected('cancelled'));} return true;},
        onConfirm: () => {if (confirmation !== request || !current(token) || busy()) {if (confirmation === request) {confirmation = null; resolve(rejected('stale'));} return rejected('stale');}
          confirmation = null; resolve({...prepared, confirmed: true}); return true;}});
    });
  }
  async function beforeWrite() {
    if (disposed || !isCurrent() || busy()) return rejected('busy');
    if (owner || session.history.getActiveTransaction()) return rejected('transaction-active');
    const hadAuthorView = !!primed || !!authorView;
    cancelConfirmation(); primed = null; authorView = null; await previewPreparation; await playback.stop('author-write'); await playback.whenIdle(); renderOverride = null;
    if (hadAuthorView && !disposed && isCurrent()) await getRuntime()?.sync(getState());
    notify(); return !disposed && isCurrent() && !busy() ? {ok: true} : rejected('stale');
  }
  function viewingContext() {
    return {token: stamp(), displayed: playback.active || authorViewValid() || !!primed && primed.prepared.target.kind !== 'base',
      timeMs: primed?.prepared.action.timeMs ?? (authorViewValid() ? authorView.timeMs : playback.active ? playback.status.timeMs : playheadMs),
      selectedKey: clone(validSelected())};
  }
  async function restoreViewing(context) {
    if (!context.displayed || !current(context.token) || busy() || owner || primed || confirmation || session.history.getActiveTransaction()) return false;
    selectedKey = context.selectedKey; validSelected();
    // A cancelled intention owns no author patch. Restore only its prior
    // paused sample, while the same complete fence still owns the viewport.
    return seek(context.timeMs, {preserveSelectedKey: true, previewMode: 'viewing'});
  }
  function prepareSync(action) {
    const state = getState(), active = setup(state), c = resolveEntityControl(state, {entityId: action.entityId, setupId: action.setupId});
    if (readonly || c.baselineReadOnly || c.locked || !c.setupState) return rejected(c.locked ? 'locked' : 'readonly');
    if (active.kind !== 'independent') return {ok: true, kind: 'base-edit', target: {kind: 'base'}, lane: c.stateLane, scope,
      action: {type: 'update', entityId: action.entityId, patch: action.patch, setupId: active.id}, state, changed: false};
    return prepareTemporalEdit(state, defined({setupId: active.id, entityId: action.entityId, patch: action.patch,
      timeMs: playheadMs, selectedKey: validSelected() ? {entityId: selectedKey.entityId, keyId: selectedKey.keyId} : undefined, source: action.source ?? 'inspector'}), options());
  }
  async function prepareEntityEdit(action) {
    if (action?.type !== 'update' || !Object.keys(action.patch ?? {}).some(field => stateFields.includes(field))) return {ok: true, handled: false};
    if (Object.keys(action.patch).some(field => !stateFields.includes(field))) return {...rejected('mixed-patch'), handled: false};
    if (playback.playing || playback.status.scrubbing) return rejected(playback.playing ? 'playback' : 'scrubbing');
    const viewing = viewingContext(), token = viewing.token, gate = await beforeWrite(); if (!gate.ok) return gate;
    if (!current(token)) return rejected('stale');
    const prepared = prepareSync(action); if (!prepared.ok) {await restoreViewing(viewing); return prepared;}
    const approved = await ask(prepared, token);
    if (!approved.ok) {await restoreViewing(viewing); return approved;}
    return {...approved, handled: true, hostToken: token};
  }
  function applyPrepared(state, prepared, patch, extra = {}) {
    if (prepared.kind === 'base-edit') return reduceEntityAction(state, {...prepared.action, patch}, {now: now()});
    return applyPreparedTemporalEdit(state, prepared, {...options(), confirmed: prepared.confirmed === true || prepared.accepted === true, patch, ...extra});
  }
  async function applyEntityEdit(prepared, patch = prepared?.action?.patch) {
    if (!prepared?.ok || !prepared.handled || !current(prepared.hostToken) || busy() || owner || session.history.getActiveTransaction()) return rejected('stale');
    const result = applyPrepared(getState(), prepared, patch); if (!result.ok) return result;
    primed = null;
    if (prepared.target.kind !== 'base') retainView(prepared.action.entityId, prepared.action.setupId, prepared.action.timeMs);
    if (result.changed) {session.change(() => result.state, {lane: result.lane, label: result.historyLabel ?? '实体编辑', scope}); onLane(result.lane);}
    finishView();
    if (result.selection) selectedKey = {...result.selection, setupId: setup().id};
    notify(); return result;
  }
  async function entityAction(action) {
    const token = stamp();
    const prepared = await prepareEntityEdit(action);
    if (!prepared.ok) return prepared;
    if (!current(token)) return rejected('stale');
    if (prepared.handled) return applyEntityEdit(prepared, action.patch);
    const gate = await beforeWrite(); if (!gate.ok) return gate;
    if (!current(token)) return rejected('stale');
    const result = reduceEntityAction(getState(), action, {now: now()});
    if (result.ok && result.changed) {session.change(() => result.state, {lane: result.lane, label: '实体编辑', scope}); onLane(result.lane);}
    validSelected(); notify(); return result;
  }
  async function primeTransform(entityId) {
    const prepared = await prepareEntityEdit({type: 'update', entityId, patch: {}, source: 'transform'});
    // Empty patch still resolves a fixed target before native transform input.
    if (!prepared.handled) {
      if (playback.playing || playback.status.scrubbing) return false;
      const viewing = viewingContext(), token = viewing.token, gate = await beforeWrite(); if (!gate.ok || !current(token)) return false;
      const target = prepareSync({type: 'update', entityId, patch: {}, source: 'transform'});
      if (!target.ok) {await restoreViewing(viewing); return false;}
      const approved = await ask(target, token); if (!approved.ok) {await restoreViewing(viewing); return false;}
      primed = {entityId, prepared: {...approved, hostToken: token}, token};
    } else if (prepared.ok) primed = {entityId, prepared, token: prepared.hostToken}; else return false;
    await getRuntime()?.sync(displayState());
    if (!primed || !current(primed.token)) {primed = null; return false;} notify(); return true;
  }
  // A failed durable commit must retain the author owner so its original
  // lease can still roll back. A consumed no-change transaction is released.
  function commitAuthorOwner(descriptor, keepView) {
    const previousView = authorView;
    try {
      if (keepView) retainView(descriptor.entityId, descriptor.prepared.action.setupId, descriptor.viewTimeMs ?? descriptor.prepared.action.timeMs);
      const committed = session.history.commit();
      if (committed !== true) {
        if (session.history.getActiveTransaction() === null) {
          if (owner === descriptor) owner = null;
          finishView();
        } else authorView = previousView;
        notify(); return false;
      }
      if (owner === descriptor) owner = null;
      finishView(); notify(); return true;
    } catch (error) {authorView = previousView; report(error); return false;}
  }
  function owned(event) {return owner && owner.entityId === event.entityId && currentAuthor(owner.token) && same(session.history.getActiveTransaction(), owner.transaction);}
  function handle(event, label, patch) {
    if (disposed) return false;
    try {
      if (event.phase === 'begin') {
        if (busy() || playback.blocksWrites || owner || session.history.getActiveTransaction()) return false;
        let prepared = primed?.entityId === event.entityId && current(primed.token) ? primed.prepared : prepareSync({type: 'update', entityId: event.entityId, patch: {}, source: 'transform'});
        if (!prepared.ok || prepared.requiresConfirmation && !prepared.confirmed) return false;
        if (!session.history.begin(prepared.lane, label, scope)) return false;
        owner = {entityId: event.entityId, prepared, token: stamp(), transaction: session.history.getActiveTransaction(), viewTimeMs: prepared.action.timeMs}; primed = null;
        onLane(prepared.lane); notify(); return true;
      }
      // Cancellation is permitted after a source/fence change, but only for
      // this exact history transaction; never cancel another editor's work.
      if (event.phase === 'cancel' && owner?.entityId === event.entityId && same(withoutSaveRevision(stamp()).fence, withoutSaveRevision(owner.token).fence) && same(session.history.getActiveTransaction(), owner.transaction)) {
        const descriptor = owner, previousView = authorView;
        try {
          if (label === '摄像机操控' && event.reason === 'capture' && owner.prepared.target.kind !== 'base') retainView(owner.entityId, owner.prepared.action.setupId, owner.viewTimeMs ?? owner.prepared.action.timeMs);
          if (session.history.cancel() !== true) {authorView = previousView; return false;}
          if (owner === descriptor) owner = null;
          finishView(); notify(); return true;
        } catch (error) {authorView = previousView; throw error;}
      }
      if (!owned(event) || busy()) return false;
      if (event.phase === 'preview') {
        const result = applyPrepared(getState(), owner.prepared, patch); if (!result.ok) return false;
        owner.prepared = result.prepared ?? {...owner.prepared, state: result.state};
        session.history.preview(() => result.state); owner.token = stamp();
        if (result.selection) selectedKey = {...result.selection, setupId: setup().id}; notify(); return true;
      }
      if (event.phase === 'commit') return commitAuthorOwner(owner, owner.prepared.target.kind !== 'base');
      return false;
    } catch (error) {report(error); return false;}
  }
  function handleTransform(event, label = '实体变换') {return handle(event, label, {transform: event.transform});}
  function handleCameraEdit(event) {return handle(event, '摄像机操控', {camera: event.clearLookAt ? {...event.camera, lookAt: {mode: 'none'}} : event.camera, transform: event.transform});}
  function getSubject(entityId) {try {const c = resolveEntityControl(displayState(), {entityId}); return c.setupState ? {entityId, label: c.definition.label, ...clone(c.setupState)} : null;} catch {return null;}}
  async function temporalAction(action) {
    if (playback.playing || playback.status.scrubbing) return rejected('playback');
    const token = stamp(), gate = await beforeWrite(); if (!gate.ok || !current(token)) return gate.ok ? rejected('stale') : gate;
    const result = reduceTemporalAction(getState(), action, options());
    if (result.ok && result.changed) {session.change(() => result.state, {lane: result.lane, label: result.historyLabel, scope}); onLane(result.lane);}
    if (result.selection) selectedKey = {...result.selection, setupId: setup().id}; validSelected(); notify(); return result;
  }
  function seek(timeMs, opts = {}) {
    if (disposed || busy() || confirmation || primed || owner && owner.kind !== 'key-move') return false;
    if (!opts.preserveSelectedKey) selectedKey = null;
    authorView = null;
    const active = setup(), requestedTime = Math.max(0, Math.min(active?.temporal?.durationMs ?? 3000, Math.round(timeMs))); playheadMs = requestedTime;
    if (owner?.kind === 'key-move') {owner.viewTimeMs = playheadMs; notify(); return true;}
    if (!active?.temporal) {notify(); return true;}
    const requestId = ++seekRequestId, token = stamp();
    const result = (async () => {
      if (!await preparePreview() || !current(token)) return false;
      if (requestId !== seekRequestId) return {ok: true, superseded: true};
      const accepted = await playback.seek(requestedTime, {scrubbing: opts.previewMode === 'scrubbing'});
      // Replaced previews are accepted input, not a rejected author action.
      // Identity changes must still report refusal instead of hiding drift.
      return !accepted && requestId !== seekRequestId && current(token) ? {ok: true, superseded: true} : accepted;
    })();
    latestSeek = result; return result;
  }
  async function endScrub() {
    const token = stamp(); await latestSeek; await playback.whenIdle();
    if (!current(token) || !playback.active) return true;
    // pause reads the last applied time. Drain the final pointer seek first,
    // otherwise it would replace that seek with the previous frame's time.
    return playback.pause();
  }
  async function preparePreview() {
    if (playback.active) return true;
    const token = stamp();
    // Let resource loading finish before capturing root/camera identity. A
    // lease captured with undefined native objects would fail on frame two.
    const ready = Promise.resolve(getRuntime()?.sync(getState()));
    previewPreparation = ready.catch(() => {}); await ready;
    return current(token) && !busy() && !owner && !primed && !confirmation;
  }
  async function selectKey(entityId, keyId) {
    if (busy() || owner || confirmation || playback.playing) return false;
    const token = stamp();
    const active = setup(), key = active.temporal?.tracks.find(track => track.owner.entityId === entityId)?.keys.find(item => item.id === keyId); if (!key) return false;
    if (await select(entityId) === false) return false;
    if (!current(token) || !setup().temporal?.tracks.some(track => track.owner.entityId === entityId && track.keys.some(item => item.id === keyId))) return false;
    selectedKey = {setupId: active.id, entityId, keyId}; return seek(key.timeMs, {preserveSelectedKey: true, previewMode: 'viewing'});
  }
  function clearSelectedKey() {
    if (disposed || busy() || owner || primed || confirmation) return false;
    selectedKey = null; notify(); return true;
  }
  function keyMoveStart(entityId, keyId, token) {
    if (!current(token) || busy() || playback.blocksWrites || owner || primed || session.history.getActiveTransaction()) return false;
    const state = getState(), active = setup(state), prepared = prepareSync({type: 'update', entityId, patch: {}});
    if (!prepared.ok || !active.temporal?.tracks.some(track => track.owner.entityId === entityId && track.keys.some(key => key.id === keyId))) return false;
    const lane = prepared.lane, label = 'director.temporal.timeline.move-key'; if (!session.history.begin(lane, label, scope)) return false;
    owner = {kind: 'key-move', entityId, token: stamp(), transaction: session.history.getActiveTransaction(), prepared: {...prepared, target: {kind: 'selected-key', entityId, keyId}}, viewTimeMs: playheadMs};
    const descriptor = owner; selectedKey = {setupId: active.id, entityId, keyId}; onLane(lane);
    const move = timeMs => {
      if (owner !== descriptor || !owned({entityId}) || busy()) return false;
      const result = reduceTemporalAction(getState(), {type: 'move-key', setupId: active.id, entityId, keyId, timeMs}, options()); if (!result.ok) return false;
      playheadMs = result.state.scenePlay.worldSpace.setups.find(item => item.id === active.id).temporal.tracks.find(track => track.owner.entityId === entityId).keys.find(key => key.id === keyId).timeMs;
      descriptor.viewTimeMs = playheadMs; session.history.preview(() => result.state); descriptor.token = stamp(); notify(); return true;
    };
    return {onMove: move, onEnd(timeMs) {if (!move(timeMs)) return false; retainView(entityId, active.id, descriptor.viewTimeMs); owner = null; session.history.commit(); finishView(); notify(); return true;},
      onCancel() {if (owner !== descriptor || !same(session.getFence?.() ?? null, descriptor.token.fence) || !same(session.history.getActiveTransaction(), descriptor.transaction)) return false; owner = null; session.history.cancel(); notify(); return true;}};
  }
  /** Plan trajectories use the same author owner/view lifecycle as native
   * transforms. The caller supplies only persistent temporal domain actions. */
  async function beginTrajectoryEdit({entityId, keyId, timeMs, label = 'director.temporal.plan.edit', initialAction, isValid = () => true} = {}) {
    if (disposed || busy() || playback.playing || playback.status.scrubbing || owner || primed || confirmation || session.history.getActiveTransaction()) return null;
    const viewing = viewingContext(), token = viewing.token, native = nativeLease();
    const gate = await beforeWrite();
    if (!gate.ok || !currentAuthor(token) || !sameNative(native) || !isValid()) return null;
    const state = getState(), active = setup(state), c = resolveEntityControl(state, {entityId});
    if (readonly || active.kind !== 'independent' || c.baselineReadOnly || c.locked || !c.setupState || !Number.isFinite(timeMs)) return null;
    const atTime = Math.max(0, Math.round(timeMs)), viewTimeMs = keyId === undefined ? viewing.timeMs : atTime, lane = `setup:${active.id}`;
    if (keyId !== undefined && !active.temporal?.tracks.some(track => track.owner.entityId === entityId && track.keys.some(key => key.id === keyId && key.timeMs === atTime))) return null;
    const actionAt = action => ({...action, setupId: active.id, entityId, source: 'plan-view'});
    let initial;
    if (initialAction) {initial = reduceTemporalAction(state, actionAt(initialAction), options()); if (!initial.ok) return null;}
    if (!session.history.begin(lane, label, scope)) return null;
    const descriptor = {kind: 'trajectory', entityId, token: stamp(), native, transaction: session.history.getActiveTransaction(), viewTimeMs,
      prepared: {target: {kind: 'time-key', timeMs: viewTimeMs}, action: {setupId: active.id, entityId, timeMs: viewTimeMs}}};
    owner = descriptor; if (keyId !== undefined) {selectedKey = {setupId: active.id, entityId, keyId}; playheadMs = atTime;} onLane(lane);
    const ownsLease = () => owner === descriptor && same(session.history.getActiveTransaction(), descriptor.transaction);
    const cancel = () => {
      if (descriptor.cancelled) return true;
      try {
        if (!ownsLease() || !same(withoutSaveRevision(descriptor.token).fence, withoutSaveRevision(stamp()).fence)) return false;
        const restore = currentAuthor(descriptor.token) && sameNative(descriptor.native);
        if (session.history.cancel() !== true) return false;
        if (owner === descriptor) owner = null;
        authorView = null; descriptor.cancelled = true; notify();
        if (restore) void restoreViewing({...viewing, token: stamp()}).catch(report); return true;
      } catch (error) {report(error); return false;}
    };
    const valid = () => {
      if (!ownsLease()) return false;
      if (!currentAuthor(descriptor.token) || !sameNative(descriptor.native) || busy() || !isValid()) {cancel(); return false;}
      return true;
    };
    const preview = result => {
      if (!result.ok) return false;
      session.history.preview(() => result.state); descriptor.token = stamp();
      if (result.selection) selectedKey = {...result.selection, setupId: active.id};
      notify(); return true;
    };
    if (initial) preview(initial); else notify();
    const move = action => {
      if (!valid()) return false;
      try {return preview(reduceTemporalAction(getState(), actionAt(action), options()));} catch (error) {report(error); return false;}
    };
    return {onMove: move, onEnd(action) {
      if (action && !move(action) || !valid()) return false;
      return commitAuthorOwner(descriptor, true);
    }, onCancel: cancel};
  }
  function read() {
    const state = getState(), active = setup(state), entityId = trackOwner(), selected = validSelected(); let track = null;
    if (entityId) {
      const c = resolveEntityControl(state, {entityId}), descriptor = temporalTrackDescriptor(state, {setupId: active.id, entityId, selectedKeyId: selected?.entityId === entityId ? selected.keyId : undefined});
      let token = stamp();
      track = descriptor ?? {id: `entity-track:${entityId}`, entityId, kind: c.definition.kind, label: c.definition.label, keyItems: [], selectedKeyId: null};
      track.authoringDisabledReason = c.baselineReadOnly ? '此实体属于场景基准' : c.locked ? '请先解锁实体' : null;
      const action = (type, extra = {}) => current(token) ? temporalAction({type, entityId, setupId: active.id, ...extra}) : rejected('stale');
      track.onSelectKey = keyId => current(token) ? selectKey(entityId, keyId) : false;
      track.onSaveKeyAt = timeMs => action('save-key', {timeMs}); track.onDeleteKey = keyId => action('remove-key', {keyId});
      if (descriptor) track.onDeleteTrack = () => action('remove-track');
      const raw = active.temporal?.tracks.find(item => item.owner.entityId === entityId);
      if (raw?.keys.length >= 3 && temporalPositionPathSegments(raw).filter(segment => segment.interpolation !== 'hold' && segment.length > 1e-8).length >= 2) track.onRedistributeTimingForUniformSpeed = () => action('redistribute-timing');
      track.onBeforeKeyMoveStart = async () => {const gate = await beforeWrite(); if (!gate.ok || !current(token)) return false; token = stamp(); return true;};
      track.onKeyMoveStart = keyId => keyMoveStart(entityId, keyId, token);
    }
    return {setupId: active.id, visible, available: !disposed && isCurrent(), readOnly: readonly, baseline: active.kind !== 'independent', canAuthorTemporal: active.kind === 'independent',
      busy: busy() || playback.status.busy && !playback.playing, durationMs: active.temporal?.durationMs ?? 3000, durationMinimum: temporalDurationMinimum(state, active.id),
      playheadMs, playing: playback.playing, looping: playback.status.loop, playbackShortcutAvailable: !getRuntime()?.controlling && !getRuntime()?.possessing,
      structureEditingDisabledReason: owner && owner.kind !== 'key-move' || primed ? '请先完成当前实体编辑' : null, track};
  }
  function mount(container, {getReturnFocus} = {}) {
    if (!timeline) timeline = createTimelineView({read, onPlayheadChange: seek,
      onPlayingChange: setPlaying, onLoopingChange: value => {if (busy()) return false; playback.setLoop(value); return true;},
      onScrubEnd: endScrub,
      onDurationChange: durationMs => temporalAction({type: 'set-duration', setupId: setup().id, durationMs}),
      close: () => setVisible(false), onError: report, ...(getReturnFocus ? {getReturnFocus} : {})});
    container?.append(timeline); return timeline;
  }
  async function setPlaying(value) {
    if (busy() || owner || primed || confirmation || session.history.getActiveTransaction()) return false;
    if (!value) return playback.pause();
    if (!setup()?.temporal) return false;
    authorView = null;
    if (!await preparePreview()) return false;
    if (!playback.active && playheadMs) await playback.seek(playheadMs);
    return playback.play();
  }
  function setVisible(value) {visible = !!value; if (!visible && !confirmation) {authorView = null; void playback.stop('timeline-close').catch(report);} notify(); return visible;}
  function refresh() {
    validSelected(); if (primed && !current(primed.token)) primed = null;
    if (authorView && !authorViewValid()) authorView = null;
    if (confirmation && !current(confirmation.token)) cancelConfirmation();
    if (!owner) void playback.refresh().catch(report); notify();
  }
  async function beforeCapture() {
    if (busy() || confirmation || owner || disposed) return rejected('busy');
    const token = stamp(); await playback.pause(); await playback.whenIdle();
    if (!current(token)) return rejected('stale');
    const lease = {token}; captureLease = lease; notify();
    return {ok: true, timeMs: playheadMs, release() {if (captureLease !== lease) return false; captureLease = null; notify(); return true;}};
  }
  async function dispose() {
    if (disposed) return playback.whenIdle();
    disposed = true;
    cancelConfirmation(); if (owner && same(session.history.getActiveTransaction(), owner.transaction)) {owner = null; session.history.cancel();}
    primed = null; authorView = null; captureLease = null; await previewPreparation; await playback.dispose(); timeline?.dispose(); renderOverride = null;
  }
  return {mount, read, refresh, onAuthorStateChanged: refresh, seek, endScrub, setPlaying, setVisible, beforeWrite, beforeCapture,
    prepareEntityEdit, applyEntityEdit, entityAction, primeTransform, handleTransform, handleCameraEdit, beginTrajectoryEdit, selectKey, clearSelectedKey, temporalAction, getSubject, dispose, playback,
    isPrimed: entityId => !disposed && isCurrent() && !playback.blocksWrites && (primed?.entityId === entityId || owner?.entityId === entityId || authorView?.entityId === entityId && authorViewValid()),
    getTemporalStatus: () => ({...playback.status, confirming: !!confirmation, editing: !!owner || !!primed, capturing: !!captureLease}),
    stop: () => beforeWrite(), setLoop: value => {if (busy()) return false; return playback.setLoop(value);},
    get timeline() {return timeline;}, get displayState() {return displayState();}, get renderState() {return displayState();},
    get selectedKey() {return clone(validSelected());}, get visible() {return visible;}, get editing() {return !!owner || !!primed;}, get confirming() {return !!confirmation;}};
}
