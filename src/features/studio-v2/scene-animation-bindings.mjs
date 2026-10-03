import * as THREE from 'three';

// A glTF node reused in another scene is a distinct loader clone. Capture each
// scene's targets before display names and the source tracks are rewritten.
export async function captureSceneAnimationBindings(loaded){
  const definitions=loaded.parser.json.scenes,indices=[...new Set(definitions.flatMap(scene=>scene.nodes||[]))];
  const roots=new Map(await Promise.all(indices.map(async index=>[index,await loaded.parser.getDependency('node',index)])));
  const sources=new Map();for(const root of roots.values())root.traverse(node=>{sources.set(node.uuid,node);if(node.name)sources.set(node.name,node);});
  const bind=lookup=>loaded.animations.map(clip=>clip.tracks.map(track=>{
    const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=lookup(parsed.nodeName);
    return node?node.uuid+'.'+parsed.propertyName:null;
  }));
  const sourceBindings=bind(name=>sources.get(name));
  const bindings=loaded.scenes.map((scene,sceneIndex)=>{
    const copies=new Map();
    function pair(source,target){if(!source||!target)return;copies.set(source.uuid,target);source.children.forEach((child,index)=>pair(child,target.children[index]));}
    (definitions[sceneIndex].nodes||[]).forEach((index,position)=>pair(roots.get(index),scene.children[position]));
    return bind(name=>copies.get(name)||THREE.PropertyBinding.findNode(scene,name));
  });
  return {bindings,sourceBindings};
}

export function cloneSceneAnimations(animations,bindings){
  return bindings.map(scene=>animations.flatMap((clip,index)=>{
    const copy=clip.clone();
    copy.tracks=copy.tracks.filter((track,trackIndex)=>{
      const name=scene[index][trackIndex];if(!name)return false;track.name=name;return true;
    });
    if(!copy.tracks.length)return [];
    copy.resetDuration();return [copy];
  }));
}
