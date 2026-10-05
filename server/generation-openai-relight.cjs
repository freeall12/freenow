'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');

const PROTOCOL='openai-relight-native',KIND='image.relight',SEMANTICS='parameter-prompt-edit';
const MODELS=['gpt-image-2','gpt-image-2-2026-04-21'],OUTPUT_SIZES=['auto','1024x1024','1536x1024','1024x1536'];
const MAX_RESPONSE_BYTES=64*1024*1024;
// Kept synchronous for provider creation. The contract test compares every
// coordinate and rim eligibility with the authoritative image-relight-core.mjs.
const angleRows=[
 ['front_0','right_45','right_90','right_rear_45','back_180','left_rear_45','left_90','left_45'],
 ['top_front_45','top_front_right_45','top_right_45','right_rear_top_45','top_rear_45','left_rear_top_45','top_left_45','top_front_left_45'],
 ['bottom_front_45','bottom_front_right_45','bottom_right_45','right_rear_bottom_45','bottom_rear_45','left_rear_bottom_45','bottom_left_45','bottom_front_left_45']
];
const ANGLES=angleRows.flatMap((row,i)=>row.map((key,j)=>({key,azimuthDeg:j*45,elevationDeg:[0,45,-45][i]}))).concat([
 {key:'top_90',azimuthDeg:0,elevationDeg:90},{key:'bottom_90',azimuthDeg:0,elevationDeg:-90}
]);
const BRIGHTNESS=[10,50,100],TEMPERATURE=[2000,3000,4000,5600,7000,8000];
const RIMS={back_0:{azimuthDeg:180,elevationDeg:0},top_back_45:{azimuthDeg:180,elevationDeg:45},low_back_45:{azimuthDeg:180,elevationDeg:-45}};
const RIM_ELIGIBLE=['front_0','left_90','right_90','top_90','bottom_90','top_front_45','left_45','right_45','top_front_left_45','top_front_right_45'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('独立 OpenAI 打光编辑状态未确认；未自动重试或重新提交','unknown');
const exactKeys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));

function parseOpenAIRelightModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(key=>key!==KIND))throw fail('打光模型映射只能使用精确 image.relight 操作别名','configuration_invalid');
 for(const entry of Object.values(map)){
  if(!exactKeys(entry,['kind','model','semantics','quality','outputSize'])||entry.kind!==KIND||!MODELS.includes(entry.model)||entry.semantics!==SEMANTICS||!['low','medium','high','auto'].includes(entry.quality)||!OUTPUT_SIZES.includes(entry.outputSize)){
   throw fail('请明确配置 GPT Image 2 的参数提示词编辑语义、质量与原生输出尺寸','configuration_invalid');
  }
 }
 return structuredClone(map);
}

function relightCapabilities(entry){
 return {
  kind:KIND,modelAlias:KIND,semantics:SEMANTICS,
  anglePresets:structuredClone(ANGLES),brightnessPercent:[...BRIGHTNESS],temperatureK:[...TEMPERATURE],
  rimPresets:structuredClone(RIMS),rimEligibleAngles:[...RIM_ELIGIBLE],
  inputMimeTypes:['image/png'],sourceRole:'source_image',maxInputImages:1,maxCount:1,promptEditable:false,
  inputCodec:'complete-noninterlaced-8bit-rgb-rgba-png',maxInputBytes:50*1024*1024-1,maxInputPixels:32*1024*1024,
  rejectedPNGMetadataChunks:['zTXt','iTXt','iCCP'],
  outputSize:entry.outputSize,quality:entry.quality,sizePolicy:'provider-native-output',
  preservesSourceBytes:true,aspectMatchGuaranteed:false,physicalLightingGuaranteed:false,tapNowEquivalent:false,
  verified:'official-schema-and-local-contract'
 };
}

function validateParameters(parameters){
 const keys=['angle','brightnessPercent','temperatureK','rimEnabled','rimPreset'];
 if(!exactKeys(parameters,keys)||Object.keys(parameters).length!==keys.length||!exactKeys(parameters.angle,['preset'])||Object.keys(parameters.angle).length!==1)throw fail('打光需要完整标准光位、亮度、色温和轮廓光参数，不接受额外字段');
 const angle=ANGLES.find(value=>value.key===parameters.angle.preset);
 if(!angle||!BRIGHTNESS.includes(parameters.brightnessPercent)||!TEMPERATURE.includes(parameters.temperatureK)||typeof parameters.rimEnabled!=='boolean'||!Object.hasOwn(RIMS,parameters.rimPreset))throw fail('打光参数不在原工具的标准光位和档位中');
 if(parameters.rimEnabled&&!RIM_ELIGIBLE.includes(angle.key))throw fail('此主光位不允许开启轮廓光，未更改参数或提交模型');
 return angle;
}

