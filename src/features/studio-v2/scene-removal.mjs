import * as THREE from 'three';

// Match official xr's guard before a deletion can change history or the scene.
export function planSceneRemoval(root,object,animations){
  let attached=false;root.traverse(node=>{if(node===object&&node!==root)attached=true;});
  if(!attached)throw Error('对象已不在当前场景中');
  const removed=new Set();object.traverse(node=>removed.add(node));
  root.traverse(node=>{
    if(!removed.has(node)&&node.isSkinnedMesh&&node.skeleton?.bones.some(bone=>removed.has(bone)))throw Error('此对象包含其他对象仍在使用的骨骼，请删除完整角色。');
  });
  const retained=[],indices=new Map();
  animations.forEach((clip,index)=>{
    const retainedMask=clip.tracks.map(track=>{
      let bound;try{bound=THREE.PropertyBinding.findNode(root,THREE.PropertyBinding.parseTrackName(track.name).nodeName);}catch{}
      return !removed.has(bound);
    });
    // Three exports only attached nodes, so unreachable channels cannot survive a GLB round trip.
    if(!retainedMask.some(Boolean))return;
    const next=retainedMask.every(Boolean)?clip:clip.clone();
    if(next!==clip){next.tracks=next.tracks.filter((_,trackIndex)=>retainedMask[trackIndex]);next.resetDuration();}
    indices.set(index,retained.length);retained.push(next);
  });
  return {animations:retained,indices,removedIds:[...removed].map(node=>node.userData.studioId).filter(Boolean)};
}
