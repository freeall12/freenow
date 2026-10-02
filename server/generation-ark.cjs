'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const modeNames=['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO','REFERENCE_TO_VIDEO','VIDEO_EDIT'];
const imageMimes=['image/png','image/jpeg','image/webp'];
const audioMimes=['audio/wav','audio/mp3','audio/mpeg'];
const own=(value,key)=>Object.hasOwn(value,key);
const isTaskId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value);
function httpsUrl(value){
 let url;try{url=new URL(value);}catch{throw failure('媒体须为公网 HTTPS 地址或受支持的内联图片/音频');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168)\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host))throw failure('媒体须为不含凭据的公网 HTTPS 地址');
 return url.href;
}
function parseArkModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value||{};
 if(!object(map))throw failure('Ark 模型映射配置无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias||!object(entry)||entry.kind!=='video.generate'||typeof entry.model!=='string'||!entry.model.trim()||!object(entry.modes)||!Object.keys(entry.modes).length)throw failure('Ark 视频能力配置无效','configuration_invalid');
  const allowed=new Set(['kind','model','modes','supportsDraft','supportsDraftTask','mediaTransport']);
  if(Object.keys(entry).some(key=>!allowed.has(key)))throw failure('Ark 模型配置含有未支持的字段','configuration_invalid');
  for(const key of ['supportsDraft','supportsDraftTask'])if(entry[key]!==undefined&&typeof entry[key]!=='boolean')throw failure('Ark 样片能力配置无效','configuration_invalid');
  if(entry.mediaTransport!==undefined){
   if(!object(entry.mediaTransport)||Object.keys(entry.mediaTransport).some(key=>!['image','audio'].includes(key)))throw failure('Ark 素材传输配置无效','configuration_invalid');
   for(const [type,mimes]of Object.entries(entry.mediaTransport))if(!Array.isArray(mimes)||mimes.some(mime=>!(type==='image'?imageMimes:audioMimes).includes(mime)))throw failure('Ark 内联素材格式配置无效','configuration_invalid');
  }
  for(const [mode,profile]of Object.entries(entry.modes)){
   const keys=['ratios','resolutions','durations','audio','maxImages','maxVideos','maxAudios','audioRequiresCompanion','videoDurationRange','audioDurationRange','omniReferenceTaskType'];
   if(!modeNames.includes(mode)||!object(profile)||Object.keys(profile).some(key=>!keys.includes(key)))throw failure('Ark 生成方式配置无效','configuration_invalid');
   for(const [key,values]of [['ratios',['adaptive','16:9','4:3','1:1','3:4','9:16','21:9']],['resolutions',['480p','720p','1080p','4k']]])if(profile[key]!==undefined&&(!Array.isArray(profile[key])||!profile[key].length||profile[key].some(item=>!values.includes(item))))throw failure('Ark 规格能力配置无效','configuration_invalid');
   if(!Array.isArray(profile.durations)||!profile.durations.length||profile.durations.some(n=>!Number.isSafeInteger(n)||n!==-1&&(n<2||n>30))||!profile.resolutions?.length)throw failure('Ark 时长/分辨率能力配置无效','configuration_invalid');
   for(const key of ['audio','audioRequiresCompanion'])if(profile[key]!==undefined&&typeof profile[key]!=='boolean')throw failure('Ark 音频能力配置无效','configuration_invalid');
   for(const [key,max]of [['maxImages',30],['maxVideos',10],['maxAudios',10]])if(profile[key]!==undefined&&(!Number.isSafeInteger(profile[key])||profile[key]<0||profile[key]>max))throw failure('Ark 参考数量能力配置无效','configuration_invalid');
   for(const type of ['video','audio']){
    const range=profile[type+'DurationRange'];
    if((profile['max'+type[0].toUpperCase()+type.slice(1)+'s']||0)>0&&!range)throw failure('Ark 参考时长能力尚未配置','configuration_invalid');
    if(range!==undefined&&(!object(range)||Object.keys(range).some(key=>!['min','max','totalMax'].includes(key))||![range.min,range.max,range.totalMax].every(n=>Number.isFinite(n)&&n>0&&n<=30)||range.min>range.max||range.max>range.totalMax))throw failure('Ark 参考时长能力配置无效','configuration_invalid');
   }
   if(profile.omniReferenceTaskType!==undefined&&(!['REFERENCE_TO_VIDEO','VIDEO_EDIT'].includes(mode)||!['auto','reference','edit','extend'].includes(profile.omniReferenceTaskType)))throw failure('Ark 参考任务类型配置无效','configuration_invalid');
   if(mode==='VIDEO_EDIT'&&(profile.omniReferenceTaskType!=='edit'||profile.durations.some(n=>n!==-1)||profile.ratios?.some(ratio=>ratio!=='adaptive')))throw failure('Ark 视频编辑须显式配置 edit、adaptive 与 -1','configuration_invalid');
  }
 }
 return structuredClone(map);
}

function createArkProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},endpoint='',configurationError=null;
 try{
  mapping=parseArkModelMap(modelMap);
  if(baseUrl){const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw failure('Ark 地址配置无效');endpoint=url.href.replace(/\/$/,'');}
 }catch{configurationError='configuration_invalid';}
 const missing=[...(!baseUrl?['GENERATION_API_BASE_URL']:[]),...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'ark-native',endpoint,mapping})).digest('hex');
 const metadata={configured,protocol:'ark-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['video.generate']:[],video:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{modes:entry.modes,supportsDraft:entry.supportsDraft===true,supportsDraftTask:entry.supportsDraftTask===true,mediaTransport:entry.mediaTransport||{image:imageMimes,audio:audioMimes},maxCount:1}])),references:true,textReferences:true,remoteRecovery:true,remoteCancellation:false,verified:'local-contract-only'}};
 function resolve(request){
  if(!configured)throw failure('Ark API 尚未配置，请检查服务端地址、Key 与模型能力映射','configuration_required');
  if(!object(request)||request.kind!=='video.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw failure('Ark 仅支持不超过 64 MiB 的视频生成请求');
  const p=request.parameters||{},wire=p.providerParameters||{};
  if(!object(p)||!object(wire))throw failure('视频生成参数无效');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&own(mapping,alias)?mapping[alias]:null;
  if(!entry)throw failure('当前视频展示模型尚未映射到 Ark 真实型号','configuration_required');
  if(p.modelId!==undefined&&p.modelId!==alias||p.model!==undefined&&(own(mapping,p.model)||p.modelId===undefined)&&p.model!==alias)throw failure('视频模型标识不一致');
  const allowedTop=new Set(['providerParameters','model','modelId','count','times','prompt','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout','mode','videoMode','variant','ratio','aspectRatio','aspect','quality','resolution','duration','audio','generateAudio','audioLabel','generateMode','draft','draftVideoId','draftEstimateMedia','referenceBindings','referenceOrder','refs','subjects','subjectPrompt','promptReferenceBindings','camera','lens','focal','aperture','thinking']);
  if(Object.keys(p).some(key=>!allowedTop.has(key)))throw failure('视频请求包含 Ark 适配尚未支持的参数');
  const allowedWire=new Set(['model','modelType','variant','aspectRatio','resolution','duration','generateAudio','times','draft','draft_video_id']);
  if(Object.keys(wire).some(key=>!allowedWire.has(key)))throw failure('供应商视频参数尚未支持，不会忽略后提交');
  for(const [key,value]of Object.entries({camera:'Sony Venice',lens:'Zeiss Ultra Prime',focal:'24mm',aperture:'ƒ/4',thinking:'high'}))if(p[key]!==undefined&&p[key]!==value)throw failure('Ark 不支持自定义相机/镜头/思考强度参数');
  if(p.generateMode!==undefined&&p.generateMode!==null&&p.generateMode!=='')throw failure('Ark 不支持当前生成质量模式');
  if(p.refs?.length||typeof request.prompt!=='string'&&request.prompt!==undefined)throw failure('素材须展开为 inputs，提示词须为文字');
  for(const value of [p.count,p.times,wire.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw failure('Ark 原生适配当前每个任务仅生成 1 个视频，请分别提交');
  const inputs=request.inputs||[];
  if(!Array.isArray(inputs)||inputs.some(input=>!object(input)||!['image','video','audio','text'].includes(input.type)))throw failure('视频参考素材类型无效');
  const finalId=wire.draft_video_id??p.draftVideoId;
  if(finalId!==undefined){
   if(entry.supportsDraftTask!==true)throw failure('当前 Ark 型号尚未配置样片转正式片能力','configuration_required');
   if(!isTaskId(finalId)||p.draftVideoId!==undefined&&p.draftVideoId!==finalId||inputs.length||request.prompt?.trim()||p.draft===true||wire.draft===true)throw failure('正式片必须只引用有效的样片任务 ID');
   if((wire.resolution??p.resolution??p.quality??'1080p')!=='1080p'||p.quality!==undefined&&p.quality!=='1080p'||p.resolution!==undefined&&p.resolution!=='1080p')throw failure('样片正式片仅支持 1080p');
   // These top-level values are inherited UI metadata. The prepared wire must
   // omit them because Ark rejects even identical repeated draft parameters.
   if(['aspectRatio','duration','generateAudio','modelType','variant'].some(key=>wire[key]!==undefined))throw failure('正式片不能重复发送样片的提示词、素材、时长、画幅或声音参数');
   return {model:entry.model,content:[{type:'draft_task',draft_task:{id:finalId}}],resolution:'1080p'};
  }
  if(p.subjects!==undefined){
   if(!Array.isArray(p.subjects)||p.subjects.some(subject=>!Array.isArray(subject.assets)||subject.assets.some(asset=>['image','video','audio'].includes(asset.type)&&!inputs.some(input=>input.type===asset.type&&input.url===asset.url))))throw failure('主体素材快照没有完整展开为输入');
  }
  const media=Object.fromEntries(['image','video','audio'].map(type=>[type,inputs.filter(input=>input.type===type)]));
  const mode=wire.modelType??p.videoMode??(!media.image.length&&!media.video.length&&!media.audio.length?'TEXT_TO_VIDEO':media.image.length===1&&!media.video.length&&!media.audio.length?'IMAGE_TO_VIDEO':'REFERENCE_TO_VIDEO');
  if(p.videoMode!==undefined&&p.videoMode!==mode||wire.variant!==undefined&&p.variant!==undefined&&wire.variant!==p.variant)throw failure('视频生成方式参数不一致');
  const profile=entry.modes[mode];if(!profile)throw failure('当前 Ark 型号尚未配置所选生成方式','configuration_required');
  const expectedFamily=['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO'].includes(mode)?'首尾帧':mode==='VIDEO_EDIT'?'视频编辑':'全能参考';
  if(p.mode!==undefined&&![expectedFamily,mode].includes(p.mode))throw failure('视频生成方式与供应商参数不一致');
  if(mode==='TEXT_TO_VIDEO'&&(media.image.length||media.video.length||media.audio.length)||mode==='IMAGE_TO_VIDEO'&&(media.image.length!==1||media.video.length||media.audio.length)||mode==='START_END_TO_VIDEO'&&(![1,2].includes(media.image.length)||media.video.length||media.audio.length))throw failure('视频生成方式与实际参考输入不一致');
  if(['REFERENCE_TO_VIDEO','VIDEO_EDIT'].includes(mode)){
   for(const type of ['image','video','audio'])if(media[type].length>(profile['max'+type[0].toUpperCase()+type.slice(1)+'s']||0))throw failure('参考素材超过当前 Ark 型号配置上限');
   if(mode==='VIDEO_EDIT'&&media.video.length!==1)throw failure('视频编辑需要且只能输入一个视频');
   if(profile.audioRequiresCompanion&&media.audio.length&&!media.image.length&&!media.video.length)throw failure('当前 Ark 型号的音频参考需要搭配图片或视频');
  }
  function select(keys){const values=keys.map(([source,key])=>source[key]).filter(value=>value!==undefined);if(values.some(value=>value!==values[0]))throw failure('视频规格与供应商参数不一致');return values[0];}
  const ratio=select([[wire,'aspectRatio'],[p,'ratio'],[p,'aspectRatio'],[p,'aspect']]);
  const resolution=select([[wire,'resolution'],[p,'quality'],[p,'resolution']]);
  const duration=select([[wire,'duration'],[p,'duration']]);
  const audio=select([[wire,'generateAudio'],[p,'audio'],[p,'generateAudio']]);
  const draft=select([[wire,'draft'],[p,'draft']]);
  const body={model:entry.model,content:[]};
  for(const [key,value,allowed]of [['ratio',ratio,profile.ratios],['resolution',resolution,profile.resolutions],['duration',duration,profile.durations]])if(value!==undefined){if(!allowed?.includes(value))throw failure('当前 Ark 型号尚未配置所选画幅、分辨率或时长','configuration_required');body[key]=value;}
  if(audio!==undefined){if(typeof audio!=='boolean'||profile.audio!==true)throw failure('当前 Ark 型号未配置生成声音控制能力','configuration_required');body.generate_audio=audio;}
  if(p.audioLabel!==undefined&&p.audioLabel!==(audio?'开启':'关闭'))throw failure('声音状态与供应商参数不一致');
  if(draft!==undefined){if(typeof draft!=='boolean'||draft&&entry.supportsDraft!==true)throw failure('当前 Ark 型号未配置样片能力','configuration_required');if(draft&&resolution!=='480p')throw failure('Ark 样片仅支持 480p');body.draft=draft;}
  if(profile.omniReferenceTaskType)body.omni_reference_task_type=profile.omniReferenceTaskType;
  for(const type of ['video','audio'])if(media[type].length){
   const range=profile[type+'DurationRange'];if(!range)throw failure('当前 Ark 型号未配置参考时长能力','configuration_required');
   const durations=media[type].map(input=>input.duration??(Number.isFinite(input.durationMs)?input.durationMs/1000:undefined));
   if(durations.some(n=>!Number.isFinite(n)||n<range.min||n>range.max)||durations.reduce((a,b)=>a+b,0)>range.totalMax)throw failure('参考音视频实际时长不符合 Ark 能力配置，不会自动截短');
  }
  let prompt=request.prompt||'';
  for(const input of inputs.filter(input=>input.type==='text')){if(typeof input.text!=='string'||!input.text.trim())throw failure('文本参考内容无效');if(!prompt.includes(input.text))prompt=input.text+'\n'+prompt;}
  prompt=prompt.replace(/\{\{(Image|Video|Audio)\s+(\d+)\}\}/g,(_token,type,index)=>{if(!media[type.toLowerCase()][Number(index)-1])throw failure('提示词媒体引用没有对应输入');return '@'+type.toLowerCase()+index;});
  if(prompt.includes('{{'))throw failure('提示词含有未展开的素材引用');
  if(!prompt.trim()&&!inputs.some(input=>input.type!=='text'))throw failure('请输入视频提示词或参考素材');
  if(prompt.length>32000)throw failure('视频提示词超过 32000 字符');
  if(prompt.trim())body.content.push({type:'text',text:prompt});
  for(const input of inputs.filter(input=>input.type!=='text')){
   let url=input.url;
   if(typeof url!=='string'||!url)throw failure('参考素材没有有效地址');
   if(url.startsWith('data:')){
    if(input.type==='video')throw failure('Ark 视频参考不支持内联本地视频，请先接入公网媒体上传');
    const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url),mimes=entry.mediaTransport?.[input.type]??(input.type==='image'?imageMimes:audioMimes);
    if(!match||!mimes.includes(match[1])||match[2].length%4)throw failure('Ark 内联参考格式未受支持，请使用 PNG/JPEG/WebP 图片或 WAV/MP3 音频');
    const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.toString('base64')!==match[2]||bytes.length>=(input.type==='image'?30:15)*1024*1024)throw failure('Ark 内联参考为空、编码无效或超过大小限制');
    if(input.type==='image'){
     const actual=inlineImage(input,body.content.length);if(actual.width<300||actual.height<300||actual.width>6000||actual.height>6000||actual.width/actual.height<0.4||actual.width/actual.height>2.5)throw failure('Ark 图片宽高须在 300–6000 像素且比例在 0.4–2.5');
    }else if(match[1]==='audio/wav'?bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE':bytes.length<4||!(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw failure('Ark 音频参考编码与 MIME 不符');
    // Browsers label MP3 bytes audio/mpeg; Ark documents audio/mp3 data URIs.
    if(match[1]==='audio/mpeg')url='data:audio/mp3;base64,'+match[2];
   }else url=httpsUrl(url);
   const expectedRole=input.type==='image'?(mode==='IMAGE_TO_VIDEO'||mode==='START_END_TO_VIDEO'?media.image.indexOf(input)===0?'first_frame':'last_frame':'reference_image'):input.type==='video'?'reference_video':'reference_audio';
   if(input.role!==undefined&&!['subject_reference',expectedRole].includes(input.role))throw failure('参考用途与视频生成方式不一致');
   body.content.push({type:input.type+'_url',[input.type+'_url']:{url},role:expectedRole});
  }
  return body;
 }
 async function read(method,id,body,signal){
  if(!configured)throw failure('Ark API 尚未配置','configuration_required');
  if(id!==undefined&&!isTaskId(id))throw failure('Ark 任务标识无效');
  const timed=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timed]):timed;
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=operation=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return operation();}),interrupted]);
  try{
   const response=await wait(()=>fetchImpl(endpoint+'/contents/generations/tasks'+(id?'/'+encodeURIComponent(id):''),{method,redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},signal:combined,...body?{body:JSON.stringify(body)}:{}}));
   if(!response.ok){response.body?.cancel().catch(()=>{});throw failure('Ark 请求状态未确认','unknown');}
   const declared=Number(response.headers?.get('content-length'));if(declared>1024*1024){response.body?.cancel().catch(()=>{});throw failure('Ark 响应超过安全上限','unknown');}
   if(!response.body?.getReader)throw failure('Ark 响应无法有界读取','unknown');
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)throw failure('Ark 响应超过安全上限','unknown');parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!object(value))throw failure('Ark 响应无效','unknown');return value;
  }catch{if(signal?.aborted)throw signal.reason;throw failure('Ark 请求状态未确认，请查询原任务；未自动重试','unknown');}
  finally{combined.removeEventListener('abort',abort);}
 }
 async function submit(request,{signal}={}){const body=resolve(request);if(signal?.aborted)throw signal.reason;const value=await read('POST',undefined,body,signal);if(!isTaskId(value.id))throw failure('Ark 未返回有效任务 ID；未自动重试','unknown');return {id:value.id,status:'queued',progress:0};}
 async function poll(id,{signal}={}){
  const value=await read('GET',id,undefined,signal);
  if(value.id!==id||!['queued','running','succeeded','failed','cancelled','expired'].includes(value.status))throw failure('Ark 返回的任务身份或状态未确认','unknown');
  if(value.status==='expired')return {id,status:'failed',code:'provider_expired',error:'Ark 任务已超过供应商执行期限'};
  if(['failed','cancelled'].includes(value.status))return {id,status:value.status,error:value.status==='failed'?'Ark 未完成视频生成':'Ark 已确认任务取消'};
  if(value.status!=='succeeded')return {id,status:value.status,progress:0};
  let url;try{url=httpsUrl(value.content?.video_url);}catch{throw failure('Ark 成功响应没有有效公网 HTTPS 视频结果','unknown');}
  return {id,status:'succeeded',outputs:[{type:'video',url,sourceFileId:id}]};
 }
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=1800000}={}){
  if(!Number.isFinite(timeout)||timeout<1||timeout>1800000||!Number.isFinite(pollInterval)||pollInterval<1||pollInterval>30000)throw failure('Ark 轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   const id=value.id;
   while(['queued','running'].includes(value.status)){
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(id,{signal:combined});
   }
   if(value.status!=='succeeded')throw failure('Ark 未完成视频生成',value.status);
   return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(!combined.aborted)throw error;throw failure('Ark 视频状态未确认，请查询原任务；未自动重试','unknown');}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate,isConfigured:()=>configured};
}
module.exports={createArkProvider,parseArkModelMap};
