import {motionTracks,keyTimes} from './motion-data.mjs';

export function playbackState(runtime){
 const p=runtime.playback;
 return {index:p.index,target:p.target,time:p.time,playing:p.playing,duration:p.index>=0?p.duration||0:0};
}
function validate(args){
 if(!args||!['select','play','pause','seek','stop'].includes(args.action))throw Error('播放操作无效');
 const allowed=args.action==='select'?['action','animationIndex','target','cameraId']:args.action==='seek'?['action','time']:['action'];
 if(Object.keys(args).some(key=>!allowed.includes(key)))throw Error('播放操作包含不适用的参数');
 if(args.action==='select'&&(!Number.isInteger(args.animationIndex)||args.animationIndex<0||args.animationIndex>10000||!['camera','objects'].includes(args.target)))throw Error('请选择有效动画索引与播放目标');
 if(args.cameraId!==undefined&&(typeof args.cameraId!=='string'||!args.cameraId.trim()||args.target!=='camera'))throw Error('镜头参数仅适用于运镜播放');
 if(args.action==='seek'&&(!Number.isFinite(args.time)||args.time<0||args.time>1000000))throw Error('播放时间必须为有效非负秒数');
}
function cameraDuration(runtime,info){
 const camera=runtime.find(runtime.shotId),clip=runtime.animations[info.index];
 return camera?(keyTimes(motionTracks(runtime.content,camera,clip)).at(-1)??clip.duration):clip.duration;
}
// Preview controls reuse the UI's actual mixer. They never author animation
// tracks; only shot/motion selection follows the existing saved UI preference.
export function controlScenePlayback(runtime,args){
 validate(args);runtime.assertReady();
 if(runtime.restoring||runtime.motion?.gesture||runtime.transform?.dragging)throw Error('正在编辑或恢复片场，请完成当前操作后再控制播放');
 const p=runtime.playback;
 if(args.action==='select'){
  const info=p.catalog().find(clip=>clip.index===args.animationIndex),cameraId=args.cameraId??runtime.shotId;
  if(!info||args.target==='objects'&&!info.objectTracks.length)throw Error('动画不存在或没有对象轨道');
  if(args.target==='camera'&&(!runtime.find(cameraId)?.isCamera||!info.cameraIds.includes(cameraId)))throw Error('此运镜不属于指定镜头');
  const changed=args.target==='camera'&&(runtime.shotId!==cameraId||runtime.motionIndex!==info.index);
  runtime.motion?.close(false);
  if(args.target==='camera'){runtime.shotId=cameraId;runtime.motionIndex=info.index;}
  p.select(info.index,args.target,{play:false});
  if(changed)runtime.commit();
 }else if(args.action==='stop'){
  runtime.motion?.close(false);p.stop(true);
 }else if(args.action==='pause'){
  if(p.index>=0){if(runtime.motion?.open)runtime.motion.seek(p.time);else p.seek(p.time);}
 }else{
  const info=p.index>=0?p.catalog().find(clip=>clip.index===p.index):p.selectedMotion();
  if(!info)throw Error('请先选择需要播放的运镜或对象动画');
  const duration=p.index>=0?p.duration:cameraDuration(runtime,info);
  if(!Number.isFinite(duration)||duration<0)throw Error('动画时长无效');
  if(args.action==='seek'&&args.time>duration)throw Error('播放时间超出当前动画时长：'+duration+' 秒');
  if(p.index<0)p.select(info.index,'camera',{play:false});
  if(args.action==='seek'){if(runtime.motion?.open)runtime.motion.seek(args.time);else p.seek(args.time);}
  else if(!p.playing)p.toggle();
 }
 return {version:2,nodeId:runtime.nodeId,shotId:runtime.shotId,motionIndex:runtime.motionIndex,playback:playbackState(runtime)};
}
