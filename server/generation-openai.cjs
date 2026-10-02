'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const Speech=require('./generation-openai-speech.cjs');
const Analysis=require('./generation-openai-analysis.cjs');
const VideoAnalysis=require('./generation-openai-video-analysis.cjs');
const {localVideoFailure}=require('./video-analysis-errors.cjs');
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const kinds=['text.generate','image.generate','audio.generate','image.recognize','video.analyze'];

// Operator configuration, never request-supplied model IDs or destinations.
function parseModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value||{};
 if(!object(map))throw fail('生成模型映射配置无效','configuration_invalid');
 for(const entry of Object.values(map)){
  if(!object(entry)||!kinds.includes(entry.kind)||typeof entry.model!=='string'||!entry.model.trim())throw fail('生成模型映射配置无效','configuration_invalid');
  if(entry.kind==='image.recognize'){Analysis.validateAnalysisProfile(entry);continue;}
  if(entry.kind==='video.analyze'){VideoAnalysis.validateVideoAnalysisProfile(entry);continue;}
  if(entry.kind==='audio.generate'){Speech.validateSpeechProfile(entry);continue;}
  if(entry.maxCount!==undefined&&(!Number.isSafeInteger(entry.maxCount)||entry.maxCount<1||entry.maxCount>10))throw fail('生成数量上限配置无效','configuration_invalid');
  if(entry.supportsImageReferences!==undefined&&(entry.kind!=='image.generate'||typeof entry.supportsImageReferences!=='boolean'))throw fail('图片参考能力配置无效','configuration_invalid');
  if(entry.supportsImageReferences===true?(!Number.isSafeInteger(entry.maxImages)||entry.maxImages<1||entry.maxImages>16):entry.maxImages!==undefined)throw fail('图片参考数量上限配置无效','configuration_invalid');
  for(const key of ['sizeMap','qualityMap','reasoningMap'])if(entry[key]!==undefined&&(!object(entry[key])||Object.values(entry[key]).some(value=>typeof value!=='string'||!value.trim())))throw fail('生成参数映射配置无效','configuration_invalid');
 }
 return structuredClone(map);
}
function createOpenAINativeProvider({apiKey='',baseUrl='',modelMap,client,fetchImpl=fetch}={}){
 let mapping={},configurationError=null,endpoint='';
 try{
  mapping=parseModelMap(modelMap);
  if(baseUrl){const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fail('生成API地址配置无效','configuration_invalid');endpoint=url.href.replace(/\/$/,'');}
 }catch{configurationError='configuration_invalid';}
 const missing=[...(!apiKey&&!client?['GENERATION_API_KEY']:[]),...(!Object.keys(mapping).length?['GENERATION_MODEL_MAP']:[])];
 const configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'openai-native',endpoint:endpoint||'openai-default',mapping})).digest('hex');
 const imageReferences=Object.fromEntries(Object.entries(mapping).filter(([,entry])=>entry.supportsImageReferences===true).map(([alias,entry])=>[alias,{maxImages:entry.maxImages,mimeTypes:['image/png','image/jpeg','image/webp'],transport:'inline'}]));
 const speech=Object.fromEntries(Object.entries(mapping).filter(([,entry])=>entry.kind==='audio.generate').map(([alias,entry])=>[alias,Speech.speechCapabilities(entry)]));
 const analysis=Object.fromEntries(Object.entries(mapping).filter(([,entry])=>entry.kind==='image.recognize').map(([alias,entry])=>[alias,Analysis.analysisCapabilities(entry)]));
 const videoAnalysis=Object.fromEntries(Object.entries(mapping).filter(([,entry])=>entry.kind==='video.analyze').map(([alias,entry])=>[alias,VideoAnalysis.videoAnalysisCapabilities(entry)]));
 const metadata={configured,protocol:'openai-native',missing,configurationError,capabilities:{kinds:[...new Set(Object.values(mapping).map(entry=>entry.kind))],references:!!Object.keys(imageReferences).length,imageReferences,speech,analysis,videoAnalysis,textReferences:true,remoteRecovery:false,remoteCancellation:false,verified:'local-contract-only'}};
 let sdk=client;
 function resolve(request){
  if(!configured)throw fail(configurationError?'生成API配置无效，请检查服务端模型映射与地址':'生成API尚未配置','configuration_required');
  if(Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw fail('完整生成请求超过64 MiB，未提交模型');
  if(!kinds.includes(request.kind))throw fail('OpenAI原生适配暂不支持此操作，请使用对应任务网关');
  const p=request.parameters||{},wire=p.providerParameters||{},alias=wire.model||p.modelId||p.model||(['image.recognize','video.analyze'].includes(request.kind)?request.kind:undefined);
  if([wire.model,p.modelId,p.model].some(value=>value!==undefined&&(typeof value!=='string'||!value.trim())))throw fail('生成模型标识无效，未提交模型');
  // The UI carries a display label beside modelId. An operator-mapped alias is
  // an identity, however, and cannot contradict either canonical model field.
  if(p.modelId!==undefined&&p.modelId!==alias||p.model!==undefined&&(Object.hasOwn(mapping,p.model)||p.modelId===undefined)&&p.model!==alias)throw fail('生成模型参数不一致，未提交模型');
  const entry=Object.hasOwn(mapping,alias)?mapping[alias]:null;
  if(!entry||entry.kind!==request.kind)throw fail('当前展示模型尚未映射到真实生成型号','configuration_required');
  if(request.kind==='image.recognize')return Analysis.prepareAnalysisRequest(request,entry);
  if(request.kind==='video.analyze')return VideoAnalysis.prepareVideoAnalysisRequest(request,entry);
  if(request.kind==='audio.generate')return Speech.prepareSpeechRequest(request,entry);
  const common=['model','modelId','count','times','prompt','resultMode','canvasResults','batch_count','batch_id','is_regeneration','layout'];
  const imageFields=['providerParameters','ratio','aspectRatio','imageSize','size','quality','outputQuality','background','mode','cameraEnabled','cameraControl','camera','lens','focal','aperture','cameraKey','lensKey','focalKey','apertureKey','modelSettings','thinking','webSearch','imageSearch','isPanoramaPrompt','duration','audio','audioLabel','referenceBindings','referenceOrder','refs','subjects'];
  const allowedTop=new Set([...common,...(request.kind==='image.generate'?imageFields:['reasoning_effort','thinking_level','thinkingLevel','referenceIds'])]);
  if(Object.keys(p).some(key=>!allowedTop.has(key)))throw fail('请求包含当前适配器尚未支持的参数');
  const inputs=request.inputs||[];
  if(!Array.isArray(inputs)||inputs.some(input=>!input||!['text',...(request.kind==='image.generate'?['image']:[])].includes(input.type)))throw fail('OpenAI原生适配不支持此参考素材类型，请使用对应任务网关');
  const images=inputs.filter(input=>input.type==='image'),texts=inputs.filter(input=>input.type==='text');
  if(images.length&&entry.supportsImageReferences!==true)throw fail('当前模型尚未配置图片参考能力','configuration_required');
  if(images.length>entry.maxImages)throw fail('图片参考超过当前模型配置上限，未提交模型');
  if(texts.some(input=>typeof input.text!=='string'||!input.text.trim()))throw fail('文本参考内容无效');
  if(p.refs?.length||p.subjects?.length)throw fail('当前适配不支持未展开的素材参考');
  let prompt=request.prompt||'';
  const textReferences=texts.map(input=>input.text).filter(text=>!prompt.includes(text));
  prompt=[...textReferences,prompt].filter(Boolean).join('\n\n');if(!prompt.trim())throw fail('请输入生成提示词');
  if(request.kind==='image.generate'&&prompt.length>32000)throw fail('图片提示词超过32000字符，未提交模型');
  const count=Number(p.count??p.times??wire.times??1),targetCount=p.canvasResults?.targetNodeIds?.length;
  if(!Number.isSafeInteger(count)||count<1||count>(entry.maxCount||1)||targetCount!==undefined&&targetCount!==count)throw fail('生成数量超出当前适配配置，未提交模型');
  if([p.count,p.times,wire.times].some(value=>value!==undefined&&Number(value)!==count))throw fail('生成数量与供应商参数不一致');
  if(p.cameraEnabled||p.cameraControl?.enabled||p.isPanoramaPrompt||wire.isPanoramaPrompt||p.webSearch||p.imageSearch||wire.enableGoogleSearch||wire.enable_image_search)throw fail('当前适配不支持相机、全景或联网搜索参数');
  const body={model:entry.model,prompt},prepared={kind:request.kind,count,body};
  if(images.length)prepared.images=images.map(inlineImage);
  if(request.kind==='text.generate'){
   if(Object.keys(wire).length)throw fail('文字生成包含未支持的供应商参数');
   const effort=p.reasoning_effort??p.thinking_level??p.thinkingLevel;
   if(effort!==undefined){const mapped=entry.reasoningMap?.[effort];if(!mapped)throw fail('当前思考强度尚未映射到真实模型','configuration_required');body.reasoning={effort:mapped};}
   if([p.reasoning_effort,p.thinking_level,p.thinkingLevel].some(value=>value!==undefined&&entry.reasoningMap?.[value]!==body.reasoning?.effort))throw fail('文字思考参数不一致');
   if(p.referenceIds?.length)throw fail('文字参考须展开为inputs正文');
   for(const key of ['temperature','max_tokens','maxOutputTokens','size','aspectRatio'])if(p[key]!==undefined)throw fail('当前文字适配不支持参数：'+key);
  }else{
   // The editor carries legacy video defaults into image settings. Only these
   // exact inactive defaults are metadata; custom values cannot be dropped.
   if(p.duration!==undefined&&(!p.providerParameters||p.duration!==5)||p.audio!==undefined&&(!p.providerParameters||p.audio!==true)||p.audioLabel!==undefined&&(!p.providerParameters||p.audioLabel!=='开启')||p.thinking!==undefined&&(!p.providerParameters||p.thinking!=='high'))throw fail('图片请求包含当前适配不支持的额外生成参数');
   const allowed=new Set(['model','mode','aspectRatio','times','imageSize','quality','background']);
   for(const key of Object.keys(wire))if(!allowed.has(key))throw fail('当前图片适配不支持参数：'+key);
   const expectedMode=images.length?'image_to_image':'text_to_image';
   const mode=wire.mode??p.mode;if(mode!==undefined&&mode!==null&&mode!==expectedMode)throw fail('图片生成方式与实际参考输入不一致');
   if(p.mode!==undefined&&p.mode!==mode&&!(p.providerParameters&&p.mode==='全能参考'))throw fail('图片生成方式与供应商参数不一致');
   for(const [topKey,wireKey]of [['imageSize','imageSize'],['aspectRatio','aspectRatio'],['ratio','aspectRatio'],['outputQuality','quality'],['background','background']])if(p[topKey]!==undefined&&wire[wireKey]!==undefined&&p[topKey]!==wire[wireKey])throw fail('图片规格与供应商参数不一致');
   const ratio=wire.aspectRatio??p.aspectRatio??p.ratio, resolution=wire.imageSize??p.imageSize;
   if(ratio!==undefined||resolution!==undefined){const size=entry.sizeMap?.[(ratio??'')+'|'+(resolution??'')];if(!size)throw fail('当前画幅与分辨率尚未映射到真实尺寸','configuration_required');body.size=size;}
   else if(p.size!==undefined){if(!Object.values(entry.sizeMap||{}).includes(p.size))throw fail('当前尺寸未在服务端映射中配置');body.size=p.size;}
   if(p.size!==undefined&&p.size!==body.size)throw fail('图片尺寸与映射的画幅规格不一致');
   // Historical p.quality means resolution only when it exactly matches imageSize.
   const legacyResolution=p.imageSize!==undefined&&p.quality===p.imageSize||p.quality===''&&ratio==='auto'&&resolution===undefined&&!!p.providerParameters;
   const quality=wire.quality??p.outputQuality??(!legacyResolution?p.quality:undefined);
   if(p.quality!==undefined&&!legacyResolution&&quality!==p.quality)throw fail('图片质量与供应商参数不一致');
   if(quality!==undefined){const mapped=entry.qualityMap?.[quality];if(!mapped)throw fail('当前质量档位尚未映射到真实模型','configuration_required');body.quality=mapped;}
   const background=wire.background??p.background;
   if(background!==undefined){if(!['opaque','transparent','auto'].includes(background))throw fail('背景参数无效');body.background=background;}
   for(const key of ['generateMode','thinking_level','seed','negativePrompt','strength','steps'])if(p[key]!==undefined)throw fail('当前图片适配不支持参数：'+key);
   body.n=count;
  }
  return prepared;
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request),{kind,count,body,images}=prepared;if(signal?.aborted)throw signal.reason;
  if(!sdk){const OpenAI=require('openai');sdk=new OpenAI({apiKey,...(endpoint?{baseURL:endpoint}:{}),fetch:fetchImpl,maxRetries:0,timeout:600000});}
  const options={signal,maxRetries:0,timeout:600000};
  try{
   if(kind==='image.recognize')return await Analysis.submitAnalysis(prepared,{sdk,signal});
   if(kind==='video.analyze')return await VideoAnalysis.submitVideoAnalysis(prepared,{sdk,signal});
   if(kind==='audio.generate')return await Speech.submitSpeech(prepared,{sdk,signal});
   if(kind==='text.generate'){
    const outputs=[];for(let index=0;index<count;index++){if(signal?.aborted)throw signal.reason;const value=await sdk.responses.create({model:body.model,input:body.prompt,store:false,...(body.reasoning?{reasoning:body.reasoning}:{})},options);if(value.status&&value.status!=='completed')throw fail('模型尚未完成生成','unknown');const text=typeof value.output_text==='string'?value.output_text:(value.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text'&&typeof item.text==='string').map(item=>item.text).join('\n');if(!text.trim())throw fail('模型没有返回文字结果','unknown');outputs.push({type:'text',text});}
    return {status:'succeeded',outputs};
   }
   let value;
   if(images){const {toFile}=require('openai');const uploads=[];for(const image of images){if(signal?.aborted)throw signal.reason;uploads.push(await toFile(image.bytes,image.name,{type:image.mime}));}if(signal?.aborted)throw signal.reason;value=await sdk.images.edit({...body,image:uploads},options);}
   else value=await sdk.images.generate(body,options);
   if(!Array.isArray(value.data)||value.data.length!==count)throw fail('图片结果数量与生成请求不一致','unknown');
   const outputs=value.data.map(item=>{
    let url=item.url,dimensions={};if(item.b64_json){if(typeof item.b64_json!=='string'||item.b64_json.length>64*1024*1024||! /^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json))throw fail('模型返回无效图片编码','unknown');const bytes=Buffer.from(item.b64_json,'base64');if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw fail('模型未返回默认PNG图片格式','unknown');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>65535||height>65535)throw fail('模型返回无效图片尺寸','unknown');dimensions={width,height};url='data:image/png;base64,'+item.b64_json;}
    if(!item.b64_json){let address;try{address=new URL(url);}catch{throw fail('模型没有返回实际图片','unknown');}if(typeof url!=='string'||!['http:','https:'].includes(address.protocol)||address.username||address.password)throw fail('模型返回的媒体地址无效','unknown');url=address.href;}
    return {type:'image',url,...dimensions};
   });return {status:'succeeded',outputs};
  }catch(error){if(signal?.aborted)throw signal.reason;if(kind==='video.analyze'&&error.providerDispatched===false){const local=localVideoFailure(error);return {status:'failed',code:local.code,error:local.message,providerDispatched:false};}throw fail('生成请求状态未确认，请查询原任务；未自动重试','unknown');}
 }
 async function generate(request,options){const result=await submit(request,options);if(result.status==='failed'&&result.providerDispatched===false)throw localVideoFailure(result);return result;}
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate,isConfigured:()=>configured};
}
module.exports={createOpenAINativeProvider,parseModelMap};
