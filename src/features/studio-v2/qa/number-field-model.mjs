import * as THREE from 'three';

export function createNumberFieldModel(){
  const scene=new THREE.Scene();scene.name='QA 数字字段精度';
  const cube=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xcb613b}));
  cube.name='QA 精确立方体';cube.userData.studioId='qa-number-cube';
  cube.position.set(2.375432109,.5,-.123456789);cube.rotation.set(.213456789,.312345678,.123456789);cube.scale.set(1.234567891,1,1);scene.add(cube);
  const camera=new THREE.PerspectiveCamera(42,16/9,.01,1000);camera.name='QA 精确镜头';camera.userData.studioId='qa-number-camera';camera.position.set(5.375432109,3.123456789,8);camera.lookAt(cube.position);scene.add(camera);
  const animations=[new THREE.AnimationClip('QA 精确运镜',2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,1,2],[5.375432109,3.123456789,8,4.123456789,3.654321987,7,3.765432109,2.123456789,6])])];
  return {scene,animations,cube,camera};
}
