'use strict';
const {createHash}=require('node:crypto');
const {createArkProvider,parseArkModelMap}=require('./generation-ark.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code,providerDispatched:false});
const protocol='ark-video-reshoot-edit';
const modes={unchanged:'UNCHANGED',static:'static',cut:'hard cut between views',dynamic:'smooth A→B camera motion'};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function parseVideoReshootModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).length>100)throw fail('视频重拍模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias.trim()||alias.length>200||!object(entry)||Object.keys(entry).some(key=>!['kind','model','capabilityMode','resolution','generateAudio','profile'].includes(key))||entry.kind!=='video.reshoot'||entry.capabilityMode!=='prompt_simulation'||!object(entry.profile))throw fail('重拍须显式配置视频编辑提示词模拟及实际型号','configuration_invalid');
  const p=entry.profile;
  parseArkModelMap({[alias]:{kind:'video.generate',model:entry.model,modes:{VIDEO_EDIT:p}}});
  if(p.ratios?.length!==1||p.ratios[0]!=='adaptive'||p.durations.length!==1||p.durations[0]!==-1||!p.resolutions.includes(entry.resolution)||p.resolutions.some(r=>!['480p','720p','1080p'].includes(r))||p.maxImages!==0||p.maxVideos!==1||p.maxAudios!==0||p.videoDurationRange.min<4||p.videoDurationRange.max>30||entry.generateAudio!==undefined&&(typeof entry.generateAudio!=='boolean'||p.audio!==true))throw fail('重拍须使用 adaptive/-1、单个 4–30 秒视频及显式声音/分辨率能力','configuration_invalid');
 }
 return structuredClone(map);
}
function camera(point){return object(point)&&Object.keys(point).sort().join(',')==='azimuth,distance,elevation'&&Number.isFinite(point.azimuth)&&point.azimuth>=0&&point.azimuth<360&&Number.isFinite(point.distance)&&point.distance>=0&&point.distance<=1&&Number.isFinite(point.elevation)&&point.elevation>=-90&&point.elevation<=90;}
function createVideoReshootProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},configurationError=null;
 try{mapping=parseVideoReshootModelMap(modelMap);}catch{configurationError='configuration_invalid';}
 const ark=createArkProvider({baseUrl,apiKey,modelMap:Object.fromEntries(Object.entries(mapping).map(([alias,e])=>[alias,{kind:'video.generate',model:e.model,modes:{VIDEO_EDIT:e.profile}}])),fetchImpl});
 configurationError||=ark.metadata.configurationError;
 const configured=!configurationError&&ark.configured,fingerprint=createHash('sha256').update(canonical({protocol,ark:ark.fingerprint,mapping})).digest('hex');
 const metadata={configured,protocol,missing:ark.metadata.missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['video.reshoot']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'video.reshoot',label:'视频重拍 · 实验性相机提示词'}])),videoReshoot:{capabilityMode:'prompt_simulation',cameraModes:Object.keys(modes),keepsSource:true,exactUnchangedSegments:false,nativeCameraControl:false,models:Object.fromEntries(Object.entries(mapping).map(([alias,e])=>[alias,{resolution:e.resolution,...e.generateAudio!==undefined?{generateAudio:e.generateAudio}:{},profile:structuredClone(e.profile)}]))},videoReferences:{transport:'public-https',requiresActualMediaMetadata:true},remoteRecovery:true,remoteCancellation:false,verified:'official-toolbar-and-local-contract'}};
 function build(request){
  if(!configured)throw fail('视频重拍尚未配置，请检查 Ark 地址、Key 与显式模型映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='video.reshoot'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw fail('此适配仅支持不超过 64 MiB 的 video.reshoot 请求');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||Object.keys(p).some(k=>!['schemaVersion','intent','capabilityMode','sourceClip','aspectRatio','duration','tracks','candidateCount','model','modelId','providerParameters','resolution','generateAudio'].includes(k))||!object(wire)||Object.keys(wire).some(k=>k!=='model'))throw fail('重拍包含尚未支持的参数，不会丢弃后提交');
  const alias=wire.model??p.modelId??p.model,e=typeof alias==='string'&&Object.hasOwn(mapping,alias)?mapping[alias]:null;
  if(!e)throw fail('重拍模型尚未显式配置','configuration_required');
  if([wire.model,p.modelId,p.model].some(v=>v!==undefined&&v!==alias))throw fail('重拍模型标识不一致');
  if(p.schemaVersion!==1||p.intent!=='video_multi_view'||p.capabilityMode!=='prompt_simulation'||p.aspectRatio!=='adaptive'||p.candidateCount!==1||request.count!==undefined&&request.count!==1||request.references?.length)throw fail('重拍须使用版本 1 相机计划、adaptive、单个实验性提示词模拟结果');
  if(p.sourceClip!=null||request.sourceClip!=null)throw fail('须先裁出真实来源片段，不能用整片替代选区');
  if(!Array.isArray(request.inputs)||request.inputs.length!==1||request.inputs[0]?.type!=='video'||request.inputs[0].role!=='source_video')throw fail('重拍须且只能输入一个真实 source_video');
  const source=request.inputs[0],seconds=source.duration??source.durationMs/1000;
  if([source.clip,source.trim,source.sourceClip].some(v=>v!=null)||!Number.isFinite(seconds)||seconds<4||seconds>30||source.durationMs!==undefined&&(!Number.isFinite(source.durationMs)||Math.abs(source.durationMs/1000-seconds)>.001)||![source.width,source.height].every(v=>Number.isSafeInteger(v)&&v>=300&&v<=6000)||source.width/source.height<.4||source.width/source.height>2.5||source.width*source.height<407696||source.width*source.height>8295044)throw fail('来源视频须为已裁好的实际 4–30 秒素材，尺寸和时长须符合 Ark 输入条件');
  if(source.sourceRange!==undefined&&(!object(source.sourceRange)||Object.keys(source.sourceRange).some(k=>!['start','end'].includes(k))||!Number.isFinite(source.sourceRange.start)||!Number.isFinite(source.sourceRange.end)||source.sourceRange.start<0||source.sourceRange.end<=source.sourceRange.start||Math.abs(source.sourceRange.end-source.sourceRange.start-seconds)>.1))throw fail('实际裁片时长与来源边界不一致');
  if(!Number.isFinite(p.duration)||Math.abs(p.duration-seconds)>.1||!Array.isArray(p.tracks)||!p.tracks.length||p.tracks.length>100)throw fail('分镜计划必须覆盖实际来源视频，不会截短或拉伸');
  let end=0;const ids=new Set(),lines=[];
  for(const [index,t]of p.tracks.entries()){
   if(!object(t)||Object.keys(t).some(k=>!['segmentId','name','startTime','endTime','mode','pointA','pointB','instruction'].includes(k))||typeof t.segmentId!=='string'||!t.segmentId.trim()||t.segmentId.length>200||ids.has(t.segmentId)||t.name!==undefined&&(typeof t.name!=='string'||t.name.length>100)||typeof t.instruction!=='string'||t.instruction.length>24000||!Number.isFinite(t.startTime)||!Number.isFinite(t.endTime)||Math.abs(t.startTime-end)>.001||t.endTime<=t.startTime||!Object.hasOwn(modes,t.mode)||!camera(t.pointA))throw fail('重拍分镜、文字或相机坐标无效');
   const moving=['cut','dynamic'].includes(t.mode);
   if(moving&&(!camera(t.pointB)||t.endTime-t.startTime<.5)||!moving&&t.pointB!==undefined||t.mode==='unchanged'&&t.instruction!=='')throw fail('短分镜运镜、隐藏指令或结束机位不符合重拍合同');
   ids.add(t.segmentId);end=t.endTime;
   const label=`${t.name||'Shot '+(index+1)} [${t.segmentId}] (${t.startTime.toFixed(3)}s–${t.endTime.toFixed(3)}s)`;
   lines.push(t.mode==='unchanged'?`${label}: UNCHANGED; preserve the original source video exactly for this entire time range; do not regenerate, reframe, move the camera, or alter the content.`:`${label}: ${modes[t.mode]}; camera A ${JSON.stringify(t.pointA)}${moving?'; camera B '+JSON.stringify(t.pointB):''}${t.instruction.trim()?'; content instruction for this time range only: '+t.instruction.trim():''}`);
  }
  if(Math.abs(end-p.duration)>.001)throw fail('分镜计划未覆盖完整实际来源时长');
  if(p.tracks.every(t=>t.mode==='unchanged'))throw fail('所有分镜均保持不变，无需生成，请至少调整一个镜头');
  if(p.resolution!==undefined&&!e.profile.resolutions.includes(p.resolution)||p.generateAudio!==undefined&&(typeof p.generateAudio!=='boolean'||e.profile.audio!==true))throw fail('来源分辨率或声音设置未被模型支持，不会静默替换');
  if(request.prompt!==undefined&&(typeof request.prompt!=='string'||request.prompt.length>24000))throw fail('重拍提示词须为不超过 24000 字符的文字');
  // Official Kpe compiles camera tracks into model instructions. Ark's edit
  // subtype validates the task, but cannot guarantee native camera trajectories
  // or byte-identical UNCHANGED segments.
  const prompt=['Apply this camera plan to @video1 only where a camera change is specified.','Segments marked UNCHANGED must remain identical to the source video for their full time range.','Maintain subject continuity across regenerated segments.','Camera coordinates: azimuth/elevation in degrees; distance is normalized 0–1 (close-up to wide).','Camera plan:',...lines,request.prompt?'Additional submitted prompt:\n'+request.prompt:''].filter(Boolean).join('\n');
  const translated={kind:'video.generate',prompt,inputs:[{...source,role:'reference_video'}],parameters:{modelId:alias,videoMode:'VIDEO_EDIT',ratio:'adaptive',duration:-1,resolution:p.resolution??e.resolution,...(p.generateAudio??e.generateAudio)!==undefined?{generateAudio:p.generateAudio??e.generateAudio}:{}}};
  try{ark.prepare(translated);}catch(error){error.providerDispatched=false;throw error;}return translated;
 }
 return {configured,fingerprint,metadata,prepare:request=>{build(request);return request;},submit:async(request,options)=>ark.submit(build(request),options),poll:(id,options)=>ark.poll(id,options),generate:async(request,options)=>ark.generate(build(request),options),isConfigured:()=>configured};
}
module.exports={createVideoReshootProvider,parseVideoReshootModelMap};