function compileRelightPrompt(parameters,source){
 const angle=validateParameters(parameters),rim=RIMS[parameters.rimPreset];
 const instructions={
  task:'Relight the single supplied source image through an image edit.',
  source:{widthPx:source.width,heightPx:source.height,composition:'Preserve the subject identity, scene geometry, framing, aspect ratio, textures and material appearance as far as the editing model allows. Do not crop or replace the scene.'},
  coordinateConvention:'Azimuth 0 degrees is front, 90 right, 180 back, 270 left. Positive elevation is above, negative below. At +90 or -90 elevation the light is directly overhead or underneath.',
  mainLight:{preset:angle.key,azimuthDeg:angle.azimuthDeg,elevationDeg:angle.elevationDeg,brightnessPercent:parameters.brightnessPercent,brightnessMeaning:'Requested relative main-light brightness on the original tool scale: 10 is dim, 50 is medium, 100 is bright; this is visual guidance, not a calibrated exposure multiplier.',temperatureK:parameters.temperatureK,temperatureMeaning:'Requested main-light color temperature in Kelvin. Lower values are warmer and amber; higher values are cooler and blue. 5600 K is daylight.'},
  rimLight:{enabled:parameters.rimEnabled,preset:parameters.rimPreset,azimuthDeg:rim.azimuthDeg,elevationDeg:rim.elevationDeg,instruction:parameters.rimEnabled?'Add a rear edge/rim light from this specified direction, consistent with the main light.':'Do not add a rim light. The recorded preset and coordinates are inactive because enabled is false.'},
  rendering:'Create natural highlights, shading and shadows consistent with all specified lighting directions and temperature; change lighting rather than inventing objects or changing the composition.',
  implementation:'These are parameter-derived editing instructions. No physically calibrated lighting or exact pixel or output aspect preservation is guaranteed.'
 };
 return 'Apply all of the following structured lighting instructions to the source image:\n'+JSON.stringify(instructions,null,2);
}

async function abortable(operation,signal,disposeLate){
 if(signal?.aborted)throw signal.reason;
 let stop;
 const stopped=new Promise((_,reject)=>{stop=()=>reject(signal.reason||unknown());signal?.addEventListener('abort',stop,{once:true});});
 const pending=Promise.resolve().then(()=>{if(signal?.aborted)throw signal.reason;return operation();}).then(value=>{
  if(signal?.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});throw signal.reason;}
  return value;
 });
 try{return await Promise.race([pending,stopped]);}finally{signal?.removeEventListener('abort',stop);}
}

