import {providerConfigurationStatus,resolveProviderConfiguration,requestModelAlias} from '../node-composer/provider-configuration.mjs';

const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
function publicVideo(value){
  let url;try{url=new URL(value);}catch{return false;}
  const host=url.hostname.toLowerCase();
  return url.protocol==='https:'&&!url.username&&!url.password&&!host.includes(':')&&!['localhost','0.0.0.0'].includes(host)&&!host.endsWith('.local')&&!host.endsWith('.localhost')&&!/^(0|10|127|169\.254|192\.168)\./.test(host)&&!/^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function extensionRequestState(metadata,request,{prepared=false}={}){
  const availability=providerConfigurationStatus(metadata,request);
  if(availability.configured!==true)return {ready:false,reason:availability.message,hint:''};
  const selected=resolveProviderConfiguration(metadata,request);
  if(selected.protocol!=='ark-video-extend-reference')return {ready:true,reason:'',hint:''};
  const p=request.parameters??{},entry=selected.capabilities?.videoExtend?.models?.[requestModelAlias(request)],profile=entry?.profile;
  const resolution=p.resolution??entry?.resolution,audio=p.generateAudio??entry?.generateAudio;
  const hint='参考生成 · '+requestModelAlias(request)+' · '+resolution+' · '+(audio===undefined?'声音按供应商默认':audio?'有声':'无声')+'；只生成新增片段，原片保留。';
  const reject=reason=>({ready:false,reason,hint});
  if(!profile||!Array.isArray(profile.durations)||!Array.isArray(profile.resolutions)||p.capabilityMode!=='prompt_simulation')return reject('延长镜头须显式配置参考生成能力，请检查模型映射');
  if(!profile.durations.includes(p.duration))return reject('当前模型支持的新增时长为 '+profile.durations.join(' / ')+' 秒；请修改时长或服务端模型能力配置');
  if(!profile.resolutions.includes(resolution)||audio!==undefined&&(typeof audio!=='boolean'||profile.audio!==true))return reject('当前延长镜头服务不支持来源视频的分辨率或声音设置，请检查模型能力配置');
  const inputs=request.inputs??[],sources=inputs.filter(input=>input.role==='source_video');
  if(sources.length!==1||sources[0].type!=='video')return reject('延长镜头需要一个实际来源视频');
  for(const type of ['image','video','audio']){
    const media=inputs.filter(input=>input.type===type),maximum=profile['max'+type[0].toUpperCase()+type.slice(1)+'s']??0;
    if(media.length>maximum)return reject('当前延长模型最多接收 '+maximum+' 个'+{image:'图片',video:'视频',audio:'音频'}[type]+'参考（含来源）');
    if(type==='image')continue;
    const range=profile[type+'DurationRange'];
    if(media.length&&!range)return reject('当前服务尚未配置参考音视频时长范围');
    const seconds=media.map(input=>input.duration??(Number.isFinite(input.durationMs)?input.durationMs/1000:undefined));
    if(seconds.some(value=>value!==undefined&&(!Number.isFinite(value)||value<range.min||value>range.max))||seconds.every(Number.isFinite)&&seconds.reduce((sum,value)=>sum+value,0)>(range?.totalMax??Infinity))return reject('参考音视频实际时长超出当前模型范围；未自动截短');
    if(prepared&&seconds.some(value=>!Number.isFinite(value)))return reject('参考音视频的实际时长尚未读取');
  }
  // Ark's documented Files API is for understanding, not a binary-to-public-URL
  // upload for generation. Fail before decoding/cutting local video, not after it.
  if(inputs.some(input=>input.type==='video'&&(!publicVideo(input.url)||input.clip!=null||input.trim!=null||input.sourceClip!=null))||p.sourceClip!=null)return reject('当前 Ark 延长接口需要已发布的独立 HTTPS 视频；本地视频及裁片尚需接入媒体上传，仅配置 Ark Key 不足以使用。');
  if(prepared&&inputs.filter(input=>input.type==='video').some(input=>{
    const {width,height}=input,seconds=input.duration??input.durationMs/1000,range=input.sourceRange;
    return ![width,height].every(value=>Number.isSafeInteger(value)&&value>=300&&value<=6000)||width/height<.4||width/height>2.5||width*height<407696||width*height>8295044||input.durationMs!==undefined&&Math.abs(input.durationMs/1000-seconds)>.001||range&&(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||Math.abs(range.end-range.start-seconds)>.1);
  }))return reject('视频实际尺寸、时长或裁片边界不符合 Ark 输入条件，未提交生成');
  return {ready:true,reason:'',hint};
}

export function assertExtensionConfiguration(metadata,request,options){
  const state=extensionRequestState(metadata,request,options);
  if(!state.ready)throw fail(state.reason);
  return request;
}
