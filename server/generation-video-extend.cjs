'use strict';
const {createHash}=require('node:crypto');
const {createArkProvider,parseArkModelMap}=require('./generation-ark.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code,providerDispatched:false});
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const protocol='ark-video-extend-reference';
const continuity={'自然延续':'natural','动作接续':'action','延续运镜':'camera','推进场景':'scene'};

function parseVideoExtendModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).length>100)throw failure('延长镜头模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','model','capabilityMode','resolution','generateAudio','profile','mediaTransport'].includes(key))||entry.kind!=='video.extend'||entry.capabilityMode!=='prompt_simulation'||!object(entry.profile)||entry.profile.ratios?.length!==1||entry.profile.ratios[0]!=='adaptive'||!entry.profile.resolutions?.includes(entry.resolution)||entry.profile.durations?.some(seconds=>seconds<4||seconds>30)||entry.generateAudio!==undefined&&(typeof entry.generateAudio!=='boolean'||entry.profile.audio!==true)||entry.profile.omniReferenceTaskType!==undefined&&entry.profile.omniReferenceTaskType!=='auto')throw failure('须显式配置参考生成、adaptive、4–30 秒规格及实际 Ark 型号','configuration_invalid');
  parseArkModelMap({[alias]:{kind:'video.generate',model:entry.model,modes:{REFERENCE_TO_VIDEO:entry.profile},...entry.mediaTransport?{mediaTransport:entry.mediaTransport}:{}}});
  if(entry.profile.resolutions.some(resolution=>!['480p','720p','1080p'].includes(resolution))||!(entry.profile.maxVideos>=1)||entry.profile.videoDurationRange.min<2||entry.profile.audioDurationRange?.min<2)throw failure('当前参考生成映射须符合已核实的 Seedance 2.5 素材及输出规格','configuration_invalid');
 }
 return structuredClone(map);
}

function createVideoExtendProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},configurationError=null;
 try{mapping=parseVideoExtendModelMap(modelMap);}catch{configurationError='configuration_invalid';}
 const arkMap=Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{kind:'video.generate',model:entry.model,modes:{REFERENCE_TO_VIDEO:entry.profile},...entry.mediaTransport?{mediaTransport:entry.mediaTransport}:{}}]));
 const ark=createArkProvider({baseUrl,apiKey,modelMap:arkMap,fetchImpl});
 configurationError=configurationError||ark.metadata.configurationError;
 const configured=!configurationError&&ark.configured;
 const fingerprint=createHash('sha256').update(canonical({protocol,ark:ark.fingerprint,mapping})).digest('hex');
 const metadata={configured,protocol,missing:ark.metadata.missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['video.extend']:[],models:Object.fromEntries(Object.entries(mapping).map(([alias])=>[alias,{kind:'video.extend',label:'延长镜头 · 参考生成'}])),videoExtend:{capabilityMode:'prompt_simulation',directions:['backward','forward'],continuityPresets:Object.values(continuity),result:'generated-segment',keepsSource:true,concatenatesSource:false,models:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{resolution:entry.resolution,...entry.generateAudio!==undefined?{generateAudio:entry.generateAudio}:{},profile:structuredClone(entry.profile),...entry.mediaTransport?{mediaTransport:structuredClone(entry.mediaTransport)}:{}}]))},references:true,textReferences:true,videoReferences:{transport:'public-https',requiresActualMediaMetadata:true},remoteRecovery:true,remoteCancellation:false,verified:'official-toolbar-and-local-contract'}};
 function build(request){
  if(!configured)throw failure('延长镜头参考生成尚未配置，请检查 Ark 地址、Key 与显式模型映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='video.extend'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw failure('此适配仅支持不超过 64 MiB 的 video.extend 请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  const allowed=['model','modelId','providerParameters','capabilityMode','direction','duration','mode','ratio','extendDirection','sourceClip','subjects','referenceIds','candidateCount','resolution','generateAudio'];
  if(!object(p)||Object.keys(p).some(key=>!allowed.includes(key))||!object(wire)||Object.keys(wire).some(key=>key!=='model'))throw failure('延长镜头包含尚未支持的设置，不会忽略后提交');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&Object.hasOwn(mapping,alias)?mapping[alias]:null;
  if(!entry)throw failure('所选延长镜头型号尚未显式配置','configuration_required');
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==alias))throw failure('延长镜头模型标识不一致');
  if(p.resolution!==undefined&&!entry.profile.resolutions.includes(p.resolution)||p.generateAudio!==undefined&&(typeof p.generateAudio!=='boolean'||entry.profile.audio!==true))throw failure('所选输出清晰度或声音未被显式模型能力支持，不会静默替换');
  const resolution=p.resolution??entry.resolution,generateAudio=p.generateAudio??entry.generateAudio;
  if(p.capabilityMode!=='prompt_simulation')throw failure('须显式选择参考生成；此工具不承诺原生时序延长');
  if(!['forward','backward'].includes(p.extendDirection)||p.direction!==(p.extendDirection==='forward'?'片尾延长':'片头延长')||!Object.hasOwn(continuity,p.mode)||p.ratio!=='自适应'||!Number.isSafeInteger(p.duration)||p.duration<4||p.duration>30||p.candidateCount!==1)throw failure('延长方向、方式、adaptive 和单个 4–30 秒新片段须一致');
  if(request.count!==undefined&&request.count!==1||request.references?.length)throw failure('延长镜头仅生成一个片段，参考须展开为 inputs');
  if([p.sourceClip,request.sourceClip].some(value=>value!==undefined&&value!==null))throw failure('须先裁出真实来源片段，不会发送整片替代选段');
  if(!Array.isArray(request.inputs)||!request.inputs.length||request.inputs.some(input=>!object(input)||!['image','video','audio','text'].includes(input.type)||!['source_video','reference','subject_reference'].includes(input.role)))throw failure('延长镜头需要真实来源视频及展开的参考素材');
  const sources=request.inputs.filter(input=>input.role==='source_video');
  if(sources.length!==1||sources[0]!==request.inputs[0]||sources[0].type!=='video')throw failure('须且只能以一个 source_video 作为首个输入');
  const subjects=p.subjects??[],referenceIds=p.referenceIds??[];
  if(!Array.isArray(subjects)||!Array.isArray(referenceIds)||subjects.length+referenceIds.length>4||new Set(referenceIds).size!==referenceIds.length||referenceIds.some(id=>typeof id!=='string'||!id)||subjects.some(subject=>!object(subject)||Object.keys(subject).some(key=>!['id','name','description'].includes(key))||typeof subject.id!=='string'||!subject.id||typeof subject.name!=='string'||!subject.name.trim()||subject.description!==undefined&&typeof subject.description!=='string')||new Set(subjects.map(subject=>subject.id)).size!==subjects.length)throw failure('最多选择四个实际参考或主体，主体说明须为文字');
  const refs=request.inputs.filter(input=>input.role==='reference'),subjectInputs=request.inputs.filter(input=>input.role==='subject_reference');
  if(refs.length!==referenceIds.length||refs.some(input=>!referenceIds.includes(input.nodeId))||new Set(refs.map(input=>input.nodeId)).size!==refs.length||subjectInputs.some(input=>!subjects.some(subject=>subject.id===input.subjectId))||subjects.some(subject=>!subjectInputs.some(input=>input.subjectId===subject.id)))throw failure('参考与主体输入未完整展开，不会丢弃后提交');
  if(request.inputs.some(input=>[input.clip,input.trim,input.sourceClip].some(value=>value!==undefined&&value!==null)))throw failure('参考选段须先裁为实际视频');
  for(const input of request.inputs.filter(input=>input.type==='video')){
   const seconds=input.duration??(Number.isFinite(input.durationMs)?input.durationMs/1000:undefined),width=input.width,height=input.height;
   if(!Number.isFinite(seconds)||input.durationMs!==undefined&&(!Number.isFinite(input.durationMs)||Math.abs(input.durationMs/1000-seconds)>.001)||![width,height].every(value=>Number.isSafeInteger(value)&&value>=300&&value<=6000)||width/height<.4||width/height>2.5||width*height<407696||width*height>8295044)throw failure('视频须提供一致的实际时长及 Ark 支持的实际尺寸');
   if(input.sourceRange!==undefined&&(!object(input.sourceRange)||Object.keys(input.sourceRange).some(key=>!['start','end'].includes(key))||!Number.isFinite(input.sourceRange.start)||!Number.isFinite(input.sourceRange.end)||input.sourceRange.start<0||input.sourceRange.end<=input.sourceRange.start||Math.abs(input.sourceRange.end-input.sourceRange.start-seconds)>.1))throw failure('已裁片来源边界须与实际片段时长一致');
  }
  const instruction=request.prompt??'';
  if(typeof instruction!=='string'||instruction.length>24000)throw failure('延长镜头提示词须为不超过 24000 字符的文字');
  const source=sources[0],boundary=source.sourceRange?`剪辑片段 ${source.sourceRange.start}–${source.sourceRange.end}`:'完整视频';
  // The official toolbar compiles these controls into a reference-generation
  // prompt. They are model instructions, not a native temporal guarantee.
  let prompt=`这不是视频编辑任务。以${boundary}（@video1）作为衔接边界，向${p.extendDirection==='forward'?'后':'前'}延长${p.duration}秒。延长方式：${p.mode}。剧情要求：${instruction.trim()||'自然延续当前动作与画面节奏'}。保持主体、场景、风格、动作、声音一致，匹配边界处的动作、运镜、光影与声音，不重复原片内容。仅生成新增片段，原片由画布保留，不要在结果中重复或拼接原片。`;
  const counts={image:0,video:0,audio:0},tokens=new Map();
  for(const input of request.inputs)if(input.type!=='text')tokens.set(input,'@'+input.type+(++counts[input.type]));
  for(const input of refs)if(input.type!=='text')prompt+=`\n画布参考 ${input.nodeId}：${tokens.get(input)}。`;
  for(const subject of subjects)prompt+=`\n主体 ${subject.name}：${subject.description||'保持主体视觉特征一致'}。素材：${subjectInputs.filter(input=>input.subjectId===subject.id&&input.type!=='text').map(input=>tokens.get(input)).join('、')||'文字参考'}。`;
  const translated={kind:'video.generate',prompt,inputs:request.inputs.map(input=>({...input,role:input.type==='text'?'subject_reference':'reference_'+input.type})),parameters:{modelId:alias,videoMode:'REFERENCE_TO_VIDEO',ratio:'adaptive',resolution,duration:p.duration,count:1,...generateAudio!==undefined?{audio:generateAudio}:{}}};
  try{ark.prepare(translated);}catch(error){error.providerDispatched=false;throw error;}
  return translated;
 }
 const prepare=request=>{build(request);return request;};
 return {configured,fingerprint,metadata,prepare,submit:async(request,options)=>ark.submit(build(request),options),poll:(id,options)=>ark.poll(id,options),generate:async(request,options)=>ark.generate(build(request),options),isConfigured:()=>configured};
}
module.exports={createVideoExtendProvider,parseVideoExtendModelMap};
