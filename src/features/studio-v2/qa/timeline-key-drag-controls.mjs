import {createTimelineKeyDragModel} from './timeline-key-drag-model.mjs';
import {exportGlb,disposeModel} from '../model-io.mjs';
import {classes as c} from '../classes.mjs';
const fixture=window.StudioTimelineKeyDragFixture,panel=document.createElement('aside'),heading=document.createElement('h2'),instructions=document.createElement('p'),actions=document.createElement('div'),output=document.createElement('pre');
panel.ariaLabel='片场关键帧拖动 QA';panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:3000;background:#202226;color:#eee;padding:10px;width:365px;max-height:35vh;overflow:auto;font:12px system-ui;border:1px solid #666';
heading.textContent='真实片场 · 关键帧捕获与身份';instructions.textContent='准备并打开运镜A。拖第2关键帧后松开，检查时间与一笔历史。拖动中Escape应仅取消时间草稿，播放时间保留。可预设下次拖动350ms后切到同名运镜B，松手不得改A/B的轨道。末关键帧可拖至旧duration之外。';output.ariaLabel='关键帧拖动真实数据回执';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';panel.append(heading,instructions,actions,output);document.body.append(panel);
const active=()=>window.StudioAPI?.active?.runtime;
let nodeId=null,error='',baseline=null,lastReceipt=null,switchNext=false;
function data(){const runtime=active(),editor=runtime?.motion;return {revision:runtime?.revision,savedRevision:runtime?.savedRevision,undo:runtime?.undoStack.length,redo:runtime?.redoStack.length,
  motion:editor?.open?{index:editor.index,cameraId:editor.cameraId,selected:editor.selected,times:editor.times}:null,
  playback:runtime?{target:runtime.playback.target,index:runtime.playback.index,time:runtime.playback.time,playing:runtime.playback.playing}:null,
  clips:runtime?.animations.map((clip,index)=>({index,name:clip.name,tracks:clip.tracks.map(track=>({name:track.name,times:Array.from(track.times),values:Array.from(track.values)}))})),
  focus:document.activeElement?.getAttribute('aria-label'),loadStatus:runtime?.loadStatus};}
function read(){return {namespace:fixture.namespace,nodeId,synthetic:true,baseline,lastReceipt,current:data(),externalAttempts:fixture.externalAttempts,blockedAPIs:fixture.blockedAPIs,error,switchNext};}
function refresh(){output.textContent=JSON.stringify(read(),null,2);}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:5px';b.onclick=async()=>{b.disabled=true;error='';try{await fn();}catch(cause){error=cause.message;}finally{b.disabled=false;refresh();}};actions.append(b);return b;}
function edit(index){const settings=document.querySelector('.studio-v2-root section[aria-label="片场设置"]');[...(settings?.querySelectorAll('.'+c.panelTab)||[])].find(b=>b.textContent==='拍摄')?.click();const b=settings?.querySelectorAll('.'+c.clipEdit)[index];if(!b)throw Error('找不到正式运镜入口');b.click();}
button('准备并打开真实片场',async()=>{const app=window.CanvasApp;await app.saveProject();let node=app.getState().nodes.find(n=>n.id===nodeId)||app.getState().nodes.find(n=>n.title==='QA 时间轴身份保护');
  if(!node){const model=createTimelineKeyDragModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}const asset=await window.LocalAssets.put(blob);node=app.addNode('studio',{x:480,y:180},null,'QA 时间轴身份保护',{studioV2:{version:2,asset,shotId:'qa-number-camera',motionIndex:0,grid:true}});await app.saveProject();}nodeId=node.id;await window.StudioAPI.open(nodeId);if(active()?.loadStatus!=='ready')throw Error('真实片场尚未就绪');edit(0);});
button('正式打开运镜 A',()=>edit(0));button('正式打开同名运镜 B',()=>edit(1));
button('记录轨道与历史基线',()=>{baseline=data();lastReceipt=null;});
button('下次拖动350ms后切换同名B',()=>{switchNext=true;});button('刷新回执',refresh);
const hide=button('收起 QA',()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=true;show.hidden=false;panel.style.width='auto';});
const show=document.createElement('button');show.textContent='展开拖动QA';show.hidden=true;show.onclick=()=>{heading.hidden=instructions.hidden=actions.hidden=output.hidden=false;show.hidden=true;panel.style.width='365px';refresh();};panel.append(show);
function receipt(event){if(!event.target.closest?.('.studio-v2-root ._timeline_1m1ec_1'))return;
  if(event.type==='pointerdown'&&event.target.closest('button._key_1aeqb_62')&&switchNext){switchNext=false;setTimeout(()=>{try{edit(1);lastReceipt={event:'switch-motion',...data()};}catch(cause){error=cause.message;}refresh();},350);}
  requestAnimationFrame(()=>{lastReceipt={event:event.type,key:event.key||null,pointerId:event.pointerId||null,...data()};refresh();});}
for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','keydown'])document.addEventListener(type,receipt,{capture:true});
window.StudioTimelineKeyDragQA={read,refresh};refresh();
