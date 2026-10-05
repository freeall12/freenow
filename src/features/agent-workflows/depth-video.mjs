import {modelFor,configuration,prepareVideoRequest,supports} from '../video-generation/settings.mjs';

export const depthProtocol=Object.freeze({id:'local-depth-v1',kind:'video.depth',source:'local-inferred',referenceVideoCount:1,preserveDuration:true,promptUsed:false});
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const text=value=>typeof value==='string'?value.trim():'';
export function mediaSignature(node){return JSON.stringify([node?.id,node?.type,node?.video||node?.fullImage||node?.image,node?.clip||null,node?.trim??null,node?.duration,node?.videoMetadata||null]);}
function media(input,type){
  if(!input||input.type!==type||!text(input.id)||!text(input.url)||!/^(https?:|data:(image|video)\/|blob:)/.test(input.url))fail('invalid_media','需要真实可读取的'+type+'参考素材');
  if(type==='video'&&(!Number.isFinite(input.duration)||input.duration<=0))fail('invalid_duration','请先读取视频的真实时长');
  return {...input};
}
function positiveDimensions(value){return Number.isInteger(value.width)&&value.width>0&&Number.isInteger(value.height)&&value.height>0;}
export function buildDepthRequest({source,modelId,resolution='source'}={}){
  const input=media(source,'video');if(!positiveDimensions(input))fail('invalid_resolution','请先读取来源视频的真实宽高');
  if(resolution!=='source')fail('contract_required','当前深度转换只支持保留来源分辨率，未自动缩小或截短');
  if(modelId!==undefined&&!text(modelId))fail('invalid_model','深度模型标识无效');
  return {kind:'video.depth',nodeId:input.id,label:'视频深度转换',prompt:'Extract per-frame depth; preserve source movement, camera, duration and frame size.',inputs:[input],
    parameters:{workflow:'depth-video-studio',protocol:depthProtocol.id,...modelId?{model:modelId}:{},resolution:'source',duration:input.duration,width:input.width,height:input.height,preserveDuration:true,promptUsed:false}};
}
// Optional server-side prepareRequest hook; normalize the same contract for direct HTTP callers.
export function prepareDepthTaskRequest(request){
  if(request.kind!=='video.depth')return request;
  if(Object.keys(request).some(key=>!['kind','nodeId','label','prompt','inputs','parameters','references','count'].includes(key)))fail('depth_contract_mismatch','深度转换包含不支持的请求字段，未静默忽略');
  if(!Array.isArray(request.inputs)||request.inputs.length!==1)fail('invalid_references','深度转换必须且只能提供一个视频');
  const p=request.parameters||{},source=request.inputs[0];
  if(typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>!['workflow','protocol','model','modelId','providerParameters','resolution','duration','width','height','preserveDuration','promptUsed','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'].includes(key))||request.prompt!==undefined&&request.prompt!==''&&request.prompt!=='Extract per-frame depth; preserve source movement, camera, duration and frame size.')fail('depth_contract_mismatch','深度转换包含不支持的设置或提示词，未静默忽略');
  const wire=p.providerParameters??{};
  if(typeof wire!=='object'||!wire||Array.isArray(wire)||Object.keys(wire).some(key=>key!=='model'))fail('depth_contract_mismatch','深度转换包含不支持的供应商参数');
  const aliases=[p.model,p.modelId,wire.model].filter(value=>value!==undefined);
  if(aliases.some(value=>!text(value))||new Set(aliases).size>1)fail('invalid_model','深度模型标识无效或互相矛盾');
  const counts=[request.count,p.count,p.times,p.canvasResults?.targetNodeIds?.length].filter(value=>value!==undefined);
  if(counts.some(count=>![1,2].includes(count))||new Set(counts).size>1)fail('depth_contract_mismatch','深度转换数量须为 1 或 2，且数量声明必须一致');
  if(p.batch_count!==undefined&&(p.canvasResults?p.batch_count!==p.canvasResults.requestPlans?.length:p.batch_count!==1))fail('depth_contract_mismatch','深度转换逻辑批次数与画布分组声明不一致');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length)||!source||Object.keys(source).some(key=>!['id','nodeId','type','url','title','name','role','duration','width','height','sizeBytes','mime','mimeType'].includes(key))||source.role!==undefined&&!['source_video','reference_video'].includes(source.role))fail('invalid_references','深度转换需要一个已物化完整视频，不能忽略额外参考或选段');
  if(typeof request.nodeId!=='string'||!request.nodeId.trim()||request.nodeId!==request.nodeId.trim()||request.nodeId.length>200||/[\x00-\x1f\x7f]/.test(request.nodeId)||p.workflow!=='depth-video-studio'||p.protocol!=='local-depth-v1'||p.resolution!=='source'||p.duration!==source.duration||p.width!==source.width||p.height!==source.height||p.preserveDuration!==true||p.promptUsed!==false)fail('depth_contract_mismatch','深度转换请求不符合保留来源时长与分辨率的本地协议');
  buildDepthRequest({source,modelId:aliases[0]});
  // Preserve already-validated aliases and host orchestration receipts. Rebuilding
  // a request here previously erased unsupported intent before native validation.
  return request;
}
function role(value,name,assets){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['nodeId','description'].includes(key)))fail('invalid_role',name+'参考无效');
  const description=text(value.description),nodeId=value.nodeId;
  if(!description&&!text(nodeId))fail('role_required','请确认'+name+'：可选择画布图片或填写文字');
  if(description.length>4000)fail('invalid_role',name+'描述过长');
  const input=nodeId?media(assets.find(input=>input.id===nodeId),'image'):null;
  return {description,nodeId:input?.id||null,input};
}
export function buildRecastRequest({depth,character,setting,assets=[],model,videoMode,duration,aspect,resolution,generateAudio,prompt=''}={}){
  const video=media(depth,'video'),who=role(character,'人物',assets),where=role(setting,'环境',assets);
  const references=[video],imageIndices=new Map();
  for(const r of [who,where])if(r.input&&!imageIndices.has(r.nodeId)){imageIndices.set(r.nodeId,imageIndices.size+1);references.push(r.input);}
  const selected=modelFor(model);if(!selected)fail('model_required','请选择已读取合同且支持视频参考的模型');
  const shape={video:1,image:imageIndices.size,audio:0},candidates=selected.variants.filter(v=>['REFERENCE_TO_VIDEO','REFERENCE_VIDEO_TO_VIDEO'].includes(v.modelType)&&supports(v,shape));
  const variant=videoMode?candidates.find(v=>v.modelType===videoMode):candidates[0];if(!variant)fail('unsupported_references','所选模型或模式不支持当前视频与图片参考组合');
  const options=variant.options||{},length=duration??video.duration;
  if(!Number.isFinite(length)||length<=0||!options.durations?.includes(length))fail('unsupported_duration',`该模型不能按 ${length} 秒生成；允许时长：${options.durations?.join(', ')||'未声明'}。请确认新时长，不会自动截短。`);
  const range=variant.referenceVideoDurationRange,tolerance=range?.maxTolerance||0;
  if(range&&(video.duration<(range.min||0)-tolerance||video.duration>(range.max??Infinity)+tolerance||video.duration>(range.totalMax??Infinity)+tolerance))fail('reference_duration_exceeded','深度视频超出模型参考视频时长限制，需要先确认分段或更换模型');
  if(aspect!==undefined&&!options.aspectRatios?.includes(aspect))fail('unsupported_aspect','模型不支持指定画幅');
  if(resolution!==undefined&&!options.resolutions?.includes(resolution))fail('unsupported_resolution','模型不支持指定分辨率');
  if(generateAudio!==undefined&&(typeof generateAudio!=='boolean'||!options.supportsAudio))fail('unsupported_audio','模型不支持指定音频选项');
  if(typeof prompt!=='string'||prompt.length>12000)fail('invalid_prompt','重演提示词无效');
  const roleMap=[{role:'motion',nodeId:video.id,type:'video',ordinal:1,label:'Video 1',controls:['movement','timing','staging','depth','camera'],excludes:['grayscale appearance','identity','old setting']},
    ...[['character',who],['setting',where]].map(([name,r])=>({role:name,nodeId:r.nodeId,type:r.input?'image':'text',ordinal:r.input?imageIndices.get(r.nodeId):null,label:r.input?'Image '+imageIndices.get(r.nodeId):name+' description',description:r.description,
      controls:name==='character'?['identity','wardrobe','appearance']:['environment','materials','lighting'],excludes:['motion','camera','grayscale rendering']}))];
  const rolePrompt=roleMap.map(r=>`${r.label}: controls ${r.controls.join(', ')} only; must not contribute ${r.excludes.join(', ')}.${r.description?' Description: '+r.description:''}`).join('\n');
  const parameters={model:selected.id,videoMode:variant.modelType,duration:length,...aspect!==undefined?{ratio:aspect}:{},...resolution!==undefined?{quality:resolution}:{},...generateAudio!==undefined?{generateAudio}:{}};
  const configured=configuration(parameters,references);if(configured.variant.key!==variant.key)fail('variant_changed','模型参考模式发生变化，请重新读取合同');
  const request=prepareVideoRequest({kind:'video.generate',nodeId:video.id,label:'深度视频重演',prompt:rolePrompt+'\nGenerate full-color natural characters and a new setting. Do not copy the grayscale depth-map appearance.\n'+prompt.trim(),inputs:references,parameters});
  return {...request,workflow:{protocol:'local-depth-recast-v1',name:'depth-video-studio',stage:'recast',depthNodeId:video.id,roleMap,sourceDuration:video.duration,outputDuration:length,durationChanged:length!==video.duration}};
}

