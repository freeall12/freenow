import {optics, opticsFields} from './studio-optics.mjs';
import {trackFrames,buildSegments,sampleTrack,redistributeTimes,moveKey,nearestPathParameter,VIEWER_TRACK} from './studio-timeline.mjs';

export function installTimeline(Studio,{THREE,el,button,copy,icon}){
 Object.assign(Studio.prototype,{
  installPathEditing(){
   const surface=this.renderer.domElement,signal=this.abort.signal;
   const rayFor=event=>{const r=surface.getBoundingClientRect(),ray=new THREE.Raycaster();ray.params.Line.threshold=.07;ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),this.camera);return ray;};
   surface.addEventListener('pointerdown',event=>{
    if(event.button!==0||!this.motionPath?.visible||this.playing||this.object()?.locked)return;
    const hits=rayFor(event).intersectObjects(this.motionPath.children),hit=hits.find(hit=>hit.object.isMesh&&hit.object.userData.keyframeId)||hits.find(hit=>hit.object.userData.segment);if(!hit)return;
    const segment=hit.object.userData.segment,id=segment?.a.id||hit.object.userData.keyframeId,field=segment?'bendConstraint':hit.object.userData.controlField;
    const curveT=segment?nearestPathParameter(segment.curve,hit.point.toArray()):null;
    this.selectKey(id);const key=this.selectedKey();if(!key)return;
    const origin=segment?segment.curve.getPoint(curveT).toArray():field?(key[field]||hit.object.position.toArray()):key.state.position;
    const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-origin[1]),point=new THREE.Vector3();if(!rayFor(event).ray.intersectPlane(plane,point))return;
    this.pathDrag={id,field,curveT,toKeyId:segment?.b.id,origin:copy(origin),start:point,plane,x:event.clientX,y:event.clientY,moved:false};
    this.controls.enabled=false;this.transform.enabled=false;surface.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
   },{capture:true,signal});
   surface.addEventListener('pointermove',event=>{
    const drag=this.pathDrag;if(!drag)return;event.preventDefault();event.stopImmediatePropagation();
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<3)return;
    const point=new THREE.Vector3();if(!rayFor(event).ray.intersectPlane(drag.plane,point))return;
    if(!drag.moved){this.remember();drag.moved=true;}
    const key=this.data.keyframes.find(k=>k.id===drag.id);if(!key)return;
    const position=point.sub(drag.start).add(new THREE.Vector3().fromArray(drag.origin)).toArray();
    if(drag.field==='bendConstraint')key.bendConstraint={point:position,t:drag.curveT,toKeyId:drag.toKeyId};else if(drag.field)key[drag.field]=position;else key.state.position=position;
    this.timelineTracks=null;this.applyTime();this.renderMotionPath();
   },{capture:true,signal});
   const finish=event=>{if(!this.pathDrag)return;event.preventDefault();event.stopImmediatePropagation();const changed=this.pathDrag.moved;this.pathDrag=null;this.controls.enabled=true;this.transform.enabled=true;if(changed)this.persist();};
   surface.addEventListener('pointerup',finish,{capture:true,signal});surface.addEventListener('pointercancel',finish,{capture:true,signal});
  },
  compileTimeline(render=true){
   this.timelineTracks=new Map();
   for(const id of new Set(this.data.keyframes.map(k=>k.entityId))){const frames=trackFrames(this.data.keyframes,id);this.timelineTracks.set(id,{frames,segments:buildSegments(frames)});}
   if(render){this.renderTimeline();this.renderMotionPath();}
  },
  timelineOwner(){return this.cameraEdit?.id||this.selected;},
  selectedKey(){return this.data.keyframes.find(k=>k.id===this.selectedKeyId);},
  displayObject(id=this.selected){const object=this.object(id);if(!object)return object;const key=this.selectedKey(),item=this.entities.get(id);if(key?.entityId===id)return {...object,...key.state,id:object.id,name:object.name,kind:object.kind,locked:object.locked};return item?{...object,...item.timelineState,position:item.root.position.toArray(),rotation:[item.root.rotation.x,item.root.rotation.y,item.root.rotation.z],scale:item.root.scale.toArray(),pose:item.currentPose||object.pose}:object;},
  toggleTimeline(){
   const old=this.root.querySelector('.studio-timeline');if(old){old.remove();this.timelineElement=null;if(this.motionPath)this.motionPath.visible=false;return;}
   this.timelineElement=el('div','studio-timeline');this.root.append(this.timelineElement);this.compileTimeline();
  },
  renderTimeline(){
   const toolbar=this.timelineElement;if(!toolbar?.isConnected)return;
   toolbar.replaceChildren();const owner=this.timelineOwner(),object=this.object(owner),frames=trackFrames(this.data.keyframes,owner),disabled=this.playing||!!this.recorder||object?.locked||!object||this.data.activeSetup==='baseline';
   const play=button(this.playing?'pause':'play',this.playing?'暂停时间调度':'播放时间调度',()=>this.setPlayback(!this.playing));play.className='studio-time-play';this.playButton=play;
   const loop=button('refresh',this.loop?'关闭循环播放':'开启循环播放',()=>{this.loop=!this.loop;this.data.loop=this.loop;this.persist();});loop.setAttribute('aria-pressed',String(this.loop));loop.classList.toggle('active',this.loop);
   const track=el('div','studio-time-track');this.timeInput=el('input');Object.assign(this.timeInput,{type:'range',min:0,max:this.duration,step:.01,value:this.time});this.timeInput.setAttribute('aria-label','定位时间轴');this.timeInput.disabled=!!this.recorder;
   this.timeInput.oninput=()=>{this.playing=false;this.selectedKeyId=null;this.time=Number(this.timeInput.value);this.applyTime();};
   this.timeInput.onchange=()=>{this.select(this.selected);this.renderTimeline();};
   this.timeInput.ondblclick=e=>{if(disabled)return;const rect=track.getBoundingClientRect();this.time=Math.max(0,Math.min(this.duration,(e.clientX-rect.left)/rect.width*this.duration));this.applyTime();this.addKeyframe();};track.append(this.timeInput);
   const ticks=el('div','studio-time-ticks'),interval=this.duration>20?5:this.duration>8?1:.5;
   for(let time=0;time<=this.duration+.001;time+=interval){const tick=el('span','',time+'s');tick.style.left=time/this.duration*100+'%';ticks.append(tick);}track.append(ticks);
   this.timeCursor=el('div','studio-time-cursor');track.append(this.timeCursor);
   for(const key of frames){
    const marker=button(null,object.name+' '+key.time.toFixed(1)+'s',()=>this.selectKey(key.id));marker.className='studio-time-key';marker.style.left=key.time/this.duration*100+'%';marker.classList.toggle('selected',key.id===this.selectedKeyId);marker.disabled=disabled;
    marker.oncontextmenu=e=>{e.preventDefault();this.selectKey(key.id);this.keyframePanel(key.id);};
    marker.onkeydown=e=>{let time=key.time;if(e.key==='ArrowLeft')time-=e.shiftKey?.5:.05;else if(e.key==='ArrowRight')time+=e.shiftKey?.5:.05;else if(e.key==='Home')time=0;else if(e.key==='End')time=this.duration;else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();this.deleteKey(key.id);return;}else return;e.preventDefault();e.stopPropagation();this.moveTimelineKey(key.id,time);};
    marker.onpointerdown=e=>{
     if(e.button!==0)return;e.preventDefault();e.stopPropagation();const rect=track.getBoundingClientRect(),start=e.clientX,original=key.time;let moved=false;marker.setPointerCapture(e.pointerId);
     marker.onpointermove=event=>{const delta=event.clientX-start;if(!moved&&Math.abs(delta)<3)return;if(!moved){this.remember();moved=true;}const time=Math.max(0,Math.min(this.duration,Math.round((original+delta/rect.width*this.duration)*100)/100));try{this.data.keyframes=moveKey(this.data.keyframes,key.id,time,this.duration);key.time=time;this.selectedKeyId=key.id;this.time=time;marker.style.left=time/this.duration*100+'%';this.timelineTracks=null;this.applyTime();}catch{}};
     marker.onpointerup=()=>{marker.onpointermove=null;marker.onpointerup=null;if(moved){this.persist();this.renderTimeline();}else this.selectKey(key.id);};
    };track.append(marker);
   }
   const redistribute=button('time','按匀速重新分配',()=>this.redistributeTrack(owner));redistribute.disabled=disabled||frames.length<3;
   const save=button('plus',object?'保存为关键帧':'先选择角色、摄像机或对象，再保存关键帧',()=>this.addKeyframe());save.disabled=disabled;
   const remove=button('delete',this.selectedKeyId?'删除所选关键帧':'选择要删除的关键帧。',()=>this.deleteKey(this.selectedKeyId));remove.disabled=disabled||!this.selectedKeyId;
   toolbar.append(el('span','studio-time-beta','测试版'),play,loop,track,redistribute,save,remove,button('more','时间轴操作',()=>this.timelinePanel()));this.updateTimeUI();
  },
  setPlayback(value){if(this.recorder?.state==='recording'&&!value)this.recorder.pause();else if(this.recorder?.state==='paused'&&value)this.recorder.resume();this.playing=value;if(value){if(this.time>=this.duration)this.time=0;this.transform.detach();}else this.select(this.selected);this.renderTimeline();},
  addKeyframe(time=this.time,entityId=this.timelineOwner()){
   const object=this.object(entityId);if(!object)throw Error('先选择角色、摄像机或对象，再保存关键帧');if(object.locked)throw Error('解锁对象后才能编辑动画');if(this.playing||this.recorder||this.data.activeSetup==='baseline')throw Error('播放中或场景基准中不能编辑关键帧');
   this.remember();this.duration=Math.max(this.duration,time);const item=this.entities.get(entityId),state={position:item.root.position.toArray(),rotation:new THREE.Euler().setFromQuaternion(item.root.quaternion,'XYZ').toArray().slice(0,3),scale:item.root.scale.toArray()};
   for(const field of ['pose','color','focal','fov','aspect',...opticsFields])if(object[field]!==undefined)state[field]=this.displayObject(entityId)?.[field]??object[field];
   if(this.cameraEdit?.id===entityId)Object.assign(state,{position:this.camera.position.toArray(),rotation:new THREE.Euler().setFromQuaternion(this.camera.quaternion,'XYZ').toArray().slice(0,3),focal:this.focal,fov:this.camera.fov,aspect:this.captureAspect,...copy(this.lens)});
   const existing=this.data.keyframes.find(k=>k.entityId===entityId&&Math.abs(k.time-time)<.025);
   const frame={...copy(existing||{}),id:existing?.id||crypto.randomUUID(),entityId,time:Math.round(time*1000)/1000,state,interpolation:existing?.interpolation||'linear'};
   this.data.keyframes=this.data.keyframes.filter(k=>k.id!==existing?.id);this.data.keyframes.push(frame);this.selectedKeyId=frame.id;this.time=frame.time;this.persist();this.renderSelection();return copy(frame);
  },
  selectKey(id){const frame=this.data.keyframes.find(k=>k.id===id);if(!frame)return;this.playing=false;this.selectedKeyId=id;this.time=frame.time;this.select(frame.entityId);this.applyTime();this.renderTimeline();},
  moveTimelineKey(id,time){this.remember();try{this.data.keyframes=moveKey(this.data.keyframes,id,time,this.duration);this.selectedKeyId=id;this.time=this.data.keyframes.find(k=>k.id===id).time;this.persist();this.applyTime();}catch(error){this.history.pop();this.notify(error.message);}},
  deleteKey(id){if(!id)return;const key=this.data.keyframes.find(k=>k.id===id);if(this.object(key?.entityId)?.locked){this.notify('对象已锁定');return;}this.remember();this.data.keyframes=this.data.keyframes.filter(k=>k.id!==id);this.selectedKeyId=null;this.persist();this.applyTime();},
  redistributeTrack(entityId){this.remember();const frames=redistributeTimes(trackFrames(this.data.keyframes,entityId));this.data.keyframes=this.data.keyframes.filter(k=>k.entityId!==entityId).concat(frames);this.time=this.selectedKey()?.time??this.time;this.persist();this.applyTime();},
  setTimelineDuration(value){if(this.recorder){this.notify('录制结束后可修改时间轴长度');return;}const last=Math.max(0,...this.data.keyframes.map(k=>k.time));if(value<last){this.notify('时间轴不能短于最后一个关键帧');return;}this.remember();this.duration=Math.max(1,Math.min(120,value));this.time=Math.min(this.time,this.duration);this.persist();},
  timelinePanel(){const p=this.popup('时间轴操作');if(!p)return;p.append(button('minus','缩短时间轴 1 秒',()=>{this.setTimelineDuration(this.duration-1);p.remove();},'缩短时间轴 1 秒'),button('plus','延长时间轴 1 秒',()=>{this.setTimelineDuration(this.duration+1);p.remove();},'延长时间轴 1 秒'));const record=button('record',this.recorder?'停止录制':'录制时间轴',()=>{this.record();p.remove();},this.recorder?'停止录制':'录制时间轴');p.append(record);},
  keyframePanel(id){const key=this.data.keyframes.find(k=>k.id===id),p=this.popup('关键帧');if(!key||!p)return;
   this.number(p,'关键帧时间（秒）',key.time,0,this.duration,.01,time=>this.moveTimelineKey(id,time));
   this.selectInput(p,'过渡',{linear:'运动',hold:'保持'},key.interpolation||'linear',value=>{this.remember();key.interpolation=value;this.persist();this.applyTime();});
   p.append(button('refresh','重置路径曲线',()=>{this.remember();for(const k of this.data.keyframes.filter(k=>k.entityId===key.entityId)){delete k.inControl;delete k.outControl;delete k.bendConstraint;}this.persist();},'重置路径曲线'),button('delete','删除所选关键帧',()=>{this.deleteKey(id);p.remove();},'删除关键帧'),button('delete','删除对象动画',()=>{this.remember();this.data.keyframes=this.data.keyframes.filter(k=>k.entityId!==key.entityId);this.selectedKeyId=null;this.persist();this.applyTime();p.remove();},'删除对象动画'));
  },
  applyTime(){
   if(!this.timelineTracks)this.compileTimeline(false);
   for(const object of this.data.objects){const track=this.timelineTracks.get(object.id),state=(track&&sampleTrack(track.frames,this.time,track.segments))||object,item=this.entities.get(object.id);if(!item)continue;item.timelineState=state;
    item.root.position.fromArray(state.position);item.root.rotation.set(...state.rotation,'XYZ');item.root.scale.fromArray(state.scale);item.root.visible=state.visible!==false;
    if(state.pose&&item.currentPose!==state.pose&&item.mixer){const clip=item.animations?.find(c=>c.name===state.pose);if(clip){item.mixer.stopAllAction();item.mixer.clipAction(clip).play();item.mixer.update(.001);item.currentPose=state.pose;}}
    if(state.color&&state.color!==item.currentColor){this.colorModel(item.model,state.color);item.currentColor=state.color;}
    if(this.cameraEdit?.id===object.id){this.camera.position.copy(item.root.position);this.camera.quaternion.copy(item.root.quaternion);this.captureAspect=state.aspect||this.captureAspect;this.setFocal(state.focal||this.focal);this.lens=optics(state);this.refreshOptics();this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()),10);}
   }
   const legacy=this.timelineTracks.get(VIEWER_TRACK);if(legacy&&!this.cameraEdit){const state=sampleTrack(legacy.frames,this.time,legacy.segments);if(state){this.camera.position.fromArray(state.position);this.camera.quaternion.fromArray(state.quaternion);this.setFocal(state.focal);this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()),10);}}
   this.updateTimeUI();
  },
  updateTimeUI(){if(this.timeInput?.isConnected)this.timeInput.value=this.time;if(this.timeCursor?.isConnected)this.timeCursor.style.left=this.time/this.duration*100+'%';},
  renderMotionPath(){
   if(this.motionPath){this.scene.remove(this.motionPath);this.motionPath.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
   const track=this.timelineTracks?.get(this.timelineOwner());if(!track||!this.timelineElement?.isConnected){this.motionPath=null;return;}
   const group=new THREE.Group(),color=this.object()?.color||'#d9bf65';
   for(const segment of track.segments){if(segment.hold)continue;const points=segment.curve.getPoints(48);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.8}));line.userData.segment=segment;line.renderOrder=20;group.add(line);}
   for(const key of track.frames){const marker=new THREE.Mesh(new THREE.SphereGeometry(key.id===this.selectedKeyId ? .1 : .07,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));marker.position.fromArray(key.state.position);marker.userData.keyframeId=key.id;marker.renderOrder=21;group.add(marker);}
   if(track.segments.length){
    for(const [segment,key,field,point] of [[track.segments[0],track.frames[0],'outControl',track.segments[0].curve.v1],[track.segments.at(-1),track.frames.at(-1),'inControl',track.segments.at(-1).curve.v2]]){
     if(segment.hold)continue;const handle=new THREE.Mesh(new THREE.SphereGeometry(.06,10,8),new THREE.MeshBasicMaterial({color:'#ffffff',depthTest:false}));handle.position.copy(point);handle.userData={keyframeId:key.id,controlField:field};handle.renderOrder=22;group.add(handle);
     const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3().fromArray(key.state.position),point]),new THREE.LineBasicMaterial({color:'#ffffff',depthTest:false,transparent:true,opacity:.3}));line.renderOrder=20;group.add(line);
    }
   }
   group.visible=!this.viewfinder;this.scene.add(group);this.motionPath=group;
  }
 });
}
