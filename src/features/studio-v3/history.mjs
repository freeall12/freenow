import {clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertState} from './schema.mjs';
import {applyPatches, assertScopeChange, diffState, normalizeScope, touchedBy, touchesOverlap} from './history-patches.mjs';

export const HISTORY_LIMIT = 50;
export const setupLane = setupId => `setup:${setupId}`;
const emptyLane = () => ({undoStack: [], redoStack: []});

// Adapted from S1/Ja/Sf: one active transaction, independent lanes, globally ordered conflicts.
export function createHistory(initialState, {createId = () => `world-history:${crypto.randomUUID()}`, now = Date.now} = {}) {
  assertState(initialState);
  let state = clone(initialState), history = {lanes: {world: emptyLane()}, nextSequence: 1}, active = null;
  const laneFor = (requested, beginning = false) => {
    const lane = requested === 'scout' || requested === 'director' ? setupLane(state.scenePlay.worldSpace.activeSetupId) : requested;
    requireDomain(typeof lane === 'string' && (lane === 'world' || lane.startsWith('setup:')), 'history.lane', 'unknown lane');
    if (lane !== 'world') {
      const id = lane.slice('setup:'.length);
      requireDomain(state.scenePlay.worldSpace.setups.some(setup => setup.id === id) || !beginning && Object.hasOwn(history.lanes, lane), 'history.lane', 'missing setup lane');
    }
    return lane;
  };
  const getLane = lane => Object.hasOwn(history.lanes, lane) ? history.lanes[lane] : emptyLane();
  // A lane replays in stack order; an earlier redo's fresh sequence must not
  // block its next redo. Fresh sequences still fence overlapping other lanes.
  const conflict = record => Object.entries(history.lanes).some(([id, lane]) => id !== record.lane && lane.undoStack.some(other =>
    other.id !== record.id && other.sequence > record.sequence && touchesOverlap(other.touched, record.touched)));
  const availability = (requested, direction) => {
    if (active) return {ok: false, reason: 'transaction-active'};
    const lane = laneFor(requested), record = getLane(lane)[direction].at(-1);
    if (!record) return {ok: false, reason: 'empty'};
    return conflict(record) ? {ok: false, reason: 'conflict'} : {ok: true};
  };
  const replay = (requested, redo) => {
    const available = availability(requested, redo ? 'redoStack' : 'undoStack');
    if (!available.ok) return available;
    const lane = laneFor(requested), stacks = getLane(lane), oldRecord = (redo ? stacks.redoStack : stacks.undoStack).at(-1);
    const record = redo ? {...oldRecord, sequence: history.nextSequence} : oldRecord;
    const next = applyPatches(state, record[redo ? 'forward' : 'inverse']);
    const nextLane = redo ? {undoStack: [...stacks.undoStack, record].slice(-HISTORY_LIMIT), redoStack: stacks.redoStack.slice(0, -1)} :
      {undoStack: stacks.undoStack.slice(0, -1), redoStack: [...stacks.redoStack, record].slice(-HISTORY_LIMIT)};
    state = next;
    history = {...history, nextSequence: redo ? record.sequence + 1 : history.nextSequence, lanes: {...history.lanes, [lane]: nextLane}};
    return {ok: true};
  };
  const api = {
    getState: () => clone(state),
    getHistory: () => clone(history),
    getActiveTransaction: () => active ? {lane: active.lane, label: active.label, scope: clone(active.scope)} : null,
    begin(requested = 'world', label = 'edit', scope = {kind: 'world-space'}) {
      if (active) return false;
      requireDomain(typeof label === 'string' && label.trim().length > 0, 'history.label', 'must be nonempty text');
      active = {lane: laneFor(requested, true), label, scope: normalizeScope(scope), before: clone(state)};
      return true;
    },
    preview(reducer) {
      requireDomain(!!active, 'history.preview', 'begin a transaction first', 'no-transaction');
      requireDomain(typeof reducer === 'function', 'history.preview', 'must be a synchronous reducer');
      const candidate = reducer(clone(state));
      requireDomain(isRecord(candidate) && typeof candidate.then !== 'function', 'history.preview', 'must return a state synchronously');
      assertState(candidate); assertScopeChange(active.before, candidate, active.scope);
      if (same(candidate, state)) return false;
      state = clone(candidate); return true;
    },
    commit() {
      if (!active) return false;
      const {forward, inverse} = diffState(active.before, state, active.scope);
      if (forward.length === 0 && inverse.length === 0) { active = null; return false; }
      const id = createId(), createdAt = now();
      requireDomain(typeof id === 'string' && id.trim().length > 0, 'history.id', 'must be nonempty text');
      requireDomain(!Object.values(history.lanes).some(lane => [...lane.undoStack, ...lane.redoStack].some(record => record.id === id)), 'history.id', 'duplicate history ID', 'duplicate-id');
      requireDomain(Number.isFinite(createdAt) && createdAt >= 0, 'history.createdAt', 'invalid timestamp');
      const record = {id, lane: active.lane, label: active.label, forward, inverse, touched: touchedBy([...forward, ...inverse]), sequence: history.nextSequence, createdAt};
      const lane = getLane(record.lane);
      history = {...history, nextSequence: record.sequence + 1, lanes: {...history.lanes, [record.lane]: {undoStack: [...lane.undoStack, record].slice(-HISTORY_LIMIT), redoStack: []}}};
      active = null; return true;
    },
    cancel() {
      if (!active) return false;
      state = active.before; active = null; return true;
    },
    transact(lane, label, reducer, scope) {
      if (!api.begin(lane, label, scope)) return false;
      try { api.preview(reducer); return api.commit(); }
      catch (error) { api.cancel(); throw error; }
    },
    undo: (lane = 'world') => replay(lane, false),
    redo: (lane = 'world') => replay(lane, true),
    getUndoAvailability: (lane = 'world') => availability(lane, 'undoStack'),
    getRedoAvailability: (lane = 'world') => availability(lane, 'redoStack'),
    clear() {
      requireDomain(!active, 'history.clear', 'cancel or commit active transaction first', 'transaction-active');
      history = {lanes: {world: emptyLane()}, nextSequence: 1};
    }
  };
  return api;
}