// These fields use the existing show_form contract; a submitted text answer or image selection
// can supply each role. The host must validate the OR requirement after the actual submission.
export function buildRecastForm(nodes,{character,setting}={}){
  const options=nodes.filter(node=>node.type==='image'&&(node.fullImage||node.image)).slice(0,64).map(node=>({value:node.id,file_id:node.id,label:(node.title||'图片参考').slice(0,300)}));
  const fields=[];for(const [name,label,known]of [['character','人物',character],['setting','环境',setting]]){
    if(known&&(text(known.nodeId)||text(known.description)))continue;
    if(options.length)fields.push({id:name+'_image',type:'image_select',label:label+'图片（可选）',options,max_select:1});
    fields.push({id:name+'_description',type:'text',label:label+'描述（可选）',description:'图片或文字至少提供一项；已有明确参考无需重复回答。',multiline:true,max_length:4000});
  }
  return fields.length?{title:'确认重演的人物与环境',description:'深度视频只提供运动、空间和镜头。请为缺少的角色选择画布图片或填写描述。',submit_label:'确认参考',fields}:null;
}

export const adaptedDepthWorkflow=`1. Use depth_video_prepare with stage convert to validate the configured video.depth route before reading actual source media and sending sampled frames to the current model session. Read the returned capability/disclosure; a missing or unsupported native profile stops without uploading. Use depth_video_convert only for an existing clip; do not confuse whitebox-to-film or video edit with depth conversion.\n2. Reuse an existing depth node for the same unchanged source when available. Otherwise submit one complete materialized video through the configured video.depth adapter. The explicit fal-video-depth-native alternative uses Depth Anything Video, complete MP4/CFR/even dimensions/5-30 fps, at most 2400 frames and 1920x1080, gray output without audio; it preserves source size and duration and never silently clips or downsizes. A configured tasks-v1 gateway remains supported. A queued/configuration_required result is not a completed depth video.\n3. Use depth_video_prepare with stage recast and sourceId of the returned depth video before recasting. Read its actual video model contracts. Obtain character and setting only from explicit user text or selected canvas image assets. Use show_form with image_select plus text fields only for missing information, then wait for the actual structured submission. Pass that show_form callId as formCallId to depth_video_prepare and depth_video_recast; never substitute draft/default answers. A new user turn starts a new model session, so prepare the chosen references again. A skipped/default form is not confirmation.\n4. Call depth_video_recast with depthNodeId, an explicit supported model, and user-specified character/setting or formCallId. Submit the depth video first and appearance images in the documented order. Give each reference one authority; explicitly prohibit the depth video's grayscale appearance, old identity and setting. Validate reference limits and explicit duration without silently shortening the source.\n5. Keep depth, recast and role-map/prompt nodes on the canvas. Report actual node IDs, duration and resolution only after persisted results. Reuse depth for variants. The depth wire protocol is local-inferred; missing official linked reference files are not reproduced.`;
