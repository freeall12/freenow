'use strict';
const {createHash}=require('node:crypto');
const {inlineImage}=require('./generation-image-input.cjs');
const {alphaMask,decodePNG}=require('./generation-png-alpha.cjs');
const {endpoint,protectGenerationFetch}=require('./generation-endpoint-policy.cjs');
const {assertCredentialFree}=require('./outbound-client.cjs');
const KINDS=['image.erase','image.redraw','image.outpaint'],MODELS=['gpt-image-2','gpt-image-2-2026-04-21'],MAX_RESPONSE_BYTES=64*1024*1024;
const REDRAW_PREFIX='Naturally redraw only the transparent-channel area in the image. The last image is the main image with transparency to redraw; keep the original content and aspect ratio of that image. Image 1 is a reference for the redrawn area. Redraw prompt: ';
const FIRST_PREFIX='Naturally redraw only the transparent-channel area in the image. The first image is the main image with transparency to redraw; keep the original content and aspect ratio of that image. Image 2 is a reference for the redrawn area. Redraw prompt: ';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code});
const unknown=()=>fail('OpenAI 蒙版编辑状态未确认；未自动重试或重新提交','unknown');
function validSize(value){if(typeof value!=='string'||!/^\d{1,4}x\d{1,4}$/.test(value))return false;const [w,h]=value.split('x').map(Number);return w>0&&h>0&&w%16===0&&h%16===0&&w<=3840&&h<=3840&&Math.max(w,h)<=3*Math.min(w,h)&&w*h>=655360&&w*h<=8294400;}
function parseOpenAIMaskedEditModelMap(value){
 const map=typeof value==='string'?JSON.parse(value):value??{};if(!object(map)||Object.keys(map).length>30)throw fail('蒙版编辑模型映射无效','configuration_invalid');
 for(const [alias,e]of Object.entries(map)){
  if(!/^[-\w.]{1,128}$/.test(alias)||!object(e)||!KINDS.includes(e.kind)||!MODELS.includes(e.model)||Object.keys(e).some(key=>!['kind','model','allowDynamicSize','sizeMap','qualityMap','maxCount'].includes(key))||e.allowDynamicSize!==undefined&&typeof e.allowDynamicSize!=='boolean'||e.maxCount!==undefined&&(!Number.isSafeInteger(e.maxCount)||e.maxCount<1||e.maxCount>4))throw fail('仅支持显式 GPT Image 2 蒙版编辑配置','configuration_invalid');
  if(e.sizeMap!==undefined&&(!object(e.sizeMap)||Object.keys(e.sizeMap).length>100||Object.entries(e.sizeMap).some(([key,size])=>!validSize(size)||!['1K|'+size,'2K|'+size,'4K|'+size].includes(key))))throw fail('尺寸映射须为 resolution|WxH 并保持相同真实尺寸','configuration_invalid');
  if(!e.allowDynamicSize&&!Object.keys(e.sizeMap||{}).length)throw fail('请明确启用已核实动态尺寸或配置严格尺寸映射','configuration_invalid');
  if(!object(e.qualityMap)||!Object.keys(e.qualityMap).length||Object.keys(e.qualityMap).length>4||Object.entries(e.qualityMap).some(([key,v])=>!['low','medium','high','auto'].includes(key)||key!==v))throw fail('请明确配置官方质量参数的同名映射','configuration_invalid');
 }
 return structuredClone(map);
}
async function abortable(operation,signal,disposeLate){if(signal?.aborted)throw signal.reason;let stop;const stopped=new Promise((_,reject)=>{stop=()=>reject(signal.reason||unknown());signal?.addEventListener('abort',stop,{once:true});});const pending=Promise.resolve().then(()=>{if(signal?.aborted)throw signal.reason;return operation();}).then(value=>{if(signal?.aborted){void Promise.resolve(disposeLate?.(value)).catch(()=>{});throw signal.reason;}return value;});try{return await Promise.race([pending,stopped]);}finally{signal?.removeEventListener('abort',stop);}}
function createOpenAIMaskedEditProvider({apiKey='',baseUrl='',modelMap,client,fetchImpl=fetch,timeoutMs=600000}={}){
 const credentials=new Set([apiKey,typeof client?.apiKey==='string'?client.apiKey:''].filter(Boolean)),checkCredentials=value=>{for(const secret of credentials)assertCredentialFree(value,secret);};
 let map={},origin='',configurationError=null;
 try{map=parseOpenAIMaskedEditModelMap(modelMap);origin=endpoint(baseUrl||client?.baseURL||'https://api.openai.com/v1');if(baseUrl&&client?.baseURL&&origin!==endpoint(client.baseURL)||typeof apiKey!=='string'||apiKey&&(apiKey!==apiKey.trim()||apiKey.length>8192||/[\x00-\x1f\x7f]/.test(apiKey))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error();checkCredentials(map);checkCredentials(origin);}catch{configurationError='configuration_invalid';map={};origin='';}
 const missing=[...(!apiKey&&!client?['GENERATION_API_KEY']:[]),...(!Object.keys(map).length?['GENERATION_MODEL_MAP']:[])],configured=!configurationError&&!missing.length;
 const fingerprint=createHash('sha256').update(JSON.stringify({protocol:'openai-masked-edit-native',origin,map})).digest('hex');
 const maskedEdits=Object.fromEntries(Object.entries(map).map(([alias,e])=>[alias,{kind:e.kind,maxCount:e.maxCount??1,maxReferences:e.kind==='image.redraw'?1:0,sourcePosition:'last',nativeSourcePosition:'first',mask:'derived-png-alpha-zero',maskCoordinatePolicy:'unscaled-source-pixels',maxMaskBytes:4*1024*1024,allowDynamicSize:e.allowDynamicSize===true,sizes:Object.keys(e.sizeMap||{}),qualities:Object.keys(e.qualityMap),maskPrecision:'provider-guidance',verified:'official-schema-and-local-contract'}]));
 const metadata={configured,protocol:'openai-masked-edit-native',missing,configurationError,capabilities:{kinds:[...new Set(Object.values(map).map(e=>e.kind))],models:Object.fromEntries(Object.entries(map).map(([alias,e])=>[alias,{kind:e.kind}])),maskedEdits,references:Object.values(map).some(e=>e.kind==='image.redraw'),remoteRecovery:false,remoteCancellation:false,verified:'official-schema-and-local-contract'}};
 const guarded=protectGenerationFetch(fetchImpl);
 async function boundedFetch(url,options={}){
  const headers=new Headers(options.headers),authorization=headers.get('authorization');if(authorization?.startsWith('Bearer '))credentials.add(authorization.slice(7));headers.set('Accept-Encoding','identity');let response,reader,finished=false;
  try{response=await abortable(()=>guarded(url,{...options,headers}),options.signal,late=>late.body?.cancel());if(response.redirected||!response.body)throw unknown();const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');if(mime!=='application/json'||encoding&&encoding!=='identity'||length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>MAX_RESPONSE_BYTES||!Number(length)))throw unknown();reader=response.body.getReader();const parts=[];let size=0;for(;;){const next=await abortable(()=>reader.read(),options.signal);if(next.done)break;if(!(next.value instanceof Uint8Array)||(size+=next.value.byteLength)>MAX_RESPONSE_BYTES)throw unknown();parts.push(Buffer.from(next.value));}if(!size||length!==null&&Number(length)!==size)throw unknown();const bytes=Buffer.concat(parts);checkCredentials(bytes.toString('utf8'));finished=true;return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});}finally{if(!finished){if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{}}
 }
 let sdk=client?.withOptions?client.withOptions({fetch:boundedFetch,maxRetries:0}):client;
 function resolve(request){
  if(!configured)throw fail('OpenAI 蒙版编辑尚未配置 Key、模型、尺寸与质量能力','configuration_required');if(!object(request)||!KINDS.includes(request.kind)||Buffer.byteLength(JSON.stringify(request))>64*1024*1024)throw fail('蒙版编辑请求无效或超过 64 MiB');checkCredentials(request);
  const p=request.parameters??{};if(!object(p)||Object.keys(p).some(key=>!['model','modelId','aspectRatio','imageSize','quality','targetWidth','targetHeight','count','times','canvas'].includes(key)))throw fail('蒙版编辑含未支持参数；未忽略或提交');
  const alias=p.modelId??p.model,e=typeof alias==='string'&&Object.hasOwn(map,alias)?map[alias]:null;if(!e||e.kind!==request.kind)throw fail('此操作和模型尚未映射为原生蒙版编辑','configuration_required');if(p.model!==undefined&&p.model!==alias||p.modelId!==undefined&&p.modelId!==alias)throw fail('蒙版编辑模型标识矛盾');
  const count=p.count??p.times??request.count??1;if(!Number.isSafeInteger(count)||count<1||count>(e.maxCount??1)||[p.count,p.times,request.count].some(v=>v!==undefined&&v!==count))throw fail('蒙版编辑生成次数无效或矛盾');
  if(p.aspectRatio!=='auto'||!['1K','2K','4K'].includes(p.imageSize)||!Number.isSafeInteger(p.targetWidth)||!Number.isSafeInteger(p.targetHeight))throw fail('蒙版编辑须使用原前端 auto 画幅与真实目标尺寸');const size=p.targetWidth+'x'+p.targetHeight;
  if(!validSize(size))throw fail('目标尺寸不符合官方 GPT Image 2 的边长、16步长、比例或面积限制；未缩放或提交');if(!e.allowDynamicSize&&e.sizeMap?.[p.imageSize+'|'+size]!==size)throw fail('目标尺寸尚未明确映射','configuration_required');if(!Object.hasOwn(e.qualityMap,p.quality))throw fail('所选质量尚未明确映射','configuration_required');
  if(typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>32000)throw fail('蒙版编辑提示词须为 1–32000 字符');if(request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('蒙版编辑不接受未展开参考');
  const inputs=request.inputs;if(!Array.isArray(inputs)||inputs.length<1||inputs.length>(request.kind==='image.redraw'?2:1)||inputs.some(v=>!object(v)||v.type!=='image'))throw fail('蒙版编辑需要一张主图，重绘最多额外一张参考图');
  const images=inputs.map(inlineImage),main=images.at(-1),mainInput=inputs.at(-1);if(main.mime!=='image/png')throw fail('蒙版主图必须为前端输出的透明 PNG，不支持普通图生图替代');checkCredentials(main.bytes.toString('utf8'));const mask=alphaMask(main.bytes);
  for(let i=0;i<inputs.length;i++){const input=inputs[i],image=images[i];if(input.width!==undefined&&input.width!==image.width||input.height!==undefined&&input.height!==image.height)throw fail('图片声明尺寸与实际字节不一致');}
  if(request.sourceNodeId!==undefined&&mainInput.nodeId!==undefined&&request.sourceNodeId!==mainInput.nodeId)throw fail('蒙版主图与源节点身份不一致');
  if(request.kind==='image.outpaint'){const c=p.canvas;if(!object(c)||Object.keys(c).sort().join(',')!=='height,width,x,y'||!Object.values(c).every(Number.isSafeInteger)||c.width!==main.width||c.height!==main.height||c.x<0||c.y<0||c.x>=c.width||c.y>=c.height)throw fail('扩图坐标与透明画布尺寸不一致，未重采样');}else if(p.canvas!==undefined)throw fail('此操作不接受扩图坐标');
  let prompt=request.prompt;if(images.length===2){if(!prompt.startsWith(REDRAW_PREFIX)||!prompt.slice(REDRAW_PREFIX.length).trim())throw fail('带参考重绘提示词与前端主图/参考图序语义不一致');prompt=FIRST_PREFIX+prompt.slice(REDRAW_PREFIX.length);}
  return {count,main,mask,images:[main,...images.slice(0,-1)],body:{model:e.model,prompt,n:count,size,quality:e.qualityMap[p.quality],output_format:'png',stream:false},targetWidth:p.targetWidth,targetHeight:p.targetHeight};
 }
 async function submit(request,{signal}={}){
  const prepared=resolve(request);if(signal?.aborted)throw signal.reason;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(unknown()),timeoutMs);
  try{
   if(!sdk){const OpenAI=require('openai');sdk=new OpenAI({apiKey,baseURL:origin,fetch:boundedFetch,maxRetries:0,timeout:timeoutMs});}
   const {toFile}=require('openai'),uploads=[];for(const [index,image]of prepared.images.entries())uploads.push(await abortable(()=>toFile(image.bytes,index===0?'main.png':'reference.'+(image.mime==='image/jpeg'?'jpg':image.mime.slice(6)),{type:image.mime}),combined));const mask=await abortable(()=>toFile(prepared.mask.bytes,'mask.png',{type:'image/png'}),combined);
   const value=await abortable(()=>sdk.images.edit({...prepared.body,image:uploads,mask},{signal:combined,maxRetries:0,timeout:timeoutMs}),combined);checkCredentials(value);if(!object(value)||!Array.isArray(value.data)||value.data.length!==prepared.count)throw unknown();
   const outputs=value.data.map(item=>{if(!object(item)||typeof item.b64_json!=='string'||item.b64_json.length>64*1024*1024||item.url!==undefined)throw unknown();const image=inlineImage({url:'data:image/png;base64,'+item.b64_json},0);checkCredentials(image.bytes.toString('utf8'));const decoded=decodePNG(image.bytes);if(decoded.width!==prepared.targetWidth||decoded.height!==prepared.targetHeight)throw unknown();return {type:'image',url:'data:image/png;base64,'+item.b64_json,width:decoded.width,height:decoded.height};});if(combined.aborted)throw combined.reason;return {status:'succeeded',outputs};
  }catch(error){if(signal?.aborted)throw signal.reason;const OpenAI=require('openai');if(error instanceof OpenAI.APIError&&Number.isInteger(error.status)&&error.status>=400&&error.status<500&&![408,409].includes(error.status)){try{checkCredentials(error.message);checkCredentials(error.error);}catch{throw unknown();}return {status:'failed',code:'provider_rejected',error:'OpenAI 已拒绝蒙版编辑请求，请检查账号资格、额度或参数'};}throw unknown();}
  finally{clearTimeout(timer);controller.abort();}
 }
 return {configured,fingerprint,metadata,prepare:request=>{resolve(request);return request;},submit,generate:submit,isConfigured:()=>configured,isPollable:()=>false};
}
module.exports={createOpenAIMaskedEditProvider,parseOpenAIMaskedEditModelMap,validSize,REDRAW_PREFIX,FIRST_PREFIX,MAX_RESPONSE_BYTES};
