import {MotionOverlay} from './motion-overlay.mjs';
import {changeEasing,syncEasing} from './motion-easing.mjs';
import * as THREE from 'three';
import {isolateCamera,motionTracks,keyTimes,worldPose,deletionReason,deleteKey,moveKey,editWorldPose} from './motion-data.mjs';

export class MotionEditor {
  constructor(runtime){this.runtime=runtime;this.open=false;this.selected=-1;this.mode='translate';this.overlay=new MotionOverlay();runtime.scene.add(this.overlay);this.pivot=new THREE.Object3D();runtime.scene.add(this.pivot);}
  get camera(){return this.runtime.find(this.cameraId);}
  get clip(){return this.runtime.animations[this.index];}
  get tracks(){return this.camera&&this.clip?motionTracks(this.runtime.content,this.camera,this.clip):[];}
  get times(){return keyTimes(this.tracks);}
  start(index,cameraId){
    const rt=this.runtime;rt.assertReady();const source=rt.find(cameraId);if(!source?.isCamera||!rt.animations[index])throw Error('镜头或运镜不存在');
    const same=rt.shotId===cameraId&&rt.motionIndex===index&&rt.playback.target==='camera'&&rt.playback.index===index,time=same?rt.playback.time:0,needsIsolation=!source.userData.tapnow_motion_isolated,selectionChanged=rt.shotId!==cameraId||rt.motionIndex!==index;
    // Camera isolation is an editing implementation detail, not a separate user undo step.
    this.close(false);rt.select(null);const camera=isolateCamera(rt.content,source,rt.animations);this.cameraId=camera.userData.studioId;rt.shotId=this.cameraId;rt.motionIndex=index;this.index=index;this.selected=-1;
    this.historyContent=rt.content;this.open=true;rt.playback.select(index,'camera',{play:false});rt.playback.apply(time);this.rebuild();if(needsIsolation||selectionChanged)rt.commit();else rt.onChange?.('motion');
  }
  close(notify=true){if(!this.open)return;this.open=false;this.selected=-1;this.gesture=null;this.overlay.visible=false;this.runtime.transform.detach();this.runtime.dirty=true;if(notify)this.runtime.onChange?.('motion');}
  pose(time){return worldPose(this.runtime.content,this.camera,this.tracks,time,this.runtime.playback.rest);}
  select(index){this.runtime.assertReady();this.selected=index;const time=this.times[index];if(time!==undefined)this.runtime.playback.seek(time);this.overlay.select(index);this.syncPivot();this.runtime.onChange?.('motion-select');}
  seek(time){this.runtime.assertReady();this.selected=-1;this.overlay.select(-1);this.runtime.transform.detach();this.runtime.playback.seek(time);this.runtime.onChange?.('motion-select');}
  setMode(mode){this.runtime.assertReady();this.mode=mode;this.runtime.transform.setMode(mode);this.runtime.onChange?.('motion-select');}
  syncPivot(){if(this.runtime.transform.dragging)return;const time=this.times[this.selected];this.runtime.transform.detach();if(time!==undefined){this.pose(time).decompose(this.pivot.position,this.pivot.quaternion,this.pivot.scale);this.pivot.updateMatrixWorld(true);this.runtime.transform.setMode(this.mode);this.runtime.transform.attach(this.pivot);}this.runtime.dirty=true;}
  state(){return {clip:this.clip.clone(),selected:this.selected,time:this.runtime.playback.time};}
  beginGesture(){if(this.gesture)return;this.runtime.assertReady();this.gesture=this.state();this.gesture.snapshot=this.runtime.snapshot();this.gestureChanged=false;this.runtime.playback.playing=false;}
  endGesture(){if(!this.gesture)return;if(!this.gestureChanged){this.gesture=null;return;}this.runtime.recordHistory(this.gesture.snapshot);this.gesture=null;this.runtime.commit();}
  apply(change,{gesture=false}={}){const rt=this.runtime;rt.assertReady();const before=this.state(),snapshot=gesture?null:rt.snapshot(),time=rt.playback.time;rt.playback.stop();try{change();if(gesture)this.gestureChanged=true;syncEasing(this.tracks);this.clip.resetDuration();rt.playback.select(this.index,'camera',{play:false});rt.playback.apply(this.times[this.selected]??time);this.rebuild();if(!gesture){rt.recordHistory(snapshot);rt.commit();}else rt.onChange?.('motion-value');}catch(error){rt.animations[this.index]=before.clip;this.selected=before.selected;rt.playback.select(this.index,'camera',{play:false});rt.playback.apply(time);throw error;}}
  easing(type,curve){this.apply(()=>changeEasing(this.tracks,type,curve));}
  move(time,next){let moved;this.apply(()=>{moved=moveKey(this.tracks,time,next);this.selected=this.times.indexOf(moved);});}
  deleteReason(){const time=this.times[this.selected];return time===undefined?'请选择关键帧':deletionReason(this.tracks,time);}
  remove(){const error=this.deleteReason();if(error)throw Error(error);const time=this.times[this.selected];this.apply(()=>{deleteKey(this.tracks,time);this.selected=Math.min(this.selected,this.times.length-1);});}
  edit(field,axis,value,{gesture=false}={}){if(!Number.isFinite(value))throw Error('关键帧参数无效');const time=this.times[this.selected];if(time===undefined)return;const pose=this.pose(time),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();pose.decompose(p,q,s);if(field==='rotation'){const e=new THREE.Euler().setFromQuaternion(q,'XYZ');e['xyz'[axis]]=THREE.MathUtils.degToRad(value);q.setFromEuler(e);}else (field==='position'?p:s).setComponent(axis,value);this.setPose(new THREE.Matrix4().compose(p,q,s),field==='rotation'?'quaternion':field,{gesture});}
  setPose(pose,field,{gesture=false}={}){const time=this.times[this.selected];if(time===undefined)return;this.apply(()=>editWorldPose(this.runtime.content,this.camera,this.clip,time,pose,field,this.runtime.playback.rest),{gesture});}
  transform(){this.pivot.updateMatrixWorld(true);this.setPose(this.pivot.matrixWorld.clone(),{translate:'position',rotate:'quaternion',scale:'scale'}[this.mode],{gesture:true});}
  undo(redo=false){return this.runtime.undo(redo).catch(error=>this.runtime.onError?.(error));}
  restoreContext(context){
    this.close(false);if(!context||!this.runtime.find(context.cameraId)?.isCamera||!this.runtime.animations[context.index])return;
    this.cameraId=context.cameraId;this.index=context.index;this.mode=context.mode||'translate';this.selected=context.selected;this.historyContent=this.runtime.content;this.open=!!context.open;
    if(context.playback){this.runtime.motionIndex=this.index;this.runtime.playback.select(this.index,'camera',{play:false});this.runtime.playback.apply(context.time);}
    this.rebuild();
  }
  rebuild(){this.overlay.visible=this.open;if(!this.open)return;this.overlay.rebuild(this.times,time=>this.pose(time));this.keyPoints=this.overlay.positions;this.overlay.select(this.selected);this.syncPivot();}

  pick(x,y,rect){if(!this.open)return false;const candidates=(this.keyPoints||[]).map((point,index)=>{const p=point.clone().project(this.runtime.camera);return {index,distance:p.z<-1||p.z>1?Infinity:Math.hypot((p.x+1)*rect.width/2+rect.left-x,(1-p.y)*rect.height/2+rect.top-y)};}).filter(p=>p.distance<=14).sort((a,b)=>a.distance-b.distance);if(!candidates.length)return false;const near=candidates.filter(p=>p.distance<=candidates[0].distance+2),current=near.findIndex(p=>p.index===this.selected);this.select(near[(current+1)%near.length].index);return true;}
  dispose(){this.close(false);this.overlay.dispose();this.pivot.removeFromParent();}
}
