import * as THREE from 'three';
import {buildPickingCase,pickingCases} from './picking-scenes.mjs';
import {Navigation} from '../navigation.mjs';
import {CameraPresentations} from '../camera-presentations.mjs';
import {disposeModel} from '../model-io.mjs';

const fixture=window.StudioPickingFixture,panel=document.createElement('aside'),targets=document.createElement('div');
panel.className='picking-qa';panel.ariaLabel='真实 GPU 拾取 QA';targets.className='picking-targets';targets.ariaHidden='true';document.body.append(panel,targets);
const heading=document.createElement('h2');heading.textContent='真实 GPU 拾取 · 隔离 QA';
const explanation=document.createElement('p');explanation.textContent='准备按钮不选择对象。请点击黄色十字中心；实际 ID 只读正式 runtime selection。细线需要精确命中像素。';
const choices=document.createElement('select');choices.ariaLabel='拾取检查分组';for(const [key,label]of pickingCases){const option=document.createElement('option');option.value=key;option.textContent=label;choices.append(option);}
const projection=document.createElement('select');projection.ariaLabel='QA 投影';for(const [key,label]of [['perspective','透视 · z=10 / fov=32°'],['orthographic','正交 · ±3 高度']]){const option=document.createElement('option');option.value=key;option.textContent=label;projection.append(option);}
const controls=document.createElement('div'),table=document.createElement('table'),status=document.createElement('p'),output=document.createElement('pre');status.role='status';output.ariaLabel='GPU 拾取实际诊断';
panel.append(heading,explanation,choices,projection,controls,status,table,output);
let nodeId=null,runtime=null,currentCase=null,samples=[],observations=[],pickerErrors=[],lineAlignment=[],pending=null,error='',release=null,hideMarkers=false,preparing=false,recordReadback=false;
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const selected=()=>runtime?.selected?.userData?.studioId||null;
function diagnostics(){
 const rt=runtime,renderer=rt?.renderer,gl=renderer?.getContext(),debug=gl?.getExtension('WEBGL_debug_renderer_info'),size=renderer?.getDrawingBufferSize(new THREE.Vector2());
 return {namespace:fixture.namespace,synthetic:true,recordReadback,fixturePersistence:'isolated Three JSON; does not validate product GLB saving',case:currentCase,projection:projection.value,three:THREE.REVISION,browser:navigator.userAgent,devicePixelRatio,rendererPixelRatio:renderer?.getPixelRatio(),drawingBuffer:size?.toArray(),gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),runtimePickerInstalled:!!rt?.picker,selectedId:selected(),runtimeRevision:rt?.revision,closed:rt?.closed,playback:{playing:rt?.playback.playing,time:rt?.playback.time,index:rt?.playback.index},lineAlignment,pending,observations:observations.slice(-12),pickerErrors,externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,errors:fixture.errors,error};
}
function projected(sample){
 if(!runtime||runtime.closed)return null;const canvas=runtime.renderer.domElement,r=canvas.getBoundingClientRect();runtime.camera.updateMatrixWorld(true);
 const position=new THREE.Vector3(...(sample.follow?.point||sample.point));
 if(sample.follow){const object=runtime.find(sample.follow.id);if(!object)return null;object.updateWorldMatrix(true,false);position.applyMatrix4(object.matrixWorld);}
 const point=position.project(runtime.camera),offset=sample.pixelOffset||[0,0];
 const projectedX=r.left+(point.x+1)*r.width/2+offset[0],projectedY=r.top+(1-point.y)*r.height/2+offset[1];
 return {x:sample.integerPointerPixel?Math.floor(projectedX):projectedX,y:sample.integerPointerPixel?Math.floor(projectedY):projectedY,...sample.integerPointerPixel?{projectedX,projectedY}:{},visible:point.z>=-1&&point.z<=1&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1};
}
function refresh(){
 const rows=[make('tr')];rows[0].append(make('th','真实点击目标'),make('th','预期 ID'),make('th','屏幕 x,y'));
 targets.replaceChildren();
 for(const sample of samples){const position=projected(sample),row=make('tr');row.append(make('td',sample.name),make('td',sample.expectedId||'null'),make('td',position?Math.round(position.x)+','+Math.round(position.y):'—'));rows.push(row);
  if(position?.visible&&!hideMarkers&&runtime&&!runtime.closed){const marker=make('div');marker.className='picking-target';marker.style.left=position.x+'px';marker.style.top=position.y+'px';marker.append(make('span',sample.name));targets.append(marker);}}
 table.replaceChildren(...rows);output.textContent=JSON.stringify(diagnostics(),null,2);status.textContent=error?'准备失败：'+error:runtime?.closed?'片场已关闭；保留诊断用于核对迟到结果':currentCase?'场景来自隔离 IDB JSON 回读。等待真实视口点击。':'请选择分组并准备场景。';
}
function button(label,run){const b=make('button',label);b.type='button';b.onclick=async()=>{b.disabled=true;error='';try{await run();}catch(cause){error=cause.message;}finally{b.disabled=false;refresh();}};controls.append(b);return b;}
function alignThinLines(){
 if(currentCase!=='lines-points'||!runtime||runtime.closed)throw Error('请先准备第 05 组');
 const rt=runtime,canvas=rt.renderer.domElement,rect=canvas.getBoundingClientRect();rt.camera.updateMatrixWorld(true);rt.content.updateMatrixWorld(true);
 const matrix=new THREE.Matrix4().multiplyMatrices(rt.camera.projectionMatrix,rt.camera.matrixWorldInverse).elements;lineAlignment=[];
 for(const id of ['qa-line','qa-dashed']){
  const object=rt.find(id),sample=samples.find(value=>value.expectedId===id),before=projected(sample),clickY=Math.floor(before.projectedY??before.y);
  // Match the physical pixel read by an integer CSS pointer. At DPR 2 and an
  // integer canvas origin its center is clickY + .25, not the unreachable .5.
  const pixelY=Math.floor((clickY-rect.top)*canvas.height/rect.height),centerY=rect.top+(pixelY+.5)*rect.height/canvas.height,ndcY=1-2*(centerY-rect.top)/rect.height;
  const [x,y,z]=sample.point,denominator=matrix[5]-ndcY*matrix[7];if(Math.abs(denominator)<1e-10)throw Error('当前视角无法沿世界 Y 对齐细线');
  const alignedY=(ndcY*(matrix[3]*x+matrix[11]*z+matrix[15])-(matrix[1]*x+matrix[9]*z+matrix[13]))/denominator,deltaY=alignedY-y;
  const origin=object.getWorldPosition(new THREE.Vector3()),destination=origin.clone();destination.y+=deltaY;object.parent.worldToLocal(destination);object.position.copy(destination);object.updateWorldMatrix(true,false);
  const related=id==='qa-line'?[sample]:samples.filter(value=>value.expectedId===id||value.name==='虚线空档');
  for(const value of related){value.point[1]+=deltaY;value.point[2]=z;value.integerPointerPixel=true;}
  lineAlignment.push({id,deltaWorldY:deltaY,beforeY:before.projectedY??before.y,projectedY:centerY,clickY,physicalRowFromTop:pixelY,rendererPixelRatio:rt.renderer.getPixelRatio()});
 }
 rt.revision++;rt.savedRevision=rt.revision;rt.dirty=true;
}
function configureCamera(rt){
 const canvas=rt.renderer.domElement,rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 rt.controls.dispose();
 rt.camera=projection.value==='orthographic'?new THREE.OrthographicCamera(-3*aspect,3*aspect,3,-3,.01,100):new THREE.PerspectiveCamera(32,aspect,.01,100);
 rt.camera.position.set(0,0,10);rt.camera.lookAt(0,0,0);rt.camera.updateProjectionMatrix();rt.camera.updateMatrixWorld(true);
 rt.controls=new Navigation(rt.camera,canvas);rt.transform.camera=rt.camera;rt.grid.visible=false;rt.dirty=true;
 // Synthetic camera arrangement is not an edit through the product camera UI.
 // Keep close/save from pretending these probes are imported user models.
 rt.saved.viewer=structuredClone(rt.read().viewer);
}
function observe(rt){
 const original=rt.onChange,originalError=rt.onError,abort=new AbortController(),canvas=rt.renderer.domElement;
 rt.onError=cause=>{originalError?.(cause);pickerErrors.push(cause.message||String(cause));refresh();};
 rt.onChange=reason=>{original?.(reason);if(reason==='selection'){
  const request=pending;pending=null;
  observations.push({case:currentCase,origin:request?'canvas-pointer':'non-pointer selection',request,actualId:selected(),expectedId:request?.expectedId,match:request?.targetName?selected()===request.expectedId:null,playbackAfter:{playing:rt.playback.playing,time:rt.playback.time},elapsedMs:request?Math.round(performance.now()-request.started):null});refresh();}
 };
 canvas.addEventListener('pointerup',event=>{
  if(preparing||rt.closed)return;const rect=canvas.getBoundingClientRect();let nearest=null,distance=Infinity;
  for(const sample of samples){const position=projected(sample);if(!position?.visible)continue;const d=Math.hypot(event.clientX-position.x,event.clientY-position.y);if(d<distance){distance=d;nearest=sample;}}
  pending={sequence:observations.length+1,started:performance.now(),trusted:event.isTrusted,client:[event.clientX,event.clientY],uv:[(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height],targetName:distance<=12?nearest.name:null,expectedId:distance<=12?nearest.expectedId:undefined,distancePx:Number(distance.toFixed(2)),selectedBefore:selected(),playbackBefore:{playing:rt.playback.playing,time:rt.playback.time}};refresh();
 },{capture:true,signal:abort.signal});
 release=()=>{abort.abort();rt.onChange=original;rt.onError=originalError;};
}
async function prepare(){
 if(preparing)throw Error('正在准备场景');preparing=true;
 try{
  const app=window.CanvasApp;if(!app||!window.StudioAPI)throw Error('请等待主画布初始化');
  await app.saveProject();release?.();release=null;
  if(window.StudioAPI.active)await window.StudioAPI.active.close();
  const built=buildPickingCase(choices.value),recordKey='agent-studio-picking-fixture:'+built.key;
  const record={version:1,case:built.key,scene:built.root.toJSON(),clips:built.clips.map(clip=>clip.toJSON()),samples:built.samples};
  await window.CanvasStore.readRecord(recordKey);await window.CanvasStore.writeRecord(recordKey,record);await window.CanvasStore.flush();
  const saved=await window.CanvasStore.readRecord(recordKey);if(saved?.case!==built.key||!saved.scene)throw Error('合成场景 IDB 回读失败');
  const scene=await new THREE.ObjectLoader().parseAsync(saved.scene);disposeModel(built.root);
  let node=app.getState().nodes.find(value=>value.id===nodeId)||app.getState().nodes.find(value=>value.title==='QA · GPU 拾取');
  if(!node){node=app.addNode('studio',{x:480,y:200},null,'QA · GPU 拾取',{studioV2:{version:2,grid:false}});await app.saveProject();}nodeId=node.id;
  const instance=await window.StudioAPI.open(node.id),rt=instance.runtime;rt.assertReady();
  disposeModel(rt.content);rt.content.removeFromParent();rt.content=scene;rt.scene.add(scene);rt.animations=saved.clips.map(clip=>THREE.AnimationClip.parse(clip));rt.resetMixer();rt.assignIds();rt.syncShots();
  rt.cameraPresentations.dispose();rt.cameraPresentations=new CameraPresentations(rt);rt.revision++;rt.savedRevision=rt.revision;
  configureCamera(rt);rt.content.updateMatrixWorld(true);rt.content.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.update();});rt.cameraPresentations.update();rt.onChange?.('scene');rt.dirty=true;
  runtime=rt;currentCase=saved.case;samples=saved.samples;observations=[];pickerErrors=[];lineAlignment=[];pending=null;recordReadback=true;observe(rt);
  if(currentCase==='camera-helper'){
   const guide=rt.cameraPresentations.get(rt.find('qa-camera'))?.children.at(-1),attribute=guide?.geometry?.attributes.position;
   if(!guide?.isLineSegments||!attribute)throw Error('实际相机辅助线未构造');
   guide.updateWorldMatrix(true,false);const midpoint=new THREE.Vector3().fromBufferAttribute(attribute,2).add(new THREE.Vector3().fromBufferAttribute(attribute,3)).multiplyScalar(.5).applyMatrix4(guide.matrixWorld);
   samples.find(sample=>sample.name==='相机轮廓（实际辅助线）').point=midpoint.toArray();
  }
 }finally{preparing=false;}
}
button('准备分组场景（不选择）',prepare);
button('播放 / 重播合成动画',()=>{if(currentCase!=='animated'||!runtime||runtime.closed)throw Error('请先准备第 09 组');runtime.playAnimation(0);});
button('DPR 1',()=>{if(!runtime||runtime.closed)throw Error('请先准备');runtime.renderer.setPixelRatio(1);const r=runtime.renderer.domElement.getBoundingClientRect();runtime.renderer.setSize(r.width,r.height,false);runtime.dirty=true;});
button('DPR 2',()=>{if(!runtime||runtime.closed)throw Error('请先准备');runtime.renderer.setPixelRatio(2);const r=runtime.renderer.domElement.getBoundingClientRect();runtime.renderer.setSize(r.width,r.height,false);runtime.dirty=true;});
button('将细线对齐整数指针像素',alignThinLines);
button('刷新坐标 / 诊断',refresh);button('十字标记显隐',()=>{hideMarkers=!hideMarkers;});
button('收起 QA',()=>{for(const element of [heading,explanation,choices,projection,controls,status,table,output])element.hidden=true;expand.hidden=false;panel.style.width='auto';});
const expand=make('button','展开 GPU 拾取 QA');expand.hidden=true;expand.onclick=()=>{for(const element of [heading,explanation,choices,projection,controls,status,table,output])element.hidden=false;expand.hidden=true;panel.style.width='';refresh();};panel.append(expand);
window.addEventListener('resize',()=>{if(runtime?.camera.isOrthographicCamera){const r=runtime.renderer.domElement.getBoundingClientRect();runtime.camera.left=-3*r.width/Math.max(1,r.height);runtime.camera.right=3*r.width/Math.max(1,r.height);runtime.camera.updateProjectionMatrix();runtime.dirty=true;}refresh();});
window.addEventListener('pagehide',()=>release?.(),{once:true});
const timer=setInterval(()=>{if(currentCase==='animated'&&runtime&&!runtime.closed&&runtime.playback.playing)refresh();},100);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
window.StudioPickingQA={refresh,read:diagnostics,coordinates:()=>samples.map(sample=>({...sample,...projected(sample)}))};refresh();
