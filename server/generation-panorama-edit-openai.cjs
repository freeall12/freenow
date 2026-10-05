'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');

const {assertPanoramaEditParameters,validatePerspectiveSource,preparePerspectiveEdit,reprojectPerspectiveEdit}=require('./generation-panorama-edit-geometry.cjs');
const PROTOCOL='openai-panorama-edit-native',KIND='panorama.edit',SEMANTICS='perspective-mask-reproject';
const MAX_RESPONSE_BYTES=64*1024*1024;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code,providerDispatched:false});
const unknown=()=>Object.assign(Error('独立全景局部编辑状态未确认；未自动重试或重新提交'),{code:'unknown'});
const exactKeys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
function parsePanoramaEditModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(key=>key!==KIND))throw fail('全景编辑只能使用精确 panorama.edit 操作别名','configuration_invalid');
 for(const e of Object.values(map))if(!exactKeys(e,['kind','model','semantics','quality','cropSize'])||Object.keys(e).length!==5||e.kind!==KIND||!['gpt-image-2','gpt-image-2-2026-04-21'].includes(e.model)||e.semantics!==SEMANTICS||!['low','medium','high','auto'].includes(e.quality)||e.cropSize!=='1024x1024')throw fail('请显式配置独立全景透视蒙版编辑语义、模型、质量和 1024 crop','configuration_invalid');
 return structuredClone(map);
}
function panoramaEditCapabilities(e){return {
 kind:KIND,modelAlias:KIND,semantics:SEMANTICS,label:'独立 OpenAI 全景局部编辑',tapNowEquivalent:false,
 inputMimeTypes:['image/png'],inputCodec:'complete-noninterlaced-8bit-rgb-rgba-png',rejectedPNGMetadataChunks:['zTXt','iTXt','iCCP'],
 maxInputBytes:32*1024*1024,maxInputPixels:2048*1024,maxInputImages:1,maxCount:1,sourceProjection:'equirectangular',sourceWidth:2048,sourceHeight:1024,
 regionPolicy:'visible-convex-four-unit-directions',minRegions:1,maxRegions:32,globalEditing:false,
 cropSize:e.cropSize,quality:e.quality,mask:'alpha-zero',maskPrecision:'provider-guidance',maxMaskBytes:4*1024*1024,
 sampling:'nearest-pixel-center',edgePolicy:'hard-spherical-pixel-center-no-feather',outsideRegionPixels:'exact-source-rgba',
 outputProjection:'equirectangular',outputSize:'2048x1024',composite:true,verified:'official-sdk-schema-and-local-contract'
 };}
function compilePrompt(prompt){return 'Edit only the area where the supplied PNG mask alpha is zero. This is a perspective crop of a 360 degree scene. Preserve viewpoint, geometry and natural context outside the mask; fill the editable area with opaque scene content. Do not add labels, numbers, guide colors or text unless expressly requested. The edited crop will be projected back only within the selected spherical area. User edit request: '+(prompt.trim()||'Remove existing content in the selected area and blend naturally with the surrounding scene.');}

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

