import * as THREE from 'three';
import {motionTracks,keyTimes,worldPose,deletionReason,editWorldPose} from './motion-data.mjs';
import {transitionType,easingOf,validCurve,defaultCurve,changeEasing} from './motion-easing.mjs';
import {exportMotion} from './video-export.mjs';

export const supportedMotionActions=['read','select','edit','move','delete','easing'];
const fields=['position','rotation','scale'];
const common=['action','cameraId','animationIndex'];
const actionFields={read:['offset','limit'],select:['keyIndex'],edit:['keyIndex','pose'],move:['keyIndex','time'],delete:['keyIndex'],easing:['type','curve']};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||!supportedMotionActions.includes(args.action))throw Error('运镜操作无效');
  if(Object.keys(args).some(key=>![...common,...actionFields[args.action]].includes(key)))throw Error('运镜操作包含不适用的参数');
  if(args.cameraId!==undefined&&(typeof args.cameraId!=='string'||!args.cameraId.trim()))throw Error('镜头 ID 无效');
  if(args.animationIndex!==undefined&&(!Number.isInteger(args.animationIndex)||args.animationIndex<0))throw Error('动画索引无效');
  if(['select','edit','move','delete'].includes(args.action)&&(!Number.isInteger(args.keyIndex)||args.keyIndex<(args.action==='select'?-1:0)))throw Error('关键帧索引无效');
  if(args.action==='read'&&(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<0)||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>200)))throw Error('关键帧分页参数无效');
  if(args.action==='move'&&(!Number.isFinite(args.time)||args.time<0||args.time>7200))throw Error('关键帧时间必须为 0–7200 秒');
  if(args.action==='easing'&&(!['LINEAR','CURVE','STEP'].includes(args.type)||args.curve!==undefined&&(args.type!=='CURVE'||!validCurve(args.curve))))throw Error('过渡方式或曲线参数无效');
  if(args.action==='edit'){
    const pose=args.pose;
    if(!pose||typeof pose!=='object'||Array.isArray(pose)||!Object.keys(pose).length)throw Error('关键帧姿态不能为空');
    for(const [field,value]of Object.entries(pose))if(!fields.includes(field)||!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite)||field==='scale'&&value.some(n=>n<.01||n>100))throw Error('关键帧姿态必须为有效三维变换，缩放范围为 0.01–100');
  }
}
function context(runtime,args){
  const cameraId=args.cameraId??runtime.shotId,index=args.animationIndex??runtime.motionIndex,camera=runtime.find(cameraId),clip=runtime.animations[index];
  if(!camera?.isCamera||!clip)throw Error('请指定有效镜头和运镜');
  const tracks=motionTracks(runtime.content,camera,clip),times=keyTimes(tracks);
  if(!times.length)throw Error('此动画没有指定镜头的运镜轨道');
  if(args.keyIndex!==undefined&&args.keyIndex>=times.length)throw Error('关键帧不存在，请重新读取运镜');
  return {cameraId,index,camera,clip,tracks,times};
}
function poseParts(matrix){
  const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);
  return {position:position.toArray(),rotation:new THREE.Euler().setFromQuaternion(quaternion,'XYZ').toArray().slice(0,3).map(THREE.MathUtils.radToDeg),scale:scale.toArray()};
}
function describe(runtime,ctx,{offset=0,limit=100}={}){
  const {cameraId,index,camera,clip,tracks,times}=ctx,curve=tracks.map(easingOf).find(Boolean)?.curve;
  return {version:2,nodeId:runtime.nodeId,cameraId,animationIndex:index,name:clip.name,duration:times.at(-1),space:'world',rotationUnits:'degrees',
    transition:{type:transitionType(tracks),curve:curve?[...curve]:null},keyframeCount:times.length,offset,hasMore:offset+limit<times.length,
    keyframes:times.slice(offset,offset+limit).map((time,i)=>({index:offset+i,time,pose:poseParts(worldPose(runtime.content,camera,tracks,time,runtime.playback.rest)),deleteReason:deletionReason(tracks,time)})),
    selectedKeyIndex:runtime.motion.open&&runtime.motion.cameraId===cameraId&&runtime.motion.index===index?runtime.motion.selected:null};
}
function assertEditable(runtime){
  runtime.assertReady();
  if(runtime.restoring||runtime.motion?.gesture||runtime.transform?.dragging||runtime.capturing)throw Error('正在编辑、恢复或拍摄片场，请完成当前操作后再操作运镜');
}
function patchedPose(runtime,ctx,args){
  const base=worldPose(runtime.content,ctx.camera,ctx.tracks,ctx.times[args.keyIndex],runtime.playback.rest),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();base.decompose(p,q,s);
  if(args.pose.position)p.fromArray(args.pose.position);
  if(args.pose.rotation)q.setFromEuler(new THREE.Euler(...args.pose.rotation.map(THREE.MathUtils.degToRad),'XYZ'));
  if(args.pose.scale)s.fromArray(args.pose.scale);
  return new THREE.Matrix4().compose(p,q.normalize(),s);
}

// Agent mutations call the same editor transaction as the visible keyframe inspector.
// Validation and cloned-track preflight run before selecting/isolation changes any runtime state.
export async function controlSceneMotion(runtime,args){
  validate(args);assertEditable(runtime);let ctx=context(runtime,args);
  if(args.action==='read')return describe(runtime,ctx,args);
  if(args.action==='delete'){const reason=deletionReason(ctx.tracks,ctx.times[args.keyIndex]);if(reason)throw Error(reason);}
  let pose;
  if(args.action==='edit'){
    pose=patchedPose(runtime,ctx,args);const probe=ctx.clip.clone();
    for(const field of Object.keys(args.pose))editWorldPose(runtime.content,ctx.camera,probe,ctx.times[args.keyIndex],pose,field==='rotation'?'quaternion':field,runtime.playback.rest);
  }
  if(args.action==='easing')changeEasing(ctx.tracks.map(track=>track.clone()),args.type,args.curve??defaultCurve);
  const revision=runtime.revision,editor=runtime.motion;
  if(!editor.open||editor.cameraId!==ctx.cameraId||editor.index!==ctx.index)editor.start(ctx.index,ctx.cameraId);
  if(args.keyIndex!==undefined)editor.select(args.keyIndex);
  if(args.action==='edit')editor.apply(()=>{for(const field of Object.keys(args.pose))editWorldPose(runtime.content,editor.camera,editor.clip,editor.times[editor.selected],pose,field==='rotation'?'quaternion':field,runtime.playback.rest);});
  else if(args.action==='move')editor.move(editor.times[editor.selected],args.time);
  else if(args.action==='delete')editor.remove();
  else if(args.action==='easing')editor.easing(args.type,args.curve??defaultCurve);
  const applied=runtime.revision!==revision;
  try{await runtime.flush();}catch(error){if(applied)Object.assign(error,{applied:true,cameraId:ctx.cameraId,animationIndex:ctx.index});throw error;}
  ctx=context(runtime,{cameraId:ctx.cameraId,animationIndex:ctx.index});
  return {...describe(runtime,ctx,{offset:Math.max(0,editor.selected-20)}),action:args.action,
    ...(args.action==='move'?{requestedTime:args.time,time:editor.times[editor.selected]}:{})};
}

// Uses the selected motion and the UI's actual encoder/persistence pipeline. No generation API.
export async function exportSceneMotion(runtime,args={},onProgress=()=>{},options={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error('请先选择运镜；视频导出不接受其他参数');
  assertEditable(runtime);
  return exportMotion(runtime,onProgress,options);
}
