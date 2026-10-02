import {validateViewport,validateLighting,cameraSettings,supportedCameraProperties,supportedLightingProperties,updateSceneSettings,updateSceneEnvironment} from './scene-settings.mjs';
import {controlScenePlayback,playbackState} from './scene-playback.mjs';
import {saveSceneKeyframe,describeKeyframes} from './scene-keyframes.mjs';
import {controlSceneMotion,exportSceneMotion,supportedMotionActions} from './scene-motion-controller.mjs';
import {captureScene} from './scene-capture.mjs';
import {CameraPresentations} from './camera-presentations.mjs';
import {MotionEditor} from './motion-editor.mjs';
import {ScenePlayback,cloneDocument} from './playback.mjs';
import {DisplayMaterials} from './display-materials.mjs';
import {SelectionBox} from './selection-box.mjs';
import {CenteredTransform} from './centered-transform.mjs';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GroundGrid } from './grid.mjs';
import { Navigation } from './navigation.mjs';
import {createViewportKeyHandler} from './viewport-shortcuts.mjs';
import { primitive, exportGlb, loadSaved, disposeModel } from './model-io.mjs';
import {planSceneRemoval} from './scene-removal.mjs';
import {importSceneModel,redoScene} from './scene-import.mjs';
export const defaultLighting={azimuth:Math.atan2(4,6)*180/Math.PI,elevation:Math.atan2(8,Math.hypot(4,6))*180/Math.PI};
export class SceneRuntime {
  constructor(canvas,{node,onChange,onError}){
    this.nodeId=node.id;this.hostNode=node;this.sessionId=crypto.randomUUID();this.saved=structuredClone(node.studioV2||{});this.onChange=onChange;this.onError=onError;this.closed=false;this.loadStatus='loading';this.loadError=null;this.saveError=null;this.lighting={...defaultLighting,...this.saved.lighting};this.revision=0;this.savedRevision=0;this.undoStack=[];this.redoStack=[];this.animations=[];this.selected=null;this.mode='translate';this.abort=new AbortController();this.dirty=true;this.displayMaterials=new DisplayMaterials();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#050505');this.content=new THREE.Scene();this.content.name='Scene';this.scene.add(this.content);this.shotId=this.saved.shotId||null;this.motionIndex=Number.isInteger(this.saved.motionIndex)?this.saved.motionIndex:-1;this.shotRatios={...this.saved.shotRatios};this.playback=new ScenePlayback(this);
    this.camera=new THREE.PerspectiveCamera(50,1,.01,10000);this.camera.position.set(6,4,8);this.camera.lookAt(0,0,0);
    if(this.saved.viewer){this.camera.position.fromArray(this.saved.viewer.position);this.camera.quaternion.fromArray(this.saved.viewer.quaternion);}
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.grid=new GroundGrid();this.grid.visible=this.saved.grid!==false;this.scene.add(this.grid);
    this.sun=new THREE.DirectionalLight(0xffffff,3);this.sun.position.set(6,10,8);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0001;this.scene.add(this.sun,this.sun.target,new THREE.HemisphereLight(0xe4f1ff,0x73706a,2));
    this.centeredTransform=new CenteredTransform(this.scene);this.controls=new Navigation(this.camera,canvas);this.transform=new TransformControls(this.camera,canvas);this.transform.setSpace('local');this.transform.setSize(.85);this.scene.add(this.transform.getHelper());this.box=new SelectionBox();this.box.visible=false;this.scene.add(this.box);this.motion=new MotionEditor(this);this.cameraPresentations=new CameraPresentations(this);
    this.transform.addEventListener('dragging-changed',e=>{this.controls.enabled=!e.value;this.controls.reset();if(this.motion.open){if(e.value)this.motion.beginGesture();else this.motion.endGesture();}else if(e.value)this.beginTransformGesture();else this.endTransformGesture();});
    this.transform.addEventListener('objectChange',()=>{if(this.motion.open){try{this.motion.transform();}catch(error){this.onError?.(error);}return;}this.centeredTransform.apply();this.dirty=true;if(this.selected)this.box.setFromObject(this.selected);this.onChange?.('transform');});
    this.resize=new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/Math.max(1,r.height);this.camera.updateProjectionMatrix();this.dirty=true;});this.resize.observe(canvas);
    const options={signal:this.abort.signal};window.addEventListener('beforeunload',event=>{if(this.savedRevision!==this.revision){event.preventDefault();event.returnValue='';}},options);let start=null;
    canvas.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};},options);
    canvas.addEventListener('pointerup',e=>{if(this.exporting)return;if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>4||this.transform.dragging||this.transform.axis)return;const r=canvas.getBoundingClientRect();if(this.motion.pick(e.clientX,e.clientY,r))return;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);const targets=[];for(const root of [this.content,this.cameraPresentations.layer])root.traverseVisible(object=>{if(object.isMesh)targets.push(object);});const hit=ray.intersectObjects(targets,false)[0]?.object;let cameraId;for(let object=hit;object;object=object.parent)if(object.userData.studioCameraId){cameraId=object.userData.studioCameraId;break;}this.select(cameraId?this.find(cameraId):hit||null);},options);
    canvas.addEventListener('keydown',createViewportKeyHandler(this),options);
    let previous=performance.now();this.renderer.setAnimationLoop(now=>{if(this.closed)return;const dt=Math.min(.05,(now-previous)/1000);previous=now;const before=this.camera.matrixWorld.clone();this.controls.update(dt);this.camera.updateMatrixWorld();this.playback.update(dt);if(this.dirty||!before.equals(this.camera.matrixWorld)){this.cameraPresentations.update();this.updateLighting();this.grid.update(this.camera,this.renderer.getPixelRatio());this.displayMaterials.render(this.content,()=>this.renderer.render(this.scene,this.camera));this.shotRenderer?.render();this.dirty=false;}});
  }
  async initialize(){
    this.loadStatus='loading';this.loadError=null;this.onChange?.('loading');
    try{if(this.saved.asset){const gltf=await loadSaved(this.saved.asset);if(this.closed){disposeModel(gltf.scene);return;}for(const child of gltf.scene.children.slice())this.content.add(child);this.animations=gltf.animations;this.resetMixer();this.assignIds();}this.syncShots();if(this.playback.selectedMotion())this.playback.select(this.motionIndex,'camera',{play:false});this.loadStatus='ready';this.dirty=true;this.onChange?.('scene');}
    catch(error){this.loadStatus='error';this.loadError=error;this.onChange?.('load-error');throw error;}
  }
  assertReady(){if(this.exporting)throw Error('视频正在导出，请等待完成');if(this.closed||this.loadStatus!=='ready')throw Error('场景尚未加载，未修改保存的数据');}
  assertTargetNode(){const node=window.CanvasApp.getState().nodes.find(value=>value.id===this.nodeId);if(node!==this.hostNode||node?.type!=='studio'||node.studio&&!node.studioV2)throw Error('目标片场节点已删除、替换或切换版本，未写入结果');return node;}
  resetMixer(){this.playback.stop();}
  syncShots(){const cameras=this.objects().filter(o=>o.kind==='camera');if(!cameras.some(o=>o.id===this.shotId))this.shotId=cameras[0]?.id||null;if(!this.playback.selectedMotion())this.motionIndex=-1;}
  selectShot(id){this.assertReady();if(!this.find(id)?.isCamera)throw Error('镜头不存在');if(this.shotId===id)return;this.motion.close(false);this.playback.stop();this.shotId=id;this.motionIndex=-1;this.commit();}
  selectMotion(index,cameraId=this.shotId){this.assertReady();const info=this.playback.catalog().find(clip=>clip.index===index&&clip.cameraIds.includes(cameraId));if(!info)throw Error('镜头或运镜不存在');if(this.motionIndex===index&&this.shotId===cameraId){this.playback.toggleMotion();return;}if(this.motion.open){this.motion.start(index,cameraId);this.playback.toggleMotion();return;}this.playback.stop();this.shotId=cameraId;this.motionIndex=index;this.playback.select(index,'camera');this.commit();}
  setShotRatio(ratio,{cameraId=this.shotId,history=true,notify=true}={}){this.assertReady();if(!this.find(cameraId)?.isCamera)throw Error('请先选择有效拍摄镜头');const next=validateViewport(ratio),previous=this.shotRatios[cameraId]||null;if(next===null&&previous===null||next&&previous&&next.width===previous.width&&next.height===previous.height)return;if(history)this.recordHistory(this.snapshot());if(next)this.shotRatios[cameraId]=next;else delete this.shotRatios[cameraId];if(notify)this.commit();else this.dirty=true;}
  // One document history keeps object edits and motion edits in their actual chronological order.
  snapshot(){const motion=this.motion;return {content:this.playback.document().toJSON(),animations:this.animations.map(clip=>clip.clone()),grid:this.grid.visible,lighting:{...this.lighting},shotId:this.shotId,motionIndex:this.motionIndex,shotRatios:{...this.shotRatios},selectedId:this.selected?.userData.studioId||null,motion:{cameraId:motion.cameraId,index:motion.index,selected:motion.selected,mode:motion.mode,open:motion.open,time:this.playback.time,playback:this.playback.target==='camera'&&this.playback.index===motion.index}};}
  updateLighting(){
    const box=new THREE.Box3().setFromObject(this.content),radius=box.getSize(new THREE.Vector3()).length()*.5;
    this.sun.castShadow=!box.isEmpty()&&Number.isFinite(radius);const extent=Math.max(radius*1.05,.001);
    if(!box.isEmpty())box.getCenter(this.sun.target.position);
    const direction=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-this.lighting.elevation),THREE.MathUtils.degToRad(this.lighting.azimuth));
    this.sun.position.copy(this.sun.target.position).addScaledVector(direction,extent*2);
    Object.assign(this.sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:extent*.5,far:extent*3.5});this.sun.shadow.normalBias=extent/this.sun.shadow.mapSize.x;this.sun.shadow.camera.updateProjectionMatrix();
  }
  setLighting(patch,{history=true,notify=true}={}){this.assertReady();const next=validateLighting(this.lighting,patch);if(next.azimuth===this.lighting.azimuth&&next.elevation===this.lighting.elevation)return;if(history)this.recordHistory(this.snapshot());this.lighting=next;if(notify)this.commit();else this.dirty=true;}
  assignIds(){this.content.traverse(o=>{if(o!==this.content){o.userData.studioId||=crypto.randomUUID();if(o.isMesh)o.castShadow=o.receiveShadow=true;}});}
  objects(){const objects=[];this.content.traverse(o=>{if(o!==this.content)objects.push({id:o.userData.studioId,name:o.name||'对象',kind:o.isCamera?'camera':o.isMesh?'model':'group',position:o.position.toArray(),rotation:o.rotation.toArray().slice(0,3).map(THREE.MathUtils.radToDeg),scale:o.scale.toArray(),parentId:o.parent===this.content?null:o.parent?.userData.studioId,visible:o.visible});});return objects;}
  read(){return {version:2,nodeId:this.nodeId,sessionId:this.sessionId,revision:this.revision,savedRevision:this.savedRevision,history:{canUndo:this.undoStack.length>0,canRedo:this.redoStack.length>0},supportedImportFormats:['glb'],supportedImportSources:['canvas-world-resource'],supportedEnvironmentProperties:['ground.grid','lighting.azimuth','lighting.elevation'],capabilities:['read','add','update','delete','select','undo','redo','import','camera','capture','keyframe','playback','environment','motion','motion-export'],supportedMotionActions:[...supportedMotionActions],supportedExportModes:['motion-video'],supportedCameraProperties:[...supportedCameraProperties],supportedLightingProperties:[...supportedLightingProperties],cameraSettings:cameraSettings(this),lightingUnits:'degrees',defaultLighting:{...defaultLighting},supportedKeyframeKinds:['camera','model','bone','light','renderable-group'],objects:this.objects(),playback:playbackState(this),selectedId:this.selected?.userData.studioId||null,animations:describeKeyframes(this),grid:this.grid.visible,lighting:{...this.lighting},shotId:this.shotId,motionIndex:this.motionIndex,shotRatios:{...this.shotRatios},viewer:{position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray()}};}
  find(id){let result;this.content.traverse(o=>{if(o.userData.studioId===id)result=o;});return result;}
  recordHistory(snapshot){this.undoStack.push(snapshot);if(this.undoStack.length>30)this.undoStack.shift();this.redoStack=[];}
  beginEdit(){this.assertReady();this.recordHistory(this.snapshot());this.motion.close(false);this.playback.stop();}
  beginTransformGesture(){this.assertReady();const snapshot=this.snapshot();this.motion.close(false);this.playback.stop();const object=this.selected;if(!object)return;object.updateMatrix();this.transformGesture={snapshot,object,matrix:object.matrix.clone()};}
  endTransformGesture(){const gesture=this.transformGesture;this.transformGesture=null;if(!gesture||gesture.object!==this.selected)return;gesture.object.updateMatrix();if(gesture.matrix.elements.every((value,index)=>Math.abs(value-gesture.object.matrix.elements[index])<=1e-12))return;this.recordHistory(gesture.snapshot);this.commit();}
  commit(){this.revision++;this.dirty=true;this.onChange?.('scene');clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.flush().catch(this.onError),500);}
  async flush(){
    if(this.loadStatus!=='ready')return;if(this.saving)return this.saving;
    this.saving=(async()=>{
      this.assertTargetNode();
      while(this.savedRevision!==this.revision){
        const revision=this.revision,blob=await exportGlb(this.playback.document(),this.animations);
        this.assertTargetNode();if(revision!==this.revision)continue;
        const asset=await window.LocalAssets.put(blob);
        this.assertTargetNode();if(revision!==this.revision)continue;
        this.saved={version:2,asset,grid:this.grid.visible,lighting:{...this.lighting},shotId:this.shotId,motionIndex:this.motionIndex,shotRatios:{...this.shotRatios},viewer:this.read().viewer};
        // The canvas host updates this node in place. Undo restores a new object,
        // so the old runtime must never follow a replacement with the same ID.
        window.CanvasApp.updateNode(this.nodeId,{studioV2:this.saved});this.assertTargetNode();
        if(window.CanvasApp.saveProject)await window.CanvasApp.saveProject();else await window.CanvasStore.flush();
        this.assertTargetNode();this.savedRevision=revision;this.onChange?.('saved');
      }
    })();
    try{await this.saving;this.saveError=null;this.onChange?.('saved');}
    catch(error){this.saveError=error;this.onChange?.('save-error');throw error;}
    finally{this.saving=null;}
  }
  async add(kind,properties={}){let object;if(kind==='camera'){object=new THREE.PerspectiveCamera(50,16/9,.01,1000);object.name=properties.name||'镜头';}else if(kind==='model'){const gltf=await loadSaved(properties.modelUrl||properties.sourceUrl||properties.url);return this.addObject(gltf.scene,properties,gltf.animations);}else if(['actor','tree'].includes(kind)){const gltf=await loadSaved('/assets/studio/'+(kind==='actor'?'character':'tree')+'.glb');return this.addObject(gltf.scene,properties,gltf.animations);}else if(!['cube','sphere','pyramid','cylinder','cone'].includes(kind))throw Error('不支持的对象类型：'+kind);else object=primitive(kind,properties.name||{cube:'立方体',sphere:'球体',pyramid:'四棱锥'}[kind]||kind);return this.addObject(object,properties);}
  async addObject(object,properties={},clips=[],{beforeApply}={}){
    this.assertReady();
    beforeApply?.();
    object.name=properties.name||object.name;for(const [key,field] of [['position','position'],['scale','scale']])if(properties[key])object[field].fromArray(properties[key]);if(properties.rotation)object.rotation.set(...properties.rotation.map(THREE.MathUtils.degToRad));
    // Validate the combined payload before modifying the authoritative scene.
    const revision=this.revision,staging=new THREE.Group();staging.add(this.playback.document(),cloneDocument(object));await exportGlb(staging,[...this.animations,...clips]);if(this.closed)throw Error('片场已关闭');if(revision!==this.revision)throw Error('场景已被更新，本次未导入。请重试。');this.assertReady();
    beforeApply?.();this.beginEdit();this.content.add(object);this.animations.push(...clips);this.assignIds();this.resetMixer();this.syncShots();this.focus(this.content);this.select(object);this.commit();try{await this.flush();}catch(error){error.applied=true;throw error;}return {id:object.userData.studioId};
  }
  async importPrepared(prepared,index){const scene=prepared.loaded.scenes[index];if(!scene?.children.length)throw Error('所选场景没有可导入的节点。');return this.addObject(scene,{},prepared.loaded.animations);}
  select(value){this.motion.close(false);if(this.exporting)throw Error('视频正在导出，请等待完成');this.playback.stop();const object=typeof value==='string'?this.find(value):value;this.selected=object||null;if(object?.isCamera&&this.shotId!==object.userData.studioId){this.shotId=object.userData.studioId;this.motionIndex=-1;}this.transform.detach();this.centeredTransform.detach();if(object){if(!this.animatedCamera(object)){this.centeredTransform.attach(object);this.transform.attach(this.centeredTransform.pivot);}this.box.setFromObject(object);}else this.box.visible=false;this.dirty=true;this.onChange?.('selection');}
  animatedCamera(object){return !!object?.isCamera&&this.playback.catalog().some(clip=>clip.cameraIds.includes(object.userData.studioId));}
  setMode(mode){this.assertReady();if(this.motion.open){this.motion.setMode(mode);return;}this.mode=mode;this.transform.setMode(mode);this.dirty=true;this.onChange?.('selection');}
  update(id,patch,{history=true,notify=true}={}){const object=this.find(id);if(!object)throw Error('对象不存在');const unsupported=Object.keys(patch).filter(key=>!['name','position','rotation','scale','visible'].includes(key));if(this.animatedCamera(object)&&['position','rotation','scale'].some(field=>patch[field]!==undefined))throw Error('镜头包含运镜，请通过关键帧编辑姿态');if(unsupported.length)throw Error('这些属性尚未接入 3D 片场 2.0：'+unsupported.join(', '));if(history)this.beginEdit();if(patch.name!==undefined)object.name=patch.name;if(patch.position)object.position.fromArray(patch.position);if(patch.rotation)object.rotation.set(...patch.rotation.map(THREE.MathUtils.degToRad));if(patch.scale)object.scale.fromArray(patch.scale);if(patch.visible!==undefined)object.visible=patch.visible;object.updateMatrixWorld(true);if(this.selected){this.box.setFromObject(this.selected);this.centeredTransform.attach(this.selected);}if(notify)this.commit();else this.dirty=true;return this.objects().find(o=>o.id===id);}
  remove(id){this.assertReady();const object=this.find(id);if(!object)throw Error('对象不存在');const plan=planSceneRemoval(this.content,object,this.animations);this.beginEdit();this.select(null);object.removeFromParent();this.animations=plan.animations;this.motionIndex=plan.indices.get(this.motionIndex)??-1;this.motion.index=plan.indices.get(this.motion.index)??-1;for(const removedId of plan.removedIds)delete this.shotRatios[removedId];disposeModel(object,{retain:this.content});this.syncShots();this.commit();return {deleted:id};}
  async undo(redo=false,{beforeApply}={}){
    this.assertReady();if(this.restoring)return;const source=redo?this.redoStack:this.undoStack,target=redo?this.undoStack:this.redoStack;if(!source.length)return;this.restoring=true;
    const revision=this.revision,snapshot=source.at(-1);try{const restored=await new THREE.ObjectLoader().parseAsync(snapshot.content);if(this.closed||revision!==this.revision){disposeModel(restored);throw Error('场景已更新，请重新撤销');}
      try{beforeApply?.();}catch(error){disposeModel(restored);throw error;}
      target.push(this.snapshot());source.pop();this.select(null);this.resetMixer();this.content.removeFromParent();disposeModel(this.content);this.content=restored;this.scene.add(restored);this.animations=snapshot.animations.map(clip=>clip.clone());this.grid.visible=snapshot.grid;this.lighting={...snapshot.lighting};this.shotId=snapshot.shotId;this.motionIndex=snapshot.motionIndex??-1;this.shotRatios={...snapshot.shotRatios};this.resetMixer();this.assignIds();this.syncShots();this.select(snapshot.selectedId);this.motion.restoreContext(snapshot.motion);this.commit();
    }finally{this.restoring=false;}
  }
  focusView(){this.renderer.domElement.focus({preventScroll:true});}
  focus(object){const box=new THREE.Box3().setFromObject(object);const center=box.isEmpty()?object.getWorldPosition(new THREE.Vector3()):box.getCenter(new THREE.Vector3()),radius=Math.max(.5,box.getBoundingSphere(new THREE.Sphere()).radius),fov=Math.min(THREE.MathUtils.degToRad(this.camera.fov),2*Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2)*this.camera.aspect)),distance=radius/Math.sin(fov/2)*1.15;this.camera.position.copy(center).add(new THREE.Vector3(1,.6,1).normalize().multiplyScalar(distance));this.camera.lookAt(center);this.camera.near=Math.max(.001,radius/1000);this.camera.far=Math.max(1000,distance*100);this.camera.updateProjectionMatrix();this.controls.speed=Math.max(.1,radius);this.dirty=true;}
  playAnimation(index){this.assertReady();this.motion.close();if(this.playback.index===index&&this.playback.target==='objects')this.playback.toggle();else this.playback.select(index,'objects');}
  setGrid(value,{history=true,notify=true}={}){this.assertReady();if(typeof value!=='boolean')throw Error('地面网格必须为布尔值');if(this.grid.visible===value)return;if(history)this.recordHistory(this.snapshot());this.grid.visible=value;if(notify)this.commit();else this.dirty=true;}
  async importModel(args,options={}){return importSceneModel(this,args,options);}
  async redoScene(args,options={}){return redoScene(this,args,options);}
  controlPlayback(args){return controlScenePlayback(this,args);}
  async updateSettings(id,patch){return updateSceneSettings(this,id,patch);}
  async environmentSettings(args){return updateSceneEnvironment(this,args);}
  async keyframe(args){return saveSceneKeyframe(this,args);}
  async controlMotion(args){return controlSceneMotion(this,args);}
  async exportMotion(args={},onProgress=()=>{},options={}){return exportSceneMotion(this,args,onProgress,options);}
  async capture(){return captureScene(this);}
  async export(){await this.flush();return exportGlb(this.playback.document(),this.animations);}
  async close(){clearTimeout(this.saveTimer);if(this.closed)return;if(this.exporting)throw Error('视频正在导出，请等待完成');if(this.loadStatus==='ready'){if(JSON.stringify(this.saved.viewer)!==JSON.stringify(this.read().viewer))this.revision++;await this.flush();}this.closed=true;this.abort.abort();this.resize.disconnect();this.renderer.setAnimationLoop(null);this.shotRenderer?.dispose();this.controls.dispose();this.motion.dispose();this.cameraPresentations.dispose();this.centeredTransform.dispose();this.resetMixer();this.transform.dispose();this.box.dispose();this.grid.dispose();this.displayMaterials.dispose();disposeModel(this.content);this.sun.shadow.dispose();this.renderer.dispose();}
}
