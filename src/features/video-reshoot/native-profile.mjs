import {providerConfigurationStatus,resolveProviderConfiguration,requestModelAlias} from '../node-composer/provider-configuration.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
function publicVideo(value){
 let u;try{u=new URL(value);}catch{return false;}const h=u.hostname.toLowerCase();
 return u.protocol==='https:'&&!u.username&&!u.password&&!h.includes(':')&&!['localhost','0.0.0.0'].includes(h)&&!h.endsWith('.local')&&!h.endsWith('.localhost')&&!/^(0|10|127|169\.254|192\.168)\./.test(h)&&!/^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
export function reshootRequestState(metadata,request,{prepared=false}={}){
 const available=providerConfigurationStatus(metadata,request);
 if(available.configured!==true)return {ready:false,reason:available.message,hint:''};
 const selected=resolveProviderConfiguration(metadata,request);
 if(selected.protocol!=='ark-video-reshoot-edit')return {ready:true,reason:'',hint:''};
 const p=request.parameters??{},alias=requestModelAlias(request),e=selected.capabilities?.videoReshoot?.models?.[alias],profile=e?.profile,resolution=p.resolution??e?.resolution,audio=p.generateAudio??e?.generateAudio;
 const hint='实验性相机提示词 · '+alias+' · '+resolution+' · '+(audio===undefined?'声音按供应商默认':audio?'有声':'无声')+'；不保证运镜精确执行或“不变”段逐帧一致，原片保留。';
 const reject=reason=>({ready:false,reason,hint});
 if(p.capabilityMode!=='prompt_simulation'||!profile||profile.omniReferenceTaskType!=='edit'||profile.durations?.length!==1||profile.durations[0]!==-1||!Array.isArray(profile.resolutions))return reject('须显式配置视频重拍实验性提示词模拟及 VIDEO_EDIT 能力');
 if(!profile.resolutions.includes(resolution)||audio!==undefined&&(typeof audio!=='boolean'||profile.audio!==true))return reject('来源视频的分辨率或声音设置未被当前模型支持，未静默替换');
 const inputs=request.inputs??[],v=inputs[0];
 if(inputs.length!==1||v?.type!=='video'||v.role!=='source_video')return reject('重拍需要一个实际来源视频');
 if(!publicVideo(v.url)||[v.clip,v.trim,v.sourceClip,p.sourceClip].some(value=>value!=null))return reject('当前 Ark 重拍需要已发布的独立 HTTPS 视频；本地视频及选段尚需接入媒体上传，仅配置 Ark Key 不足以使用。');
 const seconds=v.duration??(Number.isFinite(v.durationMs)?v.durationMs/1000:undefined),range=profile.videoDurationRange;
 if(!range||!Number.isFinite(p.duration)||p.duration<4||p.duration>30||seconds!==undefined&&(!Number.isFinite(seconds)||seconds<Math.max(4,range.min)||seconds>Math.min(30,range.max)||seconds>range.totalMax||Math.abs(p.duration-seconds)>.1))return reject('相机分镜必须覆盖实际 4–30 秒来源视频，未截短或拉伸');
 if(prepared){
  const {width,height,sourceRange}=v;
  if(!Number.isFinite(seconds)||v.durationMs!==undefined&&(!Number.isFinite(v.durationMs)||Math.abs(v.durationMs/1000-seconds)>.001)||![width,height].every(value=>Number.isSafeInteger(value)&&value>=300&&value<=6000)||width/height<.4||width/height>2.5||width*height<407696||width*height>8295044||sourceRange&&(!Number.isFinite(sourceRange.start)||!Number.isFinite(sourceRange.end)||sourceRange.start<0||sourceRange.end<=sourceRange.start||Math.abs(sourceRange.end-sourceRange.start-seconds)>.1))return reject('视频实际尺寸、时长或裁片边界不符合 Ark 输入条件');
 }
 return {ready:true,reason:'',hint};
}
export function assertReshootConfiguration(metadata,request,options){const state=reshootRequestState(metadata,request,options);if(!state.ready)throw fail(state.reason);return request;}
