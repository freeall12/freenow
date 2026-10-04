import * as THREE from 'three';
export function createFocusNavigationSpeedModel(){
  const scene=new THREE.Scene();scene.name='QA 聚焦导航速度';
  const large=new THREE.Mesh(new THREE.BoxGeometry(80,.2,30),new THREE.MeshStandardMaterial({color:0x7a6460}));large.name='QA 大布景';large.userData.studioId='qa-focus-large';large.position.set(40,-.1,0);scene.add(large);
  const small=new THREE.Mesh(new THREE.BoxGeometry(.4,.4,.4),new THREE.MeshStandardMaterial({color:0x75b762}));small.name='QA 小物体';small.userData.studioId='qa-focus-small';small.position.set(-4,.2,0);scene.add(small);
  const camera=new THREE.PerspectiveCamera(42,16/9,.01,1000);camera.name='QA 镜头';camera.userData.studioId='qa-focus-camera';camera.position.set(-2,3,6);camera.lookAt(small.position);scene.add(camera);
  return {scene,animations:[],small,large,camera};
}
