import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
export const apertureStops=[1.4,2,2.8,4,5.6,8,11,16,22];
export const opticsFields=['depthOfFieldMode','apertureFNumber','focusDistance','focus'];
export function validateOpticsPatch(patch){
 const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite),distance=value=>Number.isFinite(value)&&value>=.1&&value<=1000;
 if(patch.depthOfFieldMode!==undefined&&!['deepFocus','aperture'].includes(patch.depthOfFieldMode))throw Error('景深模式无效');
 if(patch.apertureFNumber!==undefined&&(!Number.isFinite(patch.apertureFNumber)||patch.apertureFNumber<1.4||patch.apertureFNumber>22))throw Error('光圈必须在 f/1.4 到 f/22 之间');
 if(patch.focusDistance!==undefined&&!distance(patch.focusDistance))throw Error('对焦距离必须在 0.1 到 1000 米之间');
 if(patch.focus!==undefined){const f=patch.focus;
  if(!f||!['distance','point','object'].includes(f.mode)||f.mode==='distance'&&!distance(f.distance)||f.mode==='point'&&!vector(f.target)||f.mode==='object'&&(typeof f.entityId!=='string'||!f.entityId||f.offset!==undefined&&!vector(f.offset)))throw Error('对焦参数不完整');
 }
 return patch;
}
export function optics(value={}){return {depthOfFieldMode:value.depthOfFieldMode||'deepFocus',apertureFNumber:value.apertureFNumber??value.fNumber??11,focusDistance:value.focusDistance??10,focus:structuredClone(value.focus||{mode:'distance',distance:value.focusDistance??10})};}
export function resolveFocus(lens,camera,entities){
 let point;const focus=lens.focus;
 if(focus?.mode==='point')point=new THREE.Vector3().fromArray(focus.target);
 if(focus?.mode==='object'){const root=entities?.get(focus.entityId)?.root;if(root){root.updateWorldMatrix(true,false);point=root.localToWorld(new THREE.Vector3().fromArray(focus.offset||[0,0,0]));}}
 camera.updateMatrixWorld();
 if(point){const depth=-point.applyMatrix4(camera.matrixWorldInverse).z;if(Number.isFinite(depth)&&depth>.1)return depth;}
 return Math.max(.1,Number(focus?.mode==='distance'?focus.distance:lens.focusDistance)||10);
}
export function apertureCoefficient({focal=35,apertureFNumber=11,focusDistance=10,sensorWidth=36}){
 const f=focal/1000,s=Math.max(.1,focusDistance),n=Math.max(1.4,Math.min(22,apertureFNumber));
 // The upstream Bokeh kernel radius is 0.4; convert thin-lens CoC diameter to its UV radius.
 return f*f/(n*Math.max(.001,s-f)*(sensorWidth/1000)*.8);
}
class SceneDepthPass extends BokehPass {
 render(renderer,...args){
  // Scene.background otherwise clears the depth target to the sky color, turning empty space into near geometry.
  const background=this.scene.background;this.scene.background=null;
  try{return super.render(renderer,...args);}finally{this.scene.background=background;}
 }
}
export class DepthOfField {
 constructor(renderer){this.renderer=renderer;}
 render(scene,camera,lens,{width,height,pixelRatio=1,focal=35,frameWidth=width,aspect=camera.aspect,entities}={}){
  if(lens.depthOfFieldMode==='deepFocus'||!camera.isPerspectiveCamera){this.renderer.setRenderTarget(null);this.renderer.render(scene,camera);return;}
  if(!this.composer){this.composer=new EffectComposer(this.renderer);for(const target of [this.composer.renderTarget1,this.composer.renderTarget2])target.samples=Math.min(4,this.renderer.capabilities.maxSamples);this.renderPass=new RenderPass(scene,camera);this.bokeh=new SceneDepthPass(scene,camera,{focus:10,aperture:.01,maxblur:.04});
   // Preserve the mature sampling kernel; use optical depth ratio instead of an unbounded depth difference.
   this.bokeh.materialBokeh.fragmentShader=this.bokeh.materialBokeh.fragmentShader.replace('float factor = ( focus + viewZ );','float factor = ( focus + viewZ ) / max( -viewZ, 0.1 );').replace('getViewZ( getDepth( vUv ) )','getViewZ( clamp( getDepth( vUv ), 0.0, 1.0 ) )');
   this.output=new OutputPass();this.composer.addPass(this.renderPass);this.composer.addPass(this.bokeh);this.composer.addPass(this.output);
  }
  const size=[width,height,pixelRatio].join('/');if(size!==this.size){this.composer.setPixelRatio(pixelRatio);this.composer.setSize(width,height);this.size=size;}
  this.renderPass.scene=this.bokeh.scene=scene;this.renderPass.camera=this.bokeh.camera=camera;
  const distance=resolveFocus(lens,camera,entities),scale=frameWidth/width,sensorWidth=Math.min(aspect>=1?36:24,(aspect>=1?24:36)*aspect);
  this.bokeh.uniforms.focus.value=distance;this.bokeh.uniforms.aperture.value=apertureCoefficient({focal,apertureFNumber:lens.apertureFNumber,focusDistance:distance,sensorWidth})*scale;this.bokeh.uniforms.maxblur.value=.04*scale;
  this.composer.render();
 }
 dispose(){this.bokeh?.dispose();this.output?.dispose();this.composer?.dispose();}
}
export function installOptics(Studio,{el,button}){
 Object.assign(Studio.prototype,{
  setOptics(patch){if(this.playing||this.recorder)throw Error('播放或录制中不能修改对焦参数');validateOpticsPatch(patch);if(!this.cameraEdit)this.remember();this.lens={...this.lens,...structuredClone(patch)};if(patch.focusDistance!==undefined)this.lens.focus={mode:'distance',distance:patch.focusDistance};if(!this.cameraEdit){this.data.viewer.optics=structuredClone(this.lens);this.persist();}const target=this.root.querySelector('[aria-label="对焦目标"]');if(target)target.value=this.lens.focus.mode;this.refreshOptics();},
  refreshOptics(){const aperture=this.root.querySelector('[aria-label="光圈与景深"]');if(aperture)aperture.textContent=this.lens.depthOfFieldMode==='deepFocus'?'全清晰':'f/'+Number(this.lens.apertureFNumber.toFixed(1));const focus=this.root.querySelector('[data-focus-control]');if(focus){focus.setAttribute('aria-pressed',String(!!this.focusPicking));focus.title=this.focusPicking?'点击场景设置焦点':'设置对焦点';focus.querySelector('span').textContent=resolveFocus(this.lens,this.camera,this.entities).toFixed(1)+'m';}},
  opticsPanel(){const p=this.popup('光圈与景深');if(!p)return;const modes=el('div','studio-optics-presets');const deep=button(null,'全清晰',()=>{this.setOptics({depthOfFieldMode:'deepFocus'});this.opticsPanel();},'全清晰');deep.setAttribute('aria-pressed',String(this.lens.depthOfFieldMode==='deepFocus'));modes.append(deep);for(const value of apertureStops){const b=button(null,'f/'+value,()=>{this.setOptics({depthOfFieldMode:'aperture',apertureFNumber:value});this.opticsPanel();},'f/'+value);b.setAttribute('aria-pressed',String(this.lens.depthOfFieldMode==='aperture'&&this.lens.apertureFNumber===value));modes.append(b);}p.append(modes);this.number(p,'对焦距离（米）',Number(resolveFocus(this.lens,this.camera,this.entities).toFixed(2)),.1,1000,.1,v=>{this.setOptics({focusDistance:v});});const tracked=this.lens.focus?.mode==='object';this.selectInput(p,'对焦目标',{'distance':'固定距离',point:'场景焦点',object:'跟随对象'},tracked?'object':this.lens.focus?.mode||'distance',value=>{if(value==='distance'){this.setOptics({focusDistance:resolveFocus(this.lens,this.camera,this.entities)});return;}this.focusPicking=true;this.focusPickMode=value;p.remove();this.refreshOptics();this.notify(value==='object'?'点击要跟随的对象':'点击场景设置焦点');});},
  addOpticsControls(bar){bar.append(button(null,'光圈与景深',()=>this.opticsPanel(),''));const focus=button('target','设置对焦点',()=>{this.focusPicking=!this.focusPicking;this.focusPickMode='point';this.refreshOptics();if(this.focusPicking)this.notify('点击场景设置焦点');});focus.dataset.focusControl='true';focus.append(el('span'));bar.append(focus);this.refreshOptics();},
  pickFocus(event){if(!this.focusPicking)return false;const rect=this.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster(),camera=this.previewCamera||this.camera;camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
   const roots=[...this.entities.values()].filter(item=>item.root.visible).map(item=>item.root);if(this.ground)roots.push(this.ground);if(this.room)roots.push(this.room);const hit=ray.intersectObjects(roots,true)[0];if(!hit){this.notify('此处没有可用的场景表面');return true;}
   let owner=hit.object;while(owner&&!owner.userData.entityId)owner=owner.parent;const id=owner?.userData.entityId;
   if(this.focusPickMode==='object'&&!id){this.notify('请选择角色或物体');return true;}
   const focus=this.focusPickMode==='object'?{mode:'object',entityId:id,offset:owner.worldToLocal(hit.point.clone()).toArray()}:{mode:'point',target:hit.point.toArray()};
   this.lens.focus=focus;this.lens.focusDistance=resolveFocus(this.lens,this.camera,this.entities);this.focusPicking=false;this.setOptics({focus,depthOfFieldMode:'aperture'});this.notify('对焦点已设置');return true;
  },
  renderOptical(scene,camera,{width,height,frameWidth=width,lens=this.lens,focal=this.focal,aspect=this.captureAspect||camera.aspect,entities=this.entities}={}){this.depthRenderer??=new DepthOfField(this.renderer);this.depthRenderer.render(scene,camera,lens,{width,height,frameWidth,aspect,focal,pixelRatio:this.renderer.getPixelRatio(),entities});}
 });
}
