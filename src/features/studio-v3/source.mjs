import {createState} from './schema.mjs';
import {assertStoredStudio} from './ownership.mjs';
import {clone, requireDomain} from './invariants.mjs';

export function sourceSnapshot(node, kind) {
  if (kind === 'empty') {
    requireDomain(node?.type === 'studio', 'source', 'empty source must be its studio owner');
    return {kind: 'empty'};
  }
  requireDomain(kind === 'world-resource' && ['glb', 'spz'].includes(node?.worldResource?.format), 'source', 'requires a local GLB or SPZ resource');
  return clone(node.worldResource);
}

export function createStoredStudio(node, source = node) {
  const sourceKind = source === node ? 'empty' : 'world-resource';
  const state = createState({worldNodeId: node.id});
  state.scenePlay.worldSpace.setups.forEach(setup => {setup.label = setup.kind === 'scene-baseline' ? '场景基准' : '状态 1';});
  state.scenePlay.worldSpace.stages[0].label = source === node ? '片场 1' : source.title || '片场 1';
  const stored = {version: 3, state, revision: 0,
    sourceBinding: {sourceNodeId: source.id, sourceKind, sourceSnapshot: sourceSnapshot(source, sourceKind)}};
  return assertStoredStudio(stored, node.id);
}

export function createDirectorNode(app, sourceId) {
  return app.createDirectorNode({sourceId, createStored: createStoredStudio});
}

export function readSourceResource(app, nodeId) {
  const owner = app.getState().nodes.find(node => node.id === nodeId);
  const binding = owner?.studioV3?.sourceBinding;
  if (binding?.sourceKind === 'empty') return null;
  const source = app.getState().nodes.find(node => node.id === binding?.sourceNodeId);
  return source ? sourceSnapshot(source, binding.sourceKind) : null;
}
