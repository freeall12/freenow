import * as THREE from 'three';
import {createFocusNavigationSpeedModel} from './focus-navigation-speed-model.mjs';
import {exportGlb,disposeModel} from '../model-io.mjs';
import {classes as c} from '../classes.mjs';
const fixture=window.StudioFocusNavigationSpeedFixture,panel=document.createElement('aside'),heading=document.createElement('h2'),instructions=document.createElement('p'),actions=document.createElement('div'),output=document.createElement('pre');
panel.ariaLabel='片场聚焦导航速度 QA';panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:3000;background:#202226;color:#eee;padding:10px;width:365px;max-height:40vh;overflow:auto;font:12px system-ui;border:1px solid #666';
heading.textContent='真实片场 · 聚焦与导航速度';instructions.textContent='准备片场后先正式查看全景并记录基线；依次正式树选择小物体、大布景、镜头，检查导航speed保持整场值。按F或点击对象聚焦也保持速度。查看全景恢复整场取景与sceneRadius速度。诊断记录真实世界相机、near/far、导航速度、原对象数据和历史。';output.ariaLabel='聚焦导航真实数据回执';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';panel.append(heading,instructions,actions,output);document.body.append(panel);
const active=()=>window.StudioAPI?.active?.runtime;
let nodeId=null,error='',baseline=null,lastReceipt=null;
function data(){const runtime=active();return {revision:runtime?.revision,savedRevision:runtime?.savedRevision,undo:runtime?.undoStack.length,redo:runtime?.redoStack.length,speed:runtime?.controls.speed,
  sceneRadius:runtime?Math.max(.5,new THREE.Box3().setFromObject(runtime.content).getSize(new THREE.Vector3()).length()/2):null,
  selected:runtime?.selected?.userData.studioId||null,viewer:runtime?{position:runtime.camera.position.toArray(),quaternion:runtime.camera.quaternion.toArray(),near:runtime.camera.near,far:runtime.camera.far,aspect:runtime.camera.aspect,fov:runtime.camera.fov}:null,
  objects:runtime?.objects().map(object=>({id:object.id,position:object.position,rotation:object.rotation,scale:object.scale})),focus:document.activeElement?.getAttribute('aria-label'),loadStatus:runtime?.loadStatus};}
function read(){return {namespace:fixture.namespace,nodeId,synthetic:true,baseline,lastReceipt,current:data(),externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,error};}
function refresh(){output.textContent=JSON.stringify(read(),null,2);}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:5px';b.onclick=async()=>{b.disabled=true;error='';try{await fn();}catch(cause){error=cause.message;}finally{b.disabled=false;refresh();}};actions.append(b);return b;}
function wholeScene(){const b=document.querySelector('.studio-v2-root button[aria-label="查看全景"]');if(!b)throw Error('找不到正式查看全景入口');b.click();}
function select(id){const settings=document.querySelector('.studio-v2-root section[aria-label="片场设置"]');[...(settings?.querySelectorAll('.'+c.panelTab)||[])].find(b=>b.textContent==='场景')?.click();const b=settings?.querySelector('.'+c.treeSelect+'[data-object-id="'+id+'"]');if(!b)throw Error('找不到正式对象树入口');b.click();}
button('准备并打开真实片场',async()=>{const app=window.CanvasApp;await app.saveProject();let node=app.getState().nodes.find(n=>n.id===nodeId)||app.getState().nodes.find(n=>n.title==='QA 聚焦导航速度');
  if(!node){const model=createFocusNavigationSpeedModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}const asset=await window.LocalAssets.put(blob);node=app.addNode('studio',{x:480,y:180},null,'QA 聚焦导航速度',{studioV2:{version:2,asset,shotId:'qa-focus-camera',motionIndex:-1,grid:true}});await app.saveProject();}nodeId=node.id;await window.StudioAPI.open(nodeId);if(active()?.loadStatus!=='ready')throw Error('真实片场尚未就绪');wholeScene();});
button('正式查看全景',wholeScene);button('正式树选择小物体',()=>select('qa-focus-small'));button('正式树选择大布景',()=>select('qa-focus-large'));button('正式树选择镜头',()=>select('qa-focus-camera'));
button('记录速度与数据基线',()=>{baseline=data();lastReceipt=null;});button('刷新回执',refresh);
button('收起 QA',()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=true;show.hidden=false;panel.style.width='auto';});
const show=document.createElement('button');show.textContent='展开聚焦QA';show.hidden=true;show.onclick=()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=false;show.hidden=true;panel.style.width='365px';refresh();};panel.append(show);
function receipt(event){if(!event.target.closest?.('.studio-v2-root'))return;requestAnimationFrame(()=>{lastReceipt={event:event.type,key:event.key||null,...data()};refresh();});}
for(const type of ['click','keydown'])document.addEventListener(type,receipt,{capture:true});
window.StudioFocusNavigationSpeedQA={read,refresh};refresh();
