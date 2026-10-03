// Geometry changes do not transfer task ownership; content, references and result history do.
export function nodeVersion(node, edges, config) {
  if (!node) throw Error('节点或参考来源已不存在');
  return JSON.stringify({
    type:node.type, parentId:node.parentId, tool:node.tool, generation:config(node),
    content:node.content, image:node.image, fullImage:node.fullImage, video:node.video,
    audio:node.audio, audioMode:node.audioMode, clip:node.clip, params:node.params,
    imageHistory:node.imageHistory, videoHistory:node.videoHistory,
    audioHistory:node.audioHistory, versions:node.versions,
    workflowRecoveryResult:node.workflowRecoveryResult,
    incoming:edges.filter(edge=>edge.target===node.id).map(edge=>edge.source).sort()
  });
}

export function groupMembers(state, groupId, piles) {
  if (!state.nodes.some(node=>node.id===groupId && node.type==='group')) throw Error('分组已不存在');
  const owners=piles.index(state.nodes).owner;
  return state.nodes.filter(node=>node.parentId===groupId && node.type!=='pile' && !owners.has(node.id));
}

export function readContext({state, projectId, groupId, trackedIds, config, piles}) {
  const members=groupMembers(state,groupId,piles).map(node=>node.id).sort();
  const versions={};
  for (const id of trackedIds) versions[id]=nodeVersion(state.nodes.find(node=>node.id===id),state.edges,config);
  return {projectId,groupId,members,versions};
}

export function contextMatches(expected, current) {
  return expected.projectId===current.projectId && expected.groupId===current.groupId &&
    JSON.stringify([...expected.members].sort())===JSON.stringify([...current.members].sort()) &&
    Object.keys(expected.versions).length===Object.keys(current.versions).length &&
    Object.entries(expected.versions).every(([id,version])=>current.versions[id]===version);
}
