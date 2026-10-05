import {validateMask} from './core.mjs';
import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
export function maskedVideoRequestState(metadata,request){
 const available=providerConfigurationStatus(metadata,request);if(available.configured!==true)return {ready:false,reason:available.message,hint:''};
 const selected=resolveProviderConfiguration(metadata,request);if(selected.protocol!=='fal-video-mask-native')return {ready:true,reason:'',hint:'视频编辑将使用已配置任务服务；原片保留。'};
 const capability=selected.capabilities?.videoMask,kind=request.kind,p=request.parameters??{};
 const hint='独立替代 · Wan VACE · 720p · 本机保留原声音。生成会上传来源片段、蒙层'+(kind==='video.replace'?'和替换图片到 fal CDN；按参考图替换，图片原尺寸转 PNG。':'到 fal CDN；按所选目标移除。')+'效果待验。';
 const reject=reason=>({ready:false,reason,hint});
 if(!capability||capability.semantics!=='explicit-native-alternative'||capability.temporalMask!==true||capability.maskEncoding!=='rle-zero-based-row-major'||capability.preservesSourceAudio!=='local-remux'||capability.resolution!=='720p'||capability.aspectRatio!=='adaptive'||capability.maxCount!==1)return reject('遮罩编辑服务尚未配置完整时序遮罩、规格或原声音保存能力');
 // A kind-only request is used to disclose readiness before a mask exists.
 if(!p.mask)return {ready:true,reason:'请先识别目标蒙层；识别需要独立分割服务。',hint};
 const mask=p.mask,fps=mask.fps,clip=p.sourceClip,range=capability.sourceFrames,speed=capability.sourceFps;
 if(Number.isSafeInteger(capability.maxFullMaskFrames)&&mask.frames?.length>capability.maxFullMaskFrames)return reject('完整来源蒙层超出当前媒体准备帧数预算，未截断');
 if(mask.encoding!=='rle-zero-based-row-major'||!Array.isArray(mask.frames)||!Number.isFinite(fps)||!range||!speed||fps<speed.min||fps>speed.max)return reject('Wan VACE 需要真实恒定 5–30 fps 的完整时序蒙层，未改速或重采样');
 if(clip&&(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>mask.frames.length/fps+.001))return reject('来源选段无效或超出完整蒙层时间轴');
 try{validateMask(mask,{width:mask.width,height:mask.height,duration:mask.frames.length/fps});}catch(e){return reject(e.message);}
 const start=clip?.start??0,end=clip?.end??mask.frames.length/fps,frames=(end-start)*fps;
 if([start*fps,end*fps,frames].some(value=>Math.abs(value-Math.round(value))>1e-6))return reject('来源选段须精确对齐帧边界，未自动取整或改时段');
 if(!mask.frames.slice(Math.round(start*fps),Math.round(end*fps)).some(frame=>frame.trim()))return reject('选段内蒙层没有目标，请重新识别或调整选段');
 if(frames<range.min||frames>range.max)return reject('Wan VACE 当前支持选段 '+range.min+'–'+range.max+' 帧（5–30 fps）；未截断、补帧或改速');
 if(p.aspectRatio!=='adaptive'||p.resolution!=='720p'||p.candidateCount!==1)return reject('当前替代服务只支持 adaptive、720p、单结果；未静默改变设置');
 return {ready:true,reason:'',hint};
}
export function assertMaskedVideoConfiguration(metadata,request){const state=maskedVideoRequestState(metadata,request);if(!state.ready)throw fail(state.reason);return request;}
