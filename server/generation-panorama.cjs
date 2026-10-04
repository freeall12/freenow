'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {rejectCredentials}=require('./generation-durable.cjs');
const {createFalQueue}=require('./generation-fal-queue.cjs');
const {createGenerationMediaDownloader,publicMediaUrl}=require('./generation-media-download.cjs');
const {decodePNG}=require('./generation-png-alpha.cjs');
const {assertCredentialFree,assertCredentialFreeBytes}=require('./outbound-client.cjs');

const MODEL='fal-ai/hunyuan_world',ALIAS='hunyuan-world-panorama',PROTOCOL='fal-panorama-native';
const MAX_INPUT_BYTES=20*1024*1024,MAX_OUTPUT_BYTES=32*1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const localFail=message=>Object.assign(fail(message),{providerDispatched:false});
const unknown=()=>fail('全景结果尚未确认，请查询原任务；未重新生成','unknown');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value)&&value!=='.'&&value!=='..';
function publicUrl(value){
 let url;try{url=publicMediaUrl(value);if(url.protocol!=='https:')throw Error();}catch{throw localFail('全景结果需要无凭据的公网 HTTPS 下载地址');}
 return url.href;
}
function decodedPNG(bytes,apiKey){
 assertCredentialFreeBytes(bytes,apiKey);
 // Compressed/UTF-8 metadata has independent text encoding. Until a metadata
 // decoder exists, reject it instead of publishing uninspected supplier text.
 let offset=8;
 while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)throw Error();const type=bytes.toString('ascii',offset+4,offset+8);if(['zTXt','iTXt','iCCP'].includes(type))throw Error();offset=end;}
 const actual=decodePNG(bytes);assertCredentialFreeBytes(actual.pixels,apiKey);return actual;
}
function parsePanoramaModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};
 if(!object(map)||Object.keys(map).some(alias=>alias!==ALIAS))throw fail('全景替代须显式配置 hunyuan-world-panorama 别名','configuration_invalid');
 if(own(map,ALIAS)){
  const entry=map[ALIAS];
  if(!object(entry)||Object.keys(entry).sort().join(',')!=='kind,model'||entry.kind!=='image.generate'||entry.model!==MODEL)throw fail('全景替代须映射到已核实的 Hunyuan 图片转全景接口','configuration_invalid');
 }
 return structuredClone(map);
}
function createPanoramaProvider({baseUrl='',apiKey='',modelMap,fetchImpl=fetch,download}={}){
 let mapping={},endpoint='https://queue.fal.run',configurationError=null;
 try{
  mapping=parsePanoramaModelMap(modelMap);
  if(typeof baseUrl!=='string'||typeof fetchImpl!=='function'||download!==undefined&&typeof download!=='function')throw Error();
  if(baseUrl){const url=new URL(baseUrl);if(baseUrl!==baseUrl.trim()||url.origin!==endpoint||url.username||url.password||url.search||url.hash||baseUrl.includes('?')||baseUrl.includes('#')||url.pathname!=='/')throw Error();endpoint=url.href.replace(/\/$/,'');}
  if(typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)))throw Error();
  assertCredentialFree(mapping,apiKey);assertCredentialFree(endpoint,apiKey);
 }catch{mapping={};configurationError='configuration_invalid';}
 const missing=[...(!apiKey?['GENERATION_API_KEY']:[]),...(!own(mapping,ALIAS)?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:PROTOCOL,endpoint,mapped:own(mapping,ALIAS)})).digest('hex');
 const profile={semantics:'explicit-native-alternative',label:'Hunyuan World Panorama',source:'image',maxImages:1,maxCount:1,projection:'equirectangular',fixedAspectRatio:'2:1',nativeSize:true,editing:false,maxInputBytes:MAX_INPUT_BYTES,maxOutputBytes:MAX_OUTPUT_BYTES,inputMimeTypes:['image/png'],outputMimeTypes:['image/png'],pngProfile:'noninterlaced-8bit-rgb-rgba'};
 const metadata={configured,protocol:PROTOCOL,missing,configurationError,capabilities:{kinds:own(mapping,ALIAS)?['image.generate']:[],models:own(mapping,ALIAS)?{[ALIAS]:{kind:'image.generate',label:profile.label}}:{},panorama:own(mapping,ALIAS)?{[ALIAS]:profile}:{},references:true,imageReferences:own(mapping,ALIAS)?{[ALIAS]:{maxImages:1,mimeTypes:['image/png'],transport:'inline'}}:{},remoteRecovery:true,remoteCancellation:'best-effort',verified:'official-schema-and-local-contract'}};
 async function guardedFetch(url,options){
  const response=await fetchImpl(url,options);if(!response.body?.pipeThrough)return response;
  let size=0;const chunks=[];
  const guarded=response.body.pipeThrough(new TransformStream({
   transform(chunk){if(!(chunk instanceof Uint8Array)||(size+=chunk.byteLength)>1024*1024)throw unknown();chunks.push(Buffer.from(chunk));},
   flush(controller){const bytes=Buffer.concat(chunks),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assertCredentialFree(text,apiKey);assertCredentialFree(JSON.parse(text),apiKey);controller.enqueue(bytes);}
  }));
  return new Response(guarded,{status:response.status,headers:response.headers});
 }
 const queue=createFalQueue({baseUrl:endpoint,apiKey,fetchImpl:guardedFetch});
 const downloadImage=download||createGenerationMediaDownloader({limits:{image:MAX_OUTPUT_BYTES}}).download;
 function resolve(request){
  if(!configured)throw fail('Hunyuan 全景替代尚未配置，请检查服务端 Key 与精确模型映射','configuration_required');
  rejectCredentials(request);
  if(!object(request)||request.kind!=='image.generate'||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw localFail('全景替代仅支持一张图片转全景，不支持世界生成或区域编辑');
  try{assertCredentialFree(request,apiKey);}catch{throw localFail('全景请求含有供应商凭据，尚未提交');}
  if(Object.keys(request).some(key=>!['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'].includes(key)))throw localFail('全景请求含有尚未支持的顶层字段，尚未提交');
  if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw localFail('参考素材须完整绑定到唯一 inputs，尚未提交');
  const p=request.parameters??{},wire=p.providerParameters??{};
  if(!object(p)||!object(wire))throw localFail('全景参数无效');
  const alias=wire.model??p.modelId??p.model;
  if(alias!==ALIAS||[wire.model,p.modelId,p.model].some(value=>value!==undefined&&value!==ALIAS))throw localFail('请选择明确的 Hunyuan 全景替代模型，不会替换所选型号');
  const allowed=['model','modelId','providerParameters','ratio','aspectRatio','isPanoramaPrompt','count','times','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'];
  if(Object.keys(p).some(key=>!allowed.includes(key))||Object.keys(wire).some(key=>!['model','mode','aspectRatio','times','isPanoramaPrompt'].includes(key)))throw localFail('全景接口不支持尺寸、质量、相机或额外设置，不会忽略后提交');
  const flags=[p.isPanoramaPrompt,wire.isPanoramaPrompt].filter(value=>value!==undefined);
  if(!flags.length||flags.some(value=>value!==true))throw localFail('请明确选择全景生成');
  for(const ratio of [p.ratio,p.aspectRatio,wire.aspectRatio])if(ratio!==undefined&&ratio!=='2:1')throw localFail('此原生全景接口固定为 2:1，不会改画幅后提交');
  if(wire.mode!==undefined&&wire.mode!=='image_to_image')throw localFail('此全景接口需要一张源图片，不能退回文字生成');
  for(const count of [request.count,p.count,p.times,p.batch_count,wire.times,p.canvasResults?.targetNodeIds?.length])if(count!==undefined&&count!==1)throw localFail('此全景接口每个任务只生成一张图片');
  if(p.resultMode!==undefined&&p.resultMode!=='variants')throw localFail('此全景接口不支持分镜结果模式');
  if(typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>32768)throw localFail('图片转全景需要明确描述，本地限制为 32768 字符');
  if(request.references?.length||!Array.isArray(request.inputs)||request.inputs.length!==1)throw localFail('图片转全景必须绑定且仅提交一张源图片');
  const input=request.inputs[0];
  if(!object(input)||input.type!=='image'||Object.keys(input).some(key=>!['type','url','id','nodeId','key','title','name','role','width','height','mimeType'].includes(key))||input.role!==undefined&&!['reference','source_image'].includes(input.role))throw localFail('请先物化源图片；区域、裁切或其他输入字段不受此接口支持');
  let source;
  if(typeof input.url==='string'&&input.url.startsWith('data:image/png;base64,')){
   try{
    const image=inlineImage(input,0);if(image.bytes.length>MAX_INPUT_BYTES)throw Error();const actual=decodedPNG(image.bytes,apiKey);
    if(input.width!==undefined&&input.width!==actual.width||input.height!==undefined&&input.height!==actual.height||input.mimeType!==undefined&&input.mimeType!=='image/png')throw Error();source=input.url;
   }catch{throw localFail('源图须为完整可解码非交错 8-bit RGB/RGBA PNG，且不超过 20 MiB；请先转为原尺寸 PNG');}
  }else throw localFail('源图须先物化为内联 PNG；公网 URL、JPEG 或 WebP 未经本地解码不得直接提交');
  return {image_url:source,prompt:request.prompt};
 }
 const envelope=id=>'pn1.'+Buffer.from(JSON.stringify([MODEL,ALIAS,id])).toString('base64url');
 function identity(id){
  let value;try{if(typeof id!=='string'||id.length>1000||!/^pn1\.[A-Za-z0-9_-]+$/.test(id))throw Error();value=JSON.parse(Buffer.from(id.slice(4),'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==3||value[0]!==MODEL||value[1]!==ALIAS||!validId(value[2])||envelope(value[2])!==id)throw Error();}catch{throw fail('全景任务身份无效','provider_identity_mismatch');}
  if(!configured)throw fail('原全景模型映射或凭据尚未配置','configuration_required');
  return value[2];
 }
 async function resultImage(result,requestId,signal){
  let downloaded;
  try{
   const image=result?.image;
   if(!object(image)||result.images!==undefined)throw Error();
   const source=publicUrl(image.url);
   assertCredentialFree(result,apiKey);assertCredentialFree(source,apiKey);
   if(image.content_type!=null&&image.content_type!=='image/png')throw Error();
   for(const key of ['width','height','file_size'])if(image[key]!=null&&(!Number.isSafeInteger(image[key])||image[key]<1))throw Error();
   if(image.width!=null&&image.height!=null&&image.width!==2*image.height)throw Error();
   // Use the existing DNS-pinned media downloader with no supplier credentials.
   // Validate actual bytes before publishing, rather than trusting a 2:1 label.
   downloaded=await downloadImage(source,{kind:'image',signal});
   if(downloaded.mime!=='image/png')throw Error();
   const parts=[];let size=0;
   for await(const chunk of downloaded.stream){if(signal?.aborted)throw signal.reason;if(!(chunk instanceof Uint8Array)||(size+=chunk.byteLength)>MAX_OUTPUT_BYTES)throw Error();parts.push(Buffer.from(chunk));}
   if(!size||downloaded.expectedBytes!==undefined&&size!==downloaded.expectedBytes||image.file_size!=null&&size!==image.file_size)throw Error();
   const bytes=Buffer.concat(parts),url='data:'+downloaded.mime+';base64,'+bytes.toString('base64'),actual=decodedPNG(bytes,apiKey);actual.mime='image/png';
   if(actual.width!==2*actual.height||image.width!=null&&image.width!==actual.width||image.height!=null&&image.height!==actual.height||image.content_type!=null&&image.content_type!==actual.mime)throw Error();
   return {type:'image',url,mime:actual.mime,width:actual.width,height:actual.height,sourceFileId:requestId};
  }catch{if(signal?.aborted)throw signal.reason;throw unknown();}
  finally{downloaded?.close?.();}
 }
 async function receipt(value,expected,signal){
  if(!object(value)||!validId(value.requestId)||expected!==undefined&&value.requestId!==expected)throw fail('全景回执任务身份未确认','provider_identity_mismatch');
  const id=envelope(value.requestId);
  if(value.status==='succeeded')return {id,status:'succeeded',progress:100,outputs:[await resultImage(value.result,value.requestId,signal)]};
  if(!['queued','running','failed','unknown'].includes(value.status))throw unknown();
  return {id,status:value.status,...value.status==='failed'?{code:'provider_failed',error:'供应商未完成全景生成'}:{},...value.status==='unknown'?{code:'unknown',error:'全景任务状态尚未确认，未重新生成'}:{}};
 }
 async function submit(request,{signal}={}){return receipt(await queue.submit(MODEL,resolve(request),{signal}),undefined,signal);}
 async function poll(id,{signal}={}){const requestId=identity(id);return receipt(await queue.poll(MODEL,requestId,{signal}),requestId,signal);}
 async function cancel(id,{signal}={}){const requestId=identity(id),value=await queue.cancel(MODEL,requestId,{signal});if(value.requestId!==requestId)throw fail('全景取消回执身份未确认','provider_identity_mismatch');return {id,status:'unknown'};}
 async function generate(request,{signal,onTaskIdentity=()=>{},onProgress=()=>{},pollInterval=1500,timeout=600000}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>1800000||!Number.isSafeInteger(pollInterval)||pollInterval<1||pollInterval>30000)throw localFail('全景轮询预算无效');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  try{
   let value=await submit(request,{signal:combined});onTaskIdentity(value.id);
   while(['queued','running'].includes(value.status)){
    onProgress(0);
    await new Promise((resolve,reject)=>{if(combined.aborted){reject(combined.reason);return;}const abort=()=>{clearTimeout(timer);reject(combined.reason);};const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},pollInterval);combined.addEventListener('abort',abort,{once:true});});
    value=await poll(value.id,{signal:combined});
   }
   if(value.status!=='succeeded')throw fail('全景生成尚未完成',value.status==='unknown'?'unknown':'provider_failed');return value;
  }catch(error){if(signal?.aborted)throw signal.reason;if(combined.aborted)throw unknown();throw error;}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,poll,cancel,generate};
}
module.exports={createPanoramaProvider,parsePanoramaModelMap};
