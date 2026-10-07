import {assertJson, clone, isRecord, requireDomain, same} from './invariants.mjs';
import {assertState} from './schema.mjs';

const leases = new WeakMap();

export function assertStoredStudio(value, nodeId) {
  assertJson(value, 'studioV3');
  requireDomain(isRecord(value) && value.version === 3, 'studioV3.version', 'requires explicit V3 owner');
  requireDomain(Object.keys(value).every(key => ['version', 'state', 'revision', 'sourceBinding'].includes(key)), 'studioV3', 'unsupported stored field');
  requireDomain(Number.isSafeInteger(value.revision) && value.revision >= 0, 'studioV3.revision', 'invalid revision');
  assertState(value.state);
  requireDomain(value.state.scenePlay.worldNodeId === nodeId, 'studioV3.state', 'owner mismatch');
  const binding = value.sourceBinding;
  requireDomain(isRecord(binding) && Object.keys(binding).length === 3 &&
    ['sourceNodeId', 'sourceKind', 'sourceSnapshot'].every(key => Object.hasOwn(binding, key)), 'studioV3.sourceBinding', 'requires explicit source binding');
  requireDomain(typeof binding.sourceNodeId === 'string' && binding.sourceNodeId.length > 0 &&
    typeof binding.sourceKind === 'string' && binding.sourceKind.length > 0, 'studioV3.sourceBinding', 'invalid source identity');
  return value;
}

// Keep host identity separate from private edits: a new local edit must not invalidate
// the durable acknowledgement of an older, still-owned published snapshot.
export function createOwnership({nodeId, app, getSourceSnapshot, sessionToken = crypto.randomUUID(), isCurrentSession = () => true, readonly = false}) {
  requireDomain(typeof app?.getState === 'function' && typeof app?.projectIdentity === 'function', 'ownership.app', 'requires live CanvasApp adapter');
  requireDomain(typeof getSourceSnapshot === 'function', 'ownership.source', 'requires explicit snapshot reader');
  requireDomain(typeof sessionToken === 'string' && sessionToken.length > 0, 'ownership.sessionToken', 'requires token');
  const nodes = () => app.getState().nodes;
  const find = id => nodes().find(node => node.id === id);
  const getProjectId = () => {
    const identity = app.projectIdentity();
    const id = typeof identity === 'string' ? identity : identity?.id;
    requireDomain(typeof id === 'string' && id.length > 0, 'ownership.project', 'requires project identity');
    return id;
  };
  const target = find(nodeId);
  requireDomain(!!target, 'ownership.node', 'target missing', 'stale-owner');
  const initial = clone(assertStoredStudio(target.studioV3, nodeId));
  const binding = initial.sourceBinding, source = find(binding.sourceNodeId), projectId = getProjectId();
  requireDomain(!!source && same(getSourceSnapshot(source, binding.sourceKind), binding.sourceSnapshot), 'ownership.source', 'source changed', 'stale-owner');
  let projectLeases = leases.get(app);
  if (!projectLeases) { projectLeases = new Map(); leases.set(app, projectLeases); }
  const key = JSON.stringify([projectId, nodeId]), previousLease = projectLeases.get(key);
  requireDomain(!readonly || !previousLease || previousLease.readonly, 'ownership.readonly', 'close the active editable session before opening readonly', 'session-active');
  const inheritedDirty = !!previousLease?.unacknowledged && same(initial, previousLease.unacknowledged);
  const lease = {unacknowledged: inheritedDirty ? clone(initial) : null, readonly};
  projectLeases.set(key, lease);
  let released = false, expected = clone(initial), pending = null;
  const current = () => !released && projectLeases.get(key) === lease && isCurrentSession({nodeId, sessionToken, projectId}) === true &&
    getProjectId() === projectId && find(nodeId) === target && find(binding.sourceNodeId) === source &&
    same(getSourceSnapshot(source, binding.sourceKind), binding.sourceSnapshot) &&
    (same(target.studioV3, expected) || pending !== null && same(target.studioV3, pending));
  const isCurrent = () => { try { return current(); } catch { return false; } };
  const assertCurrent = () => requireDomain(isCurrent(), 'ownership', 'owner/source/session/revision changed', 'stale-owner');
  return Object.freeze({
    getInitialStored: () => clone(initial),
    hasInheritedDirty: () => inheritedDirty,
    getFence: () => ({nodeId, projectId, sessionToken, revision: (pending || expected).revision, sourceBinding: clone(binding)}),
    isCurrent, assertCurrent,
    stage(payload) {
      assertCurrent(); assertStoredStudio(payload, nodeId);
      requireDomain(same(payload.sourceBinding, binding), 'ownership.sourceBinding', 'cannot rebind source');
      requireDomain(payload.revision >= (pending || expected).revision, 'ownership.revision', 'cannot rewind revision');
      // A failed durable write may already have published into host memory. That
      // host baseline remains ours even when the retry contains newer private edits.
      if (pending && same(target.studioV3, pending)) expected = clone(pending);
      pending = clone(payload);
      lease.unacknowledged = clone(payload);
    },
    guardNodeSnapshot(snapshotNode) {
      return isCurrent() && snapshotNode?.id === nodeId && same(snapshotNode.studioV3, pending || expected);
    },
    acknowledge(payload) {
      assertCurrent();
      requireDomain(same(target.studioV3, payload) && same(pending, payload), 'ownership.publish', 'adapter did not publish exact snapshot', 'stale-owner');
      expected = clone(payload); pending = null; lease.unacknowledged = null;
    },
    release() {
      released = true;
      if (projectLeases.get(key) === lease) projectLeases.delete(key);
    }
  });
}
