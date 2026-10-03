import * as THREE from 'three';
import {easingMetadata,sampleEasing,restoreEasing} from './motion-easing.mjs';
const fields={translation:'position',rotation:'quaternion',scale:'scale'};
export function exportEasing(scene,animations){
  const sampled=animations.map(clip=>{const copy=clip.clone();copy.tracks=clip.tracks.map(sampleEasing);return copy;});
  const plugin=writer=>({afterParse(){for(let i=0;i<animations.length;i++){const output=writer.json.animations?.[i];if(!output)continue;for(const track of animations[i].tracks){const data=easingMetadata(track);if(!data)continue;const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=THREE.PropertyBinding.findNode(scene,parsed.nodeName),nodeIndex=writer.nodeMap.get(node),path=Object.keys(fields).find(key=>fields[key]===parsed.propertyName),channel=output.channels.find(c=>c.target.node===nodeIndex&&c.target.path===path);if(!channel)throw Error('运镜曲线对应的导出节点不存在');output.samplers[channel.sampler].extras={...output.samplers[channel.sampler].extras,tapnow_easing_v1:data};}}}});
  return {sampled,plugin};
}
export function importEasing(loaded,sourceNodes){
  const nodes=new Map(sourceNodes);for(const scene of loaded.scenes)scene.traverse(node=>{const index=loaded.parser.associations.get(node)?.nodes;if(index!==undefined&&!nodes.has(index))nodes.set(index,node);});
  for(let index=0;index<(loaded.parser.json.animations||[]).length;index++){const source=loaded.parser.json.animations[index],clip=loaded.animations[index];if(!clip)continue;for(const channel of source.channels){const metadata=source.samplers[channel.sampler]?.extras?.tapnow_easing_v1,node=nodes.get(channel.target.node),field=fields[channel.target.path];if(!metadata||!node||!field)continue;const track=clip.tracks.find(t=>t.name===node.uuid+'.'+field);if(track)restoreEasing(track,metadata);}clip.resetDuration();}
}
