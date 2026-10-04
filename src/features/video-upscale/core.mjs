export const resolutions = {'1080p':1920,'2k':2560,'4k':3840};
export const mediaSource = n => n?.video || globalThis.EDITOR_DATA?.nodes[n?.id]?.video || '';
export function parameters(value={}) {
  return {...value,provider:value.provider==='bfl'?'bfl':'topazlabs',resolution:resolutions[String(value.resolution).toLowerCase()]?String(value.resolution).toLowerCase():'1080p',frame_rate:['auto','30','60','90'].includes(String(value.frame_rate??value.frameRate))?String(value.frame_rate??value.frameRate):'auto',slow_motion:Number(value.slow_motion)===2?2:1,mode:value.mode==='creative'?'creative':'precise',prompt:String(value.prompt||'').slice(0,2000)};
}
export function changeParameters(value,key,next) {
  const p=parameters({...value,[key]:next});
  if(key==='frame_rate'&&p.frame_rate!=='auto')p.slow_motion=1;
  if(key==='slow_motion'&&p.slow_motion!==1)p.frame_rate='auto';
  return p;
}
export function parentVideo(state,id) {
  return state.edges.filter(e=>e.target===id).map(e=>state.nodes.find(n=>n.id===e.source)).find(n=>n?.type==='video'&&mediaSource(n));
}
export function upscaleFactor(resolution,info) {
  if(!info||![info.width,info.height].every(n=>Number.isFinite(n)&&n>0))return;
  const factor=resolutions[resolution]/Math.max(info.width,info.height);
  return factor>=1.5&&factor<=3?factor:undefined;
}
export function validationError(p,info) {
  if(!info||![info.width,info.height].every(n=>Number.isFinite(n)&&n>0))return '无法读取视频信息，请重试';
  if(p.provider==='topazlabs')return info.width>=3840||info.height>=2160?'当前视频分辨率不支持增强':null;
  if(!Number.isFinite(info.duration)||info.duration<=0)return '无法读取视频信息，请重试';
  if(info.duration>20)return 'FLUX Video Upscale 仅支持 20 秒以内的视频';
  if(info.sizeBytes>50000000)return 'FLUX Video Upscale 仅支持 50 MB 以内的视频';
  if(upscaleFactor(p.resolution,info)===undefined)return '当前视频不支持此分辨率，请选择 1.5–3 倍的输出分辨率';
  return null;
}
export function buildRequest(node,parent,info,url) {
  const p=parameters(node.params),error=validationError(p,info);if(error)throw Error(error);
  const scale=resolutions[p.resolution]/Math.max(info.width,info.height);
  const common={provider:p.provider,resolution:p.resolution,originalWidth:info.width,originalHeight:info.height};
  const settings=p.provider==='bfl'?{...common,model:'flux-video-upscale',mode:p.mode,creativity:p.mode==='creative'?1:0,upscaleFactor:scale,durationSeconds:info.duration,duration:Math.ceil(info.duration)}:{...common,model:'prob-4',frameRate:p.frame_rate==='auto'?'auto':Number(p.frame_rate),slowMotion:p.slow_motion,width:Math.round(info.width*scale),height:Math.round(info.height*scale)};
  return {kind:'video.upscale',label:'视频增强',nodeId:node.id,prompt:p.provider==='bfl'&&p.mode==='creative'?p.prompt.trim():'',inputs:[{type:'video',nodeId:parent.id,url,role:'source_video',...(parent.clip?{clip:{...parent.clip}}:{})}],parameters:settings};
}