function createOpenAIPanoramaEditProvider({apiKey='',baseUrl='',modelMap,client,fetchImpl=fetch,timeoutMs=600000}={}){
 const credentials=new Set([apiKey,typeof client?.apiKey==='string'?client.apiKey:''].filter(Boolean));
 const checkCredentials=value=>{for(const secret of credentials)assertCredentialFree(value,secret);};
 const checkCredentialBytes=bytes=>{for(const secret of credentials)assertCredentialFreeBytes(bytes,secret);};
 function checkedPNG(bytes,expectedWidth,expectedHeight){
  // Header bounds reject oversized pixel allocations before full decoding.
  // Matching dimensions still require the complete CRC/deflate/pixel checks.
  if(bytes.length<33||bytes.readUInt32BE(16)!==expectedWidth||bytes.readUInt32BE(20)!==expectedHeight)throw fail('全景 PNG 实际尺寸与预算不一致');
  checkCredentialBytes(bytes);
  // Match the existing panorama boundary: independent metadata compression
  // is not inspected by the pixel decoder, so reject it instead of forwarding
  // or publishing unreviewed text. Do not strip or rewrite the source bytes.
  let offset=8;
  while(offset+12<=bytes.length){
   const length=bytes.readUInt32BE(offset),end=offset+12+length;
   if(end>bytes.length||['zTXt','iTXt','iCCP'].includes(bytes.toString('ascii',offset+4,offset+8)))throw fail('全景局部编辑 PNG 不支持未审阅的压缩文本或色彩配置 metadata，未接收图片');
   offset=end;
  }
  const decoded=decodePNG(bytes);
  checkCredentialBytes(decoded.pixels);
  return decoded;
 }
 let map={},origin='',configurationError=null;
 try{
  map=parsePanoramaEditModelMap(modelMap);origin=endpoint(baseUrl||client?.baseURL||'https://api.openai.com/v1');
  if(baseUrl&&client?.baseURL&&origin!==endpoint(client.baseURL)||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();
  checkCredentials(map);checkCredentials(origin);
 }catch{configurationError='configuration_invalid';map={};origin='';}
 const missing=[...(!apiKey&&!client?['GENERATION_API_KEY']:[]),...(!Object.keys(map).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:PROTOCOL,origin,map})).digest('hex');
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{
  kinds:map[KIND]?[KIND]:[],models:map[KIND]?{[KIND]:{kind:KIND}}:{},
  ...(map[KIND]?{panoramaEdit:panoramaEditCapabilities(map[KIND])}:{}),
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
 function resolve(request,{materialize=false}={}){
  if(!configured)throw fail('独立全景局部编辑尚未配置 Key 与显式透视蒙版回投能力','configuration_required');
  if(!exactKeys(request,['kind','label','nodeId','prompt','inputs','parameters','count','references'])||request.kind!==KIND||Buffer.byteLength(JSON.stringify(request))>48*1024*1024)throw fail('全景编辑含额外字段或超过 48 MiB');
  try{checkCredentials(request);}catch{throw fail('全景来源请求含供应商凭据，尚未提交');}
  if(typeof request.prompt!=='string'||request.prompt.length>30000||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('全景局部编辑只接受原 prompt、一个结果，不支持额外参考');
  assertPanoramaEditParameters(request.parameters);
  if(request.nodeId!==request.parameters.binding.nodeId)throw fail('全景绑定与节点身份不一致');
  if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('全景编辑仅接受一张完整来源');
  const input=request.inputs[0];
  if(!exactKeys(input,['type','image','projection'])||Object.keys(input).length!==3||input.type!=='image'||input.projection!=='equirectangular')throw fail('全景编辑来源字段与片场投影合同不一致');
  const image=inlineImage({url:input.image},0);if(image.mime!=='image/png'||image.bytes.length>32*1024*1024)throw fail('全景来源须为不超过 32 MiB 的完整 PNG');
  let source;try{source=checkedPNG(image.bytes,2048,1024);}catch{throw fail('全景来源 PNG 无效或含供应商凭据，尚未提交');}
  if(!materialize){validatePerspectiveSource(source,request.parameters);return request;}
  const prepared=preparePerspectiveEdit(source,request.parameters);
  if(prepared.mask.length>=4*1024*1024)throw fail('全景透视蒙版超过 4 MiB；未缩放');
  checkCredentialBytes(prepared.crop);checkCredentialBytes(prepared.mask);
  const e=map[KIND];return {...prepared,body:{model:e.model,prompt:compilePrompt(request.prompt),n:1,size:e.cropSize,quality:e.quality,output_format:'png',background:'opaque',stream:false}};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request,{materialize:true});if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  try{
   if(!sdk){const OpenAI=require('openai');sdk=new OpenAI({apiKey,baseURL:origin,fetch:boundedFetch,maxRetries:0,timeout:timeoutMs});}
   const {toFile}=require('openai');
   const upload=await abortable(()=>toFile(prepared.crop,'perspective.png',{type:'image/png'}),combined);
   const mask=await abortable(()=>toFile(prepared.mask,'mask.png',{type:'image/png'}),combined);
   const value=await abortable(()=>sdk.images.edit({...prepared.body,image:[upload],mask},{signal:combined,maxRetries:0,timeout:timeoutMs}),combined);
   checkCredentials(value);
   if(!object(value)||!Array.isArray(value.data)||value.data.length!==1)throw unknown();
   const item=value.data[0];
   if(!object(item)||typeof item.b64_json!=='string'||item.b64_json.length>64*1024*1024||item.url!==undefined)throw unknown();
   const image=inlineImage({url:'data:image/png;base64,'+item.b64_json},0);
   const decoded=checkedPNG(image.bytes,prepared.size,prepared.size);
   if(prepared.body.size!==decoded.width+'x'+decoded.height)throw unknown();
   const composite=reprojectPerspectiveEdit(prepared,decoded);checkCredentialBytes(composite.pixels);checkCredentialBytes(composite.bytes);
   if(combined.aborted)throw combined.reason;
   return {status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,'+composite.bytes.toString('base64'),width:prepared.width,height:prepared.height}]};
  }catch(error){
   if(signal?.aborted)throw signal.reason;
   const OpenAI=require('openai');
   if(error instanceof OpenAI.APIError&&Number.isInteger(error.status)&&error.status>=400&&error.status<500&&![408,409].includes(error.status)){
    try{checkCredentials(error.message);checkCredentials(error.error);}catch{throw unknown();}
    return {status:'failed',code:'provider_rejected',error:'OpenAI 已拒绝全景局部编辑请求，请检查账号资格、额度或参数'};
   }
   throw unknown();
  }finally{clearTimeout(timer);controller.abort();}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createOpenAIPanoramaEditProvider,parsePanoramaEditModelMap,compilePrompt,MAX_RESPONSE_BYTES};
