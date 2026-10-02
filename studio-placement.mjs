import * as THREE from 'three';
import {studioLibrary} from './studio-library-data.mjs';
export function sampleProperties(id,{position=[0,0,0],materialMode='source',scale}={}){
 const group=studioLibrary.find(g=>g.assets.some(a=>a.id===id)),asset=group?.assets.find(a=>a.id===id);if(!asset)throw Error('示例模型不存在');
 if(!Array.isArray(position)||position.length!==3||position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000))throw Error('模型位置无效');if(!['source','clay'].includes(materialMode))throw Error('模型材质模式无效');const size=scale??asset.scale;if(!Number.isFinite(size)||size<.01||size>100)throw Error('模型缩放无效');
 return {name:group.label,sourceUrl:asset.model,sampleId:asset.id,materialMode,position:[...position],scale:[size,size,size]};
}
export function placementRay(client,rect,camera){const ray=new THREE.Raycaster();camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2((client.x-rect.left)/rect.width*2-1,1-(client.y-rect.top)/rect.height*2),camera);return ray;}
export function placementSurface(ray,{groundY=0,surfaces=[],groundOnly=false}={}){
 // The visible floor is lowered to avoid grid z-fighting; placement uses the exact world ground plane.
 const ground=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-groundY),new THREE.Vector3());
 if(groundOnly)return ground;
 const hit=ray.intersectObjects(surfaces,true).find(hit=>{if(!hit.object.isMesh)return false;for(let object=hit.object;object;object=object.parent)if(!object.visible)return false;return true;});
 return hit&&(!ground||hit.distance<ground.distanceTo(ray.ray.origin))?hit.point:ground;
}
export function installPlacement(Studio,{el,button}){
 Object.assign(Studio.prototype,{
  installPlacementEditing(){const canvas=this.renderer.domElement,signal=this.abort.signal;canvas.addEventListener('pointermove',e=>{if(!this.placement)return;this.placement.pointer={x:e.clientX,y:e.clientY};this.refreshPlacementPreview();},{signal});canvas.addEventListener('pointerleave',()=>{if(this.placement?.item)this.placement.item.root.visible=false;},{signal});canvas.addEventListener('wheel',e=>{const placement=this.placement;if(!placement)return;e.preventDefault();e.stopImmediatePropagation();if(placement.kind==='generate-model'||placement.committing)return;const factor=Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.002);placement.properties.scale=(placement.properties.scale||[1,1,1]).map(n=>Math.max(.01,Math.min(100,n*factor)));if(placement.item)placement.item.root.scale.fromArray(placement.properties.scale);this.refreshPlacementPreview();},{capture:true,passive:false,signal});},
  cancelPlacement(){const placement=this.placement;this.placement=null;if(placement?.item){this.scene.remove(placement.item.root);this.disposeObject(placement.item);}this.root.querySelector('.studio-placement-tip')?.remove();this.root.classList.remove('studio-placing');},
  async beginPlacement(kind,properties={}){
   this.cancelPlacement();this.closePlacementMenus?.();this.root.querySelector('.studio-popup')?.remove();if(this.viewfinder)this.toggleViewfinder();const placement={kind,properties:structuredClone(properties),setupId:this.data.activeSetup};this.placement=placement;this.root.classList.add('studio-placing');this.transform.detach();
   const tip=el('div','studio-bar studio-placement-tip'),label=properties.name||{actor:'角色',camera:'摄像机',cube:'立方体',sphere:'球',cylinder:'圆柱体',cone:'圆锥体',model:'3D 对象','generate-model':'生成 3D 对象'}[kind]||'对象';tip.append(el('span','',label+'：'+(kind==='generate-model'?'点击场景选择生成位置':'点击场景可以放置对象，滚轮可以调整大小')),button(null,'取消放置',()=>this.cancelPlacement(),'取消放置'));this.root.append(tip);
   if(kind==='generate-model')return;
   this.notify('正在加载 3D 资产…');const object={id:'placement-preview',kind,name:label,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:kind==='actor'?'#D0A552':'#ddd',pose:'Standing',...placement.properties};
   try{const item=await this.buildObject(object,{detached:true});if(this.placement!==placement||this.closed){this.disposeObject(item);return;}placement.item=item;item.root.visible=false;this.scene.add(item.root);this.notify('');this.refreshPlacementPreview();}catch(error){if(this.placement===placement){this.cancelPlacement();this.notify('模型加载失败：'+error.message);}}
  },
  placementHit(event){const placement=this.placement;if(!placement)return null;const ray=placementRay({x:event.clientX??event.x,y:event.clientY??event.y},this.renderer.domElement.getBoundingClientRect(),this.camera);const surfaces=[...this.entities.values()].filter(item=>item.root.visible&&this.object(item.root.userData.entityId)?.kind!=='camera').map(item=>item.root);if(this.room)surfaces.push(this.room);if(this.worldScene)surfaces.push(this.worldScene);return placementSurface(ray,{groundY:this.data.ground.y,surfaces,groundOnly:placement.kind==='camera'||placement.kind==='actor'});},
  refreshPlacementPreview(){const placement=this.placement;if(!placement?.item||!placement.pointer)return;const point=this.placementHit(placement.pointer);placement.point=point;if(point)placement.item.root.position.copy(point);placement.item.root.visible=!!point;},
  commitPlacement(event){const placement=this.placement;if(!placement)return false;if(placement.committing)return true;const point=this.placementHit(event);if(!point){this.notify('此处没有可放置的场景表面');return true;}if(placement.kind==='generate-model'){this.cancelPlacement();this.generateModelPanel(point.toArray());return true;}if(!placement.item){this.notify('模型正在加载，请稍候');return true;}placement.committing=true;const {kind,properties,setupId}=placement;this.cancelPlacement();if(setupId!==this.data.activeSetup){this.notify('状态已切换，请重新选择放置位置');return true;}this.add(kind,{...properties,position:point.toArray()}).catch(error=>this.notify(error.message));return true;}
 });
}
