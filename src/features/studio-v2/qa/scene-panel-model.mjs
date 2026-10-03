import * as THREE from 'three';

// Synthetic and local: stresses document lookup while retaining a visible mesh scene.
export function createScenePanelModel(){
  const scene=new THREE.Scene();scene.name='QA 目录与分页布景';
  const group=new THREE.Group();group.name='QA 分页模型组';group.userData.studioId='qa-panel-models';scene.add(group);
  const geometry=new THREE.BoxGeometry(.65,.65,.65),material=new THREE.MeshStandardMaterial({color:0xcc613a,roughness:.7});
  for(let i=0;i<151;i++){
    const mesh=new THREE.Mesh(geometry,material);mesh.name='QA 模型 '+String(i+1).padStart(3,'0');mesh.userData.studioId='qa-panel-model-'+i;mesh.position.set((i%14)-6.5,.325+Math.floor(i/14)*.1,Math.floor(i/14)-5);group.add(mesh);
  }
  for(let i=0;i<400;i++){const branch=new THREE.Group();branch.name='QA 分组 '+String(i+1).padStart(3,'0');branch.userData.studioId='qa-panel-group-'+i;scene.add(branch);}
  const animations=[];
  for(let i=0;i<120;i++){
    const camera=new THREE.PerspectiveCamera(42,16/9,.1,600),angle=i/120*Math.PI*2;
    camera.name='QA 镜头 '+String(i+1).padStart(3,'0');camera.userData.studioId='qa-panel-camera-'+i;camera.position.set(Math.sin(angle)*18,10,Math.cos(angle)*18);camera.lookAt(0,1,0);scene.add(camera);
    animations.push(new THREE.AnimationClip('QA 运镜 '+String(i+1).padStart(3,'0'),2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[...camera.position.toArray(),camera.position.x+1,camera.position.y,camera.position.z])]));
  }
  return {scene,animations,expected:{meshes:151,cameras:120,motions:120,rootChildren:521,modelGroupId:'qa-panel-models',lastCameraId:'qa-panel-camera-119'}};
}