function createOpenAIRelightProvider({apiKey='',baseUrl='',modelMap,client,fetchImpl=fetch,timeoutMs=600000}={}){
 const credentials=new Set([apiKey,typeof client?.apiKey==='string'?client.apiKey:''].filter(Boolean));
 const checkCredentials=value=>{for(const secret of credentials)assertCredentialFree(value,secret);};
 const checkCredentialBytes=bytes=>{for(const secret of credentials)assertCredentialFreeBytes(bytes,secret);};
 function checkedPNG(bytes){
  checkCredentialBytes(bytes);
  // Match the existing panorama boundary: independent metadata compression
  // is not inspected by the pixel decoder, so reject it instead of forwarding
  // or publishing unreviewed text. Do not strip or rewrite the source bytes.
  let offset=8;
  while(offset+12<=bytes.length){
   const length=bytes.readUInt32BE(offset),end=offset+12+length;
   if(end>bytes.length||['zTXt','iTXt','iCCP'].includes(bytes.toString('ascii',offset+4,offset+8)))throw fail('打光 PNG 不支持未审阅的压缩文本或色彩配置 metadata，未接收图片');
   offset=end;
  }
  const decoded=decodePNG(bytes);
  checkCredentialBytes(decoded.pixels);
  return decoded;
 }
 let map={},origin='',configurationError=null;
 try{
  map=parseOpenAIRelightModelMap(modelMap);origin=endpoint(baseUrl||client?.baseURL||'https://api.openai.com/v1');
  if(baseUrl&&client?.baseURL&&origin!==endpoint(client.baseURL)||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();
  checkCredentials(map);checkCredentials(origin);
 }catch{configurationError='configuration_invalid';map={};origin='';}
 const missing=[...(!apiKey&&!client?['GENERATION_API_KEY']:[]),...(!Object.keys(map).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:PROTOCOL,origin,map})).digest('hex');
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{
  kinds:map[KIND]?[KIND]:[],models:map[KIND]?{[KIND]:{kind:KIND}}:{},
  ...(map[KIND]?{relight:relightCapabilities(map[KIND])}:{}),
  references:false,remoteRecovery:false,remoteCancellation:false,verified:'official-schema-and-local-contract'
 }};
 const guarded=protectGenerationFetch(fetchImpl);
 async function boundedFetch(url,options={}){
  const headers=new Headers(options.headers),authorization=headers.get('authorization');
  if(authorization?.startsWith('Bearer '))credentials.add(authorization.slice(7));
  headers.set('Accept-Encoding','identity');
  let response,reader,finished=false;
  try{
   response=await abortable(()=>guarded(url,{...options,headers}),options.signal,late=>late.body?.cancel());
   if(response.redirected||!response.body)throw unknown();
   const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
   if(mime!=='application/json'||encoding&&encoding!=='identity'||length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>MAX_RESPONSE_BYTES||!Number(length)))throw unknown();
   reader=response.body.getReader();const parts=[];let size=0;
   for(;;){const next=await abortable(()=>reader.read(),options.signal);if(next.done)break;if(!(next.value instanceof Uint8Array)||(size+=next.value.byteLength)>MAX_RESPONSE_BYTES)throw unknown();parts.push(Buffer.from(next.value));}
   if(!size||length!==null&&Number(length)!==size)throw unknown();
   const bytes=Buffer.concat(parts);checkCredentials(bytes.toString('utf8'));finished=true;
   return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  }finally{
   if(!finished){if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}
   try{reader?.releaseLock();}catch{}
  }
 }
 let sdk=client?.withOptions?client.withOptions({fetch:boundedFetch,maxRetries:0}):client;
 function resolve(request){
  if(!configured)throw fail('独立 OpenAI 打光编辑尚未配置 Key 与显式参数提示词编辑能力','configuration_required');
  if(!exactKeys(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'])||request.kind!==KIND||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw fail('打光请求无效、含额外字段或超过 64 MiB');
  checkCredentials(request);
  if(request.prompt!==''||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('打光只接受空额外提示词、一张来源完整图和单个结果');
  validateParameters(request.parameters);
  if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('打光需要且仅接受一张来源完整图');
  const input=request.inputs[0];
  if(!exactKeys(input,['type','role','url','nodeId','width','height'])||input.type!=='image'||input.role!=='source_image')throw fail('打光来源必须明确标记为 source_image，不接受额外参考或其他素材');
  const image=inlineImage(input,0);
  if(image.mime!=='image/png')throw fail('打光原生上传需要经原尺寸解码转换的完整 PNG');
  const decoded=checkedPNG(image.bytes);
  if(input.width!==undefined&&input.width!==decoded.width||input.height!==undefined&&input.height!==decoded.height)throw fail('打光来源声明尺寸与真实 PNG 不一致');
  if(request.sourceNodeId!==undefined&&input.nodeId!==undefined&&request.sourceNodeId!==input.nodeId)throw fail('打光来源图片与源节点身份不一致');
  const entry=map[KIND];
  return {image,body:{model:entry.model,prompt:compileRelightPrompt(request.parameters,image),n:1,size:entry.outputSize,quality:entry.quality,output_format:'png',stream:false}};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  try{
   if(!sdk){const OpenAI=require('openai');sdk=new OpenAI({apiKey,baseURL:origin,fetch:boundedFetch,maxRetries:0,timeout:timeoutMs});}
   const {toFile}=require('openai');
   const upload=await abortable(()=>toFile(prepared.image.bytes,'source.png',{type:'image/png'}),combined);
   const value=await abortable(()=>sdk.images.edit({...prepared.body,image:[upload]},{signal:combined,maxRetries:0,timeout:timeoutMs}),combined);
   checkCredentials(value);
   if(!object(value)||!Array.isArray(value.data)||value.data.length!==1)throw unknown();
   const item=value.data[0];
   if(!object(item)||typeof item.b64_json!=='string'||item.b64_json.length>64*1024*1024||item.url!==undefined)throw unknown();
   const image=inlineImage({url:'data:image/png;base64,'+item.b64_json},0);
   const decoded=checkedPNG(image.bytes);
   // auto sizes belong to the provider. Record the actual image dimensions,
   // never a guessed source size or an unproven aspect-preservation guarantee.
   if(prepared.body.size!=='auto'&&prepared.body.size!==decoded.width+'x'+decoded.height)throw unknown();
   if(combined.aborted)throw combined.reason;
   return {status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,'+item.b64_json,width:decoded.width,height:decoded.height}]};
  }catch(error){
   if(signal?.aborted)throw signal.reason;
   const OpenAI=require('openai');
   if(error instanceof OpenAI.APIError&&Number.isInteger(error.status)&&error.status>=400&&error.status<500&&![408,409].includes(error.status)){
    try{checkCredentials(error.message);checkCredentials(error.error);}catch{throw unknown();}
    return {status:'failed',code:'provider_rejected',error:'OpenAI 已拒绝打光编辑请求，请检查账号资格、额度或参数'};
   }
   throw unknown();
  }finally{clearTimeout(timer);controller.abort();}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createOpenAIRelightProvider,parseOpenAIRelightModelMap,compileRelightPrompt,MAX_RESPONSE_BYTES};
