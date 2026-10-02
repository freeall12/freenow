'use strict';
const core=import('../video-mask-core.mjs');
const fail=(message,code,status=400)=>Object.assign(Error(message),{code,status});
const abort=()=>Object.assign(Error('识别已取消；外部服务是否停止尚未确认'),{name:'AbortError',code:'segmentation_cancelled'});
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const blockedDomains=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
function checkedUrl(value,base,{endpoint=false}={}){
 if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>8192)throw fail('视频分割服务地址无效','segmentation_invalid_url');
 let url;try{url=new URL(value,base);}catch{throw fail('视频分割服务地址无效','segmentation_invalid_url');}
 const host=url.hostname.toLowerCase().replace(/\.+$/,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||endpoint&&url.search||blockedDomains.some(domain=>host===domain||host.endsWith('.'+domain)))throw fail('视频分割服务地址不允许','segmentation_invalid_url');
 return url;
}

// Destination and credentials come only from the operator's server environment.
// This synchronous provider contract has no remote cancellation/status endpoint.
function createVideoSegmentationAdapter({baseUrl='',apiKey='',fetchImpl=fetch,timeoutMs=300000,maxConcurrent=2,maxBytes=68*1024*1024}={}){
 let endpoint=null,invalid=false,active=0;
 try{
  if(baseUrl)endpoint=checkedUrl(baseUrl,undefined,{endpoint:true});
  if(typeof apiKey!=='string'||apiKey.length>4096||/[\x00-\x1f\x7f]/.test(apiKey)||apiKey!==apiKey.trim()||typeof fetchImpl!=='function')throw Error();
 }catch{invalid=true;}
 const configured=!!endpoint&&!invalid;
 const config=()=>({configured,missing:!baseUrl?['VIDEO_SEGMENTATION_API_BASE_URL']:[],configurationError:invalid?'configuration_invalid':null,availabilityVerified:false,remoteCancellation:'unknown'});
 async function prepare(request){
  const {segmentationRequest}=await core;
  if(!object(request)||Object.keys(request).some(key=>!['kind','nodeId','sourceVideoUrl','width','height','duration','time','selection','pointPrompts'].includes(key))||request.kind!=='video.segment'||typeof request.nodeId!=='string'||!request.nodeId||request.nodeId.length>512||!Number.isFinite(request.duration)||request.duration<=0||request.width*request.height>16777216||typeof request.sourceVideoUrl!=='string')throw fail('视频分割请求无效','segmentation_invalid_request');
  if(!object(request.selection)||Object.keys(request.selection).length!==4||Object.keys(request.selection).some(key=>!['x','y','width','height'].includes(key)))throw fail('视频选区字段无效','segmentation_invalid_request');
  const source=request.sourceVideoUrl;
  if(source.startsWith('data:')){
   const match=/^data:video\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
   if(!match||match[1].length%4!==0||match[1].length>Math.ceil(50*1024*1024/3)*4)throw fail('视频字节格式无效或超过50MB','segmentation_invalid_request');
   const bytes=Buffer.from(match[1],'base64');if(!bytes.length||bytes.toString('base64')!==match[1])throw fail('视频字节格式无效','segmentation_invalid_request');
  }else checkedUrl(source);
  let expected;try{expected=segmentationRequest({nodeId:request.nodeId,source,rect:request.selection,time:request.time,width:request.width,height:request.height,duration:request.duration});}catch{throw fail('视频选区或时间信息无效','segmentation_invalid_request');}
  if(!Array.isArray(request.pointPrompts)||request.pointPrompts.length!==1||!object(request.pointPrompts[0])||Object.keys(request.pointPrompts[0]).length!==4||Object.entries(expected.pointPrompts[0]).some(([key,value])=>request.pointPrompts[0][key]!==value))throw fail('视频选区与像素提示不一致','segmentation_invalid_request');
  return expected;
 }
 async function segment(input,{signal}={}){
  if(signal?.aborted)throw abort();
  if(!configured)throw fail('请在本地服务环境配置视频分割服务地址并重启服务；尚未提交识别','configuration_required',503);
  if(active>=maxConcurrent)throw fail('视频分割正在处理其他请求，请稍后重试','segmentation_capacity',429);
  const request=await prepare(input);
  if(signal?.aborted)throw abort();
  // Recheck after asynchronous validation so simultaneous requests cannot pass
  // the same capacity slot. No request bodies or provider URLs are persisted.
  if(active>=maxConcurrent)throw fail('视频分割正在处理其他请求，请稍后重试','segmentation_capacity',429);
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,timeoutMs);let dispatched=false;
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  let rejectAbort;const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(signal?.aborted?abort():fail('视频分割超时，外部识别状态未知；未自动重试','segmentation_unknown',503));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  const wait=task=>{if(controller.signal.aborted)return Promise.reject(signal?.aborted?abort():fail('视频分割超时，外部识别状态未知；未自动重试','segmentation_unknown',503));return Promise.race([Promise.resolve().then(task),cancelled]);};
  const fetchResponse=(url,options)=>wait(async()=>{
   const response=await fetchImpl(url,options);
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw signal?.aborted?abort():fail('视频分割超时，外部识别状态未知','segmentation_unknown',503);}
   return response;
  });
  async function read(response){
   if(response.status>=300&&response.status<400)throw fail('视频分割服务返回跳转，未继续请求','segmentation_redirect',502);
   if(!response.ok)throw fail('视频分割服务请求失败，请检查服务端配置','segmentation_http_error',502);
   if(Number(response.headers?.get('content-length'))>maxBytes){void response.body?.cancel().catch(()=>{});throw fail('视频蒙层数据过大','segmentation_result_too_large',502);}
   if(!response.body?.getReader)throw fail('视频分割服务响应格式无效','segmentation_invalid_result',502);
   const reader=response.body.getReader(),parts=[];let size=0,completed=false;
   try{while(true){const part=await wait(()=>reader.read());if(part.done){completed=true;break;}size+=part.value.byteLength;if(size>maxBytes)throw fail('视频蒙层数据过大','segmentation_result_too_large',502);parts.push(Buffer.from(part.value));}}
   finally{if(!completed)void reader.cancel().catch(()=>{});reader.releaseLock();}
   try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('视频分割服务返回非法JSON','segmentation_invalid_result',502);}
  }
  active++;
  try{
   const url=endpoint.href.replace(/\/$/,'')+'/segment-video';dispatched=true;
   const response=await fetchResponse(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{})},body:JSON.stringify(request),signal:controller.signal});
   let result=await read(response);
   if(!object(result))throw fail('视频分割服务响应格式无效','segmentation_invalid_result',502);
   if(result.rleUrl&&!result.frames){
    const maskUrl=checkedUrl(result.rleUrl,endpoint);
    if(maskUrl.origin!==endpoint.origin)throw fail('蒙层文件必须来自已配置的分割服务','segmentation_invalid_url',502);
    const maskResponse=await fetchResponse(maskUrl.href,{redirect:'error',signal:controller.signal});
    result={...result,frames:await read(maskResponse)};
   }
   if(controller.signal.aborted)throw signal?.aborted?abort():fail('识别状态未知，未自动重试','segmentation_unknown',503);
   const {validateMask}=await core;
   let mask;try{mask=validateMask(result,request);}catch{throw fail('视频分割服务返回无效的RLE蒙层','segmentation_invalid_result',502);}
   return {width:mask.width,height:mask.height,fps:mask.fps,frames:mask.frames};
  }catch(error){
   if(signal?.aborted)throw abort();
   if(typeof error?.code==='string'&&(error.code.startsWith('segmentation_')||error.code==='configuration_required'))throw error;
   // A lost POST response cannot establish whether the provider accepted work.
   // Never retry, include provider error text, or claim remote cancellation.
   throw fail(dispatched?'视频分割回执未确认，外部识别状态未知；未自动重试':'视频分割请求未提交','segmentation_unknown',503);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);active--;}
 }
 async function handle(req,res,pathname,{json,body}){
  if(pathname==='/api/video-segmentation/config'&&req.method==='GET')return json(res,200,config());
  if(pathname!=='/api/video-segmentation/segment')return json(res,404,{error:'Unknown video segmentation route'});
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.on('close',close);
  try{
   const input=await body(req,68*1024*1024),result=await segment(input,{signal:controller.signal});
   if(!res.destroyed&&!controller.signal.aborted)return json(res,200,result);
  }catch(error){
   const known=typeof error?.code==='string'&&(error.code.startsWith('segmentation_')||error.code==='configuration_required');
   if(!res.destroyed&&!controller.signal.aborted)return json(res,known?error.status||400:400,{error:known?error.message:'视频分割请求格式无效',code:known?error.code:'segmentation_invalid_request'});
  }finally{res.removeListener('close',close);}
 }
 return {config,segment,handle};
}
module.exports={createVideoSegmentationAdapter,checkedUrl};
