import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPickingCase,pickingCases} from './picking-scenes.mjs';

const find=(root,id)=>{let value;root.traverse(object=>{if(object.userData.studioId===id)value=object;});return value;};
const worldVertices=mesh=>{
  mesh.updateWorldMatrix(true,true);mesh.skeleton?.update();
  return Array.from({length:mesh.geometry.attributes.position.count},(_,index)=>mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).toArray());
};
for(const [key]of pickingCases){
  const built=buildPickingCase(key),saved=JSON.parse(JSON.stringify({scene:built.root.toJSON(),clips:built.clips.map(clip=>clip.toJSON()),samples:built.samples}));
  const loaded=await new THREE.ObjectLoader().parseAsync(saved.scene);
  for(const sample of saved.samples)if(sample.expectedId)assert.ok(find(loaded,sample.expectedId),key+': unknown expected ID');
  assert.deepEqual(saved.samples.at(-1).point,[0,-2.35,0]);
  if(key==='alpha-green')for(const green of [0,255]){const map=find(loaded,'qa-green-'+green+'-front').material.alphaMap;assert.equal(map.image.data[1],green);assert.equal(map.image.data[3],green?0:255);}
  if(key==='deformation')for(const [id,expectedX]of [['qa-morph',-.95],['qa-skinned',2.3]]){
    const before=find(built.root,id),after=find(loaded,id);assert.equal(after.geometry.type,'BufferGeometry');
    for(const attribute of Object.keys(before.geometry.attributes))assert.deepEqual([...after.geometry.attributes[attribute].array],[...before.geometry.attributes[attribute].array]);
    for(const [attribute,values]of Object.entries(before.geometry.morphAttributes))values.forEach((value,index)=>assert.deepEqual([...after.geometry.morphAttributes[attribute][index].array],[...value.array]));
    if(id==='qa-morph'){assert.equal(after.geometry.morphAttributes.position.length,1);assert.deepEqual(after.morphTargetInfluences,[1]);}
    else {assert.ok(after.geometry.attributes.skinIndex&&after.geometry.attributes.skinWeight);assert.equal(after.skeleton.bones.length,1);assert.equal(after.skeleton.bones[0].position.x,1.3);assert.deepEqual(after.bindMatrix.toArray(),before.bindMatrix.toArray());assert.deepEqual(after.skeleton.boneInverses[0].toArray(),before.skeleton.boneInverses[0].toArray());}
    const vertices=worldVertices(after);assert.deepEqual(vertices,worldVertices(before));assert.ok(Math.abs(vertices.reduce((sum,vertex)=>sum+vertex[0],0)/vertices.length-expectedX)<1e-6);
    console.log(id+': deformation attributes and actual world vertices preserved, centerX='+expectedX);
  }
  if(key==='animated'){const mixer=new THREE.AnimationMixer(loaded),clip=THREE.AnimationClip.parse(saved.clips[0]);mixer.clipAction(clip).play();mixer.setTime(3);assert.ok(Math.abs(find(loaded,'qa-animated').position.x)<1e-6);mixer.stopAllAction();mixer.uncacheRoot(loaded);}
  console.log(key+': JSON contract valid (not a GPU pixel result)');
}
