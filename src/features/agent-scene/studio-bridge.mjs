// Agent contracts retain radians even though the Studio 2.0 inspector uses degrees.
const radians=value=>value*Math.PI/180;
const degrees=value=>value*180/Math.PI;
const fields=['name','position','rotation','scale'];
export function agentSceneState(runtime){
  const state=runtime.read();
  return {...state,units:{position:'meters',rotation:'radians',rotationOrder:'XYZ',transformSpace:'parent-local',lighting:'degrees'},
    supportedProperties:fields,objects:state.objects.map(object=>({...object,rotation:object.rotation.map(radians)}))};
}
export async function executeStudioTool(instance,action,args={},options={}){
  if(action==='read')return agentSceneState(instance.runtime);
  const state=instance.runtime.read();
  if(!state.capabilities.includes(action))throw Error('3D 片场 2.0 尚不支持此工具操作：'+action+'。请读取 scene_read.capabilities。');
  const field=['add','import'].includes(action)?'properties':action==='update'?'patch':null;
  let converted=args;
  if(field){
    const patch=args[field]||{},camera=action==='update'&&state.objects?.find(object=>object.id===args.id)?.kind==='camera';
    const supported=camera&&state.supportedCameraProperties?.includes('viewport')?[...fields,'viewport']:fields;
    const unsupported=Object.keys(patch).filter(key=>!supported.includes(key));
    if(unsupported.length)throw Error('3D 片场 2.0 尚不支持这些属性：'+unsupported.join(', '));
    converted={...args,[field]:{...patch,...(patch.rotation?{rotation:patch.rotation.map(degrees)}:{})}};
  }
  if(action==='environment'){
    const grid=state.supportedEnvironmentProperties?.includes('ground.grid');
    if(Object.keys(args).some(key=>!['lighting',...(grid?['ground']:[])].includes(key))||!Object.keys(args).length||
      'lighting'in args&&(!args.lighting||!Object.keys(args.lighting).length||Object.keys(args.lighting).some(key=>!['azimuth','elevation'].includes(key)))||
      'ground'in args&&(!args.ground||Object.keys(args.ground).length!==1||typeof args.ground.grid!=='boolean'))throw Error('3D 片场 2.0 环境仅支持已声明的 lighting.azimuth、lighting.elevation 和 ground.grid');
  }
  if(['keyframe','motion'].includes(action)&&args.pose?.rotation){
    if(!Array.isArray(args.pose.rotation)||args.pose.rotation.length!==3||!args.pose.rotation.every(Number.isFinite))throw Error('关键帧旋转必须为三个有限弧度值');
    converted={...args,pose:{...args.pose,rotation:args.pose.rotation.map(degrees)}};
  }
  let result;
  try{result=await instance.execute(action,converted,options);}
  catch(error){
    if(error.applied===true&&action==='motion-export')return {error:'视频已加入画布，但保存失败：'+(error.message||'请重试保存'),applied:true,nodeId:error.nodeId};
    if(error.applied===true&&['update','environment','motion','import','redo'].includes(action))return {error:'本地设置已应用，但保存失败：'+(error.message||'请重试保存'),applied:true,...(action==='update'?{entityId:args.id}:action==='motion'?{cameraId:error.cameraId,animationIndex:error.animationIndex}:action==='import'?{entityId:error.entityId,sourceNodeId:error.sourceNodeId,sessionId:error.sessionId,revision:error.revision}:action==='redo'?{sessionId:error.sessionId,revision:error.revision}:{settings:error.settings||'lighting'})};
    throw error;
  }
  if(action==='motion'&&result?.keyframes)return {...result,rotationUnits:'radians',keyframes:result.keyframes.map(key=>({...key,pose:{...key.pose,rotation:key.pose.rotation.map(radians)}}))};
  return result?.rotation?{...result,rotation:result.rotation.map(radians)}:result;
}

// New V2 settings must not silently flow into legacy persistence without an
// implementation. Check the complete request before any old mutation begins.
export function validateLegacyStudioTool(action,args={}){
 const patch=action==='update'?args.patch:action==='add'?args.properties:null;
 if(patch&&Object.hasOwn(patch,'viewport'))throw Error('viewport 仅适用于 3D 片场 2.0；旧版镜头使用 aspect');
 if(action==='environment'&&args.lighting&&(Object.hasOwn(args.lighting,'elevation')||args.lighting.azimuth>359))throw Error('旧版片场不支持 elevation，azimuth 范围为 0 至 359 度');
}
