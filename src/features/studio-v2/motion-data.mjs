import * as THREE from 'three';

export function binding(root,track){const parsed=THREE.PropertyBinding.parseTrackName(track.name);return {node:THREE.PropertyBinding.findNode(root,parsed.nodeName),field:parsed.propertyName};}
export function ancestry(root,camera){const chain=[];for(let node=camera;node&&node!==root;node=node.parent)chain.unshift(node);return chain;}
export function motionTracks(root,camera,clip){const nodes=new Set(ancestry(root,camera));return clip.tracks.filter(track=>{const b=binding(root,track);return nodes.has(b.node)&&['position','quaternion','scale'].includes(b.field);});}
export const keyTimes=tracks=>[...new Set(tracks.flatMap(track=>Array.from(track.times)))].sort((a,b)=>a-b);
export const cubic=track=>!!track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline;

// Keep the source rig and its object tracks intact. Only the cloned camera branch is editable.
export function isolateCamera(root,camera,clips){
  if(camera.userData.tapnow_motion_isolated)return camera;
  const chain=ancestry(root,camera),mapping=new Map();let parent=root;
  for(const source of chain){const copy=source===camera?source.clone(false):new THREE.Group();copy.name=source.name;copy.position.copy(source.position);copy.quaternion.copy(source.quaternion);copy.scale.copy(source.scale);copy.userData={studioId:crypto.randomUUID()};mapping.set(source,copy);parent.add(copy);parent=copy;}
  const isolated=mapping.get(camera);isolated.userData={...camera.userData,tapnow_motion_isolated:true};
  for(const clip of clips){const added=[];for(const track of clip.tracks){const b=binding(root,track),copy=mapping.get(b.node);if(!copy)continue;const next=track.clone();next.name=copy.uuid+'.'+b.field;added.push(next);}clip.tracks.push(...added);}
  const placeholder=new THREE.Group();placeholder.uuid=camera.uuid;placeholder.name=camera.name;placeholder.position.copy(camera.position);placeholder.quaternion.copy(camera.quaternion);placeholder.scale.copy(camera.scale);placeholder.userData={studioId:crypto.randomUUID(),studioMotionSource:true};if(camera.children.length)placeholder.add(...camera.children.slice());const oldParent=camera.parent,index=oldParent.children.indexOf(camera);camera.removeFromParent();oldParent.add(placeholder);oldParent.children.splice(oldParent.children.indexOf(placeholder),1);oldParent.children.splice(index,0,placeholder);return isolated;
}
export function worldPose(root,camera,tracks,time,rest=new Map(),parentOnly=false){
  const matrix=new THREE.Matrix4();const chain=ancestry(root,camera);if(parentOnly)chain.pop();
  for(const node of chain){const original=rest.get(node.uuid)||node,position=original.position.clone(),quaternion=original.quaternion.clone(),scale=original.scale.clone();
    for(const track of tracks){const b=binding(root,track);if(b.node!==node)continue;const value=track.createInterpolant().evaluate(time);({position,quaternion,scale})[b.field].fromArray(value);}
    matrix.multiply(new THREE.Matrix4().compose(position,quaternion.normalize(),scale));
  }return matrix;
}
export function deletionReason(tracks,time){if(keyTimes(tracks).length<=2)return '运镜至少保留两个关键帧';if(tracks.some(track=>track.times.length===1&&track.times[0]===time))return '此关键帧是某个通道的唯一姿态，需要保留';return null;}
export function deleteKey(tracks,time){const error=deletionReason(tracks,time);if(error)throw Error(error);for(const track of tracks){const index=Array.from(track.times).indexOf(time);if(index<0)continue;const size=track.getValueSize();track.times=track.times.filter((_,i)=>i!==index);track.values=track.values.filter((_,i)=>Math.floor(i/size)!==index);}}
export function moveKey(tracks,time,next){
  const times=keyTimes(tracks),index=times.indexOf(time);if(index<0||!Number.isFinite(next))throw Error('关键帧时间无效');const min=index?times[index-1]+.001:0,max=index<times.length-1?times[index+1]-.001:7200;
  next=Math.fround(Math.max(min,Math.min(max,next)));
  for(const track of tracks){const old=Array.from(track.times),at=old.indexOf(time);if(at<0)continue;track.times[at]=next;

  }return next;
}
export function editWorldPose(root,camera,clip,time,pose,field,rest){
  const tracks=motionTracks(root,camera,clip),parent=worldPose(root,camera,tracks,time,rest,true);if(Math.abs(parent.determinant())<1e-10)throw Error('父级缩放为零，无法编辑此关键帧');
  const local=parent.invert().multiply(pose),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();local.decompose(p,q,s);const recomposed=new THREE.Matrix4().compose(p,q,s);if(local.elements.some((v,i)=>Math.abs(v-recomposed.elements[i])>1e-4*Math.max(1,Math.abs(v))))throw Error('父级缩放导致剪切，请先调整父级缩放');
  const value=({position:p,quaternion:q.normalize(),scale:s})[field].toArray();if(!value.every(Number.isFinite))throw Error('关键帧参数无效');let track=tracks.find(t=>{const b=binding(root,t);return b.node===camera&&b.field===field;});
  if(!track){const times=keyTimes(tracks),initial=(rest.get(camera.uuid)||camera)[field].toArray();track=field==='quaternion'?new THREE.QuaternionKeyframeTrack(camera.uuid+'.'+field,times,times.flatMap(()=>initial)):new THREE.VectorKeyframeTrack(camera.uuid+'.'+field,times,times.flatMap(()=>initial));clip.tracks.push(track);}
  const times=Array.from(track.times),values=Array.from(track.values),size=value.length,stride=track.getValueSize();let index=times.findIndex(t=>t===Math.fround(time));if(index<0){index=times.findIndex(t=>t>time);if(index<0)index=times.length;times.splice(index,0,time);values.splice(index*stride,0,...(cubic(track)?[...Array(size).fill(0),...value,...Array(size).fill(0)]:value));}else values.splice(index*stride+(cubic(track)?size:0),size,...value);
  track.times=new Float32Array(times);track.values=new Float32Array(values);
}
