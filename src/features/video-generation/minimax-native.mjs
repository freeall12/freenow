const failure=(code,message)=>Object.assign(Error(message),{code});
const present=value=>value!==undefined&&value!==null;
const mediaFormats={image:['image/png','image/jpeg','image/webp','image/heic','image/heif'],video:['video/mp4','video/quicktime'],audio:['audio/wav','audio/mp3','audio/mpeg']};
export const isMinimaxH3=model=>['MiniMax-H3','MiniMax-H3-Max'].includes(model?.id);

// Menus may reset obsolete selections while switching models. A submitted request
// must instead preserve every applicable, explicitly selected native parameter.
export function assertMinimaxVideoChoices(config,data){
  if(!isMinimaxH3(data?.model))return;
  const {options,variant,settings}=data;
  const check=(value,values,label)=>{if(present(value)&&!values?.includes(value))throw failure('unsupported_video_parameter','MiniMax H3 不支持所选'+label+'，请重新选择参数');};
  check(config.duration,options.durations,'时长');
  for(const value of [config.quality,config.resolution])check(value,options.resolutions,'清晰度');
  if(present(config.quality)&&present(config.resolution)&&config.quality!==config.resolution)throw failure('unsupported_video_parameter','MiniMax H3 清晰度参数不一致，请重新选择参数');
  if(present(config.mode)&&config.mode!==settings.mode)throw failure('unsupported_video_mode','MiniMax H3 不支持所选生成方式');
  if(present(config.videoMode)&&config.videoMode!==variant.modelType)throw failure('unsupported_video_mode','MiniMax H3 生成方式与参考素材不符');
  const ratios=[config.ratio,config.aspectRatio,config.aspect].filter(present);
  if(new Set(ratios).size>1)throw failure('unsupported_video_parameter','MiniMax H3 比例参数不一致，请重新选择参数');
  if(variant.aspectRatioPolicy==='derived_from_reference'){
    if(ratios.some(value=>!['adaptive','auto'].includes(value)))throw failure('unsupported_video_parameter','MiniMax H3 首尾帧比例由参考图片决定，请使用自适应比例');
  }else for(const value of ratios)check(value,options.aspectRatios,'比例');
  if(present(config.generateMode))throw failure('unsupported_video_parameter','MiniMax H3 不支持独立生成模式参数');
  if(present(config.audio)||present(config.generateAudio)||present(config.providerParameters?.generateAudio)||config.draft===true||present(config.draftVideoId))throw failure('unsupported_video_parameter','MiniMax H3 不支持独立音频开关或样片参数');
}

