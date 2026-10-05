import * as THREE from 'three';
import {pickPixel} from '../src/features/studio-v2/scene-hit.mjs';
import {splatObjects} from '../src/features/world-node/splat-io.mjs';
export function installSPZPickingQA({ensureWorld,runtime,button,refresh}){
  let state={ready:false},texture,alphaCanvas;
  const getRuntime=()=>{const rt=runtime();rt?.assertReady();if(!state.ready||!rt||rt.nodeId!==state.studioId)throw Error('请先建立真实混合拾取场景');return rt;};
  const setAlpha=hole=>{const context=alphaCanvas.getContext('2d');context.clearRect(0,0,64,64);context.fillStyle='#fff';context.fillRect(0,0,64,64);if(hole)context.clearRect(22,22,20,20);texture.needsUpdate=true;};
  const read=()=>{const rt=runtime(),rect=rt?.renderer.domElement.getBoundingClientRect();return {...state,selectedId:rt?.selected?.userData.studioId||null,target:rect&&state.pixel?{x:rect.left+state.pixel.u*rect.width,y:rect.top+state.pixel.v*rect.height}:null};};
  window.SPZPickingQA={read};
  button('建立真实SPZ前后遮挡QA',async()=>{
    const source=await ensureWorld();await window.StudioAPI.active?.close();
    const node=window.CanvasApp.createConnected(source.id,[{type:'studio',title:'QA混合深度拾取',width:375,height:250,studioV2:{version:2,splatAssets:[{version:1,format:'spz',url:source.worldResource.url,...source.worldResource.splat,name:source.title}]}}])[0];await window.CanvasApp.saveProject();await window.StudioAPI.open(node.id);
    const rt=runtime();rt.assertReady();rt.focus(rt.content);rt.camera.updateMatrixWorld(true);rt.controls.reset();await rt.splatContext.settle(rt.content,rt.camera);
    const canvas=rt.renderer.domElement;let hit,pixel;
    for(const [u,v]of [[.5,.5],[.45,.5],[.55,.5],[.5,.45],[.5,.55]]){pixel=pickPixel(u,v,canvas.width,canvas.height);hit=rt.splatContext.pick(rt.camera,pixel.u,pixel.v,{root:rt.content});if(hit&&hit.distance>rt.camera.near*8)break;}
    if(!hit)throw Error('真实SPZ在目标区域没有可拾取Gaussian');
    const pose={position:rt.camera.position.clone(),quaternion:rt.camera.quaternion.clone()},ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(pixel.u*2-1,1-pixel.v*2),rt.camera);const gap=Math.max(.2,hit.distance*.15),frontDistance=Math.max(rt.camera.near*4,hit.distance-gap),rearDistance=hit.distance+gap;
    alphaCanvas=document.createElement('canvas');alphaCanvas.width=alphaCanvas.height=64;texture=new THREE.CanvasTexture(alphaCanvas);setAlpha(false);
    const makePlane=(name,distance,color,map)=>{const size=Math.max(.2,distance*2*Math.tan(THREE.MathUtils.degToRad(rt.camera.fov/2))*.22),mesh=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,...(map?{map,transparent:true,alphaTest:.5}:{})}));mesh.name=name;mesh.position.copy(ray.ray.at(distance,new THREE.Vector3()));mesh.quaternion.copy(pose.quaternion);return mesh;};
    const front=await rt.addObject(makePlane('QA前景网格',frontDistance,'#f07850',texture)),rear=await rt.addObject(makePlane('QA后景网格',rearDistance,'#438cad'));
    rt.camera.position.copy(pose.position);rt.camera.quaternion.copy(pose.quaternion);rt.camera.updateMatrixWorld(true);rt.select(null);rt.dirty=true;
    state={ready:true,studioId:node.id,gaussianId:hit.proxy.userData.studioId,frontId:front.id,rearId:rear.id,pixel,gaussianDistance:hit.distance,gaussianDepth:hit.depth,frontDistance,rearDistance,mode:'前景网格',expectedId:front.id};clearTimeout(rt.saveTimer);await rt.flush();
    rt.renderer.domElement.addEventListener('pointerup',()=>setTimeout(refresh,200),{signal:rt.abort.signal});refresh();
  });
  const mode=async name=>{const rt=getRuntime();rt.select(null);setAlpha(name==='透明孔');rt.update(state.frontId,{visible:name==='前景网格'||name==='透明孔'},{history:false,notify:false});rt.update(state.rearId,{visible:true},{history:false,notify:false});rt.update(state.gaussianId,{visible:name!=='隐藏高斯'},{history:false,notify:false});rt.commit();state.mode=name;state.expectedId=name==='前景网格'?state.frontId:name==='隐藏高斯'?state.rearId:state.gaussianId;rt.camera.updateMatrixWorld(true);await rt.splatContext.settle(rt.content,rt.camera);refresh();};
  button('前景网格应优先',()=>mode('前景网格'));
  button('后景网格应选高斯',()=>mode('后景网格'));
  button('透明孔应选高斯',()=>mode('透明孔'));
  button('隐藏高斯应选后景',()=>mode('隐藏高斯'));
  button('程序点选目标并核对',async()=>{const rt=getRuntime(),rect=rt.renderer.domElement.getBoundingClientRect();await rt.pick(rect.left+state.pixel.u*rect.width,rect.top+state.pixel.v*rect.height);state.lastSelectionPassed=rt.selected?.userData.studioId===state.expectedId;if(!state.lastSelectionPassed)throw Error('真实深度点选未匹配预期：'+rt.selected?.userData.studioId);});
}
