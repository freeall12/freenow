import {createNumberFieldModel} from './number-field-model.mjs';
import {exportGlb,disposeModel} from '../model-io.mjs';
import {classes as c} from '../classes.mjs';

const fixture=window.StudioNumberFieldFixture,panel=document.createElement('aside'),heading=document.createElement('h2'),instructions=document.createElement('p'),actions=document.createElement('div'),output=document.createElement('pre');
panel.ariaLabel='片场数字字段 QA';panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:3000;background:#202226;color:#eee;padding:10px;width:365px;max-height:42vh;overflow:auto;font:12px system-ui;border:1px solid #666';
heading.textContent='真实片场 · 数字字段精度';instructions.textContent='准备后操作正式对象/关键帧位置、旋转、缩放：未编辑失焦；输入草稿按 Escape 后再失焦；输入精确值按 Enter。跨轴回归：关键帧位置 X 输入草稿不失焦，再拖位置 Y 的轴标签；X提交一次，Y拖动再提交一次。诊断显示原始数据、revision、历史、焦点与事件处理后的回执。';output.ariaLabel='数字字段真实数据回执';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';panel.append(heading,instructions,actions,output);document.body.append(panel);
const active=()=>window.StudioAPI?.active?.runtime;
let nodeId=null,error='',baseline=null,lastReceipt=null;
const fieldData=element=>element?{tag:element.tagName,label:element.getAttribute('aria-label'),value:element.value}:null;
function data(){
  const runtime=active(),cube=runtime?.find('qa-number-cube'),editor=runtime?.motion;
  return {revision:runtime?.revision,savedRevision:runtime?.savedRevision,undo:runtime?.undoStack.length,redo:runtime?.redoStack.length,
    cube:cube?{position:cube.position.toArray(),rotation:cube.rotation.toArray().slice(0,3),scale:cube.scale.toArray()}:null,
    motion:editor?.open?{selected:editor.selected,time:runtime.playback.time,position:editor.pose(editor.times[editor.selected]??0).elements.slice(12,15),tracks:editor.tracks.map(track=>({name:track.name,times:Array.from(track.times),values:Array.from(track.values)}))}:null,
    activeElement:fieldData(document.activeElement),loadStatus:runtime?.loadStatus};
}
function read(){return {namespace:fixture.namespace,nodeId,synthetic:true,baseline,lastReceipt,current:data(),externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,error};}
function refresh(){output.textContent=JSON.stringify(read(),null,2);}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:5px';b.onclick=async()=>{b.disabled=true;error='';try{await fn();}catch(cause){error=cause.message;}finally{b.disabled=false;refresh();}};actions.append(b);return b;}
function settings(){return document.querySelector('.studio-v2-root section[aria-label="片场设置"]');}
function tab(label){const b=[...(settings()?.querySelectorAll('.'+c.panelTab)||[])].find(b=>b.textContent===label);if(!b)throw Error('请先准备片场');b.click();}
button('准备并打开真实片场',async()=>{
  const app=window.CanvasApp;await app.saveProject();let node=app.getState().nodes.find(n=>n.id===nodeId)||app.getState().nodes.find(n=>n.title==='QA 数字字段精度');
  if(!node){const model=createNumberFieldModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}const asset=await window.LocalAssets.put(blob);node=app.addNode('studio',{x:480,y:180},null,'QA 数字字段精度',{studioV2:{version:2,asset,shotId:'qa-number-camera',motionIndex:0,grid:true}});await app.saveProject();}
  nodeId=node.id;await window.StudioAPI.open(nodeId);if(active()?.loadStatus!=='ready')throw Error('真实片场尚未就绪');
});
button('正式树选择精确立方体',()=>{
  tab('场景');const b=settings().querySelector('.'+c.treeSelect+'[data-object-id="qa-number-cube"]');if(!b)throw Error('找不到正式立方体树控件');b.click();
});
button('正式运镜选择第1关键帧',()=>{
  tab('拍摄');const b=settings().querySelector('.'+c.clipEdit);if(!b)throw Error('找不到正式运镜控件');b.click();
  const key=document.querySelector('.studio-v2-root button[aria-label="运镜 关键帧 1, 0.00 s"]');if(!key)throw Error('找不到正式关键帧控件');key.click();
});
button('记录当前精度与历史基线',()=>{baseline=data();lastReceipt=null;});
button('刷新回执',refresh);
button('收起 QA',()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=true;show.hidden=false;panel.style.width='auto';});
const show=document.createElement('button');show.textContent='展开数字QA';show.hidden=true;show.onclick=()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=false;show.hidden=true;panel.style.width='365px';refresh();};panel.append(show);
function receipt(event){const field=event.target.matches?.('input[type="number"]')?event.target:event.target.closest?.('._field_1i3al_1')?.querySelector('input[type="number"]');if(field?.closest('.studio-v2-root'))requestAnimationFrame(()=>{lastReceipt={event:event.type,key:event.key||null,pointerId:event.pointerId||null,field:fieldData(field),...data()};refresh();});}
for(const type of ['input','keydown','blur','pointerdown','pointerup','pointercancel'])document.addEventListener(type,receipt,{capture:true});
window.StudioNumberFieldQA={read,refresh};refresh();
