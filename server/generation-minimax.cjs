'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const failure=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const taskId=value=>typeof value==='string'&&value!=='.'&&value!=='..'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value);
const modes=['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO','REFERENCE_TO_VIDEO'];
const ratios=['21:9','16:9','4:3','1:1','3:4','9:16'];
const mediaTransport={image:['image/png','image/jpeg','image/webp','image/heic','image/heif'],video:['video/mp4','video/quicktime'],audio:['audio/wav','audio/mp3','audio/mpeg']};
const specification=model=>({resolutions:model==='MiniMax-H3'?['768P','2K']:['480P','768P'],durations:Array.from({length:model==='MiniMax-H3'?12:11},(_,i)=>i+(model==='MiniMax-H3'?4:5))});
function httpsUrl(value){
 let url;try{url=new URL(value);}catch{throw failure('MiniMax 素材须为公网 HTTPS、mm_file 或受支持的内联媒体');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168)\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host))throw failure('MiniMax 媒体须为不含凭据的公网 HTTPS 地址');
 return url.href;
}
function parseMiniMaxModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value||{};
 if(!object(map))throw failure('MiniMax 模型映射无效','configuration_invalid');
 for(const [alias,entry]of Object.entries(map)){
  if(!alias||!object(entry)||entry.kind!=='video.generate'||!['MiniMax-H3','MiniMax-H3-Max'].includes(entry.model)||!object(entry.modes)||!Object.keys(entry.modes).length||Object.keys(entry).some(key=>!['kind','model','modes','mediaTransport'].includes(key)))throw failure('MiniMax 视频型号与模式须显式配置','configuration_invalid');
  if(entry.mediaTransport!==undefined&&(!object(entry.mediaTransport)||Object.entries(entry.mediaTransport).some(([type,mimes])=>!mediaTransport[type]||!Array.isArray(mimes)||mimes.some(mime=>!mediaTransport[type].includes(mime)))))throw failure('MiniMax 素材传输配置无效','configuration_invalid');
  for(const [mode,profile]of Object.entries(entry.modes)){
   const frame=['IMAGE_TO_VIDEO','START_END_TO_VIDEO'].includes(mode),spec=specification(entry.model);
   if(!modes.includes(mode)||!object(profile)||Object.keys(profile).some(key=>!['ratios','resolutions','durations','audio','maxImages','maxVideos','maxAudios','audioRequiresCompanion','videoDurationRange','audioDurationRange','maxMedia'].includes(key)))throw failure('MiniMax 生成方式配置无效','configuration_invalid');
   for(const [key,allowed]of [['resolutions',spec.resolutions],['durations',spec.durations],['ratios',frame?['adaptive']:mode==='TEXT_TO_VIDEO'?ratios:['adaptive',...ratios]]])if(key!=='ratios'||profile[key]!==undefined){if(!Array.isArray(profile[key])||!profile[key].length||profile[key].some(item=>!allowed.includes(item)))throw failure('MiniMax 画幅、分辨率或时长超出官方规格','configuration_invalid');}
   if(mode==='TEXT_TO_VIDEO'&&!profile.ratios?.length||profile.audio!==undefined&&profile.audio!==false||profile.audioRequiresCompanion!==undefined&&typeof profile.audioRequiresCompanion!=='boolean')throw failure('MiniMax 没有音轨开关 API；文生视频须配置具体画幅','configuration_invalid');
   for(const [key,max]of [['maxImages',frame?mode==='IMAGE_TO_VIDEO'?1:2:mode==='REFERENCE_TO_VIDEO'?9:0],['maxVideos',mode==='REFERENCE_TO_VIDEO'?3:0],['maxAudios',mode==='REFERENCE_TO_VIDEO'?3:0],['maxMedia',12]])if(profile[key]!==undefined&&(!Number.isSafeInteger(profile[key])||profile[key]<0||profile[key]>max))throw failure('MiniMax 素材数量超过官方上限','configuration_invalid');
   for(const type of ['video','audio']){
    const range=profile[type+'DurationRange'];
    if((profile['max'+type[0].toUpperCase()+type.slice(1)+'s']||0)>0&&!range)throw failure('MiniMax 参考时长范围须配置','configuration_invalid');
    if(range!==undefined&&(!object(range)||Object.keys(range).some(key=>!['min','max','totalMax'].includes(key))||![range.min,range.max,range.totalMax].every(Number.isFinite)||range.min<2||range.min>range.max||range.max>15||range.max>range.totalMax||range.totalMax>15))throw failure('MiniMax 参考时长范围超过官方上限','configuration_invalid');
   }
  }
 }
 return structuredClone(map);
}
function createMiniMaxProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch}={}){
 let mapping={},endpoint='',configurationError=null;
 try{mapping=parseMiniMaxModelMap(modelMap);if(baseUrl){const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();endpoint=url.origin;}}catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!baseUrl?['GENERATION_API_BASE_URL']:[]),...(!apiKey?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'minimax-native',endpoint,mapping})).digest('hex');
 const metadata={configured,protocol:'minimax-native',missing,configurationError,capabilities:{kinds:Object.keys(mapping).length?['video.generate']:[],models:Object.fromEntries(Object.keys(mapping).map(alias=>[alias,{kind:'video.generate'}])),video:Object.fromEntries(Object.entries(mapping).map(([alias,entry])=>[alias,{modes:entry.modes,supportsDraft:false,supportsDraftTask:false,mediaTransport:entry.mediaTransport||mediaTransport,maxCount:1,maxMedia:12}])),references:true,textReferences:true,remoteRecovery:true,remoteCancellation:false,verified:'local-contract-only'}};
 function resolve(request){
  if(!configured)throw failure('MiniMax H3 尚未配置服务端地址、Key 与视频能力映射','configuration_required');
  if(!object(request)||request.kind!=='video.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw failure('MiniMax 原生适配仅支持不超过 64 MiB 的视频请求');
  const p=request.parameters||{},wire=p.providerParameters||{};
  if(!object(p)||!object(wire))throw failure('MiniMax 视频参数无效');
  const alias=wire.model??p.modelId??p.model,entry=typeof alias==='string'&&Object.hasOwn(mapping,alias)?mapping[alias]:null;
  if(!entry)throw failure('视频展示型号尚未配置 MiniMax 原生映射','configuration_required');
  if(p.modelId!==undefined&&p.modelId!==alias||p.model!==undefined&&(Object.hasOwn(mapping,p.model)||p.modelId===undefined)&&p.model!==alias)throw failure('MiniMax 展示型号标识不一致');
  const top=['providerParameters','model','modelId','count','times','prompt','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout','mode','videoMode','variant','ratio','aspectRatio','aspect','quality','resolution','duration','audio','generateAudio','audioLabel','generateMode','draft','referenceBindings','referenceOrder','refs','subjects','subjectPrompt','promptReferenceBindings','camera','lens','focal','aperture','thinking','extra'];
  if(Object.keys(p).some(key=>!top.includes(key))||Object.keys(wire).some(key=>!['model','modelType','variant','aspectRatio','resolution','duration','generateAudio','times','generateMode','draft','extra'].includes(key)))throw failure('MiniMax 不支持这些视频参数，未忽略后提交');
  for(const [key,value]of Object.entries({camera:'Sony Venice',lens:'Zeiss Ultra Prime',focal:'24mm',aperture:'ƒ/4',thinking:'high'}))if(p[key]!==undefined&&p[key]!==value)throw failure('MiniMax 不支持自定义相机、镜头或思考强度参数');
  if(p.audio!==undefined||p.generateAudio!==undefined||wire.generateAudio!==undefined||p.draft!==undefined&&p.draft!==false||wire.draft!==undefined&&wire.draft!==false||p.generateMode!=null&&p.generateMode!==''||wire.generateMode!=null&&wire.generateMode!=='')throw failure('MiniMax 没有音轨开关、样片或当前质量模式参数');
  if(p.audioLabel!==undefined&&p.audioLabel!=='关闭'||p.refs!==undefined&&(!Array.isArray(p.refs)||p.refs.length)||typeof request.prompt!=='string'&&request.prompt!==undefined)throw failure('MiniMax 视频提示词或参考参数无效');
  for(const value of [p.count,p.times,wire.times,p.batch_count,p.canvasResults?.targetNodeIds?.length])if(value!==undefined&&value!==1)throw failure('MiniMax 每个任务只生成一个视频，请分别提交');
  const inputs=request.inputs||[];if(!Array.isArray(inputs)||inputs.some(input=>!object(input)||!['image','video','audio','text'].includes(input.type)))throw failure('MiniMax 参考素材类型无效');
  if(inputs.some(input=>input.clip!==undefined||input.trim!==undefined))throw failure('MiniMax 选区视频须先实际裁片后提交，未忽略裁剪选区');
  if(p.subjects!==undefined&&(!Array.isArray(p.subjects)||p.subjects.some(subject=>!Array.isArray(subject.assets)||subject.assets.some(asset=>['image','video','audio'].includes(asset.type)&&!inputs.some(input=>input.type===asset.type&&input.url===asset.url)))))throw failure('主体素材须完整展开为输入');
  const media=Object.fromEntries(['image','video','audio'].map(type=>[type,inputs.filter(input=>input.type===type)]));
  const mode=wire.modelType??p.videoMode??(!media.image.length&&!media.video.length&&!media.audio.length?'TEXT_TO_VIDEO':media.image.length===1&&!media.video.length&&!media.audio.length?'IMAGE_TO_VIDEO':'REFERENCE_TO_VIDEO');
  if(p.videoMode!==undefined&&p.videoMode!==mode||wire.variant!==undefined&&p.variant!==undefined&&wire.variant!==p.variant)throw failure('MiniMax 视频生成方式不一致');
  const profile=typeof mode==='string'&&Object.hasOwn(entry.modes,mode)?entry.modes[mode]:null;if(!profile)throw failure('MiniMax 映射没有配置所选视频生成方式','configuration_required');
  const variant=wire.variant??p.variant;if(variant!==undefined&&variant!=={TEXT_TO_VIDEO:'text',IMAGE_TO_VIDEO:'image',START_END_TO_VIDEO:'start_end',REFERENCE_TO_VIDEO:'reference'}[mode])throw failure('MiniMax 视频变体与生成方式不一致');
  const frame=['IMAGE_TO_VIDEO','START_END_TO_VIDEO'].includes(mode),expectedFamily=mode==='REFERENCE_TO_VIDEO'?'全能参考':'首尾帧';
  if(p.mode!==undefined&&![mode,expectedFamily].includes(p.mode))throw failure('MiniMax 生成方式与界面参数不一致');
  if(mode==='TEXT_TO_VIDEO'&&(media.image.length||media.video.length||media.audio.length)||frame&&(media.video.length||media.audio.length||!(mode==='IMAGE_TO_VIDEO'?media.image.length===1:[1,2].includes(media.image.length))))throw failure('MiniMax 生成方式与实际素材不一致');
  if(mode==='REFERENCE_TO_VIDEO'){
   if(!media.image.length&&!media.video.length&&!media.audio.length)throw failure('MiniMax 参考模式需要实际素材，请选择文生视频');
   for(const type of ['image','video','audio'])if(media[type].length>(profile['max'+type[0].toUpperCase()+type.slice(1)+'s']||0))throw failure('MiniMax 参考素材超过已配置能力');
   if(inputs.filter(input=>input.type!=='text').length>(profile.maxMedia??12))throw failure('MiniMax 混合参考最多 12 个媒体');
   if(profile.audioRequiresCompanion&&media.audio.length&&!media.image.length&&!media.video.length)throw failure('当前 MiniMax 映射要求音频搭配图像或视频');
  }
  function select(keys){const values=keys.map(([source,key])=>source[key]).filter(value=>value!==undefined);if(values.some(value=>JSON.stringify(value)!==JSON.stringify(values[0])))throw failure('MiniMax 视频规格与供应商参数不一致');return values[0];}
  const resolution=select([[wire,'resolution'],[p,'quality'],[p,'resolution']]),duration=select([[wire,'duration'],[p,'duration']]),ratio=select([[wire,'aspectRatio'],[p,'ratio'],[p,'aspectRatio'],[p,'aspect']]);
  if(!profile.resolutions.includes(resolution)||!profile.durations.includes(duration))throw failure('MiniMax 请求须指定已配置的分辨率与整数时长','configuration_required');
  if(mode==='TEXT_TO_VIDEO'&&(!ratio||!profile.ratios?.includes(ratio))||ratio!==undefined&&!(profile.ratios??(frame?['adaptive']:['adaptive',...ratios])).includes(ratio))throw failure('MiniMax 不支持所选画幅；首尾帧画幅由图像决定','configuration_required');
  for(const type of ['video','audio'])if(media[type].length){const range=profile[type+'DurationRange'],durations=media[type].map(input=>input.duration??(Number.isFinite(input.durationMs)?input.durationMs/1000:undefined));if(!range||durations.some(value=>!Number.isFinite(value)||value<range.min||value>range.max)||durations.reduce((sum,value)=>sum+value,0)>range.totalMax)throw failure('MiniMax 参考音视频须提供有效时长，未自动截短');}
  let prompt=request.prompt||'';
  for(const input of inputs.filter(input=>input.type==='text')){if(typeof input.text!=='string'||!input.text.trim())throw failure('文本参考内容无效');if(!prompt.includes(input.text))prompt=input.text+'\n'+prompt;}
  // The official examples use natural-language reference image/video/audio 1.
  prompt=prompt.replace(/\{\{(Image|Video|Audio)\s+(\d+)\}\}/g,(_token,type,index)=>{if(!media[type.toLowerCase()][Number(index)-1])throw failure('提示词引用没有对应 MiniMax 素材');return 'reference '+type.toLowerCase()+' '+index;});
  if(prompt.includes('{{')||!prompt.trim()||[...prompt].length>7000)throw failure('MiniMax 每次须提供不超过 7000 字符的非空提示词');
  const body={model:entry.model,content:[{type:'text',text:prompt}],resolution,duration,...ratio!==undefined?{ratio}:{}};
  const uploads=[];
  for(const input of inputs.filter(input=>input.type!=='text')){
   const type=input.type,index=media[type].indexOf(input),defaultRole=type==='image'?(frame?(index===0?'first_frame':'last_frame'):'reference_image'):'reference_'+type;
   const role=input.role===undefined||input.role==='subject_reference'?defaultRole:input.role;
   if(type==='image'&&frame?!['first_frame','last_frame'].includes(role):role!==defaultRole)throw failure('MiniMax 素材用途与所选视频生成方式不一致');
   if(body.content.some(item=>frame&&item.role===role))throw failure('MiniMax 每个首尾帧角色只能提供一张图像');
   let url=input.url;if(typeof url!=='string'||!url)throw failure('MiniMax 素材缺少地址');
   for(const key of ['width','height'])if(input[key]!==undefined&&(!Number.isInteger(input[key])||input[key]<256||input[key]>5760))throw failure('MiniMax 媒体尺寸须为 256–5760 像素');
   if(input.width&&input.height&&(input.width/input.height<0.4||input.width/input.height>2.5))throw failure('MiniMax 媒体比例须在 0.4–2.5');
   if(type==='video'&&input.fps!==undefined&&(!Number.isFinite(input.fps)||input.fps<23.976||input.fps>60))throw failure('MiniMax 参考视频帧率须在 23.976–60');
   if(url.startsWith('data:')){
    const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url),mimes=entry.mediaTransport?.[type]??mediaTransport[type];
    if(!match||!mimes.includes(match[1])||match[2].length%4)throw failure('MiniMax 内联媒体 MIME 或 Base64 不受支持');
    const bytes=Buffer.from(match[2],'base64'),max={image:30,video:50,audio:15}[type]*1024*1024;
    if(!bytes.length||bytes.length>max||bytes.toString('base64')!==match[2])throw failure('MiniMax 内联素材为空、编码无效或超出官方大小限制');
    if(type==='image'&&['image/png','image/jpeg','image/webp'].includes(match[1])){const actual=inlineImage(input,index);if(actual.width<256||actual.height<256||actual.width>5760||actual.height>5760||actual.width/actual.height<0.4||actual.width/actual.height>2.5)throw failure('MiniMax 图片尺寸或比例超出官方限制');}
    else if(type==='image'){if(bytes.length<16||bytes.toString('ascii',4,8)!=='ftyp')throw failure('MiniMax HEIC/HEIF 文件头无效');}
    else if(type==='video'){if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw failure('MiniMax MP4/MOV 文件头无效');}
    else if(match[1]==='audio/wav'?bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE':bytes.length<4||!(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw failure('MiniMax 音频文件头与 MIME 不符');
    if(match[1]==='audio/mpeg')url='data:audio/mp3;base64,'+match[2];
    // MOV has an official upload format, but no documented data URI format.
    if(match[1]==='video/quicktime'){uploads.push({index:body.content.length,bytes,mime:match[1],name:'reference-'+(index+1)+'.mov'});url='';}
   }else if(url.startsWith('mm_file://')){if(!/^mm_file:\/\/\d{1,20}$/.test(url))throw failure('MiniMax 文件引用无效');}else url=httpsUrl(url);
   body.content.push({type:type+'_url',[type+'_url']:{url},role});
  }
  const extra=select([[wire,'extra'],[p,'extra']]);
  if(extra!==undefined){if(entry.model!=='MiniMax-H3-Max'||!object(extra)||Object.keys(extra).some(key=>key!=='prompt_expansion_mode')||extra.prompt_expansion_mode!==undefined&&!['disabled','balanced','quality'].includes(extra.prompt_expansion_mode))throw failure('MiniMax 额外参数仅支持 H3 Max 的官方提示词扩展枚举');body.extra=extra;}
  if(Buffer.byteLength(JSON.stringify(body))>64*1024*1024)throw failure('MiniMax 原生请求超过 64 MiB；请使用公网地址或 mm_file');
  return {body,uploads};
 }
 async function read(method,path,body,signal){
  if(!configured)throw failure('MiniMax H3 API 尚未配置','configuration_required');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const abort=()=>rejectAbort(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  const wait=fn=>Promise.race([Promise.resolve().then(()=>{if(combined.aborted)throw combined.reason;return fn();}),interrupted]);
  try{
   const multipart=body instanceof FormData;
   const response=await wait(()=>fetchImpl(endpoint+path,{method,redirect:'error',headers:{Authorization:'Bearer '+apiKey,...multipart?{}:{'Content-Type':'application/json'}},signal:combined,...body?{body:multipart?body:JSON.stringify(body)}:{}}));
   if(!response.ok||Number(response.headers?.get('content-length'))>1024*1024){response.body?.cancel().catch(()=>{});throw Error();}
   if(!response.body?.getReader)throw Error();
   const reader=response.body.getReader(),parts=[];let bytes=0,complete=false;
   try{for(;;){const chunk=await wait(()=>reader.read());if(chunk.done){complete=true;break;}bytes+=chunk.value.byteLength;if(bytes>1024*1024)throw Error();parts.push(Buffer.from(chunk.value));}}
   finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!object(value))throw Error();return value;
  }catch{if(signal?.aborted)throw signal.reason;throw failure('MiniMax 请求状态未确认，请查询原任务；未自动重试','unknown');}
  finally{combined.removeEventListener('abort',abort);}
 }
 async function submit(request,{signal}={}){
  const {body,uploads}=resolve(request);if(signal?.aborted)throw signal.reason;
  for(const upload of uploads){const form=new FormData();form.set('purpose','video_generation_input');form.set('file',new Blob([upload.bytes],{type:upload.mime}),upload.name);const value=await read('POST','/v1/files/upload',form,signal),id=value.file?.file_id;if(value.base_resp?.status_code!==0||!(typeof id==='string'&&/^\d{1,20}$/.test(id)||Number.isSafeInteger(id)&&id>0))throw failure('MiniMax 上传文件身份未确认；未自动重试','unknown');body.content[upload.index].video_url.url='mm_file://'+id;}
  const value=await read('POST','/v2/video_generation',body,signal);
  if(!taskId(value.task_id))throw failure('MiniMax 未返回有效视频任务 ID；未自动重试','unknown');
  return {id:value.task_id,status:'queued',progress:0};
 }
 async function poll(id,{signal}={}){
  if(!taskId(id))throw failure('MiniMax 原任务标识无效','provider_identity_mismatch');
  const value=await read('GET','/v2/query/video_generation/'+encodeURIComponent(id),undefined,signal),task=value.task;
  if(!object(task)||task.id!==id||!['queued','running','succeeded','failed','cancelled'].includes(task.status)||task.model!==undefined&&!Object.values(mapping).some(entry=>entry.model===task.model)||task.task_type!==undefined&&task.task_type!=='generation'||task.modality!==undefined&&task.modality!=='video')throw failure('MiniMax 返回的原任务身份或状态未确认','unknown');
  if(task.status!=='succeeded'&&task.content?.url!==undefined)throw failure('MiniMax 非成功状态附带结果，状态未确认','unknown');
  if(['failed','cancelled'].includes(task.status))return {id,status:task.status,code:'provider_'+task.status,error:task.status==='failed'?'MiniMax 未完成视频生成':'MiniMax 已确认原视频任务取消'};
  if(task.status!=='succeeded')return {id,status:task.status,progress:0};
  let url;try{url=httpsUrl(task.content?.url);}catch{throw failure('MiniMax 成功响应没有有效 HTTPS 视频结果','unknown');}
  return {id,status:'succeeded',outputs:[{type:'video',url,sourceFileId:id}]};
 }
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=10000,timeout=1800000}={}){
  if(!Number.isInteger(timeout)||timeout<1||timeout>1800000||!Number.isInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw failure('MiniMax 轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{let value=await submit(request,{signal:combined});const id=value.id;onTaskIdentity(id);
   while(['queued','running'].includes(value.status)){onProgress(0);await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});value=await poll(id,{signal:combined});}
   if(value.status!=='succeeded')throw failure('MiniMax 未完成视频生成',value.status);return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw failure('MiniMax 视频状态未确认，请查询原任务；未自动重试','unknown');throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,generate,isConfigured:()=>configured};
}
module.exports={createMiniMaxProvider,parseMiniMaxModelMap};
