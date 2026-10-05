import {providerConfigurationStatus,resolveProviderConfiguration,requestModelAlias} from '../node-composer/provider-configuration.mjs';
import {prepareDepthTaskRequest} from '../agent-workflows/depth-video.mjs';
const failure=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
export const depthDisclosure='独立深度转换 · Depth Anything Video：上传完整 MP4，输出无声音灰度深度；保留原尺寸和时长，单视频、最多 2400 帧、1920×1080、恒定 5–30 fps、32 MiB。帧数与编码由本机实际验证，不保证与参考站效果一致。';
export function depthRequestState(metadata,request={kind:'video.depth'}){
 const selected=resolveProviderConfiguration(metadata,request),native=selected?.protocol==='fal-video-depth-native';
 const hint=native?depthDisclosure:'深度转换使用已配置的任务网关；保留来源时长和尺寸，结果需解码验证。';
 const reject=reason=>({ready:false,reason,hint,label:'深度配置待完善'});
 const status=providerConfigurationStatus(metadata,request);if(status.configured!==true)return reject(status.message);
 if(request.inputs){try{prepareDepthTaskRequest(request);}catch(error){return reject(error.message);}}
 if(!native)return {ready:true,reason:'',hint,label:'深度任务服务已配置'};
 const models=selected.capabilities?.models||{},aliases=Object.keys(models).filter(alias=>models[alias]?.kind==='video.depth');
 const alias=requestModelAlias(request)??(aliases.length===1?aliases[0]:undefined),profile=selected.capabilities?.videoDepth?.[alias];
 if(profile?.model!=='fal-ai/depth-anything-video'||!profile||profile.kind!=='video.depth'||profile.semantics!=='per-frame-depth'||profile.audioPolicy!=='discard'||profile.tapNowEquivalent!==false||JSON.stringify(profile.sourceMimeTypes)!=='["video/mp4"]'||profile.preserveDuration!==true||profile.preserveDimensions!==true||profile.promptUsed!==false||profile.maxVideos!==1||profile.maxCount!==1||JSON.stringify(profile.resolutions)!=='["source"]'||JSON.stringify(profile.colormaps)!=='["grayscale"]')return reject('深度服务尚未声明 Depth Anything Video 模型、原尺寸时长与无声音灰度单结果能力');
 if(profile.maxSourceFrames!==2400||profile.maxInputBytes!==33554432||profile.maxOutputBytes!==33554432||profile.localMediaProfile!=='mp4-cfr-even-square-pixels-5-30fps'||profile.maxWidth!==1920||profile.maxHeight!==1080||profile.minFps!==5||profile.maxFps!==30||profile.maxDuration!==480)return reject('深度服务未声明完整 MP4 编码、帧数、尺寸及媒体预算');
 const p=request.parameters||{},input=request.inputs?.[0];
 if(input){
  if(input.clip!=null||input.trim!=null)return reject('深度转换需要已物化的完整视频，不能发送选段声明代替实际片段');
  if(input.width%2||input.height%2||input.width>profile.maxWidth||input.height>profile.maxHeight||input.duration>profile.maxDuration)return reject('来源视频超出原尺寸、偶数宽高或时长限制，未自动缩小或截短');
  if(Number.isFinite(input.sizeBytes)&&input.sizeBytes>profile.maxInputBytes)return reject('来源视频超过 32 MiB，未压缩或截短');
 }
 if(Object.hasOwn(p,'resolution')&&p.resolution!=='source')return reject('当前深度模型只支持保留来源分辨率');
 return {ready:true,reason:'',hint,label:'独立深度 · 效果待验',model:alias,profile};
}
export function assertDepthConfiguration(metadata,request){const state=depthRequestState(metadata,request);if(!state.ready)throw failure(state.reason);return state;}