export function prepareMinimaxNativeInputs(request,metadata){
  if(request.kind!=='video.generate'||metadata?.protocol!=='minimax-native')return request;
  const parameters=request.parameters||{},wire=parameters.providerParameters||{};
  const alias=wire.model??parameters.modelId??parameters.model;
  const profile=metadata.capabilities?.models?.[alias];
  if(metadata.configured===false||profile?.kind!=='video.generate')throw failure('provider_configuration_required','所选 MiniMax 视频模型尚未配置，请检查服务端模型映射');
  const mode=wire.modelType??parameters.videoMode;
  if(!['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO','REFERENCE_TO_VIDEO'].includes(mode))throw failure('unsupported_video_mode','MiniMax 原生接口不支持所选视频生成方式');
  const videoProfile=metadata.capabilities?.video?.[alias],modeProfile=videoProfile?.modes?.[mode];
  if(!modeProfile)throw failure('provider_configuration_required','所选 MiniMax 视频生成方式尚未配置，请检查服务端模型映射');
  for(const [value,values,label]of [[wire.resolution,modeProfile.resolutions,'清晰度'],[wire.duration,modeProfile.durations,'时长'],[wire.aspectRatio,modeProfile.ratios,'比例']])if(present(value)&&!values?.includes(value))throw failure('unsupported_video_parameter','当前 MiniMax 原生模型不支持所选'+label+'，未修改参数');
  if([wire.times,parameters.count,parameters.times].some(value=>present(value)&&value!==1))throw failure('unsupported_video_parameter','MiniMax 原生视频单次请求只支持生成 1 个结果');
  const texts=(request.inputs||[]).filter(input=>input.type==='text');
  const prompt=[request.prompt,...texts.map(input=>input.text)].filter(text=>typeof text==='string').join('\n');
  if(typeof request.prompt!=='string'||texts.some(input=>typeof input.text!=='string'||!input.text.trim())||!prompt.trim()||[...prompt].length>7000)throw failure('invalid_video_prompt','MiniMax 视频提示词须为不超过 7000 字符的非空文字');
  const inputs=request.inputs||[],media=inputs.filter(input=>input.type!=='text');
  const counts=Object.fromEntries(['image','video','audio'].map(type=>[type,media.filter(input=>input.type===type).length]));
  if(media.length>12||counts.image>9||counts.video>3||counts.audio>3)throw failure('video_reference_limit','MiniMax H3 参考最多 9 张图片、3 段视频、3 段音频，素材合计不超过 12 个');
  if(media.length>(modeProfile.maxMedia??videoProfile.maxMedia??12)||['image','video','audio'].some(type=>counts[type]>(modeProfile['max'+type[0].toUpperCase()+type.slice(1)+'s']??(mode==='REFERENCE_TO_VIDEO'?0:Infinity))))throw failure('video_reference_limit','MiniMax 参考素材超过当前模型配置上限，未提交模型');
  if(mode==='REFERENCE_TO_VIDEO'&&!media.length)throw failure('unsupported_video_mode','MiniMax 参考方式需要实际素材，请选择文生视频');
  if(mode==='TEXT_TO_VIDEO'&&media.length||mode==='IMAGE_TO_VIDEO'&&(counts.image!==1||counts.video||counts.audio)||mode==='START_END_TO_VIDEO'&&(counts.image<1||counts.image>2||counts.video||counts.audio))throw failure('unsupported_video_mode','MiniMax 视频生成方式与实际参考素材不符');
  let imageIndex=0;
  const frameRoles=new Set();
  const prepared=inputs.map(input=>{
    if(input.type==='text')return {...input};
    if(!['image','video','audio'].includes(input.type))throw failure('invalid_media_input','MiniMax 视频参考素材类型无效');
    // Submitted clips must already be independent media. Sending an unexported
    // selection as the full source would alter the creative request.
    if(input.clip!=null||input.trim!=null)throw failure('clip_media_required','MiniMax 参考选区需要先导出真实裁剪素材，不能提交完整来源视频代替');
    const defaultRole=mode==='REFERENCE_TO_VIDEO'?'reference_'+input.type:++imageIndex===1?'first_frame':'last_frame';
    const frame=mode==='IMAGE_TO_VIDEO'||mode==='START_END_TO_VIDEO';
    const role=frame&&['first_frame','last_frame'].includes(input.role)?input.role:defaultRole;
    const subjectReference=mode==='REFERENCE_TO_VIDEO'&&input.role==='subject_reference'&&typeof input.subjectId==='string'&&input.subjectId;
    if(present(input.role)&&input.role!==role&&!subjectReference)throw failure('invalid_reference_role','MiniMax 参考角色与生成方式或首尾帧顺序不符');
    if(frame&&frameRoles.has(role))throw failure('invalid_reference_role','MiniMax 每个首尾帧角色只能提供一张图片');
    if(frame)frameRoles.add(role);
    const formats=videoProfile.mediaTransport?.[input.type]??mediaFormats[input.type];
    if(!Array.isArray(formats)||!formats.length)throw failure('media_type_mismatch','MiniMax 当前模型尚未配置此参考素材类型');
    if(input.url?.startsWith('data:')&&!formats.includes(/^data:([^;,]+)/.exec(input.url)?.[1]))throw failure('media_type_mismatch','MiniMax 参考素材格式不在当前模型配置范围内');
    return {...input,role};
  });
  return {...request,inputs:prepared};
}

export function assertMinimaxNativeMedia(inputs,{baseUrl,decoded=false,transported=false,profile}={}){
  for(const input of inputs){
    if(input.type==='text')continue;
    let url;try{url=new URL(input.url,baseUrl);}catch{throw failure('invalid_media_url','MiniMax 参考素材地址无效');}
    if(url.username||url.password)throw failure('invalid_media_url','MiniMax 参考素材地址不能包含用户名或密码');
    if(url.protocol==='data:'){
      const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.url);
      if(!match||!(profile?.mediaTransport?.[input.type]??mediaFormats[input.type])?.includes(match[1]))throw failure('media_type_mismatch','MiniMax 参考素材格式不受支持，请使用当前模型配置的图片、视频或音频格式');
    }else{
      const local=baseUrl&&url.origin===new URL(baseUrl).origin;
      const host=url.hostname;
      const privateHost=host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]'||host==='0.0.0.0'||/^(127|10|192\.168)\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^169\.254\./.test(host);
      if(!local&&['http:','https:'].includes(url.protocol)&&privateHost)throw failure('media_transport_unreachable','MiniMax 跨源本地素材须先导入当前素材存储');
      if(url.protocol!=='https:'&&url.protocol!=='blob:'&&!local)throw failure('media_transport_unreachable','MiniMax 远程参考须为 HTTPS 地址，本机素材请先导入当前素材存储');
      if(transported&&(url.protocol==='blob:'||local))throw failure('invalid_media_transport','MiniMax 参考素材尚未编码或上传');
    }
  }
  if(decoded)for(const type of ['video','audio']){
    const range=profile?.modes?.REFERENCE_TO_VIDEO?.[type+'DurationRange']??{min:2,max:15,totalMax:15};
    const durations=inputs.filter(input=>input.type===type).map(input=>input.duration);
    if(durations.some(value=>!Number.isFinite(value)||value<range.min||value>range.max)||durations.reduce((sum,value)=>sum+value,0)>range.totalMax)throw failure('video_reference_duration','MiniMax '+(type==='video'?'视频':'音频')+`参考每段须为 ${range.min}–${range.max} 秒，合计不超过 ${range.totalMax} 秒，未自动截短`);
  }
}
